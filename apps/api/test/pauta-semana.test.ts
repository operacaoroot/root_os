import { Readable } from 'node:stream';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PAUTA_CORTE_MAXIMO_SEG,
  PAUTA_DIMENSOES_DA_PECA,
  PAUTA_PNG_DA_PECA_MAX_BYTES,
  PAUTA_TETO_DO_MOTIVO_DO_CORTE,
  PautaDerivacaoGerarSchema,
  PautaNumeroDaImagemSchema,
  PautaPecaDaSemanaEditarSchema,
  PautaVideoDoCorteSchema,
  conferirTrechoDoCorte,
  motivoParaNaoDerivar,
  type PautaEpisodioStatus,
  type PautaItemCurado,
} from '@mktos/shared';

import {
  CHAMADA_PADRAO_DO_STORY,
  DerivacaoInvalidaError,
  candidatosDoCorte,
  carrosselComPalavra,
  chaveDoItem,
  conferirPngDaPeca,
  ehPecaDaSemana,
  entradaDaDerivacao,
  linhaDaIa,
  montarDerivacao,
  notaDoCorte,
  palavraChaveDe,
  palavraUnica,
  pecaQueVale,
  planoDaMateria,
  segmentosParaOPrompt,
  systemDaDerivacao,
  textoDaIa,
  trechoDoCorte,
} from '../src/pauta/derivacao-do-episodio';
import type { Segmento } from '../src/pauta/pacote-do-episodio';
import { DerivacaoService } from '../src/pauta/derivacao.service';
import { DerivacaoController } from '../src/pauta/derivacao.controller';
import { EpisodioService } from '../src/pauta/episodio.service';
import { RodadaService } from '../src/pauta/rodada.service';
import { RotinaService } from '../src/pauta/rotina.service';
import { PublicacaoService } from '../src/pauta/publicacao.service';
import { VozService } from '../src/pauta/voz.service';
import { TOM_DA_CASA } from '../src/pauta/voz-da-pauta';
import { MemoriaService } from '../src/memory/memoria.service';
import { AuditService } from '../src/audit/audit.service';
import type { LlmProvider } from '../src/llm/llm.provider';
import type { StorageService } from '../src/storage/storage.service';
import { TetoDiarioEstouradoError } from '../src/llm/teto-diario.service';
import { SAIDA_DA_GERACAO_LONGA } from '../src/pauta/saida-da-geracao';
import { comContexto } from '../src/common/contexto-execucao';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import type { PrismaService } from '../src/prisma/prisma.service';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { renderPendente } from '../src/pauta/midia-do-episodio';
import { CABECALHO_DO_TRECHO, conferirCabecalhosDoEnvio } from '../src/pauta/video-do-corte';
import { chaveDoRender, rendersAFazer } from '../../../tools/root-midia/lib/vigia.mjs';
import { shaDaTranscricao } from '../src/pauta/newsletter-do-episodio';
import { jpegDeTeste, mp4DeTeste, sha256 } from './mp4-de-teste';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * A SEMANA DE POSTS — MC15: a derivação por notícia.
 *
 * Quatro camadas:
 *   1. a parte pura: o trecho do corte conferido (dentro da duração, na ordem,
 *      menos de 3 min, pelo menos 10 s), a palavra-chave única, o CTA do último
 *      slide, a resposta do modelo sem link nem emoji, o pedido sem URL, o
 *      plano de cada formato e a chave da matéria;
 *   2. os contratos: os esquemas e em que status a semana sai;
 *   3. o `DerivacaoService` DE VERDADE com dublês — com a TRANSCRIÇÃO DE
 *      EXEMPLO do critério de pronto: 3 matérias viram 3 carrosséis, 3 stories
 *      e 3 cortes; gerar de novo substitui o rascunho sem duplicar e nunca toca
 *      a aprovada; nenhum link privado sai; editar, subir PNG e registrar o mp4;
 *   4. com banco: as 9 peças pela sessão da empresa, e de novo sem duplicar.
 */

const ORG = '7c0f0a8e-4444-4a5a-9c1e-00000000mc15';
const PESSOA = 'b1d2c3e4-0000-4000-8000-000000000015';
const GMAIL = 'https://mail.google.com/mail/u/0/#inbox/18c2f0a';

const ITENS: PautaItemCurado[] = [
  { id: 'c1', titulo: 'Preço do modelo caiu pela metade', url: 'https://noticia.exemplo/preco', origem: 'N', resumo: 'API mais barata.' },
  { id: 'c2', titulo: 'Agente de planilha no Sheets', url: 'https://noticia.exemplo/sheets', origem: 'W' },
  // Uma newsletter antiga, sem a marca: o permalink do Gmail ainda está no url.
  { id: 'c3', titulo: 'Modelos abertos na The Batch', url: GMAIL, origem: 'L', resumo: `Veja ${GMAIL}` },
];

/* A TRANSCRIÇÃO DE EXEMPLO: um episódio de 6 min e meio com três matérias, como o whisper devolve. */
const FALAS: Array<[number, string]> = [
  [0.0, 'Bom dia, esta é a semana 40 da ROOT.'],
  [5.1, 'Três notícias hoje, todas sobre tempo que volta para quem toca empresa.'],
  [20.4, 'A primeira: o preço dos modelos caiu pela metade nesta semana.'],
  [35.0, 'Na prática, a mesma automação de atendimento custa a metade por mês.'],
  [58.2, 'Quem paga dois mil reais de API passa a pagar mil.'],
  [80.7, 'A segunda é o agente que preenche planilha sozinho dentro do Sheets.'],
  [101.3, 'A planilha de contas a pagar se preenche a partir do e-mail do fornecedor.'],
  [140.9, 'Isso tira umas duas horas por semana de quem fecha o caixa.'],
  [190.0, 'Terceira: a newsletter The Batch trouxe os modelos abertos da semana.'],
  [215.5, 'Modelo aberto já roda num computador comum, sem mandar dado para fora.'],
  [260.2, 'Para escritório de contabilidade, isso resolve o medo de vazar dado de cliente.'],
  [330.0, 'Troque uma tarefa manual por semana e meça o tempo que sobra.'],
  [372.4, 'Semana que vem tem mais. Até lá.'],
];
const DURACAO = 390;
const SEGMENTOS: Segmento[] = FALAS.map(([inicio, texto], i) => ({
  inicio,
  fim: i + 1 < FALAS.length ? FALAS[i + 1][0] - 0.3 : DURACAO - 2,
  texto,
}));

const CORTES: Record<number, [number, number]> = { 1: [3, 5], 2: [6, 8], 3: [9, 11] };
const PALAVRAS: Record<number, string> = { 1: 'preço', 2: 'PLANILHA', 3: 'abertos' };

