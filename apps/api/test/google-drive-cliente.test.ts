import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { GoogleService } from '../src/google/google.service';
import {
  MIME_DA_PASTA,
  nomeSemColisao,
  subirAteARaiz,
} from '../src/google/drive-do-cliente';
import { planoDaPadronizacao } from '../src/google/padronizar-evento';

/*
 * O CONECTOR GOOGLE DA PASTA DO CLIENTE E DA AGENDA (rodada dos agentes, 21/10/2026, lane A4).
 *
 * Sem banco e SEM GOOGLE: um dublê de HTTP no lugar do `fetch` responde como a
 * API do Drive e da Agenda, com os itens num mapa em memória. O que se mede é o
 * que o conector MANDA: criar pasta, copiar a estrutura do `_modelo-cliente`
 * (pastas vazias e `.md`, nunca apagando nem movendo), enviar binário sem
 * sobrescrever (nome repetido ganha sufixo), subir até a raiz com teto, e pôr
 * um evento no padrão sem tocar horário nem convidados.
 */

interface ItemFalso {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed?: boolean;
  conteudo?: Buffer;
}

const drive = new Map<string, ItemFalso>();
const pedidos: Array<{ metodo: string; url: string; corpo: unknown }> = [];
let eventos: Record<string, Record<string, unknown>> = {};
let seq = 0;
const novoId = () => `gid${String(++seq).padStart(5, '0')}abcdefghij`;

function resposta(status: number, corpo: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
const doBruto = (i: ItemFalso) => ({ id: i.id, name: i.name, mimeType: i.mimeType, parents: i.parents, webViewLink: `https://exemplo.invalid/${i.id}` });

/** O `q` que o conector monta, interpretado como o Drive interpretaria (só o que o conector usa). */
function filtrar(q: string): ItemFalso[] {
  const pai = /'([^']+)' in parents/.exec(q)?.[1];
  const soPastas = q.includes(`mimeType = '${MIME_DA_PASTA}'`);
  const nome = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\(.)/g, '$1');
  return [...drive.values()].filter((i) => !i.trashed && (!pai || i.parents.includes(pai)) && (!soPastas || i.mimeType === MIME_DA_PASTA) && (nome === undefined || i.name === nome));
}

