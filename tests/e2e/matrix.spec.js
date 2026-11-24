'use strict';

/**
 * Pruebas E2E dirigidas por datos: validaciones de formularios, roles, viewports,
 * accesibilidad, teclado, búsqueda, XSS y recursos estáticos.
 */

const { test, expect } = require('@playwright/test');
const { ADMIN, uniq, loginUI, loginAPI, createUserAPI, rowOf } = require('./helpers');

const DEMO = [
  { username: 'ana.lopez', name: 'Ana López' },
  { username: 'luis.perez', name: 'Luis Pérez' },
  { username: 'maria.gomez', name: 'María Gómez' },
];
const DEMO_PASSWORD = 'Demo12345';

async function openNewUser(page) {
  await page.getByRole('button', { name: 'Nuevo usuario' }).click();
  await expect(page.locator('#user-dialog')).toBeVisible();
}
async function fillUser(page, { name = 'Persona Matriz', username = uniq('mx'), email = '', password = 'Clave12345', role } = {}) {
  await page.locator('#f-name').fill(name);
  await page.locator('#f-username').fill(username);
  await page.locator('#f-email').fill(email);
  await page.locator('#f-password').fill(password);
  if (role) await page.locator('#f-role').selectOption(role);
}

// ---------------------------------------------------------------- inicio de sesión
test.describe('Login: combinaciones de credenciales inválidas', () => {
  const bad = [
    ['usuario correcto, contraseña vacía', 'admin', ''],
    ['usuario vacío, contraseña correcta', '', 'Admin123!'],
    ['contraseña con mayúsculas cambiadas', 'admin', 'ADMIN123!'],
    ['contraseña con un carácter de menos', 'admin', 'Admin123'],
    ['contraseña con un espacio al final', 'admin', 'Admin123! '],
    ['usuario con espacios internos', 'ad min', 'Admin123!'],
    ['usuario inexistente', 'noexiste', 'Admin123!'],
    ['usuario muy largo', 'x'.repeat(200), 'Admin123!'],
    ['contraseña muy larga', 'admin', 'x'.repeat(300)],
    ['inyección SQL en usuario', "admin'--", 'x'],
    ['inyección SQL en contraseña', 'admin', "' OR '1'='1"],
    ['HTML en el usuario', '<b>admin</b>', 'x'],
    ['emoji en el usuario', '😀', 'x'],
    ['solo espacios', '   ', '   '],
  ];
  for (const [label, user, pass] of bad) {
    test(`rechaza: ${label}`, async ({ page }) => {
      await page.goto('/');
      await page.locator('#username').fill(user);
      await page.locator('#password').fill(pass);
      await page.getByRole('button', { name: 'Iniciar sesión' }).click();
      await expect(page.locator('.field-error:visible, .form-error:visible').first()).toBeVisible();
      await expect(page).toHaveURL(/\/$/);
    });
  }

  test('el usuario con espacios alrededor sí entra (se recorta)', async ({ page }) => {
    await loginUI(page, { username: '  admin  ', password: 'Admin123!' });
    await expect(page).toHaveURL(/\/users\.html$/);
  });
  test('el usuario no distingue mayúsculas de minúsculas', async ({ page }) => {
    await loginUI(page, { username: 'ADMIN', password: 'Admin123!' });
    await expect(page).toHaveURL(/\/users\.html$/);
  });
});

