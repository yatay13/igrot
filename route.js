import { tabla } from "../../lib/servicios";

export const runtime = "nodejs";
// Un minuto. Antes era una hora, y después de cargar cartas nuevas el sitio
// seguía anunciando el número viejo sin que nada estuviera mal en la base.
export const revalidate = 60;

export async function GET() {
  try {
    const libros = await tabla("libros", {
      select: "id,titulo,numero,total_cartas,anios_hebreos",
      order: "numero.asc",
    });

    // Los temas y las festividades salen de las propias cartas: así la lista
    // refleja lo que hay de verdad y no una lista escrita a mano que se
    // desactualiza.
    //
    // El total NO se cuenta sobre estas filas: Supabase recorta cuántas sirve
    // por pedido, así que contarlas daría de menos. Viene aparte, de la
    // cabecera, y es el número de la tabla entera.
    const { filas: cartas, total } = await tabla(
      "cartas",
      { select: "temas,festividades,anio_gregoriano", limit: "2000" },
      true
    );

    const contar = (campo) => {
      const cuenta = new Map();
      for (const c of cartas) {
        for (const v of c[campo] || []) {
          cuenta.set(v, (cuenta.get(v) || 0) + 1);
        }
      }
      return [...cuenta.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([valor, n]) => ({ valor, n }));
    };

    const anios = cartas
      .map((c) => c.anio_gregoriano)
      .filter((a) => typeof a === "number");

    return Response.json({
      libros,
      temas: contar("temas"),
      festividades: contar("festividades"),
      anioMin: anios.length ? Math.min(...anios) : null,
      anioMax: anios.length ? Math.max(...anios) : null,
      total,
      // si Supabase sirvió menos filas de las que hay, los conteos por tema
      // son sobre una muestra y no sobre todo
      muestra: cartas.length < total ? cartas.length : null,
    });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
