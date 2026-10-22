/*
 * AS ATRIBUIÇÕES DA EQUIPE LIDAS DO VAULT (produção 22B, I6, 22/10/2026)
 *
 * A Equipe mostra, para cada pessoa, o que já está escrito na memória da Root,
 * só leitura e sem texto novo a pedir:
 *
 *  · `20-Governanca/Sócios e papéis.md`: a tabela Sócio · Conduz · Funções de
 *    que é dono;
 *  · `20-Governanca/<Nome>.md`: a seção "## Dono das funções", com os links das
 *    fichas;
 *  · `30-Organizacao/Matriz quem-faz-o-quê.md`: a tabela Função · Dono ·
 *    Substituto · Agentes/automações · Estado;
 *  · `30-Organizacao/Função <separador> <nome>.md`: `dono:` no frontmatter,
 *    inclusive "os três".
 *
 * A pessoa casa com as notas pelo `User.nomeNoVault` (do perfil). Sem ele, a
 * API sugere pelo primeiro nome quando não há dúvida; havendo, fica [a decidir].
 * A leitura vai pela porta protegida do índice do vault (a mesma do Contexto),
 * com `obsidian.ver` relido no banco e as notas restritas de fora.
 */

export interface FuncaoDoVault {
  /** O nome da função como a ficha diz (sem o prefixo "Função"). */
  nome: string;
  /** O caminho da ficha no vault, quando ela existe. */
  caminho: string | null;
  /** O id da nota da ficha na memória, para abrir no Contexto (`/contexto?nota=`). */
  notaId: string | null;
  /** A coluna Estado da matriz, quando há. */
  estado: string | null;
  /** A coluna Agentes/automações da matriz, quando há. */
  agentes: string | null;
}

export type OrigemDoNomeNoVault = 'perfil' | 'sugerido' | 'a_decidir';

export interface AtribuicoesDaPessoa {
  /** O nome usado para casar com as notas (do perfil ou sugerido), ou nulo. */
  nomeNoVault: string | null;
  origemDoNome: OrigemDoNomeNoVault;
  /** A coluna Conduz da tabela de sócios. */
  conduz: string | null;
  /** As funções de que ela é dona (matriz, ficha, nota da pessoa ou tabela de sócios). */
  dona: FuncaoDoVault[];
  /** As funções de que ela é substituta (matriz). */
  substituta: FuncaoDoVault[];
  /** A nota da pessoa na Governança, quando existe. */
  nota: { caminho: string; notaId: string | null } | null;
}

export type MotivoDaMemoriaIndisponivel = 'sem_permissao' | 'ausente' | 'erro';

export interface MemoriaDaEquipe {
  disponivel: boolean;
  motivo: MotivoDaMemoriaIndisponivel | null;
  /** A frase da tela. */
  frase: string | null;
  /** Os sócios que o vault nomeia (para a sugestão e a conferência do perfil). */
  socios: string[];
}

export const FRASE_DA_MEMORIA_INDISPONIVEL: Readonly<Record<MotivoDaMemoriaIndisponivel, string>> = {
  sem_permissao: 'Memória da Root indisponível para esta conta (é preciso ver o Contexto).',
  ausente: 'Memória da Root indisponível: as notas da Governança e da Organização não estão no vault indexado.',
  erro: 'Memória da Root indisponível agora. Tente de novo em instantes.',
};

export const ATRIBUICOES_VAZIAS: AtribuicoesDaPessoa = {
  nomeNoVault: null,
  origemDoNome: 'a_decidir',
  conduz: null,
  dona: [],
  substituta: [],
  nota: null,
};
