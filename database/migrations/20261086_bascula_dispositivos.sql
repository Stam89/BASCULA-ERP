-- Credenciales individuales para tablets de Bascula.
-- El token se entrega una sola vez y aqui solo se conserva su hash SHA-256.
-- La clave DEVICE_SYNC_KEY continua temporalmente como credencial de alta/legado.
CREATE TABLE IF NOT EXISTS bascula_devices (
  device_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  modelo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bascula_devices_activo
  ON bascula_devices (activo)
  WHERE activo = true;
