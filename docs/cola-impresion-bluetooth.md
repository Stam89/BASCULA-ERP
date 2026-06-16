# Cola y reconexion Bluetooth

## Clase principal

La impresion robusta esta en:

```text
android-app/app/src/main/java/com/bascula/erp/printing/BluetoothPrintManager.kt
```

## Flujo

1. Antes de imprimir, se revisa `socket?.isConnected`.
2. Si el socket no esta conectado, se intenta reconectar hasta 3 veces.
3. Cada intento espera 1 segundo antes del siguiente.
4. Si reconecta, imprime.
5. Si falla, guarda el ticket en `failed_prints`.

## Cola local

La tabla local `failed_prints` guarda:

- `ticket_id`
- `plain_text`
- `attempts`
- `last_error`
- `created_at`
- `updated_at`

## Reintentos

La pantalla Android incluye el boton:

```text
Tickets Pendientes (N)
```

Desde ahi se puede:

- Reenviar un ticket pendiente.
- Reenviar todos los pendientes en lote.

## Envio seguro

El texto se envia en bloques pequenos de 64 bytes, con `flush()` entre bloques y al final.

Antes de convertir a ESC/POS, el manager asegura final:

```text
\n\n\n
```
