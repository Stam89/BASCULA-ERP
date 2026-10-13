-- Transporte y Cosechadora (pedido del dueño 2026-10-13):
--  1) TARIFAS POR CLIENTE: precio por QQ de cosecha y de flete propio de cada cliente, y una
--     tarifa general para los que no tienen la suya. Al «Generar cobro» de un parte el precio
--     sale solo (se puede cambiar). NULL = sin tarifa (se escribe a mano como antes).
--  2) DOCUMENTOS DE LA FLOTA: matrícula, SOAT, revisión técnica, seguro, permisos… con fecha
--     de vencimiento; avisan en Hoy y en las alertas de Transporte.
-- Aditiva e idempotente.
ALTER TABLE campo_clientes ADD COLUMN IF NOT EXISTS tarifa_cosecha_qq NUMERIC(12,4);
ALTER TABLE campo_clientes ADD COLUMN IF NOT EXISTS tarifa_flete_qq NUMERIC(12,4);
DO $$ BEGIN
  ALTER TABLE campo_clientes ADD CONSTRAINT campo_clientes_tarifas_positivas
    CHECK ((tarifa_cosecha_qq IS NULL OR tarifa_cosecha_qq > 0) AND (tarifa_flete_qq IS NULL OR tarifa_flete_qq > 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS campo_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nombre_operacion VARCHAR(60) NOT NULL DEFAULT 'Campo',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO campo_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE campo_config ADD COLUMN IF NOT EXISTS tarifa_cosecha_qq NUMERIC(12,4);
ALTER TABLE campo_config ADD COLUMN IF NOT EXISTS tarifa_flete_qq NUMERIC(12,4);

CREATE TABLE IF NOT EXISTS campo_documentos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activo_id   UUID NOT NULL REFERENCES campo_activos(id) ON DELETE CASCADE,
  tipo        VARCHAR(20) NOT NULL CHECK (tipo IN ('matricula', 'soat', 'revision', 'seguro', 'permiso', 'otro')),
  descripcion VARCHAR(120),
  numero      VARCHAR(60),
  vence       DATE NOT NULL,
  notas       TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campo_documentos_vence ON campo_documentos(vence);
CREATE INDEX IF NOT EXISTS idx_campo_documentos_activo ON campo_documentos(activo_id);

-- DOWN (manual):
--   DROP TABLE IF EXISTS campo_documentos;
--   ALTER TABLE campo_config DROP COLUMN IF EXISTS tarifa_cosecha_qq, DROP COLUMN IF EXISTS tarifa_flete_qq;
--   ALTER TABLE campo_clientes DROP COLUMN IF EXISTS tarifa_cosecha_qq, DROP COLUMN IF EXISTS tarifa_flete_qq;
