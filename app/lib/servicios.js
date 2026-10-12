// Todo lo que habla con servicios externos vive acá, y sólo se ejecuta en el
// servidor. Es a propósito: las claves nunca llegan al navegador.

// La dirección real de Gemini. La variable existe para poder apuntar a un
// servidor de prueba al probar la aplicación; en Vercel no se define.
const GEMINI =
  process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com/v1beta";

const NO_SIRVEN = ["vision", "tts", "image", "audio", "live", "veo", "aqa"];

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
 */
function falloDeSupabase(estado, cuerpo) {
  const e = new Error(`Supabase ${estado}`);
  e.detalle = String(cuerpo).slice(0, 500);
  e.estado = estado;
  return e;
}

// El nombre del modelo no está escrito a mano en ningún lado: cambian cada
// pocos meses y una aplicación con uno fijo se rompe sola. Se pregunta a la
// API y se guarda en memoria mientras el servidor esté vivo.
let cacheDeModelos = null;

async function modelos(apiKey) {
  if (cacheDeModelos) return cacheDeModelos;

  const r = await fetch(`${GEMINI}/models?key=${apiKey}`);
  if (!r.ok) throw new Error(`no pude listar modelos: ${r.status}`);
  const datos = await r.json();

  const porGeneracion = (a, b) => {
    const version = (n) => {
      const m = n.match(/(\d+)\.(\d+)/);
      return m ? Number(m[1]) * 100 + Number(m[2]) : 0;
    };
    return version(b) - version(a) || a.length - b.length;
  };

  const nombres = (datos.models || []).map((m) => ({
    nombre: m.name.replace("models/", ""),
    metodos: m.supportedGenerationMethods || [],
  }));

  const utiles = (metodo, extra = () => true) =>
    nombres
      .filter((m) => m.metodos.includes(metodo))
      .map((m) => m.nombre)
      .filter((n) => !NO_SIRVEN.some((x) => n.includes(x)))
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
  cacheDeModelos = {
    embeddings: utiles("embedContent"),
    texto: [
      ...generaContenido((n) => n.includes("lite")),
      ...generaContenido((n) => n.includes("flash") && !n.includes("lite")),
      ...generaContenido((n) => !n.includes("flash") && !n.includes("lite")),
    ],
  };
  return cacheDeModelos;
}

/** Convierte la consulta del usuario en un vector de la misma forma que los
 *  que están guardados en la base. */
export async function vectorDeConsulta(texto, apiKey, dimension = 1536) {
  const { embeddings } = await modelos(apiKey);
  let ultimoError = "sin modelos de embeddings";

  for (const modelo of embeddings.slice(0, 4)) {
    const r = await fetch(`${GEMINI}/models/${modelo}:embedContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${modelo}`,
        content: { parts: [{ text: texto }] },
        outputDimensionality: dimension,
      }),
    });
    if (r.ok) {
      const datos = await r.json();
      const valores = datos?.embedding?.values;
      if (valores?.length) return valores;
    }
    ultimoError = `${modelo}: HTTP ${r.status}`;
  }
  throw new Error(`no pude vectorizar la consulta (${ultimoError})`);
}

/** Llama a una función de Postgres a través de la API de Supabase. */
export async function rpc(nombre, argumentos) {
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_KEY;
  if (!url || !clave) throw new Error("faltan SUPABASE_URL o SUPABASE_KEY");

  const r = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${nombre}`, {
    method: "POST",
    headers: {
      apikey: clave,
      Authorization: `Bearer ${clave}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(argumentos),
  });
  if (!r.ok) throw falloDeSupabase(r.status, await r.text());
  return r.json();
}

/** Lee filas de una tabla.
 *
 *  Con `conTotal` pide además el total de filas que hay en la tabla, no sólo
 *  las que vuelven. Hace falta porque Supabase recorta cuántas filas sirve por
 *  pedido: contar las que llegaron da un número más chico que el real, y el
 *  sitio terminaba diciendo que había menos cartas de las que hay.
 */
export async function tabla(nombre, parametros = {}, conTotal = false) {
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_KEY;
  if (!url || !clave) throw new Error("faltan SUPABASE_URL o SUPABASE_KEY");

  const cabeceras = { apikey: clave, Authorization: `Bearer ${clave}` };
  if (conTotal) cabeceras.Prefer = "count=exact";

  const query = new URLSearchParams(parametros).toString();
  const r = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${nombre}?${query}`, {
    headers: cabeceras,
  });
  if (!r.ok) throw falloDeSupabase(r.status, await r.text());

  const filas = await r.json();
  if (!conTotal) return filas;

  // el total viene en la cabecera, con la forma "0-999/1471"
  const rango = r.headers.get("content-range") || "";
  const despues = rango.split("/")[1];
  const total = despues && despues !== "*" ? Number(despues) : filas.length;
  return { filas, total };
}

/** Guarda una fila, y si ya estaba la reemplaza.
 *
 *  `alChocar` son las columnas que forman la clave; PostgREST necesita que se
 *  las nombre para saber qué hacer cuando la fila ya existe.
 */
export async function guardar(nombre, fila, alChocar = null) {
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_KEY;
  if (!url || !clave) throw new Error("faltan SUPABASE_URL o SUPABASE_KEY");

  const query = alChocar ? `?on_conflict=${alChocar}` : "";
  const r = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${nombre}${query}`, {
    method: "POST",
    headers: {
      apikey: clave,
      Authorization: `Bearer ${clave}`,
      "Content-Type": "application/json",
      Prefer: alChocar ? "resolution=merge-duplicates" : "return=minimal",
    },
    body: JSON.stringify(fila),
  });
  if (!r.ok) throw falloDeSupabase(r.status, await r.text());
}

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

