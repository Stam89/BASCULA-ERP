-- Campos informativos del fomento capturados en el formulario:
--   · variedad        → variedad de grano (texto libre)
--   · limite_credito  → límite de crédito manual, SOLO referencial. NO cambia el
--                       cálculo del crédito (monto_limite sigue siendo cuadras*800
--                       en la vista SELECT_FOMENTO), ni la habilitación/falta por
--                       pedir. Aditivo, nullable; filas existentes quedan en NULL.
ALTER TABLE fomentos
  ADD COLUMN IF NOT EXISTS variedad TEXT,
  ADD COLUMN IF NOT EXISTS limite_credito NUMERIC(12,2);
