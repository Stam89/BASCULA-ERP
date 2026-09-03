-- Tipo de empaque por túnel (Tulas vs Sacos) para diferenciar el pago de la
-- cuadrilla cuando se agotan las Tulas (Big Bags) y la corrida se maneja en
-- sacos individuales. Se guarda por momento: Recepción (llenado) y Botada
-- (vaciado) pueden empacarse distinto. NO altera pesos ni tickets de báscula:
-- solo cambia qué labor/tarifa se le paga a la cuadrilla en Nómina.
--   TULAS (por defecto) -> labor por QQ ("RECEPCION A TUNEL N" / "BOTADA DE TUNEL").
--   SACOS               -> labor por saco ("ENSACADO" / "SACADO EN SACO").
ALTER TABLE drying_tunnel_reports
  ADD COLUMN IF NOT EXISTS recepcion_empaque TEXT NOT NULL DEFAULT 'TULAS',
  ADD COLUMN IF NOT EXISTS recepcion_sacos   NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS botada_empaque    TEXT NOT NULL DEFAULT 'TULAS',
  ADD COLUMN IF NOT EXISTS botada_sacos      NUMERIC(12,2);
