import { BadRequestException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TRAB_CLIENTE_INTERNO, tituloNormalizado, type TrabClienteDto } from '@mktos/shared';

/*
 * O CLIENTE DA TAREFA (rodada do trabalho T4, 19/10/2026).
 *
 * Toda tarefa nova é ligada a um cliente. O cadastro é o que o fechamento do
 * comercial JÁ escreve: `Partner` com `isCliente` (reaproveitado pelo CNPJ) —
 * nenhuma sexta "verdade" sobre cliente. O trabalho da própria empresa vai para
 * o cliente da casa (`Partner.interno`, um por empresa, índice único parcial),
 * criado na primeira vez que alguém o escolhe.
 *
 * O NOME SE RESOLVE ESCOPADO POR EMPRESA, como o do agente (`agentes-da-casa.ts`):
 * `include: { cliente: true }` traria o `Partner` que estiver do outro lado do
 * ponteiro sem filtro de empresa. O gatilho `WorkTask_orgId_confere_cliente`
 * impede a escrita errada; esta leitura impede a leitura errada.
 */

type Db = PrismaClient | Prisma.TransactionClient;

const SUFIXO_INTERNO = ' (interno)';

/**
 * O nome do cliente da casa: "Root (interno)" na Root (o roteiro da rodada); nas
 * outras empresas, o nome dela sem o apelido entre parênteses do fim.
 */
export function nomeDoClienteInterno(org: { name: string; slug: string } | null): string {
  if (!org) return `A casa${SUFIXO_INTERNO}`;
  if (org.slug === 'root') return `Root${SUFIXO_INTERNO}`;
  const base = org.name.replace(/\s*\([^)]*\)\s*$/, '').trim() || org.name.trim();
  return `${base}${SUFIXO_INTERNO}`;
}

/** "…0190": os quatro últimos dígitos do CNPJ ou CPF, ou nulo. */
export function finalDoDocumento(doc: string | null): string | null {
  const d = (doc ?? '').replace(/[^0-9]/g, '');
  return d.length >= 4 ? `…${d.slice(-4)}` : null;
}

function nomeDoPartner(p: { razaoSocial: string; nomeFantasia: string | null }): string {
  return (p.nomeFantasia?.trim() || p.razaoSocial).trim();
}

/** id → nome, só dos clientes desta empresa. Ponteiro atravessado fica de fora (a tela diz "sem cliente"). */
export async function nomesDosClientes(db: Db, orgId: string, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  if (unicos.length === 0) return new Map();
  const rows = await db.partner.findMany({
    where: { orgId, id: { in: unicos } },
    select: { id: true, razaoSocial: true, nomeFantasia: true },
  });
  return new Map(rows.map((p) => [p.id, nomeDoPartner(p)]));
}

/** O cliente da casa, criado na primeira vez. O índice único parcial segura a corrida. */
export async function clienteInterno(db: Db, orgId: string): Promise<{ id: string; nome: string }> {
  const ja = await db.partner.findFirst({ where: { orgId, interno: true }, select: { id: true, razaoSocial: true, nomeFantasia: true } });
  if (ja) return { id: ja.id, nome: nomeDoPartner(ja) };
  const org = await db.org.findFirst({ where: { id: orgId }, select: { name: true, slug: true } });
  const razaoSocial = nomeDoClienteInterno(org);
  try {
    const p = await db.partner.create({ data: { orgId, isCliente: true, interno: true, razaoSocial } });
    return { id: p.id, nome: razaoSocial };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const outro = await db.partner.findFirst({ where: { orgId, interno: true }, select: { id: true, razaoSocial: true, nomeFantasia: true } });
      if (outro) return { id: outro.id, nome: nomeDoPartner(outro) };
    }
    throw e;
  }
}

/**
 * Resolve o `clienteId` que chegou na rota: `interno` vira o cliente da casa; um
 * id precisa ser cliente desta empresa. Recusa em português o que não serve.
 */
export async function resolverCliente(db: Db, orgId: string, clienteId: string): Promise<string> {
  if (clienteId === TRAB_CLIENTE_INTERNO) return (await clienteInterno(db, orgId)).id;
  const p = await db.partner.findFirst({ where: { id: clienteId, orgId }, select: { id: true, isCliente: true } });
  if (!p) throw new BadRequestException('Cliente não encontrado nesta empresa.');
  if (!p.isCliente) throw new BadRequestException('Este cadastro não é de cliente.');
  return p.id;
}

/**
 * O nome do cliente na régua da conciliação `20261019230000` (`mktos_nome_normalizado`):
 * minúsculas, sem acento, só letras e números separados por um espaço. Vazio = sem nome.
 */
export function nomeDeClienteNormalizado(nome: string | null | undefined): string {
  return tituloNormalizado(nome ?? '');
}

/**
 * O cliente desta empresa com esse nome (razão social ou nome fantasia, na régua
 * normalizada), ou nulo. Só `Partner` cliente e fora o da casa: fornecedor de nome
 * parecido NÃO vira cliente por aqui (revisão final, achado 1.2 — só o CNPJ promove).
 * Ativo antes de inativo; o mais antigo antes.
 */
