-- Guardia semanal del secador. Cada fila representa un día laborable para poder
-- conservar reemplazos a mitad de semana sin alterar días anteriores.

CREATE TABLE IF NOT EXISTS secador_guardias (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accionista_id  UUID NOT NULL REFERENCES accionistas(id) ON DELETE CASCADE,
  work_date      DATE NOT NULL,
  worker_name    VARCHAR(140) NOT NULL,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_secador_guardia_laborable
    CHECK (EXTRACT(ISODOW FROM work_date) BETWEEN 1 AND 5),
  CONSTRAINT uq_secador_guardia_dia UNIQUE (accionista_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_secador_guardias_semana
  ON secador_guardias (accionista_id, work_date DESC);

-- DOWN (reversa manual; no ejecutar si ya se asignaron guardias):
--   DROP TABLE IF EXISTS secador_guardias;
--   DELETE FROM schema_migrations WHERE filename = '20261091_secador_guardia_semanal.sql';
