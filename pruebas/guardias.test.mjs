// ===========================================================================
//  LAS GUARDIAS, UNA POR UNA
//
//  Estas funciones son puras —entra un valor, sale un valor— así que se
//  pueden recorrer a fondo y sin levantar nada. Es el lugar más barato donde
//  poner pruebas, y donde estaban casi todos los errores que encontré.
//
//  Cada bloque dice ARRIBA qué agujero tapa, no sólo qué comprueba.
// ===========================================================================

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  TOPE_CONSULTA,
  TOPE_CUERPO,
  TOPE_FILTRO,
  TOPE_ID,
  cuerpoJson,
  entero,
  errorDePedido,
  esUnTramoDeLaCarta,
  filtro,
  hayAlgunFiltro,
  huellaDelVisitante,
  idDeCarta,
  limpiarMensaje,
  lista,
  objeto,
  primeraFila,
  textoLimpio,
} from "../app/lib/guardias.js";

// ---------------------------------------------------------------------------
describe("entero()", () => {
  test("recorta por arriba: un número válido y enorme ya no pasa", () => {
    // ESTE ERA EL AGUJERO. `limite` pasaba por `Number()` y nada más. Como
    // cada resultado trae el texto completo de la carta, un solo pedido con
    // `{"limite": 1000000000}` le pedía a Postgres el corpus entero.
    assert.equal(entero(1000000000, 20, 1, 100), 100);
    assert.equal(entero("99999", 20, 1, 100), 100);
    assert.equal(entero(Number.MAX_SAFE_INTEGER, 20, 1, 100), 100);
  });

  test("recorta por abajo, incluyendo los negativos", () => {
    assert.equal(entero(-5, 20, 1, 100), 1);
    assert.equal(entero(-1e9, 0, 0, 10000), 0);
  });

  test("la basura cae al valor por omisión", () => {
    for (const malo of ["", "   ", "abc", "12abc", NaN, Infinity, -Infinity, {}, [], true, () => 1]) {
      assert.equal(entero(malo, 7, 1, 100), 7, `con ${JSON.stringify(String(malo))}`);
    }
  });

  test("el nulo y el undefined NO se vuelven cero", () => {
    // `Number(null)` es 0 y `Number([])` es 0. Si no se rechazan antes, un
    // nulo entra como el número cero en vez de caer al valor por omisión, y
    // un cero puede ser un valor con sentido (un desplazamiento, por ejemplo).
    assert.equal(entero(null, 20, 1, 100), 20);
    assert.equal(entero(undefined, 20, 1, 100), 20);
  });

  test("trunca los decimales en vez de redondear", () => {
    assert.equal(entero(19.9, 1, 1, 100), 19);
    assert.equal(entero("3.7", 1, 1, 100), 3);
  });

  test("acepta el valor por omisión nulo, que es el que usan los filtros de año", () => {
    assert.equal(entero("no es un año", null, 1000, 3000), null);
    assert.equal(entero(1960, null, 1000, 3000), 1960);
  });
});

// ---------------------------------------------------------------------------
describe("textoLimpio()", () => {
  test("NO convierte objetos ni arreglos a texto", () => {
    // ESTE ERA EL AGUJERO. `String(consulta ?? "")` volvía
    // `{"consulta": {"a":1}}` en el texto `[object Object]`, y eso se le
    // mandaba a Gemini para que lo vectorizara, con su costo. Y
    // `{"consulta": ["a","b"]}` se volvía `a,b`.
    assert.equal(textoLimpio({ a: 1 }, 500), "");
    assert.equal(textoLimpio(["a", "b"], 500), "");
    assert.equal(textoLimpio(123, 500), "");
    assert.equal(textoLimpio(true, 500), "");
    assert.equal(textoLimpio(null, 500), "");
    assert.equal(textoLimpio(undefined, 500), "");
  });

  test("recorta al tope", () => {
    assert.equal(textoLimpio("x".repeat(5000), TOPE_CONSULTA).length, TOPE_CONSULTA);
  });

  test("saca los espacios de los costados", () => {
    assert.equal(textoLimpio("  פאריז  \n", 500), "פאריז");
  });

  test("un texto de puros espacios queda vacío", () => {
    assert.equal(textoLimpio("   \t\n  ", 500), "");
  });
});

