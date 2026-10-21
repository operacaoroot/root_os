import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import { classificar, type Efeito } from '@mktos/policy';
import {
  COMERCIAL_ETAPAS,
  ETAPA_PADRAO_DO_ONBOARDING_ANTECIPADO,
  LISTA_DA_IMPLANTACAO,
  MODELOS_DE_LISTA,
  OnboardingAntecipadoSchema,
  PASTA_DA_IMPLANTACAO,
  TABELA_DE_PRECO,
  chaveDoNomeDoTrabalho,
  conferirEtapaDeEntrada,
  etapasDeEntrada,
  formatarReais,
  motivoParaNaoIniciarOnboarding,
  rotuloCurtoDaEtapa,
  type ComercialEtapa,
  type EtapaDaListaDeOnboarding,
  type EtapasDoOnboardingAntecipado,
  type LeadElegivelAoOnboarding,
  type OnboardingAntecipadoResposta,
} from '@mktos/shared';
import { ActorType, Prisma } from '@prisma/client';

import { temPapelDeMaquina } from '../approvals/alcada';
import { lerAprovador } from '../auth/aprovador';
import type { PreparoEventoNoTx } from '../gateway/event-log.service';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { TrilhoService } from '../onboarding/trilho/trilho.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AUTOR_DO_FUNIL,
  EtapaDeEntradaRecusada,
  abrirCardDaImplantacao,
  avisoDeSaidaDoFunil,
  cardIdDoLead,
  procedenciaDoCardAntecipado,
  travarImplantacaoDoLead,
} from './card-da-implantacao';
import { acharOuCriarClienteDoLead } from './cliente-do-lead';
import { eventoIdComercial, uuidDe } from './eventos';
import { FichaService } from './ficha.service';
import { FioService, ReacoesRegistry, type EventoGravado } from './fio.service';

/*
 * INICIAR O ONBOARDING ANTES DO NEGÓCIO FECHADO (ajustes da versão final A2, 19/10/2026).
 *
 * A terceira porta da implantação, SEMPRE a partir de um lead do funil: o botão
 * "Iniciar onboarding" no painel do lead e na Implantação (que abre a busca de
 * leads elegíveis). Cartão solto na lista "Onboarding de cliente" continua
 * recusado pela porta única do Trabalho (`PORTA_DA_IMPLANTACAO`).
 *
 * O QUE CRIA, idempotente e sob o cadeado do lead:
 *   · o trilho de onboarding pelo MESMO `TrilhoService.criar` do fechamento, com os
 *     dados copiados da ficha (ou o que a ficha já aponta);
 *   · numa transação: o cliente (`Partner`, achado antes de criado: `cliente-do-lead.ts`),
 *     o card pela MESMA `abrirCardDaImplantacao` do fechamento, com o MESMO id derivado
 *     do lead (iniciar duas vezes = um card só; o fechamento depois acha este card),
 *     na etapa escolhida (padrão "Kickoff marcado"), os retrolinks lead ↔ card ↔ trilho,
 *     o fato `implantacao.iniciada_antes_do_fechamento` no fio e a linha na auditoria
 *     com a pessoa como ator.
 *
 * O SELO não tem coluna: `seloDoCard` lê o fato e a ficha. Lead que fecha depois tira
 * o selo sozinho; lead que sai do funil ganha o aviso "lead saiu do funil: <motivo>"
 * no selo e num comentário (reação a `saida.registrada`). Nada é apagado nem arquivado.
 *
 * QUEM. Só gente, como o mover do funil (`mover.service.ts`): conta de máquina é
 * recusada no token (o `SoGenteGuard` da rota) e de novo aqui, relida no banco.
 * O agente não tem caminho. Permissões da rota: `leads.editar` + `tarefas.editar`.
 *
 * O NÍVEL sai do EFEITO pela escada, como o encerrar contrato da T8: tudo fica dentro
 * do OS (card, trilho, cadastro de cliente, um fato e a auditoria), sem mensagem ao
 * cliente, sem cobrança, sem documento. Dá R0. Se o efeito um dia mudar e a conta
 * subir, a rota recusa até a capacidade entrar pelo catálogo.
 */
export const EFEITO_DE_INICIAR_ONBOARDING: Efeito = {
  escreveForaDoOS: false,
  produzArtefato: false,
  reversibilidade: 'automatica',
  exposicaoExterna: false,
  impactoFinanceiro: 'nenhum',
  sensibilidade: 'interna',
  destruicao: false,
  obrigacaoLegal: false,
};

