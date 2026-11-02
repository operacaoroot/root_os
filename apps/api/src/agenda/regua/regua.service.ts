import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ActorType, Prisma, type AgendaRegraPessoa, type AgendaRito, type Feriado, type AgendaRegraTexto } from '@prisma/client';
import {
  AGENDA_FUSO,
  SOCIOS_DA_AGENDA,
  avaliarNaRegua,
  horariosLivres,
  instanteNoFuso,
  somarDias,
  type BloqueioFixo,
  type CompromissoProposto,
  type DiaLivre,
  type EventoDaAgenda,
  type FeriadoDaAgenda,
  type RegraDaPessoa,
  type RegraEmTexto,
  type RegrasDaAgenda,
  type ResultadoDaRegua,
  type RitoDaAgenda,
  type SocioDaAgenda,
  type TipoDeFeriado,
} from '@mktos/shared';

import { exigirTenant } from '../../common/contexto-execucao';
import { PrismaService } from '../../prisma/prisma.service';
import { ehEmpresaDaCasa } from '../../tenants/empresa-da-casa';
import { EspelhoService } from '../espelho/espelho.service';
import {
  SEMENTE_DAS_PESSOAS,
  SEMENTE_DOS_RITOS,
  SEMENTE_DOS_TEXTOS,
  sementeDosFeriados,
  usuarioDoSocio,
} from './regua-semente';
import type { FeriadoCriar, PessoaAlterar, RitoAlterar } from './regua.schemas';

/*
 * A RÉGUA NO SERVIDOR (agenda v2, 29/10/2026, lane G2).
 *
 * As regras da casa (`AgendaRegraPessoa`, `AgendaRito`, `Feriado`,
 * `AgendaRegraTexto`, semeadas na primeira leitura da empresa da casa) e o
 * MESMO motor puro da tela (`avaliarNaRegua`, `horariosLivres` em
 * `packages/shared/src/agenda-regua.ts`) sobre os eventos do espelho.
 *
 * Escrever regra exige `agenda.regras` (o controller confere, relida no banco) e
 * vira linha de auditoria com o antes e o depois. Nada aqui apaga: feriado e
 * regra em frase se desligam, não somem. O motor NÃO interpreta as regras em
 * frase: elas são guardadas e listadas (o vigia AG-01 é quem as lê).
 */

/** Quem escreve: a pessoa da sessão. */
export interface QuemEscreve {
  id: string;
}

const ehSocio = (v: string | null | undefined): v is SocioDaAgenda => (SOCIOS_DA_AGENDA as readonly string[]).includes(v ?? '');

const lerBloqueios = (v: Prisma.JsonValue): BloqueioFixo[] =>
  Array.isArray(v)
    ? v.flatMap((b) => {
        const o = (b ?? {}) as Record<string, unknown>;
        if (typeof o.diaDaSemana !== 'number' || typeof o.inicio !== 'string') return [];
        return [{ diaDaSemana: o.diaDaSemana, inicio: o.inicio, fim: typeof o.fim === 'string' ? o.fim : null }];
      })
    : [];

const paraPessoa = (r: AgendaRegraPessoa, email: string | null): RegraDaPessoa => ({
  id: r.id,
  nome: r.nome as SocioDaAgenda,
  area: r.area,
  email,
  janela: { inicio: r.janelaInicio, fim: r.janelaFim },
  intervaloMin: r.intervaloMin,
  trajetoMin: r.trajetoMin,
  tetoPorDia: r.tetoPorDia,
  bloqueiosFixos: lerBloqueios(r.bloqueiosFixos),
  emailPessoal: r.emailPessoal,
  fechadoLigado: r.fechadoLigado,
  substituto: ehSocio(r.substituto) ? r.substituto : null,
});

