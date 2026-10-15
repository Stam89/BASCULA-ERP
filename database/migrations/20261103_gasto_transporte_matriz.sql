-- GASTO DE TRANSPORTE PAGADO CON LA CAJA DE LA MATRIZ (Caja → Trabajo en un equipo, pedido del dueño 2026-10-15).
-- La plata sale de la caja de CEYRO pero el gasto es de Transporte y Cosechadora:
--   · Transporte: campo_cxp (acreedor = la Matriz, origen GASTO_PAGADO_MATRIZ) = su gasto + su deuda con la Matriz,
--     y el registro en la hoja de vida de la máquina (campo_mantenimientos).
--   · Matriz: su egreso de caja (GASTO_DE_TRANSPORTE, no es costo operativo suyo) y su Por Cobrar espejo
--     (accounts_receivable reference_type 'campo_cxp').
--   · Si la Matriz le debía a Transporte (fletes/cosechas), se cruza solo (cuenta interna CRUCE PILADORA).
-- Aditiva e idempotente.

ALTER TABLE campo_mantenimientos ADD COLUMN IF NOT EXISTS cxp_id UUID REFERENCES campo_cxp(id);
ALTER TABLE campo_mantenimientos ADD COLUMN IF NOT EXISTS compensacion_id UUID REFERENCES campo_compensaciones(id);

-- Un mantenimiento con costo podía salir solo de una cuenta de Transporte (cuenta + movimiento). Ahora también
-- puede haberlo pagado la Matriz: costo > 0 enlazado a su deuda (cxp_id), sin cuenta ni movimiento de Transporte.
ALTER TABLE campo_mantenimientos DROP CONSTRAINT IF EXISTS campo_mantenimientos_check2;
ALTER TABLE campo_mantenimientos DROP CONSTRAINT IF EXISTS campo_mantenimientos_costo_origen_chk;
ALTER TABLE campo_mantenimientos ADD CONSTRAINT campo_mantenimientos_costo_origen_chk CHECK (
  (costo = 0 AND cuenta_id IS NULL AND movimiento_id IS NULL)
  OR (costo > 0 AND cuenta_id IS NOT NULL AND movimiento_id IS NOT NULL)
  OR (costo > 0 AND cxp_id IS NOT NULL AND cuenta_id IS NULL AND movimiento_id IS NULL)
);

INSERT INTO cash_categories (codigo, nombre, tipo, aplicable_a, activo)
SELECT 'GASTO_DE_TRANSPORTE', 'Gasto de Transporte pagado por la Matriz', 'EGRESO', 'MATRIZ', false
 WHERE NOT EXISTS (SELECT 1 FROM cash_categories WHERE codigo = 'GASTO_DE_TRANSPORTE');

-- Saldo de la Por Cobrar espejo de la Matriz = saldo de esa deuda en Transporte.
CREATE OR REPLACE FUNCTION campo_sincronizar_cxc_de_cxp(p_cxp UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_monto NUMERIC;
  v_pagado NUMERIC;
BEGIN
  SELECT c.monto,
         COALESCE((SELECT SUM(m.monto) FROM campo_movimientos m WHERE m.cxp_id = c.id AND m.signo = 'salida'), 0)
    INTO v_monto, v_pagado
    FROM campo_cxp c WHERE c.id = p_cxp;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE accounts_receivable
     SET balance = GREATEST(0, ROUND(v_monto - v_pagado, 2)),
         status = (CASE WHEN v_monto - v_pagado <= 0.005 THEN 'PAID'
                        WHEN v_pagado > 0 THEN 'PARTIAL'
                        ELSE 'CONFIRMED' END)::document_status
   WHERE reference_type = 'campo_cxp' AND reference_id = p_cxp AND status <> 'CANCELLED';
END;
$$;

-- Cualquier abono a esa deuda en Transporte (cruce o pago) se refleja en la Matriz. Si Transporte le paga
-- con dinero (no con el cruce), ese dinero ENTRA a la caja abierta de la Matriz.
CREATE OR REPLACE FUNCTION campo_movimientos_espejo_cxc_cxp() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_ar RECORD;
  v_caja UUID;
  v_cuenta TEXT;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.cxp_id IS NOT NULL THEN
    PERFORM campo_sincronizar_cxc_de_cxp(OLD.cxp_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.cxp_id IS NOT NULL THEN
    PERFORM campo_sincronizar_cxc_de_cxp(NEW.cxp_id);
  END IF;
  IF TG_OP = 'INSERT' AND NEW.signo = 'salida' AND NEW.cxp_id IS NOT NULL THEN
    SELECT ar.id, ar.accionista_id, ar.description INTO v_ar
      FROM accounts_receivable ar
     WHERE ar.reference_type = 'campo_cxp' AND ar.reference_id = NEW.cxp_id
     LIMIT 1;
    IF FOUND THEN
      SELECT nombre INTO v_cuenta FROM campo_cuentas WHERE id = NEW.cuenta_id;
      IF COALESCE(v_cuenta, '') <> 'CRUCE PILADORA' THEN
        SELECT id INTO v_caja FROM cash_registers
         WHERE accionista_id = v_ar.accionista_id AND status = 'OPEN'
         ORDER BY (tipo = 'EFECTIVO') DESC, opened_at DESC LIMIT 1;
        IF v_caja IS NOT NULL AND NEW.monto > 0 THEN
          INSERT INTO cash_movements (cash_register_id, movement, category, reference_type, reference_id, amount, description)
          VALUES (v_caja, 'INCOME', 'COBRO_CREDITO', 'accounts_receivable', v_ar.id, NEW.monto,
                  'Transporte y Cosechadora pagó — ' || COALESCE(v_ar.description, 'gasto pagado por la Matriz'));
        END IF;
        INSERT INTO notificaciones (accionista_id, tipo, titulo, mensaje, monto, referencia_tipo, referencia_id)
        VALUES (v_ar.accionista_id, 'COBRO', 'Transporte y Cosechadora te pagó',
                'Se registró un pago de $' || to_char(NEW.monto, 'FM999999990.00') || ' por ' ||
                COALESCE(v_ar.description, 'un gasto pagado por la Matriz') || '.',
                NEW.monto, 'accounts_receivable', v_ar.id);
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_campo_movimientos_espejo_cxc_cxp ON campo_movimientos;
CREATE TRIGGER trg_campo_movimientos_espejo_cxc_cxp
  AFTER INSERT OR UPDATE OR DELETE ON campo_movimientos
  FOR EACH ROW EXECUTE FUNCTION campo_movimientos_espejo_cxc_cxp();
