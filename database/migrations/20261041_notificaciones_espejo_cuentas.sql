-- ESPEJO COMPLETO DE CUENTAS ENTRE SOCIOS, MATRIZ Y TRANSPORTE + NOTIFICACIONES
-- (aditiva e idempotente).
--
-- 1) notificaciones: avisos dentro del ERP por accionista (campanita). Se crean
--    cuando alguien registra un cobro/pago que afecta la cuenta de otro socio.
-- 2) Transporte y Cosechadora: cuando una liquidación descuenta flete/cosecha de
--    flota PROPIA, Transporte tiene una CxC (campo_servicios) contra el socio que
--    liquidó. Ahora ese socio tiene también su POR PAGAR espejo
--    (accounts_payable reference_type = 'campo_servicio', reference_id = servicio).
--    Un trigger mantiene el saldo de esa Por Pagar = saldo pendiente del servicio
--    en Transporte (cualquier cobro/anulación en Transporte se refleja solo), y
--    al registrarse un cobro en Transporte avisa al socio y saca el dinero de su
--    caja abierta (salvo que el pago haya nacido en el ERP, que ya lo registró).

CREATE TABLE IF NOT EXISTS notificaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accionista_id UUID NOT NULL REFERENCES accionistas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL DEFAULT 'COBRO',
  titulo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  monto NUMERIC(14,2),
  referencia_tipo TEXT,
  referencia_id UUID,
  leida_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notificaciones_accionista ON notificaciones(accionista_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notificaciones_no_leidas ON notificaciones(accionista_id) WHERE leida_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_payable_ref ON accounts_payable(reference_type, reference_id);

-- Liquidación de origen de un servicio de Transporte (flete: origen = liquidación;
-- cosecha: origen = liquidación o su detalle de cosechadora).
CREATE OR REPLACE FUNCTION campo_servicio_liquidacion(p_servicio UUID) RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT l.id FROM campo_servicios s JOIN liquidations l ON l.id = s.origen_id
      WHERE s.id = p_servicio AND s.origen_tipo IN ('liquidacion_flete', 'liquidacion_cosechadora')),
    (SELECT d.liquidation_id FROM campo_servicios s JOIN liquidation_harvest_details d ON d.id = s.origen_id
      WHERE s.id = p_servicio AND s.origen_tipo = 'liquidacion_cosechadora')
  )
$$;

