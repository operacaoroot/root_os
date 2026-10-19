// C2/C3 · o importador da cópia dos cartões do Lucas (rodada de 19/10/2026).
//
// Lê os dois mapas (homolog/copia/mapa-crm.json e mapa-gestao.json, formato em
// MAPA.md) e o staging (só leitura), e escreve no destino PELA API da stack
// rootos-copia, com as contas da importação (o importador propõe, o conferente
// confirma o que é escrita sensível). Não decide nada que o mapa já decidiu.
//
// Idempotente: a chave de origem `prod:<id>` fica no destino —
//   - tarefa: `WorkTask.externalId` (a API não aceita o campo; ver EXCECOES.md);
//   - lead: a origem da entrada `{tipo: 'manual', ref: 'prod:<id>'}` (o id do lead
//     é derivado dela, então a mesma origem é sempre o mesmo lead);
//   - cliente: o `Partner` é achado por CNPJ, senão pelo nome normalizado.
// Rodar duas vezes não duplica nada.
//
// A saída do console é SÓ de contagens. O detalhe linha a linha (com título e
// cliente) vai para homolog/copia/mapa-das-tarefas.md, fora do git.
//
// Uso:  node homolog/importar-copia/importar.mjs [--mapas a.json,b.json]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { PASTA_COPIA, UUID, apiDe, lerEnv, lerStaging, lit, sqlDestino } from './comum.mjs';

const env = lerEnv();
const api = apiDe(`http://127.0.0.1:${env.API_PORT || 4020}/api`);
const HOJE_PT = '19/10/2026';

// ---------------------------------------------------------------- argumentos
const arg = (nome) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : null;
};
const arquivosDosMapas = (arg('--mapas') ?? 'mapa-crm.json,mapa-gestao.json')
  .split(',')
  .map((a) => (path.isAbsolute(a) ? a : path.join(PASTA_COPIA, a)));

// ---------------------------------------------------------------- utilidades
const normalizar = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const digitos = (s) => String(s ?? '').replace(/\D/g, '');
// O Prisma grava `timestamp(3)` SEM fuso, em UTC; o JSON do staging chega sem o "Z".
// Sem isto o Node leria como hora local (-03:00) e a data andaria três horas.
const utc = (v) => (v ? new Date(/(Z|[+-]\d\d:?\d\d)$/.test(String(v)) ? v : `${v}Z`).toISOString() : null);
const celula = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

const contagem = {
  tarefas: { porLista: {}, criadas: 0, jaExistiam: 0, recusadas: 0, redirecionadas: 0, concluidas: 0, subtarefas: 0 },
  leads: { porEtapa: {}, criados: 0, jaExistiam: 0, movidos: 0, saidas: 0, ficaramNaEtapaAnterior: 0, recusados: 0 },
  clientes: { partners: 0, criados: 0, jaExistiam: 0, soCliente: 0 },
  fora: 0,
  comentarios: { procedencia: 0, tambemCom: 0, daProducao: 0 },
  etiquetas: { criadas: 0, usadas: 0 },
  avisos: {},
};
const avisar = (motivo) => {
  contagem.avisos[motivo] = (contagem.avisos[motivo] ?? 0) + 1;
};
const linhas = []; // mapa-das-tarefas.md

