import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ActorType, Prisma, type PautaFonte } from '@prisma/client';

import {
  DIAS_DA_JANELA_DO_GMAIL,
  TETO_DA_NOTA,
  TETO_DE_EMAILS_POR_COLETA,
  TETO_DO_TEXTO,
  capturaDoEmail,
  consultaDaEtiqueta,
  hashDoEmail,
  lerEtiqueta,
  textoLimpoDoEmail,
  veioDoGmail,
} from '../src/pauta/gmail-da-pauta';
import { normalizarUrlDaCaptura } from '../src/pauta/url-da-captura';
import { ColetaService, TIPOS_DA_COLETA_DA_RODADA, atorDaColeta } from '../src/pauta/coleta.service';
import { ColetorGmailService } from '../src/pauta/coletor-gmail.service';
import { PautaService } from '../src/pauta/pauta.service';
import type { RssService } from '../src/pauta/rss.service';
import { GoogleService } from '../src/google/google.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import type { ToolCallRequest, ToolCallResult, ToolGateway } from '../src/gateway/tool-gateway.service';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/*
 * GMAIL COMO FONTE DA PAUTA — MC2.
 *
 * Três camadas, todas sem banco e sem Nest:
 *   1. a parte pura (`pauta/gmail-da-pauta.ts`): a etiqueta que vira busca, o
 *      permalink que vira chave de deduplicação e o corpo que vira nota;
 *   2. a coleta de ponta a ponta com o GoogleService DE VERDADE — as mesmas
 *      capacidades R0 registradas no mesmo registro de efeitos, chamadas pela
 *      mesma porta — e só o `fetch` trocado por um Gmail de mentira (a técnica
 *      de `vault-no-drive.test.ts`). É o que o "pronto quando" mede: capturas
 *      deduplicadas, e Google ausente vira erro na fonte sem derrubar a rodada;
 *   3. o que muda no PautaService: a permissão para cadastrar a fonte, o perfil
 *      inscrito no mesmo despacho e o processamento que não abre o permalink.
 */

const ORG = '7c0f0a8e-2222-4a5a-9c1e-00000000mc02';

/** O formato do permalink que o conector monta (`link` em gmailRecent/gmailGet). */
const permalinkDoEmail = (id: string) => `https://mail.google.com/mail/u/0/#all/${id}`;
const PESSOA = 'b1d2c3e4-0000-4000-8000-000000000001';

// ---------------------------------------------------------------------------
// 1. A parte pura
// ---------------------------------------------------------------------------

describe('gmail da pauta: a etiqueta', () => {
  it('etiqueta simples passa como está, em minúsculas', () => {
    expect(lerEtiqueta('Newsletters')).toEqual({ etiqueta: 'newsletters' });
  });

  it('espaço e etiqueta aninhada viram hífen, como o Gmail mostra', () => {
    expect(lerEtiqueta('  IA / Newsletters da semana ')).toEqual({ etiqueta: 'ia-newsletters-da-semana' });
  });

  it('aceita quem cola com o prefixo label:', () => {
    expect(lerEtiqueta('label:pauta-l')).toEqual({ etiqueta: 'pauta-l' });
  });

  it('acento é letra', () => {
    expect(lerEtiqueta('Notícias')).toEqual({ etiqueta: 'notícias' });
  });

  it('vazia é erro legível', () => {
    expect(lerEtiqueta('   ')).toEqual({ erro: expect.stringContaining('exige a etiqueta') });
    expect(lerEtiqueta(null)).toHaveProperty('erro');
  });

  it('não deixa a etiqueta virar outra busca: dois-pontos, aspas e parênteses são recusados', () => {
    for (const tentativa of ['ia OR in:inbox', 'x" OR "y', '(ia)', 'ia {inbox}', 'news,in:sent']) {
      expect(lerEtiqueta(tentativa), tentativa).toHaveProperty('erro');
    }
  });

  it('recusa as pastas do próprio Gmail — a caixa inteira não entra na pauta', () => {
    for (const sistema of ['INBOX', 'sent', 'Spam', 'starred', 'important', 'unread', 'category_promotions']) {
      expect(lerEtiqueta(sistema), sistema).toEqual({ erro: expect.stringContaining('pasta do próprio Gmail') });
    }
  });

  it('a busca é a da etiqueta na janela da semana', () => {
    expect(consultaDaEtiqueta('newsletters')).toBe(`label:newsletters newer_than:${DIAS_DA_JANELA_DO_GMAIL}d`);
    expect(DIAS_DA_JANELA_DO_GMAIL).toBe(7);
  });
});