test.describe('Login de cada usuario sembrado', () => {
  for (const u of DEMO) {
    test(`${u.username} inicia sesión y ve su nombre`, async ({ page }) => {
      await loginUI(page, { username: u.username, password: DEMO_PASSWORD });
      await expect(page).toHaveURL(/\/users\.html$/);
      await expect(page.locator('#who')).toHaveText(u.name);
      await expect(page.locator('#role-badge')).toHaveText('user');
    });
    test(`${u.username} no ve controles de administrador`, async ({ page }) => {
      await loginAPI(page, { username: u.username, password: DEMO_PASSWORD });
      await page.goto('/users.html');
      await expect(page.locator('#who')).toHaveText(u.name);
      await expect(page.locator('#new-user')).toBeHidden();
      await expect(page.getByRole('button', { name: /^Editar / })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Eliminar / })).toHaveCount(0);
    });
    test(`${u.username} puede buscar usuarios`, async ({ page }) => {
      await loginAPI(page, { username: u.username, password: DEMO_PASSWORD });
      await page.goto('/users.html');
      await page.locator('#search').fill('admin');
      await expect(rowOf(page, 'admin')).toBeVisible();
    });
    test(`${u.username} cierra sesión`, async ({ page }) => {
      await loginUI(page, { username: u.username, password: DEMO_PASSWORD });
      await page.getByRole('button', { name: 'Cerrar sesión' }).click();
      await expect(page).toHaveURL(/\/$/);
    });
  }
  test('la API rechaza al rol user si intenta crear usuarios', async ({ page }) => {
    await loginAPI(page, { username: 'ana.lopez', password: DEMO_PASSWORD });
    const res = await page.request.post('/api/users', { data: { name: 'Intruso', username: uniq('int'), password: 'Clave12345' } });
    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------- formulario de alta
test.describe('Formulario de alta: validaciones por campo', () => {
  test.beforeEach(async ({ page }) => {
    await loginAPI(page);
    await page.goto('/users.html');
    await openNewUser(page);
  });

  const badUsernames = ['ab', 'a', 'x'.repeat(31), 'con espacio', 'ñandú', 'user@mail', 'user!', 'user#1', 'user/1', '<script>', '../etc', 'ユーザー'];
  for (const value of badUsernames) {
    test(`usuario inválido: "${value.slice(0, 20)}"`, async ({ page }) => {
      await fillUser(page, { username: value });
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(page.locator('#err-username')).toBeVisible();
      await expect(page.locator('#user-dialog')).toBeVisible();
    });
  }

  const badEmails = ['plain', '@x.com', 'user@', 'user@x', 'user@.com', 'us er@x.com', 'a@@b.com', 'a@b@c.com'];
  for (const value of badEmails) {
    test(`correo inválido: "${value}"`, async ({ page }) => {
      await fillUser(page, { email: value });
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(page.locator('#err-email')).toBeVisible();
      await expect(page.locator('#user-dialog')).toBeVisible();
    });
  }

  const badPasswords = ['', 'a', '1234567', 'p'.repeat(73), 'p'.repeat(200)];
  for (const value of badPasswords) {
    test(`contraseña inválida ${JSON.stringify(value.slice(0, 4))} (${value.length} caracteres)`, async ({ page }) => {
      await fillUser(page, { password: value });
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(page.locator('#err-password')).toBeVisible();
    });
  }

  const badNames = ['', ' ', 'A', 'n'.repeat(81)];
  for (const value of badNames) {
    test(`nombre inválido ${JSON.stringify(value.slice(0, 6))} (${value.length} caracteres)`, async ({ page }) => {
      await fillUser(page, { name: value });
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(page.locator('#err-name')).toBeVisible();
    });
  }

  test('los errores desaparecen al corregir y guardar', async ({ page }) => {
    await fillUser(page, { username: 'ab' });
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('#err-username')).toBeVisible();
    await page.locator('#f-username').fill(uniq('ok'));
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('#user-dialog')).toBeHidden();
  });
});

test.describe('Formulario de alta: datos válidos', () => {
  test.beforeEach(async ({ page }) => {
    await loginAPI(page);
    await page.goto('/users.html');
  });

  const validNames = [['Al', 'dos letras'], ['José Ángel Muñoz', 'acentos'], ["O'Brien", 'apóstrofo'], ['Mary-Jane', 'guion'], ['李雷', 'ideogramas'], ['n'.repeat(80), '80 caracteres']];
  for (const [name, label] of validNames) {
    test(`acepta el nombre (${label})`, async ({ page }) => {
      const username = uniq('nm');
      await openNewUser(page);
      await fillUser(page, { name, username });
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(rowOf(page, username)).toBeVisible();
    });
  }

  const validUsernames = ['abc', 'a_b', 'a.b', 'a-b', 'X'.repeat(30), '12345', 'u.s_e-r'];
  for (const base of validUsernames) {
    test(`acepta el usuario "${base.slice(0, 12)}"`, async ({ page }) => {
      const username = base.length >= 30 ? base : `${base}${Date.now().toString(36).slice(-3)}`.slice(0, 30);
      await openNewUser(page);
      await fillUser(page, { username });
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(rowOf(page, username)).toBeVisible();
    });
  }

  const validEmails = ['a@b.co', 'user+tag@example.com', 'user.name@sub.example.com', 'USER@EXAMPLE.COM', ''];
  for (const email of validEmails) {
    test(`acepta el correo "${email || '(vacío)'}"`, async ({ page }) => {
      const username = uniq('em');
      await openNewUser(page);
      await fillUser(page, { username, email });
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(rowOf(page, username)).toBeVisible();
      await expect(rowOf(page, username)).toContainText(email || '—');
    });
  }

  const xss = ['<script>alert(1)</script>', '<img src=x onerror=window.__xss=1>', '"><svg onload=window.__xss=1>', "';window.__xss=1;//", '<b>negrita</b>', '{{7*7}}', '${7*7}', '&lt;script&gt;'];
  for (const payload of xss) {
    test(`el nombre ${JSON.stringify(payload).slice(0, 36)} se muestra como texto`, async ({ page }) => {
      const u = await createUserAPI(page, { name: payload });
      await page.reload();
      await expect(rowOf(page, u.username)).toContainText(payload);
      expect(await page.evaluate(() => window.__xss)).toBeUndefined();
      await expect(rowOf(page, u.username).locator('b, img, svg, script')).toHaveCount(0);
    });
  }
});

