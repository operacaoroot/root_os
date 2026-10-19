import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import {
  ComercialEntradaWhatsSchema,
  type ComercialEntradaWhatsInput,
  type ComercialEstadoDeMensagem,
  type ComercialTemplate,
} from '@mktos/shared';
import { ActorType, Prisma } from '@prisma/client';

import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { PortaDoOperador } from '../gateway/porta-do-operador.service';
import { PrismaService } from '../prisma/prisma.service';
import { dataCurtaSP, rotuloDoHorario } from './agenda-de-homologacao';
import { EvolutionProvider } from './canais/evolution.provider';
import { MetaProvider } from './canais/meta.provider';
import { SimuladoProvider } from './canais/simulado.provider';
import { provedorDoAmbiente, type BotaoInterativo, type EnvioFeito, type Interativo, type WhatsappPort } from './canais/whatsapp.port';
import { hashDoConteudo, leadIdDoTelefone, normalizarTelefone, uuidDe } from './eventos';
import { FioService, ReacoesRegistry } from './fio.service';
import { FORMULARIO_DE_QUALIFICACAO, MENSAGENS, textoDe, VariavelFaltandoError, type Variaveis } from './mensagens';
import { RelogioComercialRegistry } from './relogio.registry';
import { SalaService } from './sala.service';
import { comLinkDaSala, MARCADOR_DO_LINK_DA_SALA, temLinkDeSalaEmClaro } from './sala-token';
import { registrarTextos } from './textos-das-mensagens';

/*
 * O WHATSAPP DO COMERCIAL — Lane B (13/10/2026).
 *
 * "Agente prepara, pessoa envia" (C08, regra vigente). O serviço PREPARA a
 * mensagem (linha `ComercialMensagem`, id derivado do lead, do texto-modelo e
 * da chave do fato: a mesma reação repetida não prepara duas) e a entrega à
 * `PortaDoOperador` como a capacidade `comercial.whatsapp.enviar`. Quem
 * realiza o envio é o EFEITO inscrito aqui, e a porta só o chama quando a
 * régua deixa: a capacidade é R3 (sai da casa, irreversível, confidencial),
 * então a mensagem fica RETIDA na fila e uma SEGUNDA pessoa confirma em
 * `/atendimento` com um toque. O proponente é o sistema (`comercial`): quem
 * estiver de plantão confirma.
 *
 * O INTERRUPTOR `ComercialConfig.envioAutomatico` (padrão falso, K08-1) liga a
 * JANELA DE VETO: a mensagem espera `janelaDeVetoMinutos` em `em_veto` antes de
 * ir à porta, e um VETO na janela a cancela. Ele NÃO tira a mensagem da régua:
 * passada a janela, a porta decide como sempre, e R3 continua retido para a
 * segunda pessoa. Executar R3 sem aprovação não é configurável e não ficou
 * configurável aqui. A janela só tira o atrito de verdade no dia em que a mesa
 * reclassificar a capacidade (R2 configurável), pela escada, não por este
 * arquivo.
 *
 * QUANDO CADA TEXTO NASCE (C08, mapa do desenho):
 *   · M1 · reação a `lead.chegou`, com o formulário de qualificação e o link da sala;
 *   · M2 · reação a `form.respondido`, com dois horários em botões;
 *   · M3 · relógio, na véspera da conversa (D-1 do horário escolhido);
 *   · M4 · reação a `proposta.publicada`, com a validade;
 *   · M5 · relógio, `fupLeuDias` depois da primeira leitura sem resposta;
 *   · M6 · relógio, `fupSilencioDias` depois da publicação sem leitura nem
 *          resposta. A C08 exige uma NOVIDADE concreta (nunca só cobrança): o
 *          relógio prepara o rascunho e ele só vai à porta com a novidade
 *          escrita (`completarM6`), pelo fupeiro ou por gente;
 *   · M7 e M8 · são das lanes do contrato e do fechamento, que chamam
 *          `prepararTemplate` (M7) e `enviarNoGrupo` (M8).
 * Os dias do M5 e do M6 nascem `null` = desligado ([a decidir] pela mesa).
 */

export const CAPACIDADE_DO_WHATSAPP = 'comercial.whatsapp.enviar';
export const ATOR_DO_WHATSAPP = 'comercial';
const PREFIXO_DO_NOME_DE_RESERVA = 'Lead ';
const MARCA_DO_NOME = '\u0000';
const DIA_MS = 86_400_000;

/**
 * Os argumentos do pedido à porta: exatamente o que sai, para a aprovação ficar
 * presa ao conteúdo. São os nomes do `argsSchema` que a espinha declarou no
 * delta da política (`additionalProperties: false`): lead, mensagem, texto,
 * modelo e destino. O telefone (ou o grupo) é relido do banco no efeito.
 */
export interface ArgsDoEnvio {
  leadId: string;
  mensagemId: string;
  texto: string;
  template?: string;
  destino: 'lead' | 'grupo';
}

export interface MensagemPreparada {
  mensagemId: string;
  estado: ComercialEstadoDeMensagem;
  approvalId: string | null;
  nova: boolean;
}

