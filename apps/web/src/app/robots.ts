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
