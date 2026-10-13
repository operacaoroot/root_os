import { Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { COMERCIAL_FATOS_DA_PRIMEIRA_PAGA, TABELA_DE_PRECO, formatarReais, type EscritaDoFechamento, type FechamentoDoLead } from '@mktos/shared';
import { ActorType, FinanceTxType, Prisma } from '@prisma/client';

import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { InterruptoresRegistry } from '../gateway/interruptores.registry';
import { PortaDoOperador } from '../gateway/porta-do-operador.service';
import { TrilhoService } from '../onboarding/trilho/trilho.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigComercialService } from './config.service';
import { DecisoesRegistry, DecisoesService, type DecisaoResolvida } from './decisoes.service';
import { DinheiroService, type AceiteDoLead } from './dinheiro.service';
import { eventoIdComercial, uuidDe } from './eventos';
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
 * O GRUPO E A M8. O grupo é criado pela porta do WhatsApp (no simulado, um
 * jid local), depois de perguntar ao interruptor do conector `whatsapp` (D-6):
 * desligado em Conexões, a escrita do grupo fica em erro com o motivo. A boas-vindas (M8) é outra capacidade (`comercial.whatsapp.enviar`,
 * R3) e vai à fila como toda mensagem; ela precisa do horário do kickoff, que
 * o cliente escolhe na sala depois do fechamento, então nasce na reação a
 * `kickoff.marcado`. Quem entra no grupo é [a decidir] pela mesa.
 */

export const CAP_FECHAMENTO = 'comercial.fechamento.executar';
const ATOR = 'comercial';
const ESCRITAS: EscritaDoFechamento['escrita'][] = ['cliente', 'contrato', 'cobranca', 'kit_e_trilho', 'grupo'];
const ONDE: Record<EscritaDoFechamento['escrita'], string> = {
  cliente: 'CRM do OS',
  contrato: 'Financeiro do OS',
  cobranca: 'Asaas',
  kit_e_trilho: 'Implantação',
  grupo: 'WhatsApp',
};
const SE_RODAR_DE_NOVO: Record<EscritaDoFechamento['escrita'], string> = {
  cliente: 'reaproveita pelo CNPJ',
  contrato: 'reaproveita pela chave',
  cobranca: 'não cria outra',
  kit_e_trilho: 'reaproveita',
  grupo: 'não cria outro',
};
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
        const tipos = await this.tiposNoFio(leadId);
        if (tipos.has('cliente.ativo')) continue;
        const r = await this.dinheiro.proporAceite(orgId, leadId, { id: ATOR, tipo: ActorType.system }, agora);
        if ('approvalIds' in r && r.approvalIds.length) a++;
        if (!prontoParaFechar(tipos).pronto) continue;
        const ac = await this.dinheiro.aceiteDoLead(leadId);
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

  private async tiposNoFio(leadId: string): Promise<Set<string>> {
    const evs = await this.prisma.leadEvent.findMany({
      where: { leadId, type: { in: [...COMERCIAL_FATOS_DA_PRIMEIRA_PAGA, 'contrato.assinado_cliente', 'contrato.assinado_root', 'cliente.ativo'] } },
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
    const base = prontoParaFechar(await this.tiposNoFio(leadId));
    if (!base.pronto) return base;
    if (!a) return { pronto: false, falta: ['aceite com dados'] };
    const referencia = `cob-${leadId}-v${a.versao}`;
    const [documentos, criada, haCobranca] = await Promise.all([
      this.prisma.comercialDocumento.findMany({ where: { leadId, orgId }, select: { hashConteudo: true, assinadoClienteEm: true, assinadoRootEm: true } }),
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
    const aprovado = cobrancaDaVersao ? await this.dinheiro.aceiteDaCobrancaAprovada(leadId, a) : null;
    if (aprovado) hashes.push(this.dinheiro.contratoDoAceite(aprovado).hash);
    const falta = faltaDaVersao({ versao: a.versao, hashesDoContrato: hashes, documentos, cobrancaDaVersao, haCobranca: haCobranca > 0 });
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
    const tipos = await this.tiposNoFio(leadId);
    if (tipos.has('cliente.ativo')) return { pulado: 'cliente já ativo' };
    const { pronto, falta } = prontoParaFechar(tipos);
    if (!pronto) return { pulado: `falta: ${falta.join(', ')}` };
    const a = await this.dinheiro.aceiteDoLead(leadId);
    if (!a) return { pulado: 'sem aceite com dados' };
    const daVersao = await this.prontidao(orgId, leadId, a);
    if (!daVersao.pronto) return { pulado: `falta: ${daVersao.falta.join(', ')}` };
    const linha = await this.garantirLinha(orgId, leadId, a);
    if (linha.estado === 'concluido' || linha.vetadoEm) return { pulado: `fechamento ${linha.estado}${linha.vetadoEm ? ' (vetado)' : ''}` };

    const cfg = await this.config.ler(orgId);
    if (cfg.fechamentoAutomatico && cfg.janelaDeVetoMinutos) {
      const expiraEm = new Date(agora.getTime() + cfg.janelaDeVetoMinutos * 60_000);
      const lead = await this.prisma.lead.findUniqueOrThrow({ where: { id: leadId }, select: { name: true } });
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
    const a = await this.dinheiro.aceiteDoLead(leadId);
    if (!a) return { pulado: 'sem aceite com dados' };
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

  private async efeitoDoFechamento(args: P, orgId: string, _ctx: ContextoDoEfeito): Promise<unknown> {
    const leadId = String(args.leadId ?? '');
    const chave = String(args.chave ?? '');
    const a = await this.dinheiro.aceiteDoLead(leadId);
    if (!a) throw new Error('o lead não tem aceite com dados: nada foi feito');
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
    const aprovado = await this.dinheiro.aceiteDaCobrancaAprovada(leadId, aceiteDeAgora);
    const a = aprovado ?? aceiteDeAgora;
    const SEM_COBRANCA_APROVADA = 'a cobrança aprovada pela titular ainda não existe: o fechamento não escreve cliente nem cobrança com dados que ela não viu';
    const escritas: EscritaDoFechamento[] = [];
    const refs: Partial<Record<EscritaDoFechamento['escrita'], string | null>> = {};

    const rodar = async (escrita: EscritaDoFechamento['escrita'], fn: () => Promise<{ estado: 'criado' | 'reaproveitado'; detalhe: string; ref: string | null }>) => {
      const antes = anteriores.get(escrita);
      const comecou = Date.now();
      let e: EscritaDoFechamento;
      try {
        const r = await fn();
        // Já estava pronta numa passada anterior: conta como reaproveitada, com o tempo de agora.
        const estado = antes && (antes.estado === 'criado' || antes.estado === 'reaproveitado') ? 'reaproveitado' : r.estado;
        e = { escrita, onde: ONDE[escrita], estado, detalhe: r.detalhe, ms: Date.now() - comecou, seRodarDeNovo: SE_RODAR_DE_NOVO[escrita], ref: r.ref };
      } catch (erro) {
        e = { escrita, onde: ONDE[escrita], estado: 'erro', detalhe: (erro instanceof Error ? erro.message : String(erro)).slice(0, 400), ms: Date.now() - comecou, seRodarDeNovo: SE_RODAR_DE_NOVO[escrita], ref: antes?.ref ?? null };
      }
      escritas.push(e);
      refs[escrita] = e.ref;
      await this.fio.registrar(orgId, leadId, 'fechamento.escrita', `${linha.chave}:${escrita}:${e.estado}:${e.ref ?? ''}`, { chave: linha.chave, escrita, estado: e.estado, ref: e.ref, ms: e.ms });
    };

    // 1. cliente: Partner, reaproveitado pelo CNPJ.
    // D-12: só se reaproveita um Partner que já é CLIENTE. O CNPJ vem da sala, que o cliente preenche sem
    // conferência: o fornecedor com o mesmo CNPJ não vira o cliente deste contrato nem é tocado; nasce outro.
    await rodar('cliente', async () => {
      if (!aprovado) throw new Error(SEM_COBRANCA_APROVADA);
      const doc = a.dados.cnpj.replace(/\D/g, '');
      const ja = await this.prisma.partner.findFirst({ where: { orgId, cnpjCpf: doc, isCliente: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (ja) {
        if (!ficha?.partnerId) await this.prisma.comercialFicha.updateMany({ where: { leadId, orgId }, data: { partnerId: ja.id } });
        return { estado: 'reaproveitado', detalhe: 'cliente já existia com este CNPJ', ref: ja.id };
      }
      const p = await this.prisma.partner.create({
        data: { orgId, isCliente: true, razaoSocial: a.dados.razaoSocial, cnpjCpf: doc, email: a.dados.email || null, phone: lead.phone ?? null },
      });
      await this.prisma.comercialFicha.updateMany({ where: { leadId, orgId }, data: { partnerId: p.id } });
      return { estado: 'criado', detalhe: a.dados.razaoSocial, ref: p.id };
    });

    // 2. cobrança: a que a aprovação de `comercial.cobranca.criar` criou, reaproveitada; nunca uma cobrança com outro devedor.
    await rodar('cobranca', async () => {
      if (!aprovado) throw new Error(SEM_COBRANCA_APROVADA);
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
      const parcelas = await this.prisma.comercialCobranca.findMany({ where: { leadId, orgId }, orderBy: { parcela: 'asc' } });
      if (!parcelas.length) throw new Error('sem parcelas: o contrato do Financeiro espera a cobrança');
      const primeira = parcelas[0];
      const ultima = parcelas[parcelas.length - 1];
      const proxima = parcelas.find((p) => !p.pagaEm) ?? ultima;
      const rotulo = TABELA_DE_PRECO[a.produto]?.rotulo ?? a.produto;
      await this.prisma.contract.create({
        data: {
          id,
          orgId,
          tipo: FinanceTxType.entrada,
          partnerId,
          descricao: `${rotulo} · ${a.dados.razaoSocial} · ${a.parcelas}× ${formatarReais(primeira.valorCentavos)} · ${linha.chave}`,
          valor: new Prisma.Decimal((primeira.valorCentavos / 100).toFixed(2)),
          diaVencimento: Number(primeira.vence.toISOString().slice(8, 10)),
          periodicidade: 'mensal',
          dataInicio: primeira.vence,
          dataFim: ultima.vence,
          proximoVencimento: proxima.vence,
        },
      });
      await this.prisma.comercialFicha.updateMany({ where: { leadId, orgId }, data: { contractId: id } });
      return { estado: 'criado', detalhe: `${a.parcelas}× ${formatarReais(primeira.valorCentavos)}, mensal`, ref: id };
    });

    // 4. kit e trilho: o trilho de implantação com os dados copiados.
    await rodar('kit_e_trilho', async () => {
      const ref = anteriores.get('kit_e_trilho')?.ref ?? ficha?.trilhoId ?? null;
      if (ref) {
        const t = await this.prisma.onboardingTrilho.findFirst({ where: { id: ref, orgId }, select: { id: true, fase: true } });
        if (t) return { estado: 'reaproveitado', detalhe: `trilho na fase ${FASES_DO_TRILHO.indexOf(t.fase) + 1} de 5`, ref: t.id };
      }
      if (!this.trilhos) throw new Error('o serviço do trilho não está disponível nesta instância');
      const manifesto = await this.manifesto(leadId, a);
      const t = await this.trilhos.criar(
        orgId,
        {
          cliente: a.dados.razaoSocial,
          contatoNome: a.dados.quemAssina,
          contatoWhatsapp: lead.phone ?? null,
          contatoEmail: a.dados.email || null,
          perfil: ficha?.perfil ?? null,
          reuniaoEm: ficha?.reuniaoEm?.toISOString() ?? null,
          observacoes: manifesto,
        },
        { id: null, nome: 'Fechamento comercial' },
      );
      await this.prisma.comercialFicha.updateMany({ where: { leadId, orgId }, data: { trilhoId: t.id } });
      // O comercial já qualificou: o trilho tenta passar pelo portão da fase 0. O portão é do onboarding e
      // recusa com a lista do que falta (próximo passo, dono, data...): isso vira lacuna à vista, não erro.
      let falta = '';
      try {
        await this.trilhos.avancar(orgId, t.id, { id: null, nome: 'Fechamento comercial' });
      } catch (e) {
        const r = (e as { getResponse?: () => unknown }).getResponse?.() as { faltando?: unknown } | undefined;
        falta = Array.isArray(r?.faltando) ? (r!.faltando as unknown[]).map(String).join('; ') : (e as Error).message;
      }
      const fase = (await this.prisma.onboardingTrilho.findUniqueOrThrow({ where: { id: t.id }, select: { fase: true } })).fase;
      const detalhe = `trilho aberto na fase ${FASES_DO_TRILHO.indexOf(fase) + 1} de 5. Lacunas [a decidir]: nível, receita e quem conduz${falta ? `. Para avançar a fase falta: ${falta}` : ''}`;
      return { estado: 'criado', detalhe: detalhe.slice(0, 400), ref: t.id };
    });

    // 5. grupo do cliente no WhatsApp (a M8 sai quando o kickoff for marcado).
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

    const essenciaisOk = ['cliente', 'contrato', 'cobranca'].every((k) => escritas.find((e) => e.escrita === k)?.estado !== 'erro');
    const tudoOk = escritas.every((e) => e.estado !== 'erro');
    const concluidoEm = tudoOk ? new Date() : null;
    const atual = await this.prisma.comercialFechamento.update({
      where: { id: linha.id },
      data: {
        estado: tudoOk ? 'concluido' : 'erro',
        escritas: escritas as unknown as Prisma.InputJsonValue,
        concluidoEm,
        erro: tudoOk ? null : escritas.filter((e) => e.estado === 'erro').map((e) => `${e.escrita}: ${e.detalhe}`).join(' · ').slice(0, 2000),
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

  /** O manifesto do kit: o que o comercial sabe, copiado (nada redigitado). */
  private async manifesto(leadId: string, a: AceiteDoLead): Promise<string> {
    const ficha = await this.prisma.comercialFicha.findUnique({ where: { leadId }, select: { ataHash: true, diagnostico: true, sistemaErp: true } });
    const rotulo = TABELA_DE_PRECO[a.produto]?.rotulo ?? a.produto;
    const linhas = [
      `Fechamento comercial ${chaveDoFechamento(leadId, a.versao)}.`,
      `Contratante: ${a.dados.razaoSocial} (${a.dados.cnpj}), ${a.dados.endereco}. Quem assina: ${a.dados.quemAssina} (${a.dados.email}).`,
      `Produto: ${rotulo}, ${formatarReais(a.valorCentavos)} em ${a.parcelas}x por ${a.forma}. Proposta v${a.versao}, hash ${a.hash.slice(0, 12)}.`,
    ];
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

  async doLead(orgId: string, leadId: string): Promise<FechamentoDoLead & { aprovacao: { id: string; status: string } | null; vetado: boolean }> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { id: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    const linha = await this.prisma.comercialFechamento.findFirst({ where: { leadId, orgId }, orderBy: { criadoEm: 'desc' } });
    if (!linha) {
      const a = await this.dinheiro.aceiteDoLead(leadId);
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
      };
    }
    const viva = await this.dinheiro.aprovacaoViva(orgId, CAP_FECHAMENTO, linha.chave);
    return { ...this.projetar(linha), aprovacao: viva ? { id: viva.id, status: viva.status } : null, vetado: !!linha.vetadoEm };
  }
}
