-- 🤝 DINERO ENTRE SOCIOS (pedido del dueño 2026-10-21): un socio le da dinero a la Matriz (o al revés), para abonar lo
-- que debe o como préstamo. Se registra UNA vez y mueve las DOS cajas (sale de la de quien da, entra a la de quien
-- recibe). Primero baja lo que el que da le debía al otro (cruces_entre_socios con el egreso); lo que pase queda como
-- deuda del que recibe ('pago_por_socio', reference_id = el egreso). Aditiva e idempotente.
CREATE TABLE IF NOT EXISTS dinero_entre_socios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  de_id UUID NOT NULL REFERENCES accionistas(id),
  para_id UUID NOT NULL REFERENCES accionistas(id),
  monto NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  medio TEXT,
  nota TEXT,
  mov_de_id UUID REFERENCES cash_movements(id),
  mov_para_id UUID REFERENCES cash_movements(id),
  -- Cuánto bajó de lo que el que dio le debía al otro, y cuánto quedó como préstamo (deuda del que recibió).
  descontado NUMERIC(14,2) NOT NULL DEFAULT 0,
  prestamo NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  anulado_at TIMESTAMPTZ,
  anulado_motivo TEXT,
  CHECK (de_id <> para_id)
);
CREATE INDEX IF NOT EXISTS dinero_entre_socios_par_idx ON dinero_entre_socios (de_id, para_id, created_at DESC);
