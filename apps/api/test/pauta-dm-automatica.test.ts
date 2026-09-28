import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ENVIO_DE_RESPOSTA_ESTADOS,
  INSTAGRAM_ESCOPO_DE_COMENTARIOS,
  INSTAGRAM_ESCOPO_DE_MENSAGENS,
  INSTAGRAM_ESCOPO_DE_PUBLICAR,
  PAUTA_CAPACIDADE_DE_PAUSAR_A_DM,
  PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO,
  PAUTA_CHAVE_DA_DM_AUTOMATICA,
  PAUTA_DM_TETO_BYTES,
  PAUTA_DM_TETO_POR_DIA_MAXIMO,
  PAUTA_DM_TETO_POR_DIA_PADRAO,
  PAUTA_FORA_DO_LOTE_DM,
  PautaPausarRegraDaDmSchema,
  bytesUtf8,
  instanteNoFuso,
  type PautaItemCurado,
} from '@mktos/shared';
import * as instagram from '../src/bio/plataformas/instagram';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { LotesService } from '../src/approvals/lotes.service';
import { AssinaturaDeLoteService } from '../src/approvals/assinatura-de-lote.service';
import { ReauthService } from '../src/auth/reauth.service';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import type { JwtUser } from '../src/auth/current-user.decorator';
import { AuditService } from '../src/audit/audit.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { AcoesService } from '../src/gateway/acoes.service';
import { PortaDoOperador, type AcaoRetida } from '../src/gateway/porta-do-operador.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { ConectoresService } from '../src/integrations/conectores.service';
import { comContexto } from '../src/common/contexto-execucao';
import { cifrar } from '../src/common/crypto';
import type { GraphDePublicacao } from '../src/pauta/graph-de-publicacao';
import type { GraphDeComentarios } from '../src/pauta/graph-de-comentarios';
import type { GraphDeMensagens } from '../src/pauta/graph-de-mensagens';
import { PublicacaoInstagramService } from '../src/pauta/publicacao-instagram.service';
import { LoteDaSemanaService } from '../src/pauta/lote-da-semana.service';
import { ComentariosService } from '../src/pauta/comentarios.service';
import { ComentariosController } from '../src/pauta/comentarios.controller';
import { DmAutomaticaService, TETO_DE_ENVIOS_POR_PASSAGEM } from '../src/pauta/dm-automatica.service';
import { ExecutorDeComentariosDaPauta } from '../src/routines/executores/pauta-comentarios.executor';
import type { ContextoDaRotina } from '../src/routines/rotina.tipos';
import {
  CODIGO_SEM_ADVANCED_ACCESS,
  argsDaRegra,
  avisoDeMensagemAutomatica,
  janelaDaRegra,
  lerFalhaDaMeta,
  lerRecursoDaRegra,
  linhaDoResumoDaDm,
  problemaDoTextoAutomatico,
  proximaAbertura,
  recursoDaRegra,
  recusasSeguidasDaMeta,
  tetoDaRegra,
  textoDaDmAutomatica,
  travaDaPessoa,
  usoMaximoDaRegra,
} from '../src/pauta/dm-automatica';
import { hmacDaPessoa, textoDaDm } from '../src/pauta/dm-por-comentario';
import type { MemoriaService } from '../src/memory/memoria.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * MD11 — A DM AUTOMÁTICA SOB O LOTE DA SEMANA (MC18.1 a 18.4 no lote da MD7/MD8,
 * disparada pela rotina de comentários da MD9, sem webhook).
 *
 * Sem banco: o texto (a linha de mensagem automática, os bytes, o link), a
 * janela de 7 dias, as 08h de São Paulo, as três recusas, o erro de Advanced
 * Access e as constantes. Com banco: a porta de verdade, com a política
 * semeada; o lote da semana assinado por outra pessoa, titular; e um dublê da
 * Graph num servidor HTTP local que responde os comentários e recebe as
 * respostas privadas. É o "pronto quando" da MD11.
 */

const JANELA: [string, string] = ['08:00', '20:00'];
/** O RASTRO tem BigInt (a sequência): serializa como texto. */
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
const SP = 'America/Sao_Paulo';

