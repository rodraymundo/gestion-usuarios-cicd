'use strict';

/**
 * Utilidades para las pruebas de la API (Jest).
 * Cada archivo de prueba arranca su propio servidor real (proceso hijo) con una base de datos
 * SQLite en memoria y lo consulta por HTTP, igual que lo haría un cliente externo.
 */

const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const ENTRY = path.join(ROOT, 'backend', 'src', 'server.js');
const SECRET = 'secreto-solo-para-pruebas';
const ADMIN = { username: 'admin', password: 'Admin123!' };

let counter = 0;
/** Genera un nombre de usuario único para que las pruebas no se estorben entre sí. */
function uniq(prefix = 'u') {
  counter += 1;
  return `${prefix}${Date.now().toString(36).slice(-5)}${counter}`;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function request(base, method, pathname, { body, rawBody, headers = {}, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, base);
    const payload = rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined;
    const reqHeaders = { ...headers };
    if (payload !== undefined) {
      if (!reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    if (cookie) reqHeaders.Cookie = cookie;
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: reqHeaders },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function waitFor(check, timeoutMs, describeFailure) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      /* el servidor aún no responde */
    }
    if (Date.now() > deadline) throw new Error(describeFailure ? describeFailure() : 'Tiempo de espera agotado');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function startServer(extraEnv = {}) {
  const port = await freePort();
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DB_PATH: ':memory:',
    SESSION_SECRET: SECRET,
    ADMIN_USER: ADMIN.username,
    ADMIN_PASSWORD: ADMIN.password,
    SEED_DEMO: '0',
    LOG_STDOUT: '0',
    NODE_NO_WARNINGS: '1',
    OTEL_EXPORTER_OTLP_ENDPOINT: '',
    ...extraEnv,
  };
  const child = spawn(process.execPath, [ENTRY], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(
    async () => (await request(base, 'GET', '/health')).status === 200,
    20000,
    () => `El servidor no arrancó a tiempo. stderr: ${stderr}`
  );
  const stop = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 4000).unref();
    });
  return { base, port, stop };
}

/** Cliente con "cookie jar" mínimo: recuerda la cookie de sesión entre llamadas. */
function createClient(base) {
  let cookie = '';
  const client = {
    get cookie() {
      return cookie;
    },
    async call(method, pathname, options = {}) {
      const res = await request(base, method, pathname, { cookie, ...options });
      const setCookie = res.headers['set-cookie'];
      if (setCookie && setCookie.length > 0) {
        const first = setCookie[0].split(';')[0];
        cookie = first.endsWith('=') ? '' : first;
      }
      return res;
    },
  };
  client.get = (pathname, options) => client.call('GET', pathname, options);
  client.post = (pathname, body, options) => client.call('POST', pathname, { ...options, body });
  client.put = (pathname, body, options) => client.call('PUT', pathname, { ...options, body });
  client.del = (pathname, options) => client.call('DELETE', pathname, options);
  return client;
}

async function loginAs(base, username, password) {
  const client = createClient(base);
  const res = await client.call('POST', '/api/auth/login', { body: { username, password } });
  if (res.status !== 200) throw new Error(`Login falló para ${username}: ${res.status} ${res.text}`);
  return client;
}

/** Crea un usuario (con un cliente administrador) y devuelve sus datos y credenciales. */
async function createUserAs(adminClient, overrides = {}) {
  const username = overrides.username || uniq('usr');
  const data = {
    name: 'Usuario de Prueba',
    username,
    email: `${username}@example.com`,
    role: 'user',
    password: 'Clave12345',
    ...overrides,
  };
  const res = await adminClient.call('POST', '/api/users', { body: data });
  if (res.status !== 201) throw new Error(`No se pudo crear ${username}: ${res.status} ${res.text}`);
  return { ...res.json.user, password: data.password };
}

/** Misma firma HMAC que usa el servidor; sirve para fabricar tokens válidos, vencidos o alterados. */
function forgeToken(payload, secret = SECRET) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

module.exports = { ADMIN, SECRET, uniq, request, startServer, createClient, loginAs, createUserAs, forgeToken, waitFor };
