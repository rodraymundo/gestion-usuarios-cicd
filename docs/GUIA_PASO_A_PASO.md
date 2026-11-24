# Guía paso a paso: Proyecto Parcial 2 (CI/CD, pruebas y observabilidad)

Esta guía te lleva de cero a tener todo funcionando y listo para la revisión. Sigue los pasos en orden. Donde dice **[CAPTURA n]** debes tomar una pantalla para el reporte (la lista completa está en el paso 12).

## 0. Qué contiene el proyecto

- **Aplicación**: página con login y CRUD de usuarios (backend Node.js + frontend HTML/JS, base de datos SQLite). Usuario inicial: `admin` / `Admin123!`.
- **Pruebas del backend (Back = Jest)**: 508 pruebas en `tests/api/`. Jest es el equivalente en JavaScript de Pytest.
- **Pruebas del frontend (Front = Playwright)**: 219 pruebas en `tests/e2e/`.
- **Pipeline**: `.github/workflows/ci-cd.yml` (GitHub Actions). Despliega a EC2 solo si pasan Jest y Playwright.
- **Observabilidad**: `docker-compose.yml` levanta la app, el OpenTelemetry Collector, OpenObserve y node-exporter (CPU, RAM, ancho de banda y temperatura).
- **Imagen Alpine Slim**: el `Dockerfile` usa `node:22-alpine`.
- **Endpoint Health**: `GET /health` devuelve estado, timestamp, versión y chequeo de la base de datos.

Todo va en **un solo repositorio**: es más fácil de entregar y de evaluar.

## 1. Probar en tu computadora

Necesitas Node.js 22.13 o superior (`node -v`) y Git.

```
cd proyecto-cicd-usuarios
npm install
npx playwright install chromium
npm run test:api
npm run test:e2e
npm start
```

- `npm run test:api` ejecuta Jest (debe terminar sin fallos).
- `npm run test:e2e` ejecuta Playwright; abre solo el servidor en el puerto 3100.
- `npm start` levanta la app en http://localhost:3000. Entra con `admin` / `Admin123!`.
- Si `npm install` genera el archivo `package-lock.json`, **súbelo al repositorio** (el pipeline lo usa).

**[CAPTURA 1]**: terminal con las pruebas de Jest pasando. **[CAPTURA 2]**: terminal con Playwright pasando.

## 2. Crear el repositorio en GitHub

1. En github.com crea un repositorio nuevo (por ejemplo `gestion-usuarios-cicd`). Puede ser público.
2. En la carpeta del proyecto:

```
git init
git add .
git commit -m "Proyecto inicial"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/gestion-usuarios-cicd.git
git push -u origin main
```

El primer push ejecutará el pipeline y **fallará en el despliegue**, porque todavía no hay servidor ni secretos. Es normal. Continúa con el paso 3.

## 3. Crear la instancia EC2 en AWS

1. En la consola de AWS entra a **EC2 > Launch instance**.
2. Nombre: `users-app`. Imagen: **Ubuntu Server 24.04 LTS**.
3. Tipo de instancia: **t3.small** o **t3.medium** (OpenObserve necesita al menos 2 GB de RAM).
4. Key pair: crea uno nuevo (`.pem`) y descárgalo. **Guárdalo bien**: es la llave SSH.
5. Almacenamiento: 20 GB.
6. Grupo de seguridad (reglas de entrada):
   - SSH, puerto **22**: origen "Anywhere" (0.0.0.0/0) para que GitHub Actions pueda conectarse (las IP de GitHub cambian). Protege el acceso con la llave.
   - TCP **3000**: origen Anywhere (la aplicación).
   - TCP **5080**: origen Anywhere (OpenObserve).
7. Lanza la instancia y copia su **IP pública** (por ejemplo `3.90.10.20`). Si la apagas y la vuelves a encender, la IP cambia: para evitarlo asigna una **Elastic IP** (EC2 > Elastic IPs).

**[CAPTURA 3]**: instancia en estado "Running". **[CAPTURA 4]**: reglas del grupo de seguridad.

## 4. Preparar el servidor

Desde tu computadora (en la carpeta donde guardaste la llave):

```
chmod 400 llave.pem
ssh -i llave.pem ubuntu@IP_PUBLICA
```

