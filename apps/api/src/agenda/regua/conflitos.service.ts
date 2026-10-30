import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AGENDA_FUSO,
  PROPRIEDADES_DO_OS,
  instanteNoFuso,
  partesNoFuso,
  somarDias,
  type EventoDaAgenda,
  type RelatorioDaAgenda,
  type RespostaDosConflitos,
  type SocioDaAgenda,
  type TipoDeConflito,
} from '@mktos/shared';

import { exigirTenant } from '../../common/contexto-execucao';
import { PrismaService } from '../../prisma/prisma.service';
import { OPCAO_NAO_E_REUNIAO } from '../vigia-da-agenda';
import { SLUG_DA_ROTINA_DO_VIGIA } from '../vigia-da-agenda.service';
import { contarConflitos, montarConflitos, type ItemDoVigiaNosConflitos } from './conflitos';
import { montarRelatorio } from './relatorios';
import { ReguaService } from './regua.service';

/*
 * OS CONFLITOS E OS RELATÓRIOS NO SERVIDOR (agenda v2, 29/10/2026, lane G5).
 *
 * Lê o espelho (pela `ReguaService`, que lê do `EspelhoService`), as regras e o
 * que o vigia AG-01 deixou aberto (`AgendaConferencia` em `proposta` ou
 * `pendencia`, a mesma lista que `GET /agenda/fora-do-padrao` mostra; o vigia
 * não é reescrito nem chamado: só lido), e entrega à parte pura
 * (`conflitos.ts`, `relatorios.ts`). Nada aqui escreve: o botão de cada cartão
 * manda o pedido pronto a `POST /agenda/escritas` (lane D).
 */

const DIA_MS = 24 * 3600_000;
const ABERTOS = ['proposta', 'pendencia'] as const;

const lerProblemas = (v: Prisma.JsonValue): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

const lerProps = (v: Prisma.JsonValue): Record<string, string> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) as Record<string, string>;
};

/** A pendência oferece "não é reunião"? (as opções gravadas pelo vigia). */
const temNaoEReuniao = (opcoes: Prisma.JsonValue): boolean =>
  Array.isArray(opcoes) && opcoes.some((o) => !!o && typeof o === 'object' && (o as { chave?: unknown }).chave === OPCAO_NAO_E_REUNIAO);

