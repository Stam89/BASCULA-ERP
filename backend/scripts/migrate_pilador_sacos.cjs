const { Client } = require('pg');
const c = new Client({ connectionString: 'postgres://postgres:1989@localhost:5432/bascula_erp' });
c.connect().then(async () => {
  // Pilador y estibador en processing_batches
  await c.query(`ALTER TABLE processing_batches ADD COLUMN IF NOT EXISTS pilador_name TEXT`);
  await c.query(`ALTER TABLE processing_batches ADD COLUMN IF NOT EXISTS estibador_name TEXT`);
  // Tabla de tipos de sacos con su inventario
  await c.query(`
    CREATE TABLE IF NOT EXISTS sack_inventory (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tipo        TEXT NOT NULL,
      stock       NUMERIC(10,0) NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await c.query(`
    CREATE TABLE IF NOT EXISTS sack_movements (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sack_id     UUID NOT NULL REFERENCES sack_inventory(id) ON DELETE CASCADE,
      movement    TEXT NOT NULL CHECK(movement IN ('ENTRADA','SALIDA')),
      cantidad    NUMERIC(10,0) NOT NULL,
      concepto    TEXT,
      ref_batch   UUID REFERENCES processing_batches(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Insertar tipos de sacos por defecto si no existen
  const tipos = ['Saco 50 LB','Saco 100 LB','Saco 98 LB','Saco 25 LB','Saco 10 LB','Saco PP'];
  for (const t of tipos) {
    await c.query(`INSERT INTO sack_inventory (tipo, stock) VALUES ($1, 0) ON CONFLICT DO NOTHING`, [t]);
  }
  console.log('OK - pilador_name, estibador_name, sack_inventory, sack_movements creados');
  c.end();
}).catch(e => { console.error(e.message); c.end(); });
