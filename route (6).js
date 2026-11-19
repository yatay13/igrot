import { vectorDeConsulta, rpc } from "../../lib/servicios.js";
import {
  TOPE_CONSULTA,
  TOPE_LIMITE,
  TOPE_DESPLAZAMIENTO,
  cuerpoJson,
  entero,
  filtro,
  hayAlgunFiltro,
  huellaDelVisitante,
  lista,
  mensajeParaAfuera,
  objeto,
  textoLimpio,
} from "../../lib/guardias.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CUÁNTO PUEDE TARDAR. Esta ruta llama a Gemini para vectorizar la consulta y
// después a Postgres para la búsqueda híbrida sobre veinticinco mil tramos.
// No estaba declarado, así que Vercel le daba el tiempo corto por omisión: si
// se pasaba, devolvía una página de error en HTML y la página reventaba al
// hacerle `res.json()`. `/api/traducir` ya lo tenía declarado; esta no.
export const maxDuration = 30;

export async function POST(pedido) {
  try {
    const cuerpo = objeto(await cuerpoJson(pedido));

    // `textoLimpio` NO convierte: `{"consulta": {"a":1}}` daba el texto
    // `[object Object]`, que se le mandaba a Gemini a vectorizar, con su
    // costo. Un objeto no es una consulta.
    const texto = textoLimpio(cuerpo.consulta, TOPE_CONSULTA);
    const filtros = objeto(cuerpo.filtros);

    // `hayAlgunFiltro` aguanta que `filtros` venga nulo. Antes, un pedido con
    // `{"filtros": null}` tiraba el servidor abajo con un 500: el valor por
    // omisión sólo actúa cuando el campo falta, y `Object.values(null)`
    // explota.
    if (!texto && !hayAlgunFiltro(filtros)) {
      return Response.json({ resultados: [], total: 0 });
    }

    // Con consulta escrita: búsqueda híbrida (vector + texto completo).
    // Sólo con filtros: el vector no aporta nada y se ahorra la llamada.
    //
    // Y si el vector NO SE PUEDE conseguir, se busca igual, sólo por texto.
    // Antes esto tiraba abajo toda la búsqueda escrita: `vectorDeConsulta`
    // llama a Gemini, y con la cuota diaria agotada devolvía 429, la excepción
    // subía hasta acá y el sitio contestaba 500. Los filtros seguían andando
    // porque no pasan por Gemini, y de afuera parecía que "escribir estaba
    // roto". La parte semántica es un extra: la búsqueda por texto completo no
    // tiene por qué depender de ella.
    let vector = null;
    let aviso = null;
    if (texto) {
      try {
        vector = await vectorDeConsulta(
          texto,
          process.env.GEMINI_API_KEY,
          1536,
          huellaDelVisitante(pedido)
        );
      } catch (e) {
        vector = null;
        // El motivo importa: si fue el techo por visitante, el aviso tiene
        // que decirle que espere, no que se agotó la cuota del día.
        aviso = /muchas búsquedas/.test(e?.message || "")
          ? mensajeParaAfuera(e)
          : "Ahora mismo estoy buscando sólo por las palabras exactas: " +
            "la búsqueda por significado no está disponible " +
            "(seguramente se agotó la cuota diaria de Gemini). " +
            "Vuelve sola cuando la cuota se renueve.";
        console.warn("buscar, sin vector:", e?.message);
      }
    }

    const argumentos = {
      consulta_embedding: vector,
      consulta_texto: texto || null,
      filtro_libro: filtro(filtros.libro),
      filtro_anio_desde: filtros.anioDesde ? entero(filtros.anioDesde, null, 1000, 3000) : null,
      filtro_anio_hasta: filtros.anioHasta ? entero(filtros.anioHasta, null, 1000, 3000) : null,
      filtro_festividad: filtro(filtros.festividad),
      filtro_tema: filtro(filtros.tema),
      limite: entero(cuerpo.limite, 20, 1, TOPE_LIMITE),
    };

    // Si el visitante manda el año "desde" más grande que el "hasta", la
    // consulta no devuelve nada y parece que el sitio está roto. Se dan
    // vuelta: es lo que quiso decir.
    if (
      argumentos.filtro_anio_desde != null &&
      argumentos.filtro_anio_hasta != null &&
      argumentos.filtro_anio_desde > argumentos.filtro_anio_hasta
    ) {
      const a = argumentos.filtro_anio_desde;
      argumentos.filtro_anio_desde = argumentos.filtro_anio_hasta;
      argumentos.filtro_anio_hasta = a;
    }

    // La versión nueva de buscar_cartas acepta un desplazamiento y devuelve
    // cuántas coinciden en total. Si en la base todavía está la vieja, la
    // llamada con ese argumento no existe: se reintenta sin él y el sitio
    // sigue andando, nada más que sin paginar.
    const desde = entero(cuerpo.desplazamiento, 0, 0, TOPE_DESPLAZAMIENTO);

    let crudo;
    let paginable = true;
    try {
      crudo = await rpc("buscar_cartas", { ...argumentos, desplazamiento: desde });
    } catch (e) {
      // SÓLO se reintenta si la función con ese argumento NO EXISTE, que es
      // un 404 de PostgREST. Antes se reintentaba ante CUALQUIER fallo, y eso
      // tenía una consecuencia que encontró el banco de pruebas: cuando la
      // base no contestaba, el primer intento esperaba sus 12 segundos, el
      // reintento esperaba otros 12, y la ruta tardaba 24 — más que el tiempo
      // que le da Vercel. O sea que el tope de tiempo quedaba anulado por el
      // reintento, justo en el caso para el que se había puesto.
      const noExiste = e?.estado === 404;
      if (desde > 0 || !noExiste) throw e;
      crudo = await rpc("buscar_cartas", argumentos);
      paginable = false;
    }

    // `lista()` en vez de usar lo que vino tal cual. Si la base devolvía nulo
    // —y PostgREST lo hace cuando la función no devuelve filas— el
    // `resultados.length` de antes tiraba un 500, o sea que el visitante veía
    // un error de servidor cuando lo honesto era decir que no hubo
    // resultados.
    const resultados = lista(crudo);
    const total = resultados.length
      ? Number(resultados[0].total_coincidencias) || resultados.length
      : 0;

    return Response.json({ resultados, total, paginable, aviso });
  } catch (e) {
    // Lo que mandó mal quien llama se contesta con su código y sin alarma:
    // no es una falla del sitio y no tiene que ensuciar los registros.
    if (e?.deEntrada) {
      return Response.json({ error: e.message }, { status: e.codigoHttp || 400 });
    }
    // El detalle crudo de Supabase va a los registros de Vercel. Al navegador
    // va sólo el mensaje corto —`Supabase 404`, `HTTP 429`—, que es lo que
    // `mensajeAmable` necesita para decir en castellano qué revisar, y pasado
    // por el limpiador para que no pueda salir nada con forma de clave.
    console.error("buscar:", e?.message, e?.detalle || "");
    return Response.json({ error: mensajeParaAfuera(e) }, { status: 500 });
  }
}
