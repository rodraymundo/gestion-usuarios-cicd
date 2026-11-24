'use strict';

/**
 * Verifica RF-04: la aplicación emite trazas, métricas y logs por OTLP/HTTP (JSON).
 * Se levanta un receptor OTLP falso y se comprueba lo que recibe.
 */

const http = require('http');
const { ADMIN, startServer, request, loginAs, createUserAs } = require('./helpers');

function startMockCollector() {
  const received = { traces: [], metrics: [], logs: [], headers: [] };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (req.url === '/v1/traces') received.traces.push(body);
        else if (req.url === '/v1/metrics') received.metrics.push(body);
        else if (req.url === '/v1/logs') received.logs.push(body);
        received.headers.push(req.headers['content-type']);
      } catch {
        /* ignorar */
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        received,
        close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }),
      });
    });
  });
}

const attr = (list, key) => {
  const found = (list || []).find((a) => a.key === key);
  if (!found) return undefined;
  const v = found.value;
  if (v.intValue !== undefined) return Number(v.intValue); // OTLP/JSON serializa los enteros como texto
  return v.stringValue ?? v.doubleValue ?? v.boolValue;
};

const allSpans = (collector) =>
  collector.received.traces.flatMap((t) => t.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans)));
const allMetrics = (collector) =>
  collector.received.metrics.flatMap((m) => m.resourceMetrics.flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics)));
const allLogs = (collector) =>
  collector.received.logs.flatMap((l) => l.resourceLogs.flatMap((r) => r.scopeLogs.flatMap((s) => s.logRecords)));

async function eventually(check, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('No llegó la telemetría esperada');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('Telemetría OpenTelemetry (OTLP/HTTP JSON)', () => {
  let collector;
  let server;
  let admin;

  beforeAll(async () => {
    collector = await startMockCollector();
    server = await startServer({
      OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
      OTEL_FLUSH_MS: '300',
      OTEL_SERVICE_NAME: 'users-app-test',
    });
    admin = await loginAs(server.base, ADMIN.username, ADMIN.password);
    await createUserAs(admin); // genera spans de BD (INSERT)
    await request(server.base, 'GET', '/health');
    await request(server.base, 'GET', '/api/users'); // 401 sin sesión
    await admin.get('/api/users');
  });

  afterAll(async () => {
    await server.stop();
    await collector.close();
  });

  test('envía trazas con el nombre del servicio y el contenido JSON correcto', async () => {
    await eventually(() => allSpans(collector).length > 0);
    const resource = collector.received.traces[0].resourceSpans[0].resource;
    expect(attr(resource.attributes, 'service.name')).toBe('users-app-test');
    expect(collector.received.headers[0]).toMatch(/application\/json/);
  });

  test('cada petición HTTP genera un span con método, ruta y código de estado', async () => {
    const span = await eventually(() =>
      allSpans(collector).find((s) => s.name === 'GET /api/users' && attr(s.attributes, 'http.status_code') === 200)
    );
    expect(attr(span.attributes, 'http.method')).toBe('GET');
    expect(attr(span.attributes, 'http.route')).toBe('/api/users');
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  test('las peticiones fallidas quedan registradas con su código (401)', async () => {
    const span = await eventually(() =>
      allSpans(collector).find((s) => s.name === 'GET /api/users' && attr(s.attributes, 'http.status_code') === 401)
    );
    expect(span).toBeDefined();
  });

  test('las consultas a la base de datos son spans hijos de la petición (traza distribuida)', async () => {
    const dbSpan = await eventually(() => allSpans(collector).find((s) => attr(s.attributes, 'db.system') === 'sqlite' && s.name === 'INSERT users'));
    expect(attr(dbSpan.attributes, 'db.statement')).toMatch(/INSERT INTO users/);
    const parent = allSpans(collector).find((s) => s.spanId === dbSpan.parentSpanId);
    expect(parent).toBeDefined();
    expect(parent.name).toBe('POST /api/users');
    expect(parent.traceId).toBe(dbSpan.traceId);
  });

  test('los tiempos de los spans son nanosegundos válidos y end >= start', async () => {
    const span = await eventually(() => allSpans(collector)[0]);
    expect(span.startTimeUnixNano).toMatch(/^\d{19}$/);
    expect(BigInt(span.endTimeUnixNano)).toBeGreaterThanOrEqual(BigInt(span.startTimeUnixNano));
  });

  test('exporta el histograma http.server.duration (tiempo de respuesta por endpoint)', async () => {
    const metric = await eventually(() => allMetrics(collector).find((m) => m.name === 'http.server.duration'));
    expect(metric.unit).toBe('ms');
    const point = metric.histogram.dataPoints.find((p) => attr(p.attributes, 'http.route') === '/api/users');
    expect(point).toBeDefined();
    expect(attr(point.attributes, 'http.method')).toBeDefined();
    expect(attr(point.attributes, 'http.status_code')).toBeDefined();
    expect(Number(point.count)).toBeGreaterThan(0);
    expect(point.bucketCounts.length).toBe(point.explicitBounds.length + 1);
  });

  test('exporta el contador http.server.requests por endpoint y código de estado', async () => {
    const metric = await eventually(() => allMetrics(collector).find((m) => m.name === 'http.server.requests'));
    expect(metric.sum.isMonotonic).toBe(true);
    const codes = metric.sum.dataPoints.map((p) => String(attr(p.attributes, 'http.status_code')));
    expect(codes).toEqual(expect.arrayContaining(['200', '401']));
  });

  test('exporta métricas de proceso (memoria y uptime)', async () => {
    const names = (await eventually(() => {
      const found = allMetrics(collector).map((m) => m.name);
      return found.includes('process.memory.rss') ? found : null;
    }));
    expect(names).toEqual(expect.arrayContaining(['process.memory.rss', 'process.uptime']));
  });

  test('envía logs estructurados con severidad, mensaje y atributos', async () => {
    const log = await eventually(() => allLogs(collector).find((l) => l.body.stringValue === 'login_ok'));
    expect(log.severityText).toBe('INFO');
    expect(attr(log.attributes, 'user.name')).toBe('admin');
  });

  test('los logs de una petición llevan el trace_id para correlacionarlos con la traza', async () => {
    const log = await eventually(() => allLogs(collector).find((l) => String(l.body.stringValue).startsWith('GET /api/users 200')));
    expect(log.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(attr(log.attributes, 'http.status_code')).toBe(200);
    expect(attr(log.attributes, 'http.duration_ms')).toBeGreaterThanOrEqual(0);
  });

  test('los errores del cliente se registran con severidad WARN', async () => {
    const log = await eventually(() => allLogs(collector).find((l) => String(l.body.stringValue).startsWith('GET /api/users 401')));
    expect(log.severityText).toBe('WARN');
  });

  test('si el colector no responde, la aplicación sigue funcionando', async () => {
    const orphan = await startServer({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9', OTEL_FLUSH_MS: '200' });
    try {
      await new Promise((r) => setTimeout(r, 600));
      const res = await request(orphan.base, 'GET', '/health');
      expect(res.status).toBe(200);
    } finally {
      await orphan.stop();
    }
  });
});