describe('MD11: a regra da DM automática (puro)', () => {
  it('o texto abre com a linha de mensagem automática, leva o /r/ e cabe em 1000 bytes; o comentário nunca entra', () => {
    const base = textoDaDm({ materia: 'Agentes no escritório', link: 'https://bio.teste/r/l1', pagina: 'https://bio.teste/@root-ep-01' });
    const t = textoDaDmAutomatica(base, 'AGENTES');
    expect(t.split('\n')[0]).toBe(avisoDeMensagemAutomatica('AGENTES'));
    expect(t.split('\n')[0]).toMatch(/^Mensagem automática/);
    expect(t).toContain('https://bio.teste/r/l1');
    // Nenhum @ de pessoa: o único @ é o da página do episódio, dentro do endereço.
    expect(t.replace(/https?:\/\/\S+/g, '')).not.toMatch(/@\w/);
    expect(problemaDoTextoAutomatico(t, 'https://bio.teste/r/l1')).toBeNull();
    // O aviso conta nos bytes: um texto no limite passa a não caber.
    const cheio = textoDaDmAutomatica(`https://bio.teste/r/l1 ${'a'.repeat(PAUTA_DM_TETO_BYTES - 30)}`, 'AGENTES');
    expect(bytesUtf8(cheio)).toBeGreaterThan(PAUTA_DM_TETO_BYTES);
    expect(problemaDoTextoAutomatico(cheio, 'https://bio.teste/r/l1')).toMatch(/bytes/);
  });

  it('os argumentos são o conteúdo assinado: as peças em ordem, sem o comentário nem a pessoa', () => {
    const a = argsDaRegra({ igUserId: 'ig', palavra: 'AGENTES', texto: 't', bioLinkId: 'l', destinoAprovado: 'https://x', midias: ['p2', 'p1', 'p2'] });
    expect(a.midias).toEqual(['p1', 'p2']);
    expect(Object.keys(a).sort()).toEqual(['bioLinkId', 'destinoAprovado', 'igUserId', 'midias', 'palavra', 'texto']);
    expect(recursoDaRegra('ep-1', 'item-1')).toBe('ep-1:item-1');
    expect(lerRecursoDaRegra('ep-1:item-1')).toEqual({ episodioId: 'ep-1', itemId: 'item-1' });
    expect(lerRecursoDaRegra('sem-dois-pontos')).toBeNull();
    // A trava é da matéria (o recurso da regra), não do item do lote: assinada de novo, a regra continua a mesma.
    expect(travaDaPessoa(recursoDaRegra('ep-1', 'item-1'), 'h')).toBe('ep-1:item-1:h');
  });

  it('o teto padrão é 100 por dia, preso ao teto de 200 do catálogo; o item vive no máximo 8 dias de teto', () => {
    expect(tetoDaRegra()).toBe(PAUTA_DM_TETO_POR_DIA_PADRAO);
    expect(PAUTA_DM_TETO_POR_DIA_PADRAO).toBe(100);
    expect(tetoDaRegra(500)).toBe(PAUTA_DM_TETO_POR_DIA_MAXIMO);
    expect(tetoDaRegra(0)).toBe(1);
    expect(usoMaximoDaRegra(100)).toBe(800);
  });

  it('a janela vai da primeira publicação a 7 dias depois, sem passar do que um lote vale; sem horário, nada', () => {
    const agora = new Date('2026-09-01T13:00:00Z');
    const oito = 8 * 86_400_000;
    const j = janelaDaRegra([new Date('2026-09-02T12:00:00Z'), new Date('2026-09-01T12:00:00Z')], agora, oito)!;
    expect(j.janelaDe.toISOString()).toBe('2026-09-01T12:00:00.000Z');
    expect(j.janelaAte.toISOString()).toBe('2026-09-08T12:00:00.000Z');
    const longe = janelaDaRegra([new Date('2026-09-07T12:00:00Z')], agora, oito)!;
    expect(longe.janelaAte.getTime()).toBe(agora.getTime() + oito - 60_000);
    expect(janelaDaRegra([], agora, oito)).toBeNull();
    expect(janelaDaRegra([new Date('2026-08-20T12:00:00Z')], agora, oito)).toBeNull();
  });

  it('fora das 08h–20h de São Paulo o envio espera a próxima abertura: 22h vai para as 08h do dia seguinte, 05h para as 08h do mesmo dia', () => {
    const noite = instanteNoFuso('2026-09-01', '22:00', SP);
    expect(proximaAbertura(noite, JANELA, SP).toISOString()).toBe(instanteNoFuso('2026-09-02', '08:00', SP).toISOString());
    const madrugada = instanteNoFuso('2026-09-02', '05:00', SP);
    expect(proximaAbertura(madrugada, JANELA, SP).toISOString()).toBe(instanteNoFuso('2026-09-02', '08:00', SP).toISOString());
    const dia = instanteNoFuso('2026-09-02', '10:00', SP);
    expect(proximaAbertura(dia, JANELA, SP)).toBe(dia);
    // 20h em ponto já é fora: a janela fecha no minuto 20:00.
    expect(proximaAbertura(instanteNoFuso('2026-09-01', '20:00', SP), JANELA, SP).toISOString()).toBe(instanteNoFuso('2026-09-02', '08:00', SP).toISOString());
  });

  it('três recusas SEGUIDAS da Meta pausam; um envio no meio zera; o que nem chegou à Meta não conta', () => {
    expect(recusasSeguidasDaMeta(['erro', 'erro', 'erro'])).toBe(true);
    expect(recusasSeguidasDaMeta(['erro', 'recusado', 'segurado', 'erro', 'erro'])).toBe(true);
    expect(recusasSeguidasDaMeta(['erro', 'enviado', 'erro', 'erro'])).toBe(false);
    expect(recusasSeguidasDaMeta(['erro', 'erro'])).toBe(false);
    // Sem resposta da Meta não é recusa: `incerto` não conta, nem o `recusado` do próprio efeito.
    expect(recusasSeguidasDaMeta(['erro', 'incerto', 'recusado', 'erro', 'erro'])).toBe(true);
    expect(recusasSeguidasDaMeta(['incerto', 'incerto', 'incerto'])).toBe(false);
    expect([...ENVIO_DE_RESPOSTA_ESTADOS].sort()).toEqual(['enviado', 'enviando', 'erro', 'ignorado', 'incerto', 'recusado', 'segurado']);
  });

  it('o erro 100/2534001 é o de Advanced Access; outro código não', () => {
    const e = Object.assign(new Error('resposta privada falhou: 400 ...'), { codigoDaMeta: { code: 100, subcode: 2534001 } });
    expect(lerFalhaDaMeta(e)).toMatchObject({ codigo: CODIGO_SEM_ADVANCED_ACCESS, semAdvancedAccess: true });
    expect(lerFalhaDaMeta(Object.assign(new Error('x'), { codigoDaMeta: { code: 2, subcode: null } }))).toMatchObject({ codigo: '2', semAdvancedAccess: false });
    expect(lerFalhaDaMeta(Object.assign(new Error('x'), { codigoDaMeta: { code: 2, subcode: null } }))).toMatchObject({ incerto: false });
    // Sem resposta (rede, prazo) ou 5xx sem o corpo de erro da Meta: o pedido pode ter chegado.
    expect(lerFalhaDaMeta(new instagram.ErroDaGraph('sem resposta', null))).toMatchObject({ codigo: null, semAdvancedAccess: false, incerto: true });
    expect(lerFalhaDaMeta(new instagram.ErroDaGraph('502', 502))).toMatchObject({ incerto: true });
    expect(lerFalhaDaMeta(Object.assign(new instagram.ErroDaGraph('500', 500), { codigoDaMeta: { code: 2, subcode: null } }))).toMatchObject({ incerto: false });
    expect(lerFalhaDaMeta(new instagram.ErroDaGraph('400 sem corpo', 400))).toMatchObject({ incerto: false });
    expect(
      linhaDoResumoDaDm({ enviadas: 1, seguradas: 2, ignoradas: 0, noTeto: 0, recusadas: 0, erros: 0, pausadas: [], semTempo: 0, incertos: 1, abertura: '07:30' }),
    ).toBe('DM automática: 1 enviada(s) · 2 segurada(s) até a janela abrir (07:30) · 1 sem resposta da Meta (pode ter saído)');
  });

  it('as constantes, a rota de pausar e a permissão dela', () => {
    expect(PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO).toBe('instagram.resposta_privada.enviar');
    expect(PAUTA_CAPACIDADE_DE_PAUSAR_A_DM).toBe('instagram.regra_de_resposta.pausar');
    expect(PAUTA_CHAVE_DA_DM_AUTOMATICA).toBe('pauta.dm.automatica');
    expect(PAUTA_FORA_DO_LOTE_DM).toBe('dm');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, ComentariosController.prototype.pausar)).toEqual(['pauta.editar']);
    expect(PautaPausarRegraDaDmSchema.safeParse({ motivo: 'ok' }).success).toBe(false);
    expect(PautaPausarRegraDaDmSchema.safeParse({ motivo: 'robô comentando' }).success).toBe(true);
    expect(PautaPausarRegraDaDmSchema.safeParse({ motivo: 'robô comentando', extra: 1 }).success).toBe(false);
  });

  it('a conexão só pede mensagens com INSTAGRAM_PEDIR_MENSAGENS=sim, e a variável está no compose e no .env.example', () => {
    expect(instagram.pedeMensagens({})).toBe(false);
    expect(instagram.pedeMensagens({ INSTAGRAM_PEDIR_MENSAGENS: 'sim' })).toBe(true);
    const antes = process.env.INSTAGRAM_PEDIR_MENSAGENS;
    try {
      delete process.env.INSTAGRAM_PEDIR_MENSAGENS;
      expect(instagram.escoposDa('publicacao')).not.toContain(INSTAGRAM_ESCOPO_DE_MENSAGENS);
      process.env.INSTAGRAM_PEDIR_MENSAGENS = 'sim';
      expect(instagram.escoposDa('publicacao')).toContain(INSTAGRAM_ESCOPO_DE_MENSAGENS);
      // A bio de todo criador nunca pede mensagens.
      expect(instagram.escoposDa('bio')).toEqual(['instagram_business_basic']);
    } finally {
      if (antes === undefined) delete process.env.INSTAGRAM_PEDIR_MENSAGENS;
      else process.env.INSTAGRAM_PEDIR_MENSAGENS = antes;
    }
    const raiz = path.join(__dirname, '..', '..', '..');
    expect(readFileSync(path.join(raiz, 'docker-compose.yml'), 'utf8')).toMatch(/INSTAGRAM_PEDIR_MENSAGENS: \$\{INSTAGRAM_PEDIR_MENSAGENS:-\}/);
    expect(readFileSync(path.join(raiz, '.env.example'), 'utf8')).toMatch(/^INSTAGRAM_PEDIR_MENSAGENS=$/m);
  });
});

// ---------------------------------------------------------------------------
// O dublê da Graph: comentários e respostas privadas
// ---------------------------------------------------------------------------

interface ComentarioDoDuble {
  id: string;
  text: string;
  timestamp: string;
  from: { id: string; username: string };
}

class GraphDuble {
  chamadas: Array<{ metodo: string; caminho: string; autorizacao: string | null; url: string; corpo: unknown }> = [];
  comentarios = new Map<string, ComentarioDoDuble[]>();
  /** As próximas respostas de `/messages` que falham, na ordem. */
  falhas: Array<{ status: number; corpo: unknown }> = [];
  /** Quantos `/messages` seguintes o dublê recebe e derruba sem responder (a resposta que se perde). */
  abortar = 0;
  seq = 0;

  zerar() {
    this.chamadas = [];
    this.falhas = [];
    this.abortar = 0;
  }

  tratar(metodo: string, caminho: string, url: string, autorizacao: string | null, corpo: unknown): { status: number; corpo: unknown; derrubar?: boolean } {
    this.chamadas.push({ metodo, caminho, autorizacao, url, corpo });
    const c = /^\/graph\/v24\.0\/([^/]+)\/comments$/.exec(caminho);
    if (metodo === 'GET' && c) return { status: 200, corpo: { data: this.comentarios.get(decodeURIComponent(c[1])) ?? [] } };
    if (metodo === 'POST' && /^\/graph\/v24\.0\/[^/]+\/messages$/.test(caminho)) {
      if (this.abortar > 0) {
        this.abortar--;
        // A mensagem "saiu" (o seq anda), mas a resposta nunca chega.
        ++this.seq;
        return { status: 0, corpo: null, derrubar: true };
      }
      const falha = this.falhas.shift();
      if (falha) return falha;
      return { status: 200, corpo: { recipient_id: 'destinatario-da-meta', message_id: `mid.${++this.seq}` } };
    }
    return { status: 404, corpo: { error: { message: 'rota do dublê desconhecida' } } };
  }

