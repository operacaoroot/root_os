import { Injectable, NotFoundException } from '@nestjs/common';
import {
  LISTA_DA_IMPLANTACAO,
  PASTA_DA_IMPLANTACAO,
  chaveDoNomeDoTrabalho,
  faseDoCartao,
  fasesDaEtapa,
  type EstadoDaAgendaDoCartao,
  type ImplantacaoDoCartao,
  type ImplantacaoDoQuadro,
  type ProximaReuniaoDoCartao,
  type ResumoDaImplantacao,
} from '@mktos/shared';
import { WorkStatusType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { tarefaViva } from '../work/arquivadas';
import { AgendaDaImplantacaoService } from './agenda-da-implantacao.service';
import { casarReunioes, type CartaoParaCasar } from './proxima-reuniao';

/*
 * O QUADRO DA IMPLANTAÇÃO SABE MAIS (rodada de produção 2, M1, S1, S2 e S5).
 *
 *   · `daLista`  — `GET /trabalho/implantacao/cartoes?listId=`: por card, a
 *     próxima reunião (S1) e a etapa contra a fase do trilho ligado (S2). Uma
 *     leitura por lista aberta, separada do movimento do quadro de propósito:
 *     a agenda pode demorar ou falhar, e o quadro não espera nem cai por ela.
 *   · `resumo`   — `GET /trabalho/implantacao/resumo`: o cartão "Implantação"
 *     do Dia a dia (S5) com os ids dos cards em cada pendência, para o clique
 *     levar à Implantação já filtrada.
 *
 * SÓ LEITURA. "Sem próximo passo" e "passo vencido" são a MESMA regra do
 * relógio do onboarding (`onboarding/trilho/relogio.ts`): trilho aberto sem
 * próximo passo; próximo passo com data que já passou. O relógio não roda aqui.
 *
 * A AGENDA SÓ PARA QUEM PODE LÊ-LA: a rota da agenda (`GET /google/calendar/
 * periodo`) pede `dashboard.ver`; sem ela, a reunião não vem e a tela diz por quê.
 *
 * Tudo com a empresa no `where`: o id da lista vem da tela.
 */

/** O teto de cartões lidos por lista (o mesmo do movimento do quadro). */
export const TETO_DE_CARTOES_DA_IMPLANTACAO = 500;
/** Quem pode ler a agenda pela rota de hoje. */
export const PERMISSAO_DA_AGENDA = 'dashboard.ver';

export interface QuemOlha {
  sub: string;
  permissions: readonly string[];
}

interface CardLido {
  id: string;
  title: string;
  clienteId: string | null;
  statusName: string;
  statusType: WorkStatusType;
}

@Injectable()
export class ImplantacaoDoQuadroService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agenda: AgendaDaImplantacaoService,
  ) {}

  /** Agora (trocável no teste). */
  agora: () => Date = () => new Date();

  async daLista(orgId: string, listId: string, quem: QuemOlha): Promise<ImplantacaoDoQuadro> {
    const lista = await this.prisma.workList.findFirst({ where: { id: listId, orgId }, select: { id: true } });
    if (!lista) throw new NotFoundException('Lista não encontrada');
    const cards = await this.cardsDaLista(orgId, listId);
    const { trilhoDe, paraCasar } = await this.dadosDosCards(orgId, cards);
    // Só os cards de cliente (com trilho ou ficha) pedem a agenda; lista sem nenhum não a lê.
    const { estado, reunioes } = paraCasar.length ? await this.reunioes(orgId, quem, paraCasar) : { estado: 'ok' as const, reunioes: new Map() };
    const deCliente = new Set(paraCasar.map((x) => x.cardId));
    const itens: ImplantacaoDoCartao[] = cards
      .filter((c) => trilhoDe.has(c.id) || deCliente.has(c.id))
      .map((c) => ({
        tarefaId: c.id,
        reuniao: reunioes.get(c.id) ?? null,
        fase: trilhoDe.has(c.id) ? faseDoCartao({ etapa: c.statusName, faseDoTrilho: trilhoDe.get(c.id)!.fase }) : null,
      }));
    return { agenda: estado, itens };
  }

  async resumo(orgId: string, quem: QuemOlha): Promise<ResumoDaImplantacao> {
    const vazio = (agenda: EstadoDaAgendaDoCartao, cartoes: number | null): ResumoDaImplantacao => ({
      cartoes, agenda, pendencias: { 'sem-proximo-passo': [], 'passo-vencido': [], 'sem-reuniao': [] },
    });
    const listId = await this.listaDaImplantacao(orgId);
    if (!listId) return vazio('ok', null);
    // Os abertos: fora a etapa de saída (fechada, ou a que o mapa diz não ter fase).
    const cards = (await this.cardsDaLista(orgId, listId)).filter((c) => c.statusType !== WorkStatusType.closed && fasesDaEtapa(c.statusName) !== null);
    if (!cards.length) return vazio('ok', 0);
    const { trilhoDe, paraCasar } = await this.dadosDosCards(orgId, cards);
    const agora = this.agora();
    const r = vazio('ok', cards.length);
    for (const c of cards) {
      const t = trilhoDe.get(c.id);
      if (!t || t.fase === 'encerrado') continue;
      if (!t.proximoPasso?.trim()) r.pendencias['sem-proximo-passo'].push(c.id);
      else if (t.proximoPassoEm && t.proximoPassoEm.getTime() < agora.getTime()) r.pendencias['passo-vencido'].push(c.id);
    }
    const { estado, reunioes } = await this.reunioes(orgId, quem, paraCasar);
    r.agenda = estado;
    if (estado === 'ok') r.pendencias['sem-reuniao'] = cards.filter((c) => !reunioes.has(c.id)).map((c) => c.id);
    return r;
  }

  /** A lista da implantação: pasta Clientes no topo, lista "Onboarding de cliente" (a regra do card). */
  private async listaDaImplantacao(orgId: string): Promise<string | null> {
    const pasta = (await this.prisma.workFolder.findMany({ where: { orgId, parentId: null, arquivadaEm: null }, select: { id: true, name: true } }))
      .find((p) => chaveDoNomeDoTrabalho(p.name) === chaveDoNomeDoTrabalho(PASTA_DA_IMPLANTACAO));
    if (!pasta) return null;
    const lista = (await this.prisma.workList.findMany({ where: { orgId, folderId: pasta.id, arquivadaEm: null }, select: { id: true, name: true } }))
      .find((l) => chaveDoNomeDoTrabalho(l.name) === chaveDoNomeDoTrabalho(LISTA_DA_IMPLANTACAO));
    return lista?.id ?? null;
  }

  private async cardsDaLista(orgId: string, listId: string): Promise<CardLido[]> {
    const tarefas = await this.prisma.workTask.findMany({
      where: { orgId, listId, archived: false, parentId: null, AND: [tarefaViva()] },
      orderBy: [{ updatedAt: 'desc' }],
      take: TETO_DE_CARTOES_DA_IMPLANTACAO,
      select: { id: true, title: true, clienteId: true, status: { select: { name: true, type: true } } },
    });
    return tarefas.map((t) => ({ id: t.id, title: t.title, clienteId: t.clienteId, statusName: t.status.name, statusType: t.status.type }));
  }

  /** O trilho ligado a cada card e o que a regra de casar precisa (e-mails do contato, nomes do cliente). */
  private async dadosDosCards(orgId: string, cards: readonly CardLido[]) {
    const ids = cards.map((c) => c.id);
    const clientes = [...new Set(cards.map((c) => c.clienteId).filter((x): x is string => !!x))];
    const [trilhos, fichas, parceiros] = await Promise.all([
      this.prisma.onboardingTrilho.findMany({
        where: { orgId, cardId: { in: ids } },
        orderBy: { criadoEm: 'desc' },
        select: { cardId: true, fase: true, cliente: true, contatoEmail: true, proximoPasso: true, proximoPassoEm: true },
      }),
      this.prisma.comercialFicha.findMany({
        where: { orgId, cardId: { in: ids } },
        select: { cardId: true, empresa: true, lead: { select: { email: true } } },
      }),
      clientes.length
        ? this.prisma.partner.findMany({ where: { orgId, id: { in: clientes } }, select: { id: true, razaoSocial: true, nomeFantasia: true, email: true } })
        : Promise.resolve([]),
    ]);
    // Um card, um trilho: com dois, vale o mais novo (o `orderBy` acima).
    const trilhoDe = new Map<string, (typeof trilhos)[number]>();
    for (const t of trilhos) if (t.cardId && !trilhoDe.has(t.cardId)) trilhoDe.set(t.cardId, t);
    const fichaDe = new Map(fichas.filter((f) => f.cardId).map((f) => [f.cardId as string, f]));
    const parceiroDe = new Map(parceiros.map((p) => [p.id, p]));
    const paraCasar: CartaoParaCasar[] = [];
    for (const c of cards) {
      const t = trilhoDe.get(c.id);
      const f = fichaDe.get(c.id);
      if (!t && !f) continue;
      const p = c.clienteId ? parceiroDe.get(c.clienteId) : undefined;
      paraCasar.push({
        cardId: c.id,
        emails: [t?.contatoEmail, f?.lead?.email, p?.email],
        nomes: [t?.cliente, f?.empresa, p?.nomeFantasia, p?.razaoSocial, c.title],
      });
    }
    return { trilhoDe, paraCasar };
  }

  /** A agenda (uma leitura por empresa, guardada 5 min) casada com os cards. */
  private async reunioes(orgId: string, quem: QuemOlha, cards: readonly CartaoParaCasar[]): Promise<{ estado: EstadoDaAgendaDoCartao; reunioes: Map<string, ProximaReuniaoDoCartao> }> {
    if (!quem.permissions.includes(PERMISSAO_DA_AGENDA)) return { estado: 'sem-permissao', reunioes: new Map() };
    const leitura = await this.agenda.ler(orgId, quem.sub);
    if (!leitura.ok) return { estado: 'indisponivel', reunioes: new Map() };
    return { estado: 'ok', reunioes: casarReunioes(leitura.eventos, cards, this.agora()) };
  }
}
