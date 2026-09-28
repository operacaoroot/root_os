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
  PAUTA_MARCADOR_DO_VIDEO,
  PAUTA_PALAVRAS_POR_PARAGRAFO,
  PautaNewsletterGerarSchema,
  PautaNewsletterVideoSchema,
  checagemAntiSlop,
  motivoParaNaoGerarNewsletter,
  semEmoji,
  type PautaEpisodioStatus,
  type PautaItemCurado,
} from '@mktos/shared';

import {
  CHAMADA_DA_PAGINA,
  CHAMADA_DO_VIDEO,
  NewsletterInvalidaError,
  checagemDaNewsletter,
  comOsMarcadores,
  ehBlocoDoSistema,
  ehNewsletterDaTranscricao,
  entradaDaNewsletter,
  frasesDitas,
  lerMetaDaNewsletter,
  montarNewsletter,
  newsletterEmHtml,
  pedidoDeReescrita,
  shaDaTranscricao,
  systemDaNewsletter,
  textoDaNewsletter,
  tituloDaNewsletter,
} from '../src/pauta/newsletter-do-episodio';
import type { Segmento } from '../src/pauta/pacote-do-episodio';
import { TOM_DA_CASA } from '../src/pauta/voz-da-pauta';
import { NewsletterService } from '../src/pauta/newsletter.service';
import { NewsletterController } from '../src/pauta/newsletter.controller';
import { EpisodioService } from '../src/pauta/episodio.service';
import { RodadaService } from '../src/pauta/rodada.service';
import { VozService } from '../src/pauta/voz.service';
import { MemoriaService } from '../src/memory/memoria.service';
import { AuditService } from '../src/audit/audit.service';
import type { LlmProvider } from '../src/llm/llm.provider';
import { comContexto } from '../src/common/contexto-execucao';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import type { PrismaService } from '../src/prisma/prisma.service';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { exigirBancoDescartavel } from './banco-de-teste';
import { SAIDA_DA_GERACAO_LONGA } from '../src/pauta/saida-da-geracao';

/*
 * A NEWSLETTER A PARTIR DA TRANSCRIÇÃO — MC13.
 *
 * Quatro camadas:
 *   1. a parte pura: a checagem anti-slop (palavras proibidas, emoji, frases de
 *      IA, parágrafo longo para o celular), a montagem (uma seção por matéria
 *      falada, o link saindo do item e nunca da newsletter de origem L, a
 *      chamada final com os marcadores), as frases ditas, os marcadores e o
 *      HTML escapado;
 *   2. os contratos: os esquemas e em que status a newsletter sai;
 *   3. o `NewsletterService` DE VERDADE com dublês de prisma, LLM e memória —
 *      com a TRANSCRIÇÃO DE EXEMPLO do critério de pronto: sai com as frases
 *      ditas, os links e a checagem aprovada ou apontada; refaz uma vez;
 *      exporta em md e html; e o controller montado à mão;
 *   4. com banco: gerar, substituir e exportar pela sessão da empresa.
 */

const ORG = '7c0f0a8e-4444-4a5a-9c1e-00000000mc13';
const PESSOA = 'b1d2c3e4-0000-4000-8000-000000000013';

const ITENS: PautaItemCurado[] = [
  { id: 'c1', titulo: 'Preço do modelo caiu pela metade', url: 'https://noticia.exemplo/preco', origem: 'N', resumo: 'API mais barata.' },
  { id: 'c2', titulo: 'Agente de planilha no Sheets', url: 'https://noticia.exemplo/sheets', origem: 'W' },
  { id: 'c3', titulo: 'Ferramenta grátis de transcrição', url: 'https://noticia.exemplo/transcricao', origem: 'R' },
  // A newsletter como o episódio a recebe: sem o url (itensMantidos o apaga).
  { id: 'c4', titulo: 'The Batch desta semana', url: '', origem: 'L', fonte: 'The Batch', semLinkPublico: true },
  // Uma newsletter antiga, sem a marca: o permalink do Gmail ainda está no url.
  { id: 'c5', titulo: 'Resumo da Ben’s Bites', url: 'https://mail.google.com/mail/u/0/#inbox/18c2f0a', origem: 'L' },
];

/* A TRANSCRIÇÃO DE EXEMPLO: um episódio de 11 min, como o whisper devolve. */
const FALAS: Array<[number, string]> = [
  [0.0, 'Bom dia, esta é a semana 39 da ROOT.'],
  [4.2, 'Hoje são quatro notícias que mexem no custo de quem toca uma empresa.'],
  [31.4, 'Começa pelo preço dos modelos, que caiu pela metade nesta semana.'],
  [44.9, 'Na prática, a mesma automação de atendimento custa a metade por mês.'],
  [64.5, 'A segunda é o agente que preenche planilha sozinho dentro do Sheets.'],
  [82.3, 'A planilha de contas a pagar se preenche a partir do e-mail.'],
  [131.7, 'Isso tira umas duas horas por semana de quem fecha o caixa.'],
  [190.2, 'Terceira: uma ferramenta grátis de transcrição de reunião.'],
  [214.8, 'Grava, transcreve e manda a ata no fim da chamada.'],
  [268.0, 'Para quem vende serviço, a ata vira proposta no mesmo dia.'],
  [345.5, 'E a newsletter The Batch trouxe o contexto da semana nos modelos abertos.'],
  [402.1, 'O ponto é que modelo aberto já roda num computador comum.'],
  [540.3, 'Troque uma tarefa manual por semana e meça o tempo que sobra.'],
  [612.0, 'Semana que vem tem mais. Até lá.'],
];
const DURACAO = 655;
const SEGMENTOS: Segmento[] = FALAS.map(([inicio, texto], i) => ({
  inicio,
  fim: i + 1 < FALAS.length ? FALAS[i + 1][0] - 0.3 : DURACAO - 2,
  texto,
}));

/** O que um modelo obediente devolve: as frases ditas, quase literais. */
function respostaDaIa(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    titulo: 'Semana 39: o preço caiu e a planilha se preenche sozinha',
    abertura: 'Hoje são quatro notícias que mexem no custo de quem toca uma empresa.',
    secoes: [
      {
        n: 1,
        titulo: 'O preço dos modelos caiu',
        texto:
          'O preço dos modelos caiu pela metade nesta semana.\n\nNa prática, a mesma automação de atendimento custa a metade por mês. Veja https://inventado.exemplo/fonte',
      },
      {
        n: 2,
        titulo: 'A planilha que se preenche',
        texto: 'O agente preenche planilha sozinho dentro do Sheets. Isso tira umas duas horas por semana de quem fecha o caixa.',
      },
      {
        n: 3,
        titulo: 'Ata de reunião grátis',
        texto: 'Uma ferramenta grátis de transcrição de reunião: grava, transcreve e manda a ata no fim da chamada.',
      },
      {
        n: 4,
        titulo: 'Modelos abertos',
        texto: 'A newsletter The Batch trouxe o contexto da semana nos modelos abertos. Modelo aberto já roda num computador comum.',
      },
    ],
    fechamento: 'Troque uma tarefa manual por semana e meça o tempo que sobra.',
    ...extra,
  });
}

