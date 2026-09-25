# BASCULA-ERP - memoria compacta

Actualizado: 2026-09-24

## Inicio rapido

- Repositorio: `C:\Users\Usuario\OneDrive\Documentos\GitHub\BASCULA-ERP`
- Rama de trabajo: `main`
- Estado esperado: limpio.
- Ultimo cambio funcional: neto de Liquidaciones corregido por lote y comprobante con descuentos desglosados.
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

### Fix: finalizar Tendal atascado + CxC de servicio (2026-09-24)

- Causa: desde que Guardar/Finalizar se separaron con el flag `finalize`, el PUT de edicion del Tendal enviaba solo `dry_end_at` sin `finalize` -> el backend guardaba la hora pero dejaba el tendal `IN_PROGRESS`; por eso no corrian `autoCobrarSecadoServicio` (CxC) ni el pago de cuadrilla. El alta (`/drying-tendal`) si estaba adaptada.
- `submitTendal` (App.tsx) ahora envia `finalize`, exige hora de inicio, rechaza hora final anterior al inicio y verifica que la respuesta venga `COMPLETED` (si no, error y conserva la edicion).
- El cartel pegado era el mensaje GLOBAL de cabecera (`setMessage("Editando secado en Tendal ...")` en `editDryingReport`); `limpiarTendal` ahora lo devuelve a "Listo".
- Backend `updateDryingReport`: al finalizar rechaza hora final anterior a la de inicio (400).
- Rollback: el PUT corre en `inTransaction` y la CxC NO usa savepoint -> si falla, nada queda finalizado.
- `updateDryingReport` se exporta para verificacion transaccional.
- Verificado en BEGIN...ROLLBACK sobre el tendal real atascado `00001-23-09-26-S` (SOLO SECADO, CEYRO, 75.40 QQ): sin finalize reproduce el bug; con finalize queda COMPLETED y crea CxC $113.10; re-finalizar no duplica. Ese tendal sigue En proceso con hora fin 16/09 < inicio 23/09: el usuario debe corregir la hora y finalizarlo.
- Nota para pruebas con DB: precargar `ensureLaborTables()` antes de BEGIN (como server.ts) o el DDL perezoso se traba con los locks de la transaccion.
- Verificaciones: backend build, 44/44 tests, frontend build.

### Neto financiero y comprobante de Liquidaciones (2026-09-24)

- Corregida la causa del neto inflado: los descuentos generales ya no se pierden al superar el bruto del primer ticket; se reparten entre todas las filas del mismo lote.
- El backend aplica primero flete/cosechadora/fomento/otros y solo descuenta anticipos sobre el saldo restante, evitando doble consumo del bruto.
- Pruebas monetarias cubren el caso real `$2747.52 - $2163.22 = $584.30`, descuentos superiores al bruto y anticipos concurrentes.
- La agrupacion visual suma el `discount_breakdown` de todas las filas, por lo que el comprobante muestra el flete completo.
- El comprobante incluye filas claras `Descuento de Cosechadora`, `Total de Descuento de Flete`, `TOTAL DESCUENTOS` y `NETO A PAGAR`.
- Migracion `20261031_reparar_neto_liquidaciones_por_lote.sql`: solo repara lotes confirmados, sin anticipos ni pagos reales; no toca CxP auxiliares de flete/cosechadora.
- Caso real JUNIOR JIMENEZ reparado: bruto `$2747.52`, descuentos `$2163.22`, neto y pendiente `$584.30`.
- Verificaciones: backend/frontend build, 41/41 tests, lint con 0 errores, migraciones al dia, preflight sin errores y revision visual en `http://localhost:4000/`.

### Liquidaciones agiles + cosechadoras multiples (2026-09-24)

- `Nueva liquidacion` usa un desplegable compacto con casillas para marcar varios ingresos y agregarlos en bloque.
- Cada ingreso conserva su fila, QQ, precio y flete independiente; precio y tarifa de la primera fila siguen heredandose sin copiar los QQ.
- Nueva migracion `20261029_liquidacion_cosechadoras_multiples.sql` agrega `campo_partes.farmer_id` y `liquidation_harvest_details` sin alterar liquidaciones historicas.
- `20261030_backfill_partes_liquidacion_cosechadora.sql` concilia solo coincidencias historicas unicas; vinculo el Parte COS.10 (76 QQ, $2.25/QQ) con su descuento existente de $171, evitando que vuelva a sugerirse.
- Los Partes Diarios de cosecha se sugieren por agricultor y ventana operativa de los tickets seleccionados; un parte ya aplicado no puede repetirse.
- La seccion Cosechadora admite varias maquinas, cada una con QQ, precio/QQ, prestador y subtotal; tambien permite agregar un prestador externo manual.
- El total combinado alimenta el mismo `discount_breakdown.cosechadora`, por lo que se conserva la matematica de bruto, descuentos, fomentos y neto.
- Backend crea un cruce Campo por cada maquina propia o una CxP separada por cada tercero. El formato singular anterior sigue aceptado.
- Al anular se liberan los partes si no existe un pago real a un tercero; con pago real se conserva la traza para evitar doble cobro.
- Partes nuevos/editados guardan el `farmer_id` global y los tickets se validan contra el socio operativo activo.
- Revision visual sin escrituras: selector, contador, alta en bloque y fila de maquina externa verificados en una pestana separada.
- Verificaciones: migracion aplicada, backend/frontend build, 38/38 tests, lint con 0 errores y preflight sin errores criticos.

