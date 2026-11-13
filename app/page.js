"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  FILTROS_VACIOS,
  aLaUrl,
  citaDeLaCarta,
  desdeLaUrl,
  esLaMisma,
  palabrasParaResaltar,
  partirResaltando,
} from "./lib/enlaces.js";

const IDIOMAS = [
  { valor: "es", nombre: "Español" },
  { valor: "en", nombre: "Inglés" },
  { valor: "pt", nombre: "Portugués" },
  { valor: "fr", nombre: "Francés" },
  { valor: "he", nombre: "Hebreo moderno" },
  { valor: "yi", nombre: "Ídish" },
];

// Cuántas cartas tiene que tener un tema para aparecer entre los frecuentes.
const TEMAS_FRECUENTES_DESDE = 10;

/** Los temas en dos grupos: los que sirven para filtrar y los muy específicos.
 *
 *  Después de cargar las 3.345 cartas sueltas hay 196 temas, y 126 de ellos
 *  tienen entre una y nueve cartas: `operación entebbe`, `Safed`, `psicología`.
 *  No están mal —son específicos de verdad— pero un desplegable de 196
 *  opciones no se puede usar, menos en un teléfono.
 *
 *  No se esconde ninguno: se agrupan. Los frecuentes quedan arriba, que es lo
 *  que uno busca el 95% de las veces, y los demás siguen ahí, a un scroll de
 *  distancia y con su encabezado. Esconder información correcta sería peor que
 *  ordenarla.
 *
 *  `elegido` se agrega aunque no esté en la lista: si alguien tiene guardado un
 *  enlace con un tema que después se juntó con otro —acabamos de juntar 30— el
 *  filtro mostraría una casilla en blanco sin decir por qué.
 */
function agruparTemas(temas, elegido = "", desde = TEMAS_FRECUENTES_DESDE) {
  const lista = (temas || []).filter((t) => t && t.valor);
  const estaElegido = lista.some((t) => t.valor === elegido);
  const completa =
    elegido && !estaElegido ? [...lista, { valor: elegido, n: null, suelto: true }] : lista;

  const frecuentes = completa.filter((t) => (t.n || 0) >= desde);
  const especificos = completa.filter((t) => (t.n || 0) < desde);

  if (!completa.length) return [];
  if (!frecuentes.length || !especificos.length) {
    return [{ etiqueta: null, temas: completa }];
  }
  return [
    { etiqueta: "Temas más frecuentes", temas: frecuentes },
    { etiqueta: `Más específicos (menos de ${desde} cartas)`, temas: especificos },
  ];
}

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
  if (/muchas búsquedas|muchas traducciones/i.test(t)) return t;
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(t))
    return "Se agotó la cuota gratis de Gemini por hoy. Probá de nuevo más tarde.";
  // 503 es "estoy sobrecargado", no "algo está mal": se arregla solo
  if (/HTTP 50[0234]|UNAVAILABLE|overloaded/i.test(t))
    return "Los modelos gratuitos de Gemini están saturados en este momento " +
      "(error 503). No es un problema de tu clave ni de la carta: esperá un " +
      "minuto y probá de nuevo.";
  if (/403|401|API key|API_KEY/i.test(t))
    return "La clave de Gemini no está funcionando. Revisala en las variables de entorno de Vercel.";
  if (/hebreo sin traducir/i.test(t))
    return "El modelo devolvió el hebreo en vez de traducirlo. Probá otra vez: " +
      "suele salir bien al segundo intento.";
  if (/faltan SUPABASE/i.test(t))
    return "Faltan las variables SUPABASE_URL y SUPABASE_KEY en Vercel.";
  if (/no contestó en \d+ segundos/i.test(t))
    return "La base no contestó a tiempo. Puede estar durmiendo: probá de nuevo " +
      "en unos segundos y suele despertarse.";
  if (/Supabase 4|Supabase 5/i.test(t))
    return "La base no respondió bien. Fijate que el esquema SQL esté corrido y la clave sea la anon.";
  if (/a tiempo|tardó demasiado|tard[oó]/i.test(t))
    return "Gemini tardó más de lo que el servidor puede esperar. Probá de nuevo: " +
      "los modelos gratuitos van lentos a ratos.";
  if (/el servidor cortó/i.test(t)) return t;
  if (/demasiado grande|no es JSON válido|viene vacío/i.test(t))
    return "El pedido salió mal armado. Recargá la página y probá de nuevo.";
  return t;
}

/** Lee la respuesta con cuidado, porque no siempre viene JSON.
 *
 *  Cuando una función de Vercel pasa su límite de tiempo, la respuesta que
 *  llega no es la nuestra: es una página de error en texto plano que empieza
 *  con "An error occurred...". Hacerle `.json()` tira
 *  "Unexpected token 'A', "An error o"... is not valid JSON", que no le
 *  explica nada a nadie. Acá se lee como texto y se traduce a algo legible.
 */
async function leerJson(r) {
  const cuerpo = await r.text();
  try {
    return JSON.parse(cuerpo);
  } catch {
    const pista = cuerpo.slice(0, 120).replace(/\s+/g, " ").trim();
    if (r.status === 504 || /an error occurred|timeout|FUNCTION_INVOCATION/i.test(cuerpo)) {
      throw new Error(
        "el servidor cortó el pedido por tiempo. Con cartas largas pasa: " +
          "probá de nuevo, o traducí la carta por partes."
      );
    }
    throw new Error(`el servidor respondió algo que no es JSON (${r.status}): ${pista}`);
  }
}

