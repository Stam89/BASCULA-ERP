# Instrucciones para asistentes

1. Leer primero `NEXT_SESSION.md`. Es la memoria compacta y vigente.
2. No leer `PROJECT_CONTEXT.md` completo al iniciar: es un historial largo. Buscar alli con `rg` solo si el cambio necesita antecedentes concretos.
3. Antes de editar, ejecutar `git status --short` y `git log -3 --oneline`.
4. No revertir cambios ajenos ni modificar datos reales para probar.
5. Mantener migraciones aditivas e idempotentes. Ejecutar build y pruebas antes de hacer commit.
6. Actualizar `NEXT_SESSION.md` al terminar una mejora importante.

