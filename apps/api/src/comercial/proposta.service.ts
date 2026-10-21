import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { TABELA_DE_PRECO, type ComercialProduto, type OpcaoDeDecisao } from '@mktos/shared';
import { ActorType, Prisma } from '@prisma/client';

import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { PortaDoOperador } from '../gateway/porta-do-operador.service';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { comProcedencia, type ProcedenciaDaChamada } from '../llm/procedencia';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigComercialService } from './config.service';
import { DecisoesRegistry, DecisoesService, type DecisaoResolvida } from './decisoes.service';
import { uuidDe, type PayloadDe } from './eventos';
import { FioService, ReacoesRegistry } from './fio.service';
import { interpretarProposta, promptDaProposta, RespostaIlegivelError } from './inteligencia-prompts';
import {
  dentroDaTabela,
  hashDaVersao,
  montarProposta,
  revisarProposta,
  type Laudo,
  type QuadroDeCustos,
  type VersaoDaProposta,
} from './proposta-construtor';
import { proximaHoraNoFuso } from './hora-da-politica';
import { RelogioComercialRegistry } from './relogio.registry';

/*
 * O CONSTRUTOR, O REVISOR E A PUBLICAÇÃO DA PROPOSTA (lane E, 13/10/2026).
 *
 * O CAMINHO
 *   1. O sócio aprova o diagnóstico (`diagnostico.pronto` com `aprovadoEm`).
 *      A reação `inteligencia.proposta` monta a v1 pela tabela
 *      (`proposta-construtor.ts`), o modelo escreve só a frase de "como é
 *      diferente", e o revisor dá o laudo. Versão e laudo ficam GRAVADOS
 *      (ver "onde mora o rascunho").
 *   2. Laudo limpo e dentro da tabela: a versão vai à PORTA como
 *      `comercial.proposta.publicar` (R3, delta 1.8.0), com os argumentos do
 *      `argsSchema` e o HASH do conteúdo exato. R3 fica RETIDA: outra pessoa
 *      com alçada libera em `/atendimento` (um toque). O efeito relê o
 *      rascunho, confere o hash e grava `proposta.publicada`.
 *   3. Laudo sujo ou fora da tabela: NÃO vai à porta. Abre a decisão
 *      `proposta_fora_da_tabela` (padrão escrito: segurar). "Levar à
 *      liberação" manda à porta, e o R3 continua valendo.
 *   4. Pedido de ajuste (`proposta.ajuste_pedido`): abre `pedido_de_ajuste`
 *      com "aprovar X%", "aprovar Y%" e "manter o preço" (padrão: manter).
 *      Aprovado, nasce a versão seguinte com o desconto (parcelas
 *      recalculadas; a última absorve o arredondamento e o laudo diz) e ela vai
 *      à porta. Manter: nada muda; a `decisao.tomada` é o que a sala lê como
 *      ajuste respondido.
 *
 * SILÊNCIO APROVA (K08-3) E A HORA DE PUBLICAR, SEM TIRAR O R3
 *   · `silencioAprova` falso (padrão, a regra vigente): a versão pronta vai à
 *     porta NA HORA e espera a liberação de uma pessoa.
 *   · `silencioAprova` verdadeiro E `horaPublicacaoProposta` escrita: a versão
 *     pronta fica AGENDADA para a próxima vez em que o relógio de São Paulo
 *     passar daquela hora; até lá, "segurar" a tira da fila sem ninguém ter de
 *     aprovar nada. No horário, o relógio a leva à PORTA, e a porta a RETÉM
 *     como sempre: o toque de liberação continua. O interruptor muda QUANDO a
 *     proposta é posta na fila e dá a janela de "segurar"; não muda o nível.
 *     Tirar o toque é a mesa reclassificar a capacidade pela escada.
 *   · Fora da tabela ou com laudo sujo, nenhum dos dois vale: decisão.
 *
 * ONDE MORA O RASCUNHO: a versão montada, o hash, o laudo e o estado
 * (`pronta`, `agendada`, `na_porta`, `na_fila`, `segurada`, `publicada`)
 * ficam numa linha de `ComercialReacao` com `reacao = inteligencia.rascunho`
 * e `eventoId = proposta:<lead>:v<n>`. É a mesma tabela por empresa, com RLS e
 * sentinela; os estados não são `erro`/`em_curso`, então o
 * `reexecutarPendentes` nunca a toca. Fase mínima: a fase 2 troca por tabela
 * própria (`ComercialProposta`) com migration.
 *
 * O QUADRO DE CUSTOS de terceiros NÃO TEM DADO REAL. Em homologação vem do
 * exemplo do mapa, só com `QUADRO_DE_CUSTOS_EXEMPLO` apontando o arquivo
 * (`homolog/fixtures/quadro-de-custos-exemplo.json`), sempre marcado
 * `exemplo: true`; sem a variável, o quadro fica ausente. Nos dois casos o
 * revisor APONTA (revisão E-3): a versão vai à decisão
 * `proposta_fora_da_tabela`, e só uma pessoa a leva à liberação. A fonte do
 * quadro é `fonteDoQuadro` (a fase 2 troca pela fonte real; a suíte põe ali o
 * quadro "escrito por alguém").
 */

