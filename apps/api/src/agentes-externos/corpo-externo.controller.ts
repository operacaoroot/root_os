import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';

import { RequirePermissions } from '../auth/permissions.decorator';
import { CorpoOuSessaoGuard, type RequisicaoDoCorpo } from './corpo-ou-sessao.guard';
import { ExecucaoExternaService, type ChamadorExterno } from './execucao-externa.service';
import { CatalogoExternoService } from './catalogo-externo.service';

/*
 * Quem pode, PELO CONSOLE, fazer um agente executar UMA capacidade em nome de si:
 * a MESMA interseção de `POST /agents/:slug/executar` (`mcp.executar` e
 * `admin.usuarios`) — a conta de serviço da IA tem `mcp.executar` e não pode
 * acordar agente. Com token de corpo a permissão de papel não entra: o corpo
 * pode o que o agente dele declarou, e quem confere é a porta.
 */
const EXECUTAR_AGENTE = ['mcp.executar', 'admin.usuarios'] as const;

/** Quem chama: o corpo (com a pessoa padrão dele) ou a pessoa do console. */
export function chamadorDe(req: RequisicaoDoCorpo): ChamadorExterno {
  const corpo = req.corpoExterno;
  if (corpo) {
    return {
      orgId: corpo.orgId,
      solicitantePadraoId: corpo.solicitanteId,
      corpo: { id: corpo.id, nome: corpo.corpo, agentSlug: corpo.agentSlug },
    };
  }
  return { orgId: String(req.user?.orgId ?? ''), solicitantePadraoId: req.user?.sub ?? null };
}

/*
 * AS ROTAS DO PRÓPRIO AGENTE, que o corpo dele alcança com o token (A2, A3, A4).
 */
@UseGuards(CorpoOuSessaoGuard)
@Controller()
export class CorpoExternoController {
  constructor(
    private readonly execucao: ExecucaoExternaService,
    private readonly catalogo: CatalogoExternoService,
  ) {}

  /** A3 — as capacidades declaradas, como o MCP do modo catálogo as transforma em ferramentas. */
  @Get('agents/:slug/catalogo-externo')
  @RequirePermissions('mcp.ver')
  catalogoExterno(@Req() req: RequisicaoDoCorpo, @Param('slug') slug: string) {
    const c = chamadorDe(req);
    if (c.corpo && c.corpo.agentSlug !== slug) throw new NotFoundException('Agente não encontrado.');
    return this.catalogo.catalogo(c.orgId, slug);
  }

  /** A3 — missão, procedimento e voz: o que o corpo de fora põe no prompt do agente. */
  @Get('agents/:slug/definicao')
  @RequirePermissions('mcp.ver')
  definicao(@Req() req: RequisicaoDoCorpo, @Param('slug') slug: string) {
    const c = chamadorDe(req);
    if (c.corpo && c.corpo.agentSlug !== slug) throw new NotFoundException('Agente não encontrado.');
    return this.catalogo.definicao(c.orgId, slug, c.solicitantePadraoId);
  }

  /**
   * A2 — UMA capacidade, pela porta, por conta de um agente que roda fora do OS.
   *
   * Responde 200 nos três desfechos da porta (`executado`, `aguardando_aprovacao`
   * com o bilhete, `recusado` com o motivo) e no `erro` do efeito: quem chama é
   * um modelo, e o desfecho é dado para ele decidir o próximo passo, não falha
   * de transporte. 404 para agente que não existe nesta empresa (ou que não é o
   * do token); 400 para corpo malformado ou solicitante que não é gente daqui.
   */
  @Post('agents/:slug/capacidades/:id/executar')
  @HttpCode(200)
  @RequirePermissions(...EXECUTAR_AGENTE)
  executar(@Req() req: RequisicaoDoCorpo, @Param('slug') slug: string, @Param('id') id: string, @Body() body: unknown) {
    return this.execucao.executar(chamadorDe(req), slug, id, body);
  }
}
