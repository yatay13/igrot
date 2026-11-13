// Todo lo que habla con servicios externos vive acá, y sólo se ejecuta en el
// servidor. Es a propósito: las claves nunca llegan al navegador.
//
// Lo que revisa que algo venga bien está en `guardias.js`, que no toca la red
// y por eso se puede probar función por función.

import {
  TIEMPO_SUPABASE_MS,
  TIEMPO_MODELOS_MS,
  esUnTramoDeLaCarta,
  limpiarMensaje,
  primeraFila,
  señalConTiempo,
  esPorTiempo,
} from "./guardias.js";

// Se reexportan para que las rutas sigan importando de un solo lado.
export { esUnTramoDeLaCarta, primeraFila };

// La dirección real de Gemini. La variable existe para poder apuntar a un
// servidor de prueba al probar la aplicación; en Vercel no se define.
const GEMINI =
  process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com/v1beta";

const NO_SIRVEN = ["vision", "tts", "image", "audio", "live", "veo", "aqa"];

/** La clave de Gemini va en una CABECERA, no en la dirección.
 *
 *  ANTES IBA EN LA DIRECCIÓN: `?key=AIza...`. Funciona, Google lo acepta, y
 *  es un problema igual. Una dirección aparece en el texto de los errores de
 *  red, en los registros de cualquier intermediario y en los mensajes que
 *  esta aplicación le muestra al visitante (el "diario" de intentos de
 *  `traducir` termina en pantalla). O sea que había un camino real por el que
 *  la clave podía quedar publicada.
 *
 *  En una cabecera no puede pasar: las cabeceras no viajan en la URL, no
 *  salen en el mensaje de un error de red y no se registran.
 */
const cabeceraDeGemini = (apiKey) => ({
  "Content-Type": "application/json",
  "x-goog-api-key": apiKey,
});

/** Un fallo de Supabase, con el cuerpo crudo GUARDADO APARTE.
 *
 *  POR QUÉ NO VA EN EL MENSAJE. Antes acá se hacía:
 *
 *      throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 300)}`)
 *
 *  y las rutas devuelven `e.message` al navegador. O sea que el cuerpo de
 *  PostgREST —con `message`, `details` y `hint`— terminaba en la pantalla de
 *  cualquiera. Eso le cuenta a un desconocido los nombres de las columnas, la
 *  firma de las funciones, el tipo de la clave y si las políticas de acceso
 *  están puestas. No es una puerta abierta, pero es el plano del edificio.
 *
 *  El `message` queda corto y SIN el cuerpo, pero conserva `Supabase <código>`
 *  porque de eso depende `mensajeAmable` en la página para decirte en castellano
 *  qué revisar. El cuerpo crudo va en `.detalle`, que las rutas mandan a
 *  `console.error` y queda en los registros de Vercel: ahí lo necesitás vos, no
 *  el visitante.
 *
 *  Y el detalle pasa por `limpiarMensaje` antes de guardarse, porque va a los
 *  registros: si PostgREST alguna vez devolviera algo con forma de clave
 *  adentro, tampoco quiero eso escrito en Vercel.
 */
function falloDeSupabase(estado, cuerpo) {
  const e = new Error(`Supabase ${estado}`);
  e.detalle = limpiarMensaje(cuerpo, process.env.SUPABASE_KEY).slice(0, 500);
  e.estado = estado;
  return e;
}

/** Dónde está Supabase y con qué clave, revisado una sola vez. */
function dondeEstaLaBase() {
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_KEY;
  if (!url || !clave) throw new Error("faltan SUPABASE_URL o SUPABASE_KEY");
  return { base: url.replace(/\/$/, ""), clave };
}

/** `fetch` con tiempo máximo y con el error ya traducido.
 *
 *  NINGUNA de las cuatro llamadas a Supabase tenía tope de tiempo. Si
 *  Supabase se colgaba, la función se quedaba esperando hasta que Vercel la
 *  mataba a los 60 segundos y devolvía una página de error en HTML; la página
 *  hacía `res.json()` sobre eso y reventaba con "Unexpected token 'A'". Es
 *  exactamente el error que ya estaba arreglado para Gemini, pero por el otro
 *  lado.
 */
