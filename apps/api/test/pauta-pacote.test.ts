import { Readable } from 'node:stream';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PAUTA_MARCADOR_DA_PAGINA_DE_LINKS,
  PAUTA_RESERVA_DA_PAGINA_DE_LINKS,
  PAUTA_TETO_DA_DESCRICAO_DO_YOUTUBE,
  PAUTA_THUMB_MAX_BYTES,
  PautaNumeroDaThumbSchema,
  PautaPacoteGerarSchema,
  PautaTituloEscolhidoSchema,
  capitulosDaDescricao,
  conferirCapitulos,
  descricaoComPaginaDeLinks,
  linhasDosCapitulos,
  motivoParaNaoGerarPacote,
  motivoParaNaoMexerNoPacote,
  tempoDoCapitulo,
  thumbsDoPacote,
  titulosDoPacote,
  type PautaEpisodioStatus,
  type PautaItemCurado,
} from '@mktos/shared';

import {
  CapitulosRecusadosError,
  MAXIMO_DE_CAPITULOS,
  TETO_DA_DESCRICAO_COM_O_MARCADOR,
  angulosRepetidos,
  PacoteInvalidoError,
  chaveDaThumb,
  conferirPngDaThumb,
  consertarCapitulos,
  entradaDoPacote,
  hashtagsDoPacote,
  linkDoPacote,
  linksDaDescricao,
  montarDescricao,
  montarPacote,
  segundosDoTempo,
  systemDoPacote,
  textoParaOYoutube,
  thumbsDaIa,
  thumbsGuardadas,
  titulosDaIa,
  transcricaoParaOPrompt,
  type Segmento,
} from '../src/pauta/pacote-do-episodio';
import { TOM_DA_CASA, blocoDeVoz } from '../src/pauta/voz-da-pauta';
import { PacoteService } from '../src/pauta/pacote.service';
import { PacoteController } from '../src/pauta/pacote.controller';
import { EpisodioService } from '../src/pauta/episodio.service';
import { VozService } from '../src/pauta/voz.service';
import { MemoriaService } from '../src/memory/memoria.service';
import { AuditService } from '../src/audit/audit.service';
import type { LlmProvider } from '../src/llm/llm.provider';
import type { StorageService } from '../src/storage/storage.service';
import { comContexto } from '../src/common/contexto-execucao';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import type { PrismaService } from '../src/prisma/prisma.service';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { exigirBancoDescartavel } from './banco-de-teste';
import { SAIDA_DA_GERACAO_LONGA } from '../src/pauta/saida-da-geracao';
import { semMarca } from './marca-de-teste';

/*
 * O PACOTE DO YOUTUBE — MC11.
 *
 * Quatro camadas:
 *   1. a parte pura: os capítulos (formato, as regras do YouTube, o conserto do
 *      que a IA erra e a recusa com motivo), os links (nunca o permalink da
 *      newsletter), títulos, hashtags, briefs das thumbs, a descrição com o
 *      teto de bytes, a transcrição no prompt e a conferência do PNG;
 *   2. os contratos: os esquemas das rotas;
 *   3. o `PacoteService` DE VERDADE com dublês de prisma, LLM, memória e
 *      storage — com a TRANSCRIÇÃO DE EXEMPLO do critério de pronto: saem 3
 *      títulos, a descrição com capítulos válidos e os links, e 3 briefs; e o
 *      controller montado à mão;
 *   4. com banco: gerar, escolher o título e subir a thumb pela sessão da empresa.
 */

const ORG = '7c0f0a8e-4444-4a5a-9c1e-00000000mc11';
const PESSOA = 'b1d2c3e4-0000-4000-8000-000000000011';

const ITENS: PautaItemCurado[] = [
  { id: 'c1', titulo: 'Preço do modelo caiu pela metade', url: 'https://noticia.exemplo/preco', origem: 'N', resumo: 'API mais barata.' },
  { id: 'c2', titulo: 'Agente de planilha no Sheets', url: 'https://noticia.exemplo/sheets', origem: 'W', resumo: 'Planilha que se preenche.' },
  // A newsletter como o episódio a recebe: sem o url (itensMantidos o apaga).
  { id: 'c3', titulo: 'The Batch desta semana', url: '', origem: 'L', fonte: 'The Batch', semLinkPublico: true },
  // Uma newsletter antiga, sem a marca: o permalink do Gmail ainda está no url.
  { id: 'c4', titulo: 'Resumo da Ben’s Bites', url: 'https://mail.google.com/mail/u/0/#inbox/18c2f0a', origem: 'L' },
  { id: 'c5', titulo: 'Ferramenta grátis de transcrição', url: 'https://noticia.exemplo/transcricao', origem: 'R' },
];

/*
 * A TRANSCRIÇÃO DE EXEMPLO: um episódio de 11 min, com os tempos do vídeo
 * final como o whisper devolve (começo de cada fala, com fração).
 */
const FALAS: Array<[number, string]> = [
  [0.0, 'Bom dia, esta é a semana 39 da ROOT.'],
  [4.2, 'Hoje são quatro notícias que mexem no custo de quem toca uma empresa.'],
  [12.6, 'Antes, um aviso rápido sobre a comunidade.'],
  [31.4, 'Começa pelo preço dos modelos, que caiu pela metade nesta semana.'],
  [44.9, 'Na prática, a mesma automação de atendimento custa a metade por mês.'],
  [64.5, 'A segunda é o agente que preenche planilha sozinho dentro do Sheets.'],
  [82.3, 'Mostro na tela: a planilha de contas a pagar se preenche a partir do e-mail.'],
  [131.7, 'Isso tira umas duas horas por semana de quem fecha o caixa.'],
  [190.2, 'Terceira: uma ferramenta grátis de transcrição de reunião.'],
  [214.8, 'Grava, transcreve e manda a ata no fim da chamada.'],
  [268.0, 'Para quem vende serviço, a ata vira proposta no mesmo dia.'],
  [345.5, 'E a newsletter The Batch trouxe o contexto da semana nos modelos abertos.'],
  [402.1, 'O ponto é que modelo aberto já roda num computador comum.'],
  [488.9, 'Para fechar: o que dá para usar amanhã cedo.'],
  [540.3, 'Troque uma tarefa manual por semana e meça o tempo que sobra.'],
  [612.0, 'Semana que vem tem mais. Até lá.'],
];
const DURACAO = 655;
const SEGMENTOS: Segmento[] = FALAS.map(([inicio, texto], i) => ({
  inicio,
  fim: i + 1 < FALAS.length ? FALAS[i + 1][0] - 0.3 : DURACAO - 2,
  texto,
}));