/** O que um modelo obediente devolve para a matéria n (e o que um desobediente escreve de link). */
function respostaDaIa(n: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    carrossel: {
      titulo: `Carrossel da matéria ${n}`,
      palavraChave: PALAVRAS[n],
      slides: [
        { titulo: `Capa ${n}: o que mudou`, texto: '' },
        { titulo: 'O fato', texto: `A matéria ${n} em uma frase. Fonte: https://inventado.exemplo/${n}` },
        { titulo: 'Na prática', texto: `O que muda no caixa 🚀 ${GMAIL}` },
        { titulo: 'O próximo passo', texto: 'Troque uma tarefa manual por semana.' },
        // O modelo escreveu o CTA apesar do pedido: o sistema põe o dele.
        { titulo: 'Comente a palavra', texto: `Comente ${PALAVRAS[n]} para receber o link.` },
      ],
      legenda: `A matéria ${n} do episódio.\n\nMais em www.inventado.exemplo`,
    },
    story: { texto: `Matéria ${n}: o que muda na semana`, chamada: 'O episódio inteiro está na bio' },
    corte: { titulo: `Corte ${n}`, legenda: `O trecho da matéria ${n}.`, de: CORTES[n][0], ate: CORTES[n][1] },
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// 1. A parte pura
// ---------------------------------------------------------------------------

describe('semana: o trecho do corte conferido', () => {
  it('a regra comum (API e tela): número, ordem, dentro do vídeo, menos de 3 min, pelo menos 10 s', () => {
    expect(conferirTrechoDoCorte(20, 80, DURACAO)).toBeNull();
    expect(conferirTrechoDoCorte('20', 80, DURACAO)).toMatch(/números/);
    expect(conferirTrechoDoCorte(-1, 30, DURACAO)).toMatch(/negativo/);
    expect(conferirTrechoDoCorte(80, 80, DURACAO)).toMatch(/depois do início/);
    expect(conferirTrechoDoCorte(300, 395, DURACAO)).toMatch(/passa do fim/);
    expect(conferirTrechoDoCorte(0, PAUTA_CORTE_MAXIMO_SEG, DURACAO)).toMatch(/menos de 3 minutos/);
    expect(conferirTrechoDoCorte(0, PAUTA_CORTE_MAXIMO_SEG - 0.5, DURACAO)).toBeNull();
    expect(conferirTrechoDoCorte(10, 19, DURACAO)).toMatch(/mínimo é 10/);
  });

  it('de/até pelos números dos segmentos: o tempo sai dos segmentos reais, com o que é dito', () => {
    const r = trechoDoCorte({ de: 3, ate: 5 }, SEGMENTOS, DURACAO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corte).toMatchObject({ inicio: 20.4, fim: 80.4, de: 3, ate: 5, avisos: [] });
    expect(r.corte.trecho).toContain('o preço dos modelos caiu pela metade');
    expect(r.corte.trecho).toContain('passa a pagar mil');
    expect(r.corte.trecho).not.toContain('planilha');
  });

  it('segmento que não existe, fora de ordem ou sem número é recusado com o porquê', () => {
    expect(trechoDoCorte({ de: 0, ate: 2 }, SEGMENTOS, DURACAO)).toMatchObject({ ok: false, motivo: expect.stringMatching(/não existe/) });
    expect(trechoDoCorte({ de: 3, ate: 99 }, SEGMENTOS, DURACAO)).toMatchObject({ ok: false, motivo: expect.stringMatching(/não existe/) });
    expect(trechoDoCorte({ de: 5, ate: 3 }, SEGMENTOS, DURACAO)).toMatchObject({ ok: false, motivo: expect.stringMatching(/fora de ordem/) });
    expect(trechoDoCorte({ de: '3', ate: 4.5 }, SEGMENTOS, DURACAO)).toMatchObject({ ok: false, motivo: expect.stringMatching(/números dos segmentos/) });
    expect(trechoDoCorte({ de: 1, ate: 1 }, [], DURACAO)).toMatchObject({ ok: false });
  });

  it('passou de 3 min, encurta pelo fim; abaixo de 10 s, cresce — sempre em segmento inteiro', () => {
    const longo = trechoDoCorte({ de: 3, ate: 11 }, SEGMENTOS, DURACAO);
    expect(longo.ok).toBe(true);
    if (longo.ok) {
      expect(longo.corte.fim - longo.corte.inicio).toBeLessThan(PAUTA_CORTE_MAXIMO_SEG);
      expect(longo.corte.ate).toBe(8);
      expect(longo.corte.avisos[0]).toMatch(/terminou no segmento 8 em vez do 11/);
    }
    const curto = trechoDoCorte({ de: 1, ate: 1 }, SEGMENTOS, DURACAO);
    expect(curto.ok).toBe(true);
    if (curto.ok) {
      expect(curto.corte).toMatchObject({ de: 1, ate: 2, inicio: 0 });
      expect(curto.corte.avisos[0]).toMatch(/cresceu/);
    }
    // Um segmento sozinho de 4 min não tem como virar corte.
    const gigante: Segmento[] = [{ inicio: 0, fim: 240, texto: 'monólogo' }];
    expect(trechoDoCorte({ de: 1, ate: 1 }, gigante, 240)).toMatchObject({ ok: false, motivo: expect.stringMatching(/sozinho/) });
  });

  it('o fim nunca passa do vídeo final, mesmo com segmento que passa', () => {
    const segs: Segmento[] = [
      { inicio: 0, fim: 10, texto: 'a' },
      { inicio: 10, fim: 40, texto: 'b' },
    ];
    const r = trechoDoCorte({ de: 1, ate: 2 }, segs, 30);
    expect(r.ok && r.corte.fim).toBe(30);
  });
});

describe('semana: a palavra-chave e o CTA', () => {
  it('a palavra do modelo sai maiúscula e sem acento; sem ela, a primeira palavra forte do título; sem essa, LINK', () => {
    expect(palavraChaveDe('preço', 'x')).toBe('PRECO');
    expect(palavraChaveDe('agentes de IA', 'x')).toBe('AGENTES');
    expect(palavraChaveDe('', 'Para o agente de planilha')).toBe('AGENTE');
    expect(palavraChaveDe('🚀', 'a 2 de')).toBe('LINK');
    expect(palavraChaveDe('x'.repeat(30), 'Automação')).toBe('AUTOMACAO');
  });

  it('palavra repetida no episódio ganha o número da matéria, cabendo nos 20', () => {
    expect(palavraUnica('PLANILHA', ['PRECO'], 2)).toBe('PLANILHA');
    expect(palavraUnica('PLANILHA', ['planilha'], 2)).toBe('PLANILHA2');
    expect(palavraUnica('PLANILHA', ['PLANILHA', 'PLANILHA2'], 2)).toBe('PLANILHA3');
    expect(palavraUnica('A'.repeat(20), ['A'.repeat(20)], 12)).toBe(`${'A'.repeat(18)}12`);
  });

  it('o último slide é o CTA com a palavra, e a legenda fecha com ele uma vez só', () => {
    const c = carrosselComPalavra({ titulo: 't', legenda: 'Texto.', slides: [{ titulo: 'Capa', texto: '' }, { titulo: 'a', texto: 'b' }, { titulo: 'c', texto: 'd' }] }, 'PRECO');
    expect(c.slides).toHaveLength(4);
    expect(c.slides[3].titulo).toBe('Palavra-chave: PRECO');
    expect(c.cta).toEqual({ instrucao: 'Comentário com a palavra', palavra: 'PRECO', beneficio: expect.stringMatching(/direct/) });
    expect(c.corpo).toMatch(/^Texto\.\n\nComentário com PRECO →/);
    const outra = carrosselComPalavra({ ...c, legenda: c.corpo, slides: c.slides.slice(0, -1) }, 'CAIXA');
    expect(outra.corpo.match(/Comentário com/g)).toHaveLength(1);
    expect(outra.corpo).toContain('CAIXA');
    // Sem segunda pessoa, como a voz da marca pede.
    expect(`${c.cta.instrucao} ${c.cta.beneficio} ${c.slides[3].texto}`).not.toMatch(/\bvocê\b|\bcomente\b/i);
  });
});

describe('semana: a resposta do modelo e o pedido', () => {
  it('as três peças saem da resposta: o CTA do modelo trocado pelo do sistema, sem link nem emoji', () => {
    const m = montarDerivacao(respostaDaIa(1), { item: ITENS[0], segmentos: SEGMENTOS, duracaoSeg: DURACAO });
    expect(m.carrossel?.palavraChave).toBe('PRECO');
    expect(m.carrossel?.slides.map((s) => s.titulo)).toEqual(['Capa 1: o que mudou', 'O fato', 'Na prática', 'O próximo passo']);
    const tudo = JSON.stringify(m);
    expect(tudo).not.toMatch(/https?:|www\.|mail\.google|inventado/);
    expect(tudo).not.toContain('🚀');
    expect(m.story).toEqual({ titulo: 'Preço do modelo caiu pela metade', corpo: 'Matéria 1: o que muda na semana', chamada: 'O episódio inteiro está na bio', tempoSeg: 20.4 });
    expect(m.corte).toMatchObject({ titulo: 'Corte 1', corpo: 'O trecho da matéria 1.', inicio: 20.4, fim: 80.4 });
    expect(m.avisos).toEqual([]);
  });

  it('cada formato vale sozinho: poucos slides, corte fora de ordem e story sem texto saem nulos com o porquê', () => {
    const m = montarDerivacao(
      respostaDaIa(2, {
        carrossel: { slides: [{ titulo: 'só a capa', texto: '' }, { titulo: 'e um', texto: 'x' }] },
        corte: { de: 8, ate: 6 },
      }),
      { item: ITENS[1], segmentos: SEGMENTOS, duracaoSeg: DURACAO },
    );
    expect(m.carrossel).toBeNull();
    expect(m.corte).toBeNull();
    expect(m.story).toMatchObject({ corpo: 'Matéria 2: o que muda na semana', tempoSeg: null });
    const semStory = montarDerivacao(respostaDaIa(2, { story: { texto: '' } }), { item: ITENS[1], segmentos: SEGMENTOS, duracaoSeg: DURACAO });
    expect(semStory.story).toBeNull();
    expect(semStory.avisos).toContain('Story: não veio texto.');
    expect(m.avisos.join(' ')).toMatch(/Carrossel: o modelo devolveu 2 slide/);
    expect(m.avisos.join(' ')).toMatch(/Corte: o corte está fora de ordem/);
    expect(() => montarDerivacao('{}', { item: ITENS[1], segmentos: SEGMENTOS, duracaoSeg: DURACAO })).toThrow(DerivacaoInvalidaError);
    expect(() => montarDerivacao('não é json', { item: ITENS[1], segmentos: SEGMENTOS, duracaoSeg: DURACAO })).toThrow(/não veio JSON/);
  });

  it('story sem chamada ganha a do sistema; sem corte, o frame fica para o Mac escolher', () => {
    const m = montarDerivacao(JSON.stringify({ story: { texto: 'O preço caiu' } }), { item: ITENS[0], segmentos: SEGMENTOS, duracaoSeg: DURACAO });
    expect(m.story).toMatchObject({ chamada: CHAMADA_PADRAO_DO_STORY, tempoSeg: null });
  });

  it('o link sai do texto do modelo mesmo colado em letra, em markdown ou marcador', () => {
    expect(linhaDaIa(`# veja${GMAIL} e [aqui](https://x.exemplo) {{video}} fim`, 200)).toBe('veja e aqui fim');
    expect(textoDaIa('um https://a.exemplo/b\n\n\ndois 🚀', 200)).toBe('um\n\ndois');
  });

  it('o pedido leva a matéria SEM link (nem o do Gmail no resumo) e a transcrição numerada com os tempos', () => {
    const u = entradaDaDerivacao({ apelido: 'ep-04', titulo: 'Semana 40', item: ITENS[2], n: 3, total: 3, segmentos: SEGMENTOS, duracaoSeg: DURACAO });
    expect(u).toContain('Matéria 3 de 3: Modelos abertos na The Batch');
    expect(u).not.toMatch(/mail\.google|https?:/);
    expect(u).toContain('#9 [03:10–03:35] Terceira: a newsletter The Batch');
    expect(u).toContain('13 segmentos, 06:30 de vídeo');
    expect(systemDaDerivacao('VOZ DO AUTOR')).toMatch(/NÃO escreva o slide de CTA[\s\S]*VOZ DO AUTOR$/);
  });

  it('transcrição longa: a fala de cada segmento encurta, o número e o tempo nunca', () => {
    const muitos: Segmento[] = Array.from({ length: 500 }, (_, i) => ({ inicio: i * 5, fim: i * 5 + 4.5, texto: `fala ${i} `.repeat(40) }));
    const t = segmentosParaOPrompt(muitos, 30_000);
    expect(t.encurtado).toBe(true);
    expect(t.texto.length).toBeLessThanOrEqual(30_000);
    expect(t.texto).toContain('#500 [41:35–41:39]');
  });

  it('uma hora de vídeo (1.200 segmentos): o último segmento chega inteiro, nenhum some do fim', () => {
    const hora: Segmento[] = Array.from({ length: 1200 }, (_, i) => ({ inicio: i * 3, fim: i * 3 + 2.9, texto: `a matéria ${i} dita com calma `.repeat(6) }));
    const t = segmentosParaOPrompt(hora);
    expect(t.encurtado).toBe(true);
    expect(t.texto.length).toBeLessThanOrEqual(40_000);
    const linhas = t.texto.split('\n');
    expect(linhas).toHaveLength(1200);
    expect(linhas.every((l, i) => l.startsWith(`#${i + 1} [`))).toBe(true);
    expect(linhas[1199]).toMatch(/^#1200 \[59:57–59:59\] a matéria/);
    // Teto que nem o prefixo cabe: a fala sai, a lista fica.
    const apertado = segmentosParaOPrompt(hora, 5_000);
    expect(apertado.texto.split('\n')).toHaveLength(1200);
    expect(apertado.texto.endsWith('#1200 [59:57–59:59]')).toBe(true);
  });

  it('o título da matéria e o do episódio também vão sem URL', () => {
    const u = entradaDaDerivacao({
      apelido: 'ep-04',
      titulo: `Semana 40 ${GMAIL}`,
      item: { ...ITENS[0], titulo: `Preço caiu, ver https://noticia.exemplo/preco e ${GMAIL}` },
      n: 1,
      total: 3,
      segmentos: SEGMENTOS,
      duracaoSeg: DURACAO,
    });
    expect(u).toContain('Matéria 1 de 3: Preço caiu, ver e');
    expect(u).not.toMatch(/mail\.google|https?:|noticia\.exemplo/);
  });
});

describe('semana: o slide de CTA do modelo, e só ele', () => {
  const resp = (slides: Array<{ titulo: string; texto: string }>, palavraChave: string) =>
    JSON.stringify({ carrossel: { titulo: 't', palavraChave, slides, legenda: 'l' } });
  const ctx = { item: ITENS[0], segmentos: SEGMENTOS, duracaoSeg: DURACAO };

  it('a palavra é o assunto: o slide de conteúdo que fala dela fica', () => {
    const m = montarDerivacao(
      resp(
        [
          { titulo: 'O preço caiu', texto: '' },
          { titulo: 'Quanto', texto: 'O preço por milhão de tokens caiu pela metade.' },
          { titulo: 'No caixa', texto: 'O preço da automação de atendimento também.' },
          { titulo: 'E agora', texto: 'Revisar o preço do contrato com o fornecedor.' },
        ],
        'PRECO',
      ),
      ctx,
    );
    expect(m.carrossel?.slides).toHaveLength(4);
    expect(m.carrossel?.slides[3].titulo).toBe('E agora');
  });

  it('palavra curta não casa dentro de outra, "comentário" sem a palavra não é CTA, e sai no máximo um slide', () => {
    const conteudo = [
      { titulo: 'Capa', texto: '' },
      { titulo: 'Capital', texto: 'O capital de giro fica mais rápido.' },
      { titulo: 'Um comentário', texto: 'O comentário do fornecedor sobre o prazo.' },
    ];
    expect(montarDerivacao(resp(conteudo, 'API'), ctx).carrossel?.slides).toHaveLength(3);
    const doisCtas = [...conteudo, { titulo: 'Comente API', texto: '' }, { titulo: 'Comente API', texto: 'para receber' }];
    expect(montarDerivacao(resp(doisCtas, 'API'), ctx).carrossel?.slides.map((x) => x.titulo)).toEqual([
      'Capa', 'Capital', 'Um comentário', 'Comente API',
    ]);
  });

  it('a planilha que se preenche: o último slide de conteúdo com a palavra fica', () => {
    const m = montarDerivacao(
      resp(
        [
          { titulo: 'Agente no Sheets', texto: '' },
          { titulo: 'O que faz', texto: 'Lê o e-mail do fornecedor.' },
          { titulo: 'Onde lança', texto: 'Na conta a pagar.' },
          { titulo: 'A planilha que se preenche', texto: 'Duas horas por semana de volta.' },
        ],
        'PLANILHA',
      ),
      { ...ctx, item: ITENS[1] },
    );
    expect(m.carrossel?.slides.map((x) => x.titulo)).toContain('A planilha que se preenche');
  });
});

describe('semana: o que fazer com cada formato e a chave da matéria', () => {
  const p = (id: string, formato: string, status: 'rascunho' | 'aprovada' | 'publicada' | 'descartada', dia: number) => ({
    id,
    formato,
    status,
    criadaEm: new Date(Date.UTC(2026, 8, dia)),
  });

  it('aprovada e publicada ficam; rascunho e descartada são substituídas no lugar; o que falta é criado', () => {
    const plano = planoDaMateria([p('a', 'carrossel', 'aprovada', 1), p('b', 'story', 'descartada', 1), p('c', 'story', 'rascunho', 2)]);
    expect(plano.carrossel).toEqual({ tipo: 'manter', id: 'a', status: 'aprovada' });
    expect(plano.story).toEqual({ tipo: 'substituir', id: 'c', status: 'rascunho' });
    expect(plano.corte).toEqual({ tipo: 'criar' });
    // Duas do mesmo formato (corrida antiga): vale a firme, mesmo mais velha.
    expect(planoDaMateria([p('x', 'corte', 'rascunho', 5), p('y', 'corte', 'publicada', 1)]).corte).toEqual({ tipo: 'manter', id: 'y', status: 'publicada' });
    expect(pecaQueVale([p('d', 'corte', 'descartada', 9), p('e', 'corte', 'rascunho', 1)], 'corte')?.id).toBe('e');
    expect(pecaQueVale([p('d', 'corte', 'descartada', 9)], 'corte')?.id).toBe('d');
  });

  it('a peça da semana tem episódio, matéria e formato; o carrossel da derivação antiga não é', () => {
    expect(ehPecaDaSemana({ episodioId: 'e1', itemId: 'c1', formato: 'story' })).toBe(true);
    expect(ehPecaDaSemana({ episodioId: 'e1', itemId: 'c1', formato: 'story' }, 'e2')).toBe(false);
    expect(ehPecaDaSemana({ slides: [] })).toBe(false);
    expect(ehPecaDaSemana({ episodioId: 'e1', origem: 'transcricao' })).toBe(false);
    expect(chaveDoItem(ITENS[0])).toBe('c1');
    const semId = chaveDoItem({ titulo: 'Antiga', url: 'https://a.exemplo' });
    expect(semId).toMatch(/^h-[0-9a-f]{16}$/);
    expect(chaveDoItem({ titulo: 'Antiga', url: 'https://a.exemplo' })).toBe(semId);
  });
});

function png(largura: number, altura: number, total = 64): Buffer {
  const b = Buffer.alloc(Math.max(total, 33));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(largura, 16);
  b.writeUInt32BE(altura, 20);
  return b;
}

describe('semana: contratos', () => {
  it('gerar: substituir padrão falso; itens de 1 em diante', () => {
    expect(PautaDerivacaoGerarSchema.parse({})).toEqual({ substituir: false });
    expect(PautaDerivacaoGerarSchema.parse({ substituir: true, itens: [2, 3] })).toEqual({ substituir: true, itens: [2, 3] });
    expect(() => PautaDerivacaoGerarSchema.parse({ itens: [0] })).toThrow();
    expect(() => PautaDerivacaoGerarSchema.parse({ itens: [] })).toThrow();
  });

  it('editar: só campos conhecidos, início e fim juntos, palavra maiúscula, slides 3 a 9', () => {
    expect(PautaPecaDaSemanaEditarSchema.parse({ texto: ' novo ' })).toEqual({ texto: 'novo' });
    expect(() => PautaPecaDaSemanaEditarSchema.parse({})).toThrow(/Nada para mudar/);
    expect(() => PautaPecaDaSemanaEditarSchema.parse({ inicio: 10 })).toThrow(/juntos/);
    expect(() => PautaPecaDaSemanaEditarSchema.parse({ status: 'publicada' })).toThrow();
    expect(() => PautaPecaDaSemanaEditarSchema.parse({ palavraChave: 'preço' })).toThrow(/maiúsculas/);
    expect(() => PautaPecaDaSemanaEditarSchema.parse({ slides: [{ titulo: 'a', texto: 'b' }] })).toThrow();
  });

  it('o mp4 do corte: caminho absoluto .mp4 no Mac, 1080×1920', () => {
    const ok = { arquivo: '/Users/pedro/Movies/ep-04-m1-corte.mp4', duracaoSeg: 60, largura: 1080, altura: 1920, bytes: 1000 };
    expect(PautaVideoDoCorteSchema.parse(ok)).toEqual(ok);
    expect(() => PautaVideoDoCorteSchema.parse({ ...ok, arquivo: 'ep.mp4' })).toThrow(/absoluto/);
    expect(() => PautaVideoDoCorteSchema.parse({ ...ok, arquivo: '/x/corte.mov' })).toThrow();
    expect(() => PautaVideoDoCorteSchema.parse({ ...ok, largura: 1920, altura: 1080 })).toThrow();
    expect(PautaNumeroDaImagemSchema.parse('3')).toBe(3);
    expect(() => PautaNumeroDaImagemSchema.parse('11')).toThrow();
  });

  it('a semana sai no Pacote e na Derivação, com transcrição e matéria', () => {
    expect(motivoParaNaoDerivar('pacote', 3, 3)).toBeNull();
    expect(motivoParaNaoDerivar('derivacao', 3, 3)).toBeNull();
    expect(motivoParaNaoDerivar('edicao', 3, 3)).toMatch(/Pacote ou na Derivação/);
    expect(motivoParaNaoDerivar('agendado', 3, 3)).toMatch(/Agendado/);
    expect(motivoParaNaoDerivar('pacote', 0, 3)).toMatch(/transcrição/);
    expect(motivoParaNaoDerivar('pacote', 3, 0)).toMatch(/matérias/);
  });

  it('o PNG da peça: assinatura, tamanho exato do formato e o teto de 5 MB', () => {
    const arq = (buffer: Buffer, mimetype = 'image/png') => ({ buffer, mimetype, size: buffer.length });
    const car = PAUTA_DIMENSOES_DA_PECA.carrossel;
    expect(conferirPngDaPeca(arq(png(1080, 1350)), car, PAUTA_PNG_DA_PECA_MAX_BYTES)).toEqual({ ok: true, largura: 1080, altura: 1350 });
    expect(conferirPngDaPeca(arq(png(1080, 1920)), car, PAUTA_PNG_DA_PECA_MAX_BYTES)).toMatchObject({ ok: false, motivo: expect.stringMatching(/1080×1350/) });
    expect(conferirPngDaPeca(arq(png(1080, 1350), 'image/jpeg'), car, PAUTA_PNG_DA_PECA_MAX_BYTES)).toMatchObject({ ok: false });
    expect(conferirPngDaPeca(arq(Buffer.from('GIF89a...........................')), car, PAUTA_PNG_DA_PECA_MAX_BYTES)).toMatchObject({ ok: false, motivo: expect.stringMatching(/assinatura/) });
    expect(conferirPngDaPeca({ ...arq(png(1080, 1350)), size: PAUTA_PNG_DA_PECA_MAX_BYTES + 1 }, car, PAUTA_PNG_DA_PECA_MAX_BYTES)).toMatchObject({ ok: false, motivo: expect.stringMatching(/5 MB/) });
    expect(conferirPngDaPeca(undefined, car, PAUTA_PNG_DA_PECA_MAX_BYTES)).toMatchObject({ ok: false });
  });
});

// ---------------------------------------------------------------------------
// 3. O serviço com dublês
// ---------------------------------------------------------------------------

type Ep = {
  id: string; orgId: string; numero: number; titulo: string; status: PautaEpisodioStatus; rodadaId: string;
  roteiro: string; midia: unknown; transcricao: unknown; transcricaoTexto: string; titulos: unknown; thumbs: unknown;
  descricao: string; bioPageId: string | null; criadoPor: string | null; criadoEm: Date; atualizadoEm: Date;
  rodada: { titulo: string; itens: unknown; janelaIni: Date; janelaFim: Date };
  bioPage?: unknown;
};

type Peca = {
  id: string; orgId: string; rodadaId: string; canal: string; formato: string; titulo: string; corpo: string;
  meta: unknown; status: string; criadaEm: Date; erro?: string | null;
};

const MIDIA = {
  arquivoBruto: '/Users/pedro/Movies/OBS/bruto.mp4',
  arquivoFinal: '/Users/pedro/Movies/OBS/root-midia/ep-04/final.mp4',
  duracaoSeg: DURACAO,
  cortes: [],
  palavraDeCorte: null,
  editor: 'ffmpeg',
  recebidaEm: '2026-09-24T10:00:00.000Z',
};

function ep(over: Partial<Ep> = {}): Ep {
  return {
    id: 'e1', orgId: ORG, numero: 4, titulo: 'Semana 40', status: 'pacote', rodadaId: 'r1', roteiro: '# roteiro',
    midia: MIDIA, transcricao: SEGMENTOS, transcricaoTexto: 'x', titulos: [], thumbs: [], descricao: '', bioPageId: null,
    criadoPor: PESSOA, criadoEm: new Date('2026-09-20T12:00:00.000Z'), atualizadoEm: new Date('2026-09-24T12:00:00.000Z'),
    rodada: { titulo: 'Semana 40', itens: ITENS, janelaIni: new Date('2026-09-17T00:00:00.000Z'), janelaFim: new Date('2026-09-24T00:00:00.000Z') },
    ...over,
  };
}

function servico(opts: {
  episodios?: Ep[];
  pecas?: Peca[];
  resposta?: (n: number, chamada: number) => string | Error;
  llm?: Partial<LlmProvider>;
  duranteIa?: (s: { lista: Ep[]; pecas: Peca[] }) => void;
} = {}) {
  const lista = opts.episodios ?? [ep()];
  const pecas: Peca[] = opts.pecas ?? [];
  const chamadas: Array<{ system: string; user: string; orgId?: string; maxTokens?: number }> = [];
  const auditoria: Array<Record<string, unknown>> = [];
  const travas: string[] = [];
  const guardados: Record<string, Buffer> = {};
  let seq = 0;
  let relogio = Date.parse('2026-09-24T12:00:00.000Z');

  const llm = {
    name: 'dublê',
    model: 'dublê-1',
    configured: true,
    supportsTools: false,
    complete: async (m: { system: string; user: string; orgId?: string; maxTokens?: number }) => {
      chamadas.push(m);
      opts.duranteIa?.({ lista, pecas });
      const n = Number(/Matéria (\d+) de/.exec(m.user)?.[1] ?? 0);
      const r = opts.resposta ? opts.resposta(n, chamadas.length) : respostaDaIa(n);
      if (r instanceof Error) throw r;
      return r;
    },
    ...opts.llm,
  } as unknown as LlmProvider;

  const casa = (p: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const atual = p[k];
      if (v && typeof v === 'object' && 'not' in v) return atual !== (v as { not: unknown }).not;
      if (v && typeof v === 'object' && 'in' in v) return (v as { in: unknown[] }).in.includes(atual);
      return atual === v;
    });

  const prisma = {
    pautaEpisodio: {
      findFirst: async ({ where }: { where: { id: string; orgId: string } }) => {
        const e = lista.find((x) => x.id === where.id && x.orgId === where.orgId);
        return e ? structuredClone(e) : null;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const alvo = lista.filter((e) => casa(e as unknown as Record<string, unknown>, where));
        for (const e of alvo) Object.assign(e, structuredClone(data));
        return { count: alvo.length };
      },
    },
    pautaPeca: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        structuredClone(pecas.filter((p) => casa(p, where)).sort((a, b) => b.criadaEm.getTime() - a.criadaEm.getTime())),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const p = pecas.find((x) => casa(x, where));
        return p ? structuredClone(p) : null;
      },
      create: async ({ data }: { data: Omit<Peca, 'id' | 'status' | 'criadaEm'> }) => {
        const p: Peca = { id: `p${++seq}`, status: 'rascunho', criadaEm: new Date((relogio += 1000)), ...structuredClone(data) };
        pecas.push(p);
        return structuredClone(p);
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const alvo = pecas.filter((p) => casa(p, where));
        for (const p of alvo) Object.assign(p, structuredClone(data));
        return { count: alvo.length };
      },
    },
    $executeRaw: async (partes: TemplateStringsArray, ...valores: unknown[]) => {
      travas.push(String(valores[0]));
      return partes.length;
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditoria.push(data);
        return data;
      },
    },
  } as unknown as PrismaService & { $transaction: unknown };

  const storage = {
    put: async (chave: string, corpo: Buffer, tipo: string) => {
      if (tipo !== (chave.endsWith('.jpg') ? 'image/jpeg' : 'image/png')) throw new Error('tipo errado');
      guardados[chave] = corpo;
    },
    putStream: async (chave: string, stream: Readable, tamanho: number, tipo: string) => {
      if (tipo !== 'video/mp4') throw new Error('tipo errado');
      const partes: Buffer[] = [];
      for await (const p of stream) partes.push(p as Buffer);
      const corpo = Buffer.concat(partes);
      if (corpo.length !== tamanho) throw new Error('tamanho errado');
      guardados[chave] = corpo;
    },
    get: async (chave: string) => {
      const b = guardados[chave];
      if (!b) throw new Error('NoSuchKey');
      return { stream: Readable.from([b]), contentType: 'image/png', size: b.length };
    },
  } as unknown as StorageService;
  const memoria = { porChave: async () => null } as unknown as MemoriaService;
  const audit = new AuditService(prisma);
  return {
    semana: new DerivacaoService(prisma, audit, llm, new VozService(prisma, audit, llm, memoria), storage, new EpisodioService(prisma, audit)),
    prisma,
    lista,
    pecas,
    chamadas,
    auditoria,
    travas,
    guardados,
  };
}

