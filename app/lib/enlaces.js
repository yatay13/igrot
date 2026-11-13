// ===========================================================================
//  LA BÚSQUEDA, GUARDADA EN LA DIRECCIÓN
//
//  POR QUÉ ESTO ES LO MÁS IMPORTANTE QUE LE FALTABA A LA PÁGINA
//
//  Hasta ahora la búsqueda vivía sólo en la memoria del navegador. Eso tenía
//  tres consecuencias, y las tres son graves en un sitio para investigar:
//
//    · No se podía compartir una búsqueda. Encontrás veinte cartas sobre la
//      educación de los hijos y no tenés manera de mandárselas a alguien:
//      hay que explicarle qué escribir.
//    · El botón «atrás» del navegador se iba del sitio. Entrás, buscás,
//      abrís una carta, tocás atrás esperando volver a los resultados, y te
//      vas afuera. Es la cosa que más molesta de una página y la que menos
//      se nota al programarla.
//    · Recargar perdía todo. Un F5 sin querer y empezás de nuevo.
//
//  Con la búsqueda en la dirección, las tres se arreglan de una sola vez, y
//  además aparece algo que no estaba: un enlace a una búsqueda es una CITA.
//  `igrot.vercel.app/?q=cartas+a+un+médico` es algo que se puede poner en un
//  pie de página de un trabajo.
//
//  Las funciones viven en su propio archivo, sin React y sin tocar el
//  navegador, para poder probarlas una por una. Ver `pruebas/enlaces.test.mjs`.
// ===========================================================================

/** Los nombres cortos que se usan en la dirección.
 *
 *  Cortos a propósito: la dirección se comparte y se pega en un mensaje, así
 *  que `?q=...&tomo=...` se lee mucho mejor que `?consulta=...&libro=...`.
 *  Que no coincidan con los nombres de adentro es el precio, y se paga una
 *  sola vez acá.
 */
const EN_LA_URL = {
  libro: "tomo",
  tema: "tema",
  festividad: "fecha",
  anioDesde: "desde",
  anioHasta: "hasta",
};

export const FILTROS_VACIOS = {
  libro: "",
  tema: "",
  festividad: "",
  anioDesde: "",
  anioHasta: "",
};

/** La dirección que le corresponde a esta búsqueda.
 *
 *  Devuelve sólo la parte de la consulta («?q=...»), o cadena vacía si no hay
 *  nada que guardar. Lo vacío NO se escribe: una dirección con
 *  `?q=&tomo=&tema=&desde=&hasta=` es ilegible y no dice nada más que una
 *  limpia.
 */
