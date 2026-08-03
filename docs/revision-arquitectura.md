# Revisión de arquitectura — BASCULA ERP

Fecha: 2026-07-27. Revisión de solo lectura; no se modificó código.

## 1. Visión general

Monorepo con 4 componentes:

```text
App Android (planta) ──┐                        ┌──> Firebase (import cada 3 min)
Panel web (admin)   ──┼──> Backend Express ────> PostgreSQL
Impresora BT 58mm  <──┘   (sirve también la     └──> uploads/ (fotos)
                           web compilada)
```

- **Backend** (`backend/`): Node + Express 4 + TypeScript (ESM), API REST bajo `/api/v1`. Sirve además el `dist` del panel web con estrategia de caché correcta (`backend/src/app.ts:67-83`).
- **Web admin** (`web-admin/`): React 18 + Vite, **sin** router, sin librería de estado, sin data-fetching — todo en un solo `App.tsx` de **10.140 líneas** con 177 llamadas API directas.
- **Android** (`android-app/`): Kotlin nativo con Views construidos en código, SQLite local (`TicketDatabaseHelper`), sync con WorkManager, impresión ESC/POS por Bluetooth. Dependencias mínimas (coroutines + WorkManager); red con `HttpURLConnection` y `org.json` a mano.
- **Base de datos**: PostgreSQL. `database/schema.sql` (701 líneas) + **49 migraciones** fechadas con runner propio (`schema_migrations`).
- **Infra**: despliegue artesanal en Windows con `.bat`/`.ps1` (inicio, respaldo vía `pg_dump`, acceso en red LAN).

## 2. Patrones de diseño identificados

### Backend (lo más sólido del proyecto)
- **Middleware chain bien ordenada**: auditoría → auth → resolución de accionista (multi-tenant) → permisos por módulo (`backend/src/routes/index.ts:40-52`).
- **Multi-tenancy por accionista** vía header `X-Accionista-Id`, validado contra `user_accionistas` en cada request (`require-auth.ts:148-179`).
- **Permisos releídos de la BD en cada escritura**, no del JWT — decisión correcta y bien documentada (`require-auth.ts:64-66`).
- **`inTransaction(client => ...)`** para operaciones críticas (`db/transaction.ts`) — transacciones reales en liquidaciones, caja, producción.
- **`asyncRoute` + `ApiError` + error handler central** que traduce códigos de Postgres (23505→409, etc.) a mensajes accionables en español (`http/error-handler.ts:20-31`).
- **Validación Zod en el borde** de cada módulo de rutas.
- **Auditoría fire-and-forget** con sanitización de secretos y captura del body (`audit/audit.ts`) — bien pensada: nunca rompe ni frena la operación.
- **Pool pg endurecido**: manejador de `error` en clientes inactivos para que un reinicio de Postgres no tumbe Node (`db/pool.ts:11-17`).
- **JWT secret auto-generado** y persistido fuera de git si falta en `.env` (`config/env.ts:14-29`).

### Base de datos
- **Stock como event log**: `inventory_movements` es la fuente de verdad; el stock se deriva de la vista `inventory_stock` (`schema.sql:618-626`). Buen patrón anti-edición directa.
- **Columna generada** `net_weight = gross - tare` (`schema.sql:189`) — integridad a nivel de base.
- **CHECK constraints generosos** (montos positivos, balances ≤ monto, estados válidos) — el dominio está bien defendido a nivel DB.
- **Reversión por contra-asiento** en caja (`reversal_of`, `reversed_at`…) en vez de borrar — patrón contable correcto.

### Android
- **Offline-first**: tickets en SQLite local + sync posterior (WorkManager) — acertado para planta con red inestable.
- **Cola de impresión con reintentos** (`PrintQueueRepository`, `FailedPrint`) y anti-fraude (bloqueo de ticket, `print_count`, PIN de admin).

## 3. Dependencias críticas

| Dependencia | Riesgo |
|---|---|
| `pg` con SQL crudo en cada ruta | Sin capa de datos: SQL duplicado y difícil de testear; pero los queries son parametrizados (sin inyección SQL evidente). |
| `firebase-admin` | Pesada (~100 MB en node_modules); carga perezosa bien hecha, pero es un **segundo canal de sincronización** (Firebase + API propia) que duplica lógica de importación. |
| Express 4 | Estable; Express 5 ya es el actual — no urgente. |
| JWT 12 h sin refresh ni revocación | Un token robado vale 12 h; se mitiga re-leyendo `is_active`/permisos en escrituras, pero **las lecturas no se revalidan**. |
| Token por query param en `/uploads` (`app.ts:37-49`) | Necesario para `<img src>`, pero el token queda en **logs de morgan** — filtrado de sesiones. |
| `postgres:postgres` como `DATABASE_URL` por defecto (`env.ts:42`) | Credenciales triviales en instalaciones que no configuren `.env`. |
| Web: solo `react` + `react-dom` | Cero librerías de soporte = todo el estado, routing por pestañas y fetching hechos a mano dentro del monolito. |
| Android: `HttpURLConnection` + `org.json` | Frágil y verboso; sin serialización type-safe ni manejo de errores unificado. |

