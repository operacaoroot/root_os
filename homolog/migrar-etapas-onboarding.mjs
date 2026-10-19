#!/usr/bin/env node
/*
 * MIGRAR AS ETAPAS DA LISTA "ONBOARDING DE CLIENTE" (rodada da implantação I1, 18/10/2026).
 *
 * A lista criada na rodada do painel nasceu com as cinco fases do trilho
 * (Qualificar, Diagnóstico, Contrato e onboarding, Imersão, Operação assistida,
 * Encerrado). O mockup aprovado troca por: Fechado no comercial · Kickoff
 * marcado · Kit montado · Contexto carregado · Imersão · Operação assistida ·
 * Encerrado. A lista é da empresa depois de criada, então a troca vai pelo
 * CAMINHO NORMAL de edição, as mesmas rotas da tela, com auditoria:
 *   - renomeia as três primeiras (PATCH /trabalho/statuses/:id), o que mantém
 *     as tarefas onde estão;
 *   - cria "Contexto carregado" (POST /trabalho/listas/:id/statuses);
 *   - acerta a ordem e a cor pelo modelo.
 * Nenhuma etapa é apagada e nenhuma tarefa sai do lugar. Idempotente: rodar de
 * novo com tudo certo não muda nada.
 *
 * Uso (Git Bash): node homolog/migrar-etapas-onboarding.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.UX_API ?? 'http://127.0.0.1:4010/api';

const env = Object.fromEntries(
  readFileSync(join(RAIZ, 'homolog/.env.homolog'), 'utf8').split(/\r?\n/)
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
);

const MODELO = [
  { name: 'Fechado no comercial', type: 'open', color: '#87909e', antes: 'Qualificar' },
  { name: 'Kickoff marcado', type: 'custom', color: '#4194f6', antes: 'Diagnóstico' },
  { name: 'Kit montado', type: 'custom', color: '#a875ff', antes: 'Contrato e onboarding' },
  { name: 'Contexto carregado', type: 'custom', color: '#f08a24', antes: null },
  { name: 'Imersão', type: 'custom', color: '#f9d900', antes: 'Imersão' },
  { name: 'Operação assistida', type: 'custom', color: '#1bbc9c', antes: 'Operação assistida' },
  { name: 'Encerrado', type: 'closed', color: '#6b7280', antes: 'Encerrado' },
];

async function api(metodo, caminho, corpo, token) {
  const r = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho} → ${r.status}: ${t}`);
  return t ? JSON.parse(t) : null;
}

const chave = (s) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

const login = await api('POST', '/auth/login', { email: 'admin@marketing-os.local', password: env.ADMIN_PASSWORD });
const token = login.token ?? login.accessToken;
const estrutura = await api('GET', '/trabalho/estrutura', undefined, token);
const pastas = [...(estrutura.folders ?? []), ...(estrutura.spaces ?? []).flatMap((s) => s.folders ?? [])];
const clientes = pastas.find((p) => chave(p.name) === 'clientes');
const lista = clientes?.lists?.find((l) => chave(l.name) === 'onboarding de cliente');
if (!lista) {
  console.log('A lista "Onboarding de cliente" não existe: nada a migrar (o fechamento cria com as etapas novas).');
  process.exit(0);
}
const feitos = [];
let atuais = [...lista.statuses];
for (const [i, alvo] of MODELO.entries()) {
  let st = atuais.find((s) => chave(s.name) === chave(alvo.name)) ?? (alvo.antes ? atuais.find((s) => chave(s.name) === chave(alvo.antes)) : null);
  if (!st) {
    st = await api('POST', `/trabalho/listas/${lista.id}/statuses`, { name: alvo.name, type: alvo.type, color: alvo.color }, token);
    atuais.push(st);
    feitos.push(`criou ${alvo.name}`);
  }
  const mudanca = {};
  if (st.name !== alvo.name) mudanca.name = alvo.name;
  if (st.order !== i) mudanca.order = i;
  if (st.type !== alvo.type) mudanca.type = alvo.type;
  if ((st.color ?? '').toLowerCase() !== alvo.color) mudanca.color = alvo.color;
  if (Object.keys(mudanca).length) {
    await api('PATCH', `/trabalho/statuses/${st.id}`, mudanca, token);
    feitos.push(`${st.name}: ${Object.entries(mudanca).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
}
// Etapa que não está no modelo fica (com as tarefas dela), no fim da fila.
const extras = atuais.filter((s) => !MODELO.some((m) => chave(m.name) === chave(s.name) || (m.antes && chave(m.antes) === chave(s.name))));
for (const [j, s] of extras.entries()) {
  if (s.order !== MODELO.length + j) {
    await api('PATCH', `/trabalho/statuses/${s.id}`, { order: MODELO.length + j }, token);
    feitos.push(`${s.name} (fora do modelo, mantida): order=${MODELO.length + j}`);
  }
}
console.log(feitos.length ? `Migrado:\n- ${feitos.join('\n- ')}` : 'Já estava nas etapas do modelo: nada mudou.');
