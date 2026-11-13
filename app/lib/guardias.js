// ===========================================================================
//  GUARDIAS
//
//  Todo lo que revisa que algo venga bien, en un solo lugar y sin tocar la
//  red. Las funciones de este archivo son puras: entra un valor, sale un
//  valor. Por eso se pueden probar una por una, y por eso los tests de
//  `pruebas/guardias.test.mjs` pueden ser exhaustivos.
//
//  POR QUÉ ESTÁ SEPARADO. Antes cada ruta traía su propia copia de `entero`
//  y su propio tope escrito a mano. Eran copias casi iguales, y "casi" es el
//  problema: `/api/traducir` revisaba el largo del texto y `/api/buscar` no
//  revisaba el tamaño del cuerpo, porque nadie se acordó de poner lo mismo en
//  los dos lados. Con un solo archivo, un arreglo acá arregla todas las rutas.
// ===========================================================================

// ---------------------------------------------------------------------------
//  LOS TOPES, TODOS JUNTOS
//
//  Están acá y no desparramados para poder leerlos de un vistazo y para que
//  los tests los importen en vez de repetir los números.
// ---------------------------------------------------------------------------

/** El cuerpo más grande que aceptamos. El pedido legítimo más gordo es un
 *  tramo de carta para traducir (2.500 caracteres) más unos pocos campos.
 *  64 KB deja margen de sobra y cierra la puerta a un POST de varios megas. */
export const TOPE_CUERPO = 64 * 1024;

export const TOPE_CONSULTA = 500; // una consulta de búsqueda, no un documento
export const TOPE_FILTRO = 200; // nombre de tomo, tema o festividad
export const TOPE_ID = 200; // los ids del corpus son cortos
export const TOPE_TEXTO = 4000; // más que un tramo de la página, con margen
export const TOPE_LIMITE = 100; // la página nunca pide más de 20
export const TOPE_DESPLAZAMIENTO = 10000;
export const TOPE_TRAMOS = 500; // una carta tiene unos pocos tramos

/** Cuánto esperamos a Supabase antes de darlo por colgado.
 *
 *  POR QUÉ HACE FALTA. Vercel mata la función a los 60 segundos y devuelve
 *  una página de error en HTML, no en JSON. La página hace `res.json()` sobre
 *  eso y revienta con "Unexpected token 'A'", que no le dice nada a nadie.
 *  Eso ya estaba arreglado para las llamadas a Gemini, pero NINGUNA de las
 *  cuatro llamadas a Supabase tenía tiempo máximo: si Supabase se colgaba,
 *  la función se quedaba esperando hasta que Vercel la mataba. Mismo error,
 *  por el otro lado. Con esto se corta sola y devuelve JSON. */
export const TIEMPO_SUPABASE_MS = 12000;

/** Lo mismo para la lista de modelos de Gemini, que tampoco tenía tope. */
export const TIEMPO_MODELOS_MS = 10000;

// ---------------------------------------------------------------------------
//  NÚMEROS Y TEXTOS
// ---------------------------------------------------------------------------

/** Un entero dentro de un rango, o el valor por omisión si no es un número.
 *
 *  `Math.trunc(Number(v))` sobre basura da NaN, y `JSON.stringify` lo manda
 *  como `null`, que del otro lado deja el filtro sin efecto. Eso ya fallaba
 *  cerrado. Lo que no fallaba cerrado era un número VÁLIDO y enorme: un solo
 *  pedido con `{"limite": 1000000000}` le pedía a Postgres el corpus entero.
 *
 *  Ojo con `Number`: `Number(null)` es 0 y `Number([])` es 0, o sea que un
 *  nulo o un arreglo vacío pasarían como el número cero en vez de caer al
 *  valor por omisión. Por eso se rechaza antes todo lo que no sea número o
 *  texto que parezca número.
 */
export function entero(v, porOmision, minimo, maximo) {
  if (typeof v !== "number" && typeof v !== "string") return porOmision;
  if (typeof v === "string" && v.trim() === "") return porOmision;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return porOmision;
  return Math.min(Math.max(n, minimo), maximo);
}

