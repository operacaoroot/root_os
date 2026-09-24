import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INSTAGRAM_ESCOPO_DE_PUBLICAR,
  PAUTA_PUBLICACAO_ESTADOS,
  PAUTA_REDES,
  PAUTA_TIPO_DA_ROTINA_DE_PUBLICACAO,
} from '@mktos/shared';
import * as instagram from '../src/bio/plataformas/instagram';
import {
  argsDaPublicacao,
  decisaoDaRotina,
  lerArgsDaPublicacao,
  midiasDoPedido,
  motivoParaNaoPublicar,
  mudouDesdeOPedido,
  passoDoStatus,
  postDoContainer,
  type ContaParaPublicar,
  type PecaParaPublicar,
} from '../src/pauta/publicacao-instagram';
import { ACAO_DO_PASSO, PublicacaoInstagramService } from '../src/pauta/publicacao-instagram.service';
import type { GraphDePublicacao } from '../src/pauta/graph-de-publicacao';
import { PublicacaoInstagramController } from '../src/pauta/publicacao-instagram.controller';
import { conferir } from '../src/pauta/midia-publica';
import { desfechoDaPublicacao } from '../src/routines/executores/pauta-publicar.executor';
import { AGENTE_DO_TIPO, MODULO_DO_TIPO, TIPOS_DA_PAUTA, TIPO_PAUTA_PUBLICAR } from '../src/routines/rotina.tipos';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { AcoesService } from '../src/gateway/acoes.service';
import { PortaDoOperador, type AcaoRetida } from '../src/gateway/porta-do-operador.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { ConectoresService } from '../src/integrations/conectores.service';
import { comContexto } from '../src/common/contexto-execucao';
import { cifrar } from '../src/common/crypto';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import type { MemoriaService } from '../src/memory/memoria.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * MD6 — O PUBLICADOR DO INSTAGRAM.
 *
 * Sem banco: a parte pura (o que vai no pedido, o que impede, o que cada status
 * da Meta quer dizer, o que a rotina faz no horário), o enum espelhado e as
 * rotas. Com banco: a porta de verdade, com a política semeada, duas pessoas
 * (quem clica e quem confirma) e um dublê da Graph num servidor HTTP local, que
 * confere o token de cada URL assinada da mídia.
 */

const SHA = (c: string) => c.repeat(64).slice(0, 64);

function metaDaSemana(formato: 'carrossel' | 'story' | 'corte', n = 5) {
  const imagens =
    formato === 'corte'
      ? []
      : Array.from({ length: formato === 'story' ? 1 : n }, (_, i) => ({
          n: i + 1,
          chave: `pauta/peca/p-${i + 1}-abc.jpg`,
          sha: 'abc',
          sha256: SHA(String((i + 1) % 10)),
          tipo: 'jpeg',
          largura: 1080,
          altura: formato === 'story' ? 1920 : 1350,
          bytes: 1000,
          enviadaEm: '2026-09-24T10:00:00.000Z',
        }));
  return {
    episodioId: 'ep-1',
    itemId: 'item-1',
    itemN: 1,
    formato,
    transcricaoSha: 't',
    linkDaMateria: null,
    avisos: [],
    imagens,
    ...(formato === 'carrossel' ? { slides: Array.from({ length: n }, (_, i) => ({ titulo: `S${i + 1}`, texto: 'x' })) } : {}),
    ...(formato === 'corte'
      ? { video: { arquivo: null, duracaoSeg: 30, largura: 1080, altura: 1920, bytes: 5000, chave: 'pauta/pecas/p/corte-x.mp4', sha256: SHA('e') } }
      : {}),
  };
}

const CONTA: ContaParaPublicar = { externalId: 'ig-1', handle: 'root', escopos: ['instagram_business_basic', INSTAGRAM_ESCOPO_DE_PUBLICAR], status: 'ok' };

function peca(p: Partial<PecaParaPublicar> = {}): PecaParaPublicar {
  return {
    id: 'peca-1',
    canal: 'instagram',
    formato: 'carrossel',
    status: 'aprovada',
    corpo: 'A legenda do carrossel',
    meta: metaDaSemana('carrossel'),
    agendadaPara: null,
    ...p,
  };
}

