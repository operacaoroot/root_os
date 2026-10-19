#!/usr/bin/env node
/*
 * A PROVA DA CÓPIA DOS CARTÕES DO LUCAS (19/10/2026), CONTRA A STACK `rootos-copia`.
 *
 * Roteiro: docs/comercial/RODADA-COPIA-LUCAS-20261019.md, C4. Mesmo arranjo do
 * `trabalho.mjs` e do `implantacao.mjs`: Playwright (Chromium) da pasta de
 * ferramentas da máquina (`UX_PW`, padrão `C:/Users/User/dev/pw-tools`), o web em
 * `http://127.0.0.1:3020`, a API em `http://127.0.0.1:4020/api`. O login é o da
 * homologação da cópia (`COPIA_LOGIN_EMAIL`/`COPIA_LOGIN_SENHA`), lido de
 * `homolog/.env.copia` em tempo de execução e nunca impresso. A `rootos-comercial`
 * (3010/4010) não é tocada.
 *
 * O que ela prova, cada passo com PASSA ou FALHA (um passo que falha não para os
 * outros; o código de saída é 1 se qualquer um falhar):
 *   1. o login da homologação entra pela tela e pela API;
 *   2. as contagens por pasta/lista do destino batem com `homolog/copia/contagens.json`
 *      (escrito pelo importador), e o total de tarefas é a soma dele;
 *   3. nenhuma pasta ou lista de marketing ou de teste no destino, nenhuma tarefa
 *      cuja procedência aponte para uma lista de marketing ou de teste, e toda
 *      tarefa tem o comentário de procedência "Copiado da produção em 19/10/2026";
 *   4. a Implantação (/trabalho/implantacao) mostra os cards copiados da lista
 *      Onboarding de cliente, cada um com o cliente;
 *   5. o Funil vivo (/comercial/funil) mostra os leads copiados;
 *   6. um card abre no pop-up (?tarefa=) com cliente `Partner` (não o interno), a
 *      procedência e comentários;
 *   7. Minhas tarefas (/caixa?aba=tarefas) do Rodrigo lista as dele, e só as dele;
 *   8. fotos `copia-*.png` em escuro, claro e 390 px, sem rolagem lateral no celular.
 *
 * SÓ LÊ: não cria, não move, não comenta nada no destino.
 *
 * DADO REAL: as fotos e o JSON da prova ficam em `homolog/copia/` (fora do git). O
 * console leva só contagens e PASSA/FALHA: nenhum título, nome de cliente ou texto
 * de comentário. As mensagens de falha seguem a mesma regra.
 *
 * Uso (Git Bash): node homolog/e2e/copia.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API = process.env.COPIA_API ?? 'http://127.0.0.1:4020/api';
const WEB = process.env.COPIA_WEB ?? 'http://127.0.0.1:3020';
const PW = process.env.UX_PW ?? 'C:/Users/User/dev/pw-tools';
const PASTA = join(RAIZ, 'homolog/copia');
const FOTOS = join(PASTA, 'fotos');
const CONTAGENS = join(PASTA, 'contagens.json');
mkdirSync(FOTOS, { recursive: true });

for (const alvo of [API, WEB]) {
  if (/:(3010|4010)\b/.test(alvo)) throw new Error('esta prova é da rootos-copia; a rootos-comercial (3010/4010) não é tocada');
}

const require = createRequire(join(PW, 'package.json'));
const { chromium } = require('playwright');

function lerEnv(arquivo) {
  const out = {};
  for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
const ENV = lerEnv(join(RAIZ, 'homolog/.env.copia'));
const EMAIL = ENV.COPIA_LOGIN_EMAIL;
const SENHA = ENV.COPIA_LOGIN_SENHA;

const PROCEDENCIA = 'Copiado da produção em 19/10/2026';
/** As listas e pastas do Lucas que NÃO vêm (marketing e teste), e os nomes que as denunciam. */
const ORIGENS_PROIBIDAS = ['copy', 'design & gravação', 'demandas gerais', 'rotina de stories', 'análise', 'calendário de conteúdo', 'gestão de temas', 'marketing', 'teste teste', 'demandas internas'];
const NOME_PROIBIDO = /marketing|\bteste?\b|\bcopy\b|design\s*&?\s*grava|stories|calend[aá]rio de conte|gest[aã]o de temas|demandas internas|demandas gerais/i;

