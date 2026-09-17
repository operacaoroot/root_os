/*
 * A TRAVA DE BANCO DAS SUÍTES QUE ESCREVEM.
 *
 * Mora aqui porque duas suítes precisam dela — `tenant-isolation.test.ts` e
 * `contexto-aprovacao.test.ts` — e até 10/09/2026 cada uma carregava a sua
 * cópia: nenhum agente da onda era dono dos dois arquivos ao mesmo tempo, então
 * a regra foi escrita duas vezes. Duas cópias de uma trava de segurança é uma
 * trava que um dia diverge, e a que ficar para trás é justamente a que vai
 * deixar passar.
 *
 * O RISCO QUE ELA CONTÉM
 * As duas suítes criam e apagam linhas. A de isolamento semeia duas empresas; a
 * de contexto DESLIGA a RULE de append-only do `EventLog` para poder limpar
 * depois de si. Apontar `TEST_DATABASE_URL` para o banco errado — copiar a linha
 * de produção para conferir uma coisa rápida é o jeito clássico — apagaria
 * RASTRO, que é exatamente o que não se apaga (02-CONSTRAINTS). Por isso o nome
 * do banco tem de se ANUNCIAR como descartável, ou o operador destrava na mão
 * com `PERMITIR_BANCO_NAO_TESTE=1`.
 *
 * É reconhecimento por NOME, não prova de nada: `marketing_os_test` num host de
 * produção passaria. A trava existe para pegar o engano comum (colar a URL de
 * produção), não um operador determinado.
 *
 * COMO RODAR NO MAC, contra o Postgres descartável:
 *   docker exec mktos-shadow psql -U mkt -d postgres -c 'CREATE DATABASE marketing_os_test'
 *   DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test' \
 *     pnpm --filter @mktos/api db:deploy
 *   DATABASE_URL='...marketing_os_test' pnpm --filter @mktos/api db:seed:politica
 *   TEST_DATABASE_URL='...marketing_os_test' pnpm --filter @mktos/api test
 *
 * O nome `marketing_os` puro NÃO passa na trava — e é de propósito: um banco
 * chamado como o de produção não se anuncia como descartável.
 *
 * ---------------------------------------------------------------------------
 * OS BANCOS DO CONTAINER `mktos-shadow` — QUATRO, E SÓ ESTES QUATRO
 * ---------------------------------------------------------------------------
 * Inventariados e podados na estabilização da onda 4 (11/09/2026). Cada agente
 * de fatia criava o seu (`..._modulos`, `..._provisionamento`, `..._ctx`,
 * `..._politica`) e ia embora deixando-o para trás; um deles ficou com o
 * CHECKSUM de uma migration que depois foi reescrita, e nesse estado
 * `prisma migrate deploy` RECUSA rodar, com um erro que não tem nada a ver com
 * o assunto. Banco descartável esquecido não é lixo inofensivo: é armadilha
 * para o próximo que apontar uma suíte para ele.
 *
 *   marketing_os          — bancada de MIGRATION. É contra ele que se roda
 *                           `db:deploy` (prova que o histórico aplica) e depois
 *                           `prisma migrate dev --create-only`. Não roda suíte:
 *                           o nome não passa na trava acima, de propósito.
 *   marketing_os_shadow   — o banco sombra do PRÓPRIO Prisma, usado por
 *                           `db:diff` (`SHADOW_DATABASE_URL`). O Prisma cria e
 *                           apaga o conteúdo dele sozinho; não guarde nada ali.
 *   marketing_os_test     — a suíte padrão da api inteira
 *                           (`pnpm --filter @mktos/api test`). Um banco só para
 *                           os 13 arquivos, que rodam em PARALELO nele — é por
 *                           isso que teste nenhum pode contar linha sem `where`
 *                           (a vizinha apaga as dela no meio) nem ligar RLS.
 *   marketing_os_test_rls — o que NÃO cabe no de cima: `test:isolamento` e a
 *                           seção de RLS de `rotas-publicas-tenant.test.ts`.
 *                           As duas ligam `ROW LEVEL SECURITY`, que vale para o
 *                           BANCO inteiro, e as duas precisam do papel restrito
 *                           `mktos_app` com senha:
 *                             docker exec mktos-shadow psql -U mkt -d marketing_os_test_rls \
 *                               -c "ALTER ROLE mktos_app WITH LOGIN PASSWORD '<senha local>'"
 *                             TENANT_DATABASE_URL='postgresql://mktos_app:<senha>@localhost:55432/marketing_os_test_rls'
 *
 * Precisou de um quinto por um dia? Use e APAGUE:
 *   docker exec mktos-shadow psql -U mkt -d postgres -c 'DROP DATABASE <nome>'
 *
 * Depois de qualquer migration nova, os quatro ficam para trás ao mesmo tempo.
 * Atualizar é `db:deploy` em cada um — e é mais barato do que descobrir, no meio
 * de uma suíte vermelha, que o banco é que estava velho.
 *
 * Este arquivo NÃO termina em `.test.ts`, então o glob do vitest em
 * `apps/api/vitest.config.ts` não o coleta como suíte. Se um dia alguém o
 * renomear para `.test.ts`, ele vira um arquivo de teste sem nenhum caso — e o
 * piso de ARQUIVOS da CI passaria a ser satisfeito por um arquivo que não testa
 * nada.
 */

/*
 * A TRAVA MUDOU DE CASA (P1-b, 17/09/2026): a expressão regular, o nome do
 * banco e a recusa moram em `src/common/banco-descartavel.ts`, porque a semente
 * de demonstração passou a fazer a mesma pergunta antes de apagar dado. Este
 * arquivo reexporta para que nenhuma suíte precise mudar de import — e para
 * que continue existindo UMA trava, não duas envelhecendo em ritmos diferentes.
 */
export { nomeDoBanco } from '../src/common/banco-descartavel';
import { exigirBancoDescartavel as exigir } from '../src/common/banco-descartavel';

/**
 * Recusa rodar quando o nome do banco não se anuncia como descartável.
 *
 * `oQueAsuiteFaz` entra na mensagem: quem lê o erro precisa saber o que teria
 * acontecido com o banco que ele apontou, e "escreve" não é a mesma coisa que
 * "desliga o append-only do RASTRO".
 *
 * URL vazia não é assunto daqui: cada suíte decide antes se se pula
 * (`describe.skipIf`) ou se lança, e as duas escolhem diferente de propósito.
 */
export function exigirBancoDescartavel(url: string, oQueAsuiteFaz: string): void {
  exigir(url, `a suíte ${oQueAsuiteFaz}`, 'TEST_DATABASE_URL');
}
