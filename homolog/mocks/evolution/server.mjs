// DUBLÊ DA EVOLUTION PARA A STACK DO SEED (3031) · produção 22C (22/10/2026), W5.
//
// Node puro, sem dependência, como os dublês do Asaas e da ZapSign. Emula o que o
// conector da empresa (`apps/api/src/pauta/evolution.service.ts`) usa da API v2:
//   GET  /instance/connectionState/:inst       → { instance: { instanceName, state } }
//   GET  /instance/connect/:inst               → { instance: { instanceName, state: 'open' } }
//   POST /message/sendText/:inst               { number, text } → { key: { id, remoteJid, fromMe: true }, ... }
//   POST /group/create/:inst                   { subject, participants } → metadata com `id` @g.us
//   POST /chat/findChats/:inst                 → [ { id, remoteJid, pushName, unreadCount, updatedAt, lastMessage } ]
//   POST /chat/findMessages/:inst              { where: { key: { remoteJid } }, page, offset }
//                                              → { messages: { total, pages, currentPage, records } } (mais nova primeiro)
//   GET  /group/fetchAllGroups/:inst?getParticipants=true → [ { id, subject, size, participants: [...] } ]
//   POST /chat/fetchProfilePictureUrl/:inst    { number } → { wuid, profilePictureUrl: null } (sem foto: iniciais)
// A chave vem no cabeçalho `apikey` e é conferida (401 sem ela); instância que não é a
// do dublê leva 404, como a Evolution.
//
// Rotas do próprio dublê (para o e2e; não existem na Evolution):
//   POST /simular/mensagem   monta um `messages.upsert` e o ENTREGA ao webhook da API:
//                            POST <API_URL>/api/approvals/canal/whatsapp/<orgId> com
//                            `x-canal-segredo` = HMAC-SHA256(CANAL_APROVACAO_SEGREDO, orgId)
//                            em hex (o segredo da empresa; vale também para a casa). O
//                            segredo vem SÓ da variável de ambiente do container.
//                            Corpo: { orgId?, chat: 'contato'|'lid'|'cliente'|'lead'|'equipe'|'sem-prefixo'
//                                     ou remoteJid, texto, deMim?, participante?, nome? }
//   GET  /enviadas           o que a API mandou pelo sendText (para o e2e conferir)
//   GET  /webhooks           as últimas entregas ao webhook (status, sem corpo da API)
//   POST /simular/reiniciar  volta ao estado inicial (conversas, mensagens, enviadas)
//   GET  /                   saúde
//
// TUDO FICTÍCIO: números da faixa 55329000000xx, nomes de exemplo. Os grupos
// `ROOT | Rede Pão Bom` (cliente) e `ROOT | Café Serra` (lead) usam nomes da semente
// comercial da 3031 (`apps/api/prisma/seed-comercial/roteiro.ts`), que já são fictícios.
// Nada é gravado em disco: reiniciar o container volta ao início.
import { createServer } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';

const PORTA = Number(process.env.PORT ?? 8080);
const INSTANCIA = process.env.EVOLUTION_INSTANCIA ?? 'rootos';
const CHAVE = process.env.EVOLUTION_CHAVE ?? 'chave-do-duble-evolution';
const API_URL = (process.env.API_URL ?? 'http://api:4001').replace(/\/+$/, '');
const ORG_PADRAO = process.env.WEBHOOK_ORG_ID ?? '';
const SEGREDO = (process.env.CANAL_APROVACAO_SEGREDO ?? '').trim();

/** O número fictício do próprio WhatsApp da casa no dublê. */
export const NUMERO_DA_CASA = '5532900000000';

const agora = () => Math.floor(Date.now() / 1000);
let seq = 0;
const novoId = () => `DUBLE${Date.now().toString(36).toUpperCase()}${(++seq).toString(36).toUpperCase()}${randomBytes(2).toString('hex').toUpperCase()}`;

/*
 * As conversas do dublê. `chave` é o apelido que o e2e usa em /simular/mensagem.
 */