describe('gmail da pauta: a chave e o texto', () => {
  it('dois e-mails são duas chaves — e é por isso que o permalink NÃO passa pela normalização da tela', () => {
    expect(hashDoEmail(permalinkDoEmail('a1'))).toBe(hashDoEmail(permalinkDoEmail('a1')));
    expect(hashDoEmail(permalinkDoEmail('a1'))).not.toBe(hashDoEmail(permalinkDoEmail('a2')));
    // A normalização apaga o fragmento, e o id mora nele: tudo viraria a mesma captura.
    expect(normalizarUrlDaCaptura(permalinkDoEmail('a1'))).toBe(normalizarUrlDaCaptura(permalinkDoEmail('a2')));
  });

  it('HTML de newsletter vira texto corrido: sem tag, sem estilo, com entidade decodificada', () => {
    const html =
      '<html><head><style>.x{color:red}</style><title>t</title></head><body>' +
      '<div style="display:none">\u034F \u200C \u034F \u200C \u034F</div><h1>A semana em IA</h1>' +
      '<p>O modelo novo custa &lt;metade&gt; &amp; roda local&nbsp;&#8212; veja.</p>' +
      '<p><a href="https://t.exemplo/c/abc">Leia mais</a></p><script>alert(1)</script></body></html>';
    const t = textoLimpoDoEmail(html);
    expect(t).toContain('A semana em IA');
    expect(t).toContain('O modelo novo custa <metade> & roda local — veja.');
    expect(t).toContain('Leia mais');
    expect(t).not.toMatch(/color:red|alert|<\/?(p|div|h1|a|html)\b|display/);
    expect(t).not.toMatch(/[\u200B-\u200D\u034F]/);
  });

  it('texto puro perde os links de rastreio e as linhas em branco em excesso', () => {
    const t = textoLimpoDoEmail(
      'Oi,\r\n\r\n\r\n\r\nSaiu a ferramenta X <https://click.exemplo/xyz>.\nLeia (https://t.co/abc) ' +
        'ou [https://l.exemplo/q] ou https://bit.ly/zzz\n\n\nAbraço',
    );
    expect(t).toBe('Oi,\n\nSaiu a ferramenta X .\nLeia ou ou\n\nAbraço');
  });

  it('o e-mail vira captura: assunto no título, trecho limpo na nota, procedência no bruto', () => {
    const c = capturaDoEmail(
      {
        id: 'm1',
        link: permalinkDoEmail('m1'),
        from: 'The Batch <thebatch@exemplo.ai>',
        subject: '  Modelos   pequenos, custo menor ',
        date: 'Tue, 22 Sep 2026 10:00:00 +0000',
        snippet: 'Modelos pequenos &amp; baratos',
        body: '<p>Corpo</p>',
      },
      'newsletters',
    );
    expect(c.url).toBe(permalinkDoEmail('m1'));
    expect(c.urlHash).toBe(hashDoEmail(permalinkDoEmail('m1')));
    expect(c.titulo).toBe('Modelos pequenos, custo menor');
    expect(c.nota).toBe('Corpo');
    expect(c.bruto).toEqual({
      origem: 'gmail',
      mensagemId: 'm1',
      etiqueta: 'newsletters',
      remetente: 'The Batch <thebatch@exemplo.ai>',
      data: 'Tue, 22 Sep 2026 10:00:00 +0000',
      publicadoEm: '2026-09-22T10:00:00.000Z',
      // O trecho da API vem com entidade mesmo sem tag.
      resumo: 'Modelos pequenos & baratos',
      texto: 'Corpo',
    });
    expect(veioDoGmail(c.bruto)).toBe(true);
    expect(veioDoGmail({ origem: 'whatsapp' })).toBe(false);
  });

  it('corpo longo é cortado na nota, e o texto inteiro fica no bruto para a ficha', () => {
    const longo = 'palavra '.repeat(1000).trim();
    const c = capturaDoEmail({ id: 'm2', link: permalinkDoEmail('m2'), from: null, subject: null, date: 'lixo', snippet: '', body: longo }, 'x');
    expect(c.titulo).toBe('(sem assunto)');
    expect(c.nota!.length).toBeLessThanOrEqual(TETO_DA_NOTA + 1);
    expect(c.nota!.endsWith('…')).toBe(true);
    expect(c.bruto.texto).toBe(longo);
    expect(c.bruto.publicadoEm).toBeNull();
  });

  it('sem corpo, o trecho do Gmail segura a nota', () => {
    const c = capturaDoEmail(
      { id: 'm3', link: permalinkDoEmail('m3'), from: null, subject: 'S', date: null, snippet: 'só o trecho d&#39;ele', body: '' },
      'x',
    );
    expect(c.nota).toBe("só o trecho d'ele");
  });

  // Metade de par substituto derruba o `create` do Prisma ("unexpected end of hex escape").
  const temSubstitutoSolto = (t: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(t);

  it('emoji na fronteira dos tetos não sai partido no texto, na nota nem no título', () => {
    const corpo = `${'a'.repeat(TETO_DO_TEXTO - 1)}😀 fim`;
    const assunto = `${'b'.repeat(299)}😀`;
    const c = capturaDoEmail(
      { id: 'm4', link: permalinkDoEmail('m4'), from: null, subject: assunto, date: null, snippet: '', body: corpo },
      'x',
    );
    expect(c.bruto.texto).toBe('a'.repeat(TETO_DO_TEXTO - 1));
    expect(temSubstitutoSolto(c.bruto.texto)).toBe(false);
    expect(temSubstitutoSolto(c.nota!)).toBe(false);
    expect(temSubstitutoSolto(c.titulo)).toBe(false);

    const nota = capturaDoEmail(
      { id: 'm5', link: permalinkDoEmail('m5'), from: null, subject: 's', date: null, snippet: '', body: `${'c'.repeat(TETO_DA_NOTA - 1)}😀😀` },
      'x',
    ).nota!;
    expect(nota).toBe(`${'c'.repeat(TETO_DA_NOTA - 1)}…`);
  });

  it('o par que já chega partido (corpo cortado em 20.000 pelo conector, entidade solta) sai do texto', () => {
    // O link de rastreio sai na limpeza e o texto cai abaixo do teto: o corte não salva o fim.
    const cortadoPeloConector = `Abre https://t.exemplo/${'x'.repeat(19_971)} fim 😀`.slice(0, 20_000);
    expect(temSubstitutoSolto(cortadoPeloConector)).toBe(true);
    const c = capturaDoEmail(
      {
        id: 'm6', link: permalinkDoEmail('m6'), from: 'Ana \uD83D <a@exemplo.com>', subject: 'Oi \uDE00',
        date: null, snippet: 'trecho &#xD83D;', body: cortadoPeloConector,
      },
      'x',
    );
    expect(c.bruto.texto).toBe('Abre fim');
    expect(temSubstitutoSolto(c.bruto.texto + c.nota + c.titulo + c.bruto.resumo + c.bruto.remetente)).toBe(false);
    expect(textoLimpoDoEmail('<p>ok &#xD83D;</p>')).toBe('ok');
  });

  it('HTML cortado dentro do <style> não vira CSS na nota; <head> sem fechamento termina no <body>', () => {
    const cortado =
      '<html><head><title>News</title><style>.c{color:#333;font-family:Arial}\n.c{margin:0}\n.d{padding:4px';
    expect(textoLimpoDoEmail(cortado)).toBe('');

    const semFecharHead = '<html><head><meta charset="utf-8"><title>T</title><body><p>O conteúdo.</p></body></html>';
    expect(textoLimpoDoEmail(semFecharHead)).toBe('O conteúdo.');

    const scriptCortado = '<p>Antes do script.</p><script>var x = "<p>não</p>";';
    expect(textoLimpoDoEmail(scriptCortado)).toBe('Antes do script.');
  });
});

// ---------------------------------------------------------------------------
// 2. A coleta de ponta a ponta, com o Gmail de mentira
// ---------------------------------------------------------------------------

interface EmailFalso {
  id: string;
  etiquetas: string[];
  de: string;
  assunto: string;
  data: string;
  html?: string;
  texto?: string;
  /** Some entre a busca e a leitura: a lista o traz, o `format=full` devolve 404. */
  sumido?: boolean;
}

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

interface RespostaFalsa {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text: () => Promise<string>;
}

/** Responde às três URLs que o conector chama, e anota o que viu. */
function gmailFalso(caixa: EmailFalso[]) {
  const vistos = { consultas: [] as string[], abertos: [] as string[], limites: [] as string[] };
  const fetchFalso = vi.fn(async (url: string): Promise<RespostaFalsa> => {
    const u = new URL(url);
    const ok = (corpo: unknown): RespostaFalsa => ({ ok: true, status: 200, json: async () => corpo, text: async () => '' });

    if (u.pathname === '/gmail/v1/users/me/messages') {
      const q = u.searchParams.get('q') ?? '';
      vistos.consultas.push(q);
      vistos.limites.push(u.searchParams.get('maxResults') ?? '');
      const etiqueta = q.match(/label:(\S+)/)?.[1];
      const achados = caixa.filter((m) => etiqueta && m.etiquetas.includes(etiqueta));
      return ok(achados.length ? { messages: achados.map((m) => ({ id: m.id, threadId: m.id })) } : {});
    }

    const um = u.pathname.match(/^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/);
    if (um) {
      const m = caixa.find((x) => x.id === decodeURIComponent(um[1]));
      if (!m) return { ok: false, status: 404, text: async () => 'not found' };
      const headers = [
        { name: 'From', value: m.de },
        { name: 'Subject', value: m.assunto },
        { name: 'Date', value: m.data },
      ];
      if (u.searchParams.get('format') === 'metadata') return ok({ id: m.id, snippet: m.assunto, labelIds: [], payload: { headers } });
      if (m.sumido) return { ok: false, status: 404, text: async () => 'not found' };
      vistos.abertos.push(m.id);
      const parts = [
        ...(m.texto !== undefined ? [{ mimeType: 'text/plain', body: { data: b64url(m.texto) } }] : []),
        ...(m.html !== undefined ? [{ mimeType: 'text/html', body: { data: b64url(m.html) } }] : []),
      ];
      return ok({ id: m.id, snippet: m.assunto, payload: { mimeType: 'multipart/alternative', headers, parts } });
    }

    throw new Error(`o Gmail de mentira não esperava esta chamada: ${url}`);
  });
  return { fetchFalso, vistos };
}

type ModoDaPorta = 'executar' | 'reter' | 'recusar';

/**
 * O `ToolGateway` reduzido ao que a porta usa dele. A decisão de política não
 * é o que se mede aqui (`porta.test.ts` mede); o que importa é que o efeito
 * chamado seja o do registro, com o contexto que a porta montou.
 */
function gatewayFalso() {
  const pedidos: Array<ToolCallRequest<Record<string, unknown>>> = [];
  let modo: ModoDaPorta = 'executar';
  let leiturasAntesDeReter: number | null = null;
  const gateway = {
    async executar(
      req: ToolCallRequest<Record<string, unknown>>,
      efeito: (args: Record<string, unknown>, ctx: ToolCallRequest['ctx']) => Promise<unknown>,
    ): Promise<ToolCallResult> {
      pedidos.push(req);
      const reterEsta =
        req.capabilityId === 'comunicacao.email.ler' && leiturasAntesDeReter !== null && leiturasAntesDeReter-- <= 0;
      if (modo === 'reter' || reterEsta) {
        return {
          status: 'aguardando_aprovacao', approvalId: 'ap-1', resumo: 'r', expiraEm: '2026-09-30T00:00:00Z',
          toolCallId: 't', decisao: { nivel: 'R3' } as never,
        };
      }
      if (modo === 'recusar') {
        return { status: 'recusado', motivo: 'O conector Gmail está desligado nesta empresa.', toolCallId: 't', decisao: {} as never };
      }
      try {
        return { status: 'executado', resultado: await efeito(req.args, req.ctx), toolCallId: 't', decisao: {} as never };
      } catch (e) {
        return { status: 'erro', mensagem: (e as Error).message, toolCallId: 't' };
      }
    },
  };
  return {
    gateway: gateway as unknown as ToolGateway,
    pedidos,
    mudar: (m: ModoDaPorta) => (modo = m),
    /** A política passa a reter a LEITURA depois de `n` e-mails abertos — a sobrescrita chega no meio da lista. */
    reterLeituraDepoisDe: (n: number) => (leiturasAntesDeReter = n),
  };
}

interface CapturaGravada {
  id: string;
  orgId: string;
  fonteId: string | null;
  tipo: string;
  url: string | null;
  urlHash: string;
  titulo: string | null;
  nota: string | null;
  bruto: unknown;
  capturadoPor: string | null;
  apifyRunId?: string | null;
}

function prismaDeMentira(opcoes: { googleConectado?: boolean } = {}) {
  const fontes: PautaFonte[] = [];
  const capturas: CapturaGravada[] = [];
  const auditoria: Array<Record<string, unknown>> = [];
  let seq = 0;
  let corridaNaProximaEscrita = false;
  const escritasRecusadas = new Set<string>();

  const prisma = {
    googleAccount: {
      findUnique: async () =>
        opcoes.googleConectado === false
          ? null
          : { accessToken: 'token-de-mentira', refreshToken: 'r', expiresAt: new Date(Date.now() + 3_600_000), scope: '', connectedAt: new Date() },
    },
    pautaFonte: {
      findMany: async ({ where }: { where: { orgId: string; ativo: boolean; tipo: { in: string[] } } }) =>
        fontes.filter((f) => f.orgId === where.orgId && f.ativo === where.ativo && where.tipo.in.includes(f.tipo)),
      findFirst: async ({ where }: { where: { id: string; orgId: string } }) =>
        fontes.find((f) => f.id === where.id && f.orgId === where.orgId) ?? null,
      create: async ({ data }: { data: Partial<PautaFonte> }) => {
        const f = novaFonte({ ...data, id: `fonte-${++seq}` });
        fontes.push(f);
        return f;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<PautaFonte> }) => {
        const f = fontes.find((x) => x.id === where.id)!;
        Object.assign(f, data);
        return f;
      },
    },
    pautaCaptura: {
      findUnique: async ({ where }: { where: { orgId_urlHash: { orgId: string; urlHash: string } } }) => {
        const { orgId, urlHash } = where.orgId_urlHash;
        const c = capturas.find((x) => x.orgId === orgId && x.urlHash === urlHash);
        return c ? { id: c.id } : null;
      },
      create: async ({ data }: { data: Omit<CapturaGravada, 'id'> }) => {
        if (data.url && escritasRecusadas.has(data.url)) throw new Error('unexpected end of hex escape');
        if (corridaNaProximaEscrita) {
          corridaNaProximaEscrita = false;
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'teste' });
        }
        if (capturas.some((x) => x.orgId === data.orgId && x.urlHash === data.urlHash)) {
          throw new Error('violou @@unique([orgId, urlHash]) — a deduplicação falhou');
        }
        const c: CapturaGravada = { ...data, id: `captura-${++seq}` };
        capturas.push(c);
        return c;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<CapturaGravada> }) => {
        const c = capturas.find((x) => x.id === where.id)!;
        Object.assign(c, data);
        return c;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditoria.push(data);
        return data;
      },
    },
  };

  return {
    prisma: prisma as unknown as PrismaService,
    fontes,
    capturas,
    auditoria,
    correrNaProximaEscrita: () => {
      corridaNaProximaEscrita = true;
    },
    recusarEscritaDe: (url: string) => escritasRecusadas.add(url),
  };
}

