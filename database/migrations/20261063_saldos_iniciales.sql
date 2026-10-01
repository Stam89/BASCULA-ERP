-- SALDOS INICIALES (arranque con datos reales). Los cortes son a FIN DE MES:
-- lo que la empresa tenía al cierre (CxC, CxP, inventario de arroz/cáscara y
-- anticipos) se carga a mano, fechado al último día de ese mes y SIN mover la
-- caja. Cada registro queda en esta tabla (auditoría y anulación) y apunta a la
-- fila real que crea en su módulo (accounts_receivable, accounts_payable,
-- inventory_movements, farmer_advances). Aditiva e idempotente.
CREATE TABLE IF NOT EXISTS saldos_iniciales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accionista_id UUID REFERENCES accionistas(id),
  -- CXC | CXP | INVENTARIO | ANTICIPO
  tipo VARCHAR(20) NOT NULL,
  corte DATE NOT NULL,
  -- CLIENTE | AGRICULTOR | PROVEEDOR | SOCIO (CxC, CxP y anticipos)
  contraparte_tipo VARCHAR(20),
  contraparte_nombre VARCHAR(200),
  monto NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Inventario: quintales y costo por quintal (referencial).
  cantidad NUMERIC(14,3),
  costo_unitario NUMERIC(14,4),
  product_id UUID REFERENCES products(id),
  detalle TEXT,
  ref_tabla VARCHAR(40),
  ref_id UUID,
  -- La otra cara: cuenta espejo del socio, o el lote de la cáscara.
  ref2_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  anulado_at TIMESTAMPTZ,
  anulado_motivo TEXT
);
CREATE INDEX IF NOT EXISTS idx_saldos_iniciales_accionista ON saldos_iniciales (accionista_id, tipo);

-- La cáscara seca del saldo inicial entra como un LOTE propio (sin tickets de
-- báscula) para poder pilarla en Producción («Lote de arroz seco (bodega)»).
ALTER TABLE lots ADD COLUMN IF NOT EXISTS saldo_inicial BOOLEAN NOT NULL DEFAULT false;
