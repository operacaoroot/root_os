import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ConflictException } from '@nestjs/common';
import {
  PAUTA_TETO_DA_TRANSCRICAO,
  PAUTA_TETO_DE_SEGMENTOS,
  PAUTA_TETO_DO_CORPO_DA_MIDIA,
  PautaTranscricaoSchema,
  type PautaItemCurado,
} from '@mktos/shared';
import {
  ehLinkPrivado,
  ehUrlDeCaixaDeEntrada,
  linkPublicoDoItem,
  semLinksDeCaixaDeEntrada,
} from '../src/pauta/link-publico';
import {
  candidatoDaCaptura,
  corpoDaCuradoria,
  destinoDosItens,
  entradaDasPecas,
  lerCandidatos,
} from '../src/pauta/curadoria-da-rodada';
import { comOrigem, linhaDoInsumo, umaPorMateriaDoInsumo } from '../src/pauta/origem-da-rodada';
import { RotinaService } from '../src/pauta/rotina.service';
import { itensMantidos } from '../src/pauta/episodio';
import { entradaDoRoteiro, montarRoteiro, ordemDoRoteiro, lerRoteiroDaIa } from '../src/pauta/roteiro-do-episodio';
import { entradaDoPacote, linksDaDescricao, montarPacote } from '../src/pauta/pacote-do-episodio';
import { planoDaPagina } from '../src/pauta/pagina-de-links-do-episodio';
import { entradaDaNewsletter, montarNewsletter } from '../src/pauta/newsletter-do-episodio';
import { SAIDA_DA_GERACAO_LONGA } from '../src/pauta/saida-da-geracao';
import { MSG_EM_ANDAMENTO, umaPorVez } from '../src/pauta/uma-por-vez';
import { PublicacaoService } from '../src/pauta/publicacao.service';
import { RodadaService } from '../src/pauta/rodada.service';
import { VozService } from '../src/pauta/voz.service';
import { AuditService } from '../src/audit/audit.service';
import { OpenAiProvider } from '../src/llm/openai.provider';
import { OpenRouterProvider } from '../src/llm/openrouter.provider';
import { AnthropicProvider } from '../src/llm/anthropic.provider';
import { ProviderComTeto } from '../src/llm/provider-com-teto';
import {
  TETO_MAXIMO_DE_SAIDA_DA_RESPOSTA,
  saidaDaResposta,
  type LlmMessage,
  type LlmProvider,
} from '../src/llm/llm.provider';
import type { TetoDeCustoIaService } from '../src/llm/teto-diario.service';
import { ROTAS_DE_MIDIA_DO_EPISODIO, instalarCorpoDaMidia } from '../src/common/corpo-da-midia';
import { TETO_DO_CORPO } from '../../../tools/root-midia/lib/os.mjs';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { EvolutionService } from '../src/pauta/evolution.service';
import type { ClickupService } from '../src/integrations/clickup.service';
import type { MemoriaService } from '../src/memory/memoria.service';

/*
 * MC-R — os três consertos de robustez achados nas ondas A e B:
 *   1. o permalink do Gmail de uma newsletter antiga, sem a marca, não sai por
 *      caminho nenhum (regra única em `pauta/link-publico.ts`);
 *   2. `complete()` aceita um teto de saída maior por chamada, com limite, e as
 *      gerações longas da pauta o pedem; as outras chamadas não mudam;
 *   3. só as rotas de mídia do episódio aceitam corpo de até 2 MB.
 */

const ORG = '7c0f0a8e-4444-4a5a-9c1e-00000000mcr1';
const PESSOA = 'b1d2c3e4-0000-4000-8000-0000000000r1';

// ---------------------------------------------------------------------------
// 1. O link privado da newsletter
// ---------------------------------------------------------------------------

const PERMALINK = 'https://mail.google.com/mail/u/0/#all/18f0aa11bb22';
const PERMALINK_2 = 'https://mail.google.com/mail/u/0/#all/18f0cc33dd44';
const PUBLICO = 'https://noticia.exemplo/preco-caiu';

