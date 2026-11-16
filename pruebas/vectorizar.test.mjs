// ===========================================================================
//  LA VECTORIZACIÓN: EL PARTIDO EN TRAMOS Y LA RUTA QUE ESCRIBE
//
//  Esta es la única ruta del sitio que ESCRIBE en el corpus, así que es la
//  que más tests merece. Varios de los de acá no comprueban que algo funcione
//  sino que algo NO pase.
// ===========================================================================

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  CLAVE_DE_GEMINI_FALSA,
  guion,
  levantar,
  limpiarGuion,
  peticiones,
  postJson,
  get,
  vectorFalso,
} from "./servidores_falsos.mjs";

import {
  LARGO_DE_CHUNK,
  SOLAPE,
  cuantosTramos,
  partirEnChunks,
  tramosConIndice,
} from "../app/lib/tramos.js";

// ===========================================================================
describe("partir en tramos", () => {
  test("un texto corto es un solo tramo, igual al original", () => {
    assert.deepEqual(partirEnChunks("שלום וברכה"), ["שלום וברכה"]);
    assert.equal(cuantosTramos("שלום וברכה"), 1);
  });

  test("un texto vacío no da ningún tramo", () => {
    for (const vacio of ["", "   ", "\n\n", null, undefined]) {
      assert.deepEqual(partirEnChunks(vacio), []);
      assert.equal(cuantosTramos(vacio), 0);
    }
  });

  test("el solape es de verdad: el final de un tramo está al principio del siguiente", () => {
    // Sin solape, una idea que cae justo en el corte queda partida y ninguna
    // de las dos mitades la contiene entera.
    const texto = "x".repeat(3000) + "FRASE-QUE-NO-SE-PUEDE-PARTIR" + "y".repeat(500);
    const tramos = partirEnChunks(texto);
    for (let i = 1; i < tramos.length; i++) {
      const colaAnterior = tramos[i - 1].slice(-SOLAPE);
      assert.equal(
        tramos[i].slice(0, SOLAPE),
        colaAnterior,
        `el tramo ${i} no empieza donde termina el ${i - 1}`
      );
    }
  });

  test("no se pierde ni una letra: juntando los tramos sale el texto entero", () => {
    // Lo más importante. Un partido que se come un pedazo deja esa parte de
    // la carta fuera de la búsqueda para siempre, y no se nota nunca.
    const texto = Array.from({ length: 5000 }, (_, i) => String.fromCharCode(1488 + (i % 22))).join("");
    const tramos = partirEnChunks(texto);
    let rearmado = tramos[0];
    for (let i = 1; i < tramos.length; i++) rearmado += tramos[i].slice(SOLAPE);
    assert.equal(rearmado, texto);
  });

  test("cada tramo entra en el largo máximo", () => {
    const texto = "א".repeat(12000);
    for (const t of partirEnChunks(texto)) {
      assert.ok(t.length <= LARGO_DE_CHUNK, `un tramo mide ${t.length}`);
    }
  });

  test("`cuantosTramos` coincide con los que salen de verdad", () => {
    // Si no coincidieran, la estimación de tiempo de la página mentiría.
    for (const largo of [1, 100, 1499, 1500, 1501, 2600, 2601, 5000, 12345]) {
      const texto = "א".repeat(largo);
      assert.equal(
        cuantosTramos(texto),
        partirEnChunks(texto).length,
        `con ${largo} caracteres`
      );
    }
  });

  test("el bucle termina aunque le pasen un solape absurdo", () => {
    // Con solape >= largo, el cursor no avanzaría y el bucle no terminaría
    // nunca. Es el tipo de error que cuelga un servidor entero.
    const texto = "א".repeat(5000);
    assert.ok(partirEnChunks(texto, 100, 100).length > 0);
    assert.ok(partirEnChunks(texto, 100, 500).length > 0);
  });

  test("los tramos salen numerados desde cero y en orden", () => {
    const t = tramosConIndice("א".repeat(4000));
    assert.deepEqual(
      t.map((x) => x.idx),
      t.map((_, i) => i)
    );
  });
});