const daSemana = (pecas: Peca[]) => pecas.filter((p) => ehPecaDaSemana(p.meta));
const meta = (p: Peca) => p.meta as Record<string, unknown>;

describe('semana: gerar (o critério de pronto, com a transcrição de exemplo)', () => {
  it('3 matérias viram 3 carrosséis, 3 stories e 3 cortes — uma chamada por matéria, com a empresa pagando', async () => {
    const s = servico();
    const r = await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });

    expect(s.chamadas).toHaveLength(3);
    for (const c of s.chamadas) {
      expect(c.orgId).toBe(ORG);
      expect(c.maxTokens).toBe(SAIDA_DA_GERACAO_LONGA);
      // Sem perfil de voz, o tom da casa (MC10).
      expect(c.system).toContain(TOM_DA_CASA.split('\n')[0]);
    }
    expect(r.conta).toEqual({ criadas: 9, substituidas: 0, mantidas: 0, falharam: 0 });
    const pecas = daSemana(s.pecas);
    expect(pecas).toHaveLength(9);
    expect(pecas.every((p) => p.canal === 'instagram' && p.rodadaId === 'r1' && p.orgId === ORG && p.status === 'rascunho')).toBe(true);
    for (const f of ['carrossel', 'story', 'corte']) {
      expect(pecas.filter((p) => p.formato === f).map((p) => meta(p).itemId).sort()).toEqual(['c1', 'c2', 'c3']);
    }

    expect(r.materias.map((m) => [m.n, Object.keys(m.pecas).sort()])).toEqual([
      [1, ['carrossel', 'corte', 'story']],
      [2, ['carrossel', 'corte', 'story']],
      [3, ['carrossel', 'corte', 'story']],
    ]);
    const m1 = r.materias[0].pecas;
    expect(m1.carrossel?.slides).toHaveLength(5);
    expect(m1.carrossel?.slides?.[4].titulo).toBe('Palavra-chave: PRECO');
    expect(m1.carrossel?.cta?.palavra).toBe('PRECO');
    expect(m1.carrossel?.corpo).toMatch(/Comentário com PRECO →/);
    expect(m1.story).toMatchObject({ corpo: 'Matéria 1: o que muda na semana', tempoSeg: 20.4 });
    expect(m1.corte).toMatchObject({ inicio: 20.4, fim: 80.4, video: null });
    expect(m1.corte?.trecho).toContain('caiu pela metade');
    expect(r.materias[1].pecas.corte).toMatchObject({ inicio: 80.7, fim: 189.7 });
    expect(r.materias[2].pecas.corte).toMatchObject({ inicio: 190, fim: 329.7 });
    expect(r.arquivoFinal).toBe(MIDIA.arquivoFinal);

    // O episódio anda para Derivação, e o RASTRO conta.
    expect(s.lista[0].status).toBe('derivacao');
    expect(r.status).toBe('derivacao');
    const log = s.auditoria.find((a) => a.action === 'pauta.semana_gerada');
    expect(log).toMatchObject({ entityId: 'e1', before: { status: 'pacote' }, after: { status: 'derivacao', conta: { criadas: 9 } } });
    expect(s.travas).toEqual(['pauta-semana:e1', 'pauta-semana:e1', 'pauta-semana:e1']);
  });

  it('nenhum link privado: o pedido não leva o Gmail, a peça da newsletter sai sem link e nenhum texto o carrega', async () => {
    const s = servico();
    const r = await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(s.chamadas.map((c) => c.user).join('\n')).not.toMatch(/mail\.google|https?:/);
    expect(JSON.stringify(s.pecas)).not.toMatch(/mail\.google|inventado|www\./);
    expect(r.materias.map((m) => m.link)).toEqual(['https://noticia.exemplo/preco', 'https://noticia.exemplo/sheets', null]);
    expect(s.pecas.map((p) => meta(p).linkDaMateria)).not.toContain(GMAIL);
  });

  it('o segundo clique enquanto a primeira geração ainda roda é 409 na hora, sem pagar a IA de novo', async () => {
    let soltar: () => void = () => undefined;
    const segura = new Promise<void>((r) => (soltar = r));
    let primeira = true;
    const s = servico({
      llm: {
        complete: async (m: { user: string }) => {
          if (primeira) {
            primeira = false;
            await segura;
          }
          return respostaDaIa(Number(/Matéria (\d+) de/.exec(m.user)?.[1] ?? 0));
        },
      } as Partial<LlmProvider>,
    });
    const emCurso = s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    await new Promise((r) => setTimeout(r, 0));
    await expect(s.semana.gerar(ORG, 'e1', PESSOA, { substituir: true })).rejects.toThrow(/já está em andamento/);
    soltar();
    expect((await emCurso).conta.criadas).toBe(9);
    // Terminada a primeira, a chave se solta: gerar de novo volta a valer.
    await expect(s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toThrow(/confirme|substituir/i);
  });

  it('gerar de novo: sem confirmar é 409 sem IA; confirmando, substitui no mesmo registro e não duplica', async () => {
    const s = servico();
    await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    const ids = s.pecas.map((p) => p.id).sort();
    // MD1: o encadeamento propôs slot para as rascunho; derivar de novo o zera.
    for (const p of s.pecas) (p as { slotProposto?: Date | null }).slotProposto = new Date('2026-09-28T15:00:00.000Z');

    await expect(s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toThrow(ConflictException);
    expect(s.chamadas).toHaveLength(3);

    const r = await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: true });
    expect(s.chamadas).toHaveLength(6);
    expect(s.pecas.map((p) => p.id).sort()).toEqual(ids);
    expect(r.conta).toEqual({ criadas: 0, substituidas: 9, mantidas: 0, falharam: 0 });
    expect(s.pecas.every((p) => (p as { slotProposto?: Date | null }).slotProposto === null)).toBe(true);
  });

  it('a aprovada e a publicada nunca são tocadas; matéria com as três firmes nem chama a IA', async () => {
    const s = servico();
    await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    const da = (item: string, f: string) => s.pecas.find((p) => meta(p).itemId === item && p.formato === f)!;
    for (const f of ['carrossel', 'story', 'corte']) da('c1', f).status = 'aprovada';
    da('c2', 'carrossel').status = 'publicada';
    const antes = structuredClone(da('c2', 'carrossel'));

    const r = await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: true });
    expect(s.chamadas).toHaveLength(3 + 2);
    expect(s.chamadas.slice(3).map((c) => /Matéria (\d)/.exec(c.user)?.[1])).toEqual(['2', '3']);
    expect(r.conta).toEqual({ criadas: 0, substituidas: 5, mantidas: 4, falharam: 0 });
    expect(da('c2', 'carrossel')).toEqual(antes);
    expect(r.avisos.join(' ')).toMatch(/Matéria 1: as três peças já estão aprovadas ou publicadas/);
    expect(daSemana(s.pecas)).toHaveLength(9);
  });

  it('a descartada é regerada no lugar, sem pedir confirmação', async () => {
    const s = servico();
    await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    for (const p of s.pecas) p.status = 'descartada';
    const r = await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(r.conta.substituidas).toBe(9);
    expect(s.pecas.every((p) => p.status === 'rascunho')).toBe(true);
  });

  it('a mesma palavra em duas matérias: a segunda ganha o número', async () => {
    const s = servico({ resposta: (n) => respostaDaIa(n, { carrossel: { ...JSON.parse(respostaDaIa(n)).carrossel, palavraChave: 'IA' } }) });
    // "IA" é curta demais: cai no título; forçamos a colisão com a mesma palavra válida.
    const t = servico({ resposta: (n) => respostaDaIa(n, { carrossel: { ...JSON.parse(respostaDaIa(n)).carrossel, palavraChave: 'SEMANA' } }) });
    await t.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    const palavras = t.pecas.filter((p) => p.formato === 'carrossel').map((p) => meta(p).palavraChave);
    expect(palavras).toEqual(['SEMANA', 'SEMANA2', 'SEMANA3']);
    const avisos = t.pecas.filter((p) => p.formato === 'carrossel').map((p) => (meta(p).avisos as string[]).join(' '));
    expect(avisos[1]).toMatch(/SEMANA já era de outra matéria: ficou SEMANA2/);
    await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(s.pecas.filter((p) => p.formato === 'carrossel').map((p) => meta(p).palavraChave)).toEqual(['PRECO', 'AGENTE', 'MODELOS']);
  });

  it('corte que não fecha fica de fora com o porquê; ao gerar de novo, o rascunho anterior dele fica', async () => {
    const s = servico();
    await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    const corteAntes = structuredClone(s.pecas.find((p) => meta(p).itemId === 'c2' && p.formato === 'corte'));
    const t = servico({ pecas: s.pecas, resposta: (n) => (n === 2 ? respostaDaIa(2, { corte: { de: 99, ate: 100 } }) : respostaDaIa(n)) });
    const r = await t.semana.gerar(ORG, 'e1', PESSOA, { substituir: true });
    expect(r.conta).toEqual({ criadas: 0, substituidas: 8, mantidas: 0, falharam: 1 });
    expect(r.avisos.join(' ')).toMatch(/Matéria 2 · Corte: o corte aponta segmento que não existe/);
    expect(r.avisos.join(' ')).toMatch(/Corte vertical: ficou a versão anterior/);
    expect(t.pecas.find((p) => p.id === corteAntes?.id)).toEqual(corteAntes);
  });

  it('JSON ruim ou IA fora numa matéria não leva as outras; todas falhando é 503 sem gravar', async () => {
    const s = servico({ resposta: (n) => (n === 2 ? 'não é json' : n === 3 ? new Error('provider fora do ar') : respostaDaIa(n)) });
    const r = await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(r.conta).toEqual({ criadas: 3, substituidas: 0, mantidas: 0, falharam: 6 });
    expect(r.avisos.join(' ')).toMatch(/Matéria 2: A IA não devolveu peças utilizáveis \(não veio JSON\)/);
    expect(r.avisos.join(' ')).toMatch(/Matéria 3: provider fora do ar/);

    const t = servico({ resposta: () => 'nada' });
    await expect(t.semana.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toThrow(ServiceUnavailableException);
    expect(t.pecas).toHaveLength(0);
    expect(t.lista[0].status).toBe('pacote');
  });

  it('a recusa por custo para o laço: o que já foi gravado fica, e as seguintes não gastam', async () => {
    const s = servico({ resposta: (n) => (n === 2 ? new TetoDiarioEstouradoError(ORG, 'Teto de IA do dia atingido.' as never) : respostaDaIa(n)) });
    const r = await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(s.chamadas).toHaveLength(2);
    expect(r.conta).toEqual({ criadas: 3, substituidas: 0, mantidas: 0, falharam: 6 });
    expect(r.avisos.join(' ')).toMatch(/Matéria 2 em diante: .*as seguintes não foram geradas/);
  });

  it('só as matérias pedidas; fora do status, sem transcrição ou matéria que não existe é 400 sem IA; sem IA é 503', async () => {
    const s = servico();
    const r = await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false, itens: [2] });
    expect(s.chamadas).toHaveLength(1);
    expect(r.conta.criadas).toBe(3);
    await expect(s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false, itens: [4] })).rejects.toThrow(/não há a 4/);

    for (const [e, msg] of [
      [ep({ status: 'edicao' }), /Pacote ou na Derivação/],
      [ep({ status: 'agendado' }), /Agendado/],
      [ep({ transcricao: [] }), /não tem transcrição/],
    ] as const) {
      const t = servico({ episodios: [e] });
      await expect(t.semana.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toThrow(BadRequestException);
      await expect(t.semana.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toThrow(msg);
      expect(t.chamadas).toHaveLength(0);
    }
    await expect(servico().semana.gerar(ORG, 'outro', PESSOA, { substituir: false })).rejects.toThrow(NotFoundException);
    const semIa = servico({ llm: { configured: false } });
    await expect(semIa.semana.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toThrow(ServiceUnavailableException);
  });

  it('na Derivação, gerar de novo não mexe no status; mídia refeita no meio da IA é 409 e nada daquela matéria grava', async () => {
    const s = servico({ episodios: [ep({ status: 'derivacao' })] });
    await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false, itens: [1] });
    expect(s.lista[0].status).toBe('derivacao');

    const t = servico({
      duranteIa: ({ lista }) => {
        lista[0].transcricao = [...SEGMENTOS, { inicio: 389, fim: 389.5, texto: 'nova' }];
      },
    });
    await expect(t.semana.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toThrow(ConflictException);
    expect(t.pecas).toHaveLength(0);
    expect(t.lista[0].status).toBe('pacote');
    expect(t.auditoria.find((a) => a.action === 'pauta.semana_gerada')).toBeTruthy();
  });

  it('a legenda do corte fecha com o CTA da mesma palavra; com carrossel aprovado, a matéria fica com a palavra dele', async () => {
    const s = servico();
    const r = await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    const corte = r.materias[0].pecas.corte!;
    expect(corte.corpo).toBe('O trecho da matéria 1.\n\nComentário com PRECO → o link da matéria e o episódio completo no direct.');
    expect(corte.palavraChave).toBe('PRECO');

    const car = s.pecas.find((p) => meta(p).itemId === 'c1' && p.formato === 'carrossel')!;
    car.status = 'aprovada';
    (car.meta as Record<string, unknown>).palavraChave = 'CUSTO';
    const t = servico({ pecas: s.pecas, resposta: (n) => respostaDaIa(n) });
    const r2 = await t.semana.gerar(ORG, 'e1', PESSOA, { substituir: true, itens: [1] });
    expect(r2.materias[0].pecas.corte?.corpo).toMatch(/Comentário com CUSTO →/);
    expect(r2.materias[0].pecas.corte?.avisos.join(' ')).toMatch(/ficou CUSTO, a da peça já aprovada desta matéria/);
  });

  it('a IA falhando numa matéria com carrossel aprovado: ele conta como mantido, não como "não saiu"', async () => {
    const s = servico();
    await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    s.pecas.find((p) => meta(p).itemId === 'c2' && p.formato === 'carrossel')!.status = 'aprovada';
    const t = servico({ pecas: s.pecas, resposta: (n) => (n === 2 ? new Error('provider fora do ar') : respostaDaIa(n)) });
    const r = await t.semana.gerar(ORG, 'e1', PESSOA, { substituir: true });
    expect(r.conta).toEqual({ criadas: 0, substituidas: 6, mantidas: 1, falharam: 2 });

    const u = servico({ pecas: s.pecas, resposta: (n) => (n === 2 ? new TetoDiarioEstouradoError(ORG, 'Teto.' as never) : respostaDaIa(n)) });
    const r2 = await u.semana.gerar(ORG, 'e1', PESSOA, { substituir: true });
    // A matéria 2 (com o carrossel firme) e a 3 param juntas: 1 mantida, 2 + 3 que não saíram.
    expect(r2.conta).toEqual({ criadas: 0, substituidas: 3, mantidas: 1, falharam: 5 });
  });

  it('o painel mostra a mais firme de cada formato e avisa a transcrição que mudou', async () => {
    const s = servico();
    await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    const antes = await s.semana.painel(ORG, 'e1');
    expect(antes.materias[0].pecas.story?.transcricaoMudou).toBe(false);
    s.lista[0].transcricao = SEGMENTOS.slice(0, 12);
    const depois = await s.semana.painel(ORG, 'e1');
    expect(depois.materias[0].pecas.story?.transcricaoMudou).toBe(true);
    expect(depois.motivo).toBeNull();
  });
});

