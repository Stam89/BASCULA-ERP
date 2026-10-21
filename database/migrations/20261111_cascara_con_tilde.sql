-- Nombres de los productos de cáscara con tilde (pedido del dueño 2026-10-21, auditoría). Solo cambia el texto
-- visible: todo el sistema busca estos productos por su CÓDIGO (CASCARA-011 / CASCARA-CORRIENTE), no por el nombre.
-- Idempotente: solo toca los nombres que siguen sin tilde.
UPDATE products SET name = 'Cáscara 0.11' WHERE code = 'CASCARA-011' AND name = 'Cascara 0.11';
UPDATE products SET name = 'Cáscara Corriente' WHERE code = 'CASCARA-CORRIENTE' AND name = 'Cascara Corriente';
