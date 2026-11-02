// Carrega variáveis de um arquivo de ambiente da máquina do operador ANTES de qualquer leitura de env.
// Ordem: `MCP_ENV_FILE`, senão `~/.config/root/mcp.env`. Variável já presente no ambiente vence o arquivo.
// Nada do conteúdo vai ao stdout (que é do protocolo) nem ao stderr: só o nome do arquivo e as CHAVES lidas.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function lerArquivoDeEnv(texto: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const linhaCrua of texto.split(/\r?\n/)) {
    const linha = linhaCrua.trim();
    if (!linha || linha.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(linha);
    if (!m) continue;
    let valor = m[2].trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) valor = valor.slice(1, -1);
    out[m[1]] = valor;
  }
  return out;
}

export function carregarEnvDoOperador(): { arquivo: string | null; chaves: string[] } {
  const arquivo = process.env.MCP_ENV_FILE ?? join(homedir(), '.config', 'root', 'mcp.env');
  if (!existsSync(arquivo)) return { arquivo: null, chaves: [] };
  const lidas = lerArquivoDeEnv(readFileSync(arquivo, 'utf8'));
  const chaves: string[] = [];
  for (const [k, v] of Object.entries(lidas)) {
    if (process.env[k] === undefined) { process.env[k] = v; chaves.push(k); }
  }
  return { arquivo, chaves };
}