const RECUSA_DE_MAQUINA = 'Iniciar onboarding é de gente: conta de serviço (IA) não abre card na implantação. O agente segue os portões.';

/** Quem inicia: a pessoa do token. */
export interface QuemInicia {
  id: string;
  nome: string | null;
  papeis: readonly string[];
}

const ETAPAS_DO_MODELO: EtapaDaListaDeOnboarding[] = MODELOS_DE_LISTA['onboarding-de-cliente'].etapas.map((e) => ({ name: e.name, type: e.type }));
/** As etapas ativas do funil antes de "Negócio fechado": onde o botão vale. */
const ETAPAS_ELEGIVEIS: ComercialEtapa[] = COMERCIAL_ETAPAS.filter((e) => e !== 'fechado');

@Injectable()
export class OnboardingAntecipadoService implements OnModuleInit {
  private readonly log = new Logger('ComercialOnboardingAntecipado');

  constructor(
    private readonly prisma: PrismaService,
    private readonly fio: FioService,
    private readonly reacoes: ReacoesRegistry,
    private readonly fichas: FichaService,
    @Optional() private readonly trilhos?: TrilhoService,
  ) {}

  onModuleInit(): void {
    this.reacoes.inscrever('saida.registrada', 'implantacao.aviso-de-saida', (ev) => this.avisarSaida(ev));
  }