type Linha = Prisma.ComercialMensagemGetPayload<object>;
type P = Record<string, unknown>;

function ehRetida(r: unknown): r is { status: 'aguardando_aprovacao'; approvalId: string } {
  return !!r && typeof r === 'object' && (r as P).status === 'aguardando_aprovacao';
}

/** O primeiro nome, ou `null` para o nome de reserva (lead que não disse o nome). */
export function nomeDeTratamento(nome: string | null | undefined): string | null {
  const n = String(nome ?? '').trim();
  if (!n || n.startsWith(PREFIXO_DO_NOME_DE_RESERVA)) return null;
  return n.split(/\s+/)[0];
}

/** O nome de reserva: nunca um nome inventado, só o fim do telefone. */
export function nomeDeReserva(telefone: string): string {
  return `${PREFIXO_DO_NOME_DE_RESERVA}${normalizarTelefone(telefone).slice(-4)}`;
}

/**
 * O texto do modelo com o nome, ou SEM o nome quando o lead não o disse: o
 * vocativo sai inteiro ("Oi, Marina." vira "Oi."), em vez de um nome inventado.
 */
export function textoComNome(template: ComercialTemplate, nome: string | null, variaveis: Variaveis): string {
  if (nome) return textoDe(template, { ...variaveis, nome });
  const bruto = textoDe(template, { ...variaveis, nome: MARCA_DO_NOME });
  return bruto
    .replace(new RegExp(`^${MARCA_DO_NOME},\\s*(.)`), (_, c: string) => c.toUpperCase())
    .replace(new RegExp(`,\\s*${MARCA_DO_NOME}`, 'g'), '')
    .replace(new RegExp(MARCA_DO_NOME, 'g'), '');
}

function provedorPorNome(): WhatsappPort {
  const p = provedorDoAmbiente();
  if (p === 'evolution') return new EvolutionProvider();
  if (p === 'meta') return new MetaProvider();
  return new SimuladoProvider();
}