// ---------------------------------------------------------------------------
describe("objeto() y hayAlgunFiltro()", () => {
  test("`{\"filtros\": null}` ya no tira el servidor abajo", () => {
    // ESTE ERA EL AGUJERO, y lo comprobé corriendo el código viejo: el valor
    // por omisión `filtros = {}` sólo actúa cuando el campo FALTA, no cuando
    // viene nulo, y después `Object.values(null)` lanza un TypeError que
    // subía hasta el `catch` y contestaba 500.
    assert.doesNotThrow(() => hayAlgunFiltro(null));
    assert.equal(hayAlgunFiltro(null), false);
    assert.deepEqual(objeto(null), {});
  });

  test("un texto no cuenta como un objeto con filtros", () => {
    // `Object.values("abc")` da `['a','b','c']`, o sea una lista CON cosas
    // adentro: con el código viejo, `{"filtros":"abc"}` hacía que la búsqueda
    // siguiera como si hubiera filtros puestos y devolviera el corpus.
    assert.equal(hayAlgunFiltro("abc"), false);
    assert.deepEqual(objeto("abc"), {});
  });

  test("un arreglo no es un objeto de filtros", () => {
    assert.deepEqual(objeto(["a"]), {});
    assert.equal(hayAlgunFiltro(["a"]), false);
  });

  test("los valores vacíos no cuentan como filtro puesto", () => {
    assert.equal(hayAlgunFiltro({ libro: "", tema: null, festividad: undefined }), false);
    assert.equal(hayAlgunFiltro({ libro: "", soloConFecha: false }), false);
  });

  test("un filtro de verdad sí cuenta", () => {
    assert.equal(hayAlgunFiltro({ libro: "igrot_13" }), true);
    assert.equal(hayAlgunFiltro({ anioDesde: 1950 }), true);
    assert.equal(hayAlgunFiltro({ soloConFecha: true }), true);
  });

  test("el cero cuenta: es un valor, no una ausencia", () => {
    assert.equal(hayAlgunFiltro({ anioDesde: 0 }), true);
  });
});

// ---------------------------------------------------------------------------
describe("filtro()", () => {
  test("recorta y devuelve null cuando no queda nada", () => {
    assert.equal(filtro(""), null);
    assert.equal(filtro("   "), null);
    assert.equal(filtro(null), null);
    assert.equal(filtro({}), null);
    assert.equal(filtro("Pésaj"), "Pésaj");
    assert.equal(filtro("y".repeat(900)).length, TOPE_FILTRO);
  });
});

// ---------------------------------------------------------------------------
describe("idDeCarta()", () => {
  test("acepta los ids que de verdad usa el corpus", () => {
    for (const bueno of ["igrot_13", "igrot_13::00003", "igrot_1", "a.b-c_d:e"]) {
      assert.equal(idDeCarta(bueno), bueno, `tendría que aceptar ${bueno}`);
    }
  });

  test("rechaza lo que no tiene forma de id", () => {
    const malos = [
      "",
      "   ",
      null,
      undefined,
      123,
      {},
      ["igrot_1"],
      "x".repeat(TOPE_ID + 1),
      "igrot_1/../otra",           // una barra no aparece en ningún id
      "igrot_1?select=*",          // el intento de agregar un parámetro
      "igrot_1&select=*",
      "igrot_1 or 1=1",            // espacios
      "igrot_1\nMalo: si",         // un salto de línea
      "igrot_1%00",
      "igrot_1'",
    ];
    for (const malo of malos) {
      assert.equal(idDeCarta(malo), null, `tendría que rechazar ${JSON.stringify(malo)}`);
    }
  });

  test("saca los espacios de los costados antes de revisar", () => {
    assert.equal(idDeCarta("  igrot_13  "), "igrot_13");
  });
});

