import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  LEU_SEM_RESPONDER_N, LEU_SEM_RESPONDER_N_PROVISORIO, PROPOSTA_ROTULO_DA_SECAO, fraseDaSituacao, situacaoDaLeitura,
  type IdeiaDoCliente, type LinhaDeLeitura, type PropostaSecao, type RelatorioDeLeitura,
} from '@mktos/shared';
import { ActorType, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { uuidDe } from './eventos';
import { clienteInterno } from '../work/clientes-da-casa';
import { LISTA_DA_IMPLANTACAO, PASTA_DA_IMPLANTACAO, PORTA_DA_IMPLANTACAO } from '@mktos/shared';

/*
 * O RELATÓRIO DO COMERCIAL · LEITURA E REAÇÃO (rodada da implantação I5, 18/10/2026).
 *
 * "Quantas vezes a pessoa acessou o link e quais as ideias dela." Tudo é
 * CONTAGEM do que está gravado; nenhum número sai de modelo:
 *   · acessos à proposta = as visitas distintas (`visita` do `proposta.lida`)
 *     com leitura da versão vigente. O `proposta.lida` é gravado pela sala de
 *     antes e pela página da proposta da I4, que lê seção por seção;
 *   · visitas às salas = os `sala.visitada` do período (uma por dia e estágio);
 *   · ideias = as linhas `ideia` da `LeadReacao` (I4);
 *   · seção mais lida = a soma dos segundos da leitura por seção (I4).
 * "Respondeu" é qualquer fala do cliente depois da publicação (aceite, ajuste,
 * dúvida, ideia, mensagem). O FUP 1 preparado é o rascunho do M5 desta versão
 * na fila (o relógio o prepara quando a leitura passa do N; humano envia).
 *
 * VIRAR TAREFA cria a `WorkTask` com a procedência e o trecho, como o aceite de
 * uma sugestão de ata: aqui direto, porque quem clica é gente (a conta de
 * máquina é recusada). O id da tarefa é derivado da reação: dois cliques, uma
 * tarefa. O texto do cliente vai como DADO na descrição, nunca a um modelo.
 */

const DIA_MS = 86_400_000;
const SAIDAS = ['desqualificado', 'geladeira', 'perdido', 'parceiro'];
const FALAS_DO_CLIENTE = ['proposta.aceita', 'proposta.ajuste_pedido', 'proposta.duvida', 'proposta.ideia', 'whats.recebida'];
const PAPEIS_DE_MAQUINA = ['ia_servico', 'ia_acao'];
/** Teto de leads lidos por relatório (os de proposta publicada mais recente primeiro). */
const TETO_DE_LEADS = 200;

type P = Record<string, unknown>;

export function rotuloDaSecao(secao: string): string {
  return (PROPOSTA_ROTULO_DA_SECAO as Record<string, string>)[secao] ?? secao;
}

const trecho = (t: string, n: number) => {
  const limpo = t.replace(/\s+/g, ' ').trim();
  return limpo.length > n ? `${limpo.slice(0, n - 1).trimEnd()}…` : limpo;
};

@Injectable()
export class LeituraEReacaoService {
  constructor(private readonly prisma: PrismaService) {}

  async relatorio(orgId: string, diasPedido?: string | number, agora: Date = new Date()): Promise<RelatorioDeLeitura> {
    const dias = [7, 30, 90].includes(Number(diasPedido)) ? Number(diasPedido) : 30;
    const desde = new Date(agora.getTime() - dias * DIA_MS);

    // As propostas publicadas: a última de cada lead (até 90 dias, para "vivas" não esquecer a de 40 dias).
    const publicadas = await this.prisma.leadEvent.findMany({
      where: { orgId, type: 'proposta.publicada', occurredAt: { gte: new Date(agora.getTime() - Math.max(90, dias) * DIA_MS) } },
      orderBy: { occurredAt: 'desc' },
      select: { leadId: true, occurredAt: true, payload: true },
      take: 2000,
    });
    const ultimaDe = new Map<string, { em: Date; versao: number }>();
    for (const p of publicadas) {
      if (!ultimaDe.has(p.leadId)) ultimaDe.set(p.leadId, { em: p.occurredAt, versao: Number(((p.payload ?? {}) as P).versao) || 1 });
    }
    const ids = [...ultimaDe.keys()].slice(0, TETO_DE_LEADS);

    const [leads, fichas, depois, reacoes, mensagens, visitas, ideiasDoPeriodo] = await Promise.all([
      this.prisma.lead.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } }),
      this.prisma.comercialFicha.findMany({ where: { orgId, leadId: { in: ids } }, select: { leadId: true, etapa: true, empresa: true } }),
      this.prisma.leadEvent.findMany({
        where: { orgId, leadId: { in: ids }, type: { in: ['proposta.lida', 'followup.enviado', ...FALAS_DO_CLIENTE] } },
        select: { leadId: true, type: true, occurredAt: true, payload: true },
      }),
      this.prisma.leadReacao.findMany({ where: { orgId, leadId: { in: ids } }, select: { leadId: true, versao: true, secao: true, tipo: true, segundos: true, acesso: true, atualizadoEm: true } }),
      this.prisma.comercialMensagem.findMany({ where: { orgId, leadId: { in: ids }, template: 'M5' }, select: { id: true, leadId: true, estado: true } }),
      this.prisma.leadEvent.count({ where: { orgId, type: 'sala.visitada', occurredAt: { gte: desde } } }),
      this.prisma.leadReacao.findMany({
        where: { orgId, tipo: { in: ['ideia', 'duvida'] }, criadoEm: { gte: desde } },
        orderBy: { criadoEm: 'desc' },
        take: 60,
        select: { id: true, leadId: true, secao: true, tipo: true, texto: true, criadoEm: true, respondidaEm: true, tarefaId: true },
      }),
    ]);
    const nomeDe = new Map(leads.map((l) => [l.id, l.name]));
    const fichaDe = new Map(fichas.map((f) => [f.leadId, f]));

    const linhas: LinhaDeLeitura[] = [];
    let propostasVivas = 0;
    let acessosNoPeriodo = 0;
    for (const leadId of ids) {
      const pub = ultimaDe.get(leadId)!;
      const ficha = fichaDe.get(leadId);
      const evs = depois.filter((d) => d.leadId === leadId && d.occurredAt.getTime() >= pub.em.getTime());
      const leituras = evs.filter((d) => d.type === 'proposta.lida' && Number(((d.payload ?? {}) as P).versao) === pub.versao);
      const visitasLidas = new Map<number, Date>();
      for (const l of leituras) {
        const v = Number(((l.payload ?? {}) as P).visita);
        const chave = Number.isFinite(v) ? v : -1;
        const antes = visitasLidas.get(chave);
        if (!antes || l.occurredAt > antes) visitasLidas.set(chave, l.occurredAt);
      }
      const daReacao = reacoes.filter((r) => r.leadId === leadId && r.versao === pub.versao);
      for (const r of daReacao.filter((x) => x.tipo === 'leitura')) {
        if (!visitasLidas.has(r.acesso)) visitasLidas.set(r.acesso, r.atualizadoEm);
      }
      const acessos = visitasLidas.size;
      const ultimoAcesso = [...visitasLidas.values()].sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      for (const em of visitasLidas.values()) if (em >= desde) acessosNoPeriodo++;
      const porSecao = new Map<string, number>();
      for (const r of daReacao) if (r.tipo === 'leitura') porSecao.set(r.secao, (porSecao.get(r.secao) ?? 0) + (r.segundos ?? 0));
      const maisLida = [...porSecao.entries()].sort((a, b) => b[1] - a[1])[0];
      const respondeu = evs.some((d) => FALAS_DO_CLIENTE.includes(d.type));
      const m5 = mensagens.find((m) => m.leadId === leadId && m.id === uuidDe([orgId, 'comercial-mensagem', leadId, 'M5', `v${pub.versao}`]));
      const fupEnviado = evs.some((d) => d.type === 'followup.enviado' && ((d.payload ?? {}) as P).qual === 'M5' && Number(((d.payload ?? {}) as P).versao ?? pub.versao) === pub.versao);
      const situacao = situacaoDaLeitura({ acessos, respondeu, fupPreparado: !!m5 && m5.estado !== 'descartada', fupEnviado });
      const viva = !evs.some((d) => d.type === 'proposta.aceita') && !!ficha && !SAIDAS.includes(ficha.etapa) && ficha.etapa !== 'fechado';
      if (viva) propostasVivas++;
      if (!viva && pub.em < desde) continue;
      linhas.push({
        leadId,
        nome: ficha?.empresa || nomeDe.get(leadId) || 'lead',
        enviadaEm: pub.em.toISOString(),
        versao: pub.versao,
        acessos,
        ultimoAcessoEm: ultimoAcesso?.toISOString() ?? null,
        secaoMaisLida: maisLida && maisLida[1] > 0 ? { secao: maisLida[0], rotulo: rotuloDaSecao(maisLida[0]), segundos: maisLida[1] } : null,
        ideias: daReacao.filter((r) => r.tipo === 'ideia').length,
        situacao,
        frase: fraseDaSituacao(situacao),
      });
    }
    // O que pede ação primeiro: leu sem responder, depois não abriu, depois o resto, cada grupo do mais recente.
    const ordem = { leu_sem_responder: 0, nao_abriu: 1, lendo: 2, respondeu: 3 } as const;
    linhas.sort((a, b) => ordem[a.situacao.tipo] - ordem[b.situacao.tipo] || b.enviadaEm.localeCompare(a.enviadaEm));

    const nomesDasIdeias = new Map((await this.prisma.comercialFicha.findMany({ where: { orgId, leadId: { in: [...new Set(ideiasDoPeriodo.map((i) => i.leadId))] } }, select: { leadId: true, empresa: true } })).map((f) => [f.leadId, f.empresa]));
    const leadsDasIdeias = await this.prisma.lead.findMany({ where: { orgId, id: { in: [...new Set(ideiasDoPeriodo.map((i) => i.leadId))] } }, select: { id: true, name: true } });
    const nomeDoLeadDaIdeia = new Map(leadsDasIdeias.map((l) => [l.id, l.name]));
    const ideias: IdeiaDoCliente[] = ideiasDoPeriodo.map((i) => ({
      id: i.id,
      leadId: i.leadId,
      nome: nomesDasIdeias.get(i.leadId) || nomeDoLeadDaIdeia.get(i.leadId) || 'lead',
      secao: i.secao,
      rotuloDaSecao: rotuloDaSecao(i.secao),
      tipo: i.tipo as 'ideia' | 'duvida',
      texto: i.texto ?? '',
      em: i.criadoEm.toISOString(),
      respondidaEm: i.respondidaEm?.toISOString() ?? null,
      tarefaId: i.tarefaId,
    }));

    return {
      periodoDias: dias,
      geradoEm: agora.toISOString(),
      tiles: {
        propostasVivas,
        acessosAPropostas: acessosNoPeriodo,
        visitasAsSalas: visitas,
        ideiasRecebidas: ideiasDoPeriodo.filter((i) => i.tipo === 'ideia').length,
      },
      leitura: linhas,
      ideias,
      n: { valor: LEU_SEM_RESPONDER_N, provisorio: LEU_SEM_RESPONDER_N_PROVISORIO },
    };
  }

  /**
   * A ideia (ou dúvida) vira tarefa no Trabalho: na lista escolhida ou, sem
   * escolha, na "Esteira de clientes" da pasta Clientes. Dois cliques, uma
   * tarefa (id derivado da reação e a reação tomada por escrita condicionada).
   */
  async virarTarefa(orgId: string, reacaoId: string, quem: { id: string; papeis: readonly string[] }, listIdPedido?: string | null, agora: Date = new Date()): Promise<{ tarefaId: string; listId: string; criada: boolean }> {
    if (quem.papeis.some((p) => PAPEIS_DE_MAQUINA.includes(p))) throw new ForbiddenException('Conta de máquina não cria tarefa a partir da ideia do cliente: quem clica é gente.');
    const pessoa = await this.prisma.user.findFirst({ where: { id: quem.id, orgId, isActive: true }, select: { id: true, name: true, roles: { select: { key: true } } } });
    if (!pessoa || pessoa.roles.some((r) => PAPEIS_DE_MAQUINA.includes(r.key))) throw new ForbiddenException('Só gente da empresa transforma a ideia em tarefa.');
    const r = await this.prisma.leadReacao.findFirst({ where: { id: reacaoId, orgId } });
    if (!r) throw new NotFoundException('Reação não encontrada.');
    if (r.tipo !== 'ideia' && r.tipo !== 'duvida') throw new BadRequestException('Só ideia ou dúvida do cliente vira tarefa.');
    const tarefaId = uuidDe([orgId, 'comercial-ideia-tarefa', r.id]);
    if (r.tarefaId) {
      const ja = await this.prisma.workTask.findFirst({ where: { id: r.tarefaId, orgId }, select: { id: true, listId: true } });
      if (ja) return { tarefaId: ja.id, listId: ja.listId, criada: false };
    }
    const lista = await this.listaDestino(orgId, listIdPedido ?? null);
    const lead = await this.prisma.lead.findFirst({ where: { id: r.leadId, orgId }, select: { name: true } });
    const ficha = await this.prisma.comercialFicha.findFirst({ where: { leadId: r.leadId, orgId }, select: { empresa: true, partnerId: true } });
    const quando = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(r.criadoEm);
    const texto = (r.texto ?? '').trim();
    // T4: o nome é imperativo (verbo + objeto) e o cliente vai no campo Cliente, não no nome.
    const titulo = `${r.tipo === 'ideia' ? 'Responder a ideia' : 'Responder a dúvida'}: ${trecho(texto, 60)}`.slice(0, 200);
    // O cliente é o do fechamento; lead que ainda não fechou é trabalho comercial da casa (cliente interno).
    const clienteId = ficha?.partnerId ?? (await clienteInterno(this.prisma, orgId)).id;
    const descricao = [
      `Procedência: ${r.tipo === 'ideia' ? 'ideia' : 'dúvida'} deixada pelo cliente na proposta v${r.versao}, seção ${rotuloDaSecao(r.secao)}, em ${quando}.`,
      `Lead no comercial: /comercial/lead/${r.leadId}`,
      '',
      'Trecho do cliente (texto dele, como chegou):',
      `> ${texto.replace(/\n/g, '\n> ')}`,
    ].join('\n').slice(0, 4000);

    const criada = await this.prisma.$transaction(async (tx) => {
      // A reação é tomada antes de a tarefa nascer: o segundo clique acha a marca e não cria outra.
      const tomada = await tx.leadReacao.updateMany({ where: { id: r.id, orgId, tarefaId: null }, data: { tarefaId } });
      if (tomada.count === 0) return false;
      const existe = await tx.workTask.findFirst({ where: { id: tarefaId }, select: { id: true } });
      if (existe) return false;
      await tx.workTask.create({ data: { id: tarefaId, orgId, listId: lista.id, statusId: lista.statusId, title: titulo, description: descricao, clienteId } });
      await tx.auditLog.create({
        data: {
          orgId, actorType: ActorType.user, actorId: pessoa.id, action: 'work.task.create', entityType: 'work_task', entityId: tarefaId,
          after: { title: titulo, list: lista.nome, procedencia: `comercial.${r.tipo}`, leadId: r.leadId, reacaoId: r.id } as Prisma.InputJsonValue,
        },
      });
      return true;
    });
    const final = await this.prisma.leadReacao.findFirstOrThrow({ where: { id: r.id, orgId }, select: { tarefaId: true } });
    if (!final.tarefaId) throw new ConflictException('A ideia mudou durante o pedido: tente de novo.');
    const t = await this.prisma.workTask.findFirst({ where: { id: final.tarefaId, orgId }, select: { id: true, listId: true } });
    void agora;
    return { tarefaId: final.tarefaId, listId: t?.listId ?? lista.id, criada };
  }

  /** A lista pedida (da empresa) ou a Esteira de clientes da pasta Clientes, ou a primeira lista da empresa. */
  private async listaDestino(orgId: string, listId: string | null): Promise<{ id: string; nome: string; statusId: string }> {
    // A lista da implantação tem porta única (rodada do trabalho T1, revisão P2-4): a ideia não vira cartão lá.
    const naoEhImplantacao: Prisma.WorkListWhereInput = {
      NOT: { name: { equals: LISTA_DA_IMPLANTACAO, mode: 'insensitive' }, folder: { name: { equals: PASTA_DA_IMPLANTACAO, mode: 'insensitive' }, parentId: null } },
    };
    const comEtapa = async (where: Prisma.WorkListWhereInput) => {
      const l = await this.prisma.workList.findFirst({ where: { AND: [where, naoEhImplantacao], orgId }, orderBy: { order: 'asc' }, select: { id: true, name: true, statuses: { orderBy: { order: 'asc' }, take: 1, select: { id: true } } } });
      return l && l.statuses[0] ? { id: l.id, nome: l.name, statusId: l.statuses[0].id } : null;
    };
    if (listId) {
      const l = await comEtapa({ id: listId });
      if (!l) {
        const existe = await this.prisma.workList.findFirst({ where: { id: listId, orgId }, select: { id: true } });
        throw existe ? new BadRequestException(PORTA_DA_IMPLANTACAO) : new NotFoundException('Lista não encontrada (ou sem etapa).');
      }
      return l;
    }
    const esteira = await comEtapa({ name: { equals: 'Esteira de clientes', mode: 'insensitive' }, folder: { name: { equals: 'Clientes', mode: 'insensitive' } } });
    if (esteira) return esteira;
    const qualquer = await comEtapa({});
    if (!qualquer) throw new BadRequestException('A empresa ainda não tem lista no Trabalho: crie a estrutura sugerida antes.');
    return qualquer;
  }

  /** "Responder" marca a ideia como respondida (a resposta é dada pela pessoa no canal; aqui só fica o registro). */
  async marcarRespondida(orgId: string, reacaoId: string, agora: Date = new Date()): Promise<{ respondidaEm: string }> {
    const r = await this.prisma.leadReacao.findFirst({ where: { id: reacaoId, orgId }, select: { id: true, respondidaEm: true } });
    if (!r) throw new NotFoundException('Reação não encontrada.');
    if (!r.respondidaEm) await this.prisma.leadReacao.updateMany({ where: { id: r.id, orgId, respondidaEm: null }, data: { respondidaEm: agora } });
    const f = await this.prisma.leadReacao.findFirstOrThrow({ where: { id: r.id, orgId }, select: { respondidaEm: true } });
    return { respondidaEm: f.respondidaEm!.toISOString() };
  }
}

export type { PropostaSecao };
