"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ===========================================================================
//  LA PÁGINA DE TAREAS
//
//  Desde acá se dispara la vectorización del corpus, que es lo que antes
//  había que hacer en Colab. No hay terminal, no hay cuaderno, no hay Drive:
//  se abre esta dirección, se pega la clave y se aprieta Empezar.
//
//  CÓMO FUNCIONA, PORQUE IMPORTA ENTENDERLO. Esta página no vectoriza nada:
//  le pide al servidor que haga una tanda chica, espera la respuesta, y vuelve
//  a pedir. Una y otra vez. Eso es a propósito y no una limitación:
//
//    · Vercel corta cualquier función a los 60 segundos. Un trabajo de horas
//      no entra en una llamada: tiene que ser muchas chiquitas.
//    · Si se corta la luz, se cierra la pestaña o te cansás, no se pierde
//      nada. Lo ya hecho deja de estar pendiente, así que la próxima vez
//      arranca justo donde quedó.
//    · Y se puede ver avanzar, que con un trabajo de horas no es un lujo.
//
//  La clave se guarda en el almacenamiento de ESTA pestaña, no del navegador:
//  al cerrarla desaparece. Así un refresco sin querer no te hace empezar de
//  nuevo, pero la clave tampoco queda dando vueltas en la computadora.
// ===========================================================================

const RECORDAR = "igrot-clave-de-tareas";

/** Cuánto tarda, dicho en castellano. */
function enCastellano(segundos) {
  if (!Number.isFinite(segundos) || segundos <= 0) return "un momento";
  if (segundos < 90) return `${Math.round(segundos)} segundos`;
  const min = Math.round(segundos / 60);
  if (min < 90) return `${min} minuto${min === 1 ? "" : "s"}`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return `${h} hora${h === 1 ? "" : "s"}${resto ? ` y ${resto} minuto${resto === 1 ? "" : "s"}` : ""}`;
}

