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

`npm run lint` del frontend conserva 2 errores historicos `no-useless-escape` en `App.tsx` alrededor de la linea 5308 y numerosos warnings anteriores. El ultimo cambio no agrego errores de compilacion.

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

### Cambios inmediatamente anteriores

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