/** Un texto recortado al tope, o cadena vacía si no era un texto.
 *
 *  NO CONVIERTE. Antes `/api/buscar` hacía `String(consulta ?? "")`, así que
 *  `{"consulta": {"a": 1}}` se volvía el texto `[object Object]` y se le
 *  mandaba a Gemini para que lo vectorizara, con su costo. Y
 *  `{"consulta": ["a","b"]}` se volvía `a,b`. Un objeto no es una consulta:
 *  acá se descarta.
 */
export function textoLimpio(v, tope) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, tope);
}

/** Un filtro de texto, o null si viene vacío o no es texto. */
export function filtro(v) {
  const t = textoLimpio(v, TOPE_FILTRO);
  return t || null;
}

/** Un id de carta, o null si no sirve. */
export function idDeCarta(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > TOPE_ID) return null;
  // Los ids del corpus son `igrot_13::00003` y parecidos: letras, números y
  // unos pocos signos. Un id con una barra, un signo de pregunta o un salto
  // de línea no es un id del corpus, es alguien probando qué pasa.
  if (!/^[A-Za-z0-9_:.\-]+$/.test(t)) return null;
  return t;
}

/** Un objeto de verdad, o `{}`.
 *
 *  `{"filtros": null}` tiraba el servidor abajo con un 500: el valor por
 *  omisión `filtros = {}` sólo actúa cuando el campo FALTA, no cuando viene
 *  nulo, y después `Object.values(null)` explota. Y `{"filtros": "abc"}`
 *  tampoco fallaba cerrado: `Object.values("abc")` da `['a','b','c']`, que
 *  es una lista con cosas adentro, así que la búsqueda seguía como si
 *  hubiera filtros puestos.
 */
export function objeto(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
  return v;
}

/** ¿Hay por lo menos un filtro con algo adentro? */
export function hayAlgunFiltro(filtros) {
  return Object.values(objeto(filtros)).some(
    (v) => v !== null && v !== undefined && v !== "" && v !== false
  );
}

// ---------------------------------------------------------------------------
//  EL CUERPO DEL PEDIDO
// ---------------------------------------------------------------------------

/** Un error con un código de respuesta pegado, para que la ruta sepa qué
 *  contestar sin tener que adivinar leyendo el mensaje. */
export function errorDePedido(codigo, mensaje) {
  const e = new Error(mensaje);
  e.codigoHttp = codigo;
  e.deEntrada = true; // lo mandó quien llama: no es una falla nuestra
  return e;
}

/** Lee el cuerpo como JSON, SIN dejar que entre algo enorme.
 *
 *  POR QUÉ NO ALCANZA `await pedido.json()` Y DESPUÉS MIRAR EL LARGO. Es lo
 *  que hacía `/api/traducir`: el tope de 4.000 caracteres se revisaba cuando
 *  el texto ya estaba en memoria. Las rutas del App Router no traen límite de
 *  tamaño de cuerpo, así que un POST de varios megas entraba completo, se
 *  parseaba completo, y recién ahí se rechazaba. `/api/buscar` no tenía
 *  ningún límite.
 *
 *  Acá se mira primero `content-length`, que corta el 99% de los casos sin
 *  leer un byte. Pero esa cabecera la elige quien llama y puede mentir o no
 *  venir, así que además se lee el cuerpo como TEXTO contando cuánto entra y
 *  se corta en el tope. El parseo es lo último.
 */
export async function cuerpoJson(pedido, tope = TOPE_CUERPO) {
  const declarado = Number(pedido.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > tope) {
    throw errorDePedido(413, "el pedido es demasiado grande");
  }

  const texto = await leerHastaElTope(pedido, tope);

  if (!texto.trim()) throw errorDePedido(400, "el pedido viene vacío");
  try {
    return JSON.parse(texto);
  } catch {
    throw errorDePedido(400, "el pedido no es JSON válido");
  }
}

/** Lee el cuerpo contando los bytes y aborta si se pasa del tope.
 *
 *  Va por el flujo y no por `pedido.text()` a propósito: `text()` junta todo
 *  en memoria antes de devolverlo, así que mide el tamaño cuando ya lo
 *  aceptó. Acá se corta en el momento en que se pasa.
 */