describe('MD6: o pedido de publicação (puro)', () => {
  it('o carrossel de 5 slides leva os 5 JPEG na ordem, com o sha256 de cada um', () => {
    const r = midiasDoPedido('carrossel', metaDaSemana('carrossel', 5));
    expect(r.ok).toBe(true);
    expect(r.ok && r.midias.map((m) => m.chave)).toEqual([1, 2, 3, 4, 5].map((n) => `pauta/peca/p-${n}-abc.jpg`));
  });

  it('falta de JPEG, de sha ou de mp4 diz o que fazer; carrossel de 1 slide não sai', () => {
    const semJpeg = metaDaSemana('carrossel', 3);
    semJpeg.imagens = semJpeg.imagens.filter((i) => i.n !== 2);
    expect(midiasDoPedido('carrossel', semJpeg)).toEqual({ ok: false, motivo: expect.stringMatching(/Falta o JPEG 2/) });
    expect(midiasDoPedido('carrossel', metaDaSemana('carrossel', 1))).toEqual({ ok: false, motivo: expect.stringMatching(/de 2 a 10/) });
    const corte = metaDaSemana('corte') as unknown as { video: { sha256?: string } };
    delete corte.video.sha256;
    expect(midiasDoPedido('corte', corte)).toEqual({ ok: false, motivo: expect.stringMatching(/sha256/) });
    expect(midiasDoPedido('story', metaDaSemana('story'))).toMatchObject({ ok: true, midias: [{ chave: 'pauta/peca/p-1-abc.jpg' }] });
  });

  it('rascunho, conta ausente, sem escopo ou com token morto não pedem', () => {
    expect(motivoParaNaoPublicar(peca({ status: 'rascunho' }), CONTA, INSTAGRAM_ESCOPO_DE_PUBLICAR)).toMatch(/Só a peça aprovada/);
    expect(motivoParaNaoPublicar(peca(), null, INSTAGRAM_ESCOPO_DE_PUBLICAR)).toMatch(/não tem conta de publicação/);
    expect(motivoParaNaoPublicar(peca(), { ...CONTA, escopos: ['instagram_business_basic'] }, INSTAGRAM_ESCOPO_DE_PUBLICAR)).toMatch(/permissão de publicar/);
    expect(motivoParaNaoPublicar(peca(), { ...CONTA, status: 'token_expirado' }, INSTAGRAM_ESCOPO_DE_PUBLICAR)).toMatch(/reconecte/);
    expect(motivoParaNaoPublicar(peca({ canal: 'whatsapp' }), CONTA, INSTAGRAM_ESCOPO_DE_PUBLICAR)).toMatch(/semana de posts/);
    expect(motivoParaNaoPublicar(peca({ corpo: 'x'.repeat(2201) }), CONTA, INSTAGRAM_ESCOPO_DE_PUBLICAR)).toMatch(/2200/);
    expect(motivoParaNaoPublicar(peca(), CONTA, INSTAGRAM_ESCOPO_DE_PUBLICAR)).toBeNull();
  });

  it('os argumentos são os do catálogo, e o que volta da porta é relido na mesma forma', () => {
    const a = argsDaPublicacao(peca({ agendadaPara: new Date('2026-09-28T15:00:00Z') }), CONTA);
    expect(Object.keys(a).sort()).toEqual(['agendadaPara', 'formato', 'igUserId', 'legenda', 'midias', 'pecaId']);
    expect(lerArgsDaPublicacao(a as unknown as Record<string, unknown>)).toEqual(a);
    // Campo a mais dentro da mídia ou sha fora do formato: fora da forma.
    expect(lerArgsDaPublicacao({ ...a, midias: [{ ...a.midias[0], extra: 1 }] })).toBeNull();
    expect(lerArgsDaPublicacao({ ...a, midias: [{ chave: 'x', sha256: 'curto' }] })).toBeNull();
  });

  it('a legenda leva a barreira de link de caixa de entrada (MC-R)', () => {
    const a = argsDaPublicacao(peca({ corpo: 'Leia https://mail.google.com/mail/u/0/#inbox/abc e comente' }), CONTA);
    expect(a.legenda).not.toMatch(/mail\.google\.com/);
  });

  it('diz o que mudou entre o que foi assinado e a peça de agora', () => {
    const a = argsDaPublicacao(peca(), CONTA);
    expect(mudouDesdeOPedido(a, a)).toBeNull();
    expect(mudouDesdeOPedido(a, { ...a, legenda: 'outra' })).toMatch(/legenda/);
    expect(mudouDesdeOPedido(a, { ...a, midias: [...a.midias].reverse() })).toMatch(/mídia/);
    expect(mudouDesdeOPedido(a, { ...a, igUserId: 'outra' })).toMatch(/conta/);
    expect(mudouDesdeOPedido(a, { ...a, agendadaPara: '2026-09-28T15:00:00.000Z' })).toMatch(/horário/);
  });

  it('cada status_code da Meta tem um passo, e PUBLISHED nunca publica de novo', () => {
    expect(passoDoStatus('FINISHED')).toBe('publicar');
    expect(passoDoStatus('IN_PROGRESS')).toBe('esperar');
    expect(passoDoStatus('ERROR')).toBe('erro');
    expect(passoDoStatus('EXPIRED')).toBe('vencido');
    expect(passoDoStatus('PUBLISHED')).toBe('ja_publicado');
    expect(passoDoStatus('')).toBe('erro');
  });

  it('acha o post cuja resposta se perdeu pela legenda, depois do container; sem legenda não adivinha', () => {
    const recentes = [
      { id: 'velho', caption: 'A legenda', timestamp: '2026-09-20T10:00:00+0000', permalink: null },
      { id: 'novo', caption: 'A legenda', timestamp: '2026-09-24T10:01:00+0000', permalink: 'https://www.instagram.com/p/x' },
      { id: 'outro', caption: 'Outra', timestamp: '2026-09-24T10:02:00+0000', permalink: null },
    ];
    expect(postDoContainer(recentes, 'A legenda', '2026-09-24T10:00:30.000Z')).toEqual({ id: 'novo', permalink: 'https://www.instagram.com/p/x' });
    expect(postDoContainer(recentes, null, '2026-09-24T10:00:30.000Z')).toBeNull();
  });

  it('a rotina só publica com a nota ligada, o lote e a porta que confere o lote', () => {
    const base = { agendadaPara: new Date('2026-09-28T15:00:00Z'), agora: new Date('2026-09-28T15:10:00Z'), loteConferidoPelaPorta: false };
    expect(decisaoDaRotina({ ...base, automaticaLigada: false, loteItemId: 'l1' })).toEqual({ tipo: 'pular', motivo: 'publicação automática desligada' });
    expect(decisaoDaRotina({ ...base, automaticaLigada: true, loteItemId: null })).toEqual({ tipo: 'pular', motivo: 'sem aprovação da semana' });
    expect(decisaoDaRotina({ ...base, automaticaLigada: true, loteItemId: 'l1' }).tipo).toBe('pular');
    expect(decisaoDaRotina({ ...base, automaticaLigada: true, loteItemId: 'l1', loteConferidoPelaPorta: true })).toEqual({ tipo: 'publicar', loteItemId: 'l1' });
    expect(decisaoDaRotina({ ...base, agora: new Date('2026-09-28T17:01:00Z'), automaticaLigada: true, loteItemId: 'l1' }).tipo).toBe('janela_perdida');
  });

  it('o desfecho da passagem: nada é pulada; erro lança; o resto é ok', () => {
    expect(desfechoDaPublicacao([]).status).toBe('pulada');
    expect(desfechoDaPublicacao([{ rotulo: 'ep-01 carrossel m1', resultado: 'pulada', detalhe: 'sem aprovação da semana' }])).toEqual({
      status: 'pulada',
      resumo: 'ep-01 carrossel m1: pulada (sem aprovação da semana)',
    });
    expect(desfechoDaPublicacao([{ rotulo: 'a', resultado: 'publicada', detalhe: null }]).status).toBe('ok');
    expect(() => desfechoDaPublicacao([{ rotulo: 'a', resultado: 'erro', detalhe: 'janela' }])).toThrow(/janela/);
  });

  it('os enums do Prisma estão espelhados no shared', () => {
    const schema = readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    const bloco = (nome: string) =>
      (new RegExp(`enum ${nome} \\{([^}]*)\\}`).exec(schema)?.[1] ?? '')
        .split('\n')
        .map((l) => l.replace(/\/\/.*$/, '').trim())
        .filter(Boolean);
    expect(bloco('PautaRede')).toEqual([...PAUTA_REDES]);
    expect(bloco('PautaPublicacaoEstado')).toEqual([...PAUTA_PUBLICACAO_ESTADOS]);
  });

  it('a rotina é da pauta, do agente da pauta, e o tipo é o do shared', () => {
    expect(TIPO_PAUTA_PUBLICAR).toBe(PAUTA_TIPO_DA_ROTINA_DE_PUBLICACAO);
    expect(TIPOS_DA_PAUTA).toContain(TIPO_PAUTA_PUBLICAR);
    expect(AGENTE_DO_TIPO[TIPO_PAUTA_PUBLICAR]).toBe('editor-de-pauta');
    expect(MODULO_DO_TIPO[TIPO_PAUTA_PUBLICAR]).toBe('pauta');
  });

  it('pedir e voltar ao manual pedem pauta.publicar; ler pede pauta.ver', () => {
    const p = PublicacaoInstagramController.prototype;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.pedir)).toEqual(['pauta.publicar']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.voltarAoManual)).toEqual(['pauta.publicar']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.daPeca)).toEqual(['pauta.ver']);
  });
});

