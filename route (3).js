import { tabla } from "../../lib/servicios.js";
import { idDeCarta, mensajeParaAfuera } from "../../lib/guardias.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

// Qué columnas se sirven. Escritas a mano, nunca `select=*`: así, el día que
// se agregue una columna interna a `cartas`, no se publica sola.
const COLUMNAS =
  "id,encabezado,fecha_hebrea_texto,dia_hebreo,mes_hebreo,anio_hebreo," +
  "lugar,pagina_inicio,pagina_fin,n_palabras,flags,numero_carta";

// La búsqueda devuelve lo justo para mostrar la lista. Cuando alguien abre
// una carta pedimos el resto: fecha hebrea tal como está impresa, lugar,
// páginas, encabezado.
export async function GET(pedido) {
  try {
    // `idDeCarta` hace tres cosas de una: exige que sea texto, lo recorta al
    // tope y revisa que tenga la forma de un id del corpus. Antes sólo se
    // miraba que existiera y que no pasara de 200 caracteres, así que
    // cualquier cadena rara viajaba hasta PostgREST para que la rechazara allá.
    const id = idDeCarta(new URL(pedido.url).searchParams.get("id"));
    if (!id) return Response.json({ error: "falta id" }, { status: 400 });

    const filas = await tabla("cartas", { select: COLUMNAS, id: `eq.${id}`, limit: "1" });

    if (!filas.length) return Response.json({ error: "no existe" }, { status: 404 });
    return Response.json({ carta: filas[0] });
  } catch (e) {
    console.error("carta:", e?.message, e?.detalle || "");
    return Response.json({ error: mensajeParaAfuera(e) }, { status: 500 });
  }
}
