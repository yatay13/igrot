import { traducir } from "../../lib/servicios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(pedido) {
  try {
    const { texto, idioma = "es" } = await pedido.json();
    if (!texto || !texto.trim()) {
      return Response.json({ error: "no hay texto" }, { status: 400 });
    }
    const traduccion = await traducir(texto, idioma, process.env.GEMINI_API_KEY);
    return Response.json({ traduccion });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
