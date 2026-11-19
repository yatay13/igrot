# Esto es, sobre todo, para que no se pierda nada

Además de los archivos del sitio, este paquete trae **dos cosas nuevas cuyo
único propósito es que el proyecto sobreviva a que se borre nuestra
conversación**:

- **`ESTADO_DEL_PROYECTO.md`** con una sección 14 nueva, que cubre todo lo del
  12 al 17 de noviembre y que hasta ahora no existía en ninguna parte.
- **`sql/`** — los nueve archivos SQL, que hasta hoy vivían **sólo** en el
  contenedor de la sesión (que se borra) y en tus descargas sueltas.

La sección 13 del propio documento dice: *«un archivo que existe en un solo
lugar no existe»*. Lo habíamos escrito y lo estábamos repitiendo.

## Cómo subirlo

1. Descomprimí el `.zip`. Windows: clic derecho → **Extraer todo** →
   **Extraer**.
2. Entrá a `https://github.com/yatay13/igrot` → **Add file** →
   **Upload files**.
3. Seleccioná **sólo estas seis cosas**:

       .github     app     pruebas     sql
       package.json        ESTADO_DEL_PROYECTO.md

   **NO** selecciones `LEEME-PRIMERO.md`: es esta hoja.
4. Arrastralas al recuadro de GitHub.
5. Fijate que los archivos aparezcan **con su carpeta adelante**
   (`sql/techo_por_visitante.sql`, no `techo_por_visitante.sql`).
6. Mensaje: `Estado al 17/11 y los SQL dentro del repositorio`
   → **Commit changes**.
7. Esperá el tilde verde ✓.

## Qué hacer si alguna vez se pierde el hilo

Empezá una conversación nueva y pegame esto:

> Estoy retomando el buscador de las Igrot Kodesh.
> El repositorio es github.com/yatay13/igrot.
> Leé `ESTADO_DEL_PROYECTO.md`, sobre todo la sección 14.

Con eso alcanza. El documento está escrito para que cualquiera pueda retomar
desde cero sin depender de que yo recuerde nada.

## Lo único que todavía falta subir

**`despues_de_cada_carga.sql`** sigue existiendo sólo en tus descargas. Es la
regla más importante del proyecto —se corre después de cada carga que toque
`cartas`— y no está en el repositorio. Si lo encontrás, mandámelo y lo meto en
`sql/` con los demás.
