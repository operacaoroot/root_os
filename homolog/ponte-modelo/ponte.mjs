#!/usr/bin/env node
/*
 * A PONTE DE MODELO — sidecar no HOST do Predator (homologação do cockpit).
 *
 * Existe para a demonstração rodar sem chave da Anthropic válida no
 * `.env.homolog`: o container da API aponta `PONTE_MODELO_URL` para
 * http://host.docker.internal:4099 e o provider `ponte` (apps/api/src/llm)
 * faz `POST /complete {system, user, maxTokens}`. Aqui a pergunta vira uma
 * chamada a `claude -p --model <modelo> --output-format text`, sem ferramentas,
 * e a resposta volta como texto.
 *
 * O que ela NÃO é: um provedor de produção. Ela gasta a assinatura de quem está
 * logado no Claude Code desta máquina, não mede custo (o OS grava custo 0 com
 * `custoDesconhecido: true`) e só escuta em loopback. Sessão do Claude Code
 * expirada = 503, e o OS cai no `stub` avisando na tela.
 *
 * Subir:  node homolog/ponte-modelo/ponte.mjs           (porta 4099)
 * Testar: curl -s -X POST localhost:4099/complete -H 'content-type: application/json' \
 *           -d '{"system":"Responda em uma palavra.","user":"Que cor é o céu?"}'
 * Saúde:  GET /saude  → { ok, modelo, ultimaChamadaEm, falhasSeguidas }
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const PORTA = Number(process.env.PONTE_PORTA ?? 4099);
const MODELO = process.env.PONTE_MODELO ?? 'claude-fable-5-1';
const PRAZO_MS = Number(process.env.PONTE_PRAZO_MS ?? 180_000);
const MAX_CORPO = 2_000_000;
const CLAUDE = process.env.PONTE_CLAUDE_BIN ?? (process.platform === 'win32' ? 'claude.exe' : 'claude');

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

/** Chama o CLI com o prompt pela ENTRADA PADRÃO: nada do pedido vai para a linha de comando. */
function perguntar({ system, user }) {
  return new Promise((resolve) => {
    const args = ['-p', '--model', MODELO, '--output-format', 'text'];
    if (system && String(system).trim()) args.push('--system-prompt', String(system));
    const filho = spawn(CLAUDE, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let saida = '';
    let erro = '';
    const prazo = setTimeout(() => {
      filho.kill('SIGTERM');
      resolve({ ok: false, status: 504, erro: `o CLI não respondeu em ${PRAZO_MS} ms` });
    }, PRAZO_MS);
    filho.stdout.on('data', (c) => (saida += c));
    filho.stderr.on('data', (c) => (erro += c));
    filho.on('error', (e) => {
      clearTimeout(prazo);
      resolve({ ok: false, status: 503, erro: `não consegui abrir o CLI do Claude: ${e.message}` });
    });
    filho.on('close', (codigo) => {
      clearTimeout(prazo);
      if (codigo === 0 && saida.trim()) return resolve({ ok: true, texto: saida.trim() });
      const motivo = erro.trim() || saida.trim() || `código ${codigo}`;
      const sessao = /log ?in|auth|unauthori|expired|token/i.test(motivo);
      resolve({ ok: false, status: 503, erro: sessao ? `sessão do Claude Code inválida ou expirada: ${motivo.slice(0, 300)}` : motivo.slice(0, 500) });
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
    if (req.method === 'GET' && req.url === '/saude') {
      return responder(200, { ok: true, modelo: MODELO, ultimaChamadaEm, falhasSeguidas, emCurso });
    }
    if (req.method === 'POST' && req.url === '/complete') {
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
      const r = await perguntar(pedido);
      emCurso -= 1;
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
  console.log(`[ponte] escutando em http://127.0.0.1:${PORTA} (modelo ${MODELO}, CLI ${CLAUDE})`);
});
