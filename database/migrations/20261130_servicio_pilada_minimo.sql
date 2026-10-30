-- ⚖️ Servicio de pilada: cobro mínimo por rendimiento (pedido del dueño 2026-10-30). Al pilarle a un cliente (maquila)
-- se cobran los QQ que salieron, pero nunca menos de (kg de cáscara que entraron ÷ 100) + este porcentaje.
-- Ej.: 2,110 kg → 21.10 + 7% = 22.58 QQ. Editable en Configuración › Parámetros de planta.
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS servicio_minimo_pct NUMERIC(5,2) NOT NULL DEFAULT 7;
