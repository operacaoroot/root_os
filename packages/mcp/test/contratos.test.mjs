// A proposta de envio do contrato: só em nome de gente. Sem operador, recusa antes de falar com a API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a ferramenta de propor envio usa o operador, e nenhuma ferramenta de contrato envia', () => {
  const fonte = readFileSync(path.join(RAIZ, 'src/server.ts'), 'utf8');
  const bloco = fonte.slice(fonte.indexOf("'comercial_contrato_propor_envio'"));
  const fim = bloco.indexOf('server.registerTool') > 0 ? bloco.indexOf('server.registerTool') : bloco.indexOf('registrarGenericas');
  const corpo = bloco.slice(0, fim);
  assert.match(corpo, /operador\(\)\.post\(`\/comercial\/contratos\/registro\/\$\{encodeURIComponent\(contrato_id\)\}\/enviar`/);
  assert.doesNotMatch(corpo, /apiGet|leitor\(\)/);
});

test('sem identidade do operador, a recusa é a frase do que configurar', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'mcp-sem-operador-'));
  const env = { PATH: process.env.PATH, HOME: home, MCP_SERVICE_PASSWORD: 'x', MCP_API_URL: 'http://127.0.0.1:9/api' };
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', "import { operador } from './dist/client.js'; try { operador(); console.log('SEM RECUSA'); } catch (e) { console.log(e.message); }"], { cwd: RAIZ, env, encoding: 'utf8' });
  assert.match(r.stdout, /Identidade do operador ausente/);
  assert.match(r.stdout, /proposta de envio do contrato/);
});
