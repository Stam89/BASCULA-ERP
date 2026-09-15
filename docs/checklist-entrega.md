# Checklist de entrega

Usar esta lista cuando el sistema este cerca del 90-100% y se quiera entregar a
otra empresa o dejar una instalacion nueva lista para operar.

## 1. Base tecnica

- `backend/.env` configurado con `DATABASE_URL`, `JWT_SECRET` y datos de empresa.
- `COMPANY_NAME` y `COMPANY_CODE` corresponden a la empresa real.
- `FIELD_OPERATION_NAME` corresponde a la operacion de Campo/Transporte.
- `NEGOCIO_ID` es unico para esa empresa si se usa Firebase/app movil.
- `DEVICE_SYNC_KEY` configurado si se usara sincronizacion directa.
- `npm run db:migrate` ejecutado sin errores.
- `npm run db:company:init` ejecutado sin errores.
- `npm run db:seed` ejecutado sin resetear claves existentes.

## 2. Verificacion en ERP

Entrar al panel y revisar:

- `Configuracion -> Estado del sistema`.
- Bloque `Empresa lista`.
- Backend en linea.
- Respaldo reciente.
- Matriz principal configurada.
- Usuarios activos.
- Campo/Transporte con cuentas base.
- Campo/Transporte con categorias base.
- Enlace de Campo con Matriz creado.

## 3. Datos reales minimos

Antes de operar, cargar manualmente:

- usuarios y permisos reales;
- socios/accionistas reales;
- flota/maquinaria real de Campo;
- operadores reales de Campo;
- clientes frecuentes, si ya existen;
- impresoras reales;
- configuracion de app movil.

No cargar maquinaria, operadores o tickets de prueba en una base que sera usada
en produccion.

## 4. Prueba operativa corta

Hacer una prueba controlada antes de entregar:

- crear usuario operador de prueba;
- registrar un ticket de bascula pequeño;
- verificar que aparece en historial;
- probar sincronizacion app movil -> ERP;
- probar guardado/exportacion de Excel o reporte que use la empresa;
- registrar un movimiento simple de Campo;
- revisar que Campo y Matriz no mezclen datos por error;
- crear respaldo despues de la prueba.

Si la prueba genera datos no deseados, hacerla en una base de prueba, no en la
base final de produccion.

## 5. Seguridad

- Cambiar la clave inicial del administrador.
- Confirmar que no se usa `admin123` ni claves cortas.
- Revisar usuarios desactivados.
- Verificar que operadores solo tengan los modulos necesarios.
- Confirmar que la app movil usa el `NEGOCIO_ID` correcto.
- Confirmar que cada empresa tiene su propio Firebase/negocio o modo local.

## 6. Respaldo y recuperacion

- Crear respaldo inicial antes de entregar.
- Guardar la ubicacion del respaldo.
- Probar que el respaldo se genera sin error.
- Documentar quien tiene la clave admin.
- Documentar quien puede restaurar o formatear datos.

## 7. Criterio de entrega

El sistema se considera listo para entregar cuando:

- el bloque `Empresa lista` no muestra pendientes criticos;
- la app movil sincroniza o queda documentado que trabajara local;
- la impresora principal esta probada;
- existe respaldo inicial;
- el usuario administrador real puede entrar;
- Campo/Transporte tiene su flota y operadores reales;
- no hay datos de prueba mezclados con produccion.
