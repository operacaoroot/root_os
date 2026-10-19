import { ESTRUTURA_SUGERIDA, LISTA_DA_IMPLANTACAO, MODELOS_DE_LISTA, PASTA_DA_IMPLANTACAO, chaveDoNomeDoTrabalho } from '@mktos/shared';
import { ActorType, Prisma } from '@prisma/client';

import { criarEstruturaSugerida } from '../work/estrutura-sugerida';
import { uuidDe } from './eventos';

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
 */

export { LISTA_DA_IMPLANTACAO, PASTA_DA_IMPLANTACAO };
export const AUTOR_DO_FECHAMENTO = 'Fechamento comercial';

type Db = Prisma.TransactionClient;

const chaveDoNome = chaveDoNomeDoTrabalho;

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

export interface DadosDoCard {
  leadId: string;
  /** Razão social do aceite aprovado (o nome do card). */
  empresa: string;
  cnpj: string;
  /** Quem assina pelo cliente. */
  contato: string;
  telefone: string | null;
  email: string | null;
  produto: string;
  valor: string;
  parcelas: number;
  forma: string;
  chave: string;
  trilhoId: string | null;
  /** O nome de quem cuida da conta (o dono do lead), ou nulo. */
  responsavel: string | null;
}

/** A descrição do card: os dados copiados e os retrolinks, em markdown simples. */
export function descricaoDoCard(d: DadosDoCard, em: Date): string {
  const contato = [d.contato, d.telefone, d.email].filter(Boolean).join(' · ');
  const linhas = [
    `Cliente: ${d.empresa}${d.cnpj ? ` (${d.cnpj})` : ''}`,
    `Contato: ${contato || '[a decidir]'}`,
    `Produto: ${d.produto} · ${d.valor} em ${d.parcelas}x por ${d.forma}`,
    '',
    `Lead no comercial: /comercial/lead/${d.leadId}`,
  ];
  if (d.trilhoId) linhas.push(`Trilho de onboarding: /onboarding/${d.trilhoId}`);
  linhas.push('', `Procedência: ${procedenciaDoCard(em)} (chave ${d.chave}). Nada foi redigitado: os dados vêm do aceite aprovado.`);
  return linhas.join('\n').slice(0, 4000);
}

export interface CardAberto {
  estado: 'criado' | 'reaproveitado';
  cardId: string;
  listId: string;
  lista: string;
  etapa: string;
  detalhe: string;
}

/**
 * Abre (ou acha) o card do lead. Roda DENTRO de uma transação interativa: a
 * estrutura sugerida toma o cadeado da árvore do Trabalho da empresa.
 */
export async function abrirCardDaImplantacao(db: Db, orgId: string, d: DadosDoCard, agora: Date = new Date()): Promise<CardAberto> {
  const cardId = cardIdDoLead(orgId, d.leadId);
  const ja = await db.workTask.findFirst({
    where: { id: cardId, orgId },
    select: { id: true, listId: true, list: { select: { name: true } }, status: { select: { name: true } } },
  });
  if (ja) {
    await ligarRetrolinks(db, orgId, d.leadId, cardId, d.trilhoId);
    return { estado: 'reaproveitado', cardId, listId: ja.listId, lista: ja.list.name, etapa: ja.status.name, detalhe: `card já aberto em ${ja.list.name} · ${ja.status.name}` };
  }

  const estrutura = await criarEstruturaSugerida(db, orgId, ESTRUTURA_SUGERIDA);
  const pasta = (await db.workFolder.findMany({ where: { orgId, parentId: null }, select: { id: true, name: true } }))
    .find((p) => chaveDoNome(p.name) === chaveDoNome(PASTA_DA_IMPLANTACAO));
  if (!pasta) throw new Error(`a pasta ${PASTA_DA_IMPLANTACAO} não existe e a estrutura sugerida não a criou`);
  const lista = (await db.workList.findMany({ where: { orgId, folderId: pasta.id }, select: { id: true, name: true } }))
    .find((l) => chaveDoNome(l.name) === chaveDoNome(LISTA_DA_IMPLANTACAO));
  if (!lista) throw new Error(`a lista ${LISTA_DA_IMPLANTACAO} não existe em ${PASTA_DA_IMPLANTACAO}`);
  const primeira = await db.workStatus.findFirst({ where: { orgId, listId: lista.id }, orderBy: { order: 'asc' }, select: { id: true, name: true } });
  if (!primeira) throw new Error(`a lista ${LISTA_DA_IMPLANTACAO} não tem etapa`);

  const descricao = descricaoDoCard(d, agora);
  await db.workTask.create({
    data: {
      id: cardId,
      orgId,
      listId: lista.id,
      statusId: primeira.id,
      title: d.empresa.slice(0, 200),
      description: descricao,
      assignee: d.responsavel,
    },
  });
  await db.workComment.create({
    data: { orgId, taskId: cardId, authorId: null, authorName: AUTOR_DO_FECHAMENTO, text: `Card ${procedenciaDoCard(agora)} (${d.chave}). Próximo passo: marcar o kickoff com ${d.contato || 'o cliente'}.` },
  });
  // A mesma linha que `WorkService.criarTarefa` grava: a caixa e o rodapé do cartão a leem.
  await db.auditLog.create({
    data: {
      orgId,
      actorType: ActorType.system,
      actorId: 'comercial',
      action: 'work.task.create',
      entityType: 'work_task',
      entityId: cardId,
      after: { title: d.empresa, status: primeira.name, list: lista.name, procedencia: 'fechamento', leadId: d.leadId, chave: d.chave } as Prisma.InputJsonValue,
    },
  });
  await ligarRetrolinks(db, orgId, d.leadId, cardId, d.trilhoId);
  const criouEstrutura = estrutura.criadas.pastas.length + estrutura.criadas.listas.length > 0;
  return {
    estado: 'criado',
    cardId,
    listId: lista.id,
    lista: lista.name,
    etapa: primeira.name,
    detalhe: `${lista.name} · ${primeira.name}${criouEstrutura ? ' (a estrutura sugerida do Trabalho foi criada junto)' : ''}`,
  };
}

/** Card ↔ lead (ficha) e card ↔ trilho. Só preenche o que está vazio: ponteiro escolhido por gente fica. */
async function ligarRetrolinks(db: Db, orgId: string, leadId: string, cardId: string, trilhoId: string | null): Promise<void> {
  await db.comercialFicha.updateMany({ where: { leadId, orgId, cardId: null }, data: { cardId } });
  if (trilhoId) await db.onboardingTrilho.updateMany({ where: { id: trilhoId, orgId, cardId: null }, data: { cardId } });
}

/** O modelo é a fonte das etapas: exportado para o teste conferir a primeira. */
export const ETAPAS_DA_IMPLANTACAO = MODELOS_DE_LISTA['onboarding-de-cliente'].etapas.map((e) => e.name);
