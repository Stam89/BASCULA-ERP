# Arquitectura

## Componentes

```text
Android Planta  --->  Backend API  ---> PostgreSQL
Panel Web      --->  Backend API  ---> PostgreSQL
Impresora 58mm <---  Android Planta
```

## Backend

El backend contiene la logica central:

- Recepcion y bascula.
- Calculo de neto y quintales.
- Anticipos.
- Liquidaciones.
- Inventario.
- Procesamiento.
- Caja.
- Ventas.
- Gastos.
- Datos de impresion.

Las operaciones importantes usan transacciones de base de datos.

## Base de datos

PostgreSQL guarda:

- Usuarios y permisos.
- Agricultores y clientes.
- Lotes y tickets de bascula.
- Movimientos de inventario.
- Anticipos y liquidaciones.
- Cuentas por pagar y cobrar.
- Caja y gastos.
- Auditoria e impresiones.

El stock no se edita directamente. Se calcula desde `inventory_movements`.

## Panel web

El panel web es para administracion:

- Dashboard.
- Inventario.
- Caja.
- Liquidaciones.
- Reportes.
- Usuarios.
- Auditoria.

## App Android

La app Android es para planta:

- Operacion de bascula.
- Impresion Bluetooth 58mm.
- Tickets.
- Liquidaciones.
- Ventas rapidas.

La app consulta `/documents/.../print-data` y convierte las lineas a ESC/POS.
