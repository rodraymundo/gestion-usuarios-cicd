'use strict';

/**
 * Pruebas dirigidas por datos (tablas de casos): valores límite, formatos válidos e inválidos,
 * matriz de rutas x roles, métodos no permitidos, inyecciones y cabeceras de seguridad.
 */

const { ADMIN, startServer, request, createClient, loginAs, createUserAs, forgeToken } = require('./helpers');

let server;
let admin;
const userN = (() => { let n = 0; return () => `mx${Date.now().toString(36).slice(-4)}${++n}`; })();
const body = (o = {}) => { const u = userN(); return { name: 'Persona Matriz', username: u, email: `${u}@example.com`, role: 'user', password: 'Clave12345', ...o }; };

beforeAll(async () => {
  server = await startServer();
  admin = await loginAs(server.base, ADMIN.username, ADMIN.password);
});
afterAll(async () => { await server.stop(); });

describe('Validación de "username"', () => {
  const valid = ['abc', 'XYZ', 'a_b', 'a.b', 'a-b', 'user123', 'x'.repeat(30), 'u.s_e-r', '123', '___', 'a1b2c3', 'Usuario.Prueba', 'j.perez', 'maria_gomez', '  espacios  '];
  const invalid = ['', ' ', 'ab', 'a', 'x'.repeat(31), 'con espacio', 'ñandú', 'usér', 'user@mail', 'user!', 'user#1', 'user/1', 'user\\1', "user'", 'user"', 'user;', 'user<b>', '<script>', '../etc', 'user%20', 'ユーザー', '😀😀😀', null, 123, [], {}, true];
  test.each(valid.map((v) => [JSON.stringify(v), v]))('acepta %s', async (_label, value) => {
    const res = await admin.post('/api/users', body({ username: value }));
    expect(res.status).toBe(201);
    expect(res.json.user.username).toBe(String(value).trim());
  });
  test.each(invalid.map((v) => [JSON.stringify(v), v]))('rechaza %s', async (_label, value) => {
    const res = await admin.post('/api/users', body({ username: value }));
    expect(res.status).toBe(400);
    expect(res.json.details).toHaveProperty('username');
  });
});

describe('Validación de "email"', () => {
  const valid = ['a@b.co', 'user@example.com', 'user.name@example.com', 'user+tag@example.com', 'user_name@sub.example.com', 'u@e.io', 'USER@EXAMPLE.COM', 'a-b@c-d.org', '123@456.com', 'user@example.museum', '', null];
  const invalid = ['plain', '@x.com', 'user@', 'user@x', 'user@.com', 'user@x.', 'us er@x.com', 'a@@b.com', 'a@b@c.com', 'user@exa mple.com', 123, 'a'.repeat(115) + '@x.com', [], {}];
  test.each(valid.map((v) => [JSON.stringify(v), v]))('acepta %s', async (_l, value) => {
    const res = await admin.post('/api/users', body({ email: value }));
    expect(res.status).toBe(201);
    expect(res.json.user.email).toBe(value === '' ? null : value);
  });
  test.each(invalid.map((v) => [JSON.stringify(v).slice(0, 40), v]))('rechaza %s', async (_l, value) => {
    const res = await admin.post('/api/users', body({ email: value }));
    expect(res.status).toBe(400);
    expect(res.json.details).toHaveProperty('email');
  });
});

describe('Validación de "password" (valores límite)', () => {
  const valid = [8, 9, 20, 50, 72].map((n) => ['longitud ' + n, 'p'.repeat(n)]).concat([['con acentos y símbolos', 'Contraseña-ñ#2026!'], ['solo números', '12345678']]);
  test.each(valid)('acepta %s', async (_l, pwd) => {
    const user = body({ password: pwd });
    expect((await admin.post('/api/users', user)).status).toBe(201);
    await expect(loginAs(server.base, user.username, pwd)).resolves.toBeDefined();
  });
  const invalid = [['vacía', ''], ['1 carácter', 'a'], ['7 caracteres', '1234567'], ['73 caracteres', 'p'.repeat(73)], ['200 caracteres', 'p'.repeat(200)], ['nula', null], ['número', 12345678], ['arreglo', ['12345678']]];
  test.each(invalid)('rechaza %s', async (_l, pwd) => {
    const res = await admin.post('/api/users', body({ password: pwd }));
    expect(res.status).toBe(400);
    expect(res.json.details).toHaveProperty('password');
  });
});