async function fetchFalso(entrada: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(entrada);
  const metodo = (init.method ?? 'GET').toUpperCase();
  let corpo: unknown = init.body;
  if (typeof corpo === 'string') {
    try {
      corpo = JSON.parse(corpo);
    } catch {
      /* texto */
    }
  }
  pedidos.push({ metodo, url, corpo });
  const u = new URL(url);

  // ---- Agenda
  const ev = /\/calendar\/v3\/calendars\/primary\/events\/([^/?]+)/.exec(u.pathname);
  if (ev) {
    const id = decodeURIComponent(ev[1]);
    const e = eventos[id];
    if (!e) return resposta(404, { error: 'not found' });
    if (metodo === 'GET') {
      // Como o Google: com `fields`, só volta o que foi pedido (o organizador inclusive).
      const campos = u.searchParams.get('fields');
      if (campos && !campos.split(',').includes('organizer')) {
        const { organizer: _fora, ...semOrganizador } = e;
        return resposta(200, { id, ...semOrganizador });
      }
      return resposta(200, { id, ...e });
    }
    if (metodo === 'PATCH') {
      const patch = corpo as Record<string, unknown>;
      Object.assign(e, patch);
      if (patch.conferenceData) e.hangoutLink = 'https://meet.invalid/abc-defg-hij';
      return resposta(200, { id, ...e });
    }
  }

  // ---- Envio (multipart e resumable)
  if (u.pathname === '/upload/drive/v3/files' && metodo === 'POST') {
    if (u.searchParams.get('uploadType') === 'multipart') {
      const bruto = Buffer.from(init.body as Buffer);
      const texto = bruto.toString('latin1');
      const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n/s.exec(bruto.toString('utf8'))![1]) as { name: string; parents: string[] };
      const partes = texto.split(/--mktos-[a-z0-9]+/);
      const segunda = partes[2];
      const inicio = segunda.indexOf('\r\n\r\n') + 4;
      const conteudo = Buffer.from(segunda.slice(inicio, segunda.length - 2), 'latin1');
      const i: ItemFalso = { id: novoId(), name: meta.name, mimeType: 'application/pdf', parents: meta.parents, conteudo };
      drive.set(i.id, i);
      return resposta(200, doBruto(i));
    }
    const meta = corpo as { name: string; parents: string[] };
    return resposta(200, '', { location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${encodeURIComponent(JSON.stringify(meta))}` });
  }
  if (u.pathname === '/upload/drive/v3/files' && metodo === 'PUT') {
    const meta = JSON.parse(u.searchParams.get('upload_id')!) as { name: string; parents: string[] };
    const i: ItemFalso = { id: novoId(), name: meta.name, mimeType: 'application/pdf', parents: meta.parents, conteudo: Buffer.from(init.body as Buffer) };
    drive.set(i.id, i);
    return resposta(200, doBruto(i));
  }

  // ---- Drive
  const copia = /^\/drive\/v3\/files\/([^/]+)\/copy$/.exec(u.pathname);
  if (copia && metodo === 'POST') {
    const o = drive.get(copia[1])!;
    const b = corpo as { name: string; parents: string[] };
    const i: ItemFalso = { id: novoId(), name: b.name, mimeType: o.mimeType, parents: b.parents, conteudo: o.conteudo };
    drive.set(i.id, i);
    return resposta(200, doBruto(i));
  }
  const um = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
  if (um && metodo === 'GET') {
    const i = drive.get(decodeURIComponent(um[1]));
    return i ? resposta(200, { ...doBruto(i), trashed: !!i.trashed }) : resposta(404, { error: 'notFound' });
  }
  if (u.pathname === '/drive/v3/files' && metodo === 'GET') {
    return resposta(200, { files: filtrar(u.searchParams.get('q') ?? '').map(doBruto) });
  }
  if (u.pathname === '/drive/v3/files' && metodo === 'POST') {
    const b = corpo as { name: string; mimeType: string; parents: string[] };
    const i: ItemFalso = { id: novoId(), name: b.name, mimeType: b.mimeType, parents: b.parents };
    drive.set(i.id, i);
    return resposta(200, doBruto(i));
  }
  return resposta(500, { error: `rota não prevista no dublê: ${metodo} ${u.pathname}` });
}

function pasta(name: string, pai: string | null): string {
  const id = novoId();
  drive.set(id, { id, name, mimeType: MIME_DA_PASTA, parents: pai ? [pai] : [] });
  return id;
}
function arquivo(name: string, pai: string, conteudo = Buffer.from('conteudo')): string {
  const id = novoId();
  drive.set(id, { id, name, mimeType: name.endsWith('.md') ? 'text/markdown' : 'application/vnd.ms-excel', parents: [pai], conteudo });
  return id;
}

const ORG = 'org-google-drive-cliente';
let google: GoogleService;
let efeitos: EfeitosRegistry;
let fetchOriginal: typeof fetch;
const auditados: Array<Record<string, unknown>> = [];

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = 'cliente-de-teste';
  process.env.GOOGLE_CLIENT_SECRET = 'segredo-de-teste';
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = fetchFalso as typeof fetch;
  const prisma = {
    googleAccount: {
      findUnique: async () => ({ orgId: ORG, accessToken: 'token-de-teste', refreshToken: null, expiresAt: new Date(Date.now() + 3_600_000), scope: '', connectedAt: new Date() }),
    },
  };
  efeitos = new EfeitosRegistry();
  google = new GoogleService(prisma as never, { log: async (a: Record<string, unknown>) => void auditados.push(a) } as never, efeitos, { registrar: () => undefined } as never);
  google.onModuleInit();
});

afterAll(() => {
  globalThis.fetch = fetchOriginal;
});

beforeEach(() => {
  drive.clear();
  pedidos.length = 0;
  eventos = {};
  auditados.length = 0;
});

describe('Drive da pasta do cliente pelo conector (dublê de HTTP)', () => {
  it('cria a pasta e copia a estrutura do modelo: pastas vazias e os .md, nunca a planilha', async () => {
    const raiz = pasta('10-clientes', null);
    const modelo = pasta('_modelo-cliente', raiz);
    const contrato = pasta('02-contrato', modelo);
    const kickoff = pasta('03-kickoff', modelo);
    arquivo('roteiro.md', kickoff);
    arquivo('LEIA-ME.md', modelo);
    arquivo('planilha.xlsx', modelo);
    arquivo('modelo-de-contrato.md', contrato);
    const antes = new Set(drive.keys());

    const nova = await google.criarPasta(ORG, raiz, 'Padaria Exemplo');
    expect(nova.mimeType).toBe(MIME_DA_PASTA);
    expect(nova.pais).toEqual([raiz]);
    const r = await google.copiarEstrutura(ORG, modelo, nova.id);
    expect(r).toEqual({ pastasCriadas: 2, arquivosCopiados: 3, jaExistiam: 0, ignorados: 1 });

    const nomes = (pai: string) => [...drive.values()].filter((i) => i.parents.includes(pai)).map((i) => i.name).sort();
    expect(nomes(nova.id)).toEqual(['02-contrato', '03-kickoff', 'LEIA-ME.md']);
    // Nada do que existia foi apagado, movido ou renomeado.
    for (const id of antes) expect(drive.get(id)?.parents).toBeDefined();
    expect(nomes(modelo)).toEqual(['02-contrato', '03-kickoff', 'LEIA-ME.md', 'planilha.xlsx']);
    expect(pedidos.some((p) => p.metodo === 'DELETE' || (p.metodo === 'PATCH' && p.url.includes('/drive/')))).toBe(false);

    // Copiar de novo não duplica: o que já existe fica como está.
    const de_novo = await google.copiarEstrutura(ORG, modelo, nova.id);
    expect(de_novo.pastasCriadas + de_novo.arquivosCopiados).toBe(0);
  });

  it('lista os filhos pelo nome exato (para ligar a pasta de mesmo nome), com aspas escapadas', async () => {
    const raiz = pasta('10-clientes', null);
    const affari = pasta("Affari d'Oro", raiz);
    pasta('Affari', raiz);
    const achados = await google.filhosDaPasta(ORG, raiz, { nome: "Affari d'Oro", soPastas: true });
    expect(achados.map((a) => a.id)).toEqual([affari]);
    const q = new URL(pedidos.at(-1)!.url).searchParams.get('q')!;
    expect(q).toContain("name = 'Affari d\\'Oro'");
    expect(q).toContain('trashed = false');
  });

  it('confere que a pasta está dentro da raiz subindo pelos pais, e recusa a de fora', async () => {
    const topo = pasta('Root', null);
    const raiz = pasta('10-clientes', topo);
    const cliente = pasta('Cliente A', raiz);
    const sub = pasta('02-contrato', cliente);
    const fora = pasta('Pessoal', topo);
    expect(await google.dentroDaRaiz(ORG, sub, raiz)).toBe(true);
    expect(await google.dentroDaRaiz(ORG, raiz, raiz)).toBe(true);
    expect(await google.dentroDaRaiz(ORG, fora, raiz)).toBe(false);
    expect(await google.dentroDaRaiz(ORG, topo, raiz)).toBe(false);
  });

  it('a subida até a raiz tem teto e não entra em laço (atalho circular)', async () => {
    const pais: Record<string, string[]> = { a: ['b'], b: ['a'] };
    expect(await subirAteARaiz('a', 'raiz', async (x) => pais[x] ?? null)).toBe(false);
    const fundo: Record<string, string[]> = {};
    for (let i = 0; i < 30; i++) fundo[`n${i}`] = [`n${i + 1}`];
    fundo.n30 = ['raiz'];
    expect(await subirAteARaiz('n0', 'raiz', async (x) => fundo[x] ?? null)).toBe(false);
    expect(await subirAteARaiz('n25', 'raiz', async (x) => fundo[x] ?? null)).toBe(true);
  });

  it('recusa nome de pasta com barra antes de chamar o Google', async () => {
    const raiz = pasta('10-clientes', null);
    await expect(google.criarPasta(ORG, raiz, 'Cliente/Outro')).rejects.toThrow(/sem barra/);
    await expect(google.criarPasta(ORG, raiz, 'Cliente\\Outro')).rejects.toThrow(/sem barra/);
    expect(pedidos.filter((p) => p.metodo === 'POST')).toEqual([]);
  });

  it('envia o binário e nome repetido ganha sufixo: nunca sobrescreve', async () => {
    const raiz = pasta('10-clientes', null);
    const sub = pasta('02-contrato', raiz);
    const original = arquivo('2026-10-21 - Contrato - Serviços.pdf', sub, Buffer.from('versao antiga'));
    const r = await google.enviarArquivo(ORG, { paiId: sub, nome: '2026-10-21 - Contrato - Serviços.pdf', tipoMime: 'application/pdf', conteudo: Buffer.from('versao nova') });
    expect(r.nome).toBe('2026-10-21 - Contrato - Serviços (2).pdf');
    expect(drive.get(original)?.conteudo?.toString()).toBe('versao antiga');
    expect(drive.get(r.id)?.conteudo?.toString()).toBe('versao nova');
    const r3 = await google.enviarArquivo(ORG, { paiId: sub, nome: '2026-10-21 - Contrato - Serviços.pdf', tipoMime: 'application/pdf', conteudo: Buffer.from('terceira') });
    expect(r3.nome).toBe('2026-10-21 - Contrato - Serviços (3).pdf');
    expect(nomeSemColisao('a.pdf', ['A.PDF'])).toBe('a (2).pdf');
  });

  it('arquivo acima de 5 MB vai por envio resumable', async () => {
    const raiz = pasta('10-clientes', null);
    const grande = Buffer.alloc(6 * 1024 * 1024, 7);
    const r = await google.enviarArquivo(ORG, { paiId: raiz, nome: 'grande.pdf', tipoMime: 'application/pdf', conteudo: grande });
    expect(drive.get(r.id)?.conteudo?.length).toBe(grande.length);
    expect(pedidos.some((p) => p.url.includes('uploadType=resumable') && p.metodo === 'POST')).toBe(true);
    expect(pedidos.some((p) => p.metodo === 'PUT')).toBe(true);
  });
});

describe('agenda.evento.padronizar pelo conector (dublê de HTTP)', () => {
  const comeco = { dateTime: '2026-10-22T14:00:00-03:00' };
  const fim = { dateTime: '2026-10-22T15:00:00-03:00' };
  const convidados = [{ email: 'cliente@exemplo.invalid' }];
  /** Quem organizou é a própria agenda (o Google manda `self: true`). */
  const DA_AGENDA = { email: 'casa@exemplo.invalid', self: true };

  it('o efeito está inscrito no registro pelo conector', () => {
    expect(efeitos.donoDe('agenda.evento.padronizar')).toBe('GoogleService');
    // Os dois do Drive são da pasta do cliente, não do conector.
    expect(efeitos.donoDe('drive.pasta.criar')).toBeNull();
    expect(efeitos.donoDe('drive.arquivo.enviar')).toBeNull();
  });

  it('troca só o título, escreve "Título original" na primeira linha e pede o Meet; horário e convidados não vão no patch', async () => {
    eventos.ev123 = { summary: 'call com padaria', description: 'pauta: preços', start: comeco, end: fim, attendees: convidados, status: 'confirmed', organizer: DA_AGENDA };
    const r = (await efeitos.executar(
      'agenda.evento.padronizar',
      { eventoId: 'ev123', tituloAtual: 'call com padaria', tituloNovo: 'Reunião Online - Padaria Exemplo - Rodrigo', adicionarMeet: true },
      { orgId: ORG, actorId: 'u1' },
    )) as { mudou: boolean; meet: string | null };
    expect(r.mudou).toBe(true);
    const patch = pedidos.find((p) => p.metodo === 'PATCH')!;
    expect(patch.url).toContain('sendUpdates=none');
    expect(patch.url).toContain('conferenceDataVersion=1');
    const corpo = patch.corpo as Record<string, unknown>;
    expect(Object.keys(corpo).sort()).toEqual(['conferenceData', 'description', 'summary']);
    expect(corpo.summary).toBe('Reunião Online - Padaria Exemplo - Rodrigo');
    expect(String(corpo.description).split('\n')[0]).toBe('Título original: call com padaria');
    expect(String(corpo.description)).toContain('pauta: preços');
    expect(eventos.ev123.start).toEqual(comeco);
    expect(eventos.ev123.end).toEqual(fim);
    expect(eventos.ev123.attendees).toEqual(convidados);
    expect(r.meet).toBeTruthy();
    expect(pedidos.some((p) => p.metodo === 'DELETE')).toBe(false);
  });

  it('não pede Meet quando o evento já tem sala, nem quando adicionarMeet é falso', async () => {
    eventos.ev2 = { summary: 'kickoff', hangoutLink: 'https://meet.invalid/ja', start: comeco, end: fim, organizer: DA_AGENDA };
    await google.padronizarEvento(ORG, { eventoId: 'ev2', tituloAtual: 'kickoff', tituloNovo: 'Reunião Online - Padaria Exemplo - Lucas', adicionarMeet: true });
    const corpo = pedidos.find((p) => p.metodo === 'PATCH')!.corpo as Record<string, unknown>;
    expect(corpo.conferenceData).toBeUndefined();
    expect(pedidos.find((p) => p.metodo === 'PATCH')!.url).not.toContain('conferenceDataVersion');
  });

  it('recusa quando o título de agora não é o que a aprovação viu: nada é escrito', async () => {
    eventos.ev3 = { summary: 'título mudado por alguém', start: comeco, end: fim, organizer: DA_AGENDA };
    await expect(
      google.padronizarEvento(ORG, { eventoId: 'ev3', tituloAtual: 'título antigo', tituloNovo: 'Reunião Online - Padaria Exemplo - Pedro', adicionarMeet: false }),
    ).rejects.toThrow(/título do evento mudou/);
    expect(pedidos.some((p) => p.metodo === 'PATCH')).toBe(false);
    expect(eventos.ev3.summary).toBe('título mudado por alguém');
  });

  it('recusa título novo fora do padrão da casa', () => {
    const p = planoDaPadronizacao({ summary: 'x', organizer: DA_AGENDA }, { tituloAtual: 'x', tituloNovo: 'Conversa qualquer', adicionarMeet: false }, 'r');
    expect(p).toMatchObject({ tipo: 'recusa', motivo: expect.stringMatching(/padrão da casa/) });
  });

  it('REVISÃO: evento organizado por OUTRA agenda (convite) é recusado; o GET pede o organizador; nada é escrito', async () => {
    eventos.ev5 = { summary: 'call com padaria', start: comeco, end: fim, attendees: convidados, organizer: { email: 'outra-pessoa@exemplo.invalid' } };
    await expect(
      google.padronizarEvento(ORG, { eventoId: 'ev5', tituloAtual: 'call com padaria', tituloNovo: 'Reunião Online - Padaria Exemplo - Pedro', adicionarMeet: true }),
    ).rejects.toThrow(/convite de outra pessoa/);
    expect(pedidos.some((p) => p.metodo === 'PATCH')).toBe(false);
    const get = pedidos.find((p) => p.metodo === 'GET' && p.url.includes('/events/ev5'))!;
    expect(new URL(get.url).searchParams.get('fields')!.split(',')).toContain('organizer');
    expect(eventos.ev5.summary).toBe('call com padaria');
    // `self: false` explícito e organizador ausente também recusam: só `true` conta.
    for (const organizer of [{ email: 'x@exemplo.invalid', self: false }, undefined]) {
      const p = planoDaPadronizacao({ summary: 'a', organizer }, { tituloAtual: 'a', tituloNovo: 'Reunião Online - Padaria Exemplo - Pedro', adicionarMeet: false }, 'r');
      expect(p.tipo).toBe('recusa');
    }
  });

  it('evento já no padrão e com sala: nada a fazer, nada é enviado', async () => {
    eventos.ev4 = { summary: 'Reunião Online - Padaria Exemplo - Pedro', hangoutLink: 'https://meet.invalid/x', organizer: DA_AGENDA };
    const r = await google.padronizarEvento(ORG, { eventoId: 'ev4', tituloAtual: 'Reunião Online - Padaria Exemplo - Pedro', tituloNovo: 'Reunião Online - Padaria Exemplo - Pedro', adicionarMeet: true });
    expect(r.mudou).toBe(false);
    expect(pedidos.some((p) => p.metodo === 'PATCH')).toBe(false);
  });
});

describe('catraca da lane A4: o cliente do Drive tem dono', () => {
  const RAIZ = path.resolve(__dirname, '../src');
  const fontes = (dir: string, acc: string[] = []): string[] => {
    for (const n of readdirSync(dir)) {
      const c = path.join(dir, n);
      if (statSync(c).isDirectory()) fontes(c, acc);
      else if (n.endsWith('.ts')) acc.push(c);
    }
    return acc;
  };
  // Sem comentário: citar o símbolo num comentário não é usá-lo.
  const semComentario = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const arquivos = fontes(RAIZ).map((f) => ({ rel: path.relative(RAIZ, f).split(path.sep).join('/'), texto: semComentario(readFileSync(f, 'utf8')) }));

  it('só a declaração, a fiação e os dois consumidores citam DRIVE_DO_CLIENTE', () => {
    const citam = arquivos.filter((a) => /\bDRIVE_DO_CLIENTE\b/.test(a.texto)).map((a) => a.rel).sort();
    expect(citam).toEqual([
      'clientes/arquivista/arquivista.service.ts',
      'clientes/pasta-do-cliente/pasta-do-cliente.service.ts',
      'google/drive-do-cliente.ts',
      'google/google.module.ts',
    ]);
  });

  it('nada em clientes/ nem em work/anexos/ importa o conector ou escreve o endereço do Google', () => {
    const daLane = arquivos.filter((a) => a.rel.startsWith('clientes/') || a.rel.startsWith('work/anexos/'));
    expect(daLane.length).toBeGreaterThan(5);
    for (const a of daLane) {
      expect(a.texto, a.rel).not.toMatch(/google\.service/);
      expect(a.texto, a.rel).not.toMatch(/https?:\/\/[\w.-]*google(apis)?\.com/);
      expect(a.texto, a.rel).not.toMatch(/\bfetch\(/);
    }
  });

  it('o conector não ganhou método de apagar nem de mover no Drive', () => {
    const conector = arquivos.find((a) => a.rel === 'google/google.service.ts')!.texto;
    expect(conector).not.toMatch(/method:\s*'DELETE'/);
    expect(conector).not.toMatch(/addParents|removeParents/);
  });
});

// O teste de laço circular usa um dublê puro; o vi está importado para o relógio de outras suítes da lane.
void vi;
