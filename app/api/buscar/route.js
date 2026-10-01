import { vectorDeConsulta, rpc } from "../../lib/servicios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(pedido) {
  try {
    const {
      consulta = "",
      filtros = {},
      limite = 20,
      desplazamiento = 0,
    } = await pedido.json();

    const texto = String(consulta).trim();
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
      filtro_libro: filtros.libro || null,
      filtro_anio_desde: filtros.anioDesde ? Number(filtros.anioDesde) : null,
      filtro_anio_hasta: filtros.anioHasta ? Number(filtros.anioHasta) : null,
      filtro_festividad: filtros.festividad || null,
      filtro_tema: filtros.tema || null,
      limite: Number(limite),
    };

    // La versión nueva de buscar_cartas acepta un desplazamiento y devuelve
    // cuántas coinciden en total. Si en la base todavía está la vieja, la
    // llamada con ese argumento no existe: se reintenta sin él y el sitio
    // sigue andando, nada más que sin paginar.
    let resultados, paginable = true;
    try {
      resultados = await rpc("buscar_cartas", {
        ...argumentos,
        desplazamiento: Number(desplazamiento),
      });
    } catch (e) {
      if (Number(desplazamiento) > 0) throw e;
      resultados = await rpc("buscar_cartas", argumentos);
      paginable = false;
    }

    const total = resultados.length
      ? Number(resultados[0].total_coincidencias) || resultados.length
      : 0;

    return Response.json({ resultados, total, paginable, aviso });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