// ---------------------------------------------------------------------------
describe("limpiarMensaje() — que no se escape una clave", () => {
  test("tapa una clave de Google aunque nadie le diga cuál es", () => {
    const sucio = "falló el pedido a https://x/models?key=AIzaSyC0ffee0123456789abcdef";
    const limpio = limpiarMensaje(sucio);
    assert.ok(!limpio.includes("AIzaSyC0ffee"), limpio);
    assert.ok(limpio.includes("···"));
  });

  test("tapa un JWT de Supabase", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijklmnop";
    const limpio = limpiarMensaje(`Authorization: Bearer ${jwt} falló`);
    assert.ok(!limpio.includes("eyJhbGciOiJIUzI1NiJ9"), limpio);
  });

  test("tapa las claves nuevas de Supabase", () => {
    assert.ok(!limpiarMensaje("sb_secret_abcdef123456789").includes("abcdef123456789"));
    assert.ok(!limpiarMensaje("sbp_abcdef123456789xyz").includes("abcdef123456789"));
  });

  test("tapa cualquier cosa después de key= aunque no tenga forma conocida", () => {
    const limpio = limpiarMensaje("https://x/y?key=lo-que-sea-raro-9988&z=1");
    assert.ok(!limpio.includes("lo-que-sea-raro"), limpio);
    // y no se come el resto de la dirección
    assert.ok(limpio.includes("&z=1"), limpio);
  });

  test("tapa por valor exacto lo que se le pasa a mano", () => {
    // Esta es la red más segura: no depende de que la clave tenga la forma
    // que yo esperaba.
    const secreto = "una-clave-sin-forma-conocida-12345";
    const limpio = limpiarMensaje(`se cayó usando ${secreto} de nuevo`, secreto);
    assert.ok(!limpio.includes(secreto), limpio);
  });

  test("no tapa nada por error en un mensaje normal", () => {
    const normal = "Supabase 404 · no encontré la función buscar_cartas";
    assert.equal(limpiarMensaje(normal), normal);
  });

  test("aguanta el nulo y el undefined sin escribir la palabra 'null' en pantalla", () => {
    assert.equal(limpiarMensaje(null), "");
    assert.equal(limpiarMensaje(undefined), "");
  });

  test("no tapa una cadena corta que se le pase como secreto", () => {
    // Si alguien pasa una variable de entorno vacía o de dos letras, taparla
    // por valor exacto destruiría el mensaje entero.
    assert.equal(limpiarMensaje("hola que tal", "a"), "hola que tal");
    assert.equal(limpiarMensaje("hola que tal", ""), "hola que tal");
    assert.equal(limpiarMensaje("hola que tal", undefined), "hola que tal");
  });
});

// ---------------------------------------------------------------------------
describe("primeraFila() y lista() — lo que devuelve PostgREST", () => {
  test("primeraFila desenvuelve el arreglo y aguanta el nulo", () => {
    assert.deepEqual(primeraFila([{ a: 1 }]), { a: 1 });
    assert.deepEqual(primeraFila({ a: 1 }), { a: 1 });
    assert.equal(primeraFila([]), null);
    assert.equal(primeraFila(null), null);
    assert.equal(primeraFila(undefined), null);
    // el booleano pelado que devuelve `consumir_cuota`
    assert.equal(primeraFila([false]), false);
    assert.equal(primeraFila(false), false);
    assert.equal(primeraFila(true), true);
  });

  test("lista() devuelve siempre una lista", () => {
    // ESTE ERA EL AGUJERO, y también lo comprobé corriendo el código viejo:
    // `resultados.length` sobre un nulo lanza un TypeError y el visitante ve
    // un error 500 cuando lo honesto es decir que no hubo resultados.
    assert.deepEqual(lista(null), []);
    assert.deepEqual(lista(undefined), []);
    assert.deepEqual(lista({}), []);
    assert.deepEqual(lista("abc"), []);
    assert.deepEqual(lista([1, 2]), [1, 2]);
  });
});

// ---------------------------------------------------------------------------
describe("esUnTramoDeLaCarta() — el control que no se puede saltear", () => {
  const carta = "ב\"ה, כ\"ה אדר תש\"כ\n\nשלום וברכה!\n\nבמענה למכתבו מיום הבהיר.";

  test("acepta un tramo de verdad", () => {
    assert.equal(esUnTramoDeLaCarta("שלום וברכה!", carta), true);
    assert.equal(esUnTramoDeLaCarta(carta, carta), true);
  });

  test("acepta un tramo con los saltos de línea distintos", () => {
    // `partirEnTramos` en la página corta por párrafo y después vuelve a
    // pegar los pedazos chicos con `\n\n`, así que un tramo legítimo puede
    // tener los saltos distintos del original. Por eso se compara sin
    // espacios: un `includes` crudo lo rechazaría.
    assert.equal(esUnTramoDeLaCarta("שלום\nוברכה!", carta), true);
    assert.equal(esUnTramoDeLaCarta("  שלום וברכה!  ", carta), true);
  });

  test("RECHAZA un texto inventado en castellano", () => {
    // Esto es lo más grave que se podía hacer en el sitio: un POST anónimo
    // con el id de una carta real y un párrafo inventado dejaba ese párrafo
    // guardado como «la traducción» de esa carta, y a partir de ahí se le
    // servía a todo el que apretara «Traducir entera». En un sitio que
    // publica cartas del Rebe, eso es ponerle en la boca palabras que no dijo.
    assert.equal(
      esUnTramoDeLaCarta("El Rebe dijo que había que vender la casa.", carta),
      false
    );
  });

  test("rechaza el vacío por los dos lados", () => {
    assert.equal(esUnTramoDeLaCarta("", carta), false);
    assert.equal(esUnTramoDeLaCarta("   ", carta), false);
    assert.equal(esUnTramoDeLaCarta("שלום", ""), false);
    assert.equal(esUnTramoDeLaCarta("שלום", null), false);
    assert.equal(esUnTramoDeLaCarta(null, carta), false);
  });
});

