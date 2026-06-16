# Seguridad anti-fraude en tickets

## Campos agregados

La entidad local Android `Ticket` incluye:

- `isLocked: Boolean = false`
- `printCount: Int = 0`

La base PostgreSQL tambien incluye:

- `weighing_tickets.is_locked BOOLEAN DEFAULT false`
- `weighing_tickets.print_count INTEGER DEFAULT 0`

## Reglas aplicadas

1. Al presionar `Guardar`, el ticket queda bloqueado permanentemente.
2. Al imprimir por primera vez, el ticket tambien queda bloqueado antes de enviar a Bluetooth.
3. Si el ticket esta bloqueado, los campos Bruto, Tara y Calificacion quedan deshabilitados.
4. El boton `Editar` solicita PIN de administrador.
5. PIN temporal de desarrollo: `1234`.
6. Cada impresion Bluetooth exitosa incrementa `printCount`.
7. Si el ticket ya tenia impresiones previas, el texto 58mm inicia y finaliza con advertencia de reimpresion.

## Formato 58mm

El formateador mantiene cada linea en maximo 32 caracteres.

Advertencia de reimpresion:

```text
--------------------------------
* REIMPRESION N° X *
--------------------------------
```
