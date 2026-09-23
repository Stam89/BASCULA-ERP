# BASCULA-ERP - memoria compacta

Actualizado: 2026-09-22

## Inicio rapido

- Repositorio: `C:\Users\Usuario\OneDrive\Documentos\GitHub\BASCULA-ERP`
- Rama de trabajo: `main`
- Estado esperado: limpio.
- Ultimo cambio funcional: catalogo de productos editable en Inventario (commit de esta sesion).
- ERP local: `http://localhost:4000/`
- Backend: Node/Express/TypeScript/PostgreSQL en `backend/`.
- Frontend: React/TypeScript/Vite en `web-admin/`.
- Android Bascula: `android-app/` (el proyecto historico tambien existe en Android Studio fuera de este repo).

## Regla de trabajo

Antes de cualquier cambio:

```powershell
git status --short
git log -3 --oneline
```

- Trabajar sobre el estado actual; no borrar ni revertir cambios de otra sesion.
- No finalizar, cancelar ni alterar lotes/tickets reales durante pruebas.
- Las migraciones deben ser aditivas e idempotentes.
- Hacer cambios pequenos, compilar, probar y luego commitear.

## Verificacion habitual

```powershell
cd backend
npm run build
npm test
npm run db:migrate

cd ..\web-admin
npm run build
```

`npm run lint` del frontend ya no tiene errores; conserva numerosos warnings historicos (`any`, variables/componentes no usados). El ultimo cambio no agrego errores de compilacion.

