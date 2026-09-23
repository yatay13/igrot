"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const IDIOMAS = [
  { valor: "es", nombre: "Español" },
  { valor: "en", nombre: "Inglés" },
  { valor: "pt", nombre: "Portugués" },
  { valor: "fr", nombre: "Francés" },
  { valor: "he", nombre: "Hebreo moderno" },
  { valor: "yi", nombre: "Ídish" },
];

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// La fecha viene como '1955-03-07'. Partirla a mano evita el corrimiento de
// un día que mete new Date() con las zonas horarias.
function fechaLegible(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

// Los errores que devuelven Gemini y Supabase son técnicos. Acá se traducen
// a algo que diga qué hacer.
function mensajeAmable(crudo) {
  const t = String(crudo || "");
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(t))
    return "Se agotó la cuota gratis de Gemini por hoy. Probá de nuevo más tarde.";
  if (/403|401|API key|API_KEY/i.test(t))
    return "La clave de Gemini no está funcionando. Revisala en las variables de entorno de Vercel.";
  if (/faltan SUPABASE/i.test(t))
    return "Faltan las variables SUPABASE_URL y SUPABASE_KEY en Vercel.";
  if (/Supabase 4|Supabase 5/i.test(t))
    return "La base no respondió bien. Fijate que el esquema SQL esté corrido y la clave sea la anon.";
  return t;
}

function nombreDeTomo(libro) {
  if (libro?.numero) return `Tomo ${libro.numero}`;
  return libro?.titulo || libro?.id || "";
}

const FILTROS_VACIOS = {
  libro: "",
  tema: "",
  festividad: "",
  anioDesde: "",
  anioHasta: "",
};

