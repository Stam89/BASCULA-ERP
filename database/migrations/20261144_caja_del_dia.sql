-- 📒 Caja del día (pedido del dueño 2026-11-20/23): la hoja se parece a su Excel de caja, un día por página y tres bloques
-- (ingresos, egresos de la piladora, egresos de Transporte). Aditiva e idempotente.

-- Cada renglón tal como lo escribió la cajera. Los movimientos de caja que nacieron de él llevan su renglon_id; los que no
-- mueven la gaveta (fiado, a su fomento, banco, a crédito) también se ven aquí, como las columnas F y G de su Excel.
CREATE TABLE IF NOT EXISTS caja_renglones (
  id UUID PRIMARY KEY,
  cash_register_id UUID NOT NULL REFERENCES cash_registers(id) ON DELETE CASCADE,
  accionista_id UUID NOT NULL REFERENCES accionistas(id),
  fecha DATE NOT NULL,
  bloque VARCHAR(12) NOT NULL CHECK (bloque IN ('INGRESO', 'EGRESO', 'TRANSPORTE')),
  quien TEXT NOT NULL DEFAULT '',
  detalle TEXT NOT NULL DEFAULT '',
  monto NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  -- '' = movió la gaveta. Si no: banco, credito, socio, cuenta (fiado o a su fomento).
  sin_gaveta VARCHAR(12) NOT NULL DEFAULT '',
  flujo VARCHAR(24) NOT NULL,
  -- Lo que se entendió: persona, socio, máquina, «se hizo el», etiquetas para mostrar.
  datos JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- «X reportar Hugo»: se le dio la plata y falta que reporte.
  reportar TEXT,
  reportado_at TIMESTAMPTZ,
  reportado_by UUID,
  reportado_nota TEXT,
  anulado_at TIMESTAMPTZ,
  anulado_by UUID,
  anulado_motivo TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_caja_renglones_dia ON caja_renglones (cash_register_id, fecha);
CREATE INDEX IF NOT EXISTS idx_caja_renglones_reportar ON caja_renglones (cash_register_id) WHERE reportar IS NOT NULL AND reportado_at IS NULL;

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS renglon_id UUID;
CREATE INDEX IF NOT EXISTS idx_cash_movements_renglon ON cash_movements (renglon_id) WHERE renglon_id IS NOT NULL;

-- Conteo de la gaveta por día («13*20»). Solo queda anotado con su diferencia: NO mueve el saldo, igual que en el Excel.
CREATE TABLE IF NOT EXISTS caja_conteos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cash_register_id UUID NOT NULL REFERENCES cash_registers(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  lineas JSONB NOT NULL DEFAULT '[]'::jsonb,
  apartado TEXT NOT NULL DEFAULT '',
  contado NUMERIC(14,2) NOT NULL DEFAULT 0,
  disponible NUMERIC(14,2) NOT NULL DEFAULT 0,
  diferencia NUMERIC(14,2) NOT NULL DEFAULT 0,
  nota TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cash_register_id, fecha)
);

-- Apodos que aprende la hoja: «VELEN PIZA» = BELEN PIZA. Se guardan cuando la cajera elige a la persona de la lista.
CREATE TABLE IF NOT EXISTS caja_apodos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo VARCHAR(16) NOT NULL,
  apodo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  veces INTEGER NOT NULL DEFAULT 1,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tipo, apodo)
);

-- 📅 «Se hizo el»: el día en que se hizo el trabajo, si no es el mismo en que se pagó.
ALTER TABLE equipment_maintenance ADD COLUMN IF NOT EXISTS fecha_trabajo DATE;

-- Máquinas que la cajera nombra en su hoja y faltaban en el catálogo.
INSERT INTO maintenance_categories (kind, area, nombre)
SELECT 'SECTION', v.area, v.nombre
  FROM (VALUES
    ('PILADORA', 'TURBINA POLVILLERA'), ('PILADORA', 'VENTILADOR DE TAMO'), ('PILADORA', 'CARACOL DE POLVILLO'), ('PILADORA', 'ELEVADOR'),
    ('PILADORA', 'CRIBAS'), ('PILADORA', 'GENERADOR'), ('ADMINISTRATIVO', 'CÁMARAS'), ('ADMINISTRATIVO', 'FUMIGADORA'), ('ADMINISTRATIVO', 'HIDROLAVADORA')
  ) AS v(area, nombre)
 WHERE EXISTS (SELECT 1 FROM maintenance_categories a WHERE a.kind = 'AREA' AND a.nombre = v.area)
   AND NOT EXISTS (SELECT 1 FROM maintenance_categories s WHERE s.kind = 'SECTION' AND s.area = v.area AND s.nombre = v.nombre);
