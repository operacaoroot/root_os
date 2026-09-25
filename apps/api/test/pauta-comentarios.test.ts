import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INSTAGRAM_ESCOPO_DE_COMENTARIOS,
  INSTAGRAM_ESCOPO_DE_PUBLICAR,
  PAUTA_CAPACIDADE_DE_LER_COMENTARIOS,
  PAUTA_DM_TETO_BYTES,
  PAUTA_TIPO_DA_ROTINA_DE_COMENTARIOS,
  PautaTextoDaDmSchema,
  bytesUtf8,
  perfilDoInstagram,
  type PautaItemCurado,
} from '@mktos/shared';
import * as instagram from '../src/bio/plataformas/instagram';
import {
  casaPalavraInteira,
  chaveDaDm,
  chaveDaPessoa,
  expiraEmDo,
  hmacDaPessoa,
  linhaDoResumo,
  mesmoPermalink,
  problemaDoTextoDaDm,
  textoDaDm,
  triarComentario,
} from '../src/pauta/dm-por-comentario';
import { ComentariosService } from '../src/pauta/comentarios.service';
import { ComentariosController } from '../src/pauta/comentarios.controller';
import type { GraphDeComentarios } from '../src/pauta/graph-de-comentarios';
import { AGENTE_DO_TIPO, MODULO_DO_TIPO, TIPOS_DA_PAUTA, TIPO_PAUTA_COMENTARIOS, type ContextoDaRotina } from '../src/routines/rotina.tipos';
import { ExecutorDeComentariosDaPauta } from '../src/routines/executores/pauta-comentarios.executor';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { ConectoresService } from '../src/integrations/conectores.service';
import { BioService } from '../src/bio/bio.service';
import { BioChallengeService } from '../src/bio/bio-challenge.service';
import { BioPublicController } from '../src/bio/bio-public.controller';
import { BioTrackingService } from '../src/bio/bio-tracking.service';
import { comContexto, novaCorrelacao } from '../src/common/contexto-execucao';
import { cifrar } from '../src/common/crypto';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import type { MemoriaService } from '../src/memory/memoria.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * MD9 — A DM POR PALAVRA-CHAVE, RESPONDIDA À MÃO (MC18.0 + o coletor).
 *
 * Sem banco: o casamento da palavra inteira, a triagem do comentário, o texto
 * da DM (bytes, link rastreado, caixa de entrada, anti-slop), o HMAC da pessoa,
 * o permalink colado à mão, as constantes e as permissões. Com banco: a porta
 * de verdade com a política semeada, e um dublê da Graph num servidor HTTP
 * local que pagina os comentários pelo cursor e responde as mídias da conta.
 */

