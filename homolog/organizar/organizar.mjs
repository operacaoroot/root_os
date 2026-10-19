// ORGANIZAR NO LUGAR as tarefas reais (decisão 5 da versão final, 19/10/2026).
//
// É O MESMO script da homologação (stack rootos-final) e da virada de produção:
// nada de caminho fixo de máquina. Tudo chega por argumento ou variável.
//
// O que faz, sempre pela API da stack (a mesma régua, auditoria e gatilhos da tela):
//   1. garante a estrutura nossa: POST /trabalho/estrutura/sugerida
//      (Administrativa · Gestão · Clientes [Esteira de clientes · Onboarding de cliente · Execução]);
//   2. garante o `Partner` de cada cliente que as tarefas citam (cartão `cadastro` →
//      Partner): acha por CNPJ, senão pelo nome normalizado (também o título do cartão
//      de origem, que é o que a migration de conciliação usa), e só cria o que falta;
//   3. move as LISTAS de origem para as pastas nossas, no lugar (mover a lista
//      preserva as tarefas e os ids delas): a lista de origem vira a lista de destino
//      quando o mapa manda as tarefas dela para uma lista que não é da estrutura;
//   4. move as TAREFAS cujo destino é uma lista da estrutura (Clientes › Execução, …),
//      com a etapa equivalente; a subtarefa cujo pai virou lead (ou saiu) fica solta;
//      o cartão pedido em Onboarding de cliente vai para Execução (a porta da
//      implantação só abre pelo fechamento, regra do nosso código);
//   5. cartões que são lead (Gestão de Leads e o que o mapa disser) → Funil vivo pela
//      entrada idempotente (`origem manual`, ref `cartao:<id>`); mover etapa é escrita
//      sensível: uma conta PEDE, a outra CONFIRMA com reautenticação; o cartão de
//      origem é ARQUIVADO com o link do lead num comentário;
//   6. testes (destino `fora`) são ARQUIVADOS, nunca apagados;
//   7. cliente em toda tarefa ativa das pastas Administrativa e Gestão (o da casa,
//      `interno`, quando faltar); em Clientes, tarefa sem cliente vira sobra;
//   8. MARKETING FICA ONDE ESTÁ: pasta e lista de marketing não são tocadas, nem
//      quando um mapa citar uma tarefa de lá.
// Tudo o que não tem destino claro FICA ONDE ESTÁ e vai para sobras.md.
//
// Não converte o `WorkTask.clienteId` do esquema do Lucas: roda DEPOIS das
// migrations (a de conciliação já trocou o ponteiro para `Partner`). Cliente que a
// conciliação já ligou é mantido; a divergência com o mapa só é contada.
//
// Idempotente: a segunda passada não muda contagem (tudo é "já está").
//
// Uso:
//   node homolog/organizar/organizar.mjs --api http://127.0.0.1:4030/api \
//        --mapas homolog/copia/mapa-crm.json,homolog/copia/mapa-gestao.json,homolog/organizar/mapa-novos.json \
//        [--env homolog/.env.final] [--web http://100.95.41.124:3030] [--saida homolog/organizar] \
//        [--simular] [--detalhe] [--producao]
// Contas (variáveis de ambiente ou do --env):
//   ORGANIZAR_PEDE_EMAIL / ORGANIZAR_PEDE_SENHA        quem escreve e PEDE o movimento de etapa
//   ORGANIZAR_CONFERE_EMAIL / ORGANIZAR_CONFERE_SENHA  quem CONFIRMA (outra pessoa, com alçada)
// `--simular` só lê (o login das duas contas é o único registro que ele deixa) e
// imprime o plano por destino; `--detalhe` grava o plano com títulos em
// <saida>/plano.md (dado de cliente: fora do git). URL fora de loopback/rede
// privada exige `--producao` para escrever.
//
// A saída do console é SÓ de contagens. Título, nome e cliente vão apenas aos
// arquivos de <saida> (plano.md, sobras.md), que ficam fora do git.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------------ argumentos
const argv = process.argv.slice(2);
const arg = (nome, padrao = null) => {
  const i = argv.indexOf(nome);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : padrao;
};
const flag = (nome) => argv.includes(nome);
const SIMULAR = flag('--simular');
const DETALHE = flag('--detalhe');

const envDoArquivo = {};
const arquivoEnv = arg('--env');
if (arquivoEnv) {
  for (const l of readFileSync(arquivoEnv, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) envDoArquivo[m[1]] = m[2];
  }
}
const cfg = (k, padrao = null) => process.env[k] ?? envDoArquivo[k] ?? padrao;

