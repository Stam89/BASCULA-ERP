# Checklist: paso a datos reales / modo producción

Estado (2026-10-07): se trabaja con datos reales pero con `APP_MODE=test` a propósito («marcha blanca»).
**No se cambia a `production` hasta que el dueño lo pida.** Esta lista sirve para ese día y también
para cualquier cambio grande (cargar saldos, borrar datos de prueba, mover el servidor).

## 0. Qué ya está probado (no hace falta repetirlo)

- Restaurar un respaldo funciona: el 2026-10-07 se restauró `bascula-erp_2026-10-08T01-00-02.dump`
  en una base temporal en ~1 s (128 tablas, mismos conteos que la base real; solo difirió un
  registro creado después del respaldo). Se borró la base temporal.
- 197 pruebas automáticas + 14 simulacros (`backend/scripts/simulacro/`) + 29 reglas de consistencia sobre la base real.
- Respaldo automático diario 8:00 PM a OneDrive (`BASCULA-ERP-Backups`, 30 copias).
- Acceso remoto: `https://erp.ceyroerp.com` (túnel Cloudflare → `localhost:4000`).

## 1. Lo que falta de parte del dueño

| # | Dato | Dónde se carga |
|---|------|----------------|
| 1 | Saldos iniciales al corte **30/09/2026** (por cobrar, por pagar, cáscara, inventario, anticipos) y capital social | Configuración → 📥 Saldos iniciales (no mueve la caja) |
| 2 | Cuentas de banco de cada socio (el borrado del 02/10 las eliminó) | Caja → abrir caja tipo Banco; luego Finanzas → Conciliación |
| 3 | Correos de destino del resumen diario (SMTP de Gmail ya está configurado) y correo de cada usuario | Configuración → Resumen diario / Usuarios |
| 4 | Precio real de la piladora externa para selección y envejecimiento (hoy 1.25 / 3.50 provisionales) | Selección → tarifas |
| 5 | Si los socios pagan a CEYRO por secar sus propios lotes (tarifa SECADO $1.50 hoy sin uso) | Decisión |

## 2. Orden recomendado el día del cambio

1. **Respaldo manual ahora** (`RESPALDO-BASCULA.bat`) y confirmar que el archivo nuevo aparece en OneDrive.
2. **Probar ese respaldo** en una base temporal (ver `respaldo-restauracion.md` §4–5): `createdb bascula_erp_restaurada` →
   `pg_restore --no-owner -d bascula_erp_restaurada <archivo>` → comparar conteos → `dropdb`.
3. Cargar los **saldos iniciales** (§1.1) y revisar Estados Financieros: el balance debe cuadrar (Activo = Pasivo + Patrimonio).
4. Abrir las **cuentas de banco** y cargar el primer extracto; la conciliación debe terminar en «Conciliado».
5. En Configuración → **Puesta en marcha**: todos los chequeos en verde (respaldo reciente, matriz, usuarios, correo).
6. Ejecutar `npm run preflight` en `backend/` (sin errores críticos) y, desde el equipo de desarrollo, la batería:
   `npm test` y los simulacros (`node scripts/simulacro/<nombre>.mjs`, todos «TODO OK»). Cada simulacro trabaja sobre una copia.
7. Revisar que **`LLAVE_MAESTRA`** exista en `backend/.env` (la escribe el dueño, mínimo 8 caracteres): sin ella el borrado de datos queda bloqueado.
8. Cambiar `APP_MODE=production` en `backend/.env` **solo con la orden del dueño**, reiniciar el servidor
   (`node dist/server.js` desde `backend/`) y confirmar en Configuración → Estado del sistema: «Modo: Producción».
9. Primer día en producción: abrir cajas, ingresar tickets, cerrar caja y mirar el resumen del día; revisar a las 20:30 que llegue el correo.

## 3. Reglas del dueño que no hay que romper

- Periodos contables: día 1 a fin de mes; los cortes son a **fin de mes**.
- La **cuadrilla es solo de la matriz** (CEYRO); los socios no pagan ni dan anticipos de cuadrilla.
- Selección y envejecimiento los hace una piladora externa: cuenta por pagar por socio, sin tarifa al socio.
- Flete solo en envejecimiento: Transporte y Cosechadora (cuenta por cobrar de Campo) o carro externo (cuenta por pagar).
- Nada se redondea para mostrar; solo los montos en dólares se guardan a centavos.
- Los sacos pueden quedar en negativo a propósito: es la señal de «Sacos por comprar».

## 4. Si algo sale mal después del cambio

1. No registrar encima: avisar al administrador.
2. Pagos mal hechos: nómina de operador → botón **Anular** (Transporte y Cosechadora); sueldo/cuadrilla/otros → anular el movimiento en Caja.
3. Si hay que volver atrás: apagar el servidor, respaldo del estado actual, restaurar en base temporal, verificar, y solo entonces decidir
   (ver `respaldo-restauracion.md`, «Regla de oro»).
4. Cualquier vuelta a `APP_MODE=test` también se hace solo por orden del dueño.

## 5. Más adelante (cuando el dueño lo pida)

- Servidor en la nube o mini PC siempre encendida: hoy la PC del local debe quedar **encendida** y con sesión iniciada para que el celular funcione.
- Que «Borrar datos de prueba» conserve las cuentas de banco.
