#!/usr/bin/env node
'use strict';

/**
 * Envía un evento del pipeline a OpenObserve por su API HTTP/JSON (RF-03).
 *
 *   node scripts/send-ci-event.js --event tests   --status failure --jest jest-results.json --playwright playwright-results.json
 *   node scripts/send-ci-event.js --event incident --status failure --message "Pruebas fallidas"
 *   node scripts/send-ci-event.js --event deploy  --status success --message "Despliegue en EC2"
 *
 * Variables de entorno:
 *   O2_URL     URL base de OpenObserve (ej. http://IP:5080)   O2_USER / O2_PASS  credenciales
 *   O2_ORG     organización (por defecto "default")           O2_STREAM  stream (por defecto "ci_pipeline")
 *   GITHUB_*   las define GitHub Actions automáticamente (commit, rama, usuario, run id…)
 *   DRY_RUN=1  imprime el JSON en lugar de enviarlo
 *
 * Nunca falla el pipeline por un problema de red: termina con código 0 aunque no pueda enviar.
 */

const fs = require('fs');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      out[key] = next && !next.startsWith('--') ? (i += 1, next) : 'true';
    }
  }
  return out;
}

function readJson(file) {
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Resumen de la salida de `jest --json`. */
function summarizeJest(report) {
  if (!report) return null;
  const failed = [];
  for (const suite of report.testResults || []) {
    for (const t of suite.assertionResults || []) {
      if (t.status === 'failed') failed.push(t.fullName || t.title);
    }
  }
  return {
    framework: 'jest',
    total: report.numTotalTests || 0,
    passed: report.numPassedTests || 0,
    failed: report.numFailedTests || 0,
    skipped: report.numPendingTests || 0,
    failed_tests: failed.slice(0, 20),
  };
}

/** Resumen de la salida del reporter `json` de Playwright. */
function summarizePlaywright(report) {
  if (!report) return null;
  const failed = [];
  const walk = (suite, trail) => {
    const here = suite.title ? [...trail, suite.title] : trail;
    for (const spec of suite.specs || []) {
      if (!spec.ok) failed.push([...here, spec.title].filter(Boolean).join(' › '));
    }
    for (const child of suite.suites || []) walk(child, here);
  };
  for (const suite of report.suites || []) walk(suite, []);
  const s = report.stats || {};
  const passed = s.expected || 0;
  const flaky = s.flaky || 0;
  const bad = s.unexpected || 0;
  return {
    framework: 'playwright',
    total: passed + flaky + bad + (s.skipped || 0),
    passed: passed + flaky,
    failed: bad,
    skipped: s.skipped || 0,
    failed_tests: failed.slice(0, 20),
  };
}

function buildEvent(args, env) {
  const now = Date.now();
  const jest = summarizeJest(readJson(args.jest));
  const playwright = summarizePlaywright(readJson(args.playwright));
  const repo = env.GITHUB_REPOSITORY || 'local/repo';
  const runId = env.GITHUB_RUN_ID || '0';
  const event = {
    _timestamp: now * 1000, // microsegundos, como espera OpenObserve
    timestamp: new Date(now).toISOString(),
    event: args.event || 'info', // tests | incident | deploy
    status: args.status || 'unknown', // success | failure
    message: args.message || '',
    repository: repo,
    commit_id: env.GITHUB_SHA || 'local',
    commit_short: (env.GITHUB_SHA || 'local').slice(0, 7),
    branch: env.GITHUB_REF_NAME || 'local',
    actor: env.GITHUB_ACTOR || env.USER || 'local',
    workflow: env.GITHUB_WORKFLOW || 'local',
    run_id: runId,
    run_attempt: env.GITHUB_RUN_ATTEMPT || '1',
    run_url: env.GITHUB_SERVER_URL ? `${env.GITHUB_SERVER_URL}/${repo}/actions/runs/${runId}` : '',
    environment: env.DEPLOY_ENV || 'ci',
  };
  if (jest) {
    event.backend_total = jest.total;
    event.backend_passed = jest.passed;
    event.backend_failed = jest.failed;
  }
  if (playwright) {
    event.frontend_total = playwright.total;
    event.frontend_passed = playwright.passed;
    event.frontend_failed = playwright.failed;
  }
  const failedTests = [...(jest ? jest.failed_tests : []), ...(playwright ? playwright.failed_tests : [])];
  if (failedTests.length > 0) event.failed_tests = failedTests.join(' | ').slice(0, 4000);
  return event;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = process.env;
  const event = buildEvent(args, env);

  if (env.DRY_RUN === '1') {
    process.stdout.write(`${JSON.stringify(event, null, 2)}\n`);
    return;
  }

  const base = (env.O2_URL || '').replace(/\/+$/, '');
  if (!base || !env.O2_USER || !env.O2_PASS) {
    process.stderr.write('send-ci-event: faltan O2_URL / O2_USER / O2_PASS; no se envía el evento.\n');
    return;
  }
  const url = `${base}/api/${env.O2_ORG || 'default'}/${env.O2_STREAM || 'ci_pipeline'}/_json`;
  const auth = Buffer.from(`${env.O2_USER}:${env.O2_PASS}`).toString('base64');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify([event]),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    process.stdout.write(`send-ci-event: ${event.event}/${event.status} -> HTTP ${res.status} ${text.slice(0, 200)}\n`);
  } catch (err) {
    process.stderr.write(`send-ci-event: no se pudo enviar (${err.message}).\n`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { buildEvent, summarizeJest, summarizePlaywright, parseArgs };
