import { existsSync } from 'node:fs';
import path from 'node:path';

import { ApprovalState } from '@prisma/client';

import type { PrismaService } from '../../prisma/prisma.service';
import type { PastaDoClientePort, ResultadoDaPasta } from '../portas';
import { FRASE_NOME_RESERVADO, chavesDoCliente, ehNomeDoModelo, nomeDaPastaDoPartner } from './nome-da-pasta';

/*
 * AS PASTAS DOS CLIENTES QUE JÁ EXISTEM (rodada dos agentes, 21/10/2026, TR-04),
 * a lógica do script `criar-pastas-dos-clientes`.
 *
 * Para todo `Partner` cliente, ativo, não interno e SEM ponteiro: pede a pasta
 * pela mesma porta do botão (`PastaDoClientePort.garantir`, origem `script`),
 * que vai à porta do operador com `drive.pasta.criar` (R3). UMA APROVAÇÃO POR
 * CLIENTE, e é a régua: o efeito decide na hora se LIGA a pasta de mesmo nome
 * que já existe na raiz (sem escrever nada no Drive) ou CRIA a pasta nova
 * copiando o `_modelo-cliente`. Saber de antemão qual dos dois seria ler o
 * Drive, e a política 1.11.0 não tem leitura de pastas fora do efeito desta
 * capacidade; por isso o `--simular` conta candidatos, não "ligar x criar".
 *
 * Idempotente: quem já tem ponteiro não entra; quem já tem pedido vivo na fila
 * conta como `aguardandoAprovacao` e não ganha outro. `--simular` depois do
 * `--valer` dá zero a propor.
 *
 * NUNCA DOIS PEDIDOS PARA A MESMA PASTA (revisão adversarial de 21/10/2026): o
 * candidato cuja chave de nome é também a de OUTRO cliente da empresa (com ou
 * sem pasta, ativo ou não) não é proposto (`nome-repetido`): os dois ligariam a
 * mesma pasta. Quem resolve é gente, diferenciando os nomes. O cliente com o
 * nome da pasta-modelo também não (`nome-reservado`).
 */

export const MOTIVO_DO_NOME_REPETIDO =
  'outro cliente desta empresa tem o mesmo nome de pasta: diferencie os nomes antes de pedir (os dois ligariam a mesma pasta).';

export interface LinhaDoPlano {
  partnerId: string;
  nome: string;
  acao: 'propor' | 'aguardando' | 'sem-nome' | 'nome-repetido' | 'nome-reservado';
  approvalId?: string | null;
  resultado?: string;
  motivo?: string | null;
}

export interface PlanoDasPastas {
  modo: 'simular' | 'valer';
  candidatos: number;
  comPonteiro: number;
  internos: number;
  semNome: number;
  /** Candidatos com a chave de nome de outro cliente, ou com o nome do modelo: não propostos. */
  nomeRepetido: number;
  aguardandoAprovacao: number;
  aPropor: number;
  /** Só no `--valer`: o que a porta respondeu, por estado. */
  resultados: Partial<Record<ResultadoDaPasta['estado'], number>>;
  linhas: LinhaDoPlano[];
}