// ---------------------------------------------------------------- mapas
function lerMapas() {
  const clientes = new Map();
  const tarefas = new Map();
  for (const arq of arquivosDosMapas) {
    if (!existsSync(arq)) throw new Error(`mapa ausente: ${path.basename(arq)}`);
    const m = JSON.parse(readFileSync(arq, 'utf8'));
    for (const c of m.clientes ?? []) {
      const ja = clientes.get(c.chave);
      if (ja) {
        if (ja.cnpj && c.cnpj && digitos(ja.cnpj) !== digitos(c.cnpj)) throw new Error(`cliente com dois CNPJs nos mapas (${path.basename(arq)})`);
        ja.cnpj = ja.cnpj || c.cnpj;
      } else clientes.set(c.chave, { ...c });
    }
    for (const t of m.tarefas ?? []) {
      if (tarefas.has(t.origemId)) throw new Error(`tarefa repetida entre os mapas (${path.basename(arq)})`);
      tarefas.set(t.origemId, t);
    }
  }
  // CNPJ igual com chave diferente é erro (MAPA.md).
  const porCnpj = new Map();
  for (const c of clientes.values()) {
    const d = digitos(c.cnpj);
    if (!d) continue;
    if (porCnpj.has(d) && porCnpj.get(d) !== c.chave) throw new Error('mesmo CNPJ com duas chaves de cliente nos mapas');
    porCnpj.set(d, c.chave);
  }
  return { clientes, tarefas };
}

// ---------------------------------------------------------------- sessão
async function entrar(email, senha) {
  if (!senha) throw new Error(`senha da conta da importação ausente no .env.copia`);
  const r = await api('POST', '/auth/login', { email, password: senha });
  return r.token ?? r.accessToken;
}

// ---------------------------------------------------------------- leitura do destino
// LEITURA por SQL no destino (EXCECOES.md, item L): a API não lista usuários com
// e-mail, nem tarefa por externalId, nem etiquetas. Só SELECT, filtrado pela empresa.
function lerDestino(orgId) {
  const um = (sql) => JSON.parse(sqlDestino(sql)[0] || 'null');
  const usuarios = um(`select json_agg(json_build_object('id', id, 'email', lower(email), 'name', name)) from "User" where "orgId" = ${lit(orgId)}`) ?? [];
  const atuais = um(`select json_object_agg("externalId", json_build_object('id', id, 'listId', "listId", 'statusId', "statusId", 'clienteId', "clienteId", 'parentId', "parentId", 'archived', archived,
      'dueDate', "dueDate", 'startDate', "startDate", 'createdAt', "createdAt"))
    from "WorkTask" where "orgId" = ${lit(orgId)} and "externalId" like 'prod:%'`) ?? {};
  const tarefas = Object.fromEntries(Object.entries(atuais).map(([k, v]) => [k, v.id]));
  const etiquetas = um(`select json_object_agg(name, id) from "WorkTag" where "orgId" = ${lit(orgId)}`) ?? {};
  return { usuarios, tarefas, atuais, etiquetas };
}

// ---------------------------------------------------------------- staging
function lerOrigem(ids) {
  const lista = ids.filter((i) => UUID.test(i));
  if (lista.length === 0) return { tarefas: new Map(), usuarios: new Map(), areas: new Map(), comentarios: new Map() };
  const inIds = lista.map(lit).join(',');
  const tarefas = lerStaging(`select json_agg(json_build_object(
      'id', t.id, 'title', t.title, 'description', t.description, 'priority', t.priority,
      'dueDate', t."dueDate", 'startDate', t."startDate", 'createdAt', t."createdAt", 'parentId', t."parentId",
      'assigneeUserId', t."assigneeUserId", 'assignee', t.assignee, 'areaId', t."areaId",
      'outros', t."outrosResponsaveisIds", 'statusType', s.type, 'lista', l.name))
    from "WorkTask" t join "WorkStatus" s on s.id = t."statusId" join "WorkList" l on l.id = t."listId"
    where t.id in (${inIds})`) ?? [];
  const usuarios = lerStaging(`select json_agg(json_build_object('id', id, 'email', lower(email), 'name', name)) from "User"`) ?? [];
  const areas = lerStaging(`select json_agg(json_build_object('id', id, 'nome', nome, 'cor', cor)) from "WorkArea"`) ?? [];
  const comentarios = lerStaging(`select json_agg(json_build_object('id', id, 'taskId', "taskId", 'authorId', "authorId", 'authorName', "authorName", 'text', text, 'createdAt', "createdAt") order by "createdAt")
    from "WorkComment" where "taskId" in (${inIds})`) ?? [];
  const porTarefa = new Map();
  for (const c of comentarios) porTarefa.set(c.taskId, [...(porTarefa.get(c.taskId) ?? []), c]);
  return {
    tarefas: new Map(tarefas.map((t) => [t.id, t])),
    usuarios: new Map(usuarios.map((u) => [u.id, u])),
    areas: new Map(areas.map((a) => [a.id, a])),
    comentarios: porTarefa,
  };
}

