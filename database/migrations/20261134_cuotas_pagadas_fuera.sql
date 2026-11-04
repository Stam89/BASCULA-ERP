-- 🏦 Cuotas de préstamos pagadas por fuera de la caja (pedido del dueño 2026-11-03): antes de usar la app de verdad las
-- cuotas se pagan igual en su día. Bajan la deuda sin mover ninguna caja.
ALTER TABLE prestamo_cuotas ADD COLUMN IF NOT EXISTS pagada_fuera BOOLEAN NOT NULL DEFAULT false;