test.describe('Edición campo por campo', () => {
  test.beforeEach(async ({ page }) => {
    await loginAPI(page);
  });
  const edits = [
    ['name', 'Nombre Editado Uno', '#f-name'],
    ['email', 'editado@example.com', '#f-email'],
  ];
  for (const [field, value, selector] of edits) {
    test(`editar solo "${field}"`, async ({ page }) => {
      const u = await createUserAPI(page);
      await page.goto('/users.html');
      await rowOf(page, u.username).getByRole('button', { name: `Editar ${u.username}` }).click();
      await page.locator(selector).fill(value);
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(page.locator('#status')).toHaveText('Usuario actualizado correctamente');
      await expect(rowOf(page, u.username)).toContainText(value);
    });
  }
  test('editar el nombre de usuario (login)', async ({ page }) => {
    const u = await createUserAPI(page);
    const nuevo = uniq('ren');
    await page.goto('/users.html');
    await rowOf(page, u.username).getByRole('button', { name: `Editar ${u.username}` }).click();
    await page.locator('#f-username').fill(nuevo);
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(rowOf(page, nuevo)).toBeVisible();
    await expect(rowOf(page, u.username)).toHaveCount(0);
  });
  test('editar la contraseña permite entrar con la nueva', async ({ page, request }) => {
    const u = await createUserAPI(page);
    await page.goto('/users.html');
    await rowOf(page, u.username).getByRole('button', { name: `Editar ${u.username}` }).click();
    await page.locator('#f-password').fill('NuevaClave999');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('#status')).toHaveText('Usuario actualizado correctamente');
    const ok = await request.post('/api/auth/login', { data: { username: u.username, password: 'NuevaClave999' } });
    expect(ok.status()).toBe(200);
    const old = await request.post('/api/auth/login', { data: { username: u.username, password: u.password } });
    expect(old.status()).toBe(401);
  });
  test('el campo de contraseña de edición explica que puede quedar vacío', async ({ page }) => {
    const u = await createUserAPI(page);
    await page.goto('/users.html');
    await rowOf(page, u.username).getByRole('button', { name: `Editar ${u.username}` }).click();
    await expect(page.locator('#password-hint')).toContainText('vacía');
  });
  test('editar a un usuario ya existente muestra el error de duplicado', async ({ page }) => {
    const a = await createUserAPI(page);
    const b = await createUserAPI(page);
    await page.goto('/users.html');
    await rowOf(page, b.username).getByRole('button', { name: `Editar ${b.username}` }).click();
    await page.locator('#f-username').fill(a.username);
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('#err-username')).toBeVisible();
  });
});

// ---------------------------------------------------------------- búsqueda
test.describe('Búsqueda con distintas consultas', () => {
  test.beforeEach(async ({ page }) => {
    await loginAPI(page);
    await page.goto('/users.html');
    await expect(rowOf(page, 'admin')).toBeVisible();
  });
  const queries = [['admin', 1], ['ADMIN', 1], ['Administrador', 1], ['istrad', 1], ['ana.lopez', 1], ['LÓPEZ', 1], ['example.com', 3], ['%zz', 0], ['_zz_', 0], ['\\zz', 0], ["'zz", 0], ['<zzz>', 0], ['x'.repeat(100), 0], ['😀', 0]];
  for (const [q, min] of queries) {
    test(`consulta ${JSON.stringify(q.slice(0, 20))}`, async ({ page }) => {
      await page.locator('#search').fill(q);
      if (min > 0) {
        await expect.poll(async () => page.locator('#users-body tr').count()).toBeGreaterThanOrEqual(min);
      } else {
        await expect(page.locator('#empty')).toBeVisible();
      }
      await expect(page.locator('#status.error')).toHaveCount(0);
    });
  }
});