### Empaque unico de botada + confirmacion de cierre (2026-09-24)

- Los tuneles mecanicos ya no muestran ni envian `Empaque de recepcion`; usan unicamente `Empaque de botada (vaciado)` al crear y editar.
- El alta de informes guarda `botada_empaque` y `botada_sacos` desde el primer guardado, con TULAS/a granel como valor por defecto.
- Las columnas historicas de recepcion se conservan en base de datos y API por compatibilidad con Nomina y con el modelo interno del Tendal; no se hizo una migracion destructiva.
- `Finalizar este tunel` abre primero una confirmacion bloqueante que explica el efecto sobre inventario/facturacion; Cancelar no escribe datos.
- Tras confirmar se mantiene intacto el flujo existente: validacion de horas, cierre individual y solicitud de combustible solo si es el ultimo tunel activo del motor.
- Revision visual sin escrituras en una pestana separada: Motor 1 y Motor 2 muestran solo el empaque de botada y mantienen la multiseleccion de tickets.
- Verificaciones: backend build, 38/38 tests, frontend build y lint con 0 errores (warnings historicos).

### Secadoras aisladas al editar + Caja condicional (2026-09-24)

- Al editar un secado mecanico, la UI muestra solo el motor y el tunel fisico elegido; no renderiza Tendal ni otros motores/tuneles.
- Si el tunel contiene partidas internas PROPIO/SOLO SECADO, ambas permanecen juntas porque corresponden a la misma carga fisica.
- Al entrar a un tunel se limpia cualquier estado de edicion residual del Tendal.
- Apertura de Caja incorpora `MIXTO`: Efectivo muestra solo saldo en efectivo, Banco solo saldo bancario y Mixto ambos.
- Frontend y backend fuerzan a cero cualquier saldo oculto para impedir que se guarde un valor residual.
- El resumen financiero reconoce cajas mixtas sin duplicar el saldo inicial; movimientos historicos sin medio de pago se conservan en efectivo por compatibilidad.
- Subcategoria solo aparece para las categorias `Gastos Generales` y `Servicios Basicos`; cambiar de categoria limpia el valor oculto.
- Verificacion visual sin escrituras en una pestaña separada: Caja cambio correctamente entre los tres tipos y la edicion del Tunel 3 mostro solo Motor 2/Tunel 3.
- Verificaciones: backend build, 38/38 tests, frontend build y lint con 0 errores (warnings historicos).

### Nomina Secador al iniciar + multiseleccion en Tendal (2026-09-24)

- Regla #1: `autoGenerarPagoSecador` (process-flow.ts) registra la jornada del Secador desde que el secado INICIA (hay `dry_start_at`), no solo al finalizar.
- Un registro por secador y dia: al iniciar queda la guardiania; cada tunel finalizado suma su $/tunel; otra maquina el mismo dia no duplica.
- Reubicar: si se corrige la fecha o el secador de una corrida iniciada, la fila PENDING huerfana (sin tuneles que la respalden en su dia) se mueve al nuevo dia/secador conservando descuentos, o se fusiona. Nunca toca filas con respaldo ni PAID.
- `POST /drying/motor/:motor/sync-run` tambien llama al auto-pago para reubicar al corregir la corrida por motor.
- La funcion ahora se exporta (para verificacion transaccional).
- Verificado contra el esquema real en BEGIN...ROLLBACK: iniciar, 2a maquina, finalizar, corregir fecha, corregir secador, sin inicio; 0 filas residuales.
- Regla #5 completada: Secado en Tendal usa la misma multiseleccion que los tuneles (`dryingEntryMultiPick`/`dryingPickerOpen` con clave `TENDAL`).
- Con esto las 8 reglas del pilotaje de Secadoras quedan cubiertas (las demas ya estaban en las entradas del 2026-09-23).
- Verificaciones: backend build, 38/38 tests, frontend build.

