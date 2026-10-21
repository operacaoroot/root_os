import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/*
 * O DUBLÊ HTTP DA EVOLUTION (Rodada de produção 1, 21/10/2026, P8). Node puro.
 *
 * Emula só o que o conector da empresa usa, com a forma da API v2 (rotas
 * conferidas no código-fonte do EvolutionAPI/evolution-api):
 *   GET  /instance/connectionState/:inst → { instance: { instanceName, state } }
 *   GET  /instance/connect/:inst         → { pairingCode, code, base64, count }
 *   POST /message/sendText/:inst         { number, text } → { key: { id, remoteJid, fromMe } }
 *   POST /group/create/:inst             { subject, participants, description? } → metadata com `id` @g.us
 * Cada chave (`apikey`) é uma CONTA com as suas instâncias; chave que o dublê
 * não conhece leva 401, instância que a conta não tem leva 404. Cada pedido é
 * guardado com a chave que veio, para a suíte conferir.
 *
 * Nenhum dado do escritório Cardozo & Saggioro: chaves, instâncias e números
 * daqui são inventados.
 */

export interface PedidoNaEvolution {
  metodo: string;
  caminho: string;
  apikey: string | null;
  corpo: unknown;
}

export interface InstanciaNoDuble {
  estado: 'open' | 'connecting' | 'close';
}

export interface DubleEvolution {
  url: string;
  pedidos: PedidoNaEvolution[];
  contas: Map<string, Record<string, InstanciaNoDuble>>;
  fechar(): Promise<void>;
}

export const QR_DO_DUBLE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function lerCorpo(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let texto = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (texto += c));
    req.on('end', () => {
      try {
        resolve(texto ? JSON.parse(texto) : null);
      } catch {
        resolve(texto);
      }
    });
  });
}

export async function subirDubleEvolution(contas: Record<string, Record<string, InstanciaNoDuble>>): Promise<DubleEvolution> {
  const pedidos: PedidoNaEvolution[] = [];
  const mapa = new Map(Object.entries(contas));
  let n = 0;

  const server: Server = createServer(async (req, res) => {
    const corpo = await lerCorpo(req);
    const url = new URL(req.url ?? '/', 'http://duble');
    const apikey = typeof req.headers.apikey === 'string' ? req.headers.apikey : null;
    pedidos.push({ metodo: req.method ?? 'GET', caminho: `${url.pathname}${url.search}`, apikey, corpo });
    const responder = (status: number, json: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    const conta = apikey ? mapa.get(apikey) : undefined;
    if (!conta) return responder(401, { status: 401, error: 'Unauthorized', response: { message: 'Unauthorized' } });

    const m = /^\/(instance\/connectionState|instance\/connect|message\/sendText|group\/create)\/([^/]+)$/.exec(url.pathname);
    if (!m) return responder(404, { message: 'rota não emulada pelo dublê' });
    const [, rota, bruto] = m;
    const inst = conta[decodeURIComponent(bruto)];
    if (!inst) return responder(404, { status: 404, error: 'Not Found', response: { message: [`The "${decodeURIComponent(bruto)}" instance does not exist`] } });

    if (req.method === 'GET' && rota === 'instance/connectionState') return responder(200, { instance: { instanceName: decodeURIComponent(bruto), state: inst.estado } });
    if (req.method === 'GET' && rota === 'instance/connect') {
      if (inst.estado === 'open') return responder(200, { instance: { instanceName: decodeURIComponent(bruto), state: 'open' } });
      inst.estado = 'connecting';
      return responder(200, { pairingCode: 'WZYEH1YY', code: '2@duble,qr', base64: QR_DO_DUBLE, count: 1 });
    }
    if (req.method === 'POST' && rota === 'message/sendText') {
      const c = (corpo ?? {}) as Record<string, unknown>;
      if (typeof c.text !== 'string' || typeof c.number !== 'string') return responder(400, { status: 400, error: 'Bad Request', response: { message: ['number e text obrigatórios'] } });
      if (inst.estado !== 'open') return responder(400, { status: 400, error: 'Bad Request', response: { message: ['Connection Closed'] } });
      const remoteJid = c.number.endsWith('@g.us') ? c.number : `${c.number}@s.whatsapp.net`;
      return responder(201, { key: { remoteJid, fromMe: true, id: `EVO${++n}` }, message: { conversation: c.text }, status: 'PENDING' });
    }
    if (req.method === 'POST' && rota === 'group/create') {
      const c = (corpo ?? {}) as Record<string, unknown>;
      if (typeof c.subject !== 'string' || !Array.isArray(c.participants) || !c.participants.length) {
        return responder(400, { status: 400, error: 'Bad Request', response: { message: ['subject e participants obrigatórios'] } });
      }
      return responder(201, { id: `1203630${String(++n).padStart(11, '0')}@g.us`, subject: c.subject, size: c.participants.length + 1, participants: [] });
    }
    return responder(404, { message: 'rota não emulada pelo dublê' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const porta = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${porta}`,
    pedidos,
    contas: mapa,
    fechar: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
