-- Tarifas con hasta 3 decimales (ej. $0.334). Casi todas ya eran NUMERIC(x,4);
-- solo quedaban con 2 decimales la tarifa de pilado de planta y los precios de
-- empaque por saco. Ampliar la escala no altera los valores guardados.
ALTER TABLE app_settings ALTER COLUMN tarifa_pilado_qq TYPE NUMERIC(12,4);
ALTER TABLE matriz_packaging_rates ALTER COLUMN precio_saco_10lb TYPE NUMERIC(14,4);
ALTER TABLE matriz_packaging_rates ALTER COLUMN precio_saco_25lb TYPE NUMERIC(14,4);
ALTER TABLE matriz_packaging_rates ALTER COLUMN precio_saco_50lb TYPE NUMERIC(14,4);
