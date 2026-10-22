import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  TETO_DE_LINKS_POR_MENSAGEM,
  comProcedencia,
  extrairUrls,
  lerLinksDoGrupo,
} from '../src/pauta/links-do-grupo';
import { hashDaCaptura, normalizarUrlDaCaptura } from '../src/pauta/url-da-captura';
import {
  EntradaDeLinksService,
  NOME_DA_FONTE_DO_GRUPO,
} from '../src/pauta/entrada-de-links.service';
import { EntradaDeGrupoRegistry, grupoDoEvento } from '../src/gateway/canais/entrada-de-grupo.registry';
import { CanalDeAprovacaoController } from '../src/gateway/canais/canal-de-aprovacao.controller';
import { segredoDoCanalDaEmpresa } from '../src/gateway/canais/configuracao-do-canal';
import type { CanalDeAprovacaoService } from '../src/gateway/canais/canal-de-aprovacao.service';
import { lerRespostaDeCanal } from '../src/gateway/canais/resposta-de-canal';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { contextoAtual } from '../src/common/contexto-execucao';

/*
 * O GRUPO DE LINKS DO WHATSAPP VIRA CAPTURA — MC1.
 *
 * Quatro camadas, todas sem banco e sem Nest:
 *   1. a leitura pura do webhook (`pauta/links-do-grupo.ts`);
 *   2. o registro na porta que desvia o grupo inscrito do canal de aprovação;
 *   3. o controlador do canal: o grupo de links sai para a pauta, qualquer outro
 *      grupo continua caindo no canal — que continua recusando;
 *   4. o serviço de entrada com um prisma de mentira, para o que o "pronto
 *      quando" mede: 1 captura por link, o mesmo link duas vezes = 1 captura.
 */

const GRUPO = '120363000000000001@g.us';
const OUTRO_GRUPO = '120363999999999999@g.us';
const ORG = '7c0f0a8e-1111-4a5a-9c1e-00000000mc01';

/** O formato que a Evolution v2 entrega em `messages.upsert` para mensagem de grupo. */
function payload(opcoes: {
  texto?: string;
  jid?: string;
  evento?: string;
  message?: Record<string, unknown>;
  fromMe?: boolean;
  id?: string;
}): Record<string, unknown> {
  return {
    event: opcoes.evento ?? 'messages.upsert',
    instance: 'root',
    data: {
      key: {
        remoteJid: opcoes.jid ?? GRUPO,
        fromMe: opcoes.fromMe ?? false,
        id: opcoes.id ?? '3EB0A1B2C3D4E5F6',
        participant: '5561999990000@s.whatsapp.net',
      },
      pushName: 'Pedro',
      message: opcoes.message ?? { conversation: opcoes.texto ?? '' },
      messageType: 'conversation',
      messageTimestamp: 1_790_000_000,
    },
    destination: 'https://os.exemplo/api/approvals/canal/whatsapp/org',
    date_time: '2026-09-23T10:00:00.000Z',
    sender: '5561988880000@s.whatsapp.net',
  };
}

// ---------------------------------------------------------------------------
// 1. A leitura
// ---------------------------------------------------------------------------