// ---------------------------------------------------------------- diseño adaptable
test.describe('Diseño adaptable (viewports)', () => {
  const viewports = [
    ['móvil pequeño', 320, 568], ['móvil', 375, 667], ['móvil grande', 414, 896],
    ['tableta vertical', 768, 1024], ['laptop', 1366, 768], ['escritorio', 1920, 1080],
  ];
  for (const [label, width, height] of viewports) {
    test.describe(label, () => {
      test.use({ viewport: { width, height } });
      test('login: el formulario es visible y no hay desbordamiento horizontal', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#login-form')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);
      });
      test('login: se puede iniciar sesión', async ({ page }) => {
        await loginUI(page);
        await expect(page).toHaveURL(/\/users\.html$/);
      });
      test('usuarios: encabezado, búsqueda y botón principal son visibles', async ({ page }) => {
        await loginAPI(page);
        await page.goto('/users.html');
        await expect(page.getByRole('heading', { name: 'Usuarios' })).toBeVisible();
        await expect(page.locator('#search')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Nuevo usuario' })).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);
      });
      test('usuarios: el diálogo de alta cabe en pantalla', async ({ page }) => {
        await loginAPI(page);
        await page.goto('/users.html');
        await openNewUser(page);
        const box = await page.locator('#user-dialog').boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      });
    });
  }
  for (const scheme of ['light', 'dark']) {
    test.describe(`tema ${scheme}`, () => {
      test.use({ colorScheme: scheme });
      test('login visible', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#login-form')).toBeVisible();
      });
      test('usuarios visible', async ({ page }) => {
        await loginAPI(page);
        await page.goto('/users.html');
        await expect(rowOf(page, 'admin')).toBeVisible();
      });
    });
  }
});

