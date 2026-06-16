# Instalacion inicial

## 1. Base de datos

Crear una base PostgreSQL:

```sql
CREATE DATABASE bascula_erp;
```

Luego ejecutar:

```powershell
cd C:\Users\ceci2\OneDrive\Documents\GitHub\BASCULA-ERP\backend
copy .env.example .env
npm install
npm run db:init
```

## 2. Backend

```powershell
cd C:\Users\ceci2\OneDrive\Documents\GitHub\BASCULA-ERP\backend
npm install
npm run db:seed
npm run dev
```

La API debe abrir en:

```text
http://localhost:4000
```

Probar:

```text
http://localhost:4000/health
```

Usuario inicial:

```text
admin
```

Clave inicial:

```text
admin123
```

## 3. Panel web administrativo

```powershell
cd C:\Users\ceci2\OneDrive\Documents\GitHub\BASCULA-ERP\web-admin
npm install
npm run dev
```

El panel debe abrir en:

```text
http://localhost:5173
```

## 4. App Android

Abrir esta carpeta en Android Studio:

```text
C:\Users\ceci2\OneDrive\Documents\GitHub\BASCULA-ERP\android-app
```

Luego esperar a que Android Studio sincronice Gradle.

Para imprimir:

1. Emparejar la impresora Bluetooth desde Android.
2. Copiar la direccion MAC de la impresora.
3. Pegarla en la app.
4. Presionar `Imprimir prueba 58mm`.

## Inicio rapido en esta computadora

Si Node.js y PostgreSQL ya estan instalados, puedes iniciar backend y panel con:

```powershell
cd C:\Users\ceci2\OneDrive\Documents\GitHub\BASCULA-ERP
.\iniciar-sistema.ps1
```
