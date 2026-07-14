-- 1) Enlaza el ticket de báscula importado con el lote que se crea a partir de
-- él, para poder meter esos pesos al proceso (secado → pilado → inventario) y
-- evitar crear el lote dos veces.
ALTER TABLE mobile_synced_tickets ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES lots(id);

-- 2) El servicio de pilado también se le cobra a clientes externos (que no son
-- accionistas). Se identifican por nombre y solo generan cuenta por cobrar para
-- CEYRO (no cuenta por pagar de un accionista).
ALTER TABLE pilado_services ALTER COLUMN client_accionista_id DROP NOT NULL;
ALTER TABLE pilado_services ADD COLUMN IF NOT EXISTS client_name VARCHAR(160);