function estadoInicial() {
  const t = agora();
  const conversas = [
    { chave: 'contato', remoteJid: '5532900000001@s.whatsapp.net', grupo: false, nome: 'Contato Exemplo' },
    // O 1:1 no modo @lid: a Evolution manda o `@lid` e o número real ao lado (remoteJidAlt).
    { chave: 'lid', remoteJid: '190000000000001@lid', alt: '5532900000002@s.whatsapp.net', grupo: false, nome: 'Contato Lid Exemplo' },
    // O 1:1 cujo número é o do lead Café Serra na semente da 3031 (casa sozinho pelo telefone).
    { chave: 'lead-telefone', remoteJid: '5511900000001@s.whatsapp.net', grupo: false, nome: 'Café Serra Contato' },
    {
      chave: 'cliente', remoteJid: '120363000000000001@g.us', grupo: true, nome: 'ROOT | Rede Pão Bom',
      participantes: [
        { id: `${NUMERO_DA_CASA}@s.whatsapp.net`, admin: 'superadmin' },
        { id: '5532900000011@s.whatsapp.net', admin: null, nome: 'Pessoa Exemplo Um' },
        { id: '190000000000012@lid', phoneNumber: '5532900000012@s.whatsapp.net', admin: null, nome: 'Pessoa Exemplo Dois' },
      ],
    },
    {
      chave: 'lead', remoteJid: '120363000000000002@g.us', grupo: true, nome: 'ROOT | Café Serra',
      participantes: [
        { id: `${NUMERO_DA_CASA}@s.whatsapp.net`, admin: 'superadmin' },
        { id: '5532900000021@s.whatsapp.net', admin: null, nome: 'Pessoa Exemplo Três' },
      ],
    },
    {
      chave: 'equipe', remoteJid: '120363000000000003@g.us', grupo: true, nome: 'ROOT | Estratégia e Produto',
      participantes: [
        { id: `${NUMERO_DA_CASA}@s.whatsapp.net`, admin: 'superadmin' },
        { id: '5532900000031@s.whatsapp.net', admin: 'admin', nome: 'Sócio Exemplo Um' },
        { id: '5532900000032@s.whatsapp.net', admin: 'admin', nome: 'Sócio Exemplo Dois' },
      ],
    },
    {
      chave: 'sem-prefixo', remoteJid: '120363000000000004@g.us', grupo: true, nome: 'Grupo de Exemplo',
      participantes: [
        { id: `${NUMERO_DA_CASA}@s.whatsapp.net`, admin: null },
        { id: '5532900000041@s.whatsapp.net', admin: 'superadmin', nome: 'Pessoa Exemplo Quatro' },
      ],
    },
  ];
  const mensagens = [];
  // Uma mensagem guardada em cada conversa, para a sincronização ter o que puxar.
  const iniciais = {
    contato: 'Olá, gostaria de saber mais sobre o serviço.',
    lid: 'Bom dia, recebi o contato de vocês.',
    'lead-telefone': 'Podemos marcar a reunião para a próxima semana?',
    cliente: 'Segue o relatório do mês para conferência.',
    lead: 'Combinado, aguardo a proposta.',
    equipe: 'Pauta da reunião de produto anexada.',
    'sem-prefixo': 'Mensagem de exemplo no grupo.',
  };
  let i = 0;
  for (const c of conversas) {
    const p = c.grupo ? c.participantes.find((x) => !x.id.startsWith(NUMERO_DA_CASA)) : null;
    mensagens.push(registro(c, { texto: iniciais[c.chave], deMim: false, participante: p, ts: t - 3600 + i * 60 }));
    i += 1;
  }
  return { conversas, mensagens, enviadas: [], webhooks: [] };
}

