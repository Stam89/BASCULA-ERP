-- Precio de compra por defecto por tipo de saco: se usa para autocompletar el
-- "Precio unitario" en Caja → Compra de Sacos (editable). Aditiva e idempotente.
ALTER TABLE sack_inventory
  ADD COLUMN IF NOT EXISTS precio_compra_default NUMERIC(10,4) NOT NULL DEFAULT 0;

-- Valores de referencia iniciales (provisionales; editables desde Inventario). Solo
-- se aplican donde aún está en 0, para no pisar ajustes ya hechos por el usuario.
UPDATE sack_inventory si SET precio_compra_default = v.precio
FROM (VALUES
  ('Saco 10 LB',              0.20),
  ('Saco 25 LB',              0.25),
  ('Saco 50 LB',              0.30),
  ('Saco 98 LB',              0.35),
  ('Saco 100 LB',             0.35),
  ('Saco Negro (Polvillo)',   0.26),
  ('Saco Usado (Arrocillo)',  0.15)
) AS v(tipo, precio)
WHERE si.tipo = v.tipo AND si.precio_compra_default = 0;
