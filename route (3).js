import {
  traducir,
  traduccionGuardada,
  guardar,
  textoDeLaCarta,
  esUnTramoDeLaCarta,
  NOMBRE_DE_IDIOMA,
} from "../../lib/servicios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Más que un tramo de la página (2.500) con margen de sobra. El tope existe
// porque las rutas del App Router no traen límite de tamaño de cuerpo: sin
// esto, un POST de varios megas entraba a `pedido.json()` y de ahí al pedido
// de Gemini, con `maxOutputTokens: 8192` y hasta cuatro modelos por intento.
const LARGO_MAXIMO = 4000;

// Los tramos de una carta son unos pocos. 500 es un techo absurdamente alto a
// propósito: nunca va a molestar a nadie de verdad y cierra la puerta a que
// alguien use `parte`/`total` para llenar la tabla de filas basura.
const TRAMOS_MAXIMOS = 500;

const entero = (v, por_omision, minimo, maximo) => {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return por_omision;
  return Math.min(Math.max(n, minimo), maximo);
};

export async function POST(pedido) {
  try {
    const cuerpo = await pedido.json();
    const {
      texto,
      idioma = "es",
      parte = 1,
      total = 1,
      cartaId = null,
      // La página manda `guardar: false` cuando el tramo se partió al medio
      // porque el modelo llenó su cupo de salida: esos pedazos comparten el
      // número de tramo y guardarlos haría que el segundo pise al primero.
      // Antes esto se señalaba mandando `cartaId: null`, que además de evitar
      // el guardado hacía imposible comprobar de qué carta era el texto.
      guardar: hayQueGuardar = true,
    } = cuerpo || {};

    if (typeof texto !== "string" || !texto.trim()) {
      return Response.json({ error: "no hay texto" }, { status: 400 });
    }
    if (texto.length > LARGO_MAXIMO) {
      return Response.json(
        { error: "el texto a traducir es demasiado largo" },
        { status: 413 }
      );
    }
    // Lista blanca, no `|| idioma`: lo que entra acá va al pedido que lee Gemini.
    if (!Object.prototype.hasOwnProperty.call(NOMBRE_DE_IDIOMA, idioma)) {
      return Response.json({ error: "idioma no soportado" }, { status: 400 });
    }
    if (typeof cartaId !== "string" || !cartaId.trim() || cartaId.length > 200) {
      return Response.json({ error: "falta el id de la carta" }, { status: 400 });
    }

    const n = entero(parte, 1, 1, TRAMOS_MAXIMOS);
    const de = entero(total, 1, 1, TRAMOS_MAXIMOS);

    // 1. ¿Ya la tenemos? Es lo primero que se pregunta: si está guardada, no
    //    se toca Gemini, no se gasta cuota y no puede fallar por sobrecarga.
    if (hayQueGuardar) {
      try {
        const guardada = await traduccionGuardada(cartaId, idioma, n, de);
        if (guardada) {
          return Response.json({ traduccion: guardada, deLaBase: true });
        }
      } catch (e) {
        // Si la tabla todavía no existe, o la base no contesta, seguimos y
        // traducimos igual. El caché es una ayuda, no un requisito: que falte
        // no puede romper la traducción.
        console.warn("no pude leer la traducción guardada:", e.message, e.detalle || "");
      }
    }

    // 2. COMPROBAR QUE EL TEXTO SEA DE ESA CARTA, antes de gastar un peso.
    //
    //    Va acá y no más arriba a propósito: si la traducción ya estaba
    //    guardada se devolvió sin leer la base de nuevo, así que este control
    //    no cuesta nada en el camino rápido. Y va ANTES de llamar a Gemini,
    //    así que también sirve de freno al gasto: por esta ruta sólo se puede
    //    traducir texto que de verdad está en el corpus.
    const original = await textoDeLaCarta(cartaId);
    if (original == null) {
      return Response.json({ error: "esa carta no existe" }, { status: 404 });
    }
    if (!esUnTramoDeLaCarta(texto, original)) {
      return Response.json(
        { error: "el texto no es un tramo de esa carta" },
        { status: 400 }
      );
    }

    // 3. Traducir de verdad
    const salida = await traducir(texto, idioma, process.env.GEMINI_API_KEY, n, de);

    // 4. Guardarla para la próxima. Tampoco puede romper nada: si esto falla,
    //    la traducción igual se devuelve.
    if (hayQueGuardar && salida?.traduccion && !salida.truncada) {
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
        console.warn("no pude guardar la traducción:", e.message, e.detalle || "");
      }
    }

    return Response.json({ ...salida, deLaBase: false });
  } catch (e) {
    // El detalle va a los registros de Vercel; al navegador va sólo el mensaje
    // corto, que es el que `mensajeAmable` sabe convertir en una indicación.
    console.error("traducir:", e?.message, e?.detalle || "", e?.stack || "");
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
