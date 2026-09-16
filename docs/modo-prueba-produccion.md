# Modo prueba y modo produccion

Esta guia evita mezclar ensayos con datos reales.

## Regla principal

Trabajar con datos reales siempre debe hacerse en:

```env
APP_MODE=production
```

En este modo, el ERP bloquea el boton **Borrar datos de prueba**. Aunque un
administrador tenga clave, el backend no permite limpiar movimientos completos.

Para ensayar, capacitar o probar una empresa nueva, usar una base separada:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/bascula_erp_prueba
APP_MODE=test
```

En `APP_MODE=test` el boton **Borrar datos de prueba** queda disponible para
limpiar ensayos.

## Como preparar una base de prueba

1. Crear una base nueva en PostgreSQL, por ejemplo `bascula_erp_prueba`.
2. En `backend/.env`, apuntar `DATABASE_URL` a esa base.
3. Poner `APP_MODE=test`.
4. Ejecutar migraciones e inicializacion.
5. Hacer pruebas, cargar tickets, usuarios y movimientos de ensayo.
6. Si todo esta correcto, repetir la instalacion real apuntando a la base final.

## Como volver a produccion

Antes de operar con datos reales:

1. Crear respaldo.
2. Cambiar `DATABASE_URL` a la base real.
3. Cambiar `APP_MODE=production`.
4. Reiniciar el backend.
5. Abrir `Configuracion -> Estado del sistema`.
6. Confirmar que diga **Modo del sistema: Produccion**.

## Emergencia

Existe una variable de mantenimiento:

```env
ALLOW_PRODUCTION_RESET=true
```

Solo debe usarse de forma temporal, con respaldo confirmado y sabiendo que
borra movimientos operativos. Despues de usarla debe volver a quedar apagada:

```env
ALLOW_PRODUCTION_RESET=false
```

Para una entrega normal a otra empresa, no activar esta variable.
