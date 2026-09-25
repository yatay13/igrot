import { rpc, tabla } from "../../lib/servicios";

export const runtime = "nodejs";
// Un minuto. Antes era una hora, y después de cargar cartas nuevas el sitio
// seguía anunciando el número viejo sin que nada estuviera mal en la base.
export const revalidate = 60;

/** Las listas contadas por la base, que es la única que las sabe exactas. */
async function desdeLaBase() {
  const datos = await rpc("facetas_de_cartas", {});
  // PostgREST devuelve el json tal cual, o envuelto en un arreglo
  const f = Array.isArray(datos) ? datos[0] : datos;
  if (!f || typeof f.total !== "number") throw new Error("respuesta rara");
  return { ...f, exactas: true };
}

/** Lo que se puede hacer sin la función nueva: contar sobre lo que llegue.
 *
 *  Queda como respaldo para que el sitio no se caiga si todavía no corriste
 *  el SQL. Los números salen cortos, y por eso se avisa con `exactas: false`
 *  en vez de mostrarlos como si fueran el total.
 */
async function comoSePueda() {
  const libros = await tabla("libros", {
    select: "id,titulo,numero,total_cartas,anios_hebreos",
    order: "numero.asc",
  });

  const { filas: cartas, total: totalPorCabecera } = await tabla(
    "cartas",
    { select: "temas,festividades,anio_gregoriano", limit: "2000" },
    true
  );

  const contar = (campo) => {
    const cuenta = new Map();
    for (const c of cartas) {
      for (const v of c[campo] || []) cuenta.set(v, (cuenta.get(v) || 0) + 1);
    }
    return [...cuenta.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([valor, n]) => ({ valor, n }));
  };

  const anios = cartas
    .map((c) => c.anio_gregoriano)
    .filter((a) => typeof a === "number");

  const sumaDeLibros = libros.reduce((a, l) => a + (l.total_cartas || 0), 0);

  return {
    libros,
    temas: contar("temas"),
    festividades: contar("festividades"),
    anioMin: anios.length ? Math.min(...anios) : null,
    anioMax: anios.length ? Math.max(...anios) : null,
    total: sumaDeLibros || totalPorCabecera || cartas.length,
    exactas: false,
    muestra: cartas.length,
  };
}

export async function GET() {
  try {
    return Response.json(await desdeLaBase());
  } catch (primerError) {
    try {
      const respaldo = await comoSePueda();
      respaldo.porQueNoSonExactas = String(primerError.message || primerError);
      return Response.json(respaldo);
    } catch (e) {
      return Response.json({ error: String(e.message || e) }, { status: 500 });
    }
  }
}
