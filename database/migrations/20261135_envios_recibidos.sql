-- 🔁 Envíos recibidos: si la respuesta del servidor se pierde (datos móviles, reinicio) y la persona vuelve a tocar Guardar,
-- el registro no se duplica: se responde lo mismo que la primera vez. Solo se guardan unos días (ver http/envio-unico.ts).
CREATE TABLE IF NOT EXISTS envios_recibidos (
  id TEXT NOT NULL,
  user_id UUID NOT NULL,
  metodo TEXT NOT NULL,
  ruta TEXT NOT NULL,
  estado_http INT,
  respuesta TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_envios_recibidos_fecha ON envios_recibidos (created_at);