const prova = { inicio: new Date().toISOString(), web: WEB, api: API, passos: [], fotos: [], semRolagemHorizontal: [], avisos: [], ok: false };
const t0 = Date.now();
const segundos = () => ((Date.now() - t0) / 1000).toFixed(1);

/** Roda um passo isolado: PASSA ou FALHA, e o próximo roda de qualquer jeito. */
async function passo(nome, fn) {
  const n = prova.passos.length + 1;
  const linha = { n, nome, resultado: 'FALHA', detalhe: '' };
  prova.passos.push(linha);
  try {
    const detalhe = await fn();
    linha.resultado = 'PASSA';
    linha.detalhe = detalhe ?? '';
  } catch (e) {
    linha.detalhe = e.message;
  }
  linha.s = Number(segundos());
  console.log(`  ${String(n).padStart(2)}. ${linha.resultado}  ${nome}${linha.detalhe ? ` · ${linha.detalhe}` : ''}`);
  return linha.resultado === 'PASSA';
}
function conferir(cond, msg) {
  if (!cond) throw new Error(msg);
}
function gravar() {
  prova.fim = new Date().toISOString();
  prova.duracaoS = Number(segundos());
  writeFileSync(join(PASTA, 'prova-copia.json'), `${JSON.stringify(prova, null, 2)}\n`);
}

