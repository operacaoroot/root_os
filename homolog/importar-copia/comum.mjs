// Peças comuns da importação da cópia (rodada de 19/10/2026).
//
// Duas pontas, sem nada no meio:
//   - o STAGING (container rootos_copia_staging, rede só dele): o dump de produção
//     restaurado. Só se LÊ, e só por aqui (`lerStaging`), pelo psql do próprio
//     container. Nenhuma API alcança este banco.
//   - o DESTINO (rootos_copia_db): o nosso esquema. Escreve-se pela API da stack
//     (`api`), que aplica RLS, auditoria, gatilhos e regras. O SQL direto no destino
//     (`sqlDestino`) existe só para o que a API não expõe, cada uso justificado no
//     ponto de chamada e no homolog/RESULTADO-COPIA.md.
//
// Nada daqui imprime título, texto ou e-mail de cliente: o log é de contagens.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PASTA_COPIA = path.join(RAIZ, 'homolog', 'copia');
/** require com a resolução do apps/api (onde moram @prisma/client, @mktos/shared e bcryptjs). */
export const requireDaApi = createRequire(path.join(RAIZ, 'apps', 'api', 'package.json'));

export function lerEnv(arquivo = path.join(RAIZ, 'homolog', '.env.copia')) {
  const env = {};
  for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function psql(container, usuario, banco, sql) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', usuario, '-d', banco, '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** Uma consulta de LEITURA no staging que devolve uma linha só com um JSON. */
export function lerStaging(sql) {
  const env = lerEnv();
  const saida = psql('rootos_copia_staging', env.STAGING_USER || 'staging', 'producao_staging', `BEGIN READ ONLY; ${sql}; COMMIT;`);
  const linhas = saida.split('\n').filter((l) => l && l !== 'BEGIN' && l !== 'COMMIT');
  return JSON.parse(linhas.join('\n') || 'null');
}

/** SQL no destino. Só para o que a API não expõe (ver o cabeçalho). Devolve as linhas cruas. */
export function sqlDestino(sql) {
  const env = lerEnv();
  return psql('rootos_copia_db', env.DB_USER || 'rootos', env.DB_NAME || 'rootos_copia', sql)
    .split('\n')
    .filter(Boolean);
}

/** Literal de SQL só para os tipos que entram aqui: uuid, data ISO, texto curto nosso. */
export function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function apiDe(base) {
  return async function api(metodo, caminho, corpo, token, extras = {}) {
    const r = await fetch(`${base}${caminho}`, {
      method: metodo,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(extras.headers ?? {}),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await r.text();
    let json = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = texto;
    }
    if (!r.ok) {
      const msg = typeof json === 'string' ? json : (json?.message ?? JSON.stringify(json));
      const e = new Error(`${metodo} ${caminho.replace(/[0-9a-f-]{36}/g, ':id')} → ${r.status}: ${String(msg).slice(0, 300)}`);
      e.status = r.status;
      throw e;
    }
    return json;
  };
}
