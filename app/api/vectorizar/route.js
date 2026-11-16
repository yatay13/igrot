import { rpc, vectorDeTexto } from "../../lib/servicios.js";
import { DIMENSION, tramosConIndice } from "../../lib/tramos.js";
import { cuerpoJson, entero, mensajeParaAfuera, objeto, primeraFila } from "../../lib/guardias.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ===========================================================================
//  LA VECTORIZACIÓN DEL CORPUS, SIN COLAB
//
//  Esta ruta hace, de a tandas, lo que hacía el cuaderno de Colab: busca las
//  cartas a las que les falta el vector en hebreo, parte el texto en tramos,
//  le pide los vectores a Gemini y los guarda llamando a
//  `guardar_chunks_de_carta`.
//
//  La dispara la página `/tareas` con una pestaña abierta. Cada llamada hace
//  un pedacito y devuelve cuánto falta; la página vuelve a llamar. Se puede
//  cortar en cualquier momento y seguir después: lo ya hecho deja de estar
//  pendiente, así que la tanda siguiente arranca donde quedó.
//
//  ---------------------------------------------------------------------------
//  POR QUÉ ESTA RUTA ES DISTINTA DE TODAS LAS DEMÁS
//
//  Es la única que ESCRIBE en el corpus. Las otras cuatro leen, o escriben
//  una traducción que la base valida. Por eso tiene tres cercos y no uno:
//
//   1 · NO EXISTE si no está puesta `CLAVE_DE_TAREAS` en Vercel. Sin esa
//       variable contesta 404, igual que una dirección inventada. Mientras no
//       la pongas, esta ruta es como si no estuviera en el repositorio.
//   2 · Pide esa clave en una cabecera, y la compara en tiempo constante.
//   3 · La base revisa, tramo por tramo, que el texto sea de verdad un pedazo
//       de esa carta. Ese control está ADENTRO de `guardar_chunks_de_carta` y
//       no se puede saltear ni llamando a PostgREST directo.
//
//  Y una cosa más, que no es seguridad sino plata: usa `vectorDeTexto`, que
//  NO pasa por el techo diario de búsquedas. Si pasara, vectorizar seis mil
//  cartas dejaría al sitio sin búsqueda por significado para todo el mundo
//  durante días.
// ===========================================================================

// Cuánto puede tardar toda la tanda. Vercel corta a los 60 segundos y
// devuelve HTML en vez de JSON; nos cortamos antes y devolvemos JSON con lo
// que se alcanzó a hacer.
const PRESUPUESTO_MS = 45000;

/** Compara dos claves sin que el TIEMPO que tarda diga cuánto coincidían.
 *
 *  Un `===` normal corta en la primera letra distinta, así que tarda un
 *  poquito más cuantas más letras acierte. Con suficientes intentos eso
 *  alcanza para adivinar la clave letra por letra. Acá se recorren siempre
 *  las dos enteras.
 */
function mismaClave(a, b) {
  const x = String(a ?? "");
  const y = String(b ?? "");
  if (x.length !== y.length) return false;
  let distinto = 0;
  for (let i = 0; i < x.length; i++) distinto |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return distinto === 0;
}

/** El portero. Devuelve null si puede pasar, o la respuesta a darle si no. */
function noPuedePasar(pedido) {
  const esperada = process.env.CLAVE_DE_TAREAS;
  // Sin la variable puesta, la ruta no existe. A propósito: un 404 no le
  // cuenta a nadie que acá hay algo protegido.
  if (!esperada || esperada.length < 16) {
    return Response.json({ error: "no existe" }, { status: 404 });
  }
  if (!mismaClave(pedido.headers.get("x-clave-de-tareas"), esperada)) {
    return Response.json({ error: "clave incorrecta" }, { status: 401 });
  }
  return null;
}

/** Cuánto falta. Lo usa la página para la barra de avance. */
export async function GET(pedido) {
  const no = noPuedePasar(pedido);
  if (no) return no;
  try {
    return Response.json({ avance: primeraFila(await rpc("avance_de_vectores", {})) });
  } catch (e) {
    console.error("vectorizar/avance:", e?.message, e?.detalle || "");
    return Response.json({ error: mensajeParaAfuera(e) }, { status: 500 });
  }
}

