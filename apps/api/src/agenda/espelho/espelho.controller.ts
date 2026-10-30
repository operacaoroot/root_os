import { BadRequestException, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import type { EstadoDaSincronia, RespostaDoEspelho, SocioDaAgenda } from '@mktos/shared';

import { CurrentUser, JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { PermissionsGuard } from '../../auth/permissions.guard';
import type { ResultadoDaRotina } from '../../routines/rotina.tipos';
import { EspelhoService } from './espelho.service';

/** O maior intervalo que a tela pede de uma vez (o mês com folga, os 60 dias dos Conflitos, a cópia de 210). */
const MAIOR_INTERVALO_DIAS = 220;
const DIA = 86_400_000;

/** `GET /agenda/livre-ocupado`: só intervalos, por sócio. O e-mail da agenda pessoal não sai daqui. */
export interface RespostaDoLivreOcupadoDaTela {
  de: string;
  ate: string;
  pessoas: Array<{ nome: SocioDaAgenda; ocupado: Array<{ inicio: string; fim: string }>; erro: string | null }>;
}

export interface RespostaDaSincroniaAgora {
  resultado: ResultadoDaRotina;
  sincronia: EstadoDaSincronia;
}

function intervalo(de: string | undefined, ate: string | undefined, teto = MAIOR_INTERVALO_DIAS): { de: Date; ate: Date } {
  const d = new Date(String(de ?? ''));
  const a = new Date(String(ate ?? ''));
  if (!de || !ate || Number.isNaN(d.getTime()) || Number.isNaN(a.getTime())) {
    throw new BadRequestException('Período inválido: use datas ISO em `de` e `ate`.');
  }
  if (a <= d) throw new BadRequestException('O fim do período tem de ser depois do início.');
  if (a.getTime() - d.getTime() > teto * DIA) throw new BadRequestException(`O período pode ter no máximo ${teto} dias.`);
  return { de: d, ate: a };
}

/**
 * O ESPELHO DA AGENDA NA TELA (agenda v2, 29/10/2026, lane G1).
 *
 * `GET /api/agenda/espelho?de=&ate=` — os eventos do intervalo (`RespostaDoEspelho`):
 *   do espelho, ou direto do Google quando ele atrasou mais de 10 min. A primeira
 *   leitura semeia as rotinas `agenda.sincronizar` e `agenda.copia` (só na casa).
 * `GET /api/agenda/sincronia` — `EstadoDaSincronia` (o selo "sincronizado há N s").
 * `GET /api/agenda/livre-ocupado?de=&ate=` — o livre/ocupado das agendas pessoais
 *   AO VIVO, pela porta, em nome de quem abriu: só intervalos, por sócio.
 * `POST /api/agenda/sincronia/agora` — uma passagem já (`agenda.editar`).
 *
 * Ver: `dashboard.ver`, a mesma da tela `/agenda`.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agenda')
export class EspelhoController {
  constructor(private readonly espelho: EspelhoService) {}

  @Get('espelho')
  @RequirePermissions('dashboard.ver')
  async periodo(@CurrentUser() user: JwtUser, @Query('de') de?: string, @Query('ate') ate?: string): Promise<RespostaDoEspelho> {
    const p = intervalo(de, ate);
    await this.espelho.garantirRotinas(user.orgId);
    return this.espelho.periodo(user.orgId, p.de, p.ate, { actorId: user.sub, comDescricao: true });
  }

  @Get('sincronia')
  @RequirePermissions('dashboard.ver')
  sincronia(@CurrentUser() user: JwtUser): Promise<EstadoDaSincronia> {
    return this.espelho.estado(user.orgId);
  }

  @Get('livre-ocupado')
  @RequirePermissions('dashboard.ver')
  async livreOcupado(
    @CurrentUser() user: JwtUser,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
  ): Promise<RespostaDoLivreOcupadoDaTela> {
    const p = intervalo(de, ate, 90);
    const pessoais = await this.espelho.agendasPessoais(user.orgId);
    const resposta: RespostaDoLivreOcupadoDaTela = { de: p.de.toISOString(), ate: p.ate.toISOString(), pessoas: [] };
    if (pessoais.size === 0) return resposta;
    const motivo = await this.espelho.motivoParaNaoLer(user.orgId, 'comunicacao.agenda.livre_ocupado');
    if (motivo) {
      resposta.pessoas = [...pessoais.values()].map((nome) => ({ nome, ocupado: [], erro: motivo }));
      return resposta;
    }
    const r = await this.espelho.lerLivreOcupado(user.orgId, [...pessoais.keys()], p.de, p.ate, user.sub, ActorType.user);
    const erros = new Map(r.erros.map((e) => [e.agenda, e.motivo]));
    resposta.pessoas = [...pessoais].map(([agenda, nome]) => ({
      nome,
      ocupado: r.intervalos.filter((i) => i.agenda === agenda).map((i) => ({ inicio: i.inicio, fim: i.fim })),
      erro: erros.get(agenda) ?? null,
    }));
    return resposta;
  }

  @Post('sincronia/agora')
  @HttpCode(200)
  @RequirePermissions('agenda.editar')
  async agora(@CurrentUser() user: JwtUser): Promise<RespostaDaSincroniaAgora> {
    await this.espelho.garantirRotinas(user.orgId);
    let resultado: ResultadoDaRotina;
    try {
      resultado = await this.espelho.passagem(user.orgId, new Date());
    } catch (e) {
      resultado = { status: 'erro', resumo: (e as Error).message.slice(0, 300) };
    }
    return { resultado, sincronia: await this.espelho.estado(user.orgId) };
  }
}
