import {
  traducir,
  traduccionGuardada,
  guardarTraduccion,
  textoDeLaCarta,
  NOMBRE_DE_IDIOMA,
} from "../../lib/servicios.js";
import {
  TOPE_TEXTO,
  TOPE_TRAMOS,
  cuerpoJson,
  entero,
  esUnTramoDeLaCarta,
  huellaDelVisitante,
  idDeCarta,
  mensajeParaAfuera,
  objeto,
} from "../../lib/guardias.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(pedido) {
  try {
    // EL TOPE DE TAMAÑO AHORA ESTÁ ANTES DE LEER, NO DESPUÉS.
    //
    // Antes esta ruta hacía `await pedido.json()` y recién entonces miraba si
    // el texto pasaba de 4.000 caracteres. Las rutas del App Router no traen
    // límite de tamaño de cuerpo, así que un POST de varios megas entraba
    // completo y se parseaba completo antes de que nadie lo frenara.
    // `cuerpoJson` mira `content-length` primero y, como esa cabecera la
    // elige quien llama y puede mentir, además cuenta los bytes mientras lee
    // y corta en el tope.
    const cuerpo = objeto(await cuerpoJson(pedido));
    const {
      texto,
      idioma = "es",
      parte = 1,
      total = 1,
      // La página manda `guardar: false` cuando el tramo se partió al medio
      // porque el modelo llenó su cupo de salida: esos pedazos comparten el
      // número de tramo y guardarlos haría que el segundo pise al primero.
      // Antes esto se señalaba mandando `cartaId: null`, que además de evitar
      // el guardado hacía imposible comprobar de qué carta era el texto.
      guardar: hayQueGuardar = true,
    } = cuerpo;

    if (typeof texto !== "string" || !texto.trim()) {
      return Response.json({ error: "no hay texto" }, { status: 400 });
    }
    if (texto.length > TOPE_TEXTO) {
      return Response.json({ error: "el texto a traducir es demasiado largo" }, { status: 413 });
    }
    // Lista blanca, no `|| idioma`: lo que entra acá va al pedido que lee Gemini.
    //
    // Y PRIMERO `typeof === "string"`. Sin eso, `idioma: ["es"]` pasaba el
    // control: cuando un arreglo se usa como nombre de propiedad, JavaScript
    // lo convierte a texto, así que `["es"]` se vuelve `"es"` y
    // `hasOwnProperty` lo aprueba. Después ese arreglo seguía viaje y se
    // guardaba en una columna de texto de la base. Lo encontró el banco de
    // pruebas; a ojo no se ve.
    if (
      typeof idioma !== "string" ||
      !Object.prototype.hasOwnProperty.call(NOMBRE_DE_IDIOMA, idioma)
    ) {
      return Response.json({ error: "idioma no soportado" }, { status: 400 });
    }
    // `idDeCarta` además exige la forma de un id del corpus. Un id con una
    // barra o un salto de línea no es un id: es alguien probando qué pasa.
    const carta = idDeCarta(cuerpo.cartaId);
    if (!carta) {
      return Response.json({ error: "falta el id de la carta" }, { status: 400 });
    }

    const n = entero(parte, 1, 1, TOPE_TRAMOS);
    const de = entero(total, 1, 1, TOPE_TRAMOS);
    // El tramo 5 de 3 no existe. Antes pasaba y quedaba guardado como una
    // fila imposible de volver a leer.
    if (n > de) {
      return Response.json({ error: "el número de tramo no puede pasar del total" }, { status: 400 });
    }

    // 1. ¿Ya la tenemos? Es lo primero que se pregunta: si está guardada, no
    //    se toca Gemini, no se gasta cuota y no puede fallar por sobrecarga.
    if (hayQueGuardar) {
      try {
        const guardada = await traduccionGuardada(carta, idioma, n, de);
        if (guardada) {
          return Response.json({ traduccion: guardada, deLaBase: true });
        }
      } catch (e) {
        // Si la tabla todavía no existe, o la base no contesta, seguimos y
        // traducimos igual. El caché es una ayuda, no un requisito: que falte
        // no puede romper la traducción.
        console.warn("no pude leer la traducción guardada:", e?.message, e?.detalle || "");
      }
    }

    // 2. COMPROBAR QUE EL TEXTO SEA DE ESA CARTA, antes de gastar un peso.
    //
    //    Va acá y no más arriba a propósito: si la traducción ya estaba
    //    guardada se devolvió sin leer la base de nuevo, así que este control
    //    no cuesta nada en el camino rápido. Y va ANTES de llamar a Gemini,
    //    así que también sirve de freno al gasto: por esta ruta sólo se puede
    //    traducir texto que de verdad está en el corpus.
    const original = await textoDeLaCarta(carta);
    if (original == null) {
      return Response.json({ error: "esa carta no existe" }, { status: 404 });
    }
    if (!esUnTramoDeLaCarta(texto, original)) {
      return Response.json({ error: "el texto no es un tramo de esa carta" }, { status: 400 });
    }

    // 3. Traducir de verdad
    const salida = await traducir(
      texto,
      idioma,
      process.env.GEMINI_API_KEY,
      n,
      de,
      huellaDelVisitante(pedido)
    );

    // 4. Guardarla para la próxima. Tampoco puede romper nada: si esto falla,
    //    la traducción igual se devuelve.
    //
    //    NO ESCRIBE LA TABLA DIRECTO. Llama a `guardar_traduccion`, que
    //    comprueba ADENTRO DE LA BASE que `original` sea de verdad un pedazo
    //    de esa carta. Es el mismo control que hizo `esUnTramoDeLaCarta` unas
    //    líneas más arriba, y está repetido a propósito: el de acá evita
    //    gastar una llamada a Gemini, y el de la base es el que no se puede
    //    saltear, porque no hay otro camino a la tabla. Si alguien llama a
    //    PostgREST sin pasar por esta ruta, se encuentra con el mismo control.
    if (hayQueGuardar && salida?.traduccion && !salida.truncada) {
      try {
        const guardada = await guardarTraduccion({
          cartaId: carta,
          idioma,
          parte: n,
          total: de,
          texto: salida.traduccion,
          modelo: salida.modelo || null,
          // el hebreo que se mandó a traducir, que es lo que la base compara
          original: texto,
        });
        // Un `false` no es un error de red: es la base diciendo que no acepta
        // ese texto. Si eso pasa con una traducción legítima, quiero verlo en
        // los registros y no que desaparezca en silencio.
        if (!guardada) {
          console.warn("la base RECHAZÓ la traducción de", carta, idioma, `${n}/${de}`);
        }
      } catch (e) {
        console.warn("no pude guardar la traducción:", e?.message, e?.detalle || "");
      }
    }

    return Response.json({ ...salida, deLaBase: false });
  } catch (e) {
    if (e?.deEntrada) {
      return Response.json({ error: e.message }, { status: e.codigoHttp || 400 });
    }
    // El detalle va a los registros de Vercel; al navegador va sólo el mensaje
    // corto y limpio, que es el que `mensajeAmable` sabe convertir en una
    // indicación.
    console.error("traducir:", e?.message, e?.detalle || "", e?.stack || "");
    return Response.json({ error: mensajeParaAfuera(e) }, { status: 500 });
  }
}