export function aLaUrl(filtros, consulta, carta = "") {
  const p = new URLSearchParams();
  const texto = String(consulta || "").trim();
  if (texto) p.set("q", texto);
  for (const [adentro, afuera] of Object.entries(EN_LA_URL)) {
    const v = String(filtros?.[adentro] ?? "").trim();
    if (v) p.set(afuera, v);
  }
  // La carta abierta va al final, para que la parte de la búsqueda se lea
  // primero cuando alguien mira el enlace.
  if (carta) p.set("carta", String(carta));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Lo contrario: de una dirección a la búsqueda que representa.
 *
 *  Aguanta cualquier cosa, porque la dirección la escribe quien quiera: una
 *  dirección pegada a medias, con parámetros repetidos o con basura, tiene
 *  que dar una búsqueda vacía y no un error.
 */
export function desdeLaUrl(busqueda) {
  let p;
  try {
    p = new URLSearchParams(String(busqueda || "").replace(/^\?/, ""));
  } catch {
    return { filtros: { ...FILTROS_VACIOS }, consulta: "", carta: "", hayAlgo: false };
  }

  const filtros = { ...FILTROS_VACIOS };
  for (const [adentro, afuera] of Object.entries(EN_LA_URL)) {
    const v = p.get(afuera);
    if (typeof v === "string" && v.trim()) filtros[adentro] = v.trim().slice(0, 200);
  }
  // Los años son números: si vienen con letras, se descartan en vez de
  // viajar hasta el servidor para que los rechace allá.
  for (const campo of ["anioDesde", "anioHasta"]) {
    if (filtros[campo] && !/^\d{3,4}$/.test(filtros[campo])) filtros[campo] = "";
  }

  const consulta = (p.get("q") || "").trim().slice(0, 500);
  const carta = (p.get("carta") || "").trim().slice(0, 200);

  return {
    filtros,
    consulta,
    carta,
    hayAlgo: Boolean(consulta) || Object.values(filtros).some((v) => v !== ""),
  };
}

/** ¿Estas dos búsquedas son la misma?
 *
 *  Hace falta para no llenar el historial del navegador con entradas
 *  repetidas: si alguien aprieta «Buscar» tres veces con lo mismo, el botón
 *  «atrás» tiene que volver a lo anterior y no pasar por las tres.
 */
export function esLaMisma(a, b) {
  return aLaUrl(a?.filtros, a?.consulta) === aLaUrl(b?.filtros, b?.consulta);
}

// ===========================================================================
//  RESALTAR LO QUE SE BUSCÓ
//
//  Una lista de resultados sin resaltado obliga a leer cada resumen entero
//  para entender por qué apareció. Resaltando, se ve de un golpe.
// ===========================================================================

/** Palabras que no vale la pena resaltar.
 *
 *  Sin esta lista, buscar «qué dice el Rebe sobre la educación de los hijos»
 *  pinta medio resumen: `de`, `la`, `el`, `sobre` aparecen en todas las
 *  frases y el resaltado deja de señalar nada. Resaltar todo es lo mismo que
 *  no resaltar.
 */
const VACÍAS = new Set(
  ("de la el los las un una unos unas y o a al en con por para que como cual " +
    "quien cuyo sobre entre desde hasta cuando donde porque pero si no mas " +
    "muy ser es son fue era hay he ha han su sus mi mis tu tus se lo le les " +
    "del este esta estos estas ese esa eso aquel todo toda todos todas")
    .split(" ")
);

/** Las palabras de la consulta que vale la pena resaltar. */
export function palabrasParaResaltar(consulta) {
  return [
    ...new Set(
      String(consulta || "")
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((p) => p.length >= 4 && !VACÍAS.has(p))
    ),
  ].slice(0, 12); // más de doce deja de ayudar y empieza a costar
}

/** Las vocales con tilde cuentan como la misma letra.
 *
 *  Alguien escribe «educacion» sin tilde y el resumen dice «educación»: sin
 *  esto, no se resalta nada y parece que el resaltado está roto. Y al revés
 *  también: «médico» tiene que encontrar «medico».
 */
const IGUALES = {
  a: "aáàä", e: "eéèë", i: "iíìï", o: "oóòö", u: "uúùü", n: "nñ", c: "cç",
};

function patronDeUnaPalabra(palabra) {
  return [...palabra]
    .map((letra) => {
      // Lo que no es letra se escapa: una consulta con un paréntesis o un
      // signo de pregunta no tiene que romper la expresión.
      const grupo = Object.entries(IGUALES).find(([, s]) => s.includes(letra));
      if (grupo) return `[${grupo[1]}]`;
      return letra.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
}

/** Parte un texto en pedazos, marcando los que coinciden.
 *
 *  Devuelve una lista de `{ texto, resaltado }`. Devolver datos y no HTML es
 *  a propósito: así no hay ni un `dangerouslySetInnerHTML` en todo el
 *  proyecto, y un resumen que contenga `<script>` se muestra como texto,
 *  que es lo que es.
 */
export function partirResaltando(texto, palabras) {
  const t = String(texto ?? "");
  if (!t || !palabras?.length) return [{ texto: t, resaltado: false }];

  let re;
  try {
    // `\p{L}` en los bordes en vez de `\b`: `\b` no funciona con palabras
    // acentuadas ni con el hebreo.
    re = new RegExp(`(${palabras.map(patronDeUnaPalabra).join("|")})`, "giu");
  } catch {
    return [{ texto: t, resaltado: false }];
  }

  const pedazos = [];
  let desde = 0;
  for (const m of t.matchAll(re)) {
    if (m.index > desde) pedazos.push({ texto: t.slice(desde, m.index), resaltado: false });
    pedazos.push({ texto: m[0], resaltado: true });
    desde = m.index + m[0].length;
  }
  if (desde < t.length) pedazos.push({ texto: t.slice(desde), resaltado: false });
  return pedazos.length ? pedazos : [{ texto: t, resaltado: false }];
}

// ===========================================================================
//  LA CITA
//
//  Lo que un investigador necesita copiar cuando encuentra una carta: de
//  dónde salió. Antes había que armarla a mano mirando la pantalla.
// ===========================================================================

/** La cita de una carta, lista para pegar en un trabajo. */
export function citaDeLaCarta(carta, libro) {
  const partes = ["אגרות קודש (Igrot Kodesh)"];
  if (libro?.numero) partes.push(`tomo ${libro.numero}`);
  else if (libro?.titulo) partes.push(libro.titulo);
  if (carta?.numero_carta) partes.push(`carta ${carta.numero_carta}`);
  if (carta?.pagina_inicio != null) {
    partes.push(
      carta.pagina_fin != null && carta.pagina_fin !== carta.pagina_inicio
        ? `págs. ${carta.pagina_inicio}–${carta.pagina_fin}`
        : `pág. ${carta.pagina_inicio}`
    );
  }
  if (carta?.fecha_hebrea_texto) partes.push(carta.fecha_hebrea_texto);
  else if (carta?.anio_gregoriano) partes.push(String(carta.anio_gregoriano));
  return partes.join(", ");
}