describe('Validación de "name"', () => {
  const valid = [['2 caracteres', 'Al'], ['con acentos', 'José Ángel Muñoz'], ['apóstrofo', "O'Brien"], ['guion', 'Mary-Jane'], ['ideogramas', '李雷'], ['80 caracteres', 'n'.repeat(80)], ['con espacios al borde', '  Ana  '], ['con punto', 'Dr. Who']];
  test.each(valid)('acepta %s', async (_l, name) => {
    const res = await admin.post('/api/users', body({ name }));
    expect(res.status).toBe(201);
    expect(res.json.user.name).toBe(name.trim());
  });
  const invalid = [['vacío', ''], ['solo espacios', '   '], ['1 carácter', 'A'], ['81 caracteres', 'n'.repeat(81)], ['nulo', null], ['número', 123], ['arreglo', ['Ana']], ['1 carácter con espacios', '  A  ']];
  test.each(invalid)('rechaza %s', async (_l, name) => {
    const res = await admin.post('/api/users', body({ name }));
    expect(res.status).toBe(400);
    expect(res.json.details).toHaveProperty('name');
  });
});

describe('Validación de "role"', () => {
  test.each([['admin'], ['user']])('acepta "%s"', async (role) => {
    expect((await admin.post('/api/users', body({ role }))).json.user.role).toBe(role);
  });
  test.each([['Admin'], ['ADMIN'], ['root'], ['superadmin'], [''], ['guest'], [null], [1], [true], [['admin']]])('rechaza %j', async (role) => {
    const res = await admin.post('/api/users', body({ role }));
    expect(res.status).toBe(400);
    expect(res.json.details).toHaveProperty('role');
  });
});

describe('Matriz de rutas x roles', () => {
  const cases = [
    ['GET /health', 200, 200, 200],
    ['POST /api/auth/logout', 200, 200, 200],
    ['GET /api/auth/me', 401, 200, 200],
    ['GET /api/users', 401, 200, 200],
    ['GET /api/users/:id', 401, 200, 200],
    ['POST /api/users', 401, 403, 201],
    ['PUT /api/users/:id', 401, 403, 200],
    ['DELETE /api/users/:id', 401, 403, 204],
  ];
  const run = async (client, label, target) => {
    const [method, route] = label.split(' ');
    const p = route.replace(':id', target.id);
    const payload = method === 'POST' ? (route === '/api/users' ? body() : undefined) : method === 'PUT' ? { name: 'Nombre Nuevo' } : undefined;
    return client.call(method, p, payload !== undefined ? { body: payload } : {});
  };
  const who = [['sin sesión', 1], ['rol user', 2], ['rol admin', 3]];
  for (const [label, ...expected] of cases) {
    who.forEach(([name], i) => {
      test(`${label} como ${name} devuelve ${expected[i]}`, async () => {
        const target = await createUserAs(admin);
        let client;
        if (i === 0) client = createClient(server.base);
        else if (i === 1) { const u = await createUserAs(admin); client = await loginAs(server.base, u.username, u.password); }
        else client = await loginAs(server.base, ADMIN.username, ADMIN.password);
        const res = await run(client, label, target);
        expect(res.status).toBe(expected[i]);
      });
    });
  }
});

