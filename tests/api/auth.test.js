'use strict';

const { ADMIN, startServer, request, createClient, loginAs, createUserAs, forgeToken } = require('./helpers');

describe('Autenticación', () => {
  let server;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(async () => {
    await server.stop();
  });

  test('login correcto devuelve 200 y los datos públicos del usuario', async () => {
    const client = createClient(server.base);
    const res = await client.post('/api/auth/login', ADMIN);
    expect(res.status).toBe(200);
    expect(res.json.user.username).toBe('admin');
    expect(res.json.user.role).toBe('admin');
  });

  test('la respuesta de login nunca incluye el hash de la contraseña', async () => {
    const res = await createClient(server.base).post('/api/auth/login', ADMIN);
    expect(res.text).not.toContain('password');
    expect(res.text).not.toContain('scrypt');
  });

  test('login entrega una cookie de sesión HttpOnly con SameSite=Lax', async () => {
    const res = await createClient(server.base).post('/api/auth/login', ADMIN);
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  test('el nombre de usuario no distingue mayúsculas de minúsculas', async () => {
    const res = await createClient(server.base).post('/api/auth/login', { username: 'ADMIN', password: ADMIN.password });
    expect(res.status).toBe(200);
  });

  test('contraseña incorrecta devuelve 401 con mensaje genérico', async () => {
    const res = await createClient(server.base).post('/api/auth/login', { username: 'admin', password: 'incorrecta' });
    expect(res.status).toBe(401);
    expect(res.json.error).toBe('invalid_credentials');
  });

  test('usuario inexistente devuelve el mismo mensaje que contraseña incorrecta', async () => {
    const wrongPassword = await createClient(server.base).post('/api/auth/login', { username: 'admin', password: 'x' });
    const unknownUser = await createClient(server.base).post('/api/auth/login', { username: 'fantasma', password: 'x' });
    expect(unknownUser.status).toBe(401);
    expect(unknownUser.json.message).toBe(wrongPassword.json.message);
  });

  test('login con campos vacíos devuelve 400 con detalles por campo', async () => {
    const res = await createClient(server.base).post('/api/auth/login', { username: '', password: '' });
    expect(res.status).toBe(400);
    expect(res.json.details).toHaveProperty('username');
    expect(res.json.details).toHaveProperty('password');
  });

  test('login con Content-Type distinto de JSON devuelve 415', async () => {
    const res = await request(server.base, 'POST', '/api/auth/login', {
      rawBody: 'username=admin&password=x',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(res.status).toBe(415);
  });

  test('login con JSON mal formado devuelve 400', async () => {
    const res = await request(server.base, 'POST', '/api/auth/login', { rawBody: '{"username": ' });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('invalid_json');
  });

  test('GET /api/auth/me con sesión devuelve el usuario actual', async () => {
    const client = await loginAs(server.base, ADMIN.username, ADMIN.password);
    const res = await client.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.json.user.username).toBe('admin');
  });

  test('GET /api/auth/me sin sesión devuelve 401', async () => {
    const res = await request(server.base, 'GET', '/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.json.error).toBe('unauthenticated');
  });

  test('logout elimina la cookie y la sesión deja de ser válida', async () => {
    const client = await loginAs(server.base, ADMIN.username, ADMIN.password);
    const out = await client.post('/api/auth/logout', undefined);
    expect(out.status).toBe(200);
    expect(out.headers['set-cookie'][0]).toMatch(/Max-Age=0/);
    const me = await client.get('/api/auth/me');
    expect(me.status).toBe(401);
  });

  test('un token con la firma alterada es rechazado', async () => {
    const token = forgeToken({ uid: 1, exp: Math.floor(Date.now() / 1000) + 600 });
    const tampered = `${token.slice(0, -2)}xx`;
    const res = await request(server.base, 'GET', '/api/auth/me', { cookie: `session=${tampered}` });
    expect(res.status).toBe(401);
  });

  test('un token vencido es rechazado', async () => {
    const token = forgeToken({ uid: 1, exp: Math.floor(Date.now() / 1000) - 60 });
    const res = await request(server.base, 'GET', '/api/auth/me', { cookie: `session=${token}` });
    expect(res.status).toBe(401);
  });

  test('un token firmado con otra clave es rechazado', async () => {
    const token = forgeToken({ uid: 1, exp: Math.floor(Date.now() / 1000) + 600 }, 'clave-del-atacante');
    const res = await request(server.base, 'GET', '/api/auth/me', { cookie: `session=${token}` });
    expect(res.status).toBe(401);
  });

  test('un token válido sí es aceptado (control de las pruebas anteriores)', async () => {
    const token = forgeToken({ uid: 1, exp: Math.floor(Date.now() / 1000) + 600 });
    const res = await request(server.base, 'GET', '/api/auth/me', { cookie: `session=${token}` });
    expect(res.status).toBe(200);
  });

  test('si se elimina un usuario, su sesión deja de funcionar de inmediato', async () => {
    const admin = await loginAs(server.base, ADMIN.username, ADMIN.password);
    const victim = await createUserAs(admin);
    const session = await loginAs(server.base, victim.username, victim.password);
    expect((await session.get('/api/auth/me')).status).toBe(200);
    expect((await admin.del(`/api/users/${victim.id}`)).status).toBe(204);
    expect((await session.get('/api/auth/me')).status).toBe(401);
  });
});