async function leerHastaElTope(pedido, tope) {
  if (!pedido.body) {
    // Sin flujo (algunos entornos, y los pedidos sin cuerpo): se cae al
    // camino simple, que acá es seguro porque `content-length` ya se revisó.
    const t = await pedido.text();
    if (t.length > tope) throw errorDePedido(413, "el pedido es demasiado grande");
    return t;
  }

  const lector = pedido.body.getReader();
  const decodificador = new TextDecoder();
  let entraron = 0;
  let texto = "";
  try {
    while (true) {
      const { done, value } = await lector.read();
      if (done) break;
      entraron += value.byteLength;
      if (entraron > tope) {
        throw errorDePedido(413, "el pedido es demasiado grande");
      }
      texto += decodificador.decode(value, { stream: true });
    }
  } finally {
    // Que no quede el flujo a medio leer si cortamos por tamaño.
    try {
      await lector.cancel();
    } catch {
      /* ya estaba cerrado */
    }
  }
  return texto + decodificador.decode();
}

// ---------------------------------------------------------------------------
//  EL TIEMPO
// ---------------------------------------------------------------------------

/** Una señal que se corta a los `ms`, para pasársela a `fetch`.
 *
 *  Envuelta en función propia por dos razones: para que los tests puedan
 *  pedir tiempos cortos, y porque `AbortSignal.timeout` no existe en todos
 *  los entornos y así el respaldo queda en un solo lugar.
 */
export function señalConTiempo(ms) {
  if (typeof AbortSignal?.timeout === "function") return AbortSignal.timeout(ms);
  const control = new AbortController();
  setTimeout(() => control.abort(), ms).unref?.();
  return control.signal;
}

/** ¿Este error es "se acabó el tiempo"? */
export function esPorTiempo(e) {
  return e?.name === "TimeoutError" || e?.name === "AbortError";
}

// ---------------------------------------------------------------------------
//  LOS MENSAJES QUE SALEN AL NAVEGADOR
// ---------------------------------------------------------------------------

/** Lo que NUNCA tiene que salir en un mensaje de error.
 *
 *  POR QUÉ ESTO EXISTE. La clave de Gemini viajaba en la dirección
 *  (`?key=AIza...`). Cuando una de esas llamadas falla por red, el texto
 *  crudo del error se guardaba en el diario de intentos, y ese diario termina
 *  en la pantalla del visitante. O sea que había un camino por el que la
 *  clave podía salir publicada.
 *
 *  La clave ya no viaja en la dirección —ahora va en una cabecera—, pero eso
 *  arregla el camino que YO encontré. Esto es la red por si mañana aparece
 *  otro: antes de contestarle a alguien, el mensaje pasa por acá y lo que
 *  tenga forma de clave se tapa.
 *
 *  Las formas que se tapan:
 *    AIza...                   claves de Google
 *    eyJ... . ... . ...        los JWT de Supabase (anon y service_role)
 *    key=... / apikey=...      por si quedó en alguna dirección
 *    sb_secret_... / sbp_...   las claves nuevas de Supabase
 */
const FORMAS_DE_CLAVE = [
  /AIza[0-9A-Za-z_-]{10,}/g,
  /eyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}/g,
  /\bsb_(secret|publishable)_[0-9A-Za-z_-]{8,}/g,
  /\bsbp_[0-9A-Za-z_-]{8,}/g,
  /([?&](?:key|apikey|api_key|access_token|token)=)[^&\s"']+/gi,
];

/** Tapa todo lo que parezca una clave, y además lo que le pasemos a mano.
 *
 *  `extras` son los valores reales de las variables de entorno. Taparlos por
 *  valor exacto es lo más seguro que hay: no depende de que la clave tenga la
 *  forma que yo esperaba.
 */
export function limpiarMensaje(texto, ...extras) {
  let t = String(texto ?? "");
  for (const secreto of extras) {
    if (typeof secreto === "string" && secreto.length >= 8) {
      t = t.split(secreto).join("···");
    }
  }
  for (const forma of FORMAS_DE_CLAVE) {
    t = t.replace(forma, (entero, prefijo) => (prefijo ? `${prefijo}···` : "···"));
  }
  return t;
}

/** El mensaje corto que se le muestra al visitante, ya limpio y recortado. */
export function mensajeParaAfuera(e) {
  const crudo = e?.message ?? String(e);
  return limpiarMensaje(crudo, process.env.GEMINI_API_KEY, process.env.SUPABASE_KEY).slice(
    0,
    300
  );
}

// ---------------------------------------------------------------------------
//  LO QUE DEVUELVE LA BASE
// ---------------------------------------------------------------------------