// ---------------------------------------------------------------------------
// O dublê da Graph
// ---------------------------------------------------------------------------

const SEGREDO = 'segredo-da-midia-publica-de-teste-md6-0123456789';

interface Chamada {
  metodo: string;
  caminho: string;
  campos: Record<string, string>;
}

/** O dublê: cria containers, responde status e limite, publica e devolve permalink. */
class GraphDuble {
  chamadas: Chamada[] = [];
  /** A chave do storage que cada URL assinada autorizava, conferida pelo token. */
  chavesBaixadas: string[] = [];
  urlsRecusadas: string[] = [];
  statusDoFinal: string[] = [];
  usado = 0;
  perderRespostaDoPublish = false;
  /** O publish cai sem resposta E sem post: a Meta não recebeu. O status segue FINISHED. */
  perderPublishSemPostar = false;
  private seq = 0;
  private containers = new Map<string, Record<string, string>>();
  publicados: Array<{ id: string; caption: string; container: string; timestamp: string }> = [];

  zerar() {
    this.chamadas = [];
    this.chavesBaixadas = [];
    this.urlsRecusadas = [];
    this.statusDoFinal = [];
    this.usado = 0;
    this.perderRespostaDoPublish = false;
    this.perderPublishSemPostar = false;
    this.containers.clear();
    this.publicados = [];
  }

