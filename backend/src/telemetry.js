'use strict';

/**
 * Telemetría OpenTelemetry (OTLP/HTTP con codificación JSON), sin dependencias.
 *
 * Emite hacia el OpenTelemetry Collector (puerto 4318) las tres señales que pide el proyecto:
 *   - Trazas  : un span por petición HTTP + un span hijo por cada consulta a SQLite.
 *   - Métricas: histograma de tiempo de respuesta y contador de peticiones, por
 *               método, ruta (endpoint) y código de estado, más memoria y uptime del proceso.
 *   - Logs    : un registro estructurado por petición (método, ruta, status, duración, timestamp).
 *
 * Si OTEL_EXPORTER_OTLP_ENDPOINT no está definido, la exportación queda desactivada
 * y los logs solo se escriben en la salida estándar.
 */

const crypto = require('crypto');
const os = require('os');
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

// Límites del histograma de tiempo de respuesta (milisegundos).
const BOUNDS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const MAX_QUEUE = 2000;
const SEVERITY = {
  debug: [5, 'DEBUG'],
  info: [9, 'INFO'],
  warn: [13, 'WARN'],
  error: [17, 'ERROR'],
};

const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');
const nowNs = () => BigInt(Date.now()) * 1000000n;

function attributeValue(v) {
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}

function toAttributes(obj = {}) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([key, v]) => ({ key, value: attributeValue(v) }));
}

class Span {
  constructor(name, { kind = 1, attributes = {}, parent = null, onEnd = () => {} } = {}) {
    this.name = name;
    this.kind = kind; // 1 = interno, 2 = servidor, 3 = cliente
    this.traceId = parent ? parent.traceId : hex(16);
    this.spanId = hex(8);
    this.parentSpanId = parent ? parent.spanId : undefined;
    this.attributes = { ...attributes };
    this.status = { code: 0 };
    this.startNs = nowNs();
    this._t0 = process.hrtime.bigint();
    this._onEnd = onEnd;
    this.ended = false;
  }

  setAttribute(key, value) {
    this.attributes[key] = value;
    return this;
  }

  setError(message) {
    this.status = { code: 2, message: String(message || '') };
    return this;
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    const duration = process.hrtime.bigint() - this._t0;
    this.endNs = this.startNs + duration;
    this.durationMs = Number(duration) / 1e6;
    this._onEnd(this);
  }
}

