import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AgentEstado,
  ContextSource,
  OnboardingFase,
  Prisma,
  RiskLevel,
  type OnboardingConvite,
  type OnboardingItem,
  type OnboardingTrilho,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';

import { CHAVE_DO_RETRATO, ROSTER_DO_ONBOARDING, precisaSemear, semearRoster } from '../../agents/roster';
import { comContexto, contextoAtual, novaCorrelacao } from '../../common/contexto-execucao';
import { EventLogService } from '../../gateway/event-log.service';
import { MemoriaService } from '../../memory/memoria.service';
import { proximaOcorrencia } from '../../pauta/cron';
import { PrismaService } from '../../prisma/prisma.service';
import { LIVRE } from '../../routines/rotina.tipos';
import { ProvisionamentoService } from '../../tenants/provisionar.service';
import { comSufixo, slugDaEmpresa } from '../cadastro';
import { espelharNoIndice } from '../indice';
import {
  aceitaEscrita,
  cifrarToken,
  decifrarToken,
  estadoDoConvite,
  gerarToken,
  linkDoConvite,
  validoAte,
  type EstadoDoConvite,
} from './convite';
import { folhaDeReuniao, type Dossie } from './dossie';
import {
  ROTULO_DO_NIVEL,
  chaveDaNotaDaEspinha,
  ehNivel,
  ehPerfil,
  obrigatorios,
  temaDaEspinha,
  temasDoBloco,
  temasDoConvite,
  type BlocosDoConvite,
  type Nivel,
  type TemaDaEspinha,
} from './espinha';
import {
  ROTULO_DA_FASE,
  itemRespondido,
  podeAvancar,
  portoesDaFase,
  type EstadoParaPortao,
  type PortaoNaTela,
  type Portoes,
} from './fases';
import type { PropostaDoLeitor } from './leitor-de-ata';
import {
  mensagemDeBoasVindas,
  mensagemDeCobrancaPessoal,
  mensagemDeLembrete,
  mensagemDoLinkA,
  mensagemDoLinkBCD,
  type ProximoPassoParaMensagem,
} from './mensagens';
import { RECEITAS, receita, type Receita } from './receitas';
import {
  N_DIAS_SEM_USO_PADRAO,
  pendencias as pendenciasDoRelogio,
  type ConviteParaRelogio,
  type Pendencia,
  type TrilhoParaRelogio,
} from './relogio';
import { montarRetratoDoTrilho, type RetratoDoTrilho } from './retrato-do-trilho';
import { montarRoteiro, type RoteiroDoKickoff } from './roteiro';
import { varrerSegredos } from './segredos';

/* ==========================================================================
 * O SERVIÇO DO TRILHO — a casca injetável do onboarding do cliente
 * ==========================================================================
 *
 * As decisões moram nos arquivos puros de `onboarding/trilho/` (espinha,
 * fases, convite, relógio, retrato…). Aqui entra o que o Nest sabe dar: o
 * banco, a memória (que grava nota com versão, procedência e RASTRO), o
 * provisionamento da empresa do cliente e o RASTRO dos marcos.
 *
 * TODA LEITURA E ESCRITA É DA EMPRESA QUE ENTREGA (a ROOT). A única vez em
 * que este serviço entra na casa do cliente é `carregarMemoria`, e ele abre o
 * contexto DAQUELA empresa para isso — como o provisionamento faz.
 */

export const TIPO_DA_ROTINA_DO_RELOGIO = 'onboarding.relogio';
export const SLUG_DA_ROTINA_DO_RELOGIO = 'onboarding-relogio';

export interface Quem {
  id: string | null;
  nome: string;
}

export interface NovoTrilho {
  cliente: string;
  contatoNome?: string | null;
  contatoWhatsapp?: string | null;
  contatoEmail?: string | null;
  perfil?: string | null;
  nivel?: string | null;
  receita?: string | null;
  conduzidoPor?: string | null;
  implantadoPor?: string | null;
  reuniaoEm?: string | null;
  cardId?: string | null;
  observacoes?: string | null;
}

export interface PatchDoTrilho {
  cliente?: string;
  contatoNome?: string | null;
  contatoWhatsapp?: string | null;
  contatoEmail?: string | null;
  perfil?: string | null;
  nivel?: string | null;
  receita?: string | null;
  conduzidoPor?: string | null;
  implantadoPor?: string | null;
  reuniaoEm?: string | null;
  kickoffEm?: string | null;
  imersaoEm?: string | null;
  grupoJid?: string | null;
  cardId?: string | null;
  empresaId?: string | null;
  proximoPasso?: string | null;
  proximoPassoDono?: string | null;
  proximoPassoEm?: string | null;
  observacoes?: string | null;
  /** `null` num portão APAGA o registro dele (o portão volta a não estar cumprido). */
  portoes?: PortoesPatch;
}

export type PortoesPatch = { [K in keyof Portoes]?: Portoes[K] | null };

export interface ItemNaBancada {
  temaId: string;
  bloco: string;
  titulo: string;
  pergunta: string;
  aprofundar: string;
  obrigatorio: boolean;
  formato: 'texto' | 'escolha';
  opcoes: string[] | null;
  ramo: string[] | null;
  origem: string;
  tipo: string;
  proposta: string | null;
  fonteMinuto: string | null;
  fonteTrecho: string | null;
  fonteNota: string | null;
  status: string;
  textoFinal: string | null;
  aprovadoPor: string | null;
  aprovadoEm: string | null;
  respondidoPor: string | null;
  respondidoEm: string | null;
  respondidoVia: string | null;
  notaId: string | null;
  carregadoEm: string | null;
}

export interface ConviteNaBancada {
  id: string;
  blocos: string;
  estado: EstadoDoConvite;
  validoAte: string;
  enviadoEm: string | null;
  lembradoEm: string | null;
  concluidoEm: string | null;
  revogadoEm: string | null;
  acessos: number;
  ultimoAcessoEm: string | null;
  /** O OS consegue reescrever o link (token cifrado guardado)? */
  temLink: boolean;
  criadoEm: string;
}

export interface MarcoNaBancada {
  id: string;
  tipo: string;
  texto: string;
  dados: Record<string, unknown>;
  quem: string | null;
  em: string;
}

export interface AtaNaBancada {
  id: string;
  fonte: string;
  referencia: string | null;
  caracteres: number;
  segredosRemovidos: number;
  modelo: string | null;
  custoUsd: number;
  custoEstimado: boolean;
  propostas: number;
  emBranco: number;
  erro: string | null;
  lidaPor: string | null;
  lidaEm: string;
}

export interface TrilhoResumo {
  id: string;
  cliente: string;
  slug: string;
  fase: OnboardingFase;
  faseRotulo: string;
  perfil: string | null;
  nivel: string | null;
  nivelRotulo: string | null;
  receita: string | null;
  contatoNome: string | null;
  conduzidoPor: string | null;
  implantadoPor: string | null;
  reuniaoEm: string | null;
  kickoffEm: string | null;
  imersaoEm: string | null;
  proximoPasso: string | null;
  proximoPassoDono: string | null;
  proximoPassoEm: string | null;
  empresaId: string | null;
  cardId: string | null;
  podeAvancar: boolean;
  faltando: string[];
  proxima: OnboardingFase | null;
  itens: { respondidos: number; obrigatorios: number; propostos: number; pendentesDeAprovacao: number };
  pendencias: number;
  criadoEm: string;
  atualizadoEm: string;
}

