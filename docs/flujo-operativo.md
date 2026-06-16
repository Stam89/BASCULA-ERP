# Flujo operativo del ERP

## 1. Entrada a bascula

1. El operador registra agricultor, vehiculo y conductor.
2. Se genera un lote unico.
3. Se genera un lote de impresion para trazabilidad.
4. Se registra peso bruto.
5. Se toma la muestra del arroz.
6. Se ingresa la calificacion manualmente.
7. Se descarga el camion.
8. Se registra tara.
9. El sistema calcula:

```text
Neto = Bruto - Tara
QQ = (Neto x 2.2) / Calificacion
```

10. Se cierra el ticket de bascula.
11. Se imprime recibo termico.
12. Si es compra normal, entra al inventario propio.
13. Si es maquila, entra como inventario fisico de tercero.

## 2. Anticipos

1. Caja registra anticipo al agricultor.
2. El sistema crea egreso de caja.
3. El anticipo queda con saldo pendiente.
4. Al liquidar, se descuenta automaticamente.

## 3. Procesamiento

1. Produccion selecciona lote.
2. Se descuenta arroz en cascara.
3. Se registran salidas:
   - Arroz pilado.
   - Arrocillo.
   - Polvillo.
   - Merma.
4. Si se empaca, se descuentan sacos vacios.
5. El lote queda trazable desde recepcion hasta producto terminado.

## 4. Liquidacion

1. Caja selecciona lote y agricultor.
2. Ingresa precio por quintal.
3. El sistema calcula valor bruto.
4. Busca anticipos pendientes.
5. Descuenta anticipos automaticamente.
6. Calcula neto a pagar.
7. Genera cuenta por pagar.
8. Registra pago total o parcial.
9. Imprime liquidacion.

## 5. Venta

1. Se selecciona cliente.
2. Se selecciona producto y lote.
3. Se ingresa cantidad y precio.
4. El sistema descuenta inventario.
5. Si es contado, registra ingreso de caja.
6. Si es credito, crea cuenta por cobrar.
7. Imprime ticket de venta.
