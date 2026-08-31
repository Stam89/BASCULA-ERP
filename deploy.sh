#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Despliegue de BASCULA-ERP en PRODUCCIÓN. Ejecutar EN EL SERVIDOR tras `git pull`.
#
# Requisitos en el server:
#   · Node + npm, PostgreSQL accesible.
#   · PM2 instalado globalmente:  npm i -g pm2
#   · backend/.env con al menos DATABASE_URL (y opcional JWT_SECRET / CORS_ORIGINS /
#     PORT). Los secretos se cargan de ahí vía dotenv; NO viven en git.
#
# Uso:  ./deploy.sh        (o  bash deploy.sh )
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Situarse en la raíz del repo (donde vive este script), sin importar desde dónde
# se invoque.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "==> [1/4] Migraciones aditivas pendientes (backend: npm run db:migrate)"
# Runner propio (tsx src/scripts/migrate.ts): aplica solo las migraciones nuevas
# (p.ej. 20260828_* y 20260829_*) y las registra en schema_migrations. Aditivas.
( cd backend && npm run db:migrate )

echo "==> [2/4] Compilar Backend (tsc -> backend/dist)"
( cd backend && npm run build )

echo "==> [3/4] Compilar Frontend (tsc && vite build -> web-admin/dist)"
# El backend sirve web-admin/dist, por eso ambos builds son necesarios.
( cd web-admin && npm run build )

echo "==> [4/4] Reiniciar el servicio con PM2 (:4000)"
# reload = recarga sin downtime si ya está corriendo; si no existe aún, se arranca.
pm2 reload ecosystem.config.js --env production \
  || pm2 start ecosystem.config.js --env production

echo "==> Despliegue completado."
pm2 status bascula-erp || true
