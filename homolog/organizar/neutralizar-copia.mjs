// Neutraliza as credenciais de uma CÓPIA da produção restaurada para homologação.
//
// NUNCA roda em produção: é o passo que vem logo depois do pg_restore numa stack de
// homologação (rootos-final, 19/10/2026). Recusa rodar se o banco não tiver nome de
// homologação.
//
// O que faz, numa transação só (inventário completo em homolog/organizar/neutralizacao.md,
// fora do git, e o resumo em homolog/organizar/README.md):
//   - User.passwordHash: toda conta recebe o bcrypt de um segredo aleatório que ninguém
//     guarda; o login do Rodrigo e o do Lucas (achado pelo NOME, uma conta só, senão
//     recusa) recebem as senhas novas do .env da stack. bcrypt custo 10, o formato que a
//     API compara (bcryptjs).
//   - Credenciais de conector e tokens: anulados ou trocados por marcador; o que é hash
//     de token (convite, aprovação, sessão do cofre) vira hash de valor aleatório e a
//     sessão do cofre vence agora. Nada é apagado.
//   - Rotinas: todas desligadas (ativo = false, estado = pausado).
//
// Uso:
//   node homolog/organizar/neutralizar-copia.mjs --env <arquivo .env da stack> \
//        [--container rootos_final_db] [--simular]
// As senhas viajam pelo stdin do psql, nunca pela linha de comando nem por arquivo.
// A saída é só de contagens.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const arg = (n, padrao = null) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : padrao;
};
const simular = process.argv.includes('--simular');
const arquivoEnv = arg('--env');
if (!arquivoEnv) throw new Error('informe --env <arquivo .env da stack>');
const env = {};
for (const l of readFileSync(arquivoEnv, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const container = arg('--container', 'rootos_final_db');
const usuario = env.DB_USER || 'rootos';
const banco = env.DB_NAME || 'rootos_final';
if (!/final|copia|homolog|test|staging/i.test(banco)) throw new Error('o banco não tem nome de homologação: recuso neutralizar');
const emailRodrigo = (env.FINAL_LOGIN_EMAIL_RODRIGO || '').toLowerCase();
const senhaRodrigo = env.FINAL_LOGIN_SENHA_RODRIGO;
const senhaLucas = env.FINAL_LOGIN_SENHA_LUCAS;
if (!emailRodrigo || !senhaRodrigo || !senhaLucas) throw new Error('faltam FINAL_LOGIN_EMAIL_RODRIGO, FINAL_LOGIN_SENHA_RODRIGO ou FINAL_LOGIN_SENHA_LUCAS no .env');

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const MARCA = 'neutralizado-na-copia-de-homologacao';

// Colunas por tabela. "anular" vale para coluna que aceita nulo; "marcar" para NOT NULL.
const sql = `
\\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA IF NOT EXISTS neutralizar_tmp;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA neutralizar_tmp;
CREATE TEMP TABLE resumo (item text, n int);

-- Lucas: uma conta só, achada pelo nome.
DO $$ BEGIN
  IF (SELECT count(*) FROM "User" WHERE name ILIKE '%lucas%') <> 1 THEN
    RAISE EXCEPTION 'esperava exatamente uma conta com o nome Lucas';
  END IF;
  IF (SELECT count(*) FROM "User" WHERE lower(email) = ${lit(emailRodrigo)}) <> 1 THEN
    RAISE EXCEPTION 'conta do Rodrigo ausente';
  END IF;
END $$;

WITH u AS (
  UPDATE "User" SET "passwordHash" = neutralizar_tmp.crypt(encode(neutralizar_tmp.gen_random_bytes(32), 'hex'), neutralizar_tmp.gen_salt('bf', 10))
  WHERE lower(email) <> ${lit(emailRodrigo)} AND name NOT ILIKE '%lucas%' RETURNING 1)
INSERT INTO resumo SELECT 'User.passwordHash (segredo descartado)', count(*) FROM u;
WITH u AS (
  UPDATE "User" SET "passwordHash" = neutralizar_tmp.crypt(${lit(senhaRodrigo)}, neutralizar_tmp.gen_salt('bf', 10))
  WHERE lower(email) = ${lit(emailRodrigo)} RETURNING 1)
INSERT INTO resumo SELECT 'User.passwordHash (Rodrigo, senha nova)', count(*) FROM u;
WITH u AS (
  UPDATE "User" SET "passwordHash" = neutralizar_tmp.crypt(${lit(senhaLucas)}, neutralizar_tmp.gen_salt('bf', 10))
  WHERE name ILIKE '%lucas%' RETURNING 1)
INSERT INTO resumo SELECT 'User.passwordHash (Lucas, senha nova)', count(*) FROM u;

WITH u AS (UPDATE "GoogleAccount" SET "accessToken" = ${lit(MARCA)}, "refreshToken" = NULL, "expiresAt" = now() RETURNING 1)
INSERT INTO resumo SELECT 'GoogleAccount.accessToken/refreshToken', count(*) FROM u;
WITH u AS (UPDATE "MetaAccount" SET "userToken" = ${lit(MARCA)}, "pageToken" = NULL, "expiresAt" = now() RETURNING 1)
INSERT INTO resumo SELECT 'MetaAccount.userToken/pageToken', count(*) FROM u;
WITH u AS (UPDATE "BioConexao" SET "tokenCifrado" = ${lit(MARCA)}, "refreshCifrado" = NULL, "expiraEm" = now(), status = 'token_expirado' RETURNING 1)
INSERT INTO resumo SELECT 'BioConexao.tokenCifrado/refreshCifrado', count(*) FROM u;
WITH u AS (UPDATE "BioCredencialApp" SET "segredoCifrado" = ${lit(MARCA)} RETURNING 1)
INSERT INTO resumo SELECT 'BioCredencialApp.segredoCifrado', count(*) FROM u;
WITH u AS (UPDATE "BioOauthState" SET verifier = NULL, "expiraEm" = now() RETURNING 1)
INSERT INTO resumo SELECT 'BioOauthState.verifier', count(*) FROM u;
WITH u AS (UPDATE "SegredoDeConector" SET "valorCifrado" = ${lit(MARCA)}, "revogadoEm" = coalesce("revogadoEm", now()), "motivoRevogacao" = coalesce("motivoRevogacao", 'neutralizado na cópia de homologação') RETURNING 1)
INSERT INTO resumo SELECT 'SegredoDeConector.valorCifrado', count(*) FROM u;
WITH u AS (UPDATE "CofreItem" SET "usuarioCifrado" = NULL, "segredoCifrado" = NULL, "notasCifradas" = NULL
  WHERE "usuarioCifrado" IS NOT NULL OR "segredoCifrado" IS NOT NULL OR "notasCifradas" IS NOT NULL RETURNING 1)
INSERT INTO resumo SELECT 'CofreItem.usuarioCifrado/segredoCifrado/notasCifradas', count(*) FROM u;
WITH u AS (UPDATE "CofreSenha" SET hash = neutralizar_tmp.crypt(encode(neutralizar_tmp.gen_random_bytes(32), 'hex'), neutralizar_tmp.gen_salt('bf', 10)) RETURNING 1)
INSERT INTO resumo SELECT 'CofreSenha.hash (segredo descartado)', count(*) FROM u;
WITH u AS (UPDATE "CofreSessao" SET "tokenHash" = encode(neutralizar_tmp.digest(neutralizar_tmp.gen_random_bytes(32), 'sha256'), 'hex'), "expiraEm" = least("expiraEm", now()) RETURNING 1)
INSERT INTO resumo SELECT 'CofreSessao.tokenHash (vencida)', count(*) FROM u;
WITH u AS (UPDATE "OnboardingConvite" SET "tokenHash" = encode(neutralizar_tmp.digest(neutralizar_tmp.gen_random_bytes(32), 'sha256'), 'hex'), "tokenCifrado" = NULL RETURNING 1)
INSERT INTO resumo SELECT 'OnboardingConvite.tokenHash/tokenCifrado', count(*) FROM u;
WITH u AS (UPDATE "Approval" SET "tokenHash" = encode(neutralizar_tmp.digest(neutralizar_tmp.gen_random_bytes(32), 'sha256'), 'hex') RETURNING 1)
INSERT INTO resumo SELECT 'Approval.tokenHash', count(*) FROM u;
WITH u AS (UPDATE "EnvioAoYoutube" SET "sessaoCifrada" = NULL WHERE "sessaoCifrada" IS NOT NULL RETURNING 1)
INSERT INTO resumo SELECT 'EnvioAoYoutube.sessaoCifrada', count(*) FROM u;

WITH u AS (UPDATE "Rotina" SET ativo = false, estado = 'pausado' WHERE ativo OR estado <> 'pausado' RETURNING 1)
INSERT INTO resumo SELECT 'Rotina (desligada e pausada)', count(*) FROM u;

DROP SCHEMA neutralizar_tmp CASCADE;
SELECT json_object_agg(item, n) FROM resumo;
${simular ? 'ROLLBACK;' : 'COMMIT;'}
`;

const saida = execFileSync('docker', ['exec', '-i', container, 'psql', '-U', usuario, '-d', banco, '-At', '-q'], { input: sql, encoding: 'utf8' });
const linha = saida.split('\n').find((l) => l.startsWith('{'));
console.log(simular ? '(simulação: nada gravado)' : 'neutralizado');
console.log(JSON.stringify(JSON.parse(linha), null, 2));
