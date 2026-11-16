# Cómo subir estos 18 archivos

Son los mismos 18 de la vez anterior, con los cambios nuevos encima. Si todavía
no subiste los de antes, este paquete los reemplaza: **subí sólo éste**.

## Primero: ¿el anterior llegó a publicarse?

Abrí `https://igrot.vercel.app/api/version` en el navegador.

- Si dice `2026-09-29c` → **nunca subiste nada todavía**. Por eso no encontrabas
  el fondo de 770: el sitio publicado sigue siendo el viejo. Seguí con los pasos
  de abajo.
- Si dice `2026-11-13` (sin la `b`) → el anterior sí entró, y el fondo estaba
  demasiado tenue para verse. Este paquete lo arregla.
- Si dice `2026-11-13b` → ya está todo arriba.

## Paso a paso

1. Descomprimí el `.zip`. En Windows: clic derecho → **Extraer todo** →
   **Extraer**.
2. Vas a tener una carpeta `igrot-cambios` con esto adentro:

       .github/      app/      pruebas/      package.json      LEEME-PRIMERO.md

3. Entrá a `https://github.com/yatay13/igrot`
4. Arriba a la derecha de la lista de archivos: **Add file** → **Upload files**.
5. Abrí la carpeta `igrot-cambios` en el Explorador de Windows.
6. **Seleccioná sólo estas cuatro** (clic en la primera, Ctrl+clic en las otras):

       .github        app        pruebas        package.json

   **NO selecciones `LEEME-PRIMERO.md`**: es esta hoja y no va al repositorio.

7. Arrastralas al recuadro de GitHub que dice *"Drag files here…"*.
8. Esperá a que suba. Fijate que los archivos aparezcan **con su carpeta
   adelante** (`app/lib/guardias.js`, no `guardias.js`). Si salen sueltos,
   cancelá y volvé al paso 6: arrastraste los archivos y no las carpetas.
9. Mensaje del commit:

       Fondo visible, navegación con teclado y el original como página

10. Dejá marcado **Commit directly to the main branch** → **Commit changes**.

## Qué pasa después, solo

- GitHub corre los **185 tests** y pone un tilde verde ✓ o una cruz roja ✗ al
  lado del commit, en treinta segundos.
- Vercel publica en uno o dos minutos.
- Para confirmar: `https://igrot.vercel.app/api/version` tiene que decir
  **`2026-11-13b`**.

Si sale cruz roja, hacele clic y pegame qué test falló. El sitio viejo sigue
publicado mientras tanto, así que no se rompe nada.

## Dónde mirar los cambios nuevos

- **El fondo de 770**: arriba a la derecha de la portada. Está a propósito
  tenue, pero ahora se ve. Mirá la imagen `asi-se-ve-el-770.png` que te mandé
  al chat: es exactamente lo que tiene que aparecer.
- **El teclado**: hacé una búsqueda y apretá `j` y `k` para recorrer las cartas,
  `Enter` para abrir el original, `/` para volver a la caja.
- **El original en hebreo**: abrilo. Ahora es una hoja con su canto de tinta del
  lado derecho, que es donde va el lomo en un libro hebreo.
- **La barra de lectura**: la línea fina de arriba de todo, que avanza al bajar.

## Si el fondo de 770 no te gusta

Se apaga con un renglón. En `app/globals.css`, buscá `--fondo-del-sitio` (está
cerca del renglón 215) y cambialo por:

    --fondo-del-sitio: none;
