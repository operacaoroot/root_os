import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CODIGO_LEAD_COM_OUTRO_TELEFONE,
  COMERCIAL_ROTULO_DA_ETAPA,
  DefinirTelefoneSchema,
  MarcarEquipeSchema,
  TelefoneNoLeadSchema,
  VincularConversaSchema,
  lerWhatsappBr,
  ehGrupoDaEquipePeloNome,
  nomeDoGrupoSemPrefixo,
  type CandidatoDeVinculo,
  type ComercialEtapa,
  type ConversaDaCaixa,
  type SugestaoDeVinculo,
  type TipoDeVinculo,
  type WhatsappDaFicha,
} from '@mktos/shared';
import type { ZodType } from 'zod';

import { temPapelDeMaquina } from '../approvals/alcada';
import { lerAprovador } from '../auth/aprovador';
import { formasDaChave } from '../gateway/canais/identidade-de-canal';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { PrismaService } from '../prisma/prisma.service';
import {
  SELECT_DA_CONVERSA,
  SELECT_DA_MENSAGEM,
  nomeDoCliente,
  numeroDoChat,
  projetarConversas,
  projetarMensagens,
} from './projecao';
import {
  ACAO_DE_AUDITORIA,
  FRASE,
  decidirGrupo,
  decidirUmAUm,
  digitosDoTelefone,
  formasEmDigitos,
  ordenarCandidatos,
  telefoneCasa,
  type AlvoDaBusca,
  type NomesDoAlvo,
} from './vinculo';

/*
 * O VÍNCULO DA CONVERSA COM LEAD E CLIENTE (rodada de produção 4, W3, 22/10/2026).
 *
 * DOIS CAMINHOS, E SÓ UM DELES É AUTOMÁTICO:
 *
 *   · `casarConversa` (o contrato que o gravador e a sincronização chamam): 1:1
 *     casa SOZINHO pelo telefone gravado no lead e no cliente; grupo só ganha
 *     SUGESTÃO pelo nome IGUAL; número ou grupo da equipe vira `equipe`. Nunca
 *     lança, é idempotente e NUNCA mexe no que uma pessoa decidiu
 *     (`vinculadoPorId` preenchido) nem em conversa arquivada.
 *   · as ações da tela (vincular, aceitar a sugestão, desvincular, equipe,
 *     pôr o número no lead, editar o telefone): SÓ GENTE (o guarda pelo token e
 *     a releitura no banco, como o mover do funil), com `leads.editar` relido,
 *     auditadas, escrita condicionada (dois cliques = um vínculo). A decisão da
 *     pessoa é marcada em `vinculadoPorId` também quando ela DESLIGA ou marca
 *     equipe: assim o casamento automático não religa o que ela desligou.
 *
 * O `leadId`/`clienteId` da conversa vai para TODAS as mensagens dela, as
 * passadas também; desvincular limpa nas mensagens. É isso que o fio do lead e
 * a ficha do cliente leem.
 *
 * Nada de número, nome ou texto no log: só ids curtos e contagens.
 */

/**
 * Quanto o webhook espera o casamento de uma conversa antes de seguir para os
 * leitores de sempre (revisão 22C, A3). O casamento continua sozinho depois.
 */
export const PRAZO_DO_CASAMENTO_NO_WEBHOOK_MS = 2_000;

const RECUSA_DE_MAQUINA = 'Vincular conversa é de gente: conta de serviço (IA) não liga conversa a lead ou cliente.';

export type QuemVincula = { id: string; papeis: readonly string[] };
export type ComoVinculou = 'manual' | 'sugestao' | 'telefone' | 'script';

type Db = Prisma.TransactionClient | PrismaService;

export interface ResultadoDoVinculo {
  conversa: ConversaDaCaixa;
  mudou: boolean;
}

