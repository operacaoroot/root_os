#!/usr/bin/env node
/*
 * A PROVA DA LANE T1b DA RODADA DO TRABALHO (19/10/2026): a porta única de quem
 * fechou FORA do sistema, no comercial.
 *
 * Mesmo arranjo do `trabalho-t7.mjs`: Playwright (Chromium) da pasta de
 * ferramentas (`UX_PW`, padrão `C:/Users/User/dev/pw-tools`), o web em
 * `http://127.0.0.1:3010`, a API em `http://127.0.0.1:4010/api`, a senha lida de
 * `homolog/.env.homolog` em tempo de execução.
 *
 * O que ela prova (docs/comercial/RODADA-TRABALHO-20261019.md, T1, "Porta única"):
 *   1. a mesa abre o Funil vivo, clica em "Registrar cliente já fechado", digita
 *      os dados do contrato, anexa o PDF assinado e deixa a cobrança nova
 *      DESMARCADA (com o motivo); a tela diz que o fechamento espera outra pessoa;
 *   2. o fechamento está na fila como R4, proposto pela mesa (que não assina);
 *   3. o sócio (titular) assina em /atendimento com motivo e senha, no lugar
 *      (a função `provarR4ComSenha` da T7);
 *   4. o fechamento conclui com a cobrança `pulado` e nada na ZapSign; o
 *      contrato aparece em Contratos vivos;
 *   5. o card do cliente aparece na implantação (a lista "Onboarding de
 *      cliente"), com o cliente (Partner) ligado.
 *
 * `provarRegistrarClienteJaFechado(paginaMesa, paginaSocio, opcoes)` é exportada
 * para o `trabalho.mjs` (T9) reaproveitar. Ela ESCREVE na homologação: um lead,
 * um Partner, um contrato no Financeiro, um trilho, um card e um grupo simulado,
 * com CNPJ e nome únicos por execução.
 *
 * Saída: `homolog/provas/trabalho-t1b.json` e `homolog/provas/trabalho-t1b-*.png`.
 * Uso (Git Bash): node homolog/e2e/trabalho-t1b.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { api, provarR4ComSenha } from './trabalho-t7.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WEB = process.env.UX_WEB ?? 'http://127.0.0.1:3010';
const PW = process.env.UX_PW ?? 'C:/Users/User/dev/pw-tools';
const PROVAS = join(RAIZ, 'homolog/provas');
const CAP_FECHAMENTO = 'comercial.fechamento.executar';

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

/** Um PDF mínimo e válido (cabeçalho `%PDF-`), único por execução. */
function pdfDeProva(marca) {
  return Buffer.from(`%PDF-1.4\n% contrato assinado fora do sistema · prova T1b ${marca}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}

/**
 * A prova inteira. `paginaMesa` logada como quem registra (leads.editar);
 * `paginaSocio` como a titular que assina. `sessoes` traz os tokens da API para
 * as leituras de conferência. Devolve o lead, a chave e o card.
 */
export async function provarRegistrarClienteJaFechado(paginaMesa, paginaSocio, { senha, sessoes, aoFotografar = async () => {} }) {
  const marca = new Date().toISOString().slice(11, 19).replace(/:/g, '');
  const razaoSocial = `Cliente Já Fechado ${marca} Ltda`;
  const cnpj = `9${String(Date.now()).slice(-13)}`;
  const telefone = `(32) 9${String(Date.now()).slice(-8)}`;

  // 1 · o formulário no Funil vivo
  await paginaMesa.goto(`${WEB}/comercial/funil`, { waitUntil: 'networkidle' });
  await paginaMesa.getByRole('button', { name: 'Registrar cliente já fechado' }).click();
  const painel = paginaMesa.locator('[data-testid="registrar-fechado-fora"]');
  await painel.waitFor({ timeout: 15_000 });
  await painel.getByLabel('Razão social', { exact: true }).fill(razaoSocial);
  await painel.getByLabel('CNPJ ou CPF', { exact: true }).fill(cnpj);
  await painel.getByLabel('Quem assina', { exact: true }).fill('Pessoa de Prova');
  await painel.getByLabel('E-mail de quem assina', { exact: true }).fill(`prova-${marca}@cliente.homolog`);
  await painel.getByLabel('WhatsApp do contato', { exact: true }).fill(telefone);
  await painel.getByLabel('Produto (tabela de 04/10)', { exact: true }).selectOption('operacao');
  await painel.getByLabel('Forma de pagamento', { exact: true }).selectOption('boleto');
  await painel.getByLabel('Assinado em', { exact: true }).fill('2026-09-01');
  await painel.getByLabel('1º vencimento', { exact: true }).fill('2026-09-10');
  const cobranca = painel.getByRole('checkbox', { name: /Criar cobrança nova no Asaas/ });
  conferir(!(await cobranca.isChecked()), 'a cobrança nova devia nascer desmarcada');
  await painel.getByLabel('Por que não criar cobrança', { exact: true }).fill('o cliente já paga por boleto do banco (prova T1b)');
  await painel.getByLabel('Contrato assinado (PDF, até 10 MB)', { exact: true }).setInputFiles({ name: `contrato-assinado-${marca}.pdf`, mimeType: 'application/pdf', buffer: pdfDeProva(marca) });
  await aoFotografar(paginaMesa, 'formulario');
  await painel.getByRole('button', { name: 'registrar e pedir o fechamento' }).click();
  const feito = painel.locator('[data-testid="registrar-fechado-fora-feito"]');
  try {
    await feito.waitFor({ timeout: 30_000 });
  } catch {
    // Sem o "feito", a prova diz o que a tela mostrou (erro da API ou campo recusado), em vez de só "tempo esgotado".
    const naTela = (await painel.innerText().catch(() => '')).split(/\r?\n/).filter((l) => /erro|recus|obrigat|inválid|não|falt|indispon/i.test(l)).slice(0, 6).join(' | ');
    // A homologação desta máquina não tem storage (sem imagem do MinIO): o registro tem de recusar
    // ANTES de gravar qualquer coisa, com a frase. É o que dá para provar aqui; o resto é da suíte da API.
    if (/envio de arquivo está indisponível|storage/i.test(naTela)) {
      const funil = JSON.stringify(await api('GET', '/comercial/funil', undefined, sessoes.mesa.token));
      conferir(!funil.includes(razaoSocial), 'sem storage o registro devia recusar antes de criar o lead, e o lead apareceu no funil');
      await aoFotografar(paginaMesa, 'sem-storage');
      return { semStorage: true, razaoSocial, mensagem: naTela };
    }
    throw new Error(`o registro não terminou: ${naTela || 'nenhuma mensagem na tela'}`);
  }
  const textoFeito = (await feito.textContent()) ?? '';
  conferir(/espera a assinatura de outra pessoa/.test(textoFeito), `a tela devia dizer que o fechamento espera outra pessoa: ${textoFeito}`);
  const chave = /fech-[0-9a-f-]{36}-v\d+/.exec(textoFeito)?.[0];
  conferir(chave, 'a chave do fechamento não apareceu na tela');
  const leadId = chave.slice(5, 41);
  await aoFotografar(paginaMesa, 'registrado');

  // 2 · o pedido na fila: R4, proposto pela mesa, que não assina
  const filaMesa = await api('GET', '/approvals/fila', undefined, sessoes.mesa.token);
  const meu = filaMesa.itens.find((i) => i.gaveta === 'esperando' && i.capacidade === CAP_FECHAMENTO && i.recurso?.id === chave);
  conferir(meu, 'o fechamento não apareceu na fila de quem registrou');
  conferir(meu.nivel === 'R4' && !meu.euPossoAprovar, 'o fechamento devia ser R4 e quem registrou não devia poder assinar');

  // 3 · o sócio assina com motivo e senha, no lugar
  const r4 = await provarR4ComSenha(paginaSocio, meu.id, { senha, motivo: 'conferi o contrato anexado e os dados (prova T1b)' });
  await aoFotografar(paginaSocio, 'assinado');

  // 4 · o fechamento concluído, sem cobrança nova; o contrato vivo
  const f = await api('GET', `/comercial/fechamentos/${leadId}`, undefined, sessoes.mesa.token);
  conferir(f.estado === 'concluido', `o fechamento devia estar concluído (está ${f.estado})`);
  const porEscrita = Object.fromEntries(f.escritas.map((e) => [e.escrita, e.estado]));
  conferir(porEscrita.cobranca === 'pulado', `a cobrança devia ficar "pulado" (ficou ${porEscrita.cobranca})`);
  conferir(porEscrita.card === 'criado' && porEscrita.cliente === 'criado', `cliente e card deviam nascer: ${JSON.stringify(porEscrita)}`);
  conferir(f.contratoAnexado?.nome?.startsWith('contrato-assinado-'), 'o fechamento devia mostrar o contrato anexado');
  const contratos = await api('GET', '/comercial/contratos', undefined, sessoes.mesa.token);
  const vivo = contratos.find((c) => c.leadId === leadId);
  conferir(vivo && vivo.cliente === razaoSocial, 'o contrato não apareceu em Contratos vivos');

  // 5 · o card na implantação, com o cliente ligado
  await paginaMesa.goto(`${WEB}/onboarding`, { waitUntil: 'networkidle' });
  const card = paginaMesa.getByText(razaoSocial, { exact: false }).first();
  await card.waitFor({ timeout: 30_000 });
  await aoFotografar(paginaMesa, 'card-na-implantacao');
  const ficha = await api('GET', `/comercial/lead/${leadId}`, undefined, sessoes.mesa.token);
  const etapa = ficha?.ficha?.etapa ?? ficha?.etapa ?? null;

  return { leadId, chave, razaoSocial, approvalId: meu.id, r4, escritas: porEscrita, situacao: vivo.situacao, etapa, urlDaImplantacao: paginaMesa.url() };
}

/* ------------------------------------------------------------------ main */

async function main() {
  mkdirSync(PROVAS, { recursive: true });
  const require = createRequire(join(PW, 'package.json'));
  const { chromium } = require('playwright');
  const SENHA = lerEnv(join(RAIZ, 'homolog/.env.homolog')).ADMIN_PASSWORD;
  conferir(SENHA, 'ADMIN_PASSWORD ausente em homolog/.env.homolog');
  const prova = { inicio: new Date().toISOString(), web: WEB, passos: [], screenshots: [], ok: false };
  const t0 = Date.now();
  const entrar = async (email) => {
    const r = await api('POST', '/auth/login', { email, password: SENHA });
    return { token: r.token ?? r.accessToken, user: r.user };
  };
  const contexto = async (navegador, sessao, tema = 'dark') => {
    const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
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
  const aoFotografar = async (pagina, nome) => {
    const arquivo = `trabalho-t1b-${nome}.png`;
    await pagina.waitForTimeout(300);
    await pagina.screenshot({ path: join(PROVAS, arquivo), fullPage: false });
    prova.screenshots.push(arquivo);
  };

  const sessoes = { mesa: await entrar('mesa@root.homolog'), socio: await entrar('socio@root.homolog') };
  const navegador = await chromium.launch();
  try {
    const pm = await (await contexto(navegador, sessoes.mesa)).newPage();
    const ps = await (await contexto(navegador, sessoes.socio)).newPage();
    const r = await provarRegistrarClienteJaFechado(pm, ps, { senha: SENHA, sessoes, aoFotografar });
    if (r.semStorage) {
      prova.passos.push({ nome: 'sem storage na homologação: o registro recusou antes de gravar, com a frase, e nenhum lead nasceu', ms: Date.now() - t0, ...r });
      prova.avisos = ['A homologação não tem storage (MinIO sem imagem nesta máquina): o caminho completo do registro fica provado pela suíte da API (comercial-fechado-fora, com dublê do storage).'];
      console.log(`  OK · sem storage: recusou antes de gravar · ${r.mensagem}`);
      console.log(`\nOK, com avisos:\n  ${prova.avisos[0]}`);
      prova.ok = true;
      return;
    }
    prova.passos.push({ nome: 'registrar cliente já fechado pelo Funil vivo, sócio assina R4 com senha, card na implantação', ms: Date.now() - t0, ...r });
    console.log(`  OK · ${r.razaoSocial} · ${r.chave} · ${JSON.stringify(r.escritas)}`);
    prova.ok = true;
  } finally {
    await navegador.close();
    prova.fim = new Date().toISOString();
    prova.duracaoMs = Date.now() - t0;
    writeFileSync(join(PROVAS, 'trabalho-t1b.json'), `${JSON.stringify(prova, null, 2)}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`\nFALHOU: ${e.message}`);
    process.exit(1);
  });
}