// ---------------------------------------------------------------------------
describe("cuerpoJson() — el tope de tamaño, ANTES de leer", () => {
  const pedidoCon = (texto, cabeceras = {}) =>
    new Request("http://localhost/api/x", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabeceras },
      body: texto,
    });

  test("lee un cuerpo normal", async () => {
    assert.deepEqual(await cuerpoJson(pedidoCon('{"a":1}')), { a: 1 });
  });

  test("rechaza por content-length sin leer nada", async () => {
    const pedido = pedidoCon('{"a":1}', { "content-length": String(TOPE_CUERPO + 1) });
    await assert.rejects(() => cuerpoJson(pedido), (e) => e.codigoHttp === 413);
  });

  test("rechaza un cuerpo grande aunque content-length MIENTA", async () => {
    // Esto es lo que hace que el tope sirva de verdad: la cabecera la elige
    // quien llama. Se cuentan los bytes mientras se lee.
    const enorme = JSON.stringify({ texto: "x".repeat(TOPE_CUERPO + 5000) });
    const pedido = new Request("http://localhost/api/x", {
      method: "POST",
      body: enorme,
    });
    await assert.rejects(() => cuerpoJson(pedido), (e) => e.codigoHttp === 413);
  });

  test("rechaza lo que no es JSON, con 400 y no con 500", async () => {
    await assert.rejects(
      () => cuerpoJson(pedidoCon("{esto no es json")),
      (e) => e.codigoHttp === 400 && e.deEntrada === true
    );
  });

  test("rechaza el cuerpo vacío", async () => {
    await assert.rejects(() => cuerpoJson(pedidoCon("")), (e) => e.codigoHttp === 400);
  });

  test("un tope chico pasado a mano también se respeta", async () => {
    await assert.rejects(
      () => cuerpoJson(pedidoCon('{"a":"' + "x".repeat(100) + '"}'), 50),
      (e) => e.codigoHttp === 413
    );
  });
});

// ---------------------------------------------------------------------------
describe("errorDePedido()", () => {
  test("marca el error como de entrada, para que la ruta no lo trate de falla", () => {
    const e = errorDePedido(413, "muy grande");
    assert.equal(e.codigoHttp, 413);
    assert.equal(e.deEntrada, true);
    assert.equal(e.message, "muy grande");
  });
});

// ---------------------------------------------------------------------------
describe("huellaDelVisitante()", () => {
  const con = (cabeceras) => new Request("http://localhost/x", { headers: cabeceras });

  test("la misma dirección da siempre la misma huella", () => {
    const a = huellaDelVisitante(con({ "x-forwarded-for": "190.1.2.3" }));
    const b = huellaDelVisitante(con({ "x-forwarded-for": "190.1.2.3" }));
    assert.equal(a, b);
    assert.equal(typeof a, "string");
  });

  test("direcciones distintas dan huellas distintas", () => {
    const a = huellaDelVisitante(con({ "x-forwarded-for": "190.1.2.3" }));
    const b = huellaDelVisitante(con({ "x-forwarded-for": "190.1.2.4" }));
    assert.notEqual(a, b);
  });

  test("NO guarda la dirección: no se puede leer la IP en la huella", () => {
    // El techo por visitante necesita distinguir a uno de otro y nada más.
    // Guardar la IP de cada persona que entra a leer cartas del Rebe es
    // guardar un dato personal que no hace falta.
    const h = huellaDelVisitante(con({ "x-forwarded-for": "190.1.2.3" }));
    assert.ok(!h.includes("190"), h);
    assert.ok(/^[0-9a-f]+$/.test(h), h);
  });

  test("de `x-forwarded-for` toma la primera, que es el visitante", () => {
    const sola = huellaDelVisitante(con({ "x-forwarded-for": "190.1.2.3" }));
    const conProxies = huellaDelVisitante(
      con({ "x-forwarded-for": "190.1.2.3, 10.0.0.1, 172.16.0.9" })
    );
    assert.equal(sola, conProxies);
  });

  test("sin ninguna cabecera devuelve null, y entonces no se frena a nadie", () => {
    assert.equal(huellaDelVisitante(con({})), null);
    assert.equal(huellaDelVisitante(con({ "x-forwarded-for": "" })), null);
    assert.equal(huellaDelVisitante(con({ "x-forwarded-for": "   " })), null);
  });
});