describe('grupo de links: a leitura do webhook', () => {
  it('link único no grupo configurado vira uma URL, com o texto e quem mandou', () => {
    const r = lerLinksDoGrupo(
      payload({ texto: 'olha esse post https://www.instagram.com/p/ABC123/?igshid=xyz' }),
      GRUPO,
    );
    expect(r).toEqual({
      tipo: 'links',
      urls: ['https://instagram.com/p/ABC123'],
      texto: 'olha esse post https://www.instagram.com/p/ABC123/?igshid=xyz',
      remetente: 'Pedro',
      mensagemId: '3EB0A1B2C3D4E5F6',
    });
  });

  it('vários links na mesma mensagem viram todas as URLs, na ordem', () => {
    const r = lerLinksDoGrupo(
      payload({
        texto: 'três pra semana:\nhttps://a.com/um\nhttp://b.com.br/dois?x=1\nhttps://c.io/tres#topo',
      }),
      GRUPO,
    );
    expect(r.tipo === 'links' && r.urls).toEqual([
      'https://a.com/um',
      'http://b.com.br/dois?x=1',
      'https://c.io/tres',
    ]);
  });

  it('mensagem sem link é ignorada', () => {
    expect(lerLinksDoGrupo(payload({ texto: 'bom dia, pessoal' }), GRUPO)).toEqual({
      tipo: 'ignorar',
      porque: 'sem-link',
    });
    // "www.x.com" sem esquema não é link colado — o WhatsApp mesmo não o trata assim.
    expect(lerLinksDoGrupo(payload({ texto: 'vejam www.site.com' }), GRUPO)).toMatchObject({
      porque: 'sem-link',
    });
  });

  it('outro grupo não passa, nem conversa direta', () => {
    expect(
      lerLinksDoGrupo(payload({ texto: 'https://a.com', jid: OUTRO_GRUPO }), GRUPO),
    ).toEqual({ tipo: 'ignorar', porque: 'outro-chat' });
    expect(
      lerLinksDoGrupo(payload({ texto: 'https://a.com', jid: '5561999990000@s.whatsapp.net' }), GRUPO),
    ).toEqual({ tipo: 'ignorar', porque: 'outro-chat' });
  });

  it('legenda de imagem conta como texto', () => {
    const r = lerLinksDoGrupo(
      payload({
        message: { imageMessage: { caption: 'print do post: https://x.com/fulano/status/42', mimetype: 'image/jpeg' } },
      }),
      GRUPO,
    );
    expect(r.tipo === 'links' && r.urls).toEqual(['https://x.com/fulano/status/42']);
  });

  it('texto estendido (com prévia do link) conta como texto', () => {
    const r = lerLinksDoGrupo(
      payload({
        message: {
          extendedTextMessage: {
            text: 'https://youtu.be/abc?si=rastreio',
            matchedText: 'https://youtu.be/abc?si=rastreio',
            title: 'Vídeo',
          },
        },
      }),
      GRUPO,
    );
    expect(r.tipo === 'links' && r.urls).toEqual(['https://youtu.be/abc']);
  });

  it('URL repetida na mesma mensagem vira uma só — inclusive com rastreio diferente', () => {
    const r = lerLinksDoGrupo(
      payload({
        texto: 'https://site.com/a e de novo https://www.site.com/a/?utm_source=zap e https://site.com/a',
      }),
      GRUPO,
    );
    expect(r.tipo === 'links' && r.urls).toEqual(['https://site.com/a']);
  });

  it('a mensagem CITADA não é lida: citar não é colar', () => {
    const r = lerLinksDoGrupo(
      payload({
        message: {
          extendedTextMessage: {
            text: 'esse aqui é bom',
            contextInfo: { quotedMessage: { conversation: 'https://citado.com/post' } },
          },
        },
      }),
      GRUPO,
    );
    expect(r).toEqual({ tipo: 'ignorar', porque: 'sem-link' });
  });

  it('só messages.upsert: edição (messages.update) não entra', () => {
    expect(
      lerLinksDoGrupo(payload({ texto: 'https://a.com', evento: 'messages.update' }), GRUPO),
    ).toEqual({ tipo: 'ignorar', porque: 'evento-desconhecido' });
  });

  it('sem grupo configurado (ou com número no lugar de grupo) a leitura fica desligada', () => {
    const p = payload({ texto: 'https://a.com' });
    expect(lerLinksDoGrupo(p, '')).toEqual({ tipo: 'ignorar', porque: 'grupo-nao-configurado' });
    expect(lerLinksDoGrupo(p, undefined)).toEqual({ tipo: 'ignorar', porque: 'grupo-nao-configurado' });
    expect(
      lerLinksDoGrupo(payload({ texto: 'https://a.com', jid: '5561999990000@s.whatsapp.net' }), '5561999990000@s.whatsapp.net'),
    ).toEqual({ tipo: 'ignorar', porque: 'grupo-nao-configurado' });
  });

  it('o JID é comparado sem caixa e sem espaço', () => {
    const r = lerLinksDoGrupo(payload({ texto: 'https://a.com' }), `  ${GRUPO.toUpperCase()} `);
    expect(r.tipo).toBe('links');
  });

  it('mensagem do próprio aparelho da instância entra — o OS não escreve no grupo de links', () => {
    expect(lerLinksDoGrupo(payload({ texto: 'https://a.com', fromMe: true }), GRUPO).tipo).toBe('links');
  });

  it('pontuação da frase sai do link; parêntese do link fica', () => {
    expect(
      extrairUrls('leiam (https://a.com/x). E https://pt.wikipedia.org/wiki/Rio_(cidade), e *https://b.com*!'),
    ).toEqual(['https://a.com/x', 'https://pt.wikipedia.org/wiki/Rio_(cidade)', 'https://b.com']);
  });

  it('esquema que não é http(s) e host sem domínio ficam de fora', () => {
    expect(extrairUrls('ftp://a.com/x javascript:alert(1) http://localhost:3000/a https://ok.com')).toEqual([
      'https://ok.com',
    ]);
  });

  it('emoji, bandeira, aspas tipográficas, angulares e reticências colados ao link ficam de fora', () => {
    expect(extrairUrls('https://x.com/a🔥')).toEqual(['https://x.com/a']);
    expect(extrairUrls('olha https://x.com/a👇 top')).toEqual(['https://x.com/a']);
    expect(extrairUrls('“https://x.com/a”')).toEqual(['https://x.com/a']);
    expect(extrairUrls('‘https://x.com/b’')).toEqual(['https://x.com/b']);
    expect(extrairUrls('https://x.com/a…')).toEqual(['https://x.com/a']);
    expect(extrairUrls('«https://x.com/a»')).toEqual(['https://x.com/a']);
    expect(extrairUrls('https://x.com/a❤️ e https://x.com/b🇧🇷')).toEqual(['https://x.com/a', 'https://x.com/b']);
    // letra acentuada é do link
    expect(extrairUrls('https://pt.wikipedia.org/wiki/São_Paulo👍')).toEqual([
      normalizarUrlDaCaptura('https://pt.wikipedia.org/wiki/São_Paulo'),
    ]);
  });

  it('sublinhado, asterisco e til no fim só saem quando abriram antes do link', () => {
    expect(extrairUrls('segue https://x.com/fulano_')).toEqual(['https://x.com/fulano_']);
    expect(extrairUrls('_https://x.com/a_ e ~https://x.com/b~')).toEqual(['https://x.com/a', 'https://x.com/b']);
    expect(extrairUrls('_*https://x.com/c*_.')).toEqual(['https://x.com/c']);
  });

  it('dois links colados só com vírgula são dois', () => {
    expect(extrairUrls('https://a.com/x,https://b.com/y')).toEqual(['https://a.com/x', 'https://b.com/y']);
    expect(extrairUrls('https://a.com/busca?q=1,2')).toEqual(['https://a.com/busca?q=1,2']);
  });

  it('IP literal e nome interno não viram captura — processar faria fetch do servidor', () => {
    expect(
      extrairUrls(
        [
          'http://169.254.169.254/latest/meta-data',
          'http://172.17.0.1:4001/api',
          'http://[::1]:3000/',
          'http://0x7f.1/',
          'http://2130706433/',
          'http://api.internal/x',
          'http://impressora.local/',
          'http://app.localhost/',
          'https://ok.com.br/p',
        ].join(' '),
      ),
    ).toEqual(['https://ok.com.br/p']);
  });

  it(`uma mensagem gera no máximo ${TETO_DE_LINKS_POR_MENSAGEM} URLs`, () => {
    const texto = Array.from({ length: 50 }, (_, i) => `https://s${i}.com/p`).join(' ');
    expect(extrairUrls(texto)).toHaveLength(TETO_DE_LINKS_POR_MENSAGEM);
  });
});

