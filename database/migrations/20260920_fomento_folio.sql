-- N.º de Página / Libreta (Folio) del fomento: dónde encontrar la firma física
-- del agricultor en el libro. Solo informativo. Aditiva.
ALTER TABLE fomentos
  ADD COLUMN IF NOT EXISTS folio TEXT;
