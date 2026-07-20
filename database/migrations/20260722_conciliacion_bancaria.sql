-- CONCILIACIÓN BANCARIA
--
-- Cruza lo que el sistema registró (cash_movements de una caja tipo BANCO)
-- contra el extracto que entrega el banco, y explica la diferencia con las
-- partidas conciliatorias clásicas:
--   · Depósitos en tránsito: en libros, todavía no en el banco.
--   · Cheques girados no cobrados: en libros, el banco aún no los debita.
--   · Notas de crédito/débito: en el banco (intereses, comisiones), todavía
--     no registradas en libros.
--
-- No se duplica ningún movimiento: el extracto vive aparte y solo se ENLAZA
-- con los movimientos de caja que ya existen.

-- Datos del banco sobre la caja que ya existe (para el encabezado del reporte).
ALTER TABLE cash_registers
  ADD COLUMN IF NOT EXISTS banco VARCHAR(80),
  ADD COLUMN IF NOT EXISTS numero_cuenta VARCHAR(40);

-- Un extracto = un período de una cuenta bancaria.
CREATE TABLE IF NOT EXISTS bank_statements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cash_register_id UUID NOT NULL REFERENCES cash_registers(id) ON DELETE CASCADE,
  accionista_id UUID REFERENCES accionistas(id),
  periodo_desde DATE NOT NULL,
  periodo_hasta DATE NOT NULL,
  saldo_inicial NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Saldo que declara el banco al cierre: es el que debe cuadrar.
  saldo_final NUMERIC(14,2) NOT NULL DEFAULT 0,
  notas TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cada línea del extracto. El monto va con signo: + entra, − sale.
CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  statement_id UUID NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  referencia VARCHAR(60),
  monto NUMERIC(14,2) NOT NULL,
  -- Movimiento de caja con el que quedó cruzada esta línea (si se cruzó).
  cash_movement_id UUID REFERENCES cash_movements(id) ON DELETE SET NULL,
  -- AUTO: lo cruzó el sistema. MANUAL: lo cruzó una persona.
  match_type VARCHAR(10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un movimiento de caja no puede quedar cruzado con dos líneas del extracto.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_line_movement
  ON bank_statement_lines(cash_movement_id)
  WHERE cash_movement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_statements_caja ON bank_statements(cash_register_id, periodo_hasta DESC);
CREATE INDEX IF NOT EXISTS idx_bank_lines_statement ON bank_statement_lines(statement_id, fecha);
