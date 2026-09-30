# BASCULA-ERP - memoria compacta

Actualizado: 2026-09-29

## Inicio rapido

- Repositorio: `C:\Users\Usuario\OneDrive\Documentos\GitHub\BASCULA-ERP`
- Rama de trabajo: `main`
- Estado esperado: limpio.
- Ultimo cambio funcional: Partes Diarios reconoce automaticamente los cobros hechos desde Liquidaciones y se retiro Servicios del menu de Campo.
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

### Repuestos de planta conectados con Caja y Mantenimiento (2026-09-30)
- Caja → Nuevo movimiento → categoria «Repuestos» (Matriz): lista opcional de repuestos (del catalogo o «➕ Nuevo repuesto…») con cantidad y costo; el Monto = total de la lista. Guarda via POST `/repuestos/compra` (lote): CONTADO = un egreso REPUESTOS (reference_type 'repuesto_compra', supplier_id) + ENTRADAS con cash_movement_id; CREDITO = `accounts_payable` gasto_credito (categoria REPUESTOS) + ENTRADAS con `payable_id` (migracion 20261056). Anular el egreso o el credito retira del stock (`reversarEntradaRepuestosDeCaja` / `...DeCredito`). Sin lista = egreso normal como antes.
- Mantenimiento de Caja (POST `/equipment/maintenance`): seccion «🔩 Repuestos usados del inventario» → `repuestos_usados`; salen del stock (SALIDA con maintenance_id, `consumirRepuestosEnMantenimiento`) y su valor va a `equipment_maintenance.repuestos_stock_valor` / `repuestos_detalle` (NO a amount: ya se pagaron al comprarlos). amount puede ser 0 si solo hubo repuestos (sin movimiento de caja). Anular el pago del mantenimiento en Caja devuelve los repuestos (`devolverRepuestosDeMantenimiento`).
- Repuestos → «Usar» ahora deja amount 0 y el valor en repuestos_stock_valor (antes se contaba doble en el historial). Repuestos → «➕ Compra»: Pagar con caja / A credito / Solo entrada (caja y credito usan `/compra`).
- Historial de Mantenimiento: «Pagado en caja» + «Repuestos del stock» + costo total (pantalla, CSV, impresion). Pestaña Mantenimiento de Caja muestra los repuestos por terminarse y un acceso al inventario.
- `resolverProveedor` se movio a `services/proveedores.ts` (lo usan cash.ts y repuestos.ts). `exigirMatriz` exportado de repuestos.ts.
- Formulario de Mantenimiento en Caja rediseñado en 3 bloques (clases `.mantForm/.mantBloque/.mantCarrito` en styles.css): 1 Datos de la reparacion · 2 Repuestos del inventario (buscador que autoelige si queda uno, «➕ Usar» deshabilitado y aviso rojo «Cantidad supera el stock disponible (Máx: N)» si excede; una fila por repuesto con cantidad, «Queda en bodega» y «🗑️ Eliminar»; cantidad vuelve a 1) · 3 Monto y comprobante (ayuda 💡, foto, «Rendir cuentas»). Mismo payload (`repuestos_usados`).
- Bug corregido: «Rendir cuentas» se mostraba en Mantenimiento pero se ignoraba. Ahora `/equipment/maintenance` acepta `es_fondo` + `responsable` (egreso POR_LIQUIDAR) y al registrar el vuelto (`/liquidar`) el `equipment_maintenance.amount` queda con el gasto real.

### Egresos con proveedor y Contado / A credito (todas las cajas) (2026-09-29)
- Caja principal (Matriz y cada socio): egresos normales llevan «🏪 Proveedor» (datalist del catalogo `suppliers`; si se escribe uno nuevo el servidor lo crea, `resolverProveedor`) y modalidad «💵 Contado» (default) / «💳 A credito». Mantenimiento, sacos, pagos enlazados (agricultor/pilado/fomento) siguen con su flujo; activo fijo y fondos solo contado.
- A CREDITO NO es cash_movement (ningun saldo/cierre/reporte cambia): crea `accounts_payable` reference_type 'gasto_credito' con supplier_id, categoria, subcategoria, origen_cash_register_id (migracion 20261054). GET `/cash/registers/:id/creditos` los lista en la tabla de la sesion (badge «💳 A Credito / CxP», «$0.00 en caja»); POST `/cash/creditos/:id/anular` (admin, sin abonos). Al pagar en Por Pagar el egreso entra con la CATEGORIA original + proveedor (pay y pay-group). Por Pagar muestra al proveedor como acreedor.
- `cash_movements.supplier_id` (contado); historicos sin proveedor = contado. Excel de cierre: columnas Proveedor/Pago + seccion «Egresos a credito»; la impresion del cierre igual.
- Transporte y Cosechadora (migracion 20261055): `campo_movimientos.proveedor`; a credito crea `campo_cxp` (origen 'EGRESO_CREDITO', categoria_id, activo_id, vence) sin movimiento; el abono hereda categoria/maquina/proveedor. Reparacion (mantenimiento de flota) y anticipos solo contado.

### Repuestos de la planta (2026-09-29)
- Inventario → pestanas «📦 Existencias» / «🔧 Repuestos de planta» (solo con la Matriz activa). `components/RepuestosModule.tsx` + `RepuestosAlertaDashboard` en el Dashboard (en o bajo el minimo; agotados).
- Tablas `repuestos` (stock, stock_minimo, costo_unitario ultimo, equipment_id, activo) y `repuesto_movimientos` (ENTRADA/SALIDA/AJUSTE con signo, stock_resultante, cash_movement_id, maintenance_id). Migracion 20261053. Router `/repuestos` (solo Matriz, 403 a socios; permiso de escritura Inventario o Caja).
- Compra: opcional pagada con la caja abierta → egreso categoria REPUESTOS (reference_type 'repuesto_compra'); al ANULAR ese egreso en Caja, `reversarEntradaRepuestosDeCaja` retira lo que entro. Uso: no deja salir mas que el stock; con maquina crea `equipment_maintenance` tipo REPUESTO (costo = cantidad × costo) en su hoja de vida. Ajuste = conteo fisico.
- Insumos (tabla `insumos`) NO se toco: es de fomentos/agricultores.

### Caja: vuelto de fondos en una sola linea + anulaciones limpias + redondeo (2026-09-29)
- «💸 Registrar Vuelto» SOLO en fondos a rendir cuentas (es_fondo, POR_LIQUIDAR, no anulado ni contra-asiento); reemplaza el «⚙️ Liquidar». Se quito el boton que convertia cualquier egreso en fondo (el endpoint `/convertir-fondo` sigue, sin uso en la UI).
- POST `/cash/movements/:id/liquidar`: si el fondo es de la MISMA caja abierta y gasto real > 0 → UPDATE en linea: amount = gasto real, `monto_entregado` = entregado (columna nueva, migracion 20261052), LIQUIDADO, descripcion «X · Gasto real: $219.00 (Entregado: $220.00 | Vuelto devuelto a caja: $1.00)». Fondo de una sesion anterior (caja cerrada) o gasto real 0 (CHECK amount > 0) → ajuste aparte como antes (reference_type 'fondo_liquidacion'). Rechaza fondos anulados.
- `/reverse`: anular un fondo anula tambien sus ajustes vigentes (contra-asientos); anular solo el ajuste devuelve el fondo a POR_LIQUIDAR (limpia la descripcion). La migracion 20261052 reparo el fondo DIESEL 219.99 que quedo LIQUIDADO con su vuelto anulado.
- Montos: zod `.transform(round2)` al crear movimientos; frontend round2 al enviar; `main.tsx` suelta (blur) un input number al girar la rueda del mouse (causa del 220 → 219.99).
- Probado con BEGIN…ROLLBACK (10 casos: vuelto, faltante, gasto 0, doble liquidacion, anular fondo/ajuste, redondeo).

### Toda la app adaptable a celular / tablet / PC (2026-09-29)
- Bloque final de `styles.css` («TODA LA APP SE ADAPTA AL EQUIPO»): reglas por tamano sobre las grillas y filas con estilo en linea (`[style*="grid-template-columns"]`, `[style*="display: flex"]`) dentro de `.content` y `.modalOverlay`. Celular ≤600: grillas explicitas a 1 columna (menos auto-fit/fill y `.tableHead/.tableRow`), filas que bajan de linea, campos 16px/40px (sin zoom), botones ≥38px, modales casi a pantalla completa, subtabs deslizables. Tablet ≤1024: grillas de 4+ columnas a 2, hijos de grilla con min-width 0. ≤860: tablas fuera de un contenedor con scroll se deslizan de lado. `.rm-main/.rm-side` apilados ≤1180. `.cajaSubNav` con max-width 100% (Nomina se salia 6px incluso en PC).
- Verificado con barrido de todos los modulos + subpestanas (Matriz y Transporte) a 390, 768, 1024 y 1280 px: sin desborde horizontal. En PC >1024 no cambia nada mas.
- Si una pantalla nueva usa una grilla en linea que NO debe colapsar en celular, darle clase `tableRow` o usar auto-fit.

