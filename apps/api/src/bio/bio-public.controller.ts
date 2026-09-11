import { Body, Controller, Get, NotFoundException, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { BioTrackSchema } from '@mktos/shared';
import { BioService } from './bio.service';
import { BioTrackingService } from './bio-tracking.service';
import { StorageService } from '../storage/storage.service';
import { comTenantPublico } from '../common/tenant-publico';
import { AVATAR_ARQUIVO_RE, AVATAR_PREFIXO, pageIdDoAvatar } from './avatar';

const COOKIE_VISITANTE = 'rid';

/** Lê o cookie do header cru — a API não usa cookie-parser. */
function lerCookie(header: string | undefined, nome: string): string | undefined {
  if (!header) return undefined;
  for (const parte of header.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/**
 * Superfície PÚBLICA da bio — sem guard, igual ao /events/track do pixel.
 * Nada aqui devolve dado de outra org: a página pública é, por definição, pública.
 *
 * CADA ROTA RESOLVE O TENANT ANTES DE LER QUALQUER COISA — RF-T-04.
 *
 * O visitante não tem token, então o `ContextoInterceptor` abre o contexto com
 * `orgId: null`. Mas a requisição é de UMA empresa, e o dado que ele trouxe diz
 * qual: o handle, o id do link, o nome do arquivo. O desenho é sempre o mesmo,
 * em dois tempos:
 *
 *   1. uma consulta de resolução, curta, sob a sentinela (`BioService.tenantDo*`);
 *   2. TODO o resto dentro de `comTenantPublico`, já com a empresa publicada no
 *      contexto — e portanto no `SET LOCAL app.org_id` da sessão de banco e no
 *      prefixo de toda linha de log deste pedido.
 *
 * Sem o passo 2, quando o isolamento por linha ligar (fatia 1.5) estas rotas
 * param de devolver linha: a página pública vira 404 para todo mundo, o link
 * deixa de redirecionar e o clique deixa de ser contado.
 */
@Controller('bio')
export class BioPublicController {
  constructor(
    private readonly svc: BioService,
    private readonly tracking: BioTrackingService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Entrega o avatar. O bucket não é público (as portas do MinIO só respondem
   * na rede do compose), então o arquivo sai por aqui — é isto que torna a URL
   * do avatar estável, ao contrário do link assinado de CDN que expira.
   */
  @Get('avatar/:arquivo')
  async avatar(@Param('arquivo') arquivo: string, @Res() res: Response) {
    // o nome vem da URL: só aceita o formato que o upload gera (sem / nem ..)
    if (!AVATAR_ARQUIVO_RE.test(arquivo)) throw new NotFoundException('avatar não encontrado');

    /*
     * A ÚNICA das quatro rotas públicas que não toca em tabela de tenant: o
     * arquivo vem do MinIO. Ainda assim ela resolve a empresa, porque o nome do
     * arquivo carrega o id da página — e sem isso este pedido é o único da bio
     * que aparece no log sem `org=`, justamente o que a RNF-09 quer evitar.
     *
     * NOME FORA DA CONVENÇÃO NÃO É ERRO AQUI. Continua sendo servido sem empresa
     * resolvida, exatamente como antes desta fatia: um 404 novo derrubaria
     * avatar antigo por causa de uma convenção de nome que mudou depois dele. E
     * não gera log nem consulta: `AVATAR_ARQUIVO_RE` aceita qualquer `abc.png`,
     * então qualquer um na internet poderia encher o log — e o banco — pedindo
     * nomes inventados.
     *
     * NOME DENTRO DA CONVENÇÃO QUE NÃO RESOLVE também não é torneira: quem
     * guarda a resposta negativa é `BioService.tenantDaPage`, e é lá que mora o
     * registro, rebaixado a `debug`. Antes desta fatia esta rota não tocava no
     * banco; esta é a parte do preço que dava para não pagar.
     */
    const pageId = pageIdDoAvatar(arquivo);
    const alvo = pageId ? await this.svc.tenantDaPage(pageId) : null;

    const entregar = async () => {
      try {
        const { stream, contentType, size } = await this.storage.get(`${AVATAR_PREFIXO}${arquivo}`);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', size);
        // a chave carrega o hash do conteúdo, então pode cachear pra sempre
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        // Cabeçalho de correlação é POR REQUISIÇÃO: o interceptor o põe em toda
        // resposta, e esta fica um ano num cache. Guardado junto com a imagem,
        // ele passa a servir a correlação de um visitante a todos os outros — e
        // esta rota é pública e anônima, então o valor pode ter vindo do próprio
        // chamador. Sai aqui, antes de o corpo começar a escrever.
        res.removeHeader('x-correlation-id');
        return stream.pipe(res);
      } catch {
        throw new NotFoundException('avatar não encontrado');
      }
    };

    return alvo ? comTenantPublico(alvo.orgId, entregar) : entregar();
  }

  @Get('public/page/:handle')
  async page(@Param('handle') handle: string) {
    const alvo = await this.svc.tenantDoHandle(handle);
    // Rascunho e handle inexistente respondem IGUAL: 404 antes de abrir contexto
    // nenhum. Distinguir os dois contaria, a quem sondasse handles, que aquela
    // página existe e ainda não foi publicada.
    if (!alvo || !alvo.publicada) throw new NotFoundException('página não encontrada');

    return comTenantPublico(alvo.orgId, async () => {
      const page = await this.svc.paginaPublica(handle);
      if (!page) throw new NotFoundException('página não encontrada');
      return page;
    });
  }

  /** Pageview enviado pelo RSC da página pública (server-to-server). */
  @Post('public/track')
  async track(@Body() body: unknown) {
    const e = BioTrackSchema.parse(body);
    const alvo = await this.svc.tenantDoHandle(e.handle);
    if (!alvo || !alvo.publicada) return { ok: false, reason: 'page' };

    return comTenantPublico(alvo.orgId, async () => {
      await this.tracking.registrar(
        {
          rid: e.rid,
          pageId: alvo.pageId,
          orgId: alvo.orgId,
          url: e.url ?? `/${e.handle}`,
          referrer: e.referrer,
          userAgent: e.userAgent,
          params: e.params ?? {},
        },
        'pageview',
      );
      return { ok: true };
    });
  }

  /**
   * Saída passa por aqui pra registrar o clique ANTES de mandar embora.
   * O cookie `rid` chega porque o web faz proxy de /api na mesma origem.
   */
  @Get('r/:linkId')
  async redirect(@Param('linkId') linkId: string, @Req() req: Request, @Res() res: Response) {
    const dono = await this.svc.tenantDoLink(linkId);
    if (!dono) return this.paraABio(res);

    return comTenantPublico(dono.orgId, async () => {
      const alvo = await this.svc.destinoDoLink(linkId);
      if (!alvo) return this.paraABio(res);

      const rid = lerCookie(req.headers.cookie, COOKIE_VISITANTE);
      if (rid) {
        /*
         * Não esperamos o registro: o clique não pode ficar mais lento por causa
         * dele. O `void` sai do escopo de `comTenantPublico` — e continua dentro
         * dele: `AsyncLocalStorage` acompanha a continuação, não a pilha. Medido
         * em `test/rotas-publicas-tenant.test.ts`, que confere o `orgId` da
         * linha gravada depois do redirect já ter respondido.
         */
        void this.tracking.registrar(
          {
            rid,
            pageId: alvo.link.page.id,
            orgId: alvo.link.page.orgId,
            url: req.originalUrl,
            referrer: req.headers.referer ?? null,
            userAgent: req.headers['user-agent'] ?? null,
            params: {},
          },
          alvo.link.tipo === 'whatsapp' ? 'whatsapp_click' : 'link_click',
          { linkId: alvo.link.id, metadata: { rotulo: alvo.link.rotulo, tipo: alvo.link.tipo } },
        );
      }

      return res.redirect(302, alvo.destino);
    });
  }

  /** Link morto, despublicado ou inexistente: devolve para a home da bio. */
  private paraABio(res: Response) {
    const web = process.env.WEB_ORIGIN?.split(',')[0] ?? 'http://localhost:4000';
    return res.redirect(`${web}/b`);
  }
}