function novaFonte(dados: Partial<PautaFonte>): PautaFonte {
  return {
    id: 'fonte-x',
    orgId: ORG,
    tipo: 'gmail',
    nome: 'Newsletters',
    url: null,
    handle: 'newsletters',
    plataforma: 'gmail',
    ativo: true,
    intervaloMin: 720,
    tetoRunsMes: 30,
    runsNoMes: 0,
    mesReferente: null,
    ultimaLeitura: null,
    ultimoErro: null,
    criadaEm: new Date('2026-09-01T00:00:00Z'),
    ...dados,
  } as PautaFonte;
}

const CAIXA: EmailFalso[] = [
  {
    id: 'n1', etiquetas: ['newsletters'], de: 'The Batch <b@exemplo.ai>', assunto: 'Agentes na planilha',
    data: 'Mon, 21 Sep 2026 12:00:00 +0000', html: '<p>Agentes agora editam planilhas.</p>',
  },
  {
    id: 'n2', etiquetas: ['newsletters'], de: 'Ben <ben@exemplo.com>', assunto: 'Preço do modelo caiu',
    data: 'Tue, 22 Sep 2026 12:00:00 +0000', texto: 'O preço caiu pela metade.', html: '<p>ignorado</p>',
  },
  {
    id: 'pessoal', etiquetas: ['inbox'], de: 'Banco <nao-responda@banco.exemplo>', assunto: 'Seu extrato',
    data: 'Tue, 22 Sep 2026 13:00:00 +0000', texto: 'Saldo: R$ 1.234,56',
  },
];