Salud del servidor:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:4000/health
```

## Estado funcional reciente

### Permisos: sub-pestañas granulares por accionista (2026-09-22)

- El sistema YA era multi-tenant por accionista (`user_accionistas.allowed_modules[]`, guard `visibleTabs` por accionista activo + redirect a Dashboard). NO se rehízo el esquema.
- NUEVO (aditivo, sin migración): control de sub-pestañas. Se guardan como claves `SUB:<Módulo>:<sub>` en el MISMO `allowed_modules[]` (junto a `EDIT:`/`PERM:`), vía el `PUT /auth/users/:id/accionistas` existente.
- Frontend `App.tsx`: const `SUB_TABS` (Seleccion: nuevo/proceso/historial; Nomina: pagos/cuadrilla/historial/sueldo-admin), helper `subTabKey`, guard `puedeVerSubTab(mod,sub)`.
- REGLA DE COMPATIBILIDAD: si el usuario no tiene ninguna `SUB:<mod>:*` marcada, ve TODAS (histórico); admin ve todo. Solo se limita cuando el admin marca al menos una.
- Editor "🔐 Accionistas y permisos": sub-filas anidadas (↳) con checkbox por accionista (`toggleSub`).
- Build tsc+vite limpio. NO verificado con login E2E (faltan credenciales locales en el navegador de prueba).

### Seleccion y Envejecimiento

Implementado en `be4dff5`:

- UI separada en tabs: Nuevo Envio, En Proceso e Historial.
- Al completar un lote se elige el producto principal que reingresa.
- Se pueden agregar subproductos/rechazo con cantidades exactas.
- Cada salida crea un movimiento de inventario independiente.
- La merma es `QQ enviados - suma de productos recibidos`.
- Frontend y backend impiden recibir mas QQ de los enviados.
- Se validan productos activos, tipos permitidos y duplicados.
- Migracion aplicada: `20261022_producto_arroz_envejecido.sql`.
- Productos activos: `ARROZ-ENVEJECIDO` y `ARROZ-PILADO-011-SEL`.
- Al verificar habia 1 lote real `IN_PROCESS`; no fue modificado.
- Build backend/frontend correcto y 33/33 pruebas backend aprobadas.

### Catalogo de Productos / Inventario

Implementado el 2026-09-21:

- Modal `Inventario -> Catalogo de Productos` permite crear productos.
- Backend acepta `POST /api/v1/products` y alias `POST /api/v1/productos`.
- El formulario pide codigo, nombre, tipo (`FINISHED_GOOD`, `BYPRODUCT`, `RAW_MATERIAL`) y unidad.
- Codigos/unidades se normalizan en mayusculas.
- Si el producto existia inactivo, se reactiva; si ya existe activo, devuelve conflicto.
- El panel de Inventario clasifica por `product_type`, no por prefijo de codigo.
- `ARROZ-ENVEJECIDO` aparece en `Stock producto terminado` con `0.00 QQ` aunque aun no tenga movimientos.
- Migracion aplicada: `20261023_catalogo_productos_creacion.sql`, idempotente, asegura `ARROZ-ENVEJECIDO`.
- Verificaciones pasadas: backend build, backend tests 33/33, `db:migrate`, frontend build y `/health`.

### Envejecido por socio y tarifario

Implementado el 2026-09-21:

- Nueva migracion `20261024_envejecido_por_socio_y_tarifario.sql`.
- `accionistas.modulo_envejecido_habilitado` controla si un socio ve/usa Envejecido.
- Se mantiene sincronizado con `puede_envejecer` para compatibilidad.
- Stalyn queda habilitado automaticamente si el nombre o codigo contiene `stalyn`.
- El tarifario de servicios acepta `SELECCION` y `ENVEJECIMIENTO`.
- Seleccion usa primero tarifa personalizada del socio activo desde `tarifario_servicio`; si no existe, usa `selection_rates`.
- Inventario/Catalogo/Seleccion ocultan productos y textos de Envejecido cuando el socio activo no tiene el flag.
- Verificaciones pasadas: backend build, backend tests 33/33, `db:migrate`, frontend build y `/health`.

### Configuración Multi-Tenant Ligera

Implementado el 2026-09-21:

- Nueva migración `20261025_config_multi_tenant_ligera.sql`.
- `app_settings` y `labor_rates` ahora aceptan `socio_id` nullable.
- `socio_id IS NULL` queda como registro Maestro/Fallback, conservando la configuración existente.
- Al consultar configuración o tarifas se devuelve primero la fila del socio activo; si no existe, se usa Maestro.
- Al guardar Parámetros de Planta o Tarifas de Nómina/Cuadrilla para un socio, se clona Maestro y luego se guarda la fila propia del socio.
- Matriz sigue usando Maestro para evitar duplicar configuración global de empresa/secuenciales.
- Producción usa tarifas de nómina del socio del lote al generar pagos automáticos.
- Cobro automático/manual de secado intenta usar tarifa del socio correspondiente cuando el flujo identifica el socio.
- Frontend recarga configuración/tarifas al cambiar el Socio Operativo activo.
- Verificaciones pasadas: backend build, backend tests 33/33, `db:migrate`, frontend build y `/health`.

Blindaje posterior:

- Guardados de Parámetros de Planta y Tarifas de Nómina/Cuadrilla envían `accionista_id` explícito además del header.
- Backend prioriza ese `accionista_id` y no actualiza Maestro si la petición corresponde a un socio específico.
- Si no puede resolver el socio activo, rechaza el guardado en vez de caer al registro global.

### Inventario Granel vs Marcas

Implementado el 2026-09-21:

- Nueva migración `20261026_packaged_goods_inventory.sql`.
- `PACKAGED_GOOD` separa marcas/empacados de producto terminado a granel.
- Se agrega el tipo `PACKAGED_GOOD` para marcas/presentaciones comerciales.
- Productos como Conejo, Flor, Lira Azul, Lira Verde, Oso y `0.11 Selectado` pasan a `PACKAGED_GOOD`.
- `Stock producto terminado` muestra solo granel/base (`FINISHED_GOOD`).
- Nueva tarjeta/tabla `Stock marcas / empacados` muestra `PACKAGED_GOOD`.
- Ventas, selección/envejecimiento y compras a clientes siguen aceptando productos empacados donde corresponde.
- Verificaciones pasadas: backend build, backend tests 33/33, `db:migrate`, frontend build y `/health`.

### Cuadrilla Multi-Tenant por Socio

Implementado el 2026-09-21:

- Nueva migración `20260921_cuadrilla_activities_multi_tenant.sql`.
- `cuadrilla_activities.socio_id` permite tarifas propias por socio sin tocar el tarifario maestro.
- Las actividades existentes quedan como maestro (`socio_id IS NULL`).
- `GET /cuadrilla/activities` retorna maestro + overrides del socio activo.
- `POST/PUT /cuadrilla/activities` crea/actualiza override si el contexto es un socio; Matriz sigue editando maestro.
- Registros manuales de Nómina, pagos automáticos de Secadoras, Tendal y Ventas usan la tarifa efectiva del socio/lote.
- Frontend envía `accionista_id` explícito al crear/editar/ocultar actividades de Cuadrilla.
- Verificaciones pasadas: backend build, backend tests 33/33, `db:migrate`, frontend build.

### Inventario: consumo por lotes

Implementado el 2026-09-21:

- Se reforzó `backend/.env` local con una `JWT_SECRET` fuerte desde `.jwt-secret`; no se commitea por estar ignorado.
- Nuevo helper `backend/src/services/inventory-consume.ts`.
- Ventas directas, preparación de pedidos y envíos a Selección/Envejecimiento consumen inventario por lotes con saldo positivo antes de usar `lot_id = NULL`.
- Esto evita crear nuevos negativos visuales en `inventory_stock` cuando el stock existe en lotes específicos.
- Los negativos antiguos detectados en `ARROZ-PILADO-011` (`BASCULA ERP` y `STALYN`, `lot_id = NULL`) fueron limpiados con la migración `20260921_rebalance_inventory_null_lots.sql`.
- La reparación histórica insertó 4 movimientos con `reference_type='repair_lot_negative_20260921'`, neto total `0`, dejando `inventory_stock` sin saldos negativos.
- Verificaciones pasadas: backend build, backend tests 33/33, `db:migrate`, frontend build, `preflight` sin errores críticos y `/health`.

### Preflight con diagnóstico de datos

Implementado el 2026-09-21:

- `backend/src/scripts/preflight.ts` ahora revisa también la base de datos real, sin modificar información.
- Valida conexión PostgreSQL, existencia única de configuración maestra, existencia única de tarifario maestro, duplicados de actividades de Cuadrilla por socio, saldos negativos en `inventory_stock` y clasificación principal de marcas como `PACKAGED_GOOD`.
- También valida duplicados lógicos de tickets móviles de Báscula por negocio/modo/número y que ningún ingreso ERP quede enlazado a más de un ticket móvil.
- Valida que existan los índices críticos de blindaje para configuración multi-tenant, Cuadrilla por socio y tickets de Báscula; si faltan, indica ejecutar `npm run db:migrate`.
- Valida que no existan migraciones pendientes comparando `database/migrations/*.sql` contra `schema_migrations`.
- Si `schema_migrations` no existe todavía, `preflight` lo reporta como migraciones pendientes en vez de fallar con un error técnico.
- Si hay migraciones pendientes, muestra los primeros nombres y detiene los chequeos profundos para evitar errores secundarios por tablas/índices aún no creados.
- Nuevo acceso `VERIFICAR-ERP.bat` en la raíz del repo para ejecutar `npm run preflight` con doble clic, sin modificar datos.
- `VERIFICAR-ERP.bat` conserva el código de salida de `preflight`: si hay errores críticos muestra `ATENCION: NO OPERAR TODAVIA`.
- `iniciar-sistema.ps1` ejecuta `preflight` después de conectar PostgreSQL y antes de levantar backend/panel; si falla, no abre la app y guarda el detalle en `logs/preflight.log`.
- Verificaciones pasadas: backend build, backend tests 33/33, `db:migrate`, frontend build y `preflight` sin errores críticos.

### Blindaje de tickets Báscula

Implementado el 2026-09-21:

- Nueva migración `20261027_blindar_tickets_bascula_unicos.sql`.
- Agrega índice único parcial para impedir duplicados lógicos en `mobile_synced_tickets` por negocio Firebase/dispositivo, modo y número de ticket normalizado.
- Agrega índice único parcial para impedir que dos tickets móviles apunten al mismo `weighing_ticket_id`.
- `preflight` usa la misma normalización de número que el índice.
- Verificaciones pasadas: backend build, backend tests 33/33, `db:migrate`, frontend build y `preflight` sin errores críticos.

### Limpieza de lint frontend

Implementado el 2026-09-21:

- Corregidos los 2 errores `no-useless-escape` en `web-admin/src/App.tsx`.
- `npm run lint` pasa con 0 errores y 157 warnings historicos.
- `web-admin npm run build` pasa correctamente.

### Pulido visual operativo

Implementado el 2026-09-21:

- Cambio CSS-only en `web-admin/src/styles.css`; no modifica logica, endpoints ni datos.
- Se mejoro la lectura de paneles, formularios, tablas, acordeones y botones.
- Los encabezados de panel tienen acento visual discreto y separacion mas clara.
- Las filas de tablas tienen zebra sutil y hover para facilitar revision operativa.
- Los controles deshabilitados/solo lectura quedan visualmente diferenciados.
- En pantallas pequenas se ajustan topbar, paneles y botones para mantener la interfaz limpia.
- Verificaciones pasadas: frontend build, backend build, backend tests 33/33, `db:migrate`, `preflight` sin errores criticos y revision visual local en `http://localhost:4000/`.

### Cambios inmediatamente anteriores

- `1b85b26`: catalogo de productos editable en Inventario.
- `cb5096d`: saldo inicial de caja integrado en movimientos.
- `3d9f167`: clientes externos en Partes Diarios.
- `129b4ff`: proteccion contra tickets duplicados en Bascula.

Consultar detalles antiguos solo cuando sean necesarios:

```powershell
rg -n "PALABRA_CLAVE" PROJECT_CONTEXT.md
git show <commit>
```

## Servidor local

El backend compilado se inicia desde `backend/` con:

```powershell
node dist/server.js
```

Si se reinicia desde PowerShell, usar `Start-Process` oculto. Confirmar primero que puerto/PID esta escuchando para no levantar dos procesos.

## Frase recomendada para la proxima sesion

`Continua BASCULA-ERP. Lee AGENTS.md y NEXT_SESSION.md, revisa git status y el ultimo commit. Luego realiza este cambio: [DESCRIBIR CAMBIO]. No leas PROJECT_CONTEXT.md completo salvo que necesites buscar un antecedente concreto.`
