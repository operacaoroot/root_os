import {
  ESTRUTURA_SUGERIDA, LISTA_DA_IMPLANTACAO, MODELOS_DE_LISTA, PASTA_DA_IMPLANTACAO, chaveDoNomeDoTrabalho, conferirEtapaDeEntrada,
  rotuloCurtoDaEtapa, ehSaida, type ComercialEtapa,
} from '@mktos/shared';
import { ActorType, Prisma } from '@prisma/client';

import { criarEstruturaSugerida } from '../work/estrutura-sugerida';
import { eventoIdComercial, uuidDe } from './eventos';

/*
 * O CARD DA IMPLANTAÇÃO (rodada da implantação I1, 18/10/2026) — a sexta
 * escrita do fechamento.
 *
 * O pedido do Rodrigo: "a task tem que ser aberta lá assim que o contrato for
 * fechado na sessão estratégica do comercial". Ninguém redigita: nome, empresa,
 * contatos, produto e valor saem do aceite que a titular aprovou e da ficha.
 *
 * ONDE. Na lista "Onboarding de cliente" da pasta "Clientes", que é a da
 * estrutura sugerida do Trabalho (rodada do painel P2). Empresa sem a estrutura
 * ganha a estrutura pela MESMA função da rota `POST /trabalho/estrutura/sugerida`,
 * dentro da mesma transação e sob o mesmo cadeado: só cria o que falta, pelo nome.
 * O card nasce na PRIMEIRA etapa da lista ("Fechado no comercial" no modelo).
 *
 * IDEMPOTENTE PELO ID. O id do card é derivado do lead (`uuidDe`), então o
 * fechamento que roda de novo acha o mesmo card e não abre outro, mesmo que a
 * ficha tenha perdido o ponteiro. Card arquivado conta como existente: quem
 * arquivou decidiu, e o fechamento não ressuscita trabalho.
 *
 * PROCEDÊNCIA GRAVADA. O card leva na descrição de onde veio e um primeiro
 * comentário assinado "Fechamento comercial" com a data; a ficha guarda o
 * `cardId` e o trilho (`OnboardingTrilho.cardId`, que já existia) aponta para
 * ele. A auditoria `work.task.create` é a mesma linha que o quadro grava quando
 * uma pessoa cria a tarefa, então a caixa de entrada e o rodapé do cartão leem
 * a criação sem uma segunda fonte.
 *
 * SEM NEST, como a estrutura sugerida: o seed da homologação usa a mesma função.
 *
 * A TERCEIRA PORTA (ajustes da versão final A2, 19/10/2026): "Iniciar onboarding"
 * a partir do lead, antes do fechamento, abre o MESMO card pela MESMA função, com
 * o mesmo id derivado do lead (`origem: 'antecipado'`). Muda: a etapa de entrada
 * é a escolhida (nunca a primeira, que é do fechamento), a procedência diz
 * "iniciado antes do fechamento" e quem abriu é a pessoa. Quando o lead fecha, a
 * sexta escrita acha o card pelo id e, sendo antecipado, registra o fechamento num
 * comentário assinado "Fechamento comercial" (uma vez por chave), sem mover a
 * etapa. O selo sai sozinho: ele é lido do fio (`seloDoCard`), sem coluna nova.
 */

export { LISTA_DA_IMPLANTACAO, PASTA_DA_IMPLANTACAO };
export const AUTOR_DO_FECHAMENTO = 'Fechamento comercial';
/** Quem assina o aviso de saída do funil no card antecipado. */
export const AUTOR_DO_FUNIL = 'Funil comercial';
export const A_DECIDIR_NO_CARD = '[a decidir]';

type Db = Prisma.TransactionClient;

const chaveDoNome = chaveDoNomeDoTrabalho;

/**
 * O CADEADO DA IMPLANTAÇÃO DO LEAD (revisão adversarial A2): "Iniciar onboarding" e as escritas
 * cliente, trilho e card do fechamento tomam o MESMO cadeado, sempre DENTRO da transação que faz o
 * trabalho (sem segurar uma conexão enquanto pede outra). Quem chega depois relê a ficha e acha o
 * que o primeiro gravou: um cliente, um trilho e um card por lead.
 */