### Ventas: sacos no traban, compartir pedido, sin duplicados (2026-09-29)
- Faltar sacos nunca bloqueo (la regla ya lo permitia), pero el aviso rojo parecia un error: ahora es ambar y dice que se puede tomar igual. Dashboard (Matriz): `SacosPorComprarAlerta` con GET `/sacks/por-comprar` (`sacosPorComprar` en services/sacos.ts: plan de sacos de pedidos PENDING sin preparar vs stock + los negativos; `planSacosPedido` extraido de `descontarSacosPedido`, mismo calculo). La alerta vieja de minimos excluye los que ya salen ahi.
- Compartir pedido con el cliente: `components/PedidoCompartir.tsx` (WhatsApp con el telefono del cliente 09.. → 593.., imagen con html2canvas, copiar texto; TOTAL A PAGAR). Se abre solo al tomar el pedido y con «📤 Compartir con el cliente» en cada pedido de la Cola de Despachos.
- «Tomar pedido» bloqueado mientras guarda (ref + estado): hubo 2 pedidos identicos PED-...IPKO / RH3W creados a 0,1 s (doble toque). No se tocaron; decidir si anular uno.

### Bascula: «Contar tickets desde» (2026-09-29)
- Hay ~280 tickets de la app de bascula (junio-agosto, antes del ERP) que salian como «Pendientes». Fecha de corte en Bascula → Tickets (solo ADMINISTRADOR): los anteriores dejan de contar como pendientes (lista Pendientes y contador «Pendientes» del panel de sincronizacion); en «Todos» siguen visibles, atenuados, con chip «Anterior al corte». Es solo un filtro de vista: no toca tickets.
- Tabla `bascula_config` (id=1, desde DATE; migracion 20261051, default NULL = se cuentan todos, sin cambio). Helper `services/bascula-corte.ts` (`fechaTicketSql`, `leerCorteBascula`; misma fecha del ticket que la bajada de carro). Endpoints GET/PUT `/tickets/corte` (PUT requireAdmin; `desde:null` quita el corte). `/tickets` devuelve `antes_del_corte`; `/api/bascula/status` respeta el corte.
- Independiente del «Contar tickets desde» de la Bajada de carro (`bajada_carro_config`).

### Vista de celular (vendedora en el telefono) (2026-09-29)
- ≤860px: el menu lateral es un cajon (☰ en la barra superior, ✕ / fondo para cerrar, se cierra solo al elegir modulo); tambien en el shell de Transporte (CampoModule). Barra superior compacta (sin fecha ni pastilla API). Ventas → Nuevo pedido en una columna (`pedidoSplit`, `pedidoGrid`, `pedidoBuscaCliente`), pestanas de Ventas con scroll horizontal, tablas con scroll dentro de su tarjeta. En PC no cambia nada (botones ocultos por CSS).
- `index.html`: `translate="no"` + `meta google notranslate`: Chrome del celular traducia la app al ingles (y la traduccion automatica puede romper React).

### Se retiro el modulo «Servicio de Secado» del menu (2026-09-29)
- Pedido del usuario: innecesario porque el cobro del Solo secado (autoCobrarSecadoServicio al finalizar el secado) y del servicio completo/pilado (al finalizar en Produccion) ya van solos a Cuentas por Cobrar (verificado: los 2 lotes SECADO tienen su CxC).
- Quitado de navGroups (Finanzas) y de la lista de permisos. El codigo de la pestana (clave "Servicio Pilado") queda sin enlazar; si se vuelve a necesitar basta con devolverlo a navGroups.
- Lo unico propio del modulo, el informe del servicio de pilado (QQ, tarifa, desglose por presentacion, producto entregado), ahora se abre desde Por Cobrar → detalle del deudor → «📄 Ver informe del servicio» (`piladoReportModal`, `CuentaDetalleModal.onVerInforme`, `DetalleRow.informeId`).

### Cambio rapido de accionista / Transporte (2026-09-29)
- Menu lateral: el select de operacion paso a botones directos (🏭 Matriz, 🚜 Transporte y Cosechadora, 🤝 socios), activo resaltado; tambien dentro de CampoWorkspace (prop operationSelector). Logica unica `opcionesOperacion` / `valorOperacionActual` / `irAOperacion` (junto a switchAccionista).
- Atajos Alt+1…Alt+9 en el orden de los botones (se ignora Ctrl+Alt = AltGr).
- Al cambiar de accionista se vuelve al mismo modulo (`bascula-erp:tab-pending`); si no es visible para el nuevo, el guardia de visibleTabs manda al Dashboard.

### Reportes: revision y correcciones (2026-09-29)
- «Gastos» (informe y KPI del Resumen) leia la tabla `expenses` (vacia, ya no se usa): ahora sale de `cash_movements` EXPENSE vigentes, con categoria de Caja, detalle, socio y separacion operativos / no operativos (`CATEGORIAS_NO_OPERATIVAS` de resultado-mensual). KPI renombrado «Gastos operativos».
- Resumen: sumas de caja y desglose excluyen anulados y contra-asientos (`MOV_VIGENTE`), antes una anulacion inflaba ingresos y egresos; CxC/CxP excluyen CANCELLED.
- Informes INDIVIDUALES por accionista (pedido del usuario): `accionistaDelInforme` usa SOLO el accionista activo (header validado por resolveAccionista); ignora ?accionista=all/otro id; 400 si no hay. Sin selector «Socio»: la barra muestra «👤 Accionista» y al cambiarlo en el menu lateral se recarga el informe. Combustible y Servicios solo con la Matriz activa (403 en backend). El titulo impreso lleva el accionista.
- Produccion: columnas con unidades (cascara kg y QQ, pilado QQ, subproductos QQ, rendimiento %, tipo propio/servicio, socio, estado Finalizado/En proceso/Anulado) + totales. Antes «Entrada» (kg) vs «Salida» (QQ) sin decirlo.

### Nomina > 🚚 Bajada de carro (2026-09-29)
- Cada ticket de bascula (modo principal, sin espera, QQ>0, fecha >= `bajada_carro_config.desde`) paga QQ x tarifa de la actividad de cuadrilla «BAJADA DE CARRO» ($0.10, editable en Configuracion > Actividades y tarifas) a quien bajo el carro: `raw_payload.bajadaX` o `mobile_synced_tickets.bajada_manual` ('__NO__' = no se paga).
- Se guarda como `cuadrilla_entries` origen 'BASCULA' (uq por referencia_id = ticket). `sincronizarBajadas` (cuadrilla.ts) crea/actualiza/borra SOLO lo no pagado; se llama en GET /cuadrilla/bajadas, POST /bajadas/sync (refreshNomina) y al asignar. En Nomina > Pagos sale como UNA sola fila «🚚 Bajada de carro» (GET /cuadrilla/bajadas/pendiente) y se paga todo junto con POST /cuadrilla/bajadas/pagar (un egreso PAGO_MANO_OBRA ref 'cuadrilla_entries' → rubro Cuadrilla); recibo desglosado por trabajador (`imprimirReciboBajada`, se abre al pagar; reimpresion GET /bajadas/recibo?paid_at). Las entradas BASCULA se EXCLUYEN de /cuadrilla/summary, /pay-worker y /worker-receipt (no se mezclan con la cuadrilla por persona). Lo no pagado se arrastra solo.
- Semana de pago sabado→viernes (`inicioSemana`). Pestana: navegacion por semana, KPIs, tickets con input de trabajador (datalist), 🚫 no se paga, totales por trabajador y arrastre. `desde` inicial 2026-09-26 (admin lo cambia en la pestana). Migracion 20261050.

### Accesos directos «⚙️ … en Configuracion» en toda la app (2026-09-29)
- Helpers en App.tsx (junto a `irAAjuste`): `irAConfig(tarjeta)` (subpestana de CONFIG_INDICE + abre y desplaza a la tarjeta), `puedeIrAConfig(tarjeta)` (Configuracion visible y `tarjetaVisibleSocio` si el activo es socio), `cfgLink(tarjeta, texto)` (boton-texto discreto `.vdTarifaLink`). `buscarTarjeta` compara titulos sin mayusculas/acentos y cae al emoji inicial (arregla el salto a «🏦 Cuentas bancarias», que antes no abria).
- Lugares: Secadoras (precio combustible x2, tarifas del tendal), Bascula (humedad base de la merma), Inventario y Caja>Sacos (catalogo de sacos; SacosTablero/SacosAlertaDashboard con prop opcional `onConfig`), Dashboard (ajustar minimos), Gana (tarifario de pilado), Venta Detalle (tarifa por libra x2), Servicio de Secado (tarifa global), Seleccion (tarifas de procesos), Nomina (tarifas de pago en la barra, actividades de cuadrilla, personal administrativo), Caja (categorias de caja, categorias de mantenimiento), Ventas (numeracion de guias). Textos que decian «Configuracion → Tarifas» para el combustible corregidos (esta en Operacion y Planta).

### Caja Principal: rediseno "dashboard financiero" (2026-09-29)
- Solo JSX/CSS (clases `cj-*` al final de styles.css; el proyecto NO usa Tailwind). Sin cambios de estado/handlers/endpoints; unico estado nuevo de UI: `cajaMenu` (menu abierto) con cierre al clic fuera.
- Encabezado oscuro -> 4 tarjetas KPI (Saldo actual destacado, Ingresos, Egresos, Saldos iniciales con efectivo/banco). Fila de 8 pestanas -> toolbar: «➕ Nuevo movimiento», «⚡ Acciones rapidas» (Venta Detalle, Fomentos, Anticipos, Sacos, Mantenimiento, mismo filtro socio/matriz), «📋 Ver movimientos» y «⚙️ Opciones» (Editar saldo inicial, ¿Cuando se hizo?, Excel, PDF, Cerrar caja). Migas «← Movimientos / seccion».
- Con «Nuevo movimiento»: grid 12 col (formulario 5 · movimientos de la sesion 7, sticky); <1100px una columna. Inputs con focus ring azul.