export default function Pagina() {
  const [consulta, setConsulta] = useState("");
  const [filtros, setFiltros] = useState(FILTROS_VACIOS);
  const [facetas, setFacetas] = useState(null);
  const [resultados, setResultados] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState(null);
  // <details open={...}> no alcanza: React lo vuelve a imponer en cada
  // re-render y el panel se cerraba solo mientras lo estabas usando.
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const cajaDeTexto = useRef(null);

  useEffect(() => {
    fetch("/api/facetas")
      .then((r) => r.json())
      .then((d) => setFacetas(d.error ? { error: d.error } : d))
      .catch((e) => setFacetas({ error: String(e) }));
  }, []);

  const hayFiltros = useMemo(
    () => Object.values(filtros).some((v) => v !== ""),
    [filtros]
  );

  async function buscar(filtrosUsados = filtros, textoUsado = consulta) {
    if (!textoUsado.trim() && !Object.values(filtrosUsados).some((v) => v !== "")) {
      setError({ texto: "Escribí algo o elegí al menos un filtro." });
      setResultados(null);
      return;
    }
    setBuscando(true);
    setError(null);
    try {
      const r = await fetch("/api/buscar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consulta: textoUsado,
          filtros: filtrosUsados,
          limite: 20,
        }),
      });
      const datos = await r.json();
      if (datos.error) throw new Error(datos.error);
      setResultados(datos.resultados || []);
    } catch (e) {
      setError({ texto: mensajeAmable(e.message || e), detalle: String(e.message || e) });
      setResultados(null);
    } finally {
      setBuscando(false);
    }
  }

  function cambiar(campo, valor) {
    setFiltros((f) => ({ ...f, [campo]: valor }));
  }

  // Al tocar una etiqueta de tema se busca ese tema directamente.
  function buscarTema(tema) {
    const nuevos = { ...FILTROS_VACIOS, tema };
    setFiltros(nuevos);
    setConsulta("");
    setFiltrosAbiertos(true);
    buscar(nuevos, "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function limpiar() {
    setFiltros(FILTROS_VACIOS);
    setConsulta("");
    setResultados(null);
    setError(null);
    cajaDeTexto.current?.focus();
  }

  return (
    <div className="envoltorio">
      <header className="cabecera">
        <h1>אגרות קודש · Buscador</h1>
        <p>
          Cartas del Rebe de Lubavitch. Preguntá en castellano lo que buscás:
          la búsqueda entiende el sentido, no hace falta acertar las palabras.
        </p>
      </header>

      <form
        className="buscador"
        onSubmit={(e) => {
          e.preventDefault();
          buscar();
        }}
      >
        <input
          ref={cajaDeTexto}
          type="search"
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          placeholder="por ejemplo: cartas sobre la educación de los hijos"
          aria-label="Qué buscás"
        />
        <button type="submit" className="principal" disabled={buscando}>
          {buscando ? "Buscando…" : "Buscar"}
        </button>
      </form>

      <details
        className="filtros"
        open={filtrosAbiertos}
        onToggle={(e) => setFiltrosAbiertos(e.currentTarget.open)}
      >
        <summary>
          Filtros por tomo, tema, festividad y año {hayFiltros ? "· activos" : ""}
        </summary>

        <div className="rejilla">
          <div className="campo">
            <label htmlFor="f-libro">Tomo</label>
            <select
              id="f-libro"
              value={filtros.libro}
              onChange={(e) => cambiar("libro", e.target.value)}
            >
              <option value="">todos</option>
              {(facetas?.libros || []).map((l) => (
                <option key={l.id} value={l.id}>
                  {nombreDeTomo(l)}
                  {l.total_cartas ? ` — ${l.total_cartas} cartas` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="f-tema">Tema</label>
            <select
              id="f-tema"
              value={filtros.tema}
              onChange={(e) => cambiar("tema", e.target.value)}
            >
              <option value="">todos</option>
              {(facetas?.temas || []).map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.valor} ({t.n})
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="f-fest">Festividad</label>
            <select
              id="f-fest"
              value={filtros.festividad}
              onChange={(e) => cambiar("festividad", e.target.value)}
            >
              <option value="">todas</option>
              {(facetas?.festividades || []).map((f) => (
                <option key={f.valor} value={f.valor}>
                  {f.valor} ({f.n})
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label>Años</label>
            <div className="par">
              <input
                type="number"
                inputMode="numeric"
                placeholder={facetas?.anioMin ? String(facetas.anioMin) : "desde"}
                value={filtros.anioDesde}
                onChange={(e) => cambiar("anioDesde", e.target.value)}
                aria-label="Año desde"
              />
              <input
                type="number"
                inputMode="numeric"
                placeholder={facetas?.anioMax ? String(facetas.anioMax) : "hasta"}
                value={filtros.anioHasta}
                onChange={(e) => cambiar("anioHasta", e.target.value)}
                aria-label="Año hasta"
              />
            </div>
          </div>
        </div>

        <div className="pie-filtros">
          <span>
            {facetas?.error
              ? "No pude leer los filtros desde la base."
              : facetas
              ? `${facetas.total} carta${facetas.total === 1 ? "" : "s"} en la base`
              : "Cargando filtros…"}
          </span>
          <button type="button" onClick={limpiar}>
            Limpiar todo
          </button>
        </div>
      </details>

      {error && <Problema {...error} />}

      {resultados !== null && !error && (
        <p className="conteo">
          {resultados.length === 0
            ? "Ninguna carta coincide."
            : `${resultados.length} carta${resultados.length === 1 ? "" : "s"}`}
        </p>
      )}

      {resultados?.map((carta) => (
        <Resultado
          key={carta.id}
          carta={carta}
          libros={facetas?.libros || []}
          alTocarTema={buscarTema}
        />
      ))}

      {resultados === null && !error && (
        <div className="aviso">
          Probá con una pregunta entera, como «qué dice el Rebe sobre estudiar
          de noche», o abrí los filtros y elegí un tomo o un año.
        </div>
      )}

      <footer className="pie">
        Los textos son el OCR de los tomos originales: pueden tener errores de
        lectura. Ante la duda, mirá la página impresa.
      </footer>
    </div>
  );
}

function Resultado({ carta, libros, alTocarTema }) {
  const [abierta, setAbierta] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [idioma, setIdioma] = useState("es");
  const [traducciones, setTraducciones] = useState({});
  const [traduciendo, setTraduciendo] = useState(false);
  const [fallo, setFallo] = useState(null);

  const libro = libros.find((l) => l.id === carta.libro_id);

  function abrir() {
    const nuevo = !abierta;
    setAbierta(nuevo);
    if (nuevo && !detalle) {
      fetch(`/api/carta?id=${encodeURIComponent(carta.id)}`)
        .then((r) => r.json())
        .then((d) => d.carta && setDetalle(d.carta))
        .catch(() => {});
    }
  }

  async function traducir() {
    if (traducciones[idioma]) return;
    setTraduciendo(true);
    setFallo(null);
    try {
      const r = await fetch("/api/traducir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: carta.texto, idioma }),
      });
      const datos = await r.json();
      if (datos.error) throw new Error(datos.error);
      setTraducciones((t) => ({ ...t, [idioma]: datos.traduccion }));
    } catch (e) {
      setFallo({ texto: mensajeAmable(e.message || e), detalle: String(e.message || e) });
    } finally {
      setTraduciendo(false);
    }
  }

  const fecha = fechaLegible(carta.fecha_gregoriana);
  const hebrea = detalle?.fecha_hebrea_texto;
  const traduccion = traducciones[idioma];

  return (
    <article className="carta">
      <h2>
        Carta{carta.numero_carta ? <> <bdi>{carta.numero_carta}</bdi></> : null}
        {carta.destinatario ? <> — <bdi>{carta.destinatario}</bdi></> : null}
      </h2>

      <div className="meta">
        {libro && <span>{nombreDeTomo(libro)}</span>}
        {libro?.anios_hebreos && (
          <span><bdi dir="rtl">{libro.anios_hebreos}</bdi></span>
        )}
        {carta.pagina_inicio != null && <span>pág. {carta.pagina_inicio}</span>}
        {fecha && <span>{fecha}</span>}
        {!fecha && carta.anio_gregoriano && <span>{carta.anio_gregoriano}</span>}
        {hebrea && <span><bdi dir="rtl">{hebrea}</bdi></span>}
        {detalle?.lugar && <span><bdi dir="rtl">{detalle.lugar}</bdi></span>}
      </div>

      <p className={carta.resumen_es ? "resumen" : "resumen vacio"}>
        {carta.resumen_es || "Sin resumen: mirá el texto original."}
      </p>

      {!!carta.temas?.length && (
        <div className="etiquetas">
          {carta.temas.map((t) => (
            <button
              key={t}
              type="button"
              className="etiqueta"
              onClick={() => alTocarTema(t)}
              title={`Ver todas las cartas de ${t}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div className="acciones">
        <button type="button" onClick={abrir}>
          {abierta ? "Ocultar original" : "Ver original en hebreo"}
        </button>

        <select
          value={idioma}
          onChange={(e) => setIdioma(e.target.value)}
          aria-label="Idioma de la traducción"
        >
          {IDIOMAS.map((i) => (
            <option key={i.valor} value={i.valor}>
              {i.nombre}
            </option>
          ))}
        </select>

        <button type="button" onClick={traducir} disabled={traduciendo}>
          {traduciendo
            ? "Traduciendo…"
            : traduccion
            ? "Traducida ✓"
            : "Traducir entera"}
        </button>
      </div>

      {fallo && <Problema {...fallo} />}

      {traduccion && (
        <div className={idioma === "he" || idioma === "yi" ? "traduccion rtl" : "traduccion"}>
          <h3>{IDIOMAS.find((i) => i.valor === idioma)?.nombre}</h3>
          {traduccion}
        </div>
      )}

      {abierta && <div className="hebreo" dir="rtl">{carta.texto}</div>}
    </article>
  );
}

function Problema({ texto, detalle }) {
  return (
    <div className="aviso mal">
      {texto}
      {detalle && detalle !== texto && (
        <details className="detalle">
          <summary>detalle técnico</summary>
          <code>{detalle}</code>
        </details>
      )}
    </div>
  );
}