@Injectable()
export class WhatsappComercialService implements OnModuleInit {
  private readonly log = new Logger('ComercialWhatsapp');
  readonly porta: WhatsappPort;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly reacoes: ReacoesRegistry,
    private readonly relogio: RelogioComercialRegistry,
    private readonly sala: SalaService,
    private readonly efeitos: EfeitosRegistry,
    private readonly operador: PortaDoOperador,
    @Optional() provedor?: WhatsappPort,
  ) {
    this.porta = provedor ?? provedorPorNome();
  }

  onModuleInit(): void {
    this.efeitos.registrar({ [CAPACIDADE_DO_WHATSAPP]: (args, orgId, ctx) => this.efeitoDeEnvio(args, orgId, ctx) }, 'comercial/whatsapp.service');

    registrarTextos((template, ctx) => {
      try {
        const vars = Object.fromEntries(Object.entries(ctx.variaveis).filter(([, v]) => typeof v === 'string' && v)) as Variaveis;
        return { texto: textoComNome(template, nomeDeTratamento(ctx.nome), vars), versao: `${template}.v${MENSAGENS[template].versao} ${MENSAGENS[template].data}` };
      } catch {
        return null;
      }
    }, 'lane B');

    this.reacoes.inscrever('lead.chegou', 'whats.m1', (ev) => this.prepararM1(ev.orgId, ev.leadId));
    this.reacoes.inscrever('form.respondido', 'whats.m2', (ev) => this.prepararM2(ev.orgId, ev.leadId, ev.em));
    this.reacoes.inscrever('proposta.publicada', 'whats.m4', (ev) => this.prepararM4(ev.orgId, ev.leadId, ev.payload));

    this.relogio.inscrever('whats.vespera', (orgId, agora) => this.vespera(orgId, agora));
    this.relogio.inscrever('whats.fup', (orgId, agora) => this.followUps(orgId, agora));
    this.relogio.inscrever('whats.janela-de-veto', (orgId, agora) => this.soltarJanelaDeVeto(orgId, agora));
  }

  // -------------------------------------------------------------------------
  // Entrada: o lead escreveu
  // -------------------------------------------------------------------------

  /**
   * A primeira mensagem de um telefone cria o lead (id derivado do telefone,
   * idempotente) e grava `lead.chegou` + `whats.recebida`. As seguintes gravam
   * só `whats.recebida`. A mesma mensagem reentregue cai no mesmo evento.
   */
  async receberEntrada(orgId: string, corpo: ComercialEntradaWhatsInput, em: Date = new Date()): Promise<{ leadId: string; leadNovo: boolean; eventoId: string }> {
    const e = ComercialEntradaWhatsSchema.parse(corpo);
    const telefone = normalizarTelefone(e.telefone);
    const leadId = leadIdDoTelefone(orgId, telefone);
    const criado = await this.prisma.lead.createMany({
      data: [{ id: leadId, orgId, name: e.nome ?? nomeDeReserva(telefone), phone: telefone, enteredAt: em }],
      skipDuplicates: true,
    });
    const mensagemExterna = e.mensagemId ?? hashDoConteudo({ telefone, texto: e.texto, minuto: em.toISOString().slice(0, 16) });
    await this.gravarEntrada(orgId, leadId, e.texto, mensagemExterna, em);
    await this.fio.registrar(
      orgId,
      leadId,
      'lead.chegou',
      'whatsapp',
      { telefone, texto: e.texto, canal: e.canal ?? null, palavraChave: e.palavraChave ?? null, nome: e.nome ?? null },
      { em },
    );
    const r = await this.fio.registrar(orgId, leadId, 'whats.recebida', mensagemExterna, { texto: e.texto, mensagemId: mensagemExterna, provedor: this.porta.provedor }, { em: new Date(em.getTime() + 1) });
    return { leadId, leadNovo: criado.count === 1, eventoId: r.eventoId };
  }

  /** Mensagem de texto de um lead que já existe (o simulador e o webhook do provedor). */
  async receberDoLead(orgId: string, leadId: string, texto: string, mensagemId: string | null = null, em: Date = new Date()): Promise<{ eventoId: string; novo: boolean }> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { phone: true } });
    if (!lead) throw new Error('lead não encontrado nesta empresa');
    const externo = mensagemId ?? hashDoConteudo({ leadId, texto, minuto: em.toISOString().slice(0, 16) });
    await this.gravarEntrada(orgId, leadId, texto, externo, em);
    return this.fio.registrar(orgId, leadId, 'whats.recebida', externo, { texto, mensagemId: externo, provedor: this.porta.provedor }, { em });
  }

  /** O que o lead "mostrou" no celular (resposta de formulário, toque em botão), sem virar fato por si. */
  async registrarNoCelular(orgId: string, leadId: string, texto: string, chave: string, em: Date = new Date()): Promise<void> {
    await this.gravarEntrada(orgId, leadId, texto, chave, em);
  }

  private async gravarEntrada(orgId: string, leadId: string, texto: string, externo: string, em: Date): Promise<void> {
    await this.prisma.comercialMensagem.createMany({
      data: [
        {
          id: uuidDe([orgId, 'comercial-mensagem-entrada', leadId, externo]),
          leadId,
          direcao: 'entrada',
          provedor: this.porta.provedor,
          destino: 'lead',
          texto,
          estado: 'recebida',
          mensagemExternaId: externo,
          criadoEm: em,
        },
      ],
      skipDuplicates: true,
    });
  }

  // -------------------------------------------------------------------------
  // Saída: preparar e entregar à porta (API para as outras lanes)
  // -------------------------------------------------------------------------

  /**
   * Prepara um dos oito textos para o lead e o entrega à porta. `chave` é a
   * identidade do fato (a mesma chave não prepara duas vezes). Variável que
   * falta = nada é preparado (lança `VariavelFaltandoError`).
   */
  async prepararTemplate(
    orgId: string,
    leadId: string,
    template: ComercialTemplate,
    variaveis: Variaveis,
    opcoes: { chave?: string; interativo?: Interativo; destino?: 'lead' | 'grupo'; para?: string } = {},
  ): Promise<MensagemPreparada> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { name: true } });
    if (!lead) throw new Error('lead não encontrado nesta empresa');
    const texto = textoComNome(template, nomeDeTratamento(lead.name), variaveis);
    return this.preparar(orgId, leadId, { template, texto, chave: opcoes.chave ?? template, interativo: opcoes.interativo, destino: opcoes.destino ?? 'lead', para: opcoes.para });
  }

  /** Texto livre para o lead (o assistente da proposta, uma resposta da mesa). Mesma régua. */
  async prepararTexto(orgId: string, leadId: string, texto: string, chave: string): Promise<MensagemPreparada> {
    return this.preparar(orgId, leadId, { template: null, texto, chave, destino: 'lead' });
  }

  /**
   * Cria o grupo do cliente no provedor. É escrita fora da casa: quem chama é o
   * EFEITO de uma capacidade da porta (o fechamento, lane D), nunca uma rota.
   * No simulado devolve um jid local; Evolution e Meta dizem por que não.
   */
  async criarGrupo(nome: string, participantes: string[]): Promise<{ jid: string }> {
    return this.porta.criarGrupo(nome, participantes.map(normalizarTelefone));
  }

  /** Texto no grupo do cliente (M8 e avisos). Vai pela porta como qualquer envio. */
  async enviarNoGrupo(orgId: string, leadId: string, jid: string, texto: string, opcoes: { template?: ComercialTemplate; chave: string }): Promise<MensagemPreparada> {
    return this.preparar(orgId, leadId, { template: opcoes.template ?? null, texto, chave: opcoes.chave, destino: 'grupo', para: jid });
  }

  /**
   * M8 pronto: o texto com nome, equipe e kickoff, no grupo.
   *
   * B-10 (revisão): a chave leva o horário do kickoff. Remarcado, sai um M8
   * novo com o horário novo, e o M8 de antes que ainda não saiu (rascunho, na
   * fila, na janela de veto ou em falha) fica `vetado`: o efeito recusa
   * mensagem vetada, então a liberação dele na fila não manda o horário velho.
   */
  async enviarM8(orgId: string, leadId: string, jid: string, variaveis: { equipe: string; kickoff: string }): Promise<MensagemPreparada> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { name: true } });
    const texto = textoComNome('M8', nomeDeTratamento(lead?.name), variaveis);
    const chave = `M8:${jid}:${variaveis.kickoff}`;
    const novoId = uuidDe([orgId, 'comercial-mensagem', leadId, 'M8', chave]);
    await this.prisma.comercialMensagem.updateMany({
      where: { orgId, leadId, template: 'M8', destino: 'grupo', mensagemExternaId: `para:${jid}`, estado: { in: ['rascunho', 'na_fila', 'em_veto', 'falhou'] }, id: { not: novoId } },
      data: { estado: 'vetada', erro: 'substituído: o kickoff foi remarcado e o M8 novo leva o horário novo' },
    });
    return this.enviarNoGrupo(orgId, leadId, jid, texto, { template: 'M8', chave });
  }

  /**
   * O M6 com a novidade escrita: reescreve o rascunho do relógio e o entrega à
   * porta. A novidade é texto livre: vai à porta EM NOME DE QUEM A ESCREVEU
   * (`quem`), para a invariante 7 valer (quem escreveu não libera o próprio
   * envio). `null` só para o fupeiro, que propõe como o sistema.
   */
  async completarM6(orgId: string, mensagemId: string, novidade: string, quem: { id: string } | null): Promise<MensagemPreparada> {
    const m = await this.prisma.comercialMensagem.findFirst({ where: { id: mensagemId, orgId, template: 'M6' } });
    if (!m) throw new Error('rascunho do M6 não encontrado');
    if (m.estado !== 'rascunho') return { mensagemId: m.id, estado: m.estado as ComercialEstadoDeMensagem, approvalId: m.approvalId, nova: false };
    const lead = await this.prisma.lead.findUniqueOrThrow({ where: { id: m.leadId }, select: { name: true } });
    const link = await this.marcadorDoLink(orgId, m.leadId);
    if (!link) throw new VariavelFaltandoError('M6', ['linkDaSala']);
    const texto = textoComNome('M6', nomeDeTratamento(lead.name), { novidade: novidade.trim(), linkDaSala: link });
    const atual = await this.prisma.comercialMensagem.update({ where: { id: m.id }, data: { texto, erro: null } });
    return this.submeter(atual, new Date(), quem);
  }

  /**
   * Uma PESSOA pede o envio de uma mensagem já preparada (rota
   * `POST /comercial/mensagens/:id/enviar`, a que o catálogo declara). Rascunho
   * e falha vão à porta em nome dela; o que já está na fila, na janela, enviado
   * ou vetado volta como está. A régua não muda: R3 fica retido e quem pediu não
   * pode liberar o próprio pedido (outra pessoa confirma em /atendimento).
   */
  async pedirEnvio(orgId: string, mensagemId: string, quem: { id: string }): Promise<MensagemPreparada> {
    const m = await this.prisma.comercialMensagem.findFirst({ where: { id: mensagemId, orgId, direcao: 'saida' } });
    if (!m) throw new NotFoundException('mensagem não encontrada');
    if (m.estado !== 'rascunho' && m.estado !== 'falhou') {
      return { mensagemId: m.id, estado: m.estado as ComercialEstadoDeMensagem, approvalId: m.approvalId, nova: false };
    }
    if (m.template === 'M6' && m.erro && m.texto.includes('[novidade:')) throw new BadRequestException('o M6 só sai com a novidade escrita');
    return this.submeter(m, new Date(), quem);
  }

  /** VETO na janela: a mensagem não sai. Só vale enquanto ela está `em_veto`. */
  async vetar(orgId: string, mensagemId: string): Promise<boolean> {
    const r = await this.prisma.comercialMensagem.updateMany({ where: { id: mensagemId, orgId, estado: 'em_veto' }, data: { estado: 'vetada' } });
    return r.count === 1;
  }

  private async preparar(
    orgId: string,
    leadId: string,
    m: { template: ComercialTemplate | null; texto: string; chave: string; interativo?: Interativo; destino: 'lead' | 'grupo'; para?: string },
  ): Promise<MensagemPreparada> {
    // O link da sala nunca entra em claro no texto guardado e assinado (B-1): quem
    // o colou (texto livre, um modelo novo) tem o link trocado pelo marcador, e o
    // efeito o reescreve na hora de entregar. Link de OUTRA sala não é trocado: recusa.
    m = { ...m, texto: await this.semOLinkDaSala(orgId, leadId, m.texto) };
    const id = uuidDe([orgId, 'comercial-mensagem', leadId, m.template ?? 'texto', m.chave]);
    const criado = await this.prisma.comercialMensagem.createMany({
      data: [
        {
          id,
          leadId,
          direcao: 'saida',
          provedor: this.porta.provedor,
          destino: m.destino,
          template: m.template,
          texto: m.texto,
          interativo: (m.interativo ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          estado: 'rascunho',
          // O jid do grupo não tem coluna própria: viaja na `mensagemExternaId` até o envio a trocar pelo id do provedor.
          ...(m.destino === 'grupo' && m.para ? { mensagemExternaId: `para:${m.para}` } : {}),
        },
      ],
      skipDuplicates: true,
    });
    const linha = await this.prisma.comercialMensagem.findUniqueOrThrow({ where: { id } });
    // Já está na fila, na janela, enviada ou vetada: nada a fazer. Rascunho e falha voltam à porta.
    if (linha.estado !== 'rascunho' && linha.estado !== 'falhou') {
      return { mensagemId: id, estado: linha.estado as ComercialEstadoDeMensagem, approvalId: linha.approvalId, nova: false };
    }
    const r = await this.submeter(linha);
    return { ...r, nova: criado.count === 1 };
  }

  /**
   * O marcador do link da sala, quando o link PODE ser reescrito na hora do envio
   * (há sala e a cifra do token abre). Sem isso o texto que pede o link não é
   * preparado: a mensagem sairia sem o caminho da sala.
   */
  private async marcadorDoLink(orgId: string, leadId: string): Promise<string | null> {
    return (await this.sala.linkDoLead(orgId, leadId)) ? MARCADOR_DO_LINK_DA_SALA : null;
  }

  /** O texto sem o link da sala em claro: o do próprio lead vira marcador; outro qualquer recusa. */
  private async semOLinkDaSala(orgId: string, leadId: string, texto: string): Promise<string> {
    if (!temLinkDeSalaEmClaro(texto)) return texto;
    const link = await this.sala.linkDoLead(orgId, leadId);
    const proprio = link ? texto.split(link).join(MARCADOR_DO_LINK_DA_SALA) : texto;
    if (temLinkDeSalaEmClaro(proprio)) {
      throw new BadRequestException('o texto leva o link de uma sala com o token em claro: nada foi preparado');
    }
    return proprio;
  }

  /** O marcador vira o link decifrado. Sem link para reescrever, o envio não sai. */
  private async textoDeEntrega(orgId: string, m: Linha): Promise<string> {
    if (temLinkDeSalaEmClaro(m.texto)) throw new Error('o texto guardado leva o link da sala em claro: nada foi enviado');
    if (!m.texto.includes(MARCADOR_DO_LINK_DA_SALA)) return m.texto;
    const link = await this.sala.linkDoLead(orgId, m.leadId);
    if (!link) throw new Error('o link da sala não pode ser reescrito (sala sem a cifra do token): nada foi enviado');
    return comLinkDaSala(m.texto, link);
  }

  private async config(orgId: string): Promise<{ envioAutomatico: boolean; janelaDeVetoMinutos: number | null; fupLeuDias: number | null; fupSilencioDias: number | null }> {
    const c = await this.prisma.comercialConfig.findUnique({ where: { orgId } });
    return {
      envioAutomatico: c?.envioAutomatico ?? false,
      janelaDeVetoMinutos: c?.janelaDeVetoMinutos ?? null,
      fupLeuDias: c?.fupLeuDias ?? null,
      fupSilencioDias: c?.fupSilencioDias ?? null,
    };
  }

  /** Para quem vai: o telefone do lead, ou o jid do grupo guardado no preparo. */
  private async destinoDe(m: Linha): Promise<string> {
    if (m.destino === 'grupo') {
      const para = (m.mensagemExternaId ?? '').startsWith('para:') ? m.mensagemExternaId!.slice(5) : '';
      if (!para) throw new Error('mensagem de grupo sem o grupo de destino');
      return para;
    }
    const lead = await this.prisma.lead.findUniqueOrThrow({ where: { id: m.leadId }, select: { phone: true } });
    if (!lead.phone) throw new Error('o lead não tem telefone');
    return lead.phone;
  }

  /** Entrega a mensagem à porta (ou à janela de veto, quando o interruptor está ligado). */
  private async submeter(m: Linha, agora: Date = new Date(), quem: { id: string } | null = null): Promise<MensagemPreparada> {
    const orgId = m.orgId;
    const cfg = await this.config(orgId);
    if (cfg.envioAutomatico && cfg.janelaDeVetoMinutos && m.estado === 'rascunho' && !m.vetoAte) {
      const vetoAte = new Date(agora.getTime() + cfg.janelaDeVetoMinutos * 60_000);
      await this.prisma.comercialMensagem.update({ where: { id: m.id }, data: { estado: 'em_veto', vetoAte } });
      return { mensagemId: m.id, estado: 'em_veto', approvalId: null, nova: false };
    }
    let args: ArgsDoEnvio;
    try {
      await this.destinoDe(m); // sem telefone (ou sem grupo) nem vai à porta
      args = { leadId: m.leadId, mensagemId: m.id, texto: m.texto, ...(m.template ? { template: m.template } : {}), destino: m.destino === 'grupo' ? 'grupo' : 'lead' };
      const r = await this.operador.executar({
        orgId,
        actorId: quem?.id ?? ATOR_DO_WHATSAPP,
        actorType: quem ? ActorType.user : ActorType.system,
        capabilityId: CAPACIDADE_DO_WHATSAPP,
        args: args as unknown as Record<string, unknown>,
        resource: { type: 'comercial.mensagem', id: m.id },
      });
      if (ehRetida(r)) {
        await this.prisma.comercialMensagem.update({ where: { id: m.id }, data: { estado: 'na_fila', approvalId: r.approvalId, erro: null } });
        return { mensagemId: m.id, estado: 'na_fila', approvalId: r.approvalId, nova: false };
      }
      const depois = await this.prisma.comercialMensagem.findUniqueOrThrow({ where: { id: m.id } });
      return { mensagemId: m.id, estado: depois.estado as ComercialEstadoDeMensagem, approvalId: depois.approvalId, nova: false };
    } catch (erro) {
      const msg = erro instanceof Error ? erro.message : String(erro);
      await this.prisma.comercialMensagem.updateMany({ where: { id: m.id, estado: { not: 'enviada' } }, data: { estado: 'falhou', erro: msg.slice(0, 1000) } });
      throw erro;
    }
  }

  /**
   * O EFEITO de `comercial.whatsapp.enviar`: só a porta chama, depois de a régua
   * deixar. Relê a mensagem e recusa se o texto mudou desde a aprovação; a
   * mensagem já enviada não sai duas vezes.
   */
  private async efeitoDeEnvio(args: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito): Promise<unknown> {
    const id = String(args.mensagemId ?? '');
    const m = await this.prisma.comercialMensagem.findFirst({ where: { id, orgId } });
    if (!m) throw new Error('mensagem não encontrada nesta empresa: nada foi enviado');
    if (m.estado === 'enviada') return { mensagemId: m.id, mensagemExternaId: m.mensagemExternaId, jaEnviada: true };
    if (m.estado === 'vetada') throw new Error('a mensagem foi vetada: nada foi enviado');
    if (m.texto !== args.texto) throw new Error('o texto mudou depois do pedido: nada foi enviado');
    if (m.leadId !== args.leadId || (m.destino === 'grupo' ? 'grupo' : 'lead') !== (args.destino ?? 'lead')) {
      throw new Error('o destino mudou depois do pedido: nada foi enviado');
    }
    // B-7 da revisão: toma a mensagem antes do provedor. Duas liberações juntas
    // (dois pedidos para a mesma mensagem) não mandam duas vezes: quem não tomar não envia.
    const tomada = await this.prisma.comercialMensagem.updateMany({ where: { id: m.id, orgId, estado: m.estado }, data: { estado: 'enviando' } });
    if (tomada.count === 0) {
      const agora = await this.prisma.comercialMensagem.findFirst({ where: { id: m.id, orgId }, select: { estado: true, mensagemExternaId: true } });
      if (agora?.estado === 'enviada') return { mensagemId: m.id, mensagemExternaId: agora.mensagemExternaId, jaEnviada: true };
      throw new Error('outra liberação já está enviando esta mensagem: nada foi enviado');
    }
    const para = await this.destinoDe(m);
    // O texto ENTREGUE: o marcador vira o link decifrado agora, e esse texto não é
    // gravado em lugar nenhum (nem na linha, nem no fato, nem no resultado).
    const entregue = await this.textoDeEntrega(orgId, m);

    let feito: EnvioFeito;
    try {
      const inter = (m.interativo ?? null) as Interativo | null;
      if (m.destino === 'grupo') feito = await this.porta.enviarNoGrupo(para, entregue);
      else if (inter?.formulario) feito = await this.porta.enviarFormulario(para, entregue, inter.formulario);
      else if (inter?.botoes?.length) feito = await this.porta.enviarBotoes(para, entregue, inter.botoes);
      else feito = await this.porta.enviarTexto(para, entregue);
    } catch (erro) {
      const msg = erro instanceof Error ? erro.message : String(erro);
      await this.prisma.comercialMensagem.update({ where: { id: m.id }, data: { estado: 'falhou', erro: msg.slice(0, 1000) } });
      throw erro;
    }
    const enviadaEm = new Date();
    await this.prisma.comercialMensagem.update({
      where: { id: m.id },
      data: { estado: 'enviada', enviadaEm, mensagemExternaId: feito.mensagemExternaId, erro: null, ...(ctx.approvalId ? { approvalId: ctx.approvalId } : {}) },
    });
    const aprovadaPor = ctx.approvalId ? (ctx.actorId ?? null) : null;
    const ev = await this.fio.registrar(orgId, m.leadId, 'whats.enviada', m.id, { template: m.template, texto: m.texto, provedor: feito.provedor, mensagemDbId: m.id, aprovadaPor }, { em: enviadaEm });
    if (m.template === 'M5' || m.template === 'M6') {
      // O follow-up também vira o seu fato próprio: o relógio e a torre contam por ele.
      const pub = await this.prisma.leadEvent.findFirst({ where: { leadId: m.leadId, type: 'proposta.publicada' }, orderBy: { occurredAt: 'desc' }, select: { payload: true } });
      const versao = Number(((pub?.payload ?? {}) as P).versao ?? 0);
      await this.fio.registrar(orgId, m.leadId, 'followup.enviado', m.id, { qual: m.template, versao, mensagemDbId: m.id }, { em: enviadaEm });
    }
    if (m.template === 'M3') {
      // A véspera ENVIADA é o fato que o portão de E3 pede ("confirmação de
      // véspera enviada"). Sem ele, o lead ficava em E3 para sempre: ninguém
      // gravava `agenda.confirmada` (achado da jornada de ponta a ponta, 13/10).
      const escolha = await this.prisma.leadEvent.findFirst({ where: { leadId: m.leadId, type: 'agenda.escolhida' }, orderBy: { occurredAt: 'desc' }, select: { payload: true } });
      const horario = String(((escolha?.payload ?? {}) as P).horario ?? '');
      if (horario) {
        await this.fio.registrar(orgId, m.leadId, 'agenda.confirmada', new Date(horario).toISOString(), { horario, via: feito.provedor }, { em: enviadaEm });
      } else {
        this.log.warn(`M3 de ${m.leadId} enviada sem horário escolhido no fio: a confirmação de véspera não foi gravada`);
      }
    }
    await this.prisma.comercialMensagem.update({ where: { id: m.id }, data: { eventoId: ev.eventoId } });
    return { mensagemId: m.id, mensagemExternaId: feito.mensagemExternaId, provedor: feito.provedor };
  }

  // -------------------------------------------------------------------------
  // As reações (C08)
  // -------------------------------------------------------------------------

  async prepararM1(orgId: string, leadId: string): Promise<MensagemPreparada> {
    await this.sala.garantir(orgId, leadId);
    const link = await this.marcadorDoLink(orgId, leadId);
    if (!link) throw new VariavelFaltandoError('M1', ['linkDaSala']);
    return this.prepararTemplate(orgId, leadId, 'M1', { linkDaSala: link }, {
      chave: 'primeiro',
      interativo: { formulario: { ...FORMULARIO_DE_QUALIFICACAO, campos: [...FORMULARIO_DE_QUALIFICACAO.campos] } },
    });
  }

  async prepararM2(orgId: string, leadId: string, agora: Date = new Date()): Promise<MensagemPreparada | { pulado: string }> {
    const escolhido = await this.prisma.leadEvent.findFirst({ where: { leadId, type: 'agenda.escolhida' }, select: { id: true } });
    if (escolhido) return { pulado: 'o horário já foi escolhido' };
    const horarios = await this.sala.garantirHorarios(orgId, leadId, agora);
    const [h1, h2] = horarios;
    if (!h1 || !h2) throw new VariavelFaltandoError('M2', ['horario1', 'horario2']);
    const botoes: BotaoInterativo[] = [h1, h2].map((h) => ({ chave: h, rotulo: rotuloDoHorario(h) }));
    return this.prepararTemplate(orgId, leadId, 'M2', { horario1: rotuloDoHorario(h1), horario2: rotuloDoHorario(h2) }, { chave: 'primeiro', interativo: { botoes } });
  }

  async prepararM4(orgId: string, leadId: string, payload: P | unknown): Promise<MensagemPreparada> {
    const p = (payload ?? {}) as P;
    const versao = Number(p.versao ?? 1);
    const link = await this.marcadorDoLink(orgId, leadId);
    if (!link) throw new VariavelFaltandoError('M4', ['linkDaSala']);
    const validade = typeof p.validaAte === 'string' && p.validaAte ? dataCurtaSP(p.validaAte) : '';
    return this.prepararTemplate(orgId, leadId, 'M4', { linkDaSala: link, validade }, { chave: `v${versao}` });
  }

  // -------------------------------------------------------------------------
  // O relógio (M3 na véspera, M5 e M6, a janela de veto)
  // -------------------------------------------------------------------------

  /** M3: a véspera da conversa. Sai uma vez por horário escolhido, nas 24 h antes dele. */
  async vespera(orgId: string, agora: Date): Promise<{ preparadas: number }> {
    const escolhas = await this.prisma.leadEvent.findMany({
      where: { orgId, type: 'agenda.escolhida', occurredAt: { gte: new Date(agora.getTime() - 30 * DIA_MS) } },
      orderBy: { occurredAt: 'desc' },
      select: { leadId: true, payload: true },
    });
    const vistos = new Set<string>();
    let preparadas = 0;
    for (const e of escolhas) {
      if (vistos.has(e.leadId)) continue;
      vistos.add(e.leadId);
      const horario = String(((e.payload ?? {}) as P).horario ?? '');
      const t = new Date(horario).getTime();
      if (Number.isNaN(t) || agora.getTime() < t - DIA_MS || agora.getTime() >= t) continue;
      const link = await this.marcadorDoLink(orgId, e.leadId);
      if (!link) continue;
      try {
        const r = await this.prepararTemplate(orgId, e.leadId, 'M3', { horario: rotuloDoHorario(horario), linkDaSala: link }, { chave: new Date(t).toISOString() });
        if (r.nova) preparadas++;
      } catch (erro) {
        this.log.warn(`M3 de ${e.leadId}: ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }
    return { preparadas };
  }

  /** M5 e M6 pelos dias da configuração. `null` = desligado ([a decidir]). */
  async followUps(orgId: string, agora: Date): Promise<{ m5: number; m6: number }> {
    const cfg = await this.config(orgId);
    if (!cfg.fupLeuDias && !cfg.fupSilencioDias) return { m5: 0, m6: 0 };
    const publicadas = await this.prisma.leadEvent.findMany({
      where: { orgId, type: 'proposta.publicada', occurredAt: { gte: new Date(agora.getTime() - 90 * DIA_MS) } },
      orderBy: { occurredAt: 'desc' },
      select: { leadId: true, payload: true, occurredAt: true },
    });
    const vistos = new Set<string>();
    let m5 = 0;
    let m6 = 0;
    for (const pub of publicadas) {
      if (vistos.has(pub.leadId)) continue;
      vistos.add(pub.leadId);
      const p = (pub.payload ?? {}) as P;
      const versao = Number(p.versao ?? 1);
      const depois = await this.prisma.leadEvent.findMany({
        where: { leadId: pub.leadId, occurredAt: { gte: pub.occurredAt }, type: { in: ['proposta.lida', 'proposta.aceita', 'proposta.duvida', 'proposta.ideia', 'proposta.ajuste_pedido', 'whats.recebida', 'saida.registrada'] } },
        orderBy: { occurredAt: 'asc' },
        select: { type: true, occurredAt: true, payload: true },
      });
      // I4: a ideia deixada na proposta é o cliente falando (conta como resposta, como a dúvida).
      // O "faz sentido" fica fora de propósito: é sinal de leitura, não pede nada à mesa.
      const respondeu = depois.some((d) => d.type !== 'proposta.lida');
      if (respondeu) continue;
      const primeiraLeitura = depois.find((d) => d.type === 'proposta.lida' && Number(((d.payload ?? {}) as P).versao) === versao);
      const link = await this.marcadorDoLink(orgId, pub.leadId);
      if (!link) continue;
      const validade = typeof p.validaAte === 'string' && p.validaAte ? dataCurtaSP(p.validaAte) : '';
      try {
        if (primeiraLeitura && cfg.fupLeuDias && agora.getTime() - primeiraLeitura.occurredAt.getTime() >= cfg.fupLeuDias * DIA_MS) {
          const r = await this.prepararTemplate(orgId, pub.leadId, 'M5', { validade }, { chave: `v${versao}` });
          if (r.nova) m5++;
        } else if (!primeiraLeitura && cfg.fupSilencioDias && agora.getTime() - pub.occurredAt.getTime() >= cfg.fupSilencioDias * DIA_MS) {
          if (await this.rascunhoDoM6(orgId, pub.leadId, versao, link)) m6++;
        }
      } catch (erro) {
        this.log.warn(`follow-up de ${pub.leadId}: ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }
    return { m5, m6 };
  }

  /** O rascunho do M6 espera a novidade: não vai à porta sem ela (C08: nunca só cobrança). */
  private async rascunhoDoM6(orgId: string, leadId: string, versao: number, link: string): Promise<boolean> {
    const lead = await this.prisma.lead.findUniqueOrThrow({ where: { id: leadId }, select: { name: true } });
    const pendente = '[novidade: falta escrever]';
    const texto = textoComNome('M6', nomeDeTratamento(lead.name), { novidade: pendente, linkDaSala: link });
    const r = await this.prisma.comercialMensagem.createMany({
      data: [
        {
          id: uuidDe([orgId, 'comercial-mensagem', leadId, 'M6', `v${versao}`]),
          leadId,
          direcao: 'saida',
          provedor: this.porta.provedor,
          destino: 'lead',
          template: 'M6',
          texto,
          estado: 'rascunho',
          erro: 'falta a novidade: o M6 só sai com um dado novo e concreto (C08)',
        },
      ],
      skipDuplicates: true,
    });
    return r.count === 1;
  }

  /** A janela de veto venceu sem VETO: a mensagem vai à porta (que decide como sempre). */
  async soltarJanelaDeVeto(orgId: string, agora: Date): Promise<{ soltas: number }> {
    const vencidas = await this.prisma.comercialMensagem.findMany({ where: { orgId, estado: 'em_veto', vetoAte: { lte: agora } }, take: 50 });
    let soltas = 0;
    for (const m of vencidas) {
      try {
        // Sai da janela antes de ir à porta: a mesma passagem repetida não manda duas vezes.
        const tomada = await this.prisma.comercialMensagem.updateMany({ where: { id: m.id, estado: 'em_veto' }, data: { estado: 'rascunho' } });
        if (tomada.count === 0) continue;
        await this.submeter({ ...m, estado: 'rascunho' }, agora);
        soltas++;
      } catch (erro) {
        this.log.warn(`janela de veto de ${m.id}: ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }
    return { soltas };
  }
}
