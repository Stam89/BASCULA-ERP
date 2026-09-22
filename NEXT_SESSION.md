# BASCULA-ERP - memoria compacta

Actualizado: 2026-09-21

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

### Limpieza de lint frontend

Implementado el 2026-09-21:

- Corregidos los 2 errores `no-useless-escape` en `web-admin/src/App.tsx`.
- `npm run lint` pasa con 0 errores y 157 warnings historicos.
- `web-admin npm run build` pasa correctamente.

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
