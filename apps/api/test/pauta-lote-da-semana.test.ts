import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAPACIDADE_DE_APROVAR_A_SEMANA,
  INSTAGRAM_ESCOPO_DE_PUBLICAR,
  PAUTA_ETAPAS_DA_PECA_NA_SEMANA,
  PautaPrepararAprovacaoSchema,
  etapaDaPecaNaSemana,
  instanteNoFuso,
} from '@mktos/shared';
import * as instagram from '../src/bio/plataformas/instagram';
import { canonicalHash, ApprovalsService } from '../src/approvals/approvals.service';
import { LotesService } from '../src/approvals/lotes.service';
import { AssinaturaDeLoteService } from '../src/approvals/assinatura-de-lote.service';
import { ReauthService } from '../src/auth/reauth.service';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { AuditService } from '../src/audit/audit.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { AcoesService } from '../src/gateway/acoes.service';
import { PortaDoOperador, type AcaoRetida } from '../src/gateway/porta-do-operador.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { linkDaFila, textoDoAviso } from '../src/gateway/canais/pedido-no-canal';
import { ConectoresService } from '../src/integrations/conectores.service';
import { comContexto } from '../src/common/contexto-execucao';
import { cifrar } from '../src/common/crypto';
import { conferir } from '../src/pauta/midia-publica';
import type { GraphDePublicacao } from '../src/pauta/graph-de-publicacao';
import { PublicacaoInstagramService } from '../src/pauta/publicacao-instagram.service';
import { LoteDaSemanaService } from '../src/pauta/lote-da-semana.service';
import { LoteDaSemanaController } from '../src/pauta/lote-da-semana.controller';
import { RotinaService } from '../src/pauta/rotina.service';
import { DerivacaoService } from '../src/pauta/derivacao.service';
import { AgendaService } from '../src/pauta/agenda.service';
import { EpisodioService } from '../src/pauta/episodio.service';
import { jpegDeTeste } from './mp4-de-teste';
import {
  argsDoItem,
  divergenciaDoItem,
  impedimentosDaSemana,
  janelaDoItem,
  ocupadoComAsCandidatas,
  problemaDaPeca,
  problemaDaPublicacao,
  reabreNaAtivacao,
  slotDaPeca,
  validadeDoLote,
  type PecaDoLote,
} from '../src/pauta/lote-da-semana';
import type { ContaParaPublicar } from '../src/pauta/publicacao-instagram';
import type { MemoriaService } from '../src/memory/memoria.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * MD8 — APROVAR A SEMANA NUM PONTO SÓ.
 *
 * Sem banco: as pré-condições de cada peça, o hash do item (que muda com a
 * legenda, a mídia, o horário e a conta), a etapa da linha do tempo, as rotas
 * e o link do aviso. Com banco: o caminho inteiro com a porta de verdade, duas
 * pessoas (quem monta e a titular que assina com senha e motivo), o executor da
 * MD6 e um dublê da Graph — nada sai antes da assinatura, nada sai com a nota
 * desligada, a peça editada depois de ativo não sai e as outras saem, até 3 por
 * passagem, com um consumo por item no RASTRO e o aprovador do lote.
 */

const SHA = (c: string) => c.repeat(64).slice(0, 64);
const CONTA: ContaParaPublicar = { externalId: 'ig-root', handle: 'operacaoroot', escopos: [INSTAGRAM_ESCOPO_DE_PUBLICAR], status: 'ok' };

function meta(formato: 'carrossel' | 'story' | 'corte', episodioId = 'ep-1', o: { slides?: number; semJpeg?: boolean; semanaSha?: string } = {}) {
  const slides = o.slides ?? 3;
  const imagens =
    formato === 'corte' || o.semJpeg
      ? []
      : Array.from({ length: formato === 'story' ? 1 : slides }, (_, i) => ({
          n: i + 1,
          chave: `pauta/peca/${formato}-${i + 1}-${o.semanaSha ?? 'a'}.jpg`,
          sha: 'abc',
          sha256: SHA(o.semanaSha ?? String((i + 1) % 10)),
          tipo: 'jpeg',
          largura: 1080,
          altura: formato === 'story' ? 1920 : 1350,
          bytes: 1000,
          enviadaEm: '2026-09-01T10:00:00.000Z',
        }));
  return {
    episodioId,
    itemId: `item-${formato}`,
    itemN: 1,
    formato,
    transcricaoSha: 't',
    linkDaMateria: null,
    avisos: [],
    imagens,
    ...(formato === 'carrossel' ? { slides: Array.from({ length: slides }, (_, i) => ({ titulo: `S${i + 1}`, texto: 'x' })) } : {}),
    ...(formato === 'corte' ? { video: { arquivo: null, duracaoSeg: 30, largura: 1080, altura: 1920, bytes: 5000, chave: 'pauta/pecas/k/corte-x.mp4', sha256: SHA('e') } } : {}),
  };
}

function peca(p: Partial<PecaDoLote> = {}): PecaDoLote {
  return {
    id: 'peca-1',
    canal: 'instagram',
    formato: 'carrossel',
    status: 'rascunho',
    corpo: 'A legenda do carrossel',
    meta: meta('carrossel'),
    agendadaPara: null,
    slotProposto: new Date('2026-09-02T15:00:00Z'),
    ...p,
  };
}

const AGORA = new Date('2026-09-01T13:00:00Z');
const livre = () => false;