/** Um registro de mensagem no formato que a Evolution v2 guarda (e o webhook manda em `data`). */
function registro(c, { texto, deMim, participante, ts, id, nome }) {
  const key = { remoteJid: c.remoteJid, fromMe: !!deMim, id: id ?? novoId() };
  if (c.alt) key.remoteJidAlt = c.alt;
  if (c.grupo && !deMim && participante) {
    key.participant = participante.id;
    if (participante.phoneNumber) key.participantAlt = participante.phoneNumber;
  }
  return {
    id: randomBytes(12).toString('hex'),
    key,
    pushName: deMim ? 'Root (dublê)' : nome ?? (c.grupo ? participante?.nome ?? 'Participante Exemplo' : c.nome),
    participant: key.participant,
    messageType: 'conversation',
    message: { conversation: texto },
    contextInfo: null,
    source: deMim ? 'web' : 'android',
    messageTimestamp: ts ?? agora(),
    instanceId: 'instancia-do-duble',
    status: deMim ? 'SERVER_ACK' : 'DELIVERY_ACK',
    MessageUpdate: [],
  };
}

let estado = estadoInicial();

function json(res, status, corpo) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
}
async function lerCorpo(req) {
  const partes = [];
  for await (const p of req) partes.push(p);
  const bruto = Buffer.concat(partes).toString('utf8');
  if (!bruto) return {};
  try {
    return JSON.parse(bruto);
  } catch {
    return {};
  }
}

const conversaPorJid = (jid) => estado.conversas.find((c) => c.remoteJid === jid || (c.alt && c.alt === jid));
const doChat = (jid) => estado.mensagens.filter((m) => m.key.remoteJid === jid);
const ultimaDe = (jid) => doChat(jid).sort((a, b) => b.messageTimestamp - a.messageTimestamp)[0] ?? null;

function chats() {
  return estado.conversas.map((c) => {
    const ultima = ultimaDe(c.remoteJid);
    return {
      id: `chat-${c.remoteJid}`,
      remoteJid: c.remoteJid,
      pushName: c.grupo ? null : c.nome,
      name: c.grupo ? c.nome : undefined,
      profilePicUrl: null,
      updatedAt: new Date((ultima?.messageTimestamp ?? agora()) * 1000).toISOString(),
      unreadCount: c.naoLidas ?? 0,
      lastMessage: ultima,
      ...(c.alt ? { remoteJidAlt: c.alt } : {}),
    };
  });
}

function grupos() {
  return estado.conversas
    .filter((c) => c.grupo)
    .map((c) => ({
      id: c.remoteJid,
      subject: c.nome,
      subjectOwner: `${NUMERO_DA_CASA}@s.whatsapp.net`,
      subjectTime: agora() - 86_400,
      pictureUrl: null,
      size: c.participantes.length,
      creation: agora() - 30 * 86_400,
      owner: `${NUMERO_DA_CASA}@s.whatsapp.net`,
      desc: null,
      restrict: false,
      announce: false,
      isCommunity: false,
      isCommunityAnnounce: false,
      participants: c.participantes.map(({ id, admin, phoneNumber }) => ({ id, admin: admin ?? null, ...(phoneNumber ? { phoneNumber } : {}) })),
    }));
}