export const CAPACIDADE_DA_PROPOSTA = 'comercial.proposta.publicar';
export const ATOR_DA_PROPOSTA = 'comercial';
export const REACAO_DO_RASCUNHO = 'inteligencia.rascunho';

export type EstadoDoRascunho = 'pronta' | 'agendada' | 'na_porta' | 'na_fila' | 'segurada' | 'publicada';

export interface Rascunho {
  versao: number;
  estado: EstadoDoRascunho;
  conteudo: VersaoDaProposta;
  hash: string;
  laudo: Laudo;
  dentroDaTabela: boolean;
  origem: 'diagnostico' | 'ajuste' | 'manual';
  approvalId: string | null;
  decisaoId: string | null;
  publicarEm: string | null;
  avisos: string[];
  procedencia: ProcedenciaDaChamada | null;
  atualizadoEm: string;
}

type P = Record<string, unknown>;

function idDoRascunho(leadId: string, versao: number): string {
  return uuidDe(['comercial-proposta-rascunho', leadId, String(versao)]);
}

function ehRetida(r: unknown): r is { status: 'aguardando_aprovacao'; approvalId: string } {
  return Boolean(r && typeof r === 'object' && (r as P).status === 'aguardando_aprovacao' && typeof (r as P).approvalId === 'string');
}

/**
 * O quadro de exemplo da homologação, ou `null` (não há dado real).
 *
 * SÓ com a variável `QUADRO_DE_CUSTOS_EXEMPLO` escrita (o caminho do arquivo).
 * Não há caminho padrão: a imagem leva o repositório inteiro, e procurar o
 * arquivo do mapa sem condição punha R$ 180 / R$ 340 em toda proposta de
 * produção (revisão E-3). O que vem dela é SEMPRE exemplo, diga o arquivo o
 * que disser, e o revisor aponta (laudo sujo, decisão de gente).
 */
export function quadroDeExemplo(): QuadroDeCustos | null {
  const configurado = process.env.QUADRO_DE_CUSTOS_EXEMPLO?.trim();
  if (!configurado) return null;
  const arquivo = resolve(configurado);
  if (!existsSync(arquivo)) return null;
  const q = JSON.parse(readFileSync(arquivo, 'utf8')) as P;
  const n = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
  return {
    mesNormalCentavos: n(q.mesNormalCentavos),
    piorMesCentavos: n(q.piorMesCentavos),
    exemplo: true,
    origem: typeof q.origem === 'string' ? q.origem.slice(0, 200) : 'exemplo de homologação, a decidir',
  };
}

/** A próxima vez em que o relógio de São Paulo passa da `hora` (0 a 23), a partir de `agora`. */
export function proximaHoraSP(agora: Date, hora: number, fuso?: string): Date {
  // E-17: pelo fuso da política, não por -3 h fixo.
  return proximaHoraNoFuso(agora, hora, fuso);
}

/** As opções do pedido de ajuste: o que o lead pediu, a metade (contraproposta provisória) e manter. */
export function opcoesDoAjuste(descontoPct: number | null | undefined): { opcoes: OpcaoDeDecisao[]; padrao: string } {
  const opcoes: OpcaoDeDecisao[] = [];
  const pedido = typeof descontoPct === 'number' && descontoPct > 0 ? Math.min(Math.round(descontoPct * 100) / 100, 50) : null;
  if (pedido) {
    const metade = Math.floor(pedido / 2);
    if (metade >= 1 && metade !== pedido) opcoes.push({ chave: `desconto:${metade}`, rotulo: `Aprovar ${metade}%`, efeito: 'nova versão da proposta com este desconto, à liberação (R3)' });
    opcoes.push({ chave: `desconto:${pedido}`, rotulo: `Aprovar ${pedido}%`, efeito: 'nova versão da proposta com este desconto, à liberação (R3)' });
  }
  opcoes.push({ chave: 'manter', rotulo: 'Manter o preço', efeito: 'nada muda; a sala mostra que o ajuste foi respondido' });
  return { opcoes, padrao: 'manter' };
}