describe('grupo de links: a procedência sobrevive ao processamento', () => {
  it('quem mandou e qual mensagem continuam no bruto que a coleta devolve', () => {
    const anterior = { origem: 'whatsapp', remetente: 'Pedro', mensagemId: 'M1' };
    expect(comProcedencia(anterior, { html: '<p>oi</p>' })).toEqual({
      html: '<p>oi</p>',
      origem: 'whatsapp',
      remetente: 'Pedro',
      mensagemId: 'M1',
    });
    expect(comProcedencia(anterior, { ownerUsername: 'fulano', origem: 'apify' })).toMatchObject({
      ownerUsername: 'fulano',
      origem: 'whatsapp',
      remetente: 'Pedro',
    });
  });

  it('captura que não veio do grupo fica com o bruto da coleta, sem nada a mais', () => {
    const novo = { html: '<p>oi</p>' };
    expect(comProcedencia(null, novo)).toBe(novo);
    expect(comProcedencia({ texto: 'colado na tela' }, novo)).toBe(novo);
  });
});

describe('grupo de links: a chave de deduplicação é a mesma da captura pela tela', () => {
  it('normaliza igual ao que o PautaService sempre fez e usa o mesmo sha256', () => {
    const url = normalizarUrlDaCaptura('https://www.Site.com/a/?utm_source=x&fbclid=y&id=7#topo');
    expect(url).toBe('https://site.com/a/?id=7');
    expect(hashDaCaptura(url)).toBe(createHash('sha256').update(url).digest('hex'));
  });

  it('a URL da leitura já sai na forma que vira urlHash', () => {
    const r = lerLinksDoGrupo(payload({ texto: 'https://www.site.com/a/' }), GRUPO);
    expect(r.tipo === 'links' && r.urls[0]).toBe(normalizarUrlDaCaptura('https://www.site.com/a/'));
  });
});

