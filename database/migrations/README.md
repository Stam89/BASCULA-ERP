# Migraciones de base de datos

Cada archivo `.sql` de esta carpeta es un cambio en la estructura de la base de
datos (nuevas tablas, columnas, etc.). Se aplican **en orden por fecha** (el
nombre empieza con `YYYYMMDD`).

## Aplicar migraciones (cualquier equipo/servidor)

Desde la carpeta `backend/`:

```bash
npm run db:migrate
```

- Aplica solo las migraciones que aún **no** se han corrido en esa base de datos.
- Lleva el registro en la tabla `schema_migrations`.
- Es **seguro correrlo varias veces**: si no hay nada pendiente, no hace nada.

Requiere la variable `DATABASE_URL` (la misma que usa el backend, en el archivo
`.env`).

## Instalación nueva desde cero

1. `npm run db:init` — crea el esquema base (`database/schema.sql`).
2. `npm run db:migrate` — aplica todas las migraciones encima.
3. `npm run db:seed` — (opcional) datos iniciales.

## Crear una migración nueva

1. Crea un archivo `YYYYMMDD_descripcion.sql` en esta carpeta.
2. Usa siempre `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` cuando se pueda, para
   que sea seguro re-aplicar.
3. Corre `npm run db:migrate`.
