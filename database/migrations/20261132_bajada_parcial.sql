-- 🚚 Bajada de carro PARCIAL (pedido del dueño 2026-10-30): p. ej. una volqueta que se vacía sola pero uno de los
-- chicos ayudó a bajar una parte. bajada_qq = QQ que se pagan de bajada en ese ticket (NULL = todo el ticket).
ALTER TABLE mobile_synced_tickets ADD COLUMN IF NOT EXISTS bajada_qq NUMERIC(12,2);
