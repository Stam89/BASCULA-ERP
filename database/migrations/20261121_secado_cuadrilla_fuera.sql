-- 🧺 Secado con la cuadrilla pagada por fuera del sistema (pedido del dueño 2026-10-28: secado del sábado de ROVINSON
-- que se registra después y cuya cuadrilla ya se pagó en el Excel). El pago automático de llenado/botada lo respeta
-- y no vuelve a generarse. Aditiva e idempotente.
ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS cuadrilla_pagada_fuera BOOLEAN NOT NULL DEFAULT false;
