-- Relaciona cada Parte Diario con el directorio de Campo para distinguir
-- clientes regulares de Bascula y clientes externos sin depender del nombre.
-- Es aditiva: conserva la columna cliente como instantanea historica legible.
ALTER TABLE campo_partes
  ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES campo_clientes(id) ON DELETE SET NULL;

-- Evita duplicar una misma persona por diferencias de mayusculas o espacios.
CREATE UNIQUE INDEX IF NOT EXISTS uq_campo_clientes_nombre_normalizado
  ON campo_clientes (lower(trim(nombre)));

-- Los partes provenientes de Bascula, o cuyo nombre ya existe en el directorio
-- de agricultores, son clientes regulares de la planta.
INSERT INTO campo_clientes (nombre, tipo, identificacion, telefono)
SELECT DISTINCT ON (lower(trim(p.cliente)))
       trim(p.cliente), 'piladora', f.identification, f.phone
  FROM campo_partes p
  LEFT JOIN farmers f ON lower(trim(f.full_name)) = lower(trim(p.cliente))
 WHERE (p.origen = 'bascula' OR f.id IS NOT NULL)
   AND NOT EXISTS (
     SELECT 1 FROM campo_clientes c
      WHERE lower(trim(c.nombre)) = lower(trim(p.cliente))
   )
 ORDER BY lower(trim(p.cliente)), p.created_at
ON CONFLICT (lower(trim(nombre))) DO NOTHING;

-- Cualquier nombre historico restante fue escrito libremente y se conserva
-- como externo. No se cambia la categoria de clientes que ya existian.
INSERT INTO campo_clientes (nombre, tipo)
SELECT DISTINCT ON (lower(trim(p.cliente))) trim(p.cliente), 'externo'
  FROM campo_partes p
 WHERE NOT EXISTS (
     SELECT 1 FROM campo_clientes c
      WHERE lower(trim(c.nombre)) = lower(trim(p.cliente))
   )
 ORDER BY lower(trim(p.cliente)), p.created_at
ON CONFLICT (lower(trim(nombre))) DO NOTHING;

UPDATE campo_partes p
   SET cliente_id = c.id
  FROM campo_clientes c
 WHERE p.cliente_id IS NULL
   AND lower(trim(c.nombre)) = lower(trim(p.cliente));

CREATE INDEX IF NOT EXISTS idx_campo_partes_cliente_id ON campo_partes (cliente_id);

-- DOWN (reversa manual):
--   DROP INDEX IF EXISTS idx_campo_partes_cliente_id;
--   ALTER TABLE campo_partes DROP COLUMN IF EXISTS cliente_id;
--   DROP INDEX IF EXISTS uq_campo_clientes_nombre_normalizado;
--   DELETE FROM schema_migrations WHERE filename = '20261020_campo_partes_cliente.sql';
