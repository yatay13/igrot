export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Para saber de un vistazo qué versión está publicada de verdad.
//
// Tres veces seguidas estuvimos discutiendo si un arreglo estaba en Vercel o
// no, mirando de refilón otras respuestas. Con esto se abre la dirección y se
// lee la fecha: si es vieja, el despliegue no pasó, y no hay más que hablar.
const PUBLICADO = "2026-09-29 · traducción con presupuesto de tiempo, errores legibles";

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
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
