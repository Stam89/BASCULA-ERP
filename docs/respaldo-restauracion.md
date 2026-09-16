# Respaldo y restauracion

Guia practica para proteger la base de datos del ERP. Un respaldo debe hacerse
antes de entregar una instalacion, antes de cambios grandes y antes de limpiar
datos de prueba.

## 1. Tipos de respaldo disponibles

### Respaldo principal en OneDrive

Archivo:

```text
RESPALDO-BASCULA.bat
```

Que hace:

- ejecuta `backend/scripts/backup-db.cjs`;
- usa `pg_dump` en formato comprimido (`.dump`);
- guarda por defecto en OneDrive, carpeta `BASCULA-ERP-Backups`;
- conserva las ultimas 30 copias, salvo que se cambie `BACKUP_KEEP`.

Uso manual:

```powershell
.\RESPALDO-BASCULA.bat
```

### Respaldo automatico diario

Archivo:

```text
INSTALAR-RESPALDO-AUTOMATICO.bat
```

Que hace:

- crea una tarea de Windows;
- ejecuta el respaldo principal todos los dias a las 8:00 PM;
- si la PC esta apagada, Windows lo ejecuta cuando pueda al volver a encender.

Uso:

```text
Clic derecho -> Ejecutar como administrador
```

### Respaldo local de 7 dias

Archivo:

```text
RESPALDO-BD-7DIAS.bat
```

Que hace:

- ejecuta `backend/scripts/backup-db-7dias.cjs`;
- guarda por defecto en `backend/backups`;
- conserva respaldos recientes por dias, no por cantidad;
- no reemplaza el respaldo principal de OneDrive.

## 2. Variables utiles

Se configuran en `backend/.env` si hace falta:

```text
BACKUP_DIR=C:\ruta\respaldos-onedrive
BACKUP_KEEP=30
BACKUP_DIR_7D=C:\ruta\respaldos-locales
BACKUP_RETENTION_DAYS=7
PG_BIN=C:\Program Files\PostgreSQL\17\bin
```

`DATABASE_URL` siempre debe apuntar a la base correcta.

## 3. Antes de restaurar

Restaurar un respaldo reemplaza datos. Hacerlo sin revisar puede borrar trabajo
reciente.

Antes de restaurar:

- confirmar que el respaldo pertenece a la empresa correcta;
- confirmar fecha y hora del archivo `.dump`;
- crear un respaldo nuevo del estado actual;
- cerrar el backend y el panel si estan abiertos;
- anotar quien autorizo la restauracion.

## 4. Restauracion manual con pg_restore

Ejemplo general:

```powershell
cd C:\Users\Usuario\OneDrive\Documentos\GitHub\BASCULA-ERP\backend
```

Crear una base nueva para probar la restauracion:

```powershell
createdb bascula_erp_restaurada
pg_restore --no-owner --dbname=postgres://postgres:postgres@localhost:5432/bascula_erp_restaurada "C:\ruta\respaldo.dump"
```

Si la prueba abre bien, se puede decidir si reemplazar la base real. Para una
base real, hacerlo solo con autorizacion y despues de un respaldo del estado
actual.

## 5. Prueba recomendada

Cada cierto tiempo probar en una base temporal:

1. restaurar el `.dump` en `bascula_erp_restaurada`;
2. apuntar temporalmente `DATABASE_URL` a esa base;
3. iniciar backend;
4. entrar al ERP;
5. verificar usuarios, Matriz, Campo, tickets y reportes;
6. volver `DATABASE_URL` a la base real.

## 6. Regla de oro

No usar restauracion como forma de "arreglar rapido" sin saber que datos se van
a perder. Primero se respalda el estado actual, luego se restaura en una base de
prueba, y solo despues se toca produccion.
