-- Un pesaje de báscula no pertenece a ningún accionista: la báscula es
-- compartida y el dueño se decide al crear el lote. Por un fallback anterior,
-- los tickets quedaban marcados con el accionista del usuario que los miraba o
-- vinculaba, lo que los escondía a los demás accionistas (parecía que faltaban
-- números de ticket).
--
-- Se corrige dejando el accionista del ticket igual al de su agricultor (que es
-- la única atribución real); NULL si el agricultor no tiene accionista asignado.
-- No se tocan los tickets que ya generaron un lote: ahí la decisión ya se tomó.
UPDATE mobile_synced_tickets t
SET accionista_id = f.accionista_id
FROM farmers f
WHERE t.farmer_id = f.id
  AND t.lot_id IS NULL
  AND t.accionista_id IS DISTINCT FROM f.accionista_id;

-- Tickets sin agricultor y sin lote: no pueden tener dueño todavía.
UPDATE mobile_synced_tickets
SET accionista_id = NULL
WHERE farmer_id IS NULL AND lot_id IS NULL AND accionista_id IS NOT NULL;
