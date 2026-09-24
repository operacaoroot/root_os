import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PautaMidiaSchema, PautaTranscricaoSchema } from '@mktos/shared';
import {
  PADROES,
  PALAVRA_PADRAO,
  codecDeVideo,
  conferirPlanoContraBruto,
  cortesAplicados,
  cortesDaPalavra,
  cortesDosSilencios,
  cortesRemovidos,
  duracaoTotal,
  filtroDoCorte,
  intervalosAManter,
  lerManter,
  lerSilencedetect,
  listaDoConcat,
  normalizarTexto,
  planoDeCortes,
  podeCortarSemReencodar,
  unirIntervalos,
} from '../../../tools/root-midia/lib/cortes.mjs';
import {
  ehAnotacao,
  segmentosDaTranscricao,
  segmentosDoWhisper,
  srtDosSegmentos,
  tempoDoWhisper,
} from '../../../tools/root-midia/lib/whisper.mjs';
import { mesmoArquivo } from '../../../tools/root-midia/lib/arquivos.mjs';
import {
  TETO_DO_CORPO,
  acharEpisodio,
  clienteDoOs,
  configuracao,
  corpoDaMidia,
  corpoDaTranscricao,
  corpoGrandeDemais,
  exigirOs,
  juntarVariaveis,
  lerArquivoDeVariaveis,
  mensagemDoErro,
} from '../../../tools/root-midia/lib/os.mjs';
import {
  ALTURA,
  APOIO_PADRAO,
  LARGURA,
  TETO_DO_PNG,
  argsDoChrome,
  argsDoFrame,
  candidatosDoChrome,
  conferirPng,
  dimensoesDoPng,
  escaparHtml,
  nomeDaThumb,
  preencherThumb,
  textoComDestaque,
} from '../../../tools/root-midia/lib/thumbs.mjs';
import {
  ALTURA_VERTICAL,
  CANVAS_PADRAO,
  LARGURA_VERTICAL,
  REGIAO_DA_TELA_PADRAO,
  REGIAO_DO_PIP_PADRAO,
  aceitaRender,
  argsDoChromeNoTamanho,
  argsDoCorteVertical,
  argsDoFrameDoStory,
  candidatosDoRender,
  conferirPngNoTamanho,
  filtroDoCorteVertical,
  layoutDoCorte,
  lerRegiao,
  marcaDoCarrossel,
  nomeDoCorte,
  nomeDoStory,
  pastaDoCarrossel,
  preencherStory,
  regiaoDoPip,
  regiaoNoVideo,
  regioesPadraoNoCanvas,
  resolucaoDoPreset,
  slidesEstourados,
  slidesParaAMaquina,
} from '../../../tools/root-midia/lib/semana.mjs';

/*
 * A ESTAÇÃO DE MÍDIA NO MAC — MC9, o lado do Mac (`tools/root-midia`).
 *
 * Só as funções puras: ler o silencedetect, o que sai de cada silêncio, a
 * heurística da palavra de corte, a lista do que MANTER e o que saiu, o filtro
 * do ffmpeg, quando dá para cortar sem reencodar, o JSON do whisper em
 * segmentos, e a conversa com o OS com um `fetch` de mentira. O ffmpeg de
 * verdade roda em `node tools/root-midia/root-midia.mjs ensaio` (clipe
 * sintético numa pasta temporária) — fora da suíte, porque a CI não tem ffmpeg
 * e caso pulado reprova a trava.
 */