export interface TrilhoCompleto extends TrilhoResumo {
  contatoWhatsapp: string | null;
  contatoEmail: string | null;
  grupoJid: string | null;
  observacoes: string | null;
  portoes: Portoes;
  portoesNaTela: PortaoNaTela[];
  itens_: ItemNaBancada[];
  convites: ConviteNaBancada[];
  atas: AtaNaBancada[];
  marcos: MarcoNaBancada[];
  receitaDetalhe: Receita | null;
  dossie: Dossie | null;
  pendenciasDoRelogio: Pendencia[];
  receitas: { chave: string; nome: string; estado: string }[];
}

export interface ConviteGerado {
  conviteId: string;
  token: string;
  link: string;
  validoAte: string;
  mensagem: string;
  aprovadosPelaRegra: number;
}

const ISO = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

function dataOuNull(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`data inválida: ${v}`);
  return d;
}

function texto(v: string | null | undefined, max = 4000): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = String(v).trim();
  const letras = Array.from(t);
  return letras.length <= max ? t : letras.slice(0, max).join('');
}

@Injectable()
export class TrilhoService {
  private readonly log = new Logger('OnboardingTrilho');

  constructor(
    private readonly prisma: PrismaService,
    private readonly memoria: MemoriaService,
    private readonly eventos: EventLogService,
    private readonly provisionamento: ProvisionamentoService,
  ) {}

  // ==========================================================================
  // 0. GARANTIAS — o roster e a rotina existem para esta empresa
  // ==========================================================================

