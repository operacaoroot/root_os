#!/usr/bin/env node
/*
 * A PROVA DA LANE T7 DA RODADA DO TRABALHO (19/10/2026): decidir sem trocar de tela.
 *
 * Mesmo arranjo do `implantacao.mjs`: Playwright (Chromium) da pasta de
 * ferramentas da máquina (`UX_PW`, padrão `C:/Users/User/dev/pw-tools`), o web em
 * `http://127.0.0.1:3010`, a API em `http://127.0.0.1:4010/api`, a senha lida de
 * `homolog/.env.homolog` em tempo de execução.
 *
 * O que ela prova (docs/comercial/RODADA-TRABALHO-20261019.md, T7 e T9):
 *   1. R3 NA LINHA · um pedido R3 da fila (o mover do funil deixou de passar por
 *      aprovação em 20/10/2026); o sócio, em /atendimento, aprova com UM clique
 *      na própria linha (o item não abre);
 *   2. R4 COM SENHA NO MESMO LUGAR · um pedido R4 que o sócio (titular) pode
 *      assinar: o clique na linha abre a caixa de motivo e senha ali mesmo (ou,
 *      no conteúdo longo, o item abre no lugar com o foco no campo), e Aprovar
 *      vai junto com a senha. Nada de um clique só;
 *   3. VENCIDA COM "PEDIR DE NOVO" · a vencida não tem Aprovar; "Pedir de novo"
 *      recria o pedido com o conteúdo de agora; quem clicou vira o proponente
 *      (a fila dele diz "Você pediu") e a outra pessoa pode assinar.
 *
 * De onde vem cada pedido:
 *   · R3: um lead do funil numa etapa que aceita avançar (o roteiro tenta até
 *     achar um). Escreve: move esse lead UMA etapa adiante.
 *   · R4: `T7_R4_ID` (uma aprovação R4 pendente), ou a primeira R4 pendente que
 *     o sócio pode assinar, ou a sala de `T7_LEAD` (um lead fechado, como o da
 *     jornada) publicada de novo pelo admin. A sala sai R4 só FORA da janela de
 *     08h–20h de São Paulo (sinal `fora_da_janela`); dentro dela sai R3, e o
 *     roteiro prova o um clique da sala no lugar e avisa que o R4 ficou sem prova.
 *   · Vencida: `T7_VENCIDA_ID`, ou uma vencida da fila com "pedir de novo"
 *     liberado (a homologação acumula vencidas), ou, com `T7_ESPERAR_VENCIDA=1`,
 *     um pedido de mover novo esperado até vencer (10 min).
 *
 * As funções `provarR3NaLinha`, `provarR4ComSenha` e `provarPedirDeNovo` são
 * exportadas para o `trabalho.mjs` (T9) reaproveitar com a página dele.
 *
 * Saída: `homolog/provas/trabalho-t7.json` e `homolog/provas/trabalho-t7-*.png`.
 * Uso (Git Bash): node homolog/e2e/trabalho-t7.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API = process.env.UX_API ?? 'http://127.0.0.1:4010/api';
const WEB = process.env.UX_WEB ?? 'http://127.0.0.1:3010';
const PW = process.env.UX_PW ?? 'C:/Users/User/dev/pw-tools';
const PROVAS = join(RAIZ, 'homolog/provas');


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

function conferir(cond, msg) {
  if (!cond) throw new Error(msg);
}

export async function api(metodo, caminho, corpo, token, extra = {}) {
  const r = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  if (!r.ok) throw new Error(`${metodo} ${caminho} → ${r.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
}

const tid = (p, id) => p.locator(`[data-testid="${id}"]`);

/** Abre /atendimento e espera a fila desenhar. */
async function abrirFila(pagina) {
  await pagina.goto(`${WEB}/atendimento`, { waitUntil: 'networkidle' });
  await tid(pagina, 'aprov-grupo-voce').waitFor({ timeout: 30_000 });
}

/** O aviso verde (role=status) ou a caixa vermelha, o que vier primeiro. */
async function desfecho(pagina) {
  const ok = tid(pagina, 'aprov-aviso');
  const erro = tid(pagina, 'aprov-erro');
  await Promise.race([ok.waitFor({ timeout: 20_000 }), erro.waitFor({ timeout: 20_000 })]);
  if (await ok.count()) return { ok: true, texto: (await ok.textContent())?.trim() ?? '' };
  return { ok: false, texto: (await erro.textContent())?.trim() ?? '' };
}

/**
 * 1 · R3 NA LINHA. `pagina` está logada como quem ASSINA (não quem pediu).
 * Prova: o botão da linha diz "Aprovar", um clique confirma, o item não abre.
 */
