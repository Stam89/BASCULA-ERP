const { Client } = require('pg');
const c = new Client({ connectionString: 'postgres://postgres:1989@localhost:5432/bascula_erp' });
c.connect().then(async () => {
  // Eliminar sacos incorrectos
  await c.query("DELETE FROM sack_inventory WHERE tipo IN ('Saco 50 LB', 'Saco 98 LB', 'Saco PP')");

  // Limpiar tabla
  await c.query("DELETE FROM sack_inventory");

  // Insertar tipos correctos
  const tipos = ['Saco 10 LB', 'Saco 25 LB', 'Saco 100 LB', 'Saco Negro (Polvillo)', 'Saco Usado (Arrocillo)'];
  for (const t of tipos) {
    await c.query(`INSERT INTO sack_inventory (tipo, stock) VALUES ($1, 0)`, [t]);
  }
  console.log('OK - sacos actualizados: 10 LB, 25 LB, 100 LB, Negro (Polvillo), Usado (Arrocillo)');
  c.end();
}).catch(e => { console.error(e.message); c.end(); });