  /**
   * Idempotente e barato quando já está tudo lá (duas consultas). Roda na
   * listagem, pelo mesmo motivo de `garantirRoster` na entrada: conserto que
   * depende de alguém rodar comando não existe.
   */
  async garantir(orgId: string): Promise<void> {
    try {
      if (await precisaSemear(this.prisma, orgId, ROSTER_DO_ONBOARDING)) {
        const dono = await this.prisma.user.findFirst({
          where: { orgId },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        const resumo = await comContexto(
          {
            orgId,
            actorType: 'system',
            actorId: null,
            correlationId: contextoAtual()?.correlationId ?? novaCorrelacao('onboarding'),
            origem: contextoAtual()?.origem ?? 'http',
          },
          () => semearRoster(this.prisma, orgId, { donoId: dono?.id ?? null, roster: ROSTER_DO_ONBOARDING }),
        );
        if (resumo.criados.length) {
          this.log.log(`empresa ${orgId}: roster do onboarding semeado (${resumo.criados.join(', ')})`);
        }
      }
    } catch (e) {
      this.log.error(`empresa ${orgId}: não consegui semear o roster do onboarding: ${(e as Error).message}`);
    }

    try {
      const cron = '0 9 * * *';
      const tz = 'America/Sao_Paulo';
      await this.prisma.rotina.upsert({
        where: { orgId_slug: { orgId, slug: SLUG_DA_ROTINA_DO_RELOGIO } },
        create: {
          orgId,
          slug: SLUG_DA_ROTINA_DO_RELOGIO,
          nome: 'Relógio do onboarding',
          tipo: TIPO_DA_ROTINA_DO_RELOGIO,
          config: { nDiasSemUso: N_DIAS_SEM_USO_PADRAO } as Prisma.InputJsonValue,
          cron,
          tz,
          ativo: true,
          estado: AgentEstado.rodando,
          origem: 'manual',
          refExterna: null,
          agenteSlug: null,
          reservadoEm: LIVRE,
          reservadoAte: LIVRE,
          proximaExecucaoEm: proximaOcorrencia(cron, tz, new Date()),
        },
        update: {},
      });
    } catch (e) {
      this.log.error(`empresa ${orgId}: não consegui semear a rotina do relógio: ${(e as Error).message}`);
    }
  }

  // ==========================================================================
  // 1. O TRILHO
  // ==========================================================================

  async listar(orgId: string): Promise<TrilhoResumo[]> {
    await this.garantir(orgId);
    const trilhos = await this.prisma.onboardingTrilho.findMany({
      where: { orgId },
      orderBy: [{ fase: 'asc' }, { atualizadoEm: 'desc' }],
      include: { itens: true, convites: true, marcos: { orderBy: { em: 'desc' }, take: 60 } },
    });
    const pend = await this.pendenciasDe(orgId, trilhos);
    return trilhos.map((t) => this.resumo(t, t.itens, pend.filter((p) => p.trilhoId === t.id).length));
  }

  async criar(orgId: string, entrada: NovoTrilho, quem: Quem): Promise<TrilhoCompleto> {
    const cliente = String(entrada.cliente ?? '').trim();
    if (cliente.length < 2) throw new BadRequestException('o nome do cliente precisa de ao menos 2 caracteres.');
    if (entrada.perfil != null && entrada.perfil !== '' && !ehPerfil(entrada.perfil)) {
      throw new BadRequestException('perfil inválido: P1, P2, P3 ou nao-entra.');
    }
    if (entrada.nivel != null && entrada.nivel !== '' && !ehNivel(entrada.nivel)) {
      throw new BadRequestException('nível inválido: beaba, avancar-junto ou entregar-pronto.');
    }
    if (entrada.receita && !receita(entrada.receita)) throw new BadRequestException('receita desconhecida.');
    if (entrada.cardId) await this.exigirCartao(orgId, entrada.cardId);

    const base = slugDaEmpresa(cliente);
    let slug = base;
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      const existe = await this.prisma.onboardingTrilho.findUnique({
        where: { orgId_slug: { orgId, slug } },
        select: { id: true },
      });
      if (!existe) break;
      slug = comSufixo(base, randomBytes(2).toString('hex'));
    }

    const trilho = await this.prisma.onboardingTrilho.create({
      data: {
        orgId,
        cliente,
        slug,
        perfil: entrada.perfil || null,
        nivel: entrada.nivel || null,
        receita: entrada.receita || null,
        contatoNome: texto(entrada.contatoNome, 120) ?? null,
        contatoWhatsapp: texto(entrada.contatoWhatsapp, 40) ?? null,
        contatoEmail: texto(entrada.contatoEmail, 200) ?? null,
        conduzidoPor: texto(entrada.conduzidoPor, 120) ?? null,
        implantadoPor: texto(entrada.implantadoPor, 120) ?? null,
        reuniaoEm: dataOuNull(entrada.reuniaoEm) ?? null,
        cardId: entrada.cardId || null,
        observacoes: texto(entrada.observacoes, 4000) ?? null,
        criadoPor: quem.id,
      },
    });
    await this.marco(orgId, trilho.id, 'trilho.criado', `${cliente} entrou na esteira (fase 0 · Qualificar).`, {}, quem);
    return this.obter(orgId, trilho.id);
  }

  async obter(orgId: string, id: string): Promise<TrilhoCompleto> {
    const t = await this.prisma.onboardingTrilho.findFirst({
      where: { id, orgId },
      include: {
        itens: true,
        convites: { orderBy: { criadoEm: 'desc' } },
        atas: { orderBy: { lidaEm: 'desc' } },
        marcos: { orderBy: { em: 'desc' }, take: 200 },
      },
    });
    if (!t) throw new NotFoundException('trilho não encontrado.');
    const pend = await this.pendenciasDe(orgId, [t]);
    const estado = this.estadoParaPortao(t, t.itens);
    const nivel: Nivel | null = ehNivel(t.nivel) ? t.nivel : null;
    const temas = this.temasDoTrilho(nivel);
    const porTema = new Map(t.itens.map((i) => [i.temaId, i]));
    const dossieMarco = t.marcos.find((m) => m.tipo === 'dossie.gerado');

    return {
      ...this.resumo(t, t.itens, pend.length),
      contatoWhatsapp: t.contatoWhatsapp,
      contatoEmail: t.contatoEmail,
      grupoJid: t.grupoJid,
      observacoes: t.observacoes,
      portoes: (t.portoes ?? {}) as Portoes,
      portoesNaTela: portoesDaFase(estado),
      itens_: temas.map((tema) => this.itemNaBancada(tema, porTema.get(tema.id) ?? null)),
      convites: t.convites.map((c) => this.conviteNaBancada(c)),
      atas: t.atas.map((a) => ({
        id: a.id,
        fonte: a.fonte,
        referencia: a.referencia,
        caracteres: a.caracteres,
        segredosRemovidos: a.segredosRemovidos,
        modelo: a.modelo,
        custoUsd: Number(a.custoUsd),
        custoEstimado: a.custoEstimado,
        propostas: a.propostas,
        emBranco: a.emBranco,
        erro: a.erro,
        lidaPor: a.lidaPor,
        lidaEm: a.lidaEm.toISOString(),
      })),
      marcos: t.marcos.map((m) => ({
        id: m.id,
        tipo: m.tipo,
        texto: m.texto,
        dados: (m.dados ?? {}) as Record<string, unknown>,
        quem: m.quem,
        em: m.em.toISOString(),
      })),
      receitaDetalhe: receita(t.receita) ?? null,
      dossie: dossieMarco ? ((dossieMarco.dados as Record<string, unknown>).dossie as Dossie) ?? null : null,
      pendenciasDoRelogio: pend,
      receitas: RECEITAS.map((r) => ({ chave: r.chave, nome: r.nome, estado: r.estado })),
    };
  }

  async atualizar(orgId: string, id: string, patch: PatchDoTrilho, quem: Quem): Promise<TrilhoCompleto> {
    const atual = await this.exigirTrilho(orgId, id);
    if (patch.perfil != null && patch.perfil !== '' && !ehPerfil(patch.perfil)) {
      throw new BadRequestException('perfil inválido: P1, P2, P3 ou nao-entra.');
    }
    if (patch.nivel != null && patch.nivel !== '' && !ehNivel(patch.nivel)) {
      throw new BadRequestException('nível inválido: beaba, avancar-junto ou entregar-pronto.');
    }
    if (patch.receita && !receita(patch.receita)) throw new BadRequestException('receita desconhecida.');
    if (patch.cardId) await this.exigirCartao(orgId, patch.cardId);

    const portoesAtuais = (atual.portoes ?? {}) as Portoes;
    let portoes: Portoes | undefined;
    if (patch.portoes) {
      const mesclado: Record<string, unknown> = { ...portoesAtuais };
      for (const [chave, valor] of Object.entries(patch.portoes)) {
        if (valor === undefined) continue;
        if (valor === null) {
          delete mesclado[chave];
          continue;
        }
        mesclado[chave] =
          chave === 'dupla'
            ? { ...((portoesAtuais.dupla ?? {}) as Record<string, unknown>), ...(valor as Record<string, unknown>) }
            : valor;
      }
      portoes = mesclado as Portoes;
    }

    const dados: Prisma.OnboardingTrilhoUpdateInput = {
      ...(patch.cliente !== undefined ? { cliente: String(patch.cliente).trim() } : {}),
      ...(patch.contatoNome !== undefined ? { contatoNome: texto(patch.contatoNome, 120) } : {}),
      ...(patch.contatoWhatsapp !== undefined ? { contatoWhatsapp: texto(patch.contatoWhatsapp, 40) } : {}),
      ...(patch.contatoEmail !== undefined ? { contatoEmail: texto(patch.contatoEmail, 200) } : {}),
      ...(patch.perfil !== undefined ? { perfil: patch.perfil || null } : {}),
      ...(patch.nivel !== undefined ? { nivel: patch.nivel || null } : {}),
      ...(patch.receita !== undefined ? { receita: patch.receita || null } : {}),
      ...(patch.conduzidoPor !== undefined ? { conduzidoPor: texto(patch.conduzidoPor, 120) } : {}),
      ...(patch.implantadoPor !== undefined ? { implantadoPor: texto(patch.implantadoPor, 120) } : {}),
      ...(patch.reuniaoEm !== undefined ? { reuniaoEm: dataOuNull(patch.reuniaoEm) } : {}),
      ...(patch.kickoffEm !== undefined ? { kickoffEm: dataOuNull(patch.kickoffEm) } : {}),
      ...(patch.imersaoEm !== undefined ? { imersaoEm: dataOuNull(patch.imersaoEm) } : {}),
      ...(patch.grupoJid !== undefined ? { grupoJid: texto(patch.grupoJid, 80) } : {}),
      ...(patch.empresaId !== undefined ? { empresaId: texto(patch.empresaId, 80) } : {}),
      ...(patch.cardId !== undefined
        ? { card: patch.cardId ? { connect: { id: patch.cardId } } : { disconnect: true } }
        : {}),
      ...(patch.proximoPasso !== undefined ? { proximoPasso: texto(patch.proximoPasso, 500) } : {}),
      ...(patch.proximoPassoDono !== undefined ? { proximoPassoDono: texto(patch.proximoPassoDono, 120) } : {}),
      ...(patch.proximoPassoEm !== undefined ? { proximoPassoEm: dataOuNull(patch.proximoPassoEm) } : {}),
      ...(patch.observacoes !== undefined ? { observacoes: texto(patch.observacoes, 4000) } : {}),
      ...(portoes ? { portoes: portoes as Prisma.InputJsonValue } : {}),
    };

    await this.prisma.onboardingTrilho.update({ where: { id }, data: dados });

    // Portão cumprido vira marco — é a prova, com data e quem.
    if (patch.portoes) {
      const chaves = Object.keys(patch.portoes).filter(
        (k) => (patch.portoes as Record<string, unknown>)[k] != null,
      );
      if (chaves.length) {
        await this.marco(orgId, id, 'portao.registrado', `Portões registrados: ${chaves.join(', ')}.`, { chaves }, quem);
      }
    }
    if (patch.proximoPasso !== undefined || patch.proximoPassoEm !== undefined) {
      await this.marco(
        orgId,
        id,
        'proximo-passo.definido',
        `Próximo passo: ${patch.proximoPasso ?? atual.proximoPasso ?? '(vazio)'} — ${patch.proximoPassoDono ?? atual.proximoPassoDono ?? 'sem dono'}.`,
        {},
        quem,
      );
    }
    return this.obter(orgId, id);
  }

  /** Avança de fase — só com o portão cumprido. Recusa com a lista do que falta. */
  async avancar(orgId: string, id: string, quem: Quem): Promise<TrilhoCompleto> {
    const t = await this.exigirTrilho(orgId, id, true);
    const decisao = podeAvancar(this.estadoParaPortao(t, t.itens));
    if (!decisao.ok || !decisao.proxima) {
      throw new ConflictException({
        message: `o portão da fase "${ROTULO_DA_FASE[t.fase]}" não está cumprido.`,
        faltando: decisao.faltando,
      });
    }
    await this.prisma.onboardingTrilho.update({
      where: { id },
      data: {
        fase: decisao.proxima,
        // O próximo passo é da fase que acabou; a nova fase começa sem um, e
        // isso é alerta de propósito — ver o relógio.
        proximoPasso: null,
        proximoPassoDono: null,
        proximoPassoEm: null,
      },
    });
    await this.marco(
      orgId,
      id,
      'fase.avancou',
      `De ${ROTULO_DA_FASE[t.fase]} para ${ROTULO_DA_FASE[decisao.proxima]}.`,
      { de: t.fase, para: decisao.proxima },
      quem,
    );
    return this.obter(orgId, id);
  }

  async encerrar(orgId: string, id: string, motivo: string, quem: Quem): Promise<TrilhoCompleto> {
    const t = await this.exigirTrilho(orgId, id);
    const m = String(motivo ?? '').trim();
    if (m.length < 4) throw new BadRequestException('diga por que o trilho está sendo encerrado.');
    await this.prisma.onboardingTrilho.update({ where: { id }, data: { fase: OnboardingFase.encerrado } });
    await this.marco(orgId, id, 'trilho.encerrado', `Encerrado na fase ${ROTULO_DA_FASE[t.fase]}: ${m}`, { de: t.fase, motivo: m }, quem);
    return this.obter(orgId, id);
  }

  // ==========================================================================
  // 2. OS ITENS — proposta, decisão, resposta
  // ==========================================================================

  /**
   * Entram as propostas do leitor de ata. NUNCA sobrescreve o que o cliente já
   * respondeu; sobrescreve proposta anterior ainda não decidida (ler a ata de
   * novo é corrigir, não duplicar).
   */
  async propor(
    orgId: string,
    trilhoId: string,
    propostas: readonly PropostaDoLeitor[],
    origem: 'ata' | 'root',
  ): Promise<{ gravadas: number; preservadas: string[] }> {
    await this.exigirTrilho(orgId, trilhoId);
    const existentes = await this.prisma.onboardingItem.findMany({ where: { trilhoId } });
    const porTema = new Map(existentes.map((i) => [i.temaId, i]));
    let gravadas = 0;
    const preservadas: string[] = [];

    for (const p of propostas) {
      const tema = temaDaEspinha(p.temaId);
      if (!tema) continue;
      const atual = porTema.get(p.temaId);
      if (atual && itemRespondido(atual.status)) {
        preservadas.push(p.temaId);
        continue;
      }
      const dados = {
        orgId,
        trilhoId,
        temaId: p.temaId,
        bloco: tema.bloco,
        origem,
        tipo: p.tipo,
        proposta: p.texto,
        fonteMinuto: p.minuto,
        fonteTrecho: p.trecho,
        fonteNota: p.nota,
        status: 'proposto',
        textoFinal: null,
        aprovadoPor: null,
        aprovadoEm: null,
      };
      await this.prisma.onboardingItem.upsert({
        where: { trilhoId_temaId: { trilhoId, temaId: p.temaId } },
        create: dados,
        update: dados,
      });
      gravadas += 1;
    }
    return { gravadas, preservadas };
  }

  /** A decisão do sócio sobre uma proposta: aprovar, editar (e aprovar) ou descartar. */
  async decidirItem(
    orgId: string,
    trilhoId: string,
    temaId: string,
    decisao: 'aprovar' | 'descartar' | 'editar' | 'desfazer',
    textoEditado: string | null,
    quem: Quem,
  ): Promise<ItemNaBancada> {
    await this.exigirTrilho(orgId, trilhoId);
    const tema = temaDaEspinha(temaId);
    if (!tema) throw new BadRequestException(`tema desconhecido: ${temaId}`);
    const item = await this.prisma.onboardingItem.findUnique({
      where: { trilhoId_temaId: { trilhoId, temaId } },
    });
    if (!item) throw new NotFoundException('não há proposta para este tema.');
    if (itemRespondido(item.status)) {
      throw new ConflictException('o cliente já respondeu este tema; a decisão da bancada não se aplica mais.');
    }

    let dados: Prisma.OnboardingItemUpdateInput;
    switch (decisao) {
      case 'aprovar':
        dados = { status: 'aprovado', aprovadoPor: quem.nome, aprovadoEm: new Date() };
        break;
      case 'editar': {
        const t = String(textoEditado ?? '').trim();
        if (!t) throw new BadRequestException('o texto editado veio vazio.');
        const v = varrerSegredos(t);
        dados = {
          proposta: v.texto,
          tipo: 'interpretado',
          status: 'aprovado',
          aprovadoPor: quem.nome,
          aprovadoEm: new Date(),
          fonteNota: [item.fonteNota, `editado por ${quem.nome}`].filter(Boolean).join(' · '),
        };
        break;
      }
      case 'descartar':
        dados = { status: 'descartado', aprovadoPor: quem.nome, aprovadoEm: new Date() };
        break;
      case 'desfazer':
        dados = { status: 'proposto', aprovadoPor: null, aprovadoEm: null };
        break;
    }
    const salvo = await this.prisma.onboardingItem.update({
      where: { trilhoId_temaId: { trilhoId, temaId } },
      data: dados,
    });
    return this.itemNaBancada(tema, salvo);
  }

  /** O sócio escreve um item à mão (o que sabe da conta). Nasce aprovado, origem `root`. */
  async escreverItem(orgId: string, trilhoId: string, temaId: string, textoBruto: string, quem: Quem): Promise<ItemNaBancada> {
    await this.exigirTrilho(orgId, trilhoId);
    const tema = temaDaEspinha(temaId);
    if (!tema) throw new BadRequestException(`tema desconhecido: ${temaId}`);
    const v = varrerSegredos(String(textoBruto ?? '').trim());
    if (!v.texto) throw new BadRequestException('o texto veio vazio.');
    const atual = await this.prisma.onboardingItem.findUnique({ where: { trilhoId_temaId: { trilhoId, temaId } } });
    if (atual && itemRespondido(atual.status)) {
      throw new ConflictException('o cliente já respondeu este tema; corrija pelo link, não pela bancada.');
    }
    const dados = {
      orgId,
      trilhoId,
      temaId,
      bloco: tema.bloco,
      origem: 'root',
      tipo: 'interpretado',
      proposta: v.texto,
      fonteMinuto: null,
      fonteTrecho: null,
      fonteNota: `escrito por ${quem.nome} na bancada`,
      status: 'aprovado',
      aprovadoPor: quem.nome,
      aprovadoEm: new Date(),
    };
    const salvo = await this.prisma.onboardingItem.upsert({
      where: { trilhoId_temaId: { trilhoId, temaId } },
      create: dados,
      update: dados,
    });
    return this.itemNaBancada(tema, salvo);
  }

  // ==========================================================================
  // 3. OS CONVITES — o link público
  // ==========================================================================

  /**
   * Gera o link. Para `BCD`, aplica a REGRA DE CORTE antes: proposta literal
   * ainda não decidida é aprovada pela regra; proposta interpretada pendente
   * BARRA o envio — o sócio precisa decidir. Convite anterior ativo do mesmo
   * bloco é revogado: um link por vez.
   */
  async gerarConvite(orgId: string, trilhoId: string, blocos: BlocosDoConvite, quem: Quem): Promise<ConviteGerado> {
    const t = await this.exigirTrilho(orgId, trilhoId, true);
    if (blocos !== 'A' && blocos !== 'BCD') throw new BadRequestException('blocos: A ou BCD.');
    if (blocos === 'A' && t.fase !== OnboardingFase.qualificar) {
      throw new ConflictException('o bloco A (triagem) é da fase 0. O trilho já passou dela.');
    }
    if (blocos === 'BCD' && t.fase === OnboardingFase.qualificar) {
      throw new ConflictException('o formulário completo (B–D) vai depois do contrato — o trilho ainda está na fase 0.');
    }

    let aprovadosPelaRegra = 0;
    if (blocos === 'BCD') {
      const pendentes = t.itens.filter((i) => i.status === 'proposto');
      const literais = pendentes.filter((i) => i.tipo === 'literal');
      const interpretados = pendentes.filter((i) => i.tipo !== 'literal');
      if (interpretados.length) {
        throw new ConflictException({
          message: `${interpretados.length} proposta(s) interpretada(s) esperam o seu OK antes de o link ir ao cliente.`,
          temas: interpretados.map((i) => i.temaId),
        });
      }
      if (literais.length) {
        await this.prisma.onboardingItem.updateMany({
          where: { trilhoId, temaId: { in: literais.map((i) => i.temaId) }, status: 'proposto' },
          data: { status: 'aprovado', aprovadoPor: 'regra: literal vai direto', aprovadoEm: new Date() },
        });
        aprovadosPelaRegra = literais.length;
      }
    }

    await this.prisma.onboardingConvite.updateMany({
      where: { trilhoId, blocos, revogadoEm: null, concluidoEm: null },
      data: { revogadoEm: new Date() },
    });

    const { token, hash } = gerarToken();
    const ate = validoAte();
    const convite = await this.prisma.onboardingConvite.create({
      data: { orgId, trilhoId, blocos, tokenHash: hash, validoAte: ate, criadoPor: quem.id },
    });
    const segredo = (process.env.ENCRYPTION_KEY ?? '').trim();
    if (segredo) {
      await this.prisma.onboardingConvite.update({
        where: { id: convite.id },
        data: { tokenCifrado: cifrarToken(token, segredo, convite.id) },
      });
    }
    const link = linkDoConvite(this.baseUrl(), token);
    const mensagem = this.mensagemDeEnvio(t, blocos, link, ate, t.itens);
    await this.marco(orgId, trilhoId, 'convite.gerado', `Link (${blocos}) gerado, válido até ${ate.toLocaleDateString('pt-BR')}.`, { blocos, conviteId: convite.id, aprovadosPelaRegra }, quem);

    return { conviteId: convite.id, token, link, validoAte: ate.toISOString(), mensagem, aprovadosPelaRegra };
  }

  async revogarConvite(orgId: string, trilhoId: string, conviteId: string, quem: Quem): Promise<void> {
    await this.exigirTrilho(orgId, trilhoId);
    const c = await this.prisma.onboardingConvite.findFirst({ where: { id: conviteId, trilhoId } });
    if (!c) throw new NotFoundException('convite não encontrado.');
    if (c.revogadoEm) return;
    await this.prisma.onboardingConvite.update({ where: { id: conviteId }, data: { revogadoEm: new Date() } });
    await this.marco(orgId, trilhoId, 'convite.revogado', `Link (${c.blocos}) revogado.`, { conviteId }, quem);
  }

  /** O sócio copiou e mandou: o relógio de 3 dias começa aqui, não na geração. */
  async marcarEnviado(orgId: string, trilhoId: string, conviteId: string, quem: Quem): Promise<ConviteNaBancada> {
    await this.exigirTrilho(orgId, trilhoId);
    const c = await this.prisma.onboardingConvite.findFirst({ where: { id: conviteId, trilhoId } });
    if (!c) throw new NotFoundException('convite não encontrado.');
    if (!aceitaEscrita(c)) throw new ConflictException(`o convite está ${estadoDoConvite(c)}.`);
    const salvo = await this.prisma.onboardingConvite.update({
      where: { id: conviteId },
      data: { enviadoEm: c.enviadoEm ?? new Date() },
    });
    if (!c.enviadoEm) {
      await this.marco(orgId, trilhoId, 'convite.enviado', `Link (${c.blocos}) enviado no grupo. Lembrete automático em 3 dias.`, { conviteId }, quem);
    }
    return this.conviteNaBancada(salvo);
  }

  /** As mensagens prontas de um convite, com o link reescrito do token cifrado. */
  async mensagensDoConvite(
    orgId: string,
    trilhoId: string,
    conviteId: string,
  ): Promise<{ envio: string | null; lembrete: string | null; cobranca: string | null; link: string | null; faltam: string[] }> {
    const t = await this.exigirTrilho(orgId, trilhoId, true);
    const c = await this.prisma.onboardingConvite.findFirst({ where: { id: conviteId, trilhoId } });
    if (!c) throw new NotFoundException('convite não encontrado.');
    const link = this.linkDoConviteGuardado(c);
    if (!link) return { envio: null, lembrete: null, cobranca: null, link: null, faltam: [] };
    const nivel: Nivel | null = ehNivel(t.nivel) ? t.nivel : null;
    const porTema = new Map(t.itens.map((i) => [i.temaId, i]));
    const faltam = obrigatorios(c.blocos as BlocosDoConvite, nivel)
      .filter((tema) => !itemRespondido(porTema.get(tema.id)?.status ?? 'em-branco'))
      .map((tema) => tema.titulo);
    return {
      envio: this.mensagemDeEnvio(t, c.blocos as BlocosDoConvite, link, c.validoAte, t.itens),
      lembrete: mensagemDeLembrete(t, link, faltam),
      cobranca: mensagemDeCobrancaPessoal(t, link),
      link,
      faltam,
    };
  }

  /** Boas-vindas com os próximos passos e datas reais. Sem data, recusa (nunca XX/XX). */
  boasVindas(t: { cliente: string; contatoNome: string | null }, passos: ProximoPassoParaMensagem[], root: string[]): string {
    return mensagemDeBoasVindas(t, passos, { root });
  }

  // ==========================================================================
  // 4. DOCUMENTOS — roteiro, folha de reunião, retrato
  // ==========================================================================

  async roteiro(orgId: string, trilhoId: string): Promise<RoteiroDoKickoff> {
    const t = await this.exigirTrilho(orgId, trilhoId, true);
    const personalizado = await this.prisma.onboardingMarco.findFirst({
      where: { trilhoId, tipo: 'roteiro.personalizado' },
      orderBy: { em: 'desc' },
    });
    const perguntas = (personalizado?.dados as { perguntas?: Record<string, string> } | null)?.perguntas ?? {};
    const roteiro = montarRoteiro(
      {
        cliente: t.cliente,
        fase: t.fase,
        perfil: t.perfil,
        nivel: t.nivel,
        receita: t.receita,
        conduzidoPor: t.conduzidoPor,
        implantadoPor: t.implantadoPor,
        kickoffEm: t.kickoffEm,
      },
      t.itens.map((i) => ({ temaId: i.temaId, bloco: i.bloco, status: i.status, textoFinal: i.textoFinal, proposta: i.proposta })),
      temasDoBloco('A'),
    );
    // As perguntas reescritas pelo roteirista entram por cima, tema a tema.
    for (const b of roteiro.blocos) {
      for (const tema of b.temas) {
        if (perguntas[tema.id]) tema.pergunta = perguntas[tema.id];
      }
    }
    return roteiro;
  }

  async folhaDeReuniao(orgId: string, trilhoId: string): Promise<{ markdown: string; dossie: Dossie | null }> {
    const t = await this.exigirTrilho(orgId, trilhoId, true);
    const m = await this.prisma.onboardingMarco.findFirst({
      where: { trilhoId, tipo: 'dossie.gerado' },
      orderBy: { em: 'desc' },
    });
    const dossie = m ? (((m.dados as Record<string, unknown>).dossie as Dossie) ?? null) : null;
    return {
      markdown: folhaDeReuniao({ cliente: t.cliente, reuniaoEm: t.reuniaoEm, conduzidoPor: t.conduzidoPor, dossie }),
      dossie,
    };
  }

  async retrato(orgId: string, trilhoId: string): Promise<RetratoDoTrilho> {
    const t = await this.exigirTrilho(orgId, trilhoId, true);
    return this.retratoDe(t, t.itens);
  }

  retratoDe(t: OnboardingTrilho, itens: readonly OnboardingItem[]): RetratoDoTrilho {
    return montarRetratoDoTrilho({
      cliente: t.cliente,
      nivel: t.nivel,
      kickoffEm: t.kickoffEm,
      itens: itens.map((i) => ({
        temaId: i.temaId,
        bloco: i.bloco,
        status: i.status,
        tipo: i.tipo,
        textoFinal: i.textoFinal,
        proposta: i.proposta,
        fonteMinuto: i.fonteMinuto,
        respondidoPor: i.respondidoPor,
        respondidoVia: i.respondidoVia,
        respondidoEm: i.respondidoEm,
      })),
      proximoPasso: t.proximoPasso,
    });
  }

  // ==========================================================================
  // 5. A EMPRESA DO CLIENTE — provisionar e carregar a memória
  // ==========================================================================

  async provisionarEmpresa(orgId: string, trilhoId: string, quem: Quem): Promise<TrilhoCompleto> {
    const t = await this.exigirTrilho(orgId, trilhoId);
    if (t.empresaId) return this.obter(orgId, trilhoId);
    const resultado = await this.provisionamento.provisionar(
      {
        slug: t.slug,
        nome: t.cliente,
        modulos: ['trabalho'],
        ...(t.contatoEmail ? { admin: { email: t.contatoEmail, nome: t.contatoNome ?? undefined } } : {}),
        modo: 'criar',
      },
      { tipo: 'user', id: quem.id, origem: 'http' },
    );
    await this.prisma.onboardingTrilho.update({ where: { id: trilhoId }, data: { empresaId: resultado.orgId } });
    await this.marco(
      orgId,
      trilhoId,
      'empresa.provisionada',
      `${t.cliente} existe no OS (${resultado.slug})${resultado.criada ? '' : ' — já existia'}.`,
      { empresaId: resultado.orgId, criada: resultado.criada },
      quem,
    );
    return this.obter(orgId, trilhoId);
  }

  /**
   * O que o cliente confirmou vira nota na memória da empresa DELE, com a
   * chave estável de cada tema (a mesma da carga guiada) e a procedência
   * completa. Roda no contexto da empresa do cliente. Idempotente: item já
   * carregado e não alterado depois não é regravado.
   */
  async carregarMemoria(orgId: string, trilhoId: string, quem: Quem): Promise<{ carregados: number; retrato: boolean }> {
    const t = await this.exigirTrilho(orgId, trilhoId, true);
    if (!t.empresaId) throw new ConflictException('a empresa do cliente ainda não existe no OS. Provisione antes.');
    const empresaId = t.empresaId;
    /*
     * "Mudou depois de carregado?" com folga de 2 s: o `update` que grava
     * `carregadoEm` também carimba `atualizadoEm` (@updatedAt), alguns
     * milissegundos depois — sem a folga, todo item pareceria alterado na
     * segunda passada e a carga nunca seria idempotente.
     */
    const FOLGA_MS = 2000;
    const paraCarregar = t.itens.filter(
      (i) =>
        itemRespondido(i.status) &&
        (i.textoFinal ?? '').trim() &&
        (!i.carregadoEm || i.atualizadoEm.getTime() > i.carregadoEm.getTime() + FOLGA_MS),
    );

    let carregados = 0;
    await comContexto(
      {
        orgId: empresaId,
        actorType: 'system',
        actorId: null,
        correlationId: contextoAtual()?.correlationId ?? novaCorrelacao('onboarding'),
        origem: contextoAtual()?.origem ?? 'http',
      },
      async () => {
        for (const i of paraCarregar) {
          const tema = temaDaEspinha(i.temaId);
          if (!tema) continue;
          const nota = {
            chave: chaveDaNotaDaEspinha(tema.id),
            title: tema.titulo,
            body: (i.textoFinal ?? '').trim(),
            kind: tema.kind,
            tags: [...tema.tags],
            sourceType: ContextSource.operador,
            sourceRef: this.procedenciaDoItem(t, i),
            motivo: `onboarding pelo link — tema "${tema.id}" ${i.status} por ${i.respondidoPor ?? 'cliente'}`,
          };
          const existente = await this.memoria.porChave(empresaId, nota.chave);
          let gravada: { id: string };
          if (existente) {
            if (existente.arquivadoEm) {
              await this.memoria.restaurar(empresaId, existente.id, 'o tema voltou a ser respondido pelo onboarding');
            }
            gravada = await this.memoria.alterar(empresaId, existente.id, { ...nota, motivo: `${nota.motivo} (revisto)` });
          } else {
            gravada = await this.memoria.criar(empresaId, nota);
          }
          try {
            await espelharNoIndice(this.prisma, empresaId, { chave: nota.chave, titulo: nota.title, corpo: nota.body, tags: nota.tags });
          } catch (e) {
            this.log.warn(`empresa ${empresaId}: nota "${nota.chave}" fora do índice de busca (${(e as Error).message})`);
          }
          await this.prisma.onboardingItem.update({
            where: { id: i.id },
            data: { notaId: gravada.id, carregadoEm: new Date() },
          });
          carregados += 1;
        }

        // O retrato também vira nota — a mesma chave da carga guiada.
        const retrato = this.retratoDe(t, t.itens);
        if (retrato.nota) {
          const existente = await this.memoria.porChave(empresaId, CHAVE_DO_RETRATO);
          const entrada = {
            chave: retrato.nota.chave,
            title: retrato.nota.titulo,
            body: retrato.nota.corpo,
            kind: retrato.nota.kind,
            tags: retrato.nota.tags,
            sourceType: retrato.nota.sourceType,
            sourceRef: retrato.nota.sourceRef,
            motivo: retrato.nota.motivo,
          };
          if (existente) await this.memoria.alterar(empresaId, existente.id, entrada);
          else await this.memoria.criar(empresaId, entrada);
        }
      },
    );

    await this.marco(orgId, trilhoId, 'memoria.carregada', `${carregados} nota(s) carregada(s) na memória de ${t.cliente}.`, { carregados, empresaId }, quem);
    return { carregados, retrato: true };
  }

  // ==========================================================================
  // 6. O RELÓGIO — as pendências, calculadas do que está gravado
  // ==========================================================================

  async pendencias(orgId: string, nDiasSemUso = N_DIAS_SEM_USO_PADRAO, agora = new Date()): Promise<Pendencia[]> {
    const trilhos = await this.prisma.onboardingTrilho.findMany({
      where: { orgId, fase: { not: OnboardingFase.encerrado } },
      include: { convites: true, marcos: { orderBy: { em: 'desc' }, take: 60 } },
    });
    return this.pendenciasDe(orgId, trilhos, agora, nDiasSemUso);
  }

  private async pendenciasDe(
    orgId: string,
    trilhos: readonly (OnboardingTrilho & { convites: OnboardingConvite[]; marcos: { tipo: string; em: Date }[] })[],
    agora: Date = new Date(),
    nDiasSemUso = N_DIAS_SEM_USO_PADRAO,
  ): Promise<Pendencia[]> {
    const umDia = agora.getTime() - 86_400_000;
    const paraRelogio: TrilhoParaRelogio[] = trilhos.map((t) => {
      const avancou = t.marcos.find((m) => m.tipo === 'fase.avancou');
      const check = t.marcos.find((m) => m.tipo === 'check.semanal');
      const cobranca = t.marcos.find((m) => m.tipo === 'convite.cobranca-pessoal');
      return {
        id: t.id,
        cliente: t.cliente,
        fase: t.fase,
        reuniaoEm: t.reuniaoEm,
        imersaoEm: t.imersaoEm,
        portoes: (t.portoes ?? {}) as Portoes,
        proximoPasso: t.proximoPasso,
        proximoPassoEm: t.proximoPassoEm,
        faseDesde: avancou?.em ?? t.criadoEm,
        ultimoCheckEm: check?.em ?? null,
        ultimaAtividadeEm: null,
        marcosRecentes: t.marcos.filter((m) => m.em.getTime() >= umDia).map((m) => m.tipo),
        cobrancaPessoalDadaEm: cobranca?.em ?? null,
      };
    });
    const convites: ConviteParaRelogio[] = trilhos.flatMap((t) =>
      t.convites.map((c) => ({
        id: c.id,
        trilhoId: c.trilhoId,
        blocos: c.blocos,
        enviadoEm: c.enviadoEm,
        lembradoEm: c.lembradoEm,
        concluidoEm: c.concluidoEm,
        revogadoEm: c.revogadoEm,
        validoAte: c.validoAte,
      })),
    );
    void orgId;
    return pendenciasDoRelogio(paraRelogio, convites, agora, { nDiasSemUso });
  }

  /** O que a rotina faz com uma pendência: grava o marco e, no lembrete, carimba o convite. */
  async registrarPendencia(orgId: string, p: Pendencia): Promise<void> {
    const dados: Record<string, unknown> = { ...(p.dados ?? {}) };
    if (p.conviteId) {
      dados.conviteId = p.conviteId;
      const c = await this.prisma.onboardingConvite.findFirst({ where: { id: p.conviteId, trilhoId: p.trilhoId } });
      if (c) {
        const link = this.linkDoConviteGuardado(c);
        const t = await this.exigirTrilho(orgId, p.trilhoId, true);
        if (link) {
          const nivel: Nivel | null = ehNivel(t.nivel) ? t.nivel : null;
          const porTema = new Map(t.itens.map((i) => [i.temaId, i]));
          const faltam = obrigatorios(c.blocos as BlocosDoConvite, nivel)
            .filter((tema) => !itemRespondido(porTema.get(tema.id)?.status ?? 'em-branco'))
            .map((tema) => tema.titulo);
          dados.mensagem =
            p.tipo === 'convite.lembrete' ? mensagemDeLembrete(t, link, faltam) : mensagemDeCobrancaPessoal(t, link);
        } else {
          dados.mensagem = null;
          dados.aviso = 'o link não pôde ser reescrito (sem ENCRYPTION_KEY); gere um link novo na bancada.';
        }
        if (p.tipo === 'convite.lembrete') {
          await this.prisma.onboardingConvite.update({ where: { id: c.id }, data: { lembradoEm: new Date() } });
        }
      }
    }
    await this.marco(orgId, p.trilhoId, p.tipo, p.texto, dados, { id: null, nome: 'relógio do onboarding' });
  }

  // ==========================================================================
  // 7. MARCOS — a linha do tempo, com cópia no RASTRO
  // ==========================================================================

  async marco(
    orgId: string,
    trilhoId: string,
    tipo: string,
    textoDoMarco: string,
    dados: Record<string, unknown>,
    quem: Quem,
  ): Promise<void> {
    let eventoId: string | null = null;
    try {
      const linha = await this.eventos.registrar({
        orgId,
        tipo: `onboarding.${tipo}`,
        actorType: quem.id ? 'user' : 'system',
        actorId: quem.id,
        nivel: RiskLevel.R1,
        correlationId: contextoAtual()?.correlationId ?? null,
        conteudo: { argumentos: { trilhoId, texto: textoDoMarco, ...dados } },
        sensibilidade: 'interna',
      });
      eventoId = linha.id;
    } catch (e) {
      this.log.warn(`marco "${tipo}" do trilho ${trilhoId} ficou sem evento no RASTRO: ${(e as Error).message}`);
    }
    await this.prisma.onboardingMarco.create({
      data: {
        orgId,
        trilhoId,
        tipo,
        texto: textoDoMarco,
        dados: dados as Prisma.InputJsonValue,
        quem: quem.nome,
        eventoId,
      },
    });
  }

  // ==========================================================================
  // Pedaços
  // ==========================================================================

  baseUrl(): string {
    return (process.env.PUBLIC_BASE_URL ?? process.env.WEB_ORIGIN ?? 'http://localhost:4000').replace(/\/+$/, '');
  }

  linkDoConviteGuardado(c: OnboardingConvite): string | null {
    const segredo = (process.env.ENCRYPTION_KEY ?? '').trim();
    if (!segredo || !c.tokenCifrado) return null;
    const token = decifrarToken(c.tokenCifrado, segredo, c.id);
    return token ? linkDoConvite(this.baseUrl(), token) : null;
  }

  private mensagemDeEnvio(
    t: OnboardingTrilho,
    blocos: BlocosDoConvite,
    link: string,
    ate: Date,
    itens: readonly OnboardingItem[],
  ): string {
    if (blocos === 'A') {
      const prazo = t.reuniaoEm ? new Date(t.reuniaoEm.getTime() - 3 * 86_400_000) : ate;
      try {
        return mensagemDoLinkA(t, link, t.reuniaoEm, prazo);
      } catch {
        return `Oi! Cinco perguntas rápidas antes da nossa conversa, uns 5 minutos: ${link}`;
      }
    }
    const nivel: Nivel | null = ehNivel(t.nivel) ? t.nivel : null;
    const temas = temasDoConvite('BCD', nivel);
    const porTema = new Map(itens.map((i) => [i.temaId, i]));
    const jaVieram = temas.filter((tema) => {
      const s = porTema.get(tema.id)?.status;
      return s === 'aprovado' || (s !== undefined && itemRespondido(s));
    }).length;
    const faltam = temas.filter((tema) => tema.obrigatorio).length - temas.filter((tema) => tema.obrigatorio && ['aprovado', 'confirmado', 'corrigido', 'respondido'].includes(porTema.get(tema.id)?.status ?? '')).length;
    return mensagemDoLinkBCD(t, link, { jaVieram, faltam: Math.max(0, faltam), validoAte: ate, kickoffEm: t.kickoffEm });
  }

  private procedenciaDoItem(t: OnboardingTrilho, i: OnboardingItem): string {
    const partes = [`onboarding:${t.slug}`];
    if (i.origem === 'ata') {
      partes.push(`kickoff ${t.kickoffEm ? t.kickoffEm.toISOString().slice(0, 10) : 'sem data'}${i.fonteMinuto ? ` ${i.fonteMinuto}` : ''}`);
    }
    partes.push(`${i.status} por ${i.respondidoPor ?? 'cliente'}${i.respondidoVia === 'audio' ? ' (áudio)' : ''}`);
    return partes.join(' · ');
  }

  temasDoTrilho(nivel: Nivel | null): TemaDaEspinha[] {
    // Todos os temas que valem para o nível, nos quatro blocos — sem nível, o tronco.
    return [...temasDoConvite('A', nivel), ...temasDoConvite('BCD', nivel)];
  }

  itemNaBancada(tema: TemaDaEspinha, i: OnboardingItem | null): ItemNaBancada {
    return {
      temaId: tema.id,
      bloco: tema.bloco,
      titulo: tema.titulo,
      pergunta: tema.pergunta,
      aprofundar: tema.aprofundar,
      obrigatorio: tema.obrigatorio,
      formato: tema.formato,
      opcoes: tema.opcoes ? [...tema.opcoes] : null,
      ramo: tema.niveis ? tema.niveis.map((n) => ROTULO_DO_NIVEL[n]) : null,
      origem: i?.origem ?? 'cliente',
      tipo: i?.tipo ?? 'em-branco',
      proposta: i?.proposta ?? null,
      fonteMinuto: i?.fonteMinuto ?? null,
      fonteTrecho: i?.fonteTrecho ?? null,
      fonteNota: i?.fonteNota ?? null,
      status: i?.status ?? 'em-branco',
      textoFinal: i?.textoFinal ?? null,
      aprovadoPor: i?.aprovadoPor ?? null,
      aprovadoEm: ISO(i?.aprovadoEm),
      respondidoPor: i?.respondidoPor ?? null,
      respondidoEm: ISO(i?.respondidoEm),
      respondidoVia: i?.respondidoVia ?? null,
      notaId: i?.notaId ?? null,
      carregadoEm: ISO(i?.carregadoEm),
    };
  }

  private conviteNaBancada(c: OnboardingConvite): ConviteNaBancada {
    return {
      id: c.id,
      blocos: c.blocos,
      estado: estadoDoConvite(c),
      validoAte: c.validoAte.toISOString(),
      enviadoEm: ISO(c.enviadoEm),
      lembradoEm: ISO(c.lembradoEm),
      concluidoEm: ISO(c.concluidoEm),
      revogadoEm: ISO(c.revogadoEm),
      acessos: c.acessos,
      ultimoAcessoEm: ISO(c.ultimoAcessoEm),
      temLink: !!c.tokenCifrado && !!(process.env.ENCRYPTION_KEY ?? '').trim(),
      criadoEm: c.criadoEm.toISOString(),
    };
  }

  estadoParaPortao(t: OnboardingTrilho, itens: readonly OnboardingItem[]): EstadoParaPortao {
    return {
      fase: t.fase,
      perfil: t.perfil,
      nivel: t.nivel,
      receita: t.receita,
      portoes: (t.portoes ?? {}) as Portoes,
      itens: itens.map((i) => ({ temaId: i.temaId, bloco: i.bloco, status: i.status })),
      proximoPasso: t.proximoPasso,
      proximoPassoDono: t.proximoPassoDono,
      proximoPassoEm: t.proximoPassoEm,
    };
  }

  private resumo(t: OnboardingTrilho, itens: readonly OnboardingItem[], pendencias: number): TrilhoResumo {
    const decisao = podeAvancar(this.estadoParaPortao(t, itens));
    const nivel: Nivel | null = ehNivel(t.nivel) ? t.nivel : null;
    const obrig = [...obrigatorios('A', nivel), ...obrigatorios('BCD', nivel)];
    return {
      id: t.id,
      cliente: t.cliente,
      slug: t.slug,
      fase: t.fase,
      faseRotulo: ROTULO_DA_FASE[t.fase],
      perfil: t.perfil,
      nivel: t.nivel,
      nivelRotulo: nivel ? ROTULO_DO_NIVEL[nivel] : null,
      receita: t.receita,
      contatoNome: t.contatoNome,
      conduzidoPor: t.conduzidoPor,
      implantadoPor: t.implantadoPor,
      reuniaoEm: ISO(t.reuniaoEm),
      kickoffEm: ISO(t.kickoffEm),
      imersaoEm: ISO(t.imersaoEm),
      proximoPasso: t.proximoPasso,
      proximoPassoDono: t.proximoPassoDono,
      proximoPassoEm: ISO(t.proximoPassoEm),
      empresaId: t.empresaId,
      cardId: t.cardId,
      podeAvancar: decisao.ok,
      faltando: decisao.faltando,
      proxima: decisao.proxima,
      itens: {
        respondidos: itens.filter((i) => itemRespondido(i.status)).length,
        obrigatorios: obrig.length,
        propostos: itens.filter((i) => i.status === 'proposto' || i.status === 'aprovado').length,
        pendentesDeAprovacao: itens.filter((i) => i.status === 'proposto' && i.tipo !== 'literal').length,
      },
      pendencias,
      criadoEm: t.criadoEm.toISOString(),
      atualizadoEm: t.atualizadoEm.toISOString(),
    };
  }

  async exigirTrilho(orgId: string, id: string): Promise<OnboardingTrilho & { itens: OnboardingItem[] }>;
  async exigirTrilho(orgId: string, id: string, comItens: true): Promise<OnboardingTrilho & { itens: OnboardingItem[] }>;
  async exigirTrilho(orgId: string, id: string, _comItens?: boolean): Promise<OnboardingTrilho & { itens: OnboardingItem[] }> {
    const t = await this.prisma.onboardingTrilho.findFirst({ where: { id, orgId }, include: { itens: true } });
    if (!t) throw new NotFoundException('trilho não encontrado.');
    return t;
  }

  private async exigirCartao(orgId: string, cardId: string): Promise<void> {
    const card = await this.prisma.workTask.findFirst({ where: { id: cardId, orgId }, select: { id: true } });
    if (!card) throw new BadRequestException('o cartão da esteira não existe nesta empresa.');
  }
}
