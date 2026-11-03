// Testa o leitor do arquivo de ambiente do operador (dist/env.js: rodar depois do build).
import test from 'node:test';
import assert from 'node:assert/strict';
import { lerArquivoDeEnv } from '../dist/env.js';

test('lê chave=valor, ignora comentário e linha vazia, tira aspas', () => {
  const lido = lerArquivoDeEnv('# cabeçalho\n\nMCP_API_URL=https://os.exemplo/api\nexport MCP_OPERADOR_EMAIL="pessoa@exemplo.com"\nMCP_OPERADOR_SENHA=\'a=b=c\'\nlinha sem igual\n');
  assert.deepEqual(lido, { MCP_API_URL: 'https://os.exemplo/api', MCP_OPERADOR_EMAIL: 'pessoa@exemplo.com', MCP_OPERADOR_SENHA: 'a=b=c' });
});

test('valor com = no meio é preservado inteiro', () => {
  assert.equal(lerArquivoDeEnv('X=abc==\n').X, 'abc==');
});