describe('MD9: a palavra, o comentário e o texto (puro)', () => {
  it('a palavra casa INTEIRA, sem caixa e sem acento; "AGENTES2" não é "AGENTES"', () => {
    expect(casaPalavraInteira('Quero AGENTES!', 'AGENTES')).toBe(true);
    expect(casaPalavraInteira('#agentes por favor', 'AGENTES')).toBe(true);
    expect(casaPalavraInteira('agêntes', 'AGENTES')).toBe(true);
    expect(casaPalavraInteira('AGENTES2', 'AGENTES')).toBe(false);
    expect(casaPalavraInteira('agentesia', 'AGENTES')).toBe(false);
    expect(casaPalavraInteira('AGENTES2 aqui', 'AGENTES2')).toBe(true);
    expect(casaPalavraInteira('qualquer coisa', '')).toBe(false);
    // O risco declarado: a palavra dentro de uma frase qualquer também casa.
    expect(casaPalavraInteira('não quero saber de agentes', 'AGENTES')).toBe(true);
  });

  const agora = new Date('2026-09-10T17:00:00Z');
  const ctx = { palavra: 'AGENTES', igUserId: 'ig-root', handle: 'operacaoroot', agora, incluirRespostas: false };
  const c = (over: Partial<Parameters<typeof triarComentario>[0]> = {}) => ({
    texto: 'AGENTES',
    timestamp: '2026-09-10T12:00:00+0000',
    deId: 'p-1',
    deUsuario: 'fulano',
    parentId: null,
    adId: null,
    ...over,
  });

  it('a triagem: a própria conta (pelo id ou pelo @), anúncio, resposta, mais de 7 dias, sem palavra', () => {
    expect(triarComentario(c(), ctx)).toEqual({ entra: true, comentadoEm: new Date('2026-09-10T12:00:00Z') });
    expect(triarComentario(c({ deId: 'ig-root' }), ctx)).toEqual({ entra: false, motivo: 'propria_conta' });
    expect(triarComentario(c({ deUsuario: 'OperacaoRoot' }), ctx)).toEqual({ entra: false, motivo: 'propria_conta' });
    expect(triarComentario(c({ adId: 'ad-1' }), ctx)).toEqual({ entra: false, motivo: 'anuncio' });
    expect(triarComentario(c({ parentId: 'c-0' }), ctx)).toEqual({ entra: false, motivo: 'resposta' });
    expect(triarComentario(c({ parentId: 'c-0' }), { ...ctx, incluirRespostas: true }).entra).toBe(true);
    expect(triarComentario(c({ timestamp: '2026-09-02T12:00:00+0000' }), ctx)).toEqual({ entra: false, motivo: 'antigo' });
    expect(triarComentario(c({ texto: 'AGENTES2' }), ctx)).toEqual({ entra: false, motivo: 'sem_palavra' });
    expect(triarComentario(c({ timestamp: null }), ctx)).toEqual({ entra: false, motivo: 'sem_data' });
    expect(triarComentario(c({ deUsuario: 'nome com espaço' }), ctx)).toEqual({ entra: false, motivo: 'sem_autor' });
  });

  it('o texto da DM leva o /r/ e a página, sem link de caixa de entrada, e cabe em 1000 bytes', () => {
    const t = textoDaDm({
      materia: 'Agentes no escritório https://mail.google.com/mail/u/0/#inbox/abc',
      link: 'https://bio.teste/r/l1',
      pagina: 'https://bio.teste/@root-ep-07',
    });
    expect(t).toContain('https://bio.teste/r/l1');
    expect(t).toContain('https://bio.teste/@root-ep-07');
    expect(t).not.toMatch(/mail\.google\.com/);
    expect(bytesUtf8(t)).toBeLessThanOrEqual(PAUTA_DM_TETO_BYTES);
    expect(problemaDoTextoDaDm(t, 'https://bio.teste/r/l1')).toBeNull();
  });

  it('a Meta mede em BYTES: 600 "ç" são 600 caracteres e 1200 bytes, e não passam', () => {
    const acentos = `https://bio.teste/r/l1 ${'ç'.repeat(600)}`;
    expect(acentos.length).toBeLessThan(PAUTA_DM_TETO_BYTES);
    expect(bytesUtf8(acentos)).toBeGreaterThan(PAUTA_DM_TETO_BYTES);
    expect(problemaDoTextoDaDm(acentos, 'https://bio.teste/r/l1')?.motivo).toMatch(/bytes/);
    expect(PautaTextoDaDmSchema.safeParse({ texto: acentos }).success).toBe(false);
    expect(PautaTextoDaDmSchema.safeParse({ texto: 'a'.repeat(1000) }).success).toBe(true);
    expect(PautaTextoDaDmSchema.safeParse({ texto: null }).success).toBe(true);
    expect(bytesUtf8('ação')).toBe(6);
    expect(bytesUtf8('🙂')).toBe(4);
  });

  it('o texto editado precisa do link rastreado e passar na checagem anti-slop', () => {
    expect(problemaDoTextoDaDm('Segue o link: https://outro.site', 'https://bio.teste/r/l1')?.motivo).toMatch(/link rastreado/);
    expect(problemaDoTextoDaDm('Segue 🚀 https://bio.teste/r/l1', 'https://bio.teste/r/l1')?.motivo).toMatch(/anti-slop/);
    expect(problemaDoTextoDaDm('   ', 'https://bio.teste/r/l1')?.motivo).toMatch(/vazio/);
  });

  it('o HMAC da pessoa é estável, depende da chave e não carrega o id', () => {
    const k = 'k'.repeat(40);
    expect(hmacDaPessoa('p-1', k)).toBe(hmacDaPessoa('p-1', k));
    expect(hmacDaPessoa('p-1', k)).not.toBe(hmacDaPessoa('p-1', 'x'.repeat(40)));
    expect(hmacDaPessoa('p-1', k)).toMatch(/^[0-9a-f]{64}$/);
    expect(hmacDaPessoa('p-1', k)).not.toContain('p-1');
    expect(chaveDaPessoa({ META_WEBHOOK_PESSOA_HMAC_KEY: 'curta' })).toBeNull();
    expect(chaveDaPessoa({ META_WEBHOOK_PESSOA_HMAC_KEY: `  ${k}  ` })).toBe(k);
    expect(chaveDaPessoa({})).toBeNull();
  });

  it('o permalink colado à mão casa com o da Graph pelo caminho; o @ vira o endereço do perfil', () => {
    expect(mesmoPermalink('https://www.instagram.com/reel/ABC/?igsh=x', 'https://instagram.com/reel/ABC')).toBe(true);
    expect(mesmoPermalink('https://www.instagram.com/p/ABC/', 'https://www.instagram.com/p/ABD/')).toBe(false);
    expect(mesmoPermalink('não é url', 'https://instagram.com/p/x')).toBe(false);
    expect(perfilDoInstagram('@fulano.silva')).toBe('https://www.instagram.com/fulano.silva/');
    expect(perfilDoInstagram('javascript:alert(1)')).toBeNull();
    expect(perfilDoInstagram(null)).toBeNull();
  });

  it('o link é um por matéria, o @ vive 7 dias, e o resumo da passagem só tem números', () => {
    expect(chaveDaDm('item-1')).toBe('campanha:dm:item-1');
    expect(expiraEmDo(new Date('2026-09-10T12:00:00Z')).toISOString()).toBe('2026-09-17T12:00:00.000Z');
    const r = linhaDoResumo({ midias: 2, lidos: 7, novos: 1, jaNaFila: 0, ignorados: { propria_conta: 1, sem_palavra: 2 }, truncadas: 0, semMidia: 0, expurgados: 3 });
    expect(r).toBe('2 post(s), 7 comentário(s) lido(s) · 1 novo(s) na fila · ignorados: da própria conta 1, sem a palavra 2 · 3 @ apagado(s) depois dos 7 dias');
  });

  it('a rotina é da pauta, do agente da pauta, e o tipo e a capacidade são os do shared', () => {
    expect(TIPO_PAUTA_COMENTARIOS).toBe(PAUTA_TIPO_DA_ROTINA_DE_COMENTARIOS);
    expect(TIPOS_DA_PAUTA).toContain(TIPO_PAUTA_COMENTARIOS);
    expect(AGENTE_DO_TIPO[TIPO_PAUTA_COMENTARIOS]).toBe('editor-de-pauta');
    expect(MODULO_DO_TIPO[TIPO_PAUTA_COMENTARIOS]).toBe('pauta');
    expect(PAUTA_CAPACIDADE_DE_LER_COMENTARIOS).toBe('instagram.comentario.ler');
  });

  it('ler a fila pede pauta.ver; marcar respondido, pauta.publicar; preparar e editar o texto, pauta.editar', () => {
    const p = ComentariosController.prototype;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.fila)).toEqual(['pauta.ver']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.respondido)).toEqual(['pauta.publicar']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.preparar)).toEqual(['pauta.editar']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.editar)).toEqual(['pauta.editar']);
  });

  it('a variável nova está no compose e no .env.example', () => {
    const raiz = path.join(__dirname, '..', '..', '..');
    expect(readFileSync(path.join(raiz, 'docker-compose.yml'), 'utf8')).toMatch(/META_WEBHOOK_PESSOA_HMAC_KEY: \$\{META_WEBHOOK_PESSOA_HMAC_KEY:-\}/);
    expect(readFileSync(path.join(raiz, '.env.example'), 'utf8')).toMatch(/^META_WEBHOOK_PESSOA_HMAC_KEY=$/m);
  });
});

// ---------------------------------------------------------------------------
// O dublê da Graph
// ---------------------------------------------------------------------------

interface ComentarioDoDuble {
  id: string;
  text: string;
  timestamp: string;
  from: { id: string; username: string };
  parent_id?: string;
  ad_id?: string;
}