describe('MD8: as pré-condições de cada peça (puro)', () => {
  it('a peça pronta entra; o slot é o proposto (rascunho) ou a agenda (aprovada)', () => {
    expect(problemaDaPeca(peca(), CONTA, AGORA, livre)).toBeNull();
    expect(slotDaPeca(peca())?.toISOString()).toBe('2026-09-02T15:00:00.000Z');
    expect(slotDaPeca(peca({ status: 'aprovada', agendadaPara: new Date('2026-09-03T15:00:00Z'), slotProposto: null }))?.toISOString()).toBe('2026-09-03T15:00:00.000Z');
  });

  it('cada pré-condição tem a frase própria, que diz o que fazer', () => {
    expect(problemaDaPeca(peca({ slotProposto: null }), CONTA, AGORA, livre)).toMatch(/Sem slot/);
    expect(problemaDaPeca(peca({ slotProposto: new Date('2026-09-01T12:00:00Z') }), CONTA, AGORA, livre)).toMatch(/já passou/);
    expect(problemaDaPeca(peca({ slotProposto: new Date('2026-09-09T12:00:00Z') }), CONTA, AGORA, livre)).toMatch(/8 dias/);
    expect(problemaDaPeca(peca({ meta: meta('carrossel', 'ep-1', { slides: 11 }) }), CONTA, AGORA, livre)).toMatch(/até 10/);
    expect(problemaDaPeca(peca({ corpo: 'x'.repeat(2201) }), CONTA, AGORA, livre)).toMatch(/2201 caracteres/);
    expect(problemaDaPeca(peca({ meta: meta('carrossel', 'ep-1', { semJpeg: true }) }), CONTA, AGORA, livre)).toMatch(/Falta o JPEG/);
    const semMp4 = { ...meta('corte'), video: null };
    expect(problemaDaPeca(peca({ formato: 'corte', meta: semMp4 }), CONTA, AGORA, livre)).toMatch(/mp4 do corte/);
    expect(problemaDaPeca(peca(), CONTA, AGORA, () => true)).toMatch(/mesmo formato nesse horário/);
  });

  it('a semana inteira para sem a página de links no ar, sem conta de publicação ou fora da Derivação/Agendado', () => {
    expect(impedimentosDaSemana({ status: 'derivacao', paginaNoAr: true, conta: CONTA })).toEqual([]);
    expect(impedimentosDaSemana({ status: 'agendado', paginaNoAr: true, conta: CONTA })).toEqual([]);
    expect(impedimentosDaSemana({ status: 'derivacao', paginaNoAr: false, conta: CONTA })).toEqual([expect.stringMatching(/página de links/)]);
    expect(impedimentosDaSemana({ status: 'derivacao', paginaNoAr: true, conta: null })).toEqual([expect.stringMatching(/conta de publicação/)]);
    expect(impedimentosDaSemana({ status: 'derivacao', paginaNoAr: true, conta: { ...CONTA, escopos: [] } })).toEqual([expect.stringMatching(/permissão de publicar/)]);
    expect(impedimentosDaSemana({ status: 'derivacao', paginaNoAr: true, conta: { ...CONTA, status: 'expirada' } })).toEqual([expect.stringMatching(/expirada/)]);
    expect(impedimentosDaSemana({ status: 'pacote', paginaNoAr: true, conta: CONTA })).toEqual([expect.stringMatching(/Derivação ou no Agendado/)]);
  });

  it('o hash do item muda com a legenda, a mídia, o horário e a conta — e é o mesmo para a peça em rascunho e a aprovada no slot', () => {
    const h = (p: PecaDoLote, c = CONTA) => canonicalHash('instagram.post.publicar', argsDoItem(p, c) as unknown as Record<string, unknown>, []);
    const base = h(peca());
    expect(h(peca({ status: 'aprovada', agendadaPara: new Date('2026-09-02T15:00:00Z'), slotProposto: null }))).toBe(base);
    expect(h(peca({ corpo: 'Outra legenda' }))).not.toBe(base);
    expect(h(peca({ meta: meta('carrossel', 'ep-1', { semanaSha: 'f' }) }))).not.toBe(base);
    expect(h(peca({ slotProposto: new Date('2026-09-02T15:01:00Z') }))).not.toBe(base);
    expect(h(peca(), { ...CONTA, externalId: 'ig-outra' })).not.toBe(base);
    // O que não vai ao post não muda o hash: o título interno da peça.
    expect(argsDoItem(peca(), CONTA)).toEqual(expect.objectContaining({ agendadaPara: '2026-09-02T15:00:00.000Z', igUserId: 'ig-root' }));
  });

  it('a janela vai do slot a slot + 2 h, e o lote vence no fim da última', () => {
    const j = janelaDoItem(new Date('2026-09-02T15:00:00Z'));
    expect(j.janelaAte.toISOString()).toBe('2026-09-02T17:00:00.000Z');
    expect(validadeDoLote([j.janelaAte, new Date('2026-09-04T11:00:00Z')]).toISOString()).toBe('2026-09-04T11:00:00.000Z');
  });

  it('a divergência diz por que o item não sai', () => {
    expect(divergenciaDoItem({ estadoDaPeca: 'rascunho', hashAgora: 'a', hashItem: 'a' })).toBeNull();
    expect(divergenciaDoItem({ estadoDaPeca: null, hashAgora: null, hashItem: 'a' })).toMatch(/não existe/);
    expect(divergenciaDoItem({ estadoDaPeca: 'descartada', hashAgora: 'a', hashItem: 'a' })).toMatch(/descartada/);
    expect(divergenciaDoItem({ estadoDaPeca: 'aprovada', hashAgora: 'b', hashItem: 'a' })).toMatch(/mudou depois/);
    expect(divergenciaDoItem({ estadoDaPeca: 'aprovada', hashAgora: null, hashItem: 'a', erroAoMontar: 'Falta o JPEG 2' })).toMatch(/Falta o JPEG 2/);
  });

  it('a linha do tempo: rascunho → proposto → aguardando assinatura → ativo → publicando → publicada', () => {
    expect(PAUTA_ETAPAS_DA_PECA_NA_SEMANA).toEqual(['rascunho', 'proposto', 'aguardando', 'ativo', 'publicando', 'publicada']);
    expect(etapaDaPecaNaSemana({ status: 'rascunho' })).toBe('rascunho');
    expect(etapaDaPecaNaSemana({ status: 'rascunho', slotProposto: 'x' })).toBe('proposto');
    const lote = (estadoDoLote: 'proposta' | 'aguardando' | 'ativo', estadoDoItem: 'ativo' | 'revogado' = 'ativo') => ({ estadoDoLote, estadoDoItem });
    expect(etapaDaPecaNaSemana({ status: 'rascunho', slotProposto: 'x', lote: lote('aguardando') })).toBe('aguardando');
    expect(etapaDaPecaNaSemana({ status: 'aprovada', agendadaPara: 'x', lote: lote('ativo') })).toBe('ativo');
    // Item revogado (a peça foi editada) volta a ser só o slot.
    expect(etapaDaPecaNaSemana({ status: 'aprovada', agendadaPara: 'x', lote: lote('ativo', 'revogado') })).toBe('proposto');
    expect(etapaDaPecaNaSemana({ status: 'aprovada', agendadaPara: 'x', lote: lote('ativo'), publicacao: { estado: 'processando' } })).toBe('publicando');
    expect(etapaDaPecaNaSemana({ status: 'publicada' })).toBe('publicada');
  });

  it('duas candidatas do mesmo formato no mesmo slot: a segunda fica com o problema, a primeira entra', () => {
    const a = peca({ id: 'a' });
    const b = peca({ id: 'b' });
    const c = peca({ id: 'c', formato: 'story', meta: meta('story') });
    const ocupado = ocupadoComAsCandidatas(livre, [a, b, c]);
    expect(problemaDaPeca(a, CONTA, AGORA, ocupado)).toBeNull();
    expect(problemaDaPeca(b, CONTA, AGORA, ocupado)).toMatch(/mesmo formato nesse horário/);
    expect(problemaDaPeca(c, CONTA, AGORA, ocupado)).toBeNull();
  });

  it('a publicação que a peça já tem: barra só o que está na Meta, publicado ou com pedido vivo; o resto a ativação reabre', () => {
    const pub = (estado: 'pendente' | 'erro' | 'recusada' | 'container_criado' | 'processando' | 'publicada', o: { approvalId?: string; erro?: string; vivo?: boolean } = {}) => ({
      estado,
      approvalId: o.approvalId ?? null,
      erro: o.erro ?? null,
      pedidoVivo: !!o.vivo,
    });
    expect(problemaDaPublicacao(null)).toBeNull();
    expect(problemaDaPublicacao(pub('publicada'))).toMatch(/Já publicada/);
    expect(problemaDaPublicacao(pub('processando'))).toMatch(/a caminho na Meta/);
    expect(problemaDaPublicacao(pub('container_criado'))).toMatch(/a caminho na Meta/);
    expect(problemaDaPublicacao(pub('pendente', { approvalId: 'ap', vivo: true }))).toMatch(/Publicar agora.*esperando na fila/);
    for (const x of [pub('pendente', { approvalId: 'ap' }), pub('erro'), pub('recusada'), pub('pendente')]) expect(problemaDaPublicacao(x)).toBeNull();

    expect(reabreNaAtivacao(pub('erro'))).toBe(true);
    expect(reabreNaAtivacao(pub('recusada'))).toBe(true);
    expect(reabreNaAtivacao(pub('pendente', { approvalId: 'ap' }))).toBe(true);
    expect(reabreNaAtivacao(pub('pendente', { erro: 'container venceu' }))).toBe(true);
    // O pedido vivo fica como está (o executor o toma do mesmo jeito), e a linha limpa não precisa de escrita.
    expect(reabreNaAtivacao(pub('pendente', { approvalId: 'ap', vivo: true }))).toBe(false);
    expect(reabreNaAtivacao(pub('pendente'))).toBe(false);
    expect(reabreNaAtivacao(null)).toBe(false);
  });

  it('"ativo" na linha do tempo só com a peça aprovada e a publicação fora do manual', () => {
    const ativo = { estadoDoLote: 'ativo' as const, estadoDoItem: 'ativo' as const };
    // O refazer mídia mandou a peça a rascunho: ela não sai, e a linha não diz que sai.
    expect(etapaDaPecaNaSemana({ status: 'rascunho', slotProposto: 'x', lote: ativo })).toBe('proposto');
    expect(etapaDaPecaNaSemana({ status: 'aprovada', agendadaPara: 'x', lote: ativo, publicacao: { estado: 'recusada' } })).toBe('proposto');
    // O erro que não é do item (antes do horário) o executor ainda toma: segue "ativo".
    expect(etapaDaPecaNaSemana({ status: 'aprovada', agendadaPara: 'x', lote: ativo, publicacao: { estado: 'erro' } })).toBe('ativo');
  });

  it('"fica fora" é uma lista curta de ids; o corpo não aceita outra chave', () => {
    expect(PautaPrepararAprovacaoSchema.parse({})).toEqual({ fora: [] });
    expect(PautaPrepararAprovacaoSchema.parse({ fora: [' p1 '] })).toEqual({ fora: ['p1'] });
    expect(() => PautaPrepararAprovacaoSchema.parse({ fora: [], itens: [] })).toThrow();
    expect(() => PautaPrepararAprovacaoSchema.parse({ fora: Array.from({ length: 61 }, (_, i) => `p${i}`) })).toThrow();
  });

  it('montar e cancelar pedem pauta.publicar; ler a semana, pauta.ver; o conteúdo do lote, só quem decide', () => {
    const c = LoteDaSemanaController.prototype;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, c.preparar)).toEqual(['pauta.publicar']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, c.cancelar)).toEqual(['pauta.publicar']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, c.estado)).toEqual(['pauta.ver']);
    // O conteúdo exato vai só para quem pode decidir: `aprovacoes.ver` (o perfil financeiro) vê a fila sem ele.
    expect(Reflect.getMetadata(PERMISSIONS_KEY, c.conteudo)).toEqual(['aprovacoes.decidir']);
  });

  it('o aviso do canal (R4 não se decide no WhatsApp) leva o link da fila, só com origem https ou loopback', () => {
    expect(linkDaFila('https://os.operacaoroot.com,https://outra')).toBe('https://os.operacaoroot.com/atendimento');
    expect(linkDaFila('http://localhost:4000')).toBe('http://localhost:4000/atendimento');
    expect(linkDaFila('http://os.operacaoroot.com')).toBeNull();
    expect(linkDaFila(undefined)).toBeNull();
    const p = { resumo: 'Semana de ep-04', nivel: 'R4', capacidade: CAPACIDADE_DE_APROVAR_A_SEMANA, hashCurto: 'abc', expiraEm: new Date(), args: {} };
    expect(textoDoAviso(p, 'porque', 'https://os.x/atendimento')).toContain('para decidir: https://os.x/atendimento');
    expect(textoDoAviso(p, 'porque', null)).toContain('Abra a fila de aprovações no painel para decidir.');
  });
});