const LARGO_DE_TRAMO = 2500;
const POR_PAGINA = 20;

/** Las preguntas que se ofrecen cuando todavía no se buscó nada.
 *
 *  Están elegidas para que cada una muestre algo distinto de lo que el
 *  buscador sabe hacer: una pregunta de consejo, una de costumbre, una sobre
 *  un momento del año y una sobre un oficio. Ninguna es una palabra suelta,
 *  justamente porque lo que hay que enseñar es que acá se pregunta por
 *  sentido y no por palabras exactas. */
const EJEMPLOS = [
  "qué dice el Rebe sobre estudiar de noche",
  "consejos para quien empieza a poner tefilín",
  "cartas a una madre preocupada por la escuela de sus hijos",
  "qué pide el Rebe antes de Rosh Hashaná",
  "cartas a un médico sobre su trabajo",
];

/** Parte una carta larga en tramos para traducirlos de a uno.
 *
 *  Corta por párrafo, y si un párrafo solo ya es más largo que el tramo, por
 *  renglón. Sólo como último recurso corta a lo bruto por cantidad de letras:
 *  respetar dónde termina una idea hace que los tramos peguen bien al unirlos.
 */
function partirEnTramos(texto, largo = LARGO_DE_TRAMO) {
  const limpio = String(texto || "").trim();
  if (limpio.length <= largo) return [limpio];

  const pedazos = [];
  for (const parrafo of limpio.split(/\n\s*\n/)) {
    if (parrafo.length <= largo) {
      pedazos.push(parrafo);
      continue;
    }
    for (const renglon of parrafo.split("\n")) {
      if (renglon.length <= largo) {
        pedazos.push(renglon);
        continue;
      }
      for (let i = 0; i < renglon.length; i += largo) {
        pedazos.push(renglon.slice(i, i + largo));
      }
    }
  }

  // Se vuelven a juntar los pedazos chicos hasta llenar un tramo.
  const tramos = [];
  let actual = "";
  for (const pedazo of pedazos) {
    if (actual && actual.length + pedazo.length + 2 > largo) {
      tramos.push(actual);
      actual = "";
    }
    actual = actual ? `${actual}\n\n${pedazo}` : pedazo;
  }
  if (actual) tramos.push(actual);
  return tramos;
}

/** Pide un tramo traducido.
 *
 *  `cartaId` va SIEMPRE: el servidor lo usa para leer el texto de la carta en
 *  la base y comprobar que el tramo sea de verdad un pedazo de ella. Sin eso,
 *  cualquiera podía mandar un texto inventado con el id de una carta real y
 *  dejarlo guardado como su traducción.
 *
 *  `guardar` es lo que antes se decía mandando `cartaId: null`: va en false
 *  cuando el tramo es un PEDAZO de otro tramo —pasa cuando el modelo llena su
 *  cupo y hay que partirlo al medio— porque los dos pedazos tendrían el mismo
 *  número de tramo y el segundo pisaría al primero en la base. Después, al
 *  leerla, volvería media carta haciéndose pasar por entera.
 */
async function pedirTraduccion(texto, idioma, parte, total, cartaId, guardar = true) {
  const r = await fetch("/api/traducir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texto, idioma, parte, total, cartaId, guardar }),
  });
  const datos = await leerJson(r);
  if (datos.error) throw new Error(datos.error);
  return datos;
}

function nombreDeTomo(libro) {
  if (libro?.numero) return `Tomo ${libro.numero}`;
  return libro?.titulo || libro?.id || "";
}

/** Guarda algo en el navegador sin que un fallo rompa la página.
 *
 *  En una ventana privada, con las cookies bloqueadas o en algunos modos de
 *  iOS, `localStorage` no está o lanza al tocarlo. Nada de lo que se guarda
 *  acá es importante —el tema elegido, el tamaño de la letra hebrea—, así que
 *  si no se puede guardar, no se guarda y listo.
 */
const recordar = {
  leer(clave, porOmision) {
    try {
      const v = window.localStorage.getItem(clave);
      return v === null ? porOmision : v;
    } catch {
      return porOmision;
    }
  },
  escribir(clave, valor) {
    try {
      window.localStorage.setItem(clave, String(valor));
    } catch {
      /* no se puede guardar: no importa */
    }
  },
};

// ===========================================================================
//  EL TEMA: CLARO, OSCURO O EL DEL SISTEMA
//
//  La hoja de estilos ya sabía hacer los tres —tiene las variables para
//  `prefers-color-scheme: dark` y para `[data-theme]`— pero no había ningún
//  interruptor que pusiera ese atributo. O sea que el modo oscuro estaba
//  escrito y era inalcanzable: lo decidía el sistema operativo y el visitante
//  no podía elegir. En un sitio para leer textos largos, eso lo decide el que
//  lee, no la computadora.
// ===========================================================================
const TEMAS = [
  { valor: "auto", nombre: "Según el sistema", icono: "◐" },
  { valor: "light", nombre: "Claro", icono: "☀" },
  { valor: "dark", nombre: "Oscuro", icono: "☾" },
];