const ambienteGoogle = { id: process.env.GOOGLE_CLIENT_ID, segredo: process.env.GOOGLE_CLIENT_SECRET };

function montar(opcoes: { googleConectado?: boolean; caixa?: EmailFalso[] } = {}) {
  const banco = prismaDeMentira(opcoes);
  const audit = new AuditService(banco.prisma);
  const efeitos = new EfeitosRegistry();
  const google = new GoogleService(
    banco.prisma,
    audit,
    efeitos,
    { registrar: () => undefined } as never,
  );
  google.onModuleInit();
  const { fetchFalso, vistos } = gmailFalso(opcoes.caixa ?? CAIXA);
  vi.stubGlobal('fetch', fetchFalso);

  const gw = gatewayFalso();
  const porta = new PortaDoOperador(gw.gateway, efeitos);
  const gmail = new ColetorGmailService(banco.prisma, audit, porta);
  const feeds: string[] = [];
  const rss = {
    ler: async (url: string) => {
      feeds.push(url);
      return [
        { titulo: 'Notícia do feed', url: 'https://noticia.exemplo/a?utm_source=x', publicadoEm: null, resumo: 'r' },
      ];
    },
  } as unknown as RssService;
  const coleta = new ColetaService(banco.prisma, rss, gmail);
  return { ...banco, coleta, gmail, porta, gw, vistos, fetchFalso, feeds };
}