// ---------------------------------------------------------------------------
// 2. O registro na porta
// ---------------------------------------------------------------------------

describe('grupo de links: o registro de entrada por grupo', () => {
  it('só aceita inscrição de JID de grupo', () => {
    const reg = new EntradaDeGrupoRegistry();
    expect(reg.registrar('5561999990000@s.whatsapp.net', async () => 'x', 'teste')).toBe(false);
    expect(reg.registrar('', async () => 'x', 'teste')).toBe(false);
    expect(reg.registrar(GRUPO, async () => 'x', 'teste')).toBe(true);
    expect(reg.inscrito(GRUPO.toUpperCase())).toBe(true);
  });

  it('despacha o grupo inscrito e devolve null para o resto', async () => {
    const reg = new EntradaDeGrupoRegistry();
    const chamado = vi.fn(async () => 'capturadas:1');
    reg.registrar(GRUPO, chamado, 'teste');

    expect(await reg.despachar(ORG, payload({ texto: 'https://a.com' }))).toBe('capturadas:1');
    expect(chamado).toHaveBeenCalledWith(ORG, expect.anything());

    expect(await reg.despachar(ORG, payload({ texto: 'https://a.com', jid: OUTRO_GRUPO }))).toBeNull();
    expect(await reg.despachar(ORG, payload({ texto: 'APROVAR ROOT-AB12CD34', jid: '5561999990000@s.whatsapp.net' }))).toBeNull();
    expect(await reg.despachar(ORG, payload({ texto: 'https://a.com', evento: 'messages.update' }))).toBeNull();
    expect(chamado).toHaveBeenCalledTimes(1);
  });

  it('sem inscrito, nada é desviado', async () => {
    expect(await new EntradaDeGrupoRegistry().despachar(ORG, payload({ texto: 'https://a.com' }))).toBeNull();
    expect(grupoDoEvento(payload({ texto: 'x' }))).toBe(GRUPO);
    expect(grupoDoEvento({ event: 'messages.upsert', data: { key: { remoteJid: '55@s.whatsapp.net' } } })).toBeNull();
  });

  it('a falha de quem se inscreveu vira rótulo, não exceção', async () => {
    const reg = new EntradaDeGrupoRegistry();
    reg.registrar(GRUPO, async () => {
      throw new Error('banco fora');
    }, 'teste');
    expect(await reg.despachar(ORG, payload({ texto: 'https://a.com' }))).toBe('erro');
  });
});

// ---------------------------------------------------------------------------
// 3. O controlador do canal: um webhook, dois destinos
// ---------------------------------------------------------------------------

