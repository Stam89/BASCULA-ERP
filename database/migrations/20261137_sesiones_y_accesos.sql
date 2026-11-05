-- 🔐 Revisión de permisos (2026-11-04).
-- sesiones_desde: los tokens firmados antes de esta fecha dejan de valer (cambio de clave o «Cerrar sesiones»).
-- ultimo_ingreso_at: para que el administrador vea quién usa su usuario y quién no.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sesiones_desde TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ultimo_ingreso_at TIMESTAMPTZ;

-- El historial de accesos se filtra por estas columnas.
CREATE INDEX IF NOT EXISTS idx_audit_accesos ON audit_logs (created_at DESC) WHERE table_name = 'auth' OR action = 'DENEGADO';
