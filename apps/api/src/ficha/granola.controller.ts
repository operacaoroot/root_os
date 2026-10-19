import { Body, Controller, Headers, HttpCode, Logger, NotFoundException, Param, Post } from '@nestjs/common';
import { CABECALHO_DO_SEGREDO_GRANOLA, ReuniaoDoGranolaSchema, type ResultadoDoGranola } from '@mktos/shared';
import { comTenantPublico } from '../common/tenant-publico';
import { GranolaService } from './granola.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * WEBHOOK DO GRANOLA (via Zapier). Rota pública — o Zap não tem sessão —, então:
 *   · a empresa vem no caminho e abre o contexto ANTES da primeira consulta
 *     (`comTenantPublico`, RF-T-04), então toda leitura e escrita fica contida
 *     nela pelo banco;
 *   · a senha vem no cabeçalho `x-root-segredo` e é conferida contra a do cofre
 *     DESTA empresa (gerada em Conexões), em tempo constante;
 *   · o conector `granola` tem de estar ligado em Conexões.
 * Senha errada, sem senha ou desligado: 404, a rota "não existe" para quem não
 * deveria entrar. A resposta diz em que card a reunião entrou: quem chama tem a
 * senha, e o teste do Zap precisa ver o resultado.
 */
@Controller('trabalho/granola')
export class GranolaController {
  private readonly log = new Logger('Granola.webhook');

  constructor(private readonly svc: GranolaService) {}

  @Post(':orgId')
  @HttpCode(200)
  async receber(
    @Param('orgId') orgIdCru: string,
    @Headers(CABECALHO_DO_SEGREDO_GRANOLA) apresentado: string | undefined,
    @Body() corpo: unknown,
  ): Promise<ResultadoDoGranola> {
    const orgId = orgIdCru?.trim() ?? '';
    if (!UUID.test(orgId) || !apresentado) throw new NotFoundException('Não encontrado');
    return comTenantPublico(orgId, async () => {
      if (!(await this.svc.podeReceber(orgId, apresentado))) throw new NotFoundException('Não encontrado');
      const r = await this.svc.receber(orgId, ReuniaoDoGranolaSchema.parse(corpo ?? {}));
      this.log.log(`reunião do Granola (${orgId}): ${r.duplicada ? 'repetida' : 'gravada'} em ${r.cliente ?? 'sem cliente'}${r.porque ? ` por ${r.porque}` : ''}`);
      return r;
    });
  }
}