Dentro del servidor, instala Docker. Puedes copiar el contenido de `scripts/ec2-bootstrap.sh` o ejecutar:

```
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
mkdir -p ~/app
exit
```

Vuelve a entrar por SSH (para que el grupo `docker` tome efecto) y crea el archivo de configuración:

```
nano ~/app/.env
```

Pega esto y cambia los valores (usa tus propias claves):

```
SESSION_SECRET=una-cadena-larga-y-aleatoria-123456789
ADMIN_USER=admin
ADMIN_PASSWORD=Admin123!
SEED_DEMO=1
DEPLOY_ENV=production
APP_VERSION=1.0.0
O2_USER=admin@uteq.edu.mx
O2_PASS=CambiaEstaClave123
O2_BASIC_AUTH=PEGA_AQUI_EL_BASE64
```

Para obtener `O2_BASIC_AUTH`, en el mismo servidor ejecuta (con **tu** correo y contraseña de OpenObserve):

```
echo -n 'admin@uteq.edu.mx:CambiaEstaClave123' | base64
```

Pega el resultado en `O2_BASIC_AUTH`. Guarda con `Ctrl+O`, Enter, `Ctrl+X`.

**Temperatura**: revisa si la instancia expone sensores:

```
ls /sys/class/thermal /sys/class/hwmon
```

En las instancias de AWS (virtualizadas) normalmente **no hay sensores de temperatura**. Si la carpeta está vacía, la gráfica de temperatura no tendrá datos: es una limitación de la nube, no un error. Mira el paso 9 para cómo explicarlo en el reporte.

## 5. Configurar los secretos de GitHub

En tu repositorio: **Settings > Secrets and variables > Actions > New repository secret**. Crea estos cinco:

- `EC2_HOST`: la IP pública de la instancia.
- `EC2_USER`: `ubuntu`.
- `EC2_SSH_KEY`: el contenido **completo** del archivo `.pem` (incluyendo las líneas `BEGIN` y `END`).
- `O2_USER`: el mismo correo que pusiste en `O2_USER` del `.env`.
- `O2_PASS`: la misma contraseña que pusiste en `O2_PASS` del `.env`.

## 6. Primer despliegue

1. En GitHub ve a **Actions > CI/CD - Gestión de usuarios > Run workflow** (o haz cualquier commit a `main`).
2. Verás cuatro trabajos: *Pruebas backend (Jest)*, *Pruebas frontend (Playwright)*, *Registrar resultado en OpenObserve* y *Desplegar en AWS EC2*.
3. La primera vez tarda unos minutos porque construye las imágenes en el servidor.
4. Al terminar, abre `http://IP_PUBLICA:3000` (la app) y `http://IP_PUBLICA:3000/health` (el endpoint health).
5. En el servidor puedes revisar los contenedores con `docker ps` (deben estar `users-app`, `otel-collector`, `openobserve` y `node-exporter`).

**[CAPTURA 5]**: pipeline completo en verde. **[CAPTURA 6]**: aplicación funcionando en la IP de EC2. **[CAPTURA 7]**: `docker ps` en el servidor.

## 7. Entrar a OpenObserve

1. Abre `http://IP_PUBLICA:5080` e inicia sesión con `O2_USER` / `O2_PASS`.
2. Genera tráfico: entra a la app, inicia sesión, crea, edita y elimina usuarios, y abre `/health` varias veces. Espera 1 o 2 minutos.
3. Ve a **Streams** y confirma que existen datos. Debes ver, según el tipo:
   - **Logs**: `ci_pipeline` (eventos del pipeline) y `app_logs` (logs de la aplicación).
   - **Metrics**: `http_server_duration_*`, `http_server_requests`, `process_memory_rss`, `node_*` (infraestructura).
   - **Traces**: la traza con servicio `users-app`.
4. **Importante**: OpenObserve cambia los puntos por guiones bajos en los nombres. Si algún nombre difiere un poco de los que usa esta guía, usa el que aparezca en **Streams**.

**[CAPTURA 8]**: lista de Streams. **[CAPTURA 9]**: logs de `ci_pipeline`. **[CAPTURA 10]**: trazas (menú Traces) con una traza abierta mostrando el span `INSERT users` dentro de `POST /api/users`.

