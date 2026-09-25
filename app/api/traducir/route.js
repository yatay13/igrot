import { traducir } from "../../lib/servicios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(pedido) {
  try {
    const { texto, idioma = "es", parte = 1, total = 1 } = await pedido.json();
    if (!texto || !texto.trim()) {
      return Response.json({ error: "no hay texto" }, { status: 400 });
    }
    const salida = await traducir(
      texto,
      idioma,
      process.env.GEMINI_API_KEY,
      Number(parte),
      Number(total)
    );
    return Response.json(salida);
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
