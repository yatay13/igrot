# Cómo subir estos archivos

Son los de siempre más los cuatro nuevos de la vectorización. Si todavía no
subiste los paquetes anteriores, **este los incluye a todos**: subí sólo éste.

## 1 · Subir los archivos

1. Descomprimí el `.zip`. Windows: clic derecho → **Extraer todo** → **Extraer**.
2. Entrá a `https://github.com/yatay13/igrot`.
3. **Add file** → **Upload files**.
4. En el Explorador, seleccioná **sólo estas cuatro cosas**:

       .github        app        pruebas        package.json

   **NO** selecciones `LEEME-PRIMERO.md`.
5. Arrastralas al recuadro de GitHub.
6. Fijate que los archivos aparezcan **con su carpeta adelante**
   (`app/api/vectorizar/route.js`, no `route.js`). Si salen sueltos, cancelá:
   arrastraste archivos en vez de carpetas.
7. Mensaje: `Vectorización desde el sitio, sin Colab` → **Commit changes**.
8. Esperá el tilde verde ✓ (GitHub corre los 213 tests solo).

## 2 · Poner la clave de tareas en Vercel

**La ruta que vectoriza no existe hasta que hagas esto.** Sin la variable,
contesta 404 como cualquier dirección inventada.

1. Entrá a `https://vercel.com` y abrí tu proyecto **igrot**.
2. Arriba: **Settings**.
3. En la columna izquierda: **Environment Variables**.
4. En **Key** escribí, exactamente:

       CLAVE_DE_TAREAS

5. En **Value** inventate una clave **larga**: por lo menos 20 caracteres,
   mezcla de letras y números. No uses una contraseña tuya de otra cosa.
   Guardala donde guardes tus claves — la vas a necesitar en el paso 3.
   **No me la pegues en el chat.**
6. Dejá marcados los tres entornos (Production, Preview, Development).
7. **Save**.
8. Andá a la pestaña **Deployments**, botón **⋯** del despliegue de arriba →
   **Redeploy** → **Redeploy**. Las variables nuevas sólo se toman al volver
   a desplegar.

## 3 · Correr los dos archivos de SQL

En Supabase → **SQL Editor** → **New query**, pegá y corré, en este orden:

1. **`estado_de_los_vectores_hoy.sql`** — no cambia nada, sólo mira.
   **Pegame la salida**: con eso confirmo que la tabla es como la esperaba.
2. **`preparar_la_vectorizacion.sql`** — crea las tres funciones. Se comprueba
   solo: si tu tabla `chunks` no es como yo creo, se cancela entero en el
   primer bloque y te dice qué encontró.

## 4 · Vectorizar

1. Abrí `https://igrot.vercel.app/tareas`.
2. Pegá la clave del paso 2.
3. **Ver cuánto falta** → tienen que aparecer los números.
4. **Empezar**. Dejá la pestaña abierta.

Va de a tres cartas por vez y muestra el avance. Se puede **Parar** cuando
quieras y seguir otro día: lo hecho no se repite. Si se cierra la pestaña o se
corta la luz, tampoco se pierde nada.

Al terminar, corré `despues_de_cada_carga.sql` como siempre.

## Si algo sale mal

- **La página dice «La ruta no está habilitada»** → falta el paso 2, o
  faltó el **Redeploy**.
- **Dice «La clave no es la correcta»** → la clave que pegaste no es la de
  Vercel. Fijate que no se haya colado un espacio al copiar.
- **Se para sola y avisa «tres tandas sin avanzar»** → pegame lo que diga
  *Qué fue pasando*.
