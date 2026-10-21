import type { DonoDaFuncao } from './agentes.js';
import { DOMINIO_DAS_CONTAS_DO_SISTEMA, equipeDasContas, tituloNormalizado } from './tarefas-do-dia.js';

/*
 * QUEM APARECE NA EQUIPE (rodada dos agentes, 21/10/2026, A7)
 *
 * A Equipe (`/organograma`) mostra as PESSOAS da empresa e, sob cada uma, os
 * agentes, rotinas e automações de que ela é dona. No ROOT OS a equipe são três
 * pessoas (Rodrigo, Lucas e Pedro), mas o banco tem mais contas que isso: as do
 * sistema, as de teste da homologação, a conta de uso comum com o nome da
 * empresa, a mesma pessoa com duas contas. Nada disso é apagado: a regra só
 * decide o que fica FORA DA VISTA, e diz por quê.
 *
 * A REGRA, NA ORDEM (a primeira que casa decide o motivo):
 *
 *  1. `desativada`  conta com `isActive = false`.
 *  2. `maquina`     conta com um papel de máquina (`ia_servico`, `ia_acao`),
 *                   mesmo que tenha outro papel junto: basta um.
 *  3. `sistema`     e-mail no domínio da semente (`@marketing-os.local`): o
 *                   admin da instalação, o MCP e a IA de ação. É a mesma
 *                   régua das tarefas (`DOMINIO_DAS_CONTAS_DO_SISTEMA`).
 *  4. `teste`       e-mail em domínio reservado de teste ou homologação:
 *                   termina em `.homolog`, `.test`, `.invalid`, `.example` ou
 *                   `.localhost`, ou é `example.com/.org/.net` ou `exemplo.com`
 *                   (as cadeiras da mesa de homologação, `@root.homolog`).
 *  5. `importacao`  conta SEM PAPEL nenhum. Conta criada por script de
 *                   importação ou de carga nasce sem papel, e conta sem papel
 *                   não abre tela nenhuma do OS: não é gente da equipe. Quem
 *                   cadastra uma pessoa pela tela sempre dá um papel.
 *  6. `empresa`     a conta com o nome (ou o apelido) da empresa: a conta de uso
 *                   comum não é pessoa (regra de `equipeDasContas`).
 *  7. `duplicada`   a mesma pessoa com duas contas (mesmo nome normalizado):
 *                   aparece UMA vez, na conta que entrou por último, e a outra
 *                   aponta para ela (regra de `equipeDasContas`).
 *
 * `.local` SOZINHO NÃO É TESTE: as três pessoas de exemplo do seed fictício
 * usam `@root.local`, e é de propósito que elas aparecem.
 */

export const PAPEIS_DE_MAQUINA: readonly string[] = ['ia_servico', 'ia_acao'];

/** Sufixos de domínio reservados para teste (RFC 2606/6761) e o da homologação. */
export const SUFIXOS_DE_TESTE: readonly string[] = ['.homolog', '.test', '.invalid', '.example', '.localhost'];
/** Domínios inteiros de exemplo. */
export const DOMINIOS_DE_TESTE: readonly string[] = ['example.com', 'example.org', 'example.net', 'exemplo.com', 'exemplo.com.br'];

export type MotivoForaDaEquipe =
  | 'desativada'
  | 'maquina'
  | 'sistema'
  | 'teste'
  | 'importacao'
  | 'empresa'
  | 'duplicada';

export const ROTULO_DO_MOTIVO: Readonly<Record<MotivoForaDaEquipe, string>> = {
  desativada: 'conta desativada',
  maquina: 'conta de máquina',
  sistema: 'conta do sistema',
  teste: 'conta de teste',
  importacao: 'conta de importação (sem papel)',
  empresa: 'conta de uso comum da empresa',
  duplicada: 'segunda conta da mesma pessoa',
};

export interface ContaParaEquipe {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  /** As CHAVES dos papéis (`admin_master`, `diretor`, `ia_acao`...). */
  papeis: readonly string[];
  ultimoAcesso: string | null;
}

export interface PessoaDaEquipe {
  id: string;
  nome: string;
  papeis: readonly string[];
  /** As contas que esta pessoa representa (ela mesma e as duplicadas). */
  contas: string[];
}