  /**
   * Gente de verdade, relida no banco: ativa, desta empresa e sem papel de máquina (a forma do
   * mover), e com as duas permissões da rota AGORA (revisão A2, achado 5: `exigirAcessoAtual`, o
   * mesmo das rotas do Trabalho). Quem perdeu a permissão não abre card até o token vencer.
   */
  private async exigirGente(orgId: string, quem: QuemInicia): Promise<{ id: string; nome: string | null }> {
    if (temPapelDeMaquina(quem.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    const doBanco = await lerAprovador(this.prisma, quem.id, orgId);
    if (!doBanco || !doBanco.ativo) throw new ForbiddenException('Quem inicia o onboarding precisa ser um usuário ativo desta empresa.');
    if (temPapelDeMaquina(doBanco.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA);
    await exigirAcessoAtual(this.prisma, orgId, quem.id, ['leads.editar', 'tarefas.editar']);
    const u = await this.prisma.user.findFirst({ where: { id: quem.id, orgId }, select: { name: true } });
    return { id: quem.id, nome: u?.name ?? quem.nome };
  }

  /** As etapas da lista de onboarding desta empresa (ou as do modelo, se a lista ainda não existe). */
  private async etapasDaLista(db: Prisma.TransactionClient | PrismaService, orgId: string): Promise<EtapaDaListaDeOnboarding[]> {
    const pasta = (await db.workFolder.findMany({ where: { orgId, parentId: null, arquivadaEm: null }, select: { id: true, name: true } }))
      .find((p) => chaveDoNomeDoTrabalho(p.name) === chaveDoNomeDoTrabalho(PASTA_DA_IMPLANTACAO));
    const lista = pasta
      ? (await db.workList.findMany({ where: { orgId, folderId: pasta.id, arquivadaEm: null }, select: { id: true, name: true } }))
        .find((l) => chaveDoNomeDoTrabalho(l.name) === chaveDoNomeDoTrabalho(LISTA_DA_IMPLANTACAO))
      : undefined;
    if (!lista) return ETAPAS_DO_MODELO;
    const etapas = await db.workStatus.findMany({ where: { orgId, listId: lista.id }, orderBy: { order: 'asc' }, select: { name: true, type: true } });
    return etapas.length ? etapas.map((e) => ({ name: e.name, type: e.type })) : ETAPAS_DO_MODELO;
  }

  /** As etapas de entrada que a tela oferece. */
  async etapas(orgId: string): Promise<EtapasDoOnboardingAntecipado> {
    const lista = etapasDeEntrada(await this.etapasDaLista(this.prisma, orgId));
    const padrao = lista.find((e) => chaveDoNomeDoTrabalho(e) === chaveDoNomeDoTrabalho(ETAPA_PADRAO_DO_ONBOARDING_ANTECIPADO)) ?? lista[0] ?? ETAPA_PADRAO_DO_ONBOARDING_ANTECIPADO;
    return { etapas: lista, padrao };
  }

  /** A busca da Implantação: só leads em andamento no funil, sem card e sem cliente ativo. */
  async elegiveis(orgId: string, q?: string, limite = 30): Promise<LeadElegivelAoOnboarding[]> {
    const busca = (q ?? '').trim().slice(0, 80);
    const fichas = await this.prisma.comercialFicha.findMany({
      where: {
        orgId,
        etapa: { in: ETAPAS_ELEGIVEIS },
        cardId: null,
        clienteAtivoEm: null,
        ...(busca
          ? { OR: [{ empresa: { contains: busca, mode: 'insensitive' } }, { lead: { name: { contains: busca, mode: 'insensitive' } } }] }
          : {}),
      },
      orderBy: { etapaDesde: 'desc' },
      take: Math.min(Math.max(limite, 1), 100),
      select: { leadId: true, empresa: true, etapa: true, lead: { select: { name: true, orgId: true } } },
    });
    const ids = fichas.map((f) => f.leadId);
    const ativos = ids.length
      ? new Set((await this.prisma.leadEvent.findMany({ where: { orgId, leadId: { in: ids }, type: 'cliente.ativo' }, select: { leadId: true } })).map((e) => e.leadId))
      : new Set<string>();
    return fichas
      .filter((f) => f.lead.orgId === orgId && !ativos.has(f.leadId))
      .map((f) => ({ leadId: f.leadId, nome: f.lead.name, empresa: f.empresa, etapa: f.etapa as ComercialEtapa, rotuloDaEtapa: rotuloCurtoDaEtapa(f.etapa as ComercialEtapa) }));
  }

  /**
   * INICIAR. Recusa (403) quem não é gente ou perdeu a permissão; (404) lead de outra empresa;
   * (409) lead fechado, em saída ou com o fechamento a caminho; (400) etapa de entrada que não
   * serve. Repetir com o lead em andamento devolve o mesmo card sem escrever nada de novo.
   *
   * UMA TRANSAÇÃO SÓ (revisão A2, achados 3 e 4): o cadeado do lead (`travarImplantacaoDoLead`, o
   * mesmo das escritas cliente, trilho e card do fechamento) e TODO o trabalho, o trilho inclusive
   * (`TrilhoService.criarNaTransacao`), correm na mesma conexão. Nada pede uma segunda conexão do
   * pool enquanto o cadeado está preso; o que o RASTRO precisa ler vem preparado antes.
   */
  async iniciar(orgId: string, leadId: string, corpo: unknown, quem: QuemInicia, agora: Date = new Date()): Promise<OnboardingAntecipadoResposta> {
    const r = OnboardingAntecipadoSchema.safeParse(corpo ?? {});
    if (!r.success) throw new BadRequestException({ message: 'Pedido inválido.', erros: r.error.issues.map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`) });
    const pessoa = await this.exigirGente(orgId, quem);
    const nivel = classificar(EFEITO_DE_INICIAR_ONBOARDING);
    if (nivel !== 'R0' && nivel !== 'R1') throw new ForbiddenException(`Iniciar onboarding ficou ${nivel} pela escada: precisa de capacidade no catálogo antes de valer.`);
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId }, select: { id: true } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    await this.fichas.garantir(orgId, leadId);
    if (!this.trilhos) throw new ServiceUnavailableException('O serviço do trilho de onboarding não está disponível agora: nada foi criado.');
    const preparo = await this.trilhos.prepararCriacaoNaTransacao(orgId);

    let gravado: { novo: boolean; evento: EventoGravado } | null = null;
    let resposta: OnboardingAntecipadoResposta;
    try {
      resposta = await this.prisma.$transaction(
        async (tx) => {
          await travarImplantacaoDoLead(tx, orgId, leadId);
          const feito = await this.iniciarNaVez(tx, orgId, leadId, r.data.etapa, pessoa, nivel, agora, preparo);
          gravado = feito.gravado;
          return feito.resposta;
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
    } catch (e) {
      if (e instanceof EtapaDeEntradaRecusada) throw new BadRequestException(e.message);
      throw e;
    }
    const g = gravado as { novo: boolean; evento: EventoGravado } | null;
    if (g?.novo) await this.fio.reagir(g.evento);
    if (resposta.estado === 'criado') this.log.log(`onboarding do lead ${leadId} iniciado antes do fechamento (${nivel}): card ${resposta.cardId} em ${resposta.etapa}, cliente ${resposta.cliente}`);
    return resposta;
  }

  private async iniciarNaVez(
    tx: Prisma.TransactionClient,
    orgId: string,
    leadId: string,
    etapaPedida: string | undefined,
    pessoa: { id: string; nome: string | null },
    nivel: string,
    agora: Date,
    preparo: PreparoEventoNoTx,
  ): Promise<{ resposta: OnboardingAntecipadoResposta; gravado: { novo: boolean; evento: EventoGravado } | null }> {
    const lead = await tx.lead.findFirstOrThrow({ where: { id: leadId, orgId }, select: { name: true, phone: true, email: true } });
    const ficha = await tx.comercialFicha.findFirstOrThrow({ where: { leadId, orgId } });
    const cardId = cardIdDoLead(orgId, leadId);
    const etapaDoLead = ficha.etapa as ComercialEtapa;
    const clienteAtivo = !!(await tx.leadEvent.findFirst({ where: { leadId, orgId, type: 'cliente.ativo' }, select: { id: true } }));

    // Revisão A2, achado 9: lead fechado ou em saída é recusado com o motivo, tenha card ou não.
    const motivo = motivoParaNaoIniciarOnboarding({ etapa: etapaDoLead, clienteAtivo });
    if (motivo) throw new ConflictException(motivo);

    // Já iniciado: o mesmo card, nada de novo.
    const card = await tx.workTask.findFirst({ where: { id: cardId, orgId }, select: { id: true, listId: true, clienteId: true, status: { select: { name: true } } } });
    if (card) {
      const fato = await tx.leadEvent.findUnique({ where: { id: eventoIdComercial(orgId, leadId, 'implantacao.iniciada_antes_do_fechamento', cardId) }, select: { leadId: true } });
      if (!fato || fato.leadId !== leadId) throw new ConflictException('Este lead já tem o card da implantação, aberto pelo fechamento.');
      return {
        gravado: null,
        resposta: {
          leadId, estado: 'reaproveitado', cardId, listId: card.listId, etapa: card.status.name,
          trilhoId: ficha.trilhoId, partnerId: card.clienteId ?? ficha.partnerId, cliente: 'ficha',
          selo: procedenciaDoCardAntecipado(etapaDoLead),
        },
      };
    }

    // Revisão A2, achado 3: com o fechamento a caminho (aprovação na fila ou rodando), o card nasce
    // nele. Iniciar agora correria com ele.
    const fechando = await tx.comercialFechamento.findFirst({ where: { leadId, orgId, estado: { in: ['pendente', 'em_curso'] } }, select: { estado: true } });
    if (fechando) throw new ConflictException('O fechamento deste lead já está a caminho: o card da implantação nasce nele. Acompanhe pelo fechamento.');

    // A etapa é conferida ANTES de qualquer escrita.
    const etapa = conferirEtapaDeEntrada(await this.etapasDaLista(tx, orgId), etapaPedida);
    if (!etapa.ok) throw new BadRequestException(etapa.motivo);

    const cadastro = (ficha.cadastro ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const empresa = ficha.empresa ?? str(cadastro.razaoSocial) ?? lead.name;
    const cnpj = ficha.cnpj ?? str(cadastro.cnpj);
    const contato = str(cadastro.quemAssina) ?? (empresa !== lead.name ? lead.name : '');
    const email = str(cadastro.email) ?? lead.email ?? null;
    const produto = ficha.produto ? TABELA_DE_PRECO[ficha.produto as keyof typeof TABELA_DE_PRECO]?.rotulo ?? ficha.produto : '';

    // O trilho: o que a ficha já aponta, ou um novo pela mesma criação do fechamento, na transação.
    let trilhoId: string | null = null;
    if (ficha.trilhoId) trilhoId = (await tx.onboardingTrilho.findFirst({ where: { id: ficha.trilhoId, orgId }, select: { id: true } }))?.id ?? null;
    if (!trilhoId) {
      const t = await this.trilhos!.criarNaTransacao(
        tx,
        orgId,
        {
          cliente: empresa,
          contatoNome: contato || null,
          contatoWhatsapp: lead.phone ?? null,
          contatoEmail: email,
          perfil: ficha.perfil ?? null,
          reuniaoEm: ficha.reuniaoEm?.toISOString() ?? null,
          observacoes: `Onboarding iniciado antes do fechamento, com o lead em ${rotuloCurtoDaEtapa(etapaDoLead)}${pessoa.nome ? `, por ${pessoa.nome}` : ''}. Os dados vêm da ficha do lead; o que ainda não existe fica [a decidir].`,
        },
        { id: pessoa.id, nome: pessoa.nome ?? 'Comercial' },
        preparo,
      );
      trilhoId = t.id;
      // Escrita condicionada: sob o cadeado a ficha está vazia; se não estiver, nada fica órfão (a transação volta).
      const ligou = await tx.comercialFicha.updateMany({ where: { leadId, orgId, OR: [{ trilhoId: null }, { trilhoId: ficha.trilhoId ?? '' }] }, data: { trilhoId } });
      if (ligou.count !== 1) throw new ConflictException('A ficha do lead ganhou outro trilho no meio do caminho: nada foi criado. Tente de novo.');
    }

    const dono = ficha.donoId ? await tx.user.findFirst({ where: { id: ficha.donoId, orgId }, select: { name: true } }) : null;
    const cliente = await acharOuCriarClienteDoLead(tx, orgId, { partnerIdDaFicha: ficha.partnerId, nome: empresa, cnpj, telefone: lead.phone, email });
    // A ficha aponta o cliente; o ponteiro que já vale (cliente desta empresa) não é trocado.
    if (cliente.como !== 'ficha') await tx.comercialFicha.updateMany({ where: { leadId, orgId }, data: { partnerId: cliente.id } });
    const c = await abrirCardDaImplantacao(
      tx,
      orgId,
      {
        leadId,
        empresa,
        cnpj: cnpj ?? '',
        contato,
        telefone: lead.phone ?? null,
        email,
        produto,
        valor: ficha.valorCentavos ? formatarReais(ficha.valorCentavos) : '',
        parcelas: ficha.parcelas ?? 0,
        forma: ficha.forma ?? '',
        chave: 'antes-do-fechamento',
        trilhoId,
        responsavel: dono?.name ?? null,
        clienteId: cliente.id,
      },
      agora,
      { origem: 'antecipado', etapa: etapa.etapa, etapaDoLead, ator: pessoa },
    );
    const gravado = await this.fio.gravarNaTransacao(tx, orgId, leadId, 'implantacao.iniciada_antes_do_fechamento', c.cardId, {
      cardId: c.cardId, listId: c.listId, lista: c.lista, etapa: c.etapa, etapaDoLead, trilhoId, partnerId: cliente.id, por: pessoa.nome, porId: pessoa.id,
    }, agora);
    await tx.auditLog.create({
      data: {
        orgId,
        actorType: ActorType.user,
        actorId: pessoa.id,
        action: 'comercial.implantacao.iniciada_antes_do_fechamento',
        entityType: 'lead',
        entityId: leadId,
        after: { cardId: c.cardId, listId: c.listId, etapa: c.etapa, etapaDoLead, trilhoId, partnerId: cliente.id, cliente: cliente.como, nivel } as Prisma.InputJsonValue,
      },
    });
    return {
      gravado,
      resposta: {
        leadId, estado: c.estado, cardId: c.cardId, listId: c.listId, etapa: c.etapa,
        trilhoId, partnerId: cliente.id, cliente: cliente.como, selo: procedenciaDoCardAntecipado(etapaDoLead),
      },
    };
  }

  /**
   * Reação a `saida.registrada`: o card antecipado do lead NÃO some. Ganha o
   * aviso num comentário (uma vez por saída) e o selo passa a dizer que o lead
   * saiu do funil (`seloDoCard`). Arquivar ou seguir é decisão de gente.
   */
  async avisarSaida(ev: EventoGravado<'saida.registrada'>): Promise<unknown> {
    const ficha = await this.prisma.comercialFicha.findFirst({ where: { leadId: ev.leadId, orgId: ev.orgId }, select: { cardId: true } });
    const cardId = cardIdDoLead(ev.orgId, ev.leadId);
    if (ficha?.cardId !== cardId) return { pulado: 'o lead não tem card da implantação' };
    const fato = await this.prisma.leadEvent.findUnique({ where: { id: eventoIdComercial(ev.orgId, ev.leadId, 'implantacao.iniciada_antes_do_fechamento', cardId) }, select: { leadId: true } });
    if (!fato || fato.leadId !== ev.leadId) return { pulado: 'o card não foi iniciado antes do fechamento' };
    const card = await this.prisma.workTask.findFirst({ where: { id: cardId, orgId: ev.orgId }, select: { id: true } });
    if (!card) return { pulado: 'o card não existe nesta empresa' };
    const p = ev.payload;
    const aviso = avisoDeSaidaDoFunil(p.saida as ComercialEtapa, p.motivo ?? null);
    const detalhe = p.detalhe ? ` (${String(p.detalhe).slice(0, 200)})` : '';
    const r = await this.prisma.workComment.createMany({
      data: [{
        id: uuidDe([ev.orgId, 'comercial-card-aviso-de-saida', cardId, ev.eventoId]),
        orgId: ev.orgId,
        taskId: cardId,
        authorId: null,
        authorName: AUTOR_DO_FUNIL,
        text: `Aviso: ${aviso}${detalhe}. O card fica aqui até alguém decidir arquivar ou seguir. Nada foi apagado.`,
      }],
      skipDuplicates: true,
    });
    return { aviso, novo: r.count === 1 };
  }
}