/** A mesma, com o que a casa proíbe: palavra, emoji, abertura de IA e um paredão de texto. */
function respostaComSlop(): string {
  const paredao = Array.from({ length: 80 }, (_, i) => `palavra${i}`).join(' ');
  return respostaDaIa({
    titulo: 'Semana 39 🚀',
    abertura: 'Em um mundo cada vez mais digital, vamos explorar como alavancar o caixa.',
    fechamento: paredao,
  });
}

// ---------------------------------------------------------------------------
// 1. A parte pura
// ---------------------------------------------------------------------------

describe('newsletter: a checagem anti-slop', () => {
  it('texto limpo passa sem apontamento', () => {
    const c = checagemAntiSlop('# Título\n\nO preço caiu pela metade.\n\nFonte: [Matéria](https://noticia.exemplo/x)');
    expect(c).toEqual({ aprovada: true, apontamentos: [] });
  });

  it('aponta a palavra proibida pela conjugação, sem acento nem caixa, com onde está', () => {
    const c = checagemAntiSlop('# Sinergia na empresa\n\nO time está ALAVANCANDO o caixa.\n\nUma solucao completa.');
    expect(c.aprovada).toBe(false);
    expect(c.apontamentos).toEqual([
      { regra: 'palavra_proibida', trecho: 'sinergia', onde: 'título “Sinergia na empresa”' },
      { regra: 'palavra_proibida', trecho: 'alavancar', onde: 'parágrafo 1' },
      { regra: 'palavra_proibida', trecho: 'solução completa', onde: 'parágrafo 2' },
    ]);
  });

  it('aponta emoji uma vez por bloco, com os emojis achados', () => {
    const c = checagemAntiSlop('Caiu o preço 🚀🚀 e subiu a conta ✅\n\nSem nada aqui.');
    expect(c.apontamentos).toEqual([{ regra: 'emoji', trecho: '🚀 ✅', onde: 'parágrafo 1' }]);
  });

  it('emoji é também bandeira e keycap (um trecho só cada); ©, ® e ™ são tipografia e passam', () => {
    const c = checagemAntiSlop('O Brasil 🇧🇷 lidera. Veja 1️⃣ passo e ❤️.\n\nChatGPT™ e Copilot® © Reuters ↔ ‼');
    expect(c.apontamentos).toEqual([{ regra: 'emoji', trecho: '🇧🇷 1️⃣ ❤️', onde: 'parágrafo 1' }]);
    expect(semEmoji('Nova IA 🚀 da OpenAI 🇧🇷 👨‍💻 chega™')).toBe('Nova IA da OpenAI chega™');
  });

  it('o endereço de um link não é texto: palavra proibida e emoji só contam no rótulo e fora do link', () => {
    const limpo = checagemAntiSlop('Veja [a matéria](https://techcrunch.com/2026/09/ai-disruption-report) e https://x.exemplo/mindset-sinergia.');
    expect(limpo).toEqual({ aprovada: true, apontamentos: [] });
    const rotulo = checagemAntiSlop('Veja [o mindset novo](https://x.exemplo/a).');
    expect(rotulo.apontamentos).toEqual([{ regra: 'palavra_proibida', trecho: 'mindset', onde: 'parágrafo 1' }]);
  });

  it('ignorarBloco pula o bloco sem mudar a numeração dos parágrafos que a tela mostra', () => {
    const c = checagemAntiSlop('Sistema 🚀\n\nDo modelo 🚀', { ignorarBloco: (b) => b.startsWith('Sistema') });
    expect(c.apontamentos).toEqual([{ regra: 'emoji', trecho: '🚀', onde: 'parágrafo 2' }]);
  });

  it('aponta as frases de abertura de IA em qualquer caixa, com ou sem acento', () => {
    const c = checagemAntiSlop('NESTE ARTIGO, vamos explorar o tema.\n\nEm um mundo cada vez mais rápido.\n\nE importante ressaltar que caiu.');
    expect(c.apontamentos.map((a) => [a.trecho, a.onde])).toEqual([
      ['Neste artigo', 'parágrafo 1'],
      ['Vamos explorar', 'parágrafo 1'],
      ['Em um mundo cada vez mais', 'parágrafo 2'],
      ['É importante ressaltar', 'parágrafo 3'],
    ]);
    expect(c.apontamentos.every((a) => a.regra === 'frase_de_ia')).toBe(true);
  });

  it(`parágrafo acima de ${PAUTA_PALAVRAS_POR_PARAGRAFO} palavras é longo para o celular; título e o endereço do link não contam`, () => {
    const palavras = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`).join(' ');
    const noTeto = `${palavras(PAUTA_PALAVRAS_POR_PARAGRAFO - 1)} [leia](https://a.exemplo/um-endereco-bem-longo)`;
    expect(checagemAntiSlop(`# ${palavras(90)}\n\n${noTeto}`).aprovada).toBe(true);
    const c = checagemAntiSlop(`Curto.\n\n${palavras(PAUTA_PALAVRAS_POR_PARAGRAFO + 1)}`);
    expect(c.apontamentos).toEqual([
      {
        regra: 'paragrafo_longo',
        trecho: 'p0 p1 p2 p3 p4 p5 p6 p7…',
        onde: `parágrafo 2 (${PAUTA_PALAVRAS_POR_PARAGRAFO + 1} palavras; o teto é ${PAUTA_PALAVRAS_POR_PARAGRAFO})`,
      },
    ]);
  });

  it('o pedido de reescrita leva cada apontamento com o rótulo da regra', () => {
    const pedido = pedidoDeReescrita(checagemAntiSlop('Vamos mergulhar 🚀'));
    expect(pedido).toContain('REPROVADA');
    expect(pedido).toContain('- Emoji: "🚀" (parágrafo 1)');
    expect(pedido).toContain('- Frase de IA: "Vamos mergulhar" (parágrafo 1)');
  });
});

describe('newsletter: a montagem a partir da resposta do modelo', () => {
  const ctx = { tituloDoEpisodio: 'Semana 39', itens: ITENS, segmentos: SEGMENTOS };

  it('título, abertura, uma seção por matéria falada, o link do item e a chamada final com os marcadores', () => {
    const m = montarNewsletter(respostaDaIa(), ctx);
    const blocos = m.markdown.split('\n\n');
    expect(blocos[0]).toBe('# Semana 39: o preço caiu e a planilha se preenche sozinha');
    expect(blocos[1]).toBe('Hoje são quatro notícias que mexem no custo de quem toca uma empresa.');
    expect(blocos[2]).toBe('## O preço dos modelos caiu');
    expect(m.markdown).toContain('Fonte: [Preço do modelo caiu pela metade](https://noticia.exemplo/preco)');
    expect(m.markdown).toContain('Fonte: [Agente de planilha no Sheets](https://noticia.exemplo/sheets)');
    expect(m.markdown).toContain('Fonte: [Ferramenta grátis de transcrição](https://noticia.exemplo/transcricao)');
    expect(blocos.slice(-2)).toEqual([CHAMADA_DA_PAGINA, CHAMADA_DO_VIDEO]);
    expect(CHAMADA_DA_PAGINA).toContain(PAUTA_MARCADOR_DA_PAGINA_DE_LINKS);
    expect(CHAMADA_DO_VIDEO).toContain(PAUTA_MARCADOR_DO_VIDEO);
    expect(m).toMatchObject({ secoes: 4, links: 3 });
  });

  it('URL escrita pelo modelo sai; a newsletter (origem L) ganha seção mas nunca link, nem o permalink do Gmail', () => {
    const m = montarNewsletter(respostaDaIa(), ctx);
    expect(m.markdown).not.toContain('inventado.exemplo');
    expect(m.markdown).not.toContain('mail.google');
    expect(m.markdown).toContain('## Modelos abertos');
    const secaoL = m.markdown.split('## Modelos abertos')[1].split('\n\n').slice(0, 3).join('\n\n');
    expect(secaoL).not.toContain('Fonte:');
  });

  it('matéria sem seção vira aviso; número fora da lista, repetido ou seção vazia é ignorado', () => {
    const m = montarNewsletter(
      JSON.stringify({
        titulo: 'T',
        secoes: [
          { n: 1, titulo: 'Um', texto: 'O preço dos modelos caiu pela metade nesta semana.' },
          { n: 1, titulo: 'Repetido', texto: 'outro' },
          { n: 9, titulo: 'Fora', texto: 'fora' },
          { n: 2, titulo: 'Vazio', texto: '   ' },
        ],
      }),
      ctx,
    );
    expect(m.secoes).toBe(1);
    expect(m.markdown).not.toContain('Repetido');
    expect(m.avisos.filter((a) => a.includes('ficou sem seção'))).toHaveLength(4);
  });

  it('seção que não usa nenhuma frase dita vira aviso', () => {
    const m = montarNewsletter(
      JSON.stringify({ titulo: 'T', secoes: [{ n: 1, titulo: 'Inventada', texto: 'Um texto escrito do zero sem nada que tenha sido falado.' }] }),
      ctx,
    );
    expect(m.avisos).toContain('A seção “Inventada” não usa nenhuma frase dita no vídeo.');
  });

  it('não é JSON, não é objeto ou não tem seção: newsletter inválida', () => {
    expect(() => montarNewsletter('texto solto', ctx)).toThrow(NewsletterInvalidaError);
    expect(() => montarNewsletter('[1,2]', ctx)).toThrow(/não veio um objeto/);
    expect(() => montarNewsletter(JSON.stringify({ titulo: 'x', secoes: [] }), ctx)).toThrow(/nenhuma seção/);
  });

  it('sem título do modelo, fica o do episódio; emoji e palavra proibida NÃO são limpos (a checagem tem de vê-los)', () => {
    const m = montarNewsletter(respostaComSlop(), { ...ctx, tituloDoEpisodio: 'Semana 39' });
    expect(m.markdown).toContain('🚀');
    expect(m.markdown).toContain('alavancar');
    expect(montarNewsletter(respostaDaIa({ titulo: '' }), ctx).titulo).toBe('Semana 39');
  });

  it('o texto do modelo perde URL, marcador, subtítulo e lista, e guarda os parágrafos', () => {
    expect(textoDaNewsletter('## Sub\n- um\n- dois {{video}}\n\nveja www.x.exemplo/a e https://y.exemplo', 500)).toBe(
      'Sub um dois\n\nveja e',
    );
    expect(textoDaNewsletter('abcdef', 3)).toBe('abc');
    expect(textoDaNewsletter(42, 10)).toBe('');
  });

  it('URL, link de markdown e marcador escritos pelo modelo nos TÍTULOS saem do markdown e do HTML', () => {
    const m = montarNewsletter(
      respostaDaIa({
        titulo: 'Veja https://inventado.exemplo/x {{video}}',
        secoes: [
          { n: 1, titulo: 'Leia [aqui](https://evil.exemplo/p)', texto: 'O preço dos modelos caiu pela metade nesta semana.' },
          { n: 2, titulo: '## Leia em www.inventado.exemplo/y {{pagina-de-links}}', texto: 'O agente preenche planilha sozinho dentro do Sheets.' },
          { n: 3, titulo: 'https://so-url.exemplo/z', texto: 'Uma ferramenta grátis de transcrição de reunião.' },
        ],
      }),
      ctx,
    );
    expect(m.titulo).toBe('Veja');
    expect(m.markdown.split('\n\n')[0]).toBe('# Veja');
    expect(m.markdown).toContain('## Leia aqui');
    expect(m.markdown).toContain('## Leia em');
    // Título de seção que fica vazio cai no do item.
    expect(m.markdown).toContain('## Ferramenta grátis de transcrição');
    for (const fora of ['inventado.exemplo', 'evil.exemplo', 'so-url.exemplo']) expect(m.markdown).not.toContain(fora);
    // Os únicos marcadores são os das chamadas do sistema.
    expect(m.markdown.match(/\{\{[^}]*\}\}/g)).toEqual([PAUTA_MARCADOR_DA_PAGINA_DE_LINKS, PAUTA_MARCADOR_DO_VIDEO]);
    const html = newsletterEmHtml(m.markdown, m.titulo);
    expect(html).toMatch(/<h1[^>]*>Veja<\/h1>/);
    expect(html).not.toMatch(/inventado|evil|so-url/);
  });

  it('link de markdown de qualquer esquema vira só o rótulo, no texto e no título', () => {
    expect(textoDaNewsletter('Leia [aqui](//golpe.exemplo/x) ou [ali](mailto:a@b.exemplo) e ![img](data:x)', 500)).toBe('Leia aqui ou ali e img');
    expect(tituloDaNewsletter('# [x](//host.exemplo) e [y](javascript:alert(1))', 90)).toBe('x e y');
    expect(tituloDaNewsletter(42, 90)).toBe('');
  });

  it('o título do item que o sistema põe (fonte e título de reserva) sai sem emoji', () => {
    const m = montarNewsletter(JSON.stringify({ titulo: '', secoes: [{ n: 1, texto: 'O preço dos modelos caiu pela metade.' }] }), {
      ...ctx,
      tituloDoEpisodio: 'Semana 39 🚀',
      itens: [{ id: 'z', titulo: 'Nova IA 🚀 da OpenAI', url: 'https://x.exemplo/a', origem: 'C' }],
    });
    expect(m.markdown).toContain('# Semana 39');
    expect(m.markdown).toContain('## Nova IA da OpenAI');
    expect(m.markdown).toContain('Fonte: [Nova IA da OpenAI](https://x.exemplo/a)');
    expect(m.markdown).not.toContain('🚀');
  });

  it('a checagem da newsletter olha só o que o modelo escreveu: fonte e chamadas finais são do sistema', () => {
    const fonte = 'Fonte: [OpenAI disrupts search, a mindset shift](https://techcrunch.com/2026/09/ai-disruption-report)';
    expect(ehBlocoDoSistema(fonte)).toBe(true);
    expect(ehBlocoDoSistema(CHAMADA_DA_PAGINA)).toBe(true);
    expect(ehBlocoDoSistema(CHAMADA_DO_VIDEO)).toBe(true);
    expect(ehBlocoDoSistema('Fonte: o time disruptivo disse isso.')).toBe(false);
    const md = ['# Semana 39', 'O preço caiu.', fonte, 'Fonte: o time disruptivo disse isso.', CHAMADA_DA_PAGINA].join('\n\n');
    expect(checagemDaNewsletter(md).apontamentos).toEqual([{ regra: 'palavra_proibida', trecho: 'disruptivo', onde: 'parágrafo 3' }]);
  });

  it('link com parêntese no endereço e colchete no título não quebra o markdown', () => {
    const m = montarNewsletter(JSON.stringify({ titulo: 'T', secoes: [{ n: 1, titulo: 'x', texto: 'O preço dos modelos caiu pela metade.' }] }), {
      ...ctx,
      itens: [{ id: 'z', titulo: 'Preço [novo]', url: 'https://w.exemplo/a_(b)', origem: 'N' }],
    });
    expect(m.markdown).toContain('Fonte: [Preço (novo)](https://w.exemplo/a_%28b%29)');
  });
});

