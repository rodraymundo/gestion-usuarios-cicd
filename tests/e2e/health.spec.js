'use strict';

const { test, expect } = require('@playwright/test');

test.describe('Endpoint Health y observabilidad (E2E)', () => {
  test('GET /health responde 200 con estado ok', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.checks.database).toBe('ok');
  });

  test('/health responde rápido (tiempo de respuesta < 1 s)', async ({ request }) => {
    const t0 = Date.now();
    await request.get('/health');
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  test('la página de login responde con el CSP estricto', async ({ page }) => {
    const res = await page.goto('/');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-security-policy']).toContain("script-src 'self'");
  });

  test('la página de login carga sin errores en consola', async ({ page }) => {
    const errors = [];
    // El login consulta /api/auth/me para saber si ya hay sesión; el 401 esperado no es un error de la página.
    page.on('console', (m) => m.type() === 'error' && !/status of 401/.test(m.text()) && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('#login-form')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('una ruta inexistente devuelve 404', async ({ request }) => {
    expect((await request.get('/api/no-existe')).status()).toBe(404);
  });
});
