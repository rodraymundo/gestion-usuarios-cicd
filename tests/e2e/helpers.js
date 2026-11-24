'use strict';

const { expect } = require('@playwright/test');

const ADMIN = { username: 'admin', password: process.env.E2E_ADMIN_PASSWORD || 'Admin123!' };
let counter = 0;
const uniq = (prefix = 'e2e') => `${prefix}${Date.now().toString(36).slice(-5)}${++counter}`;

/** Inicia sesión por la interfaz, como lo haría una persona. */
async function loginUI(page, { username, password } = ADMIN) {
  await page.goto('/');
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
}

/** Inicia sesión por la API (comparte la cookie con la página) para no repetir el login en cada prueba. */
async function loginAPI(page, { username, password } = ADMIN) {
  const res = await page.request.post('/api/auth/login', { data: { username, password } });
  expect(res.ok()).toBeTruthy();
}

/** Crea un usuario por la API y devuelve sus datos. */
async function createUserAPI(page, overrides = {}) {
  const username = overrides.username || uniq('usr');
  const data = { name: 'Usuario E2E', username, email: `${username}@example.com`, role: 'user', password: 'Clave12345', ...overrides };
  const res = await page.request.post('/api/users', { data });
  expect(res.status()).toBe(201);
  return { ...(await res.json()).user, password: data.password };
}

const rowOf = (page, username) => page.locator(`#users-body tr[data-username="${username}"]`);

module.exports = { ADMIN, uniq, loginUI, loginAPI, createUserAPI, rowOf };
