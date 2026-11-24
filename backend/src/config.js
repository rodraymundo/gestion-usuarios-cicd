'use strict';

const path = require('path');
const crypto = require('crypto');
const pkg = require('../../package.json');

function toBool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

/**
 * Lee la configuración desde variables de entorno.
 * Todos los valores tienen un valor por defecto razonable para desarrollo.
 */
function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST || '0.0.0.0',
    dbPath: env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'app.db'),
    sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    sessionTtlSeconds: Number(env.SESSION_TTL_SECONDS || 8 * 3600),
    adminUser: env.ADMIN_USER || 'admin',
    adminPassword: env.ADMIN_PASSWORD || 'Admin123!',
    seedDemo: toBool(env.SEED_DEMO, false),
    staticDir: env.STATIC_DIR || path.join(__dirname, '..', '..', 'frontend', 'public'),
    logStdout: toBool(env.LOG_STDOUT, true),
    maxBodyBytes: 100 * 1024,
    version: env.APP_VERSION || pkg.version,
    otel: {
      // Si no hay endpoint, la telemetría OTLP queda desactivada (la app funciona igual).
      endpoint: (env.OTEL_EXPORTER_OTLP_ENDPOINT || '').replace(/\/+$/, ''),
      serviceName: env.OTEL_SERVICE_NAME || 'users-app',
      flushMs: Number(env.OTEL_FLUSH_MS || 10000),
      environment: env.DEPLOY_ENV || env.NODE_ENV || 'development',
    },
  };
}

module.exports = { loadConfig };
