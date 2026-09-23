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

/** Lee filas de una tabla. */
export async function tabla(nombre, parametros = {}) {
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_KEY;
  if (!url || !clave) throw new Error("faltan SUPABASE_URL o SUPABASE_KEY");

  const query = new URLSearchParams(parametros).toString();
  const r = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${nombre}?${query}`, {
    headers: { apikey: clave, Authorization: `Bearer ${clave}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

const NOMBRE_DE_IDIOMA = {
  es: "español rioplatense neutro",
  en: "inglés",
  he: "hebreo moderno",
  pt: "portugués",
  fr: "francés",
  yi: "ídish",
};

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

  const situacion =
    total > 1
      ? `Este es el tramo ${parte} de ${total} de una carta del Rebe de ` +
        `Lubavitch. Traducí sólo este tramo. Puede empezar o terminar en ` +
        `mitad de una frase: no la completes ni la resumas, y no agregues ` +
        `encabezados, títulos ni "continuación".`
      : `Esta es una carta del Rebe de Lubavitch.`;

  const prompt =
    `${situacion} Traducila al ${nombreIdioma}.\n\n` +
    `El original está en hebreo rabínico y viene de un OCR, así que puede ` +
    `tener errores de lectura y abreviaturas. Traducí el sentido, desplegando ` +
    `las abreviaturas cuando estén claras. Si una parte es ilegible, poné ` +
    `[ilegible] en vez de inventar. Conservá los saltos de párrafo. ` +
    `Devolvé sólo la traducción, sin comentarios.\n\n---\n\n${texto}`;

  let ultimoError = "sin modelos de texto";
  for (const modelo of candidatos.slice(0, 4)) {
    const r = await fetch(`${GEMINI}/models/${modelo}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
      }),
    });
    if (r.ok) {
      const datos = await r.json();
      const candidato = datos?.candidates?.[0];
      const partes = candidato?.content?.parts || [];
      const salida = partes.map((p) => p.text || "").join("").trim();
      if (salida) {
        // Si aun así se llenó el cupo de salida, la página vuelve a partir
        // este tramo en vez de mostrar media traducción como si fuera entera.
        return { traduccion: salida, truncada: candidato?.finishReason === "MAX_TOKENS" };
      }
    }
    ultimoError = `${modelo}: HTTP ${r.status}`;
  }
  throw new Error(`no pude traducir (${ultimoError})`);
}