/** Captura L de antes da marca e sem a fonte (apagada): nem origem, nem `semLinkPublico`. */
const L_ANTIGA_SEM_ORIGEM: PautaItemCurado = {
  titulo: 'Newsletter antiga sem fonte',
  url: PERMALINK,
  fonte: 'The Rundown',
  resumo: 'O resumo que a newsletter trouxe.',
};
/** Newsletter com a letra da origem, mas sem a marca. */
const L_ANTIGA_COM_ORIGEM: PautaItemCurado = {
  titulo: 'Newsletter antiga com origem',
  url: PERMALINK_2,
  origem: 'L',
  porque: 'Mudou o preço.',
};
const ITEM_PUBLICO: PautaItemCurado = {
  titulo: 'Preço do modelo caiu',
  url: PUBLICO,
  origem: 'N',
  resumo: 'Caiu pela metade.',
};
const ITENS = [L_ANTIGA_SEM_ORIGEM, L_ANTIGA_COM_ORIGEM, ITEM_PUBLICO];

function semGmail(texto: string) {
  expect(texto).not.toContain('mail.google.com');
}

describe('MC-R 1: a regra única do link público', () => {
  it('barra pela marca, pela origem (em qualquer das origens) e pelo host — cada um basta', () => {
    expect(linkPublicoDoItem({ url: PUBLICO })).toBe(PUBLICO);
    expect(linkPublicoDoItem({ url: PUBLICO, semLinkPublico: true })).toBeNull();
    expect(linkPublicoDoItem({ url: PUBLICO, origem: 'L' })).toBeNull();
    expect(linkPublicoDoItem({ url: PUBLICO, origem: 'W', origens: ['W', 'L'] })).toBeNull();
    expect(linkPublicoDoItem({ url: PERMALINK })).toBeNull();
    expect(linkPublicoDoItem({ url: PERMALINK, origem: 'N', semLinkPublico: false })).toBeNull();
    expect(linkPublicoDoItem({ url: 'HTTPS://MAIL.GOOGLE.COM./mail/u/0/#all/x' })).toBeNull();
    expect(linkPublicoDoItem({ url: 'https://outlook.office365.com/mail/id/x' })).toBeNull();
    expect(linkPublicoDoItem({ url: 'https://u.mail.yahoo.com/d/x' })).toBeNull();
    expect(linkPublicoDoItem({ url: 'javascript:alert(1)' })).toBeNull();
    expect(linkPublicoDoItem({ url: 'https://a.exemplo/<b>' })).toBeNull();
    expect(linkPublicoDoItem({ url: '' })).toBeNull();
    // Parecido não é igual: o host tem de ser o da caixa, não um que termina com o nome.
    expect(linkPublicoDoItem({ url: 'https://notmail.google.com.exemplo/x' })).toBe('https://notmail.google.com.exemplo/x');
    expect(ehUrlDeCaixaDeEntrada('não é url')).toBe(false);
    expect(ehLinkPrivado({ url: PUBLICO, origem: 'W' })).toBe(false);
  });

  it('o texto perde só o endereço de caixa de entrada, e o "()" que sobraria some', () => {
    expect(semLinksDeCaixaDeEntrada(`Veja ${PUBLICO} e (${PERMALINK}) e <${PERMALINK_2}>.`)).toBe(`Veja ${PUBLICO} e e.`);
    expect(semLinksDeCaixaDeEntrada(`Só ${PUBLICO} (fonte)`)).toBe(`Só ${PUBLICO} (fonte)`);
  });

  it('o link colado em marca do WhatsApp ou em letra também sai, e a marca vai junto', () => {
    expect(semLinksDeCaixaDeEntrada(`Leia _${PERMALINK}_ hoje`)).toBe('Leia hoje');
    expect(semLinksDeCaixaDeEntrada(`Leia *${PERMALINK}*.`)).toBe('Leia.');
    expect(semLinksDeCaixaDeEntrada(`~${PERMALINK}~`)).toBe('');
    expect(semLinksDeCaixaDeEntrada(`x${PERMALINK}`)).toBe('x');
    expect(semLinksDeCaixaDeEntrada(`fim ${PERMALINK}.`)).toBe('fim.');
    expect(semLinksDeCaixaDeEntrada(`Veja _${PUBLICO}_`)).toBe(`Veja _${PUBLICO}_`);
  });

  it('o "()" que não era do link fica, e o parêntese do link sai só quando embrulha ele', () => {
    expect(semLinksDeCaixaDeEntrada(`Chame foo() e leia ${PERMALINK}`)).toBe('Chame foo() e leia');
    expect(semLinksDeCaixaDeEntrada(`Chame foo() e leia (${PERMALINK})`)).toBe('Chame foo() e leia');
    expect(semLinksDeCaixaDeEntrada(`Veja (fonte: ${PERMALINK})`)).toBe('Veja (fonte:)');
    expect(semLinksDeCaixaDeEntrada(`( ${PERMALINK} ) segue`)).toBe(' segue');
  });

  it('o corpo gigante de espaços não trava o event loop (a varredura é linear)', () => {
    const espacos = ' '.repeat(100_000);
    const t0 = performance.now();
    expect(semLinksDeCaixaDeEntrada(`${espacos}fim`)).toBe(`${espacos}fim`);
    expect(semLinksDeCaixaDeEntrada(`${espacos}${PERMALINK}${espacos}`)).toBe(espacos);
    expect(semLinksDeCaixaDeEntrada('*'.repeat(100_000))).toHaveLength(100_000);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('o destino da peça no WhatsApp é o primeiro link público, nunca o permalink', () => {
    expect(destinoDosItens(ITENS)).toBe(PUBLICO);
    expect(destinoDosItens([L_ANTIGA_SEM_ORIGEM, L_ANTIGA_COM_ORIGEM])).toBeNull();
  });

  it('a mensagem que vai ao grupo não leva o permalink — nem no link, nem colado no corpo', async () => {
    const enviados: string[] = [];
    const auditoria: Array<Record<string, unknown>> = [];
    const prisma = {
      pautaPeca: {
        findFirst: async () => ({
          id: 'p1', orgId: ORG, canal: 'whatsapp', status: 'rascunho', titulo: 't',
          corpo: `A semana em 3 notícias. Leia: ${PERMALINK}`,
          rodada: { titulo: 'Semana 39', itens: [L_ANTIGA_SEM_ORIGEM, L_ANTIGA_COM_ORIGEM], episodio: null },
        }),
        update: async ({ data }: { data: Record<string, unknown> }) => ({ externalId: 'msg1', ...data }),
      },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => void auditoria.push(data) },
    } as unknown as PrismaService;
    const evolution = {
      estado: async () => ({ conectada: true }),
      grupo: 'grupo@g.us',
      enviarTexto: async (_jid: string, texto: string) => {
        enviados.push(texto);
        return { id: 'msg1' };
      },
    } as unknown as EvolutionService;
    const s = new PublicacaoService(prisma, new AuditService(prisma), evolution, {} as ClickupService);
    await s.publicar(ORG, 'p1', PESSOA);
    expect(enviados).toHaveLength(1);
    semGmail(enviados[0]);
    expect(enviados[0]).toBe('A semana em 3 notícias. Leia:');
    expect(auditoria[0].after).toMatchObject({ rastreio: 'sem_link', bioLinkId: null });
  });

  it('a página de links (MC12) não monta botão com o permalink e conta as duas como privadas', () => {
    const plano = planoDaPagina(ITENS, []);
    expect(plano.links.map((l) => l.destino)).toEqual([PUBLICO]);
    expect(plano.materias).toBe(1);
    expect(plano.avisos.join(' ')).toMatch(/^2 matéria/);
  });

  it('a descrição do YouTube (MC11) e o pedido do pacote não levam o permalink', () => {
    expect(linksDaDescricao(ITENS).map((l) => l.url)).toEqual([PUBLICO]);
    const segmentos = [{ inicio: 0, fim: 30, texto: 'O preço do modelo caiu pela metade.' }];
    semGmail(entradaDoPacote({ apelido: 'ep-01', titulo: 'T', itens: ITENS, segmentos, duracaoSeg: 600 }));
    const pacote = montarPacote(
      JSON.stringify({
        titulos: [
          { texto: 'O preço da IA caiu pela metade e muda o caixa', angulo: 'resultado' },
          { texto: 'Três notícias de IA para usar amanhã na empresa', angulo: 'lista' },
          { texto: 'A notícia da semana que mexe no custo de quem vende', angulo: 'curiosidade' },
        ],
        abertura: `Neste episódio. ${PERMALINK}`,
        capitulos: [],
        thumbs: [],
        hashtags: [],
      }),
      { itens: ITENS, segmentos, duracaoSeg: 600 },
    );
    semGmail(pacote.descricao);
    expect(pacote.links).toBe(1);
  });

  it('a newsletter (MC13) cita só a fonte pública', () => {
    const segmentos = [{ inicio: 0, fim: 30, texto: 'O preço do modelo caiu pela metade e isso muda a conta.' }];
    semGmail(entradaDaNewsletter({ apelido: 'ep-01', titulo: 'T', itens: ITENS, segmentos }));
    const n = montarNewsletter(
      JSON.stringify({
        titulo: 'A semana',
        abertura: 'Abertura.',
        secoes: [1, 2, 3].map((k) => ({ n: k, titulo: `S${k}`, texto: 'O preço do modelo caiu pela metade e isso muda a conta.' })),
        fechamento: 'Até.',
      }),
      { tituloDoEpisodio: 'T', itens: ITENS, segmentos },
    );
    semGmail(n.markdown);
    expect(n.links).toBe(1);
  });

  it('o roteiro (MC8) — o pedido ao modelo e o markdown montado — não leva o permalink', () => {
    const entrada = entradaDoRoteiro({ apelido: 'ep-01', titulo: 'T', itens: ITENS });
    semGmail(entrada);
    expect(entrada).toContain('sem link público (fonte: The Rundown)');
    const daIa = lerRoteiroDaIa(
      JSON.stringify({
        abertura: 'Abre.',
        materias: [1, 2, 3].map((n) => ({ n, titulo: `M${n}`, resumo: 'r', naTela: '', gancho: 'g' })),
        fechamento: 'Fecha.',
      }),
      ITENS.length,
    );
    const md = montarRoteiro({
      apelido: 'ep-01',
      titulo: 'T',
      palavraDeCorte: 'root, corta',
      abertura: daIa.abertura,
      blocos: ordemDoRoteiro(daIa, ITENS),
      fechamento: daIa.fechamento,
    });
    semGmail(md);
    expect(md).toContain(`- **Link:** ${PUBLICO}`);
  });

  it('o miolo da curadoria e o pedido que deriva as peças não levam o permalink, nem o do miolo antigo', () => {
    const corpo = corpoDaCuradoria(ITENS);
    semGmail(corpo);
    expect(corpo).toContain(`(${PUBLICO})`);
    const entrada = entradaDasPecas({
      titulo: 'Semana 39',
      corpo: `- **Newsletter antiga** (${PERMALINK}): gravado antes do MC-R`,
      itens: ITENS,
      repertorio: '(acervo vazio)',
    });
    semGmail(entrada);
    expect(entrada).toContain(`- Preço do modelo caiu — ${PUBLICO}`);
    expect(entrada).toContain('- Newsletter antiga sem fonte (newsletter, sem link público)');
  });

  it('a derivação das peças pelo serviço manda ao modelo o pedido sem permalink e com o teto longo', async () => {
    const chamadas: LlmMessage[] = [];
    const llm = {
      name: 'dublê', model: 'd', configured: true, supportsTools: false,
      complete: async (m: LlmMessage) => {
        chamadas.push(m);
        return JSON.stringify({ whatsapp: { titulo: 'W', corpo: 'Caiu. Bora?' } });
      },
    } as unknown as LlmProvider;
    const prisma = {
      pautaRodada: {
        findFirst: async () => ({
          id: 'r1', orgId: ORG, status: 'curada', titulo: 'Semana 39',
          corpo: `Miolo antigo com ${PERMALINK}`, itens: ITENS, fichasUsadas: [], pecas: [],
        }),
      },
      pautaReferencia: { findMany: async () => [] },
      pautaPeca: { create: async () => ({}) },
      auditLog: { create: async () => ({}) },
    } as unknown as PrismaService;
    const memoria = { porChave: async () => null } as unknown as MemoriaService;
    const vozes = new VozService(prisma, new AuditService(prisma), llm, memoria);
    await new RodadaService(prisma, new AuditService(prisma), {} as never, llm, vozes).derivar(ORG, 'r1', PESSOA);
    expect(chamadas).toHaveLength(1);
    semGmail(chamadas[0].user);
    expect(chamadas[0].maxTokens).toBe(SAIDA_DA_GERACAO_LONGA);
    expect(chamadas[0].orgId).toBe(ORG);
  });

  it('no pedido das peças, só o item privado se chama newsletter; o do grupo sem URL é "sem link"', () => {
    const entrada = entradaDasPecas({
      titulo: 'Semana 39',
      corpo: '',
      itens: [
        { titulo: 'Mensagem do grupo', url: '', origem: 'W' },
        { titulo: 'URL torta', url: 'noticia sem esquema', origem: 'N' },
        L_ANTIGA_COM_ORIGEM,
      ],
      repertorio: '',
    });
    expect(entrada).toContain('- Mensagem do grupo (sem link)');
    expect(entrada).toContain('- URL torta (sem link)');
    expect(entrada).toContain('- Newsletter antiga com origem (newsletter, sem link público)');
  });

  it('o ClickUp e o carrossel do Instagram recebem o corpo sem o permalink', async () => {
    const descricoes: string[] = [];
    const corpo = `A semana. Leia: ${PERMALINK}`;
    const prisma = {
      pautaPeca: {
        findFirst: async ({ where }: { where: { id: string } }) =>
          where.id === 'ig'
            ? { id: 'ig', orgId: ORG, canal: 'instagram', titulo: 't', corpo, meta: { slides: [{ titulo: 'S1', texto: `Fonte: _${PERMALINK}_` }] } }
            : { id: 'cu', orgId: ORG, canal: 'clickup', status: 'rascunho', titulo: 't', corpo, rodada: { titulo: 'S', itens: [], episodio: null } },
        update: async () => ({}),
      },
      auditLog: { create: async () => ({}) },
    } as unknown as PrismaService;
    const clickup = {
      criarTarefa: async ({ descricao }: { descricao: string }) => {
        descricoes.push(descricao);
        return { id: 'T1', url: 'https://app.clickup.exemplo/t/T1' };
      },
    } as unknown as ClickupService;
    const s = new PublicacaoService(prisma, new AuditService(prisma), {} as EvolutionService, clickup);
    await s.publicar(ORG, 'cu', PESSOA);
    expect(descricoes).toEqual(['A semana. Leia:']);
    const pacote = await s.exportarCarrossel(ORG, 'ig');
    expect(pacote.legenda).toBe('A semana. Leia:');
    expect(pacote.slides[0].texto).toBe('Fonte:');
  });

  it('a tela da curadoria (GET da rodada) já recebe o candidato antigo com a marca', async () => {
    const rodada = (status: string, itens: unknown[]) => ({
      id: 'r1', titulo: 'S', status, rotina: null, corpo: '', itens, fichasUsadas: [], provider: null, model: null,
      erro: null, janelaIni: new Date(0), janelaFim: new Date(0), criadaEm: new Date(0), pecas: [], episodio: null,
    });
    let atual = rodada('aguardando_curadoria', [{ id: 'c1', titulo: 'Antigo', url: PERMALINK, sugerido: false, marcado: false }]);
    const prisma = { pautaRodada: { findFirst: async () => atual } } as unknown as PrismaService;
    const rotinas = new RotinaService(prisma, new AuditService(prisma), {} as RodadaService);
    const emCuradoria = await rotinas.obterRodada(ORG, 'r1');
    expect(emCuradoria.itens[0]).toMatchObject({ id: 'c1', semLinkPublico: true });
    // Fora da curadoria os itens não são candidatos (não têm id) e seguem como foram gravados.
    atual = rodada('curada', [ITEM_PUBLICO]);
    expect((await rotinas.obterRodada(ORG, 'r1')).itens).toEqual([ITEM_PUBLICO]);
  });

  it('duas newsletters sem fonte (fonte apagada) não se fundem numa só matéria', () => {
    const capturas = [
      { titulo: 'N1', url: PERMALINK, bruto: {}, fonte: null },
      { titulo: 'N2', url: PERMALINK_2, bruto: {}, fonte: null },
      { titulo: 'N1 de novo', url: PERMALINK, bruto: {}, fonte: null },
    ];
    expect(umaPorMateriaDoInsumo(capturas).map((c) => c.titulo)).toEqual(['N1', 'N2']);
  });

  it('o episódio recebe o item antigo sem o link e com a marca regravada', () => {
    const r = itensMantidos(ITENS);
    expect(r[0]).toMatchObject({ url: '', semLinkPublico: true });
    expect(r[1]).toMatchObject({ url: '', semLinkPublico: true });
    expect(r[2]).toEqual(ITEM_PUBLICO);
  });

  it('na entrada da rodada: a captura sem fonte com permalink nasce marcada, fica sem URL no prompt e não é escolhida', () => {
    const captura = { id: 'c1', titulo: 'Sem fonte', url: PERMALINK, nota: null, bruto: {}, fonte: null };
    expect(candidatoDaCaptura(captura).semLinkPublico).toBe(true);
    semGmail(linhaDoInsumo(captura, 1));
    const publica = { id: 'c2', titulo: 'Pública', url: PUBLICO, nota: null, bruto: {}, fonte: null };
    expect(comOrigem([{ titulo: 'Sem fonte', url: PERMALINK }, { titulo: 'Pública', url: PUBLICO }], [captura, publica])).toEqual([
      { titulo: 'Pública', url: PUBLICO },
    ]);
  });

  it('o candidato gravado sem a marca ganha a marca na leitura (a tela mostra "só contexto")', () => {
    const [c] = lerCandidatos([{ id: 'c1', titulo: 'Antigo', url: PERMALINK, sugerido: false, marcado: true }]);
    expect(c.semLinkPublico).toBe(true);
    const [p] = lerCandidatos([{ id: 'c2', titulo: 'Público', url: PUBLICO }]);
    expect(p).not.toHaveProperty('semLinkPublico');
  });
});

// ---------------------------------------------------------------------------
// 2. O teto de saída por chamada
// ---------------------------------------------------------------------------

describe('MC-R 2: o teto de saída de complete()', () => {
  const ambiente = { ...process.env };
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MAX_TOKENS']) {
      if (ambiente[k] === undefined) delete process.env[k];
      else process.env[k] = ambiente[k];
    }
  });

  function fetchQueGrava() {
    const corpos: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      corpos.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    });
    return corpos;
  }

  it('saidaDaResposta só sobe o padrão, para no teto máximo e ignora pedido inválido', () => {
    expect(saidaDaResposta(900, undefined)).toBe(900);
    expect(saidaDaResposta(900, 8000)).toBe(8000);
    expect(saidaDaResposta(900, 300)).toBe(900);
    expect(saidaDaResposta(900, 1_000_000)).toBe(TETO_MAXIMO_DE_SAIDA_DA_RESPOSTA);
    expect(saidaDaResposta(900, 8000.9)).toBe(8000);
    for (const ruim of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(saidaDaResposta(900, ruim)).toBe(900);
    expect(saidaDaResposta(32_000, 8000)).toBe(32_000);
  });

  it('OpenAI: sem pedido continua 900; com pedido manda o maior, limitado, e o teto do custo diz o mesmo', async () => {
    process.env.OPENAI_API_KEY = 'sk-teste';
    const corpos = fetchQueGrava();
    const p = new OpenAiProvider();
    await p.complete({ system: 's', user: 'u' });
    await p.complete({ system: 's', user: 'u', maxTokens: SAIDA_DA_GERACAO_LONGA });
    await p.complete({ system: 's', user: 'u', maxTokens: 10_000_000 });
    expect(corpos.map((c) => c.max_tokens)).toEqual([900, SAIDA_DA_GERACAO_LONGA, TETO_MAXIMO_DE_SAIDA_DA_RESPOSTA]);
    expect(corpos[0]).toMatchObject({ temperature: 0.3 });
    expect(p.tetoDeSaida({ tipo: 'completa' })).toBe(900);
    expect(p.tetoDeSaida({ tipo: 'completa', maxTokens: SAIDA_DA_GERACAO_LONGA })).toBe(SAIDA_DA_GERACAO_LONGA);
    expect(p.tetoDeSaida({ tipo: 'passo', streaming: false })).toBe(4000);
  });

  it('OpenRouter herda a mesma regra', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-teste';
    const corpos = fetchQueGrava();
    const p = new OpenRouterProvider();
    await p.complete({ system: 's', user: 'u' });
    await p.complete({ system: 's', user: 'u', maxTokens: SAIDA_DA_GERACAO_LONGA });
    expect(corpos.map((c) => c.max_tokens)).toEqual([900, SAIDA_DA_GERACAO_LONGA]);
  });

  function anthropicQueGrava() {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-teste';
    const p = new AnthropicProvider();
    const pedidos: Array<Record<string, unknown>> = [];
    (p as unknown as { client: unknown }).client = {
      beta: {
        messages: {
          create: async (req: Record<string, unknown>) => {
            pedidos.push(req);
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
          },
        },
      },
    };
    return { p, pedidos };
  }

  it('Anthropic: o padrão de 16000 não muda com o pedido longo, e nenhum parâmetro que dá 400 entra', async () => {
    delete process.env.ANTHROPIC_MAX_TOKENS;
    const { p, pedidos } = anthropicQueGrava();
    await p.complete({ system: 's', user: 'u' });
    await p.complete({ system: 's', user: 'u', maxTokens: SAIDA_DA_GERACAO_LONGA });
    expect(pedidos.map((r) => r.max_tokens)).toEqual([16000, 16000]);
    for (const r of pedidos) {
      for (const proibido of ['temperature', 'top_p', 'top_k']) expect(r).not.toHaveProperty(proibido);
      expect(r.thinking).toEqual({ type: 'adaptive' });
    }
  });

  it('Anthropic com o padrão baixado no ambiente: o pedido longo sobe, limitado ao teto máximo', async () => {
    process.env.ANTHROPIC_MAX_TOKENS = '4000';
    const { p, pedidos } = anthropicQueGrava();
    await p.complete({ system: 's', user: 'u' });
    await p.complete({ system: 's', user: 'u', maxTokens: SAIDA_DA_GERACAO_LONGA });
    await p.complete({ system: 's', user: 'u', maxTokens: 50_000 });
    expect(pedidos.map((r) => r.max_tokens)).toEqual([4000, SAIDA_DA_GERACAO_LONGA, TETO_MAXIMO_DE_SAIDA_DA_RESPOSTA]);
  });

  it('o envelope do teto de custo reserva pelo teto que a chamada pediu, e repassa o pedido', async () => {
    const reservas: Array<{ tokensSaida: number }> = [];
    const teto = {
      reservar: async (r: { orgId: string; modelo: string; tokensSaida: number }) => {
        reservas.push(r);
        return { orgId: r.orgId, modelo: r.modelo, valorUsd: 0.01, dia: '2026-09-24' };
      },
      liquidarPeloObservado: async () => undefined,
      soltar: async () => undefined,
    } as unknown as TetoDeCustoIaService;
    const recebidos: LlmMessage[] = [];
    const interno = {
      name: 'openai', model: 'gpt-4o', configured: true, supportsTools: true,
      complete: async (m: LlmMessage) => {
        recebidos.push(m);
        return 'ok';
      },
      step: async () => {
        throw new Error('não usado');
      },
      tetoDeSaida: (c: { tipo: string; maxTokens?: number }) => (c.tipo === 'completa' ? saidaDaResposta(900, c.maxTokens) : 4000),
    } as unknown as LlmProvider;
    const p = new ProviderComTeto(interno, teto);
    await p.complete({ system: 's', user: 'u', orgId: ORG });
    await p.complete({ system: 's', user: 'u', orgId: ORG, maxTokens: SAIDA_DA_GERACAO_LONGA });
    expect(reservas.map((r) => r.tokensSaida)).toEqual([900, SAIDA_DA_GERACAO_LONGA]);
    expect(recebidos.map((m) => m.maxTokens)).toEqual([undefined, SAIDA_DA_GERACAO_LONGA]);
  });
});