function createTelemetry(config) {
  const endpoint = config.otel.endpoint;
  const enabled = Boolean(endpoint);
  const processStartNs = nowNs();
  const scope = { name: config.otel.serviceName, version: config.version };
  const resource = {
    attributes: toAttributes({
      'service.name': config.otel.serviceName,
      'service.version': config.version,
      'deployment.environment': config.otel.environment,
      'host.name': os.hostname(),
      'service.instance.id': hex(8),
      'telemetry.sdk.language': 'nodejs',
      'telemetry.sdk.name': 'users-app-otlp-json',
    }),
  };

  const spans = [];
  const logs = [];
  const histograms = new Map();
  const stats = { exported: 0, failed: 0, lastError: null };
  let timer = null;

  function pushSpan(span) {
    if (!enabled) return;
    spans.push(span);
    if (spans.length > MAX_QUEUE) spans.shift();
  }

  function startSpan(name, options = {}) {
    return new Span(name, { ...options, onEnd: pushSpan });
  }

  function runWithSpan(span, fn) {
    return als.run(span, fn);
  }

  function currentSpan() {
    return als.getStore();
  }

  /** Ejecuta una consulta SQL dentro de un span hijo de la petición en curso. */
  function dbSpan(name, statement, fn) {
    const parent = als.getStore();
    if (!parent) return fn();
    const span = startSpan(name, {
      kind: 3,
      parent,
      attributes: {
        'db.system': 'sqlite',
        'db.operation': name.split(' ')[0],
        'db.statement': statement,
      },
    });
    try {
      return fn();
    } catch (err) {
      span.setError(err.message);
      throw err;
    } finally {
      span.end();
    }
  }

  function recordRequest({ method, route, status, durationMs }) {
    const key = `${method}|${route}|${status}`;
    let h = histograms.get(key);
    if (!h) {
      h = {
        method,
        route,
        status,
        count: 0,
        sum: 0,
        min: durationMs,
        max: durationMs,
        buckets: new Array(BOUNDS.length + 1).fill(0),
      };
      histograms.set(key, h);
    }
    h.count += 1;
    h.sum += durationMs;
    h.min = Math.min(h.min, durationMs);
    h.max = Math.max(h.max, durationMs);
    let index = BOUNDS.findIndex((bound) => durationMs <= bound);
    if (index === -1) index = BOUNDS.length;
    h.buckets[index] += 1;
  }

  function log(level, message, attrs = {}, span = als.getStore()) {
    const [severityNumber, severityText] = SEVERITY[level] || SEVERITY.info;
    const ts = Date.now();
    const iso = new Date(ts).toISOString();
    if (config.logStdout) {
      process.stdout.write(
        `${JSON.stringify({
          time: iso,
          level,
          msg: message,
          ...attrs,
          trace_id: span ? span.traceId : undefined,
          span_id: span ? span.spanId : undefined,
        })}\n`
      );
    }
    if (!enabled) return;
    logs.push({
      timeUnixNano: String(BigInt(ts) * 1000000n),
      severityNumber,
      severityText,
      body: { stringValue: message },
      attributes: toAttributes({ ...attrs, timestamp: iso }),
      traceId: span ? span.traceId : undefined,
      spanId: span ? span.spanId : undefined,
    });
    if (logs.length > MAX_QUEUE) logs.shift();
  }

  function spanToOtlp(span) {
    return {
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      kind: span.kind,
      startTimeUnixNano: String(span.startNs),
      endTimeUnixNano: String(span.endNs),
      attributes: toAttributes(span.attributes),
      status: span.status.code ? span.status : undefined,
    };
  }

  function buildMetrics() {
    const time = String(nowNs());
    const start = String(processStartNs);
    const histogramPoints = [];
    const counterPoints = [];
    for (const h of histograms.values()) {
      const attributes = toAttributes({
        'http.method': h.method,
        'http.route': h.route,
        'http.status_code': h.status,
      });
      histogramPoints.push({
        attributes,
        startTimeUnixNano: start,
        timeUnixNano: time,
        count: String(h.count),
        sum: h.sum,
        min: h.min,
        max: h.max,
        bucketCounts: h.buckets.map(String),
        explicitBounds: BOUNDS,
      });
      counterPoints.push({ attributes, startTimeUnixNano: start, timeUnixNano: time, asInt: String(h.count) });
    }

    const metrics = [];
    if (histogramPoints.length > 0) {
      metrics.push({
        name: 'http.server.duration',
        description: 'Tiempo de respuesta HTTP por endpoint',
        unit: 'ms',
        histogram: { aggregationTemporality: 2, dataPoints: histogramPoints },
      });
      metrics.push({
        name: 'http.server.requests',
        description: 'Peticiones HTTP atendidas por endpoint y código de estado',
        unit: '{request}',
        sum: { aggregationTemporality: 2, isMonotonic: true, dataPoints: counterPoints },
      });
    }
    metrics.push({
      name: 'process.memory.rss',
      description: 'Memoria residente del proceso de la aplicación',
      unit: 'By',
      gauge: { dataPoints: [{ timeUnixNano: time, asInt: String(process.memoryUsage().rss) }] },
    });
    metrics.push({
      name: 'process.uptime',
      description: 'Tiempo en ejecución del proceso',
      unit: 's',
      gauge: { dataPoints: [{ timeUnixNano: time, asDouble: process.uptime() }] },
    });
    return { resourceMetrics: [{ resource, scopeMetrics: [{ scope, metrics }] }] };
  }

  async function post(pathname, body) {
    try {
      const res = await fetch(`${endpoint}${pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      stats.exported += 1;
    } catch (err) {
      stats.failed += 1;
      stats.lastError = err.message;
    }
  }

  async function flush() {
    if (!enabled) return;
    const jobs = [];
    if (spans.length > 0) {
      const batch = spans.splice(0, spans.length);
      jobs.push(
        post('/v1/traces', {
          resourceSpans: [{ resource, scopeSpans: [{ scope, spans: batch.map(spanToOtlp) }] }],
        })
      );
    }
    if (logs.length > 0) {
      const batch = logs.splice(0, logs.length);
      jobs.push(post('/v1/logs', { resourceLogs: [{ resource, scopeLogs: [{ scope, logRecords: batch }] }] }));
    }
    jobs.push(post('/v1/metrics', buildMetrics()));
    await Promise.allSettled(jobs);
  }

  function start() {
    if (!enabled || timer) return;
    timer = setInterval(flush, config.otel.flushMs);
    timer.unref();
  }

  async function shutdown() {
    if (timer) clearInterval(timer);
    timer = null;
    await flush();
  }

  return { enabled, stats, startSpan, runWithSpan, currentSpan, dbSpan, recordRequest, log, flush, start, shutdown };
}

module.exports = { createTelemetry };
