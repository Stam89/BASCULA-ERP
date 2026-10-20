-- VERIFICACIÓN DEL ADMINISTRADOR AL ENTRAR DESDE INTERNET (pedido del dueño 2026-10-20: proteger el programa de
-- ataques). Si el administrador entra por erp.ceyroerp.com desde un equipo nuevo, se le envía un código de 6 dígitos a
-- su correo. Los equipos que elige «recordar» quedan como confiables (solo se guarda el hash de su token).
-- Aditiva e idempotente.
CREATE TABLE IF NOT EXISTS login_verificaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  intentos INT NOT NULL DEFAULT 0,
  used_at TIMESTAMPTZ,
  clave_debil BOOLEAN NOT NULL DEFAULT false,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_verif_user ON login_verificaciones (user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS dispositivos_confiables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dispositivos_user ON dispositivos_confiables (user_id);
