// ===========================================================================
//  UN SUPABASE Y UN GEMINI DE MENTIRA
//
//  POR QUÉ ASÍ Y NO CON SIMULACROS
//
//  La manera habitual de probar esto sería reemplazar `servicios.js` por una
//  versión falsa. El problema es que entonces se prueba el falso: los
//  timeouts, el armado de las cabeceras, el manejo de un 503, la lectura del
//  `content-range`, el parseo de lo que devuelve PostgREST —todo eso vive en
//  `servicios.js` y es justamente lo que se quiere probar.
//
//  Así que en vez de reemplazarlo, se levantan dos servidores HTTP de verdad
//  en esta misma máquina y se le dice a la aplicación que Supabase y Gemini
//  están ahí. `servicios.js` ya tenía la puerta puesta:
//
//      const GEMINI = process.env.GEMINI_BASE || "https://...";
//                     // "La variable existe para poder apuntar a un
//                     //  servidor de prueba al probar la aplicación"
//
//  El resultado es que los tests recorren el camino completo —ruta, guardias,
//  servicios, fetch, respuesta— y pueden provocar cosas que con un simulacro
//  no se pueden provocar: que la base se cuelgue y no conteste nunca, que
//  Gemini devuelva 503 dos veces y a la tercera ande, que la respuesta venga
//  con un JSON roto.
//
//  Y además dejan ver lo que se mandó. `peticiones` guarda cada pedido con su
//  dirección y sus cabeceras, y de ahí sale el test que comprueba que la clave
//  de Gemini NO viaja en la dirección.
// ===========================================================================

import { createServer } from "node:http";
import { once } from "node:events";

/** Todo lo que llegó a los servidores falsos, en orden. */
export const peticiones = [];

/** El guion: qué contesta cada servidor. Los tests lo cambian a gusto.
 *
 *  Cada entrada es una función `(pedido) => respuesta` o un objeto con
 *  `{ estado, cuerpo, cabeceras, demora }`. `demora: "nunca"` no contesta
 *  jamás, que es como se prueba un timeout.
 */
export const guion = {
  // --- Supabase ---
  rpc: {},          // por nombre de función: guion.rpc.buscar_cartas = ...
  tablas: {},       // por nombre de tabla:   guion.tablas.cartas = ...
  // --- Gemini ---
  modelos: null,    // la lista de modelos
  embed: null,      // :embedContent
  generar: null,    // :generateContent
};

/** Vuelve todo a cero entre un test y otro. */
export function limpiarGuion() {
  peticiones.length = 0;
  guion.rpc = {};
  guion.tablas = {};
  guion.modelos = null;
  guion.embed = null;
  guion.generar = null;
}

