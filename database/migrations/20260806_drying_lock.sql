-- Secadoras: bloqueo automático al guardar una edición.
-- Regla de negocio: al presionar "Guardar cambios" en un registro de secadora,
-- el registro queda BLOQUEADO (locked_at / locked_by) y ya no admite más
-- ediciones hasta que un usuario ADMINISTRADOR lo desbloquee
-- (POST /process-flow/drying/:id/unlock).
-- Los registros antiguos quedan con locked_at en NULL (editables) hasta su
-- primera edición: no se ven afectados retroactivamente.
-- La auditoría de quién bloqueó y cuándo queda en locked_at/locked_by y,
-- además, en audit_logs (middleware automático de auditoría de escrituras).

ALTER TABLE drying_tunnel_reports
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS locked_by UUID DEFAULT NULL;

-- Referencia opcional al usuario que bloqueó (sin borrar el registro si el
-- usuario se elimina: por eso ON DELETE SET NULL).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drying_tunnel_reports_locked_by_fkey'
  ) THEN
    ALTER TABLE drying_tunnel_reports
      ADD CONSTRAINT drying_tunnel_reports_locked_by_fkey
      FOREIGN KEY (locked_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;