@Injectable()
export class PropostaService implements OnModuleInit {
  private readonly log = new Logger('ComercialProposta');

  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly reacoes: ReacoesRegistry,
    private readonly decisoes: DecisoesService,
    private readonly aoDecidir: DecisoesRegistry,
    private readonly config: ConfigComercialService,
    private readonly efeitos: EfeitosRegistry,
    private readonly operador: PortaDoOperador,
    private readonly relogio: RelogioComercialRegistry,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /** De onde vem o quadro de custos de terceiros (ver o cabeçalho). */
  fonteDoQuadro: () => QuadroDeCustos | null = quadroDeExemplo;

  onModuleInit(): void {
    this.inscrever();
  }

  /** Separado para a suíte montar à mão. */
  inscrever(): void {
    this.efeitos.registrar({ [CAPACIDADE_DA_PROPOSTA]: (args, orgId, ctx) => this.efeitoDePublicar(args, orgId, ctx) }, 'comercial/proposta.service');
    this.reacoes.inscrever('diagnostico.pronto', 'inteligencia.proposta', async (ev) => {
      if (!ev.payload.aprovadoEm) return { pulado: 'o diagnóstico ainda não foi aprovado por sócio (portão de E5)' };
      const existente = await this.ultimo(ev.orgId, ev.leadId);
      if (existente) return { pulado: `o lead já tem a proposta v${existente.versao} (${existente.estado}); refazer é pela rota` };
      const r = await this.construir(ev.orgId, ev.leadId, { origem: 'diagnostico' });
      return this.encaminhar(ev.orgId, ev.leadId, r.versao, { automatico: true });
    });
    this.reacoes.inscrever('proposta.ajuste_pedido', 'inteligencia.ajuste', (ev) => this.abrirAjuste(ev.orgId, ev.leadId, ev.eventoId, ev.payload));
    this.aoDecidir.aoDecidir('pedido_de_ajuste', (d) => this.aplicarAjuste(d), 'inteligencia.ajuste');
    this.aoDecidir.aoDecidir('proposta_fora_da_tabela', (d) => this.aplicarForaDaTabela(d), 'inteligencia.fora-da-tabela');
    this.relogio.inscrever('inteligencia.publicacao-agendada', (orgId, agora) => this.soltarAgendadas(orgId, agora));
  }

  // -------------------------------------------------------------------------
  // O rascunho
  // -------------------------------------------------------------------------

  private paraRascunho(linha: { resultado: Prisma.JsonValue; estado: string; criadoEm: Date }): Rascunho {
    const r = (linha.resultado ?? {}) as unknown as Rascunho;
    return { ...r, estado: linha.estado as EstadoDoRascunho };
  }

  async rascunhos(orgId: string, leadId: string): Promise<Rascunho[]> {
    const linhas = await this.prisma.comercialReacao.findMany({ where: { orgId, leadId, reacao: REACAO_DO_RASCUNHO } });
    return linhas.map((l) => this.paraRascunho(l)).sort((a, b) => b.versao - a.versao);
  }

  async ultimo(orgId: string, leadId: string): Promise<Rascunho | null> {
    return (await this.rascunhos(orgId, leadId))[0] ?? null;
  }

  async daVersao(orgId: string, leadId: string, versao: number): Promise<Rascunho | null> {
    const l = await this.prisma.comercialReacao.findFirst({ where: { orgId, id: idDoRascunho(leadId, versao) } });
    return l ? this.paraRascunho(l) : null;
  }

  private async gravar(leadId: string, r: Rascunho, criar: boolean): Promise<void> {
    const dados = { ...r, atualizadoEm: new Date().toISOString() };
    if (criar) {
      await this.prisma.comercialReacao.create({
        data: { id: idDoRascunho(leadId, r.versao), leadId, eventoId: `proposta:${leadId}:v${r.versao}`, reacao: REACAO_DO_RASCUNHO, estado: r.estado, resultado: dados as unknown as Prisma.InputJsonValue },
      });
    } else {
      await this.prisma.comercialReacao.update({ where: { id: idDoRascunho(leadId, r.versao) }, data: { estado: r.estado, resultado: dados as unknown as Prisma.InputJsonValue } });
    }
  }