// ===========================================================================
let cerrar;
let vectorizar, avance, servicios;

before(async () => {
  cerrar = await levantar();
  process.env.CLAVE_DE_TAREAS = "una-clave-larga-de-prueba-123456";
  const mod = await import("../app/api/vectorizar/route.js");
  vectorizar = mod.POST;
  avance = mod.GET;
  servicios = await import("../app/lib/servicios.js");
});

after(async () => {
  await cerrar();
});

const CLAVE = "una-clave-larga-de-prueba-123456";
const conClave = { "x-clave-de-tareas": CLAVE };
const TEXTO = "אבג דהו זחט ישכ למנ";

beforeEach(() => {
  limpiarGuion();
  servicios.olvidarModelos();
  process.env.CLAVE_DE_TAREAS = CLAVE;
  guion.rpc.avance_de_vectores = { cuerpo: { faltan: 10, viejos: 2, con_hebreo: 100 } };
  guion.rpc.vectores_pendientes = {
    cuerpo: [{ carta_id: "igrot_1", texto: TEXTO, motivo: "falta" }],
  };
  guion.rpc.guardar_chunks_de_carta = { cuerpo: 1 };
});

// ===========================================================================
describe("la puerta de la ruta", () => {
  test("SIN la variable puesta, la ruta no existe", async () => {
    // Mientras no pongas `CLAVE_DE_TAREAS` en Vercel, esta ruta es como si no
    // estuviera en el repositorio. Un 404 tampoco le cuenta a nadie que acá
    // hay algo protegido.
    delete process.env.CLAVE_DE_TAREAS;
    const r = await vectorizar(postJson("/api/vectorizar", { lote: 1 }));
    assert.equal(r.status, 404);
    const g = await avance(get("/api/vectorizar"));
    assert.equal(g.status, 404);
  });

  test("una clave corta no habilita nada", async () => {
    // Una clave de seis letras es peor que ninguna: da sensación de cerrado.
    process.env.CLAVE_DE_TAREAS = "corta";
    const r = await vectorizar(postJson("/api/vectorizar", { lote: 1 }, conClave));
    assert.equal(r.status, 404);
  });

  test("sin la cabecera, 401", async () => {
    const r = await vectorizar(postJson("/api/vectorizar", { lote: 1 }));
    assert.equal(r.status, 401);
  });

  test("con la clave equivocada, 401 y no se toca nada", async () => {
    for (const mala of ["otra-clave-larga-de-prueba-9999", "", "una-clave-larga-de-prueba-12345"]) {
      const r = await vectorizar(
        postJson("/api/vectorizar", { lote: 1 }, { "x-clave-de-tareas": mala })
      );
      assert.equal(r.status, 401, `pasó con "${mala}"`);
    }
    assert.equal(peticiones.length, 0, "no tendría que haber llamado a nadie");
  });

  test("con la clave correcta, trabaja", async () => {
    const r = await vectorizar(postJson("/api/vectorizar", { lote: 1 }, conClave));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).hechas, 1);
  });
});