/** O que um modelo razoável devolve — com os erros que a gente espera consertar. */
function respostaDaIa(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    titulos: [
      { texto: 'O preço da IA caiu pela metade: o que muda no caixa 🚀 https://x.exemplo', angulo: 'resultado' },
      { texto: 'Quatro ferramentas de IA para usar amanhã na empresa', angulo: 'lista' },
      {
        texto:
          'A planilha que se preenche sozinha e outras três notícias da semana que mexem no custo de quem toca uma pequena empresa',
        angulo: 'curiosidade',
      },
    ],
    abertura: 'Quatro notícias da semana que mexem no custo da operação. Veja em https://link.exemplo.',
    capitulos: [
      { tempo: '00:03', titulo: 'Abertura e avisos' },
      { tempo: '03:10', titulo: 'Transcrição grátis de reunião' },
      { tempo: '00:31', titulo: 'O preço dos modelos caiu' },
      { tempo: '01:05', titulo: 'Agente de planilha no Sheets' },
      { tempo: '01:08', titulo: 'Demonstração da planilha' },
      { tempo: '05:45', titulo: 'Modelos abertos, pela The Batch' },
      { tempo: '08:08', titulo: 'Para usar amanhã' },
      { tempo: '15:00', titulo: 'Depois do fim' },
    ],
    hashtags: ['#IA', 'pequenas empresas', 'ia', '#Automação'],
    thumbs: [
      { texto: 'Preço da IA caiu pela metade de novo', destaque: 'metade', tempo: '00:45' },
      { texto: 'Planilha que se preenche', destaque: 'sozinha', tempo: '01:22' },
      { texto: 'Ata grátis', destaque: 'grátis', tempo: '99:00' },
    ],
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// 1. A parte pura
// ---------------------------------------------------------------------------

describe('pacote: os capítulos e as regras do YouTube', () => {
  it('formata mm:ss e, em vídeo de uma hora ou mais, hh:mm:ss em todas as linhas', () => {
    expect(tempoDoCapitulo(0)).toBe('00:00');
    expect(tempoDoCapitulo(64.9)).toBe('01:04');
    expect(tempoDoCapitulo(3725)).toBe('01:02:05');
    expect(tempoDoCapitulo(5, true)).toBe('00:00:05');
    expect(tempoDoCapitulo(Number.NaN)).toBe('00:00');
    const caps = [{ inicioSeg: 0, titulo: 'A' }, { inicioSeg: 600, titulo: 'B' }, { inicioSeg: 3700, titulo: 'C' }];
    expect(linhasDosCapitulos(caps)).toEqual(['00:00:00 A', '00:10:00 B', '01:01:40 C']);
    expect(linhasDosCapitulos(caps.slice(0, 2), 3900)).toEqual(['00:00:00 A', '00:10:00 B']);
    expect(linhasDosCapitulos(caps.slice(0, 2), 900)).toEqual(['00:00 A', '10:00 B']);
  });

  it('confere: primeiro em 00:00, pelo menos 3, 10 s ou mais cada, em ordem crescente, e o último até o fim', () => {
    const bom = [{ inicioSeg: 0, titulo: 'A' }, { inicioSeg: 30, titulo: 'B' }, { inicioSeg: 60, titulo: 'C' }];
    expect(conferirCapitulos(bom, 120)).toEqual([]);
    expect(conferirCapitulos(bom.slice(0, 2), 120)[0]).toMatch(/pelo menos 3/);
    expect(conferirCapitulos([{ inicioSeg: 5, titulo: 'A' }, ...bom.slice(1)], 120).join(' ')).toMatch(/tem de ser 00:00/);
    expect(conferirCapitulos([bom[0], { inicioSeg: 8, titulo: 'B' }, bom[2]], 120).join(' ')).toMatch(/menos de 10 s/);
    expect(conferirCapitulos([bom[0], bom[2], bom[1]], 120).join(' ')).toMatch(/não vem depois/);
    expect(conferirCapitulos(bom, 65).join(' ')).toMatch(/último capítulo .* até o fim/);
    expect(conferirCapitulos([bom[0], { inicioSeg: 30, titulo: ' ' }, bom[2]], 120).join(' ')).toMatch(/sem título/);
  });

  it('lê da descrição as linhas que começam por tempo (é o que o YouTube lê)', () => {
    const d = 'Abertura do episódio.\n\nCapítulos\n00:00 Abertura\n01:04 Planilha\n1:02:05 Longo\n99:99 não é tempo\nSem tempo';
    expect(capitulosDaDescricao(d)).toEqual([
      { inicioSeg: 0, titulo: 'Abertura' },
      { inicioSeg: 64, titulo: 'Planilha' },
      { inicioSeg: 3725, titulo: 'Longo' },
    ]);
  });

  it('segundos a partir de mm:ss, hh:mm:ss, [mm:ss] ou número; o resto é NaN', () => {
    expect(segundosDoTempo('01:05')).toBe(65);
    expect(segundosDoTempo('[01:05]')).toBe(65);
    expect(segundosDoTempo('1:01:05')).toBe(3665);
    expect(segundosDoTempo(12.5)).toBe(12.5);
    expect(segundosDoTempo('12,5')).toBe(12.5);
    expect(segundosDoTempo('01:75')).toBeNaN();
    expect(segundosDoTempo('amanhã')).toBeNaN();
    expect(segundosDoTempo(-3)).toBeNaN();
  });

  it('conserta o que a IA erra: encosta na fala, ordena, junta o curto, põe o primeiro em 00:00 e tira o que passa do fim', () => {
    const daIa = JSON.parse(respostaDaIa()).capitulos;
    const { capitulos, correcoes } = consertarCapitulos(daIa, { duracaoSeg: DURACAO, inicios: SEGMENTOS.map((s) => s.inicio) });
    expect(capitulos).toEqual([
      { inicioSeg: 0, titulo: 'Abertura e avisos' },
      { inicioSeg: 31, titulo: 'O preço dos modelos caiu' },
      { inicioSeg: 64, titulo: 'Agente de planilha no Sheets' },
      { inicioSeg: 190, titulo: 'Transcrição grátis de reunião' },
      { inicioSeg: 345, titulo: 'Modelos abertos, pela The Batch' },
      { inicioSeg: 488, titulo: 'Para usar amanhã' },
    ]);
    // Todo tempo é o começo real de uma fala da transcrição.
    const inicios = new Set(SEGMENTOS.map((s) => Math.floor(s.inicio)));
    expect(capitulos.every((c) => inicios.has(c.inicioSeg))).toBe(true);
    expect(conferirCapitulos(capitulos, DURACAO)).toEqual([]);
    expect(correcoes.join(' ')).toMatch(/depois do fim do vídeo saíram/);
    expect(correcoes.join(' ')).toMatch(/encostado/);
    expect(correcoes.join(' ')).toMatch(/ordem crescente/);
    expect(correcoes.join(' ')).toMatch(/mesmo tempo de outro/);
    // 00:03 encosta na fala de 00:04, e o primeiro vai para 00:00.
    expect(correcoes.join(' ')).toMatch(/foi de 00:04 para 00:00/);
  });

  it('primeiro capítulo longe do começo ganha uma "Abertura" em 00:00; título com tempo colado perde o tempo', () => {
    const r = consertarCapitulos(
      [{ tempo: '00:31', titulo: '00:31 - Preço' }, { tempo: '01:04', titulo: 'Planilha' }, { tempo: '03:10', titulo: 'Ata' }],
      { duracaoSeg: DURACAO, inicios: [] },
    );
    expect(r.capitulos.map((c) => c.titulo)).toEqual(['Abertura', 'Preço', 'Planilha', 'Ata']);
    expect(r.correcoes.join(' ')).toMatch(/Abertura/);
  });

  it('o curto se junta ao anterior, o último curto demais até o fim sai, o repetido no mesmo tempo sai', () => {
    const r = consertarCapitulos(
      [
        { tempo: '00:00', titulo: 'A' },
        { tempo: '00:40', titulo: 'B' },
        { tempo: '00:40', titulo: 'B repetido' },
        { tempo: '00:45', titulo: 'B curto' },
        { tempo: '01:20', titulo: 'C' },
        { tempo: '01:55', titulo: 'D' },
      ],
      { duracaoSeg: 120, inicios: [] },
    );
    expect(r.capitulos.map((c) => c.titulo)).toEqual(['A', 'B', 'C']);
    expect(r.correcoes.join(' ')).toMatch(/1 capítulo\(s\) no mesmo tempo/);
    expect(r.correcoes.join(' ')).toMatch(/2 capítulo\(s\) com menos de 10 s foram juntados ao anterior/);
  });

  it('mais de 10 capítulos: os mais curtos se juntam ao anterior até 10, com o 00:00 e a ordem, e a correção dita', () => {
    // 66 capítulos de 10 s num vídeo de 11 min, o último com o resto.
    const inicios = Array.from({ length: 66 }, (_, i) => i * 10);
    const brutos = inicios.map((seg) => ({ tempo: tempoDoCapitulo(seg), titulo: `Assunto ${seg}` }));
    const r = consertarCapitulos(brutos, { duracaoSeg: 700, inicios });
    expect(r.capitulos).toHaveLength(MAXIMO_DE_CAPITULOS);
    expect(r.capitulos[0]).toEqual({ inicioSeg: 0, titulo: 'Assunto 0' });
    expect(conferirCapitulos(r.capitulos, 700)).toEqual([]);
    expect(r.correcoes.join(' ')).toMatch(/56 capítulo\(s\) além de 10 foram juntados ao anterior/);
    // O capítulo longo do fim fica: sai primeiro o que dura menos.
    expect(r.capitulos.at(-1)?.inicioSeg).toBe(650);
  });

  it('recusa com o motivo quando nem consertado sobra o mínimo — vídeo de 25 s nunca tem 3 capítulos', () => {
    const curto = () =>
      consertarCapitulos(
        [{ tempo: '00:00', titulo: 'A' }, { tempo: '00:08', titulo: 'B' }, { tempo: '00:16', titulo: 'C' }],
        { duracaoSeg: 25, inicios: [0, 8, 16] },
      );
    expect(curto).toThrow(CapitulosRecusadosError);
    expect(curto).toThrow(/pelo menos 3/);
    expect(() => consertarCapitulos('não é lista', { duracaoSeg: 600, inicios: [] })).toThrow(/São 0 capítulo/);
    expect(() => consertarCapitulos([{ titulo: 'sem tempo' }, { tempo: 'x', titulo: 'y' }, null], { duracaoSeg: 600, inicios: [] })).toThrow(
      CapitulosRecusadosError,
    );
  });
});

describe('pacote: os links (nunca o permalink privado da newsletter)', () => {
  it('só link público de matéria: newsletter (L ou sem link público), caixa de entrada e não-http ficam de fora', () => {
    expect(linkDoPacote(ITENS[0])).toBe('https://noticia.exemplo/preco');
    expect(linkDoPacote(ITENS[2])).toBeNull();
    expect(linkDoPacote(ITENS[3])).toBeNull();
    expect(linkDoPacote({ url: 'https://mail.google.com/mail/u/0/#inbox/x', origem: 'N' })).toBeNull();
    expect(linkDoPacote({ url: 'https://outlook.live.com/mail/0/id/x' })).toBeNull();
    expect(linkDoPacote({ url: 'javascript:alert(1)' })).toBeNull();
    expect(linkDoPacote({ url: 'https://noticia.exemplo/<script>' })).toBeNull();
    expect(linkDoPacote({ url: 'https://x.exemplo/y', semLinkPublico: true })).toBeNull();
  });

  it('os links da descrição saem na ordem da rodada, sem repetir, com o título do item', () => {
    const links = linksDaDescricao([...ITENS, { titulo: 'Repetido', url: 'https://noticia.exemplo/preco' }]);
    expect(links).toEqual([
      { titulo: 'Preço do modelo caiu pela metade', url: 'https://noticia.exemplo/preco' },
      { titulo: 'Agente de planilha no Sheets', url: 'https://noticia.exemplo/sheets' },
      { titulo: 'Ferramenta grátis de transcrição', url: 'https://noticia.exemplo/transcricao' },
    ]);
  });

  it('o pedido ao modelo leva as matérias e a transcrição com tempos, sem nenhum link', () => {
    const u = entradaDoPacote({ apelido: 'ep-03', titulo: 'Semana 39', itens: ITENS, segmentos: SEGMENTOS, duracaoSeg: DURACAO });
    expect(u).toContain('Episódio: ep-03 · Semana 39');
    expect(u).toContain('Duração do vídeo final: 10:55');
    expect(u).toContain('[4] Resumo da Ben’s Bites');
    expect(u).toContain('(sem link público; fonte: The Batch)');
    expect(u).toContain('[00:00] Bom dia, esta é a semana 39 da ROOT.');
    expect(u).toContain('[01:04] A segunda é o agente');
    expect(u).not.toMatch(/https?:\/\//);
  });

  it('transcrição longa é agrupada em blocos maiores, com o tempo de cada bloco sendo o começo real de uma fala', () => {
    const longa: Segmento[] = Array.from({ length: 900 }, (_, i) => ({ inicio: i * 4, fim: i * 4 + 3.5, texto: `fala número ${i} com algum texto de conteúdo` }));
    const t = transcricaoParaOPrompt(longa, 8_000);
    expect(t.texto.length).toBeLessThanOrEqual(8_000);
    expect(t.graoSeg).toBeGreaterThan(0);
    const tempos = [...t.texto.matchAll(/^\[(\d+:\d{2}(?::\d{2})?)\]/gm)].map((m) => segundosDoTempo(m[1]));
    expect(tempos.length).toBe(t.blocos);
    expect(tempos.every((s) => s % 4 === 0)).toBe(true);
    const curta = transcricaoParaOPrompt(SEGMENTOS);
    expect(curta).toMatchObject({ graoSeg: 0, blocos: SEGMENTOS.length });
    const maisDeUmaHora = transcricaoParaOPrompt([{ inicio: 3700, fim: 3710, texto: 'fim' }]);
    expect(maisDeUmaHora.texto).toBe('[01:01:40] fim');
  });
});

describe('pacote: títulos, hashtags, thumbs e a descrição', () => {
  it('3 títulos dentro de 100 caracteres, cortados na palavra, sem URL, emoji nem < >', () => {
    const t = titulosDaIa(JSON.parse(respostaDaIa()).titulos);
    expect(t).toHaveLength(3);
    expect(t[0]).toEqual({ texto: 'O preço da IA caiu pela metade: o que muda no caixa', angulo: 'resultado', escolhido: false });
    expect(t[2].texto.length).toBeLessThanOrEqual(100);
    expect(t[2].texto.endsWith(' ')).toBe(false);
    expect(t.every((x) => !/https?:|🚀|[<>]/u.test(x.texto))).toBe(true);
    expect(textoParaOYoutube('<b>oi</b> www.x.exemplo 😀', 50)).toBe('boi/b');
  });

  it('título repetido, curto ou com palavra que a marca proíbe sai; menos de 3 é pacote inválido', () => {
    expect(() =>
      titulosDaIa([{ texto: 'Como alavancar a empresa com IA' }, { texto: 'Um título bom e útil' }, { texto: 'um título bom e útil' }, { texto: 'curto' }]),
    ).toThrow(PacoteInvalidoError);
    expect(() => titulosDaIa('nada')).toThrow(/0 título/);
    expect(titulosDaIa(['Título em texto puro um', 'Título em texto puro dois', 'Título em texto puro três'])).toHaveLength(3);
  });

  it('até 3 hashtags, sem espaço nem pontuação, sem repetir', () => {
    expect(hashtagsDoPacote(['#IA', 'pequenas empresas', 'ia', '#Automação', '#quinta'])).toEqual(['#IA', '#PequenasEmpresas', '#Automação']);
    expect(hashtagsDoPacote(['#', '123', 'disruptivo', '#x'])).toEqual([]);
    expect(hashtagsDoPacote(undefined)).toEqual([]);
  });

  it('thumb: até 4 palavras, destaque que é palavra do texto (senão a mais longa), frame dentro do vídeo', () => {
    const titulos = titulosDaIa(JSON.parse(respostaDaIa()).titulos);
    const { thumbs, correcoes } = thumbsDaIa(JSON.parse(respostaDaIa()).thumbs, { duracaoSeg: DURACAO, titulos });
    expect(thumbs).toEqual([
      { n: 1, texto: 'Preço da IA caiu', destaque: 'Preço', tempoSeg: 45, imagem: null },
      // "sozinha" não está no texto: vale a palavra mais longa (a primeira, no empate).
      { n: 2, texto: 'Planilha que se preenche', destaque: 'Planilha', tempoSeg: 82, imagem: null },
      { n: 3, texto: 'Ata grátis', destaque: 'grátis', tempoSeg: DURACAO - 1, imagem: null },
    ]);
    expect(correcoes.join(' ')).toMatch(/cortado\(s\) em 4 palavras/);
  });

  it('faltando thumb, os títulos completam, com o frame espalhado pelo vídeo', () => {
    const titulos = titulosDaIa(JSON.parse(respostaDaIa()).titulos);
    const { thumbs, correcoes } = thumbsDaIa([{ texto: 'Só uma', destaque: 'uma' }], { duracaoSeg: 400, titulos });
    expect(thumbs.map((t) => t.texto)).toEqual(['Só uma', 'O preço da IA', 'Quatro ferramentas de IA']);
    expect(thumbs.map((t) => t.tempoSeg)).toEqual([100, 200, 300]);
    expect(correcoes.join(' ')).toMatch(/completada\(s\) a partir dos títulos/);
  });

  it('títulos que começam igual e nenhuma thumb da IA: os trechos seguintes dos títulos completam as 3', () => {
    const titulos = titulosDaIa([
      { texto: 'O preço da IA caiu pela metade nesta semana', angulo: 'resultado' },
      { texto: 'O preço da IA e o que muda no caixa', angulo: 'alerta' },
      { texto: 'O preço da IA: quatro notícias da semana', angulo: 'lista' },
    ]);
    const { thumbs, avisos } = thumbsDaIa([], { duracaoSeg: 400, titulos });
    expect(thumbs.map((t) => t.texto)).toEqual(['O preço da IA', 'caiu pela metade nesta', 'pela metade nesta semana']);
    expect(thumbs.map((t) => t.n)).toEqual([1, 2, 3]);
    expect(avisos).toEqual([]);
  });

  it('sem textos diferentes o bastante, saem menos de 3 thumbs e o aviso diz', () => {
    const titulos = titulosDaIa(['Um dois três quatro.', 'Um dois três quatro!', 'Um dois três quatro?']);
    const { thumbs, avisos } = thumbsDaIa([], { duracaoSeg: 400, titulos });
    expect(thumbs).toHaveLength(1);
    expect(avisos[0]).toMatch(/^Saíram 1 thumb\(s\) de 3/);
    const p = montarPacote(
      JSON.stringify({ titulos: ['Um dois três quatro.', 'Um dois três quatro!', 'Um dois três quatro?'], capitulos: [], thumbs: [] }),
      { itens: [], segmentos: SEGMENTOS, duracaoSeg: DURACAO },
    );
    expect(p.avisos.some((a) => /thumb\(s\) de 3/.test(a))).toBe(true);
  });

  it('ângulo repetido ou em branco nos títulos vira aviso; três diferentes, nada', () => {
    const mesmos = titulosDaIa([
      { texto: 'Primeiro título do episódio', angulo: 'resultado' },
      { texto: 'Segundo título do episódio', angulo: 'Resultado' },
      { texto: 'Terceiro título do episódio', angulo: 'lista' },
    ]);
    expect(angulosRepetidos(mesmos)).toMatch(/sem três ângulos diferentes \(resultado, Resultado, lista\)/);
    expect(angulosRepetidos(titulosDaIa(['Primeiro título aqui', 'Segundo título aqui', 'Terceiro título aqui']))).toMatch(/sem ângulo/);
    expect(angulosRepetidos(titulosDaIa(JSON.parse(respostaDaIa()).titulos))).toBeNull();
  });

  it('a descrição guarda a folga da URL da página: trocado o marcador por uma URL do tamanho da reserva, fica no teto', () => {
    const links = Array.from({ length: 120 }, (_, i) => ({ titulo: `Matéria ${i} com acentuação é ç ã õ`, url: `https://noticia.exemplo/${i}` }));
    const d = montarDescricao({ abertura: 'Quatro notícias.', capitulos: null, duracaoSeg: 600, links, hashtags: [] });
    expect(new TextEncoder().encode(d).length).toBeLessThanOrEqual(TETO_DA_DESCRICAO_COM_O_MARCADOR);
    const url = `https://bio.exemplo/${'x'.repeat(PAUTA_RESERVA_DA_PAGINA_DE_LINKS - 'https://bio.exemplo/'.length)}`;
    expect(url.length).toBe(PAUTA_RESERVA_DA_PAGINA_DE_LINKS);
    expect(new TextEncoder().encode(descricaoComPaginaDeLinks(d, url)).length).toBeLessThanOrEqual(PAUTA_TETO_DA_DESCRICAO_DO_YOUTUBE);
  });

  it('o pior caso cabe: 150 capítulos, títulos longos com acento, abertura cheia e 120 links ficam abaixo do teto', () => {
    const duracaoSeg = 25 * 60;
    const segmentos = Array.from({ length: 150 }, (_, i) => ({ inicio: i * 10, fim: i * 10 + 9, texto: 'fala' }));
    const saida = JSON.stringify({
      titulos: ['Título longo número um', 'Título longo número dois', 'Título longo número três'],
      abertura: 'ção '.repeat(400),
      capitulos: segmentos.map((s) => ({ tempo: tempoDoCapitulo(s.inicio), titulo: 'ãõçé'.repeat(20) })),
      hashtags: ['#ÇãoÇãoÇãoÇãoÇãoÇãoÇão', '#ÉéÉéÉéÉéÉéÉéÉé', '#ÕõÕõÕõÕõÕõÕõ'],
    });
    const itens = Array.from({ length: 120 }, (_, i) => ({ id: `i${i}`, titulo: `Matéria ${i} ${'é'.repeat(100)}`, url: `https://noticia.exemplo/${i}`, origem: 'N' }));
    const p = montarPacote(saida, { itens: itens as PautaItemCurado[], segmentos, duracaoSeg });
    expect(p.capitulos).toHaveLength(MAXIMO_DE_CAPITULOS);
    expect(capitulosDaDescricao(p.descricao)).toHaveLength(MAXIMO_DE_CAPITULOS);
    expect(new TextEncoder().encode(p.descricao).length).toBeLessThanOrEqual(TETO_DA_DESCRICAO_COM_O_MARCADOR);
  });

  it('a descrição: abertura, capítulos, links citados, a página de links (marcador) e as hashtags, nessa ordem', () => {
    const d = montarDescricao({
      abertura: 'Quatro notícias.',
      capitulos: [{ inicioSeg: 0, titulo: 'Abertura' }, { inicioSeg: 31, titulo: 'Preço' }, { inicioSeg: 64, titulo: 'Planilha' }],
      duracaoSeg: DURACAO,
      links: linksDaDescricao(ITENS),
      hashtags: ['#IA'],
    });
    expect(d).toBe(
      [
        'Quatro notícias.',
        '',
        'Capítulos\n00:00 Abertura\n00:31 Preço\n01:04 Planilha',
        '',
        'Links citados no episódio\n• Preço do modelo caiu pela metade: https://noticia.exemplo/preco\n' +
          '• Agente de planilha no Sheets: https://noticia.exemplo/sheets\n• Ferramenta grátis de transcrição: https://noticia.exemplo/transcricao',
        '',
        `Os links deste episódio, numa página só: ${PAUTA_MARCADOR_DA_PAGINA_DE_LINKS}`,
        '',
        '#IA',
      ].join('\n'),
    );
    expect(descricaoComPaginaDeLinks(d, 'https://bio.exemplo/ep-03')).toContain('numa página só: https://bio.exemplo/ep-03');
    expect(descricaoComPaginaDeLinks(d, null)).toBe(d);
  });

  it('passando de 5.000 bytes, saem os links do fim (a página tem todos), e a conta é em bytes', () => {
    const links = Array.from({ length: 80 }, (_, i) => ({ titulo: `Matéria ${i} com acentuação é ç ã õ`, url: `https://noticia.exemplo/${i}` }));
    const d = montarDescricao({ abertura: 'á'.repeat(500), capitulos: null, duracaoSeg: 600, links, hashtags: [] });
    expect(new TextEncoder().encode(d).length).toBeLessThanOrEqual(PAUTA_TETO_DA_DESCRICAO_DO_YOUTUBE);
    expect(d).toMatch(/• e mais \d+ na página do episódio/);
    expect(d).toContain(PAUTA_MARCADOR_DA_PAGINA_DE_LINKS);
    expect(d).not.toContain('Capítulos');
  });

  it('o prompt leva o bloco de voz da MC10: sem perfil, o tom da casa', () => {
    const s = systemDoPacote(blocoDeVoz(null));
    expect(s.endsWith(TOM_DA_CASA)).toBe(true);
    expect(s).toContain('EXATAMENTE 3');
    expect(s).toContain('ATÉ 4 PALAVRAS');
    expect(s).toMatch(/Nunca invente notícia, número, nome ou URL/);
    expect(systemDoPacote(blocoDeVoz('Fala curta.'))).toContain('Fala curta.');
  });

  it('o pacote inteiro a partir da resposta; o que não é JSON é pacote inválido; capítulos impossíveis viram aviso', () => {
    const p = montarPacote(respostaDaIa(), { itens: ITENS, segmentos: SEGMENTOS, duracaoSeg: DURACAO });
    expect(p.titulos).toHaveLength(3);
    expect(p.thumbs).toHaveLength(3);
    expect(p.capitulos).toHaveLength(6);
    expect(p.links).toBe(3);
    expect(p.avisos).toEqual([]);
    expect(() => montarPacote('# Pacote\n\n1. título', { itens: ITENS, segmentos: SEGMENTOS, duracaoSeg: DURACAO })).toThrow(/não veio JSON/);
    expect(() => montarPacote('[1,2]', { itens: ITENS, segmentos: SEGMENTOS, duracaoSeg: DURACAO })).toThrow(PacoteInvalidoError);

    const curto = montarPacote(respostaDaIa(), { itens: ITENS, segmentos: SEGMENTOS.slice(0, 2), duracaoSeg: 25 });
    expect(curto.capitulos).toEqual([]);
    expect(curto.avisos[0]).toMatch(/^Sem capítulos na descrição:/);
    expect(curto.descricao).not.toContain('Capítulos');
  });
});

// ---------------------------------------------------------------------------
// A thumb que o Mac sobe
// ---------------------------------------------------------------------------

function png(largura: number, altura: number, total = 64): Buffer {
  const b = Buffer.alloc(Math.max(total, 33));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(largura, 16);
  b.writeUInt32BE(altura, 20);
  return b;
}

describe('pacote: os limites do upload da thumb', () => {
  const arq = (buffer: Buffer, mimetype = 'image/png') => ({ buffer, mimetype, size: buffer.length });

  it('PNG 1280×720 passa, com as dimensões; 16:9 maior também', () => {
    expect(conferirPngDaThumb(arq(png(1280, 720)))).toEqual({ ok: true, largura: 1280, altura: 720 });
    expect(conferirPngDaThumb(arq(png(1920, 1080)))).toMatchObject({ ok: true, largura: 1920 });
  });

  it('só image/png, e pela assinatura: JPEG com nome de png e "png" sem assinatura são recusados', () => {
    expect(conferirPngDaThumb(arq(png(1280, 720), 'image/jpeg'))).toMatchObject({ ok: false, motivo: expect.stringMatching(/é PNG/) });
    expect(conferirPngDaThumb(arq(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'.padEnd(40)), 'image/png'))).toMatchObject({
      ok: false,
      motivo: expect.stringMatching(/assinatura/),
    });
    expect(conferirPngDaThumb(undefined)).toMatchObject({ ok: false, motivo: expect.stringMatching(/campo "file"/) });
  });

  it('acima de 2 MB é recusado, pelo tamanho declarado ou pelo buffer', () => {
    expect(conferirPngDaThumb(arq(png(1280, 720, PAUTA_THUMB_MAX_BYTES + 1)))).toMatchObject({ ok: false, motivo: expect.stringMatching(/2 MB/) });
    expect(conferirPngDaThumb({ buffer: png(1280, 720), mimetype: 'image/png', size: PAUTA_THUMB_MAX_BYTES + 1 })).toMatchObject({ ok: false });
    expect(conferirPngDaThumb(arq(png(1280, 720, PAUTA_THUMB_MAX_BYTES)))).toMatchObject({ ok: true });
  });

  it('fora de 16:9 ou abaixo de 640 de largura é recusado', () => {
    expect(conferirPngDaThumb(arq(png(1080, 1080)))).toMatchObject({ ok: false, motivo: expect.stringMatching(/16:9/) });
    expect(conferirPngDaThumb(arq(png(320, 180)))).toMatchObject({ ok: false });
    expect(conferirPngDaThumb(arq(png(7680, 4320)))).toMatchObject({ ok: false });
  });

  it('o número da thumb é 1, 2 ou 3; a chave do storage leva o id, o número e o hash', () => {
    expect(PautaNumeroDaThumbSchema.parse('2')).toBe(2);
    for (const ruim of ['0', '4', 'a', '1.5', '']) expect(() => PautaNumeroDaThumbSchema.parse(ruim)).toThrow();
    expect(chaveDaThumb('e1', 2, 'abcdef0123456789')).toBe('pauta/thumb/e1-2-abcdef012345.png');
  });

  it('a chave do storage fica no banco e não sai no detalhe', () => {
    const guardado = [{ n: 1, texto: 'Ata grátis', destaque: 'grátis', tempoSeg: 10, imagem: { chave: 'pauta/thumb/x.png', sha: 'ab', bytes: 9, largura: 1280, altura: 720, enviadaEm: '2026-09-24T00:00:00.000Z' } }];
    expect(thumbsGuardadas(guardado)[0].imagem?.chave).toBe('pauta/thumb/x.png');
    expect(thumbsDoPacote(guardado)[0].imagem).toEqual({ bytes: 9, largura: 1280, altura: 720, enviadaEm: '2026-09-24T00:00:00.000Z' });
    expect(thumbsDoPacote([{ n: 9, texto: 'x', tempoSeg: 1 }, { n: 1, texto: '', tempoSeg: 1 }, 'lixo'])).toEqual([]);
    expect(titulosDoPacote([{ texto: 'Um', angulo: 'a', escolhido: true }, { angulo: 'sem texto' }, null])).toEqual([
      { texto: 'Um', angulo: 'a', escolhido: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. Os contratos
// ---------------------------------------------------------------------------

describe('pacote: contratos', () => {
  it('gerar só substitui com confirmação; escolher aceita 1 a 3 ou nulo', () => {
    expect(PautaPacoteGerarSchema.parse({})).toEqual({ substituir: false });
    expect(PautaTituloEscolhidoSchema.parse({ n: null })).toEqual({ n: null });
    expect(() => PautaTituloEscolhidoSchema.parse({ n: 4 })).toThrow();
    expect(() => PautaTituloEscolhidoSchema.parse({})).toThrow();
  });

  it('o pacote sai no Pacote e na Derivação, e só com transcrição', () => {
    expect(motivoParaNaoGerarPacote('pacote', 10)).toBeNull();
    expect(motivoParaNaoGerarPacote('derivacao', 10)).toBeNull();
    expect(motivoParaNaoGerarPacote('edicao', 10)).toMatch(/chega no Pacote/);
    expect(motivoParaNaoGerarPacote('agendado', 10)).toMatch(/já foi agendado/);
    expect(motivoParaNaoGerarPacote('pacote', 0)).toMatch(/não tem transcrição/);
    expect(motivoParaNaoMexerNoPacote('concluido')).toMatch(/registro do que subiu/);
    expect(motivoParaNaoMexerNoPacote('derivacao')).toBeNull();
    expect(motivoParaNaoMexerNoPacote('edicao')).toBeNull();
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
};

const MIDIA = {
  arquivoBruto: '/Users/pedro/Movies/OBS/bruto.mp4',
  arquivoFinal: '/Users/pedro/Movies/OBS/root-midia/ep-03/ep-03-final.mp4',
  duracaoSeg: DURACAO,
  cortes: [],
  palavraDeCorte: null,
  editor: 'ffmpeg',
  recebidaEm: '2026-09-24T00:00:00.000Z',
};

function ep(over: Partial<Ep> = {}): Ep {
  return {
    id: 'e1', orgId: ORG, numero: 3, titulo: 'Semana 39', status: 'pacote', rodadaId: 'r1', roteiro: '# roteiro',
    midia: MIDIA, transcricao: SEGMENTOS, transcricaoTexto: 'x', titulos: [], thumbs: [], descricao: '', bioPageId: null,
    criadoPor: PESSOA, criadoEm: new Date('2026-09-20T12:00:00.000Z'), atualizadoEm: new Date('2026-09-24T12:00:00.000Z'),
    rodada: { titulo: 'Semana 39', itens: ITENS, janelaIni: new Date('2026-09-17T00:00:00.000Z'), janelaFim: new Date('2026-09-24T00:00:00.000Z') },
    ...over,
  };
}

function servico(opts: {
  episodios?: Ep[];
  saida?: string;
  llm?: Partial<LlmProvider>;
  duranteIa?: (lista: Ep[]) => void;
  /** Roda depois de cada leitura: outra escrita que passa na frente. */
  aposLer?: (lista: Ep[]) => void;
  guardados?: Record<string, Buffer>;
} = {}) {
  const lista = opts.episodios ?? [ep()];
  const chamadas: Array<{ system: string; user: string; orgId?: string; maxTokens?: number }> = [];
  const condicionais: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const auditoria: Array<Record<string, unknown>> = [];
  const guardados: Record<string, Buffer> = opts.guardados ?? {};
  let relogio = Date.parse('2026-09-24T12:00:00.000Z');

  const llm = {
    name: 'dublê',
    model: 'dublê-1',
    configured: true,
    supportsTools: false,
    complete: async (m: { system: string; user: string; orgId?: string; maxTokens?: number }) => {
      chamadas.push(m);
      opts.duranteIa?.(lista);
      return opts.saida ?? respostaDaIa();
    },
    ...opts.llm,
  } as unknown as LlmProvider;

  const prisma = {
    pautaEpisodio: {
      findFirst: async ({ where }: { where: { id: string; orgId: string } }) => {
        const e = lista.find((x) => x.id === where.id && x.orgId === where.orgId);
        const lido = e ? structuredClone(e) : null;
        opts.aposLer?.(lista);
        return lido;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        condicionais.push({ where, data });
        const alvo = lista.filter((e) =>
          Object.entries(where).every(([k, v]) => {
            const atual = (e as Record<string, unknown>)[k];
            return v instanceof Date && atual instanceof Date ? v.getTime() === atual.getTime() : atual === v;
          }),
        );
        for (const e of alvo) Object.assign(e, structuredClone(data), { atualizadoEm: new Date((relogio += 1000)) });
        return { count: alvo.length };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditoria.push(data);
        return data;
      },
    },
  } as unknown as PrismaService;

  const memoria = { porChave: async () => null } as unknown as MemoriaService;
  const storage = {
    put: async (chave: string, corpo: Buffer, tipo: string) => {
      if (tipo !== 'image/png') throw new Error('tipo errado');
      guardados[chave] = corpo;
    },
    get: async (chave: string) => {
      const b = guardados[chave];
      if (!b) throw new Error('NoSuchKey');
      return { stream: Readable.from([b]), contentType: 'image/png', size: b.length };
    },
  } as unknown as StorageService;
  const audit = new AuditService(prisma);

  return {
    pacotes: new PacoteService(prisma, audit, llm, new VozService(prisma, audit, llm, memoria), storage, new EpisodioService(prisma, audit), semMarca),
    lista,
    chamadas,
    condicionais,
    auditoria,
    guardados,
  };
}

describe('pacote: gerar (o critério de pronto, com a transcrição de exemplo)', () => {
  it('saem 3 títulos, a descrição com capítulos válidos e os links, e 3 briefs — com a empresa pagando', async () => {
    const s = servico();
    const r = await s.pacotes.gerar(ORG, 'e1', PESSOA, { substituir: false });

    expect(s.chamadas).toHaveLength(1);
    expect(s.chamadas[0].orgId).toBe(ORG);
    expect(s.chamadas[0].maxTokens).toBe(SAIDA_DA_GERACAO_LONGA);
    expect(s.chamadas[0].system).toContain(TOM_DA_CASA);
    expect(s.chamadas[0].user).toContain('[01:04] A segunda é o agente');

    const e = r.episodio;
    expect(e.status).toBe('pacote');
    expect(e.titulos).toHaveLength(3);
    expect(e.titulos.every((t) => t.texto.length <= 100 && !t.escolhido)).toBe(true);
    expect(new Set(e.titulos.map((t) => t.angulo)).size).toBe(3);

    const caps = capitulosDaDescricao(e.descricao);
    expect(caps.length).toBeGreaterThanOrEqual(3);
    expect(conferirCapitulos(caps, DURACAO)).toEqual([]);
    expect(e.descricao).toContain('00:00 Abertura e avisos');
    expect(e.descricao).toContain('https://noticia.exemplo/preco');
    expect(e.descricao).toContain('https://noticia.exemplo/sheets');
    expect(e.descricao).toContain('https://noticia.exemplo/transcricao');
    expect(e.descricao).not.toMatch(/mail\.google|link\.exemplo|x\.exemplo/);
    expect(e.descricao).toContain(PAUTA_MARCADOR_DA_PAGINA_DE_LINKS);
    expect(e.descricao).toContain('#IA #PequenasEmpresas #Automação');

    expect(e.thumbs).toHaveLength(3);
    expect(e.thumbs.every((t) => t.texto.split(' ').length <= 4 && t.texto.includes(t.destaque) && t.imagem === null)).toBe(true);
    expect(e.thumbs.every((t) => t.tempoSeg >= 0 && t.tempoSeg < DURACAO)).toBe(true);
    expect(r.avisos).toEqual([]);
    expect(r.correcoes.length).toBeGreaterThan(0);
  });

  it('a escrita é condicionada ao status e à versão lidos antes da IA, e o RASTRO leva as contas, não o texto', async () => {
    const s = servico();
    await s.pacotes.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(s.condicionais[0].where).toEqual({ id: 'e1', orgId: ORG, status: 'pacote', atualizadoEm: new Date('2026-09-24T12:00:00.000Z') });
    expect(Object.keys(s.condicionais[0].data).sort()).toEqual(['descricao', 'thumbs', 'titulos']);
    expect(s.auditoria.at(-1)).toMatchObject({
      action: 'pauta.episodio_pacote_gerado',
      actorId: PESSOA,
      entityId: 'e1',
      before: { tinhaPacote: false, thumbsComImagem: 0 },
      after: { titulos: 3, capitulos: 6, links: 3, thumbs: 3, provider: 'dublê', model: 'dublê-1', avisos: [] },
    });
    expect(JSON.stringify(s.auditoria.at(-1))).not.toContain('noticia.exemplo');
  });

  it('antes do Pacote ou sem transcrição é 400 sem gastar IA', async () => {
    const cedo = servico({ episodios: [ep({ status: 'edicao' })] });
    await expect(cedo.pacotes.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toBeInstanceOf(BadRequestException);
    const semTexto = servico({ episodios: [ep({ transcricao: [] })] });
    await expect(semTexto.pacotes.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toThrow(/não tem transcrição/);
    expect(cedo.chamadas.length + semTexto.chamadas.length).toBe(0);
  });

  it('já tem pacote: 409 sem gastar IA; com a confirmação, substitui — e as imagens das thumbs saem junto', async () => {
    const velho = [{ n: 1, texto: 'Velha', destaque: 'Velha', tempoSeg: 5, imagem: { chave: 'k', sha: 's', bytes: 1, largura: 1280, altura: 720, enviadaEm: 'x' } }];
    const s = servico({ episodios: [ep({ titulos: [{ texto: 'Um título antigo', angulo: '', escolhido: true }], thumbs: velho })] });
    await expect(s.pacotes.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toBeInstanceOf(ConflictException);
    expect(s.chamadas).toHaveLength(0);
    const r = await s.pacotes.gerar(ORG, 'e1', PESSOA, { substituir: true });
    expect(r.episodio.titulos.some((t) => t.escolhido)).toBe(false);
    expect(r.episodio.thumbs.every((t) => t.imagem === null)).toBe(true);
    expect(s.auditoria.at(-1)).toMatchObject({ before: { tinhaPacote: true, thumbsComImagem: 1 } });
  });

  it('resposta que não é JSON, ou com menos de 3 títulos, é 503 e nada é gravado', async () => {
    const md = servico({ saida: '# Títulos\n1. Um\n2. Dois' });
    await expect(md.pacotes.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toBeInstanceOf(ServiceUnavailableException);
    const poucos = servico({ saida: respostaDaIa({ titulos: [{ texto: 'Só um título aqui' }] }) });
    await expect(poucos.pacotes.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toThrow(/1 título/);
    expect(md.condicionais.length + poucos.condicionais.length).toBe(0);
    expect(md.auditoria.length + poucos.auditoria.length).toBe(0);
  });

  it('vídeo curto demais para capítulos: o pacote sai sem eles, com o aviso na resposta e no RASTRO', async () => {
    const s = servico({ episodios: [ep({ midia: { ...MIDIA, duracaoSeg: 25 }, transcricao: SEGMENTOS.slice(0, 2) })] });
    const r = await s.pacotes.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(r.avisos[0]).toMatch(/Sem capítulos/);
    expect(capitulosDaDescricao(r.episodio.descricao)).toEqual([]);
    expect(s.auditoria.at(-1)).toMatchObject({ after: { capitulos: 0, avisos: [expect.stringMatching(/Sem capítulos/)] } });
  });

  it('sem mídia registrada, a duração é o fim da transcrição', async () => {
    const s = servico({ episodios: [ep({ midia: {} })] });
    const r = await s.pacotes.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(s.chamadas[0].user).toContain('Duração do vídeo final: 10:53');
    expect(conferirCapitulos(capitulosDaDescricao(r.episodio.descricao), DURACAO - 2)).toEqual([]);
  });

  it('IA sem credencial é 503 antes de chamar; outra empresa é 404', async () => {
    const s = servico({ llm: { configured: false } });
    await expect(s.pacotes.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(s.chamadas).toHaveLength(0);
    await expect(servico().pacotes.gerar('outra-org', 'e1', PESSOA, { substituir: false })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('um título marcado enquanto a IA pensava: 409, e a marcação fica', async () => {
    const s = servico({
      episodios: [ep({ titulos: [{ texto: 'Título marcado à mão', angulo: '', escolhido: false }] })],
      duranteIa: (l) => Object.assign(l[0], { titulos: [{ texto: 'Título marcado à mão', angulo: '', escolhido: true }], atualizadoEm: new Date('2026-09-24T12:05:00.000Z') }),
    });
    await expect(s.pacotes.gerar(ORG, 'e1', PESSOA, { substituir: true })).rejects.toBeInstanceOf(ConflictException);
    expect(titulosDoPacote(s.lista[0].titulos)[0].escolhido).toBe(true);
    expect(s.auditoria).toHaveLength(0);
  });
});

describe('pacote: o título escolhido', () => {
  const comPacote = () => servico({ episodios: [ep({ titulos: [{ texto: 'Título um', angulo: 'a', escolhido: false }, { texto: 'Título dois', angulo: 'b', escolhido: true }, { texto: 'Título três', angulo: 'c', escolhido: false }] })] });

  it('marca um só, desmarca com nulo e audita qual foi', async () => {
    const s = comPacote();
    const d = await s.pacotes.escolherTitulo(ORG, 'e1', PESSOA, 3);
    expect(d.titulos.map((t) => t.escolhido)).toEqual([false, false, true]);
    expect(s.auditoria.at(-1)).toMatchObject({ action: 'pauta.episodio_titulo_escolhido', before: { escolhido: 2 }, after: { escolhido: 3, titulo: 'Título três' } });
    const nenhum = await s.pacotes.escolherTitulo(ORG, 'e1', PESSOA, null);
    expect(nenhum.titulos.every((t) => !t.escolhido)).toBe(true);
    expect(s.condicionais[0].where).toMatchObject({ atualizadoEm: new Date('2026-09-24T12:00:00.000Z') });
  });

  it('agendado ou concluído: o título não muda (400, sem escrever); antes disso a escrita é condicionada ao status', async () => {
    for (const status of ['agendado', 'concluido'] as const) {
      const s = servico({ episodios: [ep({ status, titulos: [{ texto: 'Título um', angulo: 'a', escolhido: true }] })] });
      await expect(s.pacotes.escolherTitulo(ORG, 'e1', PESSOA, null)).rejects.toThrow(/registro do que subiu/);
      expect(s.condicionais).toHaveLength(0);
      expect(s.auditoria).toHaveLength(0);
    }
    const s = comPacote();
    await s.pacotes.escolherTitulo(ORG, 'e1', PESSOA, 1);
    expect(s.condicionais[0].where).toMatchObject({ status: 'pacote' });
  });

  it('sem pacote é 400; número que não existe é 400; outra empresa é 404', async () => {
    await expect(servico().pacotes.escolherTitulo(ORG, 'e1', PESSOA, 1)).rejects.toThrow(/gere o pacote/);
    const s = servico({ episodios: [ep({ titulos: [{ texto: 'Só um título', angulo: '', escolhido: false }] })] });
    await expect(s.pacotes.escolherTitulo(ORG, 'e1', PESSOA, 2)).rejects.toBeInstanceOf(BadRequestException);
    await expect(comPacote().pacotes.escolherTitulo('outra', 'e1', PESSOA, 1)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('pacote: as thumbs (os briefs para o Mac, o PNG que volta)', () => {
  const briefs = [
    { n: 1, texto: 'Preço da IA caiu', destaque: 'caiu', tempoSeg: 45, imagem: null },
    { n: 2, texto: 'Planilha sozinha', destaque: 'sozinha', tempoSeg: 82, imagem: null },
    { n: 3, texto: 'Ata grátis', destaque: 'grátis', tempoSeg: 214, imagem: null },
  ];

  it('GET devolve os briefs com o tempo do frame, onde está o vídeo final e a duração', async () => {
    const r = await servico({ episodios: [ep({ thumbs: briefs })] }).pacotes.thumbsParaRender(ORG, 'e1');
    expect(r).toMatchObject({ apelido: 'ep-03', arquivoFinal: MIDIA.arquivoFinal, duracaoSeg: DURACAO, status: 'pacote' });
    expect(r.thumbs[1]).toEqual({ n: 2, texto: 'Planilha sozinha', destaque: 'sozinha', tempoSeg: 82, tempo: '1:22', temImagem: false });
  });

  it('o PNG vai para o storage com o hash no nome e o episódio guarda a imagem, com versão e RASTRO', async () => {
    const s = servico({ episodios: [ep({ thumbs: briefs })] });
    const arquivo = png(1280, 720, 2048);
    const r = await s.pacotes.enviarThumb(ORG, 'e1', PESSOA, 2, { buffer: arquivo, mimetype: 'image/png', size: arquivo.length });
    expect(r.thumbs.map((t) => t.temImagem)).toEqual([false, true, false]);
    const chaves = Object.keys(s.guardados);
    expect(chaves).toHaveLength(1);
    expect(chaves[0]).toMatch(/^pauta\/thumb\/e1-2-[0-9a-f]{12}\.png$/);
    expect(s.condicionais[0].where).toMatchObject({ id: 'e1', orgId: ORG, atualizadoEm: new Date('2026-09-24T12:00:00.000Z') });
    expect(thumbsGuardadas(s.lista[0].thumbs)[1].imagem).toMatchObject({ chave: chaves[0], bytes: 2048, largura: 1280, altura: 720 });
    expect(s.auditoria.at(-1)).toMatchObject({ action: 'pauta.episodio_thumb', after: { n: 2, bytes: 2048, largura: 1280, altura: 720 } });

    const img = await s.pacotes.imagemDaThumb(ORG, 'e1', 2);
    expect(img.size).toBe(2048);
    await expect(s.pacotes.imagemDaThumb(ORG, 'e1', 1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('arquivo fora do limite é 400 antes de tocar no storage e no episódio', async () => {
    const s = servico({ episodios: [ep({ thumbs: briefs })] });
    const grande = png(1280, 720, PAUTA_THUMB_MAX_BYTES + 1);
    await expect(s.pacotes.enviarThumb(ORG, 'e1', PESSOA, 1, { buffer: grande, mimetype: 'image/png', size: grande.length })).rejects.toThrow(/2 MB/);
    await expect(s.pacotes.enviarThumb(ORG, 'e1', PESSOA, 1, { buffer: png(1280, 720), mimetype: 'image/webp' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.pacotes.enviarThumb(ORG, 'e1', PESSOA, 1, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(Object.keys(s.guardados)).toHaveLength(0);
    expect(s.condicionais).toHaveLength(0);
  });

  it('agendado: a imagem da thumb não muda (400 antes do storage); antes disso a escrita é condicionada ao status', async () => {
    const s = servico({ episodios: [ep({ status: 'agendado', thumbs: briefs })] });
    await expect(s.pacotes.enviarThumb(ORG, 'e1', PESSOA, 1, { buffer: png(1280, 720), mimetype: 'image/png' })).rejects.toThrow(/registro do que subiu/);
    expect(Object.keys(s.guardados)).toHaveLength(0);
    expect(s.condicionais).toHaveLength(0);
    const ok = servico({ episodios: [ep({ status: 'derivacao', thumbs: briefs })] });
    await ok.pacotes.enviarThumb(ORG, 'e1', PESSOA, 1, { buffer: png(1280, 720), mimetype: 'image/png' });
    expect(ok.condicionais[0].where).toMatchObject({ status: 'derivacao' });
  });

  it('sem o brief (pacote não gerado) é 400; outra empresa é 404; a imagem sumida do storage é 404', async () => {
    const semBrief = servico();
    await expect(semBrief.pacotes.enviarThumb(ORG, 'e1', PESSOA, 1, { buffer: png(1280, 720), mimetype: 'image/png' })).rejects.toThrow(/gere o pacote/);
    await expect(semBrief.pacotes.thumbsParaRender('outra', 'e1')).rejects.toBeInstanceOf(NotFoundException);
    const sumida = servico({
      episodios: [ep({ thumbs: [{ ...briefs[0], imagem: { chave: 'pauta/thumb/sumiu.png', sha: 'x', bytes: 1, largura: 1280, altura: 720, enviadaEm: 'agora' } }] })],
    });
    await expect(sumida.pacotes.imagemDaThumb(ORG, 'e1', 1)).rejects.toThrow(/não está no storage/);
  });

  it('outra escrita entre a leitura e a gravação do envio: 409', async () => {
    const s = servico({
      episodios: [ep({ thumbs: briefs })],
      aposLer: (l) => (l[0].atualizadoEm = new Date('2026-09-24T12:09:00.000Z')),
    });
    await expect(s.pacotes.enviarThumb(ORG, 'e1', PESSOA, 1, { buffer: png(1280, 720), mimetype: 'image/png' })).rejects.toBeInstanceOf(ConflictException);
    expect(s.auditoria).toHaveLength(0);
  });
});

describe('pacote: o controller', () => {
  const usuario = { sub: PESSOA, orgId: ORG } as never;

  function controller() {
    const chamadas: Array<{ metodo: string; args: unknown[] }> = [];
    const anota = (metodo: string) => async (...args: unknown[]) => {
      chamadas.push({ metodo, args });
      return metodo === 'imagemDaThumb' ? { stream: Readable.from([Buffer.from('png')]), size: 3 } : {};
    };
    const duble = {
      gerar: anota('gerar'),
      escolherTitulo: anota('escolherTitulo'),
      thumbsParaRender: anota('thumbsParaRender'),
      enviarThumb: anota('enviarThumb'),
      imagemDaThumb: anota('imagemDaThumb'),
    } as unknown as PacoteService;
    return { c: new PacoteController(duble), chamadas };
  }

  it('gerar com corpo vazio chega sem substituir; título fora de 1–3 e thumb fora de 1–3 são recusados antes do serviço', async () => {
    const { c, chamadas } = controller();
    await c.gerar(usuario, 'e1', undefined);
    expect(chamadas[0]).toEqual({ metodo: 'gerar', args: [ORG, 'e1', PESSOA, { substituir: false }] });
    await c.escolherTitulo(usuario, 'e1', { n: null });
    expect(chamadas[1]).toEqual({ metodo: 'escolherTitulo', args: [ORG, 'e1', PESSOA, null] });
    expect(() => c.escolherTitulo(usuario, 'e1', { n: 0 })).toThrow();
    expect(() => c.enviarThumb(usuario, 'e1', '4', undefined)).toThrow();
    await c.enviarThumb(usuario, 'e1', '3', undefined);
    expect(chamadas[2]).toEqual({ metodo: 'enviarThumb', args: [ORG, 'e1', PESSOA, 3, undefined] });
    expect(chamadas).toHaveLength(3);
  });

  it('a imagem sai como image/png, sem cache, com o tamanho', async () => {
    const { c } = controller();
    const cabecalhos: Record<string, unknown> = {};
    const partes: Buffer[] = [];
    const { Writable } = await import('node:stream');
    const res = Object.assign(
      new Writable({
        write(chunk, _enc, cb) {
          partes.push(Buffer.from(chunk));
          cb();
        },
      }),
      { setHeader: (k: string, v: unknown) => (cabecalhos[k] = v) },
    );
    await c.imagem(usuario, 'e1', '1', res as never);
    await new Promise((ok) => res.on('finish', ok));
    expect(cabecalhos).toEqual({ 'Content-Type': 'image/png', 'Content-Length': 3, 'Cache-Control': 'private, no-store' });
    expect(Buffer.concat(partes).toString()).toBe('png');
  });

  it('as rotas são sub-rotas de /pauta/episodios, com pauta.editar para escrever e automacoes.executar para gastar IA', () => {
    expect(Reflect.getMetadata('path', PacoteController)).toBe('pauta/episodios');
    const proto = PacoteController.prototype as unknown as Record<string, object>;
    const rotas: Array<[string, string, string[]]> = [
      ['gerar', ':id/pacote/gerar', ['pauta.editar', 'automacoes.executar']],
      ['escolherTitulo', ':id/pacote/titulo', ['pauta.editar']],
      ['thumbs', ':id/thumbs', ['pauta.ver']],
      ['enviarThumb', ':id/thumbs/:n', ['pauta.editar']],
      ['imagem', ':id/thumbs/:n/imagem', ['pauta.ver']],
    ];
    for (const [metodo, caminho, perms] of rotas) {
      expect(Reflect.getMetadata('path', proto[metodo]), metodo).toBe(caminho);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[metodo]), metodo).toEqual(perms);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Com banco
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (uma empresa, uma rodada e um episódio)');

const MARCA = `pc${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

describe.skipIf(!URL)('pacote com banco: gerar, escolher e subir a thumb pela sessão da empresa', () => {
  let admin: PrismaClient;
  let cru: PrismaClient;
  let pacotes: PacoteService;
  let episodios: EpisodioService;
  const guardados: Record<string, Buffer> = {};
  let orgId = '';

  const na = <T>(fn: () => Promise<T>) =>
    comContexto({ orgId, actorType: 'user', actorId: null, correlationId: `teste-${MARCA}`, origem: 'http' }, fn);

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: URL } } });
    cru = new PrismaClient({ datasourceUrl: URL });
    const app = comTenantNaSessao(cru, { modo: 'impor' }) as unknown as PrismaService;
    const llm = { name: 'dublê', model: 'd', configured: true, supportsTools: false, complete: async () => respostaDaIa() } as unknown as LlmProvider;
    const memoria = new MemoriaService(app, {} as never);
    const storage = {
      put: async (k: string, b: Buffer) => void (guardados[k] = b),
      get: async (k: string) => ({ stream: Readable.from([guardados[k]]), contentType: 'image/png', size: guardados[k].length }),
    } as unknown as StorageService;
    episodios = new EpisodioService(app, new AuditService(app));
    pacotes = new PacoteService(app, new AuditService(app), llm, new VozService(app, new AuditService(app), llm, memoria), storage, episodios, semMarca);
    const o = await admin.org.create({ data: { name: `Pacote ${MARCA}`, slug: `pc-${MARCA}`, modulos: ['pauta'] } });
    orgId = o.id;
  }, 60_000);

  afterAll(async () => {
    if (orgId) {
      await admin.pautaEpisodio.deleteMany({ where: { orgId } });
      await admin.pautaRodada.deleteMany({ where: { orgId } });
      await admin.auditLog.deleteMany({ where: { orgId } });
      await admin.org.deleteMany({ where: { id: orgId } });
    }
    await admin?.$disconnect();
    await cru?.$disconnect();
  });

  it('da transcrição ao pacote com capítulos válidos, título marcado e a thumb 1 no storage', async () => {
    const rodada = await admin.pautaRodada.create({
      data: { orgId, status: 'curada', titulo: `Semana ${MARCA}`, janelaIni: new Date(), janelaFim: new Date(), itens: ITENS as never },
    });
    const e = await na(() => episodios.criar(orgId, 'pessoa', { rodadaId: rodada.id }));
    await admin.pautaEpisodio.update({
      where: { id: e.id },
      data: { status: 'pacote', midia: MIDIA as never, transcricao: SEGMENTOS as never, transcricaoTexto: 'x' },
    });

    const r = await na(() => pacotes.gerar(orgId, e.id, 'pessoa', { substituir: false }));
    expect(r.episodio.titulos).toHaveLength(3);
    expect(conferirCapitulos(capitulosDaDescricao(r.episodio.descricao), DURACAO)).toEqual([]);
    expect(r.episodio.descricao).not.toContain('mail.google');

    const escolhido = await na(() => pacotes.escolherTitulo(orgId, e.id, 'pessoa', 2));
    expect(escolhido.titulos[1].escolhido).toBe(true);

    const arquivo = png(1280, 720, 1024);
    await na(() => pacotes.enviarThumb(orgId, e.id, 'pessoa', 1, { buffer: arquivo, mimetype: 'image/png', size: arquivo.length }));
    const gravado = await admin.pautaEpisodio.findUnique({ where: { id: e.id } });
    expect(thumbsGuardadas(gravado?.thumbs)[0].imagem?.chave).toMatch(new RegExp(`^pauta/thumb/${e.id}-1-`));
    expect(Object.keys(guardados)).toHaveLength(1);

    const detalhe = await na(() => episodios.obter(orgId, e.id));
    expect(detalhe.thumbs[0].imagem).toMatchObject({ bytes: 1024, largura: 1280, altura: 720 });
    expect(JSON.stringify(detalhe)).not.toContain('pauta/thumb/');

    const acoes = await admin.auditLog.findMany({ where: { orgId, entityId: e.id }, select: { action: true } });
    expect(acoes.map((a) => a.action)).toEqual(
      expect.arrayContaining(['pauta.episodio_pacote_gerado', 'pauta.episodio_titulo_escolhido', 'pauta.episodio_thumb']),
    );
  }, 60_000);
});
