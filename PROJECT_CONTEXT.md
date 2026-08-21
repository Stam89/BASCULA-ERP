# PROJECT_CONTEXT — BASCULA-ERP

> Memoria compacta para continuar sin releer todo. Última actualización: 2026-08-21 (cierre 2).
> Al empezar una sesión, **lee solo este archivo** primero.

## 0. Stack / cómo corre
- Backend: Node/Express + TS (ESM/NodeNext strict), PostgreSQL 18 (`pg`), zod. Puerto **:4000**, sirve `web-admin/dist`.
- Frontend: React 18 + Vite 6. **Un solo archivo gigante**: `web-admin/src/App.tsx` (~12.7k líneas). Helpers en `web-admin/src/format.ts` (`money`, etc.).
- Migraciones propias: `cd backend && npm run db:migrate` (archivos en `database/migrations/`, registradas en `schema_migrations`). Aditivas siempre (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
- BD local: `postgres://postgres:1989@localhost:5432/bascula_erp`. psql en `C:/Program Files/PostgreSQL/18/bin/psql.exe`.
- Verificación: FE `node ./node_modules/typescript/bin/tsc --noEmit` + `vite build`; BE `npx tsc --noEmit` / `npm run build`.
- **Se trabaja y despliega desde el checkout MAIN** (`C:\Users\...\BASCULA-ERP`), rama `main`, commit+push cada fase. El worktree `determined-proskuriakova-259d21` está sobre una rama vieja/divergente: **ignorarlo**.

## 1. ESTADO ACTUAL
ERP para piladora de arroz con arquitectura **multi-accionista**: MATRIZ **CEYRO** (dueña, id `00000000-0000-0000-0000-000000000001`) y SOCIOS **ROVINSON** y **STALYN**. Selector de accionista activo manda header `X-Accionista-Id`; permisos por accionista.
- Funciona: Dashboard, Báscula, Secadoras, Producción, Inventario, Selección/envejecido, Ventas (pedido→despacho), Compras, Caja, Por Cobrar, Por Pagar, Liquidaciones, Fomentos, Agricultores, Nómina, Cuadrilla, Servicio Pilado, Estados Financieros, Costos Operativos, Reportes, Configuración.
- Todo está **commiteado y pusheado a main** (último `ffe0665`). Typecheck y build en verde. Backend reiniciado; cambios activos. Los últimos cambios (Báscula/Selección) son solo frontend → basta recargar (Ctrl+F5).

## 2. CAMBIOS DE ESTA SESIÓN (2026-08-20)
1. **Ventas** — Toma de pedido en split-view 2 columnas + "Cola de carga" para bodega (badge 🟡, texto grande de sacos). Solo UI; estado sigue `PENDING`/`DELIVERED`. `4a2d90a`.
2. **Costos Operativos** — movido de Producción a nueva pestaña **Contabilidad → Costos Operativos** (mismo form/tabla/endpoints `/costos`). `c838994`.
3. **Cargo automático por empaque** — al DESPACHAR un pedido de un SOCIO, CEYRO le cobra por sacos 10/25/50 lb. Migración `20260822`, `backend/src/services/cargo-empaque.ts`, hook en `orders.ts /:id/deliver`, config en Configuración→Tarifas. `c9bfcc0`. **Tarifas ya definidas (2026-08-21): 10lb=$0.20, 25lb=$0.22, 50lb=$0.27** (fila de CEYRO en `matriz_packaging_rates`). Editables en Configuración→💲Tarifas→"📦 Tarifas de empaque" (admin, `PUT /settings/packaging-rates`).
4. **Mantenimiento dinámico** — Áreas/Secciones/Tipos ahora en tabla `maintenance_categories` (migración `20260823`), con botón **[+ Nueva]** + modal en Caja→Mantenimiento. Reemplaza la constante estática `SECCIONES_POR_AREA`. `d3607b8`.
5. **Mantenedor de categorías** — Configuración → "🔧 Categorías mant.": renombrar (propaga a histórico) y desactivar (soft-delete). `b6ed200`. Filtros del historial muestran inactivas con sufijo "(Inactiva)"; los forms de creación solo activas. `76fd0e5`.
6. **Por Cobrar** — rediseño: tarjetas **consolidadas por deudor** + modal "estado de cuenta" (tabla, Pagar total / Abono parcial, Imprimir). Backend resuelve nombre del deudor socio. `95cd1fc`.
7. **Por Pagar** — mismo patrón, simétrico. Modal e impresión unificados en `CuentaDetalleModal` / `printCuentaStatement`. Backend resuelve nombre del acreedor. Se borró código muerto (`CuentaCardNueva`, `groupPayables`). `50b60d0`.

Archivos tocados: `web-admin/src/App.tsx` (todo); `backend/src/routes/modules/{orders,settings,equipment,receivable,cash}.ts`; `backend/src/services/{cargo-empaque,cuentas-vinculadas}.ts`; `database/migrations/2026082{2,3}_*.sql`.

## 2b. CAMBIOS 2026-08-21 (continuación)
8. **Ventas — fixes:** (a) encabezado de "Ventas realizadas" con `color:#fff`+`bold` inline en cada `<th>` (una regla global de `th` pisaba la herencia); (b) recibo mostraba la cantidad mal (5 en vez de 50): `sale_items.quantity` guarda QQ convertidos pero precio/total son por saco → el recibo ahora muestra `total/precio` y la columna se llama "Cantidad". `fd79df9`.
9. **Guía de Remisión** — migración `20260824` (campos transportista_nombre/cedula, vehiculo_placa, guia_number, guia_emitida_at en `sales_orders` + secuencia `guia_remision_seq`, formato `001-001-000000001`). `PUT /orders/:id/guia` guarda transporte y asigna nº la 1ª vez (solo pedidos DELIVERED; no toca inventario/contab.). Modal captura Chofer/Cédula/Placa + impresión **A4** (`@page A4` + `@media print`, ventana limpia): header matriz + recuadro guía, grid Remitente/Destinatario/Transportista, tabla Cantidad/Presentación/Producto (sin precios), 3 firmas. `7370651`.
10. **Guía — reubicación UX:** el botón vive ahora en la tabla "Ventas realizadas" (columna "Recibo"→"Documentos", junto al 🖨), con columna "Guía N°". Se eliminó la tabla "Pedidos despachados". La venta se enlaza a su pedido por `sale_id`. `3acc709`.
11. **Inventario → dashboard:** cabecera con **[⚖️ Ajuste/Cuadre Manual]** (modal) y **[📄 Ver Kardex/Movimientos]** (drawer lateral); el form de cuadre y el reporte de movimientos salen de la vista principal. Fila de **KPIs en QQ** (Total Cáscara/Producto Terminado/Subproductos) + tablas como tarjetas. Sin tocar queries/lógica: el modal reusa `submitStockAdjustment`. `89f8b97`.
12. **Dashboard — 7 KPIs por accionista:** el Panel Integral (`PanelIntegral`) filtra sus 7 tarjetas por el accionista activo (deriva de `per_accionista` + `*_por_acc` que ya vienen en `/dashboard/panel`; sin cambiar fórmulas base). Subtítulo dinámico "Mostrando datos de: NOMBRE". Servicio de pilado y Costo Operativo son propios de la MATRIZ → un socio los ve en $0. Verificado en vivo. `2b96e13`.
13. **Compra múltiple de sacos (carrito):** Caja→Sacos ahora es un carrito — [➕ Agregar a la lista] acumula ítems, tabla Tipo/Cantidad/Precio/Subtotal/🗑️ + TOTAL GENERAL, y [💾 Confirmar y Registrar Compra] envía todo. Backend `POST /sacks/purchases` recibe `items[]` (acepta el formato de 1 saco por compat.), en UNA transacción itera stock+kardex por ítem y hace UN solo egreso consolidado ("Compra de múltiples sacos", reference_id NULL). Archivos: `backend/src/routes/modules/sacks.ts` + App.tsx. `1756de7`. Probado en vivo (compra de 2 tipos → 1 egreso $11.60). **Fix:** el `<select>` de tipo de saco salía vacío en Caja→Sacos; ahora `refreshSacks()` corre al abrir esa subpestaña. `a9285b8`.
14. **Sacos SIEMPRE de la matriz al despachar:** solo CEYRO posee inventario de sacos (`sack_inventory` es tabla ÚNICA, sin accionista_id). Al despachar, el arroz/subproductos salen del inventario del socio (crearVenta, sin cambios) pero los SACOS se descuentan del inventario de la matriz. Nueva `descontarSacosDelDespacho()` en `cargo-empaque.ts` (por presentación con peso → tipo "Saco N LB", movimiento SALIDA; no bloquea si falta stock o no existe el tipo), llamada en `orders.ts /:id/deliver` junto al cargo por empaque, misma transacción. Verificado en vivo: pedido ROVINSON 5×10lb → Saco 10 LB 112→107, arroz −0.5 QQ de ROVINSON, CxC/CxP $1.00. `6d12837`.
15. **Báscula = Bandeja de entrada (Inbox):** se quitó de la vista el form "Registrar ingreso" (ahora modal via [+ Ingreso Manual (Emergencia)] en la cabecera de la tabla de tickets) y las secciones "Últimos lotes" y "Pasar un lote". La tabla de Tickets es full-width y el centro. Filtro por defecto ya era "Pendientes" (se conserva; "Todos" muestra historial). Se mantiene en Báscula la "Corrección puntual de accionista de materia prima". Reubicados: "Últimos lotes" → **Producción** (DataList); "Pasar un lote" → **Inventario**, botón [🔄 Transferir Lote] en la cabecera → modal (solo si accionistas>1). `fb51167`.
16. **Selección más limpia:** "Personas externas" (form+tabla) → modal via botón [👤 Gestionar Personas Externas] junto al selector. "💲 Tarifas por defecto" → **Configuración → Tarifas → tarjeta "Tarifas de Procesos (Selección/Envejecido)"** (mismo `saveSelectionRates`; `refreshConfig` ahora carga `/selection/rates`). El form "Mandar a selectar" sigue leyendo `selectionRates` de la BD para autocompletar "Tarifa por QQ". "Completados" pasó a panel full-width. `ffe0665`.

## 3. REGLAS DE NEGOCIO (no romper)
- **Toma de pedido NO mueve dinero ni inventario**; recién al **Despachar** sale stock + entra caja (Contado) o Cuenta por Cobrar (Crédito). Estados DB: `PENDING`/`DELIVERED`/`CANCELLED` (NO renombrar; hay CHECK). El pedido genera su CxC "(pendiente de despacho)" al tomarse; al despachar se salda o se enlaza, nunca se duplica.
- **Cuentas espejo entre accionistas**: un servicio/cargo de la matriz a un socio crea CxC (CEYRO) + CxP (socio) enlazadas en tablas puente (`pilado_services`, `lot_transfers`, `matriz_service_charges`, `matriz_packaging_charges`). Un abono en una cara debe reflejarse en la otra + caja del otro socio → `backend/src/services/cuentas-vinculadas.ts` (`espejarAbonoEnContraparte`). Saldar una cuenta debe mover caja + espejar, no solo bajar saldo.
- **"PENDIENTE"** en cuentas = `document_status='CONFIRMED'` con `balance=amount`. El enum `document_status` (DRAFT/CONFIRMED/PARTIAL/PAID/CANCELLED) **NO tiene 'PENDING'** — no inventarlo.
- **Cargo por empaque**: solo si el vendedor es SOCIO (la matriz no se cobra a sí misma); agrupa sacos 10/25/50 lb × tarifa; si total>0 crea CxC/CxP. Atómico dentro del despacho.
- **Inventario de SACOS = solo de la MATRIZ (CEYRO)**: `sack_inventory` es tabla única (sin accionista_id). Al despachar, el arroz sale del inventario del socio pero los sacos SIEMPRE se descuentan de `sack_inventory` (la matriz), via `descontarSacosDelDespacho()`. No confundir con el CARGO por empaque (deuda CxC/CxP): son dos efectos distintos que conviven en la misma transacción del despacho.
- **Combustible secadoras**: por MOTOR y por corrida (`filled_at`), repartido entre las 2 secadoras aunque terminen distinto.
- **Nómina**: estibador cobra por tulas (proporcional 5/3); guardianía del secador es UNA por día (no por secadora).
- **Categorías de mantenimiento**: soft-delete (nunca borrar filas); inactivas salen de forms pero se conservan en histórico/reportes; `area`/`section`/`maintenance_type` se guardan como TEXTO en `equipment_maintenance` (retrocompat).
- **Costos/consultas**: agrupaciones son a nivel query o frontend; NO borrar ni alterar registros base de deudas.

## 4. PROBLEMAS PENDIENTES
- ~~Tarifas de empaque en $0.00~~ **RESUELTO**: 10/25/50 = 0.20/0.22/0.27, editables en UI.
- ~~Verificación en navegador~~ **HECHA 2026-08-21**: Ventas, Por Cobrar, Por Pagar, Inventario y filtro de KPIs verificados en vivo. (Nota: el panel del navegador debe estar VISIBLE para clics/capturas; si está oculto, usar `read_page`/`get_page_text`.)
- `web-admin/src/App.tsx` es enorme (~12.7k líneas) — sin modularizar (deuda técnica, no urgente).
- Guía de Remisión: RUC/dirección del cliente salen en blanco (los `customers` no guardan esos campos); si se requieren, habría que añadirlos al modelo de clientes.
- Sacos especiales sin peso ("Saco Negro (Polvillo)", "Saco Usado (Arrocillo)") NO se descuentan al despachar (el mapeo es por peso → "Saco N LB"). Si se requiere, definir mapeo presentación→tipo para esos.
- Nota de pruebas en vivo: la sesión del navegador in-app se limpia al reabrir el preview; para pruebas por API se puede generar un JWT admin con `signToken` (secreto en `backend/src/config/env.ts`) y llamar `http://localhost:4000/api/v1/...`. La extensión "Claude en Chrome" no está conectada (no se puede manejar el Chrome real del usuario).

## 5. PRÓXIMO PASO
Sin tarea pendiente comprometida. Opcional: verificar en vivo los rediseños de UI de hoy (Báscula inbox, Selección, y los modales reubicados en Inventario/Producción/Configuración) — no verificados en navegador aún, solo typecheck/build. Luego preguntar al usuario la siguiente funcionalidad.

## 6. ARCHIVOS IMPORTANTES
- `web-admin/src/App.tsx` — TODO el frontend (tabs por `activeTab === "..."`; Config por `configSubTab`; Caja por `cajaSubTab`).
- `backend/src/routes/modules/`: `orders.ts` (pedido/despacho/guía), `receivable.ts` (CxC), `cash.ts` (payables/pagos), `equipment.ts` (mantenimiento + categorías), `settings.ts` (tarifas empaque + config), `cobros.ts` (matriz→socio), `sacks.ts` (inventario + compra múltiple de sacos).
- `backend/src/services/`: `cargo-empaque.ts`, `cuentas-vinculadas.ts` (espejo).
- `backend/src/auth/require-auth.ts` — permisos por accionista (`WRITE_MODULES_BY_PREFIX`).
- `backend/src/routes/modules/dashboard.ts` — `/dashboard/panel` (KPIs + `per_accionista` + `*_por_acc`); el filtro de las 7 tarjetas se hace en el frontend (`PanelIntegral`).
- `database/migrations/` — últimas: `20260822_matriz_packaging_rates.sql`, `20260823_maintenance_categories.sql`, `20260824_guia_remision.sql`.
- Memoria del asistente: `C:\Users\Usuario\.claude\projects\C--Users-Usuario-...-BASCULA-ERP\memory\` (MEMORY.md + notas).

## 7. DECISIONES TOMADAS (no volver a preguntar)
- Reutilizar flujos existentes en vez de reconstruir (evita doble contabilidad).
- Catálogos dinámicos (categorías caja/mantenimiento, tarifas) viven en BD; se editan desde el propio front.
- "Pendiente" = CONFIRMED+balance (no tocar el enum).
- Impresión = `window.open` con HTML limpio (equivale a @media print, patrón del ERP).
- Trabajar/commitear en `main` (no en el worktree).
- Modal de cuentas unificado (`CuentaDetalleModal`) para Cobrar y Pagar.
- Guía de Remisión y KPIs del dashboard: filtrar/derivar en el FRONTEND cuando el payload ya trae los datos por accionista (no duplicar en backend). Nº de guía vía secuencia `guia_remision_seq` (formato `001-001-…`).
- Servicio de pilado y Costo Operativo son de la MATRIZ; un socio los ve en $0.
- Compras "carrito" (sacos): frontend acumula en estado local y envía `items[]`; backend hace 1 solo egreso consolidado en la misma transacción. Endpoint retrocompatible con el formato de 1 ítem.
- Patrón de limpieza de vistas: mover config/herramientas de uso no diario a modales (botón secundario en la cabecera) o a Configuración; dejar la vista principal enfocada en su tarea central. Las tarifas globales viven en Configuración→Tarifas.
- En Báscula se dejó a propósito la "Corrección puntual de accionista de materia prima" (no se pidió moverla). Si se quiere quitar, avisar.

## 8. ADVERTENCIAS (revisar dependencias antes de tocar)
- `cuentas-vinculadas.ts` (espejo CxC↔CxP): tocarlo mal desincroniza libros y cajas entre socios.
- `orders.ts /:id/deliver`: transacción atómica (venta + cargo empaque + descuento de sacos de la matriz + saldo de CxC). No romper el orden.
- `sack_inventory` es tabla ÚNICA (de la matriz), sin accionista_id: NO agregarle accionista_id sin revisar `descontarSacosDelDespacho()` y la compra de sacos, que asumen inventario global.
- Enum `document_status`: no agregar 'PENDING' ni cambiar valores.
- Estados de `sales_orders` (PENDING/DELIVERED/CANCELLED): CHECK constraint, no renombrar a español.
- `equipment_maintenance`: guarda textos, no FKs a categorías — no convertir a FK sin migrar histórico.
- Migraciones: siempre aditivas; nunca DROP/TRUNCATE de tablas con datos.

---

## INSTRUCCIÓN PARA LA PRÓXIMA SESIÓN
> Pegar esto al iniciar Claude Code:

```
Continuemos el proyecto BASCULA-ERP. Antes de nada, lee SOLO el archivo
PROJECT_CONTEXT.md (raíz del repo) y NO analices todo el código.
Trabajamos y desplegamos desde el checkout main (rama main), commit+push por fase.
Recuérdame el "PRÓXIMO PASO" del archivo y espera mi confirmación antes de codear.
```