describe('gmail da pauta: a coleta pela porta', () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'cliente-de-teste';
    process.env.GOOGLE_CLIENT_SECRET = 'segredo-de-teste';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (ambienteGoogle.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = ambienteGoogle.id;
    if (ambienteGoogle.segredo === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = ambienteGoogle.segredo;
  });

  it('fonte gmail com etiqueta: uma captura por e-mail da etiqueta, e só dela', async () => {
    const m = montar();
    const fonte = novaFonte({ id: 'f-gmail' });
    m.fontes.push(fonte);

    const r = await m.coleta.coletar(fonte, PESSOA);

    expect(r).toEqual({ novas: 2, repetidas: 0 });
    expect(m.vistos.consultas).toEqual(['label:newsletters newer_than:7d']);
    expect(m.vistos.limites).toEqual([String(TETO_DE_EMAILS_POR_COLETA)]);
    expect(TETO_DE_EMAILS_POR_COLETA).toBe(50);
    expect(m.capturas.map((c) => c.titulo).sort()).toEqual(['Agentes na planilha', 'Preço do modelo caiu']);
    expect(m.capturas.every((c) => c.fonteId === 'f-gmail' && c.tipo === 'link' && c.capturadoPor === PESSOA)).toBe(true);
    expect(m.capturas.map((c) => c.url).sort()).toEqual([permalinkDoEmail('n1'), permalinkDoEmail('n2')]);
    expect(JSON.stringify(m.capturas)).not.toContain('extrato');
  });

  it('o corpo vira nota: HTML limpo quando é o que há, texto puro quando existe', async () => {
    const m = montar();
    const fonte = novaFonte({ id: 'f-gmail' });
    m.fontes.push(fonte);
    await m.coleta.coletar(fonte, PESSOA);

    const porId = (id: string) => m.capturas.find((c) => c.url === permalinkDoEmail(id))!;
    expect(porId('n1').nota).toBe('Agentes agora editam planilhas.');
    expect(porId('n2').nota).toBe('O preço caiu pela metade.');
    expect(porId('n2').bruto).toMatchObject({
      origem: 'gmail', mensagemId: 'n2', etiqueta: 'newsletters', remetente: 'Ben <ben@exemplo.com>',
      publicadoEm: '2026-09-22T12:00:00.000Z',
    });
  });

  it('coletar de novo não duplica — e nem abre de novo o e-mail que já é captura', async () => {
    const m = montar();
    const fonte = novaFonte({ id: 'f-gmail' });
    m.fontes.push(fonte);

    await m.coleta.coletar(fonte, PESSOA);
    const r = await m.coleta.coletar(fonte, 'rotina');

    expect(r).toEqual({ novas: 0, repetidas: 2 });
    expect(m.capturas).toHaveLength(2);
    expect(m.vistos.abertos.sort()).toEqual(['n1', 'n2']);
  });

  it('corrida com a outra coleta (P2002) conta como repetida, não como erro', async () => {
    const m = montar();
    const fonte = novaFonte({ id: 'f-gmail' });
    m.fontes.push(fonte);
    m.correrNaProximaEscrita();

    const r = await m.coleta.coletar(fonte, PESSOA);

    expect(r).toEqual({ novas: 1, repetidas: 1 });
    expect(fonte.ultimoErro).toBeNull();
  });

  it('registra a leitura na fonte e uma linha de auditoria com o que entrou', async () => {
    const m = montar();
    const fonte = novaFonte({ id: 'f-gmail', ultimoErro: 'erro de ontem' });
    m.fontes.push(fonte);

    await m.coleta.coletar(fonte, PESSOA);

    expect(fonte.ultimaLeitura).toBeInstanceOf(Date);
    expect(fonte.ultimoErro).toBeNull();
    const linha = m.auditoria.find((a) => a.action === 'pauta.coleta_gmail')!;
    expect(linha).toMatchObject({ orgId: ORG, actorId: PESSOA, actorType: ActorType.user, entityId: 'f-gmail' });
    expect((linha.after as { capturas: string[] }).capturas).toHaveLength(2);
  });

  it('lê pelas duas capacidades R0 da porta, com quem pediu — e a rotina aparece como sistema', async () => {
    const m = montar();
    const fonte = novaFonte({ id: 'f-gmail' });
    m.fontes.push(fonte);

    await m.coleta.coletar(fonte, 'rotina');

    expect(m.gw.pedidos.map((p) => p.capabilityId)).toEqual([
      'comunicacao.email.buscar', 'comunicacao.email.ler', 'comunicacao.email.ler',
    ]);
    expect(m.gw.pedidos.every((p) => p.ctx.actorType === ActorType.system && p.ctx.actorId === 'rotina')).toBe(true);
    expect(m.gw.pedidos.every((p) => p.ctx.orgId === ORG)).toBe(true);
    expect(atorDaColeta(PESSOA)).toEqual({ id: PESSOA, tipo: ActorType.user });
    expect(atorDaColeta('sistema').tipo).toBe(ActorType.system);
  });

  it('Google não conectado na empresa vira erro legível na fonte, sem captura', async () => {
    const m = montar({ googleConectado: false });
    const fonte = novaFonte({ id: 'f-gmail' });
    m.fontes.push(fonte);

    await expect(m.coleta.coletar(fonte, PESSOA)).rejects.toThrow('Google não conectado. Conecte em Integrações.');

    expect(fonte.ultimoErro).toBe('Google não conectado. Conecte em Integrações.');
    expect(fonte.ultimaLeitura).toBeNull();
    expect(m.capturas).toHaveLength(0);
    expect(m.fetchFalso).not.toHaveBeenCalled();
  });

  it('o interruptor do conector Gmail desligado também para a coleta, com o motivo na fonte', async () => {
    const m = montar();
    const fonte = novaFonte({ id: 'f-gmail' });
    m.fontes.push(fonte);
    m.gw.mudar('recusar');

    await expect(m.coleta.coletar(fonte, PESSOA)).rejects.toBeInstanceOf(ForbiddenException);
    expect(fonte.ultimoErro).toBe('O conector Gmail está desligado nesta empresa.');
  });

  it('leitura retida pela política da empresa vira erro que diz por quê', async () => {
    const m = montar();
    const fonte = novaFonte({ id: 'f-gmail' });
    m.fontes.push(fonte);
    m.gw.mudar('reter');

    await expect(m.coleta.coletar(fonte, PESSOA)).rejects.toThrow(/retida para aprovação \(R3\)/);
    expect(fonte.ultimoErro).toMatch(/só roda com a leitura em R0/);
  });

  it('etiqueta inválida gravada na fonte vira erro sem nem chamar o Gmail', async () => {
    const m = montar();
    const fonte = novaFonte({ id: 'f-gmail', handle: 'inbox' });
    m.fontes.push(fonte);

    await expect(m.coleta.coletar(fonte, PESSOA)).rejects.toThrow(/pasta do próprio Gmail/);
    expect(m.gw.pedidos).toHaveLength(0);
    expect(fonte.ultimoErro).toMatch(/pasta do próprio Gmail/);
  });

  it('um e-mail que some ou não grava não tranca a etiqueta: os outros entram, com auditoria, e a fonte conta as falhas', async () => {
    const caixa: EmailFalso[] = [
      { id: 'novo-sumido', etiquetas: ['newsletters'], de: 'x', assunto: 'Apagado', data: 'Wed, 23 Sep 2026 12:00:00 +0000', sumido: true },
      { id: 'n-ruim', etiquetas: ['newsletters'], de: 'x', assunto: 'Ruim', data: 'Wed, 23 Sep 2026 11:00:00 +0000', texto: 'r' },
      ...CAIXA,
    ];
    const m = montar({ caixa });
    m.recusarEscritaDe(permalinkDoEmail('n-ruim'));
    const fonte = novaFonte({ id: 'f-gmail' });
    m.fontes.push(fonte);

    await expect(m.coleta.coletar(fonte, PESSOA)).rejects.toThrow(/2 de 4 e-mail\(s\) da etiqueta não entraram \(2 entraram\)/);

    expect(m.capturas.map((c) => c.titulo).sort()).toEqual(['Agentes na planilha', 'Preço do modelo caiu']);
    expect(fonte.ultimoErro).toMatch(/2 de 4/);
    const linha = m.auditoria.find((a) => a.action === 'pauta.coleta_gmail')!;
    expect(linha.after).toMatchObject({ falhas: 2 });
    expect((linha.after as { capturas: string[] }).capturas).toHaveLength(2);

    // Na coleta seguinte só os dois que falharam são tentados de novo.
    m.gw.pedidos.length = 0;
    await expect(m.coleta.coletar(fonte, 'rotina')).rejects.toThrow(/2 de 4/);
    expect(m.gw.pedidos.filter((p) => p.capabilityId === 'comunicacao.email.ler')).toHaveLength(2);
  });

  it('leitura retida no meio da lista para a coleta, e o que já entrou fica com a linha de auditoria', async () => {
    const m = montar({
      caixa: [
        ...CAIXA,
        { id: 'n3', etiquetas: ['newsletters'], de: 'x', assunto: 'Terceira', data: 'Wed, 23 Sep 2026 12:00:00 +0000', texto: 't' },
      ],
    });
    const fonte = novaFonte({ id: 'f-gmail' });
    m.fontes.push(fonte);
    m.gw.reterLeituraDepoisDe(1);

    await expect(m.coleta.coletar(fonte, 'rotina')).rejects.toThrow(/retida para aprovação \(R3\)/);

    // Parou na primeira retida: uma aprovação na fila, não uma por e-mail.
    expect(m.gw.pedidos.filter((p) => p.capabilityId === 'comunicacao.email.ler')).toHaveLength(2);
    expect(m.capturas).toHaveLength(1);
    const linha = m.auditoria.find((a) => a.action === 'pauta.coleta_gmail')!;
    expect((linha.after as { capturas: string[] }).capturas).toEqual([m.capturas[0].id]);
    expect(fonte.ultimoErro).toMatch(/volte a leitura para R0 ou pause a fonte/);
  });

  it('lista cheia no teto do conector entra inteira e deixa o aviso na fonte, sem ser erro', async () => {
    const cheia: EmailFalso[] = Array.from({ length: TETO_DE_EMAILS_POR_COLETA }, (_, i) => ({
      id: `cheia-${i}`, etiquetas: ['newsletters'], de: 'x', assunto: `Edição ${i}`,
      data: 'Wed, 23 Sep 2026 12:00:00 +0000', texto: `corpo ${i}`,
    }));
    const m = montar({ caixa: cheia });
    const fonte = novaFonte({ id: 'f-gmail' });
    m.fontes.push(fonte);

    const r = await m.coleta.coletar(fonte, PESSOA);

    expect(r.novas).toBe(TETO_DE_EMAILS_POR_COLETA);
    expect(fonte.ultimaLeitura).toBeInstanceOf(Date);
    expect(fonte.ultimoErro).toMatch(/teto de uma coleta; os mais antigos podem ter ficado de fora/);
  });
});