/** Como a Graph: só volta o campo que o `fields` pediu (`from{id,username}` conta como `from`). */
function soOsCampos(o: object, fields: string | undefined): Record<string, unknown> {
  const pedidos = new Set((fields ?? '').split(',').map((f) => f.replace(/\{.*$/, '').trim()).filter(Boolean));
  return Object.fromEntries(Object.entries(o).filter(([k]) => pedidos.has(k)));
}

class GraphDuble {
  chamadas: Array<{ caminho: string; campos: Record<string, string> }> = [];
  comentarios = new Map<string, ComentarioDoDuble[]>();
  midias: Array<{ id: string; timestamp: string; permalink: string }> = [];
  porPagina = 2;
  midiasFalham = false;

  zerar() {
    this.chamadas = [];
    this.comentarios.clear();
    this.midias = [];
    this.midiasFalham = false;
  }

  /** Uma página pelo cursor `after`. O `next` aponta para fora de propósito: seguir o corpo levaria o token para lá. */
  private pagina<T extends object>(todos: T[], campos: Record<string, string>) {
    const de = campos.after ? Number(campos.after) : 0;
    const proximo = de + this.porPagina < todos.length ? String(de + this.porPagina) : null;
    return {
      data: todos.slice(de, de + this.porPagina).map((o) => soOsCampos(o, campos.fields)),
      ...(proximo ? { paging: { cursors: { after: proximo }, next: `https://graph.fora-do-os.invalid/x?after=${proximo}` } } : {}),
    };
  }

  tratar(caminho: string, campos: Record<string, string>): { status: number; corpo: unknown } {
    this.chamadas.push({ caminho, campos });
    if (caminho === '/graph/me/media') {
      if (this.midiasFalham) return { status: 500, corpo: { error: { message: 'a Graph caiu' } } };
      return { status: 200, corpo: this.pagina(this.midias, campos) };
    }
    const m = /^\/graph\/v24\.0\/([^/]+)\/comments$/.exec(caminho);
    if (m) return { status: 200, corpo: this.pagina(this.comentarios.get(decodeURIComponent(m[1])) ?? [], campos) };
    return { status: 404, corpo: { error: { message: 'rota do dublê desconhecida' } } };
  }

  lidasDe(midia: string): number {
    return this.chamadas.filter((c) => c.caminho.endsWith(`/${midia}/comments`)).length;
  }
}

// ---------------------------------------------------------------------------
// Com banco: a porta de verdade
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (uma empresa, peças publicadas, a fila de comentários e RASTRO)');

const ORG = 'org-md9-comentarios';
const PEDRO = { id: 'pedro-md9', papeis: ['admin_master'] };
const CHAVE = 'chave-do-hmac-da-pessoa-md9-0123456789abcdef';
const RID = 'rid-md9-visitante';

const ITENS: PautaItemCurado[] = [
  { id: 'item-1', titulo: 'Agentes de IA no escritório', url: 'https://noticia.exemplo/agentes', origem: 'R' },
  { id: 'item-2', titulo: 'The Batch desta semana', url: 'https://mail.google.com/mail/u/0/#inbox/abc', origem: 'L' },
  { id: 'item-3', titulo: 'Planilha com agente', url: 'https://noticia.exemplo/planilha', origem: 'N' },
];

function metaDaPeca(formato: 'carrossel' | 'corte', episodioId: string, itemN: number, palavra: string) {
  return {
    episodioId,
    itemId: ITENS[itemN - 1].id,
    itemN,
    formato,
    transcricaoSha: 't',
    linkDaMateria: null,
    avisos: [],
    imagens: [],
    palavraChave: palavra,
  };
}

describe.skipIf(!URL)('MD9: a fila da DM à mão pela porta, com o dublê da Graph', () => {
  let prisma: PrismaClient;
  let servidor: Server;
  const graph = new GraphDuble();
  let servico: ComentariosService;
  let conectores: ConectoresService;
  let publico: BioPublicController;
  let episodioId = '';
  let pageId = '';
  let botaoDaPagina = '';
  let carrossel = '';
  let corte = '';
  let daNewsletter = '';
  let nota: { body: string; arquivadoEm: string | null } | null = null;
  let relogio = new Date('2026-09-10T14:00:00-03:00');
  const ambienteAntes: Record<string, string | undefined> = {};
  const AMBIENTE = ['INSTAGRAM_GRAPH_URL', 'META_WEBHOOK_PESSOA_HMAC_KEY', 'ENCRYPTION_KEY', 'GATEWAY_MODO', 'PUBLIC_BIO_ORIGIN'];

  const naEmpresa = <T>(fn: () => Promise<T>, correlationId = 'rotina-md9'): Promise<T> =>
    comContexto({ orgId: ORG, correlationId, origem: 'http' }, fn);
  const coletar = () => naEmpresa(() => servico.coletar(ORG));

  function comentario(id: string, texto: string, quem: { id: string; username: string }, horasAtras = 2, extra: Partial<ComentarioDoDuble> = {}): ComentarioDoDuble {
    return { id, text: texto, timestamp: new Date(relogio.getTime() - horasAtras * 3600_000).toISOString(), from: quem, ...extra };
  }

  beforeAll(async () => {
    vi.setSystemTime(relogio);
    for (const k of AMBIENTE) ambienteAntes[k] = process.env[k];
    process.env.GATEWAY_MODO = 'impor';
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.META_WEBHOOK_PESSOA_HMAC_KEY = CHAVE;
    process.env.PUBLIC_BIO_ORIGIN = 'https://bio.teste';

    servidor = createServer((req, res) => {
      const u = new globalThis.URL(req.url ?? '/', 'http://x');
      const campos = Object.fromEntries(u.searchParams);
      delete campos.access_token;
      const r = graph.tratar(u.pathname, campos);
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.corpo));
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    process.env.INSTAGRAM_GRAPH_URL = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/graph`;

    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await prisma.org.upsert({
      where: { id: ORG },
      create: { id: ORG, name: 'Comentários MD9', slug: 'comentarios-md9', modulos: ['pauta', 'bio'] },
      update: { modulos: ['pauta', 'bio'] },
    });
    const papel = await prisma.role.upsert({
      where: { orgId_key: { orgId: ORG, key: 'admin_master' } },
      create: { orgId: ORG, key: 'admin_master', name: 'Admin Master' },
      update: {},
      select: { id: true },
    });
    await prisma.user.upsert({
      where: { id: PEDRO.id },
      create: { id: PEDRO.id, orgId: ORG, email: 'pedro@md9.teste', name: 'Pedro MD9', passwordHash: 'sem-senha-util', roles: { connect: { id: papel.id } } },
      update: { isActive: true },
    });
    await prisma.bioConexao.deleteMany({ where: { orgId: ORG } });
    await prisma.bioConexao.create({
      data: {
        orgId: ORG,
        plataforma: 'instagram',
        externalId: 'ig-root',
        handle: 'operacaoroot',
        tokenCifrado: cifrar('token-de-publicacao'),
        escopos: `instagram_business_basic,${INSTAGRAM_ESCOPO_DE_PUBLICAR},${INSTAGRAM_ESCOPO_DE_COMENTARIOS}`,
        finalidade: 'publicacao',
        expiraEm: new Date(Date.now() + 50 * 86_400_000),
      },
    });

    const pagina = await prisma.bioPage.create({ data: { orgId: ORG, handle: 'root-md9-ep-01', titulo: 'Episódio 1', publicada: true } });
    pageId = pagina.id;
    // O botão da matéria na página do episódio (MC12): outro link, outro clique.
    botaoDaPagina = (
      await prisma.bioLink.create({ data: { pageId, ordem: 1, rotulo: ITENS[0].titulo, destino: ITENS[0].url, chave: 'pauta:item:md9', ativo: true } })
    ).id;
    const rodada = await prisma.pautaRodada.create({
      data: { orgId: ORG, status: 'curada', titulo: 'Rodada MD9', janelaIni: relogio, janelaFim: relogio, itens: ITENS as never },
    });
    episodioId = (
      await prisma.pautaEpisodio.create({ data: { rodadaId: rodada.id, numero: 1, titulo: 'Episódio MD9', bioPageId: pageId } })
    ).id;
    const publicada = { status: 'publicada' as const, publicadaEm: new Date(relogio.getTime() - 86_400_000), canal: 'instagram' as const };
    carrossel = (
      await prisma.pautaPeca.create({
        data: { orgId: ORG, rodadaId: rodada.id, formato: 'carrossel', titulo: 'Carrossel dos agentes', corpo: 'x', meta: metaDaPeca('carrossel', episodioId, 1, 'AGENTES') as never, externalId: 'midia-carrossel', ...publicada },
      })
    ).id;
    await prisma.pautaPublicacao.create({ data: { pecaId: carrossel, rede: 'instagram', estado: 'publicada', externalId: 'midia-carrossel', permalink: 'https://www.instagram.com/p/CAR/' } });
    // O corte da planilha, postado à mão (MC16): só o permalink colado.
    corte = (
      await prisma.pautaPeca.create({
        data: { orgId: ORG, rodadaId: rodada.id, formato: 'corte', titulo: 'Corte da planilha', corpo: 'x', meta: metaDaPeca('corte', episodioId, 3, 'PLANILHA') as never, urlPublicada: 'https://www.instagram.com/reel/COR/?igsh=abc', ...publicada },
      })
    ).id;
    // A matéria da newsletter: palavra no CTA, mas nenhum link público.
    daNewsletter = (
      await prisma.pautaPeca.create({
        data: { orgId: ORG, rodadaId: rodada.id, formato: 'carrossel', titulo: 'Carrossel da newsletter', corpo: 'x', meta: metaDaPeca('carrossel', episodioId, 2, 'BATCH') as never, ...publicada, externalId: 'midia-newsletter' },
      })
    ).id;

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    const approvals = new ApprovalsService(p, audit);
    const eventos = new EventLogService(p);
    const registro = new EfeitosRegistry();
    const interruptores = new InterruptoresRegistry();
    conectores = new ConectoresService(p, audit, eventos, interruptores);
    conectores.onModuleInit();
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, eventos, undefined, interruptores, registro);
    const porta = new PortaDoOperador(gateway, registro);
    const memoria = { porChave: async () => nota } as unknown as MemoriaService;
    const cliente: GraphDeComentarios = { comentariosDa: instagram.comentariosDa, midiasDesde: instagram.midiasDesde };
    servico = new ComentariosService(p, audit, registro, porta, memoria, cliente);
    servico.agora = () => relogio;
    servico.onModuleInit();
    const bio = new BioService(p, audit, new BioChallengeService(p, audit) as never, {} as never);
    publico = new BioPublicController(bio, new BioTrackingService(p), {} as never);
  }, 60_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = $1', ORG),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.pixelEvent.deleteMany({ where: { orgId: ORG } });
    await prisma.bioEvent.deleteMany({ where: { orgId: ORG } });
    await prisma.bioVisit.deleteMany({ where: { orgId: ORG } });
    await prisma.bioVisitor.deleteMany({ where: { id: RID } });
    await prisma.comentarioComPalavra.deleteMany({ where: { orgId: ORG } });
    await prisma.pautaPublicacao.deleteMany({ where: { orgId: ORG } });
    await prisma.pautaPeca.deleteMany({ where: { orgId: ORG } });
    await prisma.pautaEpisodio.deleteMany({ where: { orgId: ORG } });
    await prisma.pautaRodada.deleteMany({ where: { orgId: ORG } });
    await prisma.bioLink.deleteMany({ where: { page: { orgId: ORG } } });
    await prisma.bioPage.deleteMany({ where: { orgId: ORG } });
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
    relogio = new Date('2026-09-10T14:00:00-03:00');
    vi.setSystemTime(relogio);
    graph.zerar();
    nota = null;
    process.env.META_WEBHOOK_PESSOA_HMAC_KEY = CHAVE;
    await prisma.conectorDesligado.deleteMany({ where: { orgId: ORG } });
    await prisma.comentarioComPalavra.deleteMany({ where: { orgId: ORG } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
    await prisma.approval.deleteMany({ where: { orgId: ORG } });
  });

  const FULANO = { id: 'pessoa-fulano', username: 'fulano.silva' };
  const BELTRANO = { id: 'pessoa-beltrano', username: 'beltrano' };
  const ROOT = { id: 'ig-root', username: 'operacaoroot' };

  it('PRONTO QUANDO: a palavra certa, "palavra2" e a própria conta viram UMA linha, com o @ e o texto com o /r/ da matéria', async () => {
    graph.comentarios.set('midia-carrossel', [
      comentario('c-1', 'AGENTES por favor', FULANO),
      comentario('c-2', 'AGENTES2', BELTRANO),
      comentario('c-3', 'AGENTES — respondendo no direct', ROOT),
    ]);
    const r = await coletar();
    expect(r.status).toBe('ok');
    expect(r.resumo).toMatch(/1 novo\(s\) na fila/);
    expect(r.resumo).toMatch(/da própria conta 1/);
    expect(r.resumo).toMatch(/sem a palavra 1/);
    // Paginação pelo cursor: 3 comentários, 2 por página → duas leituras, a segunda com `after`.
    expect(graph.lidasDe('midia-carrossel')).toBe(2);
    expect(graph.chamadas.find((c) => c.caminho.endsWith('/midia-carrossel/comments') && c.campos.after)?.campos.after).toBe('2');
    expect(graph.chamadas.find((c) => c.caminho.endsWith('/midia-carrossel/comments'))?.campos.fields).toBe('id,text,timestamp,from{id,username},parent_id');

    const linhas = await prisma.comentarioComPalavra.findMany({ where: { orgId: ORG } });
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ pecaId: carrossel, commentId: 'c-1', midiaId: 'midia-carrossel', palavra: 'AGENTES', usuario: 'fulano.silva' });
    expect(linhas[0].pessoaHmac).toBe(hmacDaPessoa('pessoa-fulano', CHAVE));
    expect(linhas[0].expiraEm.getTime() - linhas[0].comentadoEm.getTime()).toBe(7 * 86_400_000);

    const fila = await naEmpresa(() => servico.fila(ORG));
    expect(fila.pendentes).toBe(1);
    expect(fila.linhas).toHaveLength(1);
    const link = await prisma.bioLink.findFirst({ where: { pageId, chave: 'campanha:dm:item-1' } });
    expect(link, 'o link de campanha da DM nasceu com a linha').not.toBeNull();
    expect(link!.ativo).toBe(false);
    expect(link!.destino).toBe(ITENS[0].url);
    expect(fila.linhas[0]).toMatchObject({ usuario: 'fulano.silva', palavra: 'AGENTES', pecaId: carrossel, formato: 'carrossel', apelido: 'ep-01', motivo: null });
    expect(fila.linhas[0].texto).toContain(`https://bio.teste/r/${link!.id}`);
    expect(fila.linhas[0].texto).toContain('https://bio.teste/@root-md9-ep-01');
    // O texto do comentário não entra em nada.
    expect(fila.linhas[0].texto).not.toMatch(/por favor/);
  });

  it('o RASTRO e o registro da chamada não guardam o @ nem o id do comentário em claro', async () => {
    graph.comentarios.set('midia-carrossel', [comentario('c-secreto-1', 'AGENTES', FULANO)]);
    await coletar();
    const chamada = await prisma.toolCall.findFirst({ where: { orgId: ORG, capabilityId: 'instagram.comentario.ler' }, orderBy: { criadoEm: 'desc' } });
    expect(chamada?.status).toBe('executado');
    expect(chamada?.nivel).toBe('R0');
    const resultado = JSON.stringify(chamada?.resultado);
    expect(resultado).not.toContain('fulano.silva');
    expect(resultado).not.toContain('c-secreto-1');
    expect(resultado).not.toContain('pessoa-fulano');
    // O @ e o id do comentário têm pouca entropia: um sha256 sem chave se desfaz
    // calculando o hash dos candidatos. Fica só a marca com o rótulo.
    const sha = (v: string) => createHash('sha256').update(v).digest('hex');
    const resumosQueDesfazem = [sha('fulano.silva'), sha('c-secreto-1')];
    for (const h of resumosQueDesfazem) expect(resultado).not.toContain(h);
    expect(resultado).toContain('@ de quem comentou');
    expect(resultado).not.toContain('resumoCriptografico');
    const eventos = await prisma.eventLog.findMany({ where: { orgId: ORG, capabilityId: 'instagram.comentario.ler' } });
    expect(eventos.length).toBeGreaterThan(0);
    expect(eventos.some((e) => JSON.stringify(e.payload).includes('@ de quem comentou')), 'o resultado da leitura chegou ao RASTRO').toBe(true);
    for (const e of eventos) {
      const s = JSON.stringify(e.payload);
      expect(s).not.toContain('fulano.silva');
      expect(s).not.toContain('c-secreto-1');
      expect(s).not.toContain('pessoa-fulano');
      expect(s).not.toContain('AGENTES por favor');
      for (const h of resumosQueDesfazem) expect(s).not.toContain(h);
    }
  });

  it('a reentrega (a leitura de 10 em 10 min) cai na mesma linha', async () => {
    graph.comentarios.set('midia-carrossel', [comentario('c-1', 'agentes', FULANO)]);
    await coletar();
    const r = await coletar();
    expect(r.resumo).toMatch(/0 novo\(s\) na fila · 1 já estava/);
    expect(await prisma.comentarioComPalavra.count({ where: { orgId: ORG } })).toBe(1);
  });

  it('a peça postada à mão é achada pelo permalink nas mídias da conta (pelo cursor); resposta e comentário de 8 dias ficam fora', async () => {
    graph.midias = [
      { id: 'midia-outra', timestamp: relogio.toISOString(), permalink: 'https://www.instagram.com/p/OUTRA/' },
      { id: 'midia-outra-2', timestamp: relogio.toISOString(), permalink: 'https://www.instagram.com/p/OUTRA2/' },
      { id: 'midia-corte', timestamp: relogio.toISOString(), permalink: 'https://www.instagram.com/reel/COR/' },
    ];
    graph.comentarios.set('midia-corte', [
      comentario('k-1', 'PLANILHA!', BELTRANO),
      comentario('k-2', 'planilha', FULANO, 2, { parent_id: 'k-1' }),
      comentario('k-3', 'planilha', { id: 'p-velho', username: 'velho' }, 8 * 24),
    ]);
    const r = await coletar();
    expect(r.resumo).toMatch(/resposta a comentário 1/);
    expect(r.resumo).toMatch(/mais de 7 dias 1/);
    // O post do corte está na segunda página das mídias: achado pelo cursor, sem seguir o `next` do corpo.
    const dasMidias = graph.chamadas.filter((c) => c.caminho === '/graph/me/media');
    expect(dasMidias.map((c) => c.campos.after ?? null)).toEqual([null, '2']);
    const linhas = await prisma.comentarioComPalavra.findMany({ where: { orgId: ORG } });
    expect(linhas.map((l) => [l.pecaId, l.midiaId, l.usuario])).toEqual([[corte, 'midia-corte', 'beltrano']]);

    // Com a nota `pauta.comentarios.respostas` ligada, a resposta entra.
    nota = { body: 'ligada', arquivadoEm: null };
    await coletar();
    expect(await prisma.comentarioComPalavra.count({ where: { orgId: ORG } })).toBe(2);
  });

  it('marcar como respondido vai ao RASTRO só com o HMAC; a segunda vez é 409', async () => {
    graph.comentarios.set('midia-carrossel', [comentario('c-1', 'AGENTES', FULANO)]);
    await coletar();
    const [linha] = await prisma.comentarioComPalavra.findMany({ where: { orgId: ORG } });
    const saida = await naEmpresa(() => servico.marcarRespondido(ORG, linha.id, PEDRO.id));
    expect(saida.respondidoEm).not.toBeNull();
    expect(saida.respondidoPor).toBe('Pedro MD9');
    const rastro = await prisma.auditLog.findFirst({ where: { orgId: ORG, action: 'pauta.dm_manual_respondida', entityId: linha.id } });
    expect(rastro).not.toBeNull();
    expect(rastro!.after).toEqual({ pessoaHmac: hmacDaPessoa('pessoa-fulano', CHAVE), palavra: 'AGENTES', pecaId: carrossel });
    const s = JSON.stringify(rastro);
    expect(s).not.toContain('fulano.silva');
    expect(s).not.toContain('pessoa-fulano');
    expect(s).not.toContain('"c-1"');
    await expect(naEmpresa(() => servico.marcarRespondido(ORG, linha.id, PEDRO.id))).rejects.toThrow(/já foi marcado/);
    expect((await naEmpresa(() => servico.fila(ORG))).pendentes).toBe(0);
  });

  it('com 7 dias simulados o @ some da linha (e a fila não o mostra mais)', async () => {
    graph.comentarios.set('midia-carrossel', [comentario('c-1', 'AGENTES', FULANO)]);
    await coletar();
    relogio = new Date(relogio.getTime() + 7 * 86_400_000);
    vi.setSystemTime(relogio);
    const r = await coletar();
    expect(r.resumo).toMatch(/1 @ apagado\(s\) depois dos 7 dias/);
    const [linha] = await prisma.comentarioComPalavra.findMany({ where: { orgId: ORG } });
    expect(linha.usuario).toBeNull();
    expect(linha.pessoaHmac).toBe(hmacDaPessoa('pessoa-fulano', CHAVE));
    const fila = await naEmpresa(() => servico.fila(ORG));
    expect(fila.linhas[0].usuario).toBeNull();
    expect(fila.pendentes).toBe(0);
    // Fora da janela da tela (14 dias), marcar respondido ainda devolve a linha, sem o @.
    relogio = new Date(relogio.getTime() + 15 * 86_400_000);
    const tarde = await naEmpresa(() => servico.marcarRespondido(ORG, linha.id, PEDRO.id));
    expect(tarde).toMatchObject({ id: linha.id, usuario: null });
    expect(tarde.respondidoEm).not.toBeNull();
  });

  it('o clique no /r/ da DM vira PixelEvent do link da DM, separado do botão da página', async () => {
    graph.comentarios.set('midia-carrossel', [comentario('c-1', 'AGENTES', FULANO)]);
    await coletar();
    const link = await prisma.bioLink.findFirst({ where: { pageId, chave: 'campanha:dm:item-1' } });
    expect(link!.id).not.toBe(botaoDaPagina);
    const estado = { status: 0, destino: '' };
    const res = {
      redirect: (a: number | string, b?: string) => {
        estado.status = typeof a === 'number' ? a : 302;
        estado.destino = typeof a === 'number' ? (b ?? '') : a;
        return res;
      },
    };
    await comContexto({ orgId: null, correlationId: novaCorrelacao('http'), origem: 'http' }, () =>
      publico.redirect(link!.id, { headers: { cookie: `rid=${RID}`, 'user-agent': 'teste' }, originalUrl: `/api/bio/r/${link!.id}` } as never, res as never),
    );
    expect(estado).toEqual({ status: 302, destino: ITENS[0].url });
    // Tentativas contadas, não prazo: com `vi.setSystemTime` o `Date.now()` fica parado.
    let pixel = null;
    for (let tentativa = 0; tentativa < 300 && !pixel; tentativa++) {
      pixel = await prisma.pixelEvent.findFirst({ where: { orgId: ORG, eventName: 'link_click', anonymousId: RID, metadata: { path: ['linkId'], equals: link!.id } } });
      if (!pixel) await new Promise((ok) => setTimeout(ok, 50));
    }
    expect(pixel).not.toBeNull();
    expect(await prisma.pixelEvent.count({ where: { orgId: ORG, metadata: { path: ['linkId'], equals: botaoDaPagina } } })).toBe(0);
  }, 30_000);

  it('a matéria da newsletter não gera link de DM, e o texto diz por quê', async () => {
    graph.comentarios.set('midia-newsletter', [comentario('n-1', 'BATCH', FULANO)]);
    await coletar();
    const fila = await naEmpresa(() => servico.fila(ORG));
    const linha = fila.linhas.find((l) => l.pecaId === daNewsletter);
    expect(linha?.texto).toBeNull();
    expect(linha?.motivo).toMatch(/não tem link público/);
    expect(await prisma.bioLink.count({ where: { pageId, chave: 'campanha:dm:item-2' } })).toBe(0);
    const texto = fila.textos.find((t) => t.itemId === 'item-2');
    expect(texto).toMatchObject({ texto: null, link: null });
  });

  it('preparar os textos cria um link por matéria; o texto editado passa pela caixa de entrada, precisa do /r/ e volta ao padrão', async () => {
    const textos = await naEmpresa(() => servico.prepararTextos(ORG, episodioId, PEDRO.id));
    const agentes = textos.find((t) => t.itemId === 'item-1')!;
    const planilha = textos.find((t) => t.itemId === 'item-3')!;
    expect(agentes.link).toMatch(/^https:\/\/bio\.teste\/r\//);
    expect(planilha.link).toMatch(/^https:\/\/bio\.teste\/r\//);
    expect(planilha.link).not.toBe(agentes.link);
    expect(agentes.checagem?.aprovada).toBe(true);
    // Preparar de novo não duplica.
    await naEmpresa(() => servico.prepararTextos(ORG, episodioId, PEDRO.id));
    expect(await prisma.bioLink.count({ where: { pageId, chave: { startsWith: 'campanha:dm:' } } })).toBe(2);

    const editado = await naEmpresa(() =>
      servico.editarTexto(ORG, episodioId, 'item-1', `O link pedido: ${agentes.link} e o e-mail https://mail.google.com/mail/u/0/#inbox/x`, PEDRO.id),
    );
    expect(editado.editado).toBe(true);
    expect(editado.texto).toContain(agentes.link!);
    expect(editado.texto).not.toMatch(/mail\.google\.com/);
    await expect(naEmpresa(() => servico.editarTexto(ORG, episodioId, 'item-1', 'sem o link rastreado', PEDRO.id))).rejects.toThrow(/link rastreado/);
    await expect(naEmpresa(() => servico.editarTexto(ORG, episodioId, 'item-1', `Segue 🚀 ${agentes.link}`, PEDRO.id))).rejects.toThrow(/anti-slop/);
    const padrao = await naEmpresa(() => servico.editarTexto(ORG, episodioId, 'item-1', null, PEDRO.id));
    expect(padrao.editado).toBe(false);
    expect(padrao.texto).toBe(agentes.texto);
  });

  it('com o Instagram desligado em /conexoes a porta recusa a leitura: nenhuma chamada à Graph, nenhuma linha', async () => {
    graph.comentarios.set('midia-carrossel', [comentario('c-1', 'AGENTES', FULANO)]);
    await naEmpresa(() => conectores.desligar(ORG, 'instagram', { motivo: 'teste do interruptor', actorId: PEDRO.id }));
    await expect(coletar()).rejects.toThrow();
    expect(graph.chamadas).toEqual([]);
    expect(await prisma.comentarioComPalavra.count({ where: { orgId: ORG } })).toBe(0);
  });

  it('fora da janela e com volume atípico a leitura sobe a R1 e NÃO vai para a fila de aprovação', async () => {
    relogio = new Date('2026-09-10T23:30:00-03:00');
    vi.setSystemTime(relogio);
    // Um histórico de 30 dias quase vazio e uma hora cheia: acende `volume_atipico`.
    await prisma.toolCall.createMany({
      data: [
        { orgId: ORG, capabilityId: 'instagram.comentario.ler', actorType: 'system', status: 'executado', nivel: 'R0', args: {}, criadoEm: new Date(relogio.getTime() - 20 * 86_400_000) },
        ...Array.from({ length: 3 }, (_, i) => ({ orgId: ORG, capabilityId: 'instagram.comentario.ler', actorType: 'system' as const, status: 'executado' as const, nivel: 'R0' as const, args: {}, criadoEm: new Date(relogio.getTime() - (i + 1) * 60_000) })),
      ],
    });
    graph.comentarios.set('midia-carrossel', [comentario('c-1', 'AGENTES', FULANO)]);
    const r = await coletar();
    expect(r.status).toBe('ok');
    const chamada = await prisma.toolCall.findFirst({ where: { orgId: ORG, capabilityId: 'instagram.comentario.ler', status: 'executado', criadoEm: { gte: new Date(relogio.getTime() - 1000) } } });
    expect(chamada?.nivel).toBe('R1');
    expect(await prisma.approval.count({ where: { orgId: ORG } })).toBe(0);
    expect(await prisma.comentarioComPalavra.count({ where: { orgId: ORG } })).toBe(1);
  });

  it('sem a chave do HMAC, sem o escopo de comentários ou sem peça, a passagem pula sem chamar a Graph', async () => {
    delete process.env.META_WEBHOOK_PESSOA_HMAC_KEY;
    expect(await coletar()).toEqual({ status: 'pulada', resumo: expect.stringMatching(/META_WEBHOOK_PESSOA_HMAC_KEY/) });
    process.env.META_WEBHOOK_PESSOA_HMAC_KEY = CHAVE;

    await prisma.bioConexao.updateMany({ where: { orgId: ORG }, data: { escopos: `instagram_business_basic,${INSTAGRAM_ESCOPO_DE_PUBLICAR}` } });
    expect((await coletar()).resumo).toMatch(/não concedeu comentários/);
    await prisma.bioConexao.updateMany({ where: { orgId: ORG }, data: { escopos: `instagram_business_basic,${INSTAGRAM_ESCOPO_DE_PUBLICAR},${INSTAGRAM_ESCOPO_DE_COMENTARIOS}` } });

    relogio = new Date(relogio.getTime() + 10 * 86_400_000);
    vi.setSystemTime(relogio);
    expect(await coletar()).toEqual({ status: 'pulada', resumo: 'nenhuma peça com palavra publicada nos últimos 7 dias' });
    expect(graph.chamadas).toEqual([]);
  });

  it('carrossel e corte da mesma matéria usam o MESMO link da DM, e o link criado pela rotina vai ao RASTRO', async () => {
    const { rodadaId } = (await prisma.pautaPeca.findUniqueOrThrow({ where: { id: carrossel }, select: { rodadaId: true } }));
    const corteDosAgentes = (
      await prisma.pautaPeca.create({
        data: { orgId: ORG, rodadaId, formato: 'corte', titulo: 'Corte dos agentes', corpo: 'x', meta: metaDaPeca('corte', episodioId, 1, 'AGENTES') as never, externalId: 'midia-corte-agentes', status: 'publicada', publicadaEm: new Date(relogio.getTime() - 86_400_000), canal: 'instagram' },
      })
    ).id;
    try {
      await prisma.auditLog.deleteMany({ where: { orgId: ORG, action: 'pauta.dm_links' } });
      graph.comentarios.set('midia-carrossel', [comentario('m-1', 'AGENTES', FULANO)]);
      graph.comentarios.set('midia-corte-agentes', [comentario('m-2', 'agentes', BELTRANO)]);
      await coletar();
      const links = await prisma.bioLink.findMany({ where: { pageId, chave: 'campanha:dm:item-1' } });
      expect(links).toHaveLength(1);
      const fila = await naEmpresa(() => servico.fila(ORG));
      const doCarrossel = fila.linhas.find((l) => l.pecaId === carrossel);
      const doCorte = fila.linhas.find((l) => l.pecaId === corteDosAgentes);
      expect(doCarrossel?.texto).toContain(`/r/${links[0].id}`);
      expect(doCorte?.texto).toContain(`/r/${links[0].id}`);
      expect(doCorte?.texto).toBe(doCarrossel?.texto);
      const rastro = await prisma.auditLog.findMany({ where: { orgId: ORG, action: 'pauta.dm_links' } });
      expect(rastro.length).toBeGreaterThan(0);
      expect(rastro[0]).toMatchObject({ actorType: 'system', actorId: 'rotina', entityId: episodioId });
    } finally {
      await prisma.comentarioComPalavra.deleteMany({ where: { pecaId: corteDosAgentes } });
      await prisma.pautaPeca.delete({ where: { id: corteDosAgentes } });
    }
  });

  it('a Graph que cai ao listar as mídias aparece como erro no resumo, e não como "post não achado"; a lista é pedida uma vez só', async () => {
    const { rodadaId } = (await prisma.pautaPeca.findUniqueOrThrow({ where: { id: carrossel }, select: { rodadaId: true } }));
    const outraAMao = (
      await prisma.pautaPeca.create({
        data: { orgId: ORG, rodadaId, formato: 'carrossel', titulo: 'Outro à mão', corpo: 'x', meta: metaDaPeca('carrossel', episodioId, 3, 'PLANILHA') as never, urlPublicada: 'https://www.instagram.com/p/AMAO/', status: 'publicada', publicadaEm: new Date(relogio.getTime() - 86_400_000), canal: 'instagram' },
      })
    ).id;
    try {
      graph.midiasFalham = true;
      graph.comentarios.set('midia-carrossel', [comentario('c-1', 'AGENTES', FULANO)]);
      const r = await coletar();
      expect(r.status).toBe('ok');
      expect(r.resumo).toMatch(/2 post\(s\) com erro: mídias da conta: mídias falharam: 500/);
      expect(r.resumo).not.toMatch(/sem o post achado/);
      expect(graph.chamadas.filter((c) => c.caminho === '/graph/me/media')).toHaveLength(1);
      expect(await prisma.comentarioComPalavra.count({ where: { orgId: ORG } })).toBe(1);
    } finally {
      await prisma.pautaPeca.delete({ where: { id: outraAMao } });
    }
  });

  it('com o módulo pauta desligado a rotina não lê nada, mas o @ vencido some assim mesmo', async () => {
    graph.comentarios.set('midia-carrossel', [comentario('c-1', 'AGENTES', FULANO)]);
    await coletar();
    relogio = new Date(relogio.getTime() + 7 * 86_400_000);
    vi.setSystemTime(relogio);
    graph.zerar();
    await prisma.org.update({ where: { id: ORG }, data: { modulos: ['bio'] } });
    try {
      const executor = new ExecutorDeComentariosDaPauta(prisma as unknown as PrismaService, servico, { registrar: () => undefined } as never);
      const r = await naEmpresa(() => executor.executar({ orgId: ORG } as ContextoDaRotina));
      expect(r).toEqual({ status: 'pulada', resumo: 'módulo pauta desligado nesta empresa — nada a ler · 1 @ apagado(s) depois dos 7 dias' });
      expect(graph.chamadas).toEqual([]);
      const [linha] = await prisma.comentarioComPalavra.findMany({ where: { orgId: ORG } });
      expect(linha.usuario).toBeNull();
    } finally {
      await prisma.org.update({ where: { id: ORG }, data: { modulos: ['pauta', 'bio'] } });
    }
  });

  it('com mais de 200 linhas a fila corta as respondidas, nunca a pendente que vence primeiro; a contagem vem do banco', async () => {
    const hora = 3_600_000;
    await prisma.comentarioComPalavra.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        pecaId: carrossel,
        commentId: `resp-${i}`,
        midiaId: 'midia-carrossel',
        palavra: 'AGENTES',
        pessoaHmac: `h-${i}`,
        usuario: `pessoa${i}`,
        comentadoEm: new Date(relogio.getTime() - hora),
        expiraEm: new Date(relogio.getTime() - hora + 7 * 86_400_000),
        respondidoEm: relogio,
        respondidoPor: PEDRO.id,
      })),
    });
    const tresDias = new Date(relogio.getTime() - 3 * 86_400_000);
    await prisma.comentarioComPalavra.create({
      data: { pecaId: carrossel, commentId: 'pendente-antiga', midiaId: 'midia-carrossel', palavra: 'AGENTES', pessoaHmac: 'h-p', usuario: 'quem.espera', comentadoEm: tresDias, expiraEm: expiraEmDo(tresDias) },
    });
    const fila = await naEmpresa(() => servico.fila(ORG));
    expect(fila.linhas).toHaveLength(200);
    expect(fila.linhas[0]).toMatchObject({ usuario: 'quem.espera', respondidoEm: null });
    expect(fila.pendentes).toBe(1);
  });

  it('o texto editado com um /r/ que não existe mais volta ao padrão, com o aviso', async () => {
    const [antes] = (await naEmpresa(() => servico.prepararTextos(ORG, episodioId, PEDRO.id))).filter((t) => t.itemId === 'item-1');
    await naEmpresa(() => servico.editarTexto(ORG, episodioId, 'item-1', `O link pedido: ${antes.link}`, PEDRO.id));
    try {
      // A página remontada no /bio: o link da DM nasce de novo, com outro id.
      await prisma.bioLink.deleteMany({ where: { pageId, chave: 'campanha:dm:item-1' } });
      const [depois] = (await naEmpresa(() => servico.prepararTextos(ORG, episodioId, PEDRO.id))).filter((t) => t.itemId === 'item-1');
      expect(depois.link).not.toBe(antes.link);
      expect(depois.editado).toBe(false);
      expect(depois.texto).toContain(depois.link!);
      expect(depois.texto).not.toContain(antes.link!);
      expect(depois.motivo).toMatch(/link da DM que não existe mais/);
    } finally {
      await naEmpresa(() => servico.editarTexto(ORG, episodioId, 'item-1', null, PEDRO.id));
    }
  });

  it('editar o texto da DM não desfaz a mídia gravada no meio: toma o cadeado do episódio e relê a meta', async () => {
    const [agentes] = (await naEmpresa(() => servico.prepararTextos(ORG, episodioId, PEDRO.id))).filter((t) => t.itemId === 'item-1');
    const original = (await prisma.pautaPeca.findUniqueOrThrow({ where: { id: carrossel }, select: { meta: true } })).meta as Record<string, unknown>;
    let editando: Promise<unknown> | null = null;
    try {
      // O "upload do JPEG": segura o cadeado, lê a meta, e grava a imagem nova depois que a edição já começou.
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pauta-semana:${episodioId}`}))`;
          const lida = (await tx.pautaPeca.findUniqueOrThrow({ where: { id: carrossel }, select: { meta: true } })).meta as Record<string, unknown>;
          editando = naEmpresa(() => servico.editarTexto(ORG, episodioId, 'item-1', `O link pedido: ${agentes.link}`, PEDRO.id));
          await new Promise((ok) => setTimeout(ok, 500));
          await tx.pautaPeca.update({ where: { id: carrossel }, data: { meta: { ...lida, imagens: ['nova.jpg'] } as never } });
        },
        { timeout: 15_000 },
      );
      await editando;
      const meta = (await prisma.pautaPeca.findUniqueOrThrow({ where: { id: carrossel }, select: { meta: true } })).meta as Record<string, unknown>;
      expect(meta.imagens).toEqual(['nova.jpg']);
      expect((meta.dm as { texto: string }).texto).toContain(agentes.link!);
    } finally {
      await prisma.pautaPeca.update({ where: { id: carrossel }, data: { meta: original as never } });
    }
  }, 30_000);
});
