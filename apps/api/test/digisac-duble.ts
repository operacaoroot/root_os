import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/*
 * O DUBLÊ HTTP DO DIGISAC (Interface 20/10, lane U6). Node puro, sem dependência.
 *
 * Emula só o que o conector usa, com a forma da documentação pública
 * (coleção Postman da DigiSac, 20/10/2026): `POST /api/v1/messages`,
 * `POST /api/v1/contacts` (grupo), `POST /api/v1/contacts/:id/add-members`,
 * `GET /api/v1/contacts/:id`, `GET /api/v1/services` e `GET /api/v1/services/:id`.
 * Cada token é uma CONTA: o dublê responde 401 para token que não conhece e
 * guarda cada pedido (com o token que veio) para a suíte conferir.
 *
 * Nenhum dado do escritório Cardozo & Saggioro: contas, números e tokens daqui
 * são inventados.
 */

export interface PedidoNoDuble {
  metodo: string;
  caminho: string;
  autorizacao: string | null;
  corpo: unknown;
}

export interface ContaNoDuble {
  servicos: Array<{ id: string; name: string; type: string; archivedAt: string | null }>;
  contatos: Record<string, { number: string; isGroup?: boolean; serviceId?: string }>;
}

export interface DubleDigisac {
  url: string;
  pedidos: PedidoNoDuble[];
  contas: Map<string, ContaNoDuble>;
  fechar(): Promise<void>;
}

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

export async function subirDubleDigisac(contas: Record<string, ContaNoDuble>): Promise<DubleDigisac> {
  const pedidos: PedidoNoDuble[] = [];
  const mapa = new Map(Object.entries(contas));
  let n = 0;

  const server: Server = createServer(async (req, res) => {
    const corpo = await lerCorpo(req);
    const url = new URL(req.url ?? '/', 'http://duble');
    const autorizacao = typeof req.headers.authorization === 'string' ? req.headers.authorization : null;
    pedidos.push({ metodo: req.method ?? 'GET', caminho: `${url.pathname}${url.search}`, autorizacao, corpo });
    const responder = (status: number, json: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    const token = autorizacao?.startsWith('Bearer ') ? autorizacao.slice(7) : '';
    const conta = mapa.get(token);
    if (!conta) return responder(401, { message: 'Unauthorized' });

    const p = url.pathname;
    if (req.method === 'POST' && p === '/api/v1/messages') {
      const c = (corpo ?? {}) as Record<string, unknown>;
      if (typeof c.text !== 'string' || !(c.contactId || (c.number && c.serviceId))) return responder(422, { message: 'text e destino obrigatórios' });
      return responder(200, { id: `msg-${++n}`, type: c.type ?? 'chat', text: c.text, isFromMe: true });
    }
    if (req.method === 'POST' && p === '/api/v1/contacts') {
      const c = (corpo ?? {}) as Record<string, unknown>;
      const id = `grp-${++n}`;
      conta.contatos[id] = { number: '', isGroup: c.isGroup === true, serviceId: String(c.serviceId ?? '') };
      return responder(200, { id, internalName: c.internalName, isGroup: c.isGroup === true, serviceId: c.serviceId });
    }
    const membros = /^\/api\/v1\/contacts\/([^/]+)\/add-members$/.exec(p);
    if (req.method === 'POST' && membros) return responder(200, { ok: true });
    const contato = /^\/api\/v1\/contacts\/([^/]+)$/.exec(p);
    if (req.method === 'GET' && contato) {
      const c = conta.contatos[decodeURIComponent(contato[1])];
      if (!c) return responder(404, { message: 'Not found' });
      return responder(200, { id: decodeURIComponent(contato[1]), isGroup: !!c.isGroup, serviceId: c.serviceId ?? null, data: { number: c.number } });
    }
    if (req.method === 'GET' && p === '/api/v1/services') return responder(200, { data: conta.servicos, total: conta.servicos.length });
    const servico = /^\/api\/v1\/services\/([^/]+)$/.exec(p);
    if (req.method === 'GET' && servico) {
      const s = conta.servicos.find((x) => x.id === decodeURIComponent(servico[1]));
      return s ? responder(200, s) : responder(404, { message: 'Not found' });
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