// ---------------------------------------------------------------- accesibilidad y teclado
test.describe('Accesibilidad', () => {
  test('el login declara idioma español y tiene título', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page).toHaveTitle(/Iniciar sesión/);
  });
  test('usuarios declara idioma español y tiene título', async ({ page }) => {
    await loginAPI(page);
    await page.goto('/users.html');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page).toHaveTitle(/Usuarios/);
  });
  for (const [label, field] of [['Usuario', 'username'], ['Contraseña', 'password']]) {
    test(`login: el campo "${label}" tiene etiqueta asociada`, async ({ page }) => {
      await page.goto('/');
      await expect(page.getByLabel(label, { exact: true })).toHaveAttribute('name', field);
    });
  }
  for (const label of ['Nombre', 'Usuario', 'Correo electrónico', 'Rol', 'Contraseña']) {
    test(`diálogo de alta: el campo "${label}" tiene etiqueta asociada`, async ({ page }) => {
      await loginAPI(page);
      await page.goto('/users.html');
      await openNewUser(page);
      await expect(page.locator('#user-dialog').getByLabel(label, { exact: true })).toBeVisible();
    });
  }
  test('el diálogo de alta está nombrado por su título', async ({ page }) => {
    await loginAPI(page);
    await page.goto('/users.html');
    await openNewUser(page);
    await expect(page.getByRole('dialog', { name: 'Nuevo usuario' })).toBeVisible();
  });
  test('el diálogo de confirmación está nombrado por su título', async ({ page }) => {
    await loginAPI(page);
    const u = await createUserAPI(page);
    await page.goto('/users.html');
    await rowOf(page, u.username).getByRole('button', { name: `Eliminar ${u.username}` }).click();
    await expect(page.getByRole('dialog', { name: 'Eliminar usuario' })).toBeVisible();
  });
  test('los mensajes de estado usan role="status"', async ({ page }) => {
    await loginAPI(page);
    await page.goto('/users.html');
    await expect(page.locator('#status')).toHaveAttribute('role', 'status');
  });
  test('el error del login usa role="alert"', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#form-error')).toHaveAttribute('role', 'alert');
  });
  test('los botones de acción tienen nombre accesible con el usuario', async ({ page }) => {
    await loginAPI(page);
    await page.goto('/users.html');
    await expect(page.getByRole('button', { name: 'Editar ana.lopez' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Eliminar ana.lopez' })).toBeVisible();
  });
  test('la tabla tiene encabezados de columna con scope', async ({ page }) => {
    await loginAPI(page);
    await page.goto('/users.html');
    await expect(page.locator('th[scope="col"]')).toHaveCount(6);
  });
  test('el campo de búsqueda tiene etiqueta (oculta visualmente)', async ({ page }) => {
    await loginAPI(page);
    await page.goto('/users.html');
    await expect(page.getByLabel('Buscar usuarios')).toBeVisible();
  });
});

test.describe('Teclado', () => {
  test('Tab recorre usuario, contraseña y botón en el login', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#username')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#password')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#submit-btn')).toBeFocused();
  });
  test('Espacio sobre el botón envía el formulario de login', async ({ page }) => {
    await page.goto('/');
    await page.locator('#username').fill('admin');
    await page.locator('#password').fill('Admin123!');
    await page.locator('#submit-btn').focus();
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(/\/users\.html$/);
  });
  test('Enter en el campo de usuario envía el formulario', async ({ page }) => {
    await page.goto('/');
    await page.locator('#password').fill('Admin123!');
    await page.locator('#username').fill('admin');
    await page.locator('#username').press('Enter');
    await expect(page).toHaveURL(/\/users\.html$/);
  });
  test('Enter dentro del formulario de alta lo envía', async ({ page }) => {
    await loginAPI(page);
    await page.goto('/users.html');
    await openNewUser(page);
    const username = uniq('kb');
    await fillUser(page, { username });
    await page.locator('#f-password').press('Enter');
    await expect(rowOf(page, username)).toBeVisible();
  });
  test('Escape cierra el diálogo de confirmación sin eliminar', async ({ page }) => {
    await loginAPI(page);
    const u = await createUserAPI(page);
    await page.goto('/users.html');
    await rowOf(page, u.username).getByRole('button', { name: `Eliminar ${u.username}` }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#confirm-dialog')).toBeHidden();
    await expect(rowOf(page, u.username)).toBeVisible();
  });
  test('el foco pasa al primer campo al abrir el alta', async ({ page }) => {
    await loginAPI(page);
    await page.goto('/users.html');
    await openNewUser(page);
    await expect(page.locator('#f-name')).toBeFocused();
  });
});

// ---------------------------------------------------------------- sesión y navegación
test.describe('Sesión y navegación', () => {
  test('la sesión se conserva al recargar', async ({ page }) => {
    await loginUI(page);
    await expect(page).toHaveURL(/\/users\.html$/);
    await page.reload();
    await expect(page).toHaveURL(/\/users\.html$/);
    await expect(page.locator('#who')).toHaveText('Administrador');
  });
  test('tras cerrar sesión, "Atrás" no deja ver la lista de usuarios', async ({ page }) => {
    await loginUI(page);
    await expect(page).toHaveURL(/\/users\.html$/);
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
  });
  test('una cookie de sesión alterada obliga a volver al login', async ({ page, context }) => {
    await loginAPI(page);
    await context.addCookies([{ name: 'session', value: 'valor-alterado', url: page.url() === 'about:blank' ? 'http://127.0.0.1:3100/' : page.url() }]);
    await page.goto('/users.html');
    await expect(page).toHaveURL(/\/$/);
  });
  test('las cookies de sesión son HttpOnly', async ({ page, context }) => {
    await loginUI(page);
    await expect(page).toHaveURL(/\/users\.html$/);
    const cookie = (await context.cookies()).find((c) => c.name === 'session');
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
  });
  test('la cookie no es accesible desde JavaScript', async ({ page }) => {
    await loginUI(page);
    await expect(page).toHaveURL(/\/users\.html$/);
    expect(await page.evaluate(() => document.cookie)).not.toContain('session');
  });
  for (const path of ['/users.html', '/users.html?x=1', '/users.html#abc']) {
    test(`sin sesión, ${path} redirige al login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/$/);
    });
  }
  test('una URL inexistente muestra el texto de 404', async ({ page }) => {
    const res = await page.goto('/pagina-que-no-existe.html');
    expect(res.status()).toBe(404);
  });
});

// ---------------------------------------------------------------- recursos estáticos y consola
test.describe('Recursos estáticos y consola', () => {
  for (const asset of ['/css/styles.css', '/js/common.js', '/js/login.js', '/js/users.js', '/favicon.svg']) {
    test(`${asset} se sirve con 200`, async ({ request }) => {
      const res = await request.get(asset);
      expect(res.status()).toBe(200);
      expect((await res.body()).length).toBeGreaterThan(0);
    });
  }
  for (const [name, setup, path] of [['login', async () => {}, '/'], ['usuarios', async (page) => loginAPI(page), '/users.html']]) {
    test(`la página de ${name} no produce errores de JavaScript`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await setup(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(errors).toEqual([]);
    });
    test(`la página de ${name} no viola la política CSP`, async ({ page }) => {
      const violations = [];
      page.on('console', (m) => /Content Security Policy|Refused to/.test(m.text()) && violations.push(m.text()));
      await setup(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(violations).toEqual([]);
    });
  }
  test('el login no carga recursos de otros dominios', async ({ page }) => {
    const external = [];
    page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1') && !r.url().startsWith('data:')) external.push(r.url()); });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(external).toEqual([]);
  });
});
