// ─────────────────────────────────────────────────────────────────────────────
// Configuración de PM2 para BASCULA-ERP.
// El backend (Node/Express) corre desde ./backend como `node dist/server.js` y
// sirve el frontend compilado en web-admin/dist.
//
// SECRETOS: DATABASE_URL, JWT_SECRET y CORS_ORIGINS NO van aquí (no se versionan).
// Se cargan de backend/.env vía dotenv al arrancar (cwd = ./backend). En este
// archivo solo dejamos NODE_ENV y PORT.
//
// Uso:
//   pm2 start ecosystem.config.js --env production
//   pm2 reload ecosystem.config.js --env production
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  apps: [
    {
      name: "bascula-erp",
      cwd: "./backend",
      script: "dist/server.js",

      // fork (NO cluster): el server mantiene un pool de PostgreSQL y estado en
      // memoria (secreto JWT, cachés). No está verificado como cluster-safe, así
      // que una sola instancia en modo fork evita duplicar conexiones/estado.
      // Migrar a cluster solo tras revisar esa dependencia.
      exec_mode: "fork",
      instances: 1,

      autorestart: true,
      max_memory_restart: "500M",   // reinicia si el proceso supera 500 MB
      // Evita reinicios en bucle si el arranque falla (p.ej. .env mal): espera 3s
      // y corta tras 10 reinicios seguidos en poco tiempo.
      restart_delay: 3000,
      min_uptime: "10s",
      max_restarts: 10,

      // Entorno por defecto (desarrollo). En prod se activa con `--env production`.
      env: {
        NODE_ENV: "development",
        PORT: 4000
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 4000
        // DATABASE_URL, JWT_SECRET, CORS_ORIGINS → definir en backend/.env
      }
    }
  ]
};
