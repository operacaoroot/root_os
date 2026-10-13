import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { DiagnosticoService } from './diagnostico.service';
import { PropostaService } from './proposta.service';
import { RelatorioDaSemanaService } from './relatorio-da-semana.service';
import { TorreService } from './torre.service';
import { VigiaService } from './vigia.service';

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
 * Fase 2 (13/10/2026): a torre (tela 12, só leitura), o relatório da quinta
 * (tela 13: números do banco, leitura do modelo sem número) e o vigia das 08:00
 * (rodar agora, o mesmo que o relógio faz às 08:00).
 */

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial')
export class InteligenciaController {
  constructor(
    private readonly diagnosticos: DiagnosticoService,
    private readonly propostas: PropostaService,
    private readonly torres: TorreService,
    private readonly relatorios: RelatorioDaSemanaService,
    private readonly vigias: VigiaService,
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

  /**
   * Aprova o diagnóstico (portão de E5). É o toque do sócio que solta a proposta.
   * Revisão E-4/C-8: decisão de mesa (`aprovacoes.decidir`, conta de máquina
   * recusada) sobre o diagnóstico que a pessoa leu: corpo `{ eventoId }`, 409
   * se o vigente for outro.
   */
  @Post('lead/:id/diagnostico/aprovar')
  @HttpCode(200)
  @RequirePermissions('aprovacoes.decidir')
  aprovarDiagnostico(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const eventoId = body && typeof body === 'object' ? (body as { eventoId?: unknown }).eventoId : undefined;
    return this.diagnosticos.aprovar(user.orgId, id, { id: user.sub, nome: user.name ?? null, papeis: user.roles ?? [] }, typeof eventoId === 'string' ? eventoId : '');
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

  /** Tela 12: a torre das automações (autonomia, última vez, acerto, premissa, vigia e custo do dia). */
  @Get('torre')
  @RequirePermissions('leads.ver')
  torre(@CurrentUser() user: JwtUser) {
    return this.torres.torre(user.orgId);
  }

  /** Roda o vigia agora (o mesmo que o relógio faz às 08:00): confere, grava os fatos e abre as exceções. */
  @Post('torre/vigia')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  rodarVigia(@CurrentUser() user: JwtUser) {
    return this.vigias.passar(user.orgId);
  }

  /** Tela 13: o último relatório gerado com o mesmo recorte; sem ele, os números ao vivo (sem leitura). */
  @Get('relatorio/semana')
  @RequirePermissions('leads.ver')
  relatorio(@CurrentUser() user: JwtUser, @Query('dias') dias?: string) {
    return this.relatorios.ler(user.orgId, dias);
  }

  /** Gera o relatório agora (o que o relógio faz na quinta 18:00). Corpo opcional: `{ dias }`. */
  @Post('relatorio/semana/gerar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  gerarRelatorio(@CurrentUser() user: JwtUser, @Body() body: unknown, @Query('dias') dias?: string) {
    const doCorpo = body && typeof body === 'object' ? (body as { dias?: unknown }).dias : undefined;
    return this.relatorios.gerar(user.orgId, { dias: doCorpo ?? dias, origem: 'pessoa' });
  }
}