async function pedirConTiempo(url, opciones, ms, queEra) {
  try {
    return await fetch(url, { ...opciones, signal: señalConTiempo(ms) });
  } catch (e) {
    if (esPorTiempo(e)) {
      const t = new Error(`${queEra} no contestó en ${Math.round(ms / 1000)} segundos`);
      t.porTiempo = true;
      throw t;
    }
    // Un error de red puede traer la dirección adentro. Se limpia igual,
    // aunque la clave ya no viaje en la dirección.
    throw new Error(
      limpiarMensaje(
        `${queEra}: ${e?.message || e}`,
        process.env.SUPABASE_KEY,
        process.env.GEMINI_API_KEY
      )
    );
  }
}

// El nombre del modelo no está escrito a mano en ningún lado: cambian cada
// pocos meses y una aplicación con uno fijo se rompe sola. Se pregunta a la
// API y se guarda en memoria mientras el servidor esté vivo.
let cacheDeModelos = null;

/** Se exporta sólo para los tests, que necesitan arrancar sin memoria previa. */
export function olvidarModelos() {
  cacheDeModelos = null;
}

async function modelos(apiKey) {
  if (cacheDeModelos) return cacheDeModelos;
  if (!apiKey) throw new Error("falta GEMINI_API_KEY");

  const r = await pedirConTiempo(
    `${GEMINI}/models`,
    { headers: cabeceraDeGemini(apiKey) },
    TIEMPO_MODELOS_MS,
    "la lista de modelos de Gemini"
  );
  if (!r.ok) throw new Error(`no pude listar modelos: HTTP ${r.status}`);
  const datos = await r.json();

  const porGeneracion = (a, b) => {
    const version = (n) => {
      const m = n.match(/(\d+)\.(\d+)/);
      return m ? Number(m[1]) * 100 + Number(m[2]) : 0;
    };
    return version(b) - version(a) || a.length - b.length;
  };

  const nombres = (datos.models || []).map((m) => ({
    nombre: String(m.name || "").replace("models/", ""),
    metodos: m.supportedGenerationMethods || [],
  }));

  const utiles = (metodo, extra = () => true) =>
    nombres
      .filter((m) => m.metodos.includes(metodo))
      .map((m) => m.nombre)
      .filter((n) => n && !NO_SIRVEN.some((x) => n.includes(x)))
      .filter(extra)
      .sort(porGeneracion);

  // El orden importa más de lo que parece. Ordenados por generación, arriba
  // quedan siempre los modelos más nuevos, que son los más pedidos y los que
  // devuelven 503 o tardan una eternidad. Una corrida real de Ariel probó
  // gemini-3.8, 3.7, 3.6 y 3.5 flash: dos dieron 503 y dos se pasaron de
  // tiempo, y nunca llegó a los `lite`, que él mismo había medido como los
  // más rápidos (13 s contra 25 s).
  //
  // Para traducir no hace falta el modelo más nuevo: hace falta uno que
  // conteste. Así que primero los `lite`, después el resto de los flash, y al
  // final los grandes.
  const generaContenido = (extra) => utiles("generateContent", extra);
  const encontrados = {
    embeddings: utiles("embedContent"),
    texto: [
      ...generaContenido((n) => n.includes("lite")),
      ...generaContenido((n) => n.includes("flash") && !n.includes("lite")),
      ...generaContenido((n) => !n.includes("flash") && !n.includes("lite")),
    ],
  };

  // No guardar una lista vacía: si la respuesta vino rara, que el próximo
  // pedido vuelva a preguntar en vez de quedar sin modelos para siempre
  // mientras el servidor esté vivo.
  if (encontrados.embeddings.length || encontrados.texto.length) {
    cacheDeModelos = encontrados;
  }
  return encontrados;
}

/** Convierte la consulta del usuario en un vector de la misma forma que los
 *  que están guardados en la base. */