describe('semana: editar, subir o PNG e registrar o mp4', () => {
  async function gerado() {
    const s = servico();
    await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    const da = (item: string, f: string) => s.pecas.find((p) => meta(p).itemId === item && p.formato === f)!;
    return { s, da };
  }

  it('o carrossel editado refaz o CTA com a palavra nova, joga fora o render e volta ao rascunho', async () => {
    const { s, da } = await gerado();
    const c = da('c1', 'carrossel');
    await s.semana.enviarImagem(ORG, c.id, PESSOA, 1, { buffer: png(1080, 1350), mimetype: 'image/png' });
    c.status = 'aprovada';
    const r = await s.semana.editar(ORG, c.id, PESSOA, {
      palavraChave: 'CUSTO',
      slides: [{ titulo: 'Capa nova', texto: '' }, { titulo: 'a', texto: `b ${GMAIL}` }, { titulo: 'c', texto: 'd' }],
    });
    const p = r.materias[0].pecas.carrossel!;
    expect(p.status).toBe('rascunho');
    expect(p.slides?.map((x) => x.titulo)).toEqual(['Capa nova', 'a', 'c', 'Palavra-chave: CUSTO']);
    expect(p.slides?.[1].texto).not.toContain('mail.google');
    expect(p.corpo).toMatch(/Comentário com CUSTO →/);
    expect(p.corpo.match(/Comentário com/g)).toHaveLength(1);
    expect(p.imagens).toEqual([]);
    expect(s.auditoria.find((a) => a.action === 'pauta.semana_peca_editada')).toMatchObject({
      before: { status: 'aprovada' },
      after: { status: 'rascunho', renderDescartado: true },
    });
  });

  it('palavra de outra matéria é 409; campo de outro formato é 400; publicada e descartada não mudam', async () => {
    const { s, da } = await gerado();
    await expect(s.semana.editar(ORG, da('c1', 'carrossel').id, PESSOA, { palavraChave: 'PLANILHA' })).rejects.toThrow(ConflictException);
    await expect(s.semana.editar(ORG, da('c1', 'story').id, PESSOA, { inicio: 1, fim: 20 })).rejects.toThrow(/Story não tem inicio, fim/);
    da('c1', 'story').status = 'publicada';
    await expect(s.semana.editar(ORG, da('c1', 'story').id, PESSOA, { texto: 'x' })).rejects.toThrow(/já publicada/);
    da('c2', 'story').status = 'descartada';
    await expect(s.semana.editar(ORG, da('c2', 'story').id, PESSOA, { texto: 'x' })).rejects.toThrow(/descartada/);
    await expect(s.semana.editar(ORG, 'nada', PESSOA, { texto: 'x' })).rejects.toThrow(NotFoundException);
  });

  it('o corte editado é conferido (menos de 3 min, dentro do vídeo), refaz o trecho e esquece o mp4 anterior', async () => {
    const { s, da } = await gerado();
    const c = da('c1', 'corte');
    await s.semana.registrarVideo(ORG, c.id, PESSOA, { arquivo: '/Users/pedro/Movies/ep-04-m1-corte.mp4', duracaoSeg: 60.02, largura: 1080, altura: 1920, bytes: 9_000_000 });
    await expect(s.semana.editar(ORG, c.id, PESSOA, { inicio: 10, fim: 10 + PAUTA_CORTE_MAXIMO_SEG })).rejects.toThrow(/menos de 3 minutos/);
    await expect(s.semana.editar(ORG, c.id, PESSOA, { inicio: 370, fim: 395 })).rejects.toThrow(/passa do fim/);
    const r = await s.semana.editar(ORG, c.id, PESSOA, { inicio: 35, fim: 80.4, legenda: 'Nova legenda' });
    expect(r.materias[0].pecas.corte).toMatchObject({ inicio: 35, fim: 80.4, corpo: expect.stringMatching(/^Nova legenda\n\nComentário com PRECO →/), video: null });
    expect(r.materias[0].pecas.corte?.trecho).toMatch(/^Na prática, a mesma automação/);
  });

  it('editar só a legenda ou o título do corte mantém o mp4; o mesmo trecho reenviado também; o trecho novo refaz de/até', async () => {
    const { s, da } = await gerado();
    const c = da('c1', 'corte');
    const video = { arquivo: '/Users/pedro/Movies/ep-04-m1-corte.mp4', duracaoSeg: 60, largura: 1080 as const, altura: 1920 as const, bytes: 9_000_000 };
    await s.semana.registrarVideo(ORG, c.id, PESSOA, video);
    const r = await s.semana.editar(ORG, c.id, PESSOA, { legenda: 'Legenda nova', titulo: 'Gancho novo' });
    expect(r.materias[0].pecas.corte).toMatchObject({ titulo: 'Gancho novo', video: expect.objectContaining({ arquivo: video.arquivo }) });
    // A linha do CTA se refaz uma vez só no fim da legenda editada.
    expect(r.materias[0].pecas.corte?.corpo).toBe('Legenda nova\n\nComentário com PRECO → o link da matéria e o episódio completo no direct.');
    const r2 = await s.semana.editar(ORG, c.id, PESSOA, { inicio: 20.405, fim: 80.4, legenda: 'De novo' });
    expect(r2.materias[0].pecas.corte?.video).not.toBeNull();
    expect(s.auditoria.filter((a) => a.action === 'pauta.semana_peca_editada').map((a) => (a.after as { renderDescartado: boolean }).renderDescartado)).toEqual([false, false]);

    await s.semana.editar(ORG, c.id, PESSOA, { inicio: 35, fim: 80.4 });
    expect(meta(c)).toMatchObject({ inicio: 35, fim: 80.4, de: 4, ate: 5, video: null });
    expect(s.travas.filter((t) => t === 'pauta-semana:e1').length).toBeGreaterThanOrEqual(3 + 4);
  });

  it('o PNG que chega depois de uma edição é do texto velho: 409, e a edição fica', async () => {
    const { s, da } = await gerado();
    const story = da('c1', 'story');
    const put = s.semana['storage'].put.bind(s.semana['storage']);
    (s.semana['storage'] as { put: unknown }).put = async (chave: string, corpo: Buffer, tipo: string) => {
      await put(chave, corpo, tipo);
      story.corpo = 'Texto editado no meio';
    };
    await expect(s.semana.enviarImagem(ORG, story.id, PESSOA, 1, { buffer: png(1080, 1920), mimetype: 'image/png' })).rejects.toThrow(/renderize de novo/);
    expect(story.corpo).toBe('Texto editado no meio');
    expect(meta(story).imagens).toEqual([]);
  });

  it('agendado ainda edita (MD8: a peça sai do lote e da agenda); concluído não muda; o render ainda sobe', async () => {
    const { s, da } = await gerado();
    s.lista[0].status = 'agendado';
    await s.semana.editar(ORG, da('c1', 'story').id, PESSOA, { texto: 'Texto de depois da assinatura' });
    expect(da('c1', 'story').corpo).toBe('Texto de depois da assinatura');
    s.lista[0].status = 'concluido';
    await expect(s.semana.editar(ORG, da('c1', 'story').id, PESSOA, { texto: 'x' })).rejects.toThrow(/já foi concluído/);
    const r = await s.semana.enviarImagem(ORG, da('c1', 'story').id, PESSOA, 1, { buffer: png(1080, 1920), mimetype: 'image/png' });
    expect(r.imagens).toHaveLength(1);
  });

  it('o PNG do slide e do story vai ao storage com o hash no nome; tamanho errado, slide que não existe e corte são 400', async () => {
    const { s, da } = await gerado();
    const story = da('c1', 'story');
    const r = await s.semana.enviarImagem(ORG, story.id, PESSOA, 1, { buffer: png(1080, 1920), mimetype: 'image/png' });
    expect(r.imagens).toEqual([expect.objectContaining({ n: 1, largura: 1080, altura: 1920 })]);
    const chave = (meta(story).imagens as Array<{ chave: string }>)[0].chave;
    expect(chave).toMatch(new RegExp(`^pauta/peca/${story.id}-1-[0-9a-f]{12}\\.png$`));
    expect(Object.keys(s.guardados)).toEqual([chave]);
    const img = await s.semana.imagem(ORG, story.id, 1);
    expect(img.size).toBe(64);

    await expect(s.semana.enviarImagem(ORG, story.id, PESSOA, 2, { buffer: png(1080, 1920), mimetype: 'image/png' })).rejects.toThrow(/não há a 2/);
    await expect(s.semana.enviarImagem(ORG, da('c1', 'carrossel').id, PESSOA, 1, { buffer: png(1080, 1920), mimetype: 'image/png' })).rejects.toThrow(/1080×1350/);
    await expect(s.semana.enviarImagem(ORG, da('c1', 'carrossel').id, PESSOA, 6, { buffer: png(1080, 1350), mimetype: 'image/png' })).rejects.toThrow(/não há a 6/);
    await expect(s.semana.enviarImagem(ORG, da('c1', 'corte').id, PESSOA, 1, { buffer: png(1080, 1920), mimetype: 'image/png' })).rejects.toThrow(/video\/arquivo/);
    await expect(s.semana.imagem(ORG, da('c2', 'story').id, 1)).rejects.toThrow(NotFoundException);
  });

  it('o mp4 do corte fica no Mac: a peça guarda o caminho; a duração tem de bater com o trecho; o RASTRO só leva o nome', async () => {
    const { s, da } = await gerado();
    const c = da('c2', 'corte');
    const corpo = { arquivo: '/Users/pedro/Movies/OBS/ep-04-semana/ep-04-m2-corte.mp4', duracaoSeg: 109, largura: 1080 as const, altura: 1920 as const, bytes: 20_000_000 };
    await expect(s.semana.registrarVideo(ORG, c.id, PESSOA, { ...corpo, duracaoSeg: 60 })).rejects.toThrow(/renderize o corte de novo/);
    const r = await s.semana.registrarVideo(ORG, c.id, PESSOA, corpo);
    expect(r.video).toMatchObject({ arquivo: corpo.arquivo, duracaoSeg: 109 });
    expect(s.auditoria.find((a) => a.action === 'pauta.semana_video')?.after).toEqual({ arquivo: 'ep-04-m2-corte.mp4', duracaoSeg: 109, bytes: 20_000_000 });
    await expect(s.semana.registrarVideo(ORG, da('c2', 'story').id, PESSOA, corpo)).rejects.toThrow(/Só o corte/);
  });

  it('mídia refeita: o mp4 e o frame da peça gerada da transcrição antiga são 409, mesmo com a duração batendo', async () => {
    const { s, da } = await gerado();
    // A edição B: outra fala, 40 s mais curta, e o trecho da matéria 2 continua cabendo nela.
    const e = s.lista[0] as unknown as { transcricao: Array<{ inicio: number; fim: number; texto: string }> };
    e.transcricao = e.transcricao.slice(0, -1).map((t) => ({ ...t, texto: `${t.texto} (tomada B)` }));
    const c = da('c2', 'corte');
    const corpo = { arquivo: '/Users/pedro/Movies/OBS/ep-04-semana/ep-04-m2-corte.mp4', duracaoSeg: 109, largura: 1080 as const, altura: 1920 as const, bytes: 20_000_000 };
    await expect(s.semana.registrarVideo(ORG, c.id, PESSOA, corpo)).rejects.toThrow(ConflictException);
    await expect(s.semana.registrarVideo(ORG, c.id, PESSOA, corpo)).rejects.toThrow(/transcrição mudou/);
    expect(meta(c).video ?? null).toBeNull();
    await expect(s.semana.enviarImagem(ORG, da('c2', 'story').id, PESSOA, 1, { buffer: png(1080, 1920), mimetype: 'image/png' })).rejects.toThrow(/transcrição mudou/);
    // O carrossel não tem tempo do vídeo: o PNG dele segue aceito.
    const r = await s.semana.enviarImagem(ORG, da('c2', 'carrossel').id, PESSOA, 1, { buffer: png(1080, 1350), mimetype: 'image/png' });
    expect(r.imagens.map((i) => i.n)).toEqual([1]);
  });
});

