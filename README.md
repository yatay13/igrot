# Buscador de Igrot Kodesh

Página web para buscar cartas del Rebe con búsqueda híbrida (vectorial +
texto completo) sobre la base de Supabase que ya cargaste, y traducción de
cartas enteras con Gemini.

## Qué hace cada cosa

```
app/
  page.js              la pantalla: buscador, filtros, resultados
  layout.js            el marco de la página
  globals.css          los estilos
  icon.svg             el ícono de la pestaña
  lib/servicios.js     TODO lo que habla con Gemini y Supabase (sólo servidor)
  api/buscar/          recibe la consulta, la vectoriza y llama a buscar_cartas
  api/facetas/         arma las listas de tomos, temas y festividades
  api/carta/           trae el detalle de una carta cuando la abrís
  api/traducir/        traduce una carta a otro idioma
```

Las claves nunca llegan al navegador: el navegador le habla a `/api/...` y el
servidor de Vercel es el único que tiene las claves.

## Variables de entorno

| Nombre           | De dónde sale                                                        |
|------------------|----------------------------------------------------------------------|
| `SUPABASE_URL`   | Supabase → Project Settings → API → Project URL                      |
| `SUPABASE_KEY`   | Supabase → Project Settings → API → `anon` `public`                  |
| `GEMINI_API_KEY` | Google AI Studio → Get API key                                       |

La clave `anon` alcanza y es la correcta: las tablas tienen RLS con permiso de
lectura pública. **No uses la `service_role`** en una página web.

## Probarlo en tu máquina (opcional)

```
npm install
copiá .env.example a .env.local y completá las tres variables
npm run dev
```

## Subirlo a Vercel

Está explicado paso a paso, con clics, en la guía que te pasé.
En resumen: subís esta carpeta a un repositorio de GitHub, entrás a
vercel.com, "Add New… → Project", elegís el repositorio, cargás las tres
variables de entorno y apretás Deploy.

## Notas

- El nombre del modelo de Gemini no está escrito a mano: se pregunta a la API
  y se elige el más nuevo que funcione. Cuando Google jubile uno, la página
  sigue andando sola.
- La búsqueda usa el resumen en español y el hebreo original al mismo tiempo,
  así que podés preguntar en castellano aunque las cartas estén en hebreo.
- Si cargás después los vectores en hebreo (sección 5b del cuaderno), la
  búsqueda mejora sola: no hay que tocar nada acá.
