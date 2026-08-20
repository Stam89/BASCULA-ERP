-- FASE 2 Caja — Catalogo de categorias de movimiento en BD (aditivo).
-- No toca cash_movements ni saldos. 'codigo' mantiene el string estable que se
-- guarda en cash_movements.category (por eso se agrega, ademas del nombre visible).
CREATE TABLE IF NOT EXISTS cash_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo VARCHAR(40) NOT NULL UNIQUE,
  nombre VARCHAR(80) NOT NULL,
  tipo VARCHAR(10) NOT NULL,
  aplicable_a VARCHAR(10) NOT NULL DEFAULT 'AMBOS',
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cash_categories_tipo_chk CHECK (tipo IN ('INGRESO','EGRESO')),
  CONSTRAINT cash_categories_aplic_chk CHECK (aplicable_a IN ('MATRIZ','SOCIO','AMBOS'))
);

-- Seed idempotente (no duplica si ya existe el codigo).
INSERT INTO cash_categories (codigo, nombre, tipo, aplicable_a) VALUES
  ('COBRO_MAQUILA',        'Cobro de Maquila',                'INGRESO', 'MATRIZ'),
  ('SERVICIOS_BASICOS',    'Luz / Energia',                   'EGRESO',  'MATRIZ'),
  ('MANTENIMIENTO_EQUIPO', 'Mantenimiento',                   'EGRESO',  'MATRIZ'),
  ('PAGO_MANO_OBRA',       'Nomina Planta',                   'EGRESO',  'MATRIZ'),
  ('GASTO_OPERATIVO',      'Gastos Generales',                'EGRESO',  'MATRIZ'),
  ('PAGO_AGRICULTOR',      'Pago a Agricultores',             'EGRESO',  'SOCIO'),
  ('FOMENTOS',             'Fomentos',                        'EGRESO',  'SOCIO'),
  ('PAGO_SERVICIO_PILADO', 'Servicio de Pilado',              'EGRESO',  'SOCIO'),
  ('FLETE',                'Servicio de Flete / Movilizacion','EGRESO',  'SOCIO'),
  ('VENTA_MAYOR',          'Venta Mayor',                     'INGRESO', 'SOCIO'),
  ('VENTA_DETALLE',        'Venta Menor',                     'INGRESO', 'SOCIO')
ON CONFLICT (codigo) DO NOTHING;
