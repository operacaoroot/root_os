import { Controller, Get, Header } from '@nestjs/common';

import { MapaPublico } from './mapa-publico';
import { MapaPublicoService } from './mapa-publico.service';

/*
 * A SUPERFÍCIE PÚBLICA DO MAPA — fatia 6.5
 * ========================================
 *
 * Sem guard, como `/api/events/track` e como a superfície pública da bio: quem
 * chega na raiz de `os.operacaoroot.com` não tem token, e não vai ter.
 *
 * SÓ LEITURA, E É DECISÃO. Publicar (criar linha, marcar `publicadoEm`) não tem
 * rota aqui — nem autenticada. Hoje é operação de dono: a semente da migration
 * escreveu o primeiro mapa, e editar é SQL ou, quando existir, uma tela do
 * painel. Uma superfície anônima que também publica seria exatamente a porta que
 * a tabela `MapaPublicoItem` existe para fechar, e ter a rota de escrita "só
 * autenticada" AQUI DENTRO misturaria as duas coisas no mesmo prefixo — o dia em
 * que alguém esquecesse um `@UseGuards` teria consequência máxima.
 *
 * O PREFIXO `mapa-publico` É FAMÍLIA NOVA e está DECLARADO em
 * `src/tenants/modulos.ts` como ESPINHA DO OS. O argumento é este: a vitrine não
 * é módulo de negócio que se contrata, é a porta de entrada do sistema. Ela não
 * desliga para empresa nenhuma porque não é superfície de empresa nenhuma: é
 * anônima, e o gate de módulos deixa requisição anônima passar de propósito.
 * Sem a declaração, `moduloDoCaminho` LANÇARIA aqui — o `ModulosInterceptor`
 * engole, LIBERA a rota e registra o erro alto — e o teste estático
 * `modulos-por-tenant` reprova até a linha existir.
 */
@Controller('mapa-publico')
export class MapaPublicoController {
  constructor(private readonly svc: MapaPublicoService) {}

  /**
   * O mapa da vitrine.
   *
   * NÃO RECEBE PARÂMETRO NENHUM, e isso é a metade da defesa: a empresa sai de
   * uma constante do código (ver `slugDaVitrine`). Um `:slug` aqui transformaria
   * a rota num oráculo anônimo de "esta empresa existe" e serviria a vitrine de
   * qualquer cliente no domínio da ROOT.
   *
   * `Cache-Control: no-store`, E ISSO É DECISÃO, não descuido.
   *
   * O corpo é o mesmo para todo mundo — não há sessão, não há cookie que o mude
   * — e a primeira versão desta rota dizia `public, max-age=30`. Só que RESPOSTA
   * NÃO É SÓ CORPO: o `ContextoInterceptor` põe `x-correlation-id` em TODA
   * resposta, o valor pode ter vindo do próprio chamador (ele entra marcado como
   * `ext-`, mas entra), e esta rota é anônima. Guardada num cache compartilhado,
   * a resposta passa a servir a correlação de UM visitante a todos os outros — o
   * mesmo defeito que o avatar da bio já pagou e consertou
   * (`bio/bio-public.controller.ts`, o `res.removeHeader('x-correlation-id')`).
   *
   * E o cabeçalho público não estava segurando nada: no único caminho que existe
   * hoje quem chama é o RSC da raiz, com `cache: 'no-store'` numa página
   * dinâmica, e não há intermediário na frente. A memória curta do serviço é que
   * absorve a rajada — ela vive no processo, não no cabeçalho.
   *
   * `no-store` explícito e não a AUSÊNCIA de cabeçalho: sem `Cache-Control` um
   * cache compartilhado pode guardar por heurística, que é o mesmo estrago sem
   * ninguém ter pedido.
   *
   * PARA VOLTAR A SER CACHEÁVEL (o dia em que houver CDN na frente): derrubar o
   * `x-correlation-id` da resposta ANTES do corpo, o que exige `@Res` aqui — e
   * `@Res` traz um parâmetro para a assinatura, que é justamente o que o teste
   * `a rota não aceita parâmetro nenhum` vigia. As duas coisas são decidíveis
   * juntas, não separadas.
   */
  @Get()
  @Header('Cache-Control', 'no-store')
  async mapa(): Promise<MapaPublico> {
    return this.svc.mapa();
  }
}
