-- Los pedidos ya tomados y aún no despachados quedaron sin cuenta por cobrar,
-- porque se registraron antes de que el pedido generara el cobro al momento de
-- tomarse. Sin esto no aparecen en «Por Cobrar» y la deuda del cliente se ve
-- más baja de lo que realmente es.
--
-- Solo se tocan los PENDIENTES sin cuenta: los despachados ya tienen la suya
-- por la venta, y crear otra sería cobrar dos veces.
WITH nuevos AS (
  INSERT INTO accounts_receivable
    (accionista_id, customer_id, reference_type, reference_id, description, amount, balance)
  SELECT o.accionista_id,
         o.customer_id,
         'sales_order',
         o.id,
         'Pedido ' || o.order_number || ' — ' || COALESCE(c.full_name, 'cliente') || ' (pendiente de despacho)',
         o.total_amount,
         o.total_amount
  FROM sales_orders o
  JOIN customers c ON c.id = o.customer_id
  WHERE o.status = 'PENDING'
    AND o.receivable_id IS NULL
    AND o.total_amount > 0
  RETURNING id, reference_id
)
UPDATE sales_orders o
SET receivable_id = n.id
FROM nuevos n
WHERE o.id = n.reference_id;