@Injectable()
export class ConflitosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regua: ReguaService,
  ) {}

  /** As propriedades privadas que o evento não trouxe, lidas da coluna do espelho. */
  private async propriedades(orgId: string, eventos: readonly EventoDaAgenda[]): Promise<Map<string, Record<string, string>>> {
    const faltam = eventos.filter((e) => e.propriedades === undefined && e.origem === 'google').map((e) => e.id);
    if (!faltam.length) return new Map();
    const linhas = await this.prisma.agendaEvento.findMany({
      where: { orgId, origem: 'google', googleId: { in: faltam } },
      select: { googleId: true, propriedades: true },
    });
    return new Map(linhas.map((l) => [l.googleId, lerProps(l.propriedades)]));
  }

  private async doVigia(orgId: string): Promise<{ itens: ItemDoVigiaNosConflitos[]; passouEm: string | null }> {
    const [linhas, rotina] = await Promise.all([
      this.prisma.agendaConferencia.findMany({
        where: { orgId, estado: { in: [...ABERTOS] } },
        orderBy: [{ inicio: 'asc' }, { criadoEm: 'asc' }],
        take: 200,
      }),
      this.prisma.rotina.findUnique({ where: { orgId_slug: { orgId, slug: SLUG_DA_ROTINA_DO_VIGIA } }, select: { ultimaExecucaoEm: true } }),
    ]);
    const ids = linhas.map((l) => l.pendenciaId).filter((x): x is string => !!x);
    const pendencias = new Map(
      ids.length
        ? (await this.prisma.pendencia.findMany({ where: { orgId, id: { in: ids }, estado: 'aberta' }, select: { id: true, opcoes: true } })).map((p) => [p.id, p])
        : [],
    );
    return {
      passouEm: rotina?.ultimaExecucaoEm?.toISOString() ?? null,
      itens: linhas.map((l) => {
        const p = l.pendenciaId ? pendencias.get(l.pendenciaId) : undefined;
        return {
          eventoId: l.eventoId,
          tituloAtual: l.tituloLido,
          inicio: l.inicio?.toISOString() ?? null,
          estado: l.estado as 'proposta' | 'pendencia',
          problemas: lerProblemas(l.problemas),
          tituloProposto: l.tituloProposto,
          adicionarMeet: l.adicionarMeet,
          pendenciaId: p ? p.id : null,
          opcaoNaoEReuniao: p && temNaoEReuniao(p.opcoes) ? OPCAO_NAO_E_REUNIAO : null,
        };
      }),
    };
  }

  /** `GET /agenda/conflitos?dias=60&tipo=&socio=` */
  async conflitos(
    orgIdBruto: string,
    filtro: { dias?: number; tipo?: TipoDeConflito; socio?: SocioDaAgenda } = {},
    agora: Date = new Date(),
  ): Promise<RespostaDosConflitos> {
    const orgId = exigirTenant(orgIdBruto, 'ConflitosService.conflitos');
    const dias = Math.min(Math.max(filtro.dias ?? 60, 1), 120);
    const [regras, eventos, vigia] = await Promise.all([
      this.regua.regras(orgId),
      this.regua.eventos(orgId, new Date(agora.getTime() - DIA_MS), new Date(agora.getTime() + (dias + 1) * DIA_MS)),
      this.doVigia(orgId),
    ]);
    const propriedades = await this.propriedades(orgId, eventos);
    const todos = montarConflitos({ orgId, eventos, regras, agora, dias, vigia: vigia.itens, propriedades });
    const doSocio = filtro.socio ? todos.filter((c) => c.pessoas.includes(filtro.socio!)) : todos;
    return {
      cartoes: filtro.tipo ? doSocio.filter((c) => c.tipo === filtro.tipo) : doSocio,
      vigiaPassouEm: vigia.passouEm,
      contagem: contarConflitos(doSocio),
    };
  }

  /** `GET /agenda/relatorios?de=&ate=` (dias `AAAA-MM-DD` inclusivos; padrão: o mês corrente). */
  async relatorios(orgIdBruto: string, periodo: { de?: string; ate?: string } = {}, agora: Date = new Date()): Promise<RelatorioDaAgenda> {
    const orgId = exigirTenant(orgIdBruto, 'ConflitosService.relatorios');
    const hoje = partesNoFuso(agora, AGENDA_FUSO).dia;
    const de = periodo.de ?? `${hoje.slice(0, 7)}-01`;
    const ate = periodo.ate ?? somarDias(`${somarDias(`${hoje.slice(0, 7)}-28`, 4).slice(0, 7)}-01`, -1);
    const desde = instanteNoFuso(de, '00:00', AGENDA_FUSO);
    const ateExclusivo = instanteNoFuso(somarDias(ate, 1), '00:00', AGENDA_FUSO);
    if (ateExclusivo.getTime() - desde.getTime() > 400 * DIA_MS) {
      // Um ano e pouco por leitura: o espelho guarda -30 a +180 dias, o resto viria vazio.
      throw new BadRequestException('Até um ano por relatório.');
    }
    const [regras, todos] = await Promise.all([this.regua.regras(orgId), this.regua.eventos(orgId, desde, ateExclusivo)]);
    const eventos = todos.filter((e) => new Date(e.inicio).getTime() >= desde.getTime() && new Date(e.inicio).getTime() < ateExclusivo.getTime());
    const propriedades = await this.propriedades(orgId, eventos);
    const pedidos = new Set<string>();
    for (const e of eventos) {
      const id = (e.propriedades ?? propriedades.get(e.id) ?? {})[PROPRIEDADES_DO_OS.pedidoPor];
      if (id) pedidos.add(id);
    }
    const nomes = new Map(
      pedidos.size
        ? (await this.prisma.user.findMany({ where: { orgId, id: { in: [...pedidos] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])
        : [],
    );
    return montarRelatorio({ de, ate, eventos, pessoas: regras.pessoas, propriedades, nomes });
  }
}
