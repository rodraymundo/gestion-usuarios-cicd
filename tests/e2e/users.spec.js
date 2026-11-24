'use strict';

const { test, expect } = require('@playwright/test');
const { loginAPI, createUserAPI, uniq, rowOf } = require('./helpers');

test.describe('CRUD de usuarios (interfaz)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAPI(page);
    await page.goto('/users.html');
    await expect(page.locator('#who')).toHaveText('Administrador');
  });

  test('muestra la tabla con sus columnas y el administrador', async ({ page }) => {
    for (const col of ['Nombre', 'Usuario', 'Correo', 'Rol', 'Creado', 'Acciones']) {
      await expect(page.getByRole('columnheader', { name: col })).toBeVisible();
    }
    await expect(rowOf(page, 'admin')).toBeVisible();
    await expect(page.locator('#role-badge')).toHaveText('admin');
  });

  test('el contador refleja la cantidad de usuarios', async ({ page }) => {
    const rows = await page.locator('#users-body tr').count();
    await expect(page.locator('#count')).toHaveText(rows === 1 ? '1 usuario' : `${rows} usuarios`);
  });

  test('el administrador no tiene botón de eliminar sobre su propia fila', async ({ page }) => {
    await expect(rowOf(page, 'admin').getByRole('button', { name: 'Eliminar admin' })).toHaveCount(0);
  });

  test.describe('crear', () => {
    test('abre y cierra el formulario con Cancelar', async ({ page }) => {
      await page.getByRole('button', { name: 'Nuevo usuario' }).click();
      const dialog = page.locator('#user-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Nuevo usuario' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancelar' }).click();
      await expect(dialog).toBeHidden();
    });

    test('crea un usuario y aparece en la tabla', async ({ page }) => {
      const username = uniq('alta');
      await page.getByRole('button', { name: 'Nuevo usuario' }).click();
      await page.locator('#f-name').fill('Persona de Alta');
      await page.locator('#f-username').fill(username);
      await page.locator('#f-email').fill(`${username}@example.com`);
      await page.locator('#f-password').fill('Clave12345');
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(page.locator('#user-dialog')).toBeHidden();
      await expect(page.locator('#status')).toHaveText('Usuario creado correctamente');
      const row = rowOf(page, username);
      await expect(row).toBeVisible();
      await expect(row).toContainText('Persona de Alta');
      await expect(row).toContainText(`${username}@example.com`);
    });

    test('permite crear un administrador', async ({ page }) => {
      const username = uniq('adm');
      await page.getByRole('button', { name: 'Nuevo usuario' }).click();
      await page.locator('#f-name').fill('Otro Admin');
      await page.locator('#f-username').fill(username);
      await page.locator('#f-role').selectOption('admin');
      await page.locator('#f-password').fill('Clave12345');
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(rowOf(page, username)).toContainText('admin');
    });

    test('muestra errores por campo si el formulario está vacío', async ({ page }) => {
      await page.getByRole('button', { name: 'Nuevo usuario' }).click();
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(page.locator('#user-dialog')).toBeVisible();
      await expect(page.locator('#err-name')).toBeVisible();
      await expect(page.locator('#err-username')).toBeVisible();
      await expect(page.locator('#err-password')).toBeVisible();
    });

    test('valida el formato del correo', async ({ page }) => {
      await page.getByRole('button', { name: 'Nuevo usuario' }).click();
      await page.locator('#f-name').fill('Correo Malo');
      await page.locator('#f-username').fill(uniq('mal'));
      await page.locator('#f-email').fill('esto-no-es-correo');
      await page.locator('#f-password').fill('Clave12345');
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(page.locator('#err-email')).toHaveText('El correo electrónico no es válido');
    });

    test('rechaza una contraseña de menos de 8 caracteres', async ({ page }) => {
      await page.getByRole('button', { name: 'Nuevo usuario' }).click();
      await page.locator('#f-name').fill('Clave Corta');
      await page.locator('#f-username').fill(uniq('cor'));
      await page.locator('#f-password').fill('corta');
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(page.locator('#err-password')).toContainText('8 a 72');
    });

    test('rechaza un usuario duplicado mostrando el error del servidor', async ({ page }) => {
      const existing = await createUserAPI(page);
      await page.reload();
      await page.getByRole('button', { name: 'Nuevo usuario' }).click();
      await page.locator('#f-name').fill('Repetido Repetido');
      await page.locator('#f-username').fill(existing.username);
      await page.locator('#f-password').fill('Clave12345');
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(page.locator('#err-username')).toHaveText('Ya existe un usuario con ese nombre de usuario');
      await expect(page.locator('#user-dialog')).toBeVisible();
    });

    test('el formulario se limpia al abrirlo de nuevo', async ({ page }) => {
      await page.getByRole('button', { name: 'Nuevo usuario' }).click();
      await page.locator('#f-name').fill('Texto Residual');
      await page.getByRole('button', { name: 'Cancelar' }).click();
      await page.getByRole('button', { name: 'Nuevo usuario' }).click();
      await expect(page.locator('#f-name')).toHaveValue('');
    });

    test('la tecla Escape cierra el formulario', async ({ page }) => {
      await page.getByRole('button', { name: 'Nuevo usuario' }).click();
      await page.keyboard.press('Escape');
      await expect(page.locator('#user-dialog')).toBeHidden();
    });
  });

  test.describe('editar', () => {
    test('abre el formulario con los datos actuales y sin contraseña', async ({ page }) => {
      const u = await createUserAPI(page, { name: 'Antes Del Cambio' });
      await page.reload();
      await rowOf(page, u.username).getByRole('button', { name: `Editar ${u.username}` }).click();
      await expect(page.getByRole('heading', { name: 'Editar usuario' })).toBeVisible();
      await expect(page.locator('#f-name')).toHaveValue('Antes Del Cambio');
      await expect(page.locator('#f-username')).toHaveValue(u.username);
      await expect(page.locator('#f-password')).toHaveValue('');
    });

    test('guarda el nuevo nombre y lo muestra en la tabla', async ({ page }) => {
      const u = await createUserAPI(page);
      await page.reload();
      await rowOf(page, u.username).getByRole('button', { name: `Editar ${u.username}` }).click();
      await page.locator('#f-name').fill('Nombre Editado');
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(page.locator('#status')).toHaveText('Usuario actualizado correctamente');
      await expect(rowOf(page, u.username)).toContainText('Nombre Editado');
    });

    test('cambia el rol de un usuario a administrador', async ({ page }) => {
      const u = await createUserAPI(page);
      await page.reload();
      await rowOf(page, u.username).getByRole('button', { name: `Editar ${u.username}` }).click();
      await page.locator('#f-role').selectOption('admin');
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(rowOf(page, u.username)).toContainText('admin');
    });

    test('cancelar la edición no modifica nada', async ({ page }) => {
      const u = await createUserAPI(page, { name: 'Sin Cambios' });
      await page.reload();
      await rowOf(page, u.username).getByRole('button', { name: `Editar ${u.username}` }).click();
      await page.locator('#f-name').fill('No Debe Guardarse');
      await page.getByRole('button', { name: 'Cancelar' }).click();
      await expect(rowOf(page, u.username)).toContainText('Sin Cambios');
    });

    test('no deja guardar un nombre vacío', async ({ page }) => {
      const u = await createUserAPI(page);
      await page.reload();
      await rowOf(page, u.username).getByRole('button', { name: `Editar ${u.username}` }).click();
      await page.locator('#f-name').fill('');
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(page.locator('#err-name')).toBeVisible();
    });
  });

  test.describe('eliminar', () => {
    test('pide confirmación y Cancelar conserva al usuario', async ({ page }) => {
      const u = await createUserAPI(page);
      await page.reload();
      await rowOf(page, u.username).getByRole('button', { name: `Eliminar ${u.username}` }).click();
      const dialog = page.locator('#confirm-dialog');
      await expect(dialog.getByRole('heading', { name: 'Eliminar usuario' })).toBeVisible();
      await expect(dialog).toContainText(u.username);
      await dialog.getByRole('button', { name: 'Cancelar' }).click();
      await expect(dialog).toBeHidden();
      await expect(rowOf(page, u.username)).toBeVisible();
    });

    test('confirmar elimina al usuario de la tabla', async ({ page }) => {
      const u = await createUserAPI(page);
      await page.reload();
      await rowOf(page, u.username).getByRole('button', { name: `Eliminar ${u.username}` }).click();
      await page.locator('#confirm-delete').click();
      await expect(page.locator('#status')).toHaveText('Usuario eliminado correctamente');
      await expect(rowOf(page, u.username)).toHaveCount(0);
    });

    test('el usuario eliminado ya no puede iniciar sesión', async ({ page }) => {
      const u = await createUserAPI(page);
      await page.reload();
      await rowOf(page, u.username).getByRole('button', { name: `Eliminar ${u.username}` }).click();
      await page.locator('#confirm-delete').click();
      await expect(rowOf(page, u.username)).toHaveCount(0);
      const res = await page.request.post('/api/auth/login', { data: { username: u.username, password: u.password } });
      expect(res.status()).toBe(401);
    });
  });

  test.describe('búsqueda', () => {
    test('filtra por nombre de usuario', async ({ page }) => {
      const a = await createUserAPI(page, { name: 'Zeta Buscable' });
      const b = await createUserAPI(page, { name: 'Otra Persona' });
      await page.reload();
      await page.getByRole('searchbox', { name: 'Buscar usuarios' }).fill(a.username);
      await expect(rowOf(page, a.username)).toBeVisible();
      await expect(rowOf(page, b.username)).toHaveCount(0);
    });

    test('filtra por nombre completo', async ({ page }) => {
      const a = await createUserAPI(page, { name: 'Xilofona Rarísima' });
      await page.reload();
      await page.locator('#search').fill('xilofona');
      await expect(rowOf(page, a.username)).toBeVisible();
      await expect(page.locator('#users-body tr')).toHaveCount(1);
    });

    test('muestra un mensaje cuando no hay resultados', async ({ page }) => {
      await page.locator('#search').fill('zzzz-no-existe-zzzz');
      await expect(page.locator('#empty')).toHaveText('No hay usuarios que coincidan con la búsqueda.');
      await expect(page.locator('#users-body tr')).toHaveCount(0);
    });

    test('al borrar la búsqueda vuelve a mostrar todos', async ({ page }) => {
      await page.locator('#search').fill('zzzz-no-existe-zzzz');
      await expect(page.locator('#empty')).toBeVisible();
      await page.locator('#search').fill('');
      await expect(page.locator('#empty')).toBeHidden();
      await expect(rowOf(page, 'admin')).toBeVisible();
    });
  });

  test('el contenido de los usuarios se muestra como texto (sin XSS)', async ({ page }) => {
    const payload = '<img src=x onerror=window.__xss=1>';
    const u = await createUserAPI(page, { name: payload });
    await page.reload();
    await expect(rowOf(page, u.username)).toContainText(payload);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('la sesión vencida redirige al login al intentar una acción', async ({ page }) => {
    await page.context().clearCookies();
    await page.getByRole('button', { name: 'Nuevo usuario' }).click();
    await page.locator('#f-name').fill('Sesion Vencida');
    await page.locator('#f-username').fill(uniq('exp'));
    await page.locator('#f-password').fill('Clave12345');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
