-- Reestructura del modelo real de la piladora:
--   * Lo que sale de la báscula NO es un lote: es un INGRESO DE MATERIA PRIMA
--     (el arroz que trae cada camión).
--   * El LOTE se forma en la SECADORA, agrupando varios de esos ingresos en un
--     túnel. De ahí en adelante el proceso (pilado, inventario, liquidación)
--     sigue trabajando con el lote.

-- 1) Un ingreso de materia prima existe sin lote: el lote llega después, al
--    agruparlo en la secadora.
ALTER TABLE weighing_tickets ALTER COLUMN lot_id DROP NOT NULL;

-- Tipo de arroz del ingreso (viene de la calidad de la báscula: 0.11 / CORRIENTE).
-- Antes vivía solo en el lote, pero el ingreso ya lo trae desde el pesaje.
ALTER TABLE weighing_tickets ADD COLUMN IF NOT EXISTS rice_type VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_weighing_tickets_sin_lote
  ON weighing_tickets(accionista_id) WHERE lot_id IS NULL;

-- 2) El grupo del túnel se arma con INGRESOS DE MATERIA PRIMA (pesajes), no con
--    lotes. Antes la llave era (drying_report_id, lot_id), lo que obligaba a que
--    cada miembro fuera un lote. Se pasa a llave propia y el miembro es el pesaje.
ALTER TABLE drying_tunnel_report_lots ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT uuid_generate_v4();
ALTER TABLE drying_tunnel_report_lots ADD COLUMN IF NOT EXISTS weighing_ticket_id UUID REFERENCES weighing_tickets(id);

ALTER TABLE drying_tunnel_report_lots DROP CONSTRAINT IF EXISTS drying_tunnel_report_lots_pkey;
ALTER TABLE drying_tunnel_report_lots ADD PRIMARY KEY (id);
ALTER TABLE drying_tunnel_report_lots DROP CONSTRAINT IF EXISTS drying_tunnel_report_lots_lot_id_key;
ALTER TABLE drying_tunnel_report_lots ALTER COLUMN lot_id DROP NOT NULL;
ALTER TABLE drying_tunnel_report_lots ALTER COLUMN lot_code DROP NOT NULL;

-- Un mismo ingreso de materia prima no puede entrar en dos grupos de secado.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dtrl_ingreso_unico
  ON drying_tunnel_report_lots(weighing_ticket_id) WHERE weighing_ticket_id IS NOT NULL;

-- 3) El ticket de báscula se enlaza con el ingreso que generó (antes con el lote).
ALTER TABLE mobile_synced_tickets ADD COLUMN IF NOT EXISTS weighing_ticket_id UUID REFERENCES weighing_tickets(id);

-- Los tickets que ya habían generado un "lote" con el modelo anterior quedan
-- enlazados a su ingreso, para no perder el rastro ni duplicarlos.
UPDATE mobile_synced_tickets m
SET weighing_ticket_id = w.id
FROM weighing_tickets w
WHERE w.lot_id = m.lot_id
  AND m.lot_id IS NOT NULL
  AND m.weighing_ticket_id IS NULL;

-- El tipo de arroz de los ingresos ya existentes se toma de su lote.
UPDATE weighing_tickets w
SET rice_type = l.rice_type
FROM lots l
WHERE w.lot_id = l.id AND w.rice_type IS NULL;
