'use strict';

const { test, expect } = require('@playwright/test');
const { ADMIN, loginUI, loginAPI, createUserAPI } = require('./helpers');

test.describe('Página de inicio de sesión', () => {
  test('muestra el formulario con sus campos y el botón', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Iniciar sesión/);
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    await expect(page.getByLabel('Usuario')).toBeVisible();
    await expect(page.getByLabel('Contraseña')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled();
  });

  test('el campo de contraseña oculta lo escrito', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#password')).toHaveAttribute('type', 'password');
  });

  test('el campo de usuario tiene el foco al abrir la página', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#username')).toBeFocused();
  });

  test('con credenciales válidas entra a la lista de usuarios', async ({ page }) => {
    await loginUI(page);
    await expect(page).toHaveURL(/\/users\.html$/);
    await expect(page.getByRole('heading', { name: 'Usuarios' })).toBeVisible();
    await expect(page.locator('#who')).toHaveText('Administrador');
  });

  test('también se puede iniciar sesión con la tecla Enter', async ({ page }) => {
    await page.goto('/');
    await page.locator('#username').fill(ADMIN.username);
    await page.locator('#password').fill(ADMIN.password);
    await page.locator('#password').press('Enter');
    await expect(page).toHaveURL(/\/users\.html$/);
  });

  test('una contraseña incorrecta muestra un error y no entra', async ({ page }) => {
    await loginUI(page, { username: 'admin', password: 'incorrecta' });
    await expect(page.locator('#form-error')).toHaveText('Usuario o contraseña incorrectos');
    await expect(page).toHaveURL(/\/$/);
  });

  test('un usuario inexistente muestra el mismo error', async ({ page }) => {
    await loginUI(page, { username: 'fantasma', password: 'cualquiera1' });
    await expect(page.locator('#form-error')).toHaveText('Usuario o contraseña incorrectos');
  });

  test('con los campos vacíos pide usuario y contraseña', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page.locator('#username-error')).toHaveText('Ingresa tu usuario');
    await expect(page.locator('#password-error')).toHaveText('Ingresa tu contraseña');
    await expect(page).toHaveURL(/\/$/);
  });

  test('solo falta la contraseña: pide únicamente la contraseña', async ({ page }) => {
    await page.goto('/');
    await page.locator('#username').fill('admin');
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page.locator('#password-error')).toBeVisible();
    await expect(page.locator('#username-error')).toBeHidden();
  });

  test('un intento de inyección SQL no concede acceso', async ({ page }) => {
    await loginUI(page, { username: "admin' OR '1'='1", password: "' OR '1'='1" });
    await expect(page.locator('#form-error')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('sin sesión, /users.html redirige al login', async ({ page }) => {
    await page.goto('/users.html');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  });

  test('con sesión activa, abrir el login redirige a usuarios', async ({ page }) => {
    await loginAPI(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/users\.html$/);
  });

  test('cerrar sesión vuelve al login y bloquea la lista', async ({ page }) => {
    await loginUI(page);
    await expect(page).toHaveURL(/\/users\.html$/);
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/users.html');
    await expect(page).toHaveURL(/\/$/);
  });

  test('un usuario con rol "user" entra pero no ve las acciones de administrador', async ({ page }) => {
    await loginAPI(page);
    const u = await createUserAPI(page);
    await page.request.post('/api/auth/logout');
    await loginUI(page, { username: u.username, password: u.password });
    await expect(page).toHaveURL(/\/users\.html$/);
    await expect(page.locator('#role-badge')).toHaveText('user');
    await expect(page.locator('#new-user')).toBeHidden();
    await expect(page.getByRole('button', { name: /^Eliminar / })).toHaveCount(0);
  });
});
