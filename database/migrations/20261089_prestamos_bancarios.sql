-- PRÉSTAMOS BANCARIOS (pedido del dueño 2026-10-12: «tengo préstamos en el banco, unos cobran en distinta fecha»).
-- Cada préstamo es de un accionista, con su banco y su TABLA DE CUOTAS (cada una con su fecha de cobro, capital,
-- interés y otros cargos como el seguro). Pagar una cuota mueve la caja (categoría PAGO_PRESTAMO): el capital baja la
-- deuda (Balance → pasivo) y el interés + otros cargos son gasto financiero (Estado de resultados / Resultado mensual).
-- Aditiva e idempotente.
CREATE TABLE IF NOT EXISTS prestamos_bancarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accionista_id UUID NOT NULL REFERENCES accionistas(id),
  banco TEXT NOT NULL,
  numero TEXT,
  descripcion TEXT,
  -- Capital al registrarlo: lo prestado si es nuevo, o lo que falta pagar si ya venía de antes.
  monto NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  tasa_anual NUMERIC(8,4) NOT NULL DEFAULT 0 CHECK (tasa_anual >= 0),
  frecuencia_meses INT NOT NULL DEFAULT 1 CHECK (frecuencia_meses IN (1, 2, 3, 6, 12)),
  -- Día del mes en que el banco cobra (sale de la fecha de la primera cuota).
  dia_pago INT NOT NULL CHECK (dia_pago BETWEEN 1 AND 31),
  -- Ingreso del dinero a la caja cuando el préstamo es nuevo (vacío si ya venía de antes).
  desembolso_movement_id UUID REFERENCES cash_movements(id),
  estado TEXT NOT NULL DEFAULT 'VIGENTE' CHECK (estado IN ('VIGENTE', 'PAGADO', 'ANULADO')),
  notas TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  anulado_at TIMESTAMPTZ,
  anulado_motivo TEXT
);
CREATE INDEX IF NOT EXISTS idx_prestamos_bancarios_acc ON prestamos_bancarios (accionista_id, estado);

CREATE TABLE IF NOT EXISTS prestamo_cuotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestamo_id UUID NOT NULL REFERENCES prestamos_bancarios(id) ON DELETE CASCADE,
  numero INT NOT NULL CHECK (numero > 0),
  fecha_vencimiento DATE NOT NULL,
  capital NUMERIC(14,2) NOT NULL CHECK (capital >= 0),
  interes NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (interes >= 0),
  otros NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (otros >= 0),
  estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'PAGADA')),
  pagado_interes NUMERIC(14,2),
  pagado_otros NUMERIC(14,2),
  pagada_at TIMESTAMPTZ,
  cash_movement_id UUID REFERENCES cash_movements(id),
  UNIQUE (prestamo_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_prestamo_cuotas_venc ON prestamo_cuotas (estado, fecha_vencimiento);

-- Categorías de caja: solo las usa el módulo de préstamos (inactivas = no salen en el formulario de movimientos).
INSERT INTO cash_categories (codigo, nombre, tipo, aplicable_a, activo)
SELECT v.codigo, v.nombre, v.tipo, 'AMBOS', false FROM (VALUES
  ('PAGO_PRESTAMO', 'Pago de cuota de préstamo bancario', 'EGRESO'),
  ('PRESTAMO_RECIBIDO', 'Préstamo bancario recibido', 'INGRESO')
) AS v(codigo, nombre, tipo)
WHERE NOT EXISTS (SELECT 1 FROM cash_categories c WHERE c.codigo = v.codigo);
