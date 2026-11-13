export const runtime = "nodejs";
export const dynamic = "force-dynamic";
//
// Para saber de un vistazo qué versión está publicada de verdad.
//
// Tres veces seguidas estuvimos discutiendo si un arreglo estaba en Vercel o
// no, mirando de refilón otras respuestas. Con esto se abre la dirección y se
// lee la fecha: si es vieja, el despliegue no pasó, y no hay más que hablar.
const PUBLICADO = "2026-11-13 · guardias, banco de pruebas, techo por visitante";

export async function GET() {
  return Response.json(
    {
      version: PUBLICADO,
      compilado: process.env.VERCEL_GIT_COMMIT_SHA
        ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
        : "local",
      tiene: {
        conteos_exactos: true,
        paginado: true,
        total_por_suma_de_tomos: true,
        traducciones_guardadas: true,
        reintento_por_sobrecarga: true,
        guardias_compartidas: true,
        techo_por_visitante: true,
        tiempo_maximo_en_la_base: true,
        clave_de_gemini_en_cabecera: true,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
