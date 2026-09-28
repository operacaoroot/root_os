import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
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
import { garantirPastaDaSaida, mesmoArquivo } from '../../../tools/root-midia/lib/arquivos.mjs';
import {
  TETO_DO_CORPO,
  acharEpisodio,
  cabecalhoDoTrecho,
  clienteDoOs,
  configuracao,
  corpoDaMidia,
  corpoDaTranscricao,
  corpoGrandeDemais,
  exigirOs,
  juntarVariaveis,
  lerArquivoDeVariaveis,
  mensagemDoErro,
  motivoParaNaoEnviarOMp4,
  prazoDoEnvioDoMp4,
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
  argsDoSips,
  caixasDeTopo,
  candidatosDoRender,
  conferirJpegNoTamanho,
  conferirPngNoTamanho,
  dimensoesDoJpeg as dimensoesDoJpegNoMac,
  jpegDoPng,
  jpegJaNoOs,
  motivoSemFaststart,
  subirCorteAoOs,
  videoJaNoOs,
  filtroDoCorteVertical,
  layoutDoCorte,
  lerRegiao,
  linhasDaAgenda,
  marcaDoCarrossel,
  nomeDoCorte,
  nomeDoStory,
  pastaDoCarrossel,
  preencherStory,
  regiaoDoPip,
  regiaoNoVideo,
  regioesPadraoNoCanvas,
  resolucaoDoPreset,
  rotuloDoCandidato,
  slidesEstourados,
  slidesParaAMaquina,
} from '../../../tools/root-midia/lib/semana.mjs';
import {
  ESPERA_DO_RENDER_REPETIDO_MS,
  IDADE_MINIMA_MS,
  PRAZO_DA_TRAVA_MS,
  ROTULO,
  SILENCIO_DA_NOTIFICACAO_MS,
  argsDaNotificacao,
  argsDoLaunchctl,
  caminhosDoVigia,
  candidatosDoBruto,
  PRAZO_DA_PORTA_MS,
  ambienteDoAgente,
  avisosDoRender,
  chaveDoBruto,
  chaveDoRender,
  episodioDaGravacao,
  estadoDoBruto,
  gravacaoParaVarios,
  lerMemoria,
  motivoParaOVigiaNaoEnviar,
  obsEscrevendo,
  passoDoBruto,
  lerPastaDoObs,
  lerTrava,
  linhaDoLog,
  mensagemDeAmbiguo,
  nomeLivre,
  pastaDoEpisodio,
  permissaoAbertaDemais,
  plistDoVigia,
  precisaRodarOLog,
  registrarNotificacao,
  rendersAFazer,
  soltarTrava,
  tomarTrava,
  transcricaoDeEnsaio,
  travaOcupada,
  ultimaLinha,
} from '../../../tools/root-midia/lib/vigia.mjs';
import { caixa, jpegDeTeste, mp4DeTeste, sha256 } from './mp4-de-teste';

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

  it('MD10: o cliente do YouTube declara, pede a sessão (nova ou a mesma), o token e conclui pelas rotas da pauta', async () => {
    const pedidos: Array<{ url: string; metodo: string; corpo?: unknown }> = [];
    const fetchFalso = (async (url: string, init: RequestInit) => {
      pedidos.push({ url, metodo: String(init.method), corpo: init.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/auth/login')) return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const os = clienteDoOs({ url: 'http://os/api', email: 'a', senha: 'b', fetch: fetchFalso });
    const arquivo = { sha256: 'a'.repeat(64), bytes: 10, mime: 'video/mp4' };
    await os.youtube('e1');
    await os.declararYoutube('e1', arquivo);
    await os.sessaoDoYoutube('e1', { ...arquivo, nova: true });
    await os.tokenDoYoutube('e1');
    await os.concluirYoutube('e1', 'vid-1');
    await os.youtubePendentes();
    expect(pedidos.slice(1).map((p) => `${p.metodo} ${p.url.replace('http://os/api', '')}`)).toEqual([
      'GET /pauta/episodios/e1/youtube',
      'PUT /pauta/episodios/e1/youtube/arquivo',
      'POST /pauta/episodios/e1/youtube/sessao',
      'POST /pauta/episodios/e1/youtube/sessao/token',
      'POST /pauta/episodios/e1/youtube/concluido',
      'GET /pauta/youtube/pendentes',
    ]);
    expect(pedidos[3].corpo).toEqual({ ...arquivo, nova: true });
    expect(pedidos[5].corpo).toEqual({ videoId: 'vid-1' });
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

  it('a pasta do --saida existe antes do trabalho longo, e criar é dito com o caminho absoluto', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'root-midia-teste-'));
    try {
      const avisos: string[] = [];
      const saida = join(pasta, 'ep-04', 'bruto.transcricao.json');
      expect(garantirPastaDaSaida(saida, (m) => avisos.push(m))).toBe(saida);
      expect(existsSync(join(pasta, 'ep-04'))).toBe(true);
      expect(avisos).toEqual([`Criei a pasta ${join(pasta, 'ep-04')}.`]);
      // A pasta que já existe não é anunciada de novo.
      garantirPastaDaSaida(join(pasta, 'ep-04', 'cortes.json'), (m) => avisos.push(m));
      expect(avisos).toHaveLength(1);
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

  it('MD13: o log do render diz o candidato em uso e a nota; sem troca possível ou trecho à mão, nada', () => {
    const c = (n: number, nota: number | null, atual: boolean) => ({ n, nota, atual });
    expect(rotuloDoCandidato({ candidatos: [c(1, 8.5, false), c(2, 6, true), c(3, null, false)] })).toBe(' (candidato 2 de 3, nota 6)');
    expect(rotuloDoCandidato({ candidatos: [c(1, 8.5, true), c(2, 6, false)] })).toBe(' (candidato 1 de 2, nota 8,5)');
    expect(rotuloDoCandidato({ candidatos: [c(1, null, false), c(2, null, true)] })).toBe(' (candidato 2 de 2)');
    expect(rotuloDoCandidato({ candidatos: [c(1, 8, false), c(2, 6, false)] })).toBe('');
    expect(rotuloDoCandidato({ candidatos: [c(1, 8, true)] })).toBe('');
    expect(rotuloDoCandidato({})).toBe('');
  });

  it('a peça gerada de outra transcrição não recebe render, nem aprovada (os tempos são do vídeo anterior)', () => {
    expect(aceitaRender({ status: 'aprovada', transcricaoMudou: true })).toBe(false);
    expect(aceitaRender({ status: 'rascunho', transcricaoMudou: true })).toBe(false);
    expect(aceitaRender({ status: 'aprovada', transcricaoMudou: false })).toBe(true);
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

describe('root-midia: o calendário da semana no terminal (MC16)', () => {
  it('pede a agenda da semana (com e sem o dia) e só lê', async () => {
    const pedidos: Array<{ url: string; metodo: string }> = [];
    const fetchFalso = (async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/login')) return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      pedidos.push({ url, metodo: String(init.method) });
      return new Response('{"dias":[]}', { status: 200 });
    }) as unknown as typeof fetch;
    const os = clienteDoOs({ url: 'http://os/api', email: 'a', senha: 'b', fetch: fetchFalso });
    await os.agenda();
    await os.agenda('2026-09-28');
    expect(pedidos).toEqual([
      { url: 'http://os/api/pauta/agenda', metodo: 'GET' },
      { url: 'http://os/api/pauta/agenda?de=2026-09-28', metodo: 'GET' },
    ]);
  });

  it('cada slot com a peça, o estado e onde está a mídia: o PNG no OS (ou quantos faltam), o mp4 no Mac pelo caminho, ou o comando', () => {
    const peca = (over: Record<string, unknown>) => ({ apelido: 'ep-04', itemN: 1, titulo: 'Preço caiu', status: 'aprovada', postada: null, ...over });
    const linhas = linhasDaAgenda({
      dias: [
        {
          dia: '2026-09-28', diaDaSemana: 'seg', feriado: null,
          linhas: [
            { hora: '09:00', formato: 'story', daGrade: true, peca: null },
            { hora: '12:00', formato: 'carrossel', daGrade: true, peca: peca({ midia: { onde: 'storage', imagens: [1, 2, 3] } }) },
            { hora: '12:00', formato: 'carrossel', daGrade: true, peca: peca({ itemN: 2, midia: { onde: 'parcial', imagens: [1, 2, 3], esperadas: 7, faltam: [4, 5, 6, 7], comando: '/root-midia carrosseis ep-04' } }) },
            { hora: '18:00', formato: 'corte', daGrade: false, peca: peca({ status: 'publicada', postada: { url: 'https://www.instagram.com/reel/x/' }, midia: { onde: 'mac', arquivo: '/Users/p/ep-04-m1-corte.mp4' } }) },
          ],
        },
        { dia: '2026-10-12', diaDaSemana: 'seg', feriado: 'Nossa Senhora Aparecida', linhas: [] },
        { dia: '2026-10-13', diaDaSemana: 'ter', feriado: null, linhas: [{ hora: '09:00', formato: 'story', daGrade: true, peca: peca({ midia: { onde: 'nenhuma', comando: '/root-midia stories ep-04' } }) }] },
      ],
      paraDistribuir: [{ apelido: 'ep-05', aprovadasSemData: 4 }],
    });
    expect(linhas).toEqual([
      'seg 28/09',
      '  09:00  story      (vago)',
      '  12:00  carrossel  ep-04 m1  aprovada  Preço caiu',
      '         3 PNG no OS',
      '  12:00  carrossel  ep-04 m2  aprovada  Preço caiu',
      '         3 de 7 PNG no OS (falta: 4, 5, 6, 7) — não poste ainda; /root-midia carrosseis ep-04',
      '  18:00  corte      ep-04 m1  postada https://www.instagram.com/reel/x/ (fora da grade)  Preço caiu',
      '         mp4 no Mac: /Users/p/ep-04-m1-corte.mp4',
      'seg 12/10 · Nossa Senhora Aparecida (sem slot)',
      '  —',
      'ter 13/10',
      '  09:00  story      ep-04 m1  aprovada  Preço caiu',
      '         sem mídia — /root-midia stories ep-04',
      'ep-05: 4 aprovada(s) sem data — "Distribuir" na aba Semana.',
    ]);
  });

  it('MD6: a publicação pelo OS aparece embaixo da peça, com o motivo do erro; a postada não repete', () => {
    const peca = (over: Record<string, unknown>) => ({ apelido: 'ep-04', itemN: 1, titulo: 'Preço caiu', status: 'aprovada', postada: null, midia: { onde: 'storage', imagens: [1] }, ...over });
    const linhas = linhasDaAgenda({
      dias: [
        {
          dia: '2026-09-28', diaDaSemana: 'seg', feriado: null,
          linhas: [
            { hora: '09:00', formato: 'story', daGrade: true, peca: peca({ publicacao: { estado: 'pendente', erro: null } }) },
            { hora: '12:00', formato: 'carrossel', daGrade: true, peca: peca({ publicacao: { estado: 'erro', erro: 'A Meta não processou a mídia (ERROR).' } }) },
            { hora: '18:00', formato: 'corte', daGrade: true, peca: peca({ status: 'publicada', postada: { url: 'https://www.instagram.com/p/m9' }, publicacao: { estado: 'publicada', erro: null } }) },
          ],
        },
      ],
    });
    expect(linhas.filter((l) => l.includes('Instagram pelo OS'))).toEqual([
      '         Instagram pelo OS: esperando a confirmação de outra pessoa em /atendimento',
      '         Instagram pelo OS: a publicação falhou — A Meta não processou a mídia (ERROR).',
    ]);
  });

  it('MD8: o lote da semana aparece embaixo da peça — assinado (e se a automática está desligada) ou na fila; o item revogado não', () => {
    const peca = (over: Record<string, unknown>) => ({ apelido: 'ep-04', itemN: 1, titulo: 'Preço caiu', status: 'aprovada', postada: null, midia: { onde: 'storage', imagens: [1] }, ...over });
    const lote = (estadoDoLote: string, estadoDoItem = 'ativo') => ({ loteId: 'l1', itemId: 'i1', estadoDoLote, estadoDoItem, janelaAte: 'x' });
    const agenda = (automatica: boolean) => ({
      publicacaoAutomatica: automatica,
      dias: [
        {
          dia: '2026-09-28', diaDaSemana: 'seg', feriado: null,
          linhas: [
            { hora: '09:00', formato: 'story', daGrade: true, peca: peca({ lote: lote('ativo') }) },
            { hora: '12:00', formato: 'carrossel', daGrade: true, peca: peca({ status: 'rascunho', lote: lote('aguardando') }) },
            { hora: '18:00', formato: 'corte', daGrade: true, peca: peca({ lote: lote('ativo', 'revogado') }) },
          ],
        },
      ],
    });
    expect(linhasDaAgenda(agenda(true)).filter((l) => l.includes('semana'))).toEqual([
      '         semana assinada: sai pelo OS no horário',
      '         semana na fila: esperando a assinatura de outra pessoa em /atendimento',
    ]);
    expect(linhasDaAgenda(agenda(false)).find((l) => l.includes('semana assinada'))).toBe(
      '         semana assinada: sai pelo OS no horário — mas a publicação automática está DESLIGADA',
    );
  });

  it('MD9: a agenda diz quantos comentários esperam a DM à mão, sem @ nenhum; zero não diz nada', () => {
    const com = linhasDaAgenda({ dias: [], paraDistribuir: [], comentariosPendentes: 3 });
    expect(com).toEqual(['3 comentário(s) com a palavra-chave esperando a DM à mão — "Quem comentou e o que responder" na aba Semana.']);
    expect(linhasDaAgenda({ dias: [], paraDistribuir: [], comentariosPendentes: 0 })).toEqual([]);
    expect(linhasDaAgenda({ dias: [], paraDistribuir: [] })).toEqual([]);
  });

  it('MD11: com a DM automática ligada, a agenda diz que as regras assinadas respondem sozinhas; desligada, fica o texto da MD9', () => {
    expect(linhasDaAgenda({ dias: [], paraDistribuir: [], comentariosPendentes: 2, dmAutomatica: true })).toEqual([
      '2 comentário(s) com a palavra-chave na fila — a DM automática responde os das regras assinadas; o resto é à mão, na aba Semana.',
    ]);
    expect(linhasDaAgenda({ dias: [], paraDistribuir: [], comentariosPendentes: 2, dmAutomatica: false })[0]).toMatch(/esperando a DM à mão/);
    expect(linhasDaAgenda({ dias: [], paraDistribuir: [], comentariosPendentes: 0, dmAutomatica: true })).toEqual([]);
  });

  it('MD1: o slot só proposto pelo encadeamento diz que falta aprovar (ou distribuir) — não é agenda', () => {
    const peca = (over: Record<string, unknown>) => ({ apelido: 'ep-04', itemN: 1, titulo: 'Preço caiu', status: 'rascunho', postada: null, agendadaPara: null, midia: { onde: 'nenhuma', comando: '/root-midia carrosseis ep-04' }, ...over });
    const linhas = linhasDaAgenda({
      dias: [
        {
          dia: '2026-09-28', diaDaSemana: 'seg', feriado: null,
          linhas: [
            { hora: '12:00', formato: 'carrossel', daGrade: true, peca: peca({ slotProposto: '2026-09-28T15:00:00.000Z' }) },
            { hora: '18:00', formato: 'corte', daGrade: true, peca: peca({ status: 'aprovada', slotProposto: '2026-09-28T21:00:00.000Z' }) },
            { hora: '19:00', formato: 'corte', daGrade: false, peca: peca({ status: 'aprovada', agendadaPara: '2026-09-28T22:00:00.000Z', slotProposto: '2026-09-28T21:00:00.000Z' }) },
          ],
        },
      ],
    });
    expect(linhas.filter((l) => l.startsWith('  1'))).toEqual([
      '  12:00  carrossel  ep-04 m1  proposto, falta aprovar  Preço caiu',
      '  18:00  corte      ep-04 m1  proposto, falta distribuir  Preço caiu',
      '  19:00  corte      ep-04 m1  aprovada (fora da grade)  Preço caiu',
    ]);
  });
});


// ---------------------------------------------------------------------------
// MD2: o vigia do Mac
// ---------------------------------------------------------------------------

describe('root-midia: o vigia do Mac — qual arquivo é o bruto (MD2)', () => {
  const T = Date.parse('2026-09-25T13:00:00.000Z');
  const entrada = (nome: string, over: Partial<{ arquivo: boolean; tamanho: number; mtimeMs: number }> = {}) => ({
    nome, arquivo: true, tamanho: 1_000_000, mtimeMs: T + 60_000, ...over,
  });

  it('candidato é arquivo comum .mkv/.mp4/.mov na raiz, não oculto, gravado DEPOIS da entrada em Gravação', () => {
    const c = candidatosDoBruto(
      [
        entrada('2026-09-25 13-10-00.MKV'),
        entrada('b.mov'),
        entrada('c.mp4'),
        entrada('antes da transicao.mp4', { mtimeMs: T - 1 }),
        entrada('no instante da transicao.mp4', { mtimeMs: T }),
        entrada('.oculto.mp4'),
        entrada('notas.txt'),
        entrada('root-midia', { arquivo: false }),
        entrada('link.mp4', { arquivo: false }),
      ],
      { statusDesdeMs: T },
    );
    expect(c.map((e) => e.nome)).toEqual(['2026-09-25 13-10-00.MKV', 'b.mov', 'c.mp4']);
  });

  it('estável: tamanho e data iguais nas duas leituras e parado há 2 min = pronto', () => {
    const e = [entrada('g.mp4')];
    expect(estadoDoBruto(e, e, { agoraMs: T + 60_000 + IDADE_MINIMA_MS })).toEqual({ estado: 'pronto', arquivo: 'g.mp4', tamanho: 1_000_000, mtimeMs: T + 60_000 });
  });

  it('gravando: o tamanho ou a data mudaram, ou um arquivo novo apareceu, entre as leituras — a passagem pula', () => {
    const agoraMs = T + 10 * 60_000;
    expect(estadoDoBruto([entrada('g.mp4')], [entrada('g.mp4', { tamanho: 2_000_000 })], { agoraMs })).toEqual({ estado: 'gravando', arquivos: ['g.mp4'] });
    expect(estadoDoBruto([entrada('g.mp4')], [entrada('g.mp4', { mtimeMs: T + 61_000 })], { agoraMs })).toMatchObject({ estado: 'gravando' });
    expect(estadoDoBruto([], [entrada('novo.mkv')], { agoraMs })).toEqual({ estado: 'gravando', arquivos: ['novo.mkv'] });
    // Um parado e outro crescendo: o OBS está gravando, e isso vem antes do "ambíguo".
    expect(estadoDoBruto([entrada('a.mp4'), entrada('b.mp4')], [entrada('a.mp4'), entrada('b.mp4', { tamanho: 9 })], { agoraMs })).toEqual({ estado: 'gravando', arquivos: ['b.mp4'] });
  });

  it('ambíguo: dois candidatos parados — ninguém adivinha, a notificação manda rodar à mão', () => {
    const dois = [entrada('a.mp4'), entrada('b.mkv')];
    expect(estadoDoBruto(dois, dois, { agoraMs: T + 10 * 60_000 })).toEqual({ estado: 'ambiguo', arquivos: ['a.mp4', 'b.mkv'] });
    expect(mensagemDeAmbiguo('ep-07')).toBe('ambíguo: rode /root-midia ep-07');
  });

  it('anterior à transição não conta; parado mas novo demais espera o que falta dos 2 min; vazio não vai', () => {
    const velho = candidatosDoBruto([entrada('ontem.mp4', { mtimeMs: T - 86_400_000 })], { statusDesdeMs: T });
    expect(estadoDoBruto(velho, velho, { agoraMs: T + 60_000 })).toEqual({ estado: 'nenhum' });
    const novo = [entrada('g.mp4', { mtimeMs: T })];
    expect(estadoDoBruto(novo, novo, { agoraMs: T + 61_000 })).toEqual({ estado: 'jovem', arquivo: 'g.mp4', esperarMs: IDADE_MINIMA_MS - 61_000 });
    const vazio = [entrada('g.mp4', { tamanho: 0 })];
    expect(estadoDoBruto(vazio, vazio, { agoraMs: T + 10 * 60_000 })).toMatchObject({ estado: 'vazio' });
  });

  it('a pasta do OBS é lida sem descer: root-midia/ep-NN e o link simbólico ficam de fora', () => {
    const obs = mkdtempSync(join(tmpdir(), 'root-midia-vigia-obs-'));
    try {
      writeFileSync(join(obs, 'bruto.mp4'), 'x');
      mkdirSync(join(obs, 'root-midia', 'ep-01'), { recursive: true });
      writeFileSync(join(obs, 'root-midia', 'ep-01', 'ep-01-final.mp4'), 'y');
      symlinkSync(join(obs, 'root-midia', 'ep-01', 'ep-01-final.mp4'), join(obs, 'atalho.mp4'));
      const lidas = lerPastaDoObs(obs);
      expect(lidas.find((e) => e.nome === 'root-midia')?.arquivo).toBe(false);
      expect(lidas.find((e) => e.nome === 'atalho.mp4')?.arquivo).toBe(false);
      expect(candidatosDoBruto(lidas, { statusDesdeMs: 0 }).map((e) => e.nome)).toEqual(['bruto.mp4']);
      expect(pastaDoEpisodio(obs, 'ep-01')).toBe(join(obs, 'root-midia', 'ep-01'));
    } finally {
      rmSync(obs, { recursive: true, force: true });
    }
  });

  it('só age com EXATAMENTE um episódio em Gravação sem mídia', () => {
    const g = (id: string, status = 'gravacao', falta = 'midia') => ({ id, status, falta });
    expect(episodioDaGravacao([g('a'), g('b', 'edicao', 'transcricao')])).toEqual({ episodio: g('a') });
    expect(episodioDaGravacao([g('b', 'edicao', 'midia')])).toEqual({ motivo: 'nenhum', quantos: 0 });
    expect(episodioDaGravacao([g('a'), g('c')])).toEqual({ motivo: 'varios', quantos: 2 });
  });

  it('o final do vigia nunca sobrescreve um que já está na pasta do episódio', () => {
    const existe = (c: string) => c.endsWith('ep-01-final.mp4') || c.endsWith('ep-01-final-2.mp4');
    expect(nomeLivre('/obs/root-midia/ep-01', 'ep-01-final', '.mp4', existe)).toBe('/obs/root-midia/ep-01/ep-01-final-3.mp4');
    expect(nomeLivre('/p', 'cortes', '.json', () => false)).toBe('/p/cortes.json');
  });
});

describe('root-midia: o vigia do Mac — trava, memória, launchd e log (MD2)', () => {
  it('onde fica cada coisa: a trava e a memória ao lado do arquivo de variáveis; OBS e log com padrão', () => {
    const c = caminhosDoVigia({}, '/Users/p');
    expect(c).toEqual({
      obs: '/Users/p/Movies/OBS',
      variaveis: '/Users/p/.config/root/root-midia.env',
      trava: '/Users/p/.config/root/root-midia-vigia.lock',
      memoria: '/Users/p/.config/root/root-midia-vigia.estado.json',
      log: '/Users/p/Library/Logs/root-midia/vigia.log',
      agentes: '/Users/p/Library/LaunchAgents',
    });
    const outro = caminhosDoVigia({ ROOT_MIDIA_ENV: '/tmp/e/vars.env', ROOT_MIDIA_OBS_DIR: '~/Gravações', ROOT_MIDIA_VIGIA_LOG: '/tmp/e/v.log' }, '/Users/p');
    expect(outro).toMatchObject({ obs: '/Users/p/Gravações', trava: '/tmp/e/root-midia-vigia.lock', log: '/tmp/e/v.log' });
  });

  it('a trava: a segunda instância sai calada; processo morto ou trava de 3 h libera; soltar não apaga o arquivo', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'root-midia-vigia-trava-'));
    try {
      const trava = join(pasta, 'sub', 'root-midia-vigia.lock');
      const agoraMs = Date.parse('2026-09-25T13:00:00.000Z');
      expect(tomarTrava(trava, { pid: 111, agoraMs, vivo: () => true })).toBe(true);
      expect(lerTrava(readFileSync(trava, 'utf8'))).toEqual({ pid: 111, desdeMs: agoraMs });
      expect(tomarTrava(trava, { pid: 222, agoraMs: agoraMs + 1000, vivo: () => true })).toBe(false);
      expect(tomarTrava(trava, { pid: 222, agoraMs: agoraMs + 1000, vivo: () => false })).toBe(true);
      expect(tomarTrava(trava, { pid: 333, agoraMs: agoraMs + 1000 + PRAZO_DA_TRAVA_MS, vivo: () => true })).toBe(true);
      expect(soltarTrava(trava, 222, agoraMs)).toBe(false);
      expect(soltarTrava(trava, 333, agoraMs)).toBe(true);
      expect(existsSync(trava)).toBe(true);
      expect(lerTrava(readFileSync(trava, 'utf8'))).toBeNull();
      expect(tomarTrava(trava, { pid: 444, agoraMs, vivo: () => true })).toBe(true);
      expect(existsSync(`${trava}.porta`)).toBe(false);
      expect(travaOcupada(null, { agoraMs, vivo: () => true })).toBe(false);
      expect(lerTrava('lixo')).toBeNull();
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it('a trava é tomada atrás de uma porta exclusiva: com a porta fechada por outra instância, perde mesmo com a trava livre; a porta de uma tomada morta sai depois de 1 min', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'root-midia-vigia-porta-'));
    try {
      const trava = join(pasta, 'root-midia-vigia.lock');
      const agoraMs = Date.now();
      writeFileSync(`${trava}.porta`, '');
      expect(tomarTrava(trava, { pid: 111, agoraMs, vivo: () => false })).toBe(false);
      expect(existsSync(trava)).toBe(false);
      expect(existsSync(`${trava}.porta`)).toBe(true);
      const velha = (agoraMs - PRAZO_DA_PORTA_MS - 1000) / 1000;
      utimesSync(`${trava}.porta`, velha, velha);
      expect(tomarTrava(trava, { pid: 111, agoraMs, vivo: () => false })).toBe(false);
      expect(existsSync(`${trava}.porta`)).toBe(false);
      expect(tomarTrava(trava, { pid: 111, agoraMs, vivo: () => false })).toBe(true);
      expect(lerTrava(readFileSync(trava, 'utf8'))).toMatchObject({ pid: 111 });
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it('o plist: o node e o script em lista, WatchPaths no OBS, 15 min, 60 s de folga, log, e das variáveis só o CAMINHO do arquivo', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'root-midia-vigia-env-'));
    try {
      const variaveis = join(pasta, 'root-midia.env');
      writeFileSync(variaveis, 'ROOT_OS_EMAIL=eu@root\nROOT_OS_SENHA=senha-que-nao-vaza\n', { mode: 0o600 });
      const xml = plistDoVigia({ node: '/opt/node/bin/node', script: '/repo/tools/root-midia/root-midia.mjs', obs: '/Users/p/Movies/OBS & Cia', log: '/Users/p/Library/Logs/root-midia/vigia.log', variaveis });
      const chave = (k: string) => new RegExp(`<key>${k}</key>\\s*([\\s\\S]*?)\\s*(?=<key>|</dict>\\s*</plist>)`).exec(xml)?.[1] ?? '';
      expect(chave('Label')).toBe(`<string>${ROTULO}</string>`);
      expect(ROTULO).toBe('com.operacaoroot.root-midia.vigia');
      expect(chave('ProgramArguments').match(/<string>(.*?)<\/string>/g)).toEqual([
        '<string>/opt/node/bin/node</string>',
        '<string>/repo/tools/root-midia/root-midia.mjs</string>',
        '<string>vigia</string>',
      ]);
      expect(chave('WatchPaths')).toContain('<string>/Users/p/Movies/OBS &amp; Cia</string>');
      expect(chave('StartInterval')).toBe('<integer>900</integer>');
      expect(chave('ThrottleInterval')).toBe('<integer>60</integer>');
      expect(chave('StandardOutPath')).toBe('<string>/Users/p/Library/Logs/root-midia/vigia.log</string>');
      expect(chave('StandardErrorPath')).toBe('<string>/Users/p/Library/Logs/root-midia/vigia.log</string>');
      expect([...xml.matchAll(/<key>(ROOT_[A-Z_]+)<\/key>/g)].map((m) => m[1])).toEqual(['ROOT_MIDIA_ENV']);
      expect(xml).toContain(`<string>${variaveis}</string>`);
      expect(xml).not.toMatch(/senha-que-nao-vaza|ROOT_OS_SENHA|eu@root/);
      expect(permissaoAbertaDemais(0o100600)).toBe(false);
      expect(permissaoAbertaDemais(0o100644)).toBe(true);
      expect(permissaoAbertaDemais(0o100640)).toBe(true);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it('launchctl e osascript em lista de argumentos; a notificação vai como argumento do script, nunca dentro dele', () => {
    expect(argsDoLaunchctl('bootstrap', { uid: 501, plist: '/x/a.plist' })).toEqual(['bootstrap', 'gui/501', '/x/a.plist']);
    expect(argsDoLaunchctl('bootout', { uid: 501 })).toEqual(['bootout', `gui/501/${ROTULO}`]);
    expect(argsDoLaunchctl('print', { uid: 501 })).toEqual(['print', `gui/501/${ROTULO}`]);
    expect(() => argsDoLaunchctl('bootstrap', { uid: 501 })).toThrow(/plist/);
    expect(() => argsDoLaunchctl('print', { uid: Number.NaN })).toThrow(/uid/);
    const a = argsDaNotificacao('ambíguo: "a.mp4" & end tell\ndo shell script "x"');
    expect(a.slice(0, 6)).toEqual(['-e', 'on run argv', '-e', 'display notification (item 1 of argv) with title (item 2 of argv)', '-e', 'end run']);
    expect(a[6]).toBe('ambíguo: "a.mp4" & end tell do shell script "x"');
    expect(a[7]).toBe('root-midia');
    expect(argsDaNotificacao('x'.repeat(500))[6]).toHaveLength(240);
  });

  it('a memória: a notificação repetida fica calada por 6 h; o render que falhou com as mesmas peças não é refeito por 24 h', () => {
    const agora = Date.parse('2026-09-25T13:00:00.000Z');
    const m0 = lerMemoria('{lixo');
    expect(m0).toEqual({ notificacoes: {}, renders: {}, brutosQueFalharam: {} });
    const m1 = registrarNotificacao(m0, 'ambíguo: rode /root-midia ep-01', agora)!;
    expect(registrarNotificacao(m1, 'ambíguo: rode /root-midia ep-01', agora + 60_000)).toBeNull();
    expect(registrarNotificacao(m1, 'outra', agora + 60_000)).not.toBeNull();
    expect(registrarNotificacao(m1, 'ambíguo: rode /root-midia ep-01', agora + SILENCIO_DA_NOTIFICACAO_MS)).not.toBeNull();

    const ep = { id: 'e1', precisaDeRender: { carrossel: { pecas: 2, assinatura: 'aaa' }, corte: { pecas: 1, assinatura: 'ccc' }, story: { pecas: 0, assinatura: 'x' } } };
    expect(rendersAFazer(ep, m0, agora).map((r) => r.formato)).toEqual(['corte', 'carrossel']);
    const tentou = lerMemoria(JSON.stringify({ renders: { [chaveDoRender('e1', 'carrossel')]: { assinatura: 'aaa', em: agora }, lixo: 'x' } }));
    expect(Object.keys(tentou.renders)).toEqual(['e1:carrossel']);
    expect(rendersAFazer(ep, tentou, agora + 60_000).map((r) => r.formato)).toEqual(['corte']);
    expect(rendersAFazer({ ...ep, precisaDeRender: { carrossel: { pecas: 2, assinatura: 'bbb' } } }, tentou, agora + 60_000)).toHaveLength(1);
    expect(rendersAFazer(ep, tentou, agora + ESPERA_DO_RENDER_REPETIDO_MS).map((r) => r.formato)).toEqual(['corte', 'carrossel']);
    expect(chaveDoBruto('/obs/a.mp4', 10, 1234.6)).toBe('/obs/a.mp4|10|1235');
  });

  it('o log: uma linha por aviso com a hora, roda aos 5 MB, e o estado lê a última linha', () => {
    expect(linhaDoLog(Date.parse('2026-09-25T13:00:00.000Z'), 'um\ndois\n')).toBe('2026-09-25T13:00:00.000Z um ⏎ dois\n');
    expect(precisaRodarOLog(5 * 1024 * 1024)).toBe(true);
    expect(precisaRodarOLog(5 * 1024 * 1024 - 1)).toBe(false);
    expect(ultimaLinha('a\nb\n\n')).toBe('b');
    expect(ultimaLinha('')).toBeNull();
  });

  it('a transcrição de ENSAIO: um segmento por trecho com som, aceito pelo OS, e a palavra no segundo tira a tomada', () => {
    const silencios = [{ inicio: 3, fim: 6 }, { inicio: 9, fim: 12 }];
    const t = transcricaoDeEnsaio(silencios, 15, { palavra: 'root, corta' });
    expect(t.segmentos.map((s) => [s.inicio, s.fim])).toEqual([[0, 3], [6, 9], [12, 15]]);
    expect(t.segmentos[1].texto).toContain('root, corta');
    expect(PautaTranscricaoSchema.safeParse(corpoDaTranscricao(t)).success).toBe(true);
    const plano = planoDeCortes({ duracao: 15, silencios, segmentos: t.segmentos, palavra: 'root, corta' });
    expect(plano.tomadasErradas).toHaveLength(1);
    expect(plano.duracaoFinalSeg).toBeLessThan(5);
    expect(transcricaoDeEnsaio([], 4).segmentos).toEqual([{ inicio: 0, fim: 4, texto: 'Trecho 1 do ensaio do vigia.' }]);
  });
});

describe('root-midia: o vigia do Mac — a metade do bruto, com disco, relógio e cadeia de mentira (MD2)', () => {
  const T = Date.parse('2026-09-25T13:00:00.000Z');
  const EP = { apelido: 'ep-07', statusDesde: new Date(T).toISOString() };
  const arq = (nome: string, over: Partial<{ tamanho: number; mtimeMs: number }> = {}) => ({ nome, arquivo: true, tamanho: 1_000_000, mtimeMs: T + 60_000, ...over });

  /** As leituras da pasta saem da lista, uma por chamada (a última se repete); o relógio só anda pela espera. */
  function montar(leituras: Array<Array<ReturnType<typeof arq>>>, over: Partial<Parameters<typeof passoDoBruto>[0]> = {}) {
    let agora = T + 10 * 60_000;
    let i = 0;
    const r = { notificacoes: [] as string[], esperas: [] as number[], cadeias: [] as string[], falhas: [] as string[], registros: [] as string[] };
    const o = {
      ep: EP,
      obs: '/obs',
      existe: () => true,
      ler: () => leituras[Math.min(i++, leituras.length - 1)],
      agora: () => agora,
      esperar: async (ms: number) => {
        r.esperas.push(ms);
        agora += ms;
      },
      intervaloMs: 60_000,
      idadeMinimaMs: IDADE_MINIMA_MS,
      esperaMaximaMs: 5 * 60_000,
      jaFalhou: () => false,
      lembrarFalha: (k: string) => void r.falhas.push(k),
      transcritor: () => ({ ensaio: false }),
      cadeia: async (bruto: string) => {
        r.cadeias.push(bruto);
        return { status: 'pacote' };
      },
      notificar: async (m: string) => void r.notificacoes.push(m),
      registrar: (m: string) => void r.registros.push(m),
      ...over,
    };
    return { o, r, avancar: (ms: number) => (agora += ms), agora: () => agora };
  }

  it('um bruto parado e maduro vai pela cadeia; a notificação diz o status', async () => {
    const { o, r } = montar([[arq('g.mp4')]]);
    expect(await passoDoBruto(o)).toEqual({ estado: 'enviado', texto: 'ep-07: g.mp4 → pacote' });
    expect(r.cadeias).toEqual([join('/obs', 'g.mp4')]);
    expect(r.esperas).toEqual([60_000]);
    expect(r.notificacoes).toEqual(['ep-07: mídia e transcrição no OS (pacote).']);
  });

  it('dois candidatos: a cadeia não é chamada, sai o "ambíguo" e nada é enviado', async () => {
    const { o, r } = montar([[arq('a.mp4'), arq('b.mkv')]]);
    expect(await passoDoBruto(o)).toMatchObject({ estado: 'ambiguo' });
    expect(r.cadeias).toEqual([]);
    expect(r.notificacoes).toEqual([mensagemDeAmbiguo('ep-07')]);
  });

  it('o arquivo mudando entre as leituras: "gravando", pula sem cadeia nem notificação', async () => {
    const { o, r } = montar([[arq('g.mp4')], [arq('g.mp4', { tamanho: 2_000_000 })]]);
    expect(await passoDoBruto(o)).toMatchObject({ estado: 'gravando' });
    expect(r.cadeias).toEqual([]);
    expect(r.notificacoes).toEqual([]);
  });

  it('o jovem espera o que falta dos 2 min e segue; o que passaria dos 5 min fica para a próxima passagem', async () => {
    const { o, r, agora } = montar([]);
    const recente = [arq('g.mp4', { mtimeMs: agora() - 10_000 })];
    o.ler = () => recente;
    expect(await passoDoBruto(o)).toMatchObject({ estado: 'enviado' });
    // 60 s entre as leituras; faltavam 120 − 70 = 50 s de idade.
    expect(r.esperas).toEqual([60_000, 50_000]);

    const lento = montar([], { idadeMinimaMs: 10 * 60_000 });
    const novo = [arq('g.mp4', { mtimeMs: lento.agora() })];
    lento.o.ler = () => novo;
    expect(await passoDoBruto(lento.o)).toMatchObject({ estado: 'jovem' });
    expect(lento.r.cadeias).toEqual([]);
  });

  it('sem o modelo do whisper: notifica e para, SEM marcar o bruto como falho', async () => {
    const { o, r } = montar([[arq('g.mp4')]], { transcritor: () => ({ falta: 'Falta o modelo do whisper (WHISPER_MODEL, D-MC3)' }) });
    expect(await passoDoBruto(o)).toMatchObject({ estado: 'sem-modelo' });
    expect(r.cadeias).toEqual([]);
    expect(r.falhas).toEqual([]);
    expect(r.notificacoes).toEqual(['ep-07: Falta o modelo do whisper (WHISPER_MODEL, D-MC3)']);
  });

  it('a cadeia que lança marca o bruto como falho pela chave dele; o que já falhou não roda de novo', async () => {
    const { o, r } = montar([[arq('g.mp4')]], {
      cadeia: async () => {
        throw new Error('ffmpeg saiu com 1\ndetalhe');
      },
    });
    expect(await passoDoBruto(o)).toEqual({ estado: 'falhou', texto: 'ep-07: a cadeia parou (ffmpeg saiu com 1)' });
    expect(r.falhas).toEqual([chaveDoBruto(join('/obs', 'g.mp4'), 1_000_000, T + 60_000)]);
    expect(r.notificacoes).toEqual(['ep-07: o vigia parou (ffmpeg saiu com 1). Rode /root-midia ep-07.']);

    const deNovo = montar([[arq('g.mp4')]], { jaFalhou: (k: string) => k === r.falhas[0] });
    expect(await passoDoBruto(deNovo.o)).toMatchObject({ estado: 'ja-falhou' });
    expect(deNovo.r.cadeias).toEqual([]);
  });

  it('o episódio que saiu de Gravação durante a cadeia: nada enviado, notificado, e o bruto não vira falho', async () => {
    const motivo = motivoParaOVigiaNaoEnviar({ apelido: 'ep-07', status: 'edicao', falta: 'transcricao' }, 'ep-07')!;
    const { o, r } = montar([[arq('g.mp4')]], { cadeia: async () => ({ naoEnviado: motivo }) });
    expect(await passoDoBruto(o)).toEqual({ estado: 'mudou', texto: motivo });
    expect(r.falhas).toEqual([]);
    expect(r.notificacoes).toEqual([motivo]);
  });

  it('sem a pasta do OBS, sem statusDesde ou sem gravação nova: nenhuma leitura de espera nem cadeia', async () => {
    const semObs = montar([[arq('g.mp4')]], { existe: () => false });
    expect(await passoDoBruto(semObs.o)).toMatchObject({ estado: 'sem-obs' });
    const semDesde = montar([[arq('g.mp4')]], { ep: { apelido: 'ep-07', statusDesde: null } });
    expect(await passoDoBruto(semDesde.o)).toMatchObject({ estado: 'sem-status' });
    const velho = montar([[arq('ontem.mp4', { mtimeMs: T - 1 })]]);
    expect(await passoDoBruto(velho.o)).toMatchObject({ estado: 'nenhum' });
    for (const x of [semObs, semDesde, velho]) {
      expect(x.r.cadeias).toEqual([]);
      expect(x.r.esperas).toEqual([]);
    }
  });
});

describe('root-midia: o vigia do Mac — o que a passagem decide fora do bruto (MD2)', () => {
  const T = Date.parse('2026-09-25T13:00:00.000Z');
  const arq = (nome: string, mtimeMs: number) => ({ nome, arquivo: true, tamanho: 10, mtimeMs });

  it('a mídia só vai se o episódio AINDA está em Gravação sem mídia', () => {
    expect(motivoParaOVigiaNaoEnviar({ apelido: 'ep-07', status: 'gravacao', falta: 'midia' }, 'ep-07')).toBeNull();
    expect(motivoParaOVigiaNaoEnviar({ apelido: 'ep-07', status: 'edicao', falta: 'transcricao' }, 'ep-07')).toBe(
      'ep-07 mudou durante a cadeia (agora em edicao, falta transcricao); nada enviado',
    );
    expect(motivoParaOVigiaNaoEnviar(null, 'ep-07')).toMatch(/^ep-07 mudou durante a cadeia \(saiu da fila da mídia\); nada enviado$/);
  });

  it('vários em Gravação só avisam com gravação nova depois da entrada do mais antigo', () => {
    const itens = [
      { status: 'gravacao', falta: 'midia', statusDesde: new Date(T).toISOString() },
      { status: 'gravacao', falta: 'midia', statusDesde: new Date(T + 3_600_000).toISOString() },
      { status: 'edicao', falta: 'transcricao', statusDesde: new Date(T - 86_400_000).toISOString() },
    ];
    expect(gravacaoParaVarios(itens, [arq('ontem.mp4', T - 1)])).toBe(false);
    expect(gravacaoParaVarios(itens, [arq('agora.mp4', T + 1)])).toBe(true);
    expect(gravacaoParaVarios([{ status: 'gravacao', falta: 'midia' }], [])).toBe(true);
  });

  it('o OBS escrevendo na raiz nos últimos 2 min segura os renders', () => {
    expect(obsEscrevendo([arq('g.mkv', T - 30_000)], T)).toBe(true);
    expect(obsEscrevendo([arq('g.mkv', T - IDADE_MINIMA_MS - 1)], T)).toBe(false);
    expect(obsEscrevendo([arq('notas.txt', T)], T)).toBe(false);
  });

  it('o render que não subiu vira notificação: o carrossel estourado e o corte sem trecho', () => {
    expect(
      avisosDoRender('ep-07', 'carrossel', {
        carrosseis: [
          { n: 1, enviado: true, estourados: [] },
          { n: 2, enviado: false, estourados: [3, 5] },
          { n: 3, enviado: false, estourados: [null] },
        ],
      }),
    ).toEqual([
      'ep-07: o carrossel da matéria 2 estourou o texto no slide 3, 5 e não subiu; encurte na tela',
      'ep-07: o carrossel da matéria 3 estourou o texto e não subiu; encurte na tela',
    ]);
    expect(avisosDoRender('ep-07', 'corte', { cortes: [], pulados: [{ n: 2, motivo: 'sem trecho; gere a semana de novo' }] })).toEqual([
      'ep-07: o corte da matéria 2 ficou sem render (sem trecho; gere a semana de novo)',
    ]);
    expect(avisosDoRender('ep-07', 'corte', { cortes: [{ n: 1, subiu: true }, { n: 3, subiu: false, motivo: 'HTTP 503' }, { n: 4, subiu: false }], pulados: [] })).toEqual([
      'ep-07: o mp4 do corte da matéria 3 não subiu ao OS (HTTP 503)',
    ]);
    expect(avisosDoRender('ep-07', 'story', { stories: [] })).toEqual([]);
    expect(avisosDoRender('ep-07', 'corte', undefined)).toEqual([]);
  });

  it('o instalar monta os caminhos só com o arquivo de variáveis, que é o que o launchd vai ver', () => {
    const env = ambienteDoAgente('ROOT_MIDIA_OBS_DIR=~/Gravações\nROOT_OS_EMAIL=eu@root\n', '/p/root-midia.env');
    expect(env).toEqual({ ROOT_MIDIA_OBS_DIR: '~/Gravações', ROOT_OS_EMAIL: 'eu@root', ROOT_MIDIA_ENV: '/p/root-midia.env' });
    expect(caminhosDoVigia(env, '/Users/p')).toMatchObject({ obs: '/Users/p/Gravações', variaveis: '/p/root-midia.env', trava: '/p/root-midia-vigia.lock' });
    // O que está só no shell de quem instala não entra.
    expect(caminhosDoVigia(ambienteDoAgente('', '/p/v.env'), '/Users/p').obs).toBe('/Users/p/Movies/OBS');
  });
});

describe('root-midia: a catraca do não-apagar (MD2)', () => {
  const raiz = join(__dirname, '../../../tools/root-midia');
  const arquivos = ['root-midia.mjs', ...readdirSync(join(raiz, 'lib')).filter((n) => n.endsWith('.mjs')).map((n) => `lib/${n}`)];
  const fontes = arquivos.map((a) => ({ a, linhas: readFileSync(join(raiz, a), 'utf8').split('\n') }));

  it('a varredura pega todo arquivo da ferramenta, o vigia inclusive', () => {
    expect(arquivos).toContain('lib/vigia.mjs');
    expect(arquivos).toContain('root-midia.mjs');
  });

  it('só apaga pasta temporária própria (mkdtemp), o plist do agente e a porta da trava; nunca o bruto, o final nem nada da pasta do OBS', () => {
    const achados: string[] = [];
    for (const { a, linhas } of fontes) {
      linhas.forEach((linha, i) => {
        for (const m of linha.matchAll(/\b(unlinkSync|unlink|rmSync|rm|rmdirSync|rmdir|renameSync|rename)\s*\(\s*([^,)]+)/g)) {
          const [, chamada, alvo] = m;
          const antes = linhas.slice(Math.max(0, i - 80), i).reverse();
          const origem = antes.find((l) => new RegExp(`\\bconst ${alvo.trim()} = `).test(l)) ?? '';
          if (chamada === 'rmSync' && alvo.trim() === 'pasta' && /mkdtempSync\(/.test(origem)) continue;
          if (chamada === 'unlinkSync' && alvo.trim() === 'plist' && /`\$\{ROTULO\}\.plist`/.test(origem)) continue;
          if (chamada === 'unlinkSync' && alvo.trim() === 'porta' && a === 'lib/vigia.mjs' && /`\$\{caminho\}\.porta`/.test(origem)) continue;
          if (chamada === 'renameSync' && alvo.trim() === 'log' && a === 'root-midia.mjs') continue;
          achados.push(`${a}:${i + 1}: ${linha.trim()}`);
        }
      });
    }
    expect(achados).toEqual([]);
  });

  it('nenhum comando externo de apagar (rm, trash) nem a API de promessas do fs', () => {
    for (const { a, linhas } of fontes) {
      const texto = linhas.join('\n');
      expect(texto, a).not.toMatch(/['"`](rm|trash|srm|rmdir)['"`]/);
      expect(texto, a).not.toMatch(/fs\/promises|promises\.(rm|unlink)/);
    }
  });
});

/*
 * MD4 — a mídia sobe ao OS: o JPEG ao lado do PNG pelo `sips` e o mp4 do corte
 * inteiro, por stream, conferido o faststart e com o sha256 no cabeçalho.
 */
describe('root-midia: o JPEG e o mp4 do corte sobem ao OS (MD4)', () => {
  it('o corte sai com o áudio em 48 kHz e o faststart', () => {
    const args = argsDoCorteVertical({ video: 'v', saida: 's.mp4', inicio: 0, fim: 30, filtro: 'F', audio: true, codec: [] });
    expect(args.join(' ')).toContain('-c:a aac -b:a 160k -ar 48000');
    expect(args.join(' ')).toContain('-movflags +faststart');
  });

  it('o sips converte o PNG num JPEG ao lado, qualidade 90, em lista de argumentos', () => {
    expect(argsDoSips('/p/ep 04; rm.png', '/p/ep 04; rm.jpg')).toEqual(['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', '/p/ep 04; rm.png', '--out', '/p/ep 04; rm.jpg']);
    expect(() => argsDoSips('/p/a.jpg', '/p/b.png')).toThrow(/converte .png em .jpg/);
    expect(jpegDoPng('/p/slide-01.PNG')).toBe('/p/slide-01.jpg');
  });

  it('o JPEG convertido é conferido: tamanho da peça e teto de 8 MB', () => {
    expect(dimensoesDoJpegNoMac(jpegDeTeste(1080, 1350))).toEqual({ largura: 1080, altura: 1350 });
    expect(dimensoesDoJpegNoMac(Buffer.from('não é jpeg'))).toBeNull();
    expect(conferirJpegNoTamanho(jpegDeTeste(1080, 1920), 1080, 1920)).toBeNull();
    expect(conferirJpegNoTamanho(jpegDeTeste(1080, 1350), 1080, 1920)).toMatch(/1080×1350; a peça é 1080×1920/);
    expect(conferirJpegNoTamanho(Buffer.concat([jpegDeTeste(1080, 1920), Buffer.alloc(8 * 1024 * 1024)]), 1080, 1920)).toMatch(/8 MB/);
    expect(conferirJpegNoTamanho(Buffer.from('x'), 1080, 1920)).toMatch(/não saiu JPEG/);
  });

  it('as caixas de topo pelo cabeçalho: com faststart passa; moov depois do mdat, sem ftyp ou truncado não', () => {
    const ler = (b: Buffer) => (offset: number, n: number) => b.subarray(offset, offset + n);
    const bom = mp4DeTeste();
    expect(caixasDeTopo(ler(bom), bom.length).map((c) => c.tipo)).toEqual(['ftyp', 'moov', 'mdat']);
    expect(motivoSemFaststart(caixasDeTopo(ler(bom), bom.length))).toBeNull();
    const ruim = mp4DeTeste({ faststart: false });
    expect(motivoSemFaststart(caixasDeTopo(ler(ruim), ruim.length))).toMatch(/faststart/);
    const semFtyp = Buffer.concat([caixa('free', Buffer.alloc(4)), bom]);
    expect(motivoSemFaststart(caixasDeTopo(ler(semFtyp), semFtyp.length))).toMatch(/ftyp/);
    expect(() => caixasDeTopo(ler(bom.subarray(0, bom.length - 1)), bom.length - 1)).toThrow(/truncado/);
  });

  it('o mesmo conteúdo que já está no OS não sobe de novo', () => {
    expect(videoJaNoOs({ video: { sha256: 'a' } }, 'a')).toBe(true);
    expect(videoJaNoOs({ video: { sha256: 'a' } }, 'b')).toBe(false);
    expect(videoJaNoOs({ video: null }, 'a')).toBe(false);
    expect(jpegJaNoOs({ jpegs: [{ n: 2, sha256: 'x' }] }, 2, 'x')).toBe(true);
    expect(jpegJaNoOs({ jpegs: [{ n: 2, sha256: 'x' }] }, 1, 'x')).toBe(false);
    expect(jpegJaNoOs({}, 1, 'x')).toBe(false);
  });

  it('o envio vai à ROOT_OS_ENVIO_URL (a API sem o proxy do web), que também só aceita https fora desta máquina', () => {
    expect(configuracao({ ROOT_OS_API_URL: 'https://os.x/api/' }).envio).toBe('https://os.x/api');
    expect(configuracao({ ROOT_OS_API_URL: 'https://os.x/api', ROOT_OS_ENVIO_URL: 'https://api.x/api/' }).envio).toBe('https://api.x/api');
    expect(() => exigirOs(configuracao({ ROOT_OS_API_URL: 'https://os.x/api', ROOT_OS_ENVIO_URL: 'http://api.x/api', ROOT_OS_EMAIL: 'a', ROOT_OS_SENHA: 'b' }))).toThrow(/ROOT_OS_ENVIO_URL/);
    expect(() => exigirOs(configuracao({ ROOT_OS_API_URL: 'https://os.x/api', ROOT_OS_ENVIO_URL: 'http://127.0.0.1:4001/api', ROOT_OS_EMAIL: 'a', ROOT_OS_SENHA: 'b' }))).not.toThrow();
  });

  it('o mp4 sobe por stream a um servidor dublê: Content-Length, o sha no cabeçalho, os bytes iguais; o 401 reabre o arquivo', async () => {
    const recebidos: Array<{ url: string; cabecalhos: Record<string, unknown>; corpo: Buffer }> = [];
    let recusarUma = true;
    const servidor = createServer((req, res) => {
      const partes: Buffer[] = [];
      req.on('data', (d: Buffer) => partes.push(d));
      req.on('end', () => {
        if (req.url?.endsWith('/auth/login')) return res.end(JSON.stringify({ token: `t${recebidos.length}` }));
        recebidos.push({ url: req.url ?? '', cabecalhos: req.headers, corpo: Buffer.concat(partes) });
        if (recusarUma) {
          recusarUma = false;
          res.statusCode = 401;
          return res.end('{}');
        }
        res.end(JSON.stringify({ video: { sha256: req.headers['x-conteudo-sha256'] } }));
      });
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    try {
      const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
      const mp4 = mp4DeTeste({ mdat: 200_000 });
      let aberturas = 0;
      const abrir = () => {
        aberturas++;
        return Readable.from([mp4.subarray(0, 100_000), mp4.subarray(100_000)]);
      };
      const os = clienteDoOs({ url: `${base}/api`, envio: `${base}/api`, email: 'a', senha: 'b' });
      const r = await os.enviarVideoDoCorte('p 1', { abrir, bytes: mp4.length, sha256: sha256(mp4) });
      expect(r).toEqual({ video: { sha256: sha256(mp4) } });
      expect(aberturas).toBe(2);
      expect(recebidos).toHaveLength(2);
      for (const pedido of recebidos) {
        expect(pedido.url).toBe('/api/pauta/pecas/p%201/video/arquivo');
        expect(pedido.cabecalhos).toMatchObject({
          'content-type': 'video/mp4',
          'content-length': String(mp4.length),
          'x-conteudo-sha256': sha256(mp4),
        });
        expect(pedido.cabecalhos['transfer-encoding']).toBeUndefined();
        expect(pedido.corpo.equals(mp4)).toBe(true);
      }
    } finally {
      servidor.close();
    }
  });

  it('pelo proxy do web o mp4 acima de 10 MB nem tenta subir; a API direto ou local, sim; o prazo cresce com o tamanho', () => {
    const MB = 1024 * 1024;
    const prod = configuracao({ ROOT_OS_API_URL: 'https://os.x/api' });
    expect(motivoParaNaoEnviarOMp4(prod, 11 * MB)).toMatch(/ROOT_OS_ENVIO_URL/);
    expect(motivoParaNaoEnviarOMp4(prod, 9 * MB)).toBeNull();
    expect(motivoParaNaoEnviarOMp4(configuracao({ ROOT_OS_API_URL: 'https://os.x/api', ROOT_OS_ENVIO_URL: 'https://api.x/api' }), 200 * MB)).toBeNull();
    expect(motivoParaNaoEnviarOMp4(configuracao({ ROOT_OS_API_URL: 'http://localhost:4001/api' }), 200 * MB)).toBeNull();
    expect(clienteDoOs({ url: 'https://os.x/api', email: 'a', senha: 'b' }).motivoParaNaoEnviar(11 * MB)).toMatch(/ROOT_OS_ENVIO_URL/);
    expect(prazoDoEnvioDoMp4(0)).toBe(60_000);
    expect(prazoDoEnvioDoMp4(300 * MB)).toBe(60_000 + 1200 * 1000);
  });

  it('cada corte falha sozinho: o envio que não chega volta com o motivo, e o barrado não apaga o mp4 que a peça já tem no OS', async () => {
    const chamadas: string[] = [];
    const osFalso = (o: { barrado?: string | null; falhaNoEnvio?: boolean } = {}) => ({
      motivoParaNaoEnviar: () => o.barrado ?? null,
      videoDoCorte: async (id: string) => void chamadas.push(`PUT ${id}`),
      enviarVideoDoCorte: async (id: string) => {
        chamadas.push(`POST ${id}`);
        if (o.falhaNoEnvio) throw new Error('POST … → HTTP 503: storage fora');
      },
    });
    const arquivo = { sha256: 'b'.repeat(64), abrir: () => Readable.from([Buffer.from('x')]) };
    const corpo = { bytes: 20 * 1024 * 1024 };

    expect(await subirCorteAoOs(osFalso(), { id: 'p1' }, corpo, arquivo)).toEqual({ sha256: arquivo.sha256, subiu: true });
    expect(await subirCorteAoOs(osFalso({ falhaNoEnvio: true }), { id: 'p2' }, corpo, arquivo)).toEqual({ sha256: arquivo.sha256, subiu: false, motivo: 'POST … → HTTP 503: storage fora' });
    // Barrado sem mp4 no OS: registra o caminho do Mac (MC15), não manda o arquivo.
    expect(await subirCorteAoOs(osFalso({ barrado: 'pelo proxy' }), { id: 'p3', video: null }, corpo, arquivo)).toMatchObject({ subiu: false, motivo: 'pelo proxy' });
    // Barrado com outro mp4 já no OS: nem registra, que o registro apagaria a referência.
    expect(await subirCorteAoOs(osFalso({ barrado: 'pelo proxy' }), { id: 'p4', video: { sha256: 'a'.repeat(64) } }, corpo, arquivo)).toMatchObject({ subiu: false, motivo: 'pelo proxy' });
    // O mesmo mp4 já no OS: nada.
    expect(await subirCorteAoOs(osFalso(), { id: 'p5', video: { sha256: arquivo.sha256 } }, corpo, arquivo)).toEqual({ sha256: arquivo.sha256, subiu: false });
    expect(chamadas).toEqual(['PUT p1', 'POST p1', 'PUT p2', 'POST p2', 'PUT p3']);
  });

  it('MD13: o corte sobe dizendo de que trecho saiu, e o 409 da troca de candidato fica neste corte', async () => {
    const pedidos: Array<{ tipo: string; id: string; corpo: unknown }> = [];
    const osFalso = (conflito = false) => ({
      motivoParaNaoEnviar: () => null,
      videoDoCorte: async (id: string, corpo: unknown) => {
        pedidos.push({ tipo: 'PUT', id, corpo });
        if (conflito) throw new Error('PUT /pauta/pecas/p2/video → HTTP 409: O mp4 é do trecho 35.0–57.9 s e a peça agora usa 58.2–80.4 s');
      },
      enviarVideoDoCorte: async (id: string, a: { trecho?: unknown }) => void pedidos.push({ tipo: 'POST', id, corpo: a.trecho }),
    });
    const arquivo = { sha256: 'c'.repeat(64), abrir: () => Readable.from([Buffer.from('x')]) };
    const corpo = { arquivo: '/x/corte.mp4', bytes: 10 };

    expect(await subirCorteAoOs(osFalso(), { id: 'p1', inicio: 35, fim: 57.9 }, corpo, arquivo)).toMatchObject({ subiu: true });
    expect(pedidos).toEqual([
      { tipo: 'PUT', id: 'p1', corpo: { arquivo: '/x/corte.mp4', bytes: 10, inicio: 35, fim: 57.9 } },
      { tipo: 'POST', id: 'p1', corpo: { inicio: 35, fim: 57.9 } },
    ]);
    pedidos.length = 0;
    expect(await subirCorteAoOs(osFalso(true), { id: 'p2', inicio: 35, fim: 57.9 }, corpo, arquivo)).toMatchObject({ subiu: false, motivo: /HTTP 409/ });
    expect(pedidos.map((x) => x.tipo)).toEqual(['PUT']);
    // Outro erro do registro segue parando o comando, como antes.
    const quebrado = { ...osFalso(), videoDoCorte: async () => { throw new Error('PUT … → HTTP 400: duração'); } };
    await expect(subirCorteAoOs(quebrado, { id: 'p3', inicio: 1, fim: 20 }, corpo, arquivo)).rejects.toThrow(/HTTP 400/);

    expect(cabecalhoDoTrecho({ inicio: 35, fim: 57.9 })).toBe('35-57.9');
    expect(cabecalhoDoTrecho({ inicio: 20.40000000001, fim: 80.4 })).toBe('20.4-80.4');
    let cabecalhos: Record<string, string> = {};
    const fetchFalso = (async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/login')) return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      cabecalhos = init.headers as Record<string, string>;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const os = clienteDoOs({ url: 'http://os/api', email: 'a', senha: 'b', fetch: fetchFalso });
    await os.enviarVideoDoCorte('p1', { abrir: () => Readable.from([Buffer.from('x')]), bytes: 1, sha256: 'a'.repeat(64), trecho: { inicio: 35, fim: 57.9 } });
    expect(cabecalhos['X-Trecho-Do-Corte']).toBe('35-57.9');
    await os.enviarVideoDoCorte('p1', { abrir: () => Readable.from([Buffer.from('x')]), bytes: 1, sha256: 'a'.repeat(64) });
    expect(cabecalhos).not.toHaveProperty('X-Trecho-Do-Corte');
  });

  it('o envio que passa do prazo vira erro com o tempo, sem pendurar o corte seguinte', async () => {
    const fetchQueEstoura = (async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/login')) return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }) as unknown as typeof fetch;
    const os = clienteDoOs({ url: 'http://127.0.0.1:1/api', email: 'a', senha: 'b', fetch: fetchQueEstoura });
    await expect(os.enviarVideoDoCorte('p1', { abrir: () => Readable.from([Buffer.from('x')]), bytes: 1, sha256: 'a'.repeat(64) })).rejects.toThrow(/passou de 61 s sem resposta/);
  });

  it('o JPEG sobe no mesmo multipart do PNG, como image/jpeg', async () => {
    const pedidos: Array<{ url: string; arquivo: File }> = [];
    const fetchFalso = (async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/login')) return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      pedidos.push({ url, arquivo: (init.body as FormData).get('file') as File });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const os = clienteDoOs({ url: 'http://os/api', email: 'a', senha: 'b', fetch: fetchFalso });
    await os.enviarImagemDaPeca('p1', 2, jpegDeTeste(1080, 1350), 'slide-02.jpg', 'image/jpeg');
    expect(pedidos[0].url).toBe('http://os/api/pauta/pecas/p1/imagens/2');
    expect(pedidos[0].arquivo).toMatchObject({ type: 'image/jpeg', name: 'slide-02.jpg' });
  });

  it('na agenda do terminal, o mp4 que subiu aparece como no OS', () => {
    const linhas = linhasDaAgenda({
      dias: [
        {
          dia: '2026-09-29',
          diaDaSemana: 'ter',
          linhas: [
            {
              hora: '18:00',
              formato: 'corte',
              daGrade: true,
              peca: { apelido: 'ep-04', itemN: 1, titulo: 'Preço', status: 'aprovada', postada: null, agendadaPara: 'x', midia: { onde: 'video', arquivo: '/m/c.mp4', bytes: 40 * 1024 * 1024 } },
            },
          ],
        },
      ],
    });
    expect(linhas.join('\n')).toContain('mp4 no OS (40 MB; baixe na aba Semana) e no Mac: /m/c.mp4');
  });
});
