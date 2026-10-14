-- CRUCE DE CUENTAS ENTRE ACCIONISTAS (pedido del dueño 2026-10-14): la Matriz le debe a un socio y ese
-- socio le debe a la Matriz → se compensa lo que se deben SIN mover caja. Cada cruce baja por igual las
-- dos caras de cada deuda (la Por Cobrar de uno y la Por Pagar espejo del otro). Aquí queda el registro
-- (qué cuentas y cuánto) para verlo y para poder anularlo.
-- Aditiva e idempotente.
CREATE TABLE IF NOT EXISTS cruces_cuentas_socios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accionista_id  UUID NOT NULL REFERENCES accionistas(id),
  contraparte_id UUID NOT NULL REFERENCES accionistas(id),
  monto          NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  -- [{ tabla: 'accounts_receivable'|'accounts_payable', id, monto }] de las 4 caras tocadas.
  detalle        JSONB NOT NULL DEFAULT '[]'::jsonb,
  nota           TEXT,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  anulado_at     TIMESTAMPTZ,
  anulado_motivo TEXT,
  CHECK (accionista_id <> contraparte_id)
);
CREATE INDEX IF NOT EXISTS idx_cruces_cuentas_socios_acc ON cruces_cuentas_socios(accionista_id, contraparte_id);

-- DOWN (manual): DROP TABLE IF EXISTS cruces_cuentas_socios;