async function api(metodo, caminho, corpo, token) {
  const r = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  if (!r.ok) {
    // Só o status: o corpo do erro pode ecoar dado.
    const e = new Error(`${metodo} ${caminho.split('?')[0]} → ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return json;
}

const norm = (s) => String(s ?? '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
const tid = (p, id) => p.locator(`[data-testid="${id}"]`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function contexto(navegador, sessao, tema, viewport = { width: 1440, height: 900 }) {
  const ctx = await navegador.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await ctx.addInitScript(
    ([token, user, tema]) => {
      localStorage.setItem('mktos_token', token);
      localStorage.setItem('mktos_user', JSON.stringify(user));
      localStorage.setItem('root-os:tema', tema);
    },
    [sessao.token, sessao.user, tema],
  );
  return ctx;
}
async function foto(pagina, nome) {
  const arquivo = `copia-${nome}.png`;
  await pagina.waitForTimeout(400);
  await pagina.screenshot({ path: join(FOTOS, arquivo), fullPage: false });
  prova.fotos.push(arquivo);
}

/* ---------------------------------------------------------------------------
 * O contagens.json do importador. O formato é dele; aqui se aceita o que for
 * razoável e, se nada casar, o passo FALHA dizendo as chaves que viu.
 *   - lista de objetos { pasta, lista, tarefas|total|n|quantidade|count };
 *   - mapa { "Pasta / Lista": n } (também "›", "»", ">", "|");
 *   - mapa aninhado { "Pasta": { "Lista": n } };
 * em `porLista`, `listas`, `tarefasPorLista`, `destino.listas`, `destino.porLista`,
 * `porPasta` ou `tarefas.porLista`. Totais e leads em chaves usuais.
 * ------------------------------------------------------------------------- */
const CHAVES_DE_NUMERO = ['tarefas', 'total', 'n', 'quantidade', 'count', 'importadas', 'qtd'];
function numeroDe(v) {
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') for (const k of CHAVES_DE_NUMERO) if (typeof v[k] === 'number') return v[k];
  return null;
}
function chaveDe(pasta, lista) {
  return `${norm(pasta)}|${norm(lista)}`;
}
function listasDasContagens(c) {
  const candidatos = [c.porLista, c.listas, c.tarefasPorLista, c.destino?.listas, c.destino?.porLista, c.tarefas?.porLista, c.porPasta, c.pastas];
  for (const cand of candidatos) {
    if (!cand || typeof cand !== 'object') continue;
    const mapa = new Map();
    if (Array.isArray(cand)) {
      for (const it of cand) {
        const pasta = it.pasta ?? it.folder ?? it.pastaDestino ?? null;
        const lista = it.lista ?? it.list ?? it.nome ?? it.listaDestino ?? null;
        const n = numeroDe(it);
        if (lista && n !== null) mapa.set(chaveDe(pasta, lista), (mapa.get(chaveDe(pasta, lista)) ?? 0) + n);
      }
    } else {
      for (const [k, v] of Object.entries(cand)) {
        const n = numeroDe(v);
        if (n !== null && !(v && typeof v === 'object' && !CHAVES_DE_NUMERO.some((x) => typeof v[x] === 'number') && !Array.isArray(v))) {
          const partes = k.split(/\s*(?:\/|›|»|>|\|)\s*/).filter(Boolean);
          const lista = partes.pop();
          mapa.set(chaveDe(partes.join(' / '), lista), n);
        } else if (v && typeof v === 'object') {
          for (const [lk, lv] of Object.entries(v)) {
            const ln = numeroDe(lv);
            if (ln !== null) mapa.set(chaveDe(k, lk), ln);
          }
        }
      }
    }
    if (mapa.size) return mapa;
  }
  return null;
}
function totalDasContagens(c) {
  for (const v of [c.total, c.totalTarefas, c.tarefas, c.destino?.tarefas, c.destino?.total]) {
    const n = typeof v === 'number' ? v : v && typeof v === 'object' && !Array.isArray(v) && typeof v.total === 'number' ? v.total : null;
    if (n !== null) return n;
  }
  return null;
}
function leadsDasContagens(c) {
  for (const v of [c.leads, c.funil, c.destino?.leads, c.porDestino?.lead, c.porDestino?.leads, c.porTipo?.lead]) {
    const n = numeroDe(v);
    if (n !== null) return n;
  }
  return null;
}

async function main() {
  console.log(`Prova da cópia · web ${WEB} · api ${API}`);
  conferir(EMAIL && SENHA, 'COPIA_LOGIN_EMAIL/COPIA_LOGIN_SENHA ausentes em homolog/.env.copia');
  let sessao = null;
  const navegador = await chromium.launch();
  try {
    // ---- 1. login ----
    await passo('login da homologação pela tela e pela API', async () => {
      const r = await api('POST', '/auth/login', { email: EMAIL, password: SENHA });
      sessao = { token: r.token ?? r.accessToken, user: r.user };
      conferir(sessao.token && sessao.user?.id, 'o login pela API não devolveu sessão');
      const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
      const p = await ctx.newPage();
      await p.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
      await p.locator('input[type="email"]').fill(EMAIL);
      await p.locator('input[type="password"]').fill(SENHA);
      await p.locator('button[type="submit"]').click();
      await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
      const caminho = new URL(p.url()).pathname;
      await ctx.close();
      return `a tela foi a ${caminho}`;
    });
    if (!sessao?.token) throw new Error('sem sessão, os outros passos não têm como rodar');
    const tk = sessao.token;

    // ---- o destino inteiro, uma vez ----
    const estrutura = await api('GET', '/trabalho/estrutura', undefined, tk);
    const pastaPorId = new Map(estrutura.folders.map((f) => [f.id, f]));
    const caminhoDaPasta = (f) => {
      const nomes = [];
      for (let x = f; x; x = x.parentId ? pastaPorId.get(x.parentId) : null) nomes.unshift(x.name);
      return nomes.join(' / ');
    };
    const listas = [
      ...estrutura.folders.flatMap((f) => f.lists.map((l) => ({ ...l, pasta: caminhoDaPasta(f), pastaRaiz: caminhoDaPasta(f).split(' / ')[0] }))),
      ...(estrutura.listasSoltas ?? []).map((l) => ({ ...l, pasta: '', pastaRaiz: '' })),
    ];
    const tarefas = [];
    for (let page = 1; ; page++) {
      const r = await api('GET', `/trabalho/tarefas?limit=500&page=${page}`, undefined, tk);
      tarefas.push(...r.items);
      if (tarefas.length >= r.total || r.items.length === 0) break;
    }
    const clientes = await api('GET', '/trabalho/clientes', undefined, tk);
    const partnerIds = new Set(clientes.filter((c) => !c.interno && c.id !== 'interno').map((c) => c.id));
    prova.destino = {
      pastas: estrutura.folders.length,
      listas: listas.map((l) => ({ pasta: l.pasta, lista: l.name, tarefas: l.total })),
      tarefas: tarefas.length,
      clientesPartner: partnerIds.size,
    };
    console.log(`      destino: ${estrutura.folders.length} pastas · ${listas.length} listas · ${tarefas.length} tarefas · ${partnerIds.size} clientes Partner`);

    // ---- 2. contagens ----
    await passo('contagens por pasta/lista batem com homolog/copia/contagens.json; o total é a soma', async () => {
      conferir(existsSync(CONTAGENS), 'homolog/copia/contagens.json não existe (o importador ainda não gravou)');
      const c = JSON.parse(readFileSync(CONTAGENS, 'utf8'));
      const esperado = listasDasContagens(c);
      conferir(esperado, `formato do contagens.json não reconhecido (chaves: ${Object.keys(c).join(', ')})`);
      const real = new Map();
      for (const l of listas) {
        real.set(chaveDe(l.pasta, l.name), l.total);
        // a contagem pode vir só com a pasta de cima
        if (l.pasta !== l.pastaRaiz) real.set(chaveDe(l.pastaRaiz, l.name), (real.get(chaveDe(l.pastaRaiz, l.name)) ?? 0) + l.total);
      }
      const divergencias = [];
      const porNomeDaLista = (lista) => listas.filter((l) => norm(l.name) === lista);
      for (const [chave, n] of esperado) {
        const [pasta, lista] = chave.split('|');
        let obtido = real.get(chave);
        if (obtido === undefined && !pasta) {
          const so = porNomeDaLista(lista);
          if (so.length === 1) obtido = so[0].total;
        }
        if (obtido !== n) divergencias.push(`${pasta || '(solta)'} / ${lista}: esperado ${n}, destino ${obtido ?? 'lista ausente'}`);
      }
      // lista com tarefa no destino que o contagens não conhece
      for (const l of listas) {
        if (l.total === 0) continue;
        const conhecida = esperado.has(chaveDe(l.pasta, l.name)) || esperado.has(chaveDe(l.pastaRaiz, l.name)) || esperado.has(chaveDe('', l.name));
        if (!conhecida) divergencias.push(`${l.pasta || '(solta)'} / ${l.name}: ${l.total} tarefas no destino, fora do contagens.json`);
      }
      const soma = [...esperado.values()].reduce((a, b) => a + b, 0);
      const total = totalDasContagens(c);
      if (total !== null && total !== soma) divergencias.push(`o total do contagens.json (${total}) não é a soma das listas (${soma})`);
      if (tarefas.length !== soma) divergencias.push(`tarefas no destino ${tarefas.length} ≠ soma do contagens.json ${soma}`);
      prova.contagens = { listasNoArquivo: esperado.size, soma, total, destino: tarefas.length };
      conferir(divergencias.length === 0, divergencias.join(' · '));
      return `${esperado.size} listas · soma ${soma} = destino ${tarefas.length}${total !== null ? ` = total ${total}` : ''}`;
    });

    // ---- 3. nada de marketing nem de teste; procedência em toda tarefa ----
    const detalhes = new Map();
    await passo('nenhuma pasta/lista/tarefa de marketing ou de teste; toda tarefa com a procedência', async () => {
      const nomesRuins = [
        ...estrutura.folders.filter((f) => NOME_PROIBIDO.test(f.name)).map((f) => `pasta ${f.name}`),
        ...listas.filter((l) => NOME_PROIBIDO.test(l.name)).map((l) => `lista ${l.name}`),
      ];
      let semProcedencia = 0;
      let origemProibida = 0;
      const origens = new Map();
      for (const t of tarefas) {
        const d = await api('GET', `/trabalho/tarefas/${t.id}`, undefined, tk);
        detalhes.set(t.id, d);
        const proc = (d.comentarios ?? []).find((x) => String(x.text ?? '').includes(PROCEDENCIA));
        if (!proc) { semProcedencia++; continue; }
        const origem = /lista de origem:\s*([^\n·]+)/i.exec(proc.text)?.[1]?.trim() ?? '(sem lista de origem)';
        origens.set(origem, (origens.get(origem) ?? 0) + 1);
        if (ORIGENS_PROIBIDAS.includes(norm(origem)) || NOME_PROIBIDO.test(origem)) origemProibida++;
      }
      const tituloDeTeste = tarefas.filter((t) => /^\s*teste?\b|\bteste teste\b/i.test(t.title)).length;
      if (tituloDeTeste) prova.avisos.push(`${tituloDeTeste} tarefa(s) com título que começa com "teste": conferir no mapa se são de verdade.`);
      prova.origens = Object.fromEntries(origens);
      const problemas = [];
      if (nomesRuins.length) problemas.push(`${nomesRuins.length} pasta(s)/lista(s) com nome de marketing ou teste: ${nomesRuins.join(', ')}`);
      if (origemProibida) problemas.push(`${origemProibida} tarefa(s) vindas de lista de marketing ou teste`);
      if (semProcedencia) problemas.push(`${semProcedencia} tarefa(s) sem o comentário de procedência`);
      conferir(problemas.length === 0, problemas.join(' · '));
      return `${tarefas.length} tarefas com procedência · ${origens.size} listas de origem · 0 de marketing/teste`;
    });

    const clientesL = listas.find((l) => l.pastaRaiz === 'Clientes' && l.name === 'Onboarding de cliente');
    const execucao = listas.find((l) => l.pastaRaiz === 'Clientes' && l.name === 'Execução');

    // ---- 4. Implantação ----
    await passo('a Implantação mostra os cards copiados (Onboarding de cliente), cada um com o cliente', async () => {
      conferir(clientesL, 'a lista Clientes / Onboarding de cliente não existe no destino');
      const daLista = tarefas.filter((t) => t.listId === clientesL.id);
      const ctx = await contexto(navegador, sessao, 'dark');
      const p = await ctx.newPage();
      await p.goto(`${WEB}/trabalho/implantacao`, { waitUntil: 'networkidle' });
      await p.locator('#root-os-main').getByRole('heading', { name: 'Implantação de clientes' }).waitFor({ timeout: 30_000 });
      await p.locator('[data-coluna]').first().waitFor({ timeout: 30_000 });
      await p.waitForTimeout(800);
      const ids = new Set(await p.locator('[data-work-task-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-work-task-id'))));
      const faltando = daLista.filter((t) => !ids.has(t.id)).length;
      const sobrando = [...ids].filter((id) => !daLista.some((t) => t.id === id)).length;
      let semCliente = 0;
      for (const t of daLista) {
        if (!ids.has(t.id)) continue;
        const txt = (await tid(p, `trabalho-cliente-${t.id}`).count()) ? (await tid(p, `trabalho-cliente-${t.id}`).innerText()).trim() : '';
        if (!txt || !t.clienteId) semCliente++;
      }
      const daPartner = daLista.filter((t) => partnerIds.has(t.clienteId)).length;
      await foto(p, 'implantacao-escuro');
      await ctx.close();
      prova.implantacao = { naLista: daLista.length, naTela: ids.size, daPartner, semCliente };
      if (daLista.length === 0) {
        prova.avisos.push('A lista Onboarding de cliente está vazia no destino: a Implantação passou sem card para conferir (os contratos foram para a Execução?).');
      }
      conferir(faltando === 0 && sobrando === 0, `${daLista.length} na lista, ${ids.size} na tela (${faltando} faltando, ${sobrando} sobrando)`);
      conferir(semCliente === 0, `${semCliente} card(s) sem cliente na tela`);
      return `${ids.size} cards na tela = ${daLista.length} na lista · ${daPartner} de cliente Partner`;
    });

    // ---- 5. Funil vivo ----
    await passo('o Funil vivo mostra os leads copiados', async () => {
      const funil = await api('GET', '/comercial/funil', undefined, tk);
      const idsApi = new Set(funil.colunas.flatMap((c) => c.cartoes.map((x) => x.leadId)));
      const ctx = await contexto(navegador, sessao, 'dark');
      const p = await ctx.newPage();
      await p.goto(`${WEB}/comercial/funil`, { waitUntil: 'networkidle' });
      await p.locator('[data-testid^="funil-coluna-"]').first().waitFor({ timeout: 30_000 });
      await p.waitForTimeout(800);
      const idsTela = new Set(
        (await p.locator('[data-testid^="funil-card-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))))
          .map((x) => x.replace(/^funil-card-/, '')).filter((x) => /^[0-9a-f-]{36}$/.test(x)),
      );
      await foto(p, 'funil-escuro');
      await ctx.close();
      const porEtapa = Object.fromEntries(funil.colunas.map((c) => [c.etapa, c.cartoes.length]));
      prova.funil = { total: funil.total, naApi: idsApi.size, naTela: idsTela.size, porEtapa };
      const faltando = [...idsApi].filter((id) => !idsTela.has(id)).length;
      conferir(faltando === 0 && idsTela.size === idsApi.size, `${idsApi.size} leads na API, ${idsTela.size} na tela (${faltando} faltando)`);
      let esperado = null;
      if (existsSync(CONTAGENS)) esperado = leadsDasContagens(JSON.parse(readFileSync(CONTAGENS, 'utf8')));
      if (esperado !== null) conferir(idsApi.size === esperado, `o contagens.json diz ${esperado} leads; o funil tem ${idsApi.size}`);
      else prova.avisos.push('O contagens.json não traz o número de leads: o funil foi conferido só contra a API.');
      conferir(idsApi.size > 0, 'o funil está vazio: nenhum lead copiado');
      return `${idsTela.size} leads na tela = ${idsApi.size} na API${esperado !== null ? ` = ${esperado} no contagens.json` : ''} · ${Object.entries(porEtapa).filter(([, n]) => n).map(([e, n]) => `${e} ${n}`).join(', ')}`;
    });

    // ---- 6. o pop-up ----
    let cardDoPopup = null;
    await passo('um card abre no pop-up (?tarefa=) com cliente Partner, a procedência e comentários', async () => {
      const comPartner = [...detalhes.values()].filter((d) => partnerIds.has(d.clienteId) && (d.comentarios ?? []).some((x) => String(x.text ?? '').includes(PROCEDENCIA)));
      conferir(comPartner.length > 0, 'nenhuma tarefa copiada com cliente Partner e procedência');
      const naImplantacao = (d) => clientesL && d.listId === clientesL.id;
      const ordenadas = [...comPartner].sort((a, b) => (naImplantacao(b) - naImplantacao(a)) || ((b.comentarios?.length ?? 0) - (a.comentarios?.length ?? 0)));
      const d = ordenadas[0];
      cardDoPopup = d;
      const rota = naImplantacao(d) ? '/trabalho/implantacao' : '/trabalho';
      const url = naImplantacao(d) ? `${WEB}/trabalho/implantacao?tarefa=${d.id}` : `${WEB}/trabalho?lista=${d.listId}&tarefa=${d.id}`;
      const ctx = await contexto(navegador, sessao, 'dark');
      const p = await ctx.newPage();
      await p.goto(url, { waitUntil: 'networkidle' });
      const pop = tid(p, 'tarefa-popup');
      await pop.waitFor({ timeout: 30_000 });
      conferir(new URL(p.url()).pathname === rota, `o pop-up saiu de ${rota}`);
      conferir(new URL(p.url()).searchParams.get('tarefa') === d.id, 'o endereço perdeu o ?tarefa=');
      const texto = await pop.innerText();
      conferir(texto.includes(PROCEDENCIA), 'o pop-up não mostra o comentário de procedência');
      conferir(d.clienteNome && texto.includes(d.clienteNome), 'o pop-up não mostra o nome do cliente Partner');
      const n = Number(/Comentários \((\d+)\)/i.exec(texto)?.[1] ?? NaN);
      conferir(n === d.comentarios.length && n >= 1, `o pop-up conta ${n} comentário(s); a API, ${d.comentarios.length}`);
      await foto(p, 'popup-escuro');
      await ctx.close();
      if (n < 2) prova.avisos.push('O card do pop-up só tem o comentário de procedência: nenhuma tarefa com cliente Partner trouxe comentário da produção.');
      return `${naImplantacao(d) ? 'Implantação' : 'Trabalho'} · cliente Partner · ${n} comentário(s), 1 de procedência`;
    });

    // ---- 7. Minhas tarefas do Rodrigo ----
    await passo('Minhas tarefas do Rodrigo lista as dele, e só as dele', async () => {
      const abertas = await api('GET', '/caixa/tarefas', undefined, tk);
      const todas = await api('GET', '/caixa/tarefas?encerradas=sim', undefined, tk);
      conferir(abertas.estado === 'ok', `a caixa respondeu estado ${abertas.estado}`);
      const ids = new Set((abertas.identidades ?? []).map(norm));
      const dele = tarefas.filter((t) => t.assignee && ids.has(norm(t.assignee)));
      const deleAbertas = dele.filter((t) => t.statusType !== 'closed' && t.statusType !== 'done');
      const idsTodas = new Set(todas.itens.map((x) => x.id));
      const idsAbertas = new Set(abertas.itens.map((x) => x.id));
      const deOutro = todas.itens.filter((x) => !x.responsavel || !ids.has(norm(x.responsavel))).length;
      conferir(deOutro === 0, `${deOutro} tarefa(s) de outra pessoa em Minhas tarefas`);
      if (!todas.truncado) conferir(dele.every((t) => idsTodas.has(t.id)) && idsTodas.size === dele.length, `${dele.length} tarefas são dele; Minhas tarefas (com encerradas) traz ${idsTodas.size}`);
      if (!abertas.truncado) conferir(deleAbertas.every((t) => idsAbertas.has(t.id)), `${deleAbertas.length} abertas são dele; Minhas tarefas traz ${idsAbertas.size}`);
      conferir(dele.length > 0, 'nenhuma tarefa copiada tem o Rodrigo como responsável');
      const ctx = await contexto(navegador, sessao, 'dark');
      const p = await ctx.newPage();
      await p.goto(`${WEB}/caixa?aba=tarefas`, { waitUntil: 'networkidle' });
      await tid(p, 'caixa-vista').waitFor({ timeout: 30_000 });
      await p.waitForTimeout(800);
      const naTela = new Set(
        (await p.locator('[data-testid^="caixa-tarefa-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))))
          .map((x) => x.replace(/^caixa-tarefa-(cartao-)?/, '')).filter((x) => UUID.test(x)),
      );
      await foto(p, 'minhas-tarefas-escuro');
      await ctx.close();
      prova.minhasTarefas = { dele: dele.length, abertas: idsAbertas.size, comEncerradas: idsTodas.size, naTela: naTela.size, truncado: abertas.truncado };
      conferir([...idsAbertas].every((id) => naTela.has(id)) && naTela.size === idsAbertas.size, `a API traz ${idsAbertas.size} abertas; a tela mostra ${naTela.size}`);
      return `${dele.length} dele no destino · ${idsAbertas.size} abertas na tela = API · ${idsTodas.size} com as encerradas · 0 de outra pessoa`;
    });

    // ---- 8. fotos em claro e 390 ----
    await passo('fotos em escuro, claro e 390 px; nenhuma página rola na horizontal no celular', async () => {
      const telas = [
        { nome: 'implantacao', url: '/trabalho/implantacao', pronto: '[data-coluna]' },
        { nome: 'funil', url: '/comercial/funil', pronto: '[data-testid^="funil-coluna-"]' },
        { nome: 'minhas-tarefas', url: '/caixa?aba=tarefas', pronto: '[data-testid="caixa-vista"]' },
        ...(execucao ? [{ nome: 'execucao', url: `/trabalho?lista=${execucao.id}`, pronto: '[data-coluna]' }] : []),
        ...(cardDoPopup
          ? [{ nome: 'popup', url: clientesL && cardDoPopup.listId === clientesL.id ? `/trabalho/implantacao?tarefa=${cardDoPopup.id}` : `/trabalho?lista=${cardDoPopup.listId}&tarefa=${cardDoPopup.id}`, pronto: '[data-testid="tarefa-popup"]' }]
          : []),
      ];
      const rolam = [];
      for (const [tema, viewport, sufixo] of [['dark', { width: 1440, height: 900 }, 'escuro'], ['light', { width: 1440, height: 900 }, 'claro'], ['dark', { width: 390, height: 844 }, '390']]) {
        const c = await contexto(navegador, sessao, tema, viewport);
        const pg = await c.newPage();
        for (const t of telas) {
          if (sufixo === 'escuro' && prova.fotos.includes(`copia-${t.nome}-escuro.png`)) continue;
          await pg.goto(`${WEB}${t.url}`, { waitUntil: 'networkidle' });
          await pg.locator(t.pronto).first().waitFor({ timeout: 30_000 });
          if (sufixo === '390') {
            const rola = await pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
            prova.semRolagemHorizontal.push({ tela: t.nome, rola });
            if (rola) rolam.push(t.nome);
          }
          await foto(pg, `${t.nome}-${sufixo}`);
        }
        await c.close();
      }
      conferir(rolam.length === 0, `rola na horizontal a 390 px: ${rolam.join(', ')}`);
      return `${prova.fotos.length} fotos em homolog/copia/fotos/`;
    });
  } finally {
    await navegador.close();
  }
  prova.ok = prova.passos.every((p) => p.resultado === 'PASSA');
}

main()
  .catch((e) => {
    prova.erro = e.message;
    console.error(`\nFALHA fora dos passos: ${e.message}`);
  })
  .finally(() => {
    gravar();
    const passaram = prova.passos.filter((p) => p.resultado === 'PASSA').length;
    console.log(`\n${prova.ok ? 'PASSA' : 'FALHA'} · ${passaram}/${prova.passos.length} passos · ${prova.fotos.length} fotos · ${segundos()} s`);
    if (prova.avisos.length) console.log(`Avisos:\n  ${prova.avisos.join('\n  ')}`);
    process.exit(prova.ok ? 0 : 1);
  });
