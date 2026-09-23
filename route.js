import { tabla } from "../../lib/servicios";

export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET() {
  try {
    const libros = await tabla("libros", {
      select: "id,titulo,numero,total_cartas,anios_hebreos",
      order: "numero.asc",
    });

    // Los temas y las festividades salen de las propias cartas: así la lista
    // refleja lo que hay de verdad y no una lista escrita a mano que se
    // desactualiza.
    const cartas = await tabla("cartas", {
      select: "temas,festividades,anio_gregoriano",
      limit: "2000",
    });

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
      total: cartas.length,
    });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