// ---------------------------------------------------------------------------
// 3. O corpo das rotas de mídia do episódio
// ---------------------------------------------------------------------------

describe('MC-R 3: o corpo grande só nas rotas de mídia', () => {
  let servidor: Server;
  let base = '';
  let parserPadraoInstalado = false;

  beforeAll(async () => {
    // Na ordem do Nest: o `main.ts` instala antes do `listen`, e o `init`
    // instala o parser padrão depois, se não achar um `jsonParser` na pilha.
    const adapter = new ExpressAdapter();
    instalarCorpoDaMidia(adapter, 'api');
    parserPadraoInstalado = !(adapter as unknown as { isMiddlewareApplied(nome: string): boolean }).isMiddlewareApplied('jsonParser');
    adapter.registerParserMiddleware();
    const app = adapter.getInstance();
    const eco = (req: { body: unknown }, res: { json: (v: unknown) => void }) =>
      res.json({ bytes: Buffer.byteLength(JSON.stringify(req.body ?? null)) });
    app.post('/api/pauta/episodios/:id/transcricao', eco);
    app.post('/api/pauta/episodios/:id/midia', eco);
    app.post('/api/pauta/episodios/:id/roteiro/gerar', eco);
    app.post('/api/pauta/voz/aprender', eco);
    servidor = app.listen(0, '127.0.0.1');
    await new Promise((r) => servidor.once('listening', r));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => servidor.close(r));
  });

  const corpoDe = (kb: number) => JSON.stringify({ segmentos: [{ inicio: 0, fim: 1, texto: 'x'.repeat(kb * 1024) }] });
  const postar = (rota: string, corpo: string) =>
    fetch(`${base}${rota}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: corpo });

  it('o parser grande não se passa pelo padrão: o Nest continua instalando o dele para a API inteira', () => {
    expect(parserPadraoInstalado).toBe(true);
    expect([...ROTAS_DE_MIDIA_DO_EPISODIO]).toEqual(['/pauta/episodios/:id/midia', '/pauta/episodios/:id/transcricao']);
  });

  it('a transcrição e a mídia aceitam 500 kB (mais de 40 min de fala); acima de 2 MB é 413', async () => {
    const r1 = await postar('/api/pauta/episodios/e1/transcricao', corpoDe(500));
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { bytes: number }).bytes).toBeGreaterThan(500 * 1024);
    expect((await postar('/api/pauta/episodios/e1/midia', corpoDe(500))).status).toBe(200);
    expect((await postar('/api/pauta/episodios/e1/transcricao', corpoDe(2100))).status).toBe(413);
  });

  it('as outras rotas seguem nos 100 kb do padrão — inclusive as vizinhas do episódio — e continuam lendo JSON', async () => {
    expect((await postar('/api/pauta/episodios/e1/roteiro/gerar', corpoDe(500))).status).toBe(413);
    expect((await postar('/api/pauta/voz/aprender', corpoDe(150))).status).toBe(413);
    const pequeno = await postar('/api/pauta/voz/aprender', JSON.stringify({ a: 1 }));
    expect(pequeno.status).toBe(200);
    expect(((await pequeno.json()) as { bytes: number }).bytes).toBe(7);
  });

  it('o pior corpo que o schema aceita cabe com folga: 2 MB é mais que o dobro dele', () => {
    const porSegmento = PAUTA_TETO_DA_TRANSCRICAO / PAUTA_TETO_DE_SEGMENTOS;
    const passo = 7.123456789012345;
    const corpo = {
      segmentos: Array.from({ length: PAUTA_TETO_DE_SEGMENTOS }, (_, i) => ({
        inicio: i * passo,
        fim: i * passo + 7.000000000000001,
        texto: '中'.repeat(porSegmento),
      })),
      idioma: 'pt',
      modelo: 'ggml-large-v3-turbo.bin',
    };
    expect(PautaTranscricaoSchema.safeParse(corpo).success).toBe(true);
    const escapado = JSON.stringify(corpo).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    expect(Buffer.byteLength(escapado) * 2).toBeLessThan(PAUTA_TETO_DO_CORPO_DA_MIDIA);
  });

  it('a estação de mídia confere pelo mesmo teto, e o main.ts instala o parser antes do listen', () => {
    expect(TETO_DO_CORPO).toBeLessThan(PAUTA_TETO_DO_CORPO_DA_MIDIA);
    expect(TETO_DO_CORPO).toBeGreaterThan(PAUTA_TETO_DO_CORPO_DA_MIDIA - 4096);
    const main = readFileSync(join(__dirname, '../src/main.ts'), 'utf8');
    const instala = main.indexOf('instalarCorpoDaMidia(app, prefixo)');
    expect(instala).toBeGreaterThan(-1);
    expect(instala).toBeLessThan(main.indexOf('app.listen('));
    expect(main).not.toMatch(/useBodyParser|bodyParser:\s*false/);
  });
});

describe('MC-R 4: uma geração longa de cada vez', () => {
  it('a mesma chave em curso é 409 antes de chamar nada; outra chave passa; ao terminar, solta — também quando falha', async () => {
    let soltar: () => void = () => undefined;
    const primeira = umaPorVez('pauta-teste:org:e1', 'A geração de teste', () => new Promise<string>((r) => (soltar = () => r('ok'))));
    let chamou = false;
    await expect(
      umaPorVez('pauta-teste:org:e1', 'A geração de teste', async () => {
        chamou = true;
        return 'segunda';
      }),
    ).rejects.toThrow(new ConflictException(`A geração de teste ${MSG_EM_ANDAMENTO}`));
    expect(chamou).toBe(false);
    await expect(umaPorVez('pauta-teste:org:e2', 'Outra', async () => 'outra')).resolves.toBe('outra');
    soltar();
    await expect(primeira).resolves.toBe('ok');

    await expect(umaPorVez('pauta-teste:org:e1', 'X', async () => Promise.reject(new Error('caiu')))).rejects.toThrow('caiu');
    await expect(umaPorVez('pauta-teste:org:e1', 'X', async () => 'de novo')).resolves.toBe('de novo');
  });
});
