import { Body, Controller, Headers, HttpCode, Logger, NotFoundException, Param, Post } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { CABECALHO_DO_SEGREDO_GRANOLA, ReuniaoDoGranolaSchema, type ResultadoDoGranola } from '@mktos/shared';
import { comTenantPublico } from '../common/tenant-publico';
import { GranolaService } from './granola.service';

/** O segredo do webhook. Vazio = webhook desligado (responde 404). */
export const segredoDoGranola = () => (process.env.GRANOLA_WEBHOOK_SEGREDO ?? '').trim();

/*
 * WEBHOOK DO GRANOLA (via Zapier). Rota pública — o Zap não tem sessão —, então:
 *   · o segredo vem no cabeçalho `x-root-segredo` e é comparado em tempo
 *     constante; errado ou ausente, ou webhook desligado, é 404 (a rota "não
 *     existe" para quem não sabe o segredo, como o canal de aprovação);
 *   · a empresa vem no caminho e abre o contexto ANTES da primeira consulta
 *     (`comTenantPublico`, RF-T-04), então toda leitura e escrita fica contida
 *     nela pelo banco.
 * A resposta diz em que card a reunião entrou: quem chama tem o segredo, e o
 * teste do Zap precisa ver o resultado.
 */
@Controller('trabalho/granola')
export class GranolaController {
  private readonly log = new Logger('Granola.webhook');

  constructor(private readonly svc: GranolaService) {}

  @Post(':orgId')
  @HttpCode(200)
  async receber(
    @Param('orgId') orgId: string,
    @Headers(CABECALHO_DO_SEGREDO_GRANOLA) apresentado: string | undefined,
    @Body() corpo: unknown,
  ): Promise<ResultadoDoGranola> {
    if (!this.segredoConfere(apresentado) || !orgId?.trim()) throw new NotFoundException('Não encontrado');
    const dados = ReuniaoDoGranolaSchema.parse(corpo ?? {});
    const r = await comTenantPublico(orgId.trim(), () => this.svc.receber(orgId.trim(), dados));
    this.log.log(`reunião do Granola (${orgId}): ${r.duplicada ? 'repetida' : 'gravada'} em ${r.cliente ?? 'sem cliente'}${r.porque ? ` por ${r.porque}` : ''}`);
    return r;
  }

  private segredoConfere(apresentado: string | undefined): boolean {
    const esperado = segredoDoGranola();
    if (!esperado || typeof apresentado !== 'string' || !apresentado) return false;
    const a = Buffer.from(apresentado, 'utf8');
    const b = Buffer.from(esperado, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
