'use strict';

const { startServer, request } = require('./helpers');

describe('Endpoint Health y servidor estático', () => {
  let server;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(async () => {
    await server.stop();
  });

  test('GET /health responde 200 con status "ok"', async () => {
    const res = await request(server.base, 'GET', '/health');
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('ok');
  });

  test('GET /health responde en formato JSON', async () => {
    const res = await request(server.base, 'GET', '/health');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  test('GET /health incluye un timestamp ISO 8601 válido', async () => {
    const res = await request(server.base, 'GET', '/health');
    expect(new Date(res.json.timestamp).toISOString()).toBe(res.json.timestamp);
  });

  test('GET /health incluye versión y uptime numérico', async () => {
    const res = await request(server.base, 'GET', '/health');
    expect(typeof res.json.version).toBe('string');
    expect(typeof res.json.uptime_s).toBe('number');
    expect(res.json.uptime_s).toBeGreaterThanOrEqual(0);
  });

  test('GET /health comprueba la base de datos', async () => {
    const res = await request(server.base, 'GET', '/health');
    expect(res.json.checks.database).toBe('ok');
  });

  test('GET /health responde en menos de 500 ms', async () => {
    const started = Date.now();
    await request(server.base, 'GET', '/health');
    expect(Date.now() - started).toBeLessThan(500);
  });

  test('las respuestas incluyen cabeceras de seguridad', async () => {
    const res = await request(server.base, 'GET', '/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
  });

  test('POST /health devuelve 405 y anuncia GET en Allow', async () => {
    const res = await request(server.base, 'POST', '/health', { body: {} });
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET');
  });

  test('una ruta de la API que no existe devuelve 404 en JSON', async () => {
    const res = await request(server.base, 'GET', '/api/no-existe');
    expect(res.status).toBe(404);
    expect(res.json.error).toBe('not_found');
  });

  test('GET / sirve la página de inicio de sesión', async () => {
    const res = await request(server.base, 'GET', '/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Iniciar sesión');
  });

  test('GET /users.html sirve la página de usuarios', async () => {
    const res = await request(server.base, 'GET', '/users.html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Nuevo usuario');
  });

  test('un archivo estático inexistente devuelve 404', async () => {
    const res = await request(server.base, 'GET', '/no-existe.html');
    expect(res.status).toBe(404);
  });

  test('no permite salir de la carpeta pública (path traversal)', async () => {
    const res = await request(server.base, 'GET', '/..%2f..%2fpackage.json');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('gestion-usuarios-cicd');
  });
});
