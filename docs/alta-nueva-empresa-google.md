# Alta de una nueva empresa con Google

Esta etapa queda preparada para activarse cuando BASCULA-ERP este estable y
la instalacion actual tenga un respaldo verificado. Mientras tanto, el flujo
actual de usuarios y la empresa existente no cambian.

## Objetivo

Permitir que una empresa nueva entre con su propia cuenta de Google y cree su
propia instalacion logica, sin mezclar tickets, usuarios, clientes, placas,
impresoras, configuracion ni datos de Campo/Transporte con otra empresa.

## Flujo previsto

1. El administrador elige `Iniciar sesion con Google`.
2. Si su cuenta no pertenece a una empresa, el sistema muestra `Crear empresa`.
3. Se solicitan nombre comercial, RUC opcional, telefono y direccion.
4. El sistema crea un `company_id` y un codigo de union unico.
5. La cuenta Google queda como administrador principal.
6. El administrador puede crear usuarios adicionales con roles y modulos.
7. BASCULA se enlaza mediante el codigo de union de esa empresa.

## Reglas de aislamiento

- Cada usuario debe estar relacionado con una empresa antes de acceder a datos.
- Cada consulta y escritura debe filtrar por `company_id` en el servidor.
- Firebase debe usar un `NEGOCIO_ID` diferente por empresa.
- El ERP no debe aceptar que el cliente elija libremente otro `company_id`.
- Una cuenta Google no debe crear una segunda empresa accidentalmente sin una
  confirmacion explicita.
- La empresa actual de PILADORA CEYRO se conserva intacta durante la migracion.

## Compatibilidad con la instalacion actual

La primera version debe convivir con los usuarios locales existentes. El
inicio de sesion con Google se habilitara gradualmente y no reemplazara la
autenticacion actual hasta comprobar:

- inicio de sesion y cierre de sesion;
- recuperacion de cuenta;
- permisos de administrador y operador;
- aislamiento entre dos empresas de prueba;
- sincronizacion BASCULA -> ERP;
- recuperacion ante falta de internet;
- respaldo y restauracion.

## Orden de implementacion cuando llegue el momento

1. Crear respaldo de base de datos, ERP, Android y configuraciones.
2. Implementar tablas o relaciones de empresa y pertenencia de usuario.
3. Agregar validacion de `company_id` en el backend.
4. Agregar Google/Firebase Authentication en el ERP.
5. Crear pantalla de alta y codigo de union.
6. Adaptar BASCULA para seleccionar o confirmar el negocio enlazado.
7. Probar con dos empresas ficticias y datos distintos.
8. Ejecutar build, pruebas y prueba manual controlada.
9. Activar primero en modo prueba; pasar a produccion solo con autorizacion.

## Criterio de activacion

No activar esta etapa mientras existan errores abiertos de sincronizacion,
permisos Firebase, recuperacion de tickets, impresion o restauracion. El
registro de una empresa nueva debe ser una funcion separada y reversible.