-- Saldo de la Por Pagar espejo = saldo pendiente del servicio en Transporte.
CREATE OR REPLACE FUNCTION campo_sincronizar_cxp(p_servicio UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE accounts_payable ap
     SET balance = GREATEST(0, ROUND(v.saldo_pendiente::numeric, 2)),
         status = (CASE WHEN v.saldo_pendiente <= 0.005 THEN 'PAID'
                        WHEN v.cobrado > 0 THEN 'PARTIAL'
                        ELSE 'CONFIRMED' END)::document_status
    FROM campo_servicios_saldo v
   WHERE v.id = p_servicio
     AND ap.reference_type = 'campo_servicio'
     AND ap.reference_id = p_servicio
     AND ap.status <> 'CANCELLED';
END;
$$;

CREATE OR REPLACE FUNCTION campo_movimientos_espejo_cxp() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_ap RECORD;
  v_caja UUID;
  v_cuenta TEXT;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.servicio_id IS NOT NULL THEN
    PERFORM campo_sincronizar_cxp(OLD.servicio_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.servicio_id IS NOT NULL THEN
    PERFORM campo_sincronizar_cxp(NEW.servicio_id);
  END IF;

  -- Cobro NUEVO registrado en Transporte contra un servicio con Por Pagar espejo.
  IF TG_OP = 'INSERT' AND NEW.signo = 'entrada' AND NEW.servicio_id IS NOT NULL THEN
    SELECT ap.id, ap.accionista_id, ap.description, ap.balance
      INTO v_ap
      FROM accounts_payable ap
     WHERE ap.reference_type = 'campo_servicio' AND ap.reference_id = NEW.servicio_id
     LIMIT 1;
    -- Si el pago nació en el ERP (el socio pagó su Por Pagar), su caja y el aviso
    -- ya se registraron allí: no se duplica.
    IF FOUND AND COALESCE(current_setting('bascula.origen_pago', true), '') <> 'erp' THEN
      SELECT nombre INTO v_cuenta FROM campo_cuentas WHERE id = NEW.cuenta_id;
      -- Un cruce contable (CRUCE PILADORA) no es dinero que salga de la caja del socio.
      IF COALESCE(v_cuenta, '') <> 'CRUCE PILADORA' THEN
        SELECT id INTO v_caja FROM cash_registers
         WHERE accionista_id = v_ap.accionista_id AND status = 'OPEN'
         ORDER BY (tipo = 'EFECTIVO') DESC, opened_at DESC LIMIT 1;
        IF v_caja IS NOT NULL AND NEW.monto > 0 THEN
          INSERT INTO cash_movements (cash_register_id, movement, category, reference_type, reference_id, amount, description)
          VALUES (v_caja, 'EXPENSE', 'PAGO_ENTRE_SOCIOS', 'accounts_payable', v_ap.id, NEW.monto,
                  'Pago a Transporte y Cosechadora — ' || COALESCE(v_ap.description, 'flete/cosecha'));
        END IF;
      END IF;
      INSERT INTO notificaciones (accionista_id, tipo, titulo, mensaje, monto, referencia_tipo, referencia_id)
      VALUES (v_ap.accionista_id, 'COBRO', 'Transporte y Cosechadora registró tu pago',
              'Se registró un cobro de $' || to_char(NEW.monto, 'FM999999990.00') || ' por ' ||
              COALESCE(v_ap.description, 'flete/cosecha') || '. Tu Por Pagar quedó en $' ||
              to_char((SELECT balance FROM accounts_payable WHERE id = v_ap.id), 'FM999999990.00') || '.',
              NEW.monto, 'accounts_payable', v_ap.id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_campo_movimientos_espejo_cxp ON campo_movimientos;
CREATE TRIGGER trg_campo_movimientos_espejo_cxp
  AFTER INSERT OR UPDATE OR DELETE ON campo_movimientos
  FOR EACH ROW EXECUTE FUNCTION campo_movimientos_espejo_cxp();

-- Si se anula el servicio en Transporte (anular liquidación/parte), su Por Pagar
-- espejo desaparece con él.
CREATE OR REPLACE FUNCTION campo_servicios_borrar_cxp() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM accounts_payable WHERE reference_type = 'campo_servicio' AND reference_id = OLD.id;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_campo_servicios_borrar_cxp ON campo_servicios;
CREATE TRIGGER trg_campo_servicios_borrar_cxp
  BEFORE DELETE ON campo_servicios
  FOR EACH ROW EXECUTE FUNCTION campo_servicios_borrar_cxp();

-- Backfill: Por Pagar espejo para los servicios de Transporte que ya existen
-- (nacidos de liquidaciones), con su saldo pendiente real.
INSERT INTO accounts_payable (accionista_id, reference_type, reference_id, description, amount, balance, status)
SELECT l.accionista_id, 'campo_servicio', s.id,
       'Transporte y Cosechadora · ' || CASE WHEN s.tipo = 'cosecha' THEN 'Cosechadora' ELSE 'Flete' END
         || ' · ' || l.liquidation_number,
       s.valor, GREATEST(0, ROUND(v.saldo_pendiente::numeric, 2)),
       (CASE WHEN v.saldo_pendiente <= 0.005 THEN 'PAID' WHEN v.cobrado > 0 THEN 'PARTIAL' ELSE 'CONFIRMED' END)::document_status
FROM campo_servicios s
JOIN campo_servicios_saldo v ON v.id = s.id
JOIN liquidations l ON l.id = campo_servicio_liquidacion(s.id)
WHERE s.origen_tipo IN ('liquidacion_flete', 'liquidacion_cosechadora')
  AND l.accionista_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM accounts_payable ap WHERE ap.reference_type = 'campo_servicio' AND ap.reference_id = s.id
  );
