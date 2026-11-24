# Gestión de usuarios: CI/CD, pruebas automatizadas y observabilidad

Aplicación con login y CRUD de usuarios, con pruebas (Jest + Playwright), pipeline de GitHub Actions que despliega a AWS EC2 solo si todo pasa, y observabilidad con OpenTelemetry + OpenObserve.

- Guía completa: [docs/GUIA_PASO_A_PASO.md](docs/GUIA_PASO_A_PASO.md)
- Usuario inicial: `admin` / `Admin123!` (cámbialo con `ADMIN_PASSWORD`).

## Uso rápido

```
npm install
npx playwright install chromium
npm run test:api     # Jest (backend)
npm run test:e2e     # Playwright (frontend)
npm start            # http://localhost:3000
```

## Estructura

- `backend/src`: API (Node.js sin dependencias), telemetría OTLP.
- `frontend/public`: login y CRUD.
- `tests/api`: pruebas Jest. `tests/e2e`: pruebas Playwright.
- `.github/workflows/ci-cd.yml`: pipeline. `scripts/send-ci-event.js`: envío de eventos a OpenObserve.
- `Dockerfile`, `docker-compose.yml`, `observability/`: despliegue y observabilidad.

## Endpoints

`GET /health`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET|POST /api/users`, `GET|PUT|DELETE /api/users/:id` (escritura solo para administradores).