  private conferirUrl(url: string | undefined) {
    if (!url) return;
    const token = /\/api\/midia-publica\/([^/?#]+)$/.exec(url)?.[1] ?? '';
    const ok = conferir(token, SEGREDO);
    if (ok) this.chavesBaixadas.push(ok.chave);
    else this.urlsRecusadas.push(url);
  }

  tratar(metodo: string, caminho: string, campos: Record<string, string>): { status: number; corpo?: unknown; derrubar?: boolean } {
    this.chamadas.push({ metodo, caminho, campos });
    const partes = caminho.replace(/^\/graph\/v24\.0\//, '').split('/');
    if (metodo === 'POST' && partes[1] === 'media') {
      this.conferirUrl(campos.image_url);
      this.conferirUrl(campos.video_url);
      const id = `c${++this.seq}`;
      this.containers.set(id, campos);
      return { status: 200, corpo: { id } };
    }
    if (metodo === 'GET' && partes[1] === 'media') {
      return { status: 200, corpo: { data: this.publicados.map((p) => ({ id: p.id, caption: p.caption, timestamp: p.timestamp, permalink: `https://www.instagram.com/p/${p.id}` })) } };
    }
    if (metodo === 'GET' && partes[1] === 'content_publishing_limit') {
      return { status: 200, corpo: { data: [{ quota_usage: this.usado, config: { quota_total: 100, quota_duration: 86400 } }] } };
    }
    if (metodo === 'POST' && partes[1] === 'media_publish') {
      const container = campos.creation_id;
      if (this.perderPublishSemPostar) return { status: 200, derrubar: true };
      const id = `m${++this.seq}`;
      this.publicados.push({ id, caption: this.containers.get(container)?.caption ?? '', container, timestamp: new Date().toISOString() });
      return this.perderRespostaDoPublish ? { status: 200, derrubar: true } : { status: 200, corpo: { id } };
    }
    if (metodo === 'GET' && partes.length === 1 && campos.fields === 'status_code,status') {
      if (this.publicados.some((p) => p.container === partes[0])) return { status: 200, corpo: { status_code: 'PUBLISHED' } };
      return { status: 200, corpo: { status_code: this.statusDoFinal.shift() ?? 'FINISHED', status: 'x' } };
    }
    if (metodo === 'GET' && partes.length === 1 && campos.fields === 'permalink') {
      return { status: 200, corpo: { permalink: `https://www.instagram.com/p/${partes[0]}` } };
    }
    return { status: 404, corpo: { error: { message: 'rota do dublê desconhecida' } } };
  }

  containersCriados(): Record<string, string>[] {
    return this.chamadas.filter((c) => c.metodo === 'POST' && c.caminho.endsWith('/media')).map((c) => c.campos);
  }

  publishes(): number {
    return this.chamadas.filter((c) => c.caminho.endsWith('/media_publish')).length;
  }
}

// ---------------------------------------------------------------------------
// Com banco: a porta de verdade
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (uma empresa, duas pessoas, peças, aprovações e RASTRO)');

const ORG = 'org-md6-publicacao';
const PEDRO = { id: 'pedro-md6', papeis: ['admin_master'] };
const LUCAS = { id: 'lucas-md6', papeis: ['gestor_marketing'] };

describe.skipIf(!URL)('MD6: publicar no Instagram pela porta, com o dublê da Graph', () => {
  let prisma: PrismaClient;
  let servidor: Server;
  const graph = new GraphDuble();
  let approvals: ApprovalsService;
  let acoes: AcoesService;
  let conectores: ConectoresService;
  let servico: PublicacaoInstagramService;
  let rodadaId: string;
  let nota: { body: string; arquivadoEm: string | null } | null = null;
  /** Roda no meio da chamada à Graph, antes de ela chegar ao dublê: é onde o tique da rotina cai. */
  const ganchos: { antesDoCriar?: () => Promise<void>; antesDoPublicar?: () => Promise<void> } = {};
  const ambienteAntes: Record<string, string | undefined> = {};
  const AMBIENTE = ['INSTAGRAM_GRAPH_URL', 'PAUTA_MIDIA_PUBLICA_SEGREDO', 'PAUTA_MIDIA_PUBLICA_ORIGEM', 'ENCRYPTION_KEY', 'GATEWAY_MODO'];

  const naEmpresa = <T>(fn: () => Promise<T>, correlationId = 'clique-md6'): Promise<T> =>
    comContexto({ orgId: ORG, correlationId, origem: 'http' }, fn);

  async function novaPeca(formato: 'carrossel' | 'story' | 'corte', status: 'aprovada' | 'rascunho' = 'aprovada', extra: { agendadaPara?: Date } = {}) {
    const p = await prisma.pautaPeca.create({
      data: {
        orgId: ORG,
        rodadaId,
        canal: 'instagram',
        formato,
        titulo: `Peça ${formato}`,
        corpo: `A legenda do ${formato} ${Math.random().toString(36).slice(2, 8)}`,
        status,
        meta: metaDaSemana(formato) as object,
        ...extra,
      },
    });
    return p.id;
  }

  const pedir = (pecaId: string) => naEmpresa(() => servico.pedir(ORG, pecaId, PEDRO.id)) as Promise<AcaoRetida>;
  async function confirmarEExecutar(r: AcaoRetida) {
    await naEmpresa(() => approvals.confirm(ORG, r.approvalId, LUCAS));
    return naEmpresa(() => acoes.executarAprovada(ORG, r.approvalId, LUCAS.id));
  }

  beforeAll(async () => {
    vi.setSystemTime(new Date('2026-09-01T14:00:00-03:00'));
    for (const k of AMBIENTE) ambienteAntes[k] = process.env[k];
    process.env.GATEWAY_MODO = 'impor';
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    process.env.PAUTA_MIDIA_PUBLICA_SEGREDO = SEGREDO;
    process.env.PAUTA_MIDIA_PUBLICA_ORIGEM = 'https://bio.teste';

    servidor = createServer((req, res) => {
      let corpo = '';
      req.on('data', (c) => (corpo += c));
      req.on('end', () => {
        const u = new globalThis.URL(req.url ?? '/', 'http://x');
        const campos = Object.fromEntries(new URLSearchParams(req.method === 'POST' ? corpo : u.search));
        delete campos.access_token;
        const r = graph.tratar(req.method ?? 'GET', u.pathname, campos);
        if (r.derrubar) {
          req.socket.destroy();
          return;
        }
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.corpo ?? {}));
      });
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    process.env.INSTAGRAM_GRAPH_URL = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/graph`;

    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG },
      create: { id: ORG, name: 'Publicação MD6', slug: 'publicacao-md6', modulos: ['pauta', 'bio'] },
      update: { modulos: ['pauta', 'bio'] },
    });
    const papel = await prisma.role.upsert({
      where: { orgId_key: { orgId: ORG, key: 'admin_master' } },
      create: { orgId: ORG, key: 'admin_master', name: 'Admin Master' },
      update: {},
      select: { id: true },
    });
    const papelDoLucas = await prisma.role.upsert({
      where: { orgId_key: { orgId: ORG, key: 'gestor_marketing' } },
      create: { orgId: ORG, key: 'gestor_marketing', name: 'Gestor de Marketing' },
      update: {},
      select: { id: true },
    });
    for (const [u, p, email] of [
      [PEDRO, papel.id, 'pedro@md6.teste'],
      [LUCAS, papelDoLucas.id, 'lucas@md6.teste'],
    ] as const) {
      await prisma.user.upsert({
        where: { id: u.id },
        create: { id: u.id, orgId: ORG, email, name: u.id, passwordHash: 'sem-senha-util', roles: { connect: { id: p } } },
        update: { isActive: true, roles: { set: [{ id: p }] } },
      });
    }
    await prisma.bioConexao.deleteMany({ where: { orgId: ORG } });
    await prisma.bioConexao.create({
      data: {
        orgId: ORG,
        plataforma: 'instagram',
        externalId: 'ig-root',
        handle: 'operacaoroot',
        tokenCifrado: cifrar('token-de-publicacao'),
        escopos: `instagram_business_basic,${INSTAGRAM_ESCOPO_DE_PUBLICAR}`,
        finalidade: 'publicacao',
        expiraEm: new Date(Date.now() + 50 * 86_400_000),
      },
    });
    const agora = new Date();
    rodadaId = (
      await prisma.pautaRodada.create({ data: { orgId: ORG, status: 'curada', titulo: 'Rodada MD6', janelaIni: agora, janelaFim: agora } })
    ).id;

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    approvals = new ApprovalsService(p, audit);
    const eventos = new EventLogService(p);
    const registro = new EfeitosRegistry();
    const interruptores = new InterruptoresRegistry();
    conectores = new ConectoresService(p, audit, eventos, interruptores);
    conectores.onModuleInit();
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, eventos, undefined, interruptores, registro);
    acoes = new AcoesService(p, gateway, eventos, interruptores, policy);
    const porta = new PortaDoOperador(gateway, registro);
    const memoria = { porChave: async () => nota } as unknown as MemoriaService;
    // O cliente de verdade do conector, apontado para o dublê.
    const cliente: GraphDePublicacao = {
      limiteDePublicacao: instagram.limiteDePublicacao,
      criarContainer: async (...a) => {
        const g = ganchos.antesDoCriar;
        ganchos.antesDoCriar = undefined;
        await g?.();
        return instagram.criarContainer(...a);
      },
      statusDoContainer: instagram.statusDoContainer,
      publicarContainer: async (...a) => {
        const g = ganchos.antesDoPublicar;
        ganchos.antesDoPublicar = undefined;
        await g?.();
        return instagram.publicarContainer(...a);
      },
      permalinkDe: instagram.permalinkDe,
      midiasRecentes: instagram.midiasRecentes,
    };
    servico = new PublicacaoInstagramService(p, audit, registro, interruptores, porta, memoria, cliente);
    servico.onModuleInit();
  });

  afterAll(async () => {
    vi.useRealTimers();
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = $1', ORG),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.pautaPublicacao.deleteMany({ where: { orgId: ORG } });
    await prisma.pautaPeca.deleteMany({ where: { orgId: ORG } });
    await prisma.pautaRodada.deleteMany({ where: { orgId: ORG } });
    await prisma.bioConexao.deleteMany({ where: { orgId: ORG } });
    await prisma.approval.deleteMany({ where: { orgId: ORG } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
    await prisma.policyDecision.deleteMany({ where: { orgId: ORG } });
    await prisma.conectorDesligado.deleteMany({ where: { orgId: ORG } });
    await prisma.auditLog.deleteMany({ where: { orgId: ORG } });
    await prisma.user.deleteMany({ where: { orgId: ORG } });
    await prisma.role.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
    await new Promise<void>((ok) => servidor.close(() => ok()));
    for (const k of AMBIENTE) {
      if (ambienteAntes[k] === undefined) delete process.env[k];
      else process.env[k] = ambienteAntes[k];
    }
  });

  beforeEach(async () => {
    vi.setSystemTime(new Date('2026-09-01T14:00:00-03:00'));
    graph.zerar();
    nota = null;
    ganchos.antesDoCriar = undefined;
    ganchos.antesDoPublicar = undefined;
    await prisma.conectorDesligado.deleteMany({ where: { orgId: ORG } });
    // O histórico de chamadas acende `volume_atipico` e subiria o R3 a R4 (ver escritas-pela-porta).
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
  });

  it('"Publicar agora" num carrossel aprovado fica RETIDO: nada vai à Meta antes de outra pessoa confirmar', async () => {
    const id = await novaPeca('carrossel');
    const r = await pedir(id);
    expect(r.status).toBe('aguardando_aprovacao');
    expect(r.nivel).toBe('R3');
    expect(r.precisaDeOutraPessoa).toBe(true);
    expect(graph.chamadas, 'o dublê foi chamado antes da aprovação').toEqual([]);
    const pub = await prisma.pautaPublicacao.findFirst({ where: { orgId: ORG, pecaId: id } });
    expect(pub).toMatchObject({ estado: 'pendente', approvalId: r.approvalId });
    // Quem clicou não assina o próprio pedido.
    await expect(naEmpresa(() => approvals.confirm(ORG, r.approvalId, PEDRO))).rejects.toThrow(/não pode aprová-la/i);
  });

  it('confirmado por outra pessoa: 5 containers de item com a URL assinada, 1 CAROUSEL, o publish e a peça publicada com permalink', async () => {
    const id = await novaPeca('carrossel');
    const r = await pedir(id);
    const exec = await confirmarEExecutar(r);
    expect(exec.status).toBe('executado');

    const criados = graph.containersCriados();
    expect(criados).toHaveLength(6);
    expect(criados.slice(0, 5).every((c) => c.is_carousel_item === 'true' && c.image_url?.startsWith('https://bio.teste/api/midia-publica/'))).toBe(true);
    expect(graph.urlsRecusadas).toEqual([]);
    expect(graph.chavesBaixadas).toEqual([1, 2, 3, 4, 5].map((n) => `pauta/peca/p-${n}-abc.jpg`));
    expect(criados[5]).toMatchObject({ media_type: 'CAROUSEL', children: 'c1,c2,c3,c4,c5' });
    expect(criados[5].caption).toMatch(/^A legenda do carrossel/);
    expect(graph.publishes()).toBe(1);

    const p = await prisma.pautaPeca.findUniqueOrThrow({ where: { id } });
    expect(p.status).toBe('publicada');
    expect(p.externalId).toMatch(/^m\d+$/);
    expect(p.urlPublicada).toBe(`https://www.instagram.com/p/${p.externalId}`);
    expect(p.publicadaEm).toBeTruthy();
    expect(p.publicadaPor).toBe(LUCAS.id);
    const pub = await prisma.pautaPublicacao.findFirstOrThrow({ where: { orgId: ORG, pecaId: id } });
    expect(pub).toMatchObject({ estado: 'publicada', externalId: p.externalId, permalink: p.urlPublicada, approvalId: r.approvalId });

    const publicada = await prisma.auditLog.findFirst({ where: { orgId: ORG, action: 'pauta.peca_publicada', entityId: id } });
    expect(publicada?.after).toMatchObject({ canal: 'instagram', externalId: p.externalId });
    const passos = await prisma.auditLog.findMany({ where: { orgId: ORG, action: ACAO_DO_PASSO, entityId: id }, orderBy: { createdAt: 'asc' } });
    expect(passos.map((l) => (l.after as { passo: string }).passo)).toEqual(['pedido', 'container', 'publicada']);
    // Os passos do efeito levam a correlação da chamada aprovada (a do clique).
    expect((passos[1].metadata as { correlationId: string }).correlationId).toBe('clique-md6');
  });

  it('story: um container STORIES com a image_url assinada e sem legenda', async () => {
    const id = await novaPeca('story');
    await confirmarEExecutar(await pedir(id));
    const criados = graph.containersCriados();
    expect(criados).toHaveLength(1);
    expect(criados[0]).toMatchObject({ media_type: 'STORIES' });
    expect(criados[0].caption).toBeUndefined();
    expect(graph.chavesBaixadas).toEqual(['pauta/peca/p-1-abc.jpg']);
    expect((await prisma.pautaPeca.findUniqueOrThrow({ where: { id } })).status).toBe('publicada');
  });

  it('Reels em IN_PROGRESS fica processando e a rotina conclui no minuto seguinte', async () => {
    const id = await novaPeca('corte');
    graph.statusDoFinal = ['IN_PROGRESS', 'FINISHED'];
    const r = await pedir(id);
    const exec = await confirmarEExecutar(r);
    expect(exec.status).toBe('executado');
    const criados = graph.containersCriados();
    expect(criados[0]).toMatchObject({ media_type: 'REELS', share_to_feed: 'true' });
    expect(graph.chavesBaixadas).toEqual(['pauta/pecas/p/corte-x.mp4']);
    expect(graph.publishes()).toBe(0);
    expect((await prisma.pautaPublicacao.findFirstOrThrow({ where: { orgId: ORG, pecaId: id } })).estado).toBe('processando');

    // Antes do minuto, a rotina não olha.
    expect(await servico.concluir(ORG, 'rotina-1')).toEqual([]);
    vi.setSystemTime(new Date('2026-09-01T14:01:05-03:00'));
    const linhas = await comContexto({ orgId: ORG, correlationId: 'rotina-1', origem: 'cron' }, () => servico.concluir(ORG, 'rotina-1'));
    expect(linhas.map((l) => l.resultado)).toEqual(['publicada']);
    expect(graph.publishes()).toBe(1);
    const p = await prisma.pautaPeca.findUniqueOrThrow({ where: { id } });
    expect(p.status).toBe('publicada');
    // Quem publica é quem confirmou; a rotina só terminou o que a aprovação cobriu.
    expect(p.publicadaPor).toBe(LUCAS.id);
    const passos = await prisma.auditLog.findMany({ where: { orgId: ORG, action: ACAO_DO_PASSO, entityId: id }, orderBy: { createdAt: 'asc' } });
    const publicadaPasso = passos.find((l) => (l.after as { passo: string }).passo === 'publicada')!;
    expect(publicadaPasso.metadata).toMatchObject({ correlationId: 'clique-md6', correlacaoDaRotina: 'rotina-1' });
    expect((publicadaPasso.after as { approvalId?: string }).approvalId).toBe(r.approvalId);
    const noAr = await prisma.auditLog.findFirstOrThrow({ where: { orgId: ORG, action: 'pauta.peca_publicada', entityId: id } });
    expect(noAr.actorId).toBe(LUCAS.id);
    expect(noAr.metadata).toMatchObject({ correlationId: 'clique-md6', correlacaoDaRotina: 'rotina-1', approvalId: r.approvalId });
  });

  it('ERROR no container: erro com o motivo, sem publish', async () => {
    const id = await novaPeca('story');
    graph.statusDoFinal = ['ERROR'];
    const r = await pedir(id);
    // Quem confirma vê o motivo, e a porta registra acao.falhou, não "executado".
    await expect(confirmarEExecutar(r)).rejects.toThrow(/não processou a mídia \(ERROR/);
    expect(await prisma.toolCall.findFirst({ where: { orgId: ORG, capabilityId: 'instagram.post.publicar', status: 'executado' } })).toBeNull();
    expect(graph.publishes()).toBe(0);
    const pub = await prisma.pautaPublicacao.findFirstOrThrow({ where: { orgId: ORG, pecaId: id } });
    expect(pub.estado).toBe('erro');
    expect(pub.erro).toMatch(/ERROR/);
    expect((await prisma.pautaPeca.findUniqueOrThrow({ where: { id } })).status).toBe('aprovada');
  });

  it('limite de 100 posts em 24 h atingido: erro, sem publish', async () => {
    const id = await novaPeca('story');
    graph.usado = 100;
    await expect(confirmarEExecutar(await pedir(id))).rejects.toThrow(/100 de 100/);
    expect(graph.publishes()).toBe(0);
    const pub = await prisma.pautaPublicacao.findFirstOrThrow({ where: { orgId: ORG, pecaId: id } });
    expect(pub.estado).toBe('erro');
    expect(pub.erro).toMatch(/100 de 100/);
  });

  it('a resposta do publish se perde: relê o container, acha o post e NÃO posta de novo', async () => {
    const id = await novaPeca('carrossel');
    graph.perderRespostaDoPublish = true;
    await confirmarEExecutar(await pedir(id));
    expect(graph.publishes(), 'postou duas vezes').toBe(1);
    const p = await prisma.pautaPeca.findUniqueOrThrow({ where: { id } });
    expect(p.status).toBe('publicada');
    expect(p.externalId).toBe(graph.publicados[0].id);
    const passos = await prisma.auditLog.findMany({ where: { orgId: ORG, action: ACAO_DO_PASSO, entityId: id }, orderBy: { createdAt: 'asc' } });
    expect(passos.map((l) => (l.after as { passo: string }).passo)).toContain('recuperada');
  });

  it('interruptor do Instagram desligado: a porta recusa sem chamar o dublê, e a rotina também não chama', async () => {
    const id = await novaPeca('story');
    await naEmpresa(() => conectores.desligar(ORG, 'instagram', { motivo: 'incidente' }));
    await expect(pedir(id)).rejects.toThrow(/desligado/i);
    expect(graph.chamadas).toEqual([]);

    // Uma publicação a caminho também para: nenhuma chamada sai pela rotina.
    await prisma.pautaPublicacao.upsert({
      where: { pecaId_rede: { pecaId: id, rede: 'instagram' } },
      create: { pecaId: id, rede: 'instagram', estado: 'processando', containers: { final: 'c9', criadoEm: new Date().toISOString() } },
      update: { estado: 'processando', containers: { final: 'c9', criadoEm: new Date().toISOString() } },
    });
    const linhas = await comContexto({ orgId: ORG, correlationId: 'rotina-2', origem: 'cron' }, () => servico.concluir(ORG, 'rotina-2'));
    expect(linhas.map((l) => l.resultado)).toEqual(['interruptor']);
    expect(graph.chamadas).toEqual([]);
    await prisma.pautaPublicacao.deleteMany({ where: { pecaId: id } });
    await naEmpresa(() => conectores.religar(ORG, 'instagram'));
  });

  it('rascunho é recusado antes da porta, sem aprovação na fila', async () => {
    const id = await novaPeca('carrossel', 'rascunho');
    const antes = await prisma.approval.count({ where: { orgId: ORG } });
    await expect(pedir(id)).rejects.toThrow(/Só a peça aprovada/);
    expect(await prisma.approval.count({ where: { orgId: ORG } })).toBe(antes);
    expect(graph.chamadas).toEqual([]);
  });

  it('a mídia trocada depois do pedido: o efeito recusa e nada vai à Meta', async () => {
    const id = await novaPeca('story');
    const r = await pedir(id);
    const meta = metaDaSemana('story');
    meta.imagens[0].sha256 = SHA('f');
    await prisma.pautaPeca.update({ where: { id }, data: { meta: meta as object } });
    await expect(confirmarEExecutar(r)).rejects.toThrow(/a mídia mudou/);
    expect(graph.chamadas).toEqual([]);
    expect((await prisma.pautaPublicacao.findFirstOrThrow({ where: { orgId: ORG, pecaId: id } })).estado).toBe('recusada');
  });

  it('uma segunda execução aprovada da mesma peça, depois do post, não posta de novo; pedir de novo é 409', async () => {
    const id = await novaPeca('story');
    const r1 = await pedir(id);
    const assinados = (await prisma.toolCall.findFirstOrThrow({
      where: { orgId: ORG, capabilityId: 'instagram.post.publicar', status: 'aguardando_aprovacao' },
      orderBy: { criadoEm: 'desc' },
      select: { args: true },
    })).args as Record<string, unknown>;
    await confirmarEExecutar(r1);
    expect(graph.publishes()).toBe(1);

    // O que a porta faria com outra aprovação confirmada destes mesmos argumentos.
    const d = await naEmpresa(() => servico.efeito(assinados, ORG, { orgId: ORG, actorId: LUCAS.id, correlationId: 'outra' }));
    expect(d.estado).toBe('publicada');
    expect(graph.publishes(), 'a segunda execução publicou de novo').toBe(1);
    expect(graph.containersCriados(), 'a segunda execução criou container').toHaveLength(1);
    await expect(pedir(id)).rejects.toThrow(/já foi publicada/);
  });

  it('voltar ao manual: a aprovação antiga confirmada depois não publica', async () => {
    const id = await novaPeca('story');
    const r = await pedir(id);
    const pub = await naEmpresa(() => servico.voltarAoManual(ORG, id, PEDRO.id));
    expect(pub.estado).toBe('recusada');
    await expect(confirmarEExecutar(r)).rejects.toThrow(/fluxo manual|voltou/i);
    expect(graph.chamadas.filter((c) => c.metodo === 'POST')).toEqual([]);
  });

  it('a rotina, sem lote, registra pulada — com a nota desligada ou ligada — e não chama ninguém', async () => {
    const id = await novaPeca('carrossel', 'aprovada', { agendadaPara: new Date(Date.now() - 10 * 60_000) });
    const desligada = await comContexto({ orgId: ORG, correlationId: 'rotina-3', origem: 'cron' }, () => servico.olharOHorario(ORG, 'rotina-3'));
    expect(desligada.find((l) => l.rotulo.includes('carrossel'))?.detalhe).toBe('publicação automática desligada');
    expect(desfechoDaPublicacao(desligada).status).toBe('pulada');

    // A decisão fica no RASTRO, uma vez por peça, slot e motivo — não uma linha por minuto.
    const puladas = () =>
      prisma.auditLog.findMany({
        where: { orgId: ORG, action: ACAO_DO_PASSO, entityId: id, after: { path: ['passo'], equals: 'pulada' } },
        orderBy: { createdAt: 'asc' },
      });
    await comContexto({ orgId: ORG, correlationId: 'rotina-3b', origem: 'cron' }, () => servico.olharOHorario(ORG, 'rotina-3b'));
    expect((await puladas()).map((l) => (l.after as { motivo: string }).motivo)).toEqual(['publicação automática desligada']);

    nota = { body: 'ligada\n', arquivadoEm: null };
    const ligada = await comContexto({ orgId: ORG, correlationId: 'rotina-3', origem: 'cron' }, () => servico.olharOHorario(ORG, 'rotina-3'));
    expect(ligada.find((l) => l.rotulo.includes('carrossel'))?.detalhe).toBe('sem aprovação da semana');
    const registradas = await puladas();
    expect(registradas.map((l) => (l.after as { motivo: string }).motivo)).toEqual(['publicação automática desligada', 'sem aprovação da semana']);
    expect(registradas[1].after).toMatchObject({ agendadaPara: new Date(Date.now() - 10 * 60_000).toISOString() });
    expect(graph.chamadas).toEqual([]);
    expect(await prisma.pautaPublicacao.count({ where: { pecaId: id } })).toBe(0);
    expect((await prisma.pautaPeca.findUniqueOrThrow({ where: { id } })).status).toBe('aprovada');
  });

  // -------------------------------------------------------------------------
  // A posse da linha: o tique da rotina no meio do efeito
  // -------------------------------------------------------------------------

  const rotina = (c: string) => comContexto({ orgId: ORG, correlationId: c, origem: 'cron' }, () => servico.concluir(ORG, c));
  const avancarRelogio = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));
  /** O histórico da hora acenderia `volume_atipico` e subiria o segundo pedido a R4: empurra-o para trás. */
  const esfriarHistorico = () => prisma.toolCall.updateMany({ where: { orgId: ORG }, data: { criadoEm: new Date(Date.now() - 3 * 3600_000) } });
  const noAr = (id: string) => prisma.auditLog.count({ where: { orgId: ORG, action: 'pauta.peca_publicada', entityId: id } });

  it('o tique da rotina no meio da criação dos containers não pega a linha: o carrossel aprovado sai uma vez', async () => {
    const id = await novaPeca('carrossel');
    const r = await pedir(id);
    const doTique: unknown[] = [];
    ganchos.antesDoCriar = async () => {
      avancarRelogio(61_000);
      doTique.push(...(await rotina('rotina-no-meio')));
    };
    const exec = await confirmarEExecutar(r);
    expect(doTique, 'a rotina tomou a linha do efeito').toEqual([]);
    expect(exec.status).toBe('executado');
    expect(graph.containersCriados()).toHaveLength(6);
    expect(graph.publishes()).toBe(1);
    expect(await noAr(id)).toBe(1);
    expect((await prisma.pautaPublicacao.findFirstOrThrow({ where: { orgId: ORG, pecaId: id } })).estado).toBe('publicada');
  });

  it('o tique da rotina no meio do media_publish não publica de novo o mesmo container', async () => {
    const id = await novaPeca('story');
    const r = await pedir(id);
    const doTique: unknown[] = [];
    ganchos.antesDoPublicar = async () => {
      avancarRelogio(61_000);
      doTique.push(...(await rotina('rotina-no-publish')));
    };
    await confirmarEExecutar(r);
    expect(doTique).toEqual([]);
    expect(graph.publishes(), 'dois media_publish do mesmo container').toBe(1);
    expect(graph.publicados).toHaveLength(1);
    expect(await noAr(id)).toBe(1);
  });

  it('com a posse vencida no meio do publish, a rotina só relê o status: nunca chama media_publish de novo', async () => {
    const id = await novaPeca('story');
    const r = await pedir(id);
    const doTique: Array<{ resultado: string }> = [];
    let publishesNoTique = -1;
    ganchos.antesDoPublicar = async () => {
      avancarRelogio(7 * 60_000);
      doTique.push(...(await rotina('rotina-atrasada')));
      publishesNoTique = graph.publishes();
    };
    await confirmarEExecutar(r);
    expect(doTique.map((l) => l.resultado)).toEqual(['processando']);
    expect(publishesNoTique).toBe(0);
    expect(graph.publishes()).toBe(1);
    expect(await noAr(id)).toBe(1);
    const passos = await prisma.auditLog.findMany({ where: { orgId: ORG, action: ACAO_DO_PASSO, entityId: id }, orderBy: { createdAt: 'asc' } });
    expect(passos.map((l) => (l.after as { passo: string }).passo)).toContain('confirmando');
  });

  it('publish sem resposta e sem post: relê a cada minuto sem republicar, vira erro em 10 min, e o pedido novo confere o container antigo antes', async () => {
    const id = await novaPeca('story');
    graph.perderPublishSemPostar = true;
    const exec = await confirmarEExecutar(await pedir(id));
    expect(exec.status).toBe('executado');
    let pub = await prisma.pautaPublicacao.findFirstOrThrow({ where: { orgId: ORG, pecaId: id } });
    expect(pub.estado).toBe('container_criado');
    expect(pub.erro).toMatch(/se perdeu/);
    expect(graph.publishes()).toBe(1);

    avancarRelogio(65_000);
    expect((await rotina('rotina-4')).map((l) => l.resultado)).toEqual(['processando']);
    expect(graph.publishes(), 'a rotina republicou o container').toBe(1);

    avancarRelogio(10 * 60_000);
    expect((await rotina('rotina-5')).map((l) => l.resultado)).toEqual(['erro']);
    pub = await prisma.pautaPublicacao.findFirstOrThrow({ where: { orgId: ORG, pecaId: id } });
    expect(pub.estado).toBe('erro');
    expect(pub.erro).toMatch(/confira no Instagram/);
    expect(graph.publishes()).toBe(1);

    // O pedido novo relê o container antigo (segue FINISHED, não saiu) e só então cria outro.
    graph.perderPublishSemPostar = false;
    await esfriarHistorico();
    const statusAntes = graph.chamadas.length;
    await confirmarEExecutar(await pedir(id));
    const depois = graph.chamadas.slice(statusAntes);
    expect(depois[0]).toMatchObject({ metodo: 'GET', campos: { fields: 'status_code,status' } });
    expect(graph.publicados).toHaveLength(1);
    expect((await prisma.pautaPeca.findUniqueOrThrow({ where: { id } })).status).toBe('publicada');
  });

  it('o pedido novo depois de um publish incerto acha o post antigo PUBLISHED e não cria container nem publica', async () => {
    const id = await novaPeca('carrossel');
    const corpo = (await prisma.pautaPeca.findUniqueOrThrow({ where: { id } })).corpo;
    const criadoEm = new Date(Date.now() - 30 * 60_000).toISOString();
    await prisma.pautaPublicacao.create({
      data: {
        pecaId: id,
        rede: 'instagram',
        estado: 'erro',
        erro: 'A Meta não confirmou se o post saiu',
        containers: { final: 'c-antigo', criadoEm, publicandoEm: criadoEm, legenda: corpo },
      },
    });
    graph.publicados.push({ id: 'm-antigo', caption: corpo, container: 'c-antigo', timestamp: new Date(Date.now() - 29 * 60_000).toISOString() });
    const exec = await confirmarEExecutar(await pedir(id));
    expect(exec.status).toBe('executado');
    expect(graph.containersCriados()).toEqual([]);
    expect(graph.publishes()).toBe(0);
    const p = await prisma.pautaPeca.findUniqueOrThrow({ where: { id } });
    expect(p).toMatchObject({ status: 'publicada', externalId: 'm-antigo' });
  });

  it('o pedido que venceu ou foi recusado na fila chega à tela como erro, com o motivo, e pede-se de novo', async () => {
    const id = await novaPeca('story');
    const r = await pedir(id);
    expect(await servico.daPeca(ORG, id)).toMatchObject({ estado: 'pendente', erro: null });

    await prisma.approval.update({ where: { id: r.approvalId }, data: { expiraEm: new Date(Date.now() - 1000) } });
    expect(await servico.daPeca(ORG, id)).toMatchObject({ estado: 'erro', erro: expect.stringMatching(/venceu sem a confirmação/) });

    await prisma.approval.update({ where: { id: r.approvalId }, data: { status: 'rejeitada', expiraEm: new Date(Date.now() + 600_000) } });
    expect(await servico.daPeca(ORG, id)).toMatchObject({ estado: 'erro', erro: expect.stringMatching(/recusou o pedido/) });

    await esfriarHistorico();
    const r2 = await pedir(id);
    expect(r2.approvalId).not.toBe(r.approvalId);
    expect(await servico.daPeca(ORG, id)).toMatchObject({ estado: 'pendente', erro: null });
  });

  it('a aprovação de um pedido antigo não publica: só a do pedido gravado na linha', async () => {
    const id = await novaPeca('story');
    const r1 = await pedir(id);
    await naEmpresa(() => servico.voltarAoManual(ORG, id, PEDRO.id));
    await esfriarHistorico();
    const r2 = await pedir(id);
    await expect(confirmarEExecutar(r1)).rejects.toThrow(/pedido antigo/);
    expect(graph.chamadas).toEqual([]);
    expect(await prisma.pautaPublicacao.findFirstOrThrow({ where: { orgId: ORG, pecaId: id } })).toMatchObject({ estado: 'pendente', approvalId: r2.approvalId });
    expect((await confirmarEExecutar(r2)).status).toBe('executado');
    expect(graph.publishes()).toBe(1);
  });

  it('sem a URL pública da mídia, "Publicar agora" responde 503 antes da fila: nenhuma aprovação queimada', async () => {
    const id = await novaPeca('story');
    const antes = process.env.PAUTA_MIDIA_PUBLICA_SEGREDO;
    delete process.env.PAUTA_MIDIA_PUBLICA_SEGREDO;
    try {
      const n = await prisma.approval.count({ where: { orgId: ORG } });
      await expect(pedir(id)).rejects.toThrow(/URL pública da mídia está desligada/);
      expect(await prisma.approval.count({ where: { orgId: ORG } })).toBe(n);
    } finally {
      process.env.PAUTA_MIDIA_PUBLICA_SEGREDO = antes;
    }
  });
});
