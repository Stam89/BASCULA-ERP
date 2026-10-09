# Cierre de mes — qué hacer el último día

Los cortes del negocio son a **fin de mes** (día 1 al último día). Ensayado sobre la copia el 2026-10-08
(simulacro `backend/scripts/simulacro/cierre_mes.mjs`).

## Antes del primer cierre (una sola vez)

1. **Saldos iniciales al 30/09** — Configuración → 📥 Saldos iniciales (CxC, CxP, inventario, anticipos).
2. **Parámetros contables de cada accionista** — Configuración → Contabilidad:
   - *Precio de referencia por QQ* de cáscara: sin liquidaciones ni este precio, la cáscara en bodega vale $0 en el balance.
   - *Capital social* y *fecha de inicio contable* (CEYRO ya tiene 01/10; ROVINSON y STALYN no). Sin capital,
     todo el patrimonio aparece como «Ajuste de apertura».

## El último día del mes (al terminar la jornada)

1. Registrar todo lo del día: ventas, cobros, pagos, gastos, nómina, liquidaciones.
2. Revisar **Configuración → Control de integridad**: debe decir 0 problemas.
3. Revisar **Por Cobrar** y **Por Pagar** de cada accionista (las deudas entre socios deben ser iguales en los dos lados).
4. Cerrar la caja (el balance la sigue contando con su saldo final).
5. **Estados Financieros → 📸 Cerrar mes** (solo administrador): guarda la foto de TODOS los socios (balance,
   estado de resultados, flujo, indicadores, activos fijos, Por Cobrar, Por Pagar, inventario y el Resultado mensual
   de CEYRO). Lo cerrado no cambia aunque después se corrija algo; cada socio tiene «⬇ Excel» del cierre.
   Si el control de integridad tiene avisos, los muestra y pide confirmar. Para corregir: «Anular este cierre» (con
   motivo) y volver a cerrar. El primer cierre real es **octubre 2026**.
6. Opcional, además del cierre: sacar con desde = día 1 y hasta = último día:
   - **Estados Financieros** → exportar Excel (balance, estado de resultados, flujo de caja).
   - **Costos Operativos → Resultado mensual** (CEYRO).
   - **Transporte y Cosechadora → Estado de resultados** del mes.
   - **Fomentos → Intereses ganados** del mes.

## Qué sale «a la fecha» y qué con saldo de hoy

- Caja, bancos e inventario del balance salen **a la fecha del corte** (se puede sacar después).
- Cuentas por cobrar, por pagar y anticipos salen con el **saldo de hoy**: por eso el balance del cierre
  conviene exportarlo **el mismo último día** (la pantalla lo avisa si la fecha es anterior a hoy).

## Cómo calcula el Estado de Resultados (desde 2026-10-08)

- Ventas = pedidos/ventas (sin anuladas) + venta al detalle de Caja.
- Servicios = cobros de servicios que nacieron en el período (pilado, secado, sacos, empaque, cobros de la Matriz).
- Costo de ventas = QQ vendidos × costo del producto terminado + combustible de secado + servicios recibidos
  (pilado, empaque, selección y fletes de Transporte de ventas/envejecido).
- Gastos y mano de obra = egresos de Caja del período, sin anulados ni pagos que no son gasto
  (compra de cáscara, fomentos, pagos entre socios, activos fijos…). Es el mismo criterio del Resultado mensual.