/** Entrega um `messages.upsert` ao webhook da API, com o segredo da empresa. */
async function entregarAoWebhook(orgId, dados) {
  const reg = { em: new Date().toISOString(), orgId: orgId.slice(0, 8), status: null, erro: null };
  if (!SEGREDO) reg.erro = 'CANAL_APROVACAO_SEGREDO vazio no dublê: nada entregue';
  else if (!orgId) reg.erro = 'sem orgId (mande no corpo ou em WEBHOOK_ORG_ID)';
  else {
    const segredo = createHmac('sha256', SEGREDO).update(orgId, 'utf8').digest('hex');
    try {
      const r = await fetch(`${API_URL}/api/approvals/canal/whatsapp/${encodeURIComponent(orgId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-canal-segredo': segredo },
        body: JSON.stringify({
          event: 'messages.upsert',
          instance: INSTANCIA,
          data: dados,
          destination: `${API_URL}/api/approvals/canal/whatsapp/${orgId}`,
          date_time: new Date().toISOString(),
          sender: `${NUMERO_DA_CASA}@s.whatsapp.net`,
          server_url: 'http://evolution_duble:8080',
        }),
      });
      reg.status = r.status;
      // O corpo da resposta da API não é guardado (pode ecoar o que chegou); só o motivo curto.
      if (!r.ok) reg.erro = `a API respondeu ${r.status}`;
    } catch (e) {
      reg.erro = String(e?.message ?? e).slice(0, 200);
    }
  }
  estado.webhooks.unshift(reg);
  estado.webhooks = estado.webhooks.slice(0, 50);
  return reg;
}

const ROTA_DA_EVOLUTION = /^\/(instance\/connectionState|instance\/connect|message\/sendText|group\/create|chat\/findChats|chat\/findMessages|group\/fetchAllGroups|chat\/fetchProfilePictureUrl)\/([^/]+)$/;

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://duble');
  const metodo = req.method ?? 'GET';
  try {
    // ---------------- rotas do dublê ----------------
    if (metodo === 'GET' && url.pathname === '/') {
      return json(res, 200, { ok: true, servico: 'dublê da Evolution (homologação)', instancia: INSTANCIA, conversas: estado.conversas.length, segredo: SEGREDO ? 'configurado' : 'vazio' });
    }
    if (metodo === 'GET' && url.pathname === '/enviadas') return json(res, 200, estado.enviadas);
    if (metodo === 'GET' && url.pathname === '/webhooks') return json(res, 200, estado.webhooks);
    if (metodo === 'POST' && url.pathname === '/simular/reiniciar') {
      estado = estadoInicial();
      return json(res, 200, { ok: true });
    }
    if (metodo === 'POST' && url.pathname === '/simular/mensagem') {
      const c = await lerCorpo(req);
      const conversa = estado.conversas.find((x) => x.chave === c.chat) ?? conversaPorJid(String(c.chat ?? c.remoteJid ?? ''));
      if (!conversa) return json(res, 400, { erro: `conversa desconhecida: use ${estado.conversas.map((x) => x.chave).join(', ')}` });
      if (typeof c.texto !== 'string' || !c.texto.trim()) return json(res, 400, { erro: 'texto obrigatório' });
      const quem = typeof c.participante === 'string' ? c.participante.replace(/\D/g, '') : '';
      const participante = conversa.grupo
        ? ((quem && conversa.participantes.find((p) => p.id.startsWith(quem) || String(p.phoneNumber ?? '').startsWith(quem))) ||
          conversa.participantes.find((p) => !p.id.startsWith(NUMERO_DA_CASA)))
        : null;
      const r = registro(conversa, { texto: c.texto, deMim: !!c.deMim, participante, nome: typeof c.nome === 'string' ? c.nome : undefined });
      estado.mensagens.push(r);
      if (!c.deMim) conversa.naoLidas = (conversa.naoLidas ?? 0) + 1;
      const entrega = await entregarAoWebhook(String(c.orgId ?? ORG_PADRAO), r);
      return json(res, entrega.status && entrega.status < 400 ? 200 : 502, { mensagemId: r.key.id, remoteJid: conversa.remoteJid, webhook: entrega });
    }

    // ---------------- rotas da Evolution ----------------
    const m = ROTA_DA_EVOLUTION.exec(url.pathname);
    if (!m) return json(res, 404, { status: 404, error: 'Not Found', response: { message: ['rota não emulada pelo dublê'] } });
    if (req.headers.apikey !== CHAVE) return json(res, 401, { status: 401, error: 'Unauthorized', response: { message: 'Unauthorized' } });
    const [, rota, bruto] = m;
    const inst = decodeURIComponent(bruto);
    if (inst !== INSTANCIA) return json(res, 404, { status: 404, error: 'Not Found', response: { message: [`The "${inst}" instance does not exist`] } });
    const corpo = metodo === 'POST' ? await lerCorpo(req) : {};

    if (metodo === 'GET' && rota === 'instance/connectionState') return json(res, 200, { instance: { instanceName: INSTANCIA, state: 'open' } });
    if (metodo === 'GET' && rota === 'instance/connect') return json(res, 200, { instance: { instanceName: INSTANCIA, state: 'open' } });

    if (metodo === 'POST' && rota === 'message/sendText') {
      if (typeof corpo.text !== 'string' || typeof corpo.number !== 'string') {
        return json(res, 400, { status: 400, error: 'Bad Request', response: { message: ['number e text obrigatórios'] } });
      }
      const remoteJid = /@(g\.us|lid|s\.whatsapp\.net)$/.test(corpo.number) ? corpo.number : `${corpo.number.replace(/\D/g, '')}@s.whatsapp.net`;
      let conversa = conversaPorJid(remoteJid);
      if (!conversa) {
        conversa = { chave: `nova-${estado.conversas.length}`, remoteJid, grupo: remoteJid.endsWith('@g.us'), nome: null, participantes: [] };
        estado.conversas.push(conversa);
      }
      const r = registro(conversa, { texto: corpo.text, deMim: true });
      estado.mensagens.push(r);
      estado.enviadas.push({ em: new Date().toISOString(), number: corpo.number, remoteJid: conversa.remoteJid, text: corpo.text, id: r.key.id });
      return json(res, 201, { key: { id: r.key.id, remoteJid: r.key.remoteJid, fromMe: true }, pushName: r.pushName, message: r.message, messageType: 'conversation', messageTimestamp: r.messageTimestamp, status: 'PENDING' });
    }

    if (metodo === 'POST' && rota === 'group/create') {
      if (typeof corpo.subject !== 'string' || !Array.isArray(corpo.participants) || !corpo.participants.length) {
        return json(res, 400, { status: 400, error: 'Bad Request', response: { message: ['subject e participants obrigatórios'] } });
      }
      const id = `1203630${String(Date.now()).slice(-11)}@g.us`;
      estado.conversas.push({
        chave: `grupo-${estado.conversas.length}`, remoteJid: id, grupo: true, nome: corpo.subject,
        participantes: [{ id: `${NUMERO_DA_CASA}@s.whatsapp.net`, admin: 'superadmin' }, ...corpo.participants.map((p) => ({ id: `${String(p).replace(/\D/g, '')}@s.whatsapp.net`, admin: null }))],
      });
      return json(res, 201, { id, subject: corpo.subject, size: corpo.participants.length + 1, participants: [] });
    }

    if (metodo === 'POST' && rota === 'chat/findChats') return json(res, 200, chats());
    if (metodo === 'GET' && rota === 'group/fetchAllGroups') return json(res, 200, grupos());

    if (metodo === 'POST' && rota === 'chat/findMessages') {
      const jid = String(corpo?.where?.key?.remoteJid ?? '');
      const pagina = Math.max(1, Math.floor(Number(corpo.page) || 1));
      const porPagina = Math.min(100, Math.max(1, Math.floor(Number(corpo.offset) || 50)));
      const todas = (jid ? doChat(jid) : estado.mensagens.slice()).sort((a, b) => b.messageTimestamp - a.messageTimestamp);
      const total = todas.length;
      const pages = Math.ceil(total / porPagina);
      const records = todas.slice((pagina - 1) * porPagina, pagina * porPagina);
      return json(res, 200, { messages: { total, pages, currentPage: pagina, records } });
    }

    if (metodo === 'POST' && rota === 'chat/fetchProfilePictureUrl') {
      return json(res, 200, { wuid: String(corpo.number ?? ''), profilePictureUrl: null });
    }

    return json(res, 404, { status: 404, error: 'Not Found', response: { message: ['rota não emulada pelo dublê'] } });
  } catch (e) {
    return json(res, 500, { status: 500, error: 'Internal Server Error', response: { message: [String(e?.message ?? e).slice(0, 200)] } });
  }
});

servidor.listen(PORTA, '0.0.0.0', () => {
  console.log(`dublê da Evolution na porta ${PORTA} · instância ${INSTANCIA} · webhook em ${API_URL} · segredo ${SEGREDO ? 'configurado' : 'vazio'}`);
});