export async function vectorDeConsulta(texto, apiKey, dimension = 1536, visitante = null) {
  // El techo va ANTES de tocar Gemini. Si se pasó, se lanza un error: la ruta
  // de búsqueda ya sabe seguir sin la parte semántica y avisarle al visitante,
  // que es exactamente lo que corresponde acá.
  //
  // Son DOS techos y miden cosas distintas: el de la casa cuida la cuenta de
  // Gemini, y el del visitante impide que una sola persona se gaste el día de
  // todos los demás. Ver `consumirCuota`.
  if (!(await consumirCuotaDelVisitante("buscar", visitante))) {
    throw new Error(
      "hiciste muchas búsquedas por significado en poco tiempo. " +
        "Esperá un momento: la búsqueda por palabras exactas sigue andando."
    );
  }
  if (!(await consumirCuota("buscar"))) {
    throw new Error("se alcanzó el límite diario de búsquedas por significado");
  }
  const { embeddings } = await modelos(apiKey);
  let ultimoError = "sin modelos de embeddings";

  for (const modelo of embeddings.slice(0, 4)) {
    const r = await pedirConTiempo(
      `${GEMINI}/models/${modelo}:embedContent`,
      {
        method: "POST",
        headers: cabeceraDeGemini(apiKey),
        body: JSON.stringify({
          model: `models/${modelo}`,
          content: { parts: [{ text: texto }] },
          outputDimensionality: dimension,
        }),
      },
      TIEMPO_MODELOS_MS,
      `el modelo ${modelo}`
    );
    if (r.ok) {
      const datos = await r.json();
      const valores = datos?.embedding?.values;
      // Que sea una lista de números de la dimensión correcta, no "algo con
      // largo". Un vector de otra dimensión hace fallar la consulta en
      // Postgres con un error que no se entiende desde acá.
      if (Array.isArray(valores) && valores.length === dimension) return valores;
      ultimoError = `${modelo}: devolvió un vector raro`;
      continue;
    }
    ultimoError = `${modelo}: HTTP ${r.status}`;
  }
  throw new Error(`no pude vectorizar la consulta (${ultimoError})`);
}

