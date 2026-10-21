import { Inject, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { COMERCIAL_FATOS_DA_PRIMEIRA_PAGA, TABELA_DE_PRECO, formatarReais, type ContratoAnexadoNaTela, type ConteudoDoFechamento, type EscritaDoFechamento, type FechamentoDoLead } from '@mktos/shared';
import { ActorType, FinanceTxType, Prisma } from '@prisma/client';

import { PASTA_DO_CLIENTE, type PastaDoClientePort } from '../clientes/portas';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { InterruptoresRegistry } from '../gateway/interruptores.registry';
import { PortaDoOperador } from '../gateway/porta-do-operador.service';
import { TrilhoService } from '../onboarding/trilho/trilho.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigComercialService } from './config.service';
import { DecisoesRegistry, DecisoesService, type DecisaoResolvida } from './decisoes.service';
import { DinheiroService, hojeEmSP, venceComoData, type AceiteDoLead } from './dinheiro.service';
import { AUTOR_DO_FECHAMENTO, abrirCardDaImplantacao, travarImplantacaoDoLead } from './card-da-implantacao';
import { eventoIdComercial, uuidDe } from './eventos';
import { SO_DOCUMENTOS_DE_ASSINATURA } from './documentos';
import { aceiteDaDeclaracao, chaveDoAnexo, parcelasDoContratoFora } from './fechado-fora';
import { FioService, ReacoesRegistry } from './fio.service';
import { RelogioComercialRegistry } from './relogio.registry';
import { WhatsappComercialService } from './whatsapp.service';

/*
 * O FECHAMENTO (lane D, 13/10/2026) — tela 10, as cinco escritas com chave.
 *
 * Assinado pelos dois e com a 1ª parcela paga, o lead fecha: cliente
 * (`Partner`), contrato no Financeiro (`Contract`), cobrança (porta do
 * Asaas), kit e trilho de implantação (`TrilhoService`) e o grupo do cliente
 * no WhatsApp. A chave é `fech-<leadId>-v<versão aceita>` (`ComercialFechamento`):
 * rodar de novo com a mesma chave reaproveita o que já foi criado e só tenta o
 * que ficou em erro. Cada escrita grava `fechamento.escrita`; com cliente,
 * contrato e cobrança em pé, `cliente.ativo` grava a data que a conta do mês lê.
 *
 * A RÉGUA. `comercial.fechamento.executar` é R4 (a cobrança é obrigação
 * financeira). Quem dispara é a reação: quando `pix.pago` (1ª parcela),
 * `contrato.assinado_cliente` e `contrato.assinado_root` estão todos no fio,
 * o sistema PROPÕE à porta e a titular assina em `/atendimento` (senha e
 * motivo). Isso não é configurável.
 *
 * O INTERRUPTOR `ComercialConfig.fechamentoAutomatico` (K08-2, padrão falso):
 *   · desligado (regra vigente): a proposta vai à porta assim que os três
 *     fatos estão no fio. Um toque: a assinatura da titular.
 *   · ligado: ANTES de propor abre a decisão `veto_de_fechamento` (opções
 *     "seguir" e "vetar", padrão "seguir") com prazo de `janelaDeVetoMinutos`.
 *     Venceu sem resposta ou "seguir": propõe à porta. "Vetar": nada é
 *     proposto, o fechamento fica `vetado` e volta só pelo "rodar de novo".
 *     A assinatura R4 da titular CONTINUA exigida depois da janela: o
 *     interruptor dá à mesa o aviso e o veto da tela 09, não tira a régua.
 *
 * O CARD DA IMPLANTAÇÃO (rodada da implantação I1, 18/10/2026) é a sexta
 * escrita: depois do trilho, o card do cliente nasce na lista "Onboarding de
 * cliente" (pasta Clientes) com os dados copiados e os retrolinks card ↔ lead
 * ↔ trilho. Regra em `card-da-implantacao.ts`; o fato `implantacao.card_criado`
 * vai ao fio. Rodar de novo acha o card pelo id derivado do lead.
 *
 * O GRUPO E A M8. O grupo é criado pela porta do WhatsApp (no simulado, um
 * jid local), depois de perguntar ao interruptor do conector `whatsapp` (D-6):
 * desligado em Conexões, a escrita do grupo fica em erro com o motivo. A boas-vindas (M8) é outra capacidade (`comercial.whatsapp.enviar`,
 * R3) e vai à fila como toda mensagem; ela precisa do horário do kickoff, que
 * o cliente escolhe na sala depois do fechamento, então nasce na reação a
 * `kickoff.marcado`. Quem entra no grupo é [a decidir] pela mesa.
 *
 * QUEM FECHOU FORA DO SISTEMA (rodada do trabalho T1b, 19/10/2026). Sem aceite
 * na sala, o fechamento lê o aceite DECLARADO (`aceite.declarado`, com o PDF do
 * contrato assinado em `contrato.anexado`; ver `fechado-fora.ts`). A chave, a
 * capacidade (R4), a porta e as seis escritas são as mesmas. Muda: a prontidão
 * é o aceite declarado com o PDF anexado (não há Pix nem ZapSign a esperar); o
 * sistema nunca propõe sozinho (os fatos foram declarados por uma pessoa); quem
 * registrou não assina o próprio registro, nem pela fila; a cobrança só nasce
 * com a pessoa marcando (sem marcar, a escrita fica `pulado` com o motivo); e o
 * contrato do Financeiro conta as parcelas do 1º vencimento declarado e guarda
 * o PDF anexado como o documento assinado.
 *
 * A PASTA DO CLIENTE (rodada dos agentes, 21/10/2026, CO-10) é a sétima escrita,
 * DEPOIS do card e fora de qualquer transação do banco: a porta
 * `PASTA_DO_CLIENTE` (lane do Drive) cria `10-clientes/<nome do cliente>` pela
 * capacidade `drive.pasta.criar` (R3). Idempotente pelo ponteiro
 * `Partner.pastaDriveId`: com ele, nem chama a porta. A falha do Drive NÃO
 * derruba o fechamento: a escrita fica `erro` com o motivo (`aguardando_aprovacao`
 * quando a porta reteve, `pulado` sem raiz configurada) e o fechamento conclui
 * com as outras seis; "Criar pasta de novo" é o componente `PastaDoCliente`, pela
 * rota da lane do Drive. As outras duas portas do card usam a mesma porta:
 * "Iniciar onboarding" (`onboarding-antecipado.service.ts`, origem
 * `onboarding-antecipado`) e "Registrar cliente já fechado" (o fechamento de
 * quem fechou fora roda AQUI, com a origem `fechado-fora`).
 */

export const CAP_FECHAMENTO = 'comercial.fechamento.executar';
const ATOR = 'comercial';
const ESCRITAS: EscritaDoFechamento['escrita'][] = ['cliente', 'contrato', 'cobranca', 'kit_e_trilho', 'card', 'grupo', 'pasta'];
const ONDE: Record<EscritaDoFechamento['escrita'], string> = {
  cliente: 'CRM do OS',
  contrato: 'Financeiro do OS',
  cobranca: 'Asaas',
  kit_e_trilho: 'Implantação',
  card: 'Trabalho',
  grupo: 'WhatsApp',
  pasta: 'Google Drive',
};
const SE_RODAR_DE_NOVO: Record<EscritaDoFechamento['escrita'], string> = {
  cliente: 'reaproveita o da ficha ou pelo CNPJ',
  contrato: 'reaproveita pela chave',
  cobranca: 'não cria outra',
  kit_e_trilho: 'reaproveita',
  card: 'acha o mesmo card (também o iniciado antes do fechamento)',
  grupo: 'não cria outro',
  pasta: 'liga a que já existe (ponteiro do cliente ou pasta de mesmo nome)',
};
/** CO-10: a escrita que não segura o fechamento (o Drive fora do ar não deixa o cliente sem contrato). */
const ESCRITAS_QUE_NAO_SEGURAM: ReadonlySet<EscritaDoFechamento['escrita']> = new Set(['pasta']);
const FASES_DO_TRILHO = ['qualificar', 'diagnostico', 'contrato', 'imersao', 'operacao'];
/**
 * D-7: um fechamento em curso há mais que isto é dado por parado (o processo
 * caiu no meio) e pode ser tomado de novo.
 */
export const FECHAMENTO_PARADO_MS = 15 * 60_000;
/** Quem entra no grupo do cliente é decisão da mesa: até lá a M8 sai com a lacuna à vista de quem libera o envio. */
export const EQUIPE_A_DECIDIR = '[a decidir: quem entra no grupo]';

type P = Record<string, unknown>;

export function chaveDoFechamento(leadId: string, versao: number): string {
  return `fech-${leadId}-v${versao}`;
}

export function escritasVazias(): EscritaDoFechamento[] {
  return ESCRITAS.map((escrita) => ({ escrita, onde: ONDE[escrita], estado: 'pendente', detalhe: '', ms: null, seRodarDeNovo: SE_RODAR_DE_NOVO[escrita], ref: null }));
}

function ehRetida(r: unknown): r is { status: 'aguardando_aprovacao'; approvalId: string } {
  return !!r && typeof r === 'object' && (r as P).status === 'aguardando_aprovacao';
}

/** Os três fatos que liberam o fechamento estão no fio? */
export function prontoParaFechar(tipos: ReadonlySet<string>): { pronto: boolean; falta: string[] } {
  const falta: string[] = [];
  // D-10: a 1ª parcela paga tem o nome da forma (Pix, boleto ou cartão); qualquer uma das três vale.
  if (!COMERCIAL_FATOS_DA_PRIMEIRA_PAGA.some((t) => tipos.has(t))) falta.push('1ª parcela paga');
  if (!tipos.has('contrato.assinado_cliente')) falta.push('contrato assinado pelo cliente');
  if (!tipos.has('contrato.assinado_root')) falta.push('contrato assinado pela Root');
  return { pronto: falta.length === 0, falta };
}

/**
 * D-4: as provas da VERSÃO ACEITA. Os três fatos no fio não bastam: depois de
 * uma versão nova aceita, o Pix e as assinaturas no fio podem ser da versão
 * velha. O documento assinado pelos dois tem de ter o hash do contrato da
 * versão aceita, e a 1ª parcela paga tem de ser da cobrança dessa versão
 * (referência `cob-<lead>-v<n>`).
 */
export interface ProvasDaVersao {
  versao: number;
  /**
   * Os hashes do contrato desta versão: montado com os dados de agora e com os
   * da cobrança aprovada (os dois levam a versão e o hash da proposta no texto).
   */
  hashesDoContrato: string[];
  documentos: { hashConteudo: string; assinadoClienteEm: Date | null; assinadoRootEm: Date | null }[];
  /** A cobrança criada com a referência desta versão (nula se não há). */
  cobrancaDaVersao: { primeiraPaga: boolean } | null;
  /** Há cobrança no lead (de qualquer versão)? Só muda a frase. */
  haCobranca: boolean;
}

export function faltaDaVersao(p: ProvasDaVersao): string[] {
  const falta: string[] = [];
  const doc = p.documentos.find((d) => p.hashesDoContrato.includes(d.hashConteudo));
  if (!doc) {
    falta.push(p.documentos.length ? `contrato da versão ${p.versao} (o documento que existe é de outra versão)` : `contrato da versão ${p.versao} gerado`);
  } else {
    if (!doc.assinadoClienteEm) falta.push(`contrato da versão ${p.versao} assinado pelo cliente`);
    if (!doc.assinadoRootEm) falta.push(`contrato da versão ${p.versao} assinado pela Root`);
  }
  if (!p.cobrancaDaVersao) {
    falta.push(p.haCobranca ? `cobrança da versão ${p.versao} (a cobrança que existe é de outra versão)` : `cobrança da versão ${p.versao} criada`);
  } else if (!p.cobrancaDaVersao.primeiraPaga) {
    falta.push(`1ª parcela da cobrança da versão ${p.versao} paga`);
  }
  return falta;
}

@Injectable()
export class FechamentoService implements OnModuleInit {
  private readonly log = new Logger('ComercialFechamento');

  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly reacoes: ReacoesRegistry,
    private readonly efeitos: EfeitosRegistry,
    private readonly operador: PortaDoOperador,
    private readonly dinheiro: DinheiroService,
    private readonly config: ConfigComercialService,
    private readonly decisoes: DecisoesService,
    private readonly decisoesRegistry: DecisoesRegistry,
    @Optional() private readonly trilhos?: TrilhoService,
    @Optional() private readonly whats?: WhatsappComercialService,
    @Optional() private readonly relogio?: RelogioComercialRegistry,
    @Optional() private readonly interruptores?: InterruptoresRegistry,
    // CO-10 (rodada dos agentes): a porta da pasta do cliente (lane do Drive). Sem ela, a 7ª escrita fica `pulado`.
    @Optional() @Inject(PASTA_DO_CLIENTE) private readonly pastas?: PastaDoClientePort,
  ) {}

  onModuleInit(): void {
    this.efeitos.registrar({ [CAP_FECHAMENTO]: (args, orgId, ctx) => this.efeitoDoFechamento(args, orgId, ctx) }, 'comercial/fechamento.service');
    for (const tipo of [...COMERCIAL_FATOS_DA_PRIMEIRA_PAGA, 'contrato.assinado_cliente', 'contrato.assinado_root'] as const) {
      this.reacoes.inscrever(tipo, 'fechamento.talvez', (ev) => this.talvezFechar(ev.orgId, ev.leadId));
    }
    this.reacoes.inscrever('kickoff.marcado', 'fechamento.m8', (ev) => this.boasVindas(ev.orgId, ev.leadId, String((ev.payload as P).horario ?? '')));
    this.decisoesRegistry.aoDecidir('veto_de_fechamento', (d) => this.aoDecidirVeto(d), 'fechamento.veto');
    this.relogio?.inscrever('dinheiro.repropor', (orgId, agora) => this.repropor(orgId, agora));
  }

  /**
   * O relógio devolve à fila o que venceu sem assinatura (R4 vale 10 minutos):
   * a cobrança e o contrato de quem aceitou e ainda não têm linha, e o
   * fechamento de quem já tem os três fatos. No máximo uma vez por hora por
   * recurso, e nunca o que a titular recusou (`travaDaRepeticao`).
   */
  async repropor(orgId: string, agora: Date): Promise<{ aceites: number; fechamentos: number }> {
    const aceites = await this.prisma.leadEvent.findMany({
      where: { type: 'proposta.aceita', lead: { orgId }, occurredAt: { gte: new Date(agora.getTime() - 30 * 86_400_000) } },
      select: { leadId: true },
      distinct: ['leadId'],
      take: 200,
    });
    let a = 0;
    let f = 0;
    for (const { leadId } of aceites) {
      try {
        const tipos = await this.tiposNoFio(orgId, leadId);
        if (tipos.has('cliente.ativo')) continue;
        const r = await this.dinheiro.proporAceite(orgId, leadId, { id: ATOR, tipo: ActorType.system }, agora);
        if ('approvalIds' in r && r.approvalIds.length) a++;
        if (!prontoParaFechar(tipos).pronto) continue;
        const ac = await this.dinheiro.aceiteDoLead(orgId, leadId);
        if (!ac) continue;
        if (!(await this.prontidao(orgId, leadId, ac)).pronto) continue;
        const chave = chaveDoFechamento(leadId, ac.versao);
        const linha = await this.prisma.comercialFechamento.findFirst({ where: { chave, orgId }, select: { estado: true, vetadoEm: true, agendadoPara: true } });
        if (linha?.vetadoEm || linha?.estado === 'concluido') continue;
        if (linha?.agendadoPara && linha.agendadoPara.getTime() > agora.getTime()) continue; // ainda na janela de veto
        if (await this.dinheiro.aprovacaoViva(orgId, CAP_FECHAMENTO, chave, agora)) continue;
        const trava = await this.dinheiro.travaDaRepeticao(orgId, CAP_FECHAMENTO, chave, agora);
        if (trava) continue;
        const p = await this.propor(orgId, leadId, { id: ATOR, tipo: ActorType.system }, agora);
        if ('estado' in p && p.estado === 'na_fila') f++;
      } catch (e) {
        this.log.warn(`repropor ${leadId}: ${(e as Error).message}`);
      }
    }
    return { aceites: a, fechamentos: f };
  }

  // -------------------------------------------------------------------------
  // Quando fechar
  // -------------------------------------------------------------------------

  private async tiposNoFio(orgId: string, leadId: string): Promise<Set<string>> {
    const evs = await this.prisma.leadEvent.findMany({
      where: { leadId, orgId, type: { in: [...COMERCIAL_FATOS_DA_PRIMEIRA_PAGA, 'contrato.assinado_cliente', 'contrato.assinado_root', 'cliente.ativo'] } },
      select: { type: true },
    });
    return new Set(evs.map((e) => e.type));
  }

  /**
   * Pronto para fechar? Os três fatos no fio E as provas da versão aceita
   * (D-4): o documento assinado pelos dois com o hash do contrato desta versão
   * e a 1ª parcela paga da cobrança desta versão. Sem isso nada vai à fila, e a
   * resposta diz o que falta.
   */
  async prontidao(orgId: string, leadId: string, a: AceiteDoLead | null): Promise<{ pronto: boolean; falta: string[] }> {
    if (a?.fora) return this.prontidaoFora(orgId, leadId, a);
    const base = prontoParaFechar(await this.tiposNoFio(orgId, leadId));
    if (!base.pronto) return base;
    if (!a) return { pronto: false, falta: ['aceite com dados'] };
    const referencia = `cob-${leadId}-v${a.versao}`;
    const [documentos, criada, haCobranca] = await Promise.all([
      this.prisma.comercialDocumento.findMany({ where: { leadId, orgId, ...SO_DOCUMENTOS_DE_ASSINATURA }, select: { hashConteudo: true, assinadoClienteEm: true, assinadoRootEm: true } }),
      this.prisma.leadEvent.findUnique({ where: { id: eventoIdComercial(orgId, leadId, 'cobranca.criada', referencia) }, select: { payload: true, leadId: true } }),
      this.prisma.comercialCobranca.count({ where: { leadId, orgId } }),
    ]);
    let cobrancaDaVersao: ProvasDaVersao['cobrancaDaVersao'] = null;
    if (criada && criada.leadId === leadId) {
      const externoId = String(((criada.payload ?? {}) as P).externoId ?? '');
      const primeira = externoId ? await this.prisma.comercialCobranca.findFirst({ where: { leadId, orgId, externoId }, select: { parcela: true, pagaEm: true, estado: true } }) : null;
      cobrancaDaVersao = { primeiraPaga: !!primeira && primeira.parcela === 1 && (!!primeira.pagaEm || primeira.estado === 'paga') };
    }
    const hashes = [this.dinheiro.contratoDoAceite(a).hash];
    const aprovado = cobrancaDaVersao ? await this.dinheiro.aceiteDaCobrancaAprovada(orgId, leadId, a) : null;
    if (aprovado) hashes.push(this.dinheiro.contratoDoAceite(aprovado).hash);
    const falta = faltaDaVersao({ versao: a.versao, hashesDoContrato: hashes, documentos, cobrancaDaVersao, haCobranca: haCobranca > 0 });
    return { pronto: falta.length === 0, falta };
  }

  /**
   * T1b: o aceite que o fechamento lê. O da sala, quando existe; sem ele, o
   * último aceite DECLARADO à mão (cliente que fechou fora do sistema).
   */
  async aceiteParaFechar(orgId: string, leadId: string): Promise<AceiteDoLead | null> {
    const daSala = await this.dinheiro.aceiteDoLead(orgId, leadId);
    if (daSala) return daSala;
    const d = await this.prisma.leadEvent.findFirst({ where: { leadId, orgId, type: 'aceite.declarado' }, orderBy: { occurredAt: 'desc' }, select: { payload: true, occurredAt: true } });
    return d ? aceiteDaDeclaracao(d.payload, d.occurredAt) : null;
  }

  /** T1b: pronto quando o PDF que a declaração cita está anexado no fio (o contrato já veio assinado). */
  private async prontidaoFora(orgId: string, leadId: string, a: AceiteDoLead): Promise<{ pronto: boolean; falta: string[] }> {
    const sha = a.fora?.arquivoSha256 ?? '';
    const anexo = sha ? await this.prisma.leadEvent.findUnique({ where: { id: eventoIdComercial(orgId, leadId, 'contrato.anexado', sha) }, select: { leadId: true } }) : null;
    const falta = anexo && anexo.leadId === leadId ? [] : ['o contrato assinado anexado (PDF)'];
    return { pronto: falta.length === 0, falta };
  }

  /** A linha do fechamento (criada pendente se ainda não existe). */
  private async garantirLinha(orgId: string, leadId: string, a: AceiteDoLead) {
    const chave = chaveDoFechamento(leadId, a.versao);
    await this.prisma.comercialFechamento.createMany({
      data: [{ id: uuidDe([orgId, 'comercial-fechamento', chave]), leadId, chave, versao: a.versao, estado: 'pendente', escritas: escritasVazias() as unknown as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });
    return this.prisma.comercialFechamento.findFirstOrThrow({ where: { chave, orgId } });
  }

  /** Reação aos três fatos: quando os três estão no fio, propõe (ou abre a janela de veto). */
  async talvezFechar(orgId: string, leadId: string, agora: Date = new Date()): Promise<unknown> {
    const tipos = await this.tiposNoFio(orgId, leadId);
    if (tipos.has('cliente.ativo')) return { pulado: 'cliente já ativo' };
    const { pronto, falta } = prontoParaFechar(tipos);
    if (!pronto) return { pulado: `falta: ${falta.join(', ')}` };
    const a = await this.dinheiro.aceiteDoLead(orgId, leadId);
    if (!a) return { pulado: 'sem aceite com dados' };
    const daVersao = await this.prontidao(orgId, leadId, a);
    if (!daVersao.pronto) return { pulado: `falta: ${daVersao.falta.join(', ')}` };
    const linha = await this.garantirLinha(orgId, leadId, a);
    if (linha.estado === 'concluido' || linha.vetadoEm) return { pulado: `fechamento ${linha.estado}${linha.vetadoEm ? ' (vetado)' : ''}` };

    const cfg = await this.config.ler(orgId);
    if (cfg.fechamentoAutomatico && cfg.janelaDeVetoMinutos) {
      const expiraEm = new Date(agora.getTime() + cfg.janelaDeVetoMinutos * 60_000);
      const lead = await this.prisma.lead.findFirstOrThrow({ where: { id: leadId, orgId }, select: { name: true } });
      const d = await this.decisoes.abrir({
        orgId,
        leadId,
        tipo: 'veto_de_fechamento',
        titulo: `${a.dados.razaoSocial || lead.name} assinou e pagou a 1ª parcela`,
        contexto: `O fechamento vai à assinatura da titular às ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(expiraEm)}. Para segurar, responda VETO até lá.`,
        opcoes: [
          { chave: 'seguir', rotulo: 'Seguir com o fechamento', efeito: 'o fechamento vai à assinatura da titular' },
          { chave: 'vetar', rotulo: 'VETO: segurar', efeito: 'nada é proposto; volta só pelo "rodar de novo"' },
        ],
        padrao: 'seguir',
        expiraEm,
        chave: linha.chave,
        dados: { chave: linha.chave },
        agora,
      });
      await this.prisma.comercialFechamento.updateMany({ where: { id: linha.id, agendadoPara: null }, data: { agendadoPara: d.expiraEm } });
      return { janelaDeVeto: d.id, ate: d.expiraEm.toISOString() };
    }
    return this.propor(orgId, leadId, { id: ATOR, tipo: ActorType.system });
  }

  private async aoDecidirVeto(d: DecisaoResolvida): Promise<unknown> {
    const chave = String(d.dados.chave ?? '');
    if (d.escolha === 'vetar') {
      await this.prisma.comercialFechamento.updateMany({ where: { chave, orgId: d.orgId, vetadoEm: null }, data: { vetadoEm: new Date(), estado: 'vetado' } });
      await this.fio.registrar(d.orgId, d.leadId, 'veto.registrado', `fechamento:${chave}`, { sobre: `fechamento ${chave}`, por: d.por?.nome ?? d.por?.id ?? null, canal: d.canal });
      return { vetado: chave };
    }
    return this.propor(d.orgId, d.leadId, { id: ATOR, tipo: ActorType.system });
  }

  /**
   * Propõe o fechamento à porta (R4: fica retido para a titular). Idempotente:
   * fechamento concluído ou já na fila não vai de novo. `ator` é o sistema na
   * reação; na rota "rodar de novo", a pessoa que clicou.
   */
  async propor(orgId: string, leadId: string, ator: { id: string; tipo: ActorType }, agora: Date = new Date()): Promise<{ estado: string; approvalId?: string; chave: string } | { pulado: string }> {
    const a = await this.aceiteParaFechar(orgId, leadId);
    if (!a) return { pulado: 'sem aceite com dados' };
    // T1b: os fatos de quem fechou fora foram DECLARADOS por uma pessoa; a máquina não propõe em nome de ninguém.
    if (a.fora && ator.tipo !== ActorType.user) return { pulado: 'cliente fechado fora do sistema: só uma pessoa propõe este fechamento' };
    const linha = await this.garantirLinha(orgId, leadId, a);
    if (linha.estado === 'concluido') return { estado: 'concluido', chave: linha.chave };
    // Nem a pessoa pede fechamento antes da hora: sem a 1ª parcela paga e as duas assinaturas, nada vai à fila.
    const pronto = await this.prontidao(orgId, leadId, a);
    if (!pronto.pronto) return { pulado: `falta: ${pronto.falta.join(', ')}` };
    const viva = await this.dinheiro.aprovacaoViva(orgId, CAP_FECHAMENTO, linha.chave, agora);
    if (viva) return { estado: 'na_fila', approvalId: viva.id, chave: linha.chave };
    if (linha.vetadoEm && ator.tipo === ActorType.system) return { pulado: 'fechamento vetado: só volta pelo "rodar de novo"' };
    if (linha.vetadoEm) await this.prisma.comercialFechamento.update({ where: { id: linha.id }, data: { vetadoEm: null, estado: 'pendente' } });
    const r = await this.operador.executar({
      orgId,
      actorId: ator.id,
      actorType: ator.tipo,
      capabilityId: CAP_FECHAMENTO,
      args: { leadId, chave: linha.chave, propostaHash: a.hash },
      resource: { type: 'comercial.fechamento', id: linha.chave },
      valorCentavos: a.valorCentavos,
    });
    if (ehRetida(r)) return { estado: 'na_fila', approvalId: r.approvalId, chave: linha.chave };
    return { estado: 'executado', chave: linha.chave };
  }

  // -------------------------------------------------------------------------
  // O efeito: as cinco escritas (só a porta chama)
  // -------------------------------------------------------------------------

  private async efeitoDoFechamento(args: P, orgId: string, ctx: ContextoDoEfeito): Promise<unknown> {
    const leadId = String(args.leadId ?? '');
    const chave = String(args.chave ?? '');
    const a = await this.aceiteParaFechar(orgId, leadId);
    if (!a) throw new Error('o lead não tem aceite com dados: nada foi feito');
    if (a.fora) {
      // T1b: o registro à mão só fecha pela fila, e quem o registrou não assina o próprio registro.
      if (!ctx?.approvalId) throw new Error('o fechamento de cliente fechado fora do sistema só roda pela fila de aprovação: nada foi feito');
      if (!ctx.actorId || ctx.actorId === a.fora.porId) throw new Error('quem registrou o cliente fechado fora não assina o próprio registro: outra pessoa aprova. Nada foi feito');
    }
    if (a.hash !== String(args.propostaHash)) throw new Error('a proposta aceita mudou depois do pedido: nada foi feito');
    if (chave !== chaveDoFechamento(leadId, a.versao)) throw new Error('a chave do fechamento não é a da versão aceita: nada foi feito');
    const pronto = await this.prontidao(orgId, leadId, a);
    if (!pronto.pronto) throw new Error(`o fechamento ainda não pode rodar (falta: ${pronto.falta.join(', ')}): nada foi feito`);
    return this.executar(orgId, leadId, a);
  }

  /** As cinco escritas. Rodar de novo reaproveita o que ficou pronto e refaz só o que ficou em erro ou pendente. */
  async executar(orgId: string, leadId: string, aceiteDeAgora: AceiteDoLead): Promise<FechamentoDoLead> {
    const pega = await this.garantirLinha(orgId, leadId, aceiteDeAgora);
    if (pega.estado === 'concluido') return this.projetar(pega);
    // D-7: a linha é TOMADA com escrita condicionada ao estado (pendente ou erro; em curso só se parado).
    // Quem não tomou sai sem escrever nada: outra execução do mesmo fechamento está rodando.
    const tomada = await this.prisma.comercialFechamento.updateMany({
      where: {
        id: pega.id,
        OR: [{ estado: { in: ['pendente', 'erro'] } }, { estado: 'em_curso', atualizadoEm: { lt: new Date(Date.now() - FECHAMENTO_PARADO_MS) } }],
      },
      data: { estado: 'em_curso', iniciadoEm: pega.iniciadoEm ?? new Date(), erro: null },
    });
    const linha = await this.prisma.comercialFechamento.findUniqueOrThrow({ where: { id: pega.id } });
    if (tomada.count === 0) {
      this.log.warn(`fechamento ${linha.chave} não tomado (estado ${linha.estado}): outra execução está em curso, nada foi feito`);
      return this.projetar(linha);
    }
    const anteriores = new Map(((linha.escritas ?? []) as unknown as EscritaDoFechamento[]).map((e) => [e.escrita, e]));

    const lead = await this.prisma.lead.findFirstOrThrow({ where: { id: leadId, orgId }, select: { name: true, phone: true, email: true } });
    const ficha = await this.prisma.comercialFicha.findFirst({ where: { leadId, orgId } });
    // D-2: o devedor é o da cobrança que a titular aprovou (gravado no `cobranca.criada`), nunca o aceite
    // mais novo: o cliente da sala não troca o CNPJ do Partner depois da assinatura. Sem cobrança aprovada,
    // nem o cliente nem a cobrança são escritos aqui.
    // T1b: de quem fechou fora, o devedor é o da DECLARAÇÃO, que está no hash que a titular assinou
    // (o efeito recalcula o hash antes de chegar aqui); não há cobrança aprovada antes do fechamento.
    const fora = aceiteDeAgora.fora ?? null;
    const aprovado = fora ? aceiteDeAgora : await this.dinheiro.aceiteDaCobrancaAprovada(orgId, leadId, aceiteDeAgora);
    const a = aprovado ?? aceiteDeAgora;
    const SEM_COBRANCA_APROVADA = 'a cobrança aprovada pela titular ainda não existe: o fechamento não escreve cliente nem cobrança com dados que ela não viu';
    const escritas: EscritaDoFechamento[] = [];
    const refs: Partial<Record<EscritaDoFechamento['escrita'], string | null>> = {};

    const rodar = async (escrita: EscritaDoFechamento['escrita'], fn: () => Promise<{ estado: 'criado' | 'reaproveitado' | 'pulado' | 'aguardando_aprovacao'; detalhe: string; ref: string | null }>) => {
      const antes = anteriores.get(escrita);
      const comecou = Date.now();
      let e: EscritaDoFechamento;
      try {
        const r = await fn();
        // Já estava pronta numa passada anterior: conta como reaproveitada, com o tempo de agora.
        const estado = r.estado !== 'pulado' && r.estado !== 'aguardando_aprovacao' && antes && (antes.estado === 'criado' || antes.estado === 'reaproveitado') ? 'reaproveitado' : r.estado;
        e = { escrita, onde: ONDE[escrita], estado, detalhe: r.detalhe, ms: Date.now() - comecou, seRodarDeNovo: SE_RODAR_DE_NOVO[escrita], ref: r.ref };
      } catch (erro) {
        e = { escrita, onde: ONDE[escrita], estado: 'erro', detalhe: (erro instanceof Error ? erro.message : String(erro)).slice(0, 400), ms: Date.now() - comecou, seRodarDeNovo: SE_RODAR_DE_NOVO[escrita], ref: antes?.ref ?? null };
      }
      escritas.push(e);
      refs[escrita] = e.ref;
      await this.fio.registrar(orgId, leadId, 'fechamento.escrita', `${linha.chave}:${escrita}:${e.estado}:${e.ref ?? ''}`, { chave: linha.chave, escrita, estado: e.estado, ref: e.ref, ms: e.ms });
    };

    // 1. cliente: Partner, reaproveitado pelo da ficha (quando confere) e, sem ele, pelo CNPJ.
    // D-12: só se reaproveita um Partner que já é CLIENTE. O CNPJ vem da sala, que o cliente preenche sem
    // conferência: o fornecedor com o mesmo CNPJ não vira o cliente deste contrato nem é tocado; nasce outro.
    // A2 e a revisão adversarial (achados 1 e 2): o lead pode já ter um cliente na ficha (onboarding
    // iniciado antes). Ele só vale se o CNPJ dele for o do aceite, ou se estiver vazio e nenhum outro
    // cliente da empresa tiver o CNPJ do aceite (aí ganha o CNPJ e o e-mail vazios). Senão vale a regra
    // D-12, e a troca fica À VISTA: no detalhe da escrita, no fio (`cliente.a_conciliar`) e no card.
    // Tudo sob o cadeado do lead, relendo a ficha (o iniciar pode ter acabado de ligar um cliente).
    let conciliar: { partnerDaFicha: string; motivo: string } | null = null;
    await rodar('cliente', async () => {
      if (!aprovado) throw new Error(SEM_COBRANCA_APROVADA);
      const doc = a.dados.cnpj.replace(/\D/g, '');
      const final4 = (d: string) => `…${d.slice(-4)}`;
      const r = await this.prisma.$transaction(
        async (tx) => {
          await travarImplantacaoDoLead(tx, orgId, leadId);
          const fichaAgora = await tx.comercialFicha.findFirst({ where: { leadId, orgId }, select: { partnerId: true } });
          const daFicha = fichaAgora?.partnerId
            ? await tx.partner.findFirst({ where: { id: fichaAgora.partnerId, orgId, isCliente: true, interno: false }, select: { id: true, cnpjCpf: true, email: true } })
            : null;
          let aviso: { partnerDaFicha: string; motivo: string } | null = null;
          if (daFicha) {
            const docDaFicha = (daFicha.cnpjCpf ?? '').replace(/\D/g, '');
            const outro = doc
              ? await tx.partner.findFirst({ where: { orgId, cnpjCpf: doc, isCliente: true, id: { not: daFicha.id } }, select: { id: true } })
              : null;
            if ((doc && docDaFicha === doc) || (!docDaFicha && !outro)) {
              const vazios: { cnpjCpf?: string; email?: string } = {};
              if (!docDaFicha && doc) vazios.cnpjCpf = doc;
              if (!daFicha.email && a.dados.email) vazios.email = a.dados.email;
              if (Object.keys(vazios).length) await tx.partner.updateMany({ where: { id: daFicha.id, orgId }, data: vazios });
              return { estado: 'reaproveitado' as const, detalhe: 'cliente já ligado ao lead', ref: daFicha.id, aviso };
            }
            aviso = {
              partnerDaFicha: daFicha.id,
              motivo: docDaFicha
                ? `o cliente ligado ao lead antes do fechamento tem outro CNPJ (${final4(docDaFicha)}) que o do aceite (${final4(doc)})`
                : `outro cliente da empresa já tem o CNPJ do aceite (${final4(doc)}); o cliente ligado ao lead antes do fechamento não o recebeu`,
            };
          }
          const comAviso = (t: string) => (aviso ? `${t}. A conciliar: ${aviso.motivo}` : t).slice(0, 400);
          const ja = doc ? await tx.partner.findFirst({ where: { orgId, cnpjCpf: doc, isCliente: true }, orderBy: { createdAt: 'asc' }, select: { id: true } }) : null;
          if (ja) {
            if (!fichaAgora?.partnerId || aviso) await tx.comercialFicha.updateMany({ where: { leadId, orgId }, data: { partnerId: ja.id } });
            return { estado: 'reaproveitado' as const, detalhe: comAviso('cliente já existia com este CNPJ'), ref: ja.id, aviso };
          }
          const p = await tx.partner.create({
            data: { orgId, isCliente: true, razaoSocial: a.dados.razaoSocial, cnpjCpf: doc, email: a.dados.email || null, phone: lead.phone ?? null },
          });
          await tx.comercialFicha.updateMany({ where: { leadId, orgId }, data: { partnerId: p.id } });
          return { estado: 'criado' as const, detalhe: comAviso(a.dados.razaoSocial), ref: p.id, aviso };
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
      if (r.aviso) {
        conciliar = r.aviso;
        await this.fio.registrar(orgId, leadId, 'cliente.a_conciliar', `${linha.chave}:${r.aviso.partnerDaFicha}:${r.ref}`, { chave: linha.chave, partnerDaFicha: r.aviso.partnerDaFicha, partnerDoFechamento: r.ref, motivo: r.aviso.motivo });
      }
      return { estado: r.estado, detalhe: r.detalhe, ref: r.ref };
    });

    // 2. cobrança: a que a aprovação de `comercial.cobranca.criar` criou, reaproveitada; nunca uma cobrança com outro devedor.
    await rodar('cobranca', async () => {
      if (!aprovado) throw new Error(SEM_COBRANCA_APROVADA);
      // T1b: o padrão seguro de quem fechou fora é NÃO criar cobrança nova; o motivo escrito fica na escrita.
      if (fora && !fora.criarCobranca) {
        return { estado: 'pulado', detalhe: `nenhuma cobrança nova no Asaas: ${fora.motivoSemCobranca ?? '[a decidir]'}`.slice(0, 400), ref: null };
      }
      const r = await this.dinheiro.criarCobrancaDoAceite(orgId, leadId, aprovado);
      const linhas = await this.prisma.comercialCobranca.findMany({ where: { leadId, orgId }, select: { estado: true } });
      const pagas = linhas.filter((l) => l.estado === 'paga').length;
      return { estado: r.reaproveitada ? 'reaproveitado' : 'criado', detalhe: `${pagas}/${linhas.length} paga · ${linhas.length - pagas} agendada(s)`, ref: r.referencia };
    });

    // 3. contrato no Financeiro: id derivado da chave.
    await rodar('contrato', async () => {
      const id = uuidDe([orgId, 'comercial-contract', linha.chave]);
      const ja = await this.prisma.contract.findUnique({ where: { id }, select: { id: true } });
      if (ja) return { estado: 'reaproveitado', detalhe: 'contrato já registrado no Financeiro', ref: id };
      const partnerId = refs.cliente ?? null;
      if (!partnerId) throw new Error('sem cliente: o contrato do Financeiro espera a escrita do cliente');
      // T1b: o contrato já veio assinado; o PDF anexado é o documento assinado (nada vai à ZapSign).
      if (fora) await this.documentoAnexado(orgId, leadId, fora.arquivoSha256, fora.assinadoEm);
      if (fora && !fora.criarCobranca) {
        const p = parcelasDoContratoFora(a.valorCentavos, a.parcelas, fora.primeiroVencimento, hojeEmSP());
        const rotulo = TABELA_DE_PRECO[a.produto]?.rotulo ?? a.produto;
        const aUltima = p.ultimaParcelaCentavos !== p.parcelaCentavos ? ` (a última de ${formatarReais(p.ultimaParcelaCentavos)})` : '';
        await this.prisma.contract.create({
          data: {
            id,
            orgId,
            tipo: FinanceTxType.entrada,
            partnerId,
            descricao: `${rotulo} · ${a.dados.razaoSocial} · ${a.parcelas}× ${formatarReais(p.parcelaCentavos)}${aUltima} · ${linha.chave} · assinado fora do sistema, sem cobrança no Asaas`,
            valor: new Prisma.Decimal((p.parcelaCentavos / 100).toFixed(2)),
            diaVencimento: Number(fora.primeiroVencimento.slice(8, 10)),
            periodicidade: 'mensal',
            dataInicio: venceComoData(p.vencimentos[0]),
            dataFim: venceComoData(p.vencimentos[p.vencimentos.length - 1]),
            proximoVencimento: venceComoData(p.proximo),
          },
        });
        await this.prisma.comercialFicha.updateMany({ where: { leadId, orgId }, data: { contractId: id } });
        return { estado: 'criado', detalhe: `${a.parcelas}× ${formatarReais(p.parcelaCentavos)}${aUltima}, mensal, desde ${fora.primeiroVencimento} · contrato assinado fora, PDF anexado`, ref: id };
      }
      const parcelas = await this.prisma.comercialCobranca.findMany({ where: { leadId, orgId }, orderBy: { parcela: 'asc' } });
      if (!parcelas.length) throw new Error('sem parcelas: o contrato do Financeiro espera a cobrança');
      const primeira = parcelas[0];
      const ultima = parcelas[parcelas.length - 1];
      const proxima = parcelas.find((p) => !p.pagaEm) ?? ultima;
      const rotulo = TABELA_DE_PRECO[a.produto]?.rotulo ?? a.produto;
      // D-11: a última parcela que absorve a diferença aparece no contrato do Financeiro.
      const aUltima = ultima.valorCentavos !== primeira.valorCentavos ? ` (a última de ${formatarReais(ultima.valorCentavos)})` : '';
      await this.prisma.contract.create({
        data: {
          id,
          orgId,
          tipo: FinanceTxType.entrada,
          partnerId,
          descricao: `${rotulo} · ${a.dados.razaoSocial} · ${a.parcelas}× ${formatarReais(primeira.valorCentavos)}${aUltima} · ${linha.chave}`,
          valor: new Prisma.Decimal((primeira.valorCentavos / 100).toFixed(2)),
          diaVencimento: Number(primeira.vence.toISOString().slice(8, 10)),
          periodicidade: 'mensal',
          dataInicio: primeira.vence,
          dataFim: ultima.vence,
          proximoVencimento: proxima.vence,
        },
      });
      await this.prisma.comercialFicha.updateMany({ where: { leadId, orgId }, data: { contractId: id } });
      return { estado: 'criado', detalhe: `${a.parcelas}× ${formatarReais(primeira.valorCentavos)}${aUltima}, mensal`, ref: id };
    });

    // 4. kit e trilho: o trilho de implantação com os dados copiados.
    // Revisão adversarial A2 (achado 3): sob o cadeado do lead, relendo a ficha, e o trilho criado na
    // MESMA transação (`criarNaTransacao`). O trilho que o "Iniciar onboarding" acabou de criar é
    // reaproveitado; o `trilhoId` só é gravado onde ainda está vazio, e se não der, a transação volta
    // (trilho criado e não ligado não fica órfão).
    await rodar('kit_e_trilho', async () => {
      if (!this.trilhos) throw new Error('o serviço do trilho não está disponível nesta instância');
      const trilhos = this.trilhos;
      const manifesto = await this.manifesto(orgId, leadId, a);
      const preparo = await trilhos.prepararCriacaoNaTransacao(orgId);
      const r = await this.prisma.$transaction(
        async (tx) => {
          await travarImplantacaoDoLead(tx, orgId, leadId);
          const fichaAgora = await tx.comercialFicha.findFirst({ where: { leadId, orgId }, select: { trilhoId: true, perfil: true, reuniaoEm: true } });
          const ref = fichaAgora?.trilhoId ?? anteriores.get('kit_e_trilho')?.ref ?? null;
          if (ref) {
            const t = await tx.onboardingTrilho.findFirst({ where: { id: ref, orgId }, select: { id: true, fase: true } });
            if (t) {
              if (!fichaAgora?.trilhoId) await tx.comercialFicha.updateMany({ where: { leadId, orgId, trilhoId: null }, data: { trilhoId: t.id } });
              return { novo: false, id: t.id, fase: t.fase };
            }
          }
          const t = await trilhos.criarNaTransacao(
            tx,
            orgId,
            {
              cliente: a.dados.razaoSocial,
              contatoNome: a.dados.quemAssina,
              contatoWhatsapp: lead.phone ?? null,
              contatoEmail: a.dados.email || null,
              perfil: fichaAgora?.perfil ?? null,
              reuniaoEm: fichaAgora?.reuniaoEm?.toISOString() ?? null,
              observacoes: manifesto,
            },
            { id: null, nome: 'Fechamento comercial' },
            preparo,
          );
          const ligou = await tx.comercialFicha.updateMany({ where: { leadId, orgId, OR: [{ trilhoId: null }, { trilhoId: fichaAgora?.trilhoId ?? '' }] }, data: { trilhoId: t.id } });
          if (ligou.count !== 1) throw new Error('a ficha do lead ganhou outro trilho no meio do caminho: nenhum trilho foi criado; rodar de novo reaproveita o dela');
          return { novo: true, id: t.id, fase: 'qualificar' };
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
      if (!r.novo) return { estado: 'reaproveitado', detalhe: `trilho na fase ${FASES_DO_TRILHO.indexOf(r.fase) + 1} de 5`, ref: r.id };
      // O comercial já qualificou: o trilho tenta passar pelo portão da fase 0. O portão é do onboarding e
      // recusa com a lista do que falta (próximo passo, dono, data...): isso vira lacuna à vista, não erro.
      let falta = '';
      try {
        await trilhos.avancar(orgId, r.id, { id: null, nome: 'Fechamento comercial' });
      } catch (e) {
        const resp = (e as { getResponse?: () => unknown }).getResponse?.() as { faltando?: unknown } | undefined;
        falta = Array.isArray(resp?.faltando) ? (resp!.faltando as unknown[]).map(String).join('; ') : (e as Error).message;
      }
      const fase = (await this.prisma.onboardingTrilho.findUniqueOrThrow({ where: { id: r.id }, select: { fase: true } })).fase;
      const detalhe = `trilho aberto na fase ${FASES_DO_TRILHO.indexOf(fase) + 1} de 5. Lacunas [a decidir]: nível, receita e quem conduz${falta ? `. Para avançar a fase falta: ${falta}` : ''}`;
      return { estado: 'criado', detalhe: detalhe.slice(0, 400), ref: r.id };
    });

    // 5. o card da implantação, na lista "Onboarding de cliente" (I1): dados copiados, retrolinks, procedência.
    // Sob o cadeado do lead (revisão A2): o card que o "Iniciar onboarding" abriu é o mesmo (id do lead).
    await rodar('card', async () => {
      const aConciliar = conciliar as { partnerDaFicha: string; motivo: string } | null;
      const r = await this.prisma.$transaction(
        async (tx) => {
          await travarImplantacaoDoLead(tx, orgId, leadId);
          const fichaAgora = await tx.comercialFicha.findFirst({ where: { leadId, orgId }, select: { trilhoId: true, partnerId: true, donoId: true } });
          const trilhoId = refs.kit_e_trilho ?? fichaAgora?.trilhoId ?? null;
          const dono = fichaAgora?.donoId ? await tx.user.findFirst({ where: { id: fichaAgora.donoId, orgId }, select: { name: true } }) : null;
          const clienteId = refs.cliente ?? fichaAgora?.partnerId ?? null;
          const c = await abrirCardDaImplantacao(tx, orgId, {
            leadId,
            empresa: a.dados.razaoSocial || lead.name,
            cnpj: a.dados.cnpj,
            contato: a.dados.quemAssina,
            telefone: lead.phone ?? null,
            email: a.dados.email || lead.email || null,
            produto: TABELA_DE_PRECO[a.produto]?.rotulo ?? a.produto,
            valor: formatarReais(a.valorCentavos),
            parcelas: a.parcelas,
            forma: a.forma,
            chave: linha.chave,
            trilhoId,
            responsavel: dono?.name ?? null,
            clienteId,
          });
          // Revisão A2: o fechamento ficou com outro cliente. O card que apontava o de antes passa ao do
          // fechamento (o que uma pessoa escolheu à mão fica), e o aviso fica no card para conciliar.
          if (aConciliar && clienteId) {
            await tx.workTask.updateMany({ where: { id: c.cardId, orgId, clienteId: aConciliar.partnerDaFicha }, data: { clienteId } });
            await tx.workComment.createMany({
              data: [{
                id: uuidDe([orgId, 'comercial-card-cliente-a-conciliar', c.cardId, linha.chave]),
                orgId,
                taskId: c.cardId,
                authorId: null,
                authorName: AUTOR_DO_FECHAMENTO,
                text: `Cliente a conciliar: ${aConciliar.motivo}. O fechamento ficou com o cliente do CNPJ do aceite; o cadastro de antes continua lá para uma pessoa decidir.`.slice(0, 2000),
              }],
              skipDuplicates: true,
            });
          }
          return c;
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
      if (r.estado === 'criado') {
        await this.fio.registrar(orgId, leadId, 'implantacao.card_criado', r.cardId, { chave: linha.chave, cardId: r.cardId, listId: r.listId, lista: r.lista, etapa: r.etapa });
      }
      // A2: o card foi iniciado antes do fechamento. É o mesmo card (id do lead); o fechamento fica
      // registrado nele (comentário, uma vez por chave) e no fio. A etapa não muda.
      if (r.antecipado) {
        await this.fio.registrar(orgId, leadId, 'implantacao.fechamento_registrado', `${linha.chave}:${r.cardId}`, { chave: linha.chave, cardId: r.cardId });
      }
      return { estado: r.estado, detalhe: r.detalhe, ref: r.cardId };
    });

    // 6. grupo do cliente no WhatsApp (a M8 sai quando o kickoff for marcado).
    await rodar('grupo', async () => {
      const jidAntes = ficha?.grupoJid ?? anteriores.get('grupo')?.ref ?? null;
      if (jidAntes) return { estado: 'reaproveitado', detalhe: 'grupo já existia', ref: jidAntes };
      if (!this.whats) throw new Error('a porta do WhatsApp não está disponível nesta instância');
      if (!lead.phone) throw new Error('o lead não tem telefone para entrar no grupo');
      // D-6: o grupo sai pelo provedor do WhatsApp, e o botão de emergência de Conexões vale aqui também.
      // Desligado, a escrita fica em erro com o motivo e o "rodar de novo" a refaz; as outras seguem.
      const recusa = await this.interruptores?.consultar({ orgId, capabilityId: CAP_FECHAMENTO, conector: 'whatsapp', actorType: ActorType.system, actorId: ATOR });
      if (recusa) throw new Error(recusa.motivo);
      const { jid } = await this.whats.criarGrupo(`Root · ${a.dados.razaoSocial}`.slice(0, 60), [lead.phone]);
      await this.prisma.comercialFicha.updateMany({ where: { leadId, orgId }, data: { grupoJid: jid } });
      const kickoff = ficha?.kickoffEm ? ficha.kickoffEm.toISOString() : null;
      if (kickoff) await this.boasVindas(orgId, leadId, kickoff);
      return { estado: 'criado', detalhe: kickoff ? 'criado · boas-vindas na fila' : 'criado · boas-vindas sai quando o kickoff for marcado', ref: jid };
    });

    // 7. a pasta do cliente no Drive (CO-10): depois do card, fora de transação, idempotente pelo ponteiro.
    await rodar('pasta', async () => this.escritaDaPasta(orgId, leadId, refs.cliente ?? null, fora ? 'fechado-fora' : 'fechamento'));

    const essenciaisOk = ['cliente', 'contrato', 'cobranca'].every((k) => escritas.find((e) => e.escrita === k)?.estado !== 'erro');
    // CO-10: a pasta em erro fica à vista na escrita e no `erro`, mas não segura o fechamento.
    const tudoOk = escritas.every((e) => e.estado !== 'erro' || ESCRITAS_QUE_NAO_SEGURAM.has(e.escrita));
    const comErro = escritas.filter((e) => e.estado === 'erro');
    const concluidoEm = tudoOk ? new Date() : null;
    const atual = await this.prisma.comercialFechamento.update({
      where: { id: linha.id },
      data: {
        estado: tudoOk ? 'concluido' : 'erro',
        escritas: escritas as unknown as Prisma.InputJsonValue,
        concluidoEm,
        erro: comErro.length ? comErro.map((e) => `${e.escrita}: ${e.detalhe}`).join(' · ').slice(0, 2000) : null,
      },
    });
    if (essenciaisOk) {
      await this.fio.registrar(orgId, leadId, 'cliente.ativo', linha.chave, {
        chave: linha.chave,
        partnerId: refs.cliente ?? null,
        contractId: refs.contrato ?? null,
        trilhoId: escritas.find((e) => e.escrita === 'kit_e_trilho' && e.estado !== 'erro')?.ref ?? null,
      });
    }
    return this.projetar(atual);
  }

  /**
   * CO-10: a 7ª escrita. Com o ponteiro no cliente, reaproveita sem chamar a porta; sem a porta nesta
   * instância, `pulado`; senão pede à porta e traduz: pronta (criada ou ligada a uma de mesmo nome),
   * retida (R3, a aprovação vai no `ref`), sem raiz (`pulado` com o motivo) ou erro (lança, e o
   * `rodar` grava a escrita em erro com o motivo).
   */
  private async escritaDaPasta(
    orgId: string,
    leadId: string,
    clienteDaEscrita: string | null,
    origem: 'fechamento' | 'fechado-fora',
  ): Promise<{ estado: 'criado' | 'reaproveitado' | 'pulado' | 'aguardando_aprovacao'; detalhe: string; ref: string | null }> {
    const partnerId = clienteDaEscrita ?? (await this.prisma.comercialFicha.findFirst({ where: { leadId, orgId }, select: { partnerId: true } }))?.partnerId ?? null;
    if (!partnerId) throw new Error('sem cliente: a pasta espera a escrita do cliente');
    const cliente = await this.prisma.partner.findFirst({ where: { id: partnerId, orgId }, select: { pastaDriveId: true } });
    if (!cliente) throw new Error('o cliente do fechamento não está nesta empresa');
    if (cliente.pastaDriveId) return { estado: 'reaproveitado', detalhe: 'a pasta já estava ligada ao cliente', ref: cliente.pastaDriveId };
    if (!this.pastas) return { estado: 'pulado', detalhe: 'a porta da pasta do cliente não está disponível nesta instância', ref: null };
    const r = await this.pastas.garantir({ orgId, partnerId, origem, leadId });
    switch (r.estado) {
      case 'pronta':
        return { estado: r.ligada ? 'reaproveitado' : 'criado', detalhe: r.ligada ? 'ligada a uma pasta de mesmo nome que já existia' : 'pasta criada a partir do modelo', ref: r.pastaId };
      case 'aguardando_aprovacao':
        return { estado: 'aguardando_aprovacao', detalhe: 'a criação da pasta espera a aprovação de outra pessoa em /atendimento', ref: r.approvalId };
      case 'sem_raiz':
        return { estado: 'pulado', detalhe: `sem a raiz dos clientes no Drive: ${r.motivo}`.slice(0, 400), ref: null };
      default:
        throw new Error(r.motivo || 'a porta da pasta devolveu erro sem motivo');
    }
  }

  /**
   * T1b: o PDF anexado vira o `ComercialDocumento` do lead (provedor `anexo`), com as duas assinaturas na
   * data que a pessoa declarou, para quem lê o documento saber que o contrato está assinado e por onde veio.
   * O id e o `externoId` derivam do lead e do arquivo: rodar de novo não cria outro.
   */
  private async documentoAnexado(orgId: string, leadId: string, sha256: string, assinadoEm: string): Promise<void> {
    const quando = venceComoData(assinadoEm);
    await this.prisma.comercialDocumento.createMany({
      data: [
        {
          id: uuidDe([orgId, 'comercial-documento', 'anexo', leadId, sha256]),
          leadId,
          provedor: 'anexo',
          externoId: `${leadId}:${sha256}`,
          estado: 'assinado',
          hashConteudo: sha256,
          assinadoClienteEm: quando,
          assinadoRootEm: quando,
          pdfUrl: chaveDoAnexo(leadId, sha256),
        },
      ],
      skipDuplicates: true,
    });
  }

  /** O manifesto do kit: o que o comercial sabe, copiado (nada redigitado). */
  private async manifesto(orgId: string, leadId: string, a: AceiteDoLead): Promise<string> {
    const ficha = await this.prisma.comercialFicha.findFirst({ where: { leadId, orgId }, select: { ataHash: true, diagnostico: true, sistemaErp: true } });
    const rotulo = TABELA_DE_PRECO[a.produto]?.rotulo ?? a.produto;
    const linhas = [
      `Fechamento comercial ${chaveDoFechamento(leadId, a.versao)}.`,
      `Contratante: ${a.dados.razaoSocial} (${a.dados.cnpj}), ${a.dados.endereco}. Quem assina: ${a.dados.quemAssina} (${a.dados.email}).`,
      a.fora
        ? `Produto: ${rotulo}, ${formatarReais(a.valorCentavos)} em ${a.parcelas}x por ${a.forma}. Registro à mão v${a.versao}, hash ${a.hash.slice(0, 12)}.`
        : `Produto: ${rotulo}, ${formatarReais(a.valorCentavos)} em ${a.parcelas}x por ${a.forma}. Proposta v${a.versao}, hash ${a.hash.slice(0, 12)}.`,
    ];
    if (a.fora) {
      linhas.push(
        `Fechado fora do sistema: contrato assinado em ${a.fora.assinadoEm}, PDF anexado (sha ${a.fora.arquivoSha256.slice(0, 12)}). Registrado à mão${a.fora.por ? ` por ${a.fora.por}` : ''}.`,
        a.fora.criarCobranca ? 'Cobrança nova no Asaas pedida no registro.' : `Sem cobrança nova no Asaas: ${a.fora.motivoSemCobranca ?? '[a decidir]'}.`,
      );
    }
    if (ficha?.sistemaErp) linhas.push(`Sistema: ${ficha.sistemaErp}.`);
    if (ficha?.ataHash) linhas.push(`Ata da sessão: hash ${ficha.ataHash.slice(0, 12)}.`);
    const dores = ((ficha?.diagnostico ?? null) as P | null)?.dores;
    if (Array.isArray(dores)) {
      for (const d of dores.slice(0, 8) as P[]) linhas.push(`Dor: ${String(d.texto ?? '')}${d.minuto ? ` (minuto ${String(d.minuto)})` : ''}.`);
    }
    return linhas.join('\n').slice(0, 4000);
  }

  /** M8 no grupo, com o horário do kickoff. Equipe = [a decidir], à vista de quem libera o envio. */
  async boasVindas(orgId: string, leadId: string, horario: string): Promise<unknown> {
    const ficha = await this.prisma.comercialFicha.findFirst({ where: { leadId, orgId }, select: { grupoJid: true } });
    if (!ficha?.grupoJid) return { pulado: 'grupo ainda não criado' };
    if (!this.whats || !horario) return { pulado: 'sem porta do WhatsApp ou sem horário' };
    const kickoff = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(horario));
    return this.whats.enviarM8(orgId, leadId, ficha.grupoJid, { equipe: EQUIPE_A_DECIDIR, kickoff });
  }

  // -------------------------------------------------------------------------
  // Leitura (tela 10)
  // -------------------------------------------------------------------------

  private projetar(linha: { chave: string; versao: number; estado: string; iniciadoEm: Date | null; concluidoEm: Date | null; escritas: unknown; vetadoEm?: Date | null }): FechamentoDoLead {
    const salvas = ((linha.escritas ?? []) as unknown as EscritaDoFechamento[]).filter(Boolean);
    const porEscrita = new Map(salvas.map((e) => [e.escrita, e]));
    const escritas = escritasVazias().map((v) => porEscrita.get(v.escrita) ?? v);
    const estado = (['pendente', 'em_curso', 'concluido', 'erro'] as const).includes(linha.estado as never) ? (linha.estado as FechamentoDoLead['estado']) : 'pendente';
    return {
      chave: linha.chave,
      versao: linha.versao,
      estado,
      iniciadoEm: linha.iniciadoEm?.toISOString() ?? null,
      concluidoEm: linha.concluidoEm?.toISOString() ?? null,
      escritas,
      copiadoSemRedigitar: ['dados do CNPJ', 'quem assina', 'produto', 'valor', 'parcelas', 'ata', 'diagnóstico e dores com minuto'],
    };
  }

  async doLead(orgId: string, leadId: string): Promise<FechamentoDoLead & { aprovacao: { id: string; status: string } | null; vetado: boolean; contratoAnexado: ContratoAnexadoNaTela | null }> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { id: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    const contratoAnexado = await this.contratoAnexado(orgId, leadId);
    const linha = await this.prisma.comercialFechamento.findFirst({ where: { leadId, orgId }, orderBy: { criadoEm: 'desc' } });
    if (!linha) {
      const a = await this.aceiteParaFechar(orgId, leadId);
      return {
        chave: a ? chaveDoFechamento(leadId, a.versao) : '',
        versao: a?.versao ?? 0,
        estado: 'pendente',
        iniciadoEm: null,
        concluidoEm: null,
        escritas: escritasVazias(),
        copiadoSemRedigitar: [],
        aprovacao: null,
        vetado: false,
        contratoAnexado,
      };
    }
    const viva = await this.dinheiro.aprovacaoViva(orgId, CAP_FECHAMENTO, linha.chave);
    return { ...this.projetar(linha), aprovacao: viva ? { id: viva.id, status: viva.status } : null, vetado: !!linha.vetadoEm, contratoAnexado };
  }

  /** T1b: o contrato assinado fora, anexado (para quem confere o fechamento baixar o PDF antes de assinar). */
  private async contratoAnexado(orgId: string, leadId: string, a?: AceiteDoLead | null): Promise<ContratoAnexadoNaTela | null> {
    // O PDF que a declaração VIGENTE cita (revisão: nunca "o mais novo", que pode ser de outra versão).
    const aceite = a === undefined ? await this.aceiteParaFechar(orgId, leadId) : a;
    const sha = aceite?.fora?.arquivoSha256;
    if (!sha) return null;
    const fato = await this.prisma.leadEvent.findUnique({ where: { id: eventoIdComercial(orgId, leadId, 'contrato.anexado', sha) }, select: { leadId: true, payload: true } });
    if (!fato || fato.leadId !== leadId) return null;
    const p = (fato.payload ?? {}) as P;
    return { nome: String(p.nome ?? 'contrato.pdf'), bytes: Number(p.bytes ?? 0), sha256: String(p.sha256 ?? ''), assinadoEm: String(p.assinadoEm ?? ''), por: typeof p.por === 'string' ? p.por : null };
  }

  /**
   * Revisão P2-1: o que a titular assina no R4 do fechamento, para o cartão de `/atendimento`. Os
   * argumentos do pedido só levam lead, chave e hash; aqui vão os dados que o hash prende, com o hash
   * RECALCULADO agora (da declaração, para quem fechou fora; do aceite da sala, para o funil) e o PDF
   * que a declaração cita. `confere` falso = o conteúdo mudou depois do pedido, e a tela não acende o botão.
   */
  async conteudoParaAssinar(orgId: string, leadId: string, hashAssinado: string | null): Promise<ConteudoDoFechamento> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { name: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    const a = await this.aceiteParaFechar(orgId, leadId);
    if (!a) throw new NotFoundException('Este lead não tem aceite para fechar.');
    return {
      leadId,
      nome: lead.name,
      origem: a.fora ? 'fora' : 'sala',
      versao: a.versao,
      chave: chaveDoFechamento(leadId, a.versao),
      produto: a.produto,
      rotuloDoProduto: TABELA_DE_PRECO[a.produto]?.rotulo ?? a.produto,
      valorCentavos: a.valorCentavos,
      parcelas: a.parcelas,
      forma: a.forma,
      dados: a.dados,
      fora: a.fora
        ? {
            assinadoEm: a.fora.assinadoEm,
            primeiroVencimento: a.fora.primeiroVencimento,
            criarCobranca: a.fora.criarCobranca,
            motivoSemCobranca: a.fora.motivoSemCobranca,
            por: a.fora.por,
            anexo: await this.contratoAnexado(orgId, leadId, a),
          }
        : null,
      hashDeAgora: a.hash,
      hashAssinado,
      confere: !!hashAssinado && hashAssinado === a.hash,
    };
  }
}