export async function POST(pedido) {
  const no = noPuedePasar(pedido);
  if (no) return no;

  const empezo = Date.now();
  const restante = () => PRESUPUESTO_MS - (Date.now() - empezo);

  try {
    const cuerpo = objeto(await cuerpoJson(pedido));
    // Pocas por tanda, a propósito. Una carta larga puede dar diez tramos, y
    // cada tramo es una llamada a Gemini: con lotes grandes la tanda no entra
    // en el tiempo de Vercel y se pierde el trabajo a medio hacer.
    const lote = entero(cuerpo.lote, 3, 1, 10);

    const pendientes = await rpc("vectores_pendientes", { p_cantidad: lote });
    const cartas = Array.isArray(pendientes) ? pendientes : [];

    if (!cartas.length) {
      return Response.json({
        terminado: true,
        hechas: 0,
        tramos: 0,
        avance: primeraFila(await rpc("avance_de_vectores", {})),
      });
    }

    let hechas = 0;
    let tramosGuardados = 0;
    const problemas = [];

    for (const carta of cartas) {
      // Si no queda tiempo, se corta y se devuelve lo hecho. La página
      // vuelve a llamar: lo que falta sigue faltando y nada se pierde.
      if (restante() < 8000) break;

      const tramos = tramosConIndice(carta.texto);
      if (!tramos.length) {
        problemas.push(`${carta.carta_id}: sin texto`);
        continue;
      }

      try {
        const conVector = [];
        for (const tramo of tramos) {
          if (restante() < 4000) break;
          const embedding = await vectorDeTexto(
            tramo.texto,
            process.env.GEMINI_API_KEY,
            DIMENSION
          );
          conVector.push({ ...tramo, embedding });
        }

        // TODOS LOS TRAMOS O NINGUNO. Si nos quedamos sin tiempo a mitad de
        // una carta, no se guarda lo que haya: media carta vectorizada deja
        // de estar pendiente y nadie se entera nunca de que le falta la otra
        // mitad. Se descarta y se vuelve a empezar esa carta en la tanda
        // siguiente, que cuesta unos segundos y no una mentira silenciosa.
        if (conVector.length !== tramos.length) break;

        const guardados = await rpc("guardar_chunks_de_carta", {
          p_carta_id: carta.carta_id,
          p_idioma: "he",
          p_chunks: conVector,
        });
        const n = Number(primeraFila(guardados)) || 0;

        if (n > 0) {
          hechas++;
          tramosGuardados += n;
        } else {
          // Un cero es la base diciendo que no acepta esos tramos. Si pasa
          // con una carta legítima quiero verlo, no que desaparezca.
          problemas.push(`${carta.carta_id}: la base rechazó los tramos`);
          console.warn("vectorizar: la base RECHAZÓ los tramos de", carta.carta_id);
        }
      } catch (e) {
        // Una carta que falla no tiene que cortar la tanda entera: se anota y
        // se sigue con la próxima.
        problemas.push(`${carta.carta_id}: ${mensajeParaAfuera(e).slice(0, 120)}`);
        console.warn("vectorizar:", carta.carta_id, e?.message);
        // Salvo que sea la cuota de Gemini, donde seguir no tiene sentido.
        if (/429|quota|RESOURCE_EXHAUSTED/i.test(String(e?.message || ""))) break;
      }
    }

    return Response.json({
      terminado: false,
      hechas,
      tramos: tramosGuardados,
      problemas,
      avance: primeraFila(await rpc("avance_de_vectores", {})),
    });
  } catch (e) {
    if (e?.deEntrada) {
      return Response.json({ error: e.message }, { status: e.codigoHttp || 400 });
    }
    console.error("vectorizar:", e?.message, e?.detalle || "");
    return Response.json({ error: mensajeParaAfuera(e) }, { status: 500 });
  }
}