// ---------------------------------------------------------------------------
// Com banco: a semana, a assinatura e o executor
// ---------------------------------------------------------------------------

const SEGREDO = 'segredo-da-midia-publica-de-teste-md8-0123456789';

class GraphDuble {
  chamadas: Array<{ metodo: string; caminho: string; campos: Record<string, string> }> = [];
  urlsRecusadas: string[] = [];
  private seq = 0;
  private containers = new Map<string, Record<string, string>>();
  publicados: Array<{ id: string; container: string; caption: string }> = [];

  zerar() {
    this.chamadas = [];
    this.urlsRecusadas = [];
    this.containers.clear();
    this.publicados = [];
  }

  tratar(metodo: string, caminho: string, campos: Record<string, string>): { status: number; corpo?: unknown } {
    this.chamadas.push({ metodo, caminho, campos });
    const partes = caminho.replace(/^\/graph\/v24\.0\//, '').split('/');
    if (metodo === 'POST' && partes[1] === 'media') {
      for (const u of [campos.image_url, campos.video_url]) {
        if (u && !conferir(/\/api\/midia-publica\/([^/?#]+)$/.exec(u)?.[1] ?? '', SEGREDO)) this.urlsRecusadas.push(u);
      }
      const id = `c${++this.seq}`;
      this.containers.set(id, campos);
      return { status: 200, corpo: { id } };
    }
    if (metodo === 'GET' && partes[1] === 'content_publishing_limit') {
      return { status: 200, corpo: { data: [{ quota_usage: this.publicados.length, config: { quota_total: 100, quota_duration: 86400 } }] } };
    }
    if (metodo === 'POST' && partes[1] === 'media_publish') {
      const id = `m${++this.seq}`;
      this.publicados.push({ id, container: campos.creation_id, caption: this.containers.get(campos.creation_id)?.caption ?? '' });
      return { status: 200, corpo: { id } };
    }
    if (metodo === 'GET' && partes.length === 1 && campos.fields === 'status_code,status') {
      if (this.publicados.some((p) => p.container === partes[0])) return { status: 200, corpo: { status_code: 'PUBLISHED' } };
      return { status: 200, corpo: { status_code: 'FINISHED', status: 'x' } };
    }
    if (metodo === 'GET' && partes.length === 1 && campos.fields === 'permalink') {
      return { status: 200, corpo: { permalink: `https://www.instagram.com/p/${partes[0]}` } };
    }
    return { status: 404, corpo: { error: { message: 'rota do dublê desconhecida' } } };
  }
}

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (uma empresa, duas pessoas, um episódio, peças, lotes, aprovações e RASTRO)');

const ORG = 'org-md8-semana';
const SENHA = 'senha-da-titular-md8';
const SUFIXO = `md8-${Date.now().toString(36)}`;
/** Terça, 10h em São Paulo: dentro das 08h–20h, longe de `fora_da_janela`. */
const INICIO = instanteNoFuso('2026-09-01', '10:00');
const SLOT = (hhmm: string) => instanteNoFuso('2026-09-01', hhmm);

describe.skipIf(!URL)('MD8: a semana assinada por outra pessoa sai no horário, pela porta, com o dublê da Graph', () => {
  let prisma: PrismaClient;
  let servidor: Server;
  const graph = new GraphDuble();
  let approvals: ApprovalsService;
  let acoes: AcoesService;
  let lotes: LotesService;
  let assinatura: AssinaturaDeLoteService;
  let semana: LoteDaSemanaService;
  let publicacao: PublicacaoInstagramService;
  let rotinas: RotinaService;
  let derivacao: DerivacaoService;
  let agenda: AgendaService;
  let nota: { body: string; arquivadoEm: string | null } | null = null;
  const id = { proponente: '', titular: '', episodio: '', rodada: '', pagina: '' };
  const pecas: Record<string, string> = {};
  const ambienteAntes: Record<string, string | undefined> = {};
  const AMBIENTE = ['INSTAGRAM_GRAPH_URL', 'PAUTA_MIDIA_PUBLICA_SEGREDO', 'PAUTA_MIDIA_PUBLICA_ORIGEM', 'ENCRYPTION_KEY', 'GATEWAY_MODO'];

  const naEmpresa = <T>(fn: () => Promise<T>, correlationId = 'clique-md8'): Promise<T> => comContexto({ orgId: ORG, correlationId, origem: 'http' }, fn);
  const rotina = (c: string) => comContexto({ orgId: ORG, correlationId: c, origem: 'cron' }, () => publicacao.olharOHorario(ORG, c));
  const publishes = () => graph.chamadas.filter((c) => c.caminho.endsWith('/media_publish')).length;

  async function novaPeca(chave: string, formato: 'carrossel' | 'story' | 'corte', slot: Date, extra: { semJpeg?: boolean } = {}) {
    const p = await prisma.pautaPeca.create({
      data: {
        orgId: ORG,
        rodadaId: id.rodada,
        canal: 'instagram',
        formato,
        titulo: `Peça ${chave}`,
        corpo: `A legenda de ${chave}`,
        status: 'rascunho',
        slotProposto: slot,
        meta: meta(formato, id.episodio, { semJpeg: extra.semJpeg, semanaSha: chave.slice(-1) }) as object,
      },
    });
    pecas[chave] = p.id;
    return p.id;
  }

  async function assinar(loteId: string) {
    const r = (await naEmpresa(() => assinatura.pedirAssinatura(ORG, loteId, id.proponente))) as AcaoRetida;
    await naEmpresa(() => approvals.confirm(ORG, r.approvalId, { id: id.titular, papeis: ['admin_master'], reauth: { senha: SENHA } }, 'conferi os posts, as legendas e os horários da semana'));
    return naEmpresa(() => acoes.executarAprovada(ORG, r.approvalId, id.titular));
  }

  beforeAll(async () => {
    vi.setSystemTime(INICIO);
    for (const k of AMBIENTE) ambienteAntes[k] = process.env[k];
    process.env.GATEWAY_MODO = 'impor';
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64');
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
      create: { id: ORG, name: 'Semana MD8', slug: 'semana-md8', modulos: ['pauta', 'bio'] },
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
        externalId: 'ig-root',
        handle: 'operacaoroot',
        tokenCifrado: cifrar('token-de-publicacao'),
        escopos: `instagram_business_basic,${INSTAGRAM_ESCOPO_DE_PUBLICAR}`,
        finalidade: 'publicacao',
        expiraEm: new Date(Date.now() + 50 * 86_400_000),
      },
    });
    id.pagina = (await prisma.bioPage.create({ data: { orgId: ORG, handle: `semana-md8-${SUFIXO}`, titulo: 'Links do ep-01', publicada: false } })).id;
    id.rodada = (await prisma.pautaRodada.create({ data: { orgId: ORG, status: 'curada', titulo: 'Rodada MD8', janelaIni: INICIO, janelaFim: INICIO } })).id;
    id.episodio = (
      await prisma.pautaEpisodio.create({ data: { rodadaId: id.rodada, numero: 1, titulo: 'Semana 36', status: 'derivacao', bioPageId: id.pagina } })
    ).id;

    // A semana que o encadeamento (MD1) deixou em rascunho, com os slots propostos: 11 posts entre 11h e 12h40.
    const formatos = ['carrossel', 'story', 'corte'] as const;
    for (let i = 0; i < 11; i++) {
      const hh = 11 + Math.floor((i * 10) / 60);
      const mm = (i * 10) % 60;
      await novaPeca(`p${String(i).padStart(2, '0')}`, formatos[i % 3], SLOT(`${hh}:${String(mm).padStart(2, '0')}`));
    }
    // Uma a mais, sem o JPEG: barra a montagem até ficar de fora.
    await novaPeca('sem-jpeg', 'carrossel', SLOT('13:00'), { semJpeg: true });

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    const reauth = new ReauthService(p, new JwtService({ secret: 'segredo-md8' }), audit);
    approvals = new ApprovalsService(p, audit, reauth);
    lotes = new LotesService(p, policy, audit);
    const eventos = new EventLogService(p);
    const registro = new EfeitosRegistry();
    const interruptores = new InterruptoresRegistry();
    new ConectoresService(p, audit, eventos, interruptores).onModuleInit();
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, eventos, undefined, interruptores, registro, lotes);
    acoes = new AcoesService(p, gateway, eventos, interruptores, policy);
    const porta = new PortaDoOperador(gateway, registro);
    assinatura = new AssinaturaDeLoteService(p, lotes, registro, porta);
    assinatura.onModuleInit();
    const memoria = { porChave: async () => nota } as unknown as MemoriaService;
    const cliente: GraphDePublicacao = {
      limiteDePublicacao: instagram.limiteDePublicacao,
      criarContainer: instagram.criarContainer,
      statusDoContainer: instagram.statusDoContainer,
      publicarContainer: instagram.publicarContainer,
      permalinkDe: instagram.permalinkDe,
      midiasRecentes: instagram.midiasRecentes,
    };
    publicacao = new PublicacaoInstagramService(p, audit, registro, interruptores, porta, memoria, cliente, lotes);
    publicacao.onModuleInit();
    semana = new LoteDaSemanaService(p, audit, lotes, publicacao);
    semana.onModuleInit();
    rotinas = new RotinaService(p, audit, {} as never, lotes);
    const episodios = new EpisodioService(p, audit);
    const storage = { put: async () => undefined } as never;
    derivacao = new DerivacaoService(p, audit, {} as never, {} as never, storage, episodios, lotes);
    agenda = new AgendaService(p, audit, memoria, episodios, lotes);
  });

  afterAll(async () => {
    vi.useRealTimers();
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = $1', ORG),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.itemDoLote.deleteMany({ where: { orgId: ORG } });
    await prisma.aprovacaoDeLote.deleteMany({ where: { orgId: ORG } });
    await prisma.pautaPublicacao.deleteMany({ where: { orgId: ORG } });
    await prisma.pautaPeca.deleteMany({ where: { orgId: ORG } });
    await prisma.pautaEpisodio.deleteMany({ where: { orgId: ORG } });
    await prisma.pautaRodada.deleteMany({ where: { orgId: ORG } });
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

  // Os casos dependem da ordem: é a semana de um episódio, do rascunho ao ar.

  it('as pré-condições barram a montagem com a frase de cada uma, e nada é gravado', async () => {
    await expect(naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, []))).rejects.toThrow(/página de links do episódio não está no ar/);
    await prisma.bioPage.update({ where: { id: id.pagina }, data: { publicada: true } });
    await expect(naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, []))).rejects.toThrow(/Falta o JPEG 1.*fica fora/);
    await expect(naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, ['nao-e-daqui']))).rejects.toThrow(/não é desta semana/);
    expect(await prisma.aprovacaoDeLote.count({ where: { orgId: ORG } })).toBe(0);

