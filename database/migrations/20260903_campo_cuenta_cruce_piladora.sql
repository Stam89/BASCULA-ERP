-- Cuenta interna de compensación Planta↔Campo. El "cruce de fletes" de una
-- liquidación de la piladora (flete de Flota Propia descontado al agricultor) se
-- asienta como una ENTRADA en esta cuenta contra el servicio por cobrar del
-- cliente-piladora: salda la deuda interna SIN mover CAJA ni BANCO (no es
-- efectivo físico, es una compensación). Aditiva e idempotente.
INSERT INTO campo_cuentas (nombre) VALUES ('CRUCE PILADORA')
ON CONFLICT (nombre) DO NOTHING;

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   DELETE FROM campo_cuentas WHERE nombre = 'CRUCE PILADORA';
--   DELETE FROM schema_migrations WHERE filename = '20260903_campo_cuenta_cruce_piladora.sql';
