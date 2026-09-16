# Instalacion inicial

Guia corta para levantar una instalacion nueva del ERP sin traer datos reales de
otra empresa. La instalacion debe quedar con Matriz/Piladora y la operacion
Campo/Transporte preparadas, pero sin maquinaria ni operadores inventados.

## 1. Preparar base de datos

Crear una base PostgreSQL vacia:

```sql
CREATE DATABASE bascula_erp;
```

Desde la carpeta del backend:

```powershell
cd C:\Users\Usuario\OneDrive\Documentos\GitHub\BASCULA-ERP\backend
copy .env.example .env
npm install
```

Editar `backend\.env` y configurar, como minimo:

```text
DATABASE_URL=postgres://postgres:postgres@localhost:5432/bascula_erp
APP_MODE=production
JWT_SECRET=una-clave-larga-y-unica

COMPANY_NAME="PILADORA NUEVA"
COMPANY_CODE=PILADORA-NUEVA
FIELD_OPERATION_NAME="Transporte y Cosechadora"
COMPANY_PHONE=
COMPANY_ADDRESS=

SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=una-clave-larga-y-unica
```

Para conectar app movil/nube, cada empresa debe usar un negocio distinto:

```text
NEGOCIO_ID=identificador-unico-de-la-empresa
FIREBASE_KEY=C:\ruta\segura\firebase-key.json
DEVICE_SYNC_KEY=otra-clave-larga-para-la-app
```

Si se va a hacer una prueba antes de entregar, usar una base separada y revisar
`docs/modo-prueba-produccion.md`.

## 2. Crear estructura y datos base

Ejecutar en orden:

```powershell
npm run preflight
npm run db:init
npm run db:migrate
npm run db:company:init
npm run db:seed
```

`preflight` revisa el `.env` antes de crear datos. Si marca `ERROR`, corregir
eso primero.

`db:company:init` prepara:

- la Matriz principal;
- los datos del negocio;
- el usuario administrador inicial;
- la operacion Campo/Transporte;
- cuentas base de Campo: `CAJA`, `BANCO`, `OTROS`, `CRUCE PILADORA`;
- categorias base de Campo;
- cliente interno de Campo enlazado con la Matriz.

No crea maquinaria, operadores ni tickets. Esos datos se cargan manualmente con
informacion real de la empresa.

## 3. Levantar backend y panel

Backend:

```powershell
cd C:\Users\Usuario\OneDrive\Documentos\GitHub\BASCULA-ERP\backend
npm run dev
```

Panel web:

```powershell
cd C:\Users\Usuario\OneDrive\Documentos\GitHub\BASCULA-ERP\web-admin
npm install
npm run dev
```

URLs locales:

```text
Backend: http://localhost:4000/health
Panel:   http://localhost:5173
```

## 4. Verificar dentro del ERP

Entrar al panel con el usuario configurado en `.env`.

Luego revisar:

1. `Configuracion -> Estado del sistema`.
2. Bloque `Empresa lista`.
3. Resolver todo lo que salga pendiente.

Pendientes normales en una empresa nueva:

- cargar flota/maquinaria real en Campo;
- cargar operadores reales de Campo;
- configurar Firebase si se usara sincronizacion movil;
- configurar clave de dispositivo;
- crear respaldo inicial.

## 5. Configuracion operativa minima

Antes de operar en serio:

- crear usuarios reales y permisos;
- revisar Matriz y socios;
- revisar datos del negocio;
- cargar flota y operadores de Campo;
- abrir caja inicial si se va a registrar dinero;
- probar un ticket de bascula;
- probar sincronizacion de app movil;
- crear respaldo.

Para una entrega formal, completar tambien `docs/checklist-entrega.md`.

## 6. Inicio rapido en esta computadora

Si Node.js y PostgreSQL ya estan instalados:

```powershell
cd C:\Users\Usuario\OneDrive\Documentos\GitHub\BASCULA-ERP
.\iniciar-sistema.ps1
```