export async function acharClientePorNome(db: Db, orgId: string, nome: string): Promise<{ id: string; nome: string } | null> {
  const alvo = nomeDeClienteNormalizado(nome);
  if (!alvo) return null;
  const rows = await db.partner.findMany({
    where: { orgId, isCliente: true, interno: false },
    select: { id: true, razaoSocial: true, nomeFantasia: true, ativo: true },
    orderBy: [{ createdAt: 'asc' }],
  });
  const casa = rows
    .filter((p) => nomeDeClienteNormalizado(p.razaoSocial) === alvo || nomeDeClienteNormalizado(p.nomeFantasia) === alvo)
    .sort((a, b) => Number(b.ativo) - Number(a.ativo))[0];
  return casa ? { id: casa.id, nome: nomeDoPartner(casa) } : null;
}

/**
 * O `Partner` cliente de um card de cadastro da forma antiga (a da produção antes da
 * conciliação), pelo nome: o campo "Empresa" do card ou, sem ele, o título — a mesma
 * escolha da migration `20261019230000`. Só ACHA (não cria): sem cliente com esse
 * nome, devolve nulo e a tarefa fica "sem cliente". Nunca devolve o id do card.
 */
export async function clienteDoCard(db: Db, orgId: string, cardId: string): Promise<string | null> {
  const card = await db.workTask.findFirst({ where: { id: cardId, orgId }, select: { title: true } });
  if (!card) return null;
  const campos = await db.workFieldValue.findMany({
    where: { orgId, taskId: cardId, value: { not: null } },
    select: { value: true, field: { select: { name: true } } },
  });
  const empresa = campos.find((v) => nomeDeClienteNormalizado(v.field.name) === 'empresa' && v.value?.trim())?.value ?? null;
  return (await acharClientePorNome(db, orgId, empresa?.trim() || card.title))?.id ?? null;
}

/**
 * "Novo cliente" digitado numa tela de tarefas: acha o `Partner` cliente pelo nome
 * ou cria um (`isCliente`), nunca um card de lista. Sob cadeado por empresa e nome,
 * dois cliques juntos dão um cliente só.
 */
export async function acharOuCriarClientePorNome(
  prisma: PrismaClient, orgId: string, nome: string,
): Promise<{ id: string; nome: string; jaExistia: boolean }> {
  const limpo = nome.trim().replace(/\s+/g, ' ');
  const alvo = nomeDeClienteNormalizado(limpo);
  if (!alvo) throw new BadRequestException('Escreva o nome do cliente com letras ou números.');
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente-por-nome:${orgId}:${alvo}`}))`;
    const ja = await acharClientePorNome(tx, orgId, limpo);
    if (ja) return { ...ja, jaExistia: true };
    const p = await tx.partner.create({ data: { orgId, isCliente: true, razaoSocial: limpo.slice(0, 160) } });
    return { id: p.id, nome: p.razaoSocial, jaExistia: false };
  });
}

/**
 * A lista do seletor: clientes ativos desta empresa, o da casa primeiro (mesmo
 * que ainda não exista: ele aparece como `interno` e nasce quando escolhido).
 */
export async function listarClientes(db: Db, orgId: string, q?: string, limite = 50): Promise<TrabClienteDto[]> {
  const busca = q?.trim();
  const rows = await db.partner.findMany({
    where: {
      orgId, isCliente: true, ativo: true, interno: false,
      // Layout 26/10: cadastro repetido (apontado para o principal na integração) não aparece no seletor.
      principalId: null,
      ...(busca ? { OR: [
        { razaoSocial: { contains: busca, mode: 'insensitive' } },
        { nomeFantasia: { contains: busca, mode: 'insensitive' } },
        { cnpjCpf: { contains: busca.replace(/\D/g, '') || busca } },
      ] } : {}),
    },
    select: { id: true, razaoSocial: true, nomeFantasia: true, cnpjCpf: true },
    orderBy: [{ razaoSocial: 'asc' }],
    take: Math.min(Math.max(limite, 1), 200),
  });
  const interno = await db.partner.findFirst({ where: { orgId, interno: true }, select: { id: true, razaoSocial: true, nomeFantasia: true } });
  const org = interno ? null : await db.org.findFirst({ where: { id: orgId }, select: { name: true, slug: true } });
  const nomeInterno = interno ? nomeDoPartner(interno) : nomeDoClienteInterno(org);
  const casa: TrabClienteDto = { id: interno?.id ?? TRAB_CLIENTE_INTERNO, nome: nomeInterno, cnpj: null, interno: true };
  const casaNaBusca = !busca || nomeInterno.toLocaleLowerCase('pt-BR').includes(busca.toLocaleLowerCase('pt-BR')) || 'interno'.includes(busca.toLocaleLowerCase('pt-BR'));
  return [
    ...(casaNaBusca ? [casa] : []),
    // Revisão P2-5: quem só lê tarefas não recebe o documento inteiro (o cadastro é do Financeiro);
    // o seletor mostra só o final, para distinguir homônimos. A busca pelo número segue aqui no servidor.
    ...rows.map((p) => ({ id: p.id, nome: nomeDoPartner(p), cnpj: finalDoDocumento(p.cnpjCpf), interno: false })),
  ];
}