function useTema() {
  // Arranca en "auto" SIEMPRE, aunque haya algo guardado: lo que se lee del
  // navegador no existe al renderizar en el servidor, y usarlo en el primer
  // dibujo haría que React se queje de que el HTML no coincide.
  const [tema, setTema] = useState("auto");
  const [listo, setListo] = useState(false);

  useEffect(() => {
    const guardado = recordar.leer("igrot-tema", "auto");
    if (TEMAS.some((t) => t.valor === guardado)) setTema(guardado);
    setListo(true);
  }, []);

  useEffect(() => {
    if (!listo) return;
    const raiz = document.documentElement;
    if (tema === "auto") raiz.removeAttribute("data-theme");
    else raiz.setAttribute("data-theme", tema);
    recordar.escribir("igrot-tema", tema);
  }, [tema, listo]);

  return [tema, setTema];
}

// ===========================================================================
//  EL TAMAÑO DE LA LETRA HEBREA
//
//  El hebreo del corpus sale de un OCR y viene lleno de abreviaturas con
//  comillas. A un tamaño chico, `אי"א` y `איי א` se parecen demasiado. Quien
//  lee en serio necesita agrandarlo, y quien mira de paso no.
//
//  Es la clase de cosa que un lector de textos rabínicos espera encontrar y
//  que no se puede resolver con el zoom del navegador, porque el zoom agranda
//  todo y descoloca la página.
// ===========================================================================
const TAMAÑOS_HEBREOS = [1, 1.15, 1.35, 1.6];

function useTamañoHebreo() {
  const [paso, setPaso] = useState(0);

  useEffect(() => {
    const n = Number(recordar.leer("igrot-hebreo", "0"));
    if (Number.isInteger(n) && n >= 0 && n < TAMAÑOS_HEBREOS.length) setPaso(n);
  }, []);

  // `cuanto` es un salto (+1 o −1), no un destino. Es la diferencia que
  // importa: con un destino, dos clics rápidos calculaban los dos sobre el
  // mismo valor viejo —el que el componente tenía al dibujarse— y el segundo
  // no hacía nada. Se veía como que el botón «A+» se trababa.
  const cambiar = useCallback((cuanto) => {
    setPaso((actual) => {
      const n = Math.min(Math.max(actual + cuanto, 0), TAMAÑOS_HEBREOS.length - 1);
      recordar.escribir("igrot-hebreo", n);
      return n;
    });
  }, []);

  return [TAMAÑOS_HEBREOS[paso], paso, cambiar];
}

