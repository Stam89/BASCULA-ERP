-- Ciclo completo de cuadrilla en Secadoras: además del LLENADO (Recepción a
-- Túnel) ahora también el VACIADO (Botada/Sacado de Túnel). La asignación de
-- cuadrilla por túnel se distingue por momento. Aditiva y reversible.
ALTER TABLE drying_tunnel_cuadrilla
  ADD COLUMN IF NOT EXISTS momento VARCHAR(12) NOT NULL DEFAULT 'LLENADO'; -- LLENADO | VACIADO

-- Una cuadrilla por túnel y por momento (llenado/vaciado). Reemplaza el índice
-- que solo consideraba (túnel, trabajador).
DROP INDEX IF EXISTS uq_drying_tunnel_cuadrilla;
CREATE UNIQUE INDEX IF NOT EXISTS uq_drying_tunnel_cuadrilla
  ON drying_tunnel_cuadrilla (drying_report_id, momento, lower(btrim(worker_name)));

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS uq_drying_tunnel_cuadrilla;
--   CREATE UNIQUE INDEX uq_drying_tunnel_cuadrilla ON drying_tunnel_cuadrilla (drying_report_id, lower(btrim(worker_name)));
--   ALTER TABLE drying_tunnel_cuadrilla DROP COLUMN IF EXISTS momento;
--   DELETE FROM schema_migrations WHERE filename = '20260912_cuadrilla_vaciado.sql';
