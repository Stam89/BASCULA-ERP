-- Módulo Cuadrilla: nómina de la cuadrilla por actividad (estibada, botada de
-- túnel, recepción, arroberos, etc.), cada una con su valor unitario. Reemplaza
-- el Excel manual. La cuadrilla trabaja para toda la planta (compartida entre
-- accionistas), por eso no lleva accionista_id.

CREATE TABLE IF NOT EXISTS cuadrilla_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(120) UNIQUE NOT NULL,
  unit_rate NUMERIC(12,4) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cuadrilla_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_date DATE NOT NULL DEFAULT CURRENT_DATE,
  activity_id UUID REFERENCES cuadrilla_activities(id),
  activity_name VARCHAR(120) NOT NULL,
  worker_name VARCHAR(120) NOT NULL DEFAULT '',
  quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  unit_rate NUMERIC(12,4) NOT NULL DEFAULT 0,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cuadrilla_entries_date ON cuadrilla_entries(work_date);
CREATE INDEX IF NOT EXISTS idx_cuadrilla_entries_worker ON cuadrilla_entries(worker_name);

CREATE TABLE IF NOT EXISTS cuadrilla_advances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  worker_name VARCHAR(120) NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  balance NUMERIC(14,2) NOT NULL,
  concept VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);
CREATE INDEX IF NOT EXISTS idx_cuadrilla_advances_worker ON cuadrilla_advances(worker_name);

-- Catálogo inicial de actividades (tomado del Excel de la cuadrilla).
INSERT INTO cuadrilla_activities (name, unit_rate) VALUES
  ('ARROBEROS', 0.25),
  ('CAMBIO DE SACO', 0.1),
  ('DESEMBARCADO', 0.1),
  ('EMBARQUE Y DESEMBARQUE', 0.2),
  ('ENSACADO', 0.4),
  ('ENSACAR Y ENBODEGAR', 0.5),
  ('ESTIBADA', 0.1),
  ('MEDIO QQ', 0.1),
  ('CAMBIO DE LUGAR', 0.05),
  ('INGRESO AL POZO', 0.2),
  ('INGRESO AL POZO CERCA', 0.1),
  ('LIMPIEZA TUNEL GRANDE', 40),
  ('LLENADO POLVILLO TUNEL', 0.25),
  ('PASADA DE ARROZ', 0.3),
  ('RECALENTADO TENDAL', 1),
  ('RECEPCION A TUNEL 1', 0.1),
  ('RECEPCION A TUNEL 2', 0.1),
  ('RECEPCION A TUNEL 3', 0.1),
  ('RECEPCION ENSACADO', 0.4),
  ('RECEPCION RASTRILLADA', 0.4),
  ('SACADO DE TUNEL', 0.3),
  ('BOTADA DE TUNEL', 0.1),
  ('SACADO DE TUNEL ELEVADOR', 0.2),
  ('REVUELTA', 0.2),
  ('REVUELTA + ARROBERO', 0.4),
  ('SACADA DE LIBRAS', 0.1),
  ('SARANDEAR', 0.35),
  ('TENDAL PARA SEMILLA', 1),
  ('TENDAL POR SACO', 1.5)
ON CONFLICT (name) DO NOTHING;
