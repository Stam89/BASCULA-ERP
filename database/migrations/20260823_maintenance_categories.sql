-- Mantenedores dinámicos para el formulario de Mantenimiento (Caja).
-- Áreas, Secciones/Sistemas y Tipos administrables por el usuario. Aditivo:
-- no toca equipment_maintenance ni sus registros; solo alimenta los <select>.
-- Los valores se siguen guardando como texto en equipment_maintenance
-- (area/section/maintenance_type), así que es 100% retrocompatible.

CREATE TABLE IF NOT EXISTS maintenance_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind VARCHAR(10) NOT NULL,          -- AREA | SECTION | TYPE
  nombre VARCHAR(80) NOT NULL,
  area VARCHAR(40),                    -- solo SECTION: a qué área pertenece
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mc_kind_chk CHECK (kind IN ('AREA','SECTION','TYPE'))
);
-- AREA y TYPE son globales (área NULL): únicos por (kind, nombre).
CREATE UNIQUE INDEX IF NOT EXISTS uq_mc_area_type ON maintenance_categories (kind, nombre)
  WHERE kind IN ('AREA','TYPE');
-- SECTION pertenece a un área: única por (área, nombre).
CREATE UNIQUE INDEX IF NOT EXISTS uq_mc_section ON maintenance_categories (kind, area, nombre)
  WHERE kind = 'SECTION';

-- Los tipos de mantenimiento se guardan en equipment_maintenance.maintenance_type
-- (varchar(20)). Se ensancha a 40 para admitir tipos personalizados un poco más
-- largos sin truncar. Ensanchar un varchar no pierde datos.
ALTER TABLE equipment_maintenance ALTER COLUMN maintenance_type TYPE VARCHAR(40);

-- ── Población inicial (lo que antes era estático en el frontend) ──
INSERT INTO maintenance_categories (kind, nombre) VALUES
  ('AREA','SECADORA'),('AREA','PILADORA'),('AREA','ADMINISTRATIVO'),('AREA','MONTACARGA')
ON CONFLICT DO NOTHING;

INSERT INTO maintenance_categories (kind, nombre) VALUES
  ('TYPE','CORRECTIVO'),('TYPE','PREVENTIVO'),('TYPE','REPUESTO'),('TYPE','MANO_OBRA')
ON CONFLICT DO NOTHING;

INSERT INTO maintenance_categories (kind, area, nombre) VALUES
  ('SECTION','SECADORA','MOTOR 1'),('SECTION','SECADORA','MOTOR 2'),
  ('SECTION','SECADORA','TÚNEL 1'),('SECTION','SECADORA','TÚNEL 2'),('SECTION','SECADORA','TÚNEL 3'),
  ('SECTION','PILADORA','MOTOR'),('SECTION','PILADORA','CILINDRO 1'),('SECTION','PILADORA','CILINDRO 2'),
  ('SECTION','PILADORA','PLAN SISTER'),('SECTION','PILADORA','MOTOR PLAN SISTER'),('SECTION','PILADORA','DESCASCARADOR'),
  ('SECTION','PILADORA','PULIDOR 1'),('SECTION','PILADORA','PULIDOR 2'),('SECTION','PILADORA','BANDEJAS PEQUEÑA'),
  ('SECTION','PILADORA','COSEDORAS'),('SECTION','PILADORA','OTROS'),
  ('SECTION','ADMINISTRATIVO','AIRE ACONDICIONADO'),('SECTION','ADMINISTRATIVO','COMPUTADORAS'),
  ('SECTION','ADMINISTRATIVO','NEVERA PEQUEÑA'),('SECTION','ADMINISTRATIVO','NEVERA GRANDE'),
  ('SECTION','ADMINISTRATIVO','HELERA'),('SECTION','ADMINISTRATIVO','IMPRESORAS'),('SECTION','ADMINISTRATIVO','BÁSCULA'),
  ('SECTION','MONTACARGA','MOTOR'),('SECTION','MONTACARGA','RADIADOR'),('SECTION','MONTACARGA','BATERÍA'),
  ('SECTION','MONTACARGA','TRANSMISIÓN'),('SECTION','MONTACARGA','OTROS')
ON CONFLICT DO NOTHING;
