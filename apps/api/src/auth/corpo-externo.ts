import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

import { comTenantPublico } from '../common/tenant-publico';

/*
 * ============================================================================
 * O TOKEN DO CORPO DE UM AGENTE EXTERNO (A4, 30/10/2026)
 * ============================================================================
 *
 * O Hermes Agent fala com o OS pela Rootinha, e precisa de uma identidade que
 * não seja a de ninguém. As três que já existiam não servem:
 *
 *   · a conta de serviço do MCP (`ia_servico`) é UMA para todos, entra com
 *     senha, não sabe de agente nenhum e tem `mcp.executar` — dar a ela as
 *     rotas de execução seria dar a qualquer cliente do MCP a autonomia da
 *     Rootinha;
 *   · o token da Frota (`FrotaCasa.tokenHash`) é o desenho certo — um token por
 *     coisa de fora, só o hash no banco, o claro aparece uma vez —, mas a
 *     tabela é a de servidores de cliente, com ficha, relato e ordens;
 *   · o JWT de sessão é de PESSOA, e uma pessoa não é um agente.
 *
 * Então o desenho da Frota, numa tabela própria (`CorpoExterno`), com o token
 * vinculado a três coisas fixas: a EMPRESA, o AGENTE e a PESSOA padrão.
 *
 * O FORMATO: `rcx.<orgId>.<segredo>`. A empresa vai no token porque a leitura do
 * hash tem de acontecer DENTRO do contexto da empresa (isolamento por linha):
 * sem ela, achar o token exigiria varrer todas as empresas por cima da policy.
 * A empresa no token não é segredo e não dá acesso: quem não tem o segredo não
 * tem o hash.
 *
 * O ESCOPO, e é o ponto inteiro: o token abre (1) as rotas do PRÓPRIO agente
 * (`/agents/<slug>/capacidades/:id/executar`, o catálogo e a definição dele) e
 * (2) as leituras GET que o agente DECLAROU — a rota de cada capacidade R0 da
 * declaração, com as permissões da pessoa padrão. Nada mais: nenhum POST fora
 * da execução (que passa pela porta), nenhum GET que o agente não declarou.
 */

export const PREFIXO_DO_TOKEN_DE_CORPO = 'rcx';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEGREDO = /^[A-Za-z0-9_-]{40,64}$/;

