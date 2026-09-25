/*
 * A TRAVA DE BANCO DESCARTÁVEL — uma verdade só, para teste e para semente.
 *
 * Nasceu em `test/banco-de-teste.ts` (onda 7) para as suítes que ESCREVEM não
 * rodarem contra o banco errado. Veio para cá quando a semente de demonstração
 * (`prisma/seed-demo.ts`, etapa P1-b do plano de produto) passou a precisar da
 * mesma pergunta: "este banco se anuncia como descartável?". Duas cópias da
 * expressão regular seriam duas travas envelhecendo em ritmos diferentes.
 *
 * Sem dependência do Nest nem do Prisma, de propósito: roda sob `tsx` (seeds) e
 * sob `vitest` (suítes), onde injeção por decorator não existe.
 */

/** Nomes que anunciam um banco descartável. */
export const PARECE_DESCARTAVEL = /test|dev|local|staging|shadow/i;

/** Destrava conscientemente rodar fora de um banco que se anuncia como tal. */
export const DESTRAVE = 'PERMITIR_BANCO_NAO_TESTE';

/**
 * O nome do banco dentro de uma URL de conexão. Devolve string vazia quando a
 * URL não é analisável — e string vazia nunca casa com o padrão, então uma URL
 * ilegível cai no lado seguro da trava.
 */
export function nomeDoBanco(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

/**
 * O banco se anuncia como descartável — pelo NOME, e só pelo nome.
 *
 * É a checagem ESTRITA, e é a que a semente de demonstração usa: o destrave
 * das suítes (`PERMITIR_BANCO_NAO_TESTE=1`) NÃO vale para apagar dado. Uma
 * variável esquecida no shell de quem roda os testes não pode virar licença
 * para o `seed-demo` limpar uma empresa.
 */
export function bancoDescartavelEstrito(url: string): boolean {
  return PARECE_DESCARTAVEL.test(nomeDoBanco(url));
}

/** O banco se anuncia como descartável, ou a pessoa destravou por escrito? (suítes) */
export function bancoEhDescartavel(url: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return bancoDescartavelEstrito(url) || env[DESTRAVE] === '1';
}

/**
 * Recusa rodar quando o nome do banco não se anuncia como descartável.
 *
 * `oQueFaz` entra na mensagem: quem lê o erro precisa saber o que teria
 * acontecido com o banco que ele apontou, e "escreve" não é a mesma coisa que
 * "apaga os leads da empresa".
 *
 * URL vazia não é assunto daqui: cada chamador decide antes se se pula ou se
 * lança, e os dois escolhem diferente de propósito.
 */
export function exigirBancoDescartavel(
  url: string,
  oQueFaz: string,
  variavelDaUrl = 'TEST_DATABASE_URL',
): void {
  if (!url) return;
  if (bancoEhDescartavel(url)) return;

  throw new Error(
    `Banco "${nomeDoBanco(url)}" não parece descartável e o comando ${oQueFaz}. ` +
      `Aponte ${variavelDaUrl} para um banco descartável (nome com test/dev/local/staging/shadow) ` +
      `ou defina ${DESTRAVE}=1 conscientemente.`,
  );
}