    const e = await naEmpresa(() => semana.estado(ORG, id.episodio, id.proponente));
    expect(e.impedimentos).toEqual([]);
    expect(e.automaticaLigada).toBe(false);
    // Sem a rotina de publicação criada, a tela sabe que nada sai no horário.
    expect(e.rotinaDePublicacao).toEqual({ existe: false, dispara: false, nome: null, calada: null });
    const rotina = await prisma.rotina.create({
      data: { orgId: ORG, slug: 'publicacao-da-semana', nome: 'Publicação da semana', tipo: 'pauta.publicar-agendadas', cron: '* * * * *', estado: 'rodando' },
    });
    try {
      const comRotina = await naEmpresa(() => semana.estado(ORG, id.episodio, id.proponente));
      expect(comRotina.rotinaDePublicacao).toMatchObject({ existe: true, nome: 'Publicação da semana' });
    } finally {
      await prisma.rotina.delete({ where: { id: rotina.id } });
    }
    expect(e.pecas).toHaveLength(12);
    expect(e.pecas.find((x) => x.id === pecas['sem-jpeg'])?.problema).toMatch(/Falta o JPEG/);
    expect(e.pecas.filter((x) => x.problema === null)).toHaveLength(11);
    expect(new Set(e.pecas.map((x) => x.etapa))).toEqual(new Set(['proposto']));
  });

  let loteId = '';

  it('a semana vira UM lote com os 11 posts; pedir a assinatura vai à fila como R4; nada é publicado antes dela, mesmo com a nota ligada', async () => {
    const m = await naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, [pecas['sem-jpeg']]));
    loteId = m.loteId;
    expect(m).toMatchObject({ itens: 11, fora: [pecas['sem-jpeg']], substituidos: [] });
    const d = await lotes.detalhe(ORG, m.loteId);
    expect(d).toMatchObject({ estado: 'proposta', capabilityId: CAPACIDADE_DE_APROVAR_A_SEMANA, recursoTipo: 'pauta_episodio', recursoId: id.episodio });
    expect(d.resumo).toMatch(/Semana de ep-01: 11 post\(s\) no @operacaoroot, de 01\/09 11:00 a 01\/09 12:40/);
    // A janela de cada item vai do slot a slot + 2 h, e o hash é o dos argumentos da peça como aprovada no slot.
    const primeiro = d.itens.find((i) => i.recursoId === pecas.p00)!;
    expect(primeiro.janelaDe).toBe(SLOT('11:00').toISOString());
    expect(primeiro.janelaAte).toBe(SLOT('13:00').toISOString());

    const r = (await naEmpresa(() => assinatura.pedirAssinatura(ORG, m.loteId, id.proponente))) as AcaoRetida;
    expect(r).toMatchObject({ status: 'aguardando_aprovacao', nivel: 'R4', precisaDeOutraPessoa: true, fila: '/atendimento' });

    // No horário, com a nota ligada, e o lote ainda na fila: nada sai.
    nota = { body: 'ligada', arquivadoEm: null };
    vi.setSystemTime(SLOT('11:05'));
    const passagem = await rotina('rotina-antes');
    expect(passagem.every((l) => l.resultado === 'pulada' && l.detalhe === 'sem aprovação da semana')).toBe(true);
    expect(graph.chamadas).toEqual([]);

    // O conteúdo que a titular lê: cada post, com o hash de agora conferido.
    const c = await naEmpresa(() => semana.conteudo(ORG, m.loteId));
    expect(c).toMatchObject({ total: 11, divergentes: 0, handle: 'operacaoroot' });
    expect(c.itens[0]).toMatchObject({ legenda: 'A legenda de p00', agendadaPara: SLOT('11:00').toISOString(), handle: 'operacaoroot', divergente: null });
    expect(c.itens.find((i) => i.formato === 'corte')?.midia).toEqual({ tipo: 'video', bytes: 5000, duracaoSeg: 30 });

    // Pedir de novo com o pedido vivo é recusado; a aprovação que ficou na fila é a que a titular assina.
    await prisma.approval.update({ where: { id: r.approvalId }, data: { status: 'expirada', expiraEm: new Date(Date.now() - 1000) } });
    nota = null;
    vi.setSystemTime(INICIO);
  });

  it('a titular assina com senha e motivo: o lote fica ativo, as peças aprovadas no slot, o proposto limpo e o episódio Agendado', async () => {
    // Quem montou não assina (invariante 7), nem pela fila.
    const r = (await naEmpresa(() => assinatura.pedirAssinatura(ORG, loteId, id.proponente))) as AcaoRetida;
    await expect(
      naEmpresa(() => approvals.confirm(ORG, r.approvalId, { id: id.proponente, papeis: ['admin_master'], reauth: { senha: SENHA } }, 'eu mesmo aprovo')),
    ).rejects.toThrow(/Quem propôs/);
    await naEmpresa(() => approvals.confirm(ORG, r.approvalId, { id: id.titular, papeis: ['admin_master'], reauth: { senha: SENHA } }, 'conferi os onze posts e os horários'));
    const exec = await naEmpresa(() => acoes.executarAprovada(ORG, r.approvalId, id.titular));
    expect(exec.status).toBe('executado');

    expect(await lotes.detalhe(ORG, loteId)).toMatchObject({ estado: 'ativo', aprovadoPorId: id.titular, motivo: 'conferi os onze posts e os horários' });
    const doLote = await prisma.pautaPeca.findMany({ where: { id: { in: Object.entries(pecas).filter(([k]) => k !== 'sem-jpeg').map(([, v]) => v) } } });
    expect(doLote.every((p) => p.status === 'aprovada' && p.slotProposto === null && p.agendadaPara !== null)).toBe(true);
    expect((await prisma.pautaPeca.findUniqueOrThrow({ where: { id: pecas.p00 } })).agendadaPara?.toISOString()).toBe(SLOT('11:00').toISOString());
    const fora = await prisma.pautaPeca.findUniqueOrThrow({ where: { id: pecas['sem-jpeg'] } });
    expect(fora).toMatchObject({ status: 'rascunho', agendadaPara: null });
    expect(fora.slotProposto).not.toBeNull();
    expect((await prisma.pautaEpisodio.findUniqueOrThrow({ where: { id: id.episodio } })).status).toBe('agendado');
    const ativado = await prisma.auditLog.findFirst({ where: { orgId: ORG, action: 'lote.ativado', entityId: loteId } });
    expect(ativado?.after).toMatchObject({ reacao: { pecasAprovadas: 11, episodioAgendado: true } });

    const e = await naEmpresa(() => semana.estado(ORG, id.episodio, id.proponente));
    expect(e.pecas.find((x) => x.id === pecas.p00)?.etapa).toBe('ativo');
    expect(e.lotes).toEqual([expect.objectContaining({ id: loteId, estado: 'ativo', itens: 11, ativos: 11 })]);
    // Com a semana assinada, "Publicar agora" à parte é 409: o post sairia por dois caminhos.
    await expect(naEmpresa(() => publicacao.pedir(ORG, pecas.p00, id.proponente))).rejects.toThrow(/já sai pelo lote da semana/);
  });

  it('com a nota desligada, o lote ativo não publica nada no horário', async () => {
    vi.setSystemTime(SLOT('11:05'));
    nota = null;
    const passagem = await rotina('rotina-desligada');
    expect(passagem.length).toBeGreaterThan(0);
    expect(passagem.every((l) => l.detalhe === 'publicação automática desligada')).toBe(true);
    expect(graph.chamadas).toEqual([]);
  });

  it('editar uma peça depois de ativo revoga só o item dela; o conteúdo do lote a marca; o executor a pula', async () => {
    await naEmpresa(() => rotinas.editarPeca(ORG, pecas.p01, id.proponente, { status: 'rascunho' }));
    const itens = (await lotes.detalhe(ORG, loteId)).itens;
    expect(itens.filter((i) => i.estado === 'revogado').map((i) => i.recursoId)).toEqual([pecas.p01]);
    expect(itens.find((i) => i.recursoId === pecas.p01)?.motivoDaRevogacao).toMatch(/aprovada a rascunho/);
    expect((await lotes.detalhe(ORG, loteId)).estado).toBe('ativo');
    const c = await naEmpresa(() => semana.conteudo(ORG, loteId));
    expect(c.itens.find((i) => i.pecaId === pecas.p01)).toMatchObject({ estadoDoItem: 'revogado' });
  });

  it('com a nota ligada, o executor publica os posts no horário, até 3 por passagem, pela porta, um uso por item', async () => {
    nota = { body: '**ligada**', arquivadoEm: null };
    // 12h41: todos os slots de 11h a 12h40 passaram e estão dentro das 2 h.
    vi.setSystemTime(SLOT('12:41'));
    const passagens: string[][] = [];
    for (let i = 0; i < 6; i++) {
      const l = await rotina(`rotina-${i}`);
      if (!l.length) break;
      passagens.push(l.map((x) => x.resultado));
    }
    expect(passagens.map((p) => p.length)).toEqual([3, 3, 3, 1]);
    expect(passagens.flat().every((r) => r === 'publicada')).toBe(true);
    expect(publishes()).toBe(10);
    expect(graph.urlsRecusadas).toEqual([]);

    const publicadas = await prisma.pautaPeca.findMany({ where: { orgId: ORG, status: 'publicada' } });
    expect(publicadas).toHaveLength(10);
    expect(publicadas.every((p) => p.urlPublicada?.startsWith('https://www.instagram.com/p/') && p.publicadaPor === id.titular)).toBe(true);
    // A peça editada ficou de fora.
    expect((await prisma.pautaPeca.findUniqueOrThrow({ where: { id: pecas.p01 } })).status).toBe('rascunho');

    // O RASTRO: um consumo por item, com o aprovador do lote e o contador antes e depois.
    const resultados = await prisma.eventLog.findMany({ where: { orgId: ORG, tipo: 'tool.resultado', capabilityId: 'instagram.post.publicar' } });
    expect(resultados).toHaveLength(10);
    for (const ev of resultados) {
      expect(ev.payload).toMatchObject({ aprovador: id.titular, estadoAnterior: { usos: 0, usoMaximo: 1 }, estadoNovo: { usos: 1, usoMaximo: 1 } });
    }
    const consumidos = (await lotes.detalhe(ORG, loteId)).itens.filter((i) => i.estado === 'consumido');
    expect(consumidos).toHaveLength(10);
    expect((await lotes.detalhe(ORG, loteId)).estado).toBe('encerrado');
    const semana2 = await naEmpresa(() => semana.estado(ORG, id.episodio, id.proponente));
    expect(semana2.pecas.find((x) => x.id === pecas.p00)?.etapa).toBe('publicada');

    // A passagem seguinte não publica nada de novo.
    graph.zerar();
    await rotina('rotina-depois');
    expect(publishes()).toBe(0);
  });

  it('"Cancelar a semana" revoga o lote inteiro sem assinatura, e nada sai por ele', async () => {
    // A peça editada volta ao lote num lote novo, de um item, e a semana é cancelada antes do horário.
    vi.setSystemTime(INICIO);
    await prisma.pautaPeca.update({ where: { id: pecas.p01 }, data: { slotProposto: SLOT('15:00') } });
    const m = await naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, [pecas['sem-jpeg']]));
    expect(m.itens).toBe(1);
    await assinar(m.loteId);
    expect((await prisma.pautaPeca.findUniqueOrThrow({ where: { id: pecas.p01 } })).status).toBe('aprovada');

    const d = await naEmpresa(() => semana.cancelar(ORG, m.loteId, id.proponente));
    expect(d.estado).toBe('revogado');
    expect(d.itens.every((i) => i.estado === 'revogado')).toBe(true);
    nota = { body: 'ligada', arquivadoEm: null };
    vi.setSystemTime(SLOT('15:05'));
    const l = await rotina('rotina-cancelada');
    expect(l.map((x) => x.detalhe)).toEqual(['sem aprovação da semana']);
    expect(graph.chamadas).toEqual([]);
    expect(await prisma.auditLog.count({ where: { orgId: ORG, action: 'pauta.semana_cancelada' } })).toBe(1);
  });

  it('a peça editada depois de montada e antes da assinatura não é aprovada: o item cai na ativação e o resto vale', async () => {
    vi.setSystemTime(INICIO);
    const a = await novaPeca('tardia-a', 'story', SLOT('16:00'));
    const b = await novaPeca('tardia-b', 'story', SLOT('16:10'));
    // A p01, aprovada no lote cancelado, segue manual: fica fora deste.
    const m = await naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, [pecas['sem-jpeg'], pecas.p01]));
    expect(m.itens).toBe(2);
    await prisma.pautaPeca.update({ where: { id: b }, data: { corpo: 'Mudou depois de montar' } });
    const c = await naEmpresa(() => semana.conteudo(ORG, m.loteId));
    expect(c.divergentes).toBe(1);
    expect(c.itens.find((i) => i.pecaId === b)?.divergente).toMatch(/mudou depois/);

    await assinar(m.loteId);
    expect((await prisma.pautaPeca.findUniqueOrThrow({ where: { id: a } })).status).toBe('aprovada');
    expect((await prisma.pautaPeca.findUniqueOrThrow({ where: { id: b } })).status).toBe('rascunho');
    const itens = (await lotes.detalhe(ORG, m.loteId)).itens;
    expect(itens.find((i) => i.recursoId === b)).toMatchObject({ estado: 'revogado' });
    expect(itens.find((i) => i.recursoId === a)).toMatchObject({ estado: 'ativo' });
  });

  it('depois de ativo: trocar o JPEG, reagendar ou editar o texto revoga só o item daquela peça', async () => {
    vi.setSystemTime(INICIO);
    const midia = await novaPeca('troca-a', 'story', SLOT('17:00'));
    const hora = await novaPeca('troca-b', 'story', SLOT('17:10'));
    const texto = await novaPeca('troca-c', 'story', SLOT('17:20'));
    const fica = await novaPeca('troca-d', 'carrossel', SLOT('17:30'));
    const fora = Object.values(pecas).filter((x) => ![midia, hora, texto, fica].includes(x));
    const m = await naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, fora));
    expect(m.itens).toBe(4);
    await assinar(m.loteId);
    const estadoDe = async (pecaId: string) => (await lotes.detalhe(ORG, m.loteId)).itens.find((i) => i.recursoId === pecaId)?.estado;

    // O JPEG é o que a Meta baixa: trocado, a peça volta a rascunho, fora da agenda.
    await naEmpresa(() => derivacao.enviarImagem(ORG, fica, id.proponente, 1, { buffer: jpegDeTeste(1080, 1350), mimetype: 'image/jpeg' }));
    const p1 = await prisma.pautaPeca.findUniqueOrThrow({ where: { id: fica } });
    expect(p1).toMatchObject({ status: 'rascunho', agendadaPara: null });
    expect(await estadoDe(fica)).toBe('revogado');

    await naEmpresa(() => agenda.reagendar(ORG, hora, id.proponente, { agendadaPara: SLOT('18:10').toISOString() }));
    expect(await estadoDe(hora)).toBe('revogado');
    expect(await prisma.pautaPeca.findUniqueOrThrow({ where: { id: hora } })).toMatchObject({ status: 'aprovada' });

    await naEmpresa(() => derivacao.editar(ORG, texto, id.proponente, { texto: 'Texto novo depois da assinatura' }));
    expect(await estadoDe(texto)).toBe('revogado');
    expect(await prisma.pautaPeca.findUniqueOrThrow({ where: { id: texto } })).toMatchObject({ status: 'rascunho', agendadaPara: null });

    expect(await estadoDe(midia)).toBe('ativo');
    const rastro = await prisma.auditLog.findMany({ where: { orgId: ORG, action: 'lote.item_revogado', entityId: { in: [fica, hora, texto] } } });
    expect(rastro.map((r) => (r.after as { motivo: string }).motivo).sort()).toEqual(
      ['a peça foi reagendada', 'o JPEG 1 da peça foi trocado', 'o texto da peça foi editado'].sort(),
    );
  });

  // Do dia 2 em diante: as peças do dia 1 sem item ficam fora da janela da rotina; as com item ainda ativo, a primeira passagem dá por perdidas.
  const DIA2 = (hhmm: string) => instanteNoFuso('2026-09-02', hhmm);
  const todasMenos = (...ficam: string[]) => Object.values(pecas).filter((x) => !ficam.includes(x));

  async function aprovadaEm(chave: string, formato: 'carrossel' | 'story' | 'corte', slot: Date) {
    const pecaId = await novaPeca(chave, formato, slot);
    await prisma.pautaPeca.update({ where: { id: pecaId }, data: { status: 'aprovada', agendadaPara: slot, slotProposto: null } });
    return pecaId;
  }

  it('a peça que já tem publicação pelo OS entra no lote e sai no horário: o pedido vencido, a linha em erro, a que voltou ao manual e o "Publicar agora" pedido enquanto a assinatura esperava', async () => {
    // A tardia-a e a troca-a do dia 1 seguem com o item ativo e a janela passou há mais de 4 h: não ficam presas.
    vi.setSystemTime(DIA2('09:00'));
    nota = { body: 'ligada', arquivadoEm: null };
    const perdidas = await rotina('rotina-dia2-0');
    expect(perdidas.map((l) => [l.resultado, l.detalhe])).toEqual([
      ['erro', expect.stringMatching(/janela de 2 h/)],
      ['erro', expect.stringMatching(/janela de 2 h/)],
    ]);
    expect(graph.chamadas).toEqual([]);
    for (const pecaId of [pecas['tardia-a'], pecas['troca-a']]) {
      expect(await prisma.itemDoLote.findFirstOrThrow({ where: { recursoId: pecaId, capabilityId: 'instagram.post.publicar' }, orderBy: { criadoEm: 'desc' } })).toMatchObject({ estado: 'revogado' });
    }
    nota = null;
    const vencido = await aprovadaEm('venc-1', 'carrossel', DIA2('11:00'));
    const comErro = await aprovadaEm('erro-2', 'story', DIA2('11:10'));
    const manual = await aprovadaEm('manual-3', 'corte', DIA2('11:20'));
    const noMeio = await aprovadaEm('meio-4', 'carrossel', DIA2('11:30'));
    const dupA = await novaPeca('dup-a', 'story', DIA2('11:40'));
    const dupB = await novaPeca('dup-b', 'story', DIA2('11:40'));
    const antes = todasMenos(vencido, comErro, manual, noMeio, dupA, dupB);

    const r3 = (await naEmpresa(() => publicacao.pedir(ORG, vencido, id.proponente))) as AcaoRetida;
    expect(r3.status).toBe('aguardando_aprovacao');
    await prisma.pautaPublicacao.create({ data: { pecaId: comErro, rede: 'instagram', estado: 'erro', erro: 'A Meta recusou o container: teste' } });
    await prisma.pautaPublicacao.create({ data: { pecaId: manual, rede: 'instagram', estado: 'recusada', erro: 'de volta ao fluxo manual' } });

    // O "Publicar agora" vivo na fila e a segunda peça do mesmo formato no mesmo slot barram a montagem, e a aba já os mostra.
    const e = await naEmpresa(() => semana.estado(ORG, id.episodio, id.proponente));
    expect(e.pecas.find((x) => x.id === vencido)?.problema).toMatch(/Publicar agora.*esperando na fila/);
    expect(e.pecas.find((x) => x.id === dupA)?.problema).toBeNull();
    expect(e.pecas.find((x) => x.id === dupB)?.problema).toMatch(/mesmo formato nesse horário/);
    expect(e.pecas.find((x) => x.id === comErro)?.problema).toBeNull();
    expect(e.pecas.find((x) => x.id === manual)?.problema).toBeNull();
    await expect(naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, [...antes, dupA]))).rejects.toThrow(/Publicar agora.*esperando na fila/);
    await expect(naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, [...antes, vencido]))).rejects.toThrow(/mesmo formato nesse horário/);

    // O pedido venceu na fila: a peça entra.
    await prisma.approval.update({ where: { id: r3.approvalId }, data: { status: 'expirada', expiraEm: new Date(Date.now() - 1000) } });
    const m = await naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, [...antes, dupA, dupB]));
    expect(m.itens).toBe(4);
    const pedido = (await naEmpresa(() => assinatura.pedirAssinatura(ORG, m.loteId, id.proponente))) as AcaoRetida;
    // Com o lote só na fila, o "Publicar agora" ainda vale.
    const r3b = (await naEmpresa(() => publicacao.pedir(ORG, noMeio, id.proponente))) as AcaoRetida;
    expect(r3b.status).toBe('aguardando_aprovacao');
    await naEmpresa(() => approvals.confirm(ORG, pedido.approvalId, { id: id.titular, papeis: ['admin_master'], reauth: { senha: SENHA } }, 'conferi os quatro posts'));
    expect((await naEmpresa(() => acoes.executarAprovada(ORG, pedido.approvalId, id.titular))).status).toBe('executado');

    const ativado = await prisma.auditLog.findFirst({ where: { orgId: ORG, action: 'lote.ativado', entityId: m.loteId } });
    expect(ativado?.after).toMatchObject({ reacao: { pecasAprovadas: 4, publicacoesReabertas: 3 } });
    for (const pecaId of [vencido, comErro, manual]) {
      expect(await prisma.pautaPublicacao.findFirstOrThrow({ where: { pecaId } })).toMatchObject({ estado: 'pendente', approvalId: null, erro: null });
    }
    expect(await prisma.pautaPublicacao.findFirstOrThrow({ where: { pecaId: noMeio } })).toMatchObject({ estado: 'pendente', approvalId: r3b.approvalId });
    // A substituição não derruba o que já foi assinado.
    expect((await lotes.revogarLote(ORG, m.loteId, 'teste', id.proponente, ['proposta', 'aguardando'])).estado).toBe('ativo');

    // Três aprovadas à mão, antes dos itens do lote e sem item: são puladas e não ocupam as vagas da passagem.
    for (const [chave, hhmm] of [['mao-1', '10:50'], ['mao-2', '10:52'], ['mao-3', '10:54']] as const) await aprovadaEm(chave, 'story', DIA2(hhmm));

    nota = { body: 'ligada', arquivadoEm: null };
    vi.setSystemTime(DIA2('11:35'));
    const p1 = await rotina('rotina-dia2-1');
    expect(p1.filter((l) => l.resultado === 'pulada')).toHaveLength(3);
    expect(p1.filter((l) => l.resultado === 'publicada')).toHaveLength(3);
    const p2 = await rotina('rotina-dia2-2');
    expect(p2.filter((l) => l.resultado === 'publicada')).toHaveLength(1);
    expect(publishes()).toBe(4);
    for (const pecaId of [vencido, comErro, manual, noMeio]) {
      expect(await prisma.pautaPeca.findUniqueOrThrow({ where: { id: pecaId } })).toMatchObject({ status: 'publicada', publicadaPor: id.titular });
    }

    // O "Publicar agora" confirmado depois (dentro do prazo dele) acha a peça publicada: nenhum post a mais.
    vi.setSystemTime(DIA2('09:05'));
    await naEmpresa(() =>
      approvals.confirm(ORG, r3b.approvalId, { id: id.titular, papeis: ['admin_master'], reauth: { senha: SENHA } }, 'confirmo o post avulso também'),
    );
    const tarde = await naEmpresa(() => acoes.executarAprovada(ORG, r3b.approvalId, id.titular));
    expect(tarde.status).toBe('executado');
    expect(publishes()).toBe(4);
    expect(graph.publicados).toHaveLength(4);
  });

  it('com a rotina parada além do lote, a peça cai em erro uma vez, perde o item e o "Publicar agora" volta a valer', async () => {
    vi.setSystemTime(DIA2('12:00'));
    nota = null;
    const parada = await novaPeca('parada', 'carrossel', DIA2('13:00'));
    const m = await naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, todasMenos(parada)));
    expect(m.itens).toBe(1);
    await assinar(m.loteId);
    const item = (await lotes.detalhe(ORG, m.loteId)).itens[0];

    // 15h30: a janela (13h–15h) passou, e o lote, que valia até o fim dela, venceu junto.
    nota = { body: 'ligada', arquivadoEm: null };
    vi.setSystemTime(DIA2('15:30'));
    const l = await rotina('rotina-parada');
    expect(l).toEqual([expect.objectContaining({ resultado: 'erro', detalhe: expect.stringMatching(/janela de 2 h/) })]);
    expect(graph.chamadas).toEqual([]);
    expect(await prisma.pautaPublicacao.findFirstOrThrow({ where: { pecaId: parada } })).toMatchObject({ estado: 'erro', loteItemId: item.id });
    expect((await lotes.detalhe(ORG, m.loteId)).itens[0]).toMatchObject({ estado: 'revogado', motivoDaRevogacao: expect.stringMatching(/janela/) });

    expect(await rotina('rotina-parada-2')).toEqual([]);
    const r = (await naEmpresa(() => publicacao.pedir(ORG, parada, id.proponente))) as AcaoRetida;
    expect(r.status).toBe('aguardando_aprovacao');
  });

  it('o slot que passou há mais de 4 h, com o lote ainda valendo por outra peça, cai em erro e perde o item em vez de ficar preso', async () => {
    const DIA3 = (hhmm: string) => instanteNoFuso('2026-09-03', hhmm);
    vi.setSystemTime(DIA3('06:00'));
    nota = null;
    const longe = await novaPeca('longe-c', 'story', DIA3('09:00'));
    const depois = await novaPeca('depois-d', 'story', DIA3('20:00'));
    const m = await naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, todasMenos(longe, depois)));
    expect(m.itens).toBe(2);
    await assinar(m.loteId);
    const itemDe = async (pecaId: string) => (await lotes.detalhe(ORG, m.loteId)).itens.find((i) => i.recursoId === pecaId)!;

    // A API ficou sem tique das 08h30 às 13h30: às 13h31 o slot das 09h está a 4,5 h, e o lote vale até as 22h.
    nota = { body: 'ligada', arquivadoEm: null };
    vi.setSystemTime(DIA3('13:31'));
    const l = await rotina('rotina-longe');
    expect(l).toEqual([expect.objectContaining({ resultado: 'erro', detalhe: expect.stringMatching(/janela de 2 h/) })]);
    expect(graph.chamadas).toEqual([]);
    expect(await prisma.pautaPublicacao.findFirstOrThrow({ where: { pecaId: longe } })).toMatchObject({ estado: 'erro' });
    expect(await itemDe(longe)).toMatchObject({ estado: 'revogado', motivoDaRevogacao: expect.stringMatching(/janela/) });
    expect(await itemDe(depois)).toMatchObject({ estado: 'ativo' });

    const r = (await naEmpresa(() => publicacao.pedir(ORG, longe, id.proponente))) as AcaoRetida;
    expect(r.status).toBe('aguardando_aprovacao');
  });

  it('o lote montado e não assinado não tira a aprovada da agenda: trocar o JPEG só revoga o item; e a aba reconfere a peça do lote na fila', async () => {
    vi.setSystemTime(DIA2('16:00'));
    nota = null;
    const naFila = await aprovadaEm('na-fila', 'carrossel', DIA2('18:00'));
    const m = await naEmpresa(() => semana.preparar(ORG, id.episodio, id.proponente, todasMenos(naFila)));
    await naEmpresa(() => assinatura.pedirAssinatura(ORG, m.loteId, id.proponente));

    // O slot passou enquanto a assinatura esperava: a aba diz, em vez de deixar o botão como se nada fosse.
    vi.setSystemTime(DIA2('18:30'));
    const e = await naEmpresa(() => semana.estado(ORG, id.episodio, id.proponente));
    expect(e.pecas.find((x) => x.id === naFila)).toMatchObject({ etapa: 'aguardando', problema: expect.stringMatching(/já passou/) });

    await naEmpresa(() => derivacao.enviarImagem(ORG, naFila, id.proponente, 1, { buffer: jpegDeTeste(1080, 1350), mimetype: 'image/jpeg' }));
    const p = await prisma.pautaPeca.findUniqueOrThrow({ where: { id: naFila } });
    expect(p.status).toBe('aprovada');
    expect(p.agendadaPara?.toISOString()).toBe(DIA2('18:00').toISOString());
    expect((await lotes.detalhe(ORG, m.loteId)).itens[0]).toMatchObject({ estado: 'revogado', motivoDaRevogacao: 'o JPEG 1 da peça foi trocado' });
  });
});

// Os valores do fuso: a gravação é em UTC e a exibição em São Paulo (risco da MD8).
describe('MD8: o horário do lote', () => {
  it('o slot das 11h de São Paulo é gravado 14h UTC, e a janela termina 16h UTC', () => {
    const slot = instanteNoFuso('2026-09-01', '11:00');
    expect(slot.toISOString()).toBe('2026-09-01T14:00:00.000Z');
    expect(janelaDoItem(slot).janelaAte.toISOString()).toBe('2026-09-01T16:00:00.000Z');
  });
});
