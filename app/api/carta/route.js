import { tabla } from "../../lib/servicios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// La búsqueda devuelve lo justo para mostrar la lista. Cuando alguien abre
// una carta pedimos el resto: fecha hebrea tal como está impresa, lugar,
// páginas, encabezado.
export async function GET(pedido) {
  try {
    const id = new URL(pedido.url).searchParams.get("id");
    if (!id) return Response.json({ error: "falta id" }, { status: 400 });

    const filas = await tabla("cartas", {
      select:
        "id,encabezado,fecha_hebrea_texto,dia_hebreo,mes_hebreo,anio_hebreo," +
        "lugar,pagina_inicio,pagina_fin,n_palabras,flags,numero_carta",
      id: `eq.${id}`,
      limit: "1",
    });

    if (!filas.length) return Response.json({ error: "no existe" }, { status: 404 });
    return Response.json({ carta: filas[0] });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
