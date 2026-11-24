'use strict';

const { ADMIN, startServer, request, loginAs, createUserAs, uniq } = require('./helpers');

describe('CRUD de usuarios', () => {
  let server;
  let admin;

  beforeAll(async () => {
    server = await startServer();
    admin = await loginAs(server.base, ADMIN.username, ADMIN.password);
  });

  afterAll(async () => {
    await server.stop();
  });

  const validBody = (overrides = {}) => {
    const username = uniq('nuevo');
    return { name: 'Persona Nueva', username, email: `${username}@example.com`, role: 'user', password: 'Clave12345', ...overrides };
  };

  describe('control de acceso', () => {
    test('GET /api/users sin sesión devuelve 401', async () => {
      const res = await request(server.base, 'GET', '/api/users');
      expect(res.status).toBe(401);
    });

    test('POST /api/users sin sesión devuelve 401', async () => {
      const res = await request(server.base, 'POST', '/api/users', { body: validBody() });
      expect(res.status).toBe(401);
    });

    test('un usuario con rol "user" puede listar usuarios', async () => {
      const u = await createUserAs(admin);
      const client = await loginAs(server.base, u.username, u.password);
      const res = await client.get('/api/users');
      expect(res.status).toBe(200);
    });

    test('un usuario con rol "user" no puede crear (403)', async () => {
      const u = await createUserAs(admin);
      const client = await loginAs(server.base, u.username, u.password);
      const res = await client.post('/api/users', validBody());
      expect(res.status).toBe(403);
      expect(res.json.error).toBe('forbidden');
    });

    test('un usuario con rol "user" no puede editar ni eliminar (403)', async () => {
      const u = await createUserAs(admin);
      const target = await createUserAs(admin);
      const client = await loginAs(server.base, u.username, u.password);
      expect((await client.put(`/api/users/${target.id}`, { name: 'Hackeado' })).status).toBe(403);
      expect((await client.del(`/api/users/${target.id}`)).status).toBe(403);
    });
  });

  describe('crear', () => {
    test('crea un usuario y devuelve 201 con cabecera Location', async () => {
      const body = validBody();
      const res = await admin.post('/api/users', body);
      expect(res.status).toBe(201);
      expect(res.headers.location).toBe(`/api/users/${res.json.user.id}`);
      expect(res.json.user).toMatchObject({ name: body.name, username: body.username, email: body.email, role: 'user' });
    });

    test('la respuesta no expone la contraseña ni su hash', async () => {
      const res = await admin.post('/api/users', validBody());
      expect(res.text).not.toMatch(/password|scrypt/);
    });

    test('el rol es "user" y el correo es null cuando no se envían', async () => {
      const username = uniq('min');
      const res = await admin.post('/api/users', { name: 'Mínimo Válido', username, password: 'Clave12345' });
      expect(res.status).toBe(201);
      expect(res.json.user.role).toBe('user');
      expect(res.json.user.email).toBeNull();
    });

    test('puede crear un administrador', async () => {
      const res = await admin.post('/api/users', validBody({ role: 'admin' }));
      expect(res.status).toBe(201);
      expect(res.json.user.role).toBe('admin');
    });

    test('el usuario creado puede iniciar sesión con su contraseña', async () => {
      const u = await createUserAs(admin);
      const client = await loginAs(server.base, u.username, u.password);
      expect((await client.get('/api/auth/me')).json.user.username).toBe(u.username);
    });

    test('rechaza un nombre de usuario duplicado con 409', async () => {
      const u = await createUserAs(admin);
      const res = await admin.post('/api/users', validBody({ username: u.username }));
      expect(res.status).toBe(409);
      expect(res.json.error).toBe('conflict');
    });

    test('el duplicado ignora mayúsculas y minúsculas', async () => {
      const u = await createUserAs(admin);
      const res = await admin.post('/api/users', validBody({ username: u.username.toUpperCase() }));
      expect(res.status).toBe(409);
    });

    test.each([
      ['name', { name: '' }],
      ['name', { name: 'A' }],
      ['username', { username: 'ab' }],
      ['username', { username: 'con espacios' }],
      ['username', { username: 'x'.repeat(31) }],
      ['email', { email: 'no-es-correo' }],
      ['role', { role: 'superadmin' }],
      ['password', { password: 'corta' }],
      ['password', { password: 'x'.repeat(73) }],
    ])('rechaza datos inválidos en "%s" con 400', async (field, override) => {
      const res = await admin.post('/api/users', validBody(override));
      expect(res.status).toBe(400);
      expect(res.json.details).toHaveProperty(field);
    });

    test('un cuerpo vacío devuelve 400 con los campos obligatorios', async () => {
      const res = await admin.post('/api/users', {});
      expect(res.status).toBe(400);
      expect(Object.keys(res.json.details)).toEqual(expect.arrayContaining(['name', 'username', 'password']));
    });

    test('un cuerpo demasiado grande devuelve 413', async () => {
      const res = await admin.post('/api/users', validBody({ name: 'x'.repeat(200 * 1024) }));
      expect(res.status).toBe(413);
    });

    test('intentar inyectar SQL en el usuario se rechaza por validación', async () => {
      const res = await admin.post('/api/users', validBody({ username: "x'; DROP TABLE users;--" }));
      expect(res.status).toBe(400);
      expect((await admin.get('/api/users')).status).toBe(200);
    });
  });

  describe('leer y buscar', () => {
    test('GET /api/users devuelve la lista y el total', async () => {
      const res = await admin.get('/api/users');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.json.users)).toBe(true);
      expect(res.json.total).toBe(res.json.users.length);
      expect(res.json.users.some((u) => u.username === 'admin')).toBe(true);
    });

    test('la lista nunca incluye contraseñas', async () => {
      const res = await admin.get('/api/users');
      expect(res.text).not.toMatch(/password|scrypt/);
    });

    test('GET /api/users/:id devuelve el usuario', async () => {
      const u = await createUserAs(admin);
      const res = await admin.get(`/api/users/${u.id}`);
      expect(res.status).toBe(200);
      expect(res.json.user.username).toBe(u.username);
    });

    test('GET /api/users/:id inexistente devuelve 404', async () => {
      expect((await admin.get('/api/users/999999')).status).toBe(404);
    });

    test('GET /api/users/:id con un id no numérico devuelve 404', async () => {
      expect((await admin.get('/api/users/abc')).status).toBe(404);
    });

    test('la búsqueda ?q= filtra por nombre, usuario o correo', async () => {
      const marker = uniq('buscame');
      await createUserAs(admin, { username: marker, name: 'Persona Buscada' });
      const byUser = await admin.get(`/api/users?q=${marker}`);
      expect(byUser.json.users.map((u) => u.username)).toEqual([marker]);
      const byName = await admin.get('/api/users?q=persona%20buscada');
      expect(byName.json.users.some((u) => u.username === marker)).toBe(true);
      const byMail = await admin.get(`/api/users?q=${marker}%40example`);
      expect(byMail.json.users.some((u) => u.username === marker)).toBe(true);
    });

    test('una búsqueda sin coincidencias devuelve lista vacía', async () => {
      const res = await admin.get('/api/users?q=zzzz-no-existe-zzzz');
      expect(res.status).toBe(200);
      expect(res.json.users).toEqual([]);
      expect(res.json.total).toBe(0);
    });

    test('los comodines de LIKE se tratan como texto literal', async () => {
      const res = await admin.get('/api/users?q=%25');
      expect(res.json.users).toEqual([]);
    });
  });

  describe('actualizar', () => {
    test('actualiza el nombre y conserva el resto', async () => {
      const u = await createUserAs(admin);
      const res = await admin.put(`/api/users/${u.id}`, { name: 'Nombre Cambiado' });
      expect(res.status).toBe(200);
      expect(res.json.user.name).toBe('Nombre Cambiado');
      expect(res.json.user.username).toBe(u.username);
    });

    test('actualiza correo y rol', async () => {
      const u = await createUserAs(admin);
      const res = await admin.put(`/api/users/${u.id}`, { email: 'otro@example.com', role: 'admin' });
      expect(res.json.user).toMatchObject({ email: 'otro@example.com', role: 'admin' });
    });

    test('un correo vacío lo deja en null', async () => {
      const u = await createUserAs(admin);
      const res = await admin.put(`/api/users/${u.id}`, { email: '' });
      expect(res.json.user.email).toBeNull();
    });

    test('cambiar la contraseña permite entrar con la nueva y no con la anterior', async () => {
      const u = await createUserAs(admin);
      expect((await admin.put(`/api/users/${u.id}`, { password: 'NuevaClave999' })).status).toBe(200);
      await expect(loginAs(server.base, u.username, 'NuevaClave999')).resolves.toBeDefined();
      await expect(loginAs(server.base, u.username, u.password)).rejects.toThrow();
    });

    test('una contraseña vacía en la edición la deja sin cambios', async () => {
      const u = await createUserAs(admin);
      expect((await admin.put(`/api/users/${u.id}`, { name: 'Sigue Igual', password: '' })).status).toBe(200);
      await expect(loginAs(server.base, u.username, u.password)).resolves.toBeDefined();
    });

    test('el campo updated_at se actualiza', async () => {
      const u = await createUserAs(admin);
      await new Promise((r) => setTimeout(r, 20));
      const res = await admin.put(`/api/users/${u.id}`, { name: 'Reloj Nuevo' });
      expect(new Date(res.json.user.updated_at).getTime()).toBeGreaterThan(new Date(u.updated_at).getTime());
    });

    test('rechaza cambiar el usuario a uno que ya existe (409)', async () => {
      const a = await createUserAs(admin);
      const b = await createUserAs(admin);
      const res = await admin.put(`/api/users/${b.id}`, { username: a.username });
      expect(res.status).toBe(409);
    });

    test('rechaza datos inválidos con 400', async () => {
      const u = await createUserAs(admin);
      expect((await admin.put(`/api/users/${u.id}`, { email: 'malo' })).status).toBe(400);
      expect((await admin.put(`/api/users/${u.id}`, { role: 'dios' })).status).toBe(400);
    });

    test('un cuerpo sin campos devuelve 400', async () => {
      const u = await createUserAs(admin);
      expect((await admin.put(`/api/users/${u.id}`, {})).status).toBe(400);
    });

    test('actualizar un usuario inexistente devuelve 404', async () => {
      expect((await admin.put('/api/users/999999', { name: 'Fantasma' })).status).toBe(404);
    });

    test('un administrador no puede quitarse su propio rol (409)', async () => {
      const me = (await admin.get('/api/auth/me')).json.user;
      const res = await admin.put(`/api/users/${me.id}`, { role: 'user' });
      expect(res.status).toBe(409);
      expect(res.json.error).toBe('cannot_demote_self');
    });

    test('mass-assignment: no se pueden modificar id ni created_at', async () => {
      const u = await createUserAs(admin);
      const res = await admin.put(`/api/users/${u.id}`, { name: 'Intento Mass', id: 9999, created_at: '2000-01-01T00:00:00.000Z' });
      expect(res.status).toBe(200);
      expect(res.json.user.id).toBe(u.id);
      expect(res.json.user.created_at).toBe(u.created_at);
    });
  });

  describe('eliminar', () => {
    test('elimina un usuario (204) y deja de existir', async () => {
      const u = await createUserAs(admin);
      expect((await admin.del(`/api/users/${u.id}`)).status).toBe(204);
      expect((await admin.get(`/api/users/${u.id}`)).status).toBe(404);
    });

    test('eliminar dos veces devuelve 404 la segunda', async () => {
      const u = await createUserAs(admin);
      await admin.del(`/api/users/${u.id}`);
      expect((await admin.del(`/api/users/${u.id}`)).status).toBe(404);
    });

    test('un administrador no puede eliminarse a sí mismo (409)', async () => {
      const me = (await admin.get('/api/auth/me')).json.user;
      const res = await admin.del(`/api/users/${me.id}`);
      expect(res.status).toBe(409);
      expect(res.json.error).toBe('cannot_delete_self');
    });

    test('el usuario eliminado ya no aparece en la lista', async () => {
      const u = await createUserAs(admin);
      await admin.del(`/api/users/${u.id}`);
      const list = await admin.get('/api/users');
      expect(list.json.users.some((x) => x.id === u.id)).toBe(false);
    });
  });

  test('un método no soportado devuelve 405 con la cabecera Allow', async () => {
    const res = await admin.call('PATCH', '/api/users', { body: {} });
    expect(res.status).toBe(405);
    expect(res.headers.allow).toMatch(/GET/);
    expect(res.headers.allow).toMatch(/POST/);
  });
});
