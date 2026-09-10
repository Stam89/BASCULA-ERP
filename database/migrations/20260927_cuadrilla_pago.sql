-- Pago real de la cuadrilla de carga/descarga desde el módulo Nómina → Pagos.
-- Hasta ahora el módulo Cuadrilla solo emitía un Recibo: no registraba el pago
-- en caja ni marcaba nada como pagado, así que su neto salía "pendiente" para
-- siempre. Estas columnas permiten liquidar a una persona (marca sus registros
-- como pagados y guarda de qué caja salió), igual que worker_payments. Aditivo e
-- idempotente; por defecto NULL = no pagado, así el comportamiento previo (todo
-- pendiente) no cambia hasta que se pague.
ALTER TABLE cuadrilla_entries ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE cuadrilla_entries ADD COLUMN IF NOT EXISTS cash_register_id UUID;
CREATE INDEX IF NOT EXISTS idx_cuadrilla_entries_paid ON cuadrilla_entries(paid_at);
