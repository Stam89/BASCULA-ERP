-- Pago a la cuadrilla por LLENADO de túnel ("Recepción a Túnel") basado en el
-- volumen (QQ) del túnel, con soporte de DIVISIÓN: un túnel puede llenarlo más de
-- una cuadrilla (mitad y mitad). La asignación se hace en Secadoras y Nómina la
-- detecta y genera. Aditiva y reversible.

-- Asignación de cuadrilla(s) al llenado de un túnel (drying_tunnel_reports).
-- Una fila por cuadrilla; quintals = QQ que hizo esa cuadrilla en ese túnel.
CREATE TABLE IF NOT EXISTS drying_tunnel_cuadrilla (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drying_report_id  UUID NOT NULL REFERENCES drying_tunnel_reports(id) ON DELETE CASCADE,
  worker_name       VARCHAR(120) NOT NULL,
  activity_id       UUID NOT NULL REFERENCES cuadrilla_activities(id),
  quintals          NUMERIC(14,3) NOT NULL DEFAULT 0,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Una cuadrilla no se repite en el mismo túnel (sin distinguir may/min ni espacios).
CREATE UNIQUE INDEX IF NOT EXISTS uq_drying_tunnel_cuadrilla
  ON drying_tunnel_cuadrilla (drying_report_id, lower(btrim(worker_name)));
CREATE INDEX IF NOT EXISTS idx_drying_tunnel_cuadrilla_report
  ON drying_tunnel_cuadrilla (drying_report_id);

-- El índice de dedupe de la nómina automática debe permitir VARIAS cuadrillas en
-- el mismo túnel/momento (la división). Antes era único por (referencia, momento);
-- ahora incluye el trabajador para que cada cuadrilla tenga su propia fila.
DROP INDEX IF EXISTS uq_cuadrilla_auto_secadora;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cuadrilla_auto_secadora
  ON cuadrilla_entries (referencia_id, momento, lower(btrim(worker_name)))
  WHERE origen = 'SECADORA';

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS uq_cuadrilla_auto_secadora;
--   CREATE UNIQUE INDEX uq_cuadrilla_auto_secadora ON cuadrilla_entries (referencia_id, momento) WHERE origen='SECADORA';
--   DROP TABLE IF EXISTS drying_tunnel_cuadrilla;
--   DELETE FROM schema_migrations WHERE filename = '20260911_cuadrilla_tunel_split.sql';
