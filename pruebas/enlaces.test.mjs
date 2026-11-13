// ===========================================================================
//  LA BÚSQUEDA EN LA DIRECCIÓN, Y EL RESALTADO
//
//  Todo lo de `enlaces.js` es puro: entra un valor, sale un valor. Por eso se
//  puede probar sin navegador y sin React, que es la razón de que esté en su
//  propio archivo y no adentro de `page.js`.
// ===========================================================================

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  FILTROS_VACIOS,
  aLaUrl,
  citaDeLaCarta,
  desdeLaUrl,
  esLaMisma,
  palabrasParaResaltar,
  partirResaltando,
} from "../app/lib/enlaces.js";

const con = (extra) => ({ ...FILTROS_VACIOS, ...extra });

// ---------------------------------------------------------------------------
describe("aLaUrl()", () => {
  test("una búsqueda escrita", () => {
    assert.equal(aLaUrl(FILTROS_VACIOS, "cartas a un médico"), "?q=cartas+a+un+m%C3%A9dico");
  });

  test("no escribe los campos vacíos", () => {
    // Una dirección con `?q=&tomo=&tema=&desde=&hasta=` es ilegible y no dice
    // nada más que una limpia. Y la dirección se comparte.
    assert.equal(aLaUrl(FILTROS_VACIOS, ""), "");
    assert.equal(aLaUrl(con({ libro: "igrot_3" }), ""), "?tomo=igrot_3");
  });

  test("usa nombres cortos y legibles", () => {
    const url = aLaUrl(
      con({ libro: "igrot_3", tema: "חינוך", festividad: "Pésaj", anioDesde: "1950" }),
      "x"
    );
    assert.match(url, /\bq=x\b/);
    assert.match(url, /\btomo=igrot_3\b/);
    assert.match(url, /\bfecha=P/);
    assert.match(url, /\bdesde=1950\b/);
    // y no los de adentro
    assert.ok(!url.includes("libro="), url);
    assert.ok(!url.includes("festividad="), url);
  });

  test("la carta abierta va al final, para que la búsqueda se lea primero", () => {
    const url = aLaUrl(FILTROS_VACIOS, "tefilín", "igrot_13::00003");
    assert.match(url, /^\?q=.*&carta=/);
  });

  test("aguanta nulos sin romperse", () => {
    assert.equal(aLaUrl(null, null), "");
    assert.equal(aLaUrl(undefined, undefined), "");
  });
});

// ---------------------------------------------------------------------------
describe("desdeLaUrl()", () => {
  test("lee lo que escribió aLaUrl: ida y vuelta", () => {
    const original = {
      filtros: con({ libro: "igrot_3", tema: "חינוך", anioDesde: "1950", anioHasta: "1960" }),
      consulta: "cartas a un médico sobre su trabajo",
    };
    const vuelta = desdeLaUrl(aLaUrl(original.filtros, original.consulta));
    assert.deepEqual(vuelta.filtros, original.filtros);
    assert.equal(vuelta.consulta, original.consulta);
    assert.equal(vuelta.hayAlgo, true);
  });

  test("una dirección vacía da una búsqueda vacía", () => {
    for (const vacia of ["", "?", null, undefined, "?&&"]) {
      const r = desdeLaUrl(vacia);
      assert.deepEqual(r.filtros, FILTROS_VACIOS);
      assert.equal(r.consulta, "");
      assert.equal(r.hayAlgo, false);
    }
  });

  test("una dirección con basura no tira nada abajo", () => {
    // La dirección la escribe quien quiera: tiene que dar una búsqueda vacía
    // y no un error.
    for (const mala of [
      "?q",
      "?=x",
      "?%",
      "?q=%E0%A4%A",
      "?tomo=a&tomo=b&tomo=c",
      "?" + "a=1&".repeat(500),
    ]) {
      assert.doesNotThrow(() => desdeLaUrl(mala), `con ${mala}`);
    }
  });

  test("los años con letras se descartan en vez de viajar al servidor", () => {
    const r = desdeLaUrl("?desde=ayer&hasta=19x0");
    assert.equal(r.filtros.anioDesde, "");
    assert.equal(r.filtros.anioHasta, "");
  });

  test("los años de verdad sí pasan", () => {
    const r = desdeLaUrl("?desde=1950&hasta=1966");
    assert.equal(r.filtros.anioDesde, "1950");
    assert.equal(r.filtros.anioHasta, "1966");
  });

  test("recorta lo demasiado largo", () => {
    const r = desdeLaUrl("?q=" + "x".repeat(2000) + "&tomo=" + "y".repeat(2000));
    assert.equal(r.consulta.length, 500);
    assert.equal(r.filtros.libro.length, 200);
  });

  test("con un parámetro repetido toma el primero y no se confunde", () => {
    assert.equal(desdeLaUrl("?tomo=igrot_1&tomo=igrot_9").filtros.libro, "igrot_1");
  });

  test("sólo la carta abierta no cuenta como búsqueda", () => {
    // Si alguien comparte el enlace de una carta sin búsqueda, no hay que
    // lanzar una búsqueda vacía contra el servidor.
    const r = desdeLaUrl("?carta=igrot_13::00003");
    assert.equal(r.carta, "igrot_13::00003");
    assert.equal(r.hayAlgo, false);
  });
});

