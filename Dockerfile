# Imagen ligera (Alpine Slim) de la aplicación: backend Node + frontend estático.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/users.db \
    NODE_NO_WARNINGS=1

WORKDIR /app

# La app no tiene dependencias de ejecución; solo se copian package.json, backend y frontend.
COPY package.json ./
COPY backend ./backend
COPY frontend ./frontend

# Usuario sin privilegios + carpeta persistente para SQLite
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "backend/src/server.js"]
