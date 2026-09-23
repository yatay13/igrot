import { vectorDeConsulta, rpc } from "../../lib/servicios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(pedido) {
  try {
    const { consulta = "", filtros = {}, limite = 20 } = await pedido.json();

    const texto = String(consulta).trim();
    if (!texto && !Object.values(filtros).some(Boolean)) {
      return Response.json({ resultados: [] });
    }

    // Con consulta escrita: búsqueda híbrida (vector + texto completo).
    // Sólo con filtros: el vector no aporta nada y se ahorra la llamada.
    let vector = null;
    if (texto) {
      vector = await vectorDeConsulta(texto, process.env.GEMINI_API_KEY);
    }

    const resultados = await rpc("buscar_cartas", {
      consulta_embedding: vector,
      consulta_texto: texto || null,
      filtro_libro: filtros.libro || null,
      filtro_anio_desde: filtros.anioDesde ? Number(filtros.anioDesde) : null,
      filtro_anio_hasta: filtros.anioHasta ? Number(filtros.anioHasta) : null,
      filtro_festividad: filtros.festividad || null,
      filtro_tema: filtros.tema || null,
      limite: Number(limite),
    });

    return Response.json({ resultados });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
