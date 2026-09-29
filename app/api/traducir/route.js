import { traducir, traduccionGuardada, guardar } from "../../lib/servicios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(pedido) {
  try {
    const {
      texto,
      idioma = "es",
      parte = 1,
      total = 1,
      cartaId = null,
    } = await pedido.json();

    if (!texto || !texto.trim()) {
      return Response.json({ error: "no hay texto" }, { status: 400 });
    }

    const n = Number(parte);
    const de = Number(total);

    // 1. ¿Ya la tenemos? Es lo primero que se pregunta: si está guardada, no
    //    se toca Gemini, no se gasta cuota y no puede fallar por sobrecarga.
    if (cartaId) {
      try {
        const guardada = await traduccionGuardada(cartaId, idioma, n, de);
        if (guardada) {
          return Response.json({ traduccion: guardada, deLaBase: true });
        }
      } catch (e) {
        // Si la tabla todavía no existe, o la base no contesta, seguimos y
        // traducimos igual. El caché es una ayuda, no un requisito: que falte
        // no puede romper la traducción.
        console.warn("no pude leer la traducción guardada:", e.message);
      }
    }

    // 2. Traducir de verdad
    const salida = await traducir(texto, idioma, process.env.GEMINI_API_KEY, n, de);

    // 3. Guardarla para la próxima. Tampoco puede romper nada: si esto falla,
    //    la traducción igual se devuelve.
    if (cartaId && salida?.traduccion && !salida.truncada) {
      try {
        await guardar(
          "traducciones",
          {
            carta_id: cartaId,
            idioma,
            parte: n,
            total: de,
            texto: salida.traduccion,
            modelo: salida.modelo || null,
          },
          "carta_id,idioma,total,parte"
        );
      } catch (e) {
        console.warn("no pude guardar la traducción:", e.message);
      }
    }

    return Response.json({ ...salida, deLaBase: false });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
