-- MÓDULO INDEPENDIENTE: Caja de Campo (cosechadora + transporte/fletes).
-- Sin relación con túneles, piladora, ventas ni fomentos. Es aparte.
-- Esta migración SOLO CREA tablas nuevas con prefijo campo_. Es aditiva y no
-- toca ninguna tabla existente. Al final va el bloque DOWN (comentado) que la
-- revierte borrando ÚNICAMENTE estas tablas nuevas.

-- ── Catálogos ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campo_activos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     VARCHAR(140) NOT NULL,
  tipo       VARCHAR(20)  NOT NULL CHECK (tipo IN ('cosechadora', 'transporte')),
  operador   VARCHAR(140),
  activo     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campo_categorias_gasto (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     VARCHAR(60) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campo_cuentas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     VARCHAR(60) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campo_clientes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     VARCHAR(160) NOT NULL,
  tipo       VARCHAR(20) NOT NULL CHECK (tipo IN ('piladora', 'externo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Datos ──────────────────────────────────────────────────────────────────
-- Servicio prestado (cosecha o flete). El valor es SIEMPRE obligatorio:
--   · con qq y precio_unitario → el backend calcula valor = qq * precio_unitario
--   · si no → el usuario ingresa el valor a mano (el flete varía por servicio).
CREATE TABLE IF NOT EXISTS campo_servicios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  cliente_id      UUID NOT NULL REFERENCES campo_clientes(id),
  activo_id       UUID NOT NULL REFERENCES campo_activos(id),
  tipo            VARCHAR(20) NOT NULL CHECK (tipo IN ('cosecha', 'flete')),
  qq              NUMERIC(14,2),
  precio_unitario NUMERIC(14,4),
  valor           NUMERIC(14,2) NOT NULL CHECK (valor >= 0),
  notas           TEXT,
  -- Auditoría: quién lo registró. FK real a users (uuid, igual que el resto del
  -- esquema). SET NULL para no bloquear el borrado de un usuario.
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Movimiento de caja. Un gasto = signo 'salida' + categoria_id. El cobro/abono
-- de un servicio = signo 'entrada' + servicio_id. cobrado/saldo/estado NO se
-- guardan: se derivan sumando estos movimientos (ver el router).
CREATE TABLE IF NOT EXISTS campo_movimientos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha        DATE NOT NULL DEFAULT CURRENT_DATE,
  cuenta_id    UUID NOT NULL REFERENCES campo_cuentas(id),
  signo        VARCHAR(10) NOT NULL CHECK (signo IN ('entrada', 'salida')),
  monto        NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  concepto     TEXT,
  categoria_id UUID REFERENCES campo_categorias_gasto(id),
  activo_id    UUID REFERENCES campo_activos(id),
  servicio_id  UUID REFERENCES campo_servicios(id),
  -- Auditoría: FK real a users (uuid). SET NULL al borrar el usuario.
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campo_mov_servicio ON campo_movimientos (servicio_id) WHERE servicio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campo_mov_cuenta   ON campo_movimientos (cuenta_id);
CREATE INDEX IF NOT EXISTS idx_campo_mov_fecha    ON campo_movimientos (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_campo_serv_cliente ON campo_servicios (cliente_id);
CREATE INDEX IF NOT EXISTS idx_campo_serv_fecha   ON campo_servicios (fecha DESC);

-- ── Semillas (idempotentes) ────────────────────────────────────────────────
INSERT INTO campo_categorias_gasto (nombre) VALUES
  ('DIESEL'), ('OPERA'), ('TRASLADO'), ('REPARACION_MANT'),
  ('OTROS'), ('GASOLINA'), ('VIATICOS'), ('MATRICULACION')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO campo_cuentas (nombre) VALUES ('CAJA'), ('BANCO'), ('OTROS')
ON CONFLICT (nombre) DO NOTHING;

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
-- Para revertir, ejecutar a mano lo siguiente (borra SOLO estas tablas nuevas,
-- en orden inverso por las FK; no toca nada más):
--
--   DROP TABLE IF EXISTS campo_movimientos;
--   DROP TABLE IF EXISTS campo_servicios;
--   DROP TABLE IF EXISTS campo_clientes;
--   DROP TABLE IF EXISTS campo_cuentas;
--   DROP TABLE IF EXISTS campo_categorias_gasto;
--   DROP TABLE IF EXISTS campo_activos;
--   DELETE FROM schema_migrations WHERE filename = '20260826_campo_caja_modulo.sql';