// La lista de modelos que devuelve Gemini si el test no dice otra cosa.
// Incluye un `lite`, un `flash` y un grande, para que el orden de preferencia
// de `servicios.js` se pueda comprobar.
export const MODELOS_POR_OMISION = {
  models: [
    { name: "models/gemini-2.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-vision-raro", supportedGenerationMethods: ["generateContent"] },
    { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
  ],
};

/** Un vector de la dimensión que pide la aplicación. */
export const vectorFalso = (d = 1536) => Array.from({ length: d }, (_, i) => (i % 7) / 7);

async function leerCuerpo(req) {
  const trozos = [];
  for await (const t of req) trozos.push(t);
  return Buffer.concat(trozos).toString("utf8");
}

function normalizar(respuesta) {
  if (typeof respuesta === "function") return respuesta;
  return () => respuesta;
}

async function contestar(res, salida) {
  if (salida?.demora === "nunca") return; // no contesta: el cliente se corta solo
  if (typeof salida?.demora === "number") {
    await new Promise((listo) => setTimeout(listo, salida.demora));
  }
  const estado = salida?.estado ?? 200;
  const cabeceras = { "Content-Type": "application/json", ...(salida?.cabeceras || {}) };
  res.writeHead(estado, cabeceras);
  // `crudo` permite devolver algo que NO es JSON, para probar qué hace la
  // aplicación cuando del otro lado le contestan con una página de error.
  if (salida?.crudo !== undefined) return res.end(String(salida.crudo));
  res.end(JSON.stringify(salida?.cuerpo ?? null));
}

/** Levanta los dos servidores y apunta las variables de entorno hacia ellos.
 *
 *  Devuelve `cerrar()`. Hay que llamarlo al final, o el proceso de tests no
 *  termina.
 */
export async function levantar() {
  // ---- el Supabase de mentira (PostgREST) ----
  const base = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const cuerpo = await leerCuerpo(req);
    peticiones.push({
      quien: "base",
      metodo: req.method,
      url: req.url,
      cabeceras: { ...req.headers },
      cuerpo,
    });

    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(.+)$/);
    if (rpc) {
      const nombre = decodeURIComponent(rpc[1]);
      const h = guion.rpc[nombre];
      if (!h) {
        // Igual que PostgREST cuando la función no existe.
        return contestar(res, {
          estado: 404,
          cuerpo: { code: "PGRST202", message: `Could not find the function ${nombre}` },
        });
      }
      return contestar(res, normalizar(h)({ nombre, cuerpo: JSON.parse(cuerpo || "{}"), url }));
    }

    const tabla = url.pathname.match(/^\/rest\/v1\/([^/]+)$/);
    if (tabla) {
      const nombre = decodeURIComponent(tabla[1]);
      const h = guion.tablas[nombre];
      if (!h) return contestar(res, { estado: 404, cuerpo: { message: "no such table" } });
      return contestar(res, normalizar(h)({ nombre, url, params: url.searchParams, req }));
    }

    return contestar(res, { estado: 404, cuerpo: { message: "ruta desconocida" } });
  });

  // ---- el Gemini de mentira ----
  const gemini = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const cuerpo = await leerCuerpo(req);
    peticiones.push({
      quien: "gemini",
      metodo: req.method,
      url: req.url,
      cabeceras: { ...req.headers },
      cuerpo,
    });

    if (url.pathname.endsWith("/models")) {
      return contestar(
        res,
        normalizar(guion.modelos ?? { cuerpo: MODELOS_POR_OMISION })({ url })
      );
    }
    if (url.pathname.includes(":embedContent")) {
      const h = guion.embed ?? { cuerpo: { embedding: { values: vectorFalso() } } };
      return contestar(res, normalizar(h)({ url, cuerpo: JSON.parse(cuerpo || "{}") }));
    }
    if (url.pathname.includes(":generateContent")) {
      const h =
        guion.generar ?? {
          cuerpo: { candidates: [{ content: { parts: [{ text: "traducción de prueba" }] } }] },
        };
      return contestar(res, normalizar(h)({ url, cuerpo: JSON.parse(cuerpo || "{}") }));
    }
    return contestar(res, { estado: 404, cuerpo: { message: "ruta desconocida" } });
  });

  base.listen(0);
  gemini.listen(0);
  await Promise.all([once(base, "listening"), once(gemini, "listening")]);

  process.env.SUPABASE_URL = `http://127.0.0.1:${base.address().port}`;
  process.env.SUPABASE_KEY = CLAVE_DE_BASE_FALSA;
  process.env.GEMINI_BASE = `http://127.0.0.1:${gemini.address().port}`;
  process.env.GEMINI_API_KEY = CLAVE_DE_GEMINI_FALSA;
  // Que una traducción que falla no tarde cuarenta y cinco segundos en los tests.
  process.env.TRADUCIR_PRESUPUESTO_MS = "4000";
  process.env.TRADUCIR_POR_LLAMADA_MS = "1200";

  return async function cerrar() {
    await Promise.all([
      new Promise((listo) => base.close(listo)),
      new Promise((listo) => gemini.close(listo)),
    ]);
  };
}

// Claves falsas con la FORMA de las de verdad, para que los tests que buscan
// filtraciones sean honestos: si el limpiador reconoce estas, reconoce las
// reales.
export const CLAVE_DE_GEMINI_FALSA = "AIzaSyFALSAfalsafalsafalsafalsafalsa01";
export const CLAVE_DE_BASE_FALSA =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImZhbHNvIn0.firmaFalsaFalsaFalsa";

// ---------------------------------------------------------------------------
//  AYUDAS PARA ESCRIBIR LOS TESTS
// ---------------------------------------------------------------------------

/** Un pedido POST con cuerpo JSON, como el que manda la página. */
export function postJson(ruta, cuerpo, cabeceras = {}) {
  const texto = typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
  return new Request(`http://localhost${ruta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cabeceras },
    body: texto,
  });
}

/** Un pedido GET. */
export function get(ruta, cabeceras = {}) {
  return new Request(`http://localhost${ruta}`, { method: "GET", headers: cabeceras });
}

/** El texto hebreo de una carta de prueba, para el control de tramos. */
export const CARTA_HEBREA =
  "ב\"ה, כ\"ה אדר תש\"כ\n\nברוקלין, נ.י.\n\nשלום וברכה!\n\n" +
  "במענה למכתבו מיום הבהיר, הנה כבר כתבתי לו בארוכה בעניין זה.";
