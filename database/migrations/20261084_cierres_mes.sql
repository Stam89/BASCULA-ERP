-- 📸 Cierre de mes (pedido del dueño 2026-10-08): foto de los estados financieros de cada accionista al último día del mes.
-- Lo cerrado no cambia aunque después se corrija algo; para volver a cerrar se ANULA el cierre (queda quién, cuándo y por qué).
-- Aditiva e idempotente.
CREATE TABLE IF NOT EXISTS cierres_mes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anio           INT NOT NULL,
  mes            INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  accionista_id  UUID NOT NULL REFERENCES accionistas(id),
  desde          DATE NOT NULL,
  hasta          DATE NOT NULL,
  datos          JSONB NOT NULL,
  integridad     JSONB,
  notas          TEXT,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  anulado_at     TIMESTAMPTZ,
  anulado_motivo TEXT,
  anulado_by     UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cierres_mes_vigente ON cierres_mes (anio, mes, accionista_id) WHERE anulado_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cierres_mes_periodo ON cierres_mes (anio, mes);
