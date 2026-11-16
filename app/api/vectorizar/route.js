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

/** Cuántos tramos se le piden a Gemini a la vez.
 *
 *  POR QUÉ NO DE A UNO, QUE ERA LO PRIMERO QUE ESCRIBÍ. La medición dio el
 *  tamaño real del trabajo: 5.896 cartas sin vector más 2.053 con vectores
 *  viejos, que son unos once mil tramos. De a uno, con lo que tarda cada
 *  llamada, eso son más de cuatro horas de pestaña abierta.
 *
 *  POR QUÉ CUATRO Y NO CUARENTA. Gemini limita cuántas llamadas por minuto
 *  acepta. Pasado ese límite empieza a contestar 429 y el trabajo se frena
 *  solo, así que subir este número más allá de cierto punto no acelera nada:
 *  cambia esperar por ser rechazado.
 */
const A_LA_VEZ = 4;

/** Corre `tarea` sobre cada cosa, de a `cuantas` al mismo tiempo. */
async function enParalelo(cosas, cuantas, tarea) {
  const salida = new Array(cosas.length);
  let siguiente = 0;
  const obreros = Array.from({ length: Math.min(cuantas, cosas.length) }, async () => {
    while (true) {
      const i = siguiente++;
      if (i >= cosas.length) return;
      salida[i] = await tarea(cosas[i], i);
    }
  });
  await Promise.all(obreros);
  return salida;
}

/** ¿Este error es Gemini diciendo «pará un poco»? */
const esDemasiadoRapido = (e) => /429|quota|RESOURCE_EXHAUSTED|rate/i.test(String(e?.message || ""));

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
    let esperarMs = 0;
    const problemas = [];

    for (const [posicion, carta] of cartas.entries()) {
      // LA PRIMERA CARTA DE LA TANDA SIEMPRE SE INTENTA, con todo el
      // presupuesto. Las que siguen, sólo si queda tiempo.
      //
      // No es un detalle: la carta más larga del corpus tiene 34.529
      // caracteres, o sea 26 tramos. Con la regla anterior —«si queda menos
      // de ocho segundos, cortá»— esa carta podía no entrar NUNCA: siempre
      // habría otra adelante comiéndose el presupuesto. Y como las pendientes
      // se piden siempre en el mismo orden, una carta que no entra vuelve a
      // salir primera en la tanda siguiente, y en la siguiente. El trabajo
      // entero se habría trabado en esa carta sin que nada pareciera roto.
      if (posicion > 0 && restante() < 10000) break;

      const tramos = tramosConIndice(carta.texto);
      if (!tramos.length) {
        problemas.push(`${carta.carta_id}: sin texto`);
        continue;
      }

      try {
        // Los tramos de una carta se piden de a varios a la vez. Es lo que
        // hace que once mil tramos sean una tarde y no varios días.
        const conVector = await enParalelo(tramos, A_LA_VEZ, async (tramo) => ({
          ...tramo,
          embedding: await vectorDeTexto(tramo.texto, process.env.GEMINI_API_KEY, DIMENSION),
        }));

        // TODOS LOS TRAMOS O NINGUNO. Media carta vectorizada deja de estar
        // pendiente y nadie se entera nunca de que le falta la otra mitad.
        if (conVector.length !== tramos.length || conVector.some((c) => !c?.embedding)) {
          problemas.push(`${carta.carta_id}: no se completaron los ${tramos.length} tramos`);
          continue;
        }

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
        problemas.push(`${carta.carta_id}: ${mensajeParaAfuera(e).slice(0, 120)}`);
        console.warn("vectorizar:", carta.carta_id, e?.message);

        // SI GEMINI DICE «PARÁ», SE PARA UN RATO Y SE SIGUE. No se abandona.
        // La versión anterior cortaba el trabajo entero ante un 429, y en una
        // tarea de once mil tramos un 429 es casi seguro: habría que volver a
        // la computadora cada tanto a reiniciarla a mano. Ahora se le dice a
        // la página cuánto esperar y ella sola retoma.
        if (esDemasiadoRapido(e)) {
          esperarMs = 60000;
          break;
        }
      }
    }

    return Response.json({
      terminado: false,
      hechas,
      tramos: tramosGuardados,
      problemas,
      esperarMs,
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
