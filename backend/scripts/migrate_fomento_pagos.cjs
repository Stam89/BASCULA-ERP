const { Client } = require('pg');
const c = new Client({ connectionString: 'postgres://postgres:1989@localhost:5432/bascula_erp' });
c.connect().then(async () => {
  await c.query(`
    CREATE TABLE IF NOT EXISTS fomento_pagos (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      fomento_id     UUID NOT NULL REFERENCES fomentos(id) ON DELETE CASCADE,
      cash_register_id UUID REFERENCES cash_registers(id),
      fecha          DATE NOT NULL DEFAULT CURRENT_DATE,
      valor          NUMERIC(12,2) NOT NULL,
      concepto       TEXT,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('OK - tabla fomento_pagos creada');
  c.end();
}).catch(e => { console.error(e.message); c.end(); });