describe('grupo de links: o webhook único do canal', () => {
  const SEGREDO = 'segredo-de-transporte-do-canal-mc1-000';
  const antes = { ...process.env };

  beforeEach(() => {
    process.env.CANAL_APROVACAO_SEGREDO = SEGREDO;
    process.env.CANAL_APROVACAO_CODIGO_SEGREDO = 'segredo-do-codigo-do-canal-mc1-00000';
  });
  afterEach(() => {
    process.env = { ...antes };
  });

  function montar() {
    const receber = vi.fn(async (_orgId: string, evento: unknown) => {
      // O canal de verdade lê assim — e recusa grupo.
      const leitura = lerRespostaDeCanal(evento);
      return { desfecho: leitura.tipo === 'ignorar' ? `ignorado:${leitura.porque}` : 'decisao' };
    });
    const canal = { receber } as unknown as CanalDeAprovacaoService;
    const grupos = new EntradaDeGrupoRegistry();
    const orgsDaEntrada: Array<string | undefined> = [];
    const entrada = vi.fn(async (orgId: string) => {
      orgsDaEntrada.push(contextoAtual()?.orgId ?? undefined);
      return `capturadas:1 (${orgId})`;
    });
    grupos.registrar(GRUPO, entrada, 'teste');
    return { webhook: new CanalDeAprovacaoController(canal, grupos), receber, entrada, orgsDaEntrada };
  }

  it('o grupo de links vai para a pauta, dentro da empresa do caminho, e não chega ao canal', async () => {
    const { webhook, receber, entrada, orgsDaEntrada } = montar();
    expect(await webhook.whatsapp(ORG, segredoDoCanalDaEmpresa(ORG)!, payload({ texto: 'https://a.com' }))).toEqual({ ok: true });
    await webhook.trabalhoEmCurso;
    expect(entrada).toHaveBeenCalledTimes(1);
    expect(orgsDaEntrada).toEqual([ORG]);
    expect(receber).not.toHaveBeenCalled();
  });

  it('qualquer outro grupo cai no canal, que continua recusando grupo', async () => {
    const { webhook, receber, entrada } = montar();
    await webhook.whatsapp(ORG, segredoDoCanalDaEmpresa(ORG)!, payload({ texto: 'APROVAR ROOT-AB12CD34', jid: OUTRO_GRUPO }));
    await webhook.trabalhoEmCurso;
    expect(entrada).not.toHaveBeenCalled();
    expect(receber).toHaveBeenCalledTimes(1);
    expect(await receber.mock.results[0].value).toEqual({ desfecho: 'ignorado:mensagem-de-grupo' });
  });

  it('o próprio grupo de links, lido pelo canal, também seria recusado — o desvio não abre nada', () => {
    expect(lerRespostaDeCanal(payload({ texto: 'APROVAR ROOT-AB12CD34' }))).toMatchObject({
      tipo: 'ignorar',
      porque: 'mensagem-de-grupo',
    });
  });

  it('conversa direta segue para o canal como antes', async () => {
    const { webhook, receber, entrada } = montar();
    await webhook.whatsapp(ORG, segredoDoCanalDaEmpresa(ORG)!, payload({ texto: 'https://a.com', jid: '5561999990000@s.whatsapp.net' }));
    await webhook.trabalhoEmCurso;
    expect(entrada).not.toHaveBeenCalled();
    expect(receber).toHaveBeenCalledTimes(1);
  });

  it('sem o segredo certo, nem o grupo de links passa', async () => {
    const { webhook, entrada } = montar();
    await expect(webhook.whatsapp(ORG, 'errado', payload({ texto: 'https://a.com' }))).rejects.toThrow();
    expect(entrada).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. O serviço de entrada, com prisma de mentira
// ---------------------------------------------------------------------------

interface Fonte {
  id: string;
  orgId: string;
  tipo: string;
  nome: string;
  plataforma: string | null;
  ativo: boolean;
  ultimaLeitura: Date | null;
  criadaEm: Date;
}
interface Captura {
  id: string;
  orgId: string;
  fonteId: string | null;
  tipo: string;
  url: string | null;
  urlHash: string;
  nota: string | null;
  bruto: unknown;
  status: string;
  capturadoPor: string | null;
}

function prismaDeMentira(modulos: string[] = ['pauta']) {
  const fontes: Fonte[] = [];
  const capturas: Captura[] = [];
  const auditoria: Array<Record<string, unknown>> = [];
  let seq = 0;
  /** Simula outra réplica gravando o mesmo link entre a consulta e a escrita. */
  let corridaNaProximaEscrita = false;

  const casa = (f: Fonte, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => (f as unknown as Record<string, unknown>)[k] === v);

  const prisma = {
    org: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === ORG ? { modulos } : null,
    },
    pautaFonte: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const f = fontes.find((x) => casa(x, where));
        return f ? { id: f.id, ativo: f.ativo } : null;
      },
      create: async ({ data }: { data: Omit<Fonte, 'id' | 'ativo' | 'ultimaLeitura' | 'criadaEm'> }) => {
        const f: Fonte = { ...data, id: `fonte-${++seq}`, ativo: true, ultimaLeitura: null, criadaEm: new Date() };
        fontes.push(f);
        return { id: f.id, ativo: f.ativo };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Fonte> }) => {
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
      create: async ({ data }: { data: Omit<Captura, 'id' | 'status'> }) => {
        if (corridaNaProximaEscrita) {
          corridaNaProximaEscrita = false;
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'teste',
          });
        }
        if (capturas.some((x) => x.orgId === data.orgId && x.urlHash === data.urlHash)) {
          throw new Error('violou @@unique([orgId, urlHash]) — a deduplicação falhou');
        }
        const c: Captura = { ...data, id: `captura-${++seq}`, status: 'rascunho' };
        capturas.push(c);
        return { id: c.id };
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
  };
}

describe('grupo de links: o serviço de entrada', () => {
  const antes = process.env.EVOLUTION_LINKS_JID;
  const orgAntes = process.env.EVOLUTION_LINKS_ORG_ID;

  beforeEach(() => {
    process.env.EVOLUTION_LINKS_JID = GRUPO;
    process.env.EVOLUTION_LINKS_ORG_ID = ORG;
  });
  afterEach(() => {
    if (antes === undefined) delete process.env.EVOLUTION_LINKS_JID;
    else process.env.EVOLUTION_LINKS_JID = antes;
    if (orgAntes === undefined) delete process.env.EVOLUTION_LINKS_ORG_ID;
    else process.env.EVOLUTION_LINKS_ORG_ID = orgAntes;
  });

  function montar(modulos?: string[]) {
    const banco = prismaDeMentira(modulos);
    const servico = new EntradaDeLinksService(banco.prisma, new AuditService(banco.prisma));
    return { ...banco, servico };
  }

  it('payload real de grupo com link produz 1 captura, em rascunho, na fonte do grupo', async () => {
    const { servico, fontes, capturas, auditoria } = montar();
    const texto = 'pra rodada de sexta: https://www.instagram.com/p/ABC123/?igshid=zap';

    expect(await servico.receber(ORG, payload({ texto }))).toBe('capturadas:1,repetidas:0');

    expect(fontes).toHaveLength(1);
    expect(fontes[0]).toMatchObject({
      orgId: ORG,
      tipo: 'manual',
      plataforma: 'whatsapp',
      nome: NOME_DA_FONTE_DO_GRUPO,
      ativo: true,
    });
    expect(fontes[0].ultimaLeitura).toBeInstanceOf(Date);

    expect(capturas).toHaveLength(1);
    expect(capturas[0]).toMatchObject({
      orgId: ORG,
      fonteId: fontes[0].id,
      tipo: 'link',
      url: 'https://instagram.com/p/ABC123',
      urlHash: hashDaCaptura('https://instagram.com/p/ABC123'),
      nota: texto,
      status: 'rascunho',
      capturadoPor: 'whatsapp',
    });
    expect(capturas[0].bruto).toEqual({ origem: 'whatsapp', remetente: 'Pedro', mensagemId: '3EB0A1B2C3D4E5F6' });
    // o número de quem mandou não é guardado
    expect(JSON.stringify(capturas[0])).not.toContain('5561999990000');

    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ orgId: ORG, action: 'pauta.captura_whatsapp', actorType: 'system' });
  });

  it('o mesmo link duas vezes vira 1 captura — e a fonte não nasce duas vezes', async () => {
    const { servico, fontes, capturas } = montar();
    await servico.receber(ORG, payload({ texto: 'https://site.com/materia', id: 'M1' }));
    expect(await servico.receber(ORG, payload({ texto: 'de novo: https://www.site.com/materia/?utm_source=zap', id: 'M2' }))).toBe(
      'capturadas:0,repetidas:1',
    );
    expect(capturas).toHaveLength(1);
    expect(fontes).toHaveLength(1);
  });

  it('duas entregas do mesmo webhook ao mesmo tempo continuam sendo 1 captura', async () => {
    const { servico, capturas, fontes } = montar();
    const p = payload({ texto: 'https://site.com/x' });
    const r = await Promise.all([servico.receber(ORG, p), servico.receber(ORG, p)]);
    expect(r.sort()).toEqual(['capturadas:0,repetidas:1', 'capturadas:1,repetidas:0']);
    expect(capturas).toHaveLength(1);
    expect(fontes).toHaveLength(1);
  });

  it('vários links numa mensagem: uma captura por link, com a mesma nota', async () => {
    const { servico, capturas } = montar();
    await servico.receber(ORG, payload({ texto: 'https://a.com/1 https://b.com/2 https://a.com/1' }));
    expect(capturas.map((c) => c.url)).toEqual(['https://a.com/1', 'https://b.com/2']);
    expect(new Set(capturas.map((c) => c.nota)).size).toBe(1);
  });

  it('mensagem sem link é ignorada: nem fonte, nem captura', async () => {
    const { servico, fontes, capturas } = montar();
    expect(await servico.receber(ORG, payload({ texto: 'bom dia' }))).toBe('ignorado:sem-link');
    expect(fontes).toHaveLength(0);
    expect(capturas).toHaveLength(0);
  });

  it('grupo diferente não passa', async () => {
    const { servico, capturas } = montar();
    expect(await servico.receber(ORG, payload({ texto: 'https://a.com', jid: OUTRO_GRUPO }))).toBe(
      'ignorado:outro-chat',
    );
    expect(capturas).toHaveLength(0);
  });

  it('empresa sem o módulo pauta não ganha captura', async () => {
    const { servico, fontes, capturas } = montar(['bio']);
    expect(await servico.receber(ORG, payload({ texto: 'https://a.com' }))).toBe('ignorado:pauta-desligada');
    expect(fontes).toHaveLength(0);
    expect(capturas).toHaveLength(0);
  });

  it('fonte pausada no Radar cala o grupo', async () => {
    const { servico, fontes, capturas } = montar();
    await servico.receber(ORG, payload({ texto: 'https://a.com' }));
    fontes[0].ativo = false;
    expect(await servico.receber(ORG, payload({ texto: 'https://b.com' }))).toBe('ignorado:fonte-pausada');
    expect(capturas).toHaveLength(1);
  });

  it('renomear a fonte não faz nascer outra: a pausa continua valendo', async () => {
    const { servico, fontes, capturas } = montar();
    await servico.receber(ORG, payload({ texto: 'https://a.com' }));
    fontes[0].nome = 'Links da equipe';
    fontes[0].ativo = false;
    expect(await servico.receber(ORG, payload({ texto: 'https://b.com' }))).toBe('ignorado:fonte-pausada');
    expect(fontes).toHaveLength(1);
    expect(capturas).toHaveLength(1);
  });

  it('corrida com outra réplica (P2002) conta como repetida, não como erro', async () => {
    const { servico, capturas, correrNaProximaEscrita } = montar();
    correrNaProximaEscrita();
    expect(await servico.receber(ORG, payload({ texto: 'https://a.com https://b.com' }))).toBe(
      'capturadas:1,repetidas:1',
    );
    expect(capturas.map((c) => c.url)).toEqual(['https://b.com']);
  });

  it('a mesma mensagem do grupo chegando pelo caminho de outra empresa não grava captura nem cria fonte lá', async () => {
    const { servico, fontes, capturas, auditoria } = montar();
    expect(await servico.receber('outra-empresa-com-pauta', payload({ texto: 'https://a.com/post' }))).toBe('ignorado:empresa-errada');
    expect(fontes).toHaveLength(0);
    expect(capturas).toHaveLength(0);
    expect(auditoria).toHaveLength(0);
    expect(await servico.receber(ORG, payload({ texto: 'https://a.com/post' }))).toBe('capturadas:1,repetidas:0');
  });

  it('sem a empresa dona do grupo, o grupo fica desligado e avisa no arranque', () => {
    const aviso = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      delete process.env.EVOLUTION_LINKS_ORG_ID;
      const banco = prismaDeMentira();
      const reg = new EntradaDeGrupoRegistry();
      const s = new EntradaDeLinksService(banco.prisma, new AuditService(banco.prisma), reg);
      expect(s.ligado).toBe(false);
      s.onModuleInit();
      expect(reg.inscrito(GRUPO)).toBe(false);
      expect(aviso).toHaveBeenCalledWith(expect.stringContaining('EVOLUTION_LINKS_ORG_ID'));
    } finally {
      aviso.mockRestore();
    }
  });

  it('se inscreve no registro com o JID da variável — e sem ela, não', () => {
    const banco = prismaDeMentira();
    const reg = new EntradaDeGrupoRegistry();
    new EntradaDeLinksService(banco.prisma, new AuditService(banco.prisma), reg).onModuleInit();
    expect(reg.inscrito(GRUPO)).toBe(true);

    delete process.env.EVOLUTION_LINKS_JID;
    const vazio = new EntradaDeGrupoRegistry();
    const desligado = new EntradaDeLinksService(banco.prisma, new AuditService(banco.prisma), vazio);
    expect(desligado.ligado).toBe(false);
    desligado.onModuleInit();
    expect(vazio.inscrito(GRUPO)).toBe(false);

    process.env.EVOLUTION_LINKS_JID = '5561999990000@s.whatsapp.net';
    const numero = new EntradaDeGrupoRegistry();
    new EntradaDeLinksService(banco.prisma, new AuditService(banco.prisma), numero).onModuleInit();
    expect(numero.inscrito('5561999990000@s.whatsapp.net')).toBe(false);
  });

  it('avisa no arranque quando o grupo está configurado mas o webhook do canal está desligado', () => {
    const aviso = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const banco = prismaDeMentira();
      delete process.env.CANAL_APROVACAO_SEGREDO;
      delete process.env.CANAL_APROVACAO_CODIGO_SEGREDO;
      new EntradaDeLinksService(banco.prisma, new AuditService(banco.prisma), new EntradaDeGrupoRegistry()).onModuleInit();
      expect(aviso).toHaveBeenCalledWith(expect.stringContaining('nenhum link do grupo vai chegar'));

      aviso.mockClear();
      process.env.CANAL_APROVACAO_SEGREDO = 'segredo-de-transporte-do-canal-mc1-000';
      process.env.CANAL_APROVACAO_CODIGO_SEGREDO = 'segredo-do-codigo-do-canal-mc1-00000';
      new EntradaDeLinksService(banco.prisma, new AuditService(banco.prisma), new EntradaDeGrupoRegistry()).onModuleInit();
      expect(aviso).not.toHaveBeenCalled();
    } finally {
      delete process.env.CANAL_APROVACAO_SEGREDO;
      delete process.env.CANAL_APROVACAO_CODIGO_SEGREDO;
      aviso.mockRestore();
    }
  });

  it('de ponta a ponta: registro inscrito pelo serviço, webhook do canal, 1 captura', async () => {
    process.env.CANAL_APROVACAO_SEGREDO = 'segredo-de-transporte-do-canal-mc1-000';
    process.env.CANAL_APROVACAO_CODIGO_SEGREDO = 'segredo-do-codigo-do-canal-mc1-00000';
    try {
      const banco = prismaDeMentira();
      const reg = new EntradaDeGrupoRegistry();
      new EntradaDeLinksService(banco.prisma, new AuditService(banco.prisma), reg).onModuleInit();
      const receber = vi.fn(async () => ({ desfecho: 'nao-devia' }));
      const webhook = new CanalDeAprovacaoController({ receber } as unknown as CanalDeAprovacaoService, reg);

      await webhook.whatsapp(ORG, segredoDoCanalDaEmpresa(ORG)!, payload({ texto: 'https://a.com/post' }));
      await webhook.trabalhoEmCurso;
      await webhook.whatsapp(ORG, segredoDoCanalDaEmpresa(ORG)!, payload({ texto: 'https://a.com/post' }));
      await webhook.trabalhoEmCurso;

      expect(banco.capturas).toHaveLength(1);
      expect(receber).not.toHaveBeenCalled();
    } finally {
      delete process.env.CANAL_APROVACAO_SEGREDO;
      delete process.env.CANAL_APROVACAO_CODIGO_SEGREDO;
    }
  });
});