export interface ResultadoDaEquipe {
  pessoas: PessoaDaEquipe[];
  fora: { id: string; motivo: MotivoForaDaEquipe }[];
  /** Qualquer conta da equipe (inclusive a duplicada) → o id da pessoa na tela. */
  canonica: Map<string, string>;
}

function dominioDe(email: string): string {
  const e = email.trim().toLowerCase();
  const arroba = e.lastIndexOf('@');
  return arroba >= 0 ? e.slice(arroba + 1) : '';
}

/** O motivo de a conta ficar fora antes de olhar as outras (regras 1 a 5), ou `null`. */
export function motivoDaConta(conta: ContaParaEquipe): MotivoForaDaEquipe | null {
  if (!conta.ativo) return 'desativada';
  if (conta.papeis.some((p) => PAPEIS_DE_MAQUINA.includes(p))) return 'maquina';
  if (conta.email.trim().toLowerCase().endsWith(DOMINIO_DAS_CONTAS_DO_SISTEMA)) return 'sistema';
  const dominio = dominioDe(conta.email);
  if (DOMINIOS_DE_TESTE.includes(dominio) || SUFIXOS_DE_TESTE.some((s) => dominio.endsWith(s))) return 'teste';
  if (conta.papeis.length === 0) return 'importacao';
  return null;
}

/** A regra inteira (ver o cabeçalho). Pura: a API e a suíte usam a mesma. */
export function pessoasDaEquipe(
  contas: readonly ContaParaEquipe[],
  empresa: { nome: string; slug: string },
): ResultadoDaEquipe {
  const fora: ResultadoDaEquipe['fora'] = [];
  const candidatas: ContaParaEquipe[] = [];
  for (const c of contas) {
    const motivo = motivoDaConta(c);
    if (motivo) fora.push({ id: c.id, motivo });
    else candidatas.push(c);
  }
  const { pessoas, canonica } = equipeDasContas(
    candidatas.map((c) => ({ id: c.id, nome: c.nome, ultimoAcesso: c.ultimoAcesso })),
    empresa,
  );
  const porId = new Map(candidatas.map((c) => [c.id, c]));
  for (const c of candidatas) {
    const dona = canonica.get(c.id);
    if (!dona) fora.push({ id: c.id, motivo: 'empresa' });
    else if (dona !== c.id) fora.push({ id: c.id, motivo: 'duplicada' });
  }
  return {
    pessoas: pessoas.map((p) => ({
      id: p.id,
      nome: p.nome,
      papeis: porId.get(p.id)?.papeis ?? [],
      contas: candidatas.filter((c) => canonica.get(c.id) === p.id).map((c) => c.id),
    })),
    fora,
    canonica,
  };
}

/** O primeiro nome, normalizado (sem acento, minúsculo). */
export function primeiroNome(nome: string): string {
  return tituloNormalizado(nome).split(' ')[0] ?? '';
}

/**
 * A pessoa do dono PADRÃO do cadastro (`rodrigo` | `lucas` | `pedro`), casando
 * pelo PRIMEIRO NOME da pessoa da equipe. Duas pessoas com o mesmo primeiro nome
 * não resolvem (devolve `null`): chutar entre elas daria a função a quem não é.
 */
export function pessoaDoDonoPadrao<P extends { id: string; nome: string }>(
  dono: DonoDaFuncao,
  pessoas: readonly P[],
): P | null {
  const alvo = tituloNormalizado(dono);
  const casam = pessoas.filter((p) => primeiroNome(p.nome) === alvo);
  return casam.length === 1 ? casam[0] : null;
}

/*
 * QUEM PODE TROCAR O DONO: `admin` ou `controle`, como o roteiro diz. No catálogo
 * de permissões isso é `admin.usuarios` (administrar gente) OU `admin.permissoes`
 * (a seção Controle: regras e permissões). Nenhuma chave nova. Hoje as duas só
 * existem no perfil Admin Master. A API relê os papéis no banco.
 */
export const PERMISSOES_DE_EDITAR_DONO: readonly string[] = ['admin.usuarios', 'admin.permissoes'];

export function podeEditarDono(permissoes: readonly string[]): boolean {
  return permissoes.some((p) => PERMISSOES_DE_EDITAR_DONO.includes(p));
}

/** Quem pode cadastrar o WhatsApp de OUTRA pessoa (para si, qualquer pessoa da casa pode). */
export const PERMISSAO_DE_CADASTRAR_WHATSAPP_DE_OUTRO = 'admin.usuarios';