export function hashDoTokenDeCorpo(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** O cabeçalho `Authorization` traz um token de corpo (e não um JWT de sessão)? */
export function ehTokenDeCorpo(bearer: string | null | undefined): boolean {
  return typeof bearer === 'string' && bearer.startsWith(`${PREFIXO_DO_TOKEN_DE_CORPO}.`);
}

/** Um token novo: o claro (mostrado UMA vez), o hash (guardado) e o prefixo (para a tela). */
export function gerarTokenDeCorpo(orgId: string): { token: string; hash: string; prefixo: string } {
  if (!UUID.test(orgId)) throw new Error('empresa inválida para o token do corpo');
  const segredo = randomBytes(32).toString('base64url');
  const token = `${PREFIXO_DO_TOKEN_DE_CORPO}.${orgId}.${segredo}`;
  return { token, hash: hashDoTokenDeCorpo(token), prefixo: `${PREFIXO_DO_TOKEN_DE_CORPO}.…${segredo.slice(0, 6)}` };
}

/** A empresa e o hash de um token bem formado, ou `null`. Não consulta nada. */
export function lerTokenDeCorpo(token: string | null | undefined): { orgId: string; hash: string } | null {
  if (!ehTokenDeCorpo(token)) return null;
  const partes = (token as string).split('.');
  if (partes.length !== 3) return null;
  const [, orgId, segredo] = partes;
  if (!UUID.test(orgId) || !SEGREDO.test(segredo)) return null;
  return { orgId: orgId.toLowerCase(), hash: hashDoTokenDeCorpo(token as string) };
}

export interface CorpoAutenticado {
  id: string;
  orgId: string;
  corpo: string;
  agentSlug: string;
  solicitanteId: string;
}

type PrismaDoCorpo = Pick<PrismaClient, 'corpoExterno'>;

/**
 * O corpo dono deste token, ou `null` (formato errado, não existe, revogado).
 * Lê DENTRO da empresa do token. Compara o hash em tempo constante, por
 * higiene: a busca já é pelo hash, e o que chega aqui é o que o banco devolveu.
 */
export async function autenticarCorpo(prisma: PrismaDoCorpo, token: string | null | undefined): Promise<CorpoAutenticado | null> {
  const lido = lerTokenDeCorpo(token);
  if (!lido) return null;
  return comTenantPublico(lido.orgId, async () => {
    const linha = await prisma.corpoExterno.findFirst({
      where: { orgId: lido.orgId, tokenHash: lido.hash, revogadoEm: null },
      select: { id: true, orgId: true, corpo: true, agentSlug: true, solicitanteId: true, tokenHash: true, ultimoUsoEm: true },
    });
    if (!linha) return null;
    const a = Buffer.from(linha.tokenHash, 'hex');
    const b = Buffer.from(lido.hash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    // O último uso é dado de tela ("este corpo falou com o OS há 2 min"), não de
    // segurança: grava no máximo uma vez por minuto, e falhar não barra ninguém.
    if (!linha.ultimoUsoEm || Date.now() - linha.ultimoUsoEm.getTime() > 60_000) {
      await prisma.corpoExterno
        .updateMany({ where: { id: linha.id, orgId: linha.orgId }, data: { ultimoUsoEm: new Date() } })
        .catch(() => undefined);
    }
    return { id: linha.id, orgId: linha.orgId, corpo: linha.corpo, agentSlug: linha.agentSlug, solicitanteId: linha.solicitanteId };
  });
}

/* ========================================================================== *
 * AS LEITURAS QUE O AGENTE DECLAROU
 * ========================================================================== */

/** `GET /leads/:id` → casa `GET /leads/abc`? A parte de consulta da rota do catálogo é ignorada. */
export function rotaCasa(rota: string, metodo: string, caminho: string): boolean {
  const [metodoDaRota, ...resto] = rota.trim().split(/\s+/);
  if (!metodoDaRota || resto.length !== 1) return false;
  if (metodoDaRota.toUpperCase() !== metodo.toUpperCase()) return false;
  const molde = resto[0].split('?')[0].replace(/\/+$/, '');
  const alvo = caminho.split('?')[0].replace(/\/+$/, '');
  const partesDoMolde = molde.split('/');
  const partesDoAlvo = alvo.split('/');
  if (partesDoMolde.length !== partesDoAlvo.length) return false;
  return partesDoMolde.every((p, i) => (p.startsWith(':') ? partesDoAlvo[i] !== '' : p === partesDoAlvo[i]));
}

/** O caminho da requisição sem o prefixo global da API (`/api`). */
export function caminhoSemPrefixo(caminho: string, prefixo = 'api'): string {
  const p = `/${prefixo}`;
  return caminho === p ? '/' : caminho.startsWith(`${p}/`) ? caminho.slice(p.length) : caminho;
}

/**
 * A leitura pedida é de uma capacidade que o agente DECLAROU e que é R0 com
 * rota GET? Devolve o id da capacidade, ou `null`. Pura: quem chama entrega a
 * declaração e o catálogo (resolvido por empresa, que é o que vale em runtime).
 */
export function leituraDeclarada(
  declaradas: readonly string[],
  catalogo: (id: string) => { nivel?: string; rota?: string } | null,
  metodo: string,
  caminho: string,
): string | null {
  if (metodo.toUpperCase() !== 'GET') return null;
  for (const id of declaradas) {
    const c = catalogo(id);
    if (!c || c.nivel !== 'R0' || !c.rota || !/^GET\s/i.test(c.rota)) continue;
    if (rotaCasa(c.rota, metodo, caminho)) return id;
  }
  return null;
}

/** A rota pedida é uma das do PRÓPRIO agente do corpo (`/agents/<slug>/...` das três do corpo)? */
export function rotaDoAgenteDoCorpo(agentSlug: string, metodo: string, caminho: string): boolean {
  const c = caminho.split('?')[0].replace(/\/+$/, '');
  const base = `/agents/${agentSlug}`;
  if (metodo.toUpperCase() === 'POST') return new RegExp(`^${base}/capacidades/[a-z0-9_.]+/executar$`).test(c);
  if (metodo.toUpperCase() === 'GET') return c === `${base}/catalogo-externo` || c === `${base}/definicao`;
  return false;
}
