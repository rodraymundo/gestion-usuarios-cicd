/** Configuración de Jest: solo pruebas de la API (backend). Las E2E del frontend las ejecuta Playwright. */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/api/**/*.test.js'],
  testTimeout: 30000,
  verbose: true,
};