/** PostgREST devuelve el valor pelado o envuelto en un arreglo, según la
 *  función. Esto normaliza las dos formas en un solo lugar.
 *
 *  Y aguanta el nulo: `resultados.length` sobre un nulo tiraba un 500. */
export function primeraFila(r) {
  if (Array.isArray(r)) return r.length ? r[0] : null;
  if (r === null || r === undefined) return null;
  return r;
}

/** Una lista, siempre. Si la base devolvió cualquier otra cosa, lista vacía.
 *
 *  Antes `/api/buscar` hacía `resultados.length` directo sobre lo que viniera.
 *  Con un nulo eso es un 500, y la página le muestra al visitante un error de
 *  servidor cuando lo honesto es decir que no hubo resultados.
 */
export function lista(r) {
  return Array.isArray(r) ? r : [];
}

// ---------------------------------------------------------------------------
//  EL CONTROL QUE NO SE PUEDE SALTEAR
// ---------------------------------------------------------------------------

/** Sin espacios ni saltos, para comparar dos recortes del mismo texto. */
export const sinEspacios = (t) => String(t ?? "").replace(/\s+/g, "");

/** ¿Este tramo es de verdad un pedazo de esta carta?
 *
 *  Vive acá, y no en `servicios.js`, porque es pura comparación de textos y
 *  así los tests lo pueden recorrer sin levantar nada.
 *
 *  QUÉ TAPA. `/api/traducir` recibía `cartaId` y `texto` del navegador,
 *  traducía y guardaba el resultado en `traducciones` con esa clave, sin
 *  comprobar que el texto fuera de esa carta. El guardado pisa la fila que
 *  hubiera, y la lectura devuelve lo guardado sin volver a consultar a
 *  Gemini. O sea que un POST anónimo con el id de una carta real y un párrafo
 *  inventado dejaba ese párrafo guardado como «la traducción» de esa carta.
 *  En un sitio que publica cartas del Rebe, eso es ponerle en la boca
 *  palabras que no dijo.
 *
 *  Se comparan las dos cadenas SIN ESPACIOS, y no con un `includes` literal,
 *  por una razón concreta: `partirEnTramos` en la página corta por párrafo y
 *  después vuelve a pegar los pedazos chicos con `\n\n`, así que un tramo
 *  legítimo puede tener los saltos distintos del original y un `includes`
 *  crudo lo rechazaría. Ignorando los espacios, un tramo de verdad siempre
 *  entra, y sigue siendo imposible fabricar un texto en castellano que, sin
 *  espacios, aparezca dentro de una carta en hebreo.
 */
export function esUnTramoDeLaCarta(tramo, textoDeLaBase) {
  const t = sinEspacios(tramo);
  const completo = sinEspacios(textoDeLaBase);
  if (!t || !completo) return false;
  return completo.includes(t);
}

// ---------------------------------------------------------------------------
//  QUIÉN ESTÁ PIDIENDO
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";

/** Una huella estable del visitante, para el techo por persona.
 *
 *  POR QUÉ NO SE GUARDA LA IP. El techo por visitante necesita distinguir a
 *  uno de otro, y nada más que eso. Guardar la dirección IP de cada persona
 *  que entra a leer cartas del Rebe es guardar un dato personal que no nos
 *  hace falta para nada: con una huella irreversible alcanza. En la base
 *  queda un revoltijo de letras, no una dirección.
 *
 *  La sal sale de una variable de entorno si está puesta. No es un secreto
 *  crítico —acá no hay nada que descifrar— pero con sal la huella tampoco se
 *  puede comparar contra una lista de IP conocidas calculada por fuera.
 */
export function huellaDelVisitante(pedido) {
  const cabecera =
    pedido.headers.get("x-forwarded-for") ||
    pedido.headers.get("x-real-ip") ||
    pedido.headers.get("cf-connecting-ip") ||
    "";
  // `x-forwarded-for` puede traer varias direcciones separadas por coma: la
  // primera es el visitante, las demás son los intermediarios.
  const direccion = cabecera.split(",")[0].trim();
  if (!direccion) return null;
  const sal = process.env.SAL_DE_VISITANTES || "igrot";
  return createHash("sha256").update(`${sal}:${direccion}`).digest("hex").slice(0, 32);
}