describe('gmail da pauta: o despacho e a rodada', () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'cliente-de-teste';
    process.env.GOOGLE_CLIENT_SECRET = 'segredo-de-teste';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (ambienteGoogle.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = ambienteGoogle.id;
    if (ambienteGoogle.segredo === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = ambienteGoogle.segredo;
  });

  // A busca (MC3) e o perfil (MC4) também entram na rodada; os testes deles moram
  // em `pauta-busca.test.ts` e `pauta-perfil.test.ts`.
  it('a rodada coleta RSS e Gmail; manual e fonte pausada ficam de fora', async () => {
    const m = montar();
    m.fontes.push(
      novaFonte({ id: 'f-rss', tipo: 'rss', url: 'https://feed.exemplo/rss', handle: null }),
      novaFonte({ id: 'f-gmail' }),
      novaFonte({ id: 'f-manual', tipo: 'manual', handle: null, plataforma: 'whatsapp' }),
      novaFonte({ id: 'f-pausada', ativo: false, handle: 'outra' }),
    );

    const r = await m.coleta.coletarDaRodada(ORG, 'rotina');

    expect(TIPOS_DA_COLETA_DA_RODADA).toEqual(['rss', 'gmail', 'busca', 'perfil']);
    expect(r).toEqual({ novas: 3, fontes: 2, erros: 0, puladas: 0 });
    expect(m.feeds).toEqual(['https://feed.exemplo/rss']);
    expect(m.capturas.filter((c) => c.fonteId === 'f-rss')).toHaveLength(1);
    expect(m.capturas.filter((c) => c.fonteId === 'f-gmail')).toHaveLength(2);
  });

  it('Google ausente não derruba a rodada: o RSS entra e o erro fica só na fonte do Gmail', async () => {
    const m = montar({ googleConectado: false });
    const rss = novaFonte({ id: 'f-rss', tipo: 'rss', url: 'https://feed.exemplo/rss', handle: null });
    const gmail = novaFonte({ id: 'f-gmail' });
    m.fontes.push(gmail, rss);

    const r = await m.coleta.coletarDaRodada(ORG, 'rotina');

    expect(r).toEqual({ novas: 1, fontes: 2, erros: 1, puladas: 0 });
    expect(gmail.ultimoErro).toBe('Google não conectado. Conecte em Integrações.');
    expect(rss.ultimoErro).toBeNull();
    expect(rss.ultimaLeitura).toBeInstanceOf(Date);
  });

  it('o RSS continua com a chave dele: a mesma matéria de novo não vira outra captura', async () => {
    const m = montar();
    const rss = novaFonte({ id: 'f-rss', tipo: 'rss', url: 'https://feed.exemplo/rss', handle: null });
    m.fontes.push(rss);

    await m.coleta.coletar(rss, 'rotina');
    const r = await m.coleta.coletar(rss, 'rotina');

    expect(r).toEqual({ novas: 0, repetidas: 1 });
    expect(m.capturas[0]).toMatchObject({ url: 'https://noticia.exemplo/a?utm_source=x', capturadoPor: 'rotina' });
  });

  it('tipo sem coletor recusa com a razão, sem marcar a fonte como quebrada', async () => {
    const m = montar();
    const busca = novaFonte({ id: 'f-busca', tipo: 'busca', handle: null });
    const manual = novaFonte({ id: 'f-manual', tipo: 'manual', handle: null });
    m.fontes.push(busca, manual);

    await expect(m.coleta.coletar(busca, PESSOA)).rejects.toThrow('ainda não tem coleta automática');
    await expect(m.coleta.coletar(manual, PESSOA)).rejects.toThrow('ela recebe o que alguém cola');
    // Clicar "Coletar" numa fonte manual é engano de quem clicou, não defeito da fonte.
    expect(busca.ultimoErro).toBeNull();
    expect(manual.ultimoErro).toBeNull();
    expect(m.coleta.temColetor('gmail')).toBe(true);
    // Perfil e busca se inscrevem do PautaService, que este `montar` não constrói.
    expect(m.coleta.temColetor('perfil')).toBe(false);
    expect(m.coleta.temColetor('busca')).toBe(false);
  });

  it('um tipo tem um coletor só: a segunda inscrição estoura no arranque', () => {
    const m = montar();
    expect(() => m.coleta.registrar('gmail', async () => ({ novas: 0, repetidas: 0 }), 'Outro')).toThrow(
      /já tem coletor \(ColetorGmailService\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. O que muda no PautaService
// ---------------------------------------------------------------------------

describe('gmail da pauta: o cadastro no Radar e o processamento', () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'cliente-de-teste';
    process.env.GOOGLE_CLIENT_SECRET = 'segredo-de-teste';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (ambienteGoogle.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = ambienteGoogle.id;
    if (ambienteGoogle.segredo === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = ambienteGoogle.segredo;
  });

  function servico(apify: Record<string, unknown> = {}) {
    const m = montar();
    const svc = new PautaService(
      m.prisma,
      new AuditService(m.prisma),
      apify as never,
      {} as never,
      { configured: false } as never,
      m.coleta,
    );
    svc.onModuleInit();
    return { ...m, svc };
  }

  const COM_GMAIL = ['pauta.editar', 'gmail.ver'];

  it('cadastrar fonte do Gmail grava a etiqueta normalizada em handle, sem url', async () => {
    const { svc, fontes } = servico();
    await svc.criarFonte(
      ORG, PESSOA,
      { tipo: 'gmail', nome: 'Newsletters', handle: 'IA / Semana', url: 'https://ignorada.exemplo', ativo: true, intervaloMin: 720, tetoRunsMes: 30 },
      COM_GMAIL,
    );
    expect(fontes[0]).toMatchObject({ tipo: 'gmail', handle: 'ia-semana', url: null, plataforma: 'gmail' });
  });

  it('sem gmail.ver não cadastra: quem escolhe a etiqueta escolhe o que da caixa entra na pauta', async () => {
    const { svc, fontes } = servico();
    const tentativa = svc.criarFonte(
      ORG, PESSOA,
      { tipo: 'gmail', nome: 'N', handle: 'newsletters', ativo: true, intervaloMin: 720, tetoRunsMes: 30 },
      ['pauta.editar'],
    );
    await expect(tentativa).rejects.toBeInstanceOf(ForbiddenException);
    expect(fontes).toHaveLength(0);
  });

  it('etiqueta que alarga a busca é recusada no cadastro', async () => {
    const { svc } = servico();
    await expect(
      svc.criarFonte(ORG, PESSOA, { tipo: 'gmail', nome: 'N', handle: 'x OR in:inbox', ativo: true, intervaloMin: 720, tetoRunsMes: 30 }, COM_GMAIL),
    ).rejects.toThrow(/mudariam a busca/);
  });

  it('trocar a etiqueta, ou virar uma fonte em Gmail, pede a mesma permissão', async () => {
    const { svc, fontes } = servico();
    fontes.push(novaFonte({ id: 'f-gmail' }), novaFonte({ id: 'f-rss', tipo: 'rss', handle: null, plataforma: null }));

    await expect(svc.atualizarFonte(ORG, 'f-gmail', PESSOA, { handle: 'inbox' }, ['pauta.editar'])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.atualizarFonte(ORG, 'f-rss', PESSOA, { tipo: 'gmail' }, ['pauta.editar'])).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    await svc.atualizarFonte(ORG, 'f-gmail', PESSOA, { handle: 'Pauta L' }, COM_GMAIL);
    expect(fontes[0].handle).toBe('pauta-l');
    // Pausar não mexe na etiqueta e não pede nada além do que a rota já pede.
    await svc.atualizarFonte(ORG, 'f-gmail', PESSOA, { ativo: false }, ['pauta.editar']);
    expect(fontes[0]).toMatchObject({ ativo: false, handle: 'pauta-l' });
  });

  it('"Coletar agora" do Radar passa pelo mesmo despacho', async () => {
    const { svc, fontes, capturas } = servico();
    fontes.push(novaFonte({ id: 'f-gmail' }));
    const r = await svc.coletarFonte(ORG, 'f-gmail', PESSOA);
    expect(r).toEqual({ ok: true, novas: 2, repetidas: 0 });
    expect(capturas).toHaveLength(2);
  });

  // O teto, o run e as plataformas do perfil (MC4) são medidos em `pauta-perfil.test.ts`.
  it('o perfil se inscreve no mesmo despacho, e o erro dele fica na fonte', async () => {
    const scrapePerfil = vi.fn();
    const { svc, fontes, coleta } = servico({ configured: false, scrapePerfil });
    const perfil = novaFonte({ id: 'f-perfil', tipo: 'perfil', handle: 'alguem', plataforma: 'instagram', tetoRunsMes: 2 });
    fontes.push(perfil);

    expect(coleta.temColetor('perfil')).toBe(true);
    await expect(svc.coletarFonte(ORG, 'f-perfil', PESSOA)).rejects.toThrow(/APIFY_TOKEN/);
    expect(scrapePerfil).not.toHaveBeenCalled();
    expect(perfil).toMatchObject({ runsNoMes: 0, ultimoErro: expect.stringMatching(/APIFY_TOKEN/) });
  });

  it('processar uma captura do Gmail usa o texto guardado, sem abrir o permalink', async () => {
    const { svc } = servico();
    const abrir = vi.fn(async () => {
      throw new Error('não era para abrir o permalink da caixa de entrada');
    });
    vi.stubGlobal('fetch', abrir);
    const c = capturaDoEmail(
      { id: 'n9', link: permalinkDoEmail('n9'), from: 'x', subject: 'S', date: null, snippet: '', body: 'O texto inteiro da newsletter.' },
      'newsletters',
    );

    const coleta = await (svc as unknown as {
      coletar: (c: { id: string; url: string | null; bruto: unknown }) => Promise<{ texto: string; bruto: unknown }>;
    }).coletar({ id: 'c9', url: c.url, bruto: c.bruto });

    expect(coleta.texto).toBe('O texto inteiro da newsletter.');
    expect(coleta.bruto).toBe(c.bruto);
    expect(abrir).not.toHaveBeenCalled();
  });
});