/** Llama a una función de Postgres a través de la API de Supabase. */
export async function rpc(nombre, argumentos) {
  const { base, clave } = dondeEstaLaBase();

  const r = await pedirConTiempo(
    `${base}/rest/v1/rpc/${encodeURIComponent(nombre)}`,
    {
      method: "POST",
      headers: {
        apikey: clave,
        Authorization: `Bearer ${clave}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(argumentos),
    },
    TIEMPO_SUPABASE_MS,
    "la base"
  );
  if (!r.ok) throw falloDeSupabase(r.status, await r.text());
  return r.json();
}

/** ¿Queda cuota para llamar a Gemini hoy?
 *
 *  POR QUÉ EL CONTADOR ESTÁ EN LA BASE Y NO ACÁ. Vercel levanta varias copias
 *  de esta función y cada una tiene su propia memoria, así que un contador en
 *  el servidor sería el límite multiplicado por una cantidad de copias que no
 *  controlamos. En la base hay uno solo para todos.
 *
 *  Y el límite NO se le pasa a la función: vive en la tabla `limites`. Si
 *  viajara como parámetro, alcanzaría con llamarla con un número enorme.
 *
 *  SI LA BASE NO CONTESTA, SE DEJA PASAR. Es a propósito y vale decirlo: el
 *  techo es un control de GASTO, no de seguridad. Que Supabase tenga un mal
 *  momento no tiene por qué dejar al visitante sin traducir. Lo que sí se
 *  respeta siempre es un `false` explícito, que es la base diciendo «se acabó».
 */
export async function consumirCuota(servicio) {
  try {
    const r = await rpc("consumir_cuota", { p_servicio: servicio });
    return primeraFila(r) !== false;
  } catch (e) {
    console.warn("no pude consultar la cuota:", e?.message, e?.detalle || "");
    return true;
  }
}

/** ¿Y le queda cuota a ESTE visitante?
 *
 *  POR QUÉ HACÍA FALTA OTRO TECHO. El de arriba es uno solo para todo el
 *  mundo y por día. Te protege la cuenta de Gemini, y eso está bien. Pero
 *  tiene un costado que no se ve: **una sola persona puede gastarle el día a
 *  todos los demás**. Trescientas búsquedas en un minuto desde una sola
 *  computadora y el resto de las visitas se queda sin búsqueda por
 *  significado hasta mañana, sin que nada esté roto.
 *
 *  Este techo es por visitante y por ventana corta, y vive en la base por la
 *  misma razón que el otro: Vercel levanta varias copias y un contador en
 *  memoria no sirve de nada.
 *
 *  Si la función todavía no está creada en la base, se deja pasar: el sitio
 *  tiene que seguir andando mientras el SQL no se haya corrido.
 */
export async function consumirCuotaDelVisitante(servicio, visitante) {
  if (!visitante) return true; // sin manera de identificarlo, no se frena
  try {
    const r = await rpc("consumir_cuota_por_visitante", {
      p_servicio: servicio,
      p_visitante: visitante,
    });
    return primeraFila(r) !== false;
  } catch (e) {
    // Un 404 es "la función no existe todavía": no es un fallo, es que falta
    // correr el SQL. Cualquier otra cosa sí conviene verla en los registros.
    if (e?.estado !== 404) {
      console.warn("no pude consultar la cuota del visitante:", e?.message, e?.detalle || "");
    }
    return true;
  }
}

/** Guarda una traducción llamando a la función de la base.
 *
 *  No escribe la tabla directo. La función `guardar_traduccion` comprueba
 *  ADENTRO DE LA BASE que `original` sea de verdad un pedazo de esa carta,
 *  que es el mismo control que hace `esUnTramoDeLaCarta` acá. La diferencia
 *  es que adentro de la base no se puede saltear: una vez cerrada la
 *  escritura directa, no hay otro camino a la tabla.
 *
 *  Devuelve `true` si guardó. Un `false` quiere decir que la base rechazó el
 *  texto, y eso conviene que quede en los registros.
 */
export async function guardarTraduccion({
  cartaId,
  idioma,
  parte,
  total,
  texto,
  modelo,
  original,
}) {
  const r = await rpc("guardar_traduccion", {
    p_carta_id: cartaId,
    p_idioma: idioma,
    p_parte: parte,
    p_total: total,
    p_texto: texto,
    p_modelo: modelo || null,
    p_original: original,
  });
  return primeraFila(r) === true;
}

/** Lee filas de una tabla.
 *
 *  Con `conTotal` pide además el total de filas que hay en la tabla, no sólo
 *  las que vuelven. Hace falta porque Supabase recorta cuántas filas sirve por
 *  pedido: contar las que llegaron da un número más chico que el real, y el
 *  sitio terminaba diciendo que había menos cartas de las que hay.
 */
export async function tabla(nombre, parametros = {}, conTotal = false) {
  const { base, clave } = dondeEstaLaBase();

  const cabeceras = { apikey: clave, Authorization: `Bearer ${clave}` };
  if (conTotal) cabeceras.Prefer = "count=exact";

  // `URLSearchParams` escapa los valores, así que un `&select=*` metido
  // adentro de un id viaja escapado y PostgREST lo lee como parte del valor,
  // no como otro parámetro. Igual los ids pasan por `idDeCarta` antes de
  // llegar acá: dos controles, porque este archivo lo puede llamar código
  // nuevo que se olvide del otro.
  const query = new URLSearchParams(parametros).toString();
  const r = await pedirConTiempo(
    `${base}/rest/v1/${nombre}?${query}`,
    { headers: cabeceras },
    TIEMPO_SUPABASE_MS,
    "la base"
  );
  if (!r.ok) throw falloDeSupabase(r.status, await r.text());

  const filas = await r.json();
  if (!conTotal) return Array.isArray(filas) ? filas : [];

  // el total viene en la cabecera, con la forma "0-999/1471"
  const rango = r.headers.get("content-range") || "";
  const despues = rango.split("/")[1];
  const lasFilas = Array.isArray(filas) ? filas : [];
  const total = despues && despues !== "*" ? Number(despues) : lasFilas.length;
  return { filas: lasFilas, total: Number.isFinite(total) ? total : lasFilas.length };
}

// NO HAY UNA FUNCIÓN `guardar()` GENÉRICA, Y ES A PROPÓSITO.
//
// Había una: `guardar(nombre, fila, alChocar)`, exportada, que escribía
// CUALQUIER tabla con CUALQUIER contenido. No la llamaba nadie —lo comprobé
// buscando en todo el repositorio— porque el guardado de traducciones pasó a
// hacerse por `guardar_traduccion`. Quedó como una puerta sin llave en una
// pared que ya nadie usa: el día que alguien la vuelva a llamar «porque está
// ahí», se saltea los controles que hace la función de la base.
//
// Si algún día hay que escribir otra tabla, el camino es el mismo que el de
// las traducciones: una función en Postgres que revise adentro lo que tiene
// que revisar, y una llamada a `rpc` desde acá.

/** El texto hebreo de una carta, leído de la base por su id.
 *
 *  Hace falta para no creerle al navegador. Ver `esUnTramoDeLaCarta`.
 */
export async function textoDeLaCarta(cartaId) {
  if (!cartaId) return null;
  const filas = await tabla("cartas", {
    select: "texto",
    id: `eq.${cartaId}`,
    limit: "1",
  });
  return filas?.[0]?.texto ?? null;
}

/** La traducción de un tramo, si ya la habíamos hecho alguna vez. */
export async function traduccionGuardada(cartaId, idioma, parte, total) {
  if (!cartaId) return null;
  const filas = await tabla("traducciones", {
    select: "texto",
    carta_id: `eq.${cartaId}`,
    idioma: `eq.${idioma}`,
    parte: `eq.${parte}`,
    total: `eq.${total}`,
    limit: "1",
  });
  return filas?.[0]?.texto || null;
}

// Se exporta para que la ruta pueda usarla como LISTA BLANCA. Antes la ruta
// aceptaba cualquier `idioma` y acá se hacía `NOMBRE_DE_IDIOMA[idioma] || idioma`,
// así que un texto cualquiera elegido por quien llama entraba al pedido que se
// le manda a Gemini. Eso es un canal para escribirle instrucciones al modelo.
export const NOMBRE_DE_IDIOMA = {
  es: "español rioplatense neutro",
  en: "inglés",
  he: "hebreo moderno",
  pt: "portugués",
  fr: "francés",
  yi: "ídish",
};

/** Proporción de letras hebreas sobre el total de letras. */
function proporcionHebrea(texto) {
  const letras = String(texto).match(/\p{L}/gu) || [];
  if (!letras.length) return 0;
  const hebreas = letras.filter((c) => /[֐-׿]/.test(c)).length;
  return hebreas / letras.length;
}

function armarPrompt(texto, nombreIdioma, parte, total, insistir) {
  // El pedido arranca y termina con la orden de traducir. La aclaración de que
  // es un tramo va subordinada, porque cuando iba adelante y en imperativo
  // ("no completes, no resumas") el modelo a veces elegía lo más seguro:
  // devolver el hebreo tal cual, sin traducir nada.
  const ubicacion =
    total > 1
      ? `, que es el tramo ${parte} de ${total} de una carta del Rebe de Lubavitch`
      : `, que es una carta del Rebe de Lubavitch`;

  const reglas = [
    `El original es hebreo rabínico salido de un OCR: puede tener errores de ` +
      `lectura y abreviaturas. Traducí el sentido y desplegá las abreviaturas ` +
      `cuando estén claras.`,
    `Si una parte es ilegible, poné [ilegible] en vez de inventar.`,
    `Conservá los saltos de párrafo.`,
    total > 1
      ? `El tramo puede empezar o terminar en mitad de una frase: traducí lo ` +
        `que hay, sin completarlo ni resumirlo, y sin agregar encabezados, ` +
        `títulos ni la palabra "continuación".`
      : null,
    `Devolvé únicamente el texto en ${nombreIdioma}, sin comentarios y sin ` +
      `copiar el hebreo.`,
    insistir
      ? `IMPORTANTE: la respuesta anterior devolvió el hebreo sin traducir. ` +
        `La respuesta tiene que estar escrita en ${nombreIdioma}.`
      : null,
  ].filter(Boolean);

  return (
    `Traducí al ${nombreIdioma} el siguiente texto${ubicacion}.\n\n` +
    reglas.map((r) => `- ${r}`).join("\n") +
    `\n\n---\n\n${texto}`
  );
}

// Cuánto puede tardar todo el pedido, y cuánto una sola llamada a Gemini.
//
// Vercel corta la función a los 60 segundos y devuelve una página de error en
// texto plano, no en JSON. La página hacía `res.json()` sobre eso y reventaba
// con "Unexpected token 'A', "An error o"... is not valid JSON", que no le
// dice nada a nadie. La causa de fondo era esta función: probaba hasta cuatro
// modelos con dos intentos cada uno, y en el plan gratuito de Gemini una
// llamada tarda entre 13 y 25 segundos. Ocho llamadas nunca iban a entrar.
//
// Ahora se corta sola antes que Vercel, y al cortarse devuelve JSON.
//
// Se pueden bajar con variables de entorno SÓLO para los tests: sin ellas,
// los valores son los de producción.
const PRESUPUESTO_MS = Number(process.env.TRADUCIR_PRESUPUESTO_MS) || 45000;
const POR_LLAMADA_MS = Number(process.env.TRADUCIR_POR_LLAMADA_MS) || 22000;

/** Traduce un tramo del texto hebreo de una carta.
 *
 *  La página parte la carta en tramos y los pide de a uno. Antes se mandaba
 *  la carta entera con un techo de 4000 tokens de salida, y las cartas largas
 *  volvían cortadas a la mitad sin avisar. Ahora cada tramo entra holgado, y
 *  de paso cada pedido termina rápido.
 */
export async function traducir(texto, idioma, apiKey, parte = 1, total = 1, visitante = null) {
  // Igual que arriba, antes de gastar. Acá el corte sí se le muestra a la
  // persona: no hay manera de traducir «a medias».
  if (!(await consumirCuotaDelVisitante("traducir", visitante))) {
    throw new Error(
      "pediste muchas traducciones en poco tiempo. Esperá un momento y volvé " +
        "a intentar; las que ya están hechas se siguen mostrando."
    );
  }
  if (!(await consumirCuota("traducir"))) {
    throw new Error(
      "se alcanzó el límite diario de traducciones. Las que ya están hechas " +
        "se siguen mostrando; las nuevas vuelven mañana."
    );
  }
  const empezo = Date.now();
  const restante = () => PRESUPUESTO_MS - (Date.now() - empezo);

  const { texto: candidatos } = await modelos(apiKey);
  const nombreIdioma = NOMBRE_DE_IDIOMA[idioma] || idioma;
  // Traducir al hebreo o al ídish sí devuelve letras hebreas: ahí el control
  // de eco no corresponde.
  const esperaHebreo = idioma === "he" || idioma === "yi";

  async function pedir(modelo, insistir) {
    const margen = Math.min(POR_LLAMADA_MS, restante());
    if (margen <= 1000) return { error: "sin tiempo" };
    try {
      const r = await fetch(`${GEMINI}/models/${modelo}:generateContent`, {
        method: "POST",
        headers: cabeceraDeGemini(apiKey),
        body: JSON.stringify({
          contents: [
            { parts: [{ text: armarPrompt(texto, nombreIdioma, parte, total, insistir) }] },
          ],
          generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
        }),
        signal: señalConTiempo(margen),
      });
      if (!r.ok) return { error: `HTTP ${r.status}`, estado: r.status };
      const datos = await r.json();
      const candidato = datos?.candidates?.[0];
      const salida = (candidato?.content?.parts || [])
        .map((p) => p.text || "")
        .join("")
        .trim();
      if (!salida) return { error: "respuesta vacía" };
      return { salida, truncada: candidato?.finishReason === "MAX_TOKENS" };
    } catch (e) {
      // El mensaje de este error TERMINA EN PANTALLA, metido en el diario de
      // intentos. Por eso pasa por `limpiarMensaje`: es el último lugar por
      // donde una clave podría salir publicada.
      const porTiempo = esPorTiempo(e);
      return {
        error: porTiempo
          ? "tardó demasiado"
          : limpiarMensaje(String(e?.message || e), apiKey).slice(0, 120),
      };
    }
  }

  // Qué significa cada fallo, que no es lo mismo:
  //
  //   503, 500, 502, 504  el modelo está sobrecargado ahora mismo. Google los
  //                       devuelve seguido en el plan gratuito y se arreglan
  //                       solos en segundos: hay que esperar y reintentar el
  //                       MISMO modelo. Antes yo lo daba por perdido y pasaba
  //                       al siguiente, que suele estar igual de ocupado.
  //   429                 se acabó la cuota. Reintentar no ayuda.
  //   400, 401, 403       la clave o el pedido están mal. Cambiar de modelo
  //                       tampoco ayuda: se corta acá.
  const PASAJERO = new Set([500, 502, 503, 504]);
  const SIN_REMEDIO = new Set([400, 401, 403]);
  const ESPERA_MS = 1500;

  // qué dijo cada modelo, para el aviso. Sin repetir el mismo renglón tres
  // veces seguidas cuando un modelo falla en sus tres intentos: el mensaje
  // termina en pantalla y tiene que poder leerse.
  const diario = [];
  const anotar = (linea) => {
    if (diario[diario.length - 1] !== linea) diario.push(linea);
  };
  for (const modelo of candidatos.slice(0, 4)) {
    // Los dos motivos para repetir con el mismo modelo son distintos y se
    // cuentan aparte. Si comparten contador, un reintento por sobrecarga
    // termina mandando el prompt de "insistí, me devolviste el hebreo", que
    // no tiene nada que ver.
    let reintentos = 0; // por sobrecarga
    let ecos = 0; // por devolver el hebreo
    let insistir = false;

    while (true) {
      if (restante() <= 1000) {
        throw new Error(
          `no llegué a traducir a tiempo (${diario.join(" · ") || "sin intentos"}). ` +
            `Probá de nuevo: los modelos gratuitos de Gemini a veces tardan mucho.`
        );
      }

      const { salida, truncada, error, estado } = await pedir(modelo, insistir);

      if (error) {
        anotar(`${modelo}: ${error}`);
        if (SIN_REMEDIO.has(estado)) {
          throw new Error(
            `no pude traducir (${modelo}: HTTP ${estado}). Revisá la clave de Gemini.`
          );
        }
        // Sobrecarga: se espera un momento y se reintenta el mismo modelo,
        // mientras quede presupuesto y no se haya intentado ya dos veces.
        if (PASAJERO.has(estado) && reintentos < 2 && restante() > ESPERA_MS + 3000) {
          reintentos++;
          await new Promise((listo) => setTimeout(listo, ESPERA_MS * reintentos));
          continue;
        }
        break; // al modelo siguiente
      }

      // Si volvió en hebreo, el modelo copió en vez de traducir. Se insiste
      // una vez y, si sigue igual, se pasa al modelo siguiente. Mostrarlo
      // sería peor que fallar: parece una traducción y no lo es.
      if (!esperaHebreo && proporcionHebrea(salida) > 0.5) {
        anotar(`${modelo}: devolvió el hebreo sin traducir`);
        if (ecos === 0) {
          ecos++;
          insistir = true;
          continue;
        }
        break;
      }
      return { traduccion: salida, truncada, modelo };
    }
  }
  throw new Error(`no pude traducir (${diario.join(" · ") || "sin modelos de texto"})`);
}
