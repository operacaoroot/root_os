import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import type {
  CompromissoProposto,
  DiaLivre,
  FeriadoDaAgenda,
  RegraDaPessoa,
  RegraEmTexto,
  RegrasDaAgenda,
  RelatorioDaAgenda,
  RespostaDosConflitos,
  ResultadoDaRegua,
  RitoDaAgenda,
} from '@mktos/shared';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../../auth/current-user.decorator';
import { AcessoAtualGuard } from '../../memory/acesso-atual.guard';
import { ConflitosService } from './conflitos.service';
import { ReguaService } from './regua.service';
import {
  ConflitosQuerySchema,
  FeriadoAlterarSchema,
  FeriadoCriarSchema,
  LivresQuerySchema,
  PessoaAlterarSchema,
  PropostaSchema,
  RelatorioQuerySchema,
  RitoAlterarSchema,
  TextoAlterarSchema,
  TextoCriarSchema,
} from './regua.schemas';

/** O id de uma linha das regras (uuid). */
const ID = /^[0-9a-f-]{36}$/i;
const id = (v: string): string => {
  if (!ID.test(v ?? '')) throw new NotFoundException('Não achei essa regra.');
  return v;
};

/**
 * A RÉGUA, OS CONFLITOS E OS RELATÓRIOS DA AGENDA (agenda v2, 29/10/2026, lanes G2 e G5).
 *
 * Ler é de quem vê a agenda (`dashboard.ver`, a mesma de `/agenda`):
 *   `GET  /api/agenda/regras`                 → `RegrasDaAgenda` (`podeEditar` = tem `agenda.regras`)
 *   `POST /api/agenda/regua/avaliar`          → `ResultadoDaRegua` (corpo: `CompromissoProposto`)
 *   `GET  /api/agenda/livres?socio=&tipo=&modalidade=&duracao=&de=&ate=` → `DiaLivre[]`
 *   `GET  /api/agenda/conflitos?dias=60&tipo=&socio=` → `RespostaDosConflitos`
 *   `GET  /api/agenda/relatorios?de=&ate=`    → `RelatorioDaAgenda`
 *
 * Escrever regra é só de sócio (`agenda.regras`, relida no banco pelo
 * `AcessoAtualGuard`, porque a permissão viaja no token) e fica na auditoria:
 *   `PUT  /api/agenda/regras/pessoa/:id`, `PUT /api/agenda/ritos/:id`,
 *   `POST /api/agenda/feriados` (municipal), `PUT /api/agenda/feriados/:id` (ligar/desligar),
 *   `POST /api/agenda/regras-texto`, `PUT /api/agenda/regras-texto/:id`.
 * Nada aqui apaga.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agenda')
export class ReguaController {
  constructor(
    private readonly regua: ReguaService,
    private readonly conflitosSvc: ConflitosService,
  ) {}

  @Get('regras')
  @RequirePermissions('dashboard.ver')
  regras(@CurrentUser() u: JwtUser): Promise<RegrasDaAgenda> {
    return this.regua.regras(u.orgId, { podeEditar: (u.permissions ?? []).includes('agenda.regras') });
  }

  @Put('regras/pessoa/:id')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('agenda.regras')
  pessoa(@CurrentUser() u: JwtUser, @Param('id') idDaLinha: string, @Body() corpo: unknown): Promise<RegraDaPessoa> {
    return this.regua.alterarPessoa(u.orgId, { id: u.sub }, id(idDaLinha), PessoaAlterarSchema.parse(corpo));
  }

  @Put('ritos/:id')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('agenda.regras')
  rito(@CurrentUser() u: JwtUser, @Param('id') idDaLinha: string, @Body() corpo: unknown): Promise<RitoDaAgenda> {
    return this.regua.alterarRito(u.orgId, { id: u.sub }, id(idDaLinha), RitoAlterarSchema.parse(corpo));
  }

  @Post('feriados')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('agenda.regras')
  criarFeriado(@CurrentUser() u: JwtUser, @Body() corpo: unknown): Promise<FeriadoDaAgenda> {
    return this.regua.criarFeriado(u.orgId, { id: u.sub }, FeriadoCriarSchema.parse(corpo));
  }

  @Put('feriados/:id')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('agenda.regras')
  feriado(@CurrentUser() u: JwtUser, @Param('id') idDaLinha: string, @Body() corpo: unknown): Promise<FeriadoDaAgenda> {
    return this.regua.alterarFeriado(u.orgId, { id: u.sub }, id(idDaLinha), FeriadoAlterarSchema.parse(corpo));
  }

  @Post('regras-texto')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('agenda.regras')
  criarTexto(@CurrentUser() u: JwtUser, @Body() corpo: unknown): Promise<RegraEmTexto> {
    return this.regua.criarTexto(u.orgId, { id: u.sub }, TextoCriarSchema.parse(corpo));
  }

  @Put('regras-texto/:id')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('agenda.regras')
  texto(@CurrentUser() u: JwtUser, @Param('id') idDaLinha: string, @Body() corpo: unknown): Promise<RegraEmTexto> {
    return this.regua.alterarTexto(u.orgId, { id: u.sub }, id(idDaLinha), TextoAlterarSchema.parse(corpo));
  }

  @Post('regua/avaliar')
  @HttpCode(200)
  @RequirePermissions('dashboard.ver')
  avaliar(@CurrentUser() u: JwtUser, @Body() corpo: unknown): Promise<ResultadoDaRegua> {
    return this.regua.avaliar(u.orgId, PropostaSchema.parse(corpo) as CompromissoProposto);
  }

  @Get('livres')
  @RequirePermissions('dashboard.ver')
  livres(@CurrentUser() u: JwtUser, @Query() q: Record<string, string>): Promise<DiaLivre[]> {
    const p = LivresQuerySchema.parse(q);
    return this.regua.livres(u.orgId, { socio: p.socio, tipo: p.tipo, modalidade: p.modalidade, duracaoMin: p.duracao, de: p.de, ate: p.ate });
  }

  @Get('conflitos')
  @RequirePermissions('dashboard.ver')
  conflitos(@CurrentUser() u: JwtUser, @Query() q: Record<string, string>): Promise<RespostaDosConflitos> {
    return this.conflitosSvc.conflitos(u.orgId, ConflitosQuerySchema.parse(q));
  }

  @Get('relatorios')
  @RequirePermissions('dashboard.ver')
  relatorios(@CurrentUser() u: JwtUser, @Query() q: Record<string, string>): Promise<RelatorioDaAgenda> {
    return this.conflitosSvc.relatorios(u.orgId, RelatorioQuerySchema.parse(q));
  }
}
