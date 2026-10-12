import { vectorDeConsulta, rpc } from "../../lib/servicios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TOPES. Antes `limite` y `desplazamiento` pasaban por `Number()` y nada más.
// Como cada resultado trae el texto completo de la carta, un solo pedido con
// `{"limite": 1000000000}` le pedía a Postgres el corpus entero y lo armaba en
// memoria para serializarlo: se agota la memoria de la función, se agota el
// tiempo, y se puede repetir gratis. La página nunca pide más de 20.
const LIMITE_MAXIMO = 100;
const DESPLAZAMIENTO_MAXIMO = 10000;
const CONSULTA_MAXIMA = 500;      // una consulta de búsqueda, no un documento
const FILTRO_MAXIMO = 200;        // nombre de tomo, tema o festividad

/** Un entero dentro de un rango, o el valor por omisión si no es un número.
 *
 *  `Math.trunc(Number(v))` sobre basura da NaN, y `JSON.stringify` lo manda
 *  como `null`, que del otro lado deja el filtro sin efecto. Eso ya fallaba
 *  cerrado. Lo que no fallaba cerrado era un número VÁLIDO y enorme.
 */
const entero = (v, por_omision, minimo, maximo) => {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return por_omision;
  return Math.min(Math.max(n, minimo), maximo);
};

/** Un filtro de texto, recortado. null si viene vacío. */
const filtro = (v) => {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, FILTRO_MAXIMO);
  return t || null;
};

export async function POST(pedido) {
  try {
    const {
      consulta = "",
      filtros = {},
      limite = 20,
      desplazamiento = 0,
    } = await pedido.json();

    const texto = String(consulta ?? "").trim().slice(0, CONSULTA_MAXIMA);
    if (!texto && !Object.values(filtros).some(Boolean)) {
      return Response.json({ resultados: [], total: 0 });
    }

    // Con consulta escrita: búsqueda híbrida (vector + texto completo).
    // Sólo con filtros: el vector no aporta nada y se ahorra la llamada.
    //
    // Y si el vector NO SE PUEDE conseguir, se busca igual, sólo por texto.
    // Antes esto tiraba abajo toda la búsqueda escrita: `vectorDeConsulta`
    // llama a Gemini, y con la cuota diaria agotada devolvía 429, la excepción
    // subía hasta acá y el sitio contestaba 500. Los filtros seguían andando
    // porque no pasan por Gemini, y de afuera parecía que "escribir estaba
    // roto". La parte semántica es un extra: la búsqueda por texto completo no
    // tiene por qué depender de ella.
    let vector = null;
    let aviso = null;
    if (texto) {
      try {
        vector = await vectorDeConsulta(texto, process.env.GEMINI_API_KEY);
      } catch (e) {
        vector = null;
        aviso =
          "Ahora mismo estoy buscando sólo por las palabras exactas: " +
          "la búsqueda por significado no está disponible " +
          "(seguramente se agotó la cuota diaria de Gemini). " +
          "Vuelve sola cuando la cuota se renueve.";
      }
    }

    const argumentos = {
      consulta_embedding: vector,
      consulta_texto: texto || null,
      filtro_libro: filtro(filtros.libro),
      filtro_anio_desde: filtros.anioDesde
        ? entero(filtros.anioDesde, null, 1000, 3000) : null,
      filtro_anio_hasta: filtros.anioHasta
        ? entero(filtros.anioHasta, null, 1000, 3000) : null,
      filtro_festividad: filtro(filtros.festividad),
      filtro_tema: filtro(filtros.tema),
      limite: entero(limite, 20, 1, LIMITE_MAXIMO),
    };

    // La versión nueva de buscar_cartas acepta un desplazamiento y devuelve
    // cuántas coinciden en total. Si en la base todavía está la vieja, la
    // llamada con ese argumento no existe: se reintenta sin él y el sitio
    // sigue andando, nada más que sin paginar.
    const desde = entero(desplazamiento, 0, 0, DESPLAZAMIENTO_MAXIMO);

    let resultados, paginable = true;
    try {
      resultados = await rpc("buscar_cartas", {
        ...argumentos,
        desplazamiento: desde,
      });
    } catch (e) {
      if (desde > 0) throw e;
      resultados = await rpc("buscar_cartas", argumentos);
      paginable = false;
    }

    const total = resultados.length
      ? Number(resultados[0].total_coincidencias) || resultados.length
      : 0;

    return Response.json({ resultados, total, paginable, aviso });
  } catch (e) {
    // El detalle crudo de Supabase va a los registros de Vercel. Al navegador
    // va sólo el mensaje corto —`Supabase 404`, `HTTP 429`—, que es lo que
    // `mensajeAmable` necesita para decir en castellano qué revisar.
    console.error("buscar:", e?.message, e?.detalle || "");
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
