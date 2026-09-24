// Todo lo que habla con servicios externos vive acá, y sólo se ejecuta en el
// servidor. Es a propósito: las claves nunca llegan al navegador.

// La dirección real de Gemini. La variable existe para poder apuntar a un
// servidor de prueba al probar la aplicación; en Vercel no se define.
const GEMINI =
  process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com/v1beta";

const NO_SIRVEN = ["vision", "tts", "image", "audio", "live", "veo", "aqa"];

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

  cacheDeModelos = {
    embeddings: utiles("embedContent"),
    // para traducir preferimos un flash: es barato y alcanza de sobra
    texto: [
      ...utiles("generateContent", (n) => n.includes("flash")),
      ...utiles("generateContent", (n) => !n.includes("flash")),
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
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 300)}`);
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
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 300)}`);

  const filas = await r.json();
  if (!conTotal) return filas;

  // el total viene en la cabecera, con la forma "0-999/1471"
  const rango = r.headers.get("content-range") || "";
  const despues = rango.split("/")[1];
  const total = despues && despues !== "*" ? Number(despues) : filas.length;
  return { filas, total };
}

const NOMBRE_DE_IDIOMA = {
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
export async function traducir(texto, idioma, apiKey, parte = 1, total = 1) {
  const { texto: candidatos } = await modelos(apiKey);
  const nombreIdioma = NOMBRE_DE_IDIOMA[idioma] || idioma;
  // Traducir al hebreo o al ídish sí devuelve letras hebreas: ahí el control
  // de eco no corresponde.
  const esperaHebreo = idioma === "he" || idioma === "yi";

  async function pedir(modelo, insistir) {
    const r = await fetch(`${GEMINI}/models/${modelo}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: armarPrompt(texto, nombreIdioma, parte, total, insistir) }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
      }),
    });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const datos = await r.json();
    const candidato = datos?.candidates?.[0];
    const salida = (candidato?.content?.parts || [])
      .map((p) => p.text || "").join("").trim();
    if (!salida) return { error: "respuesta vacía" };
    return { salida, truncada: candidato?.finishReason === "MAX_TOKENS" };
  }

  let ultimoError = "sin modelos de texto";
  for (const modelo of candidatos.slice(0, 4)) {
    for (const insistir of [false, true]) {
      const { salida, truncada, error } = await pedir(modelo, insistir);
      if (error) { ultimoError = `${modelo}: ${error}`; break; }

      // Si volvió en hebreo, el modelo copió en vez de traducir. Se insiste
      // una vez y, si sigue igual, se pasa al modelo siguiente. Mostrarlo
      // sería peor que fallar: parece una traducción y no lo es.
      if (!esperaHebreo && proporcionHebrea(salida) > 0.5) {
        ultimoError = `${modelo}: devolvió el hebreo sin traducir`;
        continue;
      }
      return { traduccion: salida, truncada };
    }
  }
  throw new Error(`no pude traducir (${ultimoError})`);
}
