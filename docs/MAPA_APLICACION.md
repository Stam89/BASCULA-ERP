# Mapa funcional y tecnico de BASCULA-ERP

Actualizado: 2026-09-26

## 1. Arquitectura ejecutable

```text
Tablet Android (offline-first) -- API directa/Firebase --+
                                                       |
Navegador React/Vite ----------- /api/v1 -------------+--> Express/TypeScript --> PostgreSQL
                                                       |
Impresoras termicas <----------- datos ESC/POS --------+
```

- `backend/`: API, reglas de negocio, autorizacion, transacciones, documentos y sincronizacion.
- `web-admin/`: ERP web. React 18, Vite y un modulo Campo cargado con `React.lazy`.
- `android-app/`: operacion de Bascula, SQLite local, sincronizacion en segundo plano e impresion.
- `database/schema.sql`: base instalable; `database/migrations/`: evolucion aditiva (151 migraciones).
- `uploads/`: comprobantes protegidos por sesion o URL firmada temporal.
- `docs/`: instalacion, respaldo, operacion, seguridad y este mapa.

El backend sirve el panel compilado y escucha en `0.0.0.0:4000`, por lo que la misma instalacion atiende al servidor y a los equipos de la red local.

## 2. Seguridad y separacion por socio

Cadena de una peticion normal:

1. `auditMiddleware` registra escrituras exitosas.
2. `requireAuth` valida el JWT.
3. `resolveAccionista` valida `X-Accionista-Id` contra `user_accionistas`.
4. `enforceModulePermissions` relee rol y permisos desde PostgreSQL en cada escritura.
5. La ruta filtra registros por `accionista_id`/`socio_id` y ejecuta su transaccion.

Excepciones intencionales:

- `/api/v1/auth`: inicio de sesion y bootstrap.
- `/api/v1/tickets`: canal historico de la app movil.
- `/api/v1/external`: API key propia.
- `/api/bascula/sync`: sincronizacion directa por WiFi.
- Agricultores/personas son catalogo global; fomentos, lotes y operaciones conservan el socio propietario.

Los administradores pueden operar todos los modulos. Los operadores usan permisos `VER` o `EDITAR` por socio. Las escrituras de Bascula, Secadoras, Produccion, Inventario, Ventas, Compras, Caja, Liquidaciones, Fomentos, Nomina y demas modulos estan asociadas a su permiso backend.

## 3. Mapa funcional

| Area web/app | Backend principal | Datos o responsabilidad |
|---|---|---|
| Dashboard | `dashboard.ts` | Indicadores del socio activo |
| Bascula Android/web | `mobile-tickets.ts`, `bascula-sync.ts`, `weighing-tickets.ts`, `lots.ts` | Tickets, identidad anti-duplicado, lotes, pesos y traspasos |
| Secadoras y Tendal | `process-flow.ts` | Llenado, horarios, combustible, servicio/propio y cierres |
| Produccion/Pilado | `processing.ts` | Cascara consumida, productos, subproductos, mermas y maquila |
| Inventario | `inventory.ts`, `sacks.ts`, `products.ts` | Movimientos, existencias derivadas, sacos y catalogo |
| Seleccion/Envejecido | `selection.ts` | Envios, proceso externo, reingreso, merma y transformacion |
| Ventas | `sales.ts`, `orders.ts`, `guias.ts`, `customers.ts` | Venta, despacho, guias, credito y consumo de stock |
| Compras | `purchases.ts`, `suppliers.ts` | Compras, proveedores e ingreso de inventario |
| Caja | `cash.ts`, `expenses.ts`, `costos.ts` | Apertura/cierre, ingresos, egresos, fondos y contra-asientos |
| Por cobrar/pagar | `receivable.ts`, `finance.ts` | Saldos, cobros, pagos y estados financieros |
| Liquidaciones | `liquidations.ts`, `advances.ts` | Lotes, precio, descuentos, anticipos, cosechadoras y neto |
| Fomentos | `fomentos.ts` | Capital, entregas, intereses, cruces y estado de cuenta |
| Agricultores | `farmers.ts` | Catalogo global y alias anti-duplicidad |
| Nomina | `labor.ts`, `admin-payroll.ts` | Planta, secador, administrativo, anticipos y pagos |
| Cuadrilla | `cuadrilla.ts` | Actividades, tarifas por socio y pagos automaticos |
| Servicio de pilado | `pilado.ts`, `cobros.ts` | Servicios, cargos y cobros |
| Reportes/Auditoria | `reports.ts`, `audit.ts`, `documents.ts` | Reportes administrativos, trazabilidad e impresion |
| Configuracion | `settings.ts`, `equipment.ts` | Empresa, tarifas, secuencias, equipos, respaldo y restauracion |
| Transporte y Cosechadora | `campo.ts`, `services/campo-*` | Partes diarios, flota, servicios, caja, CxP y cruces con ERP |

