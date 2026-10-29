-- 📦 «Lotes guardados» (Reportes) también para la cáscara seca del SALDO INICIAL (pedido del dueño 2026-10-29: los
-- lotes de septiembre por pilar no aparecían para ponerles ubicación). Mismas columnas que drying_tunnel_reports.
-- Aditiva e idempotente.
ALTER TABLE lots ADD COLUMN IF NOT EXISTS apartado_arianos BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE lots ADD COLUMN IF NOT EXISTS apartado_at TIMESTAMPTZ;
ALTER TABLE lots ADD COLUMN IF NOT EXISTS ubicacion_arianos VARCHAR(160);
