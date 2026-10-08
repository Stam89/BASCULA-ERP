-- Anular el pago de nómina de un operador (Transporte y Cosechadora): queda constancia en el propio pago,
-- y se guardan los vales que ese pago descontó para poder devolverlos a «pendiente de rendición». Aditivo e idempotente.
ALTER TABLE campo_nomina_pagos ADD COLUMN IF NOT EXISTS anulado_at timestamptz;
ALTER TABLE campo_nomina_pagos ADD COLUMN IF NOT EXISTS anulado_por uuid;
ALTER TABLE campo_nomina_pagos ADD COLUMN IF NOT EXISTS anulado_motivo text;
ALTER TABLE campo_nomina_pagos ADD COLUMN IF NOT EXISTS vale_ids uuid[];