function ler<T>(schema: ZodType<T>, corpo: unknown): T {
  const r = schema.safeParse(corpo ?? {});
  if (!r.success) {
    throw new BadRequestException({ message: r.error.issues[0]?.message ?? 'Pedido inválido.', erros: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
  }
  return r.data;
}

/** Só as linhas cujo campo é diferente do valor (com a regra de nulo do SQL). */
function diferente(campo: 'leadId' | 'clienteId', valor: string | null): Prisma.WhatsAppMensagemWhereInput {
  if (valor === null) return { [campo]: { not: null } };
  return { OR: [{ [campo]: null }, { [campo]: { not: valor } }] };
}

@Injectable()
export class VinculoDoWhatsappService {
  private readonly log = new Logger('WhatsappVinculo');

  constructor(private readonly prisma: PrismaService) {}

  // =========================================================================
  // O CASAMENTO AUTOMÁTICO (contrato da lane A)
  // =========================================================================

  /**
   * CONTRATO (chamado pelo gravador e pela sincronização, lane A, depois de
   * criar ou atualizar uma conversa): casa a conversa sozinha (1:1 pelo
   * telefone; grupo pelo nome vira SUGESTÃO, nunca vínculo sem clique; equipe
   * pelo nome) e propaga o vínculo às mensagens. Nunca desfaz vínculo manual.
   * Idempotente; nunca lança.
   */
  async casarConversa(orgId: string, conversaId: string): Promise<void> {
    // Revisão 22C (A3): o gravador chama isto DENTRO do webhook, antes dos leitores de sempre
    // (o canal de aprovação). Com banco lento, o casamento não pode segurar a aprovação: espera
    // no máximo PRAZO_DO_CASAMENTO_NO_WEBHOOK_MS e segue; o casamento termina sozinho.
    // A9: só o nome e o código do erro vão ao log (a mensagem crua do Postgres traz a linha).
    const trabalho = this.casar(orgId, conversaId).then(
      () => undefined,
      (e: unknown) => {
        const erro = e as { name?: string; code?: string };
        this.log.warn(`casar a conversa ${conversaId.slice(0, 8)} falhou: ${erro?.name ?? 'erro'}${erro?.code ? ` (${erro.code})` : ''}`);
      },
    );
    let relogio: NodeJS.Timeout | undefined;
    await Promise.race([trabalho, new Promise<void>((ok) => (relogio = setTimeout(ok, PRAZO_DO_CASAMENTO_NO_WEBHOOK_MS)))]);
    if (relogio) clearTimeout(relogio);
  }

  /**
   * O casamento, lançando (o script e a suíte querem ver o erro). Devolve o que
   * mudou (ou mudaria, com `simular`: nada é escrito). `manual` = a conversa é
   * de decisão de pessoa ou arquivada, e o casamento não a toca.
   */
  async casar(
    orgId: string,
    conversaId: string,
    opcoes: { simular?: boolean } = {},
  ): Promise<{ mudou: boolean; manual: boolean; grupo: boolean; equipe: boolean; leadId: string | null; clienteId: string | null; sugestao: SugestaoDeVinculo | null }> {
    const c = await this.prisma.whatsAppConversa.findFirst({
      where: { id: conversaId, orgId },
      select: { id: true, grupo: true, chatJid: true, nome: true, equipe: true, leadId: true, clienteId: true, vinculoSugerido: true, vinculadoPorId: true, arquivadaEm: true },
    });
    if (!c) return { mudou: false, manual: false, grupo: false, equipe: false, leadId: null, clienteId: null, sugestao: null };
    const atual = { grupo: c.grupo, equipe: c.equipe, leadId: c.leadId, clienteId: c.clienteId, sugestao: (c.vinculoSugerido as SugestaoDeVinculo | null) ?? null };
    const simular = !!opcoes.simular;
    // O que a pessoa decidiu e a conversa arquivada ficam como estão; só as mensagens novas recebem o vínculo.
    if (c.vinculadoPorId || c.arquivadaEm) {
      if (!simular) await this.propagar(this.prisma, orgId, c.id, c.leadId, c.clienteId);
      return { mudou: false, manual: true, ...atual };
    }

    let novo: { equipe: boolean; leadId: string | null; clienteId: string | null; sugestao: SugestaoDeVinculo | null };
    if (c.grupo) {
      // Revisão 22C (A3): grupo da equipe ou sem o prefixo da casa não casa com ninguém; não carrega
      // as listas de clientes e leads a cada mensagem dele (a comunidade fala o dia inteiro).
      const precisaDasListas = !ehGrupoDaEquipePeloNome(c.nome) && !!nomeDoGrupoSemPrefixo(c.nome);
      const d = precisaDasListas
        ? decidirGrupo(c.nome, await this.clientesPorNome(orgId), await this.leadsPorNome(orgId))
        : decidirGrupo(c.nome, [], []);
      // Grupo NUNCA liga sozinho: o vínculo de grupo só existe com `vinculadoPorId` (o clique).
      novo = { equipe: d.equipe, leadId: null, clienteId: null, sugestao: d.sugestao };
    } else {
      const numero = numeroDoChat(c.chatJid, false);
      if (!numero) {
        if (!simular) await this.propagar(this.prisma, orgId, c.id, c.leadId, c.clienteId);
        return { mudou: false, manual: false, ...atual };
      }
      const equipe = await this.ehNumeroDaEquipe(orgId, numero);
      const d = decidirUmAUm(equipe, equipe ? [] : await this.leadsComTelefone(orgId, numero), equipe ? [] : await this.clientesComTelefone(orgId, numero));
      novo = { equipe: d.equipe, leadId: d.leadId, clienteId: d.clienteId, sugestao: null };
    }

    const igualSugestao = JSON.stringify(atual.sugestao ?? null) === JSON.stringify(novo.sugestao ?? null);
    const mudou = atual.equipe !== novo.equipe || atual.leadId !== novo.leadId || atual.clienteId !== novo.clienteId || !igualSugestao;
    if (simular) return { mudou, manual: false, grupo: c.grupo, ...novo };
    if (mudou) {
      // Escrita condicionada: só se ninguém decidiu nem ligou nada no meio.
      const r = await this.prisma.whatsAppConversa.updateMany({
        where: { id: c.id, orgId, vinculadoPorId: null, arquivadaEm: null, leadId: c.leadId, clienteId: c.clienteId },
        data: {
          equipe: novo.equipe,
          leadId: novo.leadId,
          clienteId: novo.clienteId,
          vinculoSugerido: novo.sugestao ? (novo.sugestao as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        },
      });
      if (r.count === 0) return { mudou: false, manual: false, ...atual };
    }
    await this.propagar(this.prisma, orgId, c.id, novo.leadId, novo.clienteId);
    return { mudou, manual: false, grupo: c.grupo, ...novo };
  }

  /** O vínculo da conversa vai para as mensagens dela (só as que diferem). */
  private async propagar(db: Db, orgId: string, conversaId: string, leadId: string | null, clienteId: string | null): Promise<number> {
    const r = await db.whatsAppMensagem.updateMany({
      where: { orgId, conversaId, OR: [diferente('leadId', leadId), diferente('clienteId', clienteId)] },
      data: { leadId, clienteId },
    });
    return r.count;
  }

  private async leadsComTelefone(orgId: string, numero: string): Promise<string[]> {
    const formas = formasEmDigitos(numero);
    if (!formas.length) return [];
    const linhas = await this.prisma.$queryRaw<{ id: string; phone: string | null }[]>`
      SELECT id, phone FROM "Lead"
      WHERE "orgId" = ${orgId} AND regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') IN (${Prisma.join(formas)})`;
    return linhas.filter((l) => telefoneCasa(l.phone, numero)).map((l) => l.id);
  }

  private async clientesComTelefone(orgId: string, numero: string): Promise<string[]> {
    const formas = formasEmDigitos(numero);
    if (!formas.length) return [];
    const linhas = await this.prisma.$queryRaw<{ id: string; phone: string | null }[]>`
      SELECT id, phone FROM "Partner"
      WHERE "orgId" = ${orgId} AND "isCliente" = true AND ativo = true AND interno = false
        AND regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') IN (${Prisma.join(formas)})`;
    return linhas.filter((l) => telefoneCasa(l.phone, numero)).map((l) => l.id);
  }

  /** Número de gente da casa: identidade de canal do WhatsApp ativa, ou o telefone de um usuário ativo. */
  private async ehNumeroDaEquipe(orgId: string, numero: string): Promise<boolean> {
    const identidade = await this.prisma.channelIdentity.findFirst({
      where: { orgId, canal: 'whatsapp', ativo: true, externalId: { in: formasDaChave(numero) } },
      select: { id: true },
    });
    if (identidade) return true;
    const pessoas = await this.prisma.user.findMany({ where: { orgId, isActive: true, phone: { not: null } }, select: { phone: true }, take: 500 });
    return pessoas.some((p) => telefoneCasa(p.phone, numero));
  }

  private async clientesPorNome(orgId: string): Promise<NomesDoAlvo[]> {
    const linhas = await this.prisma.partner.findMany({
      where: { orgId, isCliente: true, ativo: true, interno: false },
      select: { id: true, razaoSocial: true, nomeFantasia: true },
      take: 5000,
    });
    return linhas.map((p) => ({ tipo: 'cliente' as const, id: p.id, nome: nomeDoCliente(p), nomes: [p.nomeFantasia, p.razaoSocial] }));
  }

  private async leadsPorNome(orgId: string): Promise<NomesDoAlvo[]> {
    const linhas = await this.prisma.lead.findMany({
      where: { orgId },
      select: { id: true, name: true, ficha: { select: { empresa: true } } },
      take: 5000,
    });
    return linhas.map((l) => ({ tipo: 'lead' as const, id: l.id, nome: l.ficha?.empresa?.trim() || l.name, nomes: [l.name, l.ficha?.empresa] }));
  }

  // =========================================================================
  // AS AÇÕES DA TELA (só gente, auditadas)
  // =========================================================================

  /** Gente de verdade, relida no banco: ativa, desta empresa, sem papel de máquina e com `leads.editar` agora. */
  async exigirGente(orgId: string, quem: QuemVincula): Promise<void> {
    if (temPapelDeMaquina(quem.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    const doBanco = await lerAprovador(this.prisma, quem.id, orgId);
    if (!doBanco || !doBanco.ativo) throw new ForbiddenException('Quem vincula precisa ser um usuário ativo desta empresa.');
    if (temPapelDeMaquina(doBanco.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    await exigirAcessoAtual(this.prisma, orgId, quem.id, ['leads.editar']);
  }

  private async conversaOu404(db: Db, orgId: string, conversaId: string) {
    const c = await db.whatsAppConversa.findFirst({
      where: { id: conversaId, orgId },
      select: { id: true, grupo: true, chatJid: true, nome: true, equipe: true, leadId: true, clienteId: true, vinculoSugerido: true, vinculadoPorId: true, atualizadoEm: true },
    });
    if (!c) throw new NotFoundException('Conversa não encontrada nesta empresa.');
    return c;
  }

  private async alvoOu404(db: Db, orgId: string, tipo: TipoDeVinculo, id: string): Promise<void> {
    if (tipo === 'lead') {
      const l = await db.lead.findFirst({ where: { id, orgId }, select: { id: true } });
      if (!l) throw new NotFoundException('Lead não encontrado nesta empresa.');
    } else {
      const p = await db.partner.findFirst({ where: { id, orgId, isCliente: true }, select: { id: true } });
      if (!p) throw new NotFoundException('Cliente não encontrado nesta empresa.');
    }
  }

  private async projetada(orgId: string, conversaId: string): Promise<ConversaDaCaixa> {
    const linha = await this.prisma.whatsAppConversa.findFirst({ where: { id: conversaId, orgId }, select: SELECT_DA_CONVERSA });
    if (!linha) throw new NotFoundException('Conversa não encontrada nesta empresa.');
    return (await projetarConversas(this.prisma, orgId, [linha]))[0];
  }

  private async auditar(db: Db, orgId: string, actorId: string, action: string, entityType: string, entityId: string, before: unknown, after: unknown, metadata?: unknown) {
    await db.auditLog.create({
      data: {
        orgId,
        actorId,
        action,
        entityType,
        entityId,
        before: before == null ? Prisma.DbNull : (before as Prisma.InputJsonValue),
        after: after == null ? Prisma.DbNull : (after as Prisma.InputJsonValue),
        ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
      },
    });
  }

  /**
   * Liga a conversa a um lead ou cliente, NA TRANSAÇÃO de quem chama. Mesmo
   * alvo de novo = nada muda; outro alvo com vínculo já feito = 409 (desvincule
   * antes). Condicionada ao que foi lido: o clique duplo cai no "nada muda".
   */
  async vincularNaTransacao(
    tx: Prisma.TransactionClient,
    orgId: string,
    conversaId: string,
    alvo: { tipo: TipoDeVinculo; id: string },
    porId: string,
    como: ComoVinculou,
  ): Promise<boolean> {
    const c = await this.conversaOu404(tx, orgId, conversaId);
    const campo = alvo.tipo === 'lead' ? 'leadId' : 'clienteId';
    const outro = alvo.tipo === 'lead' ? 'clienteId' : 'leadId';
    if (c[campo] === alvo.id && !c[outro] && c.vinculadoPorId) return false;
    if (c.leadId || c.clienteId) {
      // Vínculo automático pelo telefone ao MESMO alvo: a pessoa só o confirma (vira manual).
      if (!(c[campo] === alvo.id && !c[outro])) throw new ConflictException(FRASE.jaLigada);
    }
    const leadId = alvo.tipo === 'lead' ? alvo.id : null;
    const clienteId = alvo.tipo === 'cliente' ? alvo.id : null;
    const r = await tx.whatsAppConversa.updateMany({
      where: { id: c.id, orgId, atualizadoEm: c.atualizadoEm, leadId: c.leadId, clienteId: c.clienteId },
      data: { leadId, clienteId, vinculadoPorId: porId, vinculadoEm: new Date(), vinculoSugerido: Prisma.DbNull, equipe: false },
    });
    if (r.count !== 1) throw new ConflictException(FRASE.mudou);
    const mensagens = await this.propagar(tx, orgId, c.id, leadId, clienteId);
    await this.auditar(
      tx, orgId, porId, ACAO_DE_AUDITORIA.vinculada, 'whatsapp_conversa', c.id,
      { leadId: c.leadId, clienteId: c.clienteId },
      { tipo: alvo.tipo, id: alvo.id, como },
      { mensagens, grupo: c.grupo },
    );
    return true;
  }

  async vincular(orgId: string, conversaId: string, corpo: unknown, quem: QuemVincula): Promise<ResultadoDoVinculo> {
    const e = ler(VincularConversaSchema, corpo);
    await this.exigirGente(orgId, quem);
    await this.conversaOu404(this.prisma, orgId, conversaId);
    await this.alvoOu404(this.prisma, orgId, e.tipo, e.id);
    const mudou = await this.prisma.$transaction((tx) => this.vincularNaTransacao(tx, orgId, conversaId, e, quem.id, 'manual'));
    return { conversa: await this.projetada(orgId, conversaId), mudou };
  }

  /** "Vincular a <nome>?": um clique aceita a sugestão gravada (o alvo é relido na empresa). */
  async aceitarSugestao(orgId: string, conversaId: string, quem: QuemVincula): Promise<ResultadoDoVinculo> {
    await this.exigirGente(orgId, quem);
    const c = await this.conversaOu404(this.prisma, orgId, conversaId);
    const s = c.vinculoSugerido as { tipo?: unknown; id?: unknown } | null;
    if (!s || (s.tipo !== 'lead' && s.tipo !== 'cliente') || typeof s.id !== 'string') {
      // Clique duplo depois de aceitar: a sugestão já virou vínculo.
      if (c.vinculadoPorId && (c.leadId || c.clienteId)) return { conversa: await this.projetada(orgId, conversaId), mudou: false };
      throw new ConflictException(FRASE.semSugestao);
    }
    const alvo = { tipo: s.tipo as TipoDeVinculo, id: s.id };
    await this.alvoOu404(this.prisma, orgId, alvo.tipo, alvo.id);
    const mudou = await this.prisma.$transaction((tx) => this.vincularNaTransacao(tx, orgId, conversaId, alvo, quem.id, 'sugestao'));
    return { conversa: await this.projetada(orgId, conversaId), mudou };
  }

  /**
   * Desliga a conversa do lead/cliente e limpa as mensagens. A decisão fica
   * marcada (`vinculadoPorId`): o casamento automático não religa.
   */
  async desvincular(orgId: string, conversaId: string, quem: QuemVincula): Promise<ResultadoDoVinculo> {
    await this.exigirGente(orgId, quem);
    const mudou = await this.prisma.$transaction(async (tx) => {
      const c = await this.conversaOu404(tx, orgId, conversaId);
      if (!c.leadId && !c.clienteId) return false;
      const r = await tx.whatsAppConversa.updateMany({
        where: { id: c.id, orgId, atualizadoEm: c.atualizadoEm, leadId: c.leadId, clienteId: c.clienteId },
        data: { leadId: null, clienteId: null, vinculadoPorId: quem.id, vinculadoEm: new Date(), vinculoSugerido: Prisma.DbNull },
      });
      if (r.count !== 1) throw new ConflictException(FRASE.mudou);
      const mensagens = await this.propagar(tx, orgId, c.id, null, null);
      await this.auditar(tx, orgId, quem.id, ACAO_DE_AUDITORIA.desvinculada, 'whatsapp_conversa', c.id, { leadId: c.leadId, clienteId: c.clienteId }, { leadId: null, clienteId: null }, { mensagens, grupo: c.grupo });
      return true;
    });
    return { conversa: await this.projetada(orgId, conversaId), mudou };
  }

  /** Marcar ou tirar da equipe. Ligada a lead ou cliente, marcar é 409: desvincule antes. */
  async marcarEquipe(orgId: string, conversaId: string, corpo: unknown, quem: QuemVincula): Promise<ResultadoDoVinculo> {
    const e = ler(MarcarEquipeSchema, corpo);
    await this.exigirGente(orgId, quem);
    const mudou = await this.prisma.$transaction(async (tx) => {
      const c = await this.conversaOu404(tx, orgId, conversaId);
      if (c.equipe === e.equipe && c.vinculadoPorId) return false;
      if (e.equipe && (c.leadId || c.clienteId)) throw new ConflictException(FRASE.equipeLigada);
      const r = await tx.whatsAppConversa.updateMany({
        where: { id: c.id, orgId, atualizadoEm: c.atualizadoEm },
        data: { equipe: e.equipe, vinculadoPorId: quem.id, vinculadoEm: new Date(), ...(e.equipe ? { vinculoSugerido: Prisma.DbNull } : {}) },
      });
      if (r.count !== 1) throw new ConflictException(FRASE.mudou);
      await this.auditar(tx, orgId, quem.id, ACAO_DE_AUDITORIA.equipe, 'whatsapp_conversa', c.id, { equipe: c.equipe }, { equipe: e.equipe });
      return c.equipe !== e.equipe || !c.vinculadoPorId;
    });
    return { conversa: await this.projetada(orgId, conversaId), mudou };
  }

  /**
   * "Este número não está em nenhum lead; pôr no lead X?": grava o número da
   * conversa 1:1 em `Lead.phone` (dígitos com DDI) e liga a conversa ao lead.
   * O lead com OUTRO telefone pede `substituir`; o número que já é de outro
   * lead é recusado (dois leads com o mesmo número = conversa sem dono).
   */
  async telefoneNoLead(orgId: string, conversaId: string, corpo: unknown, quem: QuemVincula): Promise<ResultadoDoVinculo> {
    const e = ler(TelefoneNoLeadSchema, corpo);
    await this.exigirGente(orgId, quem);
    const c = await this.conversaOu404(this.prisma, orgId, conversaId);
    const numero = c.grupo ? null : numeroDoChat(c.chatJid, false);
    if (!numero) throw new BadRequestException(FRASE.naoEUmAUm);
    const lead = await this.prisma.lead.findFirst({ where: { id: e.leadId, orgId }, select: { id: true, phone: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado nesta empresa.');
    if (lead.phone?.trim() && !telefoneCasa(lead.phone, numero) && !e.substituir) {
      throw new ConflictException({ message: FRASE.leadComOutroTelefone, error: CODIGO_LEAD_COM_OUTRO_TELEFONE });
    }
    const deOutros = (await this.leadsComTelefone(orgId, numero)).filter((id) => id !== lead.id);
    if (deOutros.length) throw new ConflictException(FRASE.numeroDeOutroLead);
    const mudou = await this.prisma.$transaction(async (tx) => {
      let gravou = false;
      if (!telefoneCasa(lead.phone, numero)) {
        const r = await tx.lead.updateMany({ where: { id: lead.id, orgId, phone: lead.phone }, data: { phone: numero } });
        if (r.count !== 1) throw new ConflictException(FRASE.mudou);
        await this.auditar(tx, orgId, quem.id, ACAO_DE_AUDITORIA.telefoneDoLead, 'lead', lead.id, { tinha: !!lead.phone?.trim() }, { definido: true }, { origem: 'whatsapp.conversa', conversaId: c.id });
        gravou = true;
      }
      const ligou = await this.vincularNaTransacao(tx, orgId, c.id, { tipo: 'lead', id: lead.id }, quem.id, 'telefone');
      return gravou || ligou;
    });
    return { conversa: await this.projetada(orgId, conversaId), mudou };
  }

  /**
   * Editar o telefone do lead (`Lead.phone`) ou do cliente (`Partner.phone`).
   * Grava os dígitos com DDI (`lerWhatsappBr`, a regra da Equipe); nulo ou vazio
   * tira. Depois casa de novo as conversas 1:1 do número novo e do antigo.
   */
  async definirTelefone(orgId: string, tipo: TipoDeVinculo, id: string, corpo: unknown, quem: QuemVincula): Promise<{ telefone: string | null; mudou: boolean; conversasCasadas: number }> {
    const e = ler(DefinirTelefoneSchema, corpo);
    await this.exigirGente(orgId, quem);
    let novo: string | null = null;
    if (e.telefone != null && e.telefone.trim()) {
      const lido = lerWhatsappBr(e.telefone);
      if (!lido.ok) throw new BadRequestException(lido.motivo);
      novo = lido.digitos;
    }
    const antes =
      tipo === 'lead'
        ? await this.prisma.lead.findFirst({ where: { id, orgId }, select: { phone: true } })
        : await this.prisma.partner.findFirst({ where: { id, orgId, isCliente: true }, select: { phone: true } });
    if (!antes) throw new NotFoundException(tipo === 'lead' ? 'Lead não encontrado nesta empresa.' : 'Cliente não encontrado nesta empresa.');
    if ((antes.phone ?? null) === novo) return { telefone: novo, mudou: false, conversasCasadas: 0 };
    await this.prisma.$transaction(async (tx) => {
      const r =
        tipo === 'lead'
          ? await tx.lead.updateMany({ where: { id, orgId, phone: antes.phone }, data: { phone: novo } })
          : await tx.partner.updateMany({ where: { id, orgId, isCliente: true, phone: antes.phone }, data: { phone: novo } });
      if (r.count !== 1) throw new ConflictException('O telefone mudou enquanto você editava. Recarregue e tente de novo.');
      await this.auditar(
        tx, orgId, quem.id,
        tipo === 'lead' ? ACAO_DE_AUDITORIA.telefoneDoLead : ACAO_DE_AUDITORIA.telefoneDoCliente,
        tipo === 'lead' ? 'lead' : 'partner', id,
        { tinha: !!antes.phone?.trim() }, { definido: !!novo }, { origem: 'whatsapp.vinculos' },
      );
    });
    // As conversas 1:1 do número novo e do antigo: o casamento decide de novo (o manual fica).
    const numeros = [...new Set([novo, antes.phone ? digitosDoTelefone(antes.phone) : null].filter((x): x is string => !!x && x.length >= 12))];
    let conversasCasadas = 0;
    if (numeros.length) {
      const conversas = await this.prisma.whatsAppConversa.findMany({
        where: { orgId, grupo: false, chatJid: { in: numeros.flatMap((n) => [`${n}@s.whatsapp.net`, `${n}@c.us`]) } },
        select: { id: true },
      });
      for (const c of conversas) {
        await this.casarConversa(orgId, c.id);
        conversasCasadas++;
      }
    }
    return { telefone: novo, mudou: true, conversasCasadas };
  }

  // =========================================================================
  // LEITURAS
  // =========================================================================

  /** A busca de vínculo: leads e clientes da empresa, o igual ao nome da conversa primeiro, depois o mais parecido. */
  async candidatos(orgId: string, opcoes: { conversaId?: string | null; q?: string | null; tipo?: string | null }): Promise<CandidatoDeVinculo[]> {
    let nomeDaConversa: string | null = null;
    if (opcoes.conversaId) {
      const c = await this.prisma.whatsAppConversa.findFirst({ where: { id: opcoes.conversaId, orgId }, select: { nome: true, grupo: true } });
      if (!c) throw new NotFoundException('Conversa não encontrada nesta empresa.');
      nomeDaConversa = c.grupo ? (nomeDoGrupoSemPrefixo(c.nome) ?? c.nome) : c.nome;
    }
    const tipo = opcoes.tipo === 'lead' || opcoes.tipo === 'cliente' ? opcoes.tipo : null;
    const alvos: AlvoDaBusca[] = [];
    if (tipo !== 'lead') {
      const clientes = await this.prisma.partner.findMany({
        where: { orgId, isCliente: true, ativo: true, interno: false },
        select: { id: true, razaoSocial: true, nomeFantasia: true },
        take: 5000,
      });
      for (const p of clientes) {
        const nome = nomeDoCliente(p);
        alvos.push({ tipo: 'cliente', id: p.id, nome, nomes: [p.nomeFantasia, p.razaoSocial], detalhe: nome !== p.razaoSocial ? p.razaoSocial : 'cliente' });
      }
    }
    if (tipo !== 'cliente') {
      const leads = await this.prisma.lead.findMany({
        where: { orgId },
        select: { id: true, name: true, ficha: { select: { empresa: true, etapa: true } } },
        take: 5000,
      });
      for (const l of leads) {
        const empresa = l.ficha?.empresa?.trim() || null;
        const etapa = l.ficha?.etapa ? COMERCIAL_ROTULO_DA_ETAPA[l.ficha.etapa as ComercialEtapa] ?? null : null;
        alvos.push({ tipo: 'lead', id: l.id, nome: l.name, nomes: [l.name, empresa], detalhe: [empresa !== l.name ? empresa : null, etapa].filter(Boolean).join(' · ') || null });
      }
    }
    const q = (opcoes.q ?? '').trim().slice(0, 120) || null;
    return ordenarCandidatos(alvos, { nomeDaConversa, busca: q });
  }

  /** As conversas de um lead ou cliente e as últimas 5 mensagens da mais recente. */
  private async doVinculo(orgId: string, onde: Prisma.WhatsAppConversaWhereInput): Promise<Pick<WhatsappDaFicha, 'conversas' | 'ultimas'>> {
    const linhas = await this.prisma.whatsAppConversa.findMany({
      where: { orgId, ...onde },
      orderBy: [{ ultimaMensagemEm: { sort: 'desc', nulls: 'last' } }, { criadoEm: 'desc' }],
      select: SELECT_DA_CONVERSA,
      take: 20,
    });
    const conversas = await projetarConversas(this.prisma, orgId, linhas);
    const maisRecente = linhas[0];
    if (!maisRecente) return { conversas, ultimas: [] };
    const msgs = await this.prisma.whatsAppMensagem.findMany({
      where: { orgId, conversaId: maisRecente.id },
      orderBy: { timestamp: 'desc' },
      select: SELECT_DA_MENSAGEM,
      take: 5,
    });
    const ultimas = await projetarMensagens(this.prisma, orgId, maisRecente.id, msgs.reverse());
    return { conversas, ultimas };
  }

  async doLead(orgId: string, leadId: string, podeEditar: boolean): Promise<WhatsappDaFicha> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { id: true, phone: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado nesta empresa.');
    return { ...(await this.doVinculo(orgId, { leadId })), telefone: lead.phone ?? null, podeEditar };
  }

  /**
   * A ficha (o cartão do Trabalho) de um cliente, para o link "Cliente: <nome>":
   * a ficha do Trabalho é por cartão, não por cliente. Primeiro o card da
   * implantação que o comercial ligou ao cliente; senão o cartão mais recente do
   * CRM (`crm-root-lista`) com este cliente. Nenhum = null (a tela diz).
   */
  async fichaDoCliente(orgId: string, clienteId: string): Promise<{ taskId: string | null }> {
    const p = await this.prisma.partner.findFirst({ where: { id: clienteId, orgId }, select: { id: true } });
    if (!p) throw new NotFoundException('Cliente não encontrado nesta empresa.');
    const fichas = await this.prisma.comercialFicha.findMany({ where: { orgId, partnerId: clienteId, cardId: { not: null } }, select: { cardId: true }, orderBy: { etapaDesde: 'desc' }, take: 5 });
    for (const f of fichas) {
      const t = await this.prisma.workTask.findFirst({ where: { id: f.cardId!, orgId, excluidaEm: null }, select: { id: true } });
      if (t) return { taskId: t.id };
    }
    const doCrm = await this.prisma.workTask.findFirst({
      where: { orgId, clienteId, excluidaEm: null, list: { externalId: 'crm-root-lista' } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    return { taskId: doCrm?.id ?? null };
  }

  async doCliente(orgId: string, clienteId: string, podeEditar: boolean): Promise<WhatsappDaFicha> {
    const p = await this.prisma.partner.findFirst({ where: { id: clienteId, orgId }, select: { id: true, phone: true } });
    if (!p) throw new NotFoundException('Cliente não encontrado nesta empresa.');
    return { ...(await this.doVinculo(orgId, { clienteId })), telefone: p.phone ?? null, podeEditar };
  }
}