// ===========================================================================
describe("vectorizar de verdad", () => {
  test("parte, vectoriza y guarda", async () => {
    let guardado;
    guion.rpc.guardar_chunks_de_carta = ({ cuerpo }) => {
      guardado = cuerpo;
      return { cuerpo: 1 };
    };
    const r = await vectorizar(postJson("/api/vectorizar", { lote: 1 }, conClave));
    const d = await r.json();
    assert.equal(d.hechas, 1);
    assert.equal(guardado.p_carta_id, "igrot_1");
    assert.equal(guardado.p_idioma, "he");
    assert.equal(guardado.p_chunks.length, 1);
    assert.equal(guardado.p_chunks[0].texto, TEXTO);
    assert.equal(guardado.p_chunks[0].embedding.length, 1536);
    assert.equal(guardado.p_chunks[0].idx, 0);
  });

  test("una carta larga va en varios tramos, todos con su vector", async () => {
    let guardado;
    guion.rpc.vectores_pendientes = {
      cuerpo: [{ carta_id: "igrot_9", texto: "א".repeat(4000), motivo: "falta" }],
    };
    guion.rpc.guardar_chunks_de_carta = ({ cuerpo }) => {
      guardado = cuerpo;
      return { cuerpo: cuerpo.p_chunks.length };
    };
    await vectorizar(postJson("/api/vectorizar", { lote: 1 }, conClave));
    assert.ok(guardado.p_chunks.length >= 3, `salieron ${guardado.p_chunks.length} tramos`);
    for (const c of guardado.p_chunks) assert.equal(c.embedding.length, 1536);
  });

  test("cuando no queda nada pendiente, avisa que terminó", async () => {
    guion.rpc.vectores_pendientes = { cuerpo: [] };
    const d = await (await vectorizar(postJson("/api/vectorizar", {}, conClave))).json();
    assert.equal(d.terminado, true);
    assert.equal(d.hechas, 0);
  });

  test("el lote se recorta: no se pueden pedir mil cartas de una", async () => {
    let pedido;
    guion.rpc.vectores_pendientes = ({ cuerpo }) => {
      pedido = cuerpo;
      return { cuerpo: [] };
    };
    await vectorizar(postJson("/api/vectorizar", { lote: 100000 }, conClave));
    assert.equal(pedido.p_cantidad, 10);
    await vectorizar(postJson("/api/vectorizar", { lote: "muchas" }, conClave));
    assert.equal(pedido.p_cantidad, 3);
  });

  test("si la base RECHAZA los tramos, se informa y no se cuenta como hecha", async () => {
    guion.rpc.guardar_chunks_de_carta = { cuerpo: 0 };
    const d = await (await vectorizar(postJson("/api/vectorizar", {}, conClave))).json();
    assert.equal(d.hechas, 0);
    assert.match(d.problemas.join(" "), /rechazó/);
  });

  test("una carta que falla no corta la tanda", async () => {
    let n = 0;
    guion.rpc.vectores_pendientes = {
      cuerpo: [
        { carta_id: "mala", texto: TEXTO, motivo: "falta" },
        { carta_id: "buena", texto: TEXTO, motivo: "falta" },
      ],
    };
    guion.embed = () => {
      n++;
      if (n === 1) return { estado: 500, cuerpo: { error: "ups" } };
      return { cuerpo: { embedding: { values: vectorFalso() } } };
    };
    const d = await (await vectorizar(postJson("/api/vectorizar", { lote: 2 }, conClave))).json();
    assert.equal(d.hechas, 1, "la segunda tendría que haberse hecho igual");
    assert.match(d.problemas.join(" "), /mala/);
  });

  test("si se agotó la cuota de Gemini, corta en vez de seguir golpeando", async () => {
    guion.rpc.vectores_pendientes = {
      cuerpo: Array.from({ length: 5 }, (_, i) => ({
        carta_id: `c${i}`,
        texto: TEXTO,
        motivo: "falta",
      })),
    };
    guion.embed = { estado: 429, cuerpo: { error: "RESOURCE_EXHAUSTED" } };
    const d = await (await vectorizar(postJson("/api/vectorizar", { lote: 5 }, conClave))).json();
    assert.equal(d.hechas, 0);
    assert.equal(d.problemas.length, 1, "tendría que haber parado en la primera");
  });

  test("devuelve el avance para la barra", async () => {
    const d = await (await vectorizar(postJson("/api/vectorizar", {}, conClave))).json();
    assert.equal(d.avance.faltan, 10);
    assert.equal(d.avance.viejos, 2);
  });

  test("GET devuelve el avance sin tocar nada", async () => {
    const d = await (await avance(get("/api/vectorizar", conClave))).json();
    assert.equal(d.avance.faltan, 10);
    const escrituras = peticiones.filter((p) => p.url.includes("guardar_chunks"));
    assert.deepEqual(escrituras, []);
  });
});

