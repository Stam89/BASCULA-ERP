-- 🚜 Cosechadora descontada en una liquidación cuando su parte aún no está ingresada (pedido del dueño 2026-11-25): el
-- parte nace con la máquina «POR ASIGNAR» y se completa después en Transporte (máquina y operador).
ALTER TABLE campo_activos ADD COLUMN IF NOT EXISTS por_asignar BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_campo_activos_por_asignar ON campo_activos (tipo) WHERE por_asignar;
-- 🌱 Por qué no se descontó el fomento en esa liquidación (el arroz era de un pariente, etc.).
ALTER TABLE liquidations ADD COLUMN IF NOT EXISTS nota_fomento TEXT;