// ---------------------------------------------------------------------------
describe("esLaMisma()", () => {
  test("dos búsquedas iguales son la misma, aunque el objeto sea otro", () => {
    // Sirve para no llenar el historial: si alguien aprieta «Buscar» tres
    // veces con lo mismo, el botón «atrás» tiene que volver a lo anterior y
    // no pasar por las tres.
    assert.equal(
      esLaMisma(
        { filtros: con({ libro: "igrot_1" }), consulta: "x" },
        { filtros: con({ libro: "igrot_1" }), consulta: "x" }
      ),
      true
    );
  });

  test("y distintas son distintas", () => {
    assert.equal(
      esLaMisma(
        { filtros: con({ libro: "igrot_1" }), consulta: "x" },
        { filtros: con({ libro: "igrot_2" }), consulta: "x" }
      ),
      false
    );
  });

  test("la carta abierta no cuenta: abrir una carta no es otra búsqueda", () => {
    assert.equal(
      esLaMisma({ filtros: FILTROS_VACIOS, consulta: "x" }, { filtros: FILTROS_VACIOS, consulta: "x" }),
      true
    );
  });
});

// ---------------------------------------------------------------------------
describe("palabrasParaResaltar()", () => {
  test("saca las palabras que aparecen en todas las frases", () => {
    // Sin esto, buscar «qué dice el Rebe sobre la educación de los hijos»
    // pinta medio resumen y el resaltado deja de señalar nada.
    const p = palabrasParaResaltar("qué dice el Rebe sobre la educación de los hijos");
    assert.ok(p.includes("educación"), p.join(","));
    assert.ok(p.includes("hijos"), p.join(","));
    assert.ok(!p.includes("de"), p.join(","));
    assert.ok(!p.includes("la"), p.join(","));
    assert.ok(!p.includes("sobre"), p.join(","));
  });

  test("no repite", () => {
    assert.deepEqual(palabrasParaResaltar("tefilín tefilín TEFILÍN"), ["tefilín"]);
  });

  test("ignora las palabras de menos de cuatro letras", () => {
    assert.deepEqual(palabrasParaResaltar("ir a ver"), []);
  });

  test("aguanta el vacío y los signos", () => {
    assert.deepEqual(palabrasParaResaltar(""), []);
    assert.deepEqual(palabrasParaResaltar(null), []);
    assert.deepEqual(palabrasParaResaltar("¿¡...!?"), []);
  });

  test("sirve con palabras en hebreo", () => {
    assert.ok(palabrasParaResaltar("חינוך הבנים").includes("חינוך"));
  });

  test("no se pasa de doce", () => {
    const muchas = Array.from({ length: 40 }, (_, i) => `palabra${i}`).join(" ");
    assert.equal(palabrasParaResaltar(muchas).length, 12);
  });
});