  /** Muda o estado só se ele ainda é um dos esperados (dois caminhos ao mesmo tempo: um vence). */
  private async mudarEstado(orgId: string, leadId: string, versao: number, de: EstadoDoRascunho[], para: EstadoDoRascunho, extra: Partial<Rascunho> = {}): Promise<Rascunho | null> {
    const atual = await this.daVersao(orgId, leadId, versao);
    if (!atual || !de.includes(atual.estado)) return null;
    const novo: Rascunho = { ...atual, ...extra, estado: para, atualizadoEm: new Date().toISOString() };
    const r = await this.prisma.comercialReacao.updateMany({
      where: { id: idDoRascunho(leadId, versao), orgId, estado: atual.estado },
      data: { estado: para, resultado: novo as unknown as Prisma.InputJsonValue },
    });
    return r.count === 1 ? novo : null;
  }

  // -------------------------------------------------------------------------
  // Construir e revisar
  // -------------------------------------------------------------------------

  /**
   * Monta e revisa uma versão. Sem `versao`: a última ainda não publicada é
   * refeita no lugar; se a última já saiu, nasce a seguinte.
   */
  async construir(
    orgId: string,
    leadId: string,
    o: { origem: Rascunho['origem']; descontoAprovado?: { pct: number; decisaoId: string } | null; produto?: ComercialProduto | null; agora?: Date } ,
  ): Promise<Rascunho> {
    const agora = o.agora ?? new Date();
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { id: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    const ficha = await this.prisma.comercialFicha.findFirst({ where: { leadId, orgId } });
    const diag = await this.prisma.leadEvent.findFirst({ where: { leadId, orgId, type: 'diagnostico.pronto' }, orderBy: { occurredAt: 'desc' } });
    const dp = (diag?.payload ?? {}) as P;
    const dores = Array.isArray(dp.dores) ? (dp.dores as P[]).map((d) => String(d.texto ?? '')).filter(Boolean) : [];
    const objecoes = Array.isArray(dp.objecoes) ? (dp.objecoes as unknown[]).map(String) : [];

    const produto = (o.produto ?? (typeof dp.produtoSugerido === 'string' ? dp.produtoSugerido : null) ?? ficha?.produto ?? null) as ComercialProduto | null;
    if (!produto || !(produto in TABELA_DE_PRECO)) {
      throw new BadRequestException('Sem produto: o diagnóstico não sugeriu (a base do lead ainda não é conhecida) e a ficha não tem. [a decidir] pelo sócio.');
    }

    const cfg = await this.config.ler(orgId);
    const anterior = await this.ultimo(orgId, leadId);
    const versao = !anterior ? Math.max(1, (ficha?.propostaVersao ?? 0) + 1) : anterior.estado === 'publicada' ? anterior.versao + 1 : anterior.versao;
    if (anterior && anterior.versao === versao && anterior.estado === 'na_porta') {
      throw new ConflictException(`A v${versao} já está na fila de liberação (${anterior.approvalId}). Segure antes de refazer.`);
    }

    // A frase de "como é diferente": a única coisa que o modelo escreve. Falha do modelo não trava a proposta.
    const avisos: string[] = [];
    let comoEDiferente: string | null = null;
    let procedencia: ProcedenciaDaChamada | null = null;
    if (objecoes.length) {
      try {
        const { system, user } = promptDaProposta({ produto: TABELA_DE_PRECO[produto]?.rotulo ?? produto, dores, objecoes });
        const r = await comProcedencia(() => this.llm.complete({ funcao: 'CO-04', system, user, orgId, maxTokens: 600 }));
        procedencia = r.procedencia ?? { provider: this.llm.name, modelo: this.llm.model, custoUsd: 0, custoDesconhecido: true, caiuNoStub: false, aviso: null };
        const lida = interpretarProposta(r.resultado);
        comoEDiferente = lida.comoEDiferente;
        avisos.push(...lida.avisos);
        if (procedencia.aviso) avisos.push(procedencia.aviso);
      } catch (e) {
        avisos.push(`a frase de "como é diferente" ficou de fora: ${e instanceof RespostaIlegivelError ? e.message : (e as Error).message}`);
      }
    }

    const conteudo = montarProposta({
      leadId,
      versao,
      produto,
      dores,
      comoEDiferente,
      quadro: this.fonteDoQuadro(),
      validadeDias: cfg.validadePropostaDias,
      agora,
      descontoAprovado: o.descontoAprovado ?? null,
    });
    const laudo = revisarProposta(conteudo);
    const rascunho: Rascunho = {
      versao,
      estado: 'pronta',
      conteudo,
      hash: hashDaVersao(conteudo),
      laudo,
      dentroDaTabela: dentroDaTabela(conteudo),
      origem: o.origem,
      approvalId: null,
      decisaoId: null,
      publicarEm: null,
      avisos,
      procedencia,
      atualizadoEm: agora.toISOString(),
    };
    await this.gravar(leadId, rascunho, !(anterior && anterior.versao === versao));
    return rascunho;
  }

  /**
   * Leva a versão pronta adiante: à porta, à agenda (silêncio aprova) ou à
   * fila de decisões. `automatico` = quem chama é a reação, não uma pessoa.
   */
  async encaminhar(orgId: string, leadId: string, versao: number, o: { automatico: boolean; quem?: { id: string } | null; agora?: Date }): Promise<Rascunho> {
    const agora = o.agora ?? new Date();
    const r = await this.daVersao(orgId, leadId, versao);
    if (!r) throw new NotFoundException(`A v${versao} não existe.`);
    if (r.estado !== 'pronta') return r;

    const autorizado = r.laudo.ok && (r.dentroDaTabela || Boolean(r.conteudo.descontoDecisaoId));
    if (!autorizado) {
      const linha = TABELA_DE_PRECO[r.conteudo.produto];
      const d = await this.decisoes.abrir({
        orgId,
        leadId,
        tipo: 'proposta_fora_da_tabela',
        titulo: `Proposta v${versao} ${r.dentroDaTabela ? 'com laudo sujo' : 'fora da tabela'}`,
        contexto: [
          `${linha?.rotulo ?? r.conteudo.produto}: ${r.conteudo.parcelas}× de ${(r.conteudo.parcelaCentavos / 100).toFixed(2)} (total ${(r.conteudo.valorCentavos / 100).toFixed(2)}).`,
          `O revisor apontou: ${r.laudo.apontamentos.join('; ') || 'nada'}.`,
        ].join(' '),
        opcoes: [
          { chave: 'liberar', rotulo: 'Levar à liberação assim', efeito: 'vai à porta (R3): outra pessoa libera em /atendimento' },
          { chave: 'segurar', rotulo: 'Segurar', efeito: 'a proposta fica parada até alguém refazer' },
        ],
        padrao: 'segurar',
        dados: { versao, hash: r.hash },
        chave: `fora-da-tabela:${leadId}:v${versao}:${r.hash}`,
        agora,
      });
      return (await this.mudarEstado(orgId, leadId, versao, ['pronta'], 'na_fila', { decisaoId: d.id })) ?? r;
    }

    const cfg = await this.config.ler(orgId);
    if (o.automatico && cfg.silencioAprova && cfg.horaPublicacaoProposta != null && r.origem !== 'ajuste') {
      const publicarEm = proximaHoraSP(agora, cfg.horaPublicacaoProposta).toISOString();
      return (await this.mudarEstado(orgId, leadId, versao, ['pronta'], 'agendada', { publicarEm })) ?? r;
    }
    return this.proporAPorta(orgId, leadId, versao, o.quem ?? null, ['pronta']);
  }

  /** Entrega a versão à porta como `comercial.proposta.publicar`. R3: fica retida para outra pessoa liberar. */
  async proporAPorta(orgId: string, leadId: string, versao: number, quem: { id: string } | null, de: EstadoDoRascunho[]): Promise<Rascunho> {
    const r = await this.daVersao(orgId, leadId, versao);
    if (!r) throw new NotFoundException(`A v${versao} não existe.`);
    if (!de.includes(r.estado)) throw new ConflictException(`A v${versao} está ${r.estado}: não vai à porta daqui.`);
    const args = {
      leadId,
      versao,
      hash: r.hash,
      produto: r.conteudo.produto,
      valorCentavos: r.conteudo.valorCentavos,
      parcelas: r.conteudo.parcelas,
    };
    const resposta = await this.operador.executar({
      orgId,
      actorId: quem?.id ?? ATOR_DA_PROPOSTA,
      actorType: quem ? ActorType.user : ActorType.system,
      capabilityId: CAPACIDADE_DA_PROPOSTA,
      args,
      resource: { type: 'comercial.proposta', id: `${leadId}:v${versao}` },
    });
    if (ehRetida(resposta)) {
      return (await this.mudarEstado(orgId, leadId, versao, de, 'na_porta', { approvalId: resposta.approvalId })) ?? r;
    }
    // Sem retenção (a régua mudou): o efeito já rodou e gravou.
    return (await this.daVersao(orgId, leadId, versao)) ?? r;
  }

  /**
   * O que quem libera o R3 lê em /atendimento (revisão E-7): o conteúdo inteiro
   * da versão (desconto, validade, quadro de custos, "o que ouvimos", a frase de
   * "como é diferente"), o laudo, e o hash RECALCULADO agora. `confere` só é
   * verdadeiro quando o hash de agora é o gravado e o que a aprovação prende
   * (`hashAssinado`): divergente, o efeito recusaria de qualquer jeito.
   */
  async conteudoParaLiberar(orgId: string, leadId: string, versao: number, hashAssinado: string | null) {
    const r = await this.daVersao(orgId, leadId, versao);
    if (!r) throw new NotFoundException(`A v${versao} não existe.`);
    const hashDeAgora = hashDaVersao(r.conteudo);
    const confere = hashDeAgora === r.hash && (hashAssinado === null || hashAssinado === hashDeAgora);
    return {
      leadId,
      versao,
      estado: r.estado,
      conteudo: r.conteudo,
      laudo: r.laudo,
      dentroDaTabela: r.dentroDaTabela,
      hashGravado: r.hash,
      hashDeAgora,
      hashAssinado,
      confere,
    };
  }

  /**
   * O EFEITO de `comercial.proposta.publicar`: só a porta chama, depois da
   * liberação. Relê o rascunho, confere o hash contra o que foi aprovado e
   * grava `proposta.publicada`. Segurada depois da aprovação não sai.
   */
  private async efeitoDePublicar(args: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito): Promise<unknown> {
    const leadId = String(args.leadId ?? '');
    const versao = Number(args.versao);
    const r = await this.daVersao(orgId, leadId, versao);
    if (!r) throw new Error('a versão da proposta não existe nesta empresa: nada foi publicado');
    if (r.estado === 'publicada') return { leadId, versao, jaPublicada: true };
    if (r.estado === 'segurada') throw new Error('a proposta foi segurada depois do pedido: nada foi publicado');
    if (r.hash !== args.hash || hashDaVersao(r.conteudo) !== r.hash) throw new Error('o conteúdo da proposta mudou depois do pedido: nada foi publicado');

    const c = r.conteudo;
    const em = new Date();
    // Laudo sujo só chega aqui por "levar à liberação assim": a decisão tomada por uma pessoa sobre ESTE hash.
    const liberadoNaDecisao = r.laudo.ok ? null : await this.decisaoQueLiberou(orgId, r);
    const payload: PayloadDe<'proposta.publicada'> & P = {
      versao,
      produto: c.produto,
      valorCentavos: c.valorCentavos,
      parcelas: c.parcelas,
      parcelaCentavos: c.parcelaCentavos,
      formas: c.formas,
      validaAte: c.validaAte,
      dentroDaTabela: r.dentroDaTabela,
      laudo: { ok: r.laudo.ok, apontamentos: r.laudo.apontamentos, ...(liberadoNaDecisao ? { liberadoNaDecisao } : {}) },
      descontoPct: c.descontoPct,
      hash: r.hash,
      quadroDeCustos: c.quadroDeCustos
        ? { mesNormalCentavos: c.quadroDeCustos.mesNormalCentavos, piorMesCentavos: c.quadroDeCustos.piorMesCentavos, ...(c.quadroDeCustos.exemplo ? { exemplo: true } : {}) }
        : null,
      // Acréscimos da lane E: o que a sala e a tela 06 mostram além do contrato do evento.
      alternativa: c.alternativa,
      ouvimos: c.ouvimos,
      comoEDiferente: c.comoEDiferente,
      ultimaParcelaCentavos: c.ultimaParcelaCentavos,
      notasDoLaudo: r.laudo.notas,
      quadroDeExemplo: c.quadroDeCustos?.exemplo ?? null,
      descontoDecisaoId: c.descontoDecisaoId,
      liberadaPor: ctx.approvalId ? (ctx.actorId ?? null) : null,
      approvalId: ctx.approvalId ?? null,
    };
    const ev = await this.fio.registrar(orgId, leadId, 'proposta.publicada', `v${versao}`, payload as PayloadDe<'proposta.publicada'>, { em });
    await this.mudarEstado(orgId, leadId, versao, ['na_porta', 'pronta', 'agendada'], 'publicada');
    return { leadId, versao, eventoId: ev.eventoId };
  }

  /** O id da decisão `proposta_fora_da_tabela` que uma pessoa respondeu "liberar" para este hash, ou `null`. */
  private async decisaoQueLiberou(orgId: string, r: Rascunho): Promise<string | null> {
    if (!r.decisaoId) return null;
    const d = await this.prisma.comercialDecisao.findFirst({ where: { id: r.decisaoId, orgId, tipo: 'proposta_fora_da_tabela', estado: 'tomada', escolha: 'liberar' } });
    return d && ((d.dados ?? {}) as P).hash === r.hash ? d.id : null;
  }

  // -------------------------------------------------------------------------
  // Segurar, liberar, refazer (rotas)
  // -------------------------------------------------------------------------

  /** "Segurar": a versão sai da agenda e da fila de liberação (o efeito recusa se a aprovação chegar depois). */
  async segurar(orgId: string, leadId: string): Promise<Rascunho> {
    const r = await this.ultimo(orgId, leadId);
    if (!r) throw new NotFoundException('O lead não tem proposta.');
    if (r.estado === 'publicada') throw new ConflictException(`A v${r.versao} já foi publicada: segurar não a tira da sala.`);
    if (r.estado === 'segurada') return r;
    const novo = await this.mudarEstado(orgId, leadId, r.versao, ['pronta', 'agendada', 'na_porta', 'na_fila'], 'segurada');
    if (!novo) throw new ConflictException('A proposta mudou de estado agora; recarregue.');
    return novo;
  }

  /**
   * "Liberar" pedido por uma PESSOA: a versão (pronta ou segurada) vai à porta
   * em nome dela; outra pessoa confirma o R3. Laudo sujo continua indo à fila.
   */
  async liberar(orgId: string, leadId: string, quem: { id: string }): Promise<Rascunho> {
    const r = await this.ultimo(orgId, leadId);
    if (!r) throw new NotFoundException('O lead não tem proposta.');
    if (r.estado === 'segurada') {
      await this.mudarEstado(orgId, leadId, r.versao, ['segurada'], 'pronta', { approvalId: null, publicarEm: null });
    } else if (!['pronta', 'agendada'].includes(r.estado)) {
      throw new ConflictException(`A v${r.versao} está ${r.estado}${r.approvalId ? ` (aprovação ${r.approvalId})` : ''}.`);
    }
    if (r.estado === 'agendada') return this.proporAPorta(orgId, leadId, r.versao, quem, ['agendada']);
    return this.encaminhar(orgId, leadId, r.versao, { automatico: false, quem });
  }

  /**
   * PEDIR DE NOVO a liberação que venceu (rodada do trabalho T7, a partir de
   * /atendimento). Relê a versão VIGENTE: se a vencida era de uma versão que já
   * não é a última, recusa (a vigente se pede no painel do lead). Na porta com a
   * aprovação vencida, vai à porta de novo em nome de quem clicou, com o hash e
   * o conteúdo gravados nesta versão; parada (pronta, agendada, segurada), segue
   * o caminho do botão "liberar".
   */
  async repedirLiberacao(orgId: string, leadId: string, versao: number, vencidaId: string, quem: { id: string }): Promise<Rascunho> {
    const r = await this.ultimo(orgId, leadId);
    if (!r) throw new NotFoundException('O lead não tem proposta.');
    if (r.versao !== versao) {
      throw new ConflictException(`A v${versao} não é mais a vigente: a vigente é a v${r.versao}. Peça a liberação dela no painel do lead.`);
    }
    if (r.estado === 'na_porta') {
      if (r.approvalId && r.approvalId !== vencidaId) {
        throw new ConflictException(`A v${versao} está na fila com outro pedido (${r.approvalId}).`);
      }
      return this.proporAPorta(orgId, leadId, versao, quem, ['na_porta']);
    }
    if (r.estado === 'publicada') throw new ConflictException(`A v${versao} já foi publicada.`);
    if (r.estado === 'na_fila') throw new ConflictException(`A v${versao} espera uma decisão em Pendências.`);
    return this.liberar(orgId, leadId, quem);
  }

  /** Refazer pela rota: monta de novo e encaminha (sem agenda: quem pediu é gente). */
  async refazer(orgId: string, leadId: string, quem: { id: string }, corpo: unknown): Promise<Rascunho> {
    const produto = corpo && typeof corpo === 'object' ? (corpo as P).produto : undefined;
    if (produto !== undefined && (typeof produto !== 'string' || !(produto in TABELA_DE_PRECO))) throw new BadRequestException('Produto desconhecido.');
    try {
      const r = await this.construir(orgId, leadId, { origem: 'manual', produto: (produto as ComercialProduto | undefined) ?? null });
      return this.encaminhar(orgId, leadId, r.versao, { automatico: false, quem });
    } catch (e) {
      if (e instanceof RespostaIlegivelError) throw new ServiceUnavailableException(`${e.message}. Nada foi gravado.`);
      throw e;
    }
  }

  /** O relógio: a versão agendada (silêncio aprova) vai à porta no horário. A porta continua retendo. */
  async soltarAgendadas(orgId: string, agora: Date): Promise<{ levadas: number }> {
    const linhas = await this.prisma.comercialReacao.findMany({ where: { orgId, reacao: REACAO_DO_RASCUNHO, estado: 'agendada' }, take: 50 });
    let levadas = 0;
    for (const l of linhas) {
      const r = this.paraRascunho(l);
      if (!r.publicarEm || new Date(r.publicarEm).getTime() > agora.getTime()) continue;
      try {
        await this.proporAPorta(orgId, l.leadId, r.versao, null, ['agendada']);
        levadas++;
      } catch (e) {
        this.log.warn(`proposta agendada v${r.versao} do lead ${l.leadId} não foi à porta: ${(e as Error).message}`);
      }
    }
    return { levadas };
  }

  // -------------------------------------------------------------------------
  // Ajuste e decisões
  // -------------------------------------------------------------------------

  private async abrirAjuste(orgId: string, leadId: string, eventoId: string, p: PayloadDe<'proposta.ajuste_pedido'>): Promise<unknown> {
    const versao = Number(p.versao);
    const pub = await this.prisma.leadEvent.findFirst({ where: { leadId, orgId, type: 'proposta.publicada' }, orderBy: { occurredAt: 'desc' } });
    const pp = (pub?.payload ?? {}) as P;
    const [lead, lidas] = await Promise.all([
      this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { name: true } }),
      this.prisma.leadEvent.findMany({ where: { leadId, orgId, type: 'proposta.lida' }, select: { payload: true } }),
    ]);
    const daVersao = lidas.map((l) => (l.payload ?? {}) as P).filter((l) => Number(l.versao) === versao);
    const blocos = new Set(daVersao.map((l) => String(l.bloco)));
    const visitas = new Set(daVersao.map((l) => String(l.visita)));
    const { opcoes, padrao } = opcoesDoAjuste(p.descontoPct ?? null);
    const produto = typeof pp.produto === 'string' ? TABELA_DE_PRECO[pp.produto as ComercialProduto]?.rotulo ?? pp.produto : 'a proposta';
    const d = await this.decisoes.abrir({
      orgId,
      leadId,
      tipo: 'pedido_de_ajuste',
      titulo: `${lead?.name ?? 'O lead'} pediu ${p.descontoPct ? `${p.descontoPct}% de desconto` : 'um ajuste'} na ${produto}`,
      contexto: [
        `Pedido: "${String(p.pedido ?? '').slice(0, 300)}".`,
        `Leitura da v${versao}: ${daVersao.length} leitura(s) de bloco, ${blocos.size} bloco(s), ${visitas.size} visita(s).`,
        `Padrão se ninguém responder: manter o preço.`,
      ].join(' '),
      opcoes,
      padrao,
      dados: { versao, descontoPedido: p.descontoPct ?? null, eventoDoPedido: eventoId },
      chave: `ajuste:${eventoId}`,
    });
    return { decisaoId: d.id, nova: d.nova };
  }

  private async aplicarAjuste(d: DecisaoResolvida): Promise<unknown> {
    if (d.escolha === 'manter') return { mantido: true };
    const m = /^desconto:(\d+(?:\.\d+)?)$/.exec(d.escolha);
    if (!m) return { ignorado: d.escolha };
    const pct = Number(m[1]);
    const versaoBase = Number(d.dados.versao);
    const base = await this.daVersao(d.orgId, d.leadId, versaoBase);
    const r = await this.construir(d.orgId, d.leadId, { origem: 'ajuste', produto: base?.conteudo.produto ?? null, descontoAprovado: { pct, decisaoId: d.id } });
    return this.encaminhar(d.orgId, d.leadId, r.versao, { automatico: true });
  }

  private async aplicarForaDaTabela(d: DecisaoResolvida): Promise<unknown> {
    const versao = Number(d.dados.versao);
    if (d.escolha === 'segurar') return this.mudarEstado(d.orgId, d.leadId, versao, ['na_fila'], 'segurada');
    if (d.escolha === 'liberar') {
      // A pessoa decidiu sobre um hash: se a versão mudou depois, a decisão não vale para a nova.
      const atual = await this.daVersao(d.orgId, d.leadId, versao);
      if (!atual || atual.hash !== d.dados.hash) return { obsoleta: 'a versão mudou depois da decisão: nada foi à porta' };
      return this.proporAPorta(d.orgId, d.leadId, versao, null, ['na_fila']);
    }
    return { ignorado: d.escolha };
  }
}