### Secadoras: cierre por tunel y combustible solo al apagar motor (2026-09-23)

- El formulario de combustible permanece oculto durante el llenado y la edicion normal.
- `Finalizar este tunel` usa `POST /process-flow/drying/tunnel-finalize` y evalua todos los socios del motor, no solo el socio visible.
- Si queda otro tunel fisico activo, cierra el actual sin pedir combustible.
- Si es el ultimo tunel, conserva sus sublotes en proceso, abre el modal y exige combustible antes de apagar el motor.
- Los sublotes PROPIO/SOLO SECADO del mismo tunel comparten horas y se cierran juntos; el reparto de combustible sigue siendo proporcional.
- Cierres simultaneos del mismo motor usan bloqueo transaccional para evitar combustible duplicado.
- El selector multiple de tickets queda colapsado por defecto y mantiene badges PROPIO/SOLO SECADO.
- Verificacion visual sin escrituras: Motor 1 tenia Tunel 1 (CEYRO) y Tunel 2 (ROVINSON); ambos fueron detectados globalmente.
- Verificaciones: backend build, 38/38 tests, frontend build, lint sin errores y preflight sin errores criticos.

### Secadoras: hora de inicio compartida por motor (2026-09-23)

- Crear un tunel nuevo ya heredaba la hora inicial de la corrida activa.
- Ahora, al guardar o corregir `Hora secado inicio` en cualquier tunel mecanico, el backend la propaga automaticamente a todos los reportes pendientes del mismo motor, incluso si pertenecen a socios distintos.
- La operacion usa bloqueo transaccional por motor para evitar correcciones simultaneas inconsistentes.
- Cada `Hora secado final` permanece independiente; solo se recalcula la duracion de cada tunel contra su propia hora final.
- La trazabilidad JSON de los reportes enlazados conserva la hora inicial y duracion sincronizadas.

### Secadoras: guardado parcial, multiseleccion y carga mixta (2026-09-23)

- Se corrigio la causa real del "error inesperado": consultas de automatizacion de Cuadrilla/Secador usaban `created_at` ambiguo y abortaban la transaccion al guardar.
- El auto-pago de Cuadrilla usa savepoint; un fallo complementario ya no deja inutilizable la transaccion principal.
- Guardar y finalizar son intenciones separadas mediante `finalize`: el borrador acepta horas nulas/vacias; finalizar exige inicio y fin.
- El selector de ingresos de Secadoras permite marcar varios tickets con checkboxes y agregarlos en un clic.
- Nuevo `POST /process-flow/drying/batch`: una carga mixta se divide atomicamente por socio y tipo de operacion.
- `COMPRA` conserva su sublote propio y puede pasar a Produccion; `SECADO` conserva un sublote de servicio, queda fuera de inventario/Produccion y genera su cobro de secado al completar.
- El combustible sigue repartiendose proporcionalmente por los QQ de cada sublote.
- Prueba transaccional con datos reales y `ROLLBACK`: 4.62 QQ propios + 75.40 QQ solo secado crearon dos sublotes en el mismo tunel; despues del rollback quedaron 0 tickets vinculados.
- Verificaciones: backend build, 36/36 tests, frontend build y lint sin errores, preflight sin errores criticos.

### Secado parcial y agricultores globales (2026-09-23)

- Guardar el informe de secadora admite horas de inicio/fin vacias y nunca finaliza el secado accidentalmente.
- Las cadenas vacias de fechas/horas se normalizan a `NULL`; la base confirma que `dry_start_at` y `dry_end_at` son anulables.
- Finalizar un tunel o motor exige hora de inicio y hora final tanto en frontend como en backend; ya no se autocompleta la hora final.
- `/farmers` y `/farmers/search` siguen siendo un catalogo global, sin filtro por socio.
- Al crear o editar un Fomento se reutiliza el agricultor global existente; si no existe, se crea una sola persona global y el socio queda asociado en `fomentos`.
- Vincular Ticket conserva el socio del ticket y solo vincula el `farmer_id` global; ya no hereda el socio historico del agricultor.
- Verificaciones: backend build, 33/33 tests, frontend build y lint sin errores, preflight sin errores criticos.

### Eliminacion administrativa y renumeracion de tickets (2026-09-23)

