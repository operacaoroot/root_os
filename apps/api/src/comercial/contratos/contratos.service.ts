import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';
import { classificar } from '@mktos/policy';
import {
  MINUTOS_DA_CONFERENCIA,
  type ContratoCancelarInput,
  type ContratoCriarInput,
  type ContratoEditarInput,
  type ContratoFilhoInput,
  type ContratoFimInput,
  type ContratoLoteInput,
  type ContratoNaFicha,
  type ContratoReabrirInput,
  type QuadroDeContratos,
  type ResultadoDaConferencia,
  type ResultadoDoLote,
  type SignatariosInput,
} from '@mktos/shared';

import { alcadaDe, atendeAlcada, temPapelDeMaquina } from '../../approvals/alcada';
import { lerAprovador } from '../../auth/aprovador';
import { EfeitosRegistry, type ContextoDoEfeito } from '../../gateway/efeitos.registry';
import { FILA_DE_APROVACAO } from '../../gateway/fila-de-aprovacao';
import { InterruptoresRegistry } from '../../gateway/interruptores.registry';
import { PortaDoOperador } from '../../gateway/porta-do-operador.service';
import { exigirAcessoAtual } from '../../memory/acesso-memoria';
import { PrismaService } from '../../prisma/prisma.service';
import { contratosImportados, EFEITO_DE_ENCERRAR_CONTRATO } from '../contrato-vivo.service';
import { DinheiroService } from '../dinheiro.service';
import { canonico, hashDoConteudo, uuidDe, type PayloadDe } from '../eventos';
import { FioService, ReacoesRegistry } from '../fio.service';
import { assinaturaDoEstado, PORTA_DE_ASSINATURA, type PortaDeAssinatura } from '../portas/assinatura.port';
import { RelogioComercialRegistry } from '../relogio.registry';
import { WhatsappComercialService } from '../whatsapp.service';
import { lerFicha, lerQuadro } from './contratos-leitura';
import {
  FRASE_DO_IMPORTADO_NO_LOTE,
  chaveDoEncerramento,
  ehEstadoVivo,
  fimVigente,
  fraseDasParcelas,
  lerIdDoContrato,
  motivoParaNaoAbrirFilho,
  motivoParaNaoCancelar,
  motivoParaNaoEditar,
  motivoParaNaoEncerrar,
  motivoParaNaoMexerNosSignatarios,
  motivoParaNaoReabrir,
  motivoParaNaoReenviar,
} from './contratos-puro';

/*
 * O CONTRATO COMO REGISTRO PRÓPRIO (módulo de contratos, 02/11/2026, fases F1 e F3).
 *
 * Porta para o OS o que o FinOps tem de contrato, sobre a porta de assinatura que o OS já tem. Roteiro
 * e decisões: `docs/comercial/ROTEIRO-CONTRATOS-20261102.md`. O fio continua sendo o histórico: todo ato
 * grava um fato (`FATOS_DO_CONTRATO`) e uma linha na auditoria; o registro não substitui nenhum dos dois.
 *
 * TRÊS CAMINHOS:
 *   · INTERNOS (criar, editar, signatários, filhos, encerrar, reabrir): de gente, relida no banco, sob o
 *     cadeado do lead. Nada sai do OS: o nível sai do efeito pela escada (`EFEITO_DE_ENCERRAR_CONTRATO`,
 *     R0), e se o efeito mudar a conta sobe e a rota recusa.
 *   · CANCELAR E REENVIAR: escrevem ou falam para fora. A rota só PROPÕE, pela porta, em nome de quem
 *     clicou (`comercial.contrato.cancelar`, `comercial.contrato.reenviar`, R3): essa pessoa não confirma
 *     o próprio pedido. Os efeitos abaixo são os únicos que chamam `cancelar` e `reenviar` da porta.
 *   · CONFERIR: lê o provedor e grava pelo caminho do webhook (`DinheiroService.aplicarAssinatura`).
 *     ARRASTAR NÃO INVENTA REALIDADE: assinatura muda só por webhook ou por `consultarEstado`.
 *
 * CONTRATO IMPORTADO (`importado:<leadId>`) não tem linha: o quadro o lê do fio. O primeiro ato sobre ele
 * cria o registro (`assumirImportado`), com a `origem` do fato.
 *
 * FICA PARA A F2 (minuta vira PDF): `vincularMinuta` abaixo é o ponto de entrada. O envio do registro é
 * `comercial.contrato.enviar` com `contratoId` nos argumentos: `efeitoDeContrato` já liga o documento
 * criado a esse registro (`garantirContratoDoDocumento`). F5 (MCP) lê `quadro` e `ficha` daqui.
 */

export const CAP_CANCELAR = 'comercial.contrato.cancelar';
export const CAP_REENVIAR = 'comercial.contrato.reenviar';

/** Quantos contratos o relógio confere por passagem, em cada empresa. */
export const TETO_DA_CONFERENCIA_POR_PASSAGEM = 20;

export interface QuemNoContrato {
  id: string;
  nome: string | null;
  papeis: readonly string[];
}

type Pessoa = { id: string; nome: string | null };
type OrigemDaConferencia = 'botao' | 'lote' | 'relogio';
type LinhaDoContrato = Prisma.ComercialContratoGetPayload<{ include: { signatarios: true } }>;

const RECUSA_DE_MAQUINA = 'Contrato é de gente: conta de serviço (IA) não mexe aqui. O agente propõe o envio pela porta.';

function dataDoCampo(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  return v === null ? null : new Date(`${v}T00:00:00.000Z`);
}

