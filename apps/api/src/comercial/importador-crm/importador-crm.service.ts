import { ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
import { classificar, type Efeito } from '@mktos/policy';
import {
  ESTRUTURA_SUGERIDA,
  IMPORTACAO_CRM_MARCA,
  LeadEntradaSchema,
  TABELA_DE_PRECO,
  formatarReais,
  type ComercialEtapa,
  type TrabEstruturaSugeridaResultado,
} from '@mktos/shared';
import { ActorType, Prisma } from '@prisma/client';

import { temPapelDeMaquina } from '../../approvals/alcada';
import { lerAprovador } from '../../auth/aprovador';
import { exigirAcessoAtual } from '../../memory/acesso-memoria';
import { TrilhoService } from '../../onboarding/trilho/trilho.service';
import { LeadsService } from '../../leads/leads.service';
import { leadIdDaEntrada } from '../../leads/entrada-de-lead';
import { PrismaService } from '../../prisma/prisma.service';
import { criarEstruturaSugerida } from '../../work/estrutura-sugerida';
import { LISTA_DO_COMERCIAL, NOME_DA_LISTA_DO_COMERCIAL, acharOuCriarListaDoComercial, type ListaDoComercial } from '../../work/lista-do-comercial';
import { abrirCardDaImplantacao, cardIdDoLead, travarImplantacaoDoLead } from '../card-da-implantacao';
import { acharOuCriarClienteDoLead } from '../cliente-do-lead';
import { eventoIdComercial, uuidDe } from '../eventos';
import { FichaService } from '../ficha.service';
import { FioService } from '../fio.service';
import { MoverService } from '../mover.service';
import {
  LISTAS_DE_CONTATO_A_TIRAR,
  LISTAS_SOLTAS_QUE_FICAM,
  LISTA_DE_CONTRATOS,
  LISTA_DE_DEMANDAS_GERAIS,
  LISTA_DE_LEADS,
  LISTA_DE_TESTE,
  LISTA_SOLTA_COMERCIAL,
  LISTA_SOLTA_DE_MARKETING,
  PASTA_ADMINISTRATIVA,
  PASTA_DE_MARKETING,
  PASTA_DO_CRM,
  acharLeadDuplicado,
  destinoDaTarefaDoComercial,
  donoPeloVendedor,
  etapaNoDestino,
  MAXIMO_DE_CARTOES_DA_LISTA_DE_CONTATO,
  montarPlano,
  normalizar,
  precisaMover,
  type CartaoDoCrm,
  type CartaoNoPlano,
  type LeadExistente,
  type SobraDoPlano,
} from './plano';

/*
 * O IMPORTADOR DO CRM ANTIGO (rodada de produção 1, 21/10/2026).
 *
 * Leva os cartões das listas `cadastro` da pasta "CRM" do Trabalho para o Comercial:
 * lead e ficha no funil, cliente (`Partner`) e contrato vivo para quem já é cliente,
 * card da implantação para quem está em kickoff ou implantação. Depois arquiva o
 * cartão de origem (nunca apaga) com o link do lead, e, com tudo arquivado, as duas
 * listas e a pasta. Faz também a limpeza que a ata de 21/10 pediu, em etapas
 * separadas: a tarefa da lista solta "Marketing", a lista "Teste teste", a estrutura
 * sugerida (Gestão com Pessoas) e a pasta "Administrativa" vazia. E o adendo: as
 * tarefas da lista solta "Comercial" vão para a lista do comercial (A1; ligadas ao lead
 * que o título cita, pela regra de `plano.ts`, DEPOIS do CRM, porque casam também contra
 * os leads que ele cria), e a lista solta de um contato sai (A2), arquivada.
 *
 * DE GENTE, COM AUDITORIA. Quem roda é uma pessoa da casa (`--como`), relida no banco,
 * com `leads.editar` e `tarefas.editar`; conta de máquina é recusada. Toda escrita leva
 * a marca `importacao.crm` (fato no fio e linha na auditoria) com a pessoa como ator.
 *
 * FATO PASSADO, NÃO ATO COMERCIAL NOVO (decisão do dono do produto, 21/10/2026). Nada
 * vai à porta nem à fila de aprovação: o importador registra o que já aconteceu fora do
 * sistema. Por isso os fatos que ele grava NÃO rodam reação (`semReacoes`), e a projeção
 * na ficha é aplicada à mão: nenhuma mensagem, cobrança, sala publicada, contrato
 * enviado, grupo de WhatsApp ou contrato do Financeiro nasce daqui. O nível sai do
 * efeito pela escada (R0, como o "Iniciar onboarding"); se a conta subir, recusa.
 *
 * IDEMPOTENTE. Cada passo confere antes de escrever (fato com id derivado, card com id
 * derivado do lead, comentário com id derivado do cartão, escrita condicionada). A
 * segunda passada com `valer` não muda nada, e `simular` depois dela dá zero a fazer.
 *
 * O CONSOLE SÓ LEVA CONTAGENS. Títulos e nomes vão para `detalhe`, que o script grava
 * só no arquivo de `--detalhe` (fora do git).
 */

export const EFEITO_DE_IMPORTAR_CRM: Efeito = {
  escreveForaDoOS: false,
  produzArtefato: false,
  reversibilidade: 'automatica',
  exposicaoExterna: false,
  impactoFinanceiro: 'nenhum',
  sensibilidade: 'interna',
  destruicao: false,
  obrigacaoLegal: false,
};

const RECUSA_DE_MAQUINA = 'O importador do CRM é de gente: conta de serviço (IA) não importa.';
const PERMISSOES = ['leads.editar', 'tarefas.editar'];
const AUTOR_DO_IMPORTADOR = 'Importação do CRM antigo';

export const PASSOS_DO_IMPORTADOR = [
  'estrutura',
  'leads.criados',
  'leads.reaproveitados',
  'leads.fato',
  'leads.dono',
  'leads.etapa',
  'clientes.partner',
  'clientes.ativo',
  'contratos.importados',
  'implantacao.trilho',
  'implantacao.card',
  'cartoes.comentario',
  'cartoes.arquivados',
  'crm.listas',
  'crm.pasta',
  'marketing.tarefas',
  'marketing.lista',
  'teste.cartoes',
  'teste.lista',
  'administrativa.pasta',
  // A1: a lista solta "Comercial". `tarefas` conta toda tarefa movida; cada uma é também
  // UMA de `ligadas` (lead que já existe ou que o CRM cria), `leads` (lead criado por ela),
  // `internas` (sem nome citado) ou `ambiguas` (nas sobras, entra sem lead).
  'comercial.destino',
  'comercial.tarefas',
  'comercial.ligadas',
  'comercial.leads',
  'comercial.internas',
  'comercial.ambiguas',
  'comercial.lista',
  // A2: a lista solta de um contato.
  'contato.cartoes',
  'contato.lista',
] as const;
export type PassoDoImportador = (typeof PASSOS_DO_IMPORTADOR)[number];

export interface ContagemDoPasso {
  /** Escrito nesta passada (só com `valer`). */
  feitos: number;
  /** O que a passada escreveria (só no `simular`). */
  aFazer: number;
  /** Já estava como o importador deixa: nada a escrever. */
  jaEstava: number;
}

export interface EfeitosContados {
  mensagens: number;
  aprovacoes: number;
  cobrancas: number;
  documentos: number;
  salas: number;
  salasPublicadas: number;
  contratosDoFinanceiro: number;
  reacoes: number;
  decisoes: number;
}

export interface LinhaDoDetalhe {
  passo: PassoDoImportador | 'sobra';
  item: string;
  acao: string;
  motivo: string;
  id: string;
}

export interface RelatorioDoImportador {
  modo: 'simular' | 'valer';
  crmEncontrado: boolean;
  cartoes: { leads: number; contratos: number; noPlano: number };
  passos: Record<PassoDoImportador, ContagemDoPasso>;
  porDestino: Record<string, number>;
  sobras: number;
  erros: number;
  efeitos: { antes: EfeitosContados; depois: EfeitosContados };
  /** COM TÍTULOS: só para o arquivo de `--detalhe`. */
  detalhe: LinhaDoDetalhe[];
  sobrasDetalhe: SobraDoPlano[];
}

export interface PessoaDoImportador {
  id: string;
  nome: string | null;
  papeis: readonly string[];
}

export interface OpcoesDoImportador {
  valer: boolean;
  /** A origem da web para o link do lead no comentário (`https://os...`); sem ela, o caminho relativo. */
  web?: string | null;
  agora?: Date;
  /** Os ids das listas de contato a tirar (A2). Padrão: `LISTAS_DE_CONTATO_A_TIRAR`; o teste injeta o seu. */
  listasDeContatoATirar?: readonly string[];
}

type Tx = Prisma.TransactionClient;

class Simulacao extends Error {
  constructor(readonly resultado: TrabEstruturaSugeridaResultado) {
    super('simulação: desfeita');
  }
}

class SimulacaoDaLista extends Error {
  constructor(readonly lista: ListaDoComercial) {
    super('simulação: desfeita');
  }
}

/** Uma tarefa da lista solta "Comercial", como o importador a lê. */
interface TarefaDaListaComercial {
  id: string;
  title: string;
  createdAt: Date;
  assigneeUserId: string | null;
  areaId: string | null;
  leadId: string | null;
  status: { name: string; type: string };
}

/** O dia AAAA-MM-DD ao meio-dia de São Paulo (uma data de calendário, sem hora inventada). */
function meioDiaEmSP(dia: string): Date {
  return new Date(`${dia}T12:00:00-03:00`);
}

@Injectable()
export class ImportadorCrmService {
  private readonly log = new Logger('ImportadorCrm');

  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly fichas: FichaService,
    private readonly leads: LeadsService,
    private readonly mover: MoverService,
    @Optional() private readonly trilhos?: TrilhoService,
  ) {}

  /** Gente da casa, relida no banco, ativa, com as duas permissões agora. */
  async conferirPessoa(orgId: string, quem: PessoaDoImportador): Promise<{ id: string; nome: string | null }> {
    if (temPapelDeMaquina(quem.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    const doBanco = await lerAprovador(this.prisma, quem.id, orgId);
    if (!doBanco || !doBanco.ativo) throw new ForbiddenException('Quem importa precisa ser um usuário ativo desta empresa.');
    if (temPapelDeMaquina(doBanco.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    await exigirAcessoAtual(this.prisma, orgId, quem.id, PERMISSOES);
    const u = await this.prisma.user.findFirst({ where: { id: quem.id, orgId }, select: { name: true } });
    return { id: quem.id, nome: u?.name ?? quem.nome };
  }

  async contarEfeitos(orgId: string): Promise<EfeitosContados> {
    const [mensagens, aprovacoes, cobrancas, documentos, salas, salasPublicadas, contratosDoFinanceiro, reacoes, decisoes] = await Promise.all([
      this.prisma.comercialMensagem.count({ where: { orgId } }),
      this.prisma.approval.count({ where: { orgId } }),
      this.prisma.comercialCobranca.count({ where: { orgId } }),
      this.prisma.comercialDocumento.count({ where: { orgId } }),
      this.prisma.salaDoCliente.count({ where: { orgId } }),
      this.prisma.salaVersao.count({ where: { orgId, estado: 'publicada' } }),
      this.prisma.contract.count({ where: { orgId } }),
      this.prisma.comercialReacao.count({ where: { orgId } }),
      this.prisma.comercialDecisao.count({ where: { orgId } }),
    ]);
    return { mensagens, aprovacoes, cobrancas, documentos, salas, salasPublicadas, contratosDoFinanceiro, reacoes, decisoes };
  }

  async executar(orgId: string, quem: PessoaDoImportador, opcoes: OpcoesDoImportador): Promise<RelatorioDoImportador> {
    const nivel = classificar(EFEITO_DE_IMPORTAR_CRM);
    if (nivel !== 'R0' && nivel !== 'R1') throw new ForbiddenException(`Importar o CRM ficou ${nivel} pela escada: precisa de capacidade no catálogo antes de valer.`);
    const pessoa = await this.conferirPessoa(orgId, quem);
    return new Execucao(this, orgId, { ...pessoa, papeis: quem.papeis }, opcoes).rodar();
  }

  /** Só o `simular` roda sem pessoa: nada é escrito, então não há em nome de quem registrar. */
  async executarSemPessoa(orgId: string, opcoes: OpcoesDoImportador & { valer: false }): Promise<RelatorioDoImportador> {
    if (opcoes.valer) throw new ForbiddenException('A passada que escreve precisa de uma pessoa da casa (--como).');
    return new Execucao(this, orgId, { id: '', nome: null, papeis: [] }, { ...opcoes, valer: false }).rodar();
  }

  /** @internal Para a `Execucao`. */
  get deps() {
    return { prisma: this.prisma, fio: this.fio, fichas: this.fichas, leads: this.leads, mover: this.mover, trilhos: this.trilhos, log: this.log };
  }
}

/** Uma passada do importador: o estado dela (contagens, detalhe) e os passos. */
class Execucao {
  private readonly prisma: PrismaService;
  private readonly fio: FioService;
  private readonly fichas: FichaService;
  private readonly leads: LeadsService;
  private readonly mover: MoverService;
  private readonly trilhos?: TrilhoService;
  private readonly agora: Date;
  private readonly valer: boolean;
  private readonly correlationId: string;
  private readonly passos = Object.fromEntries(PASSOS_DO_IMPORTADOR.map((p) => [p, { feitos: 0, aFazer: 0, jaEstava: 0 }])) as Record<PassoDoImportador, ContagemDoPasso>;
  private readonly detalhe: LinhaDoDetalhe[] = [];
  private readonly sobras: SobraDoPlano[] = [];
  private readonly porDestino: Record<string, number> = {};
  private erros = 0;
  private gente: { id: string; nome: string | null }[] = [];

  constructor(
    private readonly svc: ImportadorCrmService,
    private readonly orgId: string,
    private readonly pessoa: { id: string; nome: string | null; papeis: readonly string[] },
    private readonly opcoes: OpcoesDoImportador,
  ) {
    const d = svc.deps;
    this.prisma = d.prisma;
    this.fio = d.fio;
    this.fichas = d.fichas;
    this.leads = d.leads;
    this.mover = d.mover;
    this.trilhos = d.trilhos;
    this.agora = opcoes.agora ?? new Date();
    this.valer = opcoes.valer;
    this.correlationId = uuidDe([orgId, 'importacao-crm', this.agora.toISOString()]);
  }

  // ------------------------------------------------------------------ registro
  private conta(passo: PassoDoImportador, como: 'fazer' | 'ja', item: string, acao: string, id: string, motivo = ''): void {
    if (como === 'ja') this.passos[passo].jaEstava++;
    else if (this.valer) this.passos[passo].feitos++;
    else this.passos[passo].aFazer++;
    this.detalhe.push({ passo, item, acao: como === 'ja' ? `já estava: ${acao}` : this.valer ? acao : `a fazer: ${acao}`, motivo, id });
  }

  private sobra(cartaoId: string, titulo: string, onde: string, motivo: string, acao = 'fica onde está'): void {
    this.sobras.push({ cartaoId, titulo, onde, motivo });
    this.detalhe.push({ passo: 'sobra', item: titulo, acao, motivo, id: cartaoId });
  }

  private async auditar(acao: string, entityType: string, entityId: string, after: Record<string, unknown>, before?: Record<string, unknown>, db: Tx | PrismaService = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        orgId: this.orgId,
        actorType: ActorType.user,
        actorId: this.pessoa.id,
        action: `${IMPORTACAO_CRM_MARCA}.${acao}`,
        entityType,
        entityId,
        ...(before ? { before: before as Prisma.InputJsonValue } : {}),
        after: { ...after, marca: IMPORTACAO_CRM_MARCA } as Prisma.InputJsonValue,
        metadata: { marca: IMPORTACAO_CRM_MARCA, correlationId: this.correlationId, por: this.pessoa.nome } as Prisma.InputJsonValue,
      },
    });
  }

  private linkDoLead(leadId: string): string {
    const base = (this.opcoes.web ?? '').replace(/\/+$/, '');
    return `${base}/comercial/lead/${leadId}`;
  }

  // ------------------------------------------------------------------ a passada
  async rodar(): Promise<RelatorioDoImportador> {
    const antes = await this.svc.contarEfeitos(this.orgId);
    this.gente = (await this.prisma.user.findMany({
      where: { orgId: this.orgId, isActive: true, roles: { none: { key: { in: ['ia_servico', 'ia_acao'] } } } },
      select: { id: true, name: true },
    })).map((u) => ({ id: u.id, nome: u.name }));

    await this.estrutura();
    const crm = await this.lerCrm();
    let noPlano = 0;
    // Os leads que existem, mais os que o CRM cria nesta passada (também no simular, com
    // id `novo:`): é contra eles que a lista Comercial (A1) casa, depois do CRM.
    const leadsExistentes = await this.leadsExistentes();
    if (crm) {
      const plano = montarPlano(crm.cartoes);
      noPlano = plano.cartoes.length;
      for (const s of plano.sobras) this.sobra(s.cartaoId, s.titulo, s.onde, s.motivo);
      const arquivadosNoPlano = new Set<string>();
      for (const c of plano.cartoes) {
        try {
          const feitos = await this.importarCartao(c, leadsExistentes);
          for (const id of feitos) arquivadosNoPlano.add(id);
        } catch (e) {
          this.erros++;
          this.sobra(c.cartao.id, c.cartao.titulo, 'CRM / Gestão de Leads', `erro na importação: ${(e as Error).message}`.slice(0, 300));
        }
      }
      await this.arquivarCrm(crm, arquivadosNoPlano);
    }
    await this.listaComercial(leadsExistentes);
    await this.marketingSolta();
    await this.listaDeTeste();
    await this.listasDeContato();
    await this.administrativa();
    await this.listasSoltasQueSobram();

    const depois = await this.svc.contarEfeitos(this.orgId);
    return {
      modo: this.valer ? 'valer' : 'simular',
      crmEncontrado: !!crm,
      cartoes: { leads: crm?.cartoes.filter((c) => c.lista === LISTA_DE_LEADS).length ?? 0, contratos: crm?.cartoes.filter((c) => c.lista === LISTA_DE_CONTRATOS).length ?? 0, noPlano },
      passos: this.passos,
      porDestino: this.porDestino,
      sobras: this.sobras.length,
      erros: this.erros,
      efeitos: { antes, depois },
      detalhe: this.detalhe,
      sobrasDetalhe: this.sobras,
    };
  }

  // ------------------------------------------------------------------ estrutura sugerida
  /** Pessoas em Gestão; Administrativo e Financeiro soltas movidas para lá. No simular, roda e desfaz. */
  private async estrutura(): Promise<void> {
    let r: TrabEstruturaSugeridaResultado;
    if (this.valer) {
      r = await this.prisma.$transaction((tx) => criarEstruturaSugerida(tx, this.orgId, ESTRUTURA_SUGERIDA), { timeout: 30_000, maxWait: 10_000 });
    } else {
      try {
        await this.prisma.$transaction(async (tx) => {
          throw new Simulacao(await criarEstruturaSugerida(tx, this.orgId, ESTRUTURA_SUGERIDA));
        }, { timeout: 30_000, maxWait: 10_000 });
        throw new Error('a simulação da estrutura não desfez');
      } catch (e) {
        if (!(e instanceof Simulacao)) throw e;
        r = e.resultado;
      }
    }
    for (const p of r.criadas.pastas) this.conta('estrutura', 'fazer', `(pasta) ${p}`, 'criar pasta', '');
    for (const l of r.criadas.listas) this.conta('estrutura', 'fazer', `(lista) ${l}`, 'criar lista', '');
    for (const l of r.movidas?.listas ?? []) this.conta('estrutura', 'fazer', `(lista) ${l}`, 'mover lista solta para a pasta sugerida', '');
    for (const p of r.jaExistiam.pastas) this.conta('estrutura', 'ja', `(pasta) ${p}`, 'pasta', '');
    for (const l of r.jaExistiam.listas) this.conta('estrutura', 'ja', `(lista) ${l}`, 'lista', '');
    if (this.valer && (r.criadas.pastas.length || r.criadas.listas.length || r.movidas?.listas.length)) {
      await this.auditar('estrutura', 'work_folder', this.orgId, { criadas: r.criadas, movidas: r.movidas ?? { listas: [] } });
    }
  }

  // ------------------------------------------------------------------ leitura do CRM
  private async lerCrm(): Promise<{ pastaId: string; listas: { id: string; chave: string; arquivadaEm: Date | null }[]; cartoes: CartaoDoCrm[] } | null> {
    const pasta = (await this.prisma.workFolder.findMany({ where: { orgId: this.orgId, parentId: null }, select: { id: true, name: true } }))
      .find((p) => normalizar(p.name) === PASTA_DO_CRM);
    if (!pasta) return null;
    const listas = (await this.prisma.workList.findMany({ where: { orgId: this.orgId, folderId: pasta.id }, select: { id: true, name: true, natureza: true, arquivadaEm: true } }))
      .map((l) => ({ id: l.id, chave: normalizar(l.name), natureza: l.natureza, arquivadaEm: l.arquivadaEm }));
    const doCrm = listas.filter((l) => (l.chave === LISTA_DE_LEADS || l.chave === LISTA_DE_CONTRATOS) && l.natureza === 'cadastro');
    if (!doCrm.length) return null;
    const tarefas = await this.prisma.workTask.findMany({
      where: { orgId: this.orgId, listId: { in: doCrm.map((l) => l.id) } },
      select: {
        id: true, title: true, description: true, listId: true, parentId: true, archived: true, createdAt: true, assigneeUserId: true,
        status: { select: { name: true } },
        values: { select: { value: true, field: { select: { name: true, type: true } }, option: { select: { name: true } } } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const chaveDaLista = new Map(doCrm.map((l) => [l.id, l.chave]));
    const cartoes: CartaoDoCrm[] = tarefas.map((t) => ({
      id: t.id,
      titulo: t.title,
      descricao: t.description,
      lista: chaveDaLista.get(t.listId) ?? '',
      status: t.status.name,
      parentId: t.parentId,
      archived: t.archived,
      criadoEm: t.createdAt,
      assigneeUserId: t.assigneeUserId,
      campos: t.values.map((v) => ({ nome: v.field.name, tipo: v.field.type, valor: v.option?.name ?? v.value ?? null })),
    }));
    return { pastaId: pasta.id, listas: listas.map((l) => ({ id: l.id, chave: l.chave, arquivadaEm: l.arquivadaEm })), cartoes };
  }

  private async leadsExistentes(): Promise<LeadExistente[]> {
    const leads = await this.prisma.lead.findMany({
      where: { orgId: this.orgId },
      select: { id: true, name: true, ficha: { select: { empresa: true, cnpj: true } } },
      orderBy: [{ enteredAt: 'asc' }, { id: 'asc' }],
    });
    // O contato não mora na ficha: o do cartão do CRM está no fato `lead.importado` (o primeiro).
    const fatos = await this.prisma.leadEvent.findMany({
      where: { type: 'lead.importado', lead: { orgId: this.orgId } },
      select: { leadId: true, payload: true },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    const contatos = new Map<string, string>();
    for (const f of fatos) {
      const c = (f.payload ?? {}) as { contato?: unknown };
      if (typeof c.contato === 'string' && c.contato.trim() && !contatos.has(f.leadId)) contatos.set(f.leadId, c.contato.trim());
    }
    return leads.map((l) => ({ id: l.id, nome: l.name, empresa: l.ficha?.empresa ?? null, cnpj: l.ficha?.cnpj ?? null, contato: contatos.get(l.id) ?? null }));
  }

  /** O comentário de importação deste cartão já existe? (id derivado do cartão) */
  private comentarioId(taskId: string): string {
    return uuidDe([this.orgId, 'importacao-crm-comentario', taskId]);
  }

  // ------------------------------------------------------------------ um cartão
  /** Devolve os ids de cartão que ficaram (ou ficariam) arquivados por esta importação. */
  private async importarCartao(c: CartaoNoPlano, existentes: LeadExistente[]): Promise<string[]> {
    const { cartao, destino, dados } = c;
    const titulo = cartao.titulo;
    const rotuloDoDestino = destino.tipo === 'lead' ? `Funil vivo (${destino.etapa})` : destino.etapaDoCard ? `cliente + implantação (${destino.etapaDoCard})` : 'cliente (só contrato vivo)';
    this.porDestino[rotuloDoDestino] = (this.porDestino[rotuloDoDestino] ?? 0) + 1;

    // Cartão arquivado sem o nosso comentário: alguém arquivou antes. Fica, e o motivo vai às sobras.
    const jaComentado = !!(await this.prisma.workComment.findUnique({ where: { id: this.comentarioId(cartao.id) }, select: { id: true } }));
    if (cartao.archived && !jaComentado) {
      this.sobra(cartao.id, titulo, 'CRM / Gestão de Leads', 'cartão já arquivado antes da importação: fica como está');
      return [];
    }

    // 1. o lead: o da referência do cartão; o que já recebeu este cartão; o duplicado (CNPJ ou nome); ou um novo.
    const ref = `cartao:${cartao.id}`;
    const idDaRef = leadIdDaEntrada(this.orgId, { tipo: 'manual', ref });
    let leadId: string | null = null;
    let reaproveitado: string | null = null;
    if (await this.prisma.lead.findFirst({ where: { id: idDaRef, orgId: this.orgId }, select: { id: true } })) {
      leadId = idDaRef;
      this.conta('leads.criados', 'ja', titulo, 'lead da referência do cartão', leadId);
    }
    if (!leadId) {
      const fato = await this.prisma.leadEvent.findFirst({ where: { type: 'lead.importado', lead: { orgId: this.orgId }, payload: { path: ['origem'], equals: ref } }, select: { leadId: true, payload: true } });
      if (fato) {
        leadId = fato.leadId;
        reaproveitado = String(((fato.payload ?? {}) as { reaproveitado?: unknown }).reaproveitado ?? 'fato');
        this.conta('leads.reaproveitados', 'ja', titulo, `lead existente reaproveitado (${reaproveitado})`, leadId);
      }
    }
    let duplicado = false;
    if (!leadId) {
      const dup = acharLeadDuplicado(dados, existentes);
      if (dup) {
        leadId = dup.id;
        reaproveitado = dup.como;
        duplicado = true;
      }
    }
    const novo = !leadId;
    if (novo) {
      if (!this.valer) {
        this.conta('leads.criados', 'fazer', titulo, 'criar lead pela entrada idempotente', cartao.id);
        existentes.push({ id: `novo:${cartao.id}`, nome: dados.empresa, empresa: dados.empresa, cnpj: dados.cnpj, contato: dados.contato });
        this.contarTudoAFazer(c);
        return this.idsQueArquiva(c);
      }
      leadId = await this.criarLead(c);
      existentes.push({ id: leadId, nome: dados.empresa, empresa: dados.empresa, cnpj: dados.cnpj, contato: dados.contato });
      this.conta('leads.criados', 'fazer', titulo, 'lead criado pela entrada idempotente', leadId);
    } else {
      // O lead reaproveitado ganha o contato do cartão para o casamento da lista Comercial (A1),
      // nas duas passadas igual: o fato que o grava ainda não existe no simular.
      const e = existentes.find((x) => x.id === leadId);
      if (e && !e.contato && dados.contato) e.contato = dados.contato;
    }
    if (!novo && duplicado) {
      if (String(leadId).startsWith('novo:')) {
        // Na simulação, outro cartão desta passada já criaria este lead.
        this.conta('leads.reaproveitados', 'fazer', titulo, `reaproveitar o lead que outro cartão cria (${reaproveitado})`, cartao.id);
        this.contarTudoAFazer(c, true);
        return this.idsQueArquiva(c);
      }
      this.conta('leads.reaproveitados', 'fazer', titulo, `lead existente reaproveitado (${reaproveitado})`, leadId!);
    }
    const id = leadId!;

    if (this.valer) await this.fichas.garantir(this.orgId, id);
    const ficha = await this.prisma.comercialFicha.findFirst({ where: { leadId: id, orgId: this.orgId } });

    // 2. o fato `lead.importado` (projeta empresa, CNPJ, produto e valor só onde a ficha está vazia).
    await this.fatoDoLead(c, id, reaproveitado);
    // 3. o dono.
    await this.dono(c, id, ficha?.donoId ?? null);
    // 4. a etapa.
    if (!(await this.etapaDoLead(c, id))) return [];

    // 5. cliente: Partner, cliente ativo, contratos e (kickoff/implantação) o card.
    const contratosQueFicam = destino.tipo === 'cliente' ? await this.cliente(c, id) : new Set<string>();

    // 6. o cartão de origem (e os contratos): comentário com o link e arquivado.
    await this.fecharCartao(cartao.id, titulo, `Importado para o Comercial: ${this.linkDoLead(id)}`);
    for (const k of c.contratos) {
      if (contratosQueFicam.has(k.cartao.id)) continue;
      await this.fecharCartao(k.cartao.id, k.dados.titulo, `Importado para o Comercial como contrato vivo do cliente: ${this.linkDoLead(id)}?aba=dinheiro`);
    }
    return this.idsQueArquiva(c).filter((x) => !contratosQueFicam.has(x));
  }

  /** Leva o lead à etapa do destino, só para a frente. Falso quando ele está numa saída do funil (vai às sobras). */
  private async etapaDoLead(c: CartaoNoPlano, id: string): Promise<boolean> {
    const { cartao, destino } = c;
    const titulo = cartao.titulo;
    const etapaAtual = ((await this.prisma.comercialFicha.findFirst({ where: { leadId: id, orgId: this.orgId }, select: { etapa: true } }))?.etapa ?? 'novo_lead') as ComercialEtapa;
    const alvo: ComercialEtapa = destino.tipo === 'lead' ? destino.etapa : 'fechado';
    const mover = precisaMover(etapaAtual, alvo);
    if (mover === 'saida') {
      this.sobra(cartao.id, titulo, 'Comercial', `o lead está numa saída do funil (${etapaAtual}): a etapa fica, uma pessoa decide`);
      return false;
    }
    if (mover === 'mover') {
      if (this.valer) {
        const porque = cartao.lista === LISTA_SOLTA_COMERCIAL ? 'tarefa da lista Comercial que cita quem ainda não era lead' : `status do cartão "${cartao.status}"`;
        // A MESMA porta do mover livre da tela (U4): o `MoverService` relê a pessoa e grava por `moverAMao`.
        await this.mover.mover(this.orgId, id, { para: alvo, motivo: `Importação do CRM antigo (${IMPORTACAO_CRM_MARCA}): ${porque}`.slice(0, 400) }, this.pessoa);
        await this.auditar('etapa', 'lead', id, { de: etapaAtual, para: alvo, cartao: `cartao:${cartao.id}` }, { etapa: etapaAtual });
      }
      this.conta('leads.etapa', 'fazer', titulo, `${etapaAtual} → ${alvo}`, id);
    } else {
      this.conta('leads.etapa', 'ja', titulo, mover === 'alem' ? `lead já em ${etapaAtual}, além de ${alvo}: fica` : alvo, id);
    }
    return true;
  }

  private idsQueArquiva(c: CartaoNoPlano): string[] {
    return [c.cartao.id, ...c.contratos.map((k) => k.cartao.id)];
  }

  /** Simulação de um cartão cujo lead ainda não existe: tudo a fazer. */
  private contarTudoAFazer(c: CartaoNoPlano, semFato = false): void {
    const t = c.cartao.titulo;
    if (!semFato) this.conta('leads.fato', 'fazer', t, 'fato lead.importado', c.cartao.id);
    else this.conta('leads.fato', 'fazer', t, 'fato lead.importado no lead reaproveitado', c.cartao.id);
    if (!semFato) this.conta('leads.dono', 'fazer', t, 'dono do lead', c.cartao.id);
    const alvo = c.destino.tipo === 'lead' ? c.destino.etapa : 'fechado';
    this.conta('leads.etapa', 'fazer', t, `novo_lead → ${alvo}`, c.cartao.id);
    if (c.destino.tipo === 'cliente') {
      this.conta('clientes.partner', 'fazer', t, 'achar ou criar o cliente', c.cartao.id);
      this.conta('clientes.ativo', 'fazer', t, 'cliente ativo (importado)', c.cartao.id);
      for (const k of c.contratos) this.conta('contratos.importados', 'fazer', k.dados.titulo, 'contrato vivo importado', k.cartao.id);
      if (c.destino.etapaDoCard) {
        this.conta('implantacao.trilho', 'fazer', t, 'trilho de onboarding', c.cartao.id);
        this.conta('implantacao.card', 'fazer', t, `card em ${c.destino.etapaDoCard}`, c.cartao.id);
      }
    }
    for (const id of this.idsQueArquiva(c)) {
      this.conta('cartoes.comentario', 'fazer', id === c.cartao.id ? t : (c.contratos.find((k) => k.cartao.id === id)?.dados.titulo ?? id), 'comentário com o link do lead', id);
      this.conta('cartoes.arquivados', 'fazer', id === c.cartao.id ? t : (c.contratos.find((k) => k.cartao.id === id)?.dados.titulo ?? id), 'arquivar o cartão', id);
    }
  }

  private async criarLead(c: CartaoNoPlano): Promise<string> {
    const { cartao, dados } = c;
    const dono = this.donoDoCartao(c);
    const input = LeadEntradaSchema.parse({
      origem: { tipo: 'manual', ref: `cartao:${cartao.id}` },
      nome: dados.empresa,
      ...(dados.email ? { email: dados.email } : {}),
      ...(dados.telefone ? { telefone: dados.telefone } : {}),
      ...(dono ? { ownerId: dono } : {}),
    });
    const r = await this.leads.entrada({ orgId: this.orgId, sub: this.pessoa.id, permissions: PERMISSOES }, input);
    if (r.criado) {
      // A data de entrada é a do CRM antigo (o campo de cadastro, ou a criação do cartão): o painel e o
      // relatório da semana não contam como lead novo de hoje o que entrou meses atrás.
      const entrou = dados.cadastradoEm ? meioDiaEmSP(dados.cadastradoEm) : cartao.criadoEm;
      await this.prisma.lead.updateMany({ where: { id: r.id, orgId: this.orgId }, data: { enteredAt: entrou } });
    }
    return r.id;
  }

  /** O responsável do cartão, se é gente ativa; senão o vendedor (primeiro nome, sem ambiguidade); senão quem importa. */
  private donoDoCartao(c: CartaoNoPlano): string {
    const resp = c.cartao.assigneeUserId && this.gente.some((g) => g.id === c.cartao.assigneeUserId) ? c.cartao.assigneeUserId : null;
    return resp ?? donoPeloVendedor(c.dados.vendedor, this.gente) ?? this.pessoa.id;
  }

  private async fatoDoLead(c: CartaoNoPlano, leadId: string, reaproveitado: string | null): Promise<void> {
    const { cartao, dados, destino } = c;
    const ref = `cartao:${cartao.id}`;
    const ja = await this.prisma.leadEvent.findUnique({ where: { id: eventoIdComercial(this.orgId, leadId, 'lead.importado', ref) }, select: { id: true } });
    if (ja) {
      this.conta('leads.fato', 'ja', cartao.titulo, 'fato lead.importado', leadId);
      return;
    }
    if (this.valer) {
      const payload = {
        origem: ref,
        lista: cartao.lista === LISTA_SOLTA_COMERCIAL ? 'Trabalho / Comercial' : 'CRM / Gestão de Leads',
        status: cartao.status,
        destino: destino.tipo === 'lead' ? destino.etapa : 'fechado',
        empresa: dados.empresa,
        contato: dados.contato,
        cnpj: dados.cnpj,
        produto: dados.produto,
        produtoRotulo: dados.produtoRotulo,
        valorCentavos: dados.valorCentavos,
        valorRecorrenteCentavos: dados.valorRecorrenteCentavos,
        reaproveitado,
        por: this.pessoa.nome,
        porId: this.pessoa.id,
        marca: IMPORTACAO_CRM_MARCA,
      };
      const r = await this.fio.registrar(this.orgId, leadId, 'lead.importado', ref, payload, { em: this.agora, semReacoes: true });
      if (r.novo) await this.fichas.aplicar({ eventoId: r.eventoId, orgId: this.orgId, leadId, type: 'lead.importado', payload, em: this.agora });
      await this.auditar('lead', 'lead', leadId, { cartao: ref, eventoId: r.eventoId, reaproveitado, destino: payload.destino });
    }
    this.conta('leads.fato', 'fazer', cartao.titulo, 'fato lead.importado', leadId);
  }

  private async dono(c: CartaoNoPlano, leadId: string, donoAtual: string | null): Promise<void> {
    if (donoAtual) {
      this.conta('leads.dono', 'ja', c.cartao.titulo, 'dono do lead', leadId);
      return;
    }
    if (this.valer) {
      const donoId = this.donoDoCartao(c);
      const nome = this.gente.find((g) => g.id === donoId)?.nome ?? null;
      const payload = { donoId, donoNome: nome, regra: 'importação do CRM antigo: o responsável do cartão, o vendedor do cartão (primeiro nome) ou quem importou' };
      const r = await this.fio.registrar(this.orgId, leadId, 'dono.atribuido', IMPORTACAO_CRM_MARCA, payload, { em: this.agora, semReacoes: true });
      if (r.novo) {
        await this.fichas.aplicar({ eventoId: r.eventoId, orgId: this.orgId, leadId, type: 'dono.atribuido', payload, em: this.agora });
        await this.prisma.lead.updateMany({ where: { id: leadId, orgId: this.orgId, ownerId: null }, data: { ownerId: donoId } });
      }
      await this.auditar('dono', 'lead', leadId, { donoId });
    }
    this.conta('leads.dono', 'fazer', c.cartao.titulo, 'dono do lead', leadId);
  }

  // ------------------------------------------------------------------ cliente
  /** Devolve os contratos que ficaram de fora (arquivados por alguém antes da importação). */
  private async cliente(c: CartaoNoPlano, leadId: string): Promise<Set<string>> {
    const { cartao, dados, destino } = c;
    const ficam = new Set<string>();
    if (destino.tipo !== 'cliente') return ficam;
    const ref = `cartao:${cartao.id}`;
    const titulo = cartao.titulo;

    // Partner (dedupe do `cliente-do-lead.ts`), sob o cadeado da implantação do lead.
    const ficha = await this.prisma.comercialFicha.findFirst({ where: { leadId, orgId: this.orgId } });
    const daFicha = ficha?.partnerId
      ? await this.prisma.partner.findFirst({ where: { id: ficha.partnerId, orgId: this.orgId, isCliente: true, interno: false }, select: { id: true } })
      : null;
    let partnerId = daFicha?.id ?? null;
    if (partnerId) this.conta('clientes.partner', 'ja', titulo, 'cliente ligado ao lead', partnerId);
    else {
      if (this.valer) {
        const lead = await this.prisma.lead.findFirstOrThrow({ where: { id: leadId, orgId: this.orgId }, select: { phone: true, email: true } });
        const achado = await this.prisma.$transaction(async (tx) => {
          await travarImplantacaoDoLead(tx, this.orgId, leadId);
          const r = await acharOuCriarClienteDoLead(tx, this.orgId, { partnerIdDaFicha: null, nome: dados.empresa, cnpj: dados.cnpj, telefone: lead.phone ?? dados.telefone, email: lead.email ?? dados.email });
          await tx.comercialFicha.updateMany({ where: { leadId, orgId: this.orgId }, data: { partnerId: r.id } });
          return r;
        }, { timeout: 30_000, maxWait: 10_000 });
        partnerId = achado.id;
        await this.auditar('cliente', 'partner', achado.id, { leadId, como: achado.como, cartao: ref });
        this.conta('clientes.partner', 'fazer', titulo, `cliente ${achado.como === 'criado' ? 'criado' : `achado (${achado.como})`}`, achado.id);
      } else {
        this.conta('clientes.partner', 'fazer', titulo, 'achar ou criar o cliente', leadId);
      }
    }

    // O cliente ativo: o fato que põe o contrato em Contratos vivos. Importado, sem reação.
    const ativo = await this.prisma.leadEvent.findFirst({ where: { leadId, type: 'cliente.ativo', lead: { orgId: this.orgId } }, select: { id: true } });
    if (ativo) this.conta('clientes.ativo', 'ja', titulo, 'cliente ativo', leadId);
    else {
      if (this.valer) {
        const dias = c.contratos.map((k) => k.dados.fechadoEm).filter((d): d is string => !!d).sort();
        const em = dias.length ? meioDiaEmSP(dias[0]) : cartao.criadoEm;
        const chave = `${IMPORTACAO_CRM_MARCA}:${ref}`;
        const payload = { chave, partnerId, contractId: null, trilhoId: ficha?.trilhoId ?? null, importado: true, origem: ref };
        const r = await this.fio.registrar(this.orgId, leadId, 'cliente.ativo', chave, payload, { em, semReacoes: true });
        if (r.novo) await this.fichas.aplicar({ eventoId: r.eventoId, orgId: this.orgId, leadId, type: 'cliente.ativo', payload, em });
        await this.auditar('cliente_ativo', 'lead', leadId, { cartao: ref, eventoId: r.eventoId, em: em.toISOString(), dataDoFechamento: dias.length ? 'do contrato' : 'criação do cartão' });
      }
      this.conta('clientes.ativo', 'fazer', titulo, 'cliente ativo (importado)', leadId);
    }

    // Cada subtarefa de contrato: um contrato vivo importado, sem PDF e sem parcela.
    for (const k of c.contratos) {
      const refK = `cartao:${k.cartao.id}`;
      const ja = await this.prisma.leadEvent.findUnique({ where: { id: eventoIdComercial(this.orgId, leadId, 'contrato.importado', refK) }, select: { id: true } });
      if (ja) {
        this.conta('contratos.importados', 'ja', k.dados.titulo, 'contrato vivo importado', k.cartao.id);
        continue;
      }
      if (k.cartao.archived && !(await this.prisma.workComment.findUnique({ where: { id: this.comentarioId(k.cartao.id) }, select: { id: true } }))) {
        this.sobra(k.cartao.id, k.dados.titulo, 'CRM / Contratos dos clientes', 'contrato já arquivado antes da importação: fica como está');
        ficam.add(k.cartao.id);
        continue;
      }
      if (this.valer) {
        const payload = {
          origem: refK,
          cartaoDoCliente: ref,
          titulo: k.dados.titulo,
          produto: k.dados.produto,
          produtoRotulo: k.dados.produtoRotulo ?? dados.produtoRotulo,
          valorCentavos: k.dados.valorCentavos,
          fechadoEm: k.dados.fechadoEm,
          semDocumento: true,
          parcelas: '[a decidir]',
          por: this.pessoa.nome,
          porId: this.pessoa.id,
          marca: IMPORTACAO_CRM_MARCA,
        };
        const r = await this.fio.registrar(this.orgId, leadId, 'contrato.importado', refK, payload, { em: k.dados.fechadoEm ? meioDiaEmSP(k.dados.fechadoEm) : this.agora, semReacoes: true });
        await this.auditar('contrato', 'lead', leadId, { cartao: refK, eventoId: r.eventoId, valorCentavos: k.dados.valorCentavos, fechadoEm: k.dados.fechadoEm });
      }
      this.conta('contratos.importados', 'fazer', k.dados.titulo, 'contrato vivo importado', k.cartao.id);
    }

    // O card da implantação (Kickoff e Implantação). Recorrente e Depoimento: só o contrato vivo.
    if (destino.etapaDoCard) await this.cardDaImplantacao(c, leadId, partnerId);
    return ficam;
  }

  private async cardDaImplantacao(c: CartaoNoPlano, leadId: string, partnerId: string | null): Promise<void> {
    const { cartao, dados, destino } = c;
    if (destino.tipo !== 'cliente' || !destino.etapaDoCard) return;
    const titulo = cartao.titulo;
    const cardId = cardIdDoLead(this.orgId, leadId);
    const ficha = await this.prisma.comercialFicha.findFirst({ where: { leadId, orgId: this.orgId } });
    const trilhoExiste = ficha?.trilhoId ? !!(await this.prisma.onboardingTrilho.findFirst({ where: { id: ficha.trilhoId, orgId: this.orgId }, select: { id: true } })) : false;
    const cardExiste = !!(await this.prisma.workTask.findFirst({ where: { id: cardId, orgId: this.orgId }, select: { id: true } }));
    this.conta('implantacao.trilho', trilhoExiste ? 'ja' : 'fazer', titulo, 'trilho de onboarding', ficha?.trilhoId ?? leadId);
    this.conta('implantacao.card', cardExiste ? 'ja' : 'fazer', titulo, `card em ${destino.etapaDoCard}`, cardId);
    if (!this.valer || (trilhoExiste && cardExiste)) return;
    if (!this.trilhos) throw new Error('o serviço do trilho de onboarding não está disponível: o card não foi aberto');
    const trilhos = this.trilhos;
    const lead = await this.prisma.lead.findFirstOrThrow({ where: { id: leadId, orgId: this.orgId }, select: { name: true, phone: true, email: true } });
    const preparo = await trilhos.prepararCriacaoNaTransacao(this.orgId);
    const dono = ficha?.donoId ? this.gente.find((g) => g.id === ficha.donoId)?.nome ?? null : null;
    const produto = dados.produto ? TABELA_DE_PRECO[dados.produto]?.rotulo ?? dados.produtoRotulo ?? '' : dados.produtoRotulo ?? '';
    const r = await this.prisma.$transaction(async (tx) => {
      await travarImplantacaoDoLead(tx, this.orgId, leadId);
      const fichaAgora = await tx.comercialFicha.findFirstOrThrow({ where: { leadId, orgId: this.orgId } });
      let trilhoId = fichaAgora.trilhoId ? (await tx.onboardingTrilho.findFirst({ where: { id: fichaAgora.trilhoId, orgId: this.orgId }, select: { id: true } }))?.id ?? null : null;
      let trilhoNovo = false;
      if (!trilhoId) {
        const t = await trilhos.criarNaTransacao(
          tx,
          this.orgId,
          {
            cliente: dados.empresa,
            contatoNome: dados.contato,
            contatoWhatsapp: lead.phone ?? null,
            contatoEmail: lead.email ?? dados.email,
            perfil: fichaAgora.perfil ?? null,
            reuniaoEm: fichaAgora.reuniaoEm?.toISOString() ?? null,
            observacoes: `Importado do CRM antigo (status "${cartao.status}")${this.pessoa.nome ? `, por ${this.pessoa.nome}` : ''}. Os dados vêm do cartão de lá; o que não existia fica [a decidir].`,
          },
          { id: this.pessoa.id, nome: this.pessoa.nome ?? AUTOR_DO_IMPORTADOR },
          preparo,
        );
        trilhoId = t.id;
        trilhoNovo = true;
        const ligou = await tx.comercialFicha.updateMany({ where: { leadId, orgId: this.orgId, OR: [{ trilhoId: null }, { trilhoId: fichaAgora.trilhoId ?? '' }] }, data: { trilhoId } });
        if (ligou.count !== 1) throw new Error('a ficha do lead ganhou outro trilho no meio do caminho: nada foi criado');
      }
      const card = await abrirCardDaImplantacao(
        tx,
        this.orgId,
        {
          leadId,
          empresa: dados.empresa,
          cnpj: fichaAgora.cnpj ?? dados.cnpj ?? '',
          contato: dados.contato ?? '',
          telefone: lead.phone ?? null,
          email: lead.email ?? dados.email,
          produto,
          valor: dados.valorCentavos ? formatarReais(dados.valorCentavos) : '',
          parcelas: 0,
          forma: '',
          chave: IMPORTACAO_CRM_MARCA,
          trilhoId,
          responsavel: dono,
          clienteId: partnerId ?? fichaAgora.partnerId,
        },
        this.agora,
        { origem: 'importacao', etapa: destino.etapaDoCard!, ator: this.pessoa },
      );
      return { card, trilhoId, trilhoNovo };
    }, { timeout: 30_000, maxWait: 10_000 });
    if (r.card.estado === 'criado') {
      await this.fio.registrar(this.orgId, leadId, 'implantacao.card_criado', r.card.cardId, { chave: IMPORTACAO_CRM_MARCA, cardId: r.card.cardId, listId: r.card.listId, lista: r.card.lista, etapa: r.card.etapa, origem: 'importacao' }, { em: this.agora, semReacoes: true });
    }
    await this.auditar('implantacao', 'work_task', r.card.cardId, { leadId, card: r.card.estado, etapa: r.card.etapa, trilhoId: r.trilhoId, trilhoNovo: r.trilhoNovo });
  }

  // ------------------------------------------------------------------ cartão de origem
  private async fecharCartao(taskId: string, titulo: string, texto: string): Promise<void> {
    const comentarioId = this.comentarioId(taskId);
    const tem = !!(await this.prisma.workComment.findUnique({ where: { id: comentarioId }, select: { id: true } }));
    const t = await this.prisma.workTask.findFirst({ where: { id: taskId, orgId: this.orgId }, select: { archived: true } });
    this.conta('cartoes.comentario', tem ? 'ja' : 'fazer', titulo, 'comentário com o link do lead', taskId);
    this.conta('cartoes.arquivados', t?.archived ? 'ja' : 'fazer', titulo, 'arquivar o cartão', taskId);
    if (!this.valer) return;
    if (!tem) {
      await this.prisma.workComment.createMany({
        data: [{ id: comentarioId, orgId: this.orgId, taskId, authorId: this.pessoa.id, authorName: this.pessoa.nome ?? AUTOR_DO_IMPORTADOR, text: texto.slice(0, 2000) }],
        skipDuplicates: true,
      });
    }
    if (t && !t.archived) {
      const r = await this.prisma.workTask.updateMany({ where: { id: taskId, orgId: this.orgId, archived: false }, data: { archived: true } });
      if (r.count) await this.auditar('cartao_arquivado', 'work_task', taskId, { archived: true }, { archived: false });
    }
  }

  // ------------------------------------------------------------------ listas e pasta do CRM
  private async arquivarCrm(crm: { pastaId: string; listas: { id: string; chave: string; arquivadaEm: Date | null }[]; cartoes: CartaoDoCrm[] }, arquivadosNoPlano: Set<string>): Promise<void> {
    const doCrm = crm.listas.filter((l) => l.chave === LISTA_DE_LEADS || l.chave === LISTA_DE_CONTRATOS);
    let todasArquivadas = true;
    for (const l of doCrm) {
      if (l.arquivadaEm) {
        this.conta('crm.listas', 'ja', `(lista) CRM / ${l.chave}`, 'lista arquivada', l.id);
        continue;
      }
      const tarefas = await this.prisma.workTask.findMany({ where: { orgId: this.orgId, listId: l.id }, select: { id: true, archived: true } });
      const vivas = tarefas.filter((t) => !t.archived && !(!this.valer && arquivadosNoPlano.has(t.id)));
      if (vivas.length) {
        todasArquivadas = false;
        this.sobra(l.id, `(lista) CRM / ${l.chave}`, 'CRM', `${vivas.length} cartão(ões) ficaram (sobras): a lista não é arquivada`);
        continue;
      }
      if (this.valer) {
        const r = await this.prisma.workList.updateMany({ where: { id: l.id, orgId: this.orgId, arquivadaEm: null }, data: { arquivadaEm: this.agora } });
        if (r.count) await this.auditar('lista_arquivada', 'work_list', l.id, { arquivadaEm: this.agora.toISOString(), tarefas: tarefas.length });
      }
      this.conta('crm.listas', 'fazer', `(lista) CRM / ${l.chave}`, 'arquivar a lista', l.id);
    }
    const pasta = await this.prisma.workFolder.findFirst({ where: { id: crm.pastaId, orgId: this.orgId }, select: { arquivadaEm: true } });
    if (pasta?.arquivadaEm) {
      this.conta('crm.pasta', 'ja', '(pasta) CRM', 'pasta arquivada', crm.pastaId);
      return;
    }
    const outras = crm.listas.filter((l) => !doCrm.includes(l) && !l.arquivadaEm).length;
    const filhas = await this.prisma.workFolder.count({ where: { orgId: this.orgId, parentId: crm.pastaId, arquivadaEm: null } });
    if (!todasArquivadas || outras || filhas) {
      this.sobra(crm.pastaId, '(pasta) CRM', 'Trabalho', 'a pasta ainda tem lista viva: fica');
      return;
    }
    if (this.valer) {
      const r = await this.prisma.workFolder.updateMany({ where: { id: crm.pastaId, orgId: this.orgId, arquivadaEm: null }, data: { arquivadaEm: this.agora } });
      if (r.count) await this.auditar('pasta_arquivada', 'work_folder', crm.pastaId, { arquivadaEm: this.agora.toISOString() });
    }
    this.conta('crm.pasta', 'fazer', '(pasta) CRM', 'arquivar a pasta', crm.pastaId);
  }

  // ------------------------------------------------------------------ a lista solta "Comercial" (A1)
  /**
   * As tarefas da lista solta "Comercial" (a da área, sem pasta) vão para a lista do
   * comercial: o MESMO id, a etapa pelo nome ou tipo, a área Comercial e o lead quando o
   * título o cita sem ambiguidade (a regra mora em `plano.ts`). Concluída continua
   * concluída. Sem tarefa ativa, a lista é arquivada (nunca apagada).
   */
  private async listaComercial(existentes: LeadExistente[]): Promise<void> {
    const listas = (await this.prisma.workList.findMany({
      where: { orgId: this.orgId, folderId: null, OR: [{ externalId: null }, { externalId: { not: LISTA_DO_COMERCIAL } }] },
      select: { id: true, name: true, arquivadaEm: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })).filter((l) => normalizar(l.name) === LISTA_SOLTA_COMERCIAL);
    for (const l of listas) {
      if (l.arquivadaEm) {
        this.conta('comercial.lista', 'ja', `(lista) ${l.name}`, 'lista arquivada', l.id);
        continue;
      }
      const tarefas: TarefaDaListaComercial[] = await this.prisma.workTask.findMany({
        where: { orgId: this.orgId, listId: l.id, archived: false },
        select: { id: true, title: true, createdAt: true, assigneeUserId: true, areaId: true, leadId: true, status: { select: { name: true, type: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      let movidas = 0;
      if (tarefas.length) {
        const destino = await this.listaDoComercial();
        for (const t of tarefas) {
          try {
            await this.tarefaDoComercial(t, l.id, destino, existentes);
            movidas++;
          } catch (e) {
            this.erros++;
            this.sobra(t.id, t.title, 'Trabalho / Comercial', `erro na importação: ${(e as Error).message}`.slice(0, 300));
          }
        }
      }
      const vivas = this.valer ? await this.prisma.workTask.count({ where: { orgId: this.orgId, listId: l.id, archived: false } }) : tarefas.length - movidas;
      if (vivas) {
        this.sobra(l.id, `(lista) ${l.name}`, 'Trabalho', `${vivas} tarefa(s) ativa(s) ficaram na lista: ela não é arquivada`);
        continue;
      }
      if (this.valer) {
        const r = await this.prisma.workList.updateMany({ where: { id: l.id, orgId: this.orgId, arquivadaEm: null }, data: { arquivadaEm: this.agora } });
        if (r.count) await this.auditar('lista_arquivada', 'work_list', l.id, { arquivadaEm: this.agora.toISOString(), tarefasMovidas: movidas, motivo: 'lista solta Comercial: as tarefas foram para o Comercial (adendo A1)' });
      }
      this.conta('comercial.lista', 'fazer', `(lista) ${l.name}`, 'arquivar a lista sem tarefa ativa', l.id);
    }
  }

  /** A lista do comercial (acha ou cria). No simular, cria numa transação desfeita, como a estrutura. */
  private async listaDoComercial(): Promise<ListaDoComercial> {
    let l: ListaDoComercial;
    if (this.valer) {
      l = await acharOuCriarListaDoComercial(this.prisma, this.orgId);
      if (l.criada) await this.auditar('lista_do_comercial', 'work_list', l.id, { nome: NOME_DA_LISTA_DO_COMERCIAL, externalId: LISTA_DO_COMERCIAL, areaId: l.areaId });
    } else {
      try {
        await this.prisma.$transaction(async (tx) => {
          throw new SimulacaoDaLista(await acharOuCriarListaDoComercial(tx, this.orgId));
        }, { timeout: 30_000, maxWait: 10_000 });
        throw new Error('a simulação da lista do comercial não desfez');
      } catch (e) {
        if (!(e instanceof SimulacaoDaLista)) throw e;
        l = e.lista;
      }
    }
    this.conta('comercial.destino', l.criada ? 'fazer' : 'ja', `(lista) ${NOME_DA_LISTA_DO_COMERCIAL}`, 'criar a lista do comercial', l.id);
    return l;
  }

  private async tarefaDoComercial(t: TarefaDaListaComercial, origemId: string, destino: ListaDoComercial, existentes: LeadExistente[]): Promise<void> {
    const concluida = t.status.type === 'closed';
    const etapa = etapaNoDestino(destino.statuses, t.status);
    if (!etapa) throw new Error('a lista do comercial está sem etapas');
    // Lead criado por esta tarefa numa passada que caiu no meio: segue por ele (cada passo confere).
    const idDaRef = leadIdDaEntrada(this.orgId, { tipo: 'manual', ref: `cartao:${t.id}` });
    const jaCriado = await this.prisma.lead.findFirst({ where: { id: idDaRef, orgId: this.orgId }, select: { name: true } });
    const d = jaCriado ? { tipo: 'criar' as const, nome: jaCriado.name } : destinoDaTarefaDoComercial(t.title, concluida, existentes);

    let leadId: string | null = null;
    let motivo: string;
    if (d.tipo === 'lead') {
      leadId = d.leadId;
      motivo = `cita "${d.citado}" (${d.como === 'igual' ? 'nome igual ao do lead' : 'começa pelo nome do lead'})`;
      this.conta('comercial.ligadas', 'fazer', t.title, leadId.startsWith('novo:') ? 'ligar ao lead que o CRM cria nesta passada' : 'ligar ao lead', leadId, motivo);
    } else if (d.tipo === 'criar') {
      leadId = await this.leadDaTarefa(t, d.nome, existentes);
      motivo = `cita "${d.nome}", que não era lead: lead criado em Qualificação`;
    } else if (d.tipo === 'ambigua') {
      motivo = `cita "${d.citado}": ${d.motivo}`;
      this.sobra(t.id, t.title, 'Trabalho / Comercial', motivo, 'entra como tarefa do comercial sem lead');
      this.conta('comercial.ambiguas', 'fazer', t.title, 'tarefa do comercial sem lead (ambígua)', t.id, motivo);
    } else {
      motivo = d.motivo;
      this.conta('comercial.internas', 'fazer', t.title, 'tarefa do comercial sem lead', t.id, motivo);
    }

    if (this.valer) {
      const r = await this.prisma.workTask.updateMany({
        where: { id: t.id, orgId: this.orgId, listId: origemId },
        data: { listId: destino.id, statusId: etapa.id, areaId: destino.areaId, ...(leadId ? { leadId } : {}) },
      });
      if (r.count) {
        await this.auditar(
          'tarefa_do_comercial',
          'work_task',
          t.id,
          { listId: destino.id, status: etapa.name, areaId: destino.areaId, leadId: leadId ?? t.leadId, regra: d.tipo, concluida },
          { listId: origemId, status: t.status.name, areaId: t.areaId, leadId: t.leadId },
        );
      }
    }
    this.conta('comercial.tarefas', 'fazer', t.title, `mover para ${NOME_DA_LISTA_DO_COMERCIAL} (${etapa.name})${leadId ? ', ligada ao lead' : ', sem lead'}`, t.id, motivo);
  }

  /**
   * O lead que a tarefa cita e que não existia: criado em Qualificação pelo MESMO caminho
   * dos leads do CRM (entrada idempotente com a origem `cartao:<id da tarefa>`, fato
   * `lead.importado` sem reação, dono, mover livre). Fato passado: nada vai à porta.
   */
  private async leadDaTarefa(t: TarefaDaListaComercial, nome: string, existentes: LeadExistente[]): Promise<string> {
    const c: CartaoNoPlano = {
      cartao: { id: t.id, titulo: t.title, descricao: null, lista: LISTA_SOLTA_COMERCIAL, status: t.status.name, parentId: null, archived: false, criadoEm: t.createdAt, assigneeUserId: t.assigneeUserId, campos: [] },
      destino: { tipo: 'lead', etapa: 'qualificacao' },
      dados: { empresa: nome, contato: null, telefone: null, email: null, cnpj: null, produto: null, produtoRotulo: null, valorCentavos: null, valorRecorrenteCentavos: null, cadastradoEm: null, vendedor: null },
      contratos: [],
    };
    const idDaRef = leadIdDaEntrada(this.orgId, { tipo: 'manual', ref: `cartao:${t.id}` });
    const existe = await this.prisma.lead.findFirst({ where: { id: idDaRef, orgId: this.orgId }, select: { id: true } });
    if (!existe && !this.valer) {
      const id = `novo:${t.id}`;
      this.conta('comercial.leads', 'fazer', nome, 'criar lead em Qualificação', t.id, t.title);
      this.conta('leads.fato', 'fazer', nome, 'fato lead.importado', t.id);
      this.conta('leads.dono', 'fazer', nome, 'dono do lead', t.id);
      this.conta('leads.etapa', 'fazer', nome, 'novo_lead → qualificacao', t.id);
      existentes.push({ id, nome, empresa: nome, cnpj: null, contato: null });
      return id;
    }
    let id: string;
    if (existe) {
      id = existe.id;
      this.conta('comercial.leads', 'ja', nome, 'lead da referência da tarefa', id, t.title);
    } else {
      id = await this.criarLead(c);
      this.conta('comercial.leads', 'fazer', nome, 'lead criado em Qualificação', id, t.title);
    }
    if (!existentes.some((x) => x.id === id)) existentes.push({ id, nome, empresa: nome, cnpj: null, contato: null });
    if (this.valer) await this.fichas.garantir(this.orgId, id);
    const ficha = await this.prisma.comercialFicha.findFirst({ where: { leadId: id, orgId: this.orgId }, select: { donoId: true } });
    await this.fatoDoLead(c, id, null);
    await this.dono(c, id, ficha?.donoId ?? null);
    await this.etapaDoLead(c, id);
    return id;
  }

  // ------------------------------------------------------------------ a lista solta de um contato (A2)
  /** A lista solta de um contato que a ata manda tirar (pelo id): cartões e lista arquivados, como a "Teste teste". */
  private async listasDeContato(): Promise<void> {
    const ids = [...new Set(this.opcoes.listasDeContatoATirar ?? LISTAS_DE_CONTATO_A_TIRAR)];
    if (!ids.length) return;
    const listas = await this.prisma.workList.findMany({ where: { orgId: this.orgId, id: { in: ids }, folderId: null }, select: { id: true, name: true, arquivadaEm: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    for (const l of listas) {
      const tarefas = await this.prisma.workTask.findMany({ where: { orgId: this.orgId, listId: l.id }, select: { id: true, title: true, archived: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      // A ata viu um cartão de lixo. Se a lista cresceu, há trabalho de verdade nela: fica, e vai às sobras.
      const ativos = tarefas.filter((t) => !t.archived).length;
      if (ativos > MAXIMO_DE_CARTOES_DA_LISTA_DE_CONTATO) {
        this.sobra(l.id, `(lista) ${l.name}`, 'Sem pasta', `a lista do contato tem ${ativos} cartões ativos, mais do que a ata viu: fica onde está; o Rodrigo decide`);
        continue;
      }
      for (const t of tarefas) {
        if (t.archived) {
          this.conta('contato.cartoes', 'ja', t.title, 'cartão arquivado', t.id);
          continue;
        }
        if (this.valer) {
          await this.prisma.workComment.createMany({
            data: [{ id: this.comentarioId(t.id), orgId: this.orgId, taskId: t.id, authorId: this.pessoa.id, authorName: this.pessoa.nome ?? AUTOR_DO_IMPORTADOR, text: 'Arquivado na importação do CRM antigo: a lista solta deste contato não tinha trabalho a fazer (ata de 21/10/2026). Nada foi apagado.' }],
            skipDuplicates: true,
          });
          const r = await this.prisma.workTask.updateMany({ where: { id: t.id, orgId: this.orgId, archived: false }, data: { archived: true } });
          if (r.count) await this.auditar('cartao_arquivado', 'work_task', t.id, { archived: true, motivo: 'lista solta de um contato (ata de 21/10)' }, { archived: false });
        }
        this.conta('contato.cartoes', 'fazer', t.title, 'arquivar o cartão', t.id);
      }
      if (l.arquivadaEm) {
        this.conta('contato.lista', 'ja', `(lista) ${l.name}`, 'lista arquivada', l.id);
        continue;
      }
      if (this.valer) {
        const r = await this.prisma.workList.updateMany({ where: { id: l.id, orgId: this.orgId, arquivadaEm: null }, data: { arquivadaEm: this.agora } });
        if (r.count) await this.auditar('lista_arquivada', 'work_list', l.id, { arquivadaEm: this.agora.toISOString(), tarefas: tarefas.length, motivo: 'lista solta de um contato (a regra da casa: com tarefa arquivada, arquivar; nunca apagar)' });
      }
      this.conta('contato.lista', 'fazer', `(lista) ${l.name}`, 'arquivar a lista', l.id);
    }
  }

  // ------------------------------------------------------------------ limpeza da ata
  private async listasSoltasPorNome(chave: string) {
    return (await this.prisma.workList.findMany({ where: { orgId: this.orgId, folderId: null }, select: { id: true, name: true, arquivadaEm: true } }))
      .filter((l) => normalizar(l.name) === chave);
  }

  /** A tarefa real da lista solta "Marketing" vai para Demandas internas / Marketing › Demandas gerais; a lista vazia é arquivada. */
  private async marketingSolta(): Promise<void> {
    const soltas = await this.listasSoltasPorNome(LISTA_SOLTA_DE_MARKETING);
    if (!soltas.length) return;
    const pastas = await this.prisma.workFolder.findMany({ where: { orgId: this.orgId, arquivadaEm: null }, select: { id: true, name: true, parentId: true } });
    const destinoPasta = pastas.find((p) => normalizar(p.name) === PASTA_DE_MARKETING)
      ?? pastas.find((p) => normalizar(p.name) === 'marketing' && !!p.parentId && normalizar(pastas.find((x) => x.id === p.parentId)?.name) === 'demandas internas');
    const destino = destinoPasta
      ? (await this.prisma.workList.findMany({ where: { orgId: this.orgId, folderId: destinoPasta.id, arquivadaEm: null }, select: { id: true, name: true } })).find((l) => normalizar(l.name) === LISTA_DE_DEMANDAS_GERAIS)
      : undefined;
    const etapasDoDestino = destino ? await this.prisma.workStatus.findMany({ where: { orgId: this.orgId, listId: destino.id }, orderBy: { order: 'asc' }, select: { id: true, name: true, type: true } }) : [];
    for (const l of soltas) {
      if (l.arquivadaEm) {
        this.conta('marketing.lista', 'ja', `(lista) ${l.name}`, 'lista arquivada', l.id);
        continue;
      }
      const tarefas = await this.prisma.workTask.findMany({ where: { orgId: this.orgId, listId: l.id }, select: { id: true, title: true, status: { select: { name: true, type: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      if (tarefas.length && (!destino || !etapasDoDestino.length)) {
        this.sobra(l.id, `(lista) ${l.name}`, 'Sem pasta', 'a lista Demandas gerais da pasta de marketing não foi achada: a tarefa e a lista ficam');
        continue;
      }
      for (const t of tarefas) {
        const etapa = etapaNoDestino(etapasDoDestino, t.status)!;
        if (this.valer) {
          const r = await this.prisma.workTask.updateMany({ where: { id: t.id, orgId: this.orgId, listId: l.id }, data: { listId: destino!.id, statusId: etapa.id } });
          if (r.count) await this.auditar('tarefa_movida', 'work_task', t.id, { listId: destino!.id, status: etapa.name }, { listId: l.id, status: t.status.name });
        }
        this.conta('marketing.tarefas', 'fazer', t.title, `mover para Demandas gerais (${etapa.name})`, t.id);
      }
      if (this.valer) {
        const restam = await this.prisma.workTask.count({ where: { orgId: this.orgId, listId: l.id } });
        if (restam) {
          this.sobra(l.id, `(lista) ${l.name}`, 'Sem pasta', `${restam} tarefa(s) ainda na lista: não foi arquivada`);
          continue;
        }
        const r = await this.prisma.workList.updateMany({ where: { id: l.id, orgId: this.orgId, arquivadaEm: null }, data: { arquivadaEm: this.agora } });
        if (r.count) await this.auditar('lista_arquivada', 'work_list', l.id, { arquivadaEm: this.agora.toISOString(), motivo: 'lista solta de marketing vazia (a regra da casa: arquivar, nunca apagar)' });
      }
      this.conta('marketing.lista', 'fazer', `(lista) ${l.name}`, 'arquivar a lista vazia', l.id);
    }
  }

  /** "Teste teste": os cartões são arquivados (com o porquê) e a lista também. */
  private async listaDeTeste(): Promise<void> {
    const listas = (await this.prisma.workList.findMany({ where: { orgId: this.orgId }, select: { id: true, name: true, arquivadaEm: true } }))
      .filter((l) => normalizar(l.name) === LISTA_DE_TESTE);
    for (const l of listas) {
      const tarefas = await this.prisma.workTask.findMany({ where: { orgId: this.orgId, listId: l.id }, select: { id: true, title: true, archived: true } });
      for (const t of tarefas) {
        if (t.archived) {
          this.conta('teste.cartoes', 'ja', t.title, 'cartão arquivado', t.id);
          continue;
        }
        if (this.valer) {
          await this.prisma.workComment.createMany({
            data: [{ id: this.comentarioId(t.id), orgId: this.orgId, taskId: t.id, authorId: this.pessoa.id, authorName: this.pessoa.nome ?? AUTOR_DO_IMPORTADOR, text: 'Arquivado na importação do CRM antigo: a lista "Teste teste" era de teste (ata de 21/10/2026). Nada foi apagado.' }],
            skipDuplicates: true,
          });
          const r = await this.prisma.workTask.updateMany({ where: { id: t.id, orgId: this.orgId, archived: false }, data: { archived: true } });
          if (r.count) await this.auditar('cartao_arquivado', 'work_task', t.id, { archived: true, motivo: 'lista de teste' }, { archived: false });
        }
        this.conta('teste.cartoes', 'fazer', t.title, 'arquivar o cartão de teste', t.id);
      }
      if (l.arquivadaEm) {
        this.conta('teste.lista', 'ja', `(lista) ${l.name}`, 'lista arquivada', l.id);
        continue;
      }
      if (this.valer) {
        const r = await this.prisma.workList.updateMany({ where: { id: l.id, orgId: this.orgId, arquivadaEm: null }, data: { arquivadaEm: this.agora } });
        if (r.count) await this.auditar('lista_arquivada', 'work_list', l.id, { arquivadaEm: this.agora.toISOString(), motivo: 'lista de teste (a regra da casa: arquivar, nunca apagar)' });
      }
      this.conta('teste.lista', 'fazer', `(lista) ${l.name}`, 'arquivar a lista de teste', l.id);
    }
  }

  /** A pasta "Administrativa" de topo, sem lista viva e sem pasta viva dentro: arquivada. */
  private async administrativa(): Promise<void> {
    const pastas = (await this.prisma.workFolder.findMany({ where: { orgId: this.orgId, parentId: null }, select: { id: true, name: true, arquivadaEm: true } }))
      .filter((p) => normalizar(p.name) === PASTA_ADMINISTRATIVA);
    for (const p of pastas) {
      if (p.arquivadaEm) {
        this.conta('administrativa.pasta', 'ja', `(pasta) ${p.name}`, 'pasta arquivada', p.id);
        continue;
      }
      const [listas, filhas] = await Promise.all([
        this.prisma.workList.count({ where: { orgId: this.orgId, folderId: p.id, arquivadaEm: null } }),
        this.prisma.workFolder.count({ where: { orgId: this.orgId, parentId: p.id, arquivadaEm: null } }),
      ]);
      if (listas || filhas) {
        this.sobra(p.id, `(pasta) ${p.name}`, 'Trabalho', `a pasta tem ${listas} lista(s) e ${filhas} pasta(s) viva(s): fica; o Rodrigo decide`);
        continue;
      }
      if (this.valer) {
        const r = await this.prisma.workFolder.updateMany({ where: { id: p.id, orgId: this.orgId, arquivadaEm: null }, data: { arquivadaEm: this.agora } });
        if (r.count) await this.auditar('pasta_arquivada', 'work_folder', p.id, { arquivadaEm: this.agora.toISOString(), motivo: 'pasta Administrativa vazia: saiu da estrutura sugerida' });
      }
      this.conta('administrativa.pasta', 'fazer', `(pasta) ${p.name}`, 'arquivar a pasta vazia', p.id);
    }
  }

  /** Listas soltas que ninguém tocou e que não são Comercial nem Operação: ficam, e vão às sobras. */
  private async listasSoltasQueSobram(): Promise<void> {
    const tratadas = new Set([LISTA_SOLTA_DE_MARKETING, LISTA_DE_TESTE, LISTA_SOLTA_COMERCIAL, ...LISTAS_SOLTAS_QUE_FICAM]);
    const deContato = new Set(this.opcoes.listasDeContatoATirar ?? LISTAS_DE_CONTATO_A_TIRAR);
    const daEstrutura = new Set(ESTRUTURA_SUGERIDA.flatMap((p) => p.listas.map((l) => normalizar(l.nome))));
    const soltas = await this.prisma.workList.findMany({ where: { orgId: this.orgId, folderId: null, spaceId: null, arquivadaEm: null }, select: { id: true, name: true } });
    for (const l of soltas) {
      const n = normalizar(l.name);
      // No simular, as listas da estrutura ainda soltas seriam movidas pela estrutura sugerida;
      // a de contato e a Comercial (com tarefa que sobrou) já foram tratadas acima.
      if (tratadas.has(n) || deContato.has(l.id) || (!this.valer && daEstrutura.has(n))) continue;
      this.sobra(l.id, `(lista) ${l.name}`, 'Sem pasta', 'lista solta fora da estrutura (parece teste): fica onde está; o Rodrigo decide');
    }
  }
}