describe('semana: o JPEG ao lado do PNG e o mp4 do corte no storage (MD4)', () => {
  async function gerado() {
    const s = servico();
    await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    const da = (item: string, f: string) => s.pecas.find((p) => meta(p).itemId === item && p.formato === f)!;
    return { s, da };
  }
  const envio = (b: Buffer, o: { sha?: string; bytes?: number } = {}) => ({ corpo: Readable.from([b]), bytes: o.bytes ?? b.length, sha256: o.sha ?? sha256(b) });

  it('o JPEG sobe ao lado do PNG, com o .jpg e o sha256 inteiro; a tela separa os dois e a prévia continua o PNG', async () => {
    const { s, da } = await gerado();
    const story = da('c1', 'story');
    await s.semana.enviarImagem(ORG, story.id, PESSOA, 1, { buffer: png(1080, 1920), mimetype: 'image/png' });
    const jpg = jpegDeTeste(1080, 1920);
    const r = await s.semana.enviarImagem(ORG, story.id, PESSOA, 1, { buffer: jpg, mimetype: 'image/jpeg' });
    expect(r.imagens).toEqual([expect.objectContaining({ n: 1, largura: 1080, altura: 1920, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })]);
    expect(r.jpegs).toEqual([expect.objectContaining({ n: 1, bytes: jpg.length, sha256: sha256(jpg) })]);
    const chaves = (meta(story).imagens as Array<{ chave: string }>).map((i) => i.chave);
    expect(chaves).toEqual([expect.stringMatching(/-1-[0-9a-f]{12}\.jpg$/), expect.stringMatching(/-1-[0-9a-f]{12}\.png$/)]);
    expect((await s.semana.imagem(ORG, story.id, 1)).contentType).toBe('image/png');
    expect(await s.semana.imagem(ORG, story.id, 1, 'jpeg')).toMatchObject({ contentType: 'image/jpeg', size: jpg.length });
    // O mesmo número e tipo de novo substitui, não duplica.
    await s.semana.enviarImagem(ORG, story.id, PESSOA, 1, { buffer: jpegDeTeste(1080, 1920, { total: 99 }), mimetype: 'image/jpeg' });
    expect(meta(story).imagens as unknown[]).toHaveLength(2);
  });

  it('JPEG inválido é 400: proporção de outro formato, largura acima de 1440, assinatura de PNG', async () => {
    const { s, da } = await gerado();
    const car = da('c1', 'carrossel');
    await expect(s.semana.enviarImagem(ORG, car.id, PESSOA, 1, { buffer: jpegDeTeste(1080, 1920), mimetype: 'image/jpeg' })).rejects.toThrow(/1080×1350/);
    await expect(s.semana.enviarImagem(ORG, car.id, PESSOA, 1, { buffer: jpegDeTeste(1600, 2000), mimetype: 'image/jpeg' })).rejects.toThrow(/320 a 1440/);
    await expect(s.semana.enviarImagem(ORG, car.id, PESSOA, 1, { buffer: png(1080, 1350), mimetype: 'image/jpeg' })).rejects.toThrow(/não é um JPEG/);
    const r = await s.semana.enviarImagem(ORG, car.id, PESSOA, 2, { buffer: jpegDeTeste(1080, 1350), mimetype: 'image/jpeg' });
    expect(r.jpegs?.map((j) => j.n)).toEqual([2]);
    expect(r.imagens).toEqual([]);
  });

  it('o mp4 com faststart sobe por stream: a chave leva o sha inteiro, a peça grava o sha e mantém o caminho do Mac', async () => {
    const { s, da } = await gerado();
    const c = da('c1', 'corte');
    await s.semana.registrarVideo(ORG, c.id, PESSOA, { arquivo: '/Users/pedro/Movies/ep-04-m1-corte.mp4', duracaoSeg: 60.02, largura: 1080, altura: 1920, bytes: 9_000_000 });
    const mp4 = mp4DeTeste({ duracaoSeg: 60 });
    const r = await s.semana.enviarVideo(ORG, c.id, PESSOA, envio(mp4));
    expect(r.video).toMatchObject({
      arquivo: '/Users/pedro/Movies/ep-04-m1-corte.mp4',
      chave: `pauta/pecas/${c.id}/corte-${sha256(mp4)}.mp4`,
      sha256: sha256(mp4),
      bytes: mp4.length,
      duracaoSeg: 60,
      registradoEm: expect.any(String),
      enviadoEm: expect.any(String),
    });
    expect(s.guardados[`pauta/pecas/${c.id}/corte-${sha256(mp4)}.mp4`]).toEqual(mp4);
    expect(s.auditoria.find((a) => a.action === 'pauta.semana_video_enviado')?.after).toEqual({ bytes: mp4.length, duracaoSeg: 60, sha: sha256(mp4).slice(0, 12) });
    const baixado = await s.semana.video(ORG, c.id);
    expect(baixado.size).toBe(mp4.length);
    // Reenviar o mesmo arquivo cai na mesma chave.
    await s.semana.enviarVideo(ORG, c.id, PESSOA, envio(mp4));
    expect(Object.keys(s.guardados).filter((k) => k.endsWith('.mp4'))).toHaveLength(1);
    // Registrar um render novo do Mac tira o envio anterior: é outro arquivo até ele subir.
    const r2 = await s.semana.registrarVideo(ORG, c.id, PESSOA, { arquivo: '/Users/pedro/Movies/ep-04-m1-corte.mp4', duracaoSeg: 60, largura: 1080, altura: 1920, bytes: 1 });
    expect(r2.video?.sha256).toBeUndefined();
    await expect(s.semana.video(ORG, c.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sem faststart é 400; de outro trecho ou de outro tamanho, 400 no moov; corpo maior que o declarado aborta; nada vai ao storage', async () => {
    const { s, da } = await gerado();
    const c = da('c1', 'corte');
    const semFast = mp4DeTeste({ faststart: false });
    await expect(s.semana.enviarVideo(ORG, c.id, PESSOA, envio(semFast))).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/faststart/) });
    await expect(s.semana.enviarVideo(ORG, c.id, PESSOA, envio(mp4DeTeste({ duracaoSeg: 30 })))).rejects.toThrow(/renderize o corte de novo/);
    await expect(s.semana.enviarVideo(ORG, c.id, PESSOA, envio(mp4DeTeste({ largura: 1920, altura: 1080 })))).rejects.toThrow(/1920×1080; é 1080×1920/);
    const mp4 = mp4DeTeste();
    const maior = Buffer.concat([mp4, Buffer.alloc(100)]);
    await expect(s.semana.enviarVideo(ORG, c.id, PESSOA, { corpo: Readable.from([maior]), bytes: mp4.length, sha256: sha256(mp4) })).rejects.toMatchObject({ status: 413 });
    await expect(s.semana.enviarVideo(ORG, c.id, PESSOA, envio(mp4, { sha: 'f'.repeat(64) }))).rejects.toThrow(/sha256/);
    expect(Object.keys(s.guardados).filter((k) => k.endsWith('.mp4'))).toEqual([]);
    expect(meta(c).video ?? null).toBeNull();
  });

  it('editar o título ou a legenda enquanto o mp4 sobe não derruba o envio; mudar o trecho derruba (409)', async () => {
    const { s, da } = await gerado();
    const c = da('c1', 'corte');
    const storage = s.semana['storage'] as unknown as { putStream: (...a: unknown[]) => Promise<void> };
    const original = storage.putStream;
    let enquantoSobe = () => {};
    storage.putStream = async (...a: unknown[]) => {
      await original(...a);
      enquantoSobe();
    };
    enquantoSobe = () => {
      c.titulo = 'Outro título';
      c.corpo = 'Legenda nova';
    };
    const mp4 = mp4DeTeste({ duracaoSeg: 60 });
    expect((await s.semana.enviarVideo(ORG, c.id, PESSOA, envio(mp4))).video?.sha256).toBe(sha256(mp4));
    enquantoSobe = () => {
      c.meta = { ...meta(c), inicio: Number(meta(c).inicio) + 1 };
    };
    await expect(s.semana.enviarVideo(ORG, c.id, PESSOA, envio(mp4DeTeste({ duracaoSeg: 60, mdat: 100 })))).rejects.toThrow(/O trecho da peça mudou/);
    expect(meta(c).video).toMatchObject({ sha256: sha256(mp4) });
  });

  it('o que se recusa sem ler o corpo: story, descartada e transcrição que mudou', async () => {
    const { s, da } = await gerado();
    let lido = false;
    const corpo = new Readable({ read() { lido = true; this.push(null); } });
    await expect(s.semana.enviarVideo(ORG, da('c1', 'story').id, PESSOA, { corpo, bytes: 100, sha256: 'a'.repeat(64) })).rejects.toThrow(/Só o corte/);
    da('c2', 'corte').status = 'descartada';
    await expect(s.semana.enviarVideo(ORG, da('c2', 'corte').id, PESSOA, { corpo, bytes: 100, sha256: 'a'.repeat(64) })).rejects.toThrow(/descartada/);
    const e = s.lista[0] as unknown as { transcricao: Array<{ texto: string }> };
    e.transcricao = e.transcricao.map((t) => ({ ...t, texto: `${t.texto} (B)` }));
    await expect(s.semana.enviarVideo(ORG, da('c1', 'corte').id, PESSOA, { corpo, bytes: 100, sha256: 'a'.repeat(64) })).rejects.toThrow(/transcrição mudou/);
    expect(lido).toBe(false);
  });

  it('o controller: Content-Length acima do teto é 413 ANTES de ler, com Connection: close; sem sha, 400; tipo errado, 415', async () => {
    const chamadas: unknown[] = [];
    const c = new DerivacaoController({ enviarVideo: async (...a: unknown[]) => void chamadas.push(a) } as unknown as DerivacaoService);
    const pedido = (headers: Record<string, string>) => {
      const req = Object.assign(new Readable({ read() { throw new Error('leu o corpo'); } }), { headers });
      const cab = new Map<string, string>();
      return { req, res: { setHeader: (k: string, v: string) => cab.set(k, v) }, cab };
    };
    const certo = { 'content-type': 'video/mp4', 'content-length': '5000', 'x-conteudo-sha256': 'a'.repeat(64) };
    for (const [h, status] of [
      [{ ...certo, 'content-length': String(301 * 1024 * 1024) }, 413],
      [{ ...certo, 'x-conteudo-sha256': '' }, 400],
      [{ ...certo, 'content-type': 'application/octet-stream' }, 415],
      [{ 'content-type': 'video/mp4', 'x-conteudo-sha256': 'a'.repeat(64) }, 411],
    ] as const) {
      const { req, res, cab } = pedido(h as Record<string, string>);
      await expect(c.enviarVideo({ sub: PESSOA, orgId: ORG } as never, 'p1', req as never, res as never)).rejects.toMatchObject({ status });
      expect(cab.get('Connection')).toBe('close');
    }
    expect(chamadas).toEqual([]);
    const { req, res } = pedido(certo);
    await c.enviarVideo({ sub: PESSOA, orgId: ORG } as never, 'p1', req as never, res as never);
    expect(chamadas).toEqual([[ORG, 'p1', PESSOA, { bytes: 5000, sha256: 'a'.repeat(64), corpo: req }]]);
  });

  it('carrossel com mais de 10 slides não se aprova', async () => {
    const { s, da } = await gerado();
    const pecaDb = s.prisma as unknown as { pautaPeca: Record<string, unknown> };
    pecaDb.pautaPeca.update = async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const p = s.pecas.find((x) => x.id === where.id)!;
      Object.assign(p, data);
      return structuredClone(p);
    };
    const rotinas = new RotinaService(s.prisma, new AuditService(s.prisma), {} as never);
    const car = da('c1', 'carrossel');
    (meta(car) as { slides: unknown[] }).slides = Array.from({ length: 11 }, (_, i) => ({ titulo: `s${i}`, texto: '' }));
    await expect(rotinas.editarPeca(ORG, car.id, PESSOA, { status: 'aprovada' })).rejects.toThrow(/11 slides e o Instagram aceita até 10/);
    expect(car.status).toBe('rascunho');
    (meta(car) as { slides: unknown[] }).slides.length = 10;
    await expect(rotinas.editarPeca(ORG, car.id, PESSOA, { status: 'aprovada' })).resolves.toEqual({ ok: true, status: 'aprovada' });
  });
});

