const { Client } = require('pg');
const c = new Client({ connectionString: 'postgres://postgres:1989@localhost:5432/bascula_erp' });
c.connect().then(async () => {
  await c.query(`
    CREATE TABLE IF NOT EXISTS fomentos (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      farmer_name   TEXT NOT NULL,
      farmer_id     UUID REFERENCES farmers(id) ON DELETE SET NULL,
      cuadras       NUMERIC(10,2) NOT NULL DEFAULT 0,
      inicio        DATE NOT NULL,
      cosecha       DATE,
      renta         NUMERIC(5,4) NOT NULL DEFAULT 0.07,
      status        TEXT NOT NULL DEFAULT 'ACTIVOS',
      notes         TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await c.query(`
    CREATE TABLE IF NOT EXISTS fomento_entregas (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      fomento_id  UUID NOT NULL REFERENCES fomentos(id) ON DELETE CASCADE,
      fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
      valor       NUMERIC(12,2) NOT NULL,
      concepto    TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('OK - tablas fomentos creadas');
  c.end();
}).catch(e => { console.error(e.message); c.end(); });
