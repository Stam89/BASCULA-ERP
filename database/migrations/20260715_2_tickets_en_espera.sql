-- La app de báscula guarda los pesajes incompletos (a la espera del segundo
-- pesaje) en la colección "ticketsEnEspera" de Firebase, y los pasa a "tickets"
-- cuando se completan. El ERP solo leía los completos, por eso parecía que
-- faltaban números de ticket. Ahora también se traen los que están en espera y
-- se marcan con esta bandera.
ALTER TABLE mobile_synced_tickets ADD COLUMN IF NOT EXISTS en_espera BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_mobile_synced_tickets_en_espera ON mobile_synced_tickets(en_espera);
