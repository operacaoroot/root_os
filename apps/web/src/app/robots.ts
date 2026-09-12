import type { MetadataRoute } from 'next';
import { BASE as CENTRAL } from '@/central/lib/rotas';

const URL_BASE = process.env.NEXT_PUBLIC_URL_BASE ?? 'https://os.operacaoroot.com';

/**
 * robots.txt vale para o domínio inteiro, e neste domínio só a Central é
 * pública — o resto é painel autenticado, que não tem por que ser rastreado.
 * Por isso a regra é invertida: nega tudo e libera só /central.
 *
 * Fora: os favoritos (dependem do navegador de quem acessa, não têm conteúdo
 * indexável) e os links de resgate, que são redirect e diluiriam o material.
 *
 * ============================================================================
 * PENDÊNCIA DE PRODUTO, EM ABERTO DESDE A FATIA 6.5 — a raiz segue NEGADA
 * ============================================================================
 * `disallow: ['/']` nasceu quando a raiz era painel autenticado com um protótipo
 * estático na frente. Desde a fatia 6.5 a raiz é a ENTRADA PÚBLICA do produto —
 * a página de venda com o mapa ao vivo da ROOT (`src/app/page.tsx`) — e esta
 * linha manda todo buscador não a indexar. É coerente com "não queremos ser
 * achados por busca" e incoerente com "esta é a isca do degrau 0": as duas
 * leituras são defensáveis, e a escolha é de PRODUTO, não de quem escreve o
 * código. Por isso o comportamento NÃO foi mudado aqui.
 *
 * A REGRA NÃO ESCONDE NADA que o `page.tsx` já não mostre a quem abrir a URL:
 * robots.txt orienta rastreador, não protege conteúdo. O que ela decide é se a
 * página aparece em busca.
 *
 * QUANDO ALGUÉM DECIDIR "SIM, QUERO A RAIZ INDEXADA", é uma linha — trocar o
 * `disallow` acima por:
 *
 *   disallow: ['/painel', '/config', `${CENTRAL}/favoritos`, `${CENTRAL}/r/`],
 *
 * ...que nega o painel e mantém a raiz e a Central abertas. Vale lembrar de, no
 * mesmo passo, incluir a raiz no sitemap (hoje ele aponta só para a Central) e
 * conferir se alguma outra tela do painel precisa entrar na lista de negadas: a
 * regra deixa de ser "nega tudo" e passa a ser uma lista, que envelhece com a
 * criação de telas novas. Sem essa decisão, deixar como está é o conservador.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: CENTRAL,
        disallow: ['/', `${CENTRAL}/favoritos`, `${CENTRAL}/r/`],
      },
    ],
    sitemap: `${URL_BASE}${CENTRAL}/sitemap.xml`,
  };
}
