-- RESULTADO MENSUAL DE CEYRO: costos operativos por QQ vs estimado, ingresos
-- adicionales y resultado neto (aditiva e idempotente; no altera otros módulos).
--
-- costo_rubros: los rubros de la hoja del usuario con su COSTO ESTIMADO ($/QQ) y
-- las CLAVES con que se reconocen los egresos de Caja (subcategoría, categoría,
-- descripción u origen). Se editan desde el reporte.
CREATE TABLE IF NOT EXISTS costo_rubros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  costo_estimado_qq NUMERIC(10,4) NOT NULL DEFAULT 0,
  claves TEXT[] NOT NULL DEFAULT '{}',
  orden INT NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_costo_rubros_nombre ON costo_rubros (upper(nombre));

-- Montos del mes que el sistema no registra solo: gastos financieros (hipoteca,
-- préstamos, diferidos por avances) e ingresos adicionales (envejecido,
-- selectado, calentado por secar en tendal, etc.).
CREATE TABLE IF NOT EXISTS resultado_mensual_manual (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo CHAR(7) NOT NULL,                    -- 'YYYY-MM'
  seccion TEXT NOT NULL CHECK (seccion IN ('INGRESO', 'FINANCIERO')),
  concepto TEXT NOT NULL,
  monto NUMERIC(14,2) NOT NULL CHECK (monto >= 0),
  nota TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resultado_mensual_manual_periodo ON resultado_mensual_manual (periodo);

-- Rubros iniciales con los costos estimados de la hoja (total $4.27/QQ).
INSERT INTO costo_rubros (nombre, costo_estimado_qq, claves, orden)
SELECT v.nombre, v.est, v.claves, v.orden
FROM (VALUES
  ('Gas',                                  0.35, ARRAY['gas', 'bombona', 'cilindro'], 1),
  ('Diesel',                               0.62, ARRAY['diesel', 'disel'], 2),
  ('Cuadrilla (bajada de camión)',         0.55, ARRAY['cuadrilla', 'cuadrilla_entries', 'bajada', 'lenin'], 3),
  ('Mantenimiento piladora / selector',    0.30, ARRAY['mantenimiento', 'mantenimiento_equipo', 'equipment_maintenance', 'selector'], 4),
  ('Obra civil / Gasto operativo',         0.15, ARRAY['obra civil', 'gasto_operativo', 'gastos generales', 'gasto operativo'], 5),
  ('Repuestos',                            0.20, ARRAY['repuesto', 'repuestos'], 6),
  ('Sueldos',                              0.80, ARRAY['sueldo', 'sueldos', 'admin_salary_payments'], 7),
  ('Guardianía / Secada',                  0.08, ARRAY['guardian', 'guardiania', 'secador', 'secada'], 8),
  ('Cocinera',                             0.07, ARRAY['cocinera', 'cocina'], 9),
  ('Gastos administrativos',               0.10, ARRAY['gastos administrativos', 'administrativo', 'papeleria', 'oficina'], 10),
  ('Alimentación',                         0.10, ARRAY['alimentacion', 'comida', 'almuerzo'], 11),
  ('Saquillo pilado / arrocillo / polvillo', 0.37, ARRAY['saquillo', 'saquillos', 'compra_sacos', 'compra de sacos'], 12),
  ('Vehículo gerencia',                    0.15, ARRAY['vehiculo gerencia', 'gerencia'], 13),
  ('Pilador / Estibador',                  0.25, ARRAY['pilador', 'estibador'], 14),
  ('Servicios básicos',                    0.08, ARRAY['servicios_basicos', 'servicios basicos', 'luz', 'agua', 'internet', 'telefono'], 15),
  ('Gasolina / Montacarga',                0.06, ARRAY['gasolina', 'montacarga'], 16),
  ('Cuadrilla Guayaquil',                  0.04, ARRAY['cuadrilla guayaquil', 'guayaquil'], 17)
) AS v(nombre, est, claves, orden)
WHERE NOT EXISTS (SELECT 1 FROM costo_rubros r WHERE upper(r.nombre) = upper(v.nombre));