## 8. Crear los dashboards (RF-06)

En **Dashboards > Add dashboard**, llámalo `Observabilidad - Gestión de usuarios`. Agrega estos paneles. En los de métricas elige el tipo de consulta **PromQL**; en los de logs, **SQL**.

**Tiempo de respuesta por endpoint (Time Respond)** — línea:

```
sum by (http_route) (rate(http_server_duration_sum[5m])) / sum by (http_route) (rate(http_server_duration_count[5m]))
```

**Volumen de peticiones por endpoint, método y código de estado (Endpoint type y Status Code)** — barras o línea:

```
sum by (http_route, http_method, http_status_code) (rate(http_server_requests[5m]))
```

**Tasa de error (códigos 4xx y 5xx)**:

```
sum(rate(http_server_requests{http_status_code=~"4..|5.."}[5m])) / sum(rate(http_server_requests[5m]))
```

**CPU (%)**:

```
100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100)
```

**RAM usada (%)**:

```
100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)
```

**Ancho de banda (bytes por segundo, entrada y salida)**:

```
sum(rate(node_network_receive_bytes_total{device!="lo"}[2m]))
sum(rate(node_network_transmit_bytes_total{device!="lo"}[2m]))
```

**Temperatura (°C)** — solo si el servidor tiene sensores:

```
max(node_hwmon_temp_celsius)
```

Alternativa si no aparece: `max(node_thermal_zone_temp)`. Si no hay datos, deja el panel creado y explica la limitación (paso 9).

**Eventos del pipeline** — tabla (SQL, stream `ci_pipeline`):

```
SELECT timestamp, event, status, commit_short, branch, actor, message FROM "ci_pipeline" ORDER BY _timestamp DESC
```

**Logs de la aplicación** — tabla (SQL, stream `app_logs`):

```
SELECT _timestamp, severity, body FROM "app_logs" ORDER BY _timestamp DESC
```

Si los nombres de las columnas de logs difieren, abre primero el stream en **Logs**, mira los campos y ajusta la consulta.

Para el criterio 3 ("pipeline, trazas y gráficas al mismo tiempo"), deja **todos** estos paneles en **un solo dashboard** y toma la captura con todo visible. Las trazas se muestran en el menú **Traces**; si el profesor las quiere en la misma pantalla, abre el dashboard y la vista de trazas lado a lado en la captura.

**[CAPTURA 11]**: dashboard completo (CPU, RAM, ancho de banda, temperatura, tiempos de respuesta, pipeline).

## 9. Temperatura en EC2 (cómo manejarlo)

Los servidores de AWS no tienen sensores de temperatura accesibles en la mayoría de los casos. Opciones, de mejor a peor:

1. Comprueba con `ls /sys/class/thermal /sys/class/hwmon`. Si hay datos, el panel ya funciona.
2. Si no hay, **no inventes valores**. Deja el panel con la consulta correcta y escribe en el reporte: *"La instancia EC2 es virtualizada y no expone sensores térmicos; la métrica está configurada y se activaría en hardware físico"*. Es una explicación técnicamente correcta.
3. Si el profesor insiste en ver la gráfica, comenta el caso con él antes de la revisión; no manipules datos.

## 10. Alertas operativas (RF-06)

En OpenObserve ve a **Alerts**. Primero crea un **destino** en **Alerts > Destinations** (puede ser un webhook; para pruebas sirve una dirección gratuita de webhook.site, o tu correo si lo configuras). Después crea estas alertas (tipo *Scheduled*):

1. **Pipeline fallido**: stream `ci_pipeline` (logs), condición `event = incident`, umbral mayor o igual a 1 en 5 minutos.
2. **Errores del servidor**: stream `app_logs`, condición de severidad `ERROR`, umbral mayor o igual a 1 en 5 minutos.
3. **CPU alta**: consulta PromQL sobre la métrica de CPU del paso 8, umbral mayor a 80.
4. **Latencia alta**: promedio del tiempo de respuesta mayor a 500 ms.

Si no puedes crear una alerta de métricas en tu versión, crea al menos las dos primeras (logs) y menciónalo.

**[CAPTURA 12]**: lista de alertas.