- Android Bascula v11.38 agrega `Administracion -> Eliminar ticket duplicado`.
- La accion exige clave administrativa; no permite continuar sin configurarla.
- Antes de confirmar muestra el ticket, cliente, cantidad afectada y el cambio del ultimo numero.
- Room elimina y renumera dentro de una transaccion, actualiza el contador siguiente, reconstruye Excel y sincroniza ERP/Firebase.
- Firebase elimina solamente los documentos antiguos que realmente quedaron sobrando, distinguiendo historial y espera.
- Nuevo endpoint protegido `POST /api/bascula/delete-and-renumber`: elimina y renumera en una transaccion PostgreSQL.
- El ERP bloquea la eliminacion si el ticket ya esta convertido, liquidado o tiene anticipos aplicados; los tickets posteriores conservan sus UUID y enlaces internos.
- Verificaciones: Android `testDebugUnitTest assembleDebug`, backend build, 33/33 tests, `db:migrate` y `preflight` sin errores criticos.

### Blindaje cruzado contra tickets duplicados (2026-09-23)

- Android Bascula v11.37 migra Room a version 5.
- La identidad local de un ticket ahora es unica por `modo + numero canonico`, sin permitir una copia simultanea en `espera` y otra en `historial`.
- Al migrar, si existian ambas versiones se conserva primero `historial` y luego la version mas reciente.
- El ERP ya no usa el dispositivo/canal como parte de la identidad del ticket principal: WiFi directo, Firebase y reintentos convergen en el mismo registro.
- Nueva migracion `20261028_ticket_identity_cross_channel.sql`, aplicada y verificada en la base local.
- `importBasculaTickets` hace UPSERT por identidad de negocio/modo/numero, preservando el registro existente y sus enlaces contables.
- Verificaciones: Android `testDebugUnitTest assembleDebug`, backend build, 33/33 tests, `db:migrate` y `preflight` sin errores criticos.
- APK actualizado: `C:\Users\Usuario\OneDrive\Documentos\BASCULA\Bascula-actualizada.apk`.

### Permisos: alta de usuario por accionista (2026-09-22)

- El Paso 3 "Acceso del operador" del formulario Crear usuario se rehízo: de dos listas globales (Módulos + Accionistas) a un ACORDEÓN de pills por accionista.
- Al seleccionar/expandir un accionista (🏢 Matriz / 👤 Socio) aparecen los checkboxes de Módulos (VER+EDITAR) y Sub-pestañas (↳) SOLO de ese accionista.
- Estado: `newUserForm.accPerms: Record<accionista_id, string[]>` + `newUserAccExpanded`.
- Guardado: `POST /auth/users` (allowed_modules:[], accionista_ids) y luego `PUT /auth/users/:id/accionistas` con `{accionistas:[{accionista_id,modules}]}` (mismo endpoint del modal de edición). Solo frontend, sin migración.

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

### Estado de cuenta de Fomentos

Implementado el 2026-09-24:

- La vista web y el comprobante imprimible muestran N.º, Fecha Inicial, Fecha Final, Días, Meses, Valor, Interés y Suman.
- La fecha final usa la fecha de liquidación en fomentos cerrados y la fecha actual en cuentas abiertas.
- La presentación del saldo usa una sola fórmula: pedido + interés - pagos.
- La deuda visible nunca baja de $0.00; los pagos excedentes se muestran como `Saldo a favor del agricultor` y el estado queda `SALDADO`.
- No hubo cambios de base de datos ni de registros existentes.
- Verificaciones: frontend build, lint sin errores (advertencias históricas), backend tests 41/41 y revisión visual local en Fomentos.

Ampliado el 2026-09-24:

- Liquidaciones y Fomentos usan la misma fórmula híbrida de interés (días normales y meses fijos para saldos arrastrados).
- El descuento de Fomento se limita al abono que realmente pudo aplicarse; cualquier excedente vuelve al neto de la liquidación.
- Después de reconciliar el fomento se recalculan anticipos, neto y cuenta por pagar al agricultor dentro de la misma transacción.
- La distribución manual permite repartir entre otros fomentos del agricultor, pero se bloquea si supera el disponible del arroz.
- El comprobante de Fomento quedó simplificado: solo Estado de Cuenta y saldo; fletes, cosechadora y arroz permanecen en el comprobante de Liquidación.
- Sin migraciones ni cambios de esquema. Verificaciones: backend build, 44/44 tests, frontend build, lint sin errores y preflight sin errores críticos.

## Servidor local

El backend compilado se inicia desde `backend/` con:

```powershell
node dist/server.js
```

Si se reinicia desde PowerShell, usar `Start-Process` oculto. Confirmar primero que puerto/PID esta escuchando para no levantar dos procesos.

## Frase recomendada para la proxima sesion

`Continua BASCULA-ERP. Lee AGENTS.md y NEXT_SESSION.md, revisa git status y el ultimo commit. Luego realiza este cambio: [DESCRIBIR CAMBIO]. No leas PROJECT_CONTEXT.md completo salvo que necesites buscar un antecedente concreto.`