### Secadoras: tunel con varias partidas en UN formulario + confirmacion y compartir costo (2026-09-29)
- Editor del motor: si el tunel tiene >1 partida en proceso (p. ej. propio COMPRA + servicio SECADO_PILADO, que `groupDryingEntries` separa en reportes distintos), se muestra UN formulario: cada partida con su badge, lotes, tipo de arroz (`rice_type__<id>`) y empaque de botada (`botada_empaque__<id>`/`botada_sacos__<id>`); datos comunes una vez. `guardarTunelAgrupado` hace PUT por partida y un solo `/drying/tunnel-finalize` (el backend ya cierra todos los reportes hermanos del tunel). Con 1 partida no cambia nada.
- Modal de combustible: «Confirmar y Finalizar Secado» valida (`validarFinalizarSecado`) y pide confirmacion (`fuelConfirmOpen`) antes de `confirmarFinalizarSecado`.
- Al cerrar el motor, `cerrarCombustibleMotor` devuelve el reparto del backend y se abre la tarjeta «Combustible por QQ» (gas/diesel por QQ, detalle por tunel/lote) con «📲 Compartir por WhatsApp» (`compartirCostoSecado`: share → portapapeles → descarga).

### Revision completa + sync de bascula con tickets renumerados (2026-09-28)
- Barrido: tsc/tests OK; 142 GET x 3 socios sin errores; 21 modulos en navegador (CEYRO/ROVINSON/STALYN) sin errores de consola; ~35 chequeos de integridad de datos OK (stock, cascara por lote, CxC/CxP y espejos, caja, ventas/pedidos, secado, cuadrilla, sacos).
- Bug: al borrar un ticket en la app y renumerar, el registro que nacio como #280 queda como #279 con el id estable de "#280"; el ticket NUEVO #280 chocaba en la PK y `importBasculaTickets` lo omitia en cada sync (#280 y #296). Arreglo: si el id estable esta ocupado por otro ticket (otra llave negocio/modo/numero), se usa `stableUuid(key#n)`. La identidad sigue siendo (negocio, modo, numero).

### Reportes > Servicios (solo Matriz) + impresion limpia del Resultado mensual (2026-09-28)
- `GET /reports/servicios?mes=YYYY-MM` (403 si el socio activo no es MATRIZ): servicios FINALIZADOS por lote, fechados al finalizar (SECADO: todos sus secados COMPLETED -> max dry_end_at; SECADO_PILADO/PILADO: processing_batches.finished_at). Socio = lote de otro accionista (COMPRA: completo si tuvo secado, si no solo pilado); externo = maquila. Arroz propio de la Matriz excluido. `totales[tipo] = {total, socios, externos}` con lotes/tickets/kg/qq/qq_pilado (pilado_services).
- App.tsx: ReportKind `servicios` (boton "🚜 Servicios" visible solo con la Matriz activa; con otro socio vuelve a Resumen), filtro solo por Mes (sin Socio ni Desde/Hasta), tarjetas-pestana Servicio completo / Solo secado / Solo pilado con split socios/externos y dos tablas (socios / clientes externos); Imprimir/Excel via `getReportExport` de la pestana elegida. SUB_TABS Reportes incluye `servicios` (permisos).
- ResultadoMensual `imprimir`: ya no clona la pantalla; arma HTML A4 propio (rubros con alerta roja, total, resultado y neto, ingresos, financieros, cascara comprada y por servicio).

### Configuracion: tarifas con hasta 3 decimales (2026-09-28)
- Casillas de tarifas (Configuracion, tarifa de secado y de seleccion) pasan a `step="0.001"`; helper `fmtTarifa` (App.tsx) muestra minimo 2 y hasta 3 decimales (actividades de cuadrilla, tarifario de servicio).
- Migracion 20261049: `app_settings.tarifa_pilado_qq` y `matriz_packaging_rates.precio_saco_*` a NUMERIC(x,4) (las demas tarifas ya eran de 4 decimales). Sueldo base sigue con 2.

### Resultado mensual: cascara recibida por servicio + Imprimir (2026-09-28)
- `calcularResultadoMensual` devuelve `recepcion` (aditivo): ingresos de bascula del mes (`weighing_tickets` no anulados, fecha Ecuador) por `operation_type`: Servicio completo (SECADO_PILADO), Solo secado (SECADO), Solo pilado (PILADO) y Compra; tickets, QQ, kg y totales. Informativo: la base del costo real sigue siendo la cascara liquidada.
- `ResultadoMensual.tsx`: tarjeta "🚜 Cascara recibida por servicio" en la columna lateral y boton "🖨️ Imprimir" (abre ventana con los estilos de la app y solo el reporte; oculta botones/formularios; A4).

### Secado: aviso al mezclar 0.11 y CORRIENTE + correccion ticket #298 (2026-09-28)
- Error humano en la app de bascula: #298 (CUCHO) salio CORRIENTE/cal. 230 siendo 0.11/225. El ERP copia el tipo y la calificacion del ticket.
- `confirmarMezclaTipos` (App.tsx, junto a `seleccionDe`): al guardar secadoras (batch), tunel individual o tendal, si el grupo junta 0.11 y CORRIENTE pide confirmar listando los tickets del tipo minoritario. Solo frontend; el backend sigue permitiendo la mezcla.
- Migracion 20261048 (puntual, con guardas e idempotente): #298 a 0.11 cal. 225 -> 24.053 QQ en ingreso, ticket, cascara (IN -> CASCARA-011), grupo de secado, total del tunel, labores de cuadrilla NO pagadas y foto del informe TUNEL (tambien refresca nombres de agricultor corregidos por 20261047). Lote 00004-28-09-26 queda 124.273 QQ todo 0.11.

### Produccion: Finalizar Lote con grupo de secado mixto 0.11 + CORRIENTE (2026-09-28)
- Bug: al abrir el proceso desde secadora, cada ingreso del grupo tomaba el producto del PRIMER movimiento IN del lote (todos comparten lot_id), asi que un ingreso CORRIENTE se descontaba como CASCARA-011 y el freno `assertStockNoNegativo` bloqueaba ("requiere 29.82, hay 6.29").
- Arreglo (`processing.ts` POST /): el producto/bodega se busca por el movimiento IN del propio ingreso (`reference_type='weighing_tickets' AND reference_id = weighing_ticket_id`); si no existe, cae a la busqueda anterior por lote. No habia lotes ya procesados con saldo residual.