// ---------------------------------------------------------------------------
describe("partirResaltando()", () => {
  const juntar = (pedazos) => pedazos.map((p) => p.texto).join("");
  const resaltado = (pedazos) => pedazos.filter((p) => p.resaltado).map((p) => p.texto);

  test("no pierde ni agrega una letra", () => {
    // Lo más importante: el texto que se muestra tiene que ser EXACTAMENTE el
    // original. Un resaltado que se come una letra está falseando una carta.
    const texto = "El Rebe habla de la educación de los hijos y de su escuela.";
    for (const consulta of ["educación", "hijos escuela", "", "zzz", "de"]) {
      const pedazos = partirResaltando(texto, palabrasParaResaltar(consulta));
      assert.equal(juntar(pedazos), texto, `con "${consulta}"`);
    }
  });

  test("resalta lo que se buscó", () => {
    const pedazos = partirResaltando(
      "sobre la educación de los hijos",
      palabrasParaResaltar("educación hijos")
    );
    assert.deepEqual(resaltado(pedazos), ["educación", "hijos"]);
  });

  test("las tildes no importan, en los dos sentidos", () => {
    // Alguien escribe «educacion» sin tilde y el resumen dice «educación».
    assert.deepEqual(
      resaltado(partirResaltando("la educación", palabrasParaResaltar("educacion"))),
      ["educación"]
    );
    // Y al revés.
    assert.deepEqual(
      resaltado(partirResaltando("el medico", palabrasParaResaltar("médico"))),
      ["medico"]
    );
  });

  test("la eñe también", () => {
    assert.deepEqual(resaltado(partirResaltando("los niños", palabrasParaResaltar("ninos"))), [
      "niños",
    ]);
  });

  test("no distingue mayúsculas", () => {
    assert.deepEqual(resaltado(partirResaltando("EDUCACIÓN", palabrasParaResaltar("educación"))), [
      "EDUCACIÓN",
    ]);
  });

  test("una consulta con signos de expresión regular no rompe nada", () => {
    // `(`, `*`, `[`: si no se escapan, la expresión no compila y el resaltado
    // tira una excepción en medio del renderizado.
    for (const rara of ["(hola", "a*b", "[x]", "a\\b", "a+b", "^$", "a(b[c"]) {
      assert.doesNotThrow(() => {
        const p = partirResaltando("un texto normal", palabrasParaResaltar(rara));
        assert.equal(juntar(p), "un texto normal");
      }, `con "${rara}"`);
    }
  });

  test("devuelve datos, no HTML", () => {
    // Por eso no hace falta `dangerouslySetInnerHTML` en ningún lado: un
    // resumen que contenga `<script>` se muestra como texto, que es lo que es.
    const pedazos = partirResaltando("<script>alert(1)</script> y educación", ["educación"]);
    assert.ok(pedazos.every((p) => typeof p.texto === "string"));
    assert.equal(juntar(pedazos), "<script>alert(1)</script> y educación");
  });

  test("aguanta el texto vacío y el nulo", () => {
    assert.deepEqual(partirResaltando("", ["x"]), [{ texto: "", resaltado: false }]);
    assert.deepEqual(partirResaltando(null, ["x"]), [{ texto: "", resaltado: false }]);
  });
});

// ---------------------------------------------------------------------------
describe("citaDeLaCarta()", () => {
  test("arma la cita completa", () => {
    const cita = citaDeLaCarta(
      {
        numero_carta: "ג׳תתקמ",
        pagina_inicio: 133,
        pagina_fin: 134,
        fecha_hebrea_texto: 'ב"ה, כ"ה אדר תש"כ',
      },
      { numero: 13 }
    );
    assert.match(cita, /Igrot Kodesh/);
    assert.match(cita, /tomo 13/);
    assert.match(cita, /carta ג׳תתקמ/);
    assert.match(cita, /págs\. 133–134/);
  });

  test("una sola página se dice en singular", () => {
    const cita = citaDeLaCarta({ pagina_inicio: 48, pagina_fin: 48 }, { numero: 19 });
    assert.match(cita, /pág\. 48/);
    assert.ok(!cita.includes("págs."), cita);
  });

  test("con pocos datos, arma lo que puede y no inventa", () => {
    const cita = citaDeLaCarta({}, null);
    assert.equal(cita, "אגרות קודש (Igrot Kodesh)");
  });

  test("si no hay fecha hebrea usa el año", () => {
    assert.match(citaDeLaCarta({ anio_gregoriano: 1960 }, { numero: 2 }), /1960/);
  });

  test("aguanta nulos", () => {
    assert.doesNotThrow(() => citaDeLaCarta(null, null));
  });
});