const SAIDA_DO_FFMPEG = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'bruto.mp4':
[silencedetect @ 0x6000013c4000] silence_start: -0.00133
[silencedetect @ 0x6000013c4000] silence_end: 0.412 | silence_duration: 0.413
[silencedetect @ 0x6000013c4000] silence_start: 3.00544
[silencedetect @ 0x6000013c4000] silence_end: 6.002 | silence_duration: 2.99656
size=N/A time=00:00:15.00 bitrate=N/A speed= 120x
[silencedetect @ 0x6000013c4000] silence_start: 12.5
`;

describe('root-midia: o silencedetect', () => {
  it('lê início e fim, prende o negativo em zero e fecha o silêncio aberto no fim do arquivo', () => {
    expect(lerSilencedetect(SAIDA_DO_FFMPEG, 15)).toEqual([
      { inicio: 0, fim: 0.412 },
      { inicio: 3.005, fim: 6.002 },
      { inicio: 12.5, fim: 15 },
    ]);
  });

  it('sem a duração, o silêncio aberto fica de fora; saída vazia não é erro', () => {
    expect(lerSilencedetect(SAIDA_DO_FFMPEG)).toHaveLength(2);
    expect(lerSilencedetect('')).toEqual([]);
  });

  it('fim sem início é ignorado (linha perdida no meio do log)', () => {
    expect(lerSilencedetect('[silencedetect @ 0x1] silence_end: 2 | silence_duration: 1', 5)).toEqual([]);
  });
});

describe('root-midia: o que sai de cada silêncio', () => {
  it('silêncio curto fica — é a pausa da fala; o longo sai com a margem dos dois lados', () => {
    const cortes = cortesDosSilencios(
      [
        { inicio: 2, fim: 2.5 },
        { inicio: 5, fim: 7 },
      ],
      { duracao: 20 },
    );
    expect(cortes).toEqual([{ inicio: 5 + PADROES.margemSeg, fim: 7 - PADROES.margemSeg }]);
  });

  it('no começo e no fim do arquivo o silêncio sai inteiro: não há fala a proteger', () => {
    expect(
      cortesDosSilencios(
        [
          { inicio: 0, fim: 1.5 },
          { inicio: 18, fim: 20 },
        ],
        { duracao: 20 },
      ),
    ).toEqual([
      { inicio: 0, fim: 1.3 },
      { inicio: 18.2, fim: 20 },
    ]);
  });

  it('mínimo e margem ajustáveis; silêncio que a margem consome inteiro não vira corte', () => {
    expect(cortesDosSilencios([{ inicio: 5, fim: 5.9 }], { duracao: 20, minimoSeg: 0.5, margemSeg: 0.45 })).toEqual([]);
    expect(cortesDosSilencios([{ inicio: 5, fim: 5.9 }], { duracao: 20, minimoSeg: 0.5, margemSeg: 0.1 })).toEqual([
      { inicio: 5.1, fim: 5.8 },
    ]);
  });
});

describe('root-midia: a palavra de corte', () => {
  const SEGMENTOS = [
    { inicio: 0, fim: 4, texto: 'Bom dia, esta é a semana 39.' },
    { inicio: 4, fim: 8, texto: 'A primeira notícia é sobre o Pix automático que' },
    { inicio: 8, fim: 9.5, texto: 'Root, corta!' },
    { inicio: 9.5, fim: 14, texto: 'A primeira notícia é sobre o Pix Automático.' },
    { inicio: 14, fim: 18, texto: 'E a segunda é sobre crédito.' },
  ];

  it('compara sem acento, caixa nem pontuação', () => {
    expect(normalizarTexto('  Root,   CORTA! ')).toBe('root corta');
    expect(normalizarTexto('Ação — já')).toBe('acao ja');
    expect(PALAVRA_PADRAO).toBe('root, corta');
  });

  it('corta o segmento com a palavra E o anterior, que é a tomada errada', () => {
    const cortes = cortesDaPalavra(SEGMENTOS, 'root, corta');
    expect(cortes).toEqual([
      { inicio: 4, fim: 9.5, trecho: 'A primeira notícia é sobre o Pix automático que | Root, corta!' },
    ]);
  });

  it('a respiração até a retomada sai junto, menos a margem — não sobra o fim da palavra entre dois cortes', () => {
    const comPausa = [
      { inicio: 0.1, fim: 1.9, texto: 'A primeira notícia é sobre o Pix que' },
      { inicio: 5.1, fim: 6.9, texto: 'Root, corta.' },
      { inicio: 10.1, fim: 11.9, texto: 'A primeira notícia é sobre o Pix automático.' },
    ];
    expect(cortesDaPalavra(comPausa, 'root, corta')[0]).toMatchObject({ inicio: 0.1, fim: 9.9 });
    expect(cortesDaPalavra(comPausa, 'root, corta', { margemSeg: 0.5 })[0]).toMatchObject({ fim: 9.6 });
    const plano = planoDeCortes({
      duracao: 13,
      silencios: [{ inicio: 2, fim: 5 }, { inicio: 7, fim: 10 }],
      segmentos: comPausa,
      palavra: 'root, corta',
    });
    // Os 0,1 s antes da tomada errada ficam abaixo do mínimo mantido e saem juntos.
    expect(plano.manter).toEqual([{ inicio: 9.9, fim: 13 }]);
  });

  it('a palavra no primeiro segmento leva só ele; palavra dentro de outra palavra não casa', () => {
    expect(cortesDaPalavra([{ inicio: 0, fim: 2, texto: 'Root corta' }], 'root, corta')).toEqual([
      { inicio: 0, fim: 2, trecho: 'Root corta' },
    ]);
    expect(cortesDaPalavra([{ inicio: 0, fim: 2, texto: 'o grooot cortado' }], 'root, corta')).toEqual([]);
  });

  it('palavra vazia não corta nada', () => {
    expect(cortesDaPalavra(SEGMENTOS, ' , ')).toEqual([]);
  });

  it('no plano, a tomada errada sai com o motivo e o trecho, junto com os silêncios', () => {
    const plano = planoDeCortes({
      duracao: 18,
      silencios: [{ inicio: 14.5, fim: 16 }],
      segmentos: SEGMENTOS,
      palavra: 'root, corta',
    });
    expect(plano.palavraDeCorte).toBe('root, corta');
    expect(plano.manter).toEqual([
      { inicio: 0, fim: 4 },
      { inicio: 9.5, fim: 14.7 },
      { inicio: 15.8, fim: 18 },
    ]);
    expect(plano.removidos).toEqual([
      { inicio: 4, fim: 9.5, motivo: 'palavra-de-corte' },
      { inicio: 14.7, fim: 15.8, motivo: 'silencio' },
    ]);
    expect(plano.tomadasErradas).toHaveLength(1);
    expect(plano.duracaoFinalSeg).toBe(11.4);
  });

  it('sem transcrição, só os silêncios saem e a palavra fica nula', () => {
    const plano = planoDeCortes({ duracao: 10, silencios: [{ inicio: 4, fim: 6 }], palavra: 'root, corta' });
    expect(plano.palavraDeCorte).toBeNull();
    expect(plano.removidos.every((c) => c.motivo === 'silencio')).toBe(true);
  });
});

describe('root-midia: o que manter', () => {
  it('une o que se sobrepõe ou encosta, em ordem', () => {
    expect(
      unirIntervalos([
        { inicio: 5, fim: 6 },
        { inicio: 1, fim: 3 },
        { inicio: 2, fim: 4 },
        { inicio: 6, fim: 7 },
        { inicio: 9, fim: 9 },
      ]),
    ).toEqual([
      { inicio: 1, fim: 4 },
      { inicio: 5, fim: 7 },
    ]);
  });

  it('manter é o complemento do que sai, dentro do arquivo', () => {
    expect(
      intervalosAManter({
        duracao: 10,
        remover: [
          { inicio: 2, fim: 3 },
          { inicio: 8, fim: 12 },
        ],
      }),
    ).toEqual([
      { inicio: 0, fim: 2 },
      { inicio: 3, fim: 8 },
    ]);
  });

  it('o estalo entre dois cortes vai junto; sem nada a tirar, mantém o arquivo inteiro', () => {
    expect(
      intervalosAManter({
        duracao: 10,
        remover: [
          { inicio: 2, fim: 3 },
          { inicio: 3.1, fim: 5 },
        ],
      }),
    ).toEqual([
      { inicio: 0, fim: 2 },
      { inicio: 5, fim: 10 },
    ]);
    expect(intervalosAManter({ duracao: 10, remover: [] })).toEqual([{ inicio: 0, fim: 10 }]);
  });

  it('o que saiu é o complemento exato do que ficou — o bruto inteiro é coberto', () => {
    const manter = [
      { inicio: 1, fim: 4 },
      { inicio: 6, fim: 9 },
    ];
    const removidos = cortesRemovidos({ duracao: 10, manter });
    expect(removidos).toEqual([
      { inicio: 0, fim: 1, motivo: 'silencio' },
      { inicio: 4, fim: 6, motivo: 'silencio' },
      { inicio: 9, fim: 10, motivo: 'silencio' },
    ]);
    expect(duracaoTotal(manter) + duracaoTotal(removidos)).toBe(10);
  });

  it('os cortes do plano passam no esquema que a API usa para a mídia', () => {
    const plano = planoDeCortes({
      duracao: 30,
      silencios: [
        { inicio: 0, fim: 1 },
        { inicio: 10, fim: 12 },
        { inicio: 20, fim: 30 },
      ],
    });
    const corpo = corpoDaMidia({
      arquivoBruto: '/Users/x/Movies/OBS/bruto.mp4',
      arquivoFinal: '/Users/x/Movies/OBS/ep-01-final.mp4',
      duracaoSeg: plano.duracaoFinalSeg,
      duracaoBrutoSeg: plano.duracaoBrutoSeg,
      plano,
    });
    expect(PautaMidiaSchema.safeParse(corpo).success).toBe(true);
    expect(corpo.duracaoSeg).toBe(duracaoTotal(plano.manter));
  });

  it('o cortes.json é conferido antes de cortar: fora de ordem, invertido ou vazio é recusado', () => {
    expect(lerManter({ manter: [{ inicio: 0, fim: 2 }] })).toEqual([{ inicio: 0, fim: 2 }]);
    expect(lerManter([{ inicio: 1, fim: 2 }])).toEqual([{ inicio: 1, fim: 2 }]);
    expect(() => lerManter({ manter: [] })).toThrow(/manter/);
    expect(() => lerManter({ manter: [{ inicio: 3, fim: 2 }] })).toThrow(/não é um intervalo/);
    expect(() => lerManter({ manter: [{ inicio: 3, fim: 4 }, { inicio: 1, fim: 2 }] })).toThrow(/antes do fim/);
  });
});

describe('root-midia: o corte no ffmpeg', () => {
  const MANTER = [
    { inicio: 0, fim: 3.2 },
    { inicio: 5.8, fim: 9.2 },
  ];

  it('o filtro corta vídeo e áudio de cada trecho e junta tudo com concat', () => {
    const { filtro, mapas } = filtroDoCorte(MANTER, { video: true, audio: true });
    expect(filtro).toContain('[0:v]trim=start=5.8:end=9.2,setpts=PTS-STARTPTS[v1]');
    expect(filtro).toContain('[0:a]atrim=start=0:end=3.2,asetpts=PTS-STARTPTS[a0]');
    expect(filtro.split(';\n').pop()).toBe('[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]');
    expect(mapas).toEqual(['-map', '[v]', '-map', '[a]']);
  });

  it('só áudio também corta; nada a manter é erro, não um arquivo vazio', () => {
    expect(filtroDoCorte(MANTER, { video: false, audio: true }).filtro).toMatch(/concat=n=2:v=0:a=1\[a\]$/);
    expect(() => filtroDoCorte([], { video: true, audio: true })).toThrow(/Nada a manter/);
  });

  it('sem reencodar só quando toda borda cai num quadro-chave', () => {
    const duracao = 12;
    expect(podeCortarSemReencodar([{ inicio: 0, fim: 12 }], [], { duracao })).toBe(true);
    expect(podeCortarSemReencodar(MANTER, [0, 2, 4, 6, 8, 10], { duracao })).toBe(false);
    expect(podeCortarSemReencodar(MANTER, [0, 3.2, 5.8, 9.2], { duracao })).toBe(true);
    expect(podeCortarSemReencodar(MANTER, [0, 3.21, 5.79, 9.2], { duracao })).toBe(true);
    expect(podeCortarSemReencodar(MANTER, [], { duracao })).toBe(false);
  });

  it('a lista do concat escapa aspas no caminho', () => {
    const lista = listaDoConcat("/Users/x/Movies/OBS/pedro's.mp4", MANTER);
    expect(lista.split('\n').slice(0, 4)).toEqual([
      'ffconcat version 1.0',
      "file '/Users/x/Movies/OBS/pedro'\\''s.mp4'",
      'inpoint 0',
      'outpoint 3.2',
    ]);
  });

  it('reencoda com libx264 quando há; senão o de hardware do Mac; sem os dois, diz', () => {
    expect(codecDeVideo(' V....D libx264   libx264 H.264')).toEqual(['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18']);
    expect(codecDeVideo(' V....D h264_videotoolbox VideoToolbox')[1]).toBe('h264_videotoolbox');
    expect(() => codecDeVideo('')).toThrow(/libx264/);
  });
});

describe('root-midia: o JSON do whisper', () => {
  it('lê o tempo em texto, com vírgula ou ponto', () => {
    expect(tempoDoWhisper('00:01:02,500')).toBe(62.5);
    expect(tempoDoWhisper('01:00:00.25')).toBe(3600.25);
    expect(tempoDoWhisper('lixo')).toBeNaN();
  });

  it('usa os offsets em ms, apara o texto e tira anotação que não é fala', () => {
    const segmentos = segmentosDoWhisper({
      transcription: [
        { offsets: { from: 0, to: 2500 }, text: '  Bom dia,   pessoal. ' },
        { offsets: { from: 2500, to: 4000 }, text: ' [BLANK_AUDIO]' },
        { offsets: { from: 4000, to: 6000 }, text: '(música)' },
        { timestamps: { from: '00:00:06,000', to: '00:00:08,120' }, text: 'Semana 39.' },
        { offsets: { from: 9000, to: 9500 }, text: '   ' },
      ],
    });
    expect(segmentos).toEqual([
      { inicio: 0, fim: 2.5, texto: 'Bom dia, pessoal.' },
      { inicio: 6, fim: 8.12, texto: 'Semana 39.' },
    ]);
    expect(ehAnotacao('[Risos] E aí')).toBe(false);
    expect(ehAnotacao('♪ ♪')).toBe(true);
  });

  it('sai em ordem e sem sobreposição — e passa no esquema da transcrição da API', () => {
    const segmentos = segmentosDoWhisper({
      transcription: [
        { offsets: { from: 3000, to: 5000 }, text: 'segundo' },
        { offsets: { from: 0, to: 3100 }, text: 'primeiro' },
      ],
    });
    expect(segmentos).toEqual([
      { inicio: 0, fim: 3.1, texto: 'primeiro' },
      { inicio: 3.1, fim: 5, texto: 'segundo' },
    ]);
    expect(PautaTranscricaoSchema.safeParse(corpoDaTranscricao({ segmentos, idioma: 'pt', modelo: 'ggml-small.bin' })).success).toBe(true);
  });

  it('JSON que não é do whisper é recusado com o porquê', () => {
    expect(() => segmentosDoWhisper({ segments: [] })).toThrow(/transcription/);
  });
});

describe('root-midia: a conversa com o OS', () => {
  it('as variáveis: URL padrão local sem barra no fim, palavra padrão, senha ausente só barra quem fala com o OS', () => {
    const c = configuracao({ ROOT_OS_API_URL: 'https://os.exemplo/api/', ROOT_OS_EMAIL: ' eu@root ' });
    expect(c).toMatchObject({ url: 'https://os.exemplo/api', email: 'eu@root', palavra: 'root, corta', modelo: '' });
    expect(configuracao({}).url).toBe('http://localhost:4001/api');
    expect(configuracao({ ROOT_MIDIA_PALAVRA: 'ops' }).palavra).toBe('ops');
    expect(() => exigirOs(c)).toThrow(/ROOT_OS_SENHA/);
    expect(() => exigirOs(configuracao({ ROOT_OS_EMAIL: 'a', ROOT_OS_SENHA: 'b' }))).not.toThrow();
  });

  it('entra pelo login normal, manda o token, e refaz o login uma vez no 401', async () => {
    const pedidos: Array<{ url: string; metodo: string; auth?: string; corpo?: unknown }> = [];
    let logins = 0;
    const fetchFalso = (async (url: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      pedidos.push({ url, metodo: String(init.method), auth: headers.Authorization, corpo: init.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/auth/login')) {
        logins++;
        return new Response(JSON.stringify({ token: `t${logins}` }), { status: 200 });
      }
      if (headers.Authorization === 'Bearer t1') return new Response('{}', { status: 401 });
      return new Response(JSON.stringify({ status: 'pacote' }), { status: 200 });
    }) as unknown as typeof fetch;
    const os = clienteDoOs({ url: 'http://os/api', email: 'eu@root', senha: 's3', fetch: fetchFalso });
    expect(await os.transcricao('e 1', { segmentos: [] })).toEqual({ status: 'pacote' });
    expect(pedidos[0]).toEqual({ url: 'http://os/api/auth/login', metodo: 'POST', auth: undefined, corpo: { email: 'eu@root', password: 's3' } });
    expect(pedidos.map((p) => p.url)).toEqual([
      'http://os/api/auth/login',
      'http://os/api/pauta/episodios/e%201/transcricao',
      'http://os/api/auth/login',
      'http://os/api/pauta/episodios/e%201/transcricao',
    ]);
    expect(pedidos[3].auth).toBe('Bearer t2');
  });

  it('erro da API chega com a mensagem dela — do Nest ou do zod', async () => {
    const fetchFalso = (async (url: string) =>
      url.endsWith('/auth/login')
        ? new Response(JSON.stringify({ token: 't' }), { status: 200 })
        : new Response(JSON.stringify({ statusCode: 400, message: 'Mande a mídia antes' }), { status: 400 })) as unknown as typeof fetch;
    const os = clienteDoOs({ url: 'http://os/api', email: 'a', senha: 'b', fetch: fetchFalso });
    await expect(os.pendentes()).rejects.toThrow('GET /pauta/episodios/pendentes-midia → HTTP 400: Mande a mídia antes');
    expect(mensagemDoErro(JSON.stringify({ error: 'ValidationError', issues: [{ path: 'segmentos.0.fim', message: 'Tempo negativo.' }] }))).toBe(
      'segmentos.0.fim: Tempo negativo.',
    );
    expect(mensagemDoErro('<html>502</html>')).toBe('<html>502</html>');
  });

  it('login recusado diz quais variáveis conferir', async () => {
    const fetchFalso = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(clienteDoOs({ url: 'http://os/api', email: 'a', senha: 'b', fetch: fetchFalso }).pendentes()).rejects.toThrow(
      /ROOT_OS_EMAIL e ROOT_OS_SENHA/,
    );
  });

  it('acha o episódio por ep-NN, número ou id; fora da fila diz o que há nela', () => {
    const fila = [
      { id: 'a1', numero: 7, apelido: 'ep-07' },
      { id: 'b2', numero: 12, apelido: 'ep-12' },
    ];
    expect(acharEpisodio(fila, 'ep-07').id).toBe('a1');
    expect(acharEpisodio(fila, 'EP-7').id).toBe('a1');
    expect(acharEpisodio(fila, '12').id).toBe('b2');
    expect(acharEpisodio(fila, 'b2').id).toBe('b2');
    expect(() => acharEpisodio(fila, 'ep-03')).toThrow(/Na fila: ep-07, ep-12/);
  });

  it('transcrição maior que o corpo da API é barrada aqui, com o porquê', () => {
    const grande = { segmentos: [{ inicio: 0, fim: 1, texto: 'x'.repeat(TETO_DO_CORPO) }] };
    expect(corpoGrandeDemais(grande)).toMatch(/aceita até/);
    expect(corpoGrandeDemais({ segmentos: [{ inicio: 0, fim: 1, texto: 'oi' }] })).toBeNull();
    expect(() => corpoDaTranscricao({ segmentos: [] })).toThrow(/segmentos/);
  });
});

describe('root-midia: os cortes que o final de fato tem', () => {
  const PLANO = planoDeCortes({
    duracao: 30,
    silencios: [
      { inicio: 0, fim: 1 },
      { inicio: 10, fim: 12 },
      { inicio: 20, fim: 30 },
    ],
  });

  it('sem ajuste, os cortes enviados são os `removidos` do plano', () => {
    expect(cortesAplicados(PLANO)).toEqual(PLANO.removidos);
  });

  it('o `manter` ajustado à mão manda o corte novo como manual — e o que voltou ao vídeo deixa de ser corte', () => {
    // Sobrou pedaço de tomada errada em 3–4 s: sai do manter. O silêncio de 10–12 s volta inteiro.
    const ajustado = {
      ...PLANO,
      manter: [
        { inicio: 0, fim: 3 },
        { inicio: 4, fim: 20.2 },
      ],
    };
    const cortes = cortesAplicados(ajustado);
    expect(cortes).toEqual([
      { inicio: 3, fim: 4, motivo: 'manual' },
      { inicio: 20.2, fim: 30, motivo: 'silencio' },
    ]);
    expect(duracaoTotal(cortes) + duracaoTotal(ajustado.manter)).toBe(30);
    const corpo = corpoDaMidia({ arquivoBruto: '/b.mp4', arquivoFinal: '/f.mp4', duracaoSeg: 19.2, plano: ajustado });
    expect(corpo.cortes).toEqual(cortes);
    expect(PautaMidiaSchema.safeParse({ ...corpo, duracaoBrutoSeg: 30 }).success).toBe(true);
  });

  it('o corte automático alargado à mão vira dois: o pedaço previsto guarda o motivo, o resto é manual', () => {
    const plano = { duracaoBrutoSeg: 10, manter: [{ inicio: 0, fim: 4 }, { inicio: 7, fim: 10 }], removidos: [{ inicio: 5, fim: 7, motivo: 'silencio' }] };
    expect(cortesAplicados(plano)).toEqual([
      { inicio: 4, fim: 5, motivo: 'manual' },
      { inicio: 5, fim: 7, motivo: 'silencio' },
    ]);
  });

  it('sem a duração do bruto no plano usa a medida; sem nenhuma das duas é erro', () => {
    expect(cortesAplicados({ manter: [{ inicio: 1, fim: 9 }] }, 10)).toEqual([
      { inicio: 0, fim: 1, motivo: 'silencio' },
      { inicio: 9, fim: 10, motivo: 'silencio' },
    ]);
    expect(() => cortesAplicados({ manter: [{ inicio: 1, fim: 9 }] })).toThrow(/duracaoBrutoSeg/);
  });

  it('o cortes.json de outro bruto é recusado; só o caminho diferente é aviso', () => {
    const manter = [{ inicio: 0, fim: 9 }];
    expect(conferirPlanoContraBruto({ arquivo: '/a.mp4', duracaoBrutoSeg: 10 }, manter, { arquivo: '/a.mp4', duracao: 10.05 })).toEqual({
      erro: null,
      avisos: [],
    });
    expect(conferirPlanoContraBruto({ duracaoBrutoSeg: 12 }, manter, { arquivo: '/a.mp4', duracao: 10 }).erro).toMatch(/rode `cortes` de novo/);
    expect(conferirPlanoContraBruto(null, [{ inicio: 0, fim: 11 }], { arquivo: '/a.mp4', duracao: 10 }).erro).toMatch(/vai até 11/);
    expect(conferirPlanoContraBruto({ arquivo: '/velho/a.mp4', duracaoBrutoSeg: 10 }, manter, { arquivo: '/a.mp4', duracao: 10 }).avisos).toHaveLength(1);
  });
});

describe('root-midia: a transcrição em qualquer forma', () => {
  const WHISPER = { transcription: [{ offsets: { from: 0, to: 1500 }, text: ' Olá.' }] };

  it('aceita o que `transcrever` grava, a lista crua e o JSON bruto do whisper-cli', () => {
    const um = [{ inicio: 0, fim: 1.5, texto: 'Olá.' }];
    expect(segmentosDaTranscricao({ segmentos: um })).toEqual(um);
    expect(segmentosDaTranscricao(um)).toEqual(um);
    expect(segmentosDaTranscricao(WHISPER)).toEqual(um);
    expect(corpoDaTranscricao(WHISPER).segmentos).toEqual(um);
  });

  it('nenhum segmento reconhecido é erro — a palavra de corte não some em silêncio', () => {
    expect(() => segmentosDaTranscricao({ texto: 'x' })).toThrow(/não traz segmentos/);
    expect(() => segmentosDaTranscricao([])).toThrow(/não traz segmentos/);
    expect(() => segmentosDaTranscricao(null)).toThrow(/não traz segmentos/);
  });

  it('a lista crua acha a tomada errada no plano', () => {
    const segmentos = segmentosDaTranscricao([
      { inicio: 0, fim: 2, texto: 'frase errada' },
      { inicio: 2, fim: 3, texto: 'root, corta' },
      { inicio: 4, fim: 6, texto: 'frase certa' },
    ]);
    const plano = planoDeCortes({ duracao: 6, silencios: [], segmentos, palavra: PALAVRA_PADRAO });
    expect(plano.tomadasErradas).toHaveLength(1);
  });

  it('a legenda .srt sai dos segmentos, com vírgula nos milésimos e a hora cheia', () => {
    expect(
      srtDosSegmentos([
        { inicio: 0, fim: 1.5, texto: 'Olá.' },
        { inicio: 3661.25, fim: 3662, texto: ' Tchau. ' },
      ]),
    ).toBe('1\n00:00:00,000 --> 00:00:01,500\nOlá.\n\n2\n01:01:01,250 --> 01:01:02,000\nTchau.\n');
  });
});

describe('root-midia: as variáveis e a senha', () => {
  it('http fora desta máquina é recusado — a senha iria em claro; https e loopback passam', () => {
    const com = (url: string) => configuracao({ ROOT_OS_API_URL: url, ROOT_OS_EMAIL: 'a', ROOT_OS_SENHA: 'b' });
    expect(() => exigirOs(com('http://31.97.21.167/api'))).toThrow(/https/);
    expect(() => exigirOs(com('http://os.exemplo/api'))).toThrow(/em claro/);
    expect(() => exigirOs(com('https://os.exemplo/api'))).not.toThrow();
    expect(() => exigirOs(com('http://localhost:4001/api'))).not.toThrow();
    expect(() => exigirOs(com('http://127.0.0.1:4001/api'))).not.toThrow();
    expect(() => exigirOs(com('http://[::1]:4001/api'))).not.toThrow();
  });

  it('o arquivo de variáveis: comentário, export e aspas; o ambiente vence o arquivo', () => {
    const doArquivo = lerArquivoDeVariaveis(
      '# a estação de mídia\nexport ROOT_OS_EMAIL=eu@root\nROOT_OS_SENHA="s3 #x"\nWHISPER_MODEL=/m.bin # o small\nlixo\n',
    );
    expect(doArquivo).toEqual({ ROOT_OS_EMAIL: 'eu@root', ROOT_OS_SENHA: 's3 #x', WHISPER_MODEL: '/m.bin' });
    const env = juntarVariaveis({ ROOT_OS_EMAIL: 'outro@root', PATH: '/bin' }, doArquivo);
    expect(env).toMatchObject({ ROOT_OS_EMAIL: 'outro@root', ROOT_OS_SENHA: 's3 #x', PATH: '/bin' });
  });

  it('a trava do bruto reconhece o mesmo arquivo por outro nome (link simbólico)', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'root-midia-teste-'));
    try {
      const bruto = join(pasta, 'Bruto.mp4');
      writeFileSync(bruto, 'x');
      const atalho = join(pasta, 'atalho.mp4');
      symlinkSync(bruto, atalho);
      writeFileSync(join(pasta, 'outro.mp4'), 'y');
      expect(mesmoArquivo(atalho, bruto)).toBe(true);
      expect(mesmoArquivo(bruto, bruto)).toBe(true);
      expect(mesmoArquivo(join(pasta, 'outro.mp4'), bruto)).toBe(false);
      expect(mesmoArquivo(join(pasta, 'nao-existe.mp4'), bruto)).toBe(false);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// MC11: as thumbs renderizadas no Mac (lib/thumbs.mjs e thumb.html)
// ---------------------------------------------------------------------------

function pngDe(largura: number, altura: number, total = 64): Uint8Array {
  const b = Buffer.alloc(total);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(largura, 16);
  b.writeUInt32BE(altura, 20);
  return b;
}

/** O template mora na raiz do monorepo; o vitest roda com o cwd em `apps/api` ou na raiz. */
function acharTemplate(): string {
  for (const base of [process.cwd(), join(process.cwd(), '..', '..')]) {
    const caminho = join(base, 'tools', 'root-midia', 'thumb.html');
    if (existsSync(caminho)) return caminho;
  }
  throw new Error(`Não achei tools/root-midia/thumb.html a partir de ${process.cwd()}.`);
}

const TEMPLATE = readFileSync(acharTemplate(), 'utf8');

describe('root-midia: as thumbs (MC11)', () => {
  it('o template é 1280×720 com os tokens da marca copiados — não lê o brand pack em tempo de execução', () => {
    expect(TEMPLATE).toContain('width: 1280px; height: 720px');
    for (const token of ['#9BDB1F', '#FF1F6B', '#C4FF2E', '#DFFFE8', '#070A08', "'JetBrains Mono'", "'Space Grotesk'"]) {
      expect(TEMPLATE, token).toContain(token);
    }
    expect(TEMPLATE).not.toMatch(/maquina-carrossel|brand\.json"|\.\.\//);
    for (const m of ['{{TEXTO}}', '{{APOIO}}', '{{APELIDO}}', '{{FRAME}}']) expect(TEMPLATE.split(m)).toHaveLength(2);
    expect([LARGURA, ALTURA, TETO_DO_PNG]).toEqual([1280, 720, 2 * 1024 * 1024]);
  });

  it('preenche escapando tudo: o texto da IA não vira HTML, e a palavra de destaque ganha a cor', () => {
    const html = preencherThumb(TEMPLATE, { texto: 'Preço <b>da</b> IA caiu', destaque: 'CAIU', apelido: 'ep-07', frame: 'frame.jpg' });
    expect(html).toContain('Preço &lt;b&gt;da&lt;/b&gt; IA <span class="destaque">caiu</span>');
    expect(html).toContain('<span class="ep">ep-07</span>');
    expect(html).toContain('src="frame.jpg"');
    expect(html).toContain(APOIO_PADRAO);
    expect(html).not.toMatch(/\{\{[A-Z]+\}\}/);
    expect(escaparHtml(`"x" & 'y'`)).toBe('&quot;x&quot; &amp; &#39;y&#39;');
  });

  it('destaque sem acento e sem pontuação acha a palavra; só a primeira ocorrência; ausente não destaca', () => {
    expect(textoComDestaque('Ata grátis, grátis', 'gratis')).toBe('Ata <span class="destaque">grátis,</span> grátis');
    expect(textoComDestaque('Planilha sozinha', 'nada')).toBe('Planilha sozinha');
    expect(textoComDestaque('Planilha sozinha', '')).toBe('Planilha sozinha');
  });

  it('frame com barra ou "..", ou template sem marcador, é recusado', () => {
    const v = { texto: 'x', destaque: 'x', apelido: 'ep-01' };
    expect(() => preencherThumb(TEMPLATE, { ...v, frame: '../segredo.jpg' })).toThrow(/frame inválido/);
    expect(() => preencherThumb(TEMPLATE, { ...v, frame: 'a/b.jpg' })).toThrow(/frame inválido/);
    expect(() => preencherThumb('<p>{{TEXTO}}</p>', { ...v, frame: 'f.jpg' })).toThrow(/perdeu o marcador \{\{APOIO\}\}/);
  });

  it('o frame sai do vídeo final no tempo do brief, cobrindo 1280×720', () => {
    const a = argsDoFrame('/v/ep-07-final.mp4', 82, '/tmp/f.jpg');
    expect(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 4)).toEqual(['-ss', '82.000', '-i', '/v/ep-07-final.mp4']);
    expect(a).toContain('scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720');
    expect(a.at(-1)).toBe('/tmp/f.jpg');
    expect(argsDoFrame('/v.mp4', Number.NaN, '/f.jpg')).toContain('0.000');
  });

  it('o Chrome roda sem janela, com perfil próprio, na janela exata da thumb', () => {
    const a = argsDoChrome({ html: '/tmp/x/thumb.html', png: '/tmp/x/thumb.png', perfil: '/tmp/x/perfil' });
    expect(a).toEqual(
      expect.arrayContaining(['--headless=new', '--user-data-dir=/tmp/x/perfil', '--window-size=1280,720', '--screenshot=/tmp/x/thumb.png']),
    );
    expect(a.at(-1)).toBe('file:///tmp/x/thumb.html');
  });

  it('procura o Chrome apontado, depois o instalado, depois o do agent-browser (o mais novo primeiro)', () => {
    const c = candidatosDoChrome({ ROOT_MIDIA_CHROME: ' /opt/chrome ' }, ['/h/.agent-browser/browsers/chrome-140', '/h/.agent-browser/browsers/chrome-152']);
    expect(c[0]).toBe('/opt/chrome');
    expect(c[1]).toContain('/Applications/Google Chrome.app');
    expect(c.at(-2)).toContain('chrome-152/Google Chrome for Testing.app');
    expect(candidatosDoChrome({})[0]).toContain('/Applications/Google Chrome.app');
  });

  it('o PNG renderizado é conferido antes de subir: assinatura, 1280×720 e 2 MB', () => {
    expect(dimensoesDoPng(pngDe(1280, 720))).toEqual({ largura: 1280, altura: 720 });
    expect(dimensoesDoPng(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(conferirPng(pngDe(1280, 720))).toBeNull();
    expect(conferirPng(pngDe(2560, 1440))).toMatch(/2560×1440/);
    expect(conferirPng(pngDe(1280, 720, TETO_DO_PNG + 1))).toMatch(/2 MB/);
    expect(conferirPng(Buffer.from('não é png, é texto qualquer'))).toMatch(/não saiu PNG/);
    expect(nomeDaThumb('ep-07', 2)).toBe('ep-07-thumb-2.png');
  });

  it('o cliente acha o episódio na lista inteira, lê os briefs e sobe o PNG em multipart (sem JSON no cabeçalho)', async () => {
    const pedidos: Array<{ url: string; metodo: string; tipo: string | null; corpo: unknown }> = [];
    const fetchFalso = (async (url: string, init: RequestInit) => {
      const cabecalhos = (init.headers ?? {}) as Record<string, string>;
      pedidos.push({ url, metodo: init.method ?? 'GET', tipo: cabecalhos['Content-Type'] ?? null, corpo: init.body });
      if (url.endsWith('/auth/login')) return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      if (url.endsWith('/pauta/episodios')) return new Response(JSON.stringify({ items: [{ id: 'e7', numero: 7, apelido: 'ep-07' }] }));
      return new Response(JSON.stringify({ ok: true }));
    }) as unknown as typeof fetch;
    const os = clienteDoOs({ url: 'http://os/api', email: 'a', senha: 'b', fetch: fetchFalso });

    const lista = await os.episodios();
    expect(acharEpisodio(lista.items, 'ep-7', { lista: true }).id).toBe('e7');
    expect(() => acharEpisodio(lista.items, 'ep-9', { lista: true })).toThrow(/entre os episódios da empresa \(ep-07\)/);

    await os.thumbs('e7');
    await os.enviarThumb('e7', 2, pngDe(1280, 720), 'ep-07-thumb-2.png');
    const envio = pedidos.at(-1)!;
    expect(envio).toMatchObject({ url: 'http://os/api/pauta/episodios/e7/thumbs/2', metodo: 'POST', tipo: null });
    const arquivo = (envio.corpo as FormData).get('file') as File;
    expect(arquivo.type).toBe('image/png');
    expect(arquivo.name).toBe('ep-07-thumb-2.png');
    expect(arquivo.size).toBe(64);
    expect(pedidos.map((p) => p.url)).toContain('http://os/api/pauta/episodios/e7/thumbs');
  });
});

/*
 * A SEMANA DE POSTS NO MAC — MC15 (`tools/root-midia/lib/semana.mjs`): onde
 * está o rosto na cena do OBS, o filtro do corte vertical, o story e o
 * `slides.json` da máquina de carrossel. O ffmpeg, o Chrome e o render de
 * verdade rodam em `root-midia ensaio-semana`, fora da suíte.
 */

/** A coleção "Gravação" do OBS como ela está no Mac (24/09/2026), só com o que importa. */
function colecaoDoObs(item: Record<string, unknown> = {}, preset = 'AVCaptureSessionPreset1280x720') {
  return {
    name: 'Gravação',
    sources: [
      { id: 'av_capture_input', name: 'Câmera (PiP)', settings: { device_name: 'HD Pro Webcam C920', preset } },
      {
        id: 'scene',
        name: '2 · Tela + Câmera',
        settings: {
          items: [
            { name: 'TelaH', pos: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, bounds: { x: 0, y: 0 }, bounds_type: 0, align: 5 },
            {
              name: 'Câmera (PiP)', pos: { x: 1533, y: 737 }, scale: { x: 1, y: 1 }, bounds: { x: 336, y: 299 }, bounds_type: 2,
              crop_left: 296, crop_top: 0, crop_right: 201, crop_bottom: 0, align: 5, bounds_align: 0, ...item,
            },
          ],
        },
      },
    ],
  };
}

describe('root-midia: onde está o rosto na cena do OBS (MC15)', () => {
  it('a câmera da cena "2 · Tela + Câmera": recorte, caixa escalada para dentro e centralizada, par e para dentro', () => {
    expect(regiaoDoPip(colecaoDoObs())).toEqual({ x: 1540, y: 738, largura: 322, altura: 298 });
    expect(regiaoDoPip(colecaoDoObs())).toEqual(REGIAO_DO_PIP_PADRAO);
    expect(resolucaoDoPreset('AVCaptureSessionPreset1920x1080')).toEqual({ largura: 1920, altura: 1080 });
    // A mesma câmera em 1080p muda a proporção do recorte: a caixa passa a limitar pela largura.
    const hd = regiaoDoPip(colecaoDoObs({ crop_left: 0, crop_right: 0 }, 'AVCaptureSessionPreset1920x1080'));
    expect(hd).toEqual({ x: 1534, y: 792, largura: 334, altura: 188 });
  });

  it('sem caixa, com escala e âncora no canto de baixo à direita; esticada; e o que não sabe ler é erro', () => {
    const livre = regiaoDoPip(colecaoDoObs({ bounds_type: 0, scale: { x: 0.25, y: 0.25 }, crop_left: 0, crop_right: 0, pos: { x: 1920, y: 1080 }, align: 10 }));
    expect(livre).toEqual({ x: 1600, y: 900, largura: 320, altura: 180 });
    expect(regiaoDoPip(colecaoDoObs({ bounds_type: 1 }))).toEqual({ x: 1534, y: 738, largura: 334, altura: 298 });
    expect(() => regiaoDoPip(colecaoDoObs({ bounds_type: 3 }))).toThrow(/--pip/);
    expect(() => regiaoDoPip(colecaoDoObs(), { cena: 'Outra' })).toThrow(/não tem a cena "Outra"/);
    expect(() => regiaoDoPip(colecaoDoObs(), { fonte: 'Webcam' })).toThrow(/não tem a fonte "Webcam"/);
    expect(() => regiaoDoPip(colecaoDoObs({}, 'sem-preset'))).toThrow(/resolução da fonte/);
    expect(regiaoDoPip(colecaoDoObs({}, 'sem-preset'), { resolucaoDaFonte: { largura: 1280, altura: 720 } })).toEqual(REGIAO_DO_PIP_PADRAO);
  });

  it('a região por argumento, e a do canvas levada para o vídeo que saiu em outra resolução', () => {
    expect(lerRegiao('1540,738,322,298')).toEqual(REGIAO_DO_PIP_PADRAO);
    expect(lerRegiao(' 0:0:1920:1080 ')).toEqual(REGIAO_DA_TELA_PADRAO);
    expect(() => lerRegiao('1540,738,322')).toThrow(/x,y,largura,altura/);
    expect(() => lerRegiao('-1,0,10,10')).toThrow();
    expect(() => lerRegiao('0,0,8,8')).toThrow(/pequena/);
    expect(regiaoNoVideo(REGIAO_DO_PIP_PADRAO, CANVAS_PADRAO, { largura: 1920, altura: 1080 })).toEqual(REGIAO_DO_PIP_PADRAO);
    expect(regiaoNoVideo(REGIAO_DO_PIP_PADRAO, CANVAS_PADRAO, { largura: 1280, altura: 720 })).toEqual({ x: 1028, y: 492, largura: 212, altura: 198 });
    expect(() => regiaoNoVideo({ x: 1900, y: 1060, largura: 322, altura: 298 }, CANVAS_PADRAO, CANVAS_PADRAO)).toThrow(/passa do canvas 1920×1080/);
  });

  it('sem --tela nem --pip, o padrão acompanha o --canvas: a tela é o canvas inteiro e o PiP escala junto', () => {
    expect(regioesPadraoNoCanvas(CANVAS_PADRAO)).toEqual({ tela: REGIAO_DA_TELA_PADRAO, pip: REGIAO_DO_PIP_PADRAO });
    const menor = { largura: 1280, altura: 720 };
    const r = regioesPadraoNoCanvas(menor);
    expect(r.tela).toEqual({ x: 0, y: 0, largura: 1280, altura: 720 });
    expect(r.pip).toEqual({ x: 1028, y: 492, largura: 212, altura: 198 });
    // O que antes lançava "passa do canvas" agora cabe.
    expect(regiaoNoVideo(r.tela, menor, menor)).toEqual(r.tela);
    expect(regiaoNoVideo(r.pip, menor, menor)).toEqual(r.pip);
    expect(regioesPadraoNoCanvas({ largura: 2560, altura: 1440 }).tela).toEqual({ x: 0, y: 0, largura: 2560, altura: 1440 });
  });
});

describe('root-midia: o corte vertical e o story (MC15)', () => {
  it('o filtro: a tela encaixada em cima sem deformar, o rosto cobrindo a faixa de baixo, 1080×1920', () => {
    expect(layoutDoCorte(REGIAO_DO_PIP_PADRAO)).toEqual({ alturaDoRosto: 1000, alturaDaTela: 920 });
    expect(layoutDoCorte({ x: 0, y: 0, largura: 400, altura: 100 }).alturaDoRosto).toBe(640);
    const f = filtroDoCorteVertical({ tela: REGIAO_DA_TELA_PADRAO, rosto: REGIAO_DO_PIP_PADRAO });
    expect(f).toBe(
      '[0:v]split=2[t0][r0];' +
        '[t0]crop=1920:1080:0:0,scale=1080:920:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1080:920:(ow-iw)/2:(oh-ih)/2:color=0x070A08,setsar=1[tela];' +
        '[r0]crop=322:298:1540:738,scale=1080:1000:force_original_aspect_ratio=increase,crop=1080:1000,setsar=1[rosto];' +
        '[tela][rosto]vstack=inputs=2,format=yuv420p[v]',
    );
    expect(920 + 1000).toBe(ALTURA_VERTICAL);
  });

  it('os argumentos do ffmpeg em lista: busca antes do -i, a duração do trecho, o áudio quando há, nada de shell', () => {
    const args = argsDoCorteVertical({ video: '/v/final; rm -rf ~.mp4', saida: '/s/c.mp4', inicio: 20.4, fim: 80.4, filtro: 'F', audio: true, codec: ['-c:v', 'libx264'] });
    expect(args.slice(0, 11)).toEqual(['-hide_banner', '-loglevel', 'error', '-n', '-ss', '20.400', '-t', '60.000', '-i', '/v/final; rm -rf ~.mp4', '-filter_complex']);
    expect(args).toContain('/s/c.mp4');
    expect(args.join(' ')).toContain('-map [v] -map 0:a:0 -c:a aac');
    expect(argsDoCorteVertical({ video: 'v', saida: 's', inicio: 0, fim: 30, filtro: 'F', audio: false, codec: [], sobrescrever: true })).toEqual(
      expect.arrayContaining(['-y', '-an']),
    );
    expect(() => argsDoCorteVertical({ video: 'v', saida: 's', inicio: 0, fim: 180, filtro: 'F', audio: false, codec: [] })).toThrow(/menos de 3 minutos/);
    expect(() => argsDoCorteVertical({ video: 'v', saida: 's', inicio: 30, fim: 20, filtro: 'F', audio: false, codec: [] })).toThrow(/inválido/);
  });

  it('o story: frame na largura do story, template escapado, Chrome em 1080×1920 e o PNG conferido', () => {
    expect(argsDoFrameDoStory('v.mp4', 21.4, 'f.jpg')).toEqual(['-hide_banner', '-loglevel', 'error', '-y', '-ss', '21.400', '-i', 'v.mp4', '-frames:v', '1', '-vf', 'scale=1080:-2', '-q:v', '3', 'f.jpg']);
    const html = preencherStory('<p>{{TEXTO}}</p><i>{{CHAMADA}}</i>{{APELIDO}}<img src="{{FRAME}}">', {
      texto: '<script>x</script>',
      chamada: 'Link "na" bio',
      apelido: 'ep-04',
      frame: 'frame.jpg',
    });
    expect(html).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p><i>Link &quot;na&quot; bio</i>ep-04<img src="frame.jpg">');
    expect(() => preencherStory('{{TEXTO}}', { texto: '', chamada: '', apelido: '', frame: 'f.jpg' })).toThrow(/CHAMADA/);
    expect(() => preencherStory('{{TEXTO}}{{CHAMADA}}{{APELIDO}}{{FRAME}}', { texto: '', chamada: '', apelido: '', frame: '../f.jpg' })).toThrow(/frame/);
    expect(argsDoChromeNoTamanho({ html: '/t/s.html', png: '/t/s.png', perfil: '/t/p', largura: LARGURA_VERTICAL, altura: ALTURA_VERTICAL })).toContain('--window-size=1080,1920');
    expect(conferirPngNoTamanho(pngFalso(1080, 1920), 1080, 1920)).toBeNull();
    expect(conferirPngNoTamanho(pngFalso(1280, 720), 1080, 1920)).toMatch(/1280×720/);
  });

  it('os nomes, e só rascunho e aprovada recebem render', () => {
    expect([nomeDoCorte('ep-04', 2), nomeDoStory('ep-04', 2), pastaDoCarrossel('ep-04', 2)]).toEqual(['ep-04-m2-corte.mp4', 'ep-04-m2-story.png', 'ep-04-m2-carrossel']);
    expect(['rascunho', 'aprovada', 'publicada', 'descartada'].map((status) => aceitaRender({ status }))).toEqual([true, true, false, false]);
  });
});

/** Um PNG de mentira com o cabeçalho IHDR. */
function pngFalso(largura: number, altura: number): Uint8Array {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(largura, 16);
  b.writeUInt32BE(altura, 20);
  return b;
}

describe('root-midia: o carrossel pela máquina de carrossel (MC15)', () => {
  const peca = {
    titulo: 'Carrossel da matéria 1',
    slides: [
      { titulo: 'O preço <caiu>', texto: '' },
      { titulo: 'O fato', texto: 'A API ficou pela metade & mais.' },
      { titulo: '', texto: 'Só texto' },
      { titulo: 'Palavra-chave: PRECO', texto: 'Comentário com PRECO → …' },
    ],
    cta: { instrucao: 'Comentário com a palavra', palavra: 'PRECO', beneficio: 'O link chega no direct.' },
    palavraChave: 'PRECO',
  };

  it('o slides.json: capa, conteúdo alternando, fechamento com o CTA da palavra; tudo escapado (o render põe HTML cru)', () => {
    const j = slidesParaAMaquina(peca, { handle: '@root', marcaRef: '/m/root/brand.json', apelido: 'ep-04' });
    expect(j.meta).toEqual({ handle: '@root', marca: 'root', tipo_badge: 'EP-04', framework: 'raio-x', tema: 'Carrossel da matéria 1' });
    expect(j.brand_pack_ref).toBe('/m/root/brand.json');
    expect(j.slides.map((s) => [s.ordem, s.tipo, s.bg])).toEqual([
      [1, 'capa', 'dark'],
      [2, 'conteudo', 'light'],
      [3, 'conteudo', 'dark'],
      [4, 'fechamento', 'gradient'],
    ]);
    expect(j.slides[0]).toMatchObject({ headline: 'O preço &lt;caiu&gt;' });
    expect(j.slides[1]).toMatchObject({ headline: 'O fato', blocos: ['A API ficou pela metade &amp; mais.'] });
    expect(j.slides[2]).not.toHaveProperty('headline');
    expect(j.slides[3]).toMatchObject({ tag: 'PALAVRA-CHAVE', cta: { palavra: 'PRECO', instrucao: 'Comentário com a palavra' } });
    // CTA só no fechamento, como o render da máquina valida.
    expect(j.slides.filter((s) => 'cta' in s)).toHaveLength(1);
  });

  it('o tema (o título da peça, que o render põe cru no preview.html) e o selo entram escapados', () => {
    const j = slidesParaAMaquina({ ...peca, titulo: '<img src=x onerror=alert(1)> & cia' }, { handle: '@root', marcaRef: 'b.json', apelido: 'ep-<04>' });
    expect(j.meta.tema).toBe('&lt;img src=x onerror=alert(1)&gt; &amp; cia');
    expect(j.meta.tipo_badge).toBe('EP-&lt;04&gt;');
  });

  it('o report.json do render: os slides que estouraram, pelo número; ok falso sem lista ainda acusa', () => {
    expect(slidesEstourados({ ok: true, overflow: [] })).toEqual([]);
    expect(
      slidesEstourados({ ok: false, overflow: [{ id: 'slide-3', overflow: true, excesso_px: 42 }, { id: 'slide-1', overflow: true, excesso_px: 7 }] }),
    ).toEqual([{ n: 1, excessoPx: 7 }, { n: 3, excessoPx: 42 }]);
    expect(slidesEstourados({ ok: false, overflow: ['slide-2'] })).toEqual([{ n: 2, excessoPx: 0 }]);
    expect(slidesEstourados({ ok: false })).toEqual([{ n: 0, excessoPx: 0 }]);
    expect(slidesEstourados(null)).toEqual([]);
  });

  it('menos de 4 slides, mais de 10 ou sem a palavra é recusado antes do render', () => {
    const o = { handle: '@root', marcaRef: 'b.json', apelido: 'ep-04' };
    expect(() => slidesParaAMaquina({ ...peca, slides: peca.slides.slice(0, 3) }, o)).toThrow(/pelo menos 4/);
    expect(() => slidesParaAMaquina({ ...peca, slides: Array.from({ length: 11 }, () => peca.slides[1]) }, o)).toThrow(/até 10/);
    expect(() => slidesParaAMaquina({ ...peca, cta: null, palavraChave: null }, o)).toThrow(/palavra-chave/);
  });

  it('onde achar o render e a marca: o apontado primeiro, depois o do plugin, a versão mais nova do cache antes', () => {
    expect(candidatosDoRender({ ROOT_MIDIA_CARROSSEL_RENDER: ' /x/render.mjs ' }, '/Users/p', ['0.1.0', '0.10.0', '0.2.0'])).toEqual([
      '/x/render.mjs',
      '/Users/p/.claude/plugins/marketplaces/maquina-carrossel-marketplace/plugins/maquina-carrossel/render/render.mjs',
      '/Users/p/.claude/plugins/cache/maquina-carrossel-marketplace/maquina-carrossel/0.10.0/render/render.mjs',
      '/Users/p/.claude/plugins/cache/maquina-carrossel-marketplace/maquina-carrossel/0.2.0/render/render.mjs',
      '/Users/p/.claude/plugins/cache/maquina-carrossel-marketplace/maquina-carrossel/0.1.0/render/render.mjs',
    ]);
    expect(marcaDoCarrossel({}, '/Users/p')).toBe('/Users/p/.maquina-carrossel/marcas/root/brand.json');
    expect(marcaDoCarrossel({ ROOT_MIDIA_MARCA: '/m.json' }, '/Users/p')).toBe('/m.json');
  });
});

describe('root-midia: a semana na conversa com o OS (MC15)', () => {
  it('lê a semana, sobe o PNG da peça em multipart e registra o mp4 do corte com PUT', async () => {
    const pedidos: Array<{ url: string; metodo: string; corpo: unknown }> = [];
    const fetchFalso = (async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/login')) return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      pedidos.push({ url, metodo: String(init.method), corpo: init.body instanceof FormData ? 'multipart' : init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const os = clienteDoOs({ url: 'http://os/api', email: 'a', senha: 'b', fetch: fetchFalso });
    await os.semana('e1');
    await os.enviarImagemDaPeca('p 1', 3, pngFalso(1080, 1350), 'slide-03.png');
    await os.videoDoCorte('p2', { arquivo: '/m/c.mp4', duracaoSeg: 60 });
    expect(pedidos).toEqual([
      { url: 'http://os/api/pauta/episodios/e1/semana', metodo: 'GET', corpo: undefined },
      { url: 'http://os/api/pauta/pecas/p%201/imagens/3', metodo: 'POST', corpo: 'multipart' },
      { url: 'http://os/api/pauta/pecas/p2/video', metodo: 'PUT', corpo: { arquivo: '/m/c.mp4', duracaoSeg: 60 } },
    ]);
  });
});
