# Cambios de seguridad y estética — 2026-10-08

Resumen de lo que se tocó y por qué. Lo escribo acá y no en un chat porque el
chat se pierde y el repositorio no.

## Seguridad

### 1. `.gitignore` — EL MÁS GRAVE
No existía. El archivo estaba escrito pero había quedado en la raíz con el
nombre `download`, como lo bautizó el navegador al descargarlo. El README manda
a crear `.env.local` con las tres claves y después subir la carpeta a GitHub:
seguir esas instrucciones en orden **publicaba la clave de Supabase y la de
Gemini**, y las dejaba para siempre en el historial de git aunque después se
borrara el archivo. En Windows `.env.local` además está oculto y no se ve en el
Explorador.

Ahora `.gitignore` existe y cubre `.env`, `.env.local`, `.env.*.local`,
`node_modules`, `.next` y `.vercel`.

**Antes del primer `git push`: correr `git status` y comprobar que `.env.local`
NO aparezca en la lista.** Si alguna vez se subió, hay que rotar las dos claves;
borrar el archivo en un commit posterior no lo saca del historial.

### 2. Envenenamiento del caché de traducciones
`/api/traducir` recibía `cartaId` y `texto` del navegador, traducía el texto y
guardaba el resultado en `traducciones` con esa clave, sin comprobar nunca que
el texto fuera de esa carta. El guardado es un upsert, así que pisa la fila que
hubiera; y la lectura, si encuentra la clave, devuelve lo guardado sin consultar
a Gemini.

Un POST anónimo con el id de una carta real y un párrafo inventado dejaba ese
párrafo guardado como «la traducción» de esa carta, y a partir de ahí se le
servía a todo el que apretara «Traducir entera». En un sitio que publica cartas
del Rebe, eso es ponerle en la boca palabras que no dijo.

Ahora la ruta lee el texto de la carta de la base y comprueba que el tramo sea
de verdad un pedazo de ella (`esUnTramoDeLaCarta` en `app/lib/servicios.js`). La
comparación ignora los espacios, porque `partirEnTramos` vuelve a pegar los
pedazos con `\n\n` y un `includes` literal rechazaría tramos legítimos.

De paso, eso también frena el gasto: por esta ruta sólo se puede traducir texto
que de verdad está en el corpus.

### 3. Topes en las entradas
- `/api/buscar`: `limite` entre 1 y 100 (la página pide 20), `desplazamiento`
  hasta 10.000, consulta hasta 500 caracteres, filtros hasta 200. Antes
  `limite` pasaba por `Number()` y nada más: `{"limite": 1000000000}` pedía el
  corpus entero —y cada resultado trae el texto completo de la carta— en un
  solo pedido.
- `/api/traducir`: texto hasta 4.000 caracteres, `idioma` con lista blanca
  (antes cualquier cadena entraba al pedido que lee Gemini), `parte` y `total`
  recortados a enteros.
- `/api/carta`: tope al largo del `id`.

### 4. Errores crudos
Los tres sitios que hablan con Supabase lanzaban el cuerpo de PostgREST
—`message`, `details`, `hint`— dentro del mensaje de error, y las rutas lo
devolvían al navegador. Eso no abre ninguna puerta, pero entrega el plano:
nombres de columnas, firmas de funciones, tipo de la clave, si las políticas
están puestas. Y `/api/facetas` lo adjuntaba a una respuesta **200 con
`revalidate = 60`**, así que quedaba cacheado y servido a todos por un minuto.

Ahora el cuerpo crudo va en `.detalle`, que las rutas mandan a `console.error`
(queda en los registros de Vercel). Al navegador va sólo el mensaje corto, que
conserva `Supabase <código>` porque de eso depende `mensajeAmable` para decir en
castellano qué revisar.

### 5. Cabeceras
`next.config.js` no mandaba ninguna. Ahora manda CSP, `X-Content-Type-Options`,
`Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` y HSTS, y apaga
`X-Powered-By`. El `no-store` va sólo en `/api/buscar`, `/api/carta` y
`/api/traducir`: `/api/facetas` queda afuera a propósito, porque su respuesta es
igual para todos y que se cachee es lo que hace que el sitio aguante visitas.

### 6. Nueve archivos viejos en la raíz
`page.js`, `layout.js`, `servicios.js`, `globals.css`, `icon.svg`, `route.js`,
`route (1).js`, `route (2).js` y `route (3).js`. Next sólo sirve `app/`, así que
ninguno se usaba, pero contenían código previo a estos arreglos y ensuciaban
cualquier búsqueda. Borrados.

## Estética

### La tipografía no se cargaba
`globals.css` pedía `font-family: "Frank Ruhl Libre"` para el hebreo y esa
tipografía no se cargaba en ninguna parte: no había `@font-face`, ni `<link>`, ni
`next/font`. El hebreo del sitio se leía en Times New Roman. Es la diferencia
más grande que tiene esta página: es texto rabínico, en renglones largos, de
derecha a izquierda.

Ahora `app/layout.js` la carga con `next/font/google`, que la descarga al
compilar y la sirve desde el propio sitio: no se le pide nada a Google cuando
alguien abre la página, no hay salto de tipografía al cargar, y la CSP puede
decir `font-src 'self'`.

### El resto
- `color-scheme`, que faltaba: en modo oscuro los desplegables y las barras de
  desplazamiento los dibujaba el navegador en claro.
- Ancho de lectura de 68 caracteres para el hebreo y los resúmenes. Sin eso, en
  una pantalla ancha el renglón llegaba a 180 caracteres.
- Foco visible con `:focus-visible` en todo lo enfocable, y un enlace «Saltar a
  los resultados» para quien navega con el teclado.
- Un `<main id="resultados">` como región principal.
- El hebreo más grande (1,2rem) y sin ligaduras, que deforman las comillas de
  las abreviaturas del OCR.
- Un campo por renglón en el teléfono: dos columnas no entraban y el
  desplegable de temas quedaba cortado.
- `prefers-reduced-motion`, `prefers-contrast` y estilos de impresión.

## Lo que falta y no se puede hacer desde el código

Un **límite por IP** en `/api/traducir`. Los topes de arriba acotan cada pedido,
pero no cuántos pedidos puede hacer alguien. Se pone en Vercel: Firewall →
Rate Limiting, sobre la ruta `/api/traducir`.

Y conviene **revisar las políticas de acceso (RLS) de la tabla `traducciones`**
en Supabase → Authentication → Policies. La aplicación escribe con la clave
`anon`, así que si el caché funciona es porque hay un permiso de escritura
anónima. Con el arreglo 2 eso ya no es explotable, pero vale saber qué hay.
