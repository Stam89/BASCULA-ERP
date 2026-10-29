-- 📅 Fecha HASTA la que se cobra el gasto administrativo «por días» de una entrega de fomento (pedido del dueño
-- 2026-10-29: la entrega es del 29/07 y se le cobra hasta el 28/08; después no sube). NULL = hasta hoy / hasta la cuenta.
-- Reemplaza a fecha_interes (20261124, «desde»), que no llegó a usarse: queda sin efecto. Aditiva e idempotente.
ALTER TABLE fomento_entregas ADD COLUMN IF NOT EXISTS interes_hasta DATE;
