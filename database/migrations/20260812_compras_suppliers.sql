-- FASE 3.1 — Catalogo de proveedores (modulo Compras General).
-- Aditivo: crea la tabla suppliers. No modifica ninguna tabla existente.
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(160) NOT NULL,
  identification VARCHAR(60),
  phone VARCHAR(40),
  email VARCHAR(120),
  address TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_name ON suppliers (lower(name));