describe('newsletter: as frases ditas, o prompt e os marcadores', () => {
  it('conta as frases (5 palavras ou mais) que repetem a fala; título, fonte e chamadas não contam', () => {
    const texto = [
      '# Na prática, a mesma automação de atendimento custa a metade',
      'Na prática, a mesma automação de atendimento custa a metade por mês. Uma frase escrita do nada pela máquina.',
      'Curta demais.',
      'Fonte: [Isso tira umas duas horas por semana](https://x.exemplo)',
      CHAMADA_DA_PAGINA,
    ].join('\n\n');
    expect(frasesDitas(texto, SEGMENTOS)).toEqual({ total: 2, ditas: 1 });
    expect(frasesDitas('', SEGMENTOS)).toEqual({ total: 0, ditas: 0 });
  });

  it('o pedido leva as matérias sem link e a transcrição com os tempos', () => {
    const u = entradaDaNewsletter({ apelido: 'ep-03', titulo: 'Semana 39', itens: ITENS, segmentos: SEGMENTOS });
    expect(u).toContain('[1] Preço do modelo caiu pela metade');
    expect(u).toContain('resumo: API mais barata.');
    expect(u).toContain('[00:31] Começa pelo preço dos modelos');
    expect(u).not.toMatch(/https?:\/\//);
  });

  it('o prompt leva o bloco de voz da MC10: sem perfil, o tom da casa', () => {
    const s = systemDaNewsletter(TOM_DA_CASA);
    expect(s).toContain('FRASES DITAS');
    expect(s.endsWith(TOM_DA_CASA)).toBe(true);
  });

  it('os marcadores viram a página no ar e o link do vídeo; o que falta fica e é dito', () => {
    const md = `${CHAMADA_DA_PAGINA}\n\n${CHAMADA_DO_VIDEO}`;
    const nada = comOsMarcadores(md, { paginaNoAr: null, urlDoVideo: null });
    expect(nada.markdown).toBe(md);
    expect(nada.pendentes).toHaveLength(2);
    const tudo = comOsMarcadores(md, { paginaNoAr: 'https://bio.exemplo/@root-ep-03', urlDoVideo: 'https://video.exemplo/v' });
    expect(tudo.markdown).toContain('numa página só: https://bio.exemplo/@root-ep-03');
    expect(tudo.markdown).toContain('em vídeo: https://video.exemplo/v');
    expect(tudo.pendentes).toEqual([]);
  });

  it('a peça da transcrição se reconhece pela meta, do episódio certo; a meta ruim vira padrão', () => {
    expect(ehNewsletterDaTranscricao({ origem: 'transcricao', episodioId: 'e1' }, 'e1')).toBe(true);
    expect(ehNewsletterDaTranscricao({ origem: 'transcricao', episodioId: 'e1' }, 'e2')).toBe(false);
    expect(ehNewsletterDaTranscricao({ origem: 'transcricao', episodioId: 'e1' })).toBe(true);
    expect(ehNewsletterDaTranscricao({})).toBe(false);
    expect(ehNewsletterDaTranscricao(null)).toBe(false);
    expect(lerMetaDaNewsletter('lixo')).toMatchObject({ tentativas: 0, avisos: [], urlDoVideo: null, transcricaoSha: '' });
    expect(shaDaTranscricao(SEGMENTOS)).toMatch(/^[0-9a-f]{16}$/);
    expect(shaDaTranscricao(SEGMENTOS.slice(1))).not.toBe(shaDaTranscricao(SEGMENTOS));
  });
});

describe('newsletter: o HTML simples', () => {
  it('título, subtítulo, parágrafos e links, com largura de celular', () => {
    const html = newsletterEmHtml('# Semana 39\n\nUm parágrafo\ncom quebra.\n\n## Seção\n\nFonte: [Matéria](https://noticia.exemplo/a)', 'Semana 39');
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<title>Semana 39</title>');
    expect(html).toContain('max-width:600px');
    expect(html).toMatch(/<h1 [^>]*>Semana 39<\/h1>/);
    expect(html).toMatch(/<h2 [^>]*>Seção<\/h2>/);
    expect(html).toContain('Um parágrafo<br>com quebra.');
    expect(html).toContain('Fonte: <a href="https://noticia.exemplo/a">Matéria</a>');
  });

  it('nada passa sem escapar: tag, aspas e link que não é http(s) ficam texto', () => {
    const html = newsletterEmHtml('<script>alert(1)</script> "x" [clique](javascript:alert(1))\n\n# <img src=x onerror=alert(1)>', '<b>t</b>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;x&quot;');
    expect(html).toContain('<title>&lt;b&gt;t&lt;/b&gt;</title>');
  });

  it('URL solta vira link sem levar a pontuação do fim; aspas no endereço não fogem do atributo', () => {
    const html = newsletterEmHtml('Todos os links: https://bio.exemplo/@root-ep-03.', 't');
    expect(html).toContain('<a href="https://bio.exemplo/@root-ep-03">https://bio.exemplo/@root-ep-03</a>.');
    const aspas = newsletterEmHtml('[a](https://x.exemplo/?q=1&r=2)', 't');
    expect(aspas).toContain('href="https://x.exemplo/?q=1&amp;r=2"');
  });
});

// ---------------------------------------------------------------------------
// 2. Os contratos
// ---------------------------------------------------------------------------

describe('newsletter: contratos', () => {
  it('gerar só substitui com confirmação; o link do vídeo é https, uma linha, até 500', () => {
    expect(PautaNewsletterGerarSchema.parse({})).toEqual({ substituir: false });
    expect(PautaNewsletterGerarSchema.parse({ substituir: true, urlDoVideo: ' https://video.exemplo/v ' })).toEqual({
      substituir: true,
      urlDoVideo: 'https://video.exemplo/v',
    });
    expect(PautaNewsletterVideoSchema.parse({ urlDoVideo: null })).toEqual({ urlDoVideo: null });
    for (const ruim of ['http://video.exemplo/v', 'javascript:alert(1)', 'https://a b', `https://x.exemplo/${'a'.repeat(500)}`, 'https://x/"><']) {
      expect(PautaNewsletterVideoSchema.safeParse({ urlDoVideo: ruim }).success, ruim).toBe(false);
    }
    expect(PautaNewsletterVideoSchema.safeParse({}).success).toBe(false);
  });

  it('sai do Pacote ao Agendado e só com transcrição; concluído é registro', () => {
    const casos: Array<[PautaEpisodioStatus, RegExp | null]> = [
      ['roteiro', /chega no Pacote/],
      ['edicao', /chega no Pacote/],
      ['pacote', null],
      ['derivacao', null],
      ['agendado', null],
      ['concluido', /concluído/],
    ];
    for (const [status, esperado] of casos) {
      const m = motivoParaNaoGerarNewsletter(status, 10);
      if (esperado) expect(m, status).toMatch(esperado);
      else expect(m, status).toBeNull();
    }
    expect(motivoParaNaoGerarNewsletter('pacote', 0)).toMatch(/não tem transcrição/);
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
  meta: unknown; status: string; criadaEm: Date;
};

function ep(over: Partial<Ep> = {}): Ep {
  return {
    id: 'e1', orgId: ORG, numero: 3, titulo: 'Semana 39', status: 'pacote', rodadaId: 'r1', roteiro: '# roteiro',
    midia: {}, transcricao: SEGMENTOS, transcricaoTexto: 'x', titulos: [], thumbs: [], descricao: '', bioPageId: null,
    criadoPor: PESSOA, criadoEm: new Date('2026-09-20T12:00:00.000Z'), atualizadoEm: new Date('2026-09-24T12:00:00.000Z'),
    rodada: { titulo: 'Semana 39', itens: ITENS, janelaIni: new Date('2026-09-17T00:00:00.000Z'), janelaFim: new Date('2026-09-24T00:00:00.000Z') },
    ...over,
  };
}

function servico(opts: {
  episodios?: Ep[];
  pecas?: Peca[];
  saidas?: string[];
  llm?: Partial<LlmProvider>;
  duranteIa?: (s: { lista: Ep[]; pecas: Peca[] }) => void;
} = {}) {
  const lista = opts.episodios ?? [ep()];
  const pecas: Peca[] = opts.pecas ?? [];
  const chamadas: Array<{ system: string; user: string; orgId?: string; maxTokens?: number }> = [];
  const auditoria: Array<Record<string, unknown>> = [];
  const travas: string[] = [];
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
      const saidas = opts.saidas ?? [respostaDaIa()];
      return saidas[Math.min(chamadas.length - 1, saidas.length - 1)];
    },
    ...opts.llm,
  } as unknown as LlmProvider;

  const casa = (p: Peca, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const atual = (p as Record<string, unknown>)[k];
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
    },
    pautaPeca: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        structuredClone(pecas.filter((p) => casa(p, where)).sort((a, b) => b.criadaEm.getTime() - a.criadaEm.getTime())),
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

  const memoria = { porChave: async () => null } as unknown as MemoriaService;
  const audit = new AuditService(prisma);
  return {
    newsletters: new NewsletterService(prisma, audit, llm, new VozService(prisma, audit, llm, memoria), new EpisodioService(prisma, audit)),
    prisma,
    lista,
    pecas,
    chamadas,
    auditoria,
    travas,
  };
}

function pecaDaTranscricao(over: Partial<Peca> = {}): Peca {
  return {
    id: 'antiga', orgId: ORG, rodadaId: 'r1', canal: 'newsletter', formato: 'email', titulo: 'Antiga',
    corpo: `# Antiga\n\n${CHAMADA_DA_PAGINA}\n\n${CHAMADA_DO_VIDEO}`, status: 'rascunho', criadaEm: new Date('2026-09-23T00:00:00.000Z'),
    meta: { episodioId: 'e1', origem: 'transcricao', tentativas: 1, secoes: 0, links: 0, avisos: [], urlDoVideo: 'https://video.exemplo/antigo', transcricaoSha: shaDaTranscricao(SEGMENTOS) },
    ...over,
  };
}

describe('newsletter: gerar (o critério de pronto, com a transcrição de exemplo)', () => {
  it('sai com as frases ditas, os links e a checagem aprovada — uma chamada, com a empresa pagando', async () => {
    const s = servico();
    const { newsletter: n } = await s.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false });

    expect(s.chamadas).toHaveLength(1);
    expect(s.chamadas[0].orgId).toBe(ORG);
    expect(s.chamadas[0].maxTokens).toBe(SAIDA_DA_GERACAO_LONGA);
    expect(s.chamadas[0].system).toContain(TOM_DA_CASA);
    expect(s.chamadas[0].user).toContain('[01:04] A segunda é o agente que preenche planilha');

    expect(n).not.toBeNull();
    expect(n!.checagem).toEqual({ aprovada: true, apontamentos: [] });
    expect(n!.tentativas).toBe(1);
    // As frases ditas: quase tudo que é frase saiu da fala.
    expect(n!.frases.total).toBeGreaterThanOrEqual(8);
    expect(n!.frases.ditas).toBe(n!.frases.total);
    for (const dita of ['a mesma automação de atendimento custa a metade por mês', 'grava, transcreve e manda a ata no fim da chamada']) {
      expect(n!.markdown.toLowerCase()).toContain(dita);
    }
    // Os links: um por matéria pública, nunca o da newsletter.
    expect(n!.links).toBe(3);
    for (const url of ['https://noticia.exemplo/preco', 'https://noticia.exemplo/sheets', 'https://noticia.exemplo/transcricao']) {
      expect(n!.markdown).toContain(`(${url})`);
    }
    expect(n!.markdown).not.toContain('mail.google');
    expect(n!.pendentes).toHaveLength(2);
    expect(n!.transcricaoMudou).toBe(false);

    // A peça: canal newsletter, formato email, da rodada do episódio, com a meta.
    expect(s.pecas).toHaveLength(1);
    expect(s.pecas[0]).toMatchObject({ orgId: ORG, rodadaId: 'r1', canal: 'newsletter', formato: 'email', status: 'rascunho' });
    expect(s.pecas[0].meta).toMatchObject({ episodioId: 'e1', origem: 'transcricao', tentativas: 1, secoes: 4, links: 3, urlDoVideo: null });
    expect(s.travas).toEqual(['pauta-newsletter:e1']);
  });

  it('reprovada na checagem, refaz UMA vez com os apontamentos no pedido e grava a aprovada', async () => {
    const s = servico({ saidas: [respostaComSlop(), respostaDaIa()] });
    const { newsletter: n } = await s.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(s.chamadas).toHaveLength(2);
    expect(s.chamadas[1].user).toContain('REPROVADA');
    expect(s.chamadas[1].user).toContain('- Emoji: "🚀"');
    expect(s.chamadas[1].user).toContain('- Palavra proibida da casa: "alavancar"');
    expect(s.chamadas[1].orgId).toBe(ORG);
    expect(s.chamadas[1].maxTokens).toBe(SAIDA_DA_GERACAO_LONGA);
    expect(n!.checagem.aprovada).toBe(true);
    expect(n!.tentativas).toBe(2);
    const rastro = s.auditoria.find((a) => a.action === 'pauta.newsletter_gerada') as { after: Record<string, unknown> };
    expect(rastro.after).toMatchObject({ tentativas: 2, aprovada: true });
    expect(rastro.after.reprovadaNaPrimeira).toMatchObject({ emoji: 1, palavra_proibida: 1, paragrafo_longo: 1 });
  });

  it('persistindo, grava com os apontamentos visíveis — nunca uma terceira chamada', async () => {
    const s = servico({ saidas: [respostaComSlop(), respostaComSlop(), respostaDaIa()] });
    const { newsletter: n } = await s.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(s.chamadas).toHaveLength(2);
    expect(n!.checagem.aprovada).toBe(false);
    expect(n!.checagem.apontamentos.map((a) => a.regra)).toEqual(
      expect.arrayContaining(['emoji', 'palavra_proibida', 'frase_de_ia', 'paragrafo_longo']),
    );
    expect(s.pecas).toHaveLength(1);
  });

  it('a reescrita pior que a primeira não entra; a reescrita inválida deixa a primeira, com aviso', async () => {
    const soEmoji = respostaDaIa({ titulo: 'Semana 39 🚀' });
    const pior = servico({ saidas: [soEmoji, respostaComSlop()] });
    const r1 = await pior.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(r1.newsletter!.checagem.apontamentos).toEqual([{ regra: 'emoji', trecho: '🚀', onde: 'título “Semana 39 🚀”' }]);

    const invalida = servico({ saidas: [soEmoji, 'não é json'] });
    const r2 = await invalida.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(r2.newsletter!.checagem.aprovada).toBe(false);
    expect(r2.newsletter!.avisos).toContain('A reescrita pedida pela checagem não voltou utilizável: ficou a primeira versão.');
  });

  it('antes do Pacote, concluído ou sem transcrição é 400 sem gastar IA; outra empresa é 404', async () => {
    for (const e of [ep({ status: 'edicao' }), ep({ status: 'concluido' }), ep({ transcricao: [] })]) {
      const s = servico({ episodios: [e] });
      await expect(s.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toThrow(BadRequestException);
      expect(s.chamadas).toHaveLength(0);
    }
    const s = servico();
    await expect(s.newsletters.gerar('outra', 'e1', PESSOA, { substituir: false })).rejects.toThrow(NotFoundException);
  });

  it('já tem newsletter: 409 sem gastar IA; com a confirmação, a anterior fica descartada e o link do vídeo segue', async () => {
    const s = servico({ pecas: [pecaDaTranscricao()] });
    await expect(s.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toThrow(ConflictException);
    expect(s.chamadas).toHaveLength(0);

    const { newsletter: n } = await s.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: true });
    expect(s.pecas.find((p) => p.id === 'antiga')?.status).toBe('descartada');
    expect(n!.pecaId).not.toBe('antiga');
    expect(n!.urlDoVideo).toBe('https://video.exemplo/antigo');
    expect(n!.markdown).toContain('em vídeo: https://video.exemplo/antigo');
    const rastro = s.auditoria.find((a) => a.action === 'pauta.newsletter_gerada') as { before: Record<string, unknown> };
    expect(rastro.before).toEqual({ substituidas: ['antiga'], doMiolo: [] });
  });

  it('newsletter do miolo, descartada ou de outro episódio não conta como a da transcrição', async () => {
    const s = servico({
      pecas: [
        pecaDaTranscricao({ id: 'do-miolo', meta: {} }),
        pecaDaTranscricao({ id: 'descartada', status: 'descartada' }),
        pecaDaTranscricao({ id: 'de-outro', meta: { origem: 'transcricao', episodioId: 'e9' } }),
      ],
    });
    expect((await s.newsletters.painel(ORG, 'e1')).newsletter).toBeNull();
    await s.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(s.pecas.find((p) => p.id === 'de-outro')?.status).toBe('rascunho');
  });

  it('derivar → gerar: a newsletter do miolo que ainda vale fica descartada, com aviso e no RASTRO; a publicada fica', async () => {
    const s = servico({
      pecas: [
        pecaDaTranscricao({ id: 'miolo-rascunho', meta: {} }),
        pecaDaTranscricao({ id: 'miolo-aprovada', status: 'aprovada', meta: {} }),
        pecaDaTranscricao({ id: 'miolo-publicada', status: 'publicada', meta: {} }),
        pecaDaTranscricao({ id: 'whatsapp', canal: 'whatsapp', meta: {} }),
      ],
    });
    const { newsletter: n } = await s.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false });
    const status = Object.fromEntries(s.pecas.map((p) => [p.id, p.status]));
    expect(status).toMatchObject({ 'miolo-rascunho': 'descartada', 'miolo-aprovada': 'descartada', 'miolo-publicada': 'publicada', whatsapp: 'rascunho' });
    expect(n!.avisos).toContain('A newsletter feita do miolo da rodada ficou descartada: esta toma o lugar dela.');
    const rastro = s.auditoria.find((a) => a.action === 'pauta.newsletter_gerada') as { before: Record<string, unknown> };
    expect(rastro.before).toEqual({ substituidas: [], doMiolo: ['miolo-rascunho', 'miolo-aprovada'] });
  });

  it('item com emoji e palavra proibida no título e "disruption" na URL: sai aprovada numa chamada só', async () => {
    const itens: PautaItemCurado[] = [
      { id: 'x1', titulo: 'Nova IA 🚀 da OpenAI disrupts search', url: 'https://techcrunch.com/2026/09/ai-disruption-report', origem: 'C' },
    ];
    const s = servico({
      episodios: [ep({ rodada: { ...ep().rodada, itens } })],
      saidas: [
        JSON.stringify({ titulo: 'Semana 39', secoes: [{ n: 1, titulo: 'A busca nova', texto: 'O preço dos modelos caiu pela metade nesta semana.' }] }),
      ],
    });
    const { newsletter: n } = await s.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(s.chamadas).toHaveLength(1);
    expect(n!.checagem).toEqual({ aprovada: true, apontamentos: [] });
    expect(n!.markdown).toContain('Fonte: [Nova IA da OpenAI disrupts search](https://techcrunch.com/2026/09/ai-disruption-report)');
  });

  it('o link do vídeo salvo por outra aba enquanto a IA escrevia segue na nova (lido sob o cadeado)', async () => {
    const s = servico({
      pecas: [pecaDaTranscricao()],
      duranteIa: ({ pecas }) => void ((pecas[0].meta as Record<string, unknown>).urlDoVideo = 'https://video.exemplo/novo'),
    });
    const { newsletter: n } = await s.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: true });
    expect(n!.urlDoVideo).toBe('https://video.exemplo/novo');
  });

  it('IA sem credencial é 503 antes de chamar; resposta que não é JSON é 503 e nada é gravado', async () => {
    const sem = servico({ llm: { configured: false } });
    await expect(sem.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toThrow(ServiceUnavailableException);
    expect(sem.chamadas).toHaveLength(0);
    const lixo = servico({ saidas: ['nada de json'] });
    await expect(lixo.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toThrow(ServiceUnavailableException);
    expect(lixo.pecas).toHaveLength(0);
    expect(lixo.auditoria).toHaveLength(0);
  });

  it('a transcrição refeita ou outra newsletter enquanto a IA pensava: 409, e nada é gravado', async () => {
    const refeita = servico({ duranteIa: ({ lista }) => void (lista[0].transcricao = SEGMENTOS.slice(2)) });
    await expect(refeita.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toThrow(ConflictException);
    expect(refeita.pecas).toHaveLength(0);

    const outra = servico({ duranteIa: ({ pecas }) => void pecas.push(pecaDaTranscricao({ id: 'no-meio' })) });
    await expect(outra.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toThrow(ConflictException);
    expect(outra.pecas.map((p) => p.id)).toEqual(['no-meio']);

    const concluido = servico({ duranteIa: ({ lista }) => void (lista[0].status = 'concluido') });
    await expect(concluido.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toThrow(ConflictException);
  });

  it('o RASTRO leva as contas, não o texto', async () => {
    const s = servico();
    await s.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false });
    const rastro = s.auditoria.find((a) => a.action === 'pauta.newsletter_gerada') as Record<string, unknown>;
    expect(rastro).toMatchObject({ entityType: 'pauta_episodio', entityId: 'e1' });
    expect(JSON.stringify(rastro)).not.toContain('automação de atendimento');
    expect((rastro.after as Record<string, unknown>).frases).toEqual(expect.objectContaining({ ditas: expect.any(Number) }));
  });
});

describe('newsletter: o painel, o link do vídeo e o export', () => {
  const PAGINA = {
    id: 'pg1',
    handle: 'root-ep-03',
    titulo: 'Semana 39',
    publicada: true,
    links: [],
  };

  it('o painel confere o texto de AGORA: a peça editada com emoji aparece apontada; a transcrição refeita avisa', async () => {
    const s = servico();
    await s.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false });
    s.pecas[0].corpo = `${s.pecas[0].corpo}\n\nEditado à mão 🚀`;
    let n = (await s.newsletters.painel(ORG, 'e1')).newsletter!;
    expect(n.checagem.aprovada).toBe(false);
    expect(n.checagem.apontamentos[0].regra).toBe('emoji');
    expect(n.transcricaoMudou).toBe(false);
    s.lista[0].transcricao = SEGMENTOS.slice(1);
    n = (await s.newsletters.painel(ORG, 'e1')).newsletter!;
    expect(n.transcricaoMudou).toBe(true);
  });

  it('o link do vídeo entra no lugar do marcador; nulo tira; sem newsletter é 400', async () => {
    const s = servico();
    await expect(s.newsletters.definirVideo(ORG, 'e1', PESSOA, 'https://video.exemplo/v')).rejects.toThrow(BadRequestException);
    await s.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false });
    let n = (await s.newsletters.definirVideo(ORG, 'e1', PESSOA, 'https://video.exemplo/v')).newsletter!;
    expect(n.markdown).toContain('em vídeo: https://video.exemplo/v');
    expect(n.pendentes).toHaveLength(1);
    expect(s.pecas[0].meta).toMatchObject({ urlDoVideo: 'https://video.exemplo/v', origem: 'transcricao' });
    n = (await s.newsletters.definirVideo(ORG, 'e1', PESSOA, null)).newsletter!;
    expect(n.markdown).toContain(PAUTA_MARCADOR_DO_VIDEO);
    expect(s.auditoria.filter((a) => a.action === 'pauta.newsletter_video')).toHaveLength(2);
  });

  it('exporta em md e em html com a página no ar trocada; rascunho deixa o marcador; sem newsletter é 404', async () => {
    const s = servico({ episodios: [ep({ bioPageId: 'pg1', bioPage: PAGINA })] });
    await expect(s.newsletters.exportar(ORG, 'e1', 'md')).rejects.toThrow(NotFoundException);
    await s.newsletters.gerar(ORG, 'e1', PESSOA, { substituir: false, urlDoVideo: 'https://video.exemplo/v' });

    const md = await s.newsletters.exportar(ORG, 'e1', 'md');
    expect(md.nome).toBe('ep-03-newsletter.md');
    expect(md.conteudo).toMatch(/^# Semana 39/);
    expect(md.conteudo).toContain('numa página só: https://bio.operacaoroot.com/@root-ep-03');
    expect(md.conteudo).toContain('em vídeo: https://video.exemplo/v');

    const html = await s.newsletters.exportar(ORG, 'e1', 'html');
    expect(html.nome).toBe('ep-03-newsletter.html');
    expect(html.conteudo).toContain('<a href="https://noticia.exemplo/preco">Preço do modelo caiu pela metade</a>');
    expect(html.conteudo).toContain('<a href="https://bio.operacaoroot.com/@root-ep-03">');
    expect(html.conteudo).not.toContain('{{');

    s.lista[0].bioPage = { ...PAGINA, publicada: false };
    expect((await s.newsletters.exportar(ORG, 'e1', 'md')).conteudo).toContain(PAUTA_MARCADOR_DA_PAGINA_DE_LINKS);
  });
});