const API = (arg('--api') ?? cfg('ORGANIZAR_API_URL') ?? '').replace(/\/$/, '');
const WEB = (arg('--web') ?? cfg('ORGANIZAR_WEB_URL') ?? '').replace(/\/$/, '');
const SAIDA = path.resolve(arg('--saida') ?? cfg('ORGANIZAR_SAIDA') ?? path.dirname(fileURLToPath(import.meta.url)));
const MAPAS = (arg('--mapas') ?? cfg('ORGANIZAR_MAPAS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (!API) throw new Error('informe --api <url da API, terminando em /api>');
if (MAPAS.length === 0) throw new Error('informe --mapas a.json,b.json');
const host = new URL(API).hostname;
const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.)/.test(host);
if (!SIMULAR && !local && !flag('--producao')) throw new Error('API fora de loopback/rede privada: para escrever, passe --producao (e rode --simular antes)');

const HOJE = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date());

// ------------------------------------------------------------------ utilidades
const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const digitos = (s) => String(s ?? '').replace(/\D/g, '');
const celula = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function chamar(metodo, caminho, corpo, token, extras = {}) {
  const r = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(extras.headers ?? {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  if (!r.ok) {
    // Console: só o status e o começo da frase da API (nunca o valor enviado).
    const msg = typeof json === 'string' ? json : (json?.message ?? JSON.stringify(json));
    const frase = Array.isArray(msg) ? msg.join('; ') : String(msg);
    const e = new Error(`${metodo} ${caminho.replace(/[0-9a-f-]{36}/gi, ':id')} → ${r.status}: ${frase.split(/[.:"«(]/)[0].slice(0, 60)}`);
    e.status = r.status;
    e.detalhe = frase.slice(0, 300);
    throw e;
  }
  return json;
}

// ------------------------------------------------------------------ contagens e relatórios
const conta = {
  estrutura: { pastasCriadas: 0, listasCriadas: 0 },
  clientes: { necessarios: 0, achados: 0, criados: 0, aCriar: 0, interno: 0, naoCliente: 0 },
  listas: { movidas: 0, jaNoLugar: 0, aMover: 0 },
  tarefas: { movidas: 0, aMover: 0, jaNoLugar: 0, soltas: 0, redirecionadasDaImplantacao: 0, clientePreenchido: 0, clienteDivergeDoMapa: 0, recusadas: 0 },
  leads: { criados: 0, jaExistiam: 0, aCriar: 0, movidos: 0, ficaramNaEtapaAnterior: 0, cartoesArquivados: 0, jaFeitos: 0, recusados: 0, porEtapa: {} },
  testes: { arquivados: 0, aArquivar: 0, jaArquivados: 0 },
  varredura: { clienteInternoPreenchido: 0, aPreencher: 0, semClienteEmClientes: 0 },
  marketing: { intocadas: 0, citadasNoMapa: 0 },
  sobras: 0,
  ausentes: 0,
  porDestino: {},
};
const porDestino = (k, n = 1) => { conta.porDestino[k] = (conta.porDestino[k] ?? 0) + n; };
const plano = []; // linhas do plano.md (com título)
const sobras = []; // linhas do sobras.md (com título)
const linhaDoPlano = (t, destino, acao, motivo = '') => plano.push({ titulo: t?.title ?? '(ausente)', origem: t?.listName ?? '', destino, acao, motivo, id: t?.id ?? '' });
const sobra = (t, onde, motivo) => { sobras.push({ titulo: t?.title ?? t?.name ?? '', onde, motivo, id: t?.id ?? '' }); conta.sobras++; };

// ------------------------------------------------------------------ mapas
function lerMapas() {
  const clientes = new Map();
  const tarefas = new Map();
  for (const arq of MAPAS) {
    if (!existsSync(arq)) throw new Error(`mapa ausente: ${path.basename(arq)}`);
    const m = JSON.parse(readFileSync(arq, 'utf8'));
    for (const c of m.clientes ?? []) {
      const ja = clientes.get(c.chave);
      if (ja) {
        if (ja.cnpj && c.cnpj && digitos(ja.cnpj) !== digitos(c.cnpj)) throw new Error(`cliente com dois CNPJs nos mapas (${path.basename(arq)})`);
        ja.cnpj = ja.cnpj || c.cnpj;
        ja.origemIds.push(...(c.origemId ? [c.origemId] : []));
      } else clientes.set(c.chave, { ...c, origemIds: c.origemId ? [c.origemId] : [] });
    }
    for (const t of m.tarefas ?? []) {
      if (tarefas.has(t.origemId)) throw new Error(`tarefa repetida entre os mapas (${path.basename(arq)})`);
      tarefas.set(t.origemId, t);
    }
  }
  return { clientes, tarefas };
}

// ------------------------------------------------------------------ estrutura
const ESTRUTURA = [
  { pasta: 'Administrativa', listas: [] },
  { pasta: 'Gestão', listas: [] },
  { pasta: 'Clientes', listas: ['Esteira de clientes', 'Onboarding de cliente', 'Execução'] },
];
const LISTAS_DA_ESTRUTURA = new Set(['clientes/esteira de clientes', 'clientes/onboarding de cliente', 'clientes/execucao']);
const PASTAS_NOSSAS = new Set(ESTRUTURA.map((e) => normalizar(e.pasta)));
// Tipo da etapa pelo nome (as listas da estrutura e o pipeline padrão).
const TIPO_DA_ETAPA = {
  'a fazer': 'open', 'em andamento': 'custom', 'concluida': 'closed',
  'fechado no comercial': 'open', 'encerrado': 'closed', 'qualificacao': 'open',
};

function indexar(estrutura) {
  const listas = new Map(); // id → { id, name, folderId, folderName, statuses, total }
  for (const f of estrutura.folders ?? []) {
    for (const l of f.lists ?? []) listas.set(l.id, { ...l, folderId: f.id, folderName: f.name, folderParentId: f.parentId });
  }
  for (const l of estrutura.listasSoltas ?? []) listas.set(l.id, { ...l, folderId: null, folderName: null });
  const pastaDeTopo = (nome) => (estrutura.folders ?? []).find((f) => !f.parentId && normalizar(f.name) === normalizar(nome)) ?? null;
  const listaEm = (pasta, nome) => {
    const p = pastaDeTopo(pasta);
    return p ? (p.lists ?? []).map((l) => listas.get(l.id)).find((l) => normalizar(l.name) === normalizar(nome)) ?? null : null;
  };
  const ehMarketing = (listId) => {
    const l = listas.get(listId);
    if (!l) return false;
    if (/^marketing$/i.test(normalizar(l.name))) return true;
    // a pasta de marketing, em qualquer nível
    let f = (estrutura.folders ?? []).find((x) => x.id === l.folderId);
    while (f) {
      if (/marketing/.test(normalizar(f.name))) return true;
      f = (estrutura.folders ?? []).find((x) => x.id === f.parentId);
    }
    return false;
  };
  const daEstrutura = (listId) => {
    const l = listas.get(listId);
    return !!l && PASTAS_NOSSAS.has(normalizar(l.folderName)) && !!pastaDeTopo(l.folderName) && pastaDeTopo(l.folderName).id === l.folderId;
  };
  const categoria = (listId) => {
    const l = listas.get(listId);
    if (!l) return 'lista desconhecida';
    if (ehMarketing(listId)) return 'Marketing (intocado)';
    if (daEstrutura(listId)) return `${l.folderName} / ${l.name}`;
    return 'fora das pastas nossas';
  };
  return { listas, pastaDeTopo, listaEm, ehMarketing, daEstrutura, categoria };
}

function retrato(idx) {
  const r = {};
  for (const l of idx.listas.values()) {
    const k = idx.categoria(l.id);
    r[k] = (r[k] ?? 0) + (l.total ?? 0);
  }
  return r;
}

// Etapa da lista de destino: pelo nome; senão pelo tipo; concluída sempre fecha.
function etapaNoDestino(lista, etapaPedida, concluida, tipoAtual) {
  const st = lista.statuses ?? [];
  let s = etapaPedida ? st.find((x) => normalizar(x.name) === normalizar(etapaPedida)) : null;
  const tipo = concluida ? 'closed' : (TIPO_DA_ETAPA[normalizar(etapaPedida)] ?? tipoAtual ?? 'open');
  if (s && concluida && s.type !== 'closed') s = null;
  if (!s) s = st.find((x) => x.type === tipo) ?? (tipo === 'custom' ? st.find((x) => x.type === 'open') : null) ?? st[0];
  return s;
}

// ------------------------------------------------------------------ main
async function main() {
  const { clientes, tarefas: doMapa } = lerMapas();
  const pede = { email: cfg('ORGANIZAR_PEDE_EMAIL'), senha: cfg('ORGANIZAR_PEDE_SENHA') };
  const confere = { email: cfg('ORGANIZAR_CONFERE_EMAIL'), senha: cfg('ORGANIZAR_CONFERE_SENHA') };
  if (!pede.email || !pede.senha) throw new Error('faltam ORGANIZAR_PEDE_EMAIL e ORGANIZAR_PEDE_SENHA');
  if (!confere.email || !confere.senha) throw new Error('faltam ORGANIZAR_CONFERE_EMAIL e ORGANIZAR_CONFERE_SENHA');
  if (normalizar(pede.email) === normalizar(confere.email)) throw new Error('quem pede e quem confirma precisam ser pessoas diferentes');
  const entrar = async (c) => { const r = await chamar('POST', '/auth/login', { email: c.email, password: c.senha }); return r.token ?? r.accessToken; };
  const tok = await entrar(pede);
  const tokConf = await entrar(confere);
  const api = (m, c, b, extras) => chamar(m, c, b, tok, extras);
  // A API do merge exige a versão lida em toda edição de tarefa (409 work_task_conflict se
  // mudou): relê a tarefa logo antes de escrever e manda o updatedAt dela.
  const versao = async (id) => (await api("GET", `/trabalho/tarefas/${id}`)).updatedAt;
  const editarTarefa = async (id, patch) => api("PATCH", `/trabalho/tarefas/${id}`, { ...patch, expectedUpdatedAt: await versao(id) });
  const arquivarTarefa = async (id) => api("DELETE", `/trabalho/tarefas/${id}`, { expectedUpdatedAt: await versao(id) });

  // ---------------- 1. estrutura nossa
  let estrutura = await api('GET', '/trabalho/estrutura');
  let idx = indexar(estrutura);
  const antes = retrato(idx);
  const faltam = [];
  for (const e of ESTRUTURA) {
    if (!idx.pastaDeTopo(e.pasta)) faltam.push(e.pasta);
    for (const l of e.listas) if (!idx.listaEm(e.pasta, l)) faltam.push(`${e.pasta} / ${l}`);
  }
  if (faltam.length && !SIMULAR) {
    const r = await api('POST', '/trabalho/estrutura/sugerida');
    conta.estrutura.pastasCriadas = r?.criadas?.pastas?.length ?? 0;
    conta.estrutura.listasCriadas = r?.criadas?.listas?.length ?? 0;
    estrutura = await api('GET', '/trabalho/estrutura');
    idx = indexar(estrutura);
  } else if (faltam.length) {
    conta.estrutura.aCriar = faltam.length;
  }

  // ---------------- leitura das tarefas do mapa (pelo id: é o mesmo banco)
  const atual = new Map();
  for (const id of doMapa.keys()) {
    if (!UUID.test(id)) continue;
    try {
      atual.set(id, await api('GET', `/trabalho/tarefas/${id}`));
    } catch (e) {
      if (e.status !== 404) throw e;
      conta.ausentes++;
    }
  }
  const pessoas = await api('GET', '/trabalho/pessoas').catch(() => []);
  const pessoaPorNome = (nome) => (nome ? (pessoas ?? []).find((p) => normalizar(p.nome) === normalizar(nome)) ?? null : null);

  // ---------------- 2. clientes → Partner
  const precisa = new Set();
  for (const m of doMapa.values()) if ((m.destino?.tipo === 'tarefa' || m.destino?.tipo === 'cliente') && m.cliente) precisa.add(m.cliente);
  conta.clientes.necessarios = precisa.size;
  const partners = (await api('GET', '/finance/partners').catch(() => ({ items: [] })))?.items ?? [];
  const partnerDaChave = new Map();
  for (const chave of precisa) {
    if (chave === 'cli:root-interno') { partnerDaChave.set(chave, 'interno'); conta.clientes.interno++; continue; }
    const c = clientes.get(chave);
    if (!c) { conta.clientes.naoCliente++; continue; }
    const doc = digitos(c.cnpj);
    const nomes = new Set([normalizar(String(c.nome).slice(0, 160))]);
    for (const oid of c.origemIds) {
      const cartao = atual.get(oid);
      if (cartao?.title) { nomes.add(normalizar(cartao.title)); nomes.add(normalizar(String(cartao.title).split('|')[0])); }
    }
    let p = doc ? partners.find((x) => digitos(x.cnpjCpf) === doc) : null;
    p ??= partners.find((x) => nomes.has(normalizar(x.razaoSocial)) || nomes.has(normalizar(x.nomeFantasia)));
    // a conciliação já pode ter ligado as tarefas do mapa a um Partner: segue o voto delas
    if (!p) {
      const votos = new Map();
      for (const m of doMapa.values()) {
        const cid = m.cliente === chave ? atual.get(m.origemId)?.clienteId : null;
        if (cid) votos.set(cid, (votos.get(cid) ?? 0) + 1);
      }
      const [melhor] = [...votos.entries()].sort((a, b) => b[1] - a[1]);
      if (melhor) p = partners.find((x) => x.id === melhor[0]) ?? { id: melhor[0], isCliente: true };
    }
    if (p) {
      if (p.isCliente === false) { conta.clientes.naoCliente++; sobra({ name: c.nome }, 'Partner existente', 'o cadastro achado não é de cliente (isCliente falso): ligar à mão no Financeiro'); continue; }
      partnerDaChave.set(chave, p.id);
      conta.clientes.achados++;
      continue;
    }
    if (SIMULAR) { conta.clientes.aCriar++; partnerDaChave.set(chave, `novo:${chave}`); continue; }
    const r = await api('POST', '/finance/partners', { razaoSocial: String(c.nome).slice(0, 160), cnpjCpf: doc || null, isCliente: true });
    partners.push({ id: r.id, razaoSocial: String(c.nome).slice(0, 160), nomeFantasia: null, cnpjCpf: doc || null, isCliente: true });
    partnerDaChave.set(chave, r.id);
    conta.clientes.criados++;
  }

  // ---------------- 3. listas de origem → pastas nossas (no lugar)
  // A lista de origem de uma tarefa é a lista ONDE ELA ESTÁ (mesmo banco). Quando o
  // mapa manda tarefas dela para uma lista fora da estrutura (Administrativo, Comercial,
  // Operação interna…), a própria lista vai para a pasta pedida, com o nome dela.
  const destinoDaLista = new Map(); // listId → { pasta, votos }
  for (const m of doMapa.values()) {
    const t = atual.get(m.origemId);
    if (!t || m.destino?.tipo !== 'tarefa') continue;
    const chave = `${normalizar(m.destino.pasta)}/${normalizar(m.destino.lista)}`;
    if (LISTAS_DA_ESTRUTURA.has(chave)) continue;
    if (idx.ehMarketing(t.listId)) continue;
    const d = destinoDaLista.get(t.listId) ?? { votos: new Map() };
    const k = `${m.destino.pasta}\u0000${m.destino.lista}`;
    d.votos.set(k, (d.votos.get(k) ?? 0) + 1);
    destinoDaLista.set(t.listId, d);
  }
  const casaDaLista = new Map(); // `${pasta}/${listaDoMapa}` normalizado → listId
  const vaiPara = new Map(); // listId → nome da pasta nossa (para a simulação contar como se já tivesse ido)
  for (const [listId, d] of destinoDaLista) {
    const ordenados = [...d.votos.entries()].sort((a, b) => b[1] - a[1]);
    const [pasta, listaDoMapa] = ordenados[0][0].split('\u0000');
    const l = idx.listas.get(listId);
    casaDaLista.set(`${normalizar(pasta)}/${normalizar(listaDoMapa)}`, listId);
    vaiPara.set(listId, pasta);
    for (const [outro] of ordenados.slice(1)) {
      const [p2, l2] = outro.split('\u0000');
      sobra({ name: l?.name }, `${p2} / ${l2}`, 'a mesma lista de origem tem tarefas pedidas em duas listas novas: só a primeira veio no lugar; as outras ficam');
    }
    const p = idx.pastaDeTopo(pasta) ?? (SIMULAR && faltam.includes(pasta) ? { id: `nova:${pasta}` } : null);
    if (!p) { sobra({ name: l?.name }, pasta, 'pasta de destino ausente'); continue; }
    if (l.folderId === p.id) { conta.listas.jaNoLugar++; continue; }
    if (SIMULAR) { conta.listas.aMover++; plano.push({ titulo: `(lista) ${l.name}`, origem: l.folderName ?? '(solta)', destino: `${pasta} / ${l.name}`, acao: 'mover lista', motivo: '', id: listId }); continue; }
    await api('PATCH', `/trabalho/listas/${listId}`, { folderId: p.id });
    conta.listas.movidas++;
    plano.push({ titulo: `(lista) ${l.name}`, origem: l.folderName ?? '(solta)', destino: `${pasta} / ${l.name}`, acao: 'lista movida', motivo: '', id: listId });
  }
  if (conta.listas.movidas) { estrutura = await api('GET', '/trabalho/estrutura'); idx = indexar(estrutura); }

  // ---------------- 4. tarefas
  const ordem = [...doMapa.values()].sort((a, b) => (a.paiOrigemId ? 1 : 0) - (b.paiOrigemId ? 1 : 0));
  const leads = [];
  for (const m of ordem) {
    const t = atual.get(m.origemId);
    const tipo = m.destino?.tipo;
    if (!t) { linhaDoPlano({ title: '(não existe mais)', id: m.origemId }, '-', 'ausente', 'o id do mapa não existe neste banco'); continue; }
    if (idx.ehMarketing(t.listId)) {
      conta.marketing.citadasNoMapa++;
      linhaDoPlano(t, 'fica (marketing)', 'nada', 'marketing fica onde está');
      continue;
    }
    if (tipo === 'cliente') { linhaDoPlano(t, 'Partner', 'nada', 'cartão de cadastro: o cliente é o Partner'); porDestino('cliente (Partner)'); continue; }
    if (tipo === 'lead') { leads.push({ m, t }); continue; }
    if (tipo === 'fora') {
      porDestino('arquivado (teste)');
      if (t.archived) { conta.testes.jaArquivados++; linhaDoPlano(t, 'arquivado', 'já está', m.motivo); continue; }
      if (SIMULAR) { conta.testes.aArquivar++; linhaDoPlano(t, 'arquivado', 'arquivar', m.motivo); continue; }
      await api('POST', `/trabalho/tarefas/${t.id}/comentarios`, { text: `Arquivado na organização de ${HOJE}: ${String(m.motivo ?? 'teste').slice(0, 300)}` });
      await arquivarTarefa(t.id);
      conta.testes.arquivados++;
      linhaDoPlano(t, 'arquivado', 'arquivado', m.motivo);
      continue;
    }
    if (tipo !== 'tarefa') { sobra(t, t.listName, 'destino desconhecido no mapa'); continue; }

    // destino
    const chaveMapa = `${normalizar(m.destino.pasta)}/${normalizar(m.destino.lista)}`;
    const paiMapa = m.paiOrigemId ? doMapa.get(m.paiOrigemId) : null;
    const paiFica = !!m.paiOrigemId && (!paiMapa || paiMapa.destino?.tipo === 'tarefa');
    const parentDepois = paiFica ? t.parentId : null;
    let alvo;
    let etapa = m.destino.etapa;
    let motivo = m.motivo ?? '';
    if (LISTAS_DA_ESTRUTURA.has(chaveMapa)) {
      let lista = m.destino.lista;
      if (chaveMapa === 'clientes/onboarding de cliente' && !parentDepois) {
        // A porta da implantação (regra nossa): cartão só nasce do fechamento.
        lista = 'Execução';
        const fim = /encerrad/i.test(etapa ?? '') || m.concluida;
        etapa = fim ? 'Concluída' : /fechado no comercial/i.test(etapa ?? '') ? 'A fazer' : 'Em andamento';
        motivo += ' · pedido Onboarding de cliente; a porta da implantação recusa cartão solto → Execução';
        conta.tarefas.redirecionadasDaImplantacao++;
      }
      alvo = idx.listaEm(m.destino.pasta, lista);
      // Na simulação sobre um banco sem a estrutura, a lista ainda vai nascer no passo 1.
      if (!alvo && SIMULAR) alvo = { id: `nova:${chaveMapa}`, name: lista, statuses: [] };
    } else {
      const casa = casaDaLista.get(chaveMapa);
      alvo = casa ? idx.listas.get(casa) : idx.listaEm(m.destino.pasta, m.destino.lista);
    }
    if (!alvo) { sobra(t, t.listName, `lista de destino ausente (${m.destino.pasta} / ${m.destino.lista})`); continue; }
    const destinoNome = `${idx.listas.get(alvo.id)?.folderName ?? m.destino.pasta} / ${alvo.name}`;
    const novaLista = String(alvo.id).startsWith('nova:');
    // A contagem usa os nomes do MAPA (estrutura nossa), nunca o nome de uma lista de origem.
    porDestino(`${m.destino.pasta} / ${chaveMapa === 'clientes/onboarding de cliente' && !parentDepois ? 'Execução' : m.destino.lista}`);

    const patch = {};
    if (t.listId !== alvo.id) {
      const st = novaLista ? { id: `(etapa ${etapa ?? ''})` } : etapaNoDestino(alvo, etapa, m.concluida, t.statusType);
      Object.assign(patch, { listId: alvo.id, statusId: st.id });
    }
    if ((t.parentId ?? null) !== (parentDepois ?? null)) { patch.parentId = parentDepois; conta.tarefas.soltas++; }
    const clienteMapa = m.cliente ? partnerDaChave.get(m.cliente) ?? null : null;
    if (!t.clienteId) {
      if (clienteMapa && !String(clienteMapa).startsWith('novo:')) patch.clienteId = clienteMapa;
      else if (clienteMapa) patch.clienteId = '(novo)';
      if (patch.clienteId) conta.tarefas.clientePreenchido++;
    } else if (clienteMapa && clienteMapa !== 'interno' && !String(clienteMapa).startsWith('novo:') && clienteMapa !== t.clienteId) {
      conta.tarefas.clienteDivergeDoMapa++;
      motivo += ' · o cliente ligado pela conciliação difere do mapa: mantido o da conciliação';
    }
    if (Object.keys(patch).length === 0) { conta.tarefas.jaNoLugar++; linhaDoPlano(t, destinoNome, 'já está', motivo); continue; }
    if (SIMULAR) { conta.tarefas.aMover++; linhaDoPlano(t, destinoNome, `mudar ${Object.keys(patch).join(', ')}`, motivo); continue; }
    try {
      await editarTarefa(t.id, patch);
      conta.tarefas.movidas++;
      linhaDoPlano(t, destinoNome, `mudou ${Object.keys(patch).join(', ')}`, motivo);
    } catch (e) {
      conta.tarefas.recusadas++;
      sobra(t, t.listName, `a API recusou (${e.status}): ${e.detalhe ?? e.message}`);
    }
  }

  // ---------------- 5. cartões → Funil vivo
  const DE_SISTEMA = new Set(['contrato', 'fechado']);
  const SAIDAS = new Set(['desqualificado', 'geladeira', 'perdido', 'parceiro']);
  for (const { m, t } of leads) {
    porDestino('Funil vivo (lead)');
    const jaTemLink = (t.comentarios ?? []).some((c) => /\/comercial\/lead\/[0-9a-f-]{36}/i.test(c.text ?? ''));
    if (t.archived && jaTemLink) { conta.leads.jaFeitos++; linhaDoPlano(t, 'Funil vivo', 'já está', m.motivo); continue; }
    let alvo = m.destino.etapaFunil ?? 'novo_lead';
    let motivo = m.motivo ?? '';
    if (DE_SISTEMA.has(alvo)) { motivo += ` · pedido ${alvo}: etapa de sistema; fica em proposta`; conta.leads.ficaramNaEtapaAnterior++; alvo = 'proposta'; }
    if (alvo === 'geladeira' || alvo === 'parceiro') { motivo += ` · pedido ${alvo}: falta dado obrigatório; fica em novo_lead`; conta.leads.ficaramNaEtapaAnterior++; alvo = 'novo_lead'; }
    if (SIMULAR) { conta.leads.aCriar++; conta.leads.porEtapa[alvo] = (conta.leads.porEtapa[alvo] ?? 0) + 1; linhaDoPlano(t, `Funil vivo (${alvo})`, 'lead + arquivar cartão com o link', motivo); continue; }
    try {
      const cli = m.cliente && m.cliente !== 'cli:root-interno' ? clientes.get(m.cliente)?.nome : null;
      // O dono do lead é o responsável do cartão (o principal, quando há vários).
      const idDoDono = t.assigneeUserId ?? t.responsavelId ?? t.responsaveis?.[0]?.id ?? null;
      const dono = idDoDono ? { id: idDoDono } : pessoaPorNome(t.assignee);
      const ent = await api('POST', '/leads/entrada', { origem: { tipo: 'manual', ref: `cartao:${t.id}` }, nome: String(cli || t.title).slice(0, 200), ...(dono?.id ? { ownerId: dono.id } : {}) });
      const leadId = ent.id;
      if (!UUID.test(leadId ?? '')) throw new Error('entrada sem id de lead');
      if (ent.criado) conta.leads.criados++; else conta.leads.jaExistiam++;
      const etapaAtual = async () => { const f = await api('GET', `/comercial/lead/${leadId}`); return f?.ficha?.etapa ?? f?.etapa; };
      let agora = await etapaAtual();
      if (SAIDAS.has(alvo)) {
        if (agora !== alvo) await api('POST', `/comercial/lead/${leadId}/saida`, { saida: alvo, motivo: 'outro', detalhe: `Organização de ${HOJE} · status do cartão: ${String(m.etapaOrigem ?? '').slice(0, 120)}` });
      } else if (agora !== alvo && alvo !== 'novo_lead') {
        // Escrita sensível: uma conta PEDE, a outra CONFIRMA, a primeira conclui com o token.
        const pedido = await api('POST', `/comercial/lead/${leadId}/mover/pedido`, { para: alvo });
        await chamar('POST', `/approvals/${pedido.approvalId}/confirm`, { reauth: { senha: confere.senha }, motivo: `Organização das tarefas reais (${HOJE})` }, tokConf);
        await api('POST', `/comercial/lead/${leadId}/mover`, { para: alvo }, { headers: { 'x-approval-token': pedido.token } });
        conta.leads.movidos++;
      }
      agora = (await etapaAtual()) ?? alvo;
      conta.leads.porEtapa[agora] = (conta.leads.porEtapa[agora] ?? 0) + 1;
      if (!jaTemLink) {
        const link = `${WEB}/comercial/lead/${leadId}`;
        await api('POST', `/trabalho/tarefas/${t.id}/comentarios`, { text: `Este cartão virou lead no Funil vivo na organização de ${HOJE}: ${link}` });
      }
      if (!t.archived) await arquivarTarefa(t.id);
      conta.leads.cartoesArquivados++;
      linhaDoPlano(t, `Funil vivo (${agora})`, 'lead criado/achado; cartão arquivado com o link', motivo);
    } catch (e) {
      conta.leads.recusados++;
      sobra(t, t.listName, `lead recusado (${e.status ?? 'erro'}): ${e.detalhe ?? e.message}`);
    }
  }

  // ---------------- 6/7. varredura: cliente em toda tarefa ativa das pastas nossas;
  // o que não está em mapa nenhum e não é marketing fica onde está e vira sobra.
  estrutura = await api('GET', '/trabalho/estrutura');
  idx = indexar(estrutura);
  for (const l of idx.listas.values()) {
    if (idx.ehMarketing(l.id)) { conta.marketing.intocadas += l.total ?? 0; continue; }
    if (!l.total) {
      if (!idx.daEstrutura(l.id) && !vaiPara.has(l.id)) sobra({ name: l.name }, `${l.folderName ?? '(solta)'} / ${l.name}`, 'lista fora das pastas nossas, sem tarefa ativa: fica onde está (estrutura)');
      continue;
    }
    const r = await api('GET', `/trabalho/tarefas?listId=${l.id}&limit=500`);
    const itens = r?.items ?? r ?? [];
    const nossa = idx.daEstrutura(l.id) || vaiPara.has(l.id);
    const pasta = normalizar(idx.daEstrutura(l.id) ? l.folderName : vaiPara.get(l.id));
    for (const t of itens) {
      if (!doMapa.has(t.id) && !nossa) { sobra(t, `${l.folderName ?? '(solta)'} / ${l.name}`, 'tarefa fora dos mapas e fora das pastas nossas: fica onde está'); continue; }
      if (!nossa || t.clienteId) continue;
      // Na simulação, a tarefa do mapa que ainda vai receber cliente pelo passo 4 não conta aqui.
      if (SIMULAR && doMapa.has(t.id) && doMapa.get(t.id).cliente) continue;
      if (pasta === 'administrativa' || pasta === 'gestao') {
        if (SIMULAR) { conta.varredura.aPreencher++; continue; }
        await editarTarefa(t.id, { clienteId: 'interno' });
        conta.varredura.clienteInternoPreenchido++;
      } else {
        conta.varredura.semClienteEmClientes++;
        sobra(t, `${l.folderName} / ${l.name}`, 'tarefa de Clientes sem cliente: escolher o cliente à mão');
      }
    }
  }
  const depois = retrato(idx);

  // ---------------- saídas
  mkdirSync(SAIDA, { recursive: true });
  const fim = new Date().toISOString();
  const resultado = { geradoEm: fim, simulacao: SIMULAR, api: host, antes, depois, ...conta };
  writeFileSync(path.join(SAIDA, SIMULAR ? 'contagens-simular.json' : `contagens-organizar-${fim.replace(/[:.]/g, '-')}.json`), `${JSON.stringify(resultado, null, 2)}\n`);
  writeFileSync(path.join(SAIDA, 'sobras.md'), [
    `# Sobras da organização (${fim}${SIMULAR ? ', simulação' : ''})`, '', 'Fora do git: tem título. Tudo aqui FICOU ONDE ESTAVA.', '',
    '| item | onde está | por quê | id |', '|---|---|---|---|',
    ...sobras.map((s) => `| ${celula(s.titulo)} | ${celula(s.onde)} | ${celula(s.motivo)} | ${s.id} |`), '',
  ].join('\n'));
  if (DETALHE || !SIMULAR) {
    writeFileSync(path.join(SAIDA, SIMULAR ? 'plano.md' : 'feito.md'), [
      `# ${SIMULAR ? 'Plano' : 'Feito'} da organização (${fim})`, '', 'Fora do git: tem título e cliente.', '',
      '| item | lista de origem | destino | ação | motivo | id |', '|---|---|---|---|---|---|',
      ...plano.map((l) => `| ${celula(l.titulo)} | ${celula(l.origem)} | ${celula(l.destino)} | ${celula(l.acao)} | ${celula(l.motivo)} | ${l.id} |`), '',
    ].join('\n'));
  }
  console.log(JSON.stringify(resultado, null, 2));
  const recusas = conta.tarefas.recusadas + conta.leads.recusados;
  if (recusas) { console.log(`${recusas} recusa(s): detalhe em sobras.md`); process.exitCode = 2; }
}

await main();