## 11. Demostración de los criterios de aceptación

### Criterio 1: commit con error intencional

1. Introduce un error que rompa una prueba de Playwright. La forma más simple: en `frontend/public/index.html` cambia el texto del botón `Iniciar sesión` por `Entrar` (solo el del botón, línea `<button id="submit-btn"...>`).
2. Haz commit y push:

```
git add .
git commit -m "Cambio con error intencional"
git push
```

3. Resultado esperado en Actions: **Playwright falla** (rojo), el trabajo de *Desplegar* aparece **omitido** (gris): no hay conexión SSH al servidor. Se ejecuta *Registrar resultado*, que envía a OpenObserve los eventos `tests` (failure) e `incident`.
4. En OpenObserve, en el stream `ci_pipeline`, aparece el incidente con commit, rama, usuario y las pruebas que fallaron.

**[CAPTURA 13]**: pipeline en rojo con el despliegue omitido. **[CAPTURA 14]**: reporte de Playwright con la prueba fallida. **[CAPTURA 15]**: incidente en OpenObserve.

### Criterio 2: commit válido

1. Revierte el error: `git revert HEAD --no-edit` y `git push` (o corrige el texto a mano).
2. Resultado esperado: todo en verde, los contenedores se actualizan en EC2 y OpenObserve registra el evento `deploy`.
3. Verifica con `docker ps` que los contenedores se recrearon recientemente (columna `CREATED`).

**[CAPTURA 16]**: pipeline en verde con despliegue. **[CAPTURA 17]**: evento de despliegue en OpenObserve.

### Criterio 3: todo junto

Con la app en uso, muestra en OpenObserve: eventos del pipeline, una traza, y las gráficas de CPU, ancho de banda, temperatura y RAM (captura 11).

## 12. Lista de figuras para el reporte

El reporte (`Reporte_Proyecto_Parcial2.docx`) ya incluye diagramas y capturas de la interfaz. Tienes que reemplazar los recuadros marcados como **[Insertar captura]** con tus capturas reales de los pasos anteriores (1 a 17). Pega la imagen sobre el recuadro, conserva el pie de figura numerado y revisa que el texto del reporte las mencione.

## 13. PDF del reporte de Playwright

Si el profesor pide el reporte generado por el framework:

```
npm run test:e2e
npx playwright show-report
```

Se abre el reporte HTML en el navegador. Usa **Imprimir > Guardar como PDF**. Para que incluya la portada institucional, agrega una hoja con tus datos al inicio del PDF (como en la práctica anterior).

## 14. Qué entregar

- Enlace al repositorio de GitHub.
- Enlace del servidor: `http://IP_PUBLICA:3000` (app) y `http://IP_PUBLICA:5080` (OpenObserve), con sus credenciales.
- El reporte en Word.
- El PDF del reporte de Playwright (si lo piden).

**Antes de la revisión**: confirma que la instancia está encendida y que la IP no cambió. Si cambió, actualiza el secreto `EC2_HOST`.

## 15. Problemas comunes

- **`npm ci` falla en Actions**: falta `package-lock.json`. Ejecuta `npm install` en local y sube el archivo.
- **Permission denied (publickey) en el despliegue**: el secreto `EC2_SSH_KEY` está incompleto, o `EC2_USER` no es `ubuntu`.
- **`docker: permission denied`**: no cerraste sesión SSH tras `usermod -aG docker`. Sal y vuelve a entrar.
- **El despliegue falla por `SESSION_SECRET`**: falta el archivo `~/app/.env` o la variable `SESSION_SECRET`.
- **No hay datos de métricas en OpenObserve**: revisa `docker logs otel-collector` y que `O2_BASIC_AUTH` sea el base64 de `correo:contraseña` exactos. Debe coincidir con `O2_USER` y `O2_PASS`.
- **No llegan eventos del pipeline**: en GitHub revisa que `O2_USER` y `O2_PASS` coincidan con los de OpenObserve y que el puerto 5080 esté abierto en el grupo de seguridad.
- **OpenObserve se queda sin memoria**: usa `t3.medium` o agrega swap.
- **Cambió la IP**: actualiza `EC2_HOST` y vuelve a ejecutar el pipeline.
