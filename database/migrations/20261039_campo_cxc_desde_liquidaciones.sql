-- Los descuentos de Flota Propia y Cosechadora Propia generan una CxC de la
-- operacion Transporte/Cosechadora contra el socio que liquido al agricultor.
-- El par origen_tipo/origen_id evita duplicados en reintentos y backfills.
ALTER TABLE campo_servicios ADD COLUMN IF NOT EXISTS origen_tipo VARCHAR(40);
ALTER TABLE campo_servicios ADD COLUMN IF NOT EXISTS origen_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS ux_campo_servicio_origen
  ON campo_servicios (origen_tipo, origen_id)
  WHERE origen_id IS NOT NULL;

-- Cada socio/matriz debe existir como cliente de Campo para consolidar su CxC.
INSERT INTO campo_clientes (nombre, tipo)
SELECT a.name, 'piladora'
  FROM accionistas a
 WHERE a.is_active = true
ON CONFLICT (lower(trim(nombre))) DO UPDATE SET tipo = 'piladora';

-- Cosechadoras propias historicas: el detalle conserva maquina, QQ y tarifa.
INSERT INTO campo_servicios
  (fecha, cliente_id, activo_id, tipo, qq, precio_unitario, valor, notas,
   created_by, origen_tipo, origen_id)
SELECT l.created_at::date, cc.id, d.activo_id, 'cosecha', d.quintals,
       d.price_per_quintal, d.amount,
       'Cosechadora descontada en ' || l.liquidation_number ||
       ' · Agricultor: ' || f.full_name ||
       CASE WHEN NULLIF(trim(d.provider_name), '') IS NOT NULL
            THEN ' · Equipo: ' || trim(d.provider_name) ELSE '' END,
       l.created_by, 'liquidacion_cosechadora', d.id
  FROM liquidation_harvest_details d
  JOIN liquidations l ON l.id = d.liquidation_id AND l.status <> 'CANCELLED'
  JOIN farmers f ON f.id = l.farmer_id
  JOIN accionistas a ON a.id = l.accionista_id
  JOIN campo_clientes cc ON lower(trim(cc.nombre)) = lower(trim(a.name))
 WHERE d.provider_type = 'propia'
   AND d.activo_id IS NOT NULL
ON CONFLICT (origen_tipo, origen_id) WHERE origen_id IS NOT NULL DO NOTHING;

-- Fletes propios historicos identificables: los cruces existentes prueban que
-- fueron Flota Propia. Versiones antiguas no guardaban activo_id; se usa el
-- primer camion/transporte activo solo para completar la ficha contable.
WITH fletes AS (
  SELECT DISTINCT ON (l.id)
         l.id AS liquidation_id, l.created_at::date AS fecha, l.created_by,
         l.liquidation_number, l.quintals, f.full_name AS agricultor,
         a.name AS socio, m.monto,
         (SELECT ca.id FROM campo_activos ca
           WHERE ca.activo = true AND ca.tipo IN ('camion','transporte','vehiculo')
           ORDER BY CASE WHEN ca.tipo = 'camion' THEN 0 ELSE 1 END, ca.nombre LIMIT 1) AS activo_id
    FROM campo_movimientos m
    JOIN liquidations l
      ON m.concepto LIKE 'Cruce flete Flota Propia · ' || l.liquidation_number || '%'
    JOIN farmers f ON f.id = l.farmer_id
    JOIN accionistas a ON a.id = l.accionista_id
   WHERE l.status <> 'CANCELLED'
   ORDER BY l.id, m.created_at
)
INSERT INTO campo_servicios
  (fecha, cliente_id, activo_id, tipo, qq, precio_unitario, valor, notas,
   created_by, origen_tipo, origen_id)
SELECT x.fecha, cc.id, x.activo_id, 'flete', x.quintals,
       CASE WHEN x.quintals > 0 THEN round(x.monto / x.quintals, 4) ELSE NULL END,
       x.monto,
       'Flete descontado en ' || x.liquidation_number || ' · Agricultor: ' || x.agricultor,
       x.created_by, 'liquidacion_flete', x.liquidation_id
  FROM fletes x
  JOIN campo_clientes cc ON lower(trim(cc.nombre)) = lower(trim(x.socio))
 WHERE x.activo_id IS NOT NULL
ON CONFLICT (origen_tipo, origen_id) WHERE origen_id IS NOT NULL DO NOTHING;

-- DOWN manual:
--   DELETE FROM campo_servicios WHERE origen_tipo IN ('liquidacion_flete','liquidacion_cosechadora');
--   DROP INDEX IF EXISTS ux_campo_servicio_origen;
--   ALTER TABLE campo_servicios DROP COLUMN IF EXISTS origen_id;
--   ALTER TABLE campo_servicios DROP COLUMN IF EXISTS origen_tipo;