// ===========================================================================
export default function Pagina() {
  const [consulta, setConsulta] = useState("");
  const [filtros, setFiltros] = useState(FILTROS_VACIOS);
  const [facetas, setFacetas] = useState(null);
  const [resultados, setResultados] = useState(null);
  const [total, setTotal] = useState(0);
  const [paginable, setPaginable] = useState(true);
  const [buscando, setBuscando] = useState(false);
  const [trayendoMas, setTrayendoMas] = useState(false);
  const [error, setError] = useState(null);
  // Aviso que NO es un error: la búsqueda funcionó, nada más que degradada
  // (por ejemplo sin la parte semántica porque se agotó la cuota de Gemini).
  const [aviso, setAviso] = useState(null);
  // <details open={...}> no alcanza: React lo vuelve a imponer en cada
  // re-render y el panel se cerraba solo mientras lo estabas usando.
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  // Qué carta viene abierta en la dirección, para abrirla sola al entrar.
  const [cartaDelEnlace, setCartaDelEnlace] = useState("");
  const [arriba, setArriba] = useState(true);

  const [tema, setTema] = useTema();
  const [tamañoHebreo, pasoHebreo, cambiarTamañoHebreo] = useTamañoHebreo();

  const cajaDeTexto = useRef(null);
  // Para no volver a lanzar la búsqueda cuando el cambio de dirección lo
  // provocamos nosotros mismos.
  const nosotrosCambiamosLaUrl = useRef(false);

  // Las palabras a resaltar salen de la búsqueda QUE SE HIZO, no de lo que hay
  // escrito en la caja: si no, al borrar la caja se apagaría el resaltado de
  // los resultados que están en pantalla.
  const [consultaHecha, setConsultaHecha] = useState("");
  const palabras = useMemo(() => palabrasParaResaltar(consultaHecha), [consultaHecha]);

  useEffect(() => {
    fetch("/api/facetas")
      .then(leerJson)
      .then((d) => setFacetas(d.error ? { error: d.error } : d))
      .catch((e) => setFacetas({ error: String(e) }));
  }, []);

  const hayFiltros = useMemo(() => Object.values(filtros).some((v) => v !== ""), [filtros]);

  /** Escribe la búsqueda en la dirección del navegador.
   *
   *  `pushState` cuando es una búsqueda nueva, para que el botón «atrás»
   *  vuelva a la anterior. `replaceState` cuando sólo cambió algo accesorio
   *  —qué carta está abierta— porque llenar el historial con eso hace que el
   *  botón «atrás» deje de servir para lo que la gente espera.
   */
  const escribirLaUrl = useCallback((f, texto, carta, nueva) => {
    if (typeof window === "undefined") return;
    const url = `${window.location.pathname}${aLaUrl(f, texto, carta)}`;
    nosotrosCambiamosLaUrl.current = true;
    if (nueva) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, []);

  const buscar = useCallback(
    async function buscar(filtrosUsados, textoUsado, opciones = {}) {
      const { escribir = true, nueva = true, carta = "" } = opciones;
      const hayTexto = Boolean(String(textoUsado || "").trim());
      const hayAlgunFiltro = Object.values(filtrosUsados || {}).some((v) => v !== "");

      if (!hayTexto && !hayAlgunFiltro) {
        setError({ texto: "Escribí algo o elegí al menos un filtro." });
        setResultados(null);
        return;
      }

      setBuscando(true);
      setError(null);
      setAviso(null);
      if (escribir) escribirLaUrl(filtrosUsados, textoUsado, carta, nueva);

      try {
        const r = await fetch("/api/buscar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            consulta: textoUsado,
            filtros: filtrosUsados,
            limite: POR_PAGINA,
          }),
        });
        const datos = await leerJson(r);
        if (datos.error) throw new Error(datos.error);
        setResultados(datos.resultados || []);
        setTotal(datos.total ?? (datos.resultados || []).length);
        setPaginable(datos.paginable !== false);
        setAviso(datos.aviso || null);
        setConsultaHecha(String(textoUsado || ""));
      } catch (e) {
        setError({ texto: mensajeAmable(e.message || e), detalle: String(e.message || e) });
        setResultados(null);
        setTotal(0);
      } finally {
        setBuscando(false);
      }
    },
    [escribirLaUrl]
  );

  /** AL ENTRAR: si la dirección trae una búsqueda, hacerla.
   *
   *  Esto es lo que hace que un enlace compartido funcione, que recargar no
   *  pierda nada y que el botón «atrás» del navegador vuelva a los
   *  resultados en vez de irse del sitio.
   */
  useEffect(() => {
    const aplicar = (busqueda, { escribir }) => {
      const leido = desdeLaUrl(busqueda);
      setConsulta(leido.consulta);
      setFiltros(leido.filtros);
      setCartaDelEnlace(leido.carta);
      // El panel de filtros NO se abre solo. Antes sí, y eso empujaba los
      // resultados media pantalla para abajo justo en el caso que más
      // importa: el de alguien que abre un enlace compartido. Las fichas de
      // arriba ya dicen qué filtros están puestos, así que abrir el panel
      // entero no agrega nada y tapa lo que se vino a ver.
      if (leido.hayAlgo) {
        buscar(leido.filtros, leido.consulta, { escribir, nueva: false, carta: leido.carta });
      } else {
        setResultados(null);
        setConsultaHecha("");
      }
    };

    aplicar(window.location.search, { escribir: false });

    // El botón «atrás» y el «adelante» del navegador.
    const alVolver = () => {
      if (nosotrosCambiamosLaUrl.current) {
        nosotrosCambiamosLaUrl.current = false;
      }
      aplicar(window.location.search, { escribir: false });
    };
    window.addEventListener("popstate", alVolver);
    return () => window.removeEventListener("popstate", alVolver);
  }, [buscar]);

  /** Trae las siguientes y las agrega abajo, sin perder las que ya están. */
  async function traerMas() {
    setTrayendoMas(true);
    try {
      const r = await fetch("/api/buscar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consulta,
          filtros,
          limite: POR_PAGINA,
          desplazamiento: resultados.length,
        }),
      });
      const datos = await leerJson(r);
      if (datos.error) throw new Error(datos.error);
      setResultados((antes) => [...antes, ...(datos.resultados || [])]);
    } catch (e) {
      setError({ texto: mensajeAmable(e.message || e), detalle: String(e.message || e) });
    } finally {
      setTrayendoMas(false);
    }
  }

  function cambiar(campo, valor) {
    setFiltros((f) => ({ ...f, [campo]: valor }));
  }

  /** Saca un filtro y vuelve a buscar en el acto.
   *
   *  Es lo que hacen las fichas de arriba de los resultados. Antes, para
   *  quitar un filtro había que abrir el panel, encontrarlo y ponerlo en
   *  «todos»: tres pasos para deshacer uno.
   */
  function quitarFiltro(campo) {
    const nuevos = { ...filtros, [campo]: "" };
    // Los años van de a dos: quitar uno solo deja una búsqueda rara.
    if (campo === "anios") {
      nuevos.anioDesde = "";
      nuevos.anioHasta = "";
    }
    setFiltros(nuevos);
    const quedaAlgo =
      Boolean(consulta.trim()) || Object.values(nuevos).some((v) => v !== "");
    if (quedaAlgo) buscar(nuevos, consulta);
    else limpiar();
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

  /** Una búsqueda de ejemplo, de las que se ofrecen cuando no hay resultados
   *  todavía. Limpia los filtros a propósito: si quedara uno puesto de una
   *  búsqueda anterior, el ejemplo devolvería poco o nada y parecería que el
   *  buscador no sirve. */
  function buscarEjemplo(texto) {
    setFiltros(FILTROS_VACIOS);
    setConsulta(texto);
    buscar(FILTROS_VACIOS, texto);
  }

  function limpiar() {
    setFiltros(FILTROS_VACIOS);
    setConsulta("");
    setResultados(null);
    setError(null);
    setAviso(null);
    setConsultaHecha("");
    escribirLaUrl(FILTROS_VACIOS, "", "", true);
    cajaDeTexto.current?.focus();
  }

  /** Atajos de teclado.
   *
   *  `/` para ir a la caja de búsqueda es la convención de todos los
   *  buscadores, y en un sitio donde se busca mucho ahorra el viaje al mouse.
   *  `Escape` sale de la caja. Los dos se desactivan si ya estás escribiendo
   *  en algún lado, porque si no es imposible escribir una barra.
   */
  useEffect(() => {
    const alTeclear = (e) => {
      const donde = e.target?.tagName;
      const escribiendo =
        donde === "INPUT" || donde === "TEXTAREA" || donde === "SELECT" || e.target?.isContentEditable;
      if (e.key === "/" && !escribiendo && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        cajaDeTexto.current?.focus();
        cajaDeTexto.current?.select();
      }
      if (e.key === "Escape" && donde === "INPUT") cajaDeTexto.current?.blur();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, []);

  // Para el botón de volver arriba y para que el buscador se pegue al techo.
  useEffect(() => {
    const alRodar = () => setArriba(window.scrollY < 400);
    alRodar();
    window.addEventListener("scroll", alRodar, { passive: true });
    return () => window.removeEventListener("scroll", alRodar);
  }, []);

  /** Las fichas de los filtros puestos, con su nombre legible. */
  const fichas = useMemo(() => {
    const f = [];
    if (filtros.libro) {
      const l = (facetas?.libros || []).find((x) => x.id === filtros.libro);
      // Sólo el número: la ficha ya lleva la palabra «Tomo» en su etiqueta, y
      // `nombreDeTomo` devuelve «Tomo 13», así que se leía «TomoTomo 13».
      f.push({
        campo: "libro",
        que: "Tomo",
        valor: l?.numero ? String(l.numero) : l?.titulo || filtros.libro,
      });
    }
    if (filtros.tema) f.push({ campo: "tema", que: "Tema", valor: filtros.tema, rtl: true });
    if (filtros.festividad)
      f.push({ campo: "festividad", que: "Fecha", valor: filtros.festividad });
    if (filtros.anioDesde || filtros.anioHasta) {
      f.push({
        campo: "anios",
        que: "Años",
        valor:
          filtros.anioDesde && filtros.anioHasta
            ? `${filtros.anioDesde}–${filtros.anioHasta}`
            : filtros.anioDesde
            ? `desde ${filtros.anioDesde}`
            : `hasta ${filtros.anioHasta}`,
      });
    }
    return f;
  }, [filtros, facetas]);

  return (
    <div className="envoltorio">
      {/* LA PORTADA.
          Armada como la portada de un sefer: el nombre hebreo solo y grande,
          una regla, y debajo de qué se trata.

          Las cifras no están escritas a mano: salen de `facetas`, que es lo
          que la base contestó hace un minuto. Un número escrito acá quedaría
          viejo con la primera carga y nadie se enteraría. */}
      {/* LA PORTADA SE ACHICA CUANDO YA HAY RESULTADOS.
          Entera ocupa la primera pantalla completa, que está bien al entrar:
          es la portada de un sefer y dice de qué se trata. Pero cuando alguien
          abre un enlace compartido con una búsqueda hecha, esa misma portada
          hace que no se vea NI UN resultado sin bajar. Ahí lo que importa son
          las cartas, no el título. */}
      <header className={resultados === null && !buscando ? "cabecera" : "cabecera compacta"}>
        <div className="mandos">
          <TemaElegido tema={tema} setTema={setTema} />
        </div>

        <h1 className="titulo-heb" lang="he" dir="rtl">
          אגרות קודש
        </h1>
        <p className="titulo-lat">Buscador de las cartas del Rebe de Lubavitch</p>

        {facetas && !facetas.error && (
          <p className="cifras">
            <span>
              <b>
                {facetas.exactas === false ? "+" : ""}
                {Number(facetas.total || 0).toLocaleString("es-AR")}
              </b>{" "}
              cartas
            </span>
            <span>
              <b>{facetas.libros?.length || 0}</b> tomos
            </span>
            {facetas.anioMin && facetas.anioMax && (
              <span>
                <b>
                  {facetas.anioMin}–{facetas.anioMax}
                </b>
              </span>
            )}
          </p>
        )}

        <p className="entrada">
          Preguntá en castellano lo que buscás: la búsqueda entiende el sentido,
          no hace falta acertar las palabras.
        </p>
      </header>

      <form
        className={arriba ? "buscador" : "buscador pegado"}
        onSubmit={(e) => {
          e.preventDefault();
          buscar(filtros, consulta);
        }}
      >
        <input
          ref={cajaDeTexto}
          type="search"
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          placeholder="por ejemplo: cartas sobre la educación de los hijos"
          aria-label="Qué buscás"
          enterKeyHint="search"
        />
        <button type="submit" className="principal" disabled={buscando}>
          {buscando ? "Buscando…" : "Buscar"}
        </button>
      </form>

      {/* LAS FICHAS DE LOS FILTROS PUESTOS.
          Antes, saber qué filtros estaban activos pedía abrir el panel, y
          quitar uno pedía abrirlo, encontrarlo y ponerlo en «todos»: tres
          pasos para deshacer uno. Acá se ven y se quitan de un toque. */}
      {fichas.length > 0 && (
        <div className="fichas" aria-label="Filtros puestos">
          {fichas.map((f) => (
            <button
              key={f.campo}
              type="button"
              className="ficha"
              onClick={() => quitarFiltro(f.campo)}
              title={`Quitar el filtro de ${f.que.toLowerCase()}`}
            >
              <span className="ficha-que">{f.que}</span>
              {f.rtl ? <bdi dir="rtl">{f.valor}</bdi> : f.valor}
              <span className="ficha-x" aria-hidden="true">
                ×
              </span>
            </button>
          ))}
          <button type="button" className="ficha ficha-todo" onClick={limpiar}>
            Limpiar todo
          </button>
        </div>
      )}

      <details
        className="filtros"
        open={filtrosAbiertos}
        onToggle={(e) => setFiltrosAbiertos(e.currentTarget.open)}
      >
        <summary>
          Filtros por tomo, tema, fecha/festividad y año {hayFiltros ? "· activos" : ""}
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
              {agruparTemas(facetas?.temas, filtros.tema).map((g) =>
                g.etiqueta ? (
                  <optgroup key={g.etiqueta} label={g.etiqueta}>
                    {g.temas.map((t) => (
                      <option key={t.valor} value={t.valor}>
                        {t.valor}
                        {t.n == null ? "" : ` (${t.n})`}
                      </option>
                    ))}
                  </optgroup>
                ) : (
                  g.temas.map((t) => (
                    <option key={t.valor} value={t.valor}>
                      {t.valor}
                      {t.n == null ? "" : ` (${t.n})`}
                    </option>
                  ))
                )
              )}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="f-fest">Fechas/Festividades</label>
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
              ? `${Number(facetas.total || 0).toLocaleString("es-AR")} carta${
                  facetas.total === 1 ? "" : "s"
                } en la base` +
                (facetas.exactas === false ? " · los números de cada tema son aproximados" : "")
              : "Cargando filtros…"}
          </span>
          <div className="pie-botones">
            <button type="button" onClick={() => buscar(filtros, consulta)}>
              Aplicar
            </button>
            <button type="button" onClick={limpiar}>
              Limpiar todo
            </button>
          </div>
        </div>
      </details>

      <main id="resultados">
        {error && <Problema {...error} />}

        {aviso && !error && <p className="aviso">{aviso}</p>}

        {/* MIENTRAS BUSCA.
            Antes la pantalla quedaba igual que estaba y lo único que cambiaba
            era la palabra del botón. En un teléfono eso no se ve, y la
            búsqueda semántica tarda uno o dos segundos: parecía que el toque
            no había entrado. */}
        {buscando && <Esqueleto />}

        {!buscando && resultados !== null && !error && (
          <p className="conteo">
            {resultados.length === 0 ? (
              "Ninguna carta coincide."
            ) : total > resultados.length ? (
              <>
                <b>{total.toLocaleString("es-AR")}</b> cartas · mostrando las primeras{" "}
                {resultados.length}
              </>
            ) : (
              <>
                <b>{resultados.length}</b> carta{resultados.length === 1 ? "" : "s"}
              </>
            )}
          </p>
        )}

        {!buscando &&
          resultados?.map((carta) => (
            <Resultado
              key={carta.id}
              carta={carta}
              libros={facetas?.libros || []}
              alTocarTema={buscarTema}
              palabras={palabras}
              tamañoHebreo={tamañoHebreo}
              pasoHebreo={pasoHebreo}
              cambiarTamañoHebreo={cambiarTamañoHebreo}
              abrirSola={carta.id === cartaDelEnlace}
              alAbrir={(id, abierta) =>
                escribirLaUrl(filtros, consultaHecha, abierta ? id : "", false)
              }
            />
          ))}

        {!buscando &&
          resultados !== null &&
          resultados.length > 0 &&
          total > resultados.length && (
            <div className="traer-mas">
              {paginable ? (
                <button type="button" onClick={traerMas} disabled={trayendoMas}>
                  {trayendoMas
                    ? "Trayendo…"
                    : `Ver ${Math.min(POR_PAGINA, total - resultados.length)} más`}
                </button>
              ) : (
                <p className="nota-chica">
                  Para ver las {total - resultados.length} restantes hay que correr el SQL de
                  los conteos en Supabase.
                </p>
              )}
            </div>
          )}

        {/* LA PANTALLA VACÍA.
            Preguntas de verdad, que se pueden tocar. Sirven para dos cosas a
            la vez: llenan el hueco y enseñan **cómo** se le pregunta a este
            buscador, que no es por palabras sueltas sino por sentido. Es la
            diferencia entre decir «preguntá en castellano» y mostrarlo. */}
        {!buscando && resultados === null && !error && (
          <div className="empezar">
            <p className="empezar-titulo">Probá con una pregunta entera</p>
            <div className="ejemplos">
              {EJEMPLOS.map((e) => (
                <button key={e} type="button" className="ejemplo" onClick={() => buscarEjemplo(e)}>
                  {e}
                </button>
              ))}
            </div>
            <p className="empezar-pie">
              O abrí los filtros y elegí un tomo, un tema, una festividad o un año.
              <br />
              <span className="nota-chica">
                Atajo: apretá <kbd>/</kbd> en cualquier momento para volver a la caja de
                búsqueda.
              </span>
            </p>
          </div>
        )}
      </main>

      {!arriba && (
        <button
          type="button"
          className="volver-arriba"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          title="Volver arriba"
          aria-label="Volver arriba"
        >
          ↑
        </button>
      )}

      <footer className="pie">
        Los textos son el OCR de los tomos originales: pueden tener errores de lectura. Ante la
        duda, mirá la página impresa.
      </footer>
    </div>
  );
}

/** El interruptor del tema, en tres estados. */
function TemaElegido({ tema, setTema }) {
  const actual = TEMAS.find((t) => t.valor === tema) || TEMAS[0];
  function siguiente() {
    const i = TEMAS.findIndex((t) => t.valor === tema);
    setTema(TEMAS[(i + 1) % TEMAS.length].valor);
  }
  return (
    <button
      type="button"
      className="mando"
      onClick={siguiente}
      title={`Tema: ${actual.nombre}. Tocar para cambiar.`}
      aria-label={`Tema: ${actual.nombre}. Tocar para cambiar.`}
    >
      <span aria-hidden="true">{actual.icono}</span>
    </button>
  );
}

/** El hueco que se muestra mientras la búsqueda viaja.
 *
 *  Tiene la forma de los resultados que van a venir, a propósito: así la
 *  página no salta cuando llegan.
 */
function Esqueleto() {
  return (
    <div className="esqueleto" aria-live="polite" aria-busy="true">
      <span className="sr">Buscando…</span>
      {[0, 1, 2].map((i) => (
        <article className="carta hueso" key={i} aria-hidden="true">
          <div className="hueso-linea hueso-titulo" />
          <div className="hueso-linea hueso-meta" />
          <div className="hueso-linea" />
          <div className="hueso-linea hueso-corta" />
        </article>
      ))}
    </div>
  );
}

/** Un texto con lo buscado resaltado.
 *
 *  Devuelve nodos de React, no HTML: no hay ni un `dangerouslySetInnerHTML`
 *  en todo el proyecto, así que un resumen que contuviera etiquetas se
 *  muestra como texto, que es lo que es.
 */
function Resaltado({ texto, palabras }) {
  const pedazos = useMemo(() => partirResaltando(texto, palabras), [texto, palabras]);
  if (pedazos.length === 1 && !pedazos[0].resaltado) return pedazos[0].texto;
  return pedazos.map((p, i) =>
    p.resaltado ? (
      <mark key={i} className="coincide">
        {p.texto}
      </mark>
    ) : (
      <span key={i}>{p.texto}</span>
    )
  );
}

function Resultado({
  carta,
  libros,
  alTocarTema,
  palabras,
  tamañoHebreo,
  pasoHebreo,
  cambiarTamañoHebreo,
  abrirSola,
  alAbrir,
}) {
  const [abierta, setAbierta] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [idioma, setIdioma] = useState("es");
  const [traducciones, setTraducciones] = useState({});
  // Qué idiomas quedaron COMPLETOS. Sin esto, una traducción cortada a mitad
  // de camino dejaba el botón muerto: `traducir` salía en la primera línea
  // porque ya había algo guardado, y no había manera de retomar sin recargar
  // la página. Los tramos ya hechos quedan en la base, así que retomar es
  // barato: los lee de ahí y sigue por el que falta.
  const [completas, setCompletas] = useState({});
  const [traduciendo, setTraduciendo] = useState(false);
  const [avance, setAvance] = useState(null);
  const [fallo, setFallo] = useState(null);
  const [copiado, setCopiado] = useState(false);
  const mio = useRef(null);

  const libro = libros.find((l) => l.id === carta.libro_id);

  /** Trae los datos que la búsqueda no devuelve: fecha hebrea tal como está
   *  impresa, lugar, páginas, encabezado. Devuelve lo que trajo, para que
   *  quien lo necesite —la cita— pueda esperarlo. */
  const traerDetalle = useCallback(async () => {
    if (detalle) return detalle;
    try {
      const d = await fetch(`/api/carta?id=${encodeURIComponent(carta.id)}`).then(leerJson);
      if (d.carta) {
        setDetalle(d.carta);
        return d.carta;
      }
    } catch {
      /* la carta se muestra igual con lo que trajo la búsqueda */
    }
    return null;
  }, [carta.id, detalle]);

  function abrir() {
    const nuevo = !abierta;
    setAbierta(nuevo);
    if (nuevo) traerDetalle();
    alAbrir?.(carta.id, nuevo);
  }

  /** Si la dirección venía con esta carta, abrirla sola y traerla a la vista.
   *
   *  Es lo que hace que compartir el enlace de UNA carta funcione: el que lo
   *  abre no tiene que buscarla en la lista. */
  useEffect(() => {
    if (!abrirSola) return;
    setAbierta(true);
    traerDetalle();
    // Un momento de espera para que la carta ya esté dibujada cuando la
    // traemos a la vista; si no, `scrollIntoView` no encuentra dónde ir.
    const t = setTimeout(() => {
      mio.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 180);
    return () => clearTimeout(t);
  }, [abrirSola, traerDetalle]);

  /** Copia la cita y el enlace directo a esta carta.
   *
   *  La cita necesita datos que sólo trae `/api/carta` —la fecha hebrea tal
   *  como está impresa, la página final—, así que si todavía no están se los
   *  espera antes de copiar. Copiar una cita a medias sería peor que tardar
   *  medio segundo.
   */
  async function alCopiar() {
    const completo = detalle || (await traerDetalle());
    const cita = citaDeLaCarta({ ...carta, ...completo }, libro);
    const enlace = `${window.location.origin}${window.location.pathname}?carta=${encodeURIComponent(
      carta.id
    )}`;
    const texto = `${cita}\n${enlace}`;
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2200);
    } catch {
      // Sin permiso para el portapapeles (pasa en http:// y en algunos
      // navegadores): se muestra la cita para copiarla a mano, en vez de no
      // hacer nada y parecer roto.
      setFallo({
        texto: "No pude copiar sola la cita. Está acá para copiarla a mano:",
        detalle: texto,
      });
    }
  }

  const fecha = fechaLegible(carta.fecha_gregoriana);
  const hebrea = detalle?.fecha_hebrea_texto;
  const traduccion = traducciones[idioma];

  async function traducir() {
    if (completas[idioma]) return;
    setTraduciendo(true);
    setFallo(null);
    setAvance(null);

    const tramos = partirEnTramos(carta.texto);
    const hechos = [];

    try {
      for (let i = 0; i < tramos.length; i++) {
        setAvance({ hecho: i, total: tramos.length });

        // Si el modelo llena su cupo de salida, se parte ese tramo al medio y
        // se reintenta, en vez de dejar media traducción haciéndose pasar por
        // entera. Es lo que pasaba antes con las cartas largas.
        let pendientes = [tramos[i]];
        let entero = true; // ¿sigue siendo el tramo original?
        while (pendientes.length) {
          const tramo = pendientes.shift();
          const datos = await pedirTraduccion(
            tramo,
            idioma,
            i + 1,
            tramos.length,
            carta.id,
            entero
          );
          if (datos.truncada && tramo.length > 800) {
            const mitad = Math.floor(tramo.length / 2);
            pendientes.unshift(tramo.slice(0, mitad), tramo.slice(mitad));
            entero = false;
            continue;
          }
          hechos.push(datos.traduccion);
        }

        // Se muestra lo que ya está traducido mientras siguen los demás.
        setTraducciones((t) => ({ ...t, [idioma]: hechos.join("\n\n") }));
      }
      setCompletas((c) => ({ ...c, [idioma]: true }));
      setAvance(null);
    } catch (e) {
      setFallo({ texto: mensajeAmable(e.message || e), detalle: String(e.message || e) });
      setAvance(null);
    } finally {
      setTraduciendo(false);
    }
  }

  return (
    <article className="carta" ref={mio} id={`c-${carta.id}`}>
      <h2>
        Carta
        {carta.numero_carta ? (
          <>
            {" "}
            <bdi>{carta.numero_carta}</bdi>
          </>
        ) : null}
        {carta.destinatario ? (
          <>
            {" — "}
            <bdi>{carta.destinatario}</bdi>
          </>
        ) : null}
      </h2>

      <div className="meta">
        {libro && <span>{nombreDeTomo(libro)}</span>}
        {libro?.anios_hebreos && (
          <span>
            <bdi dir="rtl">{libro.anios_hebreos}</bdi>
          </span>
        )}
        {carta.pagina_inicio != null && <span>pág. {carta.pagina_inicio}</span>}
        {fecha && <span>{fecha}</span>}
        {!fecha && carta.anio_gregoriano && <span>{carta.anio_gregoriano}</span>}
        {hebrea && (
          <span>
            <bdi dir="rtl">{hebrea}</bdi>
          </span>
        )}
        {detalle?.lugar && (
          <span>
            <bdi dir="rtl">{detalle.lugar}</bdi>
          </span>
        )}
      </div>

      <p className={carta.resumen_es ? "resumen" : "resumen vacio"}>
        {carta.resumen_es ? (
          <Resaltado texto={carta.resumen_es} palabras={palabras} />
        ) : (
          "Sin resumen: mirá el texto original."
        )}
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
            ? avance && avance.total > 1
              ? `Traduciendo ${avance.hecho + 1} de ${avance.total}…`
              : "Traduciendo…"
            : completas[idioma]
            ? "Traducida ✓"
            : traduccion
            ? "Seguir traduciendo"
            : "Traducir entera"}
        </button>

        {/* COPIAR LA CITA.
            Lo que un investigador necesita cuando encuentra una carta: de
            dónde salió, con el tomo, la página, el número y la fecha hebrea,
            más el enlace directo a esta carta. Antes había que armarlo a mano
            mirando la pantalla. */}
        <button
          type="button"
          className={copiado ? "copiar copiado" : "copiar"}
          onClick={alCopiar}
          title="Copiar la cita y el enlace a esta carta"
        >
          {copiado ? "Copiada ✓" : "Copiar cita"}
        </button>
      </div>

      {/* LA BARRA DE AVANCE DE LA TRADUCCIÓN.
          Un contador de texto («Traduciendo 3 de 7…») dice el número pero no
          se ve de reojo. Una carta larga puede tardar un minuto. */}
      {traduciendo && avance && avance.total > 1 && (
        <div
          className="avance"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={avance.total}
          aria-valuenow={avance.hecho}
        >
          <div className="avance-barra" style={{ width: `${(avance.hecho / avance.total) * 100}%` }} />
        </div>
      )}

      {fallo && <Problema {...fallo} />}

      {traduccion && (
        <div className={idioma === "he" || idioma === "yi" ? "traduccion rtl" : "traduccion"}>
          <h3>{IDIOMAS.find((i) => i.valor === idioma)?.nombre}</h3>
          {traduccion}
        </div>
      )}

      {abierta && (
        <>
          {/* EL TAMAÑO DE LA LETRA HEBREA.
              El hebreo del corpus sale de un OCR y viene lleno de
              abreviaturas con comillas: a tamaño chico, `אי"א` y `איי א` se
              parecen demasiado. El zoom del navegador no sirve porque agranda
              todo y descoloca la página. */}
          <div className="mandos-hebreo">
            <span className="nota-chica">Tamaño de la letra hebrea</span>
            <button
              type="button"
              onClick={() => cambiarTamañoHebreo(-1)}
              disabled={pasoHebreo === 0}
              aria-label="Letra más chica"
            >
              A−
            </button>
            <button
              type="button"
              onClick={() => cambiarTamañoHebreo(+1)}
              disabled={pasoHebreo === TAMAÑOS_HEBREOS.length - 1}
              aria-label="Letra más grande"
            >
              A+
            </button>
          </div>
          <div className="hebreo" dir="rtl" style={{ "--escala-hebrea": tamañoHebreo }}>
            {carta.texto}
          </div>
        </>
      )}
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
