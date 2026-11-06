-- 💵 Préstamo al dueño de la selectora (pedido del dueño 2026-11-06): se le descuenta de a poco de lo que CEYRO le debe.
-- El dinero salió de la caja cuando se le entregó: el descuento baja la cuenta y el préstamo, sin mover la gaveta.
CREATE TABLE IF NOT EXISTS prestamo_descuentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote UUID NOT NULL,
  fondo_id UUID NOT NULL REFERENCES cash_movements(id),
  payable_id UUID NOT NULL REFERENCES accounts_payable(id),
  monto NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  anulado_at TIMESTAMPTZ,
  anulado_by UUID
);
CREATE INDEX IF NOT EXISTS prestamo_descuentos_lote ON prestamo_descuentos (lote);
CREATE INDEX IF NOT EXISTS prestamo_descuentos_fondo ON prestamo_descuentos (fondo_id) WHERE anulado_at IS NULL;
CREATE INDEX IF NOT EXISTS prestamo_descuentos_payable ON prestamo_descuentos (payable_id) WHERE anulado_at IS NULL;

-- Un préstamo no es gasto: la selectora ya es costo al nacer la deuda. No se elige en Caja.
INSERT INTO cash_categories (codigo, nombre, tipo, aplicable_a, activo)
SELECT 'PRESTAMO_TERCERO', 'Préstamo a terceros', 'EGRESO', 'AMBOS', false
WHERE NOT EXISTS (SELECT 1 FROM cash_categories c WHERE c.codigo = 'PRESTAMO_TERCERO');

-- Las 3 entregas a JACOBO MACIAS (04 y 05/11/2026) se registraron como gastos varios.
UPDATE cash_movements SET category = 'PRESTAMO_TERCERO'
 WHERE id IN ('c04a147a-2e36-435f-b9ed-9cefc6d99341', '593a069d-dcd1-4aa5-a112-c3d6b7c58730', 'cc4b8b51-e571-455f-a5ed-da3ea939e8bf')
   AND category = 'GASTOS_VARIOS' AND es_fondo AND responsable = 'JACOBO MACIAS';
