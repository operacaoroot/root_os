import { PASTA_MODELO_DO_CLIENTE, nomeDaPastaDoCliente } from '@mktos/shared';

/*
 * O NOME DA PASTA E A CHAVE PARA "LIGAR" UMA QUE JÁ EXISTE (TR-04).
 *
 * A pasta nova nasce com `nomeDaPastaDoCliente` (o nome do cliente sem CNPJ e
 * sem barra). Para LIGAR uma pasta que já existe na raiz (na Root já existem
 * pastas de cliente criadas à mão), o nome é comparado pela CHAVE: sem acento,
 * sem maiúscula, sem pontuação e sem o sufixo de tipo de empresa (Ltda, ME,
 * EPP, Eireli, S/A). Só igualdade EXATA da chave liga; duas pastas com a mesma
 * chave não ligam nenhuma (a dúvida não manda arquivo de um cliente para a
 * pasta de outro). Nome parecido (o começo, uma palavra a mais) NÃO liga.
 */

const SUFIXOS = new Set(['ltda', 'limitada', 'me', 'epp', 'eireli', 'mei', 'sa', 'ss', 'slu']);

/** A chave de comparação de um nome de pasta. */
export function chaveDoNomeDaPasta(nome: string): string {
  const palavras = String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\bs\s*\/\s*a\b/g, 'sa')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  while (palavras.length > 1 && SUFIXOS.has(palavras[palavras.length - 1])) palavras.pop();
  return palavras.join(' ');
}

/** O nome com que o cliente aparece (o fantasia, quando há; senão a razão social). */
export function nomeDoCliente(p: { nomeFantasia?: string | null; razaoSocial: string }): string {
  return (p.nomeFantasia ?? '').trim() || p.razaoSocial;
}

/** O nome da pasta deste cliente, ou `null` quando não sobra nome depois da limpeza. */
export function nomeDaPastaDoPartner(p: { nomeFantasia?: string | null; razaoSocial: string }): string | null {
  return nomeDaPastaDoCliente(nomeDoCliente(p));
}

export type EscolhaDaPasta =
  | { tipo: 'ligar'; id: string }
  | { tipo: 'criar' }
  | { tipo: 'ambigua'; quantas: number };

/**
 * Entre as pastas da raiz, qual é a deste cliente. Compara pela chave do nome
 * do cliente e também pela chave da razão social (a pasta pode ter sido criada
 * com qualquer um dos dois). O modelo nunca é candidato.
 */
export function escolherPastaExistente(
  cliente: { nomeFantasia?: string | null; razaoSocial: string },
  pastas: ReadonlyArray<{ id: string; nome: string }>,
): EscolhaDaPasta {
  const chaves = new Set(
    [nomeDoCliente(cliente), cliente.razaoSocial]
      .map((n) => nomeDaPastaDoCliente(n))
      .filter((n): n is string => !!n)
      .map(chaveDoNomeDaPasta)
      .filter(Boolean),
  );
  const iguais = pastas.filter((p) => p.nome !== PASTA_MODELO_DO_CLIENTE && chaves.has(chaveDoNomeDaPasta(p.nome)));
  if (iguais.length === 1) return { tipo: 'ligar', id: iguais[0].id };
  if (iguais.length > 1) return { tipo: 'ambigua', quantas: iguais.length };
  return { tipo: 'criar' };
}
