-- ✍️ Deuda manual (pedido del dueño 2026-11-26): desde Por Cobrar o Por Pagar se registra un préstamo o una deuda
-- antigua que no nació de Ventas, Fomentos ni Cuentas entre socios. Sin mover la caja. La cuenta vive en
-- accounts_receivable / accounts_payable con reference_type 'deuda_manual' y reference_id = id de esta tabla.
CREATE TABLE IF NOT EXISTS deudas_manuales (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accionista_id      UUID NOT NULL REFERENCES accionistas(id),
  lado               VARCHAR(3) NOT NULL CHECK (lado IN ('CXC', 'CXP')),
  contraparte_tipo   VARCHAR(20) NOT NULL,
  contraparte_id     UUID,
  contraparte_nombre VARCHAR(200) NOT NULL,
  monto              NUMERIC(14, 2) NOT NULL CHECK (monto > 0),
  abonado            NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (abonado >= 0),
  fecha              DATE NOT NULL,
  detalle            TEXT,
  ref_tabla          VARCHAR(40),
  ref_id             UUID,
  created_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  anulado_at         TIMESTAMPTZ,
  anulado_motivo     TEXT,
  CHECK (abonado < monto)
);
CREATE INDEX IF NOT EXISTS idx_deudas_manuales_accionista ON deudas_manuales (accionista_id, created_at DESC);
