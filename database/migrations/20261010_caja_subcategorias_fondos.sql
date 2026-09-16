-- Caja Principal: subcategorías con memoria, asociación de mantenimiento
-- (máquina/área) y "Dinero a Rendir Cuentas" (fondos provisionales por liquidar).
--
-- CERO RUPTURAS: todo es ADITIVO. No se toca movement/amount ni el cálculo de
-- saldos, cierre o exportaciones. Las columnas nuevas son nullable / con default
-- y las lee quien las necesite; el resto del sistema las ignora.

-- 1) Columnas nuevas en cash_movements (todas opcionales).
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS subcategoria   TEXT;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS maq_activo     TEXT;   -- Máquina/Activo (mantenimiento)
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS area           TEXT;   -- Área (mantenimiento)
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS es_fondo       BOOLEAN NOT NULL DEFAULT false; -- Fondo a rendir cuentas
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS responsable    TEXT;   -- Empleado que recibe el fondo
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS fondo_estado   TEXT;   -- NULL | 'POR_LIQUIDAR' | 'LIQUIDADO'

-- 2) Memoria de subcategorías escritas a mano en "Registrar Movimiento".
CREATE TABLE IF NOT EXISTS subcategorias_gastos (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre     TEXT NOT NULL,
  categoria  TEXT,                       -- código de la categoría donde se usó (informativo)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Único por nombre normalizado (no duplica "Fletes" / "fletes ").
CREATE UNIQUE INDEX IF NOT EXISTS uq_subcategorias_gastos_nombre
  ON subcategorias_gastos (lower(btrim(nombre)));

-- 3) Categoría "Novedades" (EGRESO) pedida en el dropdown. Aditiva e idempotente.
INSERT INTO cash_categories (codigo, nombre, tipo, aplicable_a, activo)
VALUES ('NOVEDADES', 'Novedades', 'EGRESO', 'MATRIZ', true)
ON CONFLICT (codigo) DO NOTHING;
