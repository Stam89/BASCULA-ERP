-- PERMISOS POR (OPERADOR, ACCIONISTA)
--
-- Antes los módulos de un operador eran GLOBALES (users.allowed_modules): el
-- mismo set aplicaba a todos los accionistas a los que tenía acceso. Ahora cada
-- vínculo operador↔accionista lleva SUS PROPIOS módulos, para poder decir p.ej.
-- "Juan usa Báscula+Caja en CEYRO, pero solo Báscula en STALYN".
--
-- Decisión: EMPEZAR EN BLANCO. Los operadores quedan sin módulos por accionista
-- (default '{}') hasta que el administrador los reasigne por accionista. Los
-- administradores no usan esto: tienen acceso total siempre.
ALTER TABLE user_accionistas
  ADD COLUMN IF NOT EXISTS allowed_modules TEXT[] NOT NULL DEFAULT '{}';
