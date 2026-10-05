-- Sacos de subproducto de la Matriz («Saco Usado (Arrocillo)» y «Saco Negro
-- (Polvillo)»): son de 100 LB (confirmado por el usuario 2026-10-05). Se crearon
-- sin peso y salían en la columna «Sin peso» del Inventario de Sacos. El descuento
-- al vender los busca por su NOMBRE (tipoSacoEspecial), así que el peso solo
-- cambia dónde se muestran. Idempotente: solo toca los que aún no tienen peso.
UPDATE sack_inventory
   SET peso_lb = 100, updated_at = now()
 WHERE categoria = 'SUBPRODUCTO'
   AND accionista_id IS NULL
   AND peso_lb IS NULL
   AND tipo IN ('Saco Usado (Arrocillo)', 'Saco Negro (Polvillo)');