describe('newsletter: a derivação antiga convive com a da transcrição', () => {
  function rodadaCom(pecas: Array<{ canal: string; status: string; meta: unknown }>) {
    const criadas: Array<Record<string, unknown>> = [];
    const prisma = {
      pautaRodada: {
        findFirst: async () => ({ id: 'r1', orgId: ORG, status: 'curada', titulo: 'Semana 39', corpo: 'miolo', itens: ITENS, fichasUsadas: [], pecas }),
      },
      pautaReferencia: { findMany: async () => [] },
      pautaPeca: { create: async ({ data }: { data: Record<string, unknown> }) => void criadas.push(data) },
      auditLog: { create: async ({ data }: { data: unknown }) => data },
    } as unknown as PrismaService;
    const llm = {
      name: 'dublê',
      model: 'd',
      configured: true,
      complete: async () =>
        JSON.stringify({ whatsapp: { titulo: 'w', corpo: 'w' }, newsletter: { titulo: 'n', corpo: 'n' }, clickup: { titulo: 'c', corpo: 'c' } }),
    } as unknown as LlmProvider;
    const memoria = { porChave: async () => null } as unknown as MemoriaService;
    const audit = new AuditService(prisma);
    return { rodadas: new RodadaService(prisma, audit, {} as never, llm, new VozService(prisma, audit, llm, memoria)), criadas };
  }

  it('a newsletter da transcrição não trava "derivar" e toma o lugar da newsletter do miolo', async () => {
    const r = rodadaCom([{ canal: 'newsletter', status: 'rascunho', meta: { origem: 'transcricao', episodioId: 'e1' } }]);
    await r.rodadas.derivar(ORG, 'r1', PESSOA);
    expect(r.criadas.map((c) => c.canal)).toEqual(['whatsapp', 'clickup']);
  });

  it('descartada, ela não toma o lugar; outra peça qualquer segue travando', async () => {
    const r = rodadaCom([{ canal: 'newsletter', status: 'descartada', meta: { origem: 'transcricao', episodioId: 'e1' } }]);
    await r.rodadas.derivar(ORG, 'r1', PESSOA);
    expect(r.criadas.map((c) => c.canal)).toEqual(['whatsapp', 'newsletter', 'clickup']);
    const outra = rodadaCom([{ canal: 'whatsapp', status: 'rascunho', meta: {} }]);
    await expect(outra.rodadas.derivar(ORG, 'r1', PESSOA)).rejects.toThrow(/já tem peças/);
  });
});

