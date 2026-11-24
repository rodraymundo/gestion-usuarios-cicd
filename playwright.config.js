// Configuración de Playwright (pruebas E2E del frontend).
// Arranca la propia aplicación en el puerto 3100 con una base de datos en memoria.
// Para probar un despliegue ya existente: BASE_URL=http://IP:3000 npx playwright test
const { defineConfig, devices } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3100';

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: { timeout: 7000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-results.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    locale: 'es-MX',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'node backend/src/server.js',
        url: 'http://127.0.0.1:3100/health',
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
        env: {
          PORT: '3100',
          HOST: '127.0.0.1',
          DB_PATH: ':memory:',
          SESSION_SECRET: 'secreto-e2e',
          ADMIN_USER: 'admin',
          ADMIN_PASSWORD: 'Admin123!',
          SEED_DEMO: '1',
          LOG_STDOUT: '0',
          NODE_NO_WARNINGS: '1',
        },
      },
});