// ===========================================================================
describe("lo que NO tiene que pasar", () => {
  test("vectorizar NO se come la cuota diaria de búsquedas", async () => {
    // EL ERROR CARO. Si esta ruta pasara por `consumirCuota("buscar")`,
    // vectorizar seis mil cartas dejaría al sitio sin búsqueda por
    // significado para todo el mundo durante días, y se habría descubierto a
    // mitad de la primera corrida con el sitio ya degradado.
    let cuotasPedidas = 0;
    guion.rpc.consumir_cuota = () => {
      cuotasPedidas++;
      return { cuerpo: true };
    };
    guion.rpc.consumir_cuota_por_visitante = () => {
      cuotasPedidas++;
      return { cuerpo: true };
    };
    await vectorizar(postJson("/api/vectorizar", { lote: 1 }, conClave));
    assert.equal(cuotasPedidas, 0, "la vectorización no tiene que tocar los techos de las visitas");
  });

  test("nunca guarda media carta", async () => {
    // Si se corta a mitad de una carta larga y se guardara lo hecho, esa
    // carta dejaría de estar pendiente y nadie se enteraría nunca de que le
    // falta la otra mitad. Acá se fuerza a que el embebido falle en el tercer
    // tramo y se comprueba que NO se llamó a guardar.
    let n = 0;
    guion.rpc.vectores_pendientes = {
      cuerpo: [{ carta_id: "larga", texto: "א".repeat(6000), motivo: "falta" }],
    };
    guion.embed = () => {
      n++;
      if (n >= 3) return { estado: 500, cuerpo: { error: "se cayó" } };
      return { cuerpo: { embedding: { values: vectorFalso() } } };
    };
    let guardo = false;
    guion.rpc.guardar_chunks_de_carta = () => {
      guardo = true;
      return { cuerpo: 1 };
    };
    const d = await (await vectorizar(postJson("/api/vectorizar", { lote: 1 }, conClave))).json();
    assert.equal(guardo, false, "no tenía que guardar una carta a medio vectorizar");
    assert.equal(d.hechas, 0);
  });

  test("la clave de tareas no sale en ninguna respuesta", async () => {
    guion.rpc.vectores_pendientes = { estado: 500, cuerpo: { message: "ups" } };
    const r = await vectorizar(postJson("/api/vectorizar", {}, conClave));
    const texto = await r.text();
    assert.ok(!texto.includes(CLAVE), texto);
  });

  test("la clave de Gemini tampoco", async () => {
    guion.embed = { crudo: `error con key=${CLAVE_DE_GEMINI_FALSA}` };
    const r = await vectorizar(postJson("/api/vectorizar", {}, conClave));
    const texto = await r.text();
    assert.ok(!texto.includes(CLAVE_DE_GEMINI_FALSA), texto);
    assert.ok(!texto.includes("AIzaSy"), texto);
  });

  test("un cuerpo hostil no devuelve 500", async () => {
    for (const malo of ["null", "[]", '"x"', "{roto", "", '{"lote":{"a":1}}', '{"lote":-5}']) {
      const r = await vectorizar(postJson("/api/vectorizar", malo, conClave));
      assert.notEqual(r.status, 500, `con ${malo}`);
      await assert.doesNotReject(() => r.clone().json());
    }
  });

  test("sólo escribe por la función de la base, nunca la tabla directo", async () => {
    await vectorizar(postJson("/api/vectorizar", {}, conClave));
    const directas = peticiones.filter(
      (p) => p.quien === "base" && p.metodo === "POST" && !p.url.includes("/rpc/")
    );
    assert.deepEqual(directas, [], "alguien escribió `chunks` sin pasar por la función");
  });
});
