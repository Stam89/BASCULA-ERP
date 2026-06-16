# API principal

Base:

```text
/api/v1
```

## Agricultores

```http
GET    /farmers
POST   /farmers
GET    /farmers/{id}
PUT    /farmers/{id}
GET    /farmers/{id}/history
```

## Anticipos

```http
GET  /advances
POST /advances
```

## Bascula

```http
POST /weighing-tickets
PUT  /weighing-tickets/{id}/gross-weight
PUT  /weighing-tickets/{id}/tare-weight
PUT  /weighing-tickets/{id}/qualification
POST /weighing-tickets/{id}/close
GET  /weighing-tickets/{id}
```

## Inventario

```http
GET  /inventory/stock
GET  /inventory/products
POST /inventory/products
GET  /inventory/movements
POST /inventory/adjustments
```

## Procesamiento

```http
POST /processing-batches
POST /processing-batches/{id}/finish
```

## Liquidaciones

```http
POST /liquidations/preview
POST /liquidations
GET  /liquidations
```

## Caja

```http
POST /cash/registers/open
GET  /cash/registers/current
POST /cash/movements
GET  /cash/registers/{id}/movements
```

## Ventas

```http
POST /sales
GET  /sales
```

## Gastos

```http
POST /expenses
GET  /expenses
POST /expenses/labor-payments
```

## Impresion

```http
GET  /documents/weighing-ticket/{id}/print-data
GET  /documents/liquidation/{id}/print-data
GET  /documents/sale/{id}/print-data
POST /documents/print-jobs
```

Cuando `document_type` es `WEIGHING_TICKET`, `POST /documents/print-jobs` incrementa `print_count` y bloquea el ticket en backend.