describe('newsletter: o controller', () => {
  const usuario = { sub: PESSOA, orgId: ORG } as never;

  function controller() {
    const chamadas: Array<{ metodo: string; args: unknown[] }> = [];
    const anota = (metodo: string) => async (...args: unknown[]) => {
      chamadas.push({ metodo, args });
      return metodo === 'exportar' ? { nome: `ep-03-newsletter.${args[2]}`, conteudo: 'conteudo' } : { newsletter: null };
    };
    const duble = {
      painel: anota('painel'),
      gerar: anota('gerar'),
      definirVideo: anota('definirVideo'),
      exportar: anota('exportar'),
    } as unknown as NewsletterService;
    return { c: new NewsletterController(duble), chamadas };
  }

  function resposta() {
    const cabecalhos: Record<string, unknown> = {};
    return { cabecalhos, res: { setHeader: (k: string, v: unknown) => (cabecalhos[k] = v) } as never };
  }

  it('gerar com corpo vazio chega sem substituir; link do vídeo que não é https é recusado antes do serviço', async () => {
    const { c, chamadas } = controller();
    await c.gerar(usuario, 'e1', undefined);
    expect(chamadas[0]).toEqual({ metodo: 'gerar', args: [ORG, 'e1', PESSOA, { substituir: false, urlDoVideo: undefined }] });
    expect(() => c.gerar(usuario, 'e1', { urlDoVideo: 'http://x.exemplo' })).toThrow();
    expect(() => c.video(usuario, 'e1', { urlDoVideo: 'javascript:alert(1)' })).toThrow();
    await c.video(usuario, 'e1', { urlDoVideo: null });
    expect(chamadas[1]).toEqual({ metodo: 'definirVideo', args: [ORG, 'e1', PESSOA, null] });
    expect(chamadas).toHaveLength(2);
  });

  it('o markdown e o HTML saem como anexo, sem cache; o HTML com a política fechada', async () => {
    const { c } = controller();
    const md = resposta();
    expect(await c.markdown(usuario, 'e1', md.res)).toBe('conteudo');
    expect(md.cabecalhos).toEqual({
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ep-03-newsletter.md"',
      'Cache-Control': 'no-store',
    });
    const html = resposta();
    await c.html(usuario, 'e1', html.res);
    expect(html.cabecalhos).toMatchObject({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ep-03-newsletter.html"',
      'X-Content-Type-Options': 'nosniff',
    });
    expect(String(html.cabecalhos['Content-Security-Policy'])).toMatch(/default-src 'none'.*sandbox/);
  });

  it('as rotas são sub-rotas de /pauta/episodios: ver com pauta.ver, escrever com pauta.editar, gastar IA com automacoes.executar; nenhuma envia', () => {
    expect(Reflect.getMetadata('path', NewsletterController)).toBe('pauta/episodios');
    const proto = NewsletterController.prototype as unknown as Record<string, object>;
    const rotas: Array<[string, string, string[]]> = [
      ['painel', ':id/newsletter', ['pauta.ver']],
      ['gerar', ':id/newsletter/gerar', ['pauta.editar', 'automacoes.executar']],
      ['video', ':id/newsletter/video', ['pauta.editar']],
      ['markdown', ':id/newsletter.md', ['pauta.ver']],
      ['html', ':id/newsletter.html', ['pauta.ver']],
    ];
    for (const [metodo, caminho, perms] of rotas) {
      expect(Reflect.getMetadata('path', proto[metodo]), metodo).toBe(caminho);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[metodo]), metodo).toEqual(perms);
    }
    const metodos = Object.getOwnPropertyNames(NewsletterController.prototype).filter((m) => m !== 'constructor');
    expect(metodos.sort()).toEqual(rotas.map(([m]) => m).sort());
  });
});

