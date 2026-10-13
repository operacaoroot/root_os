import { Body, Controller, Get, HttpCode, NotImplementedException, Param, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { DiagnosticoService } from './diagnostico.service';
import { PropostaService } from './proposta.service';

/*
 * A INTELIGÊNCIA DO COCKPIT — lane E, fase mínima (13/10/2026).
 *
 * O que está aqui: o pós-sessão da tela 06 (diagnóstico, rascunhos e laudos),
 * refazer e aprovar o diagnóstico, gerar ou refazer a proposta, liberar e
 * segurar a publicação. O leitor de ata, o construtor, o revisor e o assistente
 * da dúvida rodam como REAÇÕES aos fatos do fio (`ata.chegou`,
 * `diagnostico.pronto`, `proposta.ajuste_pedido`, `proposta.duvida`); estas
 * rotas são o caminho de gente.
 *
 * Toda chamada de modelo sai pelo `LLM_PROVIDER` (stub, ponte ou os de
 * produção) com `orgId` para o teto. Publicar é `comercial.proposta.publicar`
 * (R3) pela porta: a rota nunca publica direto.
 *
 * Fase 2 (501 explicativo): a torre (tela 12), o relatório da quinta (tela 13)
 * e o vigia das 08:00.
 */
const FASE_2 = (oQue: string) =>
  new NotImplementedException(`${oQue}: fica para a fase 2 da lane E (relator da quinta, vigia das 08:00 e torre). Nada foi feito.`);

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial')
export class InteligenciaController {
  constructor(
    private readonly diagnosticos: DiagnosticoService,
    private readonly propostas: PropostaService,
  ) {}

  /** Tela 06: o pós-sessão — diagnóstico com minuto, rascunhos da proposta com o laudo e o estado. */
  @Get('lead/:id/sessao')
  @RequirePermissions('leads.ver')
  async sessao(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    const [diagnostico, rascunhos, leitor] = await Promise.all([
      this.diagnosticos.vigente(user.orgId, id),
      this.propostas.rascunhos(user.orgId, id),
      this.diagnosticos.reacoesDoLeitor(user.orgId, id),
    ]);
    return {
      diagnostico: diagnostico ? { eventoId: diagnostico.eventoId, em: diagnostico.em.toISOString(), ...diagnostico.payload } : null,
      leitorDeAta: leitor.map((l) => ({ estado: l.estado, resultado: l.resultado, erro: l.erro, em: l.criadoEm.toISOString() })),
      proposta: rascunhos[0] ?? null,
      versoes: rascunhos,
    };
  }

  /** Refaz o diagnóstico a partir do texto da ata (a transcrição não fica guardada no OS). 503 se o modelo não devolve o JSON combinado. */
  @Post('lead/:id/diagnostico/gerar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  gerarDiagnostico(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.diagnosticos.refazer(user.orgId, id, body);
  }

  /** Aprova o diagnóstico (portão de E5). É o toque do sócio que solta a proposta. */
  @Post('lead/:id/diagnostico/aprovar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  aprovarDiagnostico(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.diagnosticos.aprovar(user.orgId, id, { id: user.sub, nome: user.name ?? null });
  }

  /** Monta (ou refaz) a proposta pela tabela, passa pelo revisor e encaminha: porta, ou fila de decisões. Corpo opcional: `{ produto }`. */
  @Post('lead/:id/proposta/gerar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  gerarProposta(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.propostas.refazer(user.orgId, id, { id: user.sub }, body);
  }

  /** Libera a proposta pronta, agendada ou segurada: vai à porta em nome de quem pediu (R3: OUTRA pessoa confirma). */
  @Post('lead/:id/proposta/publicar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  publicarProposta(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.propostas.liberar(user.orgId, id, { id: user.sub });
  }

  /** "Segurar": tira a proposta da agenda e da fila de liberação. */
  @Post('lead/:id/proposta/segurar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  segurarProposta(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.propostas.segurar(user.orgId, id);
  }

  /** Tela 12: a torre das automações. Fase 2. */
  @Get('torre')
  @RequirePermissions('leads.ver')
  torre(@CurrentUser() _user: JwtUser) {
    throw FASE_2('a torre das automações');
  }

  /** Tela 13: o relatório da semana. Fase 2. */
  @Get('relatorio/semana')
  @RequirePermissions('leads.ver')
  relatorio(@CurrentUser() _user: JwtUser, @Query('dias') _dias?: string) {
    throw FASE_2('o relatório da semana');
  }

  /** Gera o relatório agora (o que a rotina de quinta fará). Fase 2. */
  @Post('relatorio/semana/gerar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  gerarRelatorio(@CurrentUser() _user: JwtUser) {
    throw FASE_2('gerar o relatório da semana');
  }
}
