import { NextResponse, type NextRequest } from 'next/server';
import { materialPorCodigo } from '@/central/data';
import { registrarResgate } from '@/central/lib/resgate';
import { rotas } from '@/central/lib/rotas';
import { COOKIE_VISITANTE } from '@/middleware';

/**
 * Resgate: /central/r/VAULT → 307 pro material do código.
 * O link de uma palavra pra colar em bio, comentário e story.
 *
 * Route Handler, e não página, de propósito: como página o redirect saía por
 * <meta http-equiv="refresh"> com 1s de espera — o loading.tsx abre um Suspense
 * boundary, o Next começa a streamar e já não pode mandar o header Location.
 * Um segundo de tela branca é caro justamente aqui, que é o clique vindo do reel.
 * Aqui a resposta é um Location de verdade, sem renderizar nada.
 *
 * Código desconhecido cai na biblioteca com o termo preenchido.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await ctx.params;
  const limpo = decodeURIComponent(codigo);
  const m = materialPorCodigo(limpo);

  registrarResgate(limpo, m?.slug ?? null, req.cookies.get(COOKIE_VISITANTE)?.value);

  const destino = m ? `${rotas.material(m.slug)}?via=resgate` : rotas.busca(limpo);
  return NextResponse.redirect(new URL(destino, req.url), 307);
}