### Bascula: ticket editado conserva el agricultor viejo (2026-09-28)
- Causa: `importBasculaTickets` hacia `farmer_id = COALESCE(viejo, nuevo)`; si en la app de bascula cambiaban el CLIENTE de un ticket ya sincronizado (edicion o renumeracion), se actualizaba `farmer_name` pero quedaba el agricultor anterior -> el ingreso/Secado salia con otro nombre (ej. #295 CUCHO como DON FORTA).
- Arreglo: si cambia el nombre (trim/lower), se re-homologa `farmer_id`/`accionista_id` con el nombre nuevo (o queda Sin vincular); si no cambia, se respeta el vinculo manual.
- Lista de tickets (Recepcion) devuelve `farmer_vinculado` y muestra "→ agricultor ERP" cuando no coincide con el nombre de bascula.
- Migracion 20261047 re-vincula los ya afectados no liquidados (tambien ingreso y `drying_tunnel_report_lots.farmer_name`): #281, #293, #295, #299. #294 "DON FORTA-SERVICIO P" (vinculo manual) no se toca.

### Resultado mensual: rediseno ejecutivo (2026-09-28)

- Solo maquetacion/UX en `web-admin/src/components/ResultadoMensual.tsx` + clases `rm-*` al final de `styles.css` (el proyecto NO usa Tailwind; se replicaron sus colores slate/blue/purple/red, rounded-xl, shadow-sm). Estado, endpoints y funciones de guardado/edicion/enlaces sin cambios de logica.
- Pestanas: "📊 Reporte de costos vs estimado" (grid 12 col: principal 8 = costos + resultado; lateral 4 = cascara, ingresos, gastos financieros; 1 columna < 1024px) y "⚙️ Mapeo y configuracion de rubros" (solo admin): tarjeta por rubro con badges azules (Caja) y morados (Nomina), boton "+ Asignar" con menu desplegable, Editar/Quitar y "＋ Nuevo rubro" colapsable. Costo real en rojo suave (#fef2f2/#dc2626) solo si supera el estimado.
- El costo estimado se edita con "✏️ Editar" (se quito el input suelto de la tabla del reporte).

### Resultado mensual: rubros enlazados a categorias de Caja y nomina por tipo (2026-09-28)

- Problemas reportados: "Pago semana polvillo" caia en Sueldos (la clave "sueldos" atrapaba el nombre de la categoria "Nómina planta / Sueldos"); editar rubros/claves no cambiaba Caja; "claves" confuso.
- Migracion `20261046_rubros_categoria_nomina.sql`: `costo_rubros.categorias` (codigos de Caja) y `costo_rubros.nomina` (SUELDO_ADMIN, CUADRILLA, PILADOR, ESTIBADOR, SECADOR, POLVILLO). Enlaces por defecto; POLVILLO va con Cuadrilla (pedido del usuario). Quita "sueldos" de las claves de Sueldos. Ajuste de datos: el usuario habia desactivado "Cocinera" y creado "Cocinera / Limpieza" -> se le enlaza COCINERA, se renombra la categoria en Caja y hereda el estimado 0.07 si tenia 0.
- `clasificarMovimiento` (services/resultado-mensual.ts): nomina (PAGO_MANO_OBRA) por `tipoNomina` (reference_type o rol en la descripcion; sueldo cuyo cargo nombra otro rubro va a ese rubro) -> categoria enlazada -> respaldo por claves. Tests con casos reales de septiembre.
- API: `GET /resultado-mensual/categorias-caja`, `POST /rubros` (crea su categoria EGRESO/MATRIZ con el mismo nombre si no se elige una; sin duplicar), `PATCH /rubros/:id` (categorias/nomina exclusivas por rubro; renombrar sincroniza la categoria si es solo suya y no protegida), `POST /rubros/:id/asignar` (categoria o tipo de nomina o clave).
- UI: "⚙️ Configurar rubros" con chips "Categoría de Caja" y "Pagos de nómina" (listas), nuevo rubro con "crear su categoria en Caja"; cada rubro muestra su enlace. Cada fila tiene "✏️ Editar" (nombre + costo estimado, Guardar/Cancelar, Enter/Escape; el nombre renombra su categoria de Caja) junto a "Quitar"; fuera de edicion el nombre es texto fijo. Caja recarga categorias (`onCategoriasCaja`). `cashCategoryAllowsSubcategory` ahora muestra Subcategoria en todo EGRESO salvo los de flujo propio.
- Verificado en BEGIN...ROLLBACK con los egresos reales de septiembre: todo clasificado (Sueldos 200, Cuadrilla 240.58, Pilador/Estibador 21.60, Secada 50, Cocinera/Limpieza 70...).

### Categorias de Caja = rubros del Resultado mensual (2026-09-28)

- Migracion `20261045_categorias_caja_costos.sql`: renombra (solo `nombre`, el `codigo` no cambia y solo si seguia el nombre original) PAGO_MANO_OBRA -> "Nómina planta / Sueldos", GASTO_OPERATIVO -> "Obra civil / Gastos generales" (conserva "Gastos generales": `cashCategoryAllowsSubcategory` lo busca por nombre), MANTENIMIENTO_EQUIPO -> "Mantenimiento piladora / selector", SERVICIOS_BASICOS -> "Servicios básicos", COMPRA_SACOS -> "Compra de sacos / saquillos" (conserva "saco" para `esCategoriaSacos`). Crea 11 EGRESO/MATRIZ sin duplicar por codigo ni nombre: GAS, DIESEL, CUADRILLA_BAJADA, REPUESTOS, GUARDIANIA, COCINERA, GASTOS_ADMINISTRATIVOS, ALIMENTACION, VEHICULO_GERENCIA, GASOLINA_MONTACARGA, CUADRILLA_GUAYAQUIL. Agrega claves a costo_rubros (codigos + "guardia").
- Sueldos, Pilador/Estibador y Secada NO tienen categoria nueva: se pagan por Nomina (PAGO_MANO_OBRA) y el reporte los separa por origen/descripcion ("Sueldo Cocinera X" -> Cocinera por la clave mas especifica).
- Frontend: `CATEGORIAS_RUBRO_COSTO` habilita Subcategoria en las 11 nuevas.
- Verificado en BEGIN...ROLLBACK: idempotente, sin nombres repetidos, 15/15 categorias caen en su rubro.

### Resultado mensual de CEYRO (hoja "COSTO <MES>") (2026-09-28)

- Nueva vista Costos Operativos -> "📊 Resultado mensual" (solo Matriz; subpestana `resultado` en SUB_TABS). No cambia el Consolidado Mensual existente.
- Backend: `services/resultado-mensual.ts` (`calcularResultadoMensual`, `clasificarEgreso`, `normalizar`, tests) y `routes/modules/resultado-mensual.ts` montado en `/resultado-mensual` (GET reporte ?year&month&qq; CRUD `/rubros`; `POST /rubros/:id/claves`; `POST/DELETE /manual`). Migracion `20261044_resultado_mensual.sql`: `costo_rubros` (17 rubros de la hoja con costo estimado, total $4.27/QQ, y claves) y `resultado_mensual_manual` (INGRESO / FINANCIERO por periodo YYYY-MM).
  - Base = QQ de liquidaciones no anuladas del mes de TODAS las operaciones (CEYRO+ROVINSON+STALYN); override manual `qq`.
  - Costos = egresos de las cajas de la Matriz del mes (sin anulados), clasificados por NIVELES: subcategoria > descripcion/maquina/area > reference_type (admin_salary_payments, cuadrilla_entries, worker_payments) > categoria; en cada nivel gana la clave mas larga como palabra completa. Excluidos (no operativos): `CATEGORIAS_NO_OPERATIVAS` (pago agricultor, fomentos, activo fijo, pagos entre socios/servicios, etc.). Sin clasificar se asigna desde el reporte (agrega la subcategoria como clave).
  - Costo real = gasto / QQ; alerta (rojo #FFCCCC) si > estimado.
  - Ingresos adicionales auto: bascula (CxC retencion_matriz + ingresos Caja "bascula"), tamo (ingresos Caja "tamo"), pilado_services por cliente (terceros y cada socio), matriz_service_charges por socio, CxC secado_service y sacos_servicio, interes de fomentos cerrados en el mes por operacion (misma formula de Fomentos) + manuales. La ganancia Gana por operacion la calcula el frontend con `ganaCalc` sobre `/processing-batches/history` de cada accionista (header X-Accionista-Id), solo lotes propios con precio de venta.
  - Neto = ingresos adicionales (+Gana) - costos - gastos financieros; tarjeta roja #CC0000 si < 0.
- Verificado en BEGIN...ROLLBACK con la base real (cascara 217.13 QQ, clasificacion, alerta, excluidos, ingresos, neto).

### Caja: activo fijo desde la compra + pestana renombrada (2026-09-28)

- Caja: la pestana "💳 Movimiento" (formulario) se llama ahora "➕ Nuevo movimiento" para no confundirse con "📋 Movimientos" (lista). Se actualizaron los textos que la mencionaban.
- Activo fijo desde Caja: SOLO con la categoria `COMPRA_ACTIVO_FIJO` ("Compra de activo fijo", AMBOS) aparece el bloque "🏭 Datos del activo fijo" (nombre + tipo). Sin casilla en otros egresos (pedido del usuario 2026-09-28). La vida util NO se escribe: la asigna el backend por tipo con `vidaUtilPorTipo` (`services/activos.ts`, tabla SRI: edificio 20, vehiculo 5, computo 3, resto 10). El backend rechaza `activo_fijo` si la categoria no es COMPRA_ACTIVO_FIJO. `POST /cash/:id/movements` acepta `activo_fijo` y crea `equipment` (accionista de la caja, costo = monto, fecha = hoy Guayaquil, depreciable) enlazado por `equipment.cash_movement_id` (migracion `20261043_activo_fijo_desde_caja.sql`). Anular ese egreso retira el activo (lo borra; si tiene mantenimientos queda FUERA_SERVICIO, costo 0, no depreciable).
- Verificado en BEGIN...ROLLBACK (alta, aparece en Activos fijos, retiro al anular) y el buscador «¿Cuando se hizo?» probado en el navegador con sesion.

### Buscador «¿Cuando se hizo?» (Matriz y Transporte, independientes) (2026-09-28)

- Pedido del usuario: responder rapido "¿que dia se arreglo/cambio/compro X?". Todo eso se registra en Caja (egresos con subcategoria, maquina y area) y en mantenimientos.
- API solo lectura `backend/src/routes/modules/historial.ts` (montada en `/historial`, exige contexto MATRIZ): `GET /historial/buscar?ambito=matriz|transporte&q=&desde=&hasta=` y `GET /historial/sugerencias?ambito=`. `buscarHistorial` exportada para pruebas.
  - matriz: egresos de las cajas de la Matriz (sin anulados/contra-asientos; sin los que nacieron de `equipment_maintenance`, que salen como MANTENIMIENTO) + `equipment_maintenance` no anulados.
  - transporte: `campo_mantenimientos` no anulados + egresos de `campo_movimientos` (sin transferencias par_id, reversiones, apertura de caja ni los ya ligados a un mantenimiento).
  - Busqueda por palabras (todas deben aparecer), sin distinguir mayusculas ni tildes, en descripcion/subcategoria/maquina/area/proveedor/factura/categoria.
- UI `web-admin/src/components/BuscadorHistorial.tsx`: tarjeta "Ultima vez" (fecha, hace N dias, que, maquina, proveedor, monto, veces registradas) + boton "Copiar respuesta" (para WhatsApp) + historial + chips de maquinas/rubros frecuentes. Matriz: Caja -> "🔎 ¿Cuando se hizo?" (solo Matriz). Transporte: menu propio -> "🔎 ¿Cuando se hizo?".
- Verificado en BEGIN...ROLLBACK con la base real (Matriz no ve Transporte y viceversa, sin duplicar mantenimiento y su egreso, filtros de fecha, sin tildes).

### Personal administrativo se gestiona en Configuracion (2026-09-27)

- Configuracion -> Operacion y Planta / "🏢 Mi negocio" (socios) -> "💼 Personal administrativo": agregar, editar y dar de baja empleados de oficina del accionista ACTIVO (Matriz o socio). Reutiliza `submitAdminStaff`, `editAdminStaff`, `removeAdminStaff` y `/admin-payroll/staff` (sin cambios de API). Visible tambien para socios (`tarjetaVisibleSocio`).
- Nomina -> Sueldo Administrativo queda como consulta (lista + historial) con boton "Agregar / editar empleados en Configuracion"; el pago sigue en Nomina -> 💵 Pagos.

### Mis cuentas bancarias: alta directa por socio (2026-09-27)

- Configuracion ya no exige crear una apertura tipo BANCO desde Caja: el administrador puede usar `+ Agregar cuenta bancaria` dentro de `Mis cuentas bancarias`, indicando nombre, banco/tipo y numero.
- La ficha se registra cerrada y con saldo cero, por lo que NO abre una jornada, NO altera saldos y NO bloquea la caja operativa abierta del socio.
- La lista vacia ahora se calcula para el socio activo (antes podia quedar una tabla vacia si otro socio tenia cuentas). Los usuarios no administradores cargan sus cuentas desde el endpoint filtrado, en vez de fallar silenciosamente contra la ruta global de administracion.
- Se bloquean numeros de cuenta duplicados dentro del mismo socio. Verificado: builds backend/frontend, 83/83 pruebas y alta transaccional con ROLLBACK (la cantidad de cajas abiertas no cambio).

### Configuracion por accionista: el socio solo ve lo que usa (2026-09-27)

- Con un SOCIO activo, Configuracion muestra solo: "🏢 Mi negocio" (Datos del negocio, ya independiente por socio en app_settings.socio_id), "🛒 Tarifas por libra", "🏦 Mis cuentas bancarias" (filtradas a su accionista_id) y "Mis sacos" si envejece. Ocultos para socios: Estado del sistema, Nomina/mano de obra y cuadrilla (los socios solo tienen sueldo administrativo), Parametros de planta, combustible, categorias de caja y mantenimiento, puesta en marcha, zona de peligro, respaldos, tarifas de planta/servicios/empaque/procesos, accionistas, secuenciales y usuarios. Se administran desde CEYRO.
- Implementacion solo visual en App.tsx: `esSocioActivoCfg`, `SUBTABS_SOCIO`, `tarjetaVisibleSocio` (tambien filtra el buscador de ajustes) y efecto que regresa a "operacion" si el socio estaba en otra subpestana. Sin cambios de API ni de datos.

### Sacos propios por socio (STALYN / envejecido) + Seleccion con Tula y productos por proceso (2026-09-27)

- `sack_inventory.accionista_id` (migracion `20261042_sacos_propios_socio.sql`): NULL = catalogo de la MATRIZ (todo lo existente; lo usan ventas y produccion, ahora filtrado con `accionista_id IS NULL` en `services/sacos.ts`). Filas con accionista = catalogo PROPIO del socio (categoria `PROPIO`, `marca` = nombre del saco).
- Quien maneja sacos: Matriz y el socio con `modulo_envejecido_habilitado` (STALYN). ROVINSON no (no ve la seccion; la API responde 403 al escribir).
- API `/sacks`: GET por defecto = Matriz (sin cambios para ventas/produccion); `?propio=1` = catalogo del accionista activo (tambien `/sacks/movements/recent?propio=1`). Escrituras (POST/PATCH/DELETE, movimientos, ajuste, precio, compras) validan que los sacos sean del accionista activo (`ambitoSacos` + `assertSacosDelAmbito`). La compra desde el movimiento de Caja (`registrarEntradaSacosDesdeCaja`) valida lo mismo.
- UI: `manejaSacosPropios` / `sacosDelActivo` en App.tsx. STALYN ve: Configuracion -> Operacion y Planta -> "Catalogo de sacos · Mis sacos (envejecido)" (`SacosCatalogoConfig modo="PROPIO"`), Caja -> subpestana Sacos + categoria Compra de sacos, Inventario y alerta de Dashboard con SUS sacos.
- Seleccion: productos por proceso (SELECCION: 0.11, Corriente, Arrocillo 3/4, Arrocillo fino; ENVEJECIDO: entra solo 0.11, regresa Arroz Envejecido + arrocillos/rechazo; lotes antiguos conservan sus productos). Empaque por salida: Tula por defecto; Saco 100/25/10 (informativo, el saco de la Matriz se descuenta al VENDER); en ENVEJECIDO de STALYN, sus sacos propios -> se descuentan al recibir (`selection_batch_outputs.empaque/sack_id`, `sack_movements.ref_selection`).
- Ventas: el Arroz Envejecido (ARROZ-ENVEJECIDO) NO descuenta sacos de la Matriz (ya va empacado en los sacos propios). Arrocillo y demas: saco de la Matriz al vender (sin cambios).
- Verificado en BEGIN...ROLLBACK con la base real (catalogos separados, ventas no toman sacos del socio, envejecido no descuenta doble, ROVINSON sin acceso).

### Recarga automatica tras un despliegue (2026-09-27)

- Problema: con la pestana abierta de una version anterior, abrir un modulo bajo demanda (Transporte y Cosechadora, Reportes de solo lectura, Finanzas) pedia un archivo `assets/*.js` que ya no existe y la pantalla quedaba en blanco.
- `web-admin/src/recargaVersion.ts`: `importarConRecarga` envuelve los `React.lazy` de `App.tsx`; si el import falla por version vieja recarga UNA vez (marca en sessionStorage, ventana 30 s, sin bucles). `main.tsx` escucha `vite:preloadError` con la misma regla.

### Cuentas espejo completas + notificaciones + diseno tabla en CxC/CxP (2026-09-27)

- `services/cuentas-vinculadas.ts`: `buscarCuentaHermana` unico (puentes pilado/traspaso/maquila/sacos + pares por `reference_type`+`reference_id` para `fomento_cruce` y `retencion_matriz`, que antes NO se espejaban). `espejarAbonoEnContraparte` ademas crea notificacion al otro accionista ("X registro tu pago" / "X te pago"). `bajarPayableHermanaSinCaja` (cruce con producto) usa el mismo buscador y avisa.
- Bug corregido: `POST /cash/payables/pay-group` no espejaba; ahora espeja cada cuenta abonada.
- Transporte y Cosechadora: cada cargo de flete/cosecha propia de una liquidacion crea la Por Pagar espejo del socio (`accounts_payable.reference_type='campo_servicio'`, reference_id = campo_servicios.id, SIN liquidation_id). Migracion `20261041_notificaciones_espejo_cuentas.sql`: tabla `notificaciones`, trigger `trg_campo_movimientos_espejo_cxp` (saldo Por Pagar = saldo pendiente del servicio; cobro nuevo en Transporte -> EGRESO en caja abierta del socio salvo cuenta CRUCE PILADORA + aviso), trigger `trg_campo_servicios_borrar_cxp` (anular servicio borra la Por Pagar) y backfill de las 4 existentes. Pagar esa Por Pagar desde el ERP registra el cobro en la CAJA de Transporte (`espejarPagoATransporte`, exige caja de Transporte abierta; marca `bascula.origen_pago='erp'` para no duplicar el egreso). Transporte no toca `cash_movements` en ningun otro lado.
- Listas: `/receivable` y `/cash/payables` devuelven `entre_socios` y el nombre de la contraparte (Transporte y Cosechadora / socio del fomento).
- API `GET /notificaciones`, `POST /notificaciones/:id/leer`, `POST /notificaciones/leer-todas` (accionista activo). UI: `web-admin/src/components/Notificaciones.tsx` (campanita en la barra superior, sondeo cada 60 s).
- UI Por Cobrar / Por Pagar: tabla estilo Transporte (Deudor/Acreedor, Movimientos, Debe, Haber/Pagado, Saldo, Acciones) + recuadros TOTAL/VENCIDO; filtros, detalle, abonar, imprimir y Cruzar sin cambios de logica.
- Verificado en BEGIN...ROLLBACK con la base real (backfill, cobro en Transporte baja la Por Pagar + egreso + aviso, pago desde ERP sin egreso doble, fomento y retencion espejados con aviso, anular servicio borra la Por Pagar).

### Cargo por empaque al socio: por bulto, no por QQ (2026-09-27)

- Bug corregido en `services/cargo-empaque.ts`: multiplicaba la tarifa por los QQ del pedido. Ahora `calcularCargoEmpaque` usa bultos = round(QQ x 100 / peso) por linea (igual que la Guia), agrupados por tramo: <=10 LB -> tarifa 10, <=25 -> 25, <=50 -> 50; >50 LB no se cobra. Pesos personalizados ("24 LB", sin presentation_id) usan su tramo (`pesoLineaEmpaque`, `tramoEmpaque`).
- No habia cargos historicos (`matriz_packaging_charges` vacia): nada que recalcular.
- Verificado: tests `cargo-empaque.test.ts` + BEGIN...ROLLBACK (ROVINSON 10 QQ en 10 LB + 22 QQ en 24 LB = 100 x $0.20 + 92 x $0.22 = $40.24, CxC/CxP en espejo; la Matriz no se cobra).

### Sacos: el cliente elige el saco del sobrante (2026-09-27)

- Nueva columna `sales_order_items.sobrante_saco_lb` (migracion `20261040_sobrante_saco_pedido.sql`; NULL = automatico). `orderItemSchema` la acepta en POST/PUT de pedidos y el listado la devuelve.
- `planDeSacos(qq, peso, tamanos, sobranteSacoLb?)`: si el cliente eligio un saco de la marca para el sobrante, se usan `ceil(sobrante / ese peso)` sacos; si ese saco ya no existe, vuelve a automatico. 6 QQ en 98 LB: auto 6x100 + 1x25; elige 10 LB -> 6x100 + 2x10; elige 100 -> 7x100.
- Ventas: al armar la linea, si hay sobrante aparece "Saco para el sobrante (N lb)" con Automatico o cada saco de la marca; el carrito muestra "Sobrante en saco de X LB". Editar pedido conserva la eleccion.
- Verificado en BEGIN...ROLLBACK con la base real + tests (sacos.test.ts 14).

### Sacos: empaque automatico (sin saco de 50 LB, pesos personalizados) (2026-09-27)

- La planta NO tiene sacos de 50 LB. Migracion `20261038_sacos_sin_50lb.sql` borra los sacos de marca de 50 LB sin stock ni movimientos (o los desactiva si tuvieran historial). La presentacion de venta `50lb` se conserva.
- Regla `planDeSacos(qq, pesoPresentacion, tamanos)` (backend `services/sacos.ts` y espejo en `web-admin/src/components/SacosModule.tsx`): cada bulto va en el saco MAS PEQUENO registrado de la marca donde cabe; el sobrante, en el mas pequeno que lo contiene. 10 QQ en 50 LB -> 20 x 100 LB; 100 QQ en 98 LB -> 102 x 100 LB + 1 x 10 LB. Sin reglas fijas por peso: si algun dia se registra un saco de 50 LB, se usa solo.
- `descontarSacosPedido` usa `sacosCandidatos` (marca -> todos sus sacos; subproducto -> saco especial 1 por bulto; arroz sin marca -> genericos). `resolverSaco` se elimino.
- Ventas: opcion "Otro peso (lb)" en Presentacion; la linea se guarda sin `presentation_id` y con nombre `"98 LB"` (Guia: bultos = QQ x 100 / 98). El aviso de la linea muestra "Sacos a usar: 102 x Flor 100 LB + 1 x Flor 10 LB". El cargo de empaque al socio (10/25/50 por presentation_id) no aplica a pesos personalizados.
- Verificado en BEGIN...ROLLBACK con la base real + 10 tests de `planDeSacos`/`sacosParaQq` (74 tests backend OK).

### Partes Diarios: cobro automatico visible y Servicios simplificado (2026-09-27)

- Se retiro `Servicios` del menu de Transporte y Cosechadora; el backend y los registros historicos se conservan para compatibilidad y para Cuentas por Cobrar.
- `Historial de partes` calcula el estado desde la liquidacion real: un parte de cosechadora enlazado en `liquidation_harvest_details`, o un flete de Bascula descontado en su liquidacion, aparece como `Cobrada en liquidacion`.
- El historial muestra el numero de liquidacion y el socio operativo que tomo el cobro; el filtro `Cobro generado` incluye estos casos automaticos.
- Un parte tomado por una liquidacion activa ya no puede cobrarse manualmente, editarse ni anularse; primero se debe anular la liquidacion. Esto evita dobles cobros.
- Los partes que ya tienen un servicio manual tampoco vuelven a sugerirse como cosechadora en una liquidacion.
- Validacion sobre datos reales, solo lectura: el parte de JUNIOR JIMENEZ / COS.10 queda reconocido como cobrado por `LIQ-20260924192804-UHWQ` de CEYRO.
- Sin migracion. Builds backend/frontend y 67/67 pruebas correctos.

### Inventario de sacos por marca y peso (2026-09-27)

- REGLA NUEVA: los sacos se descuentan al VENDER, en `PATCH /orders/:id/prepare` (Confirmar Preparacion), por marca (`sales_order_items.product_id`) + peso de la presentacion; `sacos = round(QQ x 100 / peso)`, minimo 1. Revertir preparacion o anular el pedido los devuelve (`restaurarInventarioPreparacion` -> `restaurarSacosPedido`). Idempotente por neto de `sack_movements.ref_order`.
- Si falta stock NO bloquea: queda negativo y el toast/Dashboard avisan. Marca sin saco propio (p. ej. Lira Verde) NO cae al generico: se avisa `sin_saco`. Arroz sin marca (FINISHED_GOOD) usa el generico `Saco N LB`; subproductos usan Saco Negro/Usado (`tipoSacoEspecial`).
- Produccion y Seleccion YA NO descuentan sacos. Produccion conserva `sacasArrozBlanco` solo para el pago del estibador. Excepcion: Servicio de Pilada (maquila) con `sacos_servicio[]` -> descuenta y crea CxC `reference_type='sacos_servicio'` (reference_id = processing_batch) por sacos x `precio_venta_cliente`.
- Servicio central: `backend/src/services/sacos.ts` (+ test). Migracion `20261037_sacos_por_marca.sql`: columnas `categoria/marca/calidad/peso_lb/product_id/stock_minimo/precio_venta_cliente/activo` en `sack_inventory`, `ref_order` en `sack_movements`, producto Extra con presentaciones y catalogo Flor/Oso/Extra/Lira Azul (0.11) + Conejo (Corriente) x 100/50/25/10 LB en stock 0. Los tipos antiguos quedan como GENERICO/SUBPRODUCTO con su stock.
- API catalogo (solo contexto Matriz): `POST /sacks` (marca + pesos; crea producto/presentaciones si la marca es nueva), `PATCH /sacks/:id` (minimo, precios, calidad, activo; el stock NO se edita aqui), `DELETE /sacks/:id` (borra si no tiene movimientos y stock 0; si no, desactiva).
- UI: `web-admin/src/components/SacosModule.tsx` (tablero marca x peso en Inventario y Caja, catalogo en Configuracion -> Operacion y Planta -> Catalogo de sacos, alerta en Dashboard si stock <= minimo). Ventas muestra los sacos de la marca/peso al armar la linea; Produccion de servicio tiene "Sacos de la planta para el cliente". `getInventoryProductForBrand` incluye Extra y marcas nuevas por su `calidad`.
- Verificado en BEGIN...ROLLBACK con la base real (15 comprobaciones): migracion idempotente, descuento/restauracion/idempotencia, negativo sin bloqueo, genérico solo para arroz sin marca, servicio $ correcto, kardex = stock.
- Pendiente del usuario: cargar stock real de sacos (compra en Caja), fijar minimos y precios al cliente en el Catalogo.

### Mantenimiento unificado, sin doble digitacion (2026-09-27)

- Se retiro del menu de Transporte/Cosechadora la nueva opcion duplicada de Mantenimiento.
- El usuario registra una sola vez desde `Transporte y Cosechadora > Caja > Egreso`, categoria `REPARACION_MANT`.
- Ese mismo guardado crea el egreso en Caja de Campo y alimenta automaticamente el historial oficial existente en `Caja principal > Mantenimiento`, sin crear un segundo movimiento contable.
- Los registros de Campo ya existentes se migran al historial oficial con el area `TRANSPORTE Y COSECHADORA`; el enlace unico impide duplicarlos.
- Reversar el egreso tambien marca como anulado el registro del historial oficial.
- Migracion aplicada: `20261036_unificar_mantenimiento_campo.sql`. Builds, 64/64 tests, migraciones y preflight correctos.

### Caja sin sobregiro y reversion auditada (2026-09-26)

- CAJA fisica ya no permite egresos superiores al saldo disponible. El control se ejecuta dentro de transacciones y cubre egresos manuales, mantenimiento, nomina, CxP, reembolsos de vales y transferencias.
- BANCO y OTROS no se bloquearon para evitar romper conciliaciones externas que aun no hayan sido cargadas en el ERP.
- El Libro permite reversar movimientos manuales y mantenimientos con motivo obligatorio. Nunca borra el original: crea el asiento opuesto, marca el original como reversado y conserva usuario/fecha para auditoria.
- Movimientos ligados a servicios, nomina, CxP, vales, transferencias, apertura/cierre y `CRUCE PILADORA` no se reversan desde el Libro; deben corregirse desde su modulo de origen.
- Reversar un mantenimiento tambien lo marca anulado en la hoja de vida. Los reportes por maquina incluyen mantenimiento y netean sus reversiones.
- Migracion aplicada: `20261035_campo_reversiones_y_saldo_caja.sql`. Verificacion: backend 64/64 tests, builds backend/frontend, preflight y health correctos; UI comprobada sin modificar datos reales.

### Hoja de vida y Caja de Transporte/Cosechadora (2026-09-26, unificada el 2026-09-27)

- La tabla tecnica interna conserva por maquina fecha, tipo de trabajo, pieza/sistema, detalle, horometro o kilometraje, proxima fecha/lectura, taller, factura, costo y observaciones; ya no se presenta como una seccion separada.
- Los mantenimientos con costo crean atomicamente el egreso de Caja y la ficha tecnica; los controles sin costo tambien pueden registrarse. `CRUCE PILADORA` no se acepta como cuenta de pago.
- Los egresos existentes con categoria `REPARACION_MANT` y maquina asignada se recuperan automaticamente como historial basico, sin duplicarlos.
- En el formulario de Egreso, la categoria `REPARACION_MANT` exige una maquina y alimenta la hoja de vida; no se puede confundir con un anticipo por rendir.
- Caja y Reportes muestran `DISPONIBLE` excluyendo `CRUCE PILADORA`, que sigue visible como cuenta interna pero ya no infla el efectivo utilizable.
- Migracion aplicada: `20261034_campo_mantenimiento_flota.sql`. Verificacion: backend 64/64 tests, builds backend/frontend, preflight y health correctos; UI revisada sin insertar datos de prueba.

### Transporte y Cosechadora: integridad operativa y contable (2026-09-26)

- Los Partes Diarios ahora derivan el servicio desde la maquina: una cosechadora genera `cosecha`; camion, vehiculo, transporte u otro generan `flete`. La UI usa textos dinamicos y sugiere el operador habitual de la maquina.
- La liquidacion de Nomina ya no confia en totales enviados por el navegador: bloquea los partes, valida operador/maquina, recalcula base y tarifa en backend y evita pagos simultaneos duplicados.
- Pagar Nomina registra tambien el egreso en CAJA/BANCO/OTROS; `CRUCE PILADORA` no se ofrece ni se acepta como cuenta de pago. CAJA exige una sesion abierta.
- Integracion Bascula→Campo protegida con `origen_uid` unico basado en el UUID del ingreso ERP; los reintentos concurrentes ya no pueden crear dos partes del mismo ingreso.
- El Libro muestra saldo corrido por cuenta aun al consultar `Todas`. El cierre de Caja genera un movimiento tecnico que reinicia el saldo contable de la jornada y evita duplicar el efectivo al abrir la siguiente.
- Se hicieron visibles las secciones existentes `Vales por Rendir` y `Reportes` en el menu de la operacion.
- Migracion aplicada: `20261033_campo_integridad_operativa.sql`. Verificacion: backend 64/64 tests, builds backend/frontend y preflight correctos.

### Auditoria integral y mapa de la aplicacion (2026-09-26)

- Nuevo mapa tecnico/funcional en `docs/MAPA_APLICACION.md`: arquitectura, modulos, flujos interconectados, seguridad, controles, estado verificado y deuda tecnica priorizada.
- Caja: consultas, cierre, exportacion y operaciones sobre movimientos ahora comprueban que la caja pertenezca al accionista activo. La apertura usa un candado transaccional por socio y rechaza cajas abiertas duplicadas, incluso con doble clic o dos equipos.
- Liquidaciones: editar/desbloquear/aplicar anticipos/anular/eliminar quedaron estrictamente filtrados por accionista activo. `apply-advances` bloquea liquidacion y CxP por separado para evitar locks invalidos sobre un `LEFT JOIN`.
- Permisos: se cubrieron prefijos que no estaban en el mapa de escrituras (`guias-remision`, `admin-payroll`, `productos` y `catalogs`).
- Frontend: se elimino la segunda llamada identica a `refreshNomina()` al entrar en Nomina.
- Preflight: nuevo control que falla si un socio tiene mas de una caja abierta.
- Verificacion: backend build y 61/61 tests; preflight y migraciones correctos; frontend build; lint 0 errores/166 warnings historicos; base real sin tickets duplicados ni stock negativo; health HTTP 200.

### Nomina de Secador solo de lunes a viernes (2026-09-25)

- Sabado y domingo se guardan y finalizan normalmente los secados, pero no generan guardiania ni pago por tunel para el rol `SECADOR`.
- La restriccion vive en backend y cubre los tres caminos: automatizacion de Secadoras, sugerencias detectadas y alta manual de dias del secador.
- Si una version anterior hubiera dejado un pago automatico pendiente de fin de semana, al reprocesar esa corrida se elimina; los pagos ya liquidados nunca se tocan.
- Revision de datos reales en solo lectura: no existen pagos historicos de Secador en sabado o domingo.
- Pruebas de calendario lunes-domingo agregadas; backend build correcto y 56/56 tests aprobados.

### Secador de turno semanal compartido por toda la planta (2026-09-25)

- La semana operativa y el periodo sugerido de Nomina empiezan el lunes.
- El nombre dejo de guardarse por separado para Motor 1 y Motor 2: ahora existe un unico secador de turno semanal compartido por los tres tuneles.
- Al guardar una corrida, todos sus tuneles reciben el mismo responsable. Al abrir el otro motor se reutiliza ese responsable, evitando nombres distintos por motor.
- El responsable se puede cambiar cualquier dia por enfermedad o reemplazo; las corridas siguientes usan el nuevo nombre y los secados ya finalizados conservan su responsable historico.
- Si la aplicacion permanece abierta del domingo al lunes, detecta la nueva semana en menos de un minuto y limpia el responsable anterior.
- Compatibilidad: si esta semana ya tenia un nombre almacenado por motor, se migra automaticamente al nuevo turno unico de planta.
- Verificacion: frontend build correcto y semana visible desde el lunes 2026-09-21.

### Secados guardados compactos (2026-09-25)

- Se reemplazo la cuadricula de diez minitarjetas por registro por una ficha operativa compacta de tres franjas: identidad/estado, datos principales y linea de tiempo.
- Conserva peso, responsable, secadora, variedad, lotes, agricultor, llenado, inicio, fin y duracion; las acciones Compartir/Corregir siguen intactas.
- Las fechas usan formato corto de 24 horas (`dd/mm/aaaa · HH:mm`) para reducir ruido visual.
- Responsive verificado: escritorio con tarjetas de baja altura y movil a dos columnas, sin overflow horizontal.
- Verificaciones: frontend build correcto; lint con 0 errores y 166 warnings historicos.

### Secador semanal, nomina visible y detalle de secados (2026-09-25)

- Diagnostico de solo lectura: el Tunel 3 real si genero pago pendiente para `MARGARO` por $15.00 (guardiania + 1 tunel); estaba oculto conceptualmente porque la subpestana `Secadora` habia sido retirada y solo aparecia mezclado en `Pagos`.
- Se restauro `Nomina > Secadora` como vista de revision por periodo. El pago sigue siendo automatico y se liquida unicamente desde `Pagos`.
- El responsable ya no se recuerda indefinidamente por tunel: se guarda por semana operativa y por motor. Una semana nueva inicia sin heredar el nombre anterior y exige confirmar el secador antes de crear la corrida.
- Los motores activos devuelven `operator_name`, para conservar el responsable correcto durante una corrida ya iniciada.
- `Secados guardados` muestra responsable, fecha de llenado, inicio, fin y duracion. Los finalizados incluyen `Corregir datos`; cambiar el responsable conserva el cierre y hace que la automatizacion reubique el pago pendiente.
- Verificacion visual sin escrituras: Tunel 3 mostro MARGARO, 24/09 20:11 a 25/09 07:12, 11.0 h; Nomina > Secadora mostro su pago pendiente de $15.00.
- Verificaciones: backend build + 48/48 tests y frontend build correctos.

### Servicio completo: herencia correcta al agregar a Secadoras (2026-09-25)

- Corregido el falso badge `PROPIO` que aparecia al pulsar `Agregar al lote`: el mapeo temporal de tickets ahora conserva `operation_type` e `is_maquila` tanto en tuneles como en Tendal.
- Produccion ya no muestra el checkbox deshabilitado `Es Servicio de Pilada (Maquila)`. En su lugar muestra un estado compacto de solo lectura (`Servicio completo` o `Lote propio`) detectado automaticamente desde Bascula.
- Al finalizar Produccion se envia directamente `millingEsServicio`, derivado del origen seleccionado, sin un estado React intermedio que pueda quedar atrasado.
- Dato real revisado solo en lectura: CUCHO tiene `operation_type = SECADO_PILADO` e `is_maquila = true`.
- Verificacion visual sin guardar datos: CUCHO se mostro `SERV. COMPLETO` antes y despues de agregarlo al lote. Frontend build correcto; lint 0 errores y 166 warnings historicos.

### Rediseno UX/UI de Produccion / Reporte de Pilado (2026-09-25)

- Cambio exclusivamente visual en `web-admin/src/App.tsx` y `styles.css`; no se modificaron estados, handlers, llamadas API ni funciones de guardado/finalizacion.
- Flujo dividido en cuatro pasos: origen de materia prima, personal de turno, rendimiento/subproductos y resumen/acciones.
- Origen usa control segmentado y conserva el indicador de maquila heredado/bloqueado; el reporte muestra `Pendiente de origen` u `Origen seleccionado`.
- Personal quedo en tres columnas; arroz pilado y subproductos estan separados en paneles; el total y su desglose se trasladaron a una tarjeta final con `Guardar Proceso` secundario y `Finalizar Lote` principal.
- CSS responsive nativo del proyecto (sin agregar Tailwind ni dependencias): escritorio a dos columnas y apilado en movil, sin desbordamiento horizontal.
- Revision visual solo de lectura con y sin origen seleccionado; no se guardo ni finalizo ningun lote real.
- Verificaciones: frontend build correcto, lint con 0 errores (166 warnings historicos), escritorio 1082 px y movil 433 px sin overflow horizontal.

### Produccion: "Es Servicio de Pilada (Maquila)" heredado de Bascula (2026-09-25)

- Regla unica `loteEsMaquila` (backend/src/utils/maquila.ts, con tests): `operation_type` != COMPRA -> maquila (SECADO_PILADO/PILADO/SECADO); sin tipo (legado) -> `is_maquila`.
- API: `GET /process-flow/drying/reports` devuelve `es_maquila` (del LOTE PRINCIPAL `d.lot_id`, el que se pila) y `es_maquila_mixto` (lotes del secado con tipos mezclados, solo aviso). `GET /lots/dry-in-storage` devuelve `es_maquila`.
- Cierre `cerrarProcesoProduccion`: si el lote tiene `operation_type`, `isMaquila` se DERIVA de el e ignora `body.is_maquila`/`ownership` (el operador ya no puede cambiar la naturaleza del lote). Lotes sin tipo conservan la regla anterior.
- Frontend Produccion: el checkbox se marca solo con `es_maquila` de la API, esta `disabled` y muestra "🔒 Heredado de Bascula"; aviso si `es_maquila_mixto`.
- Datos reales (solo lectura): COMPRA -> false, SECADO -> true; 0 lotes sin operation_type.
- Verificaciones: backend build, 48/48 tests, frontend build y lint 0 errores.

### Fix: nomina de Tendal ensacado SIEMPRE por QQ (2026-09-24)

- Bug: `calcularPagoCuadrillaTendal` en ensacado multiplicaba la tarifa "TENDAL POR SACO" por el numero de sacos entregados (ej. 15 sacos x $2 = $30). Regla correcta: nomina SIEMPRE por peso: granel -> "SECADO EN TENDAL" x QQ; ensacado -> "TENDAL POR SACO" x QQ. Los sacos quedan solo en la nota ("21.6 Quintales (15 sacos)"); `drying_tunnel_cuadrilla.quintals` ahora recibe QQ.
- CxC del Tendal ya era por QQ (sin cambios). Tuneles sin cambios.
- `audit:tendales` marca estos casos como "se habia calculado x sacos, no x QQ".
- Verificado en BEGIN...ROLLBACK con los 2 tendales reales: 00002 ensacado (15 sacos, 21.6 QQ) nomina $43.20 + CxC $48.60; 00001 granel $113.10 + $131.95; auditoria = cierre.

### Tendal: nomina por actividades de cuadrilla + auditoria (2026-09-24)

- REVIERTE parte de la entrada "Fix: tarifas del cierre de Tendal": el usuario pidio que la nomina del Tendal salga SIEMPRE de la tabla de actividades de Cuadrilla: A granel -> `SECADO EN TENDAL`; Ensacado -> `TENDAL POR SACO`. `labor_rates.tendal_per_qq` ya no se usa (columna y clave API intactas; se quito su input de la UI y se muestra un resumen de solo lectura de ambas actividades).
- Fuente unica: `calcularPagoCuadrillaTendal` (exportada) la usan el cierre (`registrarPagoCuadrillaTendal`) y la auditoria. CxC del Tendal sin cambios (granel/saco por Servicios); `calcularCobroTendal` es un espejo de la rama Tendal de `autoCobrarSecadoServicio` solo para auditar. `autoCobrarSecadoServicio` y todo lo de tuneles NO se toco (los tuneles siguen decidiendo por `botada_empaque`, como se pidio en b0f8019).
- Script `npm run audit:tendales` (backend/src/scripts/auditar-tendales.ts): SIMULACION por defecto (ROLLBACK); `-- --aplicar` hace COMMIT en una transaccion. No toca pagos con `paid_at` ni CxC cobradas; en cobro parcial conserva lo cobrado. Precarga `ensureLaborTables()` antes del BEGIN.
- Verificado en BEGIN...ROLLBACK: granel nomina $113.10 (1.50) + CxC $131.95 (1.75); ensacado $100 (2.00x50) + CxC $169.65 (2.25); la auditoria coincide con el cierre (0 diferencias).
- Simulacion sobre datos reales: nomina del tendal 00001-23-09-26-S correcta; su CxC $113.10 se emitio a $1.50 y la tarifa actual es $1.75 -> NO se aplico (re-cobrar con tarifa posterior es decision del usuario).
- Verificaciones: backend build, 44/44 tests, frontend build y lint 0 errores.

### Configuracion: Nomina (egresos) separada de Servicios (ingresos) (2026-09-24)

- Solo UI (App.tsx); sin cambios de backend ni de claves de BD. Los 14 campos de `labor_rates` siguen existiendo una sola vez y todos guardan con el mismo `saveLaborRates` (estado compartido `laborRatesForm`).
- Nueva subpestana `nomina` = "👷 Tarifas de Nomina y Mano de Obra": Pilador, Estibador, Secador, "☀️ Cuadrilla / Secado en Tendal" y las actividades de cuadrilla (alta + tabla de tarifas).
- La subpestana independiente "👷 Cuadrilla" de Configuracion YA NO EXISTE (se quito del tipo `configSubTab`); su contenido se renderiza con `configSubTab === "nomina"` y `refreshCuadrilla()` corre al entrar a Nomina. El modulo Nomina -> Cuadrilla -> Actividades sigue intacto.
- La clave `tarifas` se conserva (buscador y accesos la usan) y se muestra como "🧾 Tarifas de Servicios y Clientes": Secado como Servicio (granel/saco), Tarifario de Servicios, Empaque/sacos, Procesos (Seleccion/Envejecido) y Tarifas por libra.
- "⛽ Precio del combustible" paso a "⚙️ Operacion y Planta" como tarjeta propia.
- Buscador de ajustes actualizado (Tarifas de pago -> nomina; nuevas entradas Secado como Servicio y Combustible). Puesta en marcha tiene botones Nomina y Servicios.
- El cobro dinamico por empaque de botada ya estaba hecho en la entrada anterior (tarifa granel vs saco); la CxC sigue con `reference_type='secado_service'`.
- Verificaciones: frontend build y lint con 0 errores.

### Tarifa de secado como servicio: A granel vs En saco (2026-09-24)

- Nueva columna `labor_rates.secado_servicio_saco_per_qq` (migracion `20261032_secado_servicio_saco.sql`, aditiva e idempotente; tambien en `ensureLaborTables`). Arranca con el MISMO valor de granel en cada fila (maestro y socios), asi ningun cobro cambia hasta editarla.
- Configuracion -> Tarifas y Servicios de Planta -> Secado como Servicio: `Secado A Granel / Directo a Produccion ($ x QQ)` (= `secado_servicio_per_qq`, renombrado solo en UI) y nuevo `Secado En Saco ($ x QQ)`.
- `PUT /labor/rates`: el campo nuevo es OPCIONAL y se guarda con `COALESCE` (un cliente que no lo mande no lo borra). Se clona a los overrides por socio y `getRates` lo expone.
- `autoCobrarSecadoServicio`: tuneles deciden por `botada_empaque` (Empaque de botada/vaciado); Tendal por `recepcion_empaque` (su modo Granel/Ensacado; su botada siempre trae TULAS por defecto). SACOS -> tarifa saco (si es 0 usa granel); resto -> granel. La descripcion de la CxC dice `(a granel)` / `(en saco)`.
- El cobro automatico Secado+Pilado ya NO usa esta tarifa (`secadoRate = 0` en processing.ts); se corrigio la nota de la UI que decia lo contrario. El cobro manual de Solo Secado (cobros.ts) sigue sugiriendo la de granel.
- Verificado en BEGIN...ROLLBACK con el tendal real: backfill 1.5 en 3 filas; tendal granel $113.10, tendal saco $169.65 (2.25), tunel botada saco $169.65, tunel botada granel $113.10, saco en 0 usa granel.
- Verificaciones: backend build, 44/44 tests, frontend build.

### Fix: tarifas del cierre de Tendal (cuadrilla vs CxC) (2026-09-24)

- Causa: el campo de Configuracion "Secado en Tendal (Cuadrilla) $ x QQ" (`labor_rates.tendal_per_qq`, $2.00) se guardaba pero el backend lo IGNORABA; a granel pagaba con la actividad del catalogo "SECADO EN TENDAL" ($1.50), que coincidia con la tarifa de servicio y parecia un cruce.
- `registrarPagoCuadrillaTendal`: a granel usa `getRates(...).tendal_per_qq` (efectivo por socio) si es > 0; si esta en 0 conserva la tarifa del catalogo (compatibilidad). Ensacado sigue por saco con "TENDAL POR SACO".
- CxC (`autoCobrarSecadoServicio`) sigue con `secado_servicio_per_qq`. NO se cambio `reference_type='secado_service'` (lo usan la dedup del cobro manual en cobros.ts y el listado de lotes por cobrar en lots.ts); el origen se indica en la descripcion: "Servicio de Secado en Tendal - Lote ...".
- Invariante: un lote SOLO SECADO con tarifa de servicio en $0 ya no se finaliza (400) y todo se revierte; antes se pagaba al personal y se saltaba la CxC en silencio. Aplica a tuneles y tendal.
- Atomicidad: alta (`/drying-tendal`) y edicion (`PUT /drying/:id`) corren en `inTransaction`; CxC y nomina usan el mismo client.
- Verificado en BEGIN...ROLLBACK sobre el tendal real: granel cuadrilla $150.80 (2.00) + CxC $113.10 (1.50); ensacado $100 (2.00 x 50 sacos); sin tarifa de servicio rechaza y no deja pago. El pago YA registrado de ese tendal quedo en $1.50 ($113.10) por el bug.
- Verificaciones: backend build, 44/44 tests.

### Edicion segura e interes fijo de Fomentos (2026-09-24)

- La caja permanente de `Interes fijo del saldo arrastrado` salio de la vista principal; ahora se abre desde `Ajustar interes fijo` en un modal compacto, conservando el mismo endpoint y calculo.
- Editar `Fecha Inicio` actualiza dentro de la misma transaccion las entregas dinamicas vinculadas a la fecha inicial anterior; las entregas posteriores con fecha propia y los saldos de meses fijos no se alteran.
- El detalle devuelto por el PATCH vuelve a calcular inmediatamente dias, meses, interes y deuda mediante `SELECT_FOMENTO`.
- Un fomento `CERRADO_LIQUIDACION` conserva su estado al editar: el frontend lo muestra bloqueado y no envia un cambio de estado; el backend tambien descarta cualquier intento de reabrirlo.
- Revision visual sin escrituras sobre el fomento archivado de Junior Jimenez: boton/modal visibles y estado `ARCHIVADO (estado protegido)` deshabilitado.
- Verificaciones: backend/frontend build, 44/44 tests, lint con 0 errores y preflight sin errores criticos.

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