const paraRito = (r: AgendaRito): RitoDaAgenda => ({
  id: r.id,
  nome: r.nome,
  titulo: r.titulo,
  diaDaSemana: r.diaDaSemana,
  ordinalNoMes: r.ordinalNoMes,
  inicio: r.inicio,
  duracaoMin: r.duracaoMin,
  quem: r.quem,
  politica: r.politica === 'bloqueia' ? 'bloqueia' : 'pergunta',
  ligado: r.ligado,
  aDecidir: r.aDecidir,
});

const paraFeriado = (f: Feriado): FeriadoDaAgenda => ({
  id: f.id,
  data: f.data,
  nome: f.nome,
  tipo: f.tipo as TipoDeFeriado,
  cidade: f.cidade,
  ligado: f.ligado,
});

const paraTexto = (t: AgendaRegraTexto): RegraEmTexto => ({ id: t.id, frase: t.frase, ligada: t.ligada });

const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

/** Os dias, à volta de um intervalo, que a régua precisa ler (o trajeto e o intervalo olham o vizinho). */
const DIA_MS = 24 * 3600_000;

@Injectable()
export class ReguaService {
  private readonly log = new Logger('ReguaDaAgenda');
  private readonly semeadas = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly espelho: EspelhoService,
  ) {}

  /** A empresa é a da casa? A mesma pergunta do vigia (`tenants/empresa-da-casa.ts`). */
  protected ehDaCasa(orgId: string): Promise<boolean> {
    return ehEmpresaDaCasa(this.prisma, orgId);
  }

  // ------------------------------------------------------------------ semente

  /**
   * Semeia as regras da casa (idempotente, uma vez por processo e empresa).
   * Só na empresa da casa. Nunca sobrescreve: o que existe pela chave única
   * (pessoa pelo nome, rito pelo nome, feriado pela data e nome) fica como está;
   * as regras em frase só nascem quando a empresa não tem nenhuma.
   */
  async garantirSemente(orgId: string): Promise<void> {
    if (!orgId || this.semeadas.has(orgId)) return;
    if (!(await this.ehDaCasa(orgId))) return;
    const usuarios = await this.prisma.user.findMany({ where: { orgId, isActive: true }, select: { id: true, name: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agenda-regras:${orgId}`}))`;
      await tx.agendaRegraPessoa.createMany({
        data: SEMENTE_DAS_PESSOAS.map((p) => ({
          orgId,
          nome: p.nome,
          area: p.area,
          userId: usuarioDoSocio(p.nome, usuarios)?.id ?? null,
          janelaInicio: p.janelaInicio,
          janelaFim: p.janelaFim,
          intervaloMin: p.intervaloMin,
          trajetoMin: p.trajetoMin,
          tetoPorDia: p.tetoPorDia,
          bloqueiosFixos: json(p.bloqueiosFixos),
          emailPessoal: null,
          fechadoLigado: p.fechadoLigado,
          substituto: p.substituto,
          ordem: p.ordem,
        })),
        skipDuplicates: true,
      });
      await tx.agendaRito.createMany({ data: SEMENTE_DOS_RITOS.map((r) => ({ orgId, ...r })), skipDuplicates: true });
      await tx.feriado.createMany({
        data: sementeDosFeriados().map((f) => ({ orgId, data: f.data, nome: f.nome, tipo: f.tipo, ligado: f.ligado, cidade: null })),
        skipDuplicates: true,
      });
      if ((await tx.agendaRegraTexto.count({ where: { orgId } })) === 0) {
        await tx.agendaRegraTexto.createMany({ data: SEMENTE_DOS_TEXTOS.map((t) => ({ orgId, ...t })) });
      }
    });
    this.semeadas.add(orgId);
  }

  // ------------------------------------------------------------------ leitura

  async regras(orgIdBruto: string, opcoes: { podeEditar?: boolean } = {}): Promise<RegrasDaAgenda> {
    const orgId = exigirTenant(orgIdBruto, 'ReguaService.regras');
    try {
      await this.garantirSemente(orgId);
    } catch (e) {
      // A leitura nunca cai pela semente: mostra o que houver e tenta de novo na próxima.
      this.log.warn(`empresa ${orgId}: não semeei as regras da agenda: ${(e as Error).message}`);
    }
    const [pessoas, ritos, feriados, textos] = await Promise.all([
      this.prisma.agendaRegraPessoa.findMany({ where: { orgId }, orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] }),
      this.prisma.agendaRito.findMany({ where: { orgId }, orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] }),
      this.prisma.feriado.findMany({ where: { orgId }, orderBy: [{ data: 'asc' }, { nome: 'asc' }] }),
      this.prisma.agendaRegraTexto.findMany({ where: { orgId }, orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }] }),
    ]);
    const ids = pessoas.map((p) => p.userId).filter((x): x is string => !!x);
    const emails = new Map(
      ids.length
        ? (await this.prisma.user.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, email: true } })).map((u) => [u.id, u.email])
        : [],
    );
    return {
      pessoas: pessoas.filter((p) => ehSocio(p.nome)).map((p) => paraPessoa(p, (p.userId && emails.get(p.userId)) || null)),
      ritos: ritos.map(paraRito),
      feriados: feriados.map(paraFeriado),
      textos: textos.map(paraTexto),
      podeEditar: opcoes.podeEditar === true,
    };
  }

  /** Os eventos do espelho de um intervalo (o próprio espelho decide se cai na leitura direta). */
  async eventos(orgId: string, de: Date, ate: Date): Promise<EventoDaAgenda[]> {
    const r = await this.espelho.periodo(orgId, de, ate);
    return r.eventos;
  }

  /** O semáforo de um compromisso, com os eventos do espelho em volta. */
  async avaliar(orgIdBruto: string, proposta: CompromissoProposto, agora: Date = new Date()): Promise<ResultadoDaRegua> {
    const orgId = exigirTenant(orgIdBruto, 'ReguaService.avaliar');
    const ini = new Date(proposta.inicio).getTime();
    const fim = new Date(proposta.fim).getTime();
    if (!Number.isFinite(ini) || !Number.isFinite(fim)) throw new BadRequestException('Início e fim em ISO 8601.');
    const [regras, eventos] = await Promise.all([
      this.regras(orgId),
      this.eventos(orgId, new Date(ini - DIA_MS), new Date(fim + DIA_MS)),
    ]);
    return avaliarNaRegua({ eventos, regras, proposta, agora });
  }

  /** Os horários verdes que o link público mostra. Nunca título, nunca quem. */
  async livres(
    orgIdBruto: string,
    pedido: { socio: SocioDaAgenda; tipo: 'cliente' | 'interna'; modalidade: 'online' | 'presencial'; duracaoMin: number; de: string; ate: string },
    agora: Date = new Date(),
  ): Promise<DiaLivre[]> {
    const orgId = exigirTenant(orgIdBruto, 'ReguaService.livres');
    if (pedido.ate < pedido.de) return [];
    const de = instanteNoFuso(somarDias(pedido.de, -1), '00:00', AGENDA_FUSO);
    const ate = instanteNoFuso(somarDias(pedido.ate, 2), '00:00', AGENDA_FUSO);
    if (ate.getTime() - de.getTime() > 70 * DIA_MS) throw new BadRequestException('Até 62 dias por leitura.');
    const [regras, eventos] = await Promise.all([this.regras(orgId), this.eventos(orgId, de, ate)]);
    return horariosLivres({ eventos, regras, socio: pedido.socio, tipo: pedido.tipo, modalidade: pedido.modalidade, duracaoMin: pedido.duracaoMin, de: pedido.de, ate: pedido.ate, agora });
  }

  // ------------------------------------------------------------------ escrita (agenda.regras)

  /** Grava e audita na mesma transação; 404 quando a linha não é desta empresa. */
  private async auditar(
    tx: Prisma.TransactionClient,
    orgId: string,
    quem: QuemEscreve,
    action: string,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        orgId,
        actorType: ActorType.user,
        actorId: quem.id,
        action,
        entityType,
        entityId,
        before: before == null ? Prisma.JsonNull : json(before),
        after: after == null ? Prisma.JsonNull : json(after),
        metadata: json({ origem: 'agenda.regras' }),
      },
    });
  }

  async alterarPessoa(orgIdBruto: string, quem: QuemEscreve, id: string, dados: PessoaAlterar): Promise<RegraDaPessoa> {
    const orgId = exigirTenant(orgIdBruto, 'ReguaService.alterarPessoa');
    const linha = await this.prisma.$transaction(async (tx) => {
      const antes = await tx.agendaRegraPessoa.findFirst({ where: { id, orgId } });
      if (!antes) throw new NotFoundException('Essa regra de sócio não existe nesta empresa.');
      if (dados.substituto && dados.substituto === antes.nome) throw new BadRequestException('O substituto é outro sócio.');
      const data: Prisma.AgendaRegraPessoaUpdateInput = {
        ...(dados.area !== undefined ? { area: dados.area || null } : {}),
        ...(dados.janela ? { janelaInicio: dados.janela.inicio, janelaFim: dados.janela.fim } : {}),
        ...(dados.intervaloMin !== undefined ? { intervaloMin: dados.intervaloMin } : {}),
        ...(dados.trajetoMin !== undefined ? { trajetoMin: dados.trajetoMin } : {}),
        ...(dados.tetoPorDia !== undefined ? { tetoPorDia: dados.tetoPorDia } : {}),
        ...(dados.bloqueiosFixos ? { bloqueiosFixos: json(dados.bloqueiosFixos.map((b) => ({ diaDaSemana: b.diaDaSemana, inicio: b.inicio, fim: b.fim ?? null }))) } : {}),
        ...(dados.emailPessoal !== undefined ? { emailPessoal: dados.emailPessoal || null } : {}),
        ...(dados.fechadoLigado !== undefined ? { fechadoLigado: dados.fechadoLigado } : {}),
        ...(dados.substituto !== undefined ? { substituto: dados.substituto } : {}),
      };
      const depois = await tx.agendaRegraPessoa.update({ where: { id: antes.id }, data });
      await this.auditar(tx, orgId, quem, 'agenda.regras.pessoa', 'agenda_regra_pessoa', antes.id, semId(antes), semId(depois));
      return depois;
    });
    const email = linha.userId
      ? (await this.prisma.user.findFirst({ where: { orgId, id: linha.userId }, select: { email: true } }))?.email ?? null
      : null;
    return paraPessoa(linha, email);
  }

  async alterarRito(orgIdBruto: string, quem: QuemEscreve, id: string, dados: RitoAlterar): Promise<RitoDaAgenda> {
    const orgId = exigirTenant(orgIdBruto, 'ReguaService.alterarRito');
    return this.prisma.$transaction(async (tx) => {
      const antes = await tx.agendaRito.findFirst({ where: { id, orgId } });
      if (!antes) throw new NotFoundException('Esse rito não existe nesta empresa.');
      // Salvar o horário é confirmá-lo: sai do `[a decidir]`, a menos que a pessoa diga o contrário.
      const aDecidir = dados.aDecidir ?? (dados.inicio !== undefined || dados.diaDaSemana !== undefined ? false : undefined);
      const { aDecidir: _a, ...resto } = dados;
      void _a;
      const depois = await tx.agendaRito.update({
        where: { id: antes.id },
        data: { ...resto, ...(aDecidir !== undefined ? { aDecidir } : {}) },
      });
      await this.auditar(tx, orgId, quem, 'agenda.regras.rito', 'agenda_rito', antes.id, semId(antes), semId(depois));
      return paraRito(depois);
    });
  }

  /** Feriado municipal: o único que se cadastra (nacional e facultativo vêm da semente). */
  async criarFeriado(orgIdBruto: string, quem: QuemEscreve, dados: FeriadoCriar): Promise<FeriadoDaAgenda> {
    const orgId = exigirTenant(orgIdBruto, 'ReguaService.criarFeriado');
    return this.prisma.$transaction(async (tx) => {
      const igual = await tx.feriado.findFirst({ where: { orgId, data: dados.data, nome: dados.nome } });
      if (igual) return paraFeriado(igual);
      const f = await tx.feriado.create({
        data: { orgId, data: dados.data, nome: dados.nome, tipo: 'municipal', cidade: dados.cidade, ligado: dados.ligado ?? true },
      });
      await this.auditar(tx, orgId, quem, 'agenda.regras.feriado_criado', 'feriado', f.id, null, semId(f));
      return paraFeriado(f);
    });
  }

  async alterarFeriado(orgIdBruto: string, quem: QuemEscreve, id: string, dados: { ligado: boolean }): Promise<FeriadoDaAgenda> {
    const orgId = exigirTenant(orgIdBruto, 'ReguaService.alterarFeriado');
    return this.prisma.$transaction(async (tx) => {
      const antes = await tx.feriado.findFirst({ where: { id, orgId } });
      if (!antes) throw new NotFoundException('Esse feriado não existe nesta empresa.');
      const depois = await tx.feriado.update({ where: { id: antes.id }, data: { ligado: dados.ligado } });
      await this.auditar(tx, orgId, quem, 'agenda.regras.feriado', 'feriado', antes.id, { ligado: antes.ligado }, { ligado: depois.ligado });
      return paraFeriado(depois);
    });
  }

  async criarTexto(orgIdBruto: string, quem: QuemEscreve, dados: { frase: string; ligada?: boolean }): Promise<RegraEmTexto> {
    const orgId = exigirTenant(orgIdBruto, 'ReguaService.criarTexto');
    return this.prisma.$transaction(async (tx) => {
      const ordem = await tx.agendaRegraTexto.count({ where: { orgId } });
      const t = await tx.agendaRegraTexto.create({ data: { orgId, frase: dados.frase, ligada: dados.ligada ?? true, ordem } });
      await this.auditar(tx, orgId, quem, 'agenda.regras.texto_criado', 'agenda_regra_texto', t.id, null, { frase: t.frase, ligada: t.ligada });
      return paraTexto(t);
    });
  }

  async alterarTexto(orgIdBruto: string, quem: QuemEscreve, id: string, dados: { frase?: string; ligada?: boolean }): Promise<RegraEmTexto> {
    const orgId = exigirTenant(orgIdBruto, 'ReguaService.alterarTexto');
    return this.prisma.$transaction(async (tx) => {
      const antes = await tx.agendaRegraTexto.findFirst({ where: { id, orgId } });
      if (!antes) throw new NotFoundException('Essa regra em frase não existe nesta empresa.');
      const depois = await tx.agendaRegraTexto.update({
        where: { id: antes.id },
        data: { ...(dados.frase !== undefined ? { frase: dados.frase } : {}), ...(dados.ligada !== undefined ? { ligada: dados.ligada } : {}) },
      });
      await this.auditar(tx, orgId, quem, 'agenda.regras.texto', 'agenda_regra_texto', antes.id, { frase: antes.frase, ligada: antes.ligada }, { frase: depois.frase, ligada: depois.ligada });
      return paraTexto(depois);
    });
  }
}

/** O retrato de uma linha para a auditoria, sem os carimbos de banco. */
function semId<T extends { orgId: string; criadoEm: Date; atualizadoEm: Date }>(linha: T): Omit<T, 'orgId' | 'criadoEm' | 'atualizadoEm'> {
  const { orgId: _o, criadoEm: _c, atualizadoEm: _a, ...resto } = linha;
  void _o; void _c; void _a;
  return resto;
}
