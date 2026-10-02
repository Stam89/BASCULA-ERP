-- Recuperación de clave por correo: en el inicio de sesión, «¿Olvidaste tu clave?»
-- envía un código de 6 dígitos al correo de recuperación del usuario (p. ej. su
-- Gmail). Aditiva e idempotente: el correo es opcional (NULL en los usuarios que
-- ya existen) y los códigos se guardan SOLO como hash, con vencimiento, límite de
-- intentos y un solo uso.
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_email VARCHAR(160);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  used_at TIMESTAMPTZ,
  requested_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens (user_id, created_at DESC);
