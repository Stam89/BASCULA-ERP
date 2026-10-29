-- 📅 Fecha desde la que se cobra el gasto administrativo de una entrega de fomento (pedido del dueño 2026-10-29):
-- la entrega tiene su fecha real (p. ej. 29/07) pero el interés «por días» se cuenta desde otra (p. ej. 28/08).
-- NULL = desde la fecha de la entrega (como siempre). Aditiva e idempotente.
ALTER TABLE fomento_entregas ADD COLUMN IF NOT EXISTS fecha_interes DATE;
