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

/** Cuántas CARTAS se procesan al mismo tiempo.
 *
 *  ACÁ ME EQUIVOQUÉ, Y LA CORRIDA DE VERDAD LO MOSTRÓ. Mi primera versión
 *  paralelizaba los TRAMOS de cada carta, procesando las cartas una tras
 *  otra. Sobre el papel sonaba bien. Pero la medición del corpus dice que la
 *  carta mediana tiene 985 caracteres, o sea UN SOLO TRAMO: paralelizar
 *  adentro de una carta que tiene una sola llamada no paraleliza nada.
 *
 *  El resultado fue que seis cartas tardaban veintitrés segundos —seis esperas
 *  seguidas— y el trabajo entero se iba a once horas. Lo vi en la primera
 *  tanda real de Ariel, no en mis pruebas, porque mis servidores de mentira
 *  contestaban al instante y ahí seis esperas de cero siguen siendo cero.
 *
 *  Lo que hay que superponer son las CARTAS. Con cuatro a la vez, la misma
 *  tanda pasa de seis esperas seguidas a dos.
 */
const CARTAS_A_LA_VEZ = 3;

/** Y adentro de una carta larga, sus tramos también se superponen. Las cartas
 *  de un tramo no lo necesitan, pero la más larga del corpus tiene 27. */
const TRAMOS_A_LA_VEZ = 3;

/** Cuánto esperar entre una llamada a Gemini y la siguiente.
 *
 *  POR QUÉ FRENARSE A PROPÓSITO. El modelo que usa el sitio es
 *  `gemini-embedding-001`, y su plan gratuito acepta del orden de cien
 *  llamadas por minuto. Pasado eso contesta 429 y hay que esperar un minuto
 *  entero: una pausa de sesenta segundos cuesta mucho más que las décimas
 *  que se ahorran yendo rápido.
 *
 *  Setecientos milisegundos entre llamadas son unas 85 por minuto: debajo del
 *  techo, con margen. Correr más rápido no termina antes, termina en pausas.
 *
 *  El freno es compartido por todos los que trabajan a la vez, así que el
 *  ritmo total es el de este número, no el de este número por la cantidad de
 *  cartas superpuestas.
 *
 *  Se puede bajar con `VECTORIZAR_RITMO_MS` SÓLO para los tests: sin esa
 *  variable, el valor es el de producción. Hace falta porque una prueba que
 *  mide tiempos no puede tardar lo que tarda la realidad.
 */
const ENTRE_LLAMADAS_MS = Number(process.env.VECTORIZAR_RITMO_MS) || 700;

/** El freno, compartido por toda la tanda. */
function hacerElFreno(ms) {
  let proxima = 0;
  return async function esperarMiTurno() {
    const ahora = Date.now();
    const cuando = Math.max(ahora, proxima);
    proxima = cuando + ms;
    if (cuando > ahora) await new Promise((listo) => setTimeout(listo, cuando - ahora));
  };
}

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
    // El tope de 24 existe porque Vercel corta a los 60 segundos. Con cuatro
    // cartas superpuestas, veinticuatro son seis esperas: entra. Pedir cien
    // no entraría y se perdería el trabajo a medio hacer.
    const lote = entero(cuerpo.lote, 6, 1, 24);

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
    let cuotaDelDia = false;
    const problemas = [];
    const esperarMiTurno = hacerElFreno(ENTRE_LLAMADAS_MS);

    /** Todo el trabajo de UNA carta: partir, vectorizar y guardar. */
    async function hacerUnaCarta(carta, posicion) {
      // La primera carta de la tanda siempre se intenta, con todo el
      // presupuesto. Las que siguen, sólo si queda tiempo.
      //
      // No es un detalle: la carta más larga del corpus tiene 34.529
      // caracteres, o sea 27 tramos. Con una regla del tipo «si queda poco,
      // cortá», esa carta podía no entrar NUNCA, porque siempre habría otra
      // adelante comiéndose el presupuesto. Y como las pendientes salen
      // siempre en el mismo orden, volvería a salir primera en la tanda
      // siguiente, y en la siguiente: el trabajo entero trabado ahí sin que
      // nada pareciera roto.
      if (posicion > 0 && restante() < 10000) return;

      // SI YA NOS DIJERON «PARÁ», NO SE EMPIEZAN MÁS. Con las cartas
      // superpuestas, un 429 ya no corta el bucle: las que estaban en vuelo
      // siguen. Sin esto, la tanda entera —hasta veinticuatro— seguiría
      // golpeando a Gemini después del primer rechazo y llenaría el registro
      // de errores idénticos. Así el daño queda en las pocas que ya estaban
      // en el aire.
      if (esperarMs > 0 || cuotaDelDia) return;

      const tramos = tramosConIndice(carta.texto);
      if (!tramos.length) {
        problemas.push(`${carta.carta_id}: sin texto`);
        return;
      }

      try {
        const conVector = await enParalelo(tramos, TRAMOS_A_LA_VEZ, async (tramo) => {
          await esperarMiTurno();
          return {
            ...tramo,
            embedding: await vectorDeTexto(tramo.texto, process.env.GEMINI_API_KEY, DIMENSION),
          };
        });

        // TODOS LOS TRAMOS O NINGUNO. Media carta vectorizada deja de estar
        // pendiente y nadie se entera nunca de que le falta la otra mitad.
        if (conVector.length !== tramos.length || conVector.some((c) => !c?.embedding)) {
          problemas.push(`${carta.carta_id}: no se completaron los ${tramos.length} tramos`);
          return;
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

        // SI GEMINI DICE «PARÁ», SE PIDE UNA PAUSA Y SE SIGUE DESPUÉS. No se
        // abandona: en una tarea de once mil tramos un 429 es casi seguro, y
        // abandonar significaría volver a la computadora a reiniciarla.
        // Dos cosas muy distintas, aunque las dos lleguen como 429:
        //
        //   · «fuiste muy rápido» → se espera un minuto y se sigue.
        //   · «se acabó la cuota del día» → esperar NO sirve. La cuota vuelve
        //     recién cuando Google la renueva. Hay que parar y avisar, no
        //     dejar a alguien mirando una pausa de sesenta segundos que se
        //     repite contra las mismas cartas sin avanzar ninguna.
        if (e?.cuota === "dia") {
          cuotaDelDia = true;
          esperarMs = 0;
        } else if (esDemasiadoRapido(e)) {
          esperarMs = 60000;
        }
      }
    }

    // LAS CARTAS SE SUPERPONEN. Es el cambio que baja el trabajo de once
    // horas a poco más de una: el tiempo se va esperando a Gemini, no
    // calculando, así que lo que importa es cuántas esperas corren a la vez.
    await enParalelo(cartas, CARTAS_A_LA_VEZ, hacerUnaCarta);

    return Response.json({
      terminado: false,
      hechas,
      tramos: tramosGuardados,
      problemas,
      esperarMs,
      cuotaDelDia,
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
