-- Resumen diario por correo: un correo al cierre del día con lo que pasó (báscula, secado,
-- caja, ventas) y lo que quedó pendiente. Aditiva e idempotente. NACE APAGADO: no se envía
-- nada hasta que el administrador lo active y elija a qué correos llega.
CREATE TABLE IF NOT EXISTS resumen_diario_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  activo BOOLEAN NOT NULL DEFAULT false,
  hora VARCHAR(5) NOT NULL DEFAULT '20:30',          -- hora de Ecuador, «HH:MM»
  destinatarios TEXT[] NOT NULL DEFAULT '{}',
  ultimo_envio_fecha DATE,                           -- día (Ecuador) del último envío exitoso
  ultimo_envio_at TIMESTAMPTZ,
  ultimo_resultado TEXT,                             -- «OK» o el motivo del último fallo
  intento_fecha DATE,                                -- día de los intentos de hoy (reintentos acotados)
  intentos_hoy INT NOT NULL DEFAULT 0,
  ultimo_intento_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);
INSERT INTO resumen_diario_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