export async function provarR3NaLinha(pagina, approvalId) {
  await abrirFila(pagina);
  const botao = tid(pagina, `aprov-acao-${approvalId}`);
  await botao.waitFor({ timeout: 15_000 });
  const rotulo = (await botao.textContent())?.trim();
  conferir(rotulo === 'Aprovar', `o botão da linha devia dizer "Aprovar" (diz "${rotulo}")`);
  conferir((await tid(pagina, `item-${approvalId}`).count()) === 0, 'o item não devia estar aberto antes do clique');
  await pagina.waitForFunction((id) => !document.querySelector(`[data-testid="aprov-acao-${id}"]`)?.hasAttribute('disabled'), approvalId, { timeout: 15_000 });
  await botao.click();
  const d = await desfecho(pagina);
  conferir(d.ok, `aprovar na linha falhou: ${d.texto}`);
  conferir((await tid(pagina, `item-${approvalId}`).count()) === 0, 'aprovar na linha abriu o item: devia ser um clique só');
  return { rotulo, aviso: d.texto };
}

/**
 * 2 · R4 COM SENHA NO MESMO LUGAR. `pagina` logada como a titular.
 * Prova: o clique NÃO confirma sozinho; a caixa (ou o item, no conteúdo longo)
 * abre ali; com motivo e senha, Aprovar executa.
 */
export async function provarR4ComSenha(pagina, approvalId, { senha, motivo }) {
  await abrirFila(pagina);
  const botao = tid(pagina, `aprov-acao-${approvalId}`);
  await botao.waitFor({ timeout: 15_000 });
  await pagina.waitForFunction((id) => !document.querySelector(`[data-testid="aprov-acao-${id}"]`)?.hasAttribute('disabled'), approvalId, { timeout: 15_000 });
  const rotulo = (await botao.textContent())?.trim();
  const urlAntes = pagina.url();
  await botao.click();
  conferir(pagina.url() === urlAntes, 'o clique trocou de tela');
  const caixa = tid(pagina, `aprov-caixa-${approvalId}`);
  const item = tid(pagina, `item-${approvalId}`);
  await Promise.race([caixa.waitFor({ timeout: 15_000 }), item.waitFor({ timeout: 15_000 })]);
  conferir((await tid(pagina, 'aprov-aviso').count()) === 0, 'o primeiro clique já aprovou: em R4 não existe um clique só');
  let forma;
  if (await caixa.count()) {
    forma = 'caixa-na-linha';
    const enviar = tid(pagina, `aprov-enviar-${approvalId}`);
    conferir(await enviar.isDisabled(), 'Aprovar devia nascer desligado, sem motivo e senha');
    if (await tid(pagina, `aprov-motivo-${approvalId}`).count()) await tid(pagina, `aprov-motivo-${approvalId}`).fill(motivo);
    await tid(pagina, `aprov-senha-${approvalId}`).fill(senha);
    await enviar.click();
  } else {
    forma = 'ler-e-aprovar';
    const campo = item.locator('textarea').first();
    await campo.waitFor({ timeout: 20_000 });
    await campo.fill(motivo);
    await item.locator('input[type="password"]').first().fill(senha);
    await item.getByRole('button', { name: /^(Assinar como titular|Confirmar)$/ }).click();
  }
  const d = await desfecho(pagina);
  conferir(d.ok, `aprovar com senha falhou: ${d.texto}`);
  return { rotulo, forma, aviso: d.texto };
}

/**
 * 3 · VENCIDA COM "PEDIR DE NOVO". `pagina` logada como quem pede de novo.
 * Prova: a vencida não tem Aprovar; o botão diz que quem clica vira quem pede;
 * o clique recria o pedido. Devolve o aviso; quem chama confere o pedido novo.
 */
export async function provarPedirDeNovo(pagina, approvalId) {
  await abrirFila(pagina);
  const alternar = tid(pagina, 'aprov-historico-alternar');
  if ((await alternar.getAttribute('aria-expanded')) !== 'true') await alternar.click();
  const botao = tid(pagina, `aprov-pedir-de-novo-${approvalId}`);
  await botao.waitFor({ timeout: 15_000 });
  conferir((await tid(pagina, `aprov-acao-${approvalId}`).count()) === 0, 'a vencida não pode ter botão de aprovar');
  const titulo = await botao.getAttribute('title');
  conferir(/Você vira quem pede/.test(titulo ?? '') && /não poderá assinar/.test(titulo ?? ''), 'o botão não diz que quem clica vira o proponente');
  await botao.click();
  const d = await desfecho(pagina);
  return d;
}

/* ------------------------------------------------------------------ main */