export async function travarImplantacaoDoLead(db: Db, orgId: string, leadId: string): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`implantacao-do-lead:${orgId}:${leadId}`}))`;
}

export function cardIdDoLead(orgId: string, leadId: string): string {
  return uuidDe([orgId, 'comercial-card-implantacao', leadId]);
}

export function dataCurta(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

/** A procedência que a tela mostra no selo e que a descrição e o comentário gravam. */
export function procedenciaDoCard(em: Date): string {
  return `criado pelo fechamento · ${dataCurta(em)}`;
}

/** Rodada de produção 1: o selo do card que veio do CRM antigo pelo importador. */
export function procedenciaDoCardImportado(em: Date): string {
  return `importado do CRM antigo · ${dataCurta(em)}`;
}

/** A2: o selo do card iniciado antes do fechamento, com a etapa em que o lead está agora. */
export function procedenciaDoCardAntecipado(etapaDoLead: ComercialEtapa): string {
  return `Iniciado antes do fechamento · lead em ${rotuloCurtoDaEtapa(etapaDoLead)}`;
}

/** Os motivos de saída do funil, na língua da tela (`COMERCIAL_MOTIVOS_DE_SAIDA`). */
const ROTULO_DO_MOTIVO: Record<string, string> = {
  sem_base: 'sem base',
  preco: 'preço',
  sumiu: 'sumiu',
  momento: 'momento',
  nao_e_cliente_root: 'não é cliente Root',
  outro: 'outro',
};

/** A2: o aviso do card antecipado cujo lead saiu do funil ("lead saiu do funil: Perdido, preço"). */
export function avisoDeSaidaDoFunil(saida: ComercialEtapa, motivo: string | null): string {
  const m = motivo ? ROTULO_DO_MOTIVO[motivo] ?? motivo : null;
  return `lead saiu do funil: ${rotuloCurtoDaEtapa(saida)}${m ? `, ${m}` : ''}`;
}

/**
 * O selo do card que veio do comercial, lido do fio e da ficha (sem coluna nova):
 *   · card do fechamento: "criado pelo fechamento · data";
 *   · card antecipado com o lead no funil: "Iniciado antes do fechamento · lead em <etapa>";
 *   · card antecipado com o lead numa saída: o aviso "lead saiu do funil: <motivo>";
 *   · card antecipado de lead que fechou depois: o selo de antes sai, e fica "fechado no comercial · data";
 *   · card antecipado com o lead levado a "Negócio fechado" à mão, sem fechamento: continua antecipado,
 *     e o selo diz que não há fechamento registrado.
 */
export function seloDoCard(s: {
  leadId: string;
  criadoEm: Date;
  etapa: ComercialEtapa;
  motivoSaida: string | null;
  antecipado: boolean;
  /** Quando o fechamento foi registrado no card antecipado (ou o cliente ficou ativo), ou nulo. */
  fechadoEm: Date | null;
  /** Rodada de produção 1: o card nasceu do importador do CRM antigo (fato `implantacao.card_criado` com origem `importacao`). */
  importado?: boolean;
}): { tipo: 'fechamento' | 'antecipado' | 'saiu_do_funil'; leadId: string; rotulo: string } {
  if (s.importado && !s.antecipado) return { tipo: 'fechamento', leadId: s.leadId, rotulo: procedenciaDoCardImportado(s.criadoEm) };
  if (!s.antecipado) return { tipo: 'fechamento', leadId: s.leadId, rotulo: procedenciaDoCard(s.criadoEm) };
  // Só o fechamento de verdade (o fato no card ou o cliente ativo) tira o selo. A etapa
  // "Negócio fechado" sozinha é o mover à mão, que não fecha nada.
  if (s.fechadoEm) return { tipo: 'fechamento', leadId: s.leadId, rotulo: `fechado no comercial · ${dataCurta(s.fechadoEm)}` };
  if (s.etapa === 'fechado') return { tipo: 'antecipado', leadId: s.leadId, rotulo: `${procedenciaDoCardAntecipado(s.etapa)}, sem fechamento registrado` };
  if (ehSaida(s.etapa)) return { tipo: 'saiu_do_funil', leadId: s.leadId, rotulo: avisoDeSaidaDoFunil(s.etapa, s.motivoSaida) };
  return { tipo: 'antecipado', leadId: s.leadId, rotulo: procedenciaDoCardAntecipado(s.etapa) };
}

export interface DadosDoCard {
  leadId: string;
  /** Razão social do aceite aprovado (o nome do card). */
  empresa: string;
  cnpj: string;
  /** Quem assina pelo cliente. */
  contato: string;
  telefone: string | null;
  email: string | null;
  /** Produto, valor, parcelas e forma: vazio (ou zero) = ainda não decidido, e o card diz `[a decidir]` (A2). */
  produto: string;
  valor: string;
  parcelas: number;
  forma: string;
  /** A chave do fechamento (`fech-<lead>-v<n>`); no card antecipado, `antes-do-fechamento`. */
  chave: string;
  trilhoId: string | null;
  /** O nome de quem cuida da conta (o dono do lead), ou nulo. */
  responsavel: string | null;
  /**
   * O cliente da tarefa (rodada do trabalho T4): o `Partner` que a escrita `cliente`
   * do fechamento gravou (`ComercialFicha.partnerId`). Nulo só em lead sem cliente.
   */
  clienteId?: string | null;
}

/**
 * De onde o card veio (A2): o fechamento (padrão), "Iniciar onboarding" antes dele, ou (rodada de
 * produção 1) o importador do CRM antigo, que traz o cliente que já estava em kickoff ou implantação.
 */
export interface EntradaDoCard {
  origem?: 'fechamento' | 'antecipado' | 'importacao';
  /** O nome da etapa de entrada (no antecipado e na importação; o fechamento entra na primeira). */
  etapa?: string;
  /** A etapa do funil em que o lead estava ao iniciar (só no antecipado). */
  etapaDoLead?: ComercialEtapa;
  /** A pessoa que iniciou (no antecipado) ou importou (na importação); no fechamento quem abre é o sistema. */
  ator?: { id: string; nome: string | null };
}

/** A etapa de entrada pedida não serve (a primeira, a de encerramento ou uma que não existe). */
export class EtapaDeEntradaRecusada extends Error {}

/** A descrição do card: os dados copiados e os retrolinks, em markdown simples. */
export function descricaoDoCard(d: DadosDoCard, em: Date, entrada: EntradaDoCard = {}): string {
  const contato = [d.contato, d.telefone, d.email].filter(Boolean).join(' · ');
  const produto = `${d.produto || A_DECIDIR_NO_CARD} · ${d.valor || A_DECIDIR_NO_CARD}${d.parcelas ? ` em ${d.parcelas}x` : ''}${d.forma ? ` por ${d.forma}` : ''}`;
  const linhas = [
    `Cliente: ${d.empresa}${d.cnpj ? ` (${d.cnpj})` : ''}`,
    `Contato: ${contato || A_DECIDIR_NO_CARD}`,
    `Produto: ${produto}`,
    '',
    `Lead no comercial: /comercial/lead/${d.leadId}`,
  ];
  if (d.trilhoId) linhas.push(`Trilho de onboarding: /onboarding/${d.trilhoId}`);
  if (entrada.origem === 'antecipado') {
    const etapa = entrada.etapaDoLead ? ` · lead em ${rotuloCurtoDaEtapa(entrada.etapaDoLead)}` : '';
    const por = entrada.ator?.nome ? `, por ${entrada.ator.nome}` : '';
    linhas.push('', `Procedência: iniciado antes do fechamento${etapa} · ${dataCurta(em)}${por}. Nada foi redigitado: os dados vêm da ficha do lead, e o que ainda não existe fica ${A_DECIDIR_NO_CARD}.`);
  } else if (entrada.origem === 'importacao') {
    const por = entrada.ator?.nome ? `, por ${entrada.ator.nome}` : '';
    linhas.push('', `Procedência: ${procedenciaDoCardImportado(em)}${por}. O cliente já estava nesta etapa no CRM antigo; os dados vêm do cartão de lá, e o que não existia fica ${A_DECIDIR_NO_CARD}.`);
  } else {
    linhas.push('', `Procedência: ${procedenciaDoCard(em)} (chave ${d.chave}). Nada foi redigitado: os dados vêm do aceite aprovado.`);
  }
  return linhas.join('\n').slice(0, 4000);
}

export interface CardAberto {
  estado: 'criado' | 'reaproveitado';
  cardId: string;
  listId: string;
  lista: string;
  etapa: string;
  detalhe: string;
  /** A2: o card reaproveitado pelo fechamento tinha sido iniciado antes dele. */
  antecipado?: boolean;
  /** A2: o comentário do fechamento foi gravado agora (falso quando já estava lá). */
  fechamentoRegistradoAgora?: boolean;
}

/** O comentário "Fechamento comercial" no card antecipado: um por card e por chave do fechamento. */
export function comentarioDoFechamentoId(orgId: string, cardId: string, chave: string): string {
  return uuidDe([orgId, 'comercial-card-fechamento-registrado', cardId, chave]);
}

/**
 * Abre (ou acha) o card do lead. Roda DENTRO de uma transação interativa: a
 * estrutura sugerida toma o cadeado da árvore do Trabalho da empresa.
 *
 * `entrada.origem = 'antecipado'` (A2) abre o card na etapa escolhida, com a
 * pessoa como autora. No fechamento (o padrão), achar um card que foi iniciado
 * antes dele grava o comentário "Fechamento comercial" uma vez por chave e não
 * mexe na etapa.
 */
export async function abrirCardDaImplantacao(db: Db, orgId: string, d: DadosDoCard, agora: Date = new Date(), entrada: EntradaDoCard = {}): Promise<CardAberto> {
  const origem = entrada.origem ?? 'fechamento';
  const cardId = cardIdDoLead(orgId, d.leadId);
  const ja = await db.workTask.findFirst({
    where: { id: cardId, orgId },
    select: { id: true, listId: true, list: { select: { name: true } }, status: { select: { name: true } } },
  });
  if (ja) {
    await ligarRetrolinks(db, orgId, d.leadId, cardId, d.trilhoId);
    // Cliente obrigatório no card (T4): o card que ficou sem cliente ganha o do lead; o que já tem, fica.
    if (d.clienteId) await db.workTask.updateMany({ where: { id: cardId, orgId, clienteId: null }, data: { clienteId: d.clienteId } });
    let antecipado = false;
    let fechamentoRegistradoAgora = false;
    if (origem === 'fechamento') {
      const ev = await db.leadEvent.findUnique({
        where: { id: eventoIdComercial(orgId, d.leadId, 'implantacao.iniciada_antes_do_fechamento', cardId) },
        select: { leadId: true },
      });
      antecipado = !!ev && ev.leadId === d.leadId;
      if (antecipado) {
        const r = await db.workComment.createMany({
          data: [{
            id: comentarioDoFechamentoId(orgId, cardId, d.chave),
            orgId,
            taskId: cardId,
            authorId: null,
            authorName: AUTOR_DO_FECHAMENTO,
            text: `Fechamento comercial em ${dataCurta(agora)} (${d.chave}). O card foi iniciado antes do fechamento e segue em ${ja.status.name}.`,
          }],
          skipDuplicates: true,
        });
        fechamentoRegistradoAgora = r.count === 1;
      }
    }
    return {
      estado: 'reaproveitado',
      cardId,
      listId: ja.listId,
      lista: ja.list.name,
      etapa: ja.status.name,
      detalhe: `card já aberto em ${ja.list.name} · ${ja.status.name}${antecipado ? ' (iniciado antes do fechamento: o fechamento ficou registrado no card)' : ''}`,
      antecipado,
      fechamentoRegistradoAgora,
    };
  }

  // Só a pasta da implantação (21/10/2026): abrir um card não cria nem move as listas de Gestão.
  const estrutura = await criarEstruturaSugerida(
    db, orgId, ESTRUTURA_SUGERIDA.filter((p) => chaveDoNome(p.nome) === chaveDoNome(PASTA_DA_IMPLANTACAO)),
  );
  const pasta = (await db.workFolder.findMany({ where: { orgId, parentId: null, arquivadaEm: null }, select: { id: true, name: true } }))
    .find((p) => chaveDoNome(p.name) === chaveDoNome(PASTA_DA_IMPLANTACAO));
  if (!pasta) throw new Error(`a pasta ${PASTA_DA_IMPLANTACAO} não existe e a estrutura sugerida não a criou`);
  const lista = (await db.workList.findMany({ where: { orgId, folderId: pasta.id, arquivadaEm: null }, select: { id: true, name: true } }))
    .find((l) => chaveDoNome(l.name) === chaveDoNome(LISTA_DA_IMPLANTACAO));
  if (!lista) throw new Error(`a lista ${LISTA_DA_IMPLANTACAO} não existe em ${PASTA_DA_IMPLANTACAO}`);
  const etapas = await db.workStatus.findMany({ where: { orgId, listId: lista.id }, orderBy: { order: 'asc' }, select: { id: true, name: true, type: true } });
  if (!etapas.length) throw new Error(`a lista ${LISTA_DA_IMPLANTACAO} não tem etapa`);
  let alvo = etapas[0];
  if (origem === 'antecipado' || origem === 'importacao') {
    // A2: nunca a primeira (é do fechamento), nunca a de encerramento, nunca uma que não existe.
    const c = conferirEtapaDeEntrada(etapas.map((e) => ({ name: e.name, type: e.type })), entrada.etapa);
    if (!c.ok) throw new EtapaDeEntradaRecusada(c.motivo);
    alvo = etapas.find((e) => e.name === c.etapa) ?? alvo;
  }

  const descricao = descricaoDoCard(d, agora, entrada);
  await db.workTask.create({
    data: {
      id: cardId,
      orgId,
      listId: lista.id,
      statusId: alvo.id,
      title: d.empresa.slice(0, 200),
      description: descricao,
      assignee: d.responsavel,
      clienteId: d.clienteId ?? null,
    },
  });
  const pessoa = origem === 'antecipado' || origem === 'importacao' ? entrada.ator ?? null : null;
  const texto = origem === 'antecipado'
    ? `Card iniciado antes do fechamento, com o lead em ${entrada.etapaDoLead ? rotuloCurtoDaEtapa(entrada.etapaDoLead) : 'andamento'}. Quando o lead fechar, o fechamento fica registrado aqui e o card continua o mesmo.`
    : origem === 'importacao'
      ? `Card ${procedenciaDoCardImportado(agora)}, em ${alvo.name}. O cliente já estava nesta etapa no CRM antigo; nenhuma mensagem foi enviada.`
      : `Card ${procedenciaDoCard(agora)} (${d.chave}). Próximo passo: marcar o kickoff com ${d.contato || 'o cliente'}.`;
  await db.workComment.create({
    data: { orgId, taskId: cardId, authorId: pessoa?.id ?? null, authorName: pessoa ? pessoa.nome || 'Comercial' : AUTOR_DO_FECHAMENTO, text: texto },
  });
  // A mesma linha que `WorkService.criarTarefa` grava: a caixa e o rodapé do cartão a leem.
  await db.auditLog.create({
    data: {
      orgId,
      actorType: pessoa ? ActorType.user : ActorType.system,
      actorId: pessoa?.id ?? 'comercial',
      action: 'work.task.create',
      entityType: 'work_task',
      entityId: cardId,
      after: { title: d.empresa, status: alvo.name, list: lista.name, procedencia: origem, leadId: d.leadId, chave: d.chave } as Prisma.InputJsonValue,
    },
  });
  await ligarRetrolinks(db, orgId, d.leadId, cardId, d.trilhoId);
  const criouEstrutura = estrutura.criadas.pastas.length + estrutura.criadas.listas.length > 0;
  return {
    estado: 'criado',
    cardId,
    listId: lista.id,
    lista: lista.name,
    etapa: alvo.name,
    detalhe: `${lista.name} · ${alvo.name}${criouEstrutura ? ' (a estrutura sugerida do Trabalho foi criada junto)' : ''}`,
  };
}

/** Card ↔ lead (ficha) e card ↔ trilho. Só preenche o que está vazio: ponteiro escolhido por gente fica. */
async function ligarRetrolinks(db: Db, orgId: string, leadId: string, cardId: string, trilhoId: string | null): Promise<void> {
  await db.comercialFicha.updateMany({ where: { leadId, orgId, cardId: null }, data: { cardId } });
  if (trilhoId) await db.onboardingTrilho.updateMany({ where: { id: trilhoId, orgId, cardId: null }, data: { cardId } });
}

/** O modelo é a fonte das etapas: exportado para o teste conferir a primeira. */
export const ETAPAS_DA_IMPLANTACAO = MODELOS_DE_LISTA['onboarding-de-cliente'].etapas.map((e) => e.name);