// ---------------------------------------------------------------- main
async function main() {
  const inicio = new Date();
  const { clientes, tarefas: doMapa } = lerMapas();
  const tokImp = await entrar('importador@copia.homolog', env.COPIA_IMPORTADOR_SENHA);
  const tokConf = await entrar('conferente@copia.homolog', env.COPIA_CONFERENTE_SENHA);
  const eu = await api('GET', '/auth/me', undefined, tokImp).catch(() => null);
  const orgId = eu?.orgId ?? eu?.user?.orgId ?? sqlDestino(`select id from "Org" where slug = 'root'`)[0];
  if (!UUID.test(orgId ?? '')) throw new Error('empresa root não encontrada no destino');

  const origem = lerOrigem([...doMapa.keys()]);
  const destino = lerDestino(orgId);
  const usuarioDoDestino = (idProd) => {
    const u = origem.usuarios.get(idProd);
    return u ? destino.usuarios.find((d) => d.email === u.email) ?? null : null;
  };
  const nomeDaPessoa = (idProd) => usuarioDoDestino(idProd)?.name ?? origem.usuarios.get(idProd)?.name ?? null;

  // ---------------- clientes → Partner
  const partnerDaChave = new Map();
  const precisaPartner = new Set();
  for (const t of doMapa.values()) {
    if ((t.destino?.tipo === 'tarefa' || t.destino?.tipo === 'cliente') && t.cliente) precisaPartner.add(t.cliente);
  }
  const existentes = (await api('GET', '/finance/partners', undefined, tokImp)).items ?? [];
  const acharPartner = (c) => {
    const d = digitos(c.cnpj);
    if (d) {
      const p = existentes.find((x) => digitos(x.cnpjCpf) === d);
      if (p) return p;
    }
    const n = normalizar(c.nome);
    return existentes.find((x) => normalizar(x.razaoSocial) === n || normalizar(x.nomeFantasia) === n) ?? null;
  };
  for (const chave of precisaPartner) {
    if (chave === 'cli:root-interno') {
      partnerDaChave.set(chave, 'interno'); // a API cria/acha o Partner.interno ("Root (interno)")
      continue;
    }
    const c = clientes.get(chave);
    if (!c) {
      avisar('cliente citado na tarefa e ausente da lista de clientes do mapa');
      continue;
    }
    const ja = acharPartner(c);
    if (ja) {
      partnerDaChave.set(chave, ja.id);
      contagem.clientes.jaExistiam++;
      continue;
    }
    const r = await api('POST', '/finance/partners', { razaoSocial: String(c.nome).slice(0, 160), cnpjCpf: digitos(c.cnpj) || null, isCliente: true }, tokImp);
    partnerDaChave.set(chave, r.id);
    existentes.push({ id: r.id, razaoSocial: c.nome, nomeFantasia: null, cnpjCpf: digitos(c.cnpj) || null });
    contagem.clientes.criados++;
  }
  contagem.clientes.partners = new Set([...partnerDaChave.values()]).size;

  let internoId = null;
  async function idDoInterno() {
    if (internoId) return internoId;
    const lista = await api('GET', '/trabalho/clientes', undefined, tokImp);
    internoId = (Array.isArray(lista) ? lista : lista.items ?? []).find((c) => c.interno)?.id ?? null;
    return internoId;
  }

  // ---------------- estrutura do destino (pastas, listas, etapas)
  let estrutura = await api('GET', '/trabalho/estrutura', undefined, tokImp);
  const pastaPorNome = (n) => estrutura.folders.find((f) => !f.parentId && normalizar(f.name) === normalizar(n));
  const listaDe = (pasta, lista) => pastaPorNome(pasta)?.lists.find((l) => normalizar(l.name) === normalizar(lista)) ?? null;
  async function garantirLista(pasta, lista) {
    let l = listaDe(pasta, lista);
    if (l) return l;
    const p = pastaPorNome(pasta);
    if (!p) throw new Error('pasta do mapa não existe no destino');
    await api('POST', '/trabalho/listas', { folderId: p.id, name: lista }, tokImp);
    estrutura = await api('GET', '/trabalho/estrutura', undefined, tokImp);
    l = listaDe(pasta, lista);
    if (!l) throw new Error('lista criada e não encontrada');
    return l;
  }

  // ---------------- etiquetas (área do Lucas → WorkTag)
  async function etiquetaDaArea(areaId) {
    const a = areaId ? origem.areas.get(areaId) : null;
    if (!a) return null;
    const nome = `Área: ${a.nome}`.slice(0, 40);
    if (destino.etiquetas[nome]) return destino.etiquetas[nome];
    const corpo = { name: nome, ...(/^#[0-9a-f]{6}$/i.test(a.cor ?? '') ? { color: a.cor } : {}) };
    const r = await api('POST', '/trabalho/tags', corpo, tokImp);
    destino.etiquetas[nome] = r.id;
    contagem.etiquetas.criadas++;
    return r.id;
  }

  // ---------------- tarefas (pais antes dos filhos)
  const ordem = [...doMapa.values()].sort((a, b) => (a.paiOrigemId ? 1 : 0) - (b.paiOrigemId ? 1 : 0));
  const leads = [];
  const nomeDoCliente = (chave) => (chave === 'cli:root-interno' ? 'Root (interno)' : clientes.get(chave)?.nome ?? '');

  for (const m of ordem) {
    const t = origem.tarefas.get(m.origemId);
    const tipo = m.destino?.tipo;
    const linha = { titulo: t?.title ?? '(sem origem)', lista: m.listaOrigem, destino: '', cliente: nomeDoCliente(m.cliente), etapa: '', motivo: m.motivo ?? '', id: '' };
    linhas.push(linha);
    if (tipo === 'fora') {
      contagem.fora++;
      linha.destino = 'fora';
      continue;
    }
    if (tipo === 'cliente') {
      contagem.clientes.soCliente++;
      linha.destino = 'cliente (Partner)';
      linha.id = partnerDaChave.get(m.cliente) ?? '';
      continue;
    }
    if (!t) {
      avisar('tarefa do mapa ausente do staging');
      linha.destino = 'não encontrada no staging';
      continue;
    }
    if (tipo === 'lead') {
      leads.push({ m, t, linha });
      continue;
    }
    if (tipo !== 'tarefa') {
      avisar('destino desconhecido no mapa');
      continue;
    }

    const chaveExterna = `prod:${t.id}`;
    let pasta = m.destino.pasta;
    let lista = m.destino.lista;
    let etapaPedida = m.destino.etapa;
    // A PORTA DA IMPLANTAÇÃO (regra do nosso código, T1): o cartão de Onboarding de
    // cliente só nasce do contrato assinado no comercial (ou de "Registrar cliente já
    // fechado", que precisa do storage que esta stack não tem). Não se força: o cartão
    // vai a Clientes › Execução, com o porquê no mapa e na contagem.
    // Subtarefa cujo pai não virou tarefa (o pai foi ao funil como lead) entra solta;
    // então a porta vale para ela também.
    const paiDestino = m.paiOrigemId ? destino.tarefas[`prod:${m.paiOrigemId}`] ?? null : null;
    if (m.paiOrigemId && !paiDestino) {
      avisar(doMapa.get(m.paiOrigemId)?.destino?.tipo === 'lead' ? 'subtarefa de um cartão que virou lead (entra solta, com o cliente)' : 'subtarefa sem o pai copiado (entra solta)');
      linha.motivo += ' · o pai não é tarefa no destino: entra solta';
    }
    const ehImplantacao = normalizar(pasta) === 'clientes' && normalizar(lista) === 'onboarding de cliente' && !paiDestino;
    if (ehImplantacao) {
      lista = 'Execução';
      const fim = /encerrad/i.test(etapaPedida ?? '') || m.concluida;
      etapaPedida = fim ? 'Concluída' : /fechado no comercial/i.test(etapaPedida ?? '') ? 'A fazer' : 'Em andamento';
      linha.motivo = `${linha.motivo} · pedido Onboarding de cliente; a porta da implantação recusa cartão solto → Execução`;
      contagem.tarefas.redirecionadas++;
    }
    const chaveLista = `${pasta} / ${lista}`;
    linha.destino = chaveLista;

    if (destino.tarefas[chaveExterna]) {
      // Já copiada: só RECONCILIA com o mapa de agora (lista, etapa, cliente, pai), pela
      // rota de editar. Nada é recriado; o mapa revisado depois da 1ª passada vale aqui.
      try {
        const atual = destino.atuais[chaveExterna] ?? {};
        const l = await garantirLista(pasta, lista);
        let st = l.statuses.find((x) => normalizar(x.name) === normalizar(etapaPedida));
        if (m.concluida && (!st || st.type !== 'closed')) st = l.statuses.find((x) => x.type === 'closed') ?? st;
        st = st ?? l.statuses.find((x) => x.type !== 'closed') ?? l.statuses[0];
        const clienteId = m.cliente ? partnerDaChave.get(m.cliente) ?? null : null;
        const patch = {};
        if (atual.listId !== l.id || atual.statusId !== st.id) Object.assign(patch, { listId: l.id, statusId: st.id });
        const clienteReal = clienteId === 'interno' ? await idDoInterno() : clienteId;
        if (clienteReal && atual.clienteId !== clienteReal) patch.clienteId = clienteReal;
        if ((paiDestino ?? null) !== (atual.parentId ?? null)) patch.parentId = paiDestino;
        if (atual.archived) patch.archived = false;
        if (utc(atual.dueDate) !== utc(t.dueDate)) patch.dueDate = utc(t.dueDate);
        if (utc(atual.startDate) !== utc(t.startDate)) patch.startDate = utc(t.startDate);
        if (utc(atual.createdAt) !== utc(t.createdAt)) {
          // SQL DIRETO (EXCECOES.md, item T): a data original da produção, como na criação.
          sqlDestino(`update "WorkTask" set "createdAt" = ${lit(utc(t.createdAt))} where id = ${lit(atual.id)} and "orgId" = ${lit(orgId)}`);
          contagem.tarefas.datasCorrigidas = (contagem.tarefas.datasCorrigidas ?? 0) + 1;
        }
        if (Object.keys(patch).length) {
          await api('PATCH', `/trabalho/tarefas/${destino.tarefas[chaveExterna]}`, patch, tokImp);
          contagem.tarefas.reconciliadas = (contagem.tarefas.reconciliadas ?? 0) + 1;
        }
        linha.etapa = st.name;
      } catch (e) {
        contagem.tarefas.recusadas++;
        avisar(`reconciliação recusada (${e.status ?? 'erro'})`);
        linha.motivo += ` · RECONCILIAÇÃO RECUSADA: ${String(e.message).slice(0, 200)}`;
      }
      contagem.tarefas.jaExistiam++;
      contagem.tarefas.porLista[chaveLista] = (contagem.tarefas.porLista[chaveLista] ?? 0) + 1;
      if (m.concluida) contagem.tarefas.concluidas++;
      if (paiDestino) contagem.tarefas.subtarefas++;
      linha.id = destino.tarefas[chaveExterna];
      continue;
    }
    try {
      const l = await garantirLista(pasta, lista);
      let st = l.statuses.find((s) => normalizar(s.name) === normalizar(etapaPedida));
      if (m.concluida && (!st || st.type !== 'closed')) st = l.statuses.find((s) => s.type === 'closed') ?? st;
      if (!st) {
        st = l.statuses.find((s) => s.type !== 'closed') ?? l.statuses[0];
        linha.motivo += ' · etapa sem equivalente: primeira etapa aberta';
        avisar('etapa sem equivalente na lista de destino');
      }
      linha.etapa = st.name;
      const responsavel = (t.assigneeUserId ? nomeDaPessoa(t.assigneeUserId) : null) ?? (t.assignee || null);
      if (t.assigneeUserId && !usuarioDoDestino(t.assigneeUserId)) avisar('responsável sem conta no destino (nome copiado)');
      const tagId = await etiquetaDaArea(t.areaId);
      if (tagId) contagem.etiquetas.usadas++;
      const clienteId = m.cliente ? partnerDaChave.get(m.cliente) ?? null : null;
      if (!clienteId && !paiDestino) {
        avisar('tarefa sem cliente resolvido (recusada: toda tarefa tem cliente)');
        throw Object.assign(new Error('sem cliente resolvido'), { status: 0 });
      }
      const prioridade = ['urgente', 'alta', 'normal', 'baixa'].includes(t.priority) ? t.priority : 'normal';
      const corpo = {
        listId: l.id,
        title: String(t.title).slice(0, 300),
        description: t.description ? String(t.description).slice(0, 20000) : null,
        statusId: st.id,
        priority: prioridade,
        assignee: responsavel ? responsavel.slice(0, 120) : null,
        dueDate: utc(t.dueDate),
        startDate: utc(t.startDate),
        parentId: paiDestino,
        ...(tagId ? { tagIds: [tagId] } : {}),
        ...(clienteId ? { clienteId } : {}),
      };
      const criada = await api('POST', '/trabalho/tarefas', corpo, tokImp);
      // SQL DIRETO (EXCECOES.md, item T): a rota de criação não aceita `externalId`
      // (a chave da idempotência) nem `createdAt` (a data original da produção).
      // Gravados logo depois do POST, na mesma linha, filtrando pela empresa.
      sqlDestino(`update "WorkTask" set "externalId" = ${lit(chaveExterna)}, "createdAt" = ${lit(utc(t.createdAt))}
        where id = ${lit(criada.id)} and "orgId" = ${lit(orgId)}`);
      destino.tarefas[chaveExterna] = criada.id;
      linha.id = criada.id;

      // Comentários: procedência PRIMEIRO, depois "Também com", depois os da produção.
      await api('POST', `/trabalho/tarefas/${criada.id}/comentarios`, { text: `Copiado da produção em ${HOJE_PT} · lista de origem: ${m.listaOrigem}` }, tokImp);
      contagem.comentarios.procedencia++;
      const outros = Array.isArray(t.outros) ? t.outros : [];
      const nomesOutros = outros.map(nomeDaPessoa).filter(Boolean);
      if (nomesOutros.length) {
        await api('POST', `/trabalho/tarefas/${criada.id}/comentarios`, { text: `Também com: ${nomesOutros.join(' · ')}` }, tokImp);
        contagem.comentarios.tambemCom++;
      }
      for (const c of origem.comentarios.get(t.id) ?? []) {
        const autor = c.authorId ? usuarioDoDestino(c.authorId) : null;
        const texto = autor ? c.text : `${c.authorName ?? 'autor da produção'}: ${c.text}`;
        const r = await api('POST', `/trabalho/tarefas/${criada.id}/comentarios`, { text: String(texto).slice(0, 10000) }, tokImp);
        // SQL DIRETO (EXCECOES.md, item C): a rota grava autor = quem chama e data = agora;
        // o comentário da produção mantém o autor (quando ele existe no destino) e a data original.
        sqlDestino(`update "WorkComment" set "createdAt" = ${lit(utc(c.createdAt))}
          ${autor ? `, "authorId" = ${lit(autor.id)}, "authorName" = ${lit(autor.name)}` : ''}
          where id = ${lit(r.id)} and "taskId" = ${lit(criada.id)}`);
        contagem.comentarios.daProducao++;
      }
      contagem.tarefas.criadas++;
      contagem.tarefas.porLista[chaveLista] = (contagem.tarefas.porLista[chaveLista] ?? 0) + 1;
      if (m.concluida) contagem.tarefas.concluidas++;
      if (paiDestino) contagem.tarefas.subtarefas++;
    } catch (e) {
      contagem.tarefas.recusadas++;
      avisar(`tarefa recusada (${e.status ?? 'erro'})`);
      linha.motivo += ` · RECUSADA: ${String(e.message).slice(0, 200)}`;
    }
  }

  // ---------------- copiadas que o mapa de agora não quer mais como tarefa → arquivar
  // (o "apagar" da API é arquivar: nada some, a auditoria fica; reverte na passada seguinte
  // se o mapa voltar a pedir a tarefa).
  for (const [chave, atual] of Object.entries(destino.atuais)) {
    const m = doMapa.get(chave.slice('prod:'.length));
    if (m?.destino?.tipo === 'tarefa' || atual.archived) continue;
    await api('DELETE', `/trabalho/tarefas/${atual.id}`, undefined, tokImp);
    contagem.tarefas.arquivadasPorMapaNovo = (contagem.tarefas.arquivadasPorMapaNovo ?? 0) + 1;
  }

  // ---------------- leads → Funil vivo
  const SAIDAS = new Set(['desqualificado', 'geladeira', 'perdido', 'parceiro']);
  const DE_SISTEMA = new Set(['contrato', 'fechado']);
  for (const { m, t, linha } of leads) {
    linha.destino = 'Funil vivo';
    let alvo = m.destino.etapaFunil ?? 'novo_lead';
    try {
      const dono = t.assigneeUserId ? usuarioDoDestino(t.assigneeUserId) : null;
      const nome = String(m.cliente && m.cliente !== 'cli:root-interno' ? nomeDoCliente(m.cliente) || t.title : t.title).slice(0, 200);
      const ent = await api('POST', '/leads/entrada', { origem: { tipo: 'manual', ref: `prod:${t.id}` }, nome, ...(dono ? { ownerId: dono.id } : {}) }, tokImp);
      const leadId = ent.id;
      if (!UUID.test(leadId ?? '')) throw new Error('entrada sem id de lead');
      linha.id = leadId;
      if (!ent.criado) contagem.leads.jaExistiam++;
      else contagem.leads.criados++;
      let ficha = await api('GET', `/comercial/lead/${leadId}`, undefined, tokImp);
      const etapaAtual = () => ficha?.ficha?.etapa ?? ficha?.etapa;

      if (DE_SISTEMA.has(alvo)) {
        // contrato e fechado são etapas do SISTEMA (aceite na sala / 1ª parcela + assinaturas);
        // "Registrar cliente já fechado" exige o PDF no storage, que esta stack não tem.
        linha.motivo += ` · pedido ${alvo}: etapa de sistema; fica em proposta`;
        contagem.leads.ficaramNaEtapaAnterior++;
        avisar(`lead pedido em ${alvo}: fica em proposta (etapa de sistema; fechado-fora sem storage)`);
        alvo = 'proposta';
      }
      if (SAIDAS.has(alvo)) {
        if (alvo === 'geladeira' || alvo === 'parceiro') {
          // geladeira exige data de volta e parceiro exige para quem: a produção não tem; não se inventa.
          linha.motivo += ` · pedido ${alvo}: sem ${alvo === 'geladeira' ? 'data de volta' : 'parceiro'} na origem; fica na etapa`;
          contagem.leads.ficaramNaEtapaAnterior++;
          avisar(`lead pedido em ${alvo}: falta dado obrigatório, fica na etapa`);
        } else if (etapaAtual() !== alvo) {
          await api('POST', `/comercial/lead/${leadId}/saida`, { saida: alvo, motivo: 'outro', detalhe: `Copiado da produção em ${HOJE_PT} · status de origem: ${String(m.etapaOrigem ?? '').slice(0, 120)}` }, tokImp);
          contagem.leads.saidas++;
        }
      } else if (etapaAtual() !== alvo && alvo !== 'novo_lead') {
        // Mover é escrita sensível: o importador PEDE, o conferente CONFIRMA, o importador conclui.
        const pedido = await api('POST', `/comercial/lead/${leadId}/mover/pedido`, { para: alvo }, tokImp);
        await api('POST', `/approvals/${pedido.approvalId}/confirm`, { reauth: { senha: env.COPIA_CONFERENTE_SENHA }, motivo: `Conferência da cópia da produção (${HOJE_PT})` }, tokConf);
        await api('POST', `/comercial/lead/${leadId}/mover`, { para: alvo }, tokImp, { headers: { 'x-approval-token': pedido.token } });
        contagem.leads.movidos++;
      }
      ficha = await api('GET', `/comercial/lead/${leadId}`, undefined, tokImp);
      const final = etapaAtual() ?? alvo;
      linha.etapa = final;
      contagem.leads.porEtapa[final] = (contagem.leads.porEtapa[final] ?? 0) + 1;
    } catch (e) {
      contagem.leads.recusados++;
      avisar(`lead recusado (${e.status ?? 'erro'})`);
      linha.motivo += ` · RECUSADO: ${String(e.message).slice(0, 200)}`;
    }
  }

  // ---------------- saídas
  const fim = new Date();
  const md = [
    `# Mapa das tarefas da cópia (${fim.toISOString()})`,
    '',
    'Fora do git: tem título e nome de cliente.',
    '',
    '| tarefa | lista de origem | destino | cliente | etapa | motivo | id no destino |',
    '|---|---|---|---|---|---|---|',
    ...linhas.map((l) => `| ${celula(l.titulo)} | ${celula(l.lista)} | ${celula(l.destino)} | ${celula(l.cliente)} | ${celula(l.etapa)} | ${celula(l.motivo)} | ${l.id} |`),
    '',
  ].join('\n');
  writeFileSync(path.join(PASTA_COPIA, 'mapa-das-tarefas.md'), md);

  const contagens = {
    geradoEm: fim.toISOString(),
    tarefasPorLista: contagem.tarefas.porLista,
    tarefasTotal: Object.values(contagem.tarefas.porLista).reduce((a, b) => a + b, 0),
    tarefasConcluidas: contagem.tarefas.concluidas,
    subtarefas: contagem.tarefas.subtarefas,
    tarefasRedirecionadasDaImplantacao: contagem.tarefas.redirecionadas,
    tarefasRecusadas: contagem.tarefas.recusadas,
    leadsPorEtapa: contagem.leads.porEtapa,
    leadsTotal: Object.values(contagem.leads.porEtapa).reduce((a, b) => a + b, 0),
    partners: contagem.clientes.partners,
    fora: contagem.fora,
  };
  writeFileSync(path.join(PASTA_COPIA, 'contagens.json'), `${JSON.stringify(contagens, null, 2)}\n`);

  const recusas = contagem.tarefas.recusadas + contagem.leads.recusados;
  console.log(JSON.stringify(contagem, null, 2));
  if (recusas === 0) {
    writeFileSync(
      path.join(PASTA_COPIA, 'IMPORTADO'),
      `importado em ${fim.toISOString()} (início ${inicio.toISOString()})\n${JSON.stringify(contagens, null, 2)}\n`,
    );
    console.log('passada verde: IMPORTADO escrito');
  } else {
    console.log(`passada com ${recusas} recusa(s): IMPORTADO não escrito (detalhe em mapa-das-tarefas.md)`);
    process.exitCode = 2;
  }
}

await main();