async function main() {
  mkdirSync(PROVAS, { recursive: true });
  const require = createRequire(join(PW, 'package.json'));
  const { chromium } = require('playwright');
  const SENHA = lerEnv(process.env.HOMOLOG_ENV ?? join(RAIZ, 'homolog/.env.homolog')).ADMIN_PASSWORD;
  conferir(SENHA, 'ADMIN_PASSWORD ausente em homolog/.env.homolog');

  const prova = { inicio: new Date().toISOString(), web: WEB, passos: [], screenshots: [], avisos: [], ok: false };
  const t0 = Date.now();
  const passo = (nome, dados = {}) => {
    const linha = { n: prova.passos.length + 1, nome, ms: Date.now() - t0, ...dados };
    prova.passos.push(linha);
    console.log(`  ${String(linha.n).padStart(2)}. ${nome}${dados.detalhe ? ` · ${dados.detalhe}` : ''}`);
  };
  const gravar = () => {
    prova.fim = new Date().toISOString();
    prova.duracaoMs = Date.now() - t0;
    writeFileSync(join(PROVAS, `${process.env.PROVAS_PREFIXO ?? ''}trabalho-t7.json`), `${JSON.stringify(prova, null, 2).replace(/"token":\s*"[^"]{6}[^"]*"/g, '"token": "…"')}\n`);
  };
  const entrar = async (email) => {
    const r = await api('POST', '/auth/login', { email, password: SENHA });
    return { token: r.token ?? r.accessToken, user: r.user };
  };
  const contexto = async (navegador, sessao, tema = 'dark', viewport = { width: 1440, height: 900 }) => {
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
  };
  const foto = async (pagina, nome) => {
    const arquivo = `${process.env.PROVAS_PREFIXO ?? ''}trabalho-t7-${nome}.png`;
    await pagina.waitForTimeout(300);
    await pagina.screenshot({ path: join(PROVAS, arquivo), fullPage: false });
    prova.screenshots.push(arquivo);
  };
  const filaDe = (s) => api('GET', '/approvals/fila', undefined, s.token);

  const pessoas = { mesa: await entrar('mesa@root.homolog'), socio: await entrar('socio@root.homolog'), admin: await entrar('admin@marketing-os.local') };
  passo('mesa, sócio e admin entraram pela API');

  const navegador = await chromium.launch();
  try {
    const ctxSocio = await contexto(navegador, pessoas.socio);
    const ps = await ctxSocio.newPage();
    const ctxMesa = await contexto(navegador, pessoas.mesa);
    const pm = await ctxMesa.newPage();

    // ---- 1. R3 na linha ----
    // Desde a rodada da interface (20/10/2026) o mover do funil não passa mais por aprovação
    // (mover livre para gente). O R3 vem da fila: `T7_R3_ID`, ou o primeiro R3 pendente que o
    // sócio pode assinar; sem nenhum, a sala de `T7_LEAD` publicada de novo (R3 dentro da janela).
    let r3Id = process.env.T7_R3_ID ?? null;
    if (!r3Id) {
      const f = await filaDe(pessoas.socio);
      r3Id = f.itens.find((i) => i.gaveta === 'esperando' && i.nivel === 'R3' && i.euPossoAprovar && i.linha?.pode !== false)?.id ?? null;
    }
    if (r3Id) {
      passo('um pedido R3 da fila, que o sócio pode assinar', { approvalId: r3Id });
      const r3 = await provarR3NaLinha(ps, r3Id);
      await foto(ps, 'r3-aprovada-na-linha');
      passo('R3 na linha: o sócio aprovou com UM clique, sem abrir o item', { detalhe: r3.aviso });
    } else {
      prova.avisos.push('R3 na linha sem pedido próprio nesta execução: o mover do funil deixou de passar por aprovação (20/10/2026). Passe T7_R3_ID, ou T7_LEAD para a sala dentro da janela.');
    }
    // ---- 2. R4 com senha no mesmo lugar ----
    let r4Id = process.env.T7_R4_ID ?? null;
    if (!r4Id) {
      const f = await filaDe(pessoas.socio);
      r4Id = f.itens.find((i) => i.gaveta === 'esperando' && i.nivel === 'R4' && i.euPossoAprovar)?.id ?? null;
    }
    if (!r4Id && process.env.T7_LEAD) {
      const lead = process.env.T7_LEAD;
      const passos1 = [{ oque: 'conferir a prova da T7', quando: '2026-10-22', comQuem: 'Marina Duarte' }];
      await api('PUT', `/comercial/lead/${lead}/sala/rascunho`, { proximosPassos: passos1, combinado: [`Prova T7 ${new Date().toISOString().slice(11, 19)}`], quemCuida: { nome: 'Admin Root', papel: 'cuida da sua conta na Root' } }, pessoas.admin.token);
      const v = await api('POST', `/comercial/lead/${lead}/sala/publicar`, {}, pessoas.admin.token);
      conferir(v.approvalId, 'publicar a sala devia ficar retido na porta');
      const item = (await filaDe(pessoas.socio)).itens.find((i) => i.id === v.approvalId);
      if (item?.nivel === 'R4') r4Id = v.approvalId;
      else {
        const sala = await provarR3NaLinha(ps, v.approvalId);
        passo('a sala saiu R3 (dentro da janela): aprovada com um clique na linha, com a versão conferida', { detalhe: sala.aviso });
        prova.avisos.push('R4 sem prova nesta execução: rode fora das 08h–20h de São Paulo, ou passe T7_R4_ID.');
      }
    }
    if (r4Id) {
      const r4 = await provarR4ComSenha(ps, r4Id, { senha: SENHA, motivo: 'conferi o conteúdo na prova da T7' });
      await foto(ps, 'r4-aprovada-com-senha');
      passo('R4 com senha no mesmo lugar: o clique abriu a caixa ali, e Aprovar foi junto com a senha', { detalhe: `${r4.forma} · ${r4.aviso}`, approvalId: r4Id });
    } else if (!prova.avisos.length) {
      prova.avisos.push('R4 sem prova nesta execução: nenhum R4 pendente para a titular. Passe T7_R4_ID ou T7_LEAD (fora da janela).');
    }

    // ---- 3. Vencida com "pedir de novo" ----
    let vencidas = [];
    if (process.env.T7_VENCIDA_ID) vencidas = [process.env.T7_VENCIDA_ID];
    else {
      if (process.env.T7_ESPERAR_VENCIDA === '1') {
        // O pedido de mover deixou de existir (20/10/2026). Um R3 pendente da fila é deixado vencer.
        const pendente = (await filaDe(pessoas.mesa)).itens.find((i) => i.gaveta === 'esperando' && i.expiraEm);
        if (pendente) {
          console.log('     esperando um pedido pendente vencer…');
          await new Promise((r) => setTimeout(r, Math.max(0, new Date(pendente.expiraEm).getTime() - Date.now()) + 15_000));
        }
      }
      const f = await filaDe(pessoas.mesa);
      vencidas = f.itens.filter((i) => i.gaveta === 'expirou' && i.pedirDeNovo?.pode).map((i) => i.id);
    }
    conferir(vencidas.length, 'nenhuma vencida com "pedir de novo" na fila. Passe T7_VENCIDA_ID ou T7_ESPERAR_VENCIDA=1');
    let refeito = null;
    const tentativas = [];
    for (const id of vencidas.slice(0, 8)) {
      const d = await provarPedirDeNovo(pm, id);
      tentativas.push({ id, ok: d.ok, texto: d.texto.slice(0, 160) });
      if (d.ok) {
        refeito = { id, aviso: d.texto };
        break;
      }
    }
    conferir(refeito, `nenhuma vencida voltou à fila: ${JSON.stringify(tentativas)}`);
    await foto(pm, 'pedir-de-novo');
    const minha = await filaDe(pessoas.mesa);
    const nova = minha.itens.find((i) => i.gaveta === 'esperando' && i.proponente.id === pessoas.mesa.user.id && new Date(i.propostaEm).getTime() > t0);
    conferir(nova, 'o pedido novo não apareceu na fila em nome de quem clicou');
    conferir(!nova.euPossoAprovar && /propôs/.test(nova.porQueNao ?? ''), 'quem pediu de novo não devia poder assinar o pedido novo');
    const doSocio = (await filaDe(pessoas.socio)).itens.find((i) => i.id === nova.id);
    passo('vencida: "Pedir de novo" recriou o pedido; quem clicou vira o proponente e não assina', {
      detalhe: `${refeito.id} → ${nova.id} · o sócio ${doSocio?.euPossoAprovar ? 'pode' : 'não pode'} assinar`,
      tentativas,
    });
    // O pedido de prova não fica esperando: o sócio recusa (recusar não muda nada lá fora).
    await api('POST', `/approvals/${nova.id}/reject`, {}, pessoas.socio.token).catch(() => null);

    // ---- fotos da fila: escuro, claro e 390 px ----
    await abrirFila(ps);
    await foto(ps, 'fila-escuro');
    const ctxClaro = await contexto(navegador, pessoas.socio, 'light');
    const pc = await ctxClaro.newPage();
    await abrirFila(pc);
    await foto(pc, 'fila-claro');
    const ctxCel = await contexto(navegador, pessoas.socio, 'dark', { width: 390, height: 844 });
    const p390 = await ctxCel.newPage();
    await abrirFila(p390);
    const rola = await p390.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    conferir(!rola, '/atendimento rola na horizontal a 390 px');
    await foto(p390, 'fila-390');
    passo('fotos da fila em escuro, claro e 390 px; nada rola na horizontal no celular');

    prova.ok = true;
  } finally {
    await navegador.close();
    gravar();
  }
  console.log(prova.avisos.length ? `\nOK, com avisos:\n  ${prova.avisos.join('\n  ')}` : '\nOK');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`\nFALHOU: ${e.message}`);
    process.exit(1);
  });
}
