-- "Guardar Proceso" del pilado guardaba un borrador solo en el navegador del
-- equipo (localStorage): no se veía desde otra PC ni quedaba registro. Ahora se
-- guarda en el servidor, por túnel de secado, y queda visible como proceso en
-- curso para el accionista dueño del lote.
CREATE TABLE IF NOT EXISTS milling_drafts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  drying_report_id UUID NOT NULL UNIQUE REFERENCES drying_tunnel_reports(id) ON DELETE CASCADE,
  accionista_id UUID REFERENCES accionistas(id),
  -- Subproductos del pilado (arrocillo 3/4, arrocillo fino, polvillo).
  report JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Presentaciones de arroz pilado: [{ id, presentation, quantityQq }]
  pilado_entries JSONB NOT NULL DEFAULT '[]'::jsonb,
  saved_by UUID,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_milling_drafts_accionista ON milling_drafts(accionista_id);
