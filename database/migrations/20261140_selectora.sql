-- 🧹 Selectora de la piladora (pedido del dueño 2026-11-06): la máquina es de una persona externa que cobra por QQ pilado.
-- De lo que se cobra al socio sale su parte (el socio le queda debiendo a esa persona); con arroz de un cliente o propio,
-- la cuenta queda a la Matriz.
CREATE TABLE IF NOT EXISTS selectora_tarifas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES external_providers(id),
  precio_por_qq NUMERIC(10,4) NOT NULL CHECK (precio_por_qq >= 0),
  fecha_vigencia DATE NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS selectora_tarifas_por_fecha ON selectora_tarifas (fecha_vigencia);

CREATE TABLE IF NOT EXISTS selectora_cargos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processing_batch_id UUID NOT NULL REFERENCES processing_batches(id),
  lot_id UUID REFERENCES lots(id),
  provider_id UUID NOT NULL REFERENCES external_providers(id),
  accionista_id UUID NOT NULL REFERENCES accionistas(id),
  quintales NUMERIC(12,3) NOT NULL,
  tarifa_qq NUMERIC(10,4) NOT NULL,
  total NUMERIC(14,2) NOT NULL,
  payable_id UUID NOT NULL REFERENCES accounts_payable(id),
  fecha DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS selectora_cargos_por_proceso ON selectora_cargos (processing_batch_id);
CREATE INDEX IF NOT EXISTS selectora_cargos_payable ON selectora_cargos (payable_id);

-- Lo que le queda a la Matriz va al Resultado mensual en su propio rubro.
INSERT INTO costo_rubros (nombre, costo_estimado_qq, claves, categorias, orden)
SELECT 'Selectora', 0, ARRAY['selectora'], ARRAY[]::text[], 22
WHERE NOT EXISTS (SELECT 1 FROM costo_rubros r WHERE upper(r.nombre) = 'SELECTORA');