// ---------------------------------------------------------------------------
// 4. Com banco
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (uma empresa, uma rodada, um episódio e peças)');

const MARCA = `nl${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

describe.skipIf(!URL)('newsletter com banco: gerar, substituir e exportar pela sessão da empresa', () => {
  let admin: PrismaClient;
  let cru: PrismaClient;
  let newsletters: NewsletterService;
  let episodios: EpisodioService;
  let orgId = '';
  let saida = respostaDaIa();

  const na = <T>(fn: () => Promise<T>) =>
    comContexto({ orgId, actorType: 'user', actorId: null, correlationId: `teste-${MARCA}`, origem: 'http' }, fn);

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: URL } } });
    cru = new PrismaClient({ datasourceUrl: URL });
    const app = comTenantNaSessao(cru, { modo: 'impor' }) as unknown as PrismaService;
    const llm = { name: 'dublê', model: 'd', configured: true, supportsTools: false, complete: async () => saida } as unknown as LlmProvider;
    const memoria = new MemoriaService(app, {} as never, {} as never);
    episodios = new EpisodioService(app, new AuditService(app));
    newsletters = new NewsletterService(app, new AuditService(app), llm, new VozService(app, new AuditService(app), llm, memoria), episodios);
    const o = await admin.org.create({ data: { name: `Newsletter ${MARCA}`, slug: `nl-${MARCA}`, modulos: ['pauta'] } });
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

  it('da transcrição à peça de newsletter com as frases ditas e os links, substituída e exportada', async () => {
    const rodada = await admin.pautaRodada.create({
      data: { orgId, status: 'curada', titulo: `Semana ${MARCA}`, janelaIni: new Date(), janelaFim: new Date(), itens: ITENS as never },
    });
    const e = await na(() => episodios.criar(orgId, 'pessoa', { rodadaId: rodada.id }));
    await admin.pautaEpisodio.update({
      where: { id: e.id },
      data: { status: 'pacote', transcricao: SEGMENTOS as never, transcricaoTexto: FALAS.map(([, t]) => t).join(' ') },
    });

    const r = await na(() => newsletters.gerar(orgId, e.id, 'pessoa', { substituir: false }));
    expect(r.newsletter?.checagem.aprovada).toBe(true);
    expect(r.newsletter?.frases.ditas).toBeGreaterThan(0);
    const gravada = await admin.pautaPeca.findUnique({ where: { id: r.newsletter!.pecaId } });
    expect(gravada).toMatchObject({ orgId, rodadaId: rodada.id, canal: 'newsletter', formato: 'email', status: 'rascunho' });
    expect(gravada?.meta).toMatchObject({ episodioId: e.id, origem: 'transcricao' });
    expect(gravada?.corpo).toContain('(https://noticia.exemplo/sheets)');
    expect(gravada?.corpo).not.toContain('mail.google');

    await expect(na(() => newsletters.gerar(orgId, e.id, 'pessoa', { substituir: false }))).rejects.toThrow(ConflictException);
    saida = respostaDaIa({ titulo: 'Semana 39, de novo' });
    const r2 = await na(() => newsletters.gerar(orgId, e.id, 'pessoa', { substituir: true, urlDoVideo: 'https://video.exemplo/v' }));
    const todas = await admin.pautaPeca.findMany({ where: { orgId }, orderBy: { criadaEm: 'asc' } });
    expect(todas.map((p) => p.status)).toEqual(['descartada', 'rascunho']);
    expect(r2.newsletter?.titulo).toBe('Semana 39, de novo');

    const html = await na(() => newsletters.exportar(orgId, e.id, 'html'));
    expect(html.conteudo).toContain('<a href="https://video.exemplo/v">');
    const painel = await na(() => newsletters.painel(orgId, e.id));
    expect(painel.newsletter?.pecaId).toBe(r2.newsletter?.pecaId);

    const acoes = await admin.auditLog.findMany({ where: { orgId, entityId: e.id }, select: { action: true } });
    expect(acoes.filter((a) => a.action === 'pauta.newsletter_gerada')).toHaveLength(2);
  }, 60_000);
});