## 4. Flujos que conectan los modulos

### Arroz propio

`Ticket Bascula -> Lote -> Secadora/Tendal -> Produccion -> Inventario -> Venta/Despacho -> Caja o CxC`

- La identidad del ticket se protege entre canal Android, Firebase y API directa.
- Secado conserva el tipo original y Produccion decide inventario segun propiedad/servicio.
- Inventario usa movimientos como fuente de verdad; no se debe editar el saldo calculado.

### Servicio a terceros

`Ticket SOLO SECADO o SECADO_PILADO -> Secado -> CxC de servicio -> Pilado opcional -> Cobro`

- El producto de servicio no debe convertirse en stock propio.
- Las tarifas de servicio y las tarifas de pago de personal son conceptos separados.

### Liquidacion de agricultor

`Lotes -> Bruto -> Flete/Cosechadora/Secado/otros descuentos -> Anticipos -> Neto -> CxP/Pago`

- Partes diarios de Campo pueden alimentar flete y cosechadora.
- El backend vuelve a calcular importes criticos; el frontend no es fuente contable.

### Nomina

`Actividad operativa -> Registro automatico/manual -> Resumen semanal/quincenal -> Pago desde caja`

- Secador: lunes a viernes; fin de semana no genera guardiania ni secada.
- Cuadrilla y personal administrativo mantienen historial separado de Caja.

## 5. Controles de integridad existentes

- Transacciones PostgreSQL en cierres, liquidaciones, caja, ventas y produccion.
- SQL parametrizado y validacion Zod en los endpoints.
- `inventory_movements` como libro de inventario y `inventory_stock` como saldo derivado.
- Reversion de Caja mediante contra-asiento, sin borrar la historia contable.
- Migraciones idempotentes y `schema_migrations`.
- `npm run preflight` comprueba migraciones, salud, duplicados de tickets, stock negativo, tipos de producto y cajas abiertas.
- SQLite y WorkManager en Android permiten trabajar y reintentar cuando falla la red.

## 6. Resultado de la revision 2026-09-26

Estado verificado:

- Backend compila y sus 61 pruebas pasan.
- Frontend compila; ESLint tiene 0 errores y 166 advertencias historicas.
- Base real al dia, sin tickets duplicados ni inventario negativo.
- `/health` responde correctamente.

Correcciones aplicadas durante la revision:

1. Caja ahora valida el socio activo al consultar, cerrar, exportar y modificar una caja o movimiento.
2. Apertura de Caja bloqueada atomicamente: no se pueden abrir dos cajas simultaneas para un mismo socio por doble clic o dos equipos.
3. Liquidaciones ahora validan el socio activo al editar, desbloquear, aplicar anticipos, anular y eliminar.
4. Las rutas de guias, nomina administrativa, catalogos y el alias `/productos` ya respetan permisos de escritura.
5. Se elimino una carga duplicada de Nomina al entrar en la pestana.
6. Preflight alerta si algun socio llega a tener mas de una caja abierta.

## 7. Deuda tecnica controlada

No son fallas operativas inmediatas, pero deben guiar las siguientes etapas:

- `web-admin/src/App.tsx` supera 21.000 lineas. Dividirlo debe hacerse modulo por modulo, con pruebas visuales y funcionales; una reescritura total seria riesgosa.
- El bundle web principal es grande. El modulo Campo ya usa carga diferida; los siguientes candidatos naturales son Configuracion, Reportes y Nomina.
- Hay 166 advertencias ESLint historicas. Deben reducirse gradualmente, evitando limpiezas masivas junto con cambios funcionales.
- Algunas tablas se aseguran todavia desde el runtime (`ensure*`). La direccion correcta es migrarlas de forma gradual a SQL versionado.
- El canal Firebase se conserva como respaldo, pero la API directa debe seguir siendo el camino principal para reducir lecturas y demoras.
- Las rutas financieras criticas tienen buena validacion, pero faltan pruebas de integracion HTTP con una base temporal; hoy se cubren con unit tests, compilacion y preflight sobre la base real.

## 8. Verificacion recomendada antes de cada entrega

```powershell
cd backend
npm run build
npm test
npm run db:migrate
npm run preflight

cd ..\web-admin
npm run build
npm run lint

Invoke-WebRequest -UseBasicParsing http://localhost:4000/health
git diff --check
git status --short
```

Nunca probar finalizaciones, anulaciones, pagos o cierres con registros reales. Para esos flujos se usan pruebas unitarias, simulacion con `ROLLBACK` o datos expresamente creados para prueba.