export default function Tareas() {
  const [clave, setClave] = useState("");
  const [avance, setAvance] = useState(null);
  const [corriendo, setCorriendo] = useState(false);
  const [error, setError] = useState(null);
  const [diario, setDiario] = useState([]);
  const [hechasEnEstaVuelta, setHechasEnEstaVuelta] = useState(0);
  const [faltabanAlEmpezar, setFaltabanAlEmpezar] = useState(null);
  const [empezoEn, setEmpezoEn] = useState(null);

  // Una caja, y no un estado, porque el bucle la lee en cada vuelta y tiene
  // que ver el valor de AHORA, no el que había cuando arrancó.
  const quieroParar = useRef(false);

  useEffect(() => {
    try {
      const guardada = window.sessionStorage.getItem(RECORDAR);
      if (guardada) setClave(guardada);
    } catch {
      /* sin almacenamiento: se escribe a mano y listo */
    }
  }, []);

  const anotar = useCallback((linea) => {
    setDiario((d) => [`${new Date().toLocaleTimeString("es-AR")} · ${linea}`, ...d].slice(0, 200));
  }, []);

  /** Pregunta cuánto falta. Sirve también para probar que la clave sirve. */
  const mirarAvance = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch("/api/vectorizar", { headers: { "x-clave-de-tareas": clave } });
      if (r.status === 404) {
        throw new Error(
          "La ruta no está habilitada. Falta poner la variable CLAVE_DE_TAREAS en Vercel " +
            "(y volver a desplegar para que tome efecto)."
        );
      }
      if (r.status === 401) throw new Error("La clave no es la correcta.");
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setAvance(d.avance);
      try {
        window.sessionStorage.setItem(RECORDAR, clave);
      } catch {
        /* no se puede guardar: no importa */
      }
      return d.avance;
    } catch (e) {
      setError(String(e.message || e));
      return null;
    }
  }, [clave]);

  /** El bucle: una tanda, mirar, otra tanda. */
  async function empezar() {
    quieroParar.current = false;
    setCorriendo(true);
    setError(null);
    setHechasEnEstaVuelta(0);
    setEmpezoEn(Date.now());

    const primero = await mirarAvance();
    if (!primero) return setCorriendo(false);
    setFaltabanAlEmpezar((primero.faltan || 0) + (primero.viejos || 0));
    anotar(`arranco: faltan ${primero.faltan}, viejos ${primero.viejos}`);

    let hechas = 0;
    let vaciasSeguidas = 0;
    let fallosSeguidos = 0;
    let pausasSinAvanzar = 0;

    while (!quieroParar.current) {
      try {
        const r = await fetch("/api/vectorizar", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-clave-de-tareas": clave },
          // Doce por tanda. Ahora que las cartas se superponen de a cuatro
          // del lado del servidor, una tanda de doce son tres esperas, no
          // doce: entra holgada en el presupuesto y se ahorran viajes.
          body: JSON.stringify({ lote: 12 }),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);

        if (d.avance) setAvance(d.avance);
        for (const p of d.problemas || []) anotar(`⚠️ ${p}`);

        if (d.terminado) {
          anotar("no queda nada pendiente: terminó");
          break;
        }

        hechas += d.hechas || 0;
        setHechasEnEstaVuelta(hechas);

        // SE ACABÓ LA CUOTA DEL DÍA. Esperar no sirve: no vuelve en un
        // minuto, vuelve cuando Google la renueva. Parar y decirlo es lo
        // único honesto; la alternativa es dejarte mirando una pausa de
        // sesenta segundos que se repite contra las mismas cartas.
        if (d.cuotaDelDia) {
          setError(
            "Se agotó la cuota DIARIA de Gemini para embeddings. Esperar no " +
              "sirve: vuelve cuando Google la renueva (suele ser a medianoche " +
              "hora del Pacífico, unas 5 de la mañana en Buenos Aires). Todo " +
              "lo vectorizado está guardado: mañana apretá Empezar y sigue " +
              "desde acá."
          );
          anotar("se agotó la cuota del día · paro");
          break;
        }

        // Gemini pidió un respiro. No es un error: en un trabajo de once mil
        // tramos es casi inevitable. Se espera lo que pidió y se sigue sola,
        // en vez de hacerte volver a la computadora a reiniciarla.
        if (d.esperarMs > 0) {
          // Y UN SEGURO, POR SI EL MOTIVO NO VIENE CLARO. Si dos pausas
          // seguidas no hacen avanzar ni una carta, esperar no está
          // sirviendo, diga lo que diga el error. Se para igual. Esto es lo
          // que atrapa el caso aunque Google cambie el texto de su respuesta.
          pausasSinAvanzar = d.hechas > 0 ? 0 : pausasSinAvanzar + 1;
          if (pausasSinAvanzar >= 2) {
            setError(
              "Dos pausas seguidas sin vectorizar ni una carta. Lo más " +
                "probable es que se haya agotado la cuota diaria de Gemini, " +
                "que no vuelve esperando un minuto. Lo hecho está guardado: " +
                "probá de nuevo más tarde."
            );
            anotar("dos pausas sin avanzar · paro");
            break;
          }
          const seg = Math.round(d.esperarMs / 1000);
          anotar(`Gemini pidió esperar · pauso ${seg} segundos y sigo`);
          await new Promise((listo) => setTimeout(listo, d.esperarMs));
          vaciasSeguidas = 0;
          continue;
        }

        if (d.hechas > 0) {
          anotar(`${d.hechas} carta(s) · ${d.tramos} tramos`);
          vaciasSeguidas = 0;
        } else {
          // Una tanda que no hizo nada y tampoco dijo "terminado" quiere decir
          // que algo está rechazando todo. Insistir mil veces sólo llena el
          // diario: se para y se avisa.
          vaciasSeguidas++;
          if (vaciasSeguidas >= 3) {
            setError(
              "Tres tandas seguidas sin avanzar. Algo está rechazando las cartas: " +
                "mirá el detalle de arriba y mandámelo."
            );
            break;
          }
        }
      } catch (e) {
        // UN TROPEZÓN NO TERMINA EL TRABAJO.
        //
        // Antes, cualquier error cortaba la corrida y había que volver a la
        // computadora a apretar Empezar. En la primera corrida de verdad, un
        // `Supabase 500` suelto la frenó a los cuatro minutos. En una tarea
        // de tres horas eso pasa varias veces: la base tiene un mal momento,
        // se corta un segundo la conexión, Vercel recicla la función.
        //
        // Ninguna de esas cosas es motivo para abandonar. Se espera un poco
        // —cada vez un poco más— y se vuelve a intentar. Sólo después de
        // cinco tropezones SEGUIDOS se para, porque ahí ya no es mala suerte.
        fallosSeguidos++;
        anotar(`⚠️ ${e.message || e}  ·  intento ${fallosSeguidos} de 5`);
        if (fallosSeguidos >= 5) {
          setError(
            `${e.message || e} — cinco intentos seguidos fallaron, así que paré. ` +
              `Lo hecho está guardado: podés volver a apretar Empezar cuando quieras.`
          );
          break;
        }
        setError(null);
        await new Promise((listo) => setTimeout(listo, 3000 * fallosSeguidos));
        continue;
      }
      fallosSeguidos = 0;
      // Un respiro entre tandas. No es por educación: Gemini limita cuántas
      // llamadas por minuto acepta, y pegarle sin pausa hace que empiece a
      // contestar 429 y el trabajo se frene solo. Más corto que antes porque
      // las tandas ahora son del doble de largas: el respiro se paga una vez
      // cada doce cartas y no cada seis.
      await new Promise((listo) => setTimeout(listo, 400));
    }

    setCorriendo(false);
    if (quieroParar.current) anotar("parado a mano");
  }

  const faltan = (avance?.faltan || 0) + (avance?.viejos || 0);
  const hechoDeEstaVuelta =
    faltabanAlEmpezar && faltabanAlEmpezar > 0
      ? Math.min(1, (faltabanAlEmpezar - faltan) / faltabanAlEmpezar)
      : 0;

  // Cuánto falta, calculado con el ritmo REAL de esta corrida y no con una
  // estimación inventada: si tu conexión o la cuota de Gemini van lentas, el
  // número lo refleja.
  let cuantoFalta = null;
  if (corriendo && hechasEnEstaVuelta > 0 && empezoEn) {
    const porCarta = (Date.now() - empezoEn) / 1000 / hechasEnEstaVuelta;
    cuantoFalta = enCastellano(porCarta * faltan);
  }

  return (
    <div className="envoltorio">
      <header className="cabecera compacta">
        <h1 className="titulo-heb" lang="he" dir="rtl">
          אגרות קודש
        </h1>
        <p className="titulo-lat">Tareas de mantenimiento</p>
      </header>

      <main className="tareas">
        <section className="carta">
          <h2>Vectorizar el corpus</h2>
          <p className="resumen">
            Calcula los vectores en hebreo de las cartas que no los tienen, y vuelve a
            calcular los que quedaron viejos porque el texto cambió. Se puede parar y
            seguir cuando quieras: lo hecho no se repite.
          </p>

          <div className="campo">
            <label htmlFor="clave">Clave de tareas</label>
            <input
              id="clave"
              type="password"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              placeholder="la que pusiste en Vercel, en CLAVE_DE_TAREAS"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="acciones">
            <button type="button" onClick={mirarAvance} disabled={!clave || corriendo}>
              Ver cuánto falta
            </button>
            <button
              type="button"
              className="principal"
              onClick={empezar}
              disabled={!clave || corriendo}
            >
              {corriendo ? "Trabajando…" : "Empezar"}
            </button>
            <button
              type="button"
              onClick={() => {
                quieroParar.current = true;
              }}
              disabled={!corriendo}
            >
              Parar
            </button>
          </div>

          {error && <div className="aviso mal">{error}</div>}

          {avance && (
            <>
              <div className="cuentas">
                <span>
                  <b>{(avance.faltan ?? 0).toLocaleString("es-AR")}</b> sin vector
                </span>
                <span>
                  <b>{(avance.viejos ?? 0).toLocaleString("es-AR")}</b> viejos
                </span>
                <span>
                  <b>{(avance.con_hebreo ?? 0).toLocaleString("es-AR")}</b> ya hechas
                </span>
                <span>
                  <b>{(avance.chunks_hebreos ?? 0).toLocaleString("es-AR")}</b> tramos
                </span>
              </div>

              {corriendo && (
                <>
                  <div
                    className="avance"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(hechoDeEstaVuelta * 100)}
                  >
                    <div className="avance-barra" style={{ width: `${hechoDeEstaVuelta * 100}%` }} />
                  </div>
                  <p className="nota-chica">
                    {hechasEnEstaVuelta} carta(s) en esta vuelta
                    {cuantoFalta ? ` · al ritmo de ahora, falta ${cuantoFalta}` : ""}
                  </p>
                </>
              )}

              {faltan === 0 && !corriendo && (
                <p className="aviso">
                  No queda ninguna carta sin vectorizar. Después de esto conviene correr{" "}
                  <code>despues_de_cada_carga.sql</code>.
                </p>
              )}
            </>
          )}

          {diario.length > 0 && (
            <details className="filtros" open>
              <summary>Qué fue pasando ({diario.length})</summary>
              <ol className="diario">
                {diario.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ol>
            </details>
          )}
        </section>

        <p className="nota-chica">
          Dejá esta pestaña abierta mientras trabaja. Si la cerrás, se para donde iba y
          la próxima vez sigue desde ahí.
        </p>
      </main>
    </div>
  );
}