// ---------------------------------------------------------------------------
// MD13: o corte com nota e motivo
// ---------------------------------------------------------------------------

/**
 * O modelo da MD13: três trechos por matéria, fora da ordem da nota. O do meio
 * (começa um segmento depois) tem a maior nota; a nota em texto com vírgula
 * também vale.
 */
function respostaComCandidatos(n: number, candidatos?: unknown[]): string {
  const [a, b] = CORTES[n];
  const base = JSON.parse(respostaDaIa(n)) as Record<string, unknown>;
  return JSON.stringify({
    ...base,
    corte: {
      legenda: `O trecho da matéria ${n}.`,
      candidatos: candidatos ?? [
        { titulo: `Inteiro ${n}`, de: a, ate: b, nota: 6, motivo: 'A fala fecha, mas o começo demora a chegar no número.' },
        { titulo: `Direto ${n}`, de: a + 1, ate: b, nota: 8.5, motivo: 'Gancho no primeiro segundo e a ideia fecha.' },
        { titulo: `Começo ${n}`, de: a, ate: b - 1, nota: '7,2', motivo: 'Abre bem, mas termina antes do exemplo.' },
      ],
    },
  });
}

describe('semana: o corte com nota e motivo (MD13)', () => {
  const ctx = { segmentos: SEGMENTOS, duracaoSeg: DURACAO, tituloPadrao: 'Matéria' };

  it('a nota fica entre 0 e 10 com uma casa; texto com vírgula vale; o que não é número é nula', () => {
    expect(notaDoCorte(8.46)).toBe(8.5);
    expect(notaDoCorte('7,2')).toBe(7.2);
    expect(notaDoCorte(14)).toBe(10);
    expect(notaDoCorte(-3)).toBe(0);
    expect(notaDoCorte('alta')).toBeNull();
    expect(notaDoCorte(undefined)).toBeNull();
    expect(notaDoCorte('')).toBeNull();
  });

  it('3 candidatos: cada um conferido, em ordem de nota, e o de maior nota vira o corte com o motivo', () => {
    const m = montarDerivacao(respostaComCandidatos(1), { item: ITENS[0], segmentos: SEGMENTOS, duracaoSeg: DURACAO });
    expect(m.cortesCandidatos.map((c) => [c.titulo, c.nota, c.inicio, c.fim])).toEqual([
      ['Direto 1', 8.5, 35, 80.4],
      ['Começo 1', 7.2, 20.4, 57.9],
      ['Inteiro 1', 6, 20.4, 80.4],
    ]);
    expect(m.corte).toMatchObject({ titulo: 'Direto 1', nota: 8.5, motivo: 'Gancho no primeiro segundo e a ideia fecha.', inicio: 35, fim: 80.4, corpo: 'O trecho da matéria 1.' });
    expect(m.corte?.trecho).toMatch(/^Na prática/);
    // O frame do story sai do corte escolhido.
    expect(m.story?.tempoSeg).toBe(35);
    expect(m.avisos).toEqual([]);
  });

  it('candidato inválido sai com o motivo, o repetido sai, o quarto não entra; sem nota fica por último', () => {
    const r = candidatosDoCorte(
      {
        titulo: 'Gancho geral',
        candidatos: [
          { de: 5, ate: 3, nota: 9, motivo: 'fora de ordem' },
          { de: 3, ate: 5, motivo: 'sem nota' },
          { de: 3, ate: 99, nota: 10 },
          { de: 3, ate: 5, nota: 2 },
        ],
      },
      ctx,
    );
    expect(r.candidatos).toHaveLength(1);
    expect(r.candidatos[0]).toMatchObject({ inicio: 20.4, fim: 80.4, nota: null, titulo: 'Gancho geral', motivo: 'sem nota' });
    expect(r.avisos).toEqual([
      'o modelo devolveu 4 candidatos; ficaram os 3 primeiros',
      'o candidato 1 ficou de fora: o corte está fora de ordem (de 5 até 3)',
      'o candidato 3 ficou de fora: o corte aponta segmento que não existe (de 3 até 99; são 13)',
    ]);
    const repetido = candidatosDoCorte({ candidatos: [{ de: 3, ate: 5, nota: 4 }, { de: 3, ate: 5, nota: 7, titulo: 'Melhor' }] }, ctx);
    expect(repetido.candidatos.map((c) => [c.titulo, c.nota])).toEqual([['Melhor', 7]]);
    expect(repetido.avisos).toEqual(['o candidato 1 repetia o trecho de outro e ficou de fora']);
    // Nenhum de pé: o corte não sai, o resto da matéria sai, e o aviso diz por quê.
    const m = montarDerivacao(respostaComCandidatos(2, [{ de: 8, ate: 6, nota: 9 }, { de: 0, ate: 1, nota: 8 }]), {
      item: ITENS[1],
      segmentos: SEGMENTOS,
      duracaoSeg: DURACAO,
    });
    expect(m.corte).toBeNull();
    expect(m.cortesCandidatos).toEqual([]);
    expect(m.carrossel).not.toBeNull();
    expect(m.avisos).toContain('Corte: o candidato 1 ficou de fora: o corte está fora de ordem (de 8 até 6).');
    expect(candidatosDoCorte({ candidatos: [] }, ctx)).toEqual({ candidatos: [], avisos: ['o modelo não devolveu candidato'] });
  });

  it('a resposta antiga (de/até no próprio corte) é um candidato sem nota; o prompt pede os 3 com nota e motivo', () => {
    const m = montarDerivacao(respostaDaIa(1), { item: ITENS[0], segmentos: SEGMENTOS, duracaoSeg: DURACAO });
    expect(m.cortesCandidatos).toHaveLength(1);
    expect(m.corte).toMatchObject({ titulo: 'Corte 1', nota: null, motivo: '', inicio: 20.4 });
    const system = systemDaDerivacao('');
    expect(system).toContain('"candidatos"');
    expect(system).toContain('"nota": number');
    expect(system).toMatch(/gancho nos 3 primeiros segundos/);
    expect(system).toMatch(/referência a slide/);
  });

  it('o schema: candidato de 1 a 3, e nunca junto com o trecho editado à mão', () => {
    expect(PautaPecaDaSemanaEditarSchema.safeParse({ candidato: 2 }).success).toBe(true);
    expect(PautaPecaDaSemanaEditarSchema.safeParse({ candidato: 4 }).success).toBe(false);
    expect(PautaPecaDaSemanaEditarSchema.safeParse({ candidato: 0 }).success).toBe(false);
    expect(PautaPecaDaSemanaEditarSchema.safeParse({ candidato: 1, inicio: 1, fim: 20 }).success).toBe(false);
  });

  it('gerar: cada matéria sai com 3 candidatos na meta e o de maior nota como o corte da peça', async () => {
    const s = servico({ resposta: (n) => respostaComCandidatos(n) });
    const r = await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    for (const m of r.materias) {
      const c = m.pecas.corte!;
      expect(c.candidatos).toHaveLength(3);
      expect(c.candidatos?.map((x) => x.nota)).toEqual([8.5, 7.2, 6]);
      expect(c.candidatos?.map((x) => x.atual)).toEqual([true, false, false]);
      expect(c.titulo).toBe(`Direto ${m.n}`);
      expect(c.inicio).toBe(c.candidatos?.[0].inicio);
    }
    const guardado = meta(s.pecas.find((p) => p.formato === 'corte' && meta(p).itemId === 'c1')!);
    expect(guardado.cortesCandidatos).toEqual([
      expect.objectContaining({ titulo: 'Direto 1', nota: 8.5, motivo: 'Gancho no primeiro segundo e a ideia fecha.', de: 4, ate: 5, trecho: expect.stringMatching(/^Na prática/) }),
      expect.objectContaining({ titulo: 'Começo 1', nota: 7.2 }),
      expect.objectContaining({ titulo: 'Inteiro 1', nota: 6 }),
    ]);
  });

  it('trocar o candidato: o trecho e o gancho mudam, o mp4 sai da peça (e fica no storage), a peça volta ao rascunho e o render a pendente', async () => {
    const s = servico({ resposta: (n) => respostaComCandidatos(n) });
    await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    const c = s.pecas.find((p) => p.formato === 'corte' && meta(p).itemId === 'c1')!;
    const mp4 = mp4DeTeste({ duracaoSeg: 45.4 });
    await s.semana.enviarVideo(ORG, c.id, PESSOA, { corpo: Readable.from([mp4]), bytes: mp4.length, sha256: sha256(mp4) });
    c.status = 'aprovada';
    const pendente = () => renderPendente(structuredClone(s.pecas.filter((x) => x.id === c.id)), { id: 'e1', numero: 4, sha: shaDaTranscricao(SEGMENTOS) }).corte;
    expect(pendente()).toBeUndefined();

    const r = await s.semana.editar(ORG, c.id, PESSOA, { candidato: 3 });
    const p = r.materias[0].pecas.corte!;
    expect(p).toMatchObject({ status: 'rascunho', titulo: 'Inteiro 1', inicio: 20.4, fim: 80.4, video: null });
    expect(p.trecho).toContain('o preço dos modelos caiu pela metade');
    expect(p.candidatos?.map((x) => x.atual)).toEqual([false, false, true]);
    expect(meta(c)).toMatchObject({ de: 3, ate: 5 });
    // Desassociar não é apagar: o mp4 anterior continua no storage.
    expect(s.guardados[`pauta/pecas/${c.id}/corte-${sha256(mp4)}.mp4`]).toEqual(mp4);
    expect(pendente()).toMatchObject({ pecas: 1 });
    // O RASTRO diz de que trecho saiu e para qual foi, e que o gancho do candidato trocou o título.
    expect(s.auditoria.filter((a) => a.action === 'pauta.semana_peca_editada').at(-1)).toMatchObject({
      before: { status: 'aprovada', formato: 'corte', trecho: { inicio: 35, fim: 80.4 } },
      after: { status: 'rascunho', campos: ['candidato', 'titulo'], trecho: { inicio: 20.4, fim: 80.4 }, renderDescartado: true, candidato: { n: 3, nota: 6 } },
    });

    // Voltar ao de maior nota, com o gancho escrito à mão: o título pedido vale.
    const r2 = await s.semana.editar(ORG, c.id, PESSOA, { candidato: 1, titulo: 'Gancho meu' });
    expect(r2.materias[0].pecas.corte).toMatchObject({ titulo: 'Gancho meu', inicio: 35, fim: 80.4 });
    // O trecho editado à mão não é candidato nenhum; os candidatos continuam lá.
    const r3 = await s.semana.editar(ORG, c.id, PESSOA, { inicio: 21, fim: 57.9 });
    expect(r3.materias[0].pecas.corte?.candidatos?.map((x) => x.atual)).toEqual([false, false, false]);
  });

  it('a legenda que o modelo pôs dentro do candidato é a do escolhido, não a do primeiro da lista', () => {
    const base = JSON.parse(respostaDaIa(1)) as Record<string, unknown>;
    const resposta = JSON.stringify({
      ...base,
      corte: {
        candidatos: [
          { titulo: 'Fraco', de: 3, ate: 5, nota: 4, legenda: 'Legenda do fraco.' },
          { titulo: 'Forte', de: 4, ate: 5, nota: 9, legenda: 'Legenda do forte.' },
        ],
      },
    });
    const m = montarDerivacao(resposta, { item: ITENS[0], segmentos: SEGMENTOS, duracaoSeg: DURACAO });
    expect(m.corte).toMatchObject({ titulo: 'Forte', corpo: 'Legenda do forte.' });
    expect(systemDaDerivacao('')).toContain(`até ${PAUTA_TETO_DO_MOTIVO_DO_CORTE} caracteres: por que essa nota`);
  });

  it('trocar e voltar ao trecho já renderizado muda a assinatura do render: o vigia não pula o corte por 24 h', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-25T10:00:00Z'));
      const s = servico({ resposta: (n) => respostaComCandidatos(n) });
      await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
      const c = s.pecas.find((p) => p.formato === 'corte' && meta(p).itemId === 'c1')!;
      const ep = { id: 'e1', numero: 4, sha: shaDaTranscricao(SEGMENTOS) };
      const pendente = () => renderPendente(structuredClone(s.pecas.filter((x) => x.formato === 'corte')), ep).corte;
      const subir = async (duracaoSeg: number) => {
        const mp4 = mp4DeTeste({ duracaoSeg });
        await s.semana.enviarVideo(ORG, c.id, PESSOA, { corpo: Readable.from([mp4]), bytes: mp4.length, sha256: sha256(mp4) });
      };

      await s.semana.editar(ORG, c.id, PESSOA, { candidato: 3 });
      const noTres = pendente()!;
      // O vigia tenta o 3 (a memória guarda a assinatura) e o render dá certo.
      const memoria = { notificacoes: {}, brutosQueFalharam: {}, renders: { [chaveDoRender('e1', 'corte')]: { assinatura: noTres.assinatura, em: Date.now() } } };
      await subir(60);
      vi.setSystemTime(new Date('2026-09-25T10:05:00Z'));
      await s.semana.editar(ORG, c.id, PESSOA, { candidato: 1 });
      vi.setSystemTime(new Date('2026-09-25T10:06:00Z'));
      await s.semana.editar(ORG, c.id, PESSOA, { candidato: 3 });

      const deVolta = pendente()!;
      expect(deVolta.assinatura).not.toBe(noTres.assinatura);
      expect(rendersAFazer({ id: 'e1', precisaDeRender: { corte: deVolta } }, memoria, Date.now())).toEqual([
        { formato: 'corte', pecas: deVolta.pecas, assinatura: deVolta.assinatura },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('o mp4 de outro trecho com a mesma duração é recusado (409) quando o Mac diz o que renderizou; o Mac antigo segue só pela duração', async () => {
    // Dois candidatos de 22,9 s e 22,2 s: a duração sozinha não os separa.
    const s = servico({
      resposta: (n) => respostaComCandidatos(n, [{ titulo: 'A', de: 4, ate: 4, nota: 9 }, { titulo: 'B', de: 5, ate: 5, nota: 8 }]),
    });
    await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    const c = s.pecas.find((p) => p.formato === 'corte' && meta(p).itemId === 'c1')!;
    expect(meta(c)).toMatchObject({ inicio: 35, fim: 57.9 });
    // O vigia leu a semana e renderiza o A; a pessoa troca para o B no meio.
    const doA = { inicio: 35, fim: 57.9 };
    await s.semana.editar(ORG, c.id, PESSOA, { candidato: 2 });
    const video = { arquivo: '/Users/pedro/Movies/ep-04-m1-corte.mp4', duracaoSeg: 22.9, largura: 1080, altura: 1920, bytes: 9_000_000 } as const;
    await expect(s.semana.registrarVideo(ORG, c.id, PESSOA, { ...video, ...doA })).rejects.toThrow(ConflictException);
    const mp4DoA = mp4DeTeste({ duracaoSeg: 22.9 });
    await expect(
      s.semana.enviarVideo(ORG, c.id, PESSOA, { corpo: Readable.from([mp4DoA]), bytes: mp4DoA.length, sha256: sha256(mp4DoA), trecho: doA }),
    ).rejects.toThrow(/é do trecho 35.0–57.9 s e a peça agora usa 58.2–80.4 s/);
    expect(meta(c).video).toBeNull();

    // O mp4 do B, com o trecho do B, entra.
    const doB = { inicio: 58.2, fim: 80.4 };
    await s.semana.registrarVideo(ORG, c.id, PESSOA, { ...video, duracaoSeg: 22.2, ...doB });
    const mp4DoB = mp4DeTeste({ duracaoSeg: 22.2 });
    await s.semana.enviarVideo(ORG, c.id, PESSOA, { corpo: Readable.from([mp4DoB]), bytes: mp4DoB.length, sha256: sha256(mp4DoB), trecho: doB });
    expect(meta(c).video).toMatchObject({ sha256: sha256(mp4DoB), arquivo: video.arquivo });
    expect(meta(c).video).not.toHaveProperty('inicio');
    // Sem o trecho (o Mac de antes da MD13), a duração dentro de 1 s ainda passa: é o risco que o trecho fecha.
    await s.semana.registrarVideo(ORG, c.id, PESSOA, video);
  });

  it('o trecho renderizado: no PUT vem com início e fim juntos; no envio, pelo cabeçalho início-fim', () => {
    const video = { arquivo: '/x/corte.mp4', duracaoSeg: 22, largura: 1080, altura: 1920, bytes: 10 };
    expect(PautaVideoDoCorteSchema.safeParse({ ...video, inicio: 1, fim: 23 }).success).toBe(true);
    expect(PautaVideoDoCorteSchema.safeParse({ ...video, inicio: 1 }).success).toBe(false);
    const cab = (extra: Record<string, string>) =>
      conferirCabecalhosDoEnvio({ 'content-type': 'video/mp4', 'content-length': '100', 'x-conteudo-sha256': 'a'.repeat(64), ...extra }, 1_000_000);
    expect(cab({}).trecho).toBeUndefined();
    expect(cab({ [CABECALHO_DO_TRECHO]: '58.2-80.4' }).trecho).toEqual({ inicio: 58.2, fim: 80.4 });
    expect(cab({ [CABECALHO_DO_TRECHO]: '35-57.9' }).trecho).toEqual({ inicio: 35, fim: 57.9 });
    for (const ruim of ['', '80-58', '1e3-2e3', '-1-5', '10', '10-20-30']) {
      expect(() => cab({ [CABECALHO_DO_TRECHO]: ruim })).toThrow(/início-fim em segundos/);
    }
  });

  it('trocar é recusado: candidato que não existe, formato sem candidato, transcrição refeita', async () => {
    const s = servico({ resposta: (n) => (n === 2 ? respostaComCandidatos(n, [{ de: 6, ate: 8, nota: 7 }]) : respostaComCandidatos(n)) });
    await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    const da = (item: string, f: string) => s.pecas.find((p) => meta(p).itemId === item && p.formato === f)!;
    await expect(s.semana.editar(ORG, da('c2', 'corte').id, PESSOA, { candidato: 2 })).rejects.toThrow(/tem 1 candidato\(s\): não há o 2/);
    await expect(s.semana.editar(ORG, da('c1', 'story').id, PESSOA, { candidato: 1 })).rejects.toThrow(/Story não tem candidato/);
    const e = s.lista[0] as unknown as { transcricao: Array<{ inicio: number; fim: number; texto: string }> };
    e.transcricao = e.transcricao.map((t) => ({ ...t, texto: `${t.texto} (tomada B)` }));
    const antes = structuredClone(meta(da('c1', 'corte')));
    await expect(s.semana.editar(ORG, da('c1', 'corte').id, PESSOA, { candidato: 2 })).rejects.toThrow(ConflictException);
    expect(meta(da('c1', 'corte'))).toEqual(antes);
    // O trecho editado à mão na transcrição nova esquece os candidatos da antiga.
    await s.semana.editar(ORG, da('c1', 'corte').id, PESSOA, { inicio: 21, fim: 57.9 });
    expect(meta(da('c1', 'corte')).cortesCandidatos).toEqual([]);
  });
});

describe('semana: convive com a derivação antiga e com o export do carrossel', () => {
  it('as peças da semana não travam "derivar" da rodada', async () => {
    const criadas: Array<Record<string, unknown>> = [];
    const prisma = {
      pautaRodada: {
        findFirst: async () => ({
          id: 'r1', orgId: ORG, status: 'curada', titulo: 'Semana 40', corpo: 'miolo', itens: ITENS, fichasUsadas: [],
          pecas: [{ canal: 'instagram', formato: 'story', status: 'rascunho', meta: { episodioId: 'e1', itemId: 'c1', formato: 'story' } }],
        }),
      },
      pautaReferencia: { findMany: async () => [] },
      pautaPeca: { create: async ({ data }: { data: Record<string, unknown> }) => void criadas.push(data) },
      auditLog: { create: async ({ data }: { data: unknown }) => data },
    } as unknown as PrismaService;
    const llm = {
      name: 'dublê', model: 'd', configured: true,
      complete: async () => JSON.stringify({ whatsapp: { titulo: 'w', corpo: 'w' }, clickup: { titulo: 'c', corpo: 'c' } }),
    } as unknown as LlmProvider;
    const audit = new AuditService(prisma);
    const rodadas = new RodadaService(prisma, audit, {} as never, llm, new VozService(prisma, audit, llm, { porChave: async () => null } as never));
    await rodadas.derivar(ORG, 'r1', PESSOA);
    expect(criadas.map((c) => c.canal)).toEqual(['whatsapp', 'clickup']);
  });

  it('o PATCH da aba Rodadas só muda o status da peça da semana: texto é 400 e aponta o PUT dela', async () => {
    const s = servico();
    await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    const pecaDb = s.prisma as unknown as { pautaPeca: Record<string, unknown> };
    pecaDb.pautaPeca.update = async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const p = s.pecas.find((x) => x.id === where.id)!;
      Object.assign(p, data);
      return structuredClone(p);
    };
    const rotinas = new RotinaService(s.prisma, new AuditService(s.prisma), {} as never);
    const story = s.pecas.find((p) => p.formato === 'story')!;
    await expect(rotinas.editarPeca(ORG, story.id, PESSOA, { corpo: 'outro texto' })).rejects.toThrow(/PUT \/pauta\/pecas\/.*\/semana/);
    await expect(rotinas.editarPeca(ORG, story.id, PESSOA, { titulo: 'x', status: 'aprovada' })).rejects.toThrow(BadRequestException);
    expect(story.status).toBe('rascunho');
    await expect(rotinas.editarPeca(ORG, story.id, PESSOA, { status: 'aprovada' })).resolves.toEqual({ ok: true, status: 'aprovada' });
  });

  it('o export do carrossel leva o CTA da palavra; story e corte não são carrossel', async () => {
    const s = servico();
    await s.semana.gerar(ORG, 'e1', PESSOA, { substituir: false });
    const pub = new PublicacaoService(s.prisma, new AuditService(s.prisma), {} as never, {} as never);
    const car = s.pecas.find((p) => p.formato === 'carrossel')!;
    const x = await pub.exportarCarrossel(ORG, car.id);
    expect(x).toMatchObject({ marca: 'root', palavraChave: 'PRECO', cta: { palavra: 'PRECO' } });
    expect(x.slides).toHaveLength(5);
    expect(x.slides[4]).toMatchObject({ ordem: 5, titulo: 'Palavra-chave: PRECO' });
    await expect(pub.exportarCarrossel(ORG, s.pecas.find((p) => p.formato === 'story')!.id)).rejects.toThrow(/story, não carrossel/);
  });
});

describe('semana: o controller', () => {
  const usuario = { sub: PESSOA, orgId: ORG } as never;

  it('os esquemas chegam antes do serviço; as rotas e as permissões; nenhuma publica', async () => {
    const chamadas: Array<{ metodo: string; args: unknown[] }> = [];
    const anota = (metodo: string) => async (...args: unknown[]) => void chamadas.push({ metodo, args });
    const duble = { painel: anota('painel'), gerar: anota('gerar'), editar: anota('editar'), enviarImagem: anota('enviarImagem'), registrarVideo: anota('registrarVideo'), enviarVideo: anota('enviarVideo') } as unknown as DerivacaoService;
    const c = new DerivacaoController(duble);
    await c.gerar(usuario, 'e1', undefined);
    expect(chamadas[0]).toEqual({ metodo: 'gerar', args: [ORG, 'e1', PESSOA, { substituir: false, itens: undefined }] });
    expect(() => c.editar(usuario, 'p1', { status: 'publicada' })).toThrow();
    expect(() => c.video(usuario, 'p1', { arquivo: 'relativo.mp4', duracaoSeg: 10, largura: 1080, altura: 1920, bytes: 1 })).toThrow();
    expect(() => c.enviarImagem(usuario, 'p1', '0')).toThrow();
    expect(chamadas).toHaveLength(1);

    expect(Reflect.getMetadata('path', DerivacaoController)).toBe('pauta');
    const proto = DerivacaoController.prototype as unknown as Record<string, object>;
    const rotas: Array<[string, string, string[]]> = [
      ['painel', 'episodios/:id/semana', ['pauta.ver']],
      ['gerar', 'episodios/:id/semana/gerar', ['pauta.editar', 'automacoes.executar']],
      ['editar', 'pecas/:id/semana', ['pauta.editar']],
      ['enviarImagem', 'pecas/:id/imagens/:n', ['pauta.editar']],
      ['imagem', 'pecas/:id/imagens/:n', ['pauta.ver']],
      ['video', 'pecas/:id/video', ['pauta.editar']],
      ['enviarVideo', 'pecas/:id/video/arquivo', ['pauta.editar']],
      ['baixarVideo', 'pecas/:id/video/arquivo', ['pauta.ver']],
    ];
    for (const [metodo, caminho, perms] of rotas) {
      expect(Reflect.getMetadata('path', proto[metodo]), metodo).toBe(caminho);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[metodo]), metodo).toEqual(perms);
    }
    const metodos = Object.getOwnPropertyNames(DerivacaoController.prototype).filter((m) => m !== 'constructor');
    expect(metodos.sort()).toEqual(rotas.map(([m]) => m).sort());
  });
});