@Injectable()
export class ContratosService implements OnModuleInit {
  private readonly log = new Logger('ComercialContratos');

  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly reacoes: ReacoesRegistry,
    private readonly efeitos: EfeitosRegistry,
    private readonly relogio: RelogioComercialRegistry,
    private readonly operador: PortaDoOperador,
    private readonly dinheiro: DinheiroService,
    @Inject(PORTA_DE_ASSINATURA) private readonly assinatura: PortaDeAssinatura,
    @Optional() private readonly whats?: WhatsappComercialService,
    @Optional() private readonly interruptores?: InterruptoresRegistry,
  ) {}

  onModuleInit(): void {
    this.efeitos.registrar(
      {
        [CAP_CANCELAR]: (args, orgId, ctx) => this.efeitoDeCancelar(args, orgId, ctx),
        [CAP_REENVIAR]: (args, orgId, ctx) => this.efeitoDeReenviar(args, orgId, ctx),
      },
      'comercial/contratos.service',
    );
    this.relogio.inscrever('contratos.conferir', (orgId, agora) => this.conferirEmAssinatura(orgId, agora));
    // O registro acompanha o que os caminhos de sempre gravam no fio.
    this.reacoes.inscrever('cliente.ativo', 'contratos.cliente-ativo', (ev) => this.aoClienteAtivo(ev.orgId, ev.leadId));
    this.reacoes.inscrever('contrato.concluido', 'contratos.concluido-a-mao', (ev) => this.aoConcluirPeloLead(ev.orgId, ev.leadId, ev.payload, ev.em));
  }

  // -------------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------------

  quadro(orgId: string, agora?: Date): Promise<QuadroDeContratos> {
    return lerQuadro(this.prisma, orgId, this.assinatura.configurada(), agora);
  }

  ficha(orgId: string, id: string, agora?: Date): Promise<ContratoNaFicha> {
    return lerFicha(this.prisma, orgId, id, this.assinatura.configurada(), agora);
  }

  // -------------------------------------------------------------------------
  // Quem age
  // -------------------------------------------------------------------------

  /** Gente de verdade, relida no banco: ativa, desta empresa, sem papel de máquina e com `leads.editar` agora. */
  private async exigirGente(orgId: string, quem: QuemNoContrato): Promise<Pessoa> {
    if (!quem.id || temPapelDeMaquina(quem.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    const doBanco = await lerAprovador(this.prisma, quem.id, orgId);
    if (!doBanco || !doBanco.ativo) throw new ForbiddenException('Só gente ativa da empresa mexe no contrato.');
    if (temPapelDeMaquina(doBanco.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    await exigirAcessoAtual(this.prisma, orgId, quem.id, ['leads.editar']);
    const u = await this.prisma.user.findFirst({ where: { id: quem.id, orgId }, select: { name: true } });
    return { id: quem.id, nome: u?.name ?? quem.nome };
  }

  /** O nível dos atos internos sai do efeito pela escada. Mudou o efeito, a conta sobe e a rota recusa. */
  private nivelInterno(): string {
    const nivel = classificar(EFEITO_DE_ENCERRAR_CONTRATO);
    if (nivel !== 'R0' && nivel !== 'R1') throw new ForbiddenException(`Este ato ficou ${nivel} pela escada: precisa de capacidade no catálogo antes de valer.`);
    return nivel;
  }

  private cadeado(tx: Prisma.TransactionClient, orgId: string, leadId: string): Promise<unknown> {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`comercial-contrato:${orgId}:${leadId}`}))`;
  }

  private auditar(tx: Prisma.TransactionClient, orgId: string, atorId: string | null, acao: string, contratoId: string, before: unknown, after: unknown, ator: ActorType = ActorType.user): Promise<unknown> {
    return tx.auditLog.create({
      data: {
        orgId, actorType: ator, actorId: atorId, action: acao, entityType: 'comercial.contrato', entityId: contratoId,
        before: (before ?? Prisma.JsonNull) as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue,
      },
    });
  }

  private async linha(orgId: string, id: string): Promise<LinhaDoContrato> {
    const r = await this.prisma.comercialContrato.findFirst({ where: { id, orgId }, include: { signatarios: true } });
    if (!r) throw new NotFoundException('Contrato não encontrado.');
    return r;
  }

  /** O registro de um id do quadro. Importado: cria o registro. Fantasma: ainda não há contrato. */
  private async registroParaAgir(orgId: string, id: string, pessoa: Pessoa): Promise<LinhaDoContrato> {
    const alvo = lerIdDoContrato(id);
    if (alvo.tipo === 'fantasma') throw new ConflictException('Este cliente ainda não tem contrato: crie o contrato antes.');
    if (alvo.tipo === 'importado') return this.assumirImportado(orgId, alvo.leadId, pessoa);
    return this.linha(orgId, alvo.id);
  }

  /**
   * O primeiro ato sobre um contrato importado cria o registro. Mais de um importado no lead continua sendo UM
   * contrato (o cartão soma): a primeira origem vai em `origemImportada`, todas em `dadosDoContrato.origens`.
   */
  private async assumirImportado(orgId: string, leadId: string, pessoa: Pessoa, agora: Date = new Date()): Promise<LinhaDoContrato> {
    const fatos = await this.prisma.leadEvent.findMany({ where: { orgId, leadId, type: 'contrato.importado' }, select: { payload: true } });
    if (!fatos.length) throw new NotFoundException('Contrato importado não encontrado.');
    const importados = contratosImportados(fatos);
    const principal = importados[0]!;
    const soma = importados.every((c) => c.valorCentavos !== null) ? importados.reduce((s, c) => s + (c.valorCentavos ?? 0), 0) : null;
    const [ficha, fins] = await Promise.all([
      this.prisma.comercialFicha.findFirst({ where: { orgId, leadId }, select: { partnerId: true, valorCentavos: true, valorNegociadoCentavos: true } }),
      this.prisma.leadEvent.findMany({ where: { orgId, leadId, type: { in: ['contrato.concluido', 'contrato.desativado', 'contrato.reaberto'] } }, select: { type: true, payload: true, occurredAt: true } }),
    ]);
    const fim = fimVigente(fins);
    const concluido = fim?.type === 'contrato.concluido' ? fim : null;
    const id = uuidDe([orgId, 'comercial-contrato', 'importado', leadId]);
    const evento = await this.prisma.$transaction(async (tx) => {
      await this.cadeado(tx, orgId, leadId);
      const ja = await tx.comercialContrato.findFirst({ where: { orgId, leadId, origemImportada: { not: null } }, select: { id: true } });
      if (ja) return null;
      await tx.comercialContrato.create({
        data: {
          id, leadId, partnerId: ficha?.partnerId ?? null, tipo: 'contrato', estado: concluido ? 'encerrado' : 'ativo',
          valorCentavos: soma ?? ficha?.valorNegociadoCentavos ?? ficha?.valorCentavos ?? null, origemImportada: principal.origem,
          dadosDoContrato: { origens: importados.map((c) => c.origem) },
          motivoDoFim: concluido ? String(((concluido.payload ?? {}) as Record<string, unknown>).motivo ?? '') : null, encerradoEm: concluido?.occurredAt ?? null,
        },
      });
      const g = await this.fio.gravarNaTransacao(tx, orgId, leadId, 'contrato.registrado', `${id}:importado`, { contratoId: id, tipo: 'contrato', ato: 'importado_assumido', por: pessoa.nome, porId: pessoa.id }, agora);
      await this.auditar(tx, orgId, pessoa.id, 'comercial.contrato.importado_assumido', id, null, { leadId, origens: importados.map((c) => c.origem), eventoId: g.evento.eventoId });
      return g.novo ? g.evento : null;
    });
    if (evento) await this.fio.reagir(evento);
    return this.linha(orgId, (await this.prisma.comercialContrato.findFirstOrThrow({ where: { orgId, leadId, origemImportada: { not: null } }, select: { id: true } })).id);
  }

  // -------------------------------------------------------------------------
  // Criar, editar, signatários
  // -------------------------------------------------------------------------

  /** Cria do lead. Idempotente: um contrato vivo por lead, e o segundo clique devolve o mesmo. */
  async criar(orgId: string, quem: QuemNoContrato, input: ContratoCriarInput, agora: Date = new Date()): Promise<ContratoNaFicha> {
    const pessoa = await this.exigirGente(orgId, quem);
    const nivel = this.nivelInterno();
    const lead = await this.prisma.lead.findFirst({ where: { id: input.leadId, orgId }, select: { id: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    const leadId = lead.id;
    const importado = await this.prisma.leadEvent.findFirst({ where: { orgId, leadId, type: 'contrato.importado' }, select: { id: true } });
    const assumido = importado ? await this.prisma.comercialContrato.findFirst({ where: { orgId, leadId, origemImportada: { not: null } }, select: { id: true } }) : null;
    if (importado && !assumido) {
      const r = await this.assumirImportado(orgId, leadId, pessoa, agora);
      return this.ficha(orgId, r.id, agora);
    }
    const ficha = await this.prisma.comercialFicha.findFirst({ where: { orgId, leadId }, select: { partnerId: true, valorCentavos: true, valorNegociadoCentavos: true } });
    const r = await this.prisma.$transaction(async (tx) => {
      await this.cadeado(tx, orgId, leadId);
      const vivos = await tx.comercialContrato.findMany({ where: { orgId, leadId, tipo: 'contrato' }, orderBy: { criadoEm: 'desc' }, select: { id: true, estado: true } });
      const vivo = vivos.find((c) => ehEstadoVivo(c.estado));
      if (vivo) return { id: vivo.id, evento: null };
      const criado = await tx.comercialContrato.create({
        data: { leadId, partnerId: ficha?.partnerId ?? null, tipo: 'contrato', modalidade: input.modalidade, estado: 'a_emitir', valorCentavos: ficha?.valorNegociadoCentavos ?? ficha?.valorCentavos ?? null },
        select: { id: true },
      });
      const g = await this.fio.gravarNaTransacao(tx, orgId, leadId, 'contrato.registrado', `${criado.id}:criado`, { contratoId: criado.id, tipo: 'contrato', ato: 'criado', por: pessoa.nome, porId: pessoa.id }, agora);
      await this.auditar(tx, orgId, pessoa.id, 'comercial.contrato.criado', criado.id, null, { leadId, modalidade: input.modalidade, nivel, eventoId: g.evento.eventoId });
      return { id: criado.id, evento: g.novo ? g.evento : null };
    });
    if (r.evento) await this.fio.reagir(r.evento);
    return this.ficha(orgId, r.id, agora);
  }

  async editar(orgId: string, id: string, quem: QuemNoContrato, input: ContratoEditarInput, agora: Date = new Date()): Promise<ContratoNaFicha> {
    const pessoa = await this.exigirGente(orgId, quem);
    const nivel = this.nivelInterno();
    const atual = await this.registroParaAgir(orgId, id, pessoa);
    const campos = Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined);
    if (!campos.length) return this.ficha(orgId, atual.id, agora);
    const recusa = motivoParaNaoEditar(atual.estado, campos);
    if (recusa) throw new ConflictException(recusa);
    const inicio = input.vigenciaInicio === undefined ? atual.vigenciaInicio?.toISOString().slice(0, 10) ?? null : input.vigenciaInicio;
    const fim = input.vigenciaFim === undefined ? atual.vigenciaFim?.toISOString().slice(0, 10) ?? null : input.vigenciaFim;
    if (inicio && fim && fim < inicio) throw new BadRequestException('A vigência termina antes de começar.');
    const antes = { modalidade: atual.modalidade, numero: atual.numero, vigenciaInicio: atual.vigenciaInicio, vigenciaFim: atual.vigenciaFim, faturaPor: atual.faturaPor };
    const evento = await this.prisma.$transaction(async (tx) => {
      await this.cadeado(tx, orgId, atual.leadId);
      const n = await tx.comercialContrato.updateMany({
        where: { id: atual.id, estado: atual.estado },
        data: {
          ...(input.modalidade !== undefined ? { modalidade: input.modalidade } : {}),
          ...(input.numero !== undefined ? { numero: input.numero?.trim() || null } : {}),
          ...(input.faturaPor !== undefined ? { faturaPor: input.faturaPor?.trim() || null } : {}),
          ...(input.vigenciaInicio !== undefined ? { vigenciaInicio: dataDoCampo(input.vigenciaInicio) } : {}),
          ...(input.vigenciaFim !== undefined ? { vigenciaFim: dataDoCampo(input.vigenciaFim) } : {}),
        },
      });
      if (!n.count) throw new ConflictException('O contrato mudou agora há pouco. Recarregue antes de salvar.');
      const chave = `${atual.id}:editado:${hashDoConteudo({ campos: input, em: agora.toISOString() }).slice(0, 16)}`;
      const g = await this.fio.gravarNaTransacao(tx, orgId, atual.leadId, 'contrato.registrado', chave, { contratoId: atual.id, tipo: atual.tipo, ato: 'editado', campos, por: pessoa.nome, porId: pessoa.id }, agora);
      await this.auditar(tx, orgId, pessoa.id, 'comercial.contrato.editado', atual.id, antes, { ...input, nivel, eventoId: g.evento.eventoId });
      return g.novo ? g.evento : null;
    });
    if (evento) await this.fio.reagir(evento);
    return this.ficha(orgId, atual.id, agora);
  }

  /** Quem assina pela Root só pode ser usuário ativo titular desta empresa, relido no banco (decisão D4). */
  private async conferirRoot(orgId: string, email: string): Promise<{ nome: string; email: string }> {
    const recusa = new BadRequestException(`Quem assina pela Root precisa ser um usuário ativo e titular desta empresa: ${email} não é.`);
    const u = await this.prisma.user.findFirst({ where: { orgId, isActive: true, email: { equals: email, mode: 'insensitive' } }, select: { id: true, name: true, email: true } });
    if (!u) throw recusa;
    const doBanco = await lerAprovador(this.prisma, u.id, orgId);
    if (!doBanco?.ativo || temPapelDeMaquina(doBanco.papeis) || !atendeAlcada('titular', alcadaDe(doBanco.papeis))) throw recusa;
    return { nome: u.name, email: u.email };
  }

  async definirSignatarios(orgId: string, id: string, quem: QuemNoContrato, input: SignatariosInput, agora: Date = new Date()): Promise<ContratoNaFicha> {
    const pessoa = await this.exigirGente(orgId, quem);
    const nivel = this.nivelInterno();
    const alvo = lerIdDoContrato(id);
    if (alvo.tipo !== 'registro') throw new ConflictException('Os signatários só valem para contrato que ainda vai para assinatura.');
    const atual = await this.linha(orgId, alvo.id);
    const recusa = motivoParaNaoMexerNosSignatarios(atual.estado);
    if (recusa) throw new ConflictException(recusa);
    const lista = await Promise.all(
      input.signatarios.map(async (s, i) => {
        const doBanco = s.papel === 'root' ? await this.conferirRoot(orgId, s.email) : { nome: s.nome.trim(), email: s.email.trim() };
        return { contratoId: atual.id, ordem: i + 1, papel: s.papel, nome: doBanco.nome, email: doBanco.email };
      }),
    );
    const evento = await this.prisma.$transaction(async (tx) => {
      await this.cadeado(tx, orgId, atual.leadId);
      const agoraNoBanco = await tx.comercialContrato.findFirst({ where: { id: atual.id, orgId }, select: { estado: true } });
      const recusaDentro = agoraNoBanco ? motivoParaNaoMexerNosSignatarios(agoraNoBanco.estado) : 'Contrato não encontrado.';
      if (recusaDentro) throw new ConflictException(recusaDentro);
      await tx.comercialContratoSignatario.deleteMany({ where: { contratoId: atual.id } });
      await tx.comercialContratoSignatario.createMany({ data: lista });
      const chave = `${atual.id}:signatarios:${hashDoConteudo(lista.map((s) => [s.ordem, s.papel, s.email.toLowerCase()])).slice(0, 16)}`;
      // No fio, só a contagem: nome e e-mail ficam na tabela e na auditoria.
      const g = await this.fio.gravarNaTransacao(tx, orgId, atual.leadId, 'contrato.registrado', chave, { contratoId: atual.id, tipo: atual.tipo, ato: 'signatarios', campos: [`${lista.length} signatários`], por: pessoa.nome, porId: pessoa.id }, agora);
      await this.auditar(tx, orgId, pessoa.id, 'comercial.contrato.signatarios', atual.id, { total: atual.signatarios.length }, { total: lista.length, papeis: lista.map((s) => s.papel), nivel, eventoId: g.evento.eventoId });
      return g.novo ? g.evento : null;
    });
    if (evento) await this.fio.reagir(evento);
    return this.ficha(orgId, atual.id, agora);
  }

  // -------------------------------------------------------------------------
  // Aditivo e distrato
  // -------------------------------------------------------------------------

  private parcelasEmAberto(orgId: string, leadId: string): Promise<number> {
    return this.prisma.comercialCobranca.count({ where: { orgId, leadId, pagaEm: null } });
  }

  /**
   * Abre um aditivo ou distrato em rascunho, sobre contrato ativo. Distrato com parcela em aberto pede ciência e
   * NÃO cancela a cobrança (como o encerrar). O mesmo pedido de novo cai no mesmo rascunho. A F2 gera o PDF.
   */
  async criarFilho(orgId: string, id: string, quem: QuemNoContrato, input: ContratoFilhoInput, agora: Date = new Date()): Promise<ContratoNaFicha> {
    const pessoa = await this.exigirGente(orgId, quem);
    const nivel = this.nivelInterno();
    const pai = await this.registroParaAgir(orgId, id, pessoa);
    const recusa = motivoParaNaoAbrirFilho(pai);
    if (recusa) throw new ConflictException(recusa);
    const emAberto = input.tipo === 'distrato' ? await this.parcelasEmAberto(orgId, pai.leadId) : 0;
    if (emAberto > 0 && !input.cienteDasParcelas) throw new BadRequestException(fraseDasParcelas(emAberto, 'distratar'));
    const filhoId = uuidDe([orgId, 'comercial-contrato', pai.id, input.tipo, canonico({ motivo: input.motivo, mudancas: input.mudancas ?? null, vigenciaFim: input.vigenciaFim ?? null, valorCentavos: input.valorCentavos ?? null })]);
    const evento = await this.prisma.$transaction(async (tx) => {
      await this.cadeado(tx, orgId, pai.leadId);
      if (await tx.comercialContrato.findFirst({ where: { id: filhoId }, select: { id: true } })) return null;
      if (input.tipo === 'distrato') {
        const outro = await tx.comercialContrato.findFirst({ where: { orgId, paiId: pai.id, tipo: 'distrato', estado: { notIn: ['cancelado'] } }, select: { id: true } });
        if (outro) throw new ConflictException('Este contrato já tem um distrato aberto.');
      }
      await tx.comercialContrato.create({
        data: {
          id: filhoId, leadId: pai.leadId, partnerId: pai.partnerId, paiId: pai.id, tipo: input.tipo, modalidade: pai.modalidade, estado: 'rascunho', faturaPor: pai.faturaPor,
          valorCentavos: input.valorCentavos ?? null, vigenciaFim: input.vigenciaFim ? new Date(`${input.vigenciaFim}T00:00:00.000Z`) : null,
          dadosDoContrato: { motivo: input.motivo, mudancas: input.mudancas ?? null, parcelasEmAberto: emAberto, cienteDasParcelas: emAberto > 0 },
          ...(pai.signatarios.length ? { signatarios: { create: pai.signatarios.map((s) => ({ ordem: s.ordem, papel: s.papel, nome: s.nome, email: s.email })) } } : {}),
        },
      });
      const g = input.tipo === 'distrato'
        ? await this.fio.gravarNaTransacao(tx, orgId, pai.leadId, 'contrato.distrato', filhoId, { contratoId: filhoId, paiId: pai.id, motivo: input.motivo, parcelasEmAberto: emAberto, cienteDasParcelas: emAberto > 0, por: pessoa.nome, porId: pessoa.id }, agora)
        : await this.fio.gravarNaTransacao(tx, orgId, pai.leadId, 'contrato.aditivo', filhoId, { contratoId: filhoId, paiId: pai.id, motivo: input.motivo, por: pessoa.nome, porId: pessoa.id }, agora);
      await this.auditar(tx, orgId, pessoa.id, `comercial.contrato.${input.tipo}`, filhoId, null, { paiId: pai.id, parcelasEmAberto: emAberto, cienteDasParcelas: emAberto > 0, nivel, eventoId: g.evento.eventoId });
      return g.novo ? g.evento : null;
    });
    if (evento) await this.fio.reagir(evento);
    return this.ficha(orgId, pai.id, agora);
  }

  // -------------------------------------------------------------------------
  // Encerrar e reabrir
  // -------------------------------------------------------------------------

  /**
   * Encerrar à mão: R0 interno, como o encerrar do contrato vivo (`ContratoVivoService.encerrar`), e pelo mesmo
   * fato, para a lista de contratos vivos e a régua dos importados contarem igual. Não cancela cobrança.
   */
  async encerrar(orgId: string, id: string, quem: QuemNoContrato, input: ContratoFimInput, agora: Date = new Date()): Promise<ContratoNaFicha> {
    const pessoa = await this.exigirGente(orgId, quem);
    const nivel = this.nivelInterno();
    const atual = await this.registroParaAgir(orgId, id, pessoa);
    const recusa = motivoParaNaoEncerrar(atual.estado, atual.tipo);
    if (recusa) throw new ConflictException(recusa);
    const emAberto = await this.parcelasEmAberto(orgId, atual.leadId);
    if (emAberto > 0 && !input.cienteDasParcelas) throw new BadRequestException(fraseDasParcelas(emAberto, 'encerrar'));
    const evento = await this.prisma.$transaction(async (tx) => {
      await this.cadeado(tx, orgId, atual.leadId);
      const n = await tx.comercialContrato.updateMany({ where: { id: atual.id, estado: { in: ['assinado', 'ativo'] } }, data: { estado: 'encerrado', motivoDoFim: input.motivo, encerradoEm: agora } });
      if (!n.count) throw new ConflictException('Este contrato já mudou de estado. Recarregue.');
      const reaberturas = await tx.leadEvent.count({ where: { leadId: atual.leadId, type: 'contrato.reaberto' } });
      const g = await this.fio.gravarNaTransacao(tx, orgId, atual.leadId, 'contrato.concluido', chaveDoEncerramento(reaberturas), { motivo: input.motivo, por: pessoa.id, porNome: pessoa.nome, parcelasEmAberto: emAberto, nivel, contratoId: atual.id }, agora);
      await this.auditar(tx, orgId, pessoa.id, 'comercial.contrato.encerrado', atual.id, { estado: atual.estado }, { estado: 'encerrado', parcelasEmAberto: emAberto, nivel, eventoId: g.evento.eventoId });
      return g.novo ? g.evento : null;
    });
    if (evento) await this.fio.reagir(evento);
    return this.ficha(orgId, atual.id, agora);
  }

  async reabrir(orgId: string, id: string, quem: QuemNoContrato, input: ContratoReabrirInput, agora: Date = new Date()): Promise<ContratoNaFicha> {
    const pessoa = await this.exigirGente(orgId, quem);
    const nivel = this.nivelInterno();
    const atual = await this.registroParaAgir(orgId, id, pessoa);
    const recusa = motivoParaNaoReabrir(atual.estado);
    if (recusa) throw new ConflictException(recusa);
    const evento = await this.prisma.$transaction(async (tx) => {
      await this.cadeado(tx, orgId, atual.leadId);
      const n = await tx.comercialContrato.updateMany({ where: { id: atual.id, estado: 'encerrado' }, data: { estado: 'ativo', motivoDoFim: null, encerradoEm: null } });
      if (!n.count) throw new ConflictException('Este contrato já mudou de estado. Recarregue.');
      const reaberturas = await tx.leadEvent.count({ where: { leadId: atual.leadId, type: 'contrato.reaberto' } });
      const g = await this.fio.gravarNaTransacao(tx, orgId, atual.leadId, 'contrato.reaberto', `${atual.id}:${reaberturas + 1}`, { contratoId: atual.id, motivo: input.motivo ?? null, nivel, por: pessoa.id, porNome: pessoa.nome }, agora);
      await this.auditar(tx, orgId, pessoa.id, 'comercial.contrato.reaberto', atual.id, { estado: 'encerrado', motivoDoFim: atual.motivoDoFim }, { estado: 'ativo', motivo: input.motivo ?? null, nivel, eventoId: g.evento.eventoId });
      return g.novo ? g.evento : null;
    });
    if (evento) await this.fio.reagir(evento);
    return this.ficha(orgId, atual.id, agora);
  }

  // -------------------------------------------------------------------------
  // Conferir (F3)
  // -------------------------------------------------------------------------

  private exigirProvedor(): void {
    if (!this.assinatura.configurada()) {
      throw new ServiceUnavailableException('A ZapSign não tem token nesta instância: não dá para conferir nem enviar. Quem contrata o plano de API são os sócios.');
    }
  }

  async conferir(orgId: string, id: string, quem: QuemNoContrato, agora: Date = new Date(), origem: OrigemDaConferencia = 'botao'): Promise<ResultadoDaConferencia> {
    const pessoa = await this.exigirGente(orgId, quem);
    const alvo = lerIdDoContrato(id);
    if (alvo.tipo !== 'registro') throw new ConflictException('Este contrato não tem documento na ZapSign para conferir.');
    const atual = await this.linha(orgId, alvo.id);
    if (!atual.documentoId) throw new ConflictException('Este contrato ainda não tem documento na ZapSign para conferir.');
    this.exigirProvedor();
    const recusaDoConector = await this.interruptores?.consultar({ orgId, conector: 'zapsign', actorType: ActorType.user, actorId: pessoa.id });
    if (recusaDoConector) throw new ForbiddenException('O conector da ZapSign está desligado em Conexões: nada foi consultado.');
    const r = await this.conferirUm(orgId, atual, origem, pessoa, agora);
    await this.prisma.auditLog.create({
      data: { orgId, actorType: ActorType.user, actorId: pessoa.id, action: 'comercial.contrato.conferido', entityType: 'comercial.contrato', entityId: atual.id, before: { estado: atual.estado } as Prisma.InputJsonValue, after: { estado: r.estado, mudou: r.mudou, ...r.assinaturas } as Prisma.InputJsonValue },
    });
    return r;
  }

  /**
   * Consulta o provedor e grava pelo MESMO caminho do webhook: reentrega não duplica, consulta acha assinatura sem
   * webhook. Só um documento deste provedor se consulta (anexo não está lá). Fato no fio só quando há novidade.
   */
  private async conferirUm(orgId: string, atual: LinhaDoContrato, origem: OrigemDaConferencia, pessoa: Pessoa | null, agora: Date): Promise<ResultadoDaConferencia> {
    const doc = await this.prisma.comercialDocumento.findFirst({ where: { id: atual.documentoId!, orgId }, select: { id: true, provedor: true, externoId: true, assinadoClienteEm: true, assinadoRootEm: true } });
    const antes = { feitas: atual.signatarios.filter((s) => s.assinadoEm).length, total: atual.signatarios.length };
    const resposta = (estado: string, mudou: boolean, conta: { feitas: number; total: number }, frase: string): ResultadoDaConferencia => ({ contratoId: atual.id, estado: estado as ResultadoDaConferencia['estado'], mudou, assinaturas: conta, frase });
    if (!doc || doc.provedor !== this.assinatura.provedor) {
      return resposta(atual.estado, false, antes, 'Este documento não está na ZapSign: não há o que consultar.');
    }
    let estado;
    try {
      estado = await this.assinatura.consultarEstado(doc.externoId);
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      this.log.warn(`conferência do contrato ${atual.id}: ${(e as Error).message}`);
      throw new BadGatewayException('A ZapSign não respondeu agora: nada mudou. Tente de novo em instantes.');
    }
    await this.prisma.comercialContrato.updateMany({ where: { id: atual.id }, data: { ultimaConferenciaEm: agora } });
    if (!estado) {
      return resposta(atual.estado, false, antes, 'A ZapSign não acha mais este documento. Confira no painel dela e cancele o contrato aqui, se for o caso.');
    }
    const docAntes = (doc.assinadoClienteEm ? 1 : 0) + (doc.assinadoRootEm ? 1 : 0);
    const aplicado = await this.dinheiro.aplicarAssinatura(orgId, atual.leadId, doc.id, assinaturaDoEstado(estado));
    const reflexo = aplicado.registro;
    const conta = reflexo ? { feitas: reflexo.feitas, total: reflexo.total } : antes;
    const novoEstado = reflexo?.estado ?? atual.estado;
    const mudou = (reflexo?.mudou ?? false) || aplicado.gravados > 0 || (atual.signatarios.length === 0 && conta.feitas !== docAntes);
    if (mudou) {
      const chave = `${atual.id}:${novoEstado}:${conta.feitas}`;
      const payload: PayloadDe<'contrato.conferido'> = { contratoId: atual.id, externoId: doc.externoId, estado: novoEstado, feitas: conta.feitas, total: conta.total, origem, por: pessoa?.nome ?? null };
      await this.fio.registrar(orgId, atual.leadId, 'contrato.conferido', chave, payload, { em: agora });
    }
    const frase = estado.estado === 'assinado'
      ? 'Todos assinaram na ZapSign.'
      : `${conta.feitas} de ${conta.total} assinaturas na ZapSign${mudou ? ': novidade gravada.' : ': nada novo.'}`;
    return resposta(novoEstado, mudou, conta, frase);
  }

  /** A tarefa do relógio: só os contratos em assinatura, os mais antigos primeiro, com teto. Sem token ou com o conector desligado, nada. */
  async conferirEmAssinatura(orgId: string, agora: Date): Promise<{ conferidos: number; mudaram: number; erros: number }> {
    if (!this.assinatura.configurada()) return { conferidos: 0, mudaram: 0, erros: 0 };
    if (await this.interruptores?.consultar({ orgId, conector: 'zapsign', actorType: ActorType.system })) return { conferidos: 0, mudaram: 0, erros: 0 };
    const limite = new Date(agora.getTime() - MINUTOS_DA_CONFERENCIA * 60_000);
    const alvos = await this.prisma.comercialContrato.findMany({
      where: { orgId, estado: 'em_assinatura', documentoId: { not: null }, OR: [{ ultimaConferenciaEm: null }, { ultimaConferenciaEm: { lte: limite } }] },
      orderBy: [{ ultimaConferenciaEm: { sort: 'asc', nulls: 'first' } }, { criadoEm: 'asc' }],
      take: TETO_DA_CONFERENCIA_POR_PASSAGEM,
      include: { signatarios: true },
    });
    let mudaram = 0;
    let erros = 0;
    for (const c of alvos) {
      try {
        const r = await this.conferirUm(orgId, c, 'relogio', null, agora);
        if (r.mudou) mudaram++;
      } catch (e) {
        // A passagem seguinte tenta de novo; marcar a conferência leva o que falha para o fim da fila.
        erros++;
        this.log.warn(`conferência do contrato ${c.id} na passagem do relógio: ${(e as Error).message}`);
        await this.prisma.comercialContrato.updateMany({ where: { id: c.id }, data: { ultimaConferenciaEm: agora } });
      }
    }
    return { conferidos: alvos.length, mudaram, erros };
  }

  // -------------------------------------------------------------------------
  // Cancelar e reenviar: a rota propõe, o efeito faz (F3)
  // -------------------------------------------------------------------------

  private async proporParaAPorta(orgId: string, atual: { id: string }, capabilityId: string, args: Record<string, unknown>, pessoa: Pessoa): Promise<unknown> {
    const viva = await this.dinheiro.aprovacaoViva(orgId, capabilityId, atual.id);
    // O segundo clique responde como o primeiro: a tela lê `aguardando_aprovacao` e diz que está na fila.
    if (viva) return { status: 'aguardando_aprovacao', approvalId: viva.id, jaNaFila: true, precisaDeOutraPessoa: true, fila: FILA_DE_APROVACAO, mensagem: 'Este pedido já está na fila, esperando outra pessoa aprovar.' };
    return this.operador.executar({ orgId, actorId: pessoa.id, actorType: ActorType.user, capabilityId, args, resource: { type: 'comercial.contrato', id: atual.id } });
  }

  async proporCancelar(orgId: string, id: string, quem: QuemNoContrato, input: ContratoCancelarInput): Promise<unknown> {
    const pessoa = await this.exigirGente(orgId, quem);
    const alvo = lerIdDoContrato(id);
    if (alvo.tipo !== 'registro') throw new ConflictException('Contrato importado não está na ZapSign: encerre em vez de cancelar.');
    const atual = await this.linha(orgId, alvo.id);
    const recusa = motivoParaNaoCancelar(atual.estado);
    if (recusa) throw new ConflictException(recusa);
    return this.proporParaAPorta(orgId, atual, CAP_CANCELAR, { contratoId: atual.id, motivo: input.motivo }, pessoa);
  }

  async proporReenviar(orgId: string, id: string, quem: QuemNoContrato): Promise<unknown> {
    const pessoa = await this.exigirGente(orgId, quem);
    const alvo = lerIdDoContrato(id);
    if (alvo.tipo !== 'registro') throw new ConflictException('Contrato importado não está na ZapSign: não há link para reenviar.');
    const atual = await this.linha(orgId, alvo.id);
    const recusa = motivoParaNaoReenviar(atual.estado, atual.documentoId);
    if (recusa) throw new ConflictException(recusa);
    return this.proporParaAPorta(orgId, atual, CAP_REENVIAR, { contratoId: atual.id }, pessoa);
  }

  private async nomeDoAtor(orgId: string, ctx: ContextoDoEfeito): Promise<string | null> {
    if (!ctx.actorId) return null;
    return (await this.prisma.user.findFirst({ where: { id: ctx.actorId, orgId }, select: { name: true } }))?.name ?? null;
  }

  /**
   * O efeito de cancelar (só a porta chama). Relê o contrato: o estado mudou desde o pedido, nada sai. Pergunta ao
   * provedor antes de apagar: documento TODO ASSINADO não sai da ZapSign nunca (a assinatura é gravada e o cancelamento,
   * recusado). Documento parcialmente assinado sai: foi o que a pessoa aprovou. O registro, o hash e o fio ficam no OS.
   */
  private async efeitoDeCancelar(args: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito): Promise<unknown> {
    const atual = await this.linha(orgId, String(args.contratoId ?? ''));
    if (atual.estado === 'cancelado') return { contratoId: atual.id, reaproveitado: true };
    const recusa = motivoParaNaoCancelar(atual.estado);
    if (recusa) throw new Error(`${recusa} Nada foi cancelado.`);
    const motivo = String(args.motivo ?? '');
    let externoId: string | null = null;
    let jaNaoExistia = false;
    if (atual.documentoId) {
      const doc = await this.prisma.comercialDocumento.findFirst({ where: { id: atual.documentoId, orgId }, select: { id: true, provedor: true, externoId: true } });
      if (doc && doc.provedor === this.assinatura.provedor) {
        if (!this.assinatura.cancelar) throw new Error(`O conector de assinatura (${this.assinatura.provedor}) não cancela documento: nada foi feito.`);
        externoId = doc.externoId;
        const noProvedor = await this.assinatura.consultarEstado(doc.externoId);
        if (noProvedor?.estado === 'assinado') {
          await this.dinheiro.aplicarAssinatura(orgId, atual.leadId, doc.id, assinaturaDoEstado(noProvedor));
          throw new Error('Todos já assinaram na ZapSign: o documento não foi cancelado, e a assinatura foi gravada. Para terminar, encerre ou abra um distrato.');
        }
        jaNaoExistia = (await this.assinatura.cancelar(doc.externoId)).jaNaoExistia;
        // O link morto não é oferecido a mais ninguém.
        await this.prisma.comercialDocumento.updateMany({ where: { id: doc.id }, data: { estado: 'cancelado', linkCliente: null, linkRoot: null } });
      }
    }
    const por = await this.nomeDoAtor(orgId, ctx);
    const agora = new Date();
    const n = await this.prisma.comercialContrato.updateMany({ where: { id: atual.id, estado: atual.estado }, data: { estado: 'cancelado', motivoDoFim: motivo, encerradoEm: agora } });
    if (!n.count) this.log.warn(`contrato ${atual.id} mudou de estado durante o cancelamento`);
    await this.fio.registrar(orgId, atual.leadId, 'contrato.cancelado', atual.id, { contratoId: atual.id, externoId, motivo, jaNaoExistia, por }, { em: agora });
    await this.prisma.auditLog.create({
      data: { orgId, actorType: ctx.actorType ?? ActorType.system, actorId: ctx.actorId ?? null, action: 'comercial.contrato.cancelado', entityType: 'comercial.contrato', entityId: atual.id, before: { estado: atual.estado } as Prisma.InputJsonValue, after: { estado: 'cancelado', jaNaoExistia, approvalId: ctx.approvalId ?? null } as Prisma.InputJsonValue },
    });
    return { contratoId: atual.id, cancelado: true, jaNaoExistia };
  }

  /**
   * O efeito de reenviar (só a porta chama). A ZapSign NÃO reenvia e-mail: o documento nasce com
   * `disable_signer_emails` e quem fala com o cliente é o WhatsApp da Root. Reenviar é ler os links atuais e preparar
   * a M7 de novo para quem do cliente ainda não assinou; a M7 é outra capacidade e vai à fila como toda mensagem.
   * O link nunca volta no resultado (fica no rastro) nem vai ao fio, e o link que assina pela Root não sai por aqui.
   */
  private async efeitoDeReenviar(args: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito): Promise<unknown> {
    const atual = await this.linha(orgId, String(args.contratoId ?? ''));
    const recusa = motivoParaNaoReenviar(atual.estado, atual.documentoId);
    if (recusa) throw new Error(`${recusa} Nada foi reenviado.`);
    const doc = await this.prisma.comercialDocumento.findFirst({ where: { id: atual.documentoId!, orgId }, select: { id: true, provedor: true, externoId: true } });
    if (!doc || doc.provedor !== this.assinatura.provedor) throw new Error('Este documento não está na ZapSign: nada foi reenviado.');
    if (!this.assinatura.reenviar) throw new Error(`O conector de assinatura (${this.assinatura.provedor}) não reenvia: nada foi feito.`);
    const noProvedor = await this.assinatura.reenviar(doc.externoId);
    if (!noProvedor) throw new Error('A ZapSign não acha mais este documento: nada foi reenviado.');
    if (noProvedor.estado === 'assinado') {
      await this.dinheiro.aplicarAssinatura(orgId, atual.leadId, doc.id, assinaturaDoEstado(noProvedor));
      return { contratoId: atual.id, reenviado: false, motivo: 'todos já assinaram' };
    }
    const pendentes = noProvedor.signatarios.filter((s) => s.assinadoEm === null);
    const doCliente = pendentes.filter((s) => s.papel === 'cliente' && s.link);
    const primeiro = doCliente[0];
    if (primeiro?.link) await this.prisma.comercialDocumento.updateMany({ where: { id: doc.id }, data: { linkCliente: primeiro.link } });
    const nomeDe = (token: string) => atual.signatarios.find((s) => s.tokenNoProvedor === token)?.nome ?? null;
    const lead = await this.prisma.lead.findFirst({ where: { id: atual.leadId, orgId }, select: { name: true } });
    const rodada = ctx.approvalId ?? new Date().toISOString();
    let preparadas = 0;
    if (this.whats) {
      for (const s of doCliente) {
        try {
          await this.whats.prepararTemplate(orgId, atual.leadId, 'M7', { linkAssinatura: s.link!, quemAssina: nomeDe(s.token) ?? lead?.name ?? 'Cliente' }, { chave: `reenvio:${doc.externoId}:${s.token}:${rodada}` });
          preparadas++;
        } catch (e) {
          this.log.warn(`M7 do reenvio do contrato ${atual.id}: ${(e as Error).message}`);
        }
      }
    }
    const por = await this.nomeDoAtor(orgId, ctx);
    const agora = new Date();
    await this.fio.registrar(orgId, atual.leadId, 'contrato.reenviado', `${atual.id}:${rodada}`, { contratoId: atual.id, externoId: doc.externoId, pendentes: pendentes.length, mensagemPreparada: preparadas > 0, por }, { em: agora });
    await this.prisma.auditLog.create({
      data: { orgId, actorType: ctx.actorType ?? ActorType.system, actorId: ctx.actorId ?? null, action: 'comercial.contrato.reenviado', entityType: 'comercial.contrato', entityId: atual.id, after: { pendentes: pendentes.length, mensagens: preparadas, approvalId: ctx.approvalId ?? null } as Prisma.InputJsonValue },
    });
    return { contratoId: atual.id, reenviado: preparadas > 0, pendentes: pendentes.length, mensagens: preparadas };
  }

  // -------------------------------------------------------------------------
  // Lote
  // -------------------------------------------------------------------------

  /** O contrato importado, derivado do fio ou já assumido como registro. */
  private async ehImportado(orgId: string, id: string): Promise<boolean> {
    const alvo = lerIdDoContrato(id);
    if (alvo.tipo === 'importado') return true;
    if (alvo.tipo !== 'registro') return false;
    const r = await this.prisma.comercialContrato.findFirst({ where: { id: alvo.id, orgId }, select: { origemImportada: true } });
    return !!r?.origemImportada;
  }

  /**
   * Um por um, sem parar no primeiro erro. Encerrar com parcela em aberto é recusado no item, com a frase: o lote não dá
   * ciência por ninguém, e essa ciência é por contrato, na ficha. Contrato importado também volta recusado em encerrar
   * e reabrir: quem cuida dele é a lista antiga. Item retido pela política vai em `retidos`, nem feito nem recusado: as
   * três ações de hoje são internas e nunca retêm, e o caminho fica pronto para o dia em que a escada subir alguma.
   */
  async lote(orgId: string, quem: QuemNoContrato, input: ContratoLoteInput, agora: Date = new Date()): Promise<ResultadoDoLote> {
    await this.exigirGente(orgId, quem);
    if (input.acao === 'encerrar' && !input.motivo) throw new BadRequestException('Encerrar em lote pede o motivo.');
    const ok: string[] = [];
    const recusados: ResultadoDoLote['recusados'] = [];
    const retidos: NonNullable<ResultadoDoLote['retidos']> = [];
    for (const id of new Set(input.ids)) {
      try {
        if (input.acao !== 'conferir' && (await this.ehImportado(orgId, id))) {
          recusados.push({ id, motivo: FRASE_DO_IMPORTADO_NO_LOTE });
          continue;
        }
        let r: unknown;
        if (input.acao === 'conferir') r = await this.conferir(orgId, id, quem, agora, 'lote');
        else if (input.acao === 'encerrar') r = await this.encerrar(orgId, id, quem, { motivo: input.motivo! }, agora);
        else r = await this.reabrir(orgId, id, quem, { motivo: input.motivo }, agora);
        const retido = r as { status?: unknown; approvalId?: unknown } | null;
        if (retido?.status === 'aguardando_aprovacao') retidos.push({ id, approvalId: typeof retido.approvalId === 'string' ? retido.approvalId : null });
        else ok.push(id);
      } catch (e) {
        recusados.push({ id, motivo: (e as Error).message });
      }
    }
    return { ok, recusados, retidos };
  }

  // -------------------------------------------------------------------------
  // F2: o ponto de entrada da minuta
  // -------------------------------------------------------------------------

  /**
   * A minuta ligada ao registro: o contrato passa a `rascunho`, com o conteúdo congelado e o hash. Quem chama é a F2
   * (a minuta que vira PDF), sem rota própria ainda. Depois disso, enviar é `comercial.contrato.enviar` com `contratoId`.
   */
  async vincularMinuta(orgId: string, contratoId: string, minuta: { minutaId: string; hash: string; dados: Prisma.InputJsonValue; por: string | null }, agora: Date = new Date()): Promise<void> {
    const atual = await this.linha(orgId, contratoId);
    const recusa = motivoParaNaoMexerNosSignatarios(atual.estado);
    if (recusa) throw new ConflictException('A minuta só muda antes de o contrato ir para assinatura.');
    await this.prisma.comercialContrato.updateMany({ where: { id: atual.id, estado: atual.estado }, data: { estado: 'rascunho', minutaId: minuta.minutaId, hashDoConteudo: minuta.hash, dadosDoContrato: minuta.dados } });
    await this.fio.registrar(orgId, atual.leadId, 'contrato.registrado', `${atual.id}:minuta:${minuta.hash.slice(0, 16)}`, { contratoId: atual.id, tipo: atual.tipo, ato: 'minuta', por: minuta.por, porId: null }, { em: agora });
  }

  // -------------------------------------------------------------------------
  // As reações
  // -------------------------------------------------------------------------

  private async aoClienteAtivo(orgId: string, leadId: string): Promise<void> {
    await this.prisma.comercialContrato.updateMany({ where: { orgId, leadId, tipo: 'contrato', estado: 'assinado' }, data: { estado: 'ativo' } });
  }

  /** Concluiu pela rota antiga (`POST contratos/:leadId/encerrar`): o registro do lead acompanha. O fato vindo daqui leva `contratoId`. */
  private async aoConcluirPeloLead(orgId: string, leadId: string, payload: PayloadDe<'contrato.concluido'>, em: Date): Promise<void> {
    if (payload.contratoId) return;
    await this.prisma.comercialContrato.updateMany({
      where: { orgId, leadId, tipo: 'contrato', estado: { in: ['assinado', 'ativo'] } },
      data: { estado: 'encerrado', motivoDoFim: payload.motivo, encerradoEm: em },
    });
  }
}
