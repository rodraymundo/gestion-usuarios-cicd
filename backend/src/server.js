'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadConfig } = require('./config');
const { createTelemetry } = require('./telemetry');
const { openDatabase } = require('./db');
const auth = require('./auth');
const { validateUser } = require('./validate');

class HttpError extends Error {
  constructor(status, code, message, details, headers) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function createApp(config = loadConfig()) {
  const telemetry = createTelemetry(config);
  const db = openDatabase(config.dbPath, telemetry);
  let dummyHash = null; // para que el login tarde igual si el usuario no existe

  const publicUser = ({ password_hash: _hash, ...rest }) => rest;

  // ---------------------------------------------------------------- utilidades HTTP
  function sendJson(res, status, body, headers = {}) {
    if (status === 204) {
      res.writeHead(204, { 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
      res.end();
      return;
    }
    const payload = JSON.stringify(body ?? {});
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...headers,
    });
    res.end(payload);
  }

  async function readJson(req) {
    const limit = config.maxBodyBytes;
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit * 10) {
        req.destroy();
        throw new HttpError(413, 'payload_too_large', 'El cuerpo de la petición es demasiado grande');
      }
      if (size <= limit) chunks.push(chunk);
    }
    if (size > limit) throw new HttpError(413, 'payload_too_large', 'El cuerpo de la petición es demasiado grande');
    if (size === 0) return {};
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') {
      throw new HttpError(415, 'unsupported_media_type', 'Content-Type debe ser application/json');
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new HttpError(400, 'invalid_json', 'El cuerpo no es un JSON válido');
    }
  }

  async function authenticate(req) {
    const cookies = auth.parseCookies(req.headers.cookie);
    const payload = auth.verifyToken(cookies[auth.COOKIE_NAME], config.sessionSecret);
    const user = payload && Number.isInteger(payload.uid) ? db.get(payload.uid) : null;
    if (!user) throw new HttpError(401, 'unauthenticated', 'Debes iniciar sesión');
    return user;
  }

  const parseId = (raw) => {
    if (!/^\d{1,12}$/.test(raw)) throw new HttpError(404, 'not_found', 'Usuario no encontrado');
    return Number(raw);
  };

  // ---------------------------------------------------------------- manejadores
  async function health() {
    let dbOk = true;
    try {
      db.ping();
    } catch {
      dbOk = false;
    }
    return {
      status: dbOk ? 200 : 503,
      body: {
        status: dbOk ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime_s: Math.round(process.uptime()),
        version: config.version,
        checks: { database: dbOk ? 'ok' : 'error' },
      },
    };
  }

  async function login({ body: rawBody }) {
    const body = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? rawBody : {};
    const errors = {};
    if (typeof body.username !== 'string' || !body.username.trim()) errors.username = 'El usuario es obligatorio';
    if (typeof body.password !== 'string' || !body.password) errors.password = 'La contraseña es obligatoria';
    if (Object.keys(errors).length > 0) throw new HttpError(400, 'validation', 'Datos incompletos', errors);

    const username = body.username.trim().slice(0, 60);
    const user = db.getByUsername(username);
    const valid = await auth.verifyPassword(body.password, user ? user.password_hash : dummyHash);
    if (!user || !valid) {
      telemetry.log('warn', 'login_failed', { 'user.name': username });
      throw new HttpError(401, 'invalid_credentials', 'Usuario o contraseña incorrectos');
    }
    const exp = Math.floor(Date.now() / 1000) + config.sessionTtlSeconds;
    const token = auth.signToken({ uid: user.id, exp }, config.sessionSecret);
    telemetry.log('info', 'login_ok', { 'user.name': user.username, 'user.role': user.role });
    return {
      status: 200,
      body: { user: publicUser(user) },
      headers: { 'Set-Cookie': auth.sessionCookie(token, config.sessionTtlSeconds) },
    };
  }

  async function logout() {
    return { status: 200, body: { ok: true }, headers: { 'Set-Cookie': auth.clearCookie() } };
  }

  async function me({ user }) {
    return { status: 200, body: { user: publicUser(user) } };
  }

  async function listUsers({ url }) {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
    const users = db.list(q);
    return { status: 200, body: { users, total: users.length } };
  }

  async function getUser({ params }) {
    const user = db.get(parseId(params.id));
    if (!user) throw new HttpError(404, 'not_found', 'Usuario no encontrado');
    return { status: 200, body: { user } };
  }

  async function createUser({ body, user: actor }) {
    const { errors, value } = validateUser(body, { create: true });
    if (Object.keys(errors).length > 0) throw new HttpError(400, 'validation', 'Datos no válidos', errors);
    const passwordHash = await auth.hashPassword(value.password);
    try {
      const created = db.insert({ ...value, password_hash: passwordHash });
      telemetry.log('info', 'user_created', { 'user.id': created.id, 'user.name': created.username, 'actor.name': actor.username });
      return { status: 201, body: { user: created }, headers: { Location: `/api/users/${created.id}` } };
    } catch (err) {
      if (/UNIQUE constraint failed/i.test(err.message)) {
        throw new HttpError(409, 'conflict', 'Ya existe un usuario con ese nombre de usuario', {
          username: 'Ya existe un usuario con ese nombre de usuario',
        });
      }
      throw err;
    }
  }

  async function updateUser({ params, body, user: actor }) {
    const id = parseId(params.id);
    if (!db.get(id)) throw new HttpError(404, 'not_found', 'Usuario no encontrado');
    const { errors, value } = validateUser(body, { create: false });
    if (Object.keys(errors).length > 0) throw new HttpError(400, 'validation', 'Datos no válidos', errors);
    if (Object.keys(value).length === 0) throw new HttpError(400, 'validation', 'No hay datos para actualizar');
    if (id === actor.id && value.role && value.role !== 'admin') {
      throw new HttpError(409, 'cannot_demote_self', 'No puedes quitarte tu propio rol de administrador');
    }
    const fields = { ...value };
    if (fields.password) {
      fields.password_hash = await auth.hashPassword(fields.password);
      delete fields.password;
    }
    try {
      const updated = db.update(id, fields);
      telemetry.log('info', 'user_updated', { 'user.id': id, 'actor.name': actor.username });
      return { status: 200, body: { user: updated } };
    } catch (err) {
      if (/UNIQUE constraint failed/i.test(err.message)) {
        throw new HttpError(409, 'conflict', 'Ya existe un usuario con ese nombre de usuario', {
          username: 'Ya existe un usuario con ese nombre de usuario',
        });
      }
      throw err;
    }
  }

  async function deleteUser({ params, user: actor }) {
    const id = parseId(params.id);
    if (id === actor.id) throw new HttpError(409, 'cannot_delete_self', 'No puedes eliminar tu propio usuario');
    if (!db.remove(id)) throw new HttpError(404, 'not_found', 'Usuario no encontrado');
    telemetry.log('info', 'user_deleted', { 'user.id': id, 'actor.name': actor.username });
    return { status: 204 };
  }

  // ---------------------------------------------------------------- rutas
  const routes = [
    ['GET', '/health', 'none', health],
    ['POST', '/api/auth/login', 'none', login],
    ['POST', '/api/auth/logout', 'none', logout],
    ['GET', '/api/auth/me', 'user', me],
    ['GET', '/api/users', 'user', listUsers],
    ['POST', '/api/users', 'admin', createUser],
    ['GET', '/api/users/:id', 'user', getUser],
    ['PUT', '/api/users/:id', 'admin', updateUser],
    ['DELETE', '/api/users/:id', 'admin', deleteUser],
  ].map(([method, pattern, access, handler]) => ({
    method,
    pattern,
    access,
    handler,
    regex: new RegExp(`^${pattern.replace(/:[a-z]+/g, '([^/]+)')}$`),
    keys: [...pattern.matchAll(/:([a-z]+)/g)].map((m) => m[1]),
  }));

  function matchRoute(method, pathname) {
    const allowed = [];
    for (const route of routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      if (route.method === method) {
        const params = Object.fromEntries(route.keys.map((key, i) => [key, decodeURIComponent(m[i + 1])]));
        return { route, params, allowed };
      }
      allowed.push(route.method);
    }
    return { route: null, params: {}, allowed };
  }

  // ---------------------------------------------------------------- archivos estáticos (frontend)
  async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY_HEADERS });
      res.end();
      return;
    }
    const notFound = () => {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end('No encontrado');
    };
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return notFound();
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const root = path.resolve(config.staticDir);
    const full = path.join(root, path.normalize(rel));
    if (!full.startsWith(root + path.sep) || path.basename(full).startsWith('.')) return notFound();
    try {
      const data = await fs.promises.readFile(full);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': 'no-cache',
        ...SECURITY_HEADERS,
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      notFound();
    }
  }

  // ---------------------------------------------------------------- ciclo de vida de cada petición
  async function handleApi(req, res, url) {
    const { route, params, allowed } = matchRoute(req.method, url.pathname);
    const routeLabel = route ? route.pattern : 'unmatched';
    const span = telemetry.startSpan(`${req.method} ${routeLabel}`, {
      kind: 2,
      attributes: {
        'http.method': req.method,
        'http.route': routeLabel,
        'http.target': url.pathname,
        'http.user_agent': String(req.headers['user-agent'] || '').slice(0, 120),
      },
    });
    const t0 = process.hrtime.bigint();
    let actor = null;
    let finished = false;

    const finalize = () => {
      if (finished) return;
      finished = true;
      const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
      const status = res.statusCode;
      span.setAttribute('http.status_code', status);
      if (status >= 500) span.setError(`HTTP ${status}`);
      span.end();
      telemetry.recordRequest({ method: req.method, route: routeLabel, status, durationMs });
      telemetry.log(
        status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
        `${req.method} ${routeLabel} ${status}`,
        {
          'http.method': req.method,
          'http.route': routeLabel,
          'http.target': url.pathname,
          'http.status_code': status,
          'http.duration_ms': Math.round(durationMs * 100) / 100,
          'user.name': actor ? actor.username : undefined,
        },
        span
      );
    };
    res.once('finish', finalize);
    res.once('close', finalize);

    await telemetry.runWithSpan(span, async () => {
      try {
        if (!route) {
          if (allowed.length > 0) {
            throw new HttpError(405, 'method_not_allowed', 'Método no permitido', undefined, { Allow: allowed.join(', ') });
          }
          throw new HttpError(404, 'not_found', 'Ruta no encontrada');
        }
        const ctx = { req, res, url, params, user: null, body: undefined };
        if (route.access !== 'none') {
          ctx.user = await authenticate(req);
          actor = ctx.user;
          if (route.access === 'admin' && ctx.user.role !== 'admin') {
            throw new HttpError(403, 'forbidden', 'Se requiere rol de administrador');
          }
        }
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') ctx.body = await readJson(req);
        const result = await route.handler(ctx);
        sendJson(res, result.status, result.body, result.headers);
      } catch (err) {
        if (err instanceof HttpError) {
          sendJson(
            res,
            err.status,
            { error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
            err.headers
          );
        } else {
          span.setError(err && err.message);
          telemetry.log('error', 'unhandled_error', {
            'exception.message': String(err && err.message),
            'exception.stack': String(err && err.stack).slice(0, 2000),
          });
          sendJson(res, 500, { error: 'internal_error', message: 'Error interno del servidor' });
        }
      }
    });
  }

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400, SECURITY_HEADERS);
      res.end();
      return;
    }
    const isApi = url.pathname === '/health' || url.pathname.startsWith('/api/');
    const run = isApi ? handleApi(req, res, url) : serveStatic(req, res, url.pathname);
    run.catch((err) => {
      telemetry.log('error', 'fatal_request_error', { 'exception.message': String(err && err.message) });
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  // ---------------------------------------------------------------- arranque
  async function seed() {
    if (!db.getByUsername(config.adminUser)) {
      db.insert({
        name: 'Administrador',
        username: config.adminUser,
        email: null,
        role: 'admin',
        password_hash: await auth.hashPassword(config.adminPassword),
      });
      telemetry.log('info', 'admin_seeded', { 'user.name': config.adminUser });
    }
    if (config.seedDemo && db.count() < 3) {
      const demo = [
        ['Ana López', 'ana.lopez', 'ana.lopez@example.com'],
        ['Luis Pérez', 'luis.perez', 'luis.perez@example.com'],
        ['María Gómez', 'maria.gomez', 'maria.gomez@example.com'],
      ];
      for (const [name, username, email] of demo) {
        if (db.getByUsername(username)) continue;
        db.insert({ name, username, email, role: 'user', password_hash: await auth.hashPassword('Demo12345') });
      }
      telemetry.log('info', 'demo_users_seeded', { count: demo.length });
    }
  }

  async function start() {
    dummyHash = await auth.hashPassword(crypto.randomBytes(8).toString('hex'));
    await seed();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, resolve);
    });
    telemetry.start();
    telemetry.log('info', 'server_started', {
      port: server.address().port,
      version: config.version,
      otlp_enabled: telemetry.enabled,
    });
    return server;
  }

  async function stop() {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    await telemetry.shutdown();
    db.close();
  }

  return { server, telemetry, db, start, stop };
}

if (require.main === module) {
  const app = createApp(loadConfig());
  app.start().catch((err) => {
    process.stderr.write(`No se pudo iniciar el servidor: ${err.stack || err}\n`);
    process.exit(1);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      await app.stop().catch(() => {});
      process.exit(0);
    });
  }
}

module.exports = { createApp };