  get respostas() {
    return this.chamadas.filter((x) => x.metodo === 'POST' && x.caminho.endsWith('/messages'));
  }
}

// ---------------------------------------------------------------------------
// Com banco: a porta, o lote assinado e o dublê
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (uma empresa, duas pessoas, um episódio, peças, lotes, a fila da DM e RASTRO)');

const ORG = 'org-md11-dm';
const SENHA = 'senha-da-titular-md11';
const SUFIXO = `md11-${Date.now().toString(36)}`;
const CHAVE = 'chave-do-hmac-da-pessoa-md11-0123456789abcdef';
/** Terça, 10h em São Paulo: dentro das 08h–20h. */
const INICIO = instanteNoFuso('2026-09-01', '10:00', SP);
const EM = (dia: string, hhmm: string) => instanteNoFuso(dia, hhmm, SP);

const ITENS: PautaItemCurado[] = [
  { id: 'md11-item-1', titulo: 'Agentes de IA no escritório', url: 'https://noticia.exemplo/agentes', origem: 'R' },
  { id: 'md11-item-2', titulo: 'The Batch desta semana', url: 'https://mail.google.com/mail/u/0/#inbox/abc', origem: 'L' },
];

function metaDaPeca(formato: 'carrossel' | 'corte', episodioId: string, itemN: number, palavra: string) {
  return { episodioId, itemId: ITENS[itemN - 1].id, itemN, formato, transcricaoSha: 't', linkDaMateria: null, avisos: [], imagens: [], palavraChave: palavra };
}

