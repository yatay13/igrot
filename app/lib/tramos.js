// ===========================================================================
//  PARTIR UNA CARTA EN TRAMOS PARA VECTORIZARLA
//
//  Esto es lo que hacía el cuaderno de Colab, con los mismos números:
//  tramos de 1.500 caracteres con 200 de solape.
//
//  POR QUÉ LOS MISMOS NÚMEROS, Y NO LOS QUE A MÍ ME PAREZCAN MEJORES. En la
//  base ya hay 11.461 tramos en hebreo calculados con esos valores, y la
//  búsqueda compara el vector de la consulta contra todos ellos. Si los
//  tramos nuevos salieran de otro tamaño, convivirían dos poblaciones con
//  granularidad distinta: los cortos darían puntajes sistemáticamente más
//  altos que los largos para la misma consulta, y el orden de los resultados
//  dependería de cuándo se vectorizó cada carta y no de qué dice.
//
//  POR QUÉ HAY SOLAPE. Sin él, una idea que cae justo en el corte queda
//  partida en dos mitades, y ninguna de las dos la contiene entera: el
//  vector de cada mitad describe media idea y la búsqueda no encuentra
//  ninguna. Con 200 caracteres de solape, cualquier frase de largo normal
//  aparece completa en por lo menos un tramo.
//
//  Vive en su propio archivo, sin red y sin React, para poder recorrerlo a
//  fondo en `pruebas/tramos.test.mjs`.
// ===========================================================================

export const LARGO_DE_CHUNK = 1500;
export const SOLAPE = 200;
export const DIMENSION = 1536;

/** Cuántos tramos van a salir, sin armarlos.
 *
 *  Sirve para estimar el trabajo y el tiempo antes de empezar, que es lo que
 *  la página de tareas muestra.
 */
export function cuantosTramos(texto, largo = LARGO_DE_CHUNK, solape = SOLAPE) {
  const t = String(texto ?? "").trim();
  if (!t) return 0;
  if (t.length <= largo) return 1;
  const paso = largo - solape;
  return Math.ceil((t.length - solape) / paso);
}

/** Parte el texto en tramos solapados.
 *
 *  El último tramo puede quedar corto, y está bien: recortarlo o pegarlo al
 *  anterior haría que el final de la carta quedara descrito por un vector
 *  dominado por el párrafo de antes.
 */
export function partirEnChunks(texto, largo = LARGO_DE_CHUNK, solape = SOLAPE) {
  const t = String(texto ?? "").trim();
  if (!t) return [];
  if (t.length <= largo) return [t];

  // Un solape mayor o igual al tramo haría que el cursor no avance nunca y el
  // bucle no terminara. No debería pasar con los valores de arriba, pero esta
  // función la puede llamar código futuro con otros números.
  const paso = Math.max(1, largo - solape);

  const tramos = [];
  for (let i = 0; i < t.length; i += paso) {
    tramos.push(t.slice(i, i + largo));
    if (i + largo >= t.length) break;
  }
  return tramos;
}

/** Los tramos listos para mandarle a la base, con su número de orden. */
export function tramosConIndice(texto) {
  return partirEnChunks(texto).map((texto, idx) => ({ idx, texto }));
}