describe('Métodos HTTP no permitidos (405)', () => {
  const table = [
    ['/health', ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']],
    ['/api/auth/login', ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']],
    ['/api/auth/logout', ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']],
    ['/api/auth/me', ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']],
    ['/api/users', ['PUT', 'DELETE', 'PATCH', 'OPTIONS']],
    ['/api/users/1', ['POST', 'PATCH', 'OPTIONS']],
  ];
  const cases = table.flatMap(([p, methods]) => methods.map((m) => [m, p]));
  test.each(cases)('%s %s devuelve 405 con cabecera Allow', async (method, path) => {
    const res = await admin.call(method, path);
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBeDefined();
    expect(res.headers.allow).not.toMatch(new RegExp(`\\b${method}\\b`));
  });
});

describe('Identificadores inválidos en /api/users/:id', () => {
  const ids = ['0', '-1', '1.5', 'abc', '99999999999999999999', '1e3', '%00', 'null', 'undefined', '1 OR 1=1', '００１'];
  const cases = ids.flatMap((id) => [['GET', id], ['PUT', id], ['DELETE', id]]);
  test.each(cases)('%s con id "%s" devuelve 404', async (method, id) => {
    const res = await admin.call(method, `/api/users/${encodeURIComponent(id)}`, method === 'PUT' ? { body: { name: 'Nadie Aqui' } } : {});
    expect(res.status).toBe(404);
  });
});

describe('Intentos de inyección', () => {
  const sqli = ["' OR '1'='1", "' OR 1=1--", "admin'--", "admin' #", "'; DROP TABLE users;--", "\" OR \"\"=\"", "') OR ('1'='1", '1; SELECT * FROM users', "' UNION SELECT 1,2,3--", "admin' AND SLEEP(5)--", '%27%20OR%201%3D1', '\\\' OR 1=1'];
  test.each(sqli.map((s) => [s]))('login con usuario %j no concede acceso', async (payload) => {
    const res = await request(server.base, 'POST', '/api/auth/login', { body: { username: payload, password: 'x' } });
    expect([400, 401]).toContain(res.status);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
  test.each(sqli.map((s) => [s]))('login con contraseña %j no concede acceso', async (payload) => {
    const res = await request(server.base, 'POST', '/api/auth/login', { body: { username: 'admin', password: payload } });
    expect(res.status).toBe(401);
  });
  test.each(sqli.map((s) => [s]))('búsqueda con %j se trata como texto', async (payload) => {
    const res = await admin.get(`/api/users?q=${encodeURIComponent(payload)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.users)).toBe(true);
  });
  const xss = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>', "';alert(1);//", '<iframe src=javascript:alert(1)>', '<a href="javascript:alert(1)">x</a>', '{{7*7}}', '${7*7}', '<b>negrita</b>', '&lt;script&gt;'];
  test.each(xss.map((s) => [s]))('el nombre %j se guarda y devuelve como texto, nunca como HTML', async (name) => {
    const created = await admin.post('/api/users', body({ name }));
    expect(created.status).toBe(201);
    expect(created.json.user.name).toBe(name);
    const got = await admin.get(`/api/users/${created.json.user.id}`);
    expect(got.headers['content-type']).toMatch(/application\/json/);
    expect(got.json.user.name).toBe(name);
  });
  test('después de todos los intentos la tabla de usuarios sigue intacta', async () => {
    const res = await admin.get('/api/users');
    expect(res.json.users.some((u) => u.username === 'admin')).toBe(true);
  });
});

describe('Archivos estáticos', () => {
  const files = [['/', 'text/html'], ['/index.html', 'text/html'], ['/users.html', 'text/html'], ['/css/styles.css', 'text/css'], ['/js/common.js', 'javascript'], ['/js/login.js', 'javascript'], ['/js/users.js', 'javascript'], ['/favicon.svg', 'image/svg\\+xml']];
  test.each(files)('GET %s devuelve 200 con tipo %s', async (path, type) => {
    const res = await request(server.base, 'GET', path);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(new RegExp(type));
    expect(res.text.length).toBeGreaterThan(0);
  });
  const hidden = ['/nope', '/css/nope.css', '/js/nope.js', '/.env', '/.git/config', '/package.json', '/backend/src/server.js', '/tests/api/helpers.js', '/%2e%2e/package.json', '/..%2fpackage.json', '/%2e%2e%2f%2e%2e%2fetc/passwd', '/js/../../package.json', '/css/', '/js/'];
  test.each(hidden.map((p) => [p]))('GET %s devuelve 404 sin filtrar código', async (path) => {
    const res = await request(server.base, 'GET', path);
    expect(res.status).toBe(404);
    expect(res.text).not.toMatch(/createApp|gestion-usuarios-cicd|root:/);
  });
  test.each([['POST'], ['PUT'], ['DELETE'], ['PATCH']])('%s / devuelve 405', async (method) => {
    expect((await request(server.base, method, '/')).status).toBe(405);
  });
  test('HEAD / devuelve 200 sin cuerpo', async () => {
    const res = await request(server.base, 'HEAD', '/');
    expect(res.status).toBe(200);
    expect(res.text).toBe('');
  });
});

describe('Cabeceras de seguridad en todas las respuestas', () => {
  const paths = ['/', '/users.html', '/css/styles.css', '/js/users.js', '/health', '/api/users', '/api/no-existe', '/no-existe'];
  const headers = [
    ['x-content-type-options', /nosniff/],
    ['x-frame-options', /DENY/],
    ['content-security-policy', /frame-ancestors 'none'/],
    ['referrer-policy', /no-referrer/],
  ];
  const cases = paths.flatMap((p) => headers.map(([h, re]) => [p, h, re]));
  test.each(cases)('%s incluye %s', async (path, header, re) => {
    const res = await request(server.base, 'GET', path);
    expect(res.headers[header]).toMatch(re);
  });
  test.each([['/health'], ['/api/users'], ['/api/auth/me'], ['/api/no-existe']])('la API no cachea %s', async (path) => {
    const res = await request(server.base, 'GET', path);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('Cuerpos y tipos de contenido', () => {
  test.each([['text/plain'], ['application/x-www-form-urlencoded'], ['multipart/form-data'], ['application/xml'], ['text/html']])('login con Content-Type %s devuelve 415', async (type) => {
    const res = await request(server.base, 'POST', '/api/auth/login', { rawBody: 'x=1', headers: { 'Content-Type': type } });
    expect(res.status).toBe(415);
  });
  test.each([['application/json; charset=utf-8'], ['APPLICATION/JSON'], ['application/json;charset=UTF-8']])('login con Content-Type %s es aceptado', async (type) => {
    const res = await request(server.base, 'POST', '/api/auth/login', { rawBody: JSON.stringify(ADMIN), headers: { 'Content-Type': type } });
    expect(res.status).toBe(200);
  });
  test.each([['{'], ['{"a":'], ['['], ['nul'], ["{'a':1}"], ['{"a":1,}'], ['<xml/>'], ['{"username":"admin" "password":"x"}']])('JSON mal formado %j devuelve 400', async (raw) => {
    const res = await request(server.base, 'POST', '/api/auth/login', { rawBody: raw });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('invalid_json');
  });
  const odd = [
    { username: 123, password: 'x' }, { username: null, password: 'x' }, { username: ['admin'], password: 'x' }, { username: {}, password: 'x' },
    { username: 'admin', password: 123 }, { username: 'admin', password: null }, { username: 'admin', password: ['x'] },
    { username: 'admin' }, { password: 'x' }, {}, [], 'texto', 42, null, true,
  ];
  test.each(odd.map((o) => [JSON.stringify(o)]))('login con cuerpo %s devuelve 400', async (raw) => {
    const res = await request(server.base, 'POST', '/api/auth/login', { rawBody: raw });
    expect(res.status).toBe(400);
  });
  test.each(odd.map((o) => [JSON.stringify(o)]))('crear usuario con cuerpo %s devuelve 400', async (raw) => {
    const res = await admin.call('POST', '/api/users', { rawBody: raw });
    expect(res.status).toBe(400);
  });
});

describe('Búsqueda con distintas consultas', () => {
  const queries = ['a', 'A', 'admin', 'ADMIN', 'Administrador', '%', '_', '\\', '"', "'", 'a b', '   ', 'ñ', '😀', 'x'.repeat(200), 'x'.repeat(81), '<script>', ';--', '%00', 'null'];
  test.each(queries.map((q) => [JSON.stringify(q).slice(0, 30), q]))('?q=%s responde 200 y es consistente', async (_l, q) => {
    const res = await admin.get(`/api/users?q=${encodeURIComponent(q)}`);
    expect(res.status).toBe(200);
    expect(res.json.total).toBe(res.json.users.length);
  });
  test.each([['admin', 1], ['ADMIN', 1], ['Administrador', 1], ['istrad', 1], ['zzzzzz-no', 0]])('?q=%s encuentra %i resultado(s) del administrador', async (q, expected) => {
    const res = await admin.get(`/api/users?q=${q}`);
    expect(res.json.users.filter((u) => u.username === 'admin').length).toBe(expected);
  });
});

describe('Duplicados y actualización campo por campo', () => {
  test.each([['igual', (u) => u], ['MAYÚSCULAS', (u) => u.toUpperCase()], ['Capitalizado', (u) => u[0].toUpperCase() + u.slice(1)], ['con espacios', (u) => `  ${u}  `]])('usuario duplicado (%s) devuelve 409', async (_l, fn) => {
    const u = await createUserAs(admin);
    const res = await admin.post('/api/users', body({ username: fn(u.username) }));
    expect(res.status).toBe(409);
  });
  test.each([['name', 'Nombre Distinto'], ['email', 'nuevo@example.com'], ['role', 'admin'], ['password', 'ClaveNueva999'], ['username', 'renombrado']])('actualizar solo "%s" funciona', async (field, value) => {
    const u = await createUserAs(admin);
    const v = field === 'username' ? userN() : value;
    const res = await admin.put(`/api/users/${u.id}`, { [field]: v });
    expect(res.status).toBe(200);
    if (field !== 'password') expect(res.json.user[field]).toBe(v);
  });
  test.each([['name', ''], ['email', 'malo'], ['role', 'dios'], ['password', 'corta'], ['username', 'a b']])('actualizar "%s" con un valor inválido devuelve 400', async (field, value) => {
    const u = await createUserAs(admin);
    const res = await admin.put(`/api/users/${u.id}`, { [field]: value });
    expect(res.status).toBe(400);
    expect(res.json.details).toHaveProperty(field);
  });
  test.each([['is_admin', true], ['id', 99999], ['created_at', '2000-01-01'], ['password_hash', 'evil'], ['__proto__', { role: 'admin' }]])('el campo no permitido "%s" se ignora al crear', async (field, value) => {
    const data = body();
    const res = await admin.call('POST', '/api/users', { rawBody: JSON.stringify({ ...data, [field]: value }).replace('"__proto__"', '"__proto__"') });
    expect(res.status).toBe(201);
    expect(res.json.user.role).toBe('user');
    expect(res.json.user.id).not.toBe(99999);
    await expect(loginAs(server.base, data.username, data.password)).resolves.toBeDefined();
  });
});

describe('Tokens de sesión inválidos', () => {
  const now = Math.floor(Date.now() / 1000);
  const tokens = [['vacío', ''], ['texto suelto', 'abc'], ['sin firma', 'abc.'], ['dos partes falsas', 'abc.def'], ['tres partes', 'a.b.c'], ['solo punto', '.'], ['null', 'null'], ['muy largo', 'x'.repeat(5000)], ['uid inexistente', forgeToken({ uid: 987654, exp: now + 600 })], ['sin uid', forgeToken({ exp: now + 600 })], ['sin exp', forgeToken({ uid: 1 })], ['uid de texto', forgeToken({ uid: '1', exp: now + 600 })], ['uid decimal', forgeToken({ uid: 1.5, exp: now + 600 })], ['exp en el pasado', forgeToken({ uid: 1, exp: now - 5 })]];
  test.each(tokens)('%s devuelve 401', async (_l, token) => {
    const res = await request(server.base, 'GET', '/api/auth/me', { cookie: `session=${token}` });
    expect(res.status).toBe(401);
  });
  test.each([['%E0%A4%A'], ['%'], ['%%%'], ['abc%zz']])('una cookie mal codificada %s devuelve 401 y no un error 500', async (raw) => {
    const res = await request(server.base, 'GET', '/api/auth/me', { cookie: `session=${raw}` });
    expect(res.status).toBe(401);
  });
  test.each([['sess'], ['token'], ['SESSION'], ['connect.sid']])('una cookie llamada "%s" no inicia sesión', async (name) => {
    const res = await request(server.base, 'GET', '/api/auth/me', { cookie: `${name}=${forgeToken({ uid: 1, exp: now + 600 })}` });
    expect(res.status).toBe(401);
  });
});
