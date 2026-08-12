-- Campo cedula en usuarios (por si se equivocaron al registrar). Opcional.
ALTER TABLE users ADD COLUMN IF NOT EXISTS cedula VARCHAR(20);