/** Sin espacios ni saltos, para comparar dos recortes del mismo texto. */
const sinEspacios = (t) => String(t ?? "").replace(/\s+/g, "");

/** ¿Este tramo es de verdad un pedazo de esta carta?
 *
 *  ESTE ES EL CONTROL QUE FALTABA, y el agujero que tapa era el peor del
 *  sitio. `/api/traducir` recibía `cartaId` y `texto` del navegador, traducía
 *  el texto y guardaba el resultado en la tabla `traducciones` con esa clave,
 *  sin comprobar en ningún momento que el texto fuera de esa carta. El guardado
 *  es un upsert, así que PISA la fila que hubiera. Y la lectura busca sólo por
 *  (carta_id, idioma, parte, total) y, si encuentra algo, lo devuelve sin
 *  consultar a Gemini.
 *
 *  O sea que un POST anónimo con el id de una carta real y un párrafo
 *  inventado en castellano dejaba ese párrafo guardado como «la traducción» de
 *  esa carta, y a partir de ahí se le servía a todo el que apretara «Traducir
 *  entera». En un sitio que publica cartas del Rebe, eso es ponerle en la boca
 *  palabras que no dijo. Es lo más grave que se puede hacer en un sitio que,
 *  por lo demás, es de sólo lectura.
 *
 *  Ahora el texto a traducir se compara contra el de la base. Se comparan las
 *  dos cadenas SIN ESPACIOS, y no con un `includes` literal, por una razón
 *  concreta: `partirEnTramos` en la página corta por párrafo y después vuelve a
 *  pegar los pedazos chicos con `\n\n`, así que un tramo legítimo puede tener
 *  los saltos de línea distintos del original y un `includes` crudo lo
 *  rechazaría. Ignorando los espacios, un tramo de verdad siempre entra, y
 *  sigue siendo imposible fabricar un texto en castellano que, sin espacios,
 *  aparezca dentro de una carta en hebreo.
 */
export function esUnTramoDeLaCarta(tramo, textoDeLaBase) {
  const t = sinEspacios(tramo);
  const completo = sinEspacios(textoDeLaBase);
  if (!t || !completo) return false;
  return completo.includes(t);
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

/** Traduce un tramo del texto hebreo de una carta.
 *
 *  La página parte la carta en tramos y los pide de a uno. Antes se mandaba
 *  la carta entera con un techo de 4000 tokens de salida, y las cartas largas
 *  volvían cortadas a la mitad sin avisar. Ahora cada tramo entra holgado, y
 *  de paso cada pedido termina rápido: Vercel corta a los 60 segundos.
 */
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
const PRESUPUESTO_MS = 45000;
const POR_LLAMADA_MS = 22000;

export async function traducir(texto, idioma, apiKey, parte = 1, total = 1) {
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
      const r = await fetch(`${GEMINI}/models/${modelo}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: armarPrompt(texto, nombreIdioma, parte, total, insistir) }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
        }),
        signal: AbortSignal.timeout(margen),
      });
      if (!r.ok) return { error: `HTTP ${r.status}`, estado: r.status };
      const datos = await r.json();
      const candidato = datos?.candidates?.[0];
      const salida = (candidato?.content?.parts || [])
        .map((p) => p.text || "").join("").trim();
      if (!salida) return { error: "respuesta vacía" };
      return { salida, truncada: candidato?.finishReason === "MAX_TOKENS" };
    } catch (e) {
      // AbortSignal.timeout lanza TimeoutError; cualquier otra cosa es de red
      const porTiempo = e?.name === "TimeoutError" || e?.name === "AbortError";
      return { error: porTiempo ? "tardó demasiado" : String(e?.message || e) };
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
    let reintentos = 0;                  // por sobrecarga
    let ecos = 0;                        // por devolver el hebreo
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
          throw new Error(`no pude traducir (${modelo}: HTTP ${estado}). ` +
                          `Revisá la clave de Gemini.`);
        }
        // Sobrecarga: se espera un momento y se reintenta el mismo modelo,
        // mientras quede presupuesto y no se haya intentado ya dos veces.
        if (PASAJERO.has(estado) && reintentos < 2 && restante() > ESPERA_MS + 3000) {
          reintentos++;
          await new Promise((listo) => setTimeout(listo, ESPERA_MS * reintentos));
          continue;
        }
        break;                            // al modelo siguiente
      }

      // Si volvió en hebreo, el modelo copió en vez de traducir. Se insiste
      // una vez y, si sigue igual, se pasa al modelo siguiente. Mostrarlo
      // sería peor que fallar: parece una traducción y no lo es.
      if (!esperaHebreo && proporcionHebrea(salida) > 0.5) {
        anotar(`${modelo}: devolvió el hebreo sin traducir`);
        if (ecos === 0) { ecos++; insistir = true; continue; }
        break;
      }
      return { traduccion: salida, truncada, modelo };
    }
  }
  throw new Error(`no pude traducir (${diario.join(" · ") || "sin modelos de texto"})`);
}
