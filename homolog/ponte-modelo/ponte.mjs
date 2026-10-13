#!/usr/bin/env node
/*
 * A PONTE DE MODELO — sidecar no HOST do Predator (homologação do cockpit).
 *
 * Existe para a demonstração rodar sem chave da Anthropic válida no
 * `.env.homolog`: o container da API aponta `PONTE_MODELO_URL` para
 * http://host.docker.internal:4099 e o provider `ponte` (apps/api/src/llm)
 * faz `POST /complete {system, user, maxTokens}`. Aqui a pergunta vira uma
 * chamada a `claude -p --model <modelo> --output-format text`, e a resposta
 * volta como texto.
 *
 * O que ela NÃO é: um provedor de produção. Ela gasta a assinatura de quem está
 * logado no Claude Code desta máquina, não mede custo (o OS grava custo 0 com
 * `custoDesconhecido: true`) e só escuta em loopback. Sessão do Claude Code
 * expirada = 503, e o OS cai no `stub` avisando na tela.
 *
 * AS TRANCAS (conserto E-1 da revisão, 13/10/2026). A pergunta do cliente na
 * sala é anônima e chega até aqui; por isso:
 *   1. nada do pedido vai para a linha de comando: o CLI é aberto SEM shell,
 *      pelo caminho absoluto do executável; o prompt de sistema vai por arquivo
 *      temporário (`--system-prompt-file`, inteiro, com as quebras de linha) e a
 *      pergunta pela entrada padrão;
 *   2. o CLI sobe sem ferramenta nenhuma (`--tools ""` e `--disallowedTools`
 *      cobrindo as de leitura, escrita, shell e rede), sem MCP
 *      (`--strict-mcp-config` sem `--mcp-config`), sem configuração de usuário,
 *      projeto ou local (`--setting-sources` vazio), sem guardar sessão, com o
 *      diretório corrente numa pasta temporária vazia;
 *   3. só atende quem traz o token compartilhado (`x-ponte-token`, o mesmo
 *      `PONTE_MODELO_TOKEN` do `.env.homolog` que o compose passa à API), com
 *      `content-type: application/json` e `Host` de loopback ou do Docker
 *      (um navegador desta máquina não consegue mandar o pedido sem preflight);
 *   4. no máximo `PONTE_MAX_EM_CURSO` chamadas ao mesmo tempo (429 acima).
 * Sem token de 32 caracteres ou mais, a ponte nem sobe.
 *
 * Subir:  node homolog/ponte-modelo/ponte.mjs           (porta 4099; lê o token do .env.homolog)
 * Testar: curl -s -X POST localhost:4099/complete -H 'content-type: application/json' \
 *           -H "x-ponte-token: $PONTE_MODELO_TOKEN" \
 *           -d '{"system":"Responda em uma palavra.","user":"Que cor é o céu?"}'
 * Saúde:  GET /saude  → { ok, modelo, ultimaChamadaEm, falhasSeguidas }  (sem token; não revela nada)
 */
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PONTE_PORTA ?? 4099);
const MODELO = process.env.PONTE_MODELO ?? 'claude-fable-5-1';
const PRAZO_MS = Number(process.env.PONTE_PRAZO_MS ?? 180_000);
const MAX_EM_CURSO = Number(process.env.PONTE_MAX_EM_CURSO ?? 2);
const MAX_CORPO = 2_000_000;
const HOSTS = new Set([`127.0.0.1:${PORTA}`, `localhost:${PORTA}`, `host.docker.internal:${PORTA}`]);
/** As ferramentas que nunca podem estar ligadas, mesmo que `--tools ""` mude de sentido numa versão do CLI. */
const PROIBIDAS = ['Bash', 'PowerShell', 'Read', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'Skill', 'mcp__*'];

/** O token: variável de ambiente ou a linha `PONTE_MODELO_TOKEN=` do `homolog/.env.homolog`. */
function lerToken() {
  if (process.env.PONTE_MODELO_TOKEN) return process.env.PONTE_MODELO_TOKEN.trim();
  const arquivo = resolve(AQUI, '..', '.env.homolog');
  if (!existsSync(arquivo)) return '';
  const linha = readFileSync(arquivo, 'utf8').split(/\r?\n/).find((l) => l.startsWith('PONTE_MODELO_TOKEN='));
  return linha ? linha.slice('PONTE_MODELO_TOKEN='.length).trim() : '';
}

/** O caminho absoluto do executável do CLI (sem shell não há busca no PATH com extensão implícita). */
function acharClaude() {
  const pedido = process.env.PONTE_CLAUDE_BIN;
  if (pedido) return isAbsolute(pedido) && existsSync(pedido) ? pedido : null;
  const nome = process.platform === 'win32' ? 'claude.exe' : 'claude';
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const c = join(dir, nome);
    if (existsSync(c)) return c;
  }
  return null;
}