export async function planoDasPastas(
  prisma: Pick<PrismaService, 'partner' | 'approval'>,
  orgId: string,
): Promise<PlanoDasPastas> {
  const todos = await prisma.partner.findMany({
    where: { orgId, isCliente: true, ativo: true },
    select: { id: true, razaoSocial: true, nomeFantasia: true, interno: true, pastaDriveId: true },
    orderBy: { razaoSocial: 'asc' },
  });
  const internos = todos.filter((p) => p.interno).length;
  const comPonteiro = todos.filter((p) => !p.interno && p.pastaDriveId).length;
  const candidatos = todos.filter((p) => !p.interno && !p.pastaDriveId);
  const pedidos = await prisma.approval.findMany({
    where: {
      orgId,
      capabilityId: 'drive.pasta.criar',
      resourceType: 'cliente',
      resourceId: { in: candidatos.map((c) => c.id) },
      status: { in: [ApprovalState.pendente, ApprovalState.confirmada] },
      expiraEm: { gt: new Date() },
    },
    select: { id: true, resourceId: true },
  });
  const naFila = new Map(pedidos.map((p) => [p.resourceId, p.id]));
  // Todos os clientes da empresa (também os inativos e os que já têm pasta): é contra eles que a chave colide.
  const todosOsClientes = await prisma.partner.findMany({
    where: { orgId, isCliente: true, interno: false },
    select: { id: true, razaoSocial: true, nomeFantasia: true },
  });
  const quemTemAChave = new Map<string, Set<string>>();
  for (const c of todosOsClientes) {
    for (const k of chavesDoCliente(c)) {
      if (!quemTemAChave.has(k)) quemTemAChave.set(k, new Set());
      quemTemAChave.get(k)!.add(c.id);
    }
  }
  const repetido = (c: { id: string; razaoSocial: string; nomeFantasia: string | null }) =>
    [...chavesDoCliente(c)].some((k) => [...(quemTemAChave.get(k) ?? [])].some((id) => id !== c.id));
  const linhas: LinhaDoPlano[] = candidatos.map((c) => {
    const nome = nomeDaPastaDoPartner(c);
    if (!nome) return { partnerId: c.id, nome: c.razaoSocial, acao: 'sem-nome' };
    if (naFila.has(c.id)) return { partnerId: c.id, nome, acao: 'aguardando', approvalId: naFila.get(c.id) };
    if (ehNomeDoModelo(nome)) return { partnerId: c.id, nome, acao: 'nome-reservado', motivo: FRASE_NOME_RESERVADO };
    if (repetido(c)) return { partnerId: c.id, nome, acao: 'nome-repetido', motivo: MOTIVO_DO_NOME_REPETIDO };
    return { partnerId: c.id, nome, acao: 'propor' };
  });
  return {
    modo: 'simular',
    candidatos: candidatos.length,
    comPonteiro,
    internos,
    semNome: linhas.filter((l) => l.acao === 'sem-nome').length,
    nomeRepetido: linhas.filter((l) => l.acao === 'nome-repetido' || l.acao === 'nome-reservado').length,
    aguardandoAprovacao: linhas.filter((l) => l.acao === 'aguardando').length,
    aPropor: linhas.filter((l) => l.acao === 'propor').length,
    resultados: {},
    linhas,
  };
}

/**
 * Pede a pasta de cada candidato `propor`. Para no primeiro `sem_raiz` (sem a
 * nota da raiz ou sem Google, todos falhariam pelo mesmo motivo).
 */
export async function proporPastas(
  prisma: Pick<PrismaService, 'partner' | 'approval'>,
  pastas: PastaDoClientePort,
  orgId: string,
  atorId: string,
): Promise<PlanoDasPastas> {
  const plano = await planoDasPastas(prisma, orgId);
  plano.modo = 'valer';
  for (const l of plano.linhas) {
    if (l.acao !== 'propor') continue;
    const r = await pastas.garantir({ orgId, partnerId: l.partnerId, origem: 'script', atorId });
    plano.resultados[r.estado] = (plano.resultados[r.estado] ?? 0) + 1;
    l.resultado = r.estado;
    l.approvalId = r.estado === 'aguardando_aprovacao' ? r.approvalId : null;
    l.motivo = r.estado === 'erro' || r.estado === 'sem_raiz' ? r.motivo : null;
    if (r.estado === 'sem_raiz') break;
  }
  return plano;
}

/**
 * O arquivo de `--detalhe` tem nome de cliente: nunca dentro de um repositório
 * git. Sobe a árvore a partir da pasta do arquivo procurando `.git` (pasta ou,
 * num worktree, arquivo). O mesmo desenho do importador do CRM.
 */
export function dentroDeGit(arquivo: string): boolean {
  let dir = path.dirname(path.resolve(arquivo));
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return true;
    const pai = path.dirname(dir);
    if (pai === dir) return false;
    dir = pai;
  }
}
