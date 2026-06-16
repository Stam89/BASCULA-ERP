# BASCULA ERP

Sistema de gestion, caja, inventario y bascula para piladora de arroz.

## Estructura

- `database/`: esquema relacional PostgreSQL.
- `backend/`: API REST para web y Android.
- `android-app/`: base de la app Android operativa e impresion Bluetooth 58mm.
- `docs/`: arquitectura, flujo de trabajo y guia de instalacion.

## Aplicaciones necesarias

1. Android Studio: para la app Android.
2. Visual Studio Code: para backend, base de datos y documentacion.
3. PostgreSQL: base de datos principal.
4. Node.js LTS: backend/API.
5. GitHub Desktop: subir cambios a GitHub.
6. Postman o Insomnia: probar endpoints de la API.

La primera version del sistema queda pensada como monorepo: backend, base de datos y app Android en una sola carpeta.

## Acceso local

- Panel web: http://127.0.0.1:5173
- Backend: http://127.0.0.1:4000/health
- Usuario inicial: `admin`
- Clave inicial: `admin123`

## Abrir sistema cada dia

La forma recomendada es usar el acceso directo del Escritorio:

```text
ABRIR BASCULA ERP
```

Tambien puedes abrirlo desde la carpeta del proyecto con doble clic:

```text
ABRIR_BASCULA_ERP.bat
```

Ese archivo revisa PostgreSQL, inicia backend y panel web si no estan activos, espera a que respondan y abre el navegador.

## Iniciar sistema manualmente

Desde PowerShell:

```powershell
cd C:\Users\ceci2\OneDrive\Documents\GitHub\BASCULA-ERP
.\iniciar-sistema.ps1
```

## Estado funcional actual

- Base PostgreSQL creada: `bascula_erp`.
- Productos iniciales cargados: arroz en cascara, arroz pilado, arrocillo, polvillo y sacos vacios.
- Bodegas iniciales cargadas: materia prima, producto terminado e insumos.
- Backend con modulos de bascula, agricultores, anticipos, inventario, liquidaciones, caja, ventas, gastos e impresion.
- Panel web con formularios operativos basicos.
- App Android base con soporte de impresion termica Bluetooth 58mm.
- Seguridad anti-fraude en tickets: bloqueo permanente, PIN de administrador y control de reimpresiones.