## 4. Cuellos de botella

1. **`App.tsx` de 10.140 líneas** (web-admin). Cuello de botella #1 del proyecto — de mantenibilidad: cualquier cambio toca un archivo gigante, no hay code-splitting y el estado vive en un componente raíz con decenas de `useState`.
2. **Hasta 3 queries extra por request** en la cadena de auth (`resolveAccionista` + `enforceModulePermissions`, `require-auth.ts:79-109`). Sin caché.
3. **Vista `inventory_stock` recalcula `SUM` sobre todo el historial** en cada consulta. Con años de datos, cada pantalla de inventario será un full-scan.
4. **Índices faltantes en FKs calientes**: `liquidations.farmer_id`, `liquidations.lot_id`, `sale_items.sale_id`, `cash_movements.reference_*`, `accounts_payable/receivable`, `audit_logs.user_id`… El schema solo indexa ~10 columnas (`schema.sql:607-616`).
5. **Importación Firebase cada 3 min con `get()` de colecciones completas** (`bascula-firebase.ts:62-65`) — lee TODOS los tickets cada vez, sin cursor incremental.
6. **Pool de 10 conexiones** compartido entre requests, auditoría e importación Firebase — un reporte pesado puede acaparar el pool.
7. **Paginación inconsistente**: algunos listados tienen `LIMIT 100` (`processing.ts:88`), pero la mayoría de catálogos y movimientos devuelven todo.
8. **Logging con `morgan("dev")` + `console.log`** en producción, sin rotación — `logs/backend.log` crece indefinidamente.
9. **`ensureAuditTable()` hace `ALTER TABLE` en runtime** desde el middleware (`audit.ts:7-19`) — DDL escondido fuera de migraciones.
10. **Sin HTTPS**: todo circula en claro por la LAN (tokens JWT incluidos).

## 5. Áreas de mejora (priorizadas)

**P0 — impacto inmediato, bajo riesgo** ✅ Aplicadas (2026-07-27)
- ~~Índices en FKs y columnas de fecha calientes~~ → migración `20260730_indices_fks_sync_y_auditoria.sql` (también recreó `mobile_advance_applications`, tabla que el código usaba pero no existía en la base).
- ~~Sync incremental de Firebase~~ → `bascula-firebase.ts` ahora usa marcas por colección en `firebase_sync_state` con solape de 5 min.
- ~~Token de `/uploads`~~ → URLs firmadas HMAC de 1 hora (`auth/upload-sign.ts`); el JWT por query param ya no se acepta.
- ~~Default de `DATABASE_URL`~~ → en producción (`NODE_ENV=production`) el backend exige `DATABASE_URL`; en desarrollo mantiene el default con aviso.
- Extra: permisos por escritura pasaron de 2 queries a 1 (JOIN `users`+`user_accionistas` en `require-auth.ts`); el DDL de auditoría salió del middleware a la migración.

**P1 — mantenibilidad**
- **Dividir `App.tsx` por módulos** (una carpeta por pestaña) con `React.lazy`. Es la mejora con más retorno del proyecto.
- Cachear permisos/rol por request (una sola query juntando `users` + `user_accionistas`).
- Consolidar `schema.sql` con las 49 migraciones (hoy no contiene tablas actuales como `milling_drafts`, `user_accionistas` ni la columna `accionista_id` en `lots`).
- Mover los `ALTER` de `ensureAuditTable` a una migración.

**P2 — robustez**
- Tests: solo existen 3 archivos de utilidades (`codes`, `money`, `rice-formulas`). Las rutas críticas (liquidaciones, caja, producción) no tienen ni un test.
- Logging estructurado con rotación y apagar `morgan` en producción.
- Paginación estándar (`?page`/`?limit`) en listados grandes.
- Materializar stock cuando la vista se vuelva lenta — no antes.
- Android: extraer la lógica de negocio de `MainActivity` hacia los repositorios que ya existen; considerar Retrofit/Ktor + Moshi si la API crece.
- Documentación: `docs/arquitectura.md` describe el sistema original; no menciona accionistas, cuadrilla, fomentos, selección, pedidos ni el módulo financiero.

## 6. Valoración final

El **backend y la base de datos están notablemente bien cuidados** para un proyecto de este tamaño: transacciones, constraints, auditoría, anti-fraude, revalidación de permisos y comentarios que explican el *porqué* de cada decisión. La deuda técnica se concentra en dos puntos: el **monolito de `App.tsx`** (10k líneas) y la **divergencia schema↔migraciones↔docs**. Los cuellos de botella de rendimiento (vista de stock, sync Firebase completo, N+1 de auth) hoy son latentes por la escala LAN, pero todos crecen linealmente con los datos.