const TOKEN = lerToken();
const CLAUDE = acharClaude();
if (TOKEN.length < 32) {
  console.error('[ponte] PONTE_MODELO_TOKEN ausente ou curto (32+ caracteres): gere com `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"` e ponha no homolog/.env.homolog. Não subi.');
  process.exit(1);
}
if (!CLAUDE) {
  console.error('[ponte] não achei o executável do Claude Code (PATH ou PONTE_CLAUDE_BIN com caminho absoluto). Não subi.');
  process.exit(1);
}

let ultimaChamadaEm = null;
let falhasSeguidas = 0;
let emCurso = 0;

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes = [];
    req.on('data', (c) => {
      tamanho += c.length;
      if (tamanho > MAX_CORPO) {
        reject(new Error('corpo acima de 2 MB'));
        req.destroy();
        return;
      }
      partes.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

function tokenConfere(recebido) {
  const a = Buffer.from(String(recebido ?? ''), 'utf8');
  const b = Buffer.from(TOKEN, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Chama o CLI: sem shell, sem ferramentas, sem MCP, sem configurações; sistema por arquivo, pergunta pela entrada padrão. */
function perguntar({ system, user }) {
  return new Promise((resolverPergunta) => {
    const pasta = mkdtempSync(join(tmpdir(), 'ponte-modelo-'));
    const args = [
      '-p',
      '--model', MODELO,
      '--output-format', 'text',
      '--tools', '',
      '--disallowedTools', ...PROIBIDAS,
      '--strict-mcp-config',
      '--setting-sources', '',
      '--no-session-persistence',
    ];
    if (system && String(system).trim()) {
      const arquivo = join(pasta, 'sistema.txt');
      writeFileSync(arquivo, String(system), 'utf8');
      args.push('--system-prompt-file', arquivo);
    }
    let terminou = false;
    const fim = (r) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(prazo);
      try {
        rmSync(pasta, { recursive: true, force: true });
      } catch {
        /* pasta temporária fica para o sistema limpar */
      }
      resolverPergunta(r);
    };
    const filho = spawn(CLAUDE, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false, cwd: pasta, windowsHide: true });
    let saida = '';
    let erro = '';
    const prazo = setTimeout(() => {
      filho.kill('SIGTERM');
      fim({ ok: false, status: 504, erro: `o CLI não respondeu em ${PRAZO_MS} ms` });
    }, PRAZO_MS);
    filho.stdout.on('data', (c) => (saida += c));
    filho.stderr.on('data', (c) => (erro += c));
    filho.on('error', (e) => fim({ ok: false, status: 503, erro: `não consegui abrir o CLI do Claude: ${e.message}` }));
    filho.on('close', (codigo) => {
      if (codigo === 0 && saida.trim()) return fim({ ok: true, texto: saida.trim() });
      const motivo = erro.trim() || saida.trim() || `código ${codigo}`;
      const sessao = /log ?in|auth|unauthori|expired|token/i.test(motivo);
      fim({ ok: false, status: 503, erro: sessao ? `sessão do Claude Code inválida ou expirada: ${motivo.slice(0, 300)}` : motivo.slice(0, 500) });
    });
    filho.stdin.end(String(user ?? ''));
  });
}

const servidor = createServer(async (req, res) => {
  const responder = (status, corpo) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(corpo));
  };
  try {
    if (!HOSTS.has(String(req.headers.host ?? '').toLowerCase())) return responder(421, { erro: 'host não atendido' });
    if (req.method === 'GET' && req.url === '/saude') {
      return responder(200, { ok: true, modelo: MODELO, ultimaChamadaEm, falhasSeguidas, emCurso });
    }
    if (req.method === 'POST' && req.url === '/complete') {
      if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) return responder(415, { erro: 'só application/json' });
      if (!tokenConfere(req.headers['x-ponte-token'])) return responder(401, { erro: 'token ausente ou errado' });
      if (emCurso >= MAX_EM_CURSO) return responder(429, { erro: `já há ${emCurso} chamadas em curso` });
      const bruto = await lerCorpo(req);
      let pedido;
      try {
        pedido = JSON.parse(bruto || '{}');
      } catch {
        return responder(400, { erro: 'JSON inválido' });
      }
      if (!pedido || typeof pedido.user !== 'string' || !pedido.user.trim()) {
        return responder(400, { erro: 'faltou `user`' });
      }
      emCurso += 1;
      const inicio = Date.now();
      let r;
      try {
        r = await perguntar(pedido);
      } finally {
        emCurso -= 1;
      }
      ultimaChamadaEm = new Date().toISOString();
      if (!r.ok) {
        falhasSeguidas += 1;
        console.error(`[ponte] falha: ${r.erro}`);
        return responder(r.status, { erro: r.erro });
      }
      falhasSeguidas = 0;
      console.log(`[ponte] ok em ${Date.now() - inicio} ms (${r.texto.length} caracteres)`);
      return responder(200, { texto: r.texto, modelo: MODELO, custoUsd: 0, custoDesconhecido: true, ms: Date.now() - inicio });
    }
    responder(404, { erro: 'rota desconhecida' });
  } catch (e) {
    responder(500, { erro: e.message });
  }
});

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`[ponte] escutando em http://127.0.0.1:${PORTA} (modelo ${MODELO}, CLI ${CLAUDE}, sem ferramentas e sem MCP)`);
});