// ---------------------------------------------------------------------------
// 4. Com banco
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (uma empresa, uma rodada, um episódio e peças)');

const MARCA = `sm${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

describe.skipIf(!URL)('semana com banco: 3 matérias viram 9 peças pela sessão da empresa, e de novo sem duplicar', () => {
  let admin: PrismaClient;
  let cru: PrismaClient;
  let semana: DerivacaoService;
  let episodios: EpisodioService;
  let orgId = '';

  const na = <T>(fn: () => Promise<T>) =>
    comContexto({ orgId, actorType: 'user', actorId: null, correlationId: `teste-${MARCA}`, origem: 'http' }, fn);

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: URL } } });
    cru = new PrismaClient({ datasourceUrl: URL });
    const app = comTenantNaSessao(cru, { modo: 'impor' }) as unknown as PrismaService;
    const llm = {
      name: 'dublê', model: 'd', configured: true, supportsTools: false,
      complete: async (m: { user: string }) => respostaDaIa(Number(/Matéria (\d+) de/.exec(m.user)?.[1])),
    } as unknown as LlmProvider;
    const memoria = new MemoriaService(app, {} as never, {} as never);
    episodios = new EpisodioService(app, new AuditService(app));
    semana = new DerivacaoService(app, new AuditService(app), llm, new VozService(app, new AuditService(app), llm, memoria), {} as never, episodios);
    const o = await admin.org.create({ data: { name: `Semana ${MARCA}`, slug: `sm-${MARCA}`, modulos: ['pauta'] } });
    orgId = o.id;
  }, 60_000);

  afterAll(async () => {
    if (orgId) {
      await admin.pautaPeca.deleteMany({ where: { orgId } });
      await admin.pautaEpisodio.deleteMany({ where: { orgId } });
      await admin.pautaRodada.deleteMany({ where: { orgId } });
      await admin.auditLog.deleteMany({ where: { orgId } });
      await admin.org.deleteMany({ where: { id: orgId } });
    }
    await admin?.$disconnect();
    await cru?.$disconnect();
  });

  it('gera, aprova uma, gera de novo e segue com 9 — a aprovada intacta, o episódio em Derivação', async () => {
    const rodada = await admin.pautaRodada.create({
      data: { orgId, status: 'curada', titulo: `Semana ${MARCA}`, janelaIni: new Date(), janelaFim: new Date(), itens: ITENS as never },
    });
    const e = await na(() => episodios.criar(orgId, 'pessoa', { rodadaId: rodada.id }));
    await admin.pautaEpisodio.update({
      where: { id: e.id },
      data: { status: 'pacote', midia: MIDIA as never, transcricao: SEGMENTOS as never, transcricaoTexto: FALAS.map(([, t]) => t).join(' ') },
    });

    const r = await na(() => semana.gerar(orgId, e.id, 'pessoa', { substituir: false }));
    expect(r.conta.criadas).toBe(9);
    const todas = await admin.pautaPeca.findMany({ where: { orgId } });
    expect(todas).toHaveLength(9);
    expect(todas.map((p) => p.formato).sort()).toEqual(['carrossel', 'carrossel', 'carrossel', 'corte', 'corte', 'corte', 'story', 'story', 'story']);
    expect(JSON.stringify(todas)).not.toContain('mail.google');
    expect((await admin.pautaEpisodio.findUnique({ where: { id: e.id } }))?.status).toBe('derivacao');

    const aprovada = todas.find((p) => p.formato === 'corte')!;
    await admin.pautaPeca.update({ where: { id: aprovada.id }, data: { status: 'aprovada' } });
    const r2 = await na(() => semana.gerar(orgId, e.id, 'pessoa', { substituir: true }));
    expect(r2.conta).toEqual({ criadas: 0, substituidas: 8, mantidas: 1, falharam: 0 });
    const depois = await admin.pautaPeca.findMany({ where: { orgId } });
    expect(depois.map((p) => p.id).sort()).toEqual(todas.map((p) => p.id).sort());
    expect(depois.find((p) => p.id === aprovada.id)).toEqual({ ...aprovada, status: 'aprovada' });

    const acoes = await admin.auditLog.findMany({ where: { orgId, entityId: e.id }, select: { action: true } });
    expect(acoes.filter((a) => a.action === 'pauta.semana_gerada')).toHaveLength(2);
  }, 60_000);
});