describe.skipIf(!URL)('MD11: a DM automática sai sob o lote assinado, pela porta, com o dublê da Graph', () => {
  let prisma: PrismaClient;
  let servidor: Server;
  const graph = new GraphDuble();
  let approvals: ApprovalsService;
  let acoes: AcoesService;
  let lotes: LotesService;
  let assinatura: AssinaturaDeLoteService;
  let semana: LoteDaSemanaService;
  let comentarios: ComentariosService;
  let dm: DmAutomaticaService;
  let policy: PolicyService;
  let conectores: ConectoresService;
  let executor: ExecutorDeComentariosDaPauta;
  let controlador: ComentariosController;
  const notas: Record<string, { body: string; arquivadoEm: string | null } | null> = {};
  const id = { proponente: '', titular: '', episodio: '', rodada: '', pagina: '', carrossel: '', corte: '', newsletter: '' };
  const ambienteAntes: Record<string, string | undefined> = {};
  const AMBIENTE = ['INSTAGRAM_GRAPH_URL', 'META_WEBHOOK_PESSOA_HMAC_KEY', 'ENCRYPTION_KEY', 'GATEWAY_MODO', 'PUBLIC_BIO_ORIGIN', 'POLITICA_FUSO_HORARIO', 'PAUTA_MIDIA_PUBLICA_SEGREDO'];
  let seqComentario = 0;

  const naEmpresa = <T>(fn: () => Promise<T>, correlationId = 'clique-md11'): Promise<T> => comContexto({ orgId: ORG, correlationId, origem: 'http' }, fn);
  const passar = () => comContexto({ orgId: ORG, correlationId: `rotina-md11-${++seqComentario}`, origem: 'cron' }, () => executor.executar({ orgId: ORG } as ContextoDaRotina));
  const ligar = (ligada: boolean) => {
    notas[PAUTA_CHAVE_DA_DM_AUTOMATICA] = ligada ? { body: 'ligada', arquivadoEm: null } : null;
  };
  const relogio = (d: Date) => vi.setSystemTime(d);

  function comenta(midia: string, texto: string, quem: { id: string; username: string }, horasAtras = 0.1) {
    const cid = `md11-c-${++seqComentario}`;
    const lista = graph.comentarios.get(midia) ?? [];
    lista.push({ id: cid, text: texto, timestamp: new Date(Date.now() - horasAtras * 3600_000).toISOString(), from: quem });
    graph.comentarios.set(midia, lista);
    return cid;
  }

  async function assinar(loteId: string) {
    const r = (await naEmpresa(() => assinatura.pedirAssinatura(ORG, loteId, id.proponente))) as AcaoRetida;
    await naEmpresa(() =>
      approvals.confirm(ORG, r.approvalId, { id: id.titular, papeis: ['admin_master'], reauth: { senha: SENHA } }, 'conferi o texto da DM, o link e o teto'),
    );
    return naEmpresa(() => acoes.executarAprovada(ORG, r.approvalId, id.titular));
  }

  /** Monta e assina um lote novo só com a regra da DM (os posts já saíram). */
  async function loteNovoAssinado() {
    const m = await naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, []));
    await assinar(m.loteId);
    const item = await prisma.itemDoLote.findFirstOrThrow({ where: { loteId: m.loteId, capabilityId: PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO } });
    return { loteId: m.loteId, item };
  }

  const envioDo = (commentId: string) =>
    prisma.envioDeResposta.findFirst({ where: { orgId: ORG, comentario: { commentId } } });

  beforeAll(async () => {
    relogio(INICIO);
    for (const k of AMBIENTE) ambienteAntes[k] = process.env[k];
    process.env.GATEWAY_MODO = 'impor';
    process.env.PAUTA_MIDIA_PUBLICA_SEGREDO = 's'.repeat(48);
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');
    process.env.META_WEBHOOK_PESSOA_HMAC_KEY = CHAVE;
    process.env.PUBLIC_BIO_ORIGIN = 'https://bio.teste';
    delete process.env.POLITICA_FUSO_HORARIO;

    servidor = createServer((req, res) => {
      let bruto = '';
      req.on('data', (c) => (bruto += c));
      req.on('end', () => {
        const u = new globalThis.URL(req.url ?? '/', 'http://x');
        let corpo: unknown = null;
        try {
          corpo = bruto ? JSON.parse(bruto) : null;
        } catch {
          corpo = bruto;
        }
        const r = graph.tratar(req.method ?? 'GET', u.pathname, req.url ?? '', (req.headers.authorization as string | undefined) ?? null, corpo);
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
      create: { id: ORG, name: 'DM MD11', slug: 'dm-md11', modulos: ['pauta', 'bio'] },
      update: { modulos: ['pauta', 'bio'] },
    });
    const admin = await prisma.role.upsert({
      where: { orgId_key: { orgId: ORG, key: 'admin_master' } },
      create: { orgId: ORG, key: 'admin_master', name: 'Admin Master' },
      update: {},
      select: { id: true },
    });
    const usuario = async (email: string) =>
      (
        await prisma.user.upsert({
          where: { email },
          create: { orgId: ORG, email, name: email, passwordHash: await bcrypt.hash(SENHA, 4), roles: { connect: { id: admin.id } } },
          update: {},
          select: { id: true },
        })
      ).id;
    id.proponente = await usuario(`proponente@${SUFIXO}`);
    id.titular = await usuario(`titular@${SUFIXO}`);

    await prisma.bioConexao.deleteMany({ where: { orgId: ORG } });
    await prisma.bioConexao.create({
      data: {
        orgId: ORG,
        plataforma: 'instagram',
        externalId: 'ig-root-md11',
        handle: 'operacaoroot',
        tokenCifrado: cifrar('token-de-publicacao-md11'),
        escopos: `instagram_business_basic,${INSTAGRAM_ESCOPO_DE_PUBLICAR},${INSTAGRAM_ESCOPO_DE_COMENTARIOS}`,
        finalidade: 'publicacao',
        expiraEm: new Date(Date.now() + 50 * 86_400_000),
      },
    });
    id.pagina = (await prisma.bioPage.create({ data: { orgId: ORG, handle: `dm-${SUFIXO}`, titulo: 'Links do ep-01', publicada: true } })).id;
    id.rodada = (
      await prisma.pautaRodada.create({ data: { orgId: ORG, status: 'curada', titulo: 'Rodada MD11', janelaIni: INICIO, janelaFim: INICIO, itens: ITENS as never } })
    ).id;
    id.episodio = (
      await prisma.pautaEpisodio.create({ data: { rodadaId: id.rodada, numero: 1, titulo: 'Semana 36', status: 'agendado', bioPageId: id.pagina } })
    ).id;
    // Os posts da matéria 1 saíram às 09h (o carrossel pelo OS, o corte também); a matéria 2 é de newsletter.
    const publicada = { status: 'publicada' as const, publicadaEm: EM('2026-09-01', '09:00'), canal: 'instagram' as const };
    id.carrossel = (
      await prisma.pautaPeca.create({
        data: { orgId: ORG, rodadaId: id.rodada, formato: 'carrossel', titulo: 'Carrossel dos agentes', corpo: 'x', meta: metaDaPeca('carrossel', id.episodio, 1, 'AGENTES') as never, externalId: 'md11-midia-car', ...publicada },
      })
    ).id;
    id.corte = (
      await prisma.pautaPeca.create({
        data: { orgId: ORG, rodadaId: id.rodada, formato: 'corte', titulo: 'Corte dos agentes', corpo: 'x', meta: metaDaPeca('corte', id.episodio, 1, 'AGENTES') as never, externalId: 'md11-midia-corte', ...publicada },
      })
    ).id;
    id.newsletter = (
      await prisma.pautaPeca.create({
        data: { orgId: ORG, rodadaId: id.rodada, formato: 'carrossel', titulo: 'Carrossel da newsletter', corpo: 'x', meta: metaDaPeca('carrossel', id.episodio, 2, 'BATCH') as never, externalId: 'md11-midia-news', ...publicada },
      })
    ).id;

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    policy = new PolicyService(p);
    await policy.onModuleInit();
    const reauth = new ReauthService(p, new JwtService({ secret: 'segredo-md11' }), audit);
    approvals = new ApprovalsService(p, audit, reauth);
    lotes = new LotesService(p, policy, audit);
    const eventos = new EventLogService(p);
    const registro = new EfeitosRegistry();
    const interruptores = new InterruptoresRegistry();
    conectores = new ConectoresService(p, audit, eventos, interruptores);
    conectores.onModuleInit();
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, eventos, undefined, interruptores, registro, lotes);
    acoes = new AcoesService(p, gateway, eventos, interruptores, policy);
    const porta = new PortaDoOperador(gateway, registro);
    assinatura = new AssinaturaDeLoteService(p, lotes, registro, porta);
    assinatura.onModuleInit();
    const memoria = { porChave: async (_org: string, chave: string) => notas[chave] ?? null } as unknown as MemoriaService;
    const clientePub: GraphDePublicacao = {
      limiteDePublicacao: instagram.limiteDePublicacao,
      criarContainer: instagram.criarContainer,
      statusDoContainer: instagram.statusDoContainer,
      publicarContainer: instagram.publicarContainer,
      permalinkDe: instagram.permalinkDe,
      midiasRecentes: instagram.midiasRecentes,
    };
    const publicacao = new PublicacaoInstagramService(p, audit, registro, interruptores, porta, memoria, clientePub, lotes);
    publicacao.onModuleInit();
    const clienteComentarios: GraphDeComentarios = { comentariosDa: instagram.comentariosDa, midiasDesde: instagram.midiasDesde };
    comentarios = new ComentariosService(p, audit, registro, porta, memoria, clienteComentarios, lotes);
    comentarios.onModuleInit();
    const clienteMensagens: GraphDeMensagens = { responderEmPrivado: instagram.responderEmPrivado };
    dm = new DmAutomaticaService(p, audit, registro, interruptores, porta, memoria, policy, lotes, comentarios, clienteMensagens);
    dm.onModuleInit();
    semana = new LoteDaSemanaService(p, audit, lotes, publicacao, undefined, dm);
    semana.onModuleInit();
    executor = new ExecutorDeComentariosDaPauta(p, comentarios, { registrar: () => undefined } as never, dm);
    controlador = new ComentariosController(comentarios, dm);
  }, 60_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = $1', ORG),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.envioDeResposta.deleteMany({ where: { orgId: ORG } });
    await prisma.comentarioComPalavra.deleteMany({ where: { orgId: ORG } });
    await prisma.itemDoLote.deleteMany({ where: { orgId: ORG } });
    await prisma.aprovacaoDeLote.deleteMany({ where: { orgId: ORG } });
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

  beforeEach(() => {
    graph.zerar();
  });

  const FULANO = { id: 'md11-pessoa-fulano', username: 'fulano.silva' };
  const BELTRANO = { id: 'md11-pessoa-beltrano', username: 'beltrano' };
  const CICLANO = { id: 'md11-pessoa-ciclano', username: 'ciclano' };

  // Os casos dependem da ordem: é a semana de um episódio, da montagem às pausas.

  let regra = { loteId: '', itemId: '', recursoId: '' };
  let linkId = '';

  it('antes da montagem, a aprovação mostra a regra da matéria com link público e explica a da newsletter; a nota nasce desligada', async () => {
    const e = await naEmpresa(() => semana.estado(ORG, id.episodio, id.proponente));
    expect(e.dm?.automatica).toBe(false);
    const [m1, m2] = e.dm!.regras;
    expect(m1).toMatchObject({ itemN: 1, palavra: 'AGENTES', problema: null, tetoPorDia: 100, noLote: null });
    expect(m1.janelaDe).toBe(EM('2026-09-01', '09:00').toISOString());
    expect(m1.janelaAte).toBe(EM('2026-09-08', '09:00').toISOString());
    expect(m2).toMatchObject({ itemN: 2, palavra: 'BATCH' });
    expect(m2.problema).toMatch(/link público/);

    // O link que ainda não existe some da tela, mas não esconde outro motivo: sem o escopo de comentários, a regra diz por quê.
    const conexao = await prisma.bioConexao.findFirstOrThrow({ where: { orgId: ORG } });
    await prisma.bioConexao.update({ where: { id: conexao.id }, data: { escopos: `instagram_business_basic,${INSTAGRAM_ESCOPO_DE_PUBLICAR}` } });
    try {
      const sem = await naEmpresa(() => semana.estado(ORG, id.episodio, id.proponente));
      expect(sem.dm!.regras[0].problema).toMatch(/não concedeu comentários/);
    } finally {
      await prisma.bioConexao.update({ where: { id: conexao.id }, data: { escopos: conexao.escopos } });
    }

    // O coletor casa cada post com a palavra dele, e a regra assina uma só: palavras diferentes na matéria não assinam.
    const corte = await prisma.pautaPeca.findUniqueOrThrow({ where: { id: id.corte } });
    await prisma.pautaPeca.update({ where: { id: id.corte }, data: { meta: metaDaPeca('corte', id.episodio, 1, 'OUTRA') as never } });
    try {
      const outra = await naEmpresa(() => semana.estado(ORG, id.episodio, id.proponente));
      expect(outra.dm!.regras[0].problema).toMatch(/palavras diferentes \(AGENTES, OUTRA\)/);
    } finally {
      await prisma.pautaPeca.update({ where: { id: id.corte }, data: { meta: corte.meta as never } });
    }
  });

  it('a semana vira um lote com a regra da DM (teto 100/dia, 7 dias, o texto exato), e a titular lê o que assina', async () => {
    const m = await naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, []));
    expect(m.itens).toBe(1);
    const d = await lotes.detalhe(ORG, m.loteId);
    expect(d.resumo).toMatch(/1 regra\(s\) de DM automática \(até 100 por dia cada, 7 dias\)/);
    const [item] = d.itens;
    expect(item).toMatchObject({ capabilityId: PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO, recursoId: recursoDaRegra(id.episodio, ITENS[0].id!), tetoPorDia: 100, usoMaximo: 800 });
    const link = await prisma.bioLink.findFirstOrThrow({ where: { pageId: id.pagina, chave: `campanha:dm:${ITENS[0].id}` } });
    linkId = link.id;
    expect(link).toMatchObject({ destino: ITENS[0].url, ativo: false });

    const c = await naEmpresa(() => semana.conteudo(ORG, m.loteId));
    expect(c.divergentes).toBe(0);
    const [regraLida] = c.dm!;
    expect(regraLida.palavra).toBe('AGENTES');
    expect(regraLida.texto.split('\n')[0]).toBe(avisoDeMensagemAutomatica('AGENTES'));
    expect(regraLida.texto).toContain(`https://bio.teste/r/${linkId}`);
    expect(regraLida.destino).toBe(ITENS[0].url);
    expect(regraLida.pecas.map((x) => x.id).sort()).toEqual([id.carrossel, id.corte].sort());
    expect(regraLida.divergente).toBeNull();
    expect(regraLida).toMatchObject({ horario: '08:00–20:00', fuso: 'America/Sao_Paulo' });

    await assinar(m.loteId);
    expect((await lotes.detalhe(ORG, m.loteId)).estado).toBe('ativo');
    regra = { loteId: m.loteId, itemId: item.id, recursoId: item.recursoId };
  });

  it('PRONTO QUANDO 7: com a nota desligada, nenhum envio sai, e o comentário fica na fila à mão', async () => {
    ligar(false);
    const cid = comenta('md11-midia-car', 'AGENTES', { id: 'md11-pessoa-antes', username: 'antes' });
    const r = await passar();
    expect(r.resumo).toMatch(/DM automática desligada/);
    expect(graph.respostas).toEqual([]);
    const linha = await prisma.comentarioComPalavra.findFirstOrThrow({ where: { orgId: ORG, commentId: cid } });
    expect(linha.respondidoEm).toBeNull();
    expect(await envioDo(cid)).toBeNull();
    // Ninguém vai responder esta à mão no teste: marcada, ela não entra nos próximos casos.
    await naEmpresa(() => comentarios.marcarRespondido(ORG, linha.id, id.proponente));
  });

  it('PRONTO QUANDO 1: um comentário casado gera UM envio, com o /r/ e a linha de mensagem automática, e sai da fila à mão', async () => {
    ligar(true);
    const cid = comenta('md11-midia-car', 'AGENTES por favor, quero muito', FULANO);
    const r = await passar();
    expect(r.status).toBe('ok');
    expect(r.resumo).toMatch(/DM automática: 1 enviada\(s\)/);
    expect(graph.respostas).toHaveLength(1);
    const [envio] = graph.respostas;
    expect(envio.caminho).toBe('/graph/v24.0/ig-root-md11/messages');
    // O token vai no cabeçalho, nunca na URL.
    expect(envio.autorizacao).toBe('Bearer token-de-publicacao-md11');
    expect(envio.url).not.toMatch(/access_token/);
    const corpo = envio.corpo as { recipient: { comment_id: string }; message: { text: string } };
    expect(corpo.recipient).toEqual({ comment_id: cid });
    expect(corpo.message.text.split('\n')[0]).toBe(avisoDeMensagemAutomatica('AGENTES'));
    expect(corpo.message.text).toContain(`https://bio.teste/r/${linkId}`);
    // O texto do comentário nunca vai na mensagem.
    expect(corpo.message.text).not.toMatch(/quero muito/);
    expect(corpo.message.text).not.toMatch(/fulano/);

    const e = await envioDo(cid);
    expect(e).toMatchObject({ estado: 'enviado', loteItemId: regra.itemId, pessoaHmac: hmacDaPessoa(FULANO.id, CHAVE), mensagemId: 'mid.1' });
    expect(e!.expiraEm.toISOString()).toBe(new Date(INICIO.getTime() + 90 * 86_400_000).toISOString());
    const linha = await prisma.comentarioComPalavra.findFirstOrThrow({ where: { orgId: ORG, commentId: cid } });
    expect(linha.respondidoPor).toBe('dm-automatica');
    const item = await prisma.itemDoLote.findUniqueOrThrow({ where: { id: regra.itemId } });
    expect(item).toMatchObject({ usos: 1, usosNoDia: 1, diaDoContador: '2026-09-01', estado: 'ativo' });

    // A fila mostra a regra, "enviadas hoje" e o envio da linha.
    const fila = await naEmpresa(() => controlador.fila({ orgId: ORG, sub: id.proponente } as JwtUser));
    expect(fila.dmAutomatica).toMatchObject({ ligada: true });
    expect(fila.dmAutomatica!.regras[0]).toMatchObject({ loteItemId: regra.itemId, palavra: 'AGENTES', enviadasHoje: 1, tetoPorDia: 100, estadoDoItem: 'ativo' });
    const naFila = fila.linhas.find((l) => l.id === linha.id)!;
    expect(naFila.respondidoPor).toBe('DM automática');
    expect(naFila.automatica).toMatchObject({ estado: 'enviado' });
  });

  it('PRONTO QUANDO 8: o RASTRO do envio é R4 (a procedência externa), com o aprovador do lote, e nunca o comentário nem a pessoa em claro', async () => {
    const decisoes = await prisma.policyDecision.findMany({ where: { orgId: ORG, capabilityId: PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO } });
    expect(decisoes.length).toBeGreaterThan(0);
    expect(decisoes.every((d) => d.nivel === 'R4')).toBe(true);
    expect(JSON.stringify(decisoes.map((d) => d.sinais))).toMatch(/fonte_nao_confiavel/);
    const resultado = await prisma.eventLog.findFirstOrThrow({ where: { orgId: ORG, capabilityId: PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO, tipo: 'tool.resultado' } });
    expect(resultado.nivel).toBe('R4');
    expect(json(resultado)).toContain(id.titular);
    const lote = await prisma.aprovacaoDeLote.findUniqueOrThrow({ where: { id: regra.loteId } });
    expect(resultado.contentHash).toBe(lote.hashConteudo);
    expect((resultado.payload as { rastro?: { faltando?: string[] } }).rastro?.faltando ?? []).not.toContain('aprovador');

    const tudo = json([
      await prisma.eventLog.findMany({ where: { orgId: ORG } }),
      await prisma.toolCall.findMany({ where: { orgId: ORG } }),
      await prisma.auditLog.findMany({ where: { orgId: ORG } }),
    ]);
    const cid = (await prisma.comentarioComPalavra.findFirstOrThrow({ where: { orgId: ORG, usuario: 'fulano.silva' } })).commentId;
    expect(tudo).not.toContain(cid);
    expect(tudo).not.toContain(FULANO.id);
    // Nem o pseudônimo no RASTRO do envio: o HMAC da pessoa vive 90 dias na linha do envio, não 5 anos ali.
    // (A leitura da MD9, `instagram.comentario.ler`, grava o HMAC de quem casou no resultado dela: é outra capacidade.)
    const doEnvio = json([
      await prisma.eventLog.findMany({ where: { orgId: ORG, capabilityId: PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO } }),
      await prisma.toolCall.findMany({ where: { orgId: ORG, capabilityId: PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO } }),
    ]);
    expect(doEnvio).toContain('"estado":"enviado"');
    expect(doEnvio).not.toContain(hmacDaPessoa(FULANO.id, CHAVE));
    expect(tudo).not.toContain('fulano.silva');
    expect(tudo).not.toContain('quero muito');
  });

  it('PRONTO QUANDO 2: a mesma pessoa, comentando de novo, não recebe duas mensagens', async () => {
    const cid = comenta('md11-midia-corte', 'AGENTES de novo', FULANO);
    const r = await passar();
    expect(r.resumo).toMatch(/1 da mesma pessoa, ignorada/);
    expect(graph.respostas).toEqual([]);
    expect(await envioDo(cid)).toMatchObject({ estado: 'ignorado', travaDaPessoa: null });
    // A reentrega (a mesma leitura na passagem seguinte) também não gera outro envio.
    await passar();
    expect(graph.respostas).toEqual([]);
    expect(await prisma.envioDeResposta.count({ where: { orgId: ORG, estado: 'enviado' } })).toBe(1);
  });

  it('PRONTO QUANDO 5 e 4: fora da janela o envio fica segurado até as 08h de São Paulo; na manhã seguinte ele sai, contado no dia novo, sem nova aprovação', async () => {
    relogio(EM('2026-09-01', '22:00'));
    const cid = comenta('md11-midia-car', 'agentes!', BELTRANO);
    const r = await passar();
    expect(r.resumo).toMatch(/1 segurada\(s\) até a janela abrir \(08:00\)/);
    expect(graph.respostas).toEqual([]);
    expect(await envioDo(cid)).toMatchObject({ estado: 'segurado', seguradoAte: EM('2026-09-02', '08:00') });

    relogio(EM('2026-09-02', '07:59'));
    await passar();
    expect(graph.respostas).toEqual([]);

    relogio(EM('2026-09-02', '08:05'));
    const manha = await passar();
    expect(manha.resumo).toMatch(/1 enviada\(s\)/);
    expect(graph.respostas).toHaveLength(1);
    expect((graph.respostas[0].corpo as { recipient: { comment_id: string } }).recipient.comment_id).toBe(cid);
    expect(await envioDo(cid)).toMatchObject({ estado: 'enviado', seguradoAte: null });
    const item = await prisma.itemDoLote.findUniqueOrThrow({ where: { id: regra.itemId } });
    expect(item).toMatchObject({ usos: 2, usosNoDia: 1, diaDoContador: '2026-09-02', estado: 'ativo' });
    expect(await prisma.approval.count({ where: { orgId: ORG, capabilityId: PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO } })).toBe(0);
  });

  it('PRONTO QUANDO 3: o 101º envio do dia é recusado, e o item continua ativo; no dia seguinte a mesma linha sai', async () => {
    relogio(EM('2026-09-02', '10:00'));
    await prisma.itemDoLote.update({ where: { id: regra.itemId }, data: { usosNoDia: 100, diaDoContador: '2026-09-02' } });
    const cid = comenta('md11-midia-car', 'AGENTES', CICLANO);
    const r = await passar();
    expect(r.resumo).toMatch(/1 esperando o teto do dia virar/);
    expect(graph.respostas).toEqual([]);
    expect(await envioDo(cid)).toBeNull();

    // E na porta, que é quem decide: o consumo além do teto é recusado e o item segue ativo.
    const argsDeAgora = (await dm.regrasDoEpisodio(ORG, id.episodio)).find((x) => x.itemN === 1)!.args!;
    const c = await naEmpresa(() =>
      lotes.consumirItem({
        orgId: ORG,
        loteItemId: regra.itemId,
        capabilityId: PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO,
        recursoId: regra.recursoId,
        hashAtual: lotes.hashDoItem(ORG, PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO, argsDeAgora as unknown as Record<string, unknown>),
        loteDaCapacidade: 'pauta.semana.aprovar',
      }),
    );
    expect(c).toEqual({ ok: false, motivo: 'o teto do dia (100) foi atingido' });
    const item = await prisma.itemDoLote.findUniqueOrThrow({ where: { id: regra.itemId } });
    expect(item).toMatchObject({ estado: 'ativo', usosNoDia: 100 });

    relogio(EM('2026-09-03', '09:00'));
    const amanha = await passar();
    expect(amanha.resumo).toMatch(/1 enviada\(s\)/);
    expect(await envioDo(cid)).toMatchObject({ estado: 'enviado' });
    expect(await prisma.itemDoLote.findUniqueOrThrow({ where: { id: regra.itemId } })).toMatchObject({ usosNoDia: 1, diaDoContador: '2026-09-03' });
  });

  it('dois envios simultâneos no último uso do dia: um sai, o outro não; na virada, os dois contam no dia novo', async () => {
    relogio(EM('2026-09-03', '11:00'));
    const argsDeAgora = (await dm.regrasDoEpisodio(ORG, id.episodio)).find((x) => x.itemN === 1)!.args!;
    const pedido = {
      orgId: ORG,
      loteItemId: regra.itemId,
      capabilityId: PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO,
      recursoId: regra.recursoId,
      hashAtual: lotes.hashDoItem(ORG, PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO, argsDeAgora as unknown as Record<string, unknown>),
      loteDaCapacidade: 'pauta.semana.aprovar',
    };
    await prisma.itemDoLote.update({ where: { id: regra.itemId }, data: { usosNoDia: 99, diaDoContador: '2026-09-03' } });
    const [a, b] = await Promise.all([naEmpresa(() => lotes.consumirItem(pedido)), naEmpresa(() => lotes.consumirItem(pedido))]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect((await prisma.itemDoLote.findUniqueOrThrow({ where: { id: regra.itemId } })).usosNoDia).toBe(100);

    relogio(EM('2026-09-04', '09:00'));
    const [x, y] = await Promise.all([naEmpresa(() => lotes.consumirItem(pedido)), naEmpresa(() => lotes.consumirItem(pedido))]);
    expect(x.ok && y.ok).toBe(true);
    expect(await prisma.itemDoLote.findUniqueOrThrow({ where: { id: regra.itemId } })).toMatchObject({ usosNoDia: 2, diaDoContador: '2026-09-04', estado: 'ativo' });
  });

  it('com o Instagram desligado em /conexoes, nada sai e a regra continua ativa', async () => {
    relogio(EM('2026-09-04', '10:00'));
    await naEmpresa(() => conectores.desligar(ORG, 'instagram', { motivo: 'teste do interruptor', actorId: id.proponente }));
    try {
      const cid = comenta('md11-midia-car', 'AGENTES', { id: 'md11-pessoa-desligado', username: 'desligado' });
      await passar().catch(() => undefined);
      expect(graph.respostas).toEqual([]);
      expect(await envioDo(cid)).toBeNull();
      expect((await prisma.itemDoLote.findUniqueOrThrow({ where: { id: regra.itemId } })).estado).toBe('ativo');
    } finally {
      await prisma.conectorDesligado.deleteMany({ where: { orgId: ORG } });
    }
    // Religado, a linha que esperava sai na passagem seguinte.
    await passar();
    expect(graph.respostas).toHaveLength(1);
  });

  it('PRONTO QUANDO 6: o destino do link alterado no /bio pausa a regra, e nada sai', async () => {
    await prisma.bioLink.update({ where: { id: linkId }, data: { destino: 'https://outro.site/golpe' } });
    const cid = comenta('md11-midia-car', 'AGENTES', { id: 'md11-pessoa-destino', username: 'destino' });
    const r = await passar();
    expect(r.resumo).toMatch(/pausada\(s\): o destino do link da DM foi alterado no \/bio/);
    expect(graph.respostas).toEqual([]);
    expect(await envioDo(cid)).toBeNull();
    const item = await prisma.itemDoLote.findUniqueOrThrow({ where: { id: regra.itemId } });
    expect(item.estado).toBe('revogado');
    expect(item.motivoDaRevogacao).toMatch(/destino do link da DM foi alterado/);
    expect(await prisma.auditLog.count({ where: { orgId: ORG, action: 'pauta.dm_regra_pausada' } })).toBe(1);
    // A fila mostra por que a regra caiu; o comentário segue para a resposta à mão.
    const fila = await naEmpresa(() => controlador.fila({ orgId: ORG, sub: id.proponente } as JwtUser));
    expect(fila.dmAutomatica!.regras.find((x) => x.loteItemId === regra.itemId)?.motivoDaPausa).toMatch(/destino/);
    await prisma.bioLink.update({ where: { id: linkId }, data: { destino: ITENS[0].url } });
    const linha = await prisma.comentarioComPalavra.findFirstOrThrow({ where: { orgId: ORG, commentId: cid } });
    await naEmpresa(() => comentarios.marcarRespondido(ORG, linha.id, id.proponente));
  });

  it('o erro 100/2534001 da Meta grava "precisa de Advanced Access" e pausa a regra; o comentário volta para a mão', async () => {
    relogio(EM('2026-09-04', '11:00'));
    const nova = await loteNovoAssinado();
    regra = { loteId: nova.loteId, itemId: nova.item.id, recursoId: nova.item.recursoId };
    const cid = comenta('md11-midia-car', 'AGENTES', { id: 'md11-pessoa-sem-papel', username: 'sempapel' });
    // A Meta ecoa o id do comentário no erro: ele não pode chegar ao RASTRO.
    graph.falhas.push({ status: 400, corpo: { error: { message: `Requires advanced access for comment ${cid}`, type: 'OAuthException', code: 100, error_subcode: 2534001 } } });
    const r = await passar();
    expect(r.resumo).toMatch(/precisa de Advanced Access/);
    expect(graph.respostas).toHaveLength(1);
    const e = await envioDo(cid);
    expect(e).toMatchObject({ estado: 'erro', codigoDoErro: '100/2534001', travaDaPessoa: null });
    expect(e!.motivo).toMatch(/precisa de Advanced Access/);
    const item = await prisma.itemDoLote.findUniqueOrThrow({ where: { id: regra.itemId } });
    expect(item.estado).toBe('revogado');
    expect(item.motivoDaRevogacao).toMatch(/precisa de Advanced Access/);
    expect(e!.motivo).toContain('[id do comentário]');
    const rastro = json([await prisma.eventLog.findMany({ where: { orgId: ORG } }), await prisma.toolCall.findMany({ where: { orgId: ORG } })]);
    expect(rastro).toContain('[id do comentário]');
    expect(rastro).not.toContain(cid);
    const linha = await prisma.comentarioComPalavra.findFirstOrThrow({ where: { orgId: ORG, commentId: cid } });
    expect(linha.respondidoEm).toBeNull();
    await naEmpresa(() => comentarios.marcarRespondido(ORG, linha.id, id.proponente));
  });

  it('três recusas seguidas da Meta pausam a regra; a terceira fica registrada', async () => {
    const nova = await loteNovoAssinado();
    regra = { loteId: nova.loteId, itemId: nova.item.id, recursoId: nova.item.recursoId };
    for (let i = 0; i < 3; i++) graph.falhas.push({ status: 500, corpo: { error: { message: 'temporário', code: 2 } } });
    const cids = [1, 2, 3].map((n) => comenta('md11-midia-car', 'AGENTES', { id: `md11-pessoa-erro-${n}`, username: `erro${n}` }));
    const r = await passar();
    expect(r.resumo).toMatch(/3 recusada\(s\) pela Meta/);
    expect(r.resumo).toMatch(/três recusas seguidas da Meta/);
    expect(graph.respostas).toHaveLength(3);
    for (const cid of cids) expect(await envioDo(cid)).toMatchObject({ estado: 'erro', codigoDoErro: '2' });
    expect((await prisma.itemDoLote.findUniqueOrThrow({ where: { id: regra.itemId } })).estado).toBe('revogado');
    for (const cid of cids) {
      const linha = await prisma.comentarioComPalavra.findFirstOrThrow({ where: { orgId: ORG, commentId: cid } });
      await naEmpresa(() => comentarios.marcarRespondido(ORG, linha.id, id.proponente));
    }
  });

  it('pausar pela tela é R0, pela porta, sem aprovação nem no segundo clique da hora; editar o texto da DM derruba a regra assinada', async () => {
    const nova = await loteNovoAssinado();
    const r = (await naEmpresa(() => controlador.pausar({ orgId: ORG, sub: id.proponente } as JwtUser, nova.item.id, { motivo: 'robô comentando a palavra' }))) as {
      estadoNovo: { estado: string };
    };
    expect(r.estadoNovo).toEqual({ estado: 'revogado' });
    const item = await prisma.itemDoLote.findUniqueOrThrow({ where: { id: nova.item.id } });
    expect(item.estado).toBe('revogado');
    expect(item.motivoDaRevogacao).toMatch(/pausada à mão: robô comentando a palavra/);
    const decisao = await prisma.policyDecision.findFirstOrThrow({ where: { orgId: ORG, capabilityId: PAUTA_CAPACIDADE_DE_PAUSAR_A_DM } });
    expect(decisao.nivel).toBe('R0');
    expect(await prisma.approval.count({ where: { orgId: ORG, capabilityId: PAUTA_CAPACIDADE_DE_PAUSAR_A_DM } })).toBe(0);
    await expect(naEmpresa(() => controlador.pausar({ orgId: ORG, sub: id.proponente } as JwtUser, nova.item.id, { motivo: 'de novo' }))).rejects.toThrow(/o item está revogado/);

    const outra = await loteNovoAssinado();
    const textos = await naEmpresa(() => comentarios.prepararTextos(ORG, id.episodio, id.proponente));
    const link = textos.find((t) => t.itemN === 1)!.link!;
    await naEmpresa(() => comentarios.editarTexto(ORG, id.episodio, ITENS[0].id!, `O link da matéria dos agentes: ${link}`, id.proponente));
    const depois = await prisma.itemDoLote.findUniqueOrThrow({ where: { id: outra.item.id } });
    expect(depois.estado).toBe('revogado');
    expect(depois.motivoDaRevogacao).toMatch(/texto da DM foi editado/);
    // O próximo lote leva o texto novo, e a titular o lê com a linha de aviso na frente.
    const m = await naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, []));
    const c = await naEmpresa(() => semana.conteudo(ORG, m.loteId));
    expect(c.dm![0].texto).toBe(`${avisoDeMensagemAutomatica('AGENTES')}\n\nO link da matéria dos agentes: ${link}`);
    await naEmpresa(() => comentarios.editarTexto(ORG, id.episodio, ITENS[0].id!, null, id.proponente));
  });

  it('a DM segurada cuja regra cai antes das 08h não sai de manhã: volta à mão, sem trava', async () => {
    const nova = await loteNovoAssinado();
    relogio(EM('2026-09-04', '21:00'));
    const cid = comenta('md11-midia-car', 'AGENTES', { id: 'md11-pessoa-noite', username: 'noite' });
    await passar();
    expect(await envioDo(cid)).toMatchObject({ estado: 'segurado' });
    await naEmpresa(() => controlador.pausar({ orgId: ORG, sub: id.proponente } as JwtUser, nova.item.id, { motivo: 'parar antes da manhã' }));
    relogio(EM('2026-09-05', '08:10'));
    await passar();
    expect(graph.respostas).toEqual([]);
    expect(await envioDo(cid)).toMatchObject({ estado: 'recusado', travaDaPessoa: null });
    const linha = await prisma.comentarioComPalavra.findFirstOrThrow({ where: { orgId: ORG, commentId: cid } });
    expect(linha.respondidoEm).toBeNull();
    await naEmpresa(() => comentarios.marcarRespondido(ORG, linha.id, id.proponente));
  });

  it('"fica fora" deixa a DM de fora do lote; a regra que mudou entre a montagem e a assinatura não vale na ativação', async () => {
    await expect(naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, [PAUTA_FORA_DO_LOTE_DM]))).rejects.toThrow(/Não há peça para aprovar/);
    const m = await naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, []));
    // Entre a montagem e a assinatura, o destino da DM muda no /bio.
    await prisma.bioLink.update({ where: { id: linkId }, data: { destino: 'https://outro.site/depois' } });
    try {
      const c = await naEmpresa(() => semana.conteudo(ORG, m.loteId));
      expect(c.dm![0].divergente).toMatch(/não sai/);
      await assinar(m.loteId);
      const d = await lotes.detalhe(ORG, m.loteId);
      expect(d.itens[0].estado).toBe('revogado');
      expect(d.estado).toBe('encerrado');
    } finally {
      await prisma.bioLink.update({ where: { id: linkId }, data: { destino: ITENS[0].url } });
    }
  });

  it('sem a capacidade no catálogo da empresa (o seed não rodou), a regra fica fora com o porquê e não derruba a semana', async () => {
    relogio(EM('2026-09-05', '10:00'));
    const original = policy.resolverCapacidade.bind(policy);
    const espiao = vi
      .spyOn(policy, 'resolverCapacidade')
      .mockImplementation((org: string, cap: string) => (cap === PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO ? null : original(org, cap)));
    try {
      const e = await naEmpresa(() => semana.estado(ORG, id.episodio, id.proponente));
      expect(e.dm!.regras.find((r) => r.itemN === 1)!.problema).toMatch(/db:seed:politica assinado/);
      // Só a DM entraria: a semana diz que não há o que aprovar, em vez do 400 do lote inteiro.
      await expect(naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, []))).rejects.toThrow(/Não há peça para aprovar/);
    } finally {
      espiao.mockRestore();
    }
  });

  it('a trava é da matéria: a regra pausada e assinada de novo não manda a segunda DM a quem já recebeu', async () => {
    const QUEM = { id: 'md11-pessoa-trava', username: 'trava' };
    const primeira = await loteNovoAssinado();
    comenta('md11-midia-car', 'AGENTES', QUEM);
    await passar();
    expect(graph.respostas).toHaveLength(1);
    await naEmpresa(() => controlador.pausar({ orgId: ORG, sub: id.proponente } as JwtUser, primeira.item.id, { motivo: 'conferir o texto de novo' }));
    const segunda = await loteNovoAssinado();
    expect(segunda.item.id).not.toBe(primeira.item.id);
    regra = { loteId: segunda.loteId, itemId: segunda.item.id, recursoId: segunda.item.recursoId };
    graph.zerar();
    const cid = comenta('md11-midia-corte', 'AGENTES outra vez', QUEM);
    const r = await passar();
    expect(r.resumo).toMatch(/1 da mesma pessoa, ignorada/);
    expect(graph.respostas).toEqual([]);
    expect(await envioDo(cid)).toMatchObject({ estado: 'ignorado', loteItemId: segunda.item.id, travaDaPessoa: null });
  });

  it('mais de 40 comentários antigos de matéria sem regra não tomam as vagas: o comentário da regra que vale sai', async () => {
    const velho = Date.now() - 3 * 3600_000;
    await prisma.comentarioComPalavra.createMany({
      data: Array.from({ length: TETO_DE_ENVIOS_POR_PASSAGEM + 1 }, (_, n) => ({
        pecaId: id.newsletter,
        commentId: `md11-velho-${n}`,
        midiaId: 'md11-midia-news',
        palavra: 'BATCH',
        pessoaHmac: hmacDaPessoa(`md11-pessoa-velha-${n}`, CHAVE),
        usuario: `velho${n}`,
        comentadoEm: new Date(velho + n * 1000),
        expiraEm: new Date(velho + 7 * 86_400_000),
      })),
    });
    try {
      const cid = comenta('md11-midia-car', 'AGENTES', { id: 'md11-pessoa-na-fila', username: 'nafila' });
      const r = await passar();
      expect(r.resumo).toMatch(/DM automática: 1 enviada\(s\)/);
      expect(graph.respostas).toHaveLength(1);
      expect(await envioDo(cid)).toMatchObject({ estado: 'enviado', loteItemId: regra.itemId });
      // Os da newsletter seguem na fila à mão, sem linha de envio.
      expect(await prisma.envioDeResposta.count({ where: { orgId: ORG, comentario: { commentId: { startsWith: 'md11-velho-' } } } })).toBe(0);
    } finally {
      await prisma.comentarioComPalavra.deleteMany({ where: { orgId: ORG, commentId: { startsWith: 'md11-velho-' } } });
    }
  });

  it('sem resposta da Meta a DM pode ter saído: fica incerta, com a trava, não conta como recusa, e a mesma pessoa não recebe outra', async () => {
    const QUEM = { id: 'md11-pessoa-incerta', username: 'incerta' };
    graph.abortar = 1;
    const cid = comenta('md11-midia-car', 'AGENTES', QUEM);
    const r = await passar();
    expect(r.resumo).toMatch(/1 sem resposta da Meta \(pode ter saído\)/);
    expect(r.resumo).not.toMatch(/recusada\(s\) pela Meta/);
    expect(graph.respostas).toHaveLength(1);
    expect(await envioDo(cid)).toMatchObject({ estado: 'incerto', travaDaPessoa: travaDaPessoa(regra.recursoId, hmacDaPessoa(QUEM.id, CHAVE)) });
    const linha = await prisma.comentarioComPalavra.findFirstOrThrow({ where: { orgId: ORG, commentId: cid } });
    expect(linha.respondidoEm).toBeNull();
    expect((await prisma.itemDoLote.findUniqueOrThrow({ where: { id: regra.itemId } })).estado).toBe('ativo');

    const cid2 = comenta('md11-midia-corte', 'AGENTES de novo', QUEM);
    await passar();
    expect(graph.respostas).toHaveLength(1);
    expect(await envioDo(cid2)).toMatchObject({ estado: 'ignorado', travaDaPessoa: null });
    // Nada garante que a primeira saiu: a segunda fica na fila, para quem conferir no Instagram.
    const linha2 = await prisma.comentarioComPalavra.findFirstOrThrow({ where: { orgId: ORG, commentId: cid2 } });
    expect(linha2.respondidoEm).toBeNull();
    const fila = await naEmpresa(() => controlador.fila({ orgId: ORG, sub: id.proponente } as JwtUser));
    expect(fila.linhas.find((l) => l.id === linha.id)!.automatica).toMatchObject({ estado: 'incerto' });
    for (const l of [linha, linha2]) await naEmpresa(() => comentarios.marcarRespondido(ORG, l.id, id.proponente));
  });

  it('a linha presa em "enviando" (a passagem caiu no meio) vira incerta na passagem seguinte e segura a trava', async () => {
    const QUEM = { id: 'md11-pessoa-caiu', username: 'caiu' };
    const hmac = hmacDaPessoa(QUEM.id, CHAVE);
    const presa = await prisma.comentarioComPalavra.create({
      data: { pecaId: id.carrossel, commentId: 'md11-caiu-1', midiaId: 'md11-midia-car', palavra: 'AGENTES', pessoaHmac: hmac, usuario: 'caiu', comentadoEm: new Date(Date.now() - 3600_000), expiraEm: new Date(Date.now() + 6 * 86_400_000) },
    });
    const envio = await prisma.envioDeResposta.create({
      data: { comentarioId: presa.id, loteItemId: regra.itemId, pessoaHmac: hmac, travaDaPessoa: travaDaPessoa(regra.recursoId, hmac), estado: 'enviando', correlationId: 'dm-que-caiu', expiraEm: new Date(Date.now() + 90 * 86_400_000) },
    });
    // Uma recém-tomada fica como está: só a que passou do prazo é dada por incerta.
    await passar();
    expect((await prisma.envioDeResposta.findUniqueOrThrow({ where: { id: envio.id } })).estado).toBe('enviando');
    await prisma.$executeRawUnsafe('UPDATE "EnvioDeResposta" SET "atualizadoEm" = $1 WHERE id = $2', new Date(Date.now() - 20 * 60_000), envio.id);
    const cid = comenta('md11-midia-corte', 'AGENTES', QUEM);
    await passar();
    expect(graph.respostas).toEqual([]);
    expect(await prisma.envioDeResposta.findUniqueOrThrow({ where: { id: envio.id } })).toMatchObject({ estado: 'incerto', travaDaPessoa: travaDaPessoa(regra.recursoId, hmac) });
    expect(await envioDo(cid)).toMatchObject({ estado: 'ignorado' });
    const linha = await prisma.comentarioComPalavra.findFirstOrThrow({ where: { orgId: ORG, commentId: cid } });
    expect(linha.respondidoEm).toBeNull();
    for (const l of [presa, linha]) await naEmpresa(() => comentarios.marcarRespondido(ORG, l.id, id.proponente));
  });

  it('a regra vencida não envia: passada a janela do item, o comentário novo fica na fila à mão, e a porta também recusa', async () => {
    await prisma.itemDoLote.update({ where: { id: regra.itemId }, data: { janelaAte: new Date(Date.now() - 60_000) } });
    const cid = comenta('md11-midia-car', 'AGENTES', { id: 'md11-pessoa-tarde', username: 'tarde' });
    await passar();
    expect(graph.respostas).toEqual([]);
    expect(await envioDo(cid)).toBeNull();
    const linha = await prisma.comentarioComPalavra.findFirstOrThrow({ where: { orgId: ORG, commentId: cid } });
    expect(linha.respondidoEm).toBeNull();
    const argsDeAgora = (await dm.regrasDoEpisodio(ORG, id.episodio)).find((x) => x.itemN === 1)!.args!;
    const c = await naEmpresa(() =>
      lotes.consumirItem({
        orgId: ORG,
        loteItemId: regra.itemId,
        capabilityId: PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO,
        recursoId: regra.recursoId,
        hashAtual: lotes.hashDoItem(ORG, PAUTA_CAPACIDADE_DE_RESPONDER_EM_PRIVADO, argsDeAgora as unknown as Record<string, unknown>),
        loteDaCapacidade: 'pauta.semana.aprovar',
      }),
    );
    expect(c.ok).toBe(false);
    await naEmpresa(() => comentarios.marcarRespondido(ORG, linha.id, id.proponente));
  });

  it('a linha de envio vive 90 dias: a passagem apaga a vencida, também com a nota desligada e com o módulo pauta desligado', async () => {
    ligar(false);
    relogio(new Date(EM('2026-09-04', '12:00').getTime() + 90 * 86_400_000));
    const vencidas = await prisma.envioDeResposta.count({ where: { orgId: ORG, expiraEm: { lte: new Date() } } });
    expect(vencidas).toBeGreaterThan(0);
    const r = await dm.passagem(ORG);
    expect(r.resumo).toMatch(new RegExp(`${vencidas} envio\\(s\\) apagado\\(s\\) depois dos 90 dias`));
    // Com o módulo pauta desligado a rotina não lê nada, mas o prazo dos 90 dias vale assim mesmo.
    const resto = await prisma.envioDeResposta.count({ where: { orgId: ORG } });
    expect(resto).toBeGreaterThan(0);
    relogio(new Date(EM('2026-09-06', '12:00').getTime() + 91 * 86_400_000));
    await prisma.org.update({ where: { id: ORG }, data: { modulos: ['bio'] } });
    try {
      const semModulo = await passar();
      expect(semModulo.status).toBe('pulada');
      expect(semModulo.resumo).toMatch(new RegExp(`${resto} envio\\(s\\) apagado\\(s\\) depois dos 90 dias`));
    } finally {
      await prisma.org.update({ where: { id: ORG }, data: { modulos: ['pauta', 'bio'] } });
    }
    expect(await prisma.envioDeResposta.count({ where: { orgId: ORG } })).toBe(0);
    relogio(INICIO);
  });
});
