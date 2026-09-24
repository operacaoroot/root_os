#!/usr/bin/env node
// @ts-check
/*
 * root-midia — a estação de mídia do ROOT OS no Mac (MC9).
 *
 * A mídia pesada roda aqui e só o leve volta ao OS: onde estão os arquivos, a
 * duração, o que foi cortado e a transcrição com os tempos do vídeo final. O
 * vídeo FICA no Mac (o MinIO da VPS não é público; o YouTube é manual na V1).
 *
 * Node 22, sem dependência: fetch nativo e child_process chamando ffmpeg,
 * ffprobe e whisper-cli. Passo a passo e variáveis: SKILL.md e README.md.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { garantirPastaDaSaida, mesmoArquivo } from './lib/arquivos.mjs';
import {
  PADROES,
  codecDeVideo,
  conferirPlanoContraBruto,
  duracaoTotal,
  filtroDoCorte,
  lerManter,
  lerSilencedetect,
  listaDoConcat,
  planoDeCortes,
  podeCortarSemReencodar,
} from './lib/cortes.mjs';
import { segmentosDaTranscricao, segmentosDoWhisper, srtDosSegmentos } from './lib/whisper.mjs';
import {
  APOIO_PADRAO,
  argsDoChrome,
  argsDoFrame,
  candidatosDoChrome,
  conferirPng,
  nomeDaThumb,
  preencherThumb,
} from './lib/thumbs.mjs';
import {
  ALTURA_DO_SLIDE,
  ALTURA_VERTICAL,
  CANVAS_PADRAO,
  LARGURA_DO_SLIDE,
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
  lerRegiao,
  marcaDoCarrossel,
  nomeDoCorte,
  nomeDoStory,
  pastaDoCarrossel,
  preencherStory,
  regiaoDoPip,
  regiaoNoVideo,
  regioesPadraoNoCanvas,
  linhasDaAgenda,
  slidesEstourados,
  slidesParaAMaquina,
} from './lib/semana.mjs';
import {
  acharEpisodio,
  clienteDoOs,
  configuracao,
  corpoDaMidia,
  corpoDaTranscricao,
  corpoGrandeDemais,
  exigirOs,
  juntarVariaveis,
  lerArquivoDeVariaveis,
} from './lib/os.mjs';

const AJUDA = `root-midia — estação de mídia do ROOT OS (MC9)

  root-midia pendentes
      A fila do OS: episódios gravados (falta a mídia) e em edição (falta a transcrição),
      com a palavra de corte que vale para cada um.
  root-midia silencios <arquivo> [--ruido -35] [--minimo 0.8] [--saida s.json]
      ffmpeg silencedetect → intervalos de silêncio.
  root-midia cortes <arquivo> [--silencios s.json] [--transcricao t.json] [--palavra "root, corta"]
                    [--minimo 0.8] [--margem 0.2] [--saida cortes.json]
      A lista do que MANTER: tira os silêncios longos e, com a transcrição do bruto, as
      tomadas erradas (o segmento com a palavra de corte e o anterior).
  root-midia cortar <arquivo> <cortes.json> <saida> [--copiar | --reencodar] [--sobrescrever]
      Junta os trechos mantidos. Sem reencodar quando toda borda cai em quadro-chave;
      senão reencoda (preciso). --copiar força a cópia (bordas no quadro-chave mais próximo).
  root-midia transcrever <arquivo> [--idioma pt] [--saida t.json]
      whisper-cli com o modelo de WHISPER_MODEL → segmentos {inicio, fim, texto}; com --saida,
      grava também a legenda t.srt ao lado.
  root-midia enviar <ep-NN> [--final f.mp4] [--bruto b.mp4] [--cortes cortes.json]
                    [--transcricao t.json] [--editor ffmpeg|palmier|manual]
      Manda ao OS a mídia (o episódio vai para Edição) e a transcrição (vai para Pacote).
  root-midia ensaio [--manter]
      Gera um clipe sintético (tom + silêncio) numa pasta temporária e roda
      silencios → cortes → cortar, conferindo que o final saiu mais curto e sem silêncio.
  root-midia thumbs <ep-NN> [--final f.mp4] [--saida pasta] [--so 1|2|3] [--apoio "texto"] [--sem-enviar]
      Lê do OS os 3 briefs do pacote (MC11), tira o frame de cada um do vídeo final no tempo
      sugerido, renderiza o template da marca (thumb.html, 1280×720) num Chrome sem janela e
      sobe o PNG. --sem-enviar só grava os PNG na pasta.
  root-midia ensaio-thumb [--saida thumb.png] [--manter]
      Renderiza 1 thumb com um frame sintético, sem falar com o OS, e confere 1280×720 e 2 MB.

  A semana de posts (MC15) — as peças por matéria que o OS gerou:
  root-midia semana <ep-NN>
      As matérias do episódio e o estado das três peças de cada uma (carrossel, story, corte).
  root-midia carrosseis <ep-NN> [--saida pasta] [--so N] [--sem-enviar] [--forcar]
      Renderiza cada carrossel pela máquina de carrossel (plugin, 1080×1350, marca root) e sobe os PNG.
      Slide com texto estourado (o report.json do render) não sobe, salvo com --forcar.
  root-midia stories <ep-NN> [--final f.mp4] [--saida pasta] [--so N] [--sem-enviar]
      story.html 1080×1920 com o frame do episódio no começo do corte da matéria, e sobe o PNG.
  root-midia cortes <ep-NN> [<vídeo final>] [--pip x,y,l,a] [--tela x,y,l,a] [--canvas 1920x1080]
                    [--obs colecao.json] [--cena "2 · Tela + Câmera"] [--saida pasta] [--so N] [--sem-enviar]
      (também \`cortes-verticais\`) O trecho de cada corte em 1080×1920: a tela em cima e o rosto
      (o PiP do OBS) embaixo. O mp4 FICA no Mac; ao OS vai o caminho e o que foi medido.
  root-midia agenda [--de AAAA-MM-DD]
      O calendário da semana (MC16): cada slot com a peça, o estado e onde está a mídia para
      postar à mão (o PNG no OS, o mp4 no Mac pelo caminho). Só lê; postar é na aba Semana.
  root-midia ensaio-semana [--manter]
      Vídeo sintético 1920×1080 com um PiP colorido: 1 corte vertical e 1 story (e 1 carrossel, se a
      máquina de carrossel estiver instalada), conferindo 1080×1920, a duração e o rosto embaixo.

Variáveis: ROOT_OS_API_URL (padrão http://localhost:4001/api), ROOT_OS_EMAIL, ROOT_OS_SENHA,
WHISPER_MODEL (caminho do .bin ggml), ROOT_MIDIA_PALAVRA (padrão "root, corta"),
ROOT_MIDIA_CHROME (o Chrome do render, quando não é o de /Applications), ROOT_MIDIA_PIP e
ROOT_MIDIA_TELA (x,y,l,a no canvas), ROOT_MIDIA_OBS_COLECAO (o JSON da coleção do OBS),
ROOT_MIDIA_CARROSSEL_RENDER (o render.mjs da máquina de carrossel) e ROOT_MIDIA_MARCA (o brand.json).
Lidas do ambiente e do arquivo ~/.config/root/root-midia.env (ou o de ROOT_MIDIA_ENV); o ambiente vence.`;

/** O ambiente mais o arquivo de variáveis do Mac, sem sobrescrever o que já foi exportado. */
function ambiente() {
  const caminho = process.env.ROOT_MIDIA_ENV?.trim() || join(homedir(), '.config', 'root', 'root-midia.env');
  if (!existsSync(caminho)) {
    if (process.env.ROOT_MIDIA_ENV?.trim()) throw new Error(`ROOT_MIDIA_ENV aponta para ${caminho}, que não existe.`);
    return process.env;
  }
  return juntarVariaveis(process.env, lerArquivoDeVariaveis(readFileSync(caminho, 'utf8')));
}

const BOOLEANAS = new Set(['copiar', 'reencodar', 'sobrescrever', 'manter', 'ajuda', 'sem-enviar', 'forcar']);

/** @param {string[]} argv */
function lerArgumentos(argv) {
  /** @type {string[]} */
  const posicionais = [];
  /** @type {Record<string, string | true>} */
  const opcoes = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') opcoes.ajuda = true;
    else if (a.startsWith('--')) {
      const [nome, valor] = a.slice(2).split(/=(.*)/s, 2);
      if (valor !== undefined) opcoes[nome] = valor;
      else if (BOOLEANAS.has(nome)) opcoes[nome] = true;
      else if (i + 1 < argv.length) opcoes[nome] = argv[++i];
      else throw new Error(`--${nome} precisa de um valor.`);
    } else posicionais.push(a);
  }
  return { posicionais, opcoes };
}

/** @param {Record<string, string | true>} o @param {string} nome */
function texto(o, nome) {
  const v = o[nome];
  return typeof v === 'string' ? v : undefined;
}

/** @param {Record<string, string | true>} o @param {string} nome @param {number} padrao */
function numero(o, nome, padrao) {
  const v = texto(o, nome);
  if (v === undefined) return padrao;
  const n = Number(v.replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`--${nome} precisa ser número (veio "${v}").`);
  return n;
}

/** @param {string} msg */
function avisar(msg) {
  process.stderr.write(`${msg}\n`);
}

/** Acha o binário no PATH ou no Homebrew; faltar é mensagem, não instalação. @param {string} nome */
function binario(nome) {
  const pastas = [...(process.env.PATH ?? '').split(delimiter), '/opt/homebrew/bin', '/usr/local/bin'];
  for (const p of pastas) {
    if (p && existsSync(join(p, nome))) return join(p, nome);
  }
  throw new Error(`Não achei \`${nome}\` no PATH nem em /opt/homebrew/bin. Instalar é decisão sua (brew).`);
}

/**
 * @param {string} bin
 * @param {string[]} args
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function rodar(bin, args) {
  return new Promise((ok, falha) => {
    const filho = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    filho.stdout.on('data', (d) => (stdout += d));
    filho.stderr.on('data', (d) => (stderr += d));
    filho.on('error', falha);
    filho.on('close', (codigo) => {
      if (codigo === 0) ok({ stdout, stderr });
      else falha(new Error(`${basename(bin)} saiu com código ${codigo}:\n${stderr.split('\n').slice(-15).join('\n')}`));
    });
  });
}

/**
 * O Chrome sem janela grava o PNG e, no Mac, pode ficar de pé por minutos
 * depois disso. Espera o arquivo (o aviso "bytes written" ou o tamanho
 * parado), encerra o processo e segue; passar do prazo é erro.
 * @param {string} bin @param {string[]} args @param {string} arquivo @param {number} [prazoMs]
 */
function rodarAteGravar(bin, args, arquivo, prazoMs = 60_000) {
  return new Promise((ok, falha) => {
    const filho = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    let tamanho = -1;
    let fim = false;
    const acabar = (/** @type {Error | null} */ erro) => {
      if (fim) return;
      fim = true;
      clearInterval(relogio);
      clearTimeout(prazo);
      const devolver = () => (erro ? falha(erro) : ok(undefined));
      if (filho.exitCode !== null || filho.signalCode !== null) return devolver();
      // Só devolve com o processo morto: ele ainda escreve no perfil temporário
      // que a chamada apaga em seguida.
      const forca = setTimeout(() => filho.kill('SIGKILL'), 3000);
      filho.once('close', () => {
        clearTimeout(forca);
        devolver();
      });
      filho.kill('SIGTERM');
    };
    const pronto = () => {
      if (!existsSync(arquivo)) return false;
      const agora = statSync(arquivo).size;
      const parado = agora > 0 && agora === tamanho;
      tamanho = agora;
      return parado || (agora > 0 && /bytes written to file/.test(saida));
    };
    filho.stdout.on('data', (d) => (saida += d));
    filho.stderr.on('data', (d) => (saida += d));
    filho.on('error', (e) => acabar(e));
    filho.on('close', (codigo) => {
      if (fim) return;
      if (existsSync(arquivo) && statSync(arquivo).size > 0) acabar(null);
      else acabar(new Error(`${basename(bin)} saiu com código ${codigo} sem gravar ${basename(arquivo)}:\n${saida.split('\n').slice(-10).join('\n')}`));
    });
    const relogio = setInterval(() => pronto() && acabar(null), 250);
    const prazo = setTimeout(
      () => acabar(new Error(`${basename(bin)} não gravou ${basename(arquivo)} em ${Math.round(prazoMs / 1000)} s.`)),
      prazoMs,
    );
  });
}

/** @param {string} arquivo */
function exigirArquivo(arquivo) {
  if (!arquivo) throw new Error('Falta o arquivo.');
  const caminho = resolve(arquivo);
  if (!existsSync(caminho)) throw new Error(`Arquivo não encontrado: ${caminho}`);
  return caminho;
}

/** @param {string} caminho */
function lerJson(caminho) {
  try {
    return JSON.parse(readFileSync(exigirArquivo(caminho), 'utf8'));
  } catch (e) {
    throw new Error(`Não consegui ler o JSON ${caminho}: ${/** @type {Error} */ (e).message}`);
  }
}

/** @param {unknown} valor @param {string | undefined} saida */
function escrever(valor, saida) {
  const json = `${JSON.stringify(valor, null, 2)}\n`;
  if (saida) {
    writeFileSync(garantirPastaDaSaida(saida, avisar), json);
    avisar(`→ ${resolve(saida)}`);
  } else process.stdout.write(json);
}

/** @param {string} arquivo */
async function duracaoDe(arquivo) {
  const { stdout } = await rodar(binario('ffprobe'), [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', arquivo,
  ]);
  const d = Number(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`O ffprobe não mediu a duração de ${arquivo}.`);
  return d;
}

/** @param {string} arquivo */
async function fluxosDe(arquivo) {
  const { stdout } = await rodar(binario('ffprobe'), [
    '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', arquivo,
  ]);
  const tipos = stdout.split('\n').map((l) => l.trim());
  return { video: tipos.includes('video'), audio: tipos.includes('audio') };
}

/** Os quadros-chave pelos PACOTES (flag K), sem decodificar o vídeo. @param {string} arquivo */
async function quadrosChaveDe(arquivo) {
  const { stdout } = await rodar(binario('ffprobe'), [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', arquivo,
  ]);
  return stdout
    .split('\n')
    .map((l) => l.split(','))
    .filter(([t, flags]) => t && flags?.includes('K'))
    .map(([t]) => Number(t))
    .filter(Number.isFinite);
}

/** @param {string} arquivo @param {{ ruidoDb: number, minimoSeg: number }} o */
async function detectarSilencios(arquivo, { ruidoDb, minimoSeg }) {
  const duracaoSeg = await duracaoDe(arquivo);
  const { stderr } = await rodar(binario('ffmpeg'), [
    '-hide_banner', '-nostats', '-i', arquivo, '-vn', '-af', `silencedetect=noise=${ruidoDb}dB:d=${minimoSeg}`, '-f', 'null', '-',
  ]);
  return { arquivo, duracaoSeg, ruidoDb, minimoSeg, silencios: lerSilencedetect(stderr, duracaoSeg) };
}

/**
 * @param {string} arquivo @param {unknown} planoOuManter @param {string} saida
 * @param {{ modo: 'auto' | 'copiar' | 'reencodar', sobrescrever?: boolean }} o
 */
async function cortar(arquivo, planoOuManter, saida, { modo, sobrescrever = false }) {
  const manter = lerManter(planoOuManter);
  if (mesmoArquivo(saida, arquivo)) throw new Error('A saída não pode ser o próprio bruto (nem outro nome para ele).');
  if (existsSync(saida) && !sobrescrever) throw new Error(`${saida} já existe (use --sobrescrever).`);
  const duracao = await duracaoDe(arquivo);
  const plano = Array.isArray(planoOuManter) ? null : /** @type {{ arquivo?: unknown, duracaoBrutoSeg?: unknown }} */ (planoOuManter);
  const conferido = conferirPlanoContraBruto(plano, manter, { arquivo, duracao });
  if (conferido.erro) throw new Error(conferido.erro);
  conferido.avisos.forEach(avisar);
  const fluxos = await fluxosDe(arquivo);
  const ffmpeg = binario('ffmpeg');
  const inteiro = manter.length === 1 && manter[0].inicio <= 0.001 && manter[0].fim >= duracao - 0.001;

  let copiar = modo === 'copiar' || inteiro;
  if (modo === 'auto' && !inteiro && fluxos.video) {
    copiar = podeCortarSemReencodar(manter, await quadrosChaveDe(arquivo), { duracao });
  } else if (modo === 'auto' && !fluxos.video) copiar = false;

  const pasta = mkdtempSync(join(tmpdir(), 'root-midia-'));
  try {
    const base = ['-hide_banner', '-loglevel', 'error', sobrescrever ? '-y' : '-n'];
    if (copiar && inteiro) {
      avisar('Nada a cortar: cópia do arquivo, sem reencodar.');
      await rodar(ffmpeg, [...base, '-i', arquivo, '-map', '0', '-c', 'copy', saida]);
    } else if (copiar) {
      if (modo === 'copiar') avisar('Cópia forçada: as bordas caem no quadro-chave mais próximo, não no tempo exato.');
      else avisar('Toda borda cai em quadro-chave: corte sem reencodar.');
      const lista = join(pasta, 'lista.ffconcat');
      writeFileSync(lista, listaDoConcat(arquivo, manter));
      await rodar(ffmpeg, [...base, '-f', 'concat', '-safe', '0', '-i', lista, '-map', '0', '-c', 'copy', saida]);
    } else {
      avisar(`Reencodando ${manter.length} trecho(s) — o corte fica no tempo exato.`);
      const { filtro, mapas } = filtroDoCorte(manter, fluxos);
      const arquivoDoFiltro = join(pasta, 'filtro.txt');
      writeFileSync(arquivoDoFiltro, filtro);
      const { stdout: encoders } = await rodar(ffmpeg, ['-hide_banner', '-encoders']);
      await rodar(ffmpeg, [
        ...base, '-i', arquivo, '-/filter_complex', arquivoDoFiltro, ...mapas,
        ...(fluxos.video ? codecDeVideo(encoders) : []),
        ...(fluxos.audio ? ['-c:a', 'aac', '-b:a', '192k'] : []),
        '-movflags', '+faststart', saida,
      ]);
    }
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
  const final = await duracaoDe(saida);
  return { duracaoBrutoSeg: duracao, duracaoFinalSeg: final, esperadoSeg: duracaoTotal(manter), copiado: copiar };
}

/** @param {string} arquivo @param {{ idioma: string, modelo: string }} o */
async function transcrever(arquivo, { idioma, modelo }) {
  if (!modelo || !existsSync(modelo)) {
    const erro = new Error(
      (modelo ? `WHISPER_MODEL aponta para ${modelo}, que não existe.` : 'WHISPER_MODEL não está definido.') +
        '\nFalta o modelo do whisper — baixar é decisão sua (D-MC3), a ferramenta não baixa nada.' +
        '\nO que fazer: baixe um modelo ggml multilíngue (ex.: ggml-large-v3-turbo.bin, ~1,6 GB, ou' +
        ' ggml-small.bin, ~470 MB — o SKILL.md diz onde), guarde fora do repositório e rode com' +
        ' WHISPER_MODEL=/caminho/do/modelo.bin.',
    );
    /** @type {Error & { codigo?: number }} */ (erro).codigo = 2;
    throw erro;
  }
  const whisper = binario('whisper-cli');
  const pasta = mkdtempSync(join(tmpdir(), 'root-midia-'));
  try {
    const wav = join(pasta, 'audio.wav');
    // O whisper-cli lê WAV 16 kHz mono; o .mp4 do OBS não entra direto.
    await rodar(binario('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-i', arquivo, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
    const prefixo = join(pasta, 'transcricao');
    avisar(`Transcrevendo com ${basename(modelo)} (${idioma})…`);
    await rodar(whisper, ['-m', modelo, '-f', wav, '-l', idioma, '-oj', '-of', prefixo, '-np']);
    const segmentos = segmentosDoWhisper(JSON.parse(readFileSync(`${prefixo}.json`, 'utf8')));
    return { arquivo, duracaoSeg: await duracaoDe(arquivo), idioma, modelo: basename(modelo), segmentos };
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

/** @param {string} ep @param {Record<string, string | true>} o */
async function enviar(ep, o) {
  const cfg = configuracao(ambiente());
  exigirOs(cfg);
  const os = clienteDoOs(cfg);
  const fila = await os.pendentes();
  /** @type {Array<{ id: string, numero: number, apelido: string, titulo: string, status: string, falta: string }>} */
  const itens = fila?.items ?? [];
  const alvo = acharEpisodio(itens, ep);
  avisar(`${alvo.apelido} — ${alvo.titulo} (${alvo.status}; falta ${alvo.falta})`);

  const final = texto(o, 'final');
  const caminhoTranscricao = texto(o, 'transcricao');
  if (!final && alvo.falta === 'midia') throw new Error(`O ${alvo.apelido} ainda não tem mídia no OS: passe --final <vídeo final>.`);
  if (!final && !caminhoTranscricao) throw new Error('Nada a enviar: passe --final e/ou --transcricao.');

  // Os dois corpos saem prontos ANTES do primeiro POST: um erro na transcrição
  // depois da mídia deixaria o episódio em Edição com a transcrição anterior descartada.
  let corpoTranscricao = null;
  if (caminhoTranscricao) {
    corpoTranscricao = corpoDaTranscricao(lerJson(caminhoTranscricao));
    const grande = corpoGrandeDemais(corpoTranscricao);
    if (grande) throw new Error(grande);
  }
  let corpoMidia = null;
  if (final) {
    const arquivoFinal = exigirArquivo(final);
    const plano = texto(o, 'cortes') ? lerJson(/** @type {string} */ (texto(o, 'cortes'))) : null;
    const bruto = texto(o, 'bruto') ?? plano?.arquivo;
    const arquivoBruto = bruto ? exigirArquivo(bruto) : arquivoFinal;
    const editor = /** @type {'palmier' | 'ffmpeg' | 'manual'} */ (texto(o, 'editor') ?? 'ffmpeg');
    const duracaoSeg = await duracaoDe(arquivoFinal);
    corpoMidia = corpoDaMidia({
      arquivoBruto,
      arquivoFinal,
      duracaoSeg,
      duracaoBrutoSeg: plano?.duracaoBrutoSeg ?? (arquivoBruto !== arquivoFinal ? await duracaoDe(arquivoBruto) : undefined),
      plano,
      editor,
    });
    if (plano) {
      const esperado = duracaoTotal(lerManter(plano));
      if (Math.abs(esperado - duracaoSeg) > 1) {
        avisar(
          `AVISO: o final tem ${duracaoSeg.toFixed(1)} s e o \`manter\` do cortes.json soma ${esperado.toFixed(1)} s. ` +
            'Os cortes enviados saem do `manter`: se a edição tirou ou devolveu trechos fora dele, ajuste o `manter` e envie de novo.',
        );
      }
      const manuais = corpoMidia.cortes.filter((c) => c.motivo === 'manual').length;
      if (manuais) avisar(`${manuais} corte(s) fora do plano automático vão como \`manual\`.`);
    }
  }

  let resposta = null;
  if (corpoMidia) {
    resposta = await os.midia(alvo.id, corpoMidia);
    avisar(`Mídia registrada: ${alvo.apelido} em ${resposta.status} (${corpoMidia.cortes.length} corte(s), ${corpoMidia.duracaoSeg} s).`);
  }
  if (corpoTranscricao) {
    resposta = await os.transcricao(alvo.id, corpoTranscricao);
    avisar(`Transcrição registrada: ${alvo.apelido} em ${resposta.status} (${corpoTranscricao.segmentos.length} segmento(s)).`);
  }
  return { id: alvo.id, apelido: alvo.apelido, status: resposta?.status ?? alvo.status };
}

/** Clipe sintético: tom 0–3 s, silêncio 3–6 s, tom 6–9 s, silêncio 9–12 s, tom 12–15 s. */
async function ensaio({ manter = false }) {
  const pasta = mkdtempSync(join(tmpdir(), 'root-midia-ensaio-'));
  const ffmpeg = binario('ffmpeg');
  try {
    const clipe = join(pasta, 'bruto.mp4');
    await rodar(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=15',
      '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,6),3),0.5*sin(2*PI*440*t),0)':s=48000:d=15",
      '-c:v', 'libx264', '-g', '60', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clipe,
    ]);
    const s = await detectarSilencios(clipe, { ruidoDb: PADROES.ruidoDb, minimoSeg: PADROES.minimoSeg });
    const plano = planoDeCortes({ duracao: s.duracaoSeg, silencios: s.silencios });
    const cortesJson = join(pasta, 'cortes.json');
    writeFileSync(cortesJson, JSON.stringify({ arquivo: clipe, ...plano }, null, 2));
    const final = join(pasta, 'final.mp4');
    const r = await cortar(clipe, lerJson(cortesJson), final, { modo: 'auto' });
    const depois = await detectarSilencios(final, { ruidoDb: PADROES.ruidoDb, minimoSeg: PADROES.minimoSeg });
    const relatorio = {
      pasta,
      bruto: { duracaoSeg: s.duracaoSeg, silencios: s.silencios },
      manter: plano.manter,
      final: { duracaoSeg: r.duracaoFinalSeg, esperadoSeg: r.esperadoSeg, silenciosLongos: depois.silencios, copiado: r.copiado },
    };
    const ok =
      s.silencios.length === 2 &&
      r.duracaoFinalSeg < s.duracaoSeg - 4 &&
      Math.abs(r.duracaoFinalSeg - r.esperadoSeg) < 0.2 &&
      depois.silencios.length === 0;
    escrever({ ok, ...relatorio }, undefined);
    avisar(ok ? 'ENSAIO OK: o final saiu mais curto e sem silêncio longo.' : 'ENSAIO FALHOU: veja o relatório acima.');
    return ok;
  } finally {
    if (!manter) rmSync(pasta, { recursive: true, force: true });
  }
}

/** O Chrome do render: o apontado, o instalado ou o que o agent-browser baixou. */
function acharChrome() {
  const pasta = join(homedir(), '.agent-browser', 'browsers');
  let doAgentBrowser = [];
  try {
    doAgentBrowser = readdirSync(pasta).filter((n) => n.startsWith('chrome-')).map((n) => join(pasta, n));
  } catch {
    /* sem agent-browser: segue com os outros */
  }
  return candidatosDoChrome(ambiente(), doAgentBrowser).find((c) => existsSync(c)) ?? null;
}

/**
 * Sem Chrome, o agent-browser (se houver) abre o HTML num navegador próprio,
 * numa sessão só desta ferramenta, e tira a foto — depois da rede parar e das
 * fontes do Google carregarem, para o texto não sair na fonte de reserva.
 * @param {string} html @param {string} png @param {number} [largura] @param {number} [altura]
 */
async function renderizarComAgentBrowser(html, png, largura = 1280, altura = 720) {
  const ab = binario('agent-browser');
  const sessao = ['--session', `root-midia-thumb-${process.pid}`];
  try {
    await rodar(ab, [...sessao, 'set', 'viewport', String(largura), String(altura)]);
    await rodar(ab, [...sessao, 'open', `file://${html}`]);
    await rodar(ab, [...sessao, 'wait', '--load', 'networkidle']);
    await rodar(ab, [...sessao, 'wait', '--fn', "document.fonts.status === 'loaded'"]);
    await rodar(ab, [...sessao, 'screenshot', png]);
  } finally {
    await rodar(ab, [...sessao, 'close']).catch(() => undefined);
  }
}

/**
 * Uma thumb: o frame do vídeo no tempo do brief, o template preenchido e a
 * foto do Chrome. Devolve o PNG conferido (1280×720, até 2 MB).
 * @param {{ video: string, tempoSeg: number, texto: string, destaque: string, apelido: string, apoio?: string, saida: string }} o
 */
async function renderizarThumb(o) {
  const template = readFileSync(fileURLToPath(new URL('./thumb.html', import.meta.url)), 'utf8');
  const pasta = mkdtempSync(join(tmpdir(), 'root-midia-thumb-'));
  try {
    await rodar(binario('ffmpeg'), argsDoFrame(o.video, o.tempoSeg, join(pasta, 'frame.jpg')));
    const html = join(pasta, 'thumb.html');
    writeFileSync(html, preencherThumb(template, { texto: o.texto, destaque: o.destaque, apoio: o.apoio, apelido: o.apelido, frame: 'frame.jpg' }));
    const png = join(pasta, 'thumb.png');
    const chrome = acharChrome();
    if (chrome) await rodarAteGravar(chrome, argsDoChrome({ html, png, perfil: join(pasta, 'perfil') }), png);
    else await renderizarComAgentBrowser(html, png);
    if (!existsSync(png)) throw new Error('O navegador não gravou o PNG da thumb.');
    const buffer = readFileSync(png);
    const erro = conferirPng(buffer);
    if (erro) throw new Error(erro);
    writeFileSync(o.saida, buffer);
    return buffer;
  } finally {
    rmSync(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/** @param {string} ep @param {Record<string, string | true>} o */
async function thumbs(ep, o) {
  const cfg = configuracao(ambiente());
  exigirOs(cfg);
  const os = clienteDoOs(cfg);
  const lista = await os.episodios();
  const alvo = acharEpisodio(lista?.items ?? [], ep, { lista: true });
  /** @type {{ status: string, arquivoFinal: string | null, thumbs: Array<{ n: number, texto: string, destaque: string, tempoSeg: number, tempo: string }> }} */
  const pacote = await os.thumbs(alvo.id);
  if (!pacote.thumbs?.length) throw new Error(`O ${alvo.apelido} ainda não tem os briefs das thumbs: gere o pacote na tela (aba Episódios).`);
  if (o['sem-enviar'] !== true && (pacote.status === 'agendado' || pacote.status === 'concluido')) {
    throw new Error(`O ${alvo.apelido} já foi agendado: o pacote é o registro do que subiu e a thumb não muda mais (com --sem-enviar, só renderiza).`);
  }
  const final = texto(o, 'final') ?? pacote.arquivoFinal;
  if (!final) throw new Error(`O ${alvo.apelido} não tem o vídeo final registrado: passe --final <vídeo final>.`);
  const video = exigirArquivo(final);
  const pasta = resolve(texto(o, 'saida') ?? join(dirname(video), `${alvo.apelido}-thumbs`));
  mkdirSync(pasta, { recursive: true });
  const so = texto(o, 'so') ? numero(o, 'so', 0) : null;
  const escolhidas = pacote.thumbs.filter((t) => so === null || t.n === so);
  if (!escolhidas.length) throw new Error(`Não há a thumb ${so}: o pacote tem ${pacote.thumbs.map((t) => t.n).join(', ')}.`);

  const feitas = [];
  for (const t of escolhidas) {
    const saida = join(pasta, nomeDaThumb(alvo.apelido, t.n));
    avisar(`Thumb ${t.n}: "${t.texto}" (destaque "${t.destaque}", frame em ${t.tempo})…`);
    const png = await renderizarThumb({ video, tempoSeg: t.tempoSeg, texto: t.texto, destaque: t.destaque, apelido: alvo.apelido, apoio: texto(o, 'apoio'), saida });
    avisar(`→ ${saida} (${Math.round(png.length / 1024)} kB)`);
    if (o['sem-enviar'] !== true) {
      await os.enviarThumb(alvo.id, t.n, png, basename(saida));
      avisar(`Thumb ${t.n} enviada ao OS.`);
    }
    feitas.push({ n: t.n, arquivo: saida, bytes: png.length, enviada: o['sem-enviar'] !== true });
  }
  return { id: alvo.id, apelido: alvo.apelido, pasta, thumbs: feitas };
}

/** Uma thumb com frame sintético: prova o ffmpeg, o template e o Chrome sem tocar no OS. */
async function ensaioThumb({ saida, manter = false }) {
  const pasta = mkdtempSync(join(tmpdir(), 'root-midia-ensaio-thumb-'));
  try {
    const clipe = join(pasta, 'final.mp4');
    await rodar(binario('ffmpeg'), [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipe,
    ]);
    // Fora da pasta temporária, que é apagada no fim: o caminho mostrado continua valendo.
    const destino = resolve(saida ?? join(tmpdir(), `root-midia-ensaio-${nomeDaThumb('ep-00', 1)}`));
    const png = await renderizarThumb({
      video: clipe,
      tempoSeg: 2,
      texto: 'Preço da IA caiu',
      destaque: 'caiu',
      apelido: 'ep-00',
      apoio: APOIO_PADRAO,
      saida: destino,
    });
    const ok = conferirPng(png) === null;
    escrever({ ok, png: destino, bytes: png.length, pasta: manter ? pasta : null }, undefined);
    avisar(ok ? 'ENSAIO OK: a thumb saiu 1280×720 e abaixo de 2 MB.' : 'ENSAIO FALHOU.');
    return ok;
  } finally {
    if (!manter) rmSync(pasta, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// A semana de posts (MC15)
// ---------------------------------------------------------------------------

/** Largura e altura do primeiro fluxo de vídeo. @param {string} arquivo */
async function dimensoesDe(arquivo) {
  const { stdout } = await rodar(binario('ffprobe'), [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', arquivo,
  ]);
  const [largura, altura] = stdout.trim().split('x').map(Number);
  if (!largura || !altura) throw new Error(`O ffprobe não mediu o tamanho de ${arquivo}.`);
  return { largura, altura };
}

/**
 * O episódio e a semana dele no OS.
 * @param {string} ep
 * @returns {Promise<{ os: ReturnType<typeof clienteDoOs>, alvo: { id: string, apelido: string }, semana: any }>}
 */
async function semanaDoOs(ep) {
  const cfg = configuracao(ambiente());
  exigirOs(cfg);
  const os = clienteDoOs(cfg);
  const lista = await os.episodios();
  const alvo = acharEpisodio(lista?.items ?? [], ep, { lista: true });
  const semana = await os.semana(alvo.id);
  return { os, alvo, semana };
}

/**
 * As matérias pedidas (`--so N`) que têm a peça do formato e aceitam render.
 * @param {any} semana @param {'carrossel' | 'story' | 'corte'} formato @param {Record<string, string | true>} o
 */
function pecasParaRender(semana, formato, o) {
  const so = texto(o, 'so') ? numero(o, 'so', 0) : null;
  /** @type {Array<{ n: number, titulo: string, peca: any, corte: any }>} */
  const lista = [];
  for (const m of semana.materias ?? []) {
    if (so !== null && m.n !== so) continue;
    const p = m.pecas?.[formato];
    if (!p) {
      avisar(`Matéria ${m.n}: sem ${formato} — gere a semana na tela (aba Episódios).`);
      continue;
    }
    if (p.transcricaoMudou === true) {
      avisar(`Matéria ${m.n}: o ${formato} é da transcrição anterior (a mídia foi refeita) — gere a semana de novo na tela antes de renderizar.`);
      continue;
    }
    if (!aceitaRender(p)) {
      avisar(`Matéria ${m.n}: o ${formato} está ${p.status} e não recebe render.`);
      continue;
    }
    lista.push({ n: m.n, titulo: m.titulo, peca: p, corte: m.pecas?.corte ?? null });
  }
  if (so !== null && !lista.length) throw new Error(`A matéria ${so} não tem ${formato} para renderizar.`);
  return lista;
}

/** A pasta dos renders da semana: ao lado do vídeo final, ou a pedida. @param {Record<string, string | true>} o @param {string | null} final @param {string} apelido */
function pastaDaSemana(o, final, apelido) {
  const base = texto(o, 'saida') ?? (final ? join(dirname(final), `${apelido}-semana`) : join(process.cwd(), `${apelido}-semana`));
  const pasta = resolve(base);
  mkdirSync(pasta, { recursive: true });
  return pasta;
}

/**
 * Onde está a câmera e a tela no canvas: argumento > variável > o JSON da
 * coleção do OBS (só leitura) > o padrão medido em 24/09/2026.
 * @param {Record<string, string | true>} o
 */
function regioesDoCorte(o) {
  const env = ambiente();
  const canvasTexto = texto(o, 'canvas');
  const canvas = canvasTexto
    ? (() => {
        const [largura, altura] = canvasTexto.split(/[x×,]/).map(Number);
        if (!Number.isInteger(largura) || !Number.isInteger(altura)) throw new Error(`--canvas é LxA (ex.: 1920x1080), veio "${canvasTexto}".`);
        return { largura, altura };
      })()
    : CANVAS_PADRAO;
  // Sem --tela, a tela é o canvas pedido inteiro, e o PiP medido escala com ele.
  const padrao = regioesPadraoNoCanvas(canvas);
  const tela = texto(o, 'tela') ? lerRegiao(/** @type {string} */ (texto(o, 'tela'))) : env.ROOT_MIDIA_TELA ? lerRegiao(env.ROOT_MIDIA_TELA) : padrao.tela;
  if (texto(o, 'pip')) return { canvas, tela, pip: lerRegiao(/** @type {string} */ (texto(o, 'pip'))), origem: '--pip' };
  if (env.ROOT_MIDIA_PIP?.trim()) return { canvas, tela, pip: lerRegiao(env.ROOT_MIDIA_PIP), origem: 'ROOT_MIDIA_PIP' };
  const colecao = texto(o, 'obs') ?? env.ROOT_MIDIA_OBS_COLECAO?.trim() ?? join(homedir(), 'Library', 'Application Support', 'obs-studio', 'basic', 'scenes', 'Gravação.json');
  if (existsSync(colecao)) {
    try {
      const pip = regiaoDoPip(JSON.parse(readFileSync(colecao, 'utf8')), { cena: texto(o, 'cena'), canvas });
      return { canvas, tela, pip, origem: `OBS (${basename(colecao)})` };
    } catch (e) {
      if (texto(o, 'obs')) throw e;
      avisar(`Não li o PiP do OBS (${/** @type {Error} */ (e).message}); sigo com o padrão.`);
    }
  }
  const escalado = canvas.largura !== CANVAS_PADRAO.largura || canvas.altura !== CANVAS_PADRAO.altura;
  return {
    canvas,
    tela,
    pip: padrao.pip,
    origem: escalado
      ? `padrão medido em 1920×1080, escalado para ${canvas.largura}×${canvas.altura} (confira com --pip)`
      : 'padrão (medido no OBS em 24/09/2026)',
  };
}

/**
 * Um corte vertical: o trecho reencodado em 1080×1920, a tela em cima e o
 * rosto embaixo, conferido pelo ffprobe (tamanho e duração).
 * @param {{ video: string, inicio: number, fim: number, saida: string, regioes: ReturnType<typeof regioesDoCorte> }} o
 */
async function renderizarCorte({ video, inicio, fim, saida, regioes }) {
  if (mesmoArquivo(saida, video)) throw new Error('A saída do corte não pode ser o próprio vídeo final.');
  const dims = await dimensoesDe(video);
  const fluxos = await fluxosDe(video);
  const rosto = regiaoNoVideo(regioes.pip, regioes.canvas, dims);
  const tela = regiaoNoVideo(regioes.tela, regioes.canvas, dims);
  const ffmpeg = binario('ffmpeg');
  const { stdout: encoders } = await rodar(ffmpeg, ['-hide_banner', '-encoders']);
  await rodar(
    ffmpeg,
    argsDoCorteVertical({
      video,
      saida,
      inicio,
      fim,
      filtro: filtroDoCorteVertical({ tela, rosto }),
      audio: fluxos.audio,
      codec: codecDeVideo(encoders),
      sobrescrever: true,
    }),
  );
  const saiu = await dimensoesDe(saida);
  const duracaoSeg = await duracaoDe(saida);
  if (saiu.largura !== LARGURA_VERTICAL || saiu.altura !== ALTURA_VERTICAL) {
    throw new Error(`O corte saiu ${saiu.largura}×${saiu.altura}; era para ser ${LARGURA_VERTICAL}×${ALTURA_VERTICAL}.`);
  }
  if (Math.abs(duracaoSeg - (fim - inicio)) > 0.5) {
    throw new Error(`O corte saiu com ${duracaoSeg.toFixed(2)} s; o trecho é de ${(fim - inicio).toFixed(2)} s.`);
  }
  return { arquivo: saida, duracaoSeg: Math.round(duracaoSeg * 1000) / 1000, largura: saiu.largura, altura: saiu.altura, bytes: statSync(saida).size, rosto, tela };
}

/** @param {string} ep @param {string | undefined} finalArg @param {Record<string, string | true>} o */
async function cortesVerticais(ep, finalArg, o) {
  const { os, alvo, semana } = await semanaDoOs(ep);
  const final = finalArg ?? texto(o, 'final') ?? semana.arquivoFinal;
  if (!final) throw new Error(`O ${alvo.apelido} não tem o vídeo final registrado: passe o arquivo (root-midia cortes ${alvo.apelido} <final.mp4>).`);
  const video = exigirArquivo(final);
  const regioes = regioesDoCorte(o);
  avisar(`Rosto em ${regioes.pip.largura}×${regioes.pip.altura} a partir de (${regioes.pip.x}, ${regioes.pip.y}) — ${regioes.origem}.`);
  const pasta = pastaDaSemana(o, video, alvo.apelido);
  const feitas = [];
  for (const { n, peca } of pecasParaRender(semana, 'corte', o)) {
    if (typeof peca.inicio !== 'number' || typeof peca.fim !== 'number') {
      avisar(`Matéria ${n}: o corte não tem trecho — gere a semana de novo.`);
      continue;
    }
    const saida = join(pasta, nomeDoCorte(alvo.apelido, n));
    avisar(`Corte da matéria ${n}: ${peca.inicio.toFixed(1)}–${peca.fim.toFixed(1)} s…`);
    const r = await renderizarCorte({ video, inicio: peca.inicio, fim: peca.fim, saida, regioes });
    avisar(`→ ${saida} (${r.duracaoSeg.toFixed(1)} s, ${Math.round(r.bytes / 1024)} kB)`);
    const corpo = { arquivo: r.arquivo, duracaoSeg: r.duracaoSeg, largura: r.largura, altura: r.altura, bytes: r.bytes };
    if (o['sem-enviar'] !== true) {
      await os.videoDoCorte(peca.id, corpo);
      avisar(`Corte da matéria ${n} registrado no OS (o mp4 fica no Mac).`);
    }
    feitas.push({ n, ...corpo, enviado: o['sem-enviar'] !== true });
  }
  return { id: alvo.id, apelido: alvo.apelido, pasta, pip: regioes.pip, cortes: feitas };
}

/**
 * Um story: o frame do episódio no tempo pedido, o template preenchido e a
 * foto do Chrome em 1080×1920, conferida.
 * @param {{ video: string, tempoSeg: number, texto: string, chamada: string, apelido: string, saida: string }} o
 */
async function renderizarStory(o) {
  const template = readFileSync(fileURLToPath(new URL('./story.html', import.meta.url)), 'utf8');
  const pasta = mkdtempSync(join(tmpdir(), 'root-midia-story-'));
  try {
    await rodar(binario('ffmpeg'), argsDoFrameDoStory(o.video, o.tempoSeg, join(pasta, 'frame.jpg')));
    const html = join(pasta, 'story.html');
    writeFileSync(html, preencherStory(template, { texto: o.texto, chamada: o.chamada, apelido: o.apelido, frame: 'frame.jpg' }));
    const png = join(pasta, 'story.png');
    const chrome = acharChrome();
    if (chrome) {
      await rodarAteGravar(chrome, argsDoChromeNoTamanho({ html, png, perfil: join(pasta, 'perfil'), largura: LARGURA_VERTICAL, altura: ALTURA_VERTICAL }), png);
    } else await renderizarComAgentBrowser(html, png, LARGURA_VERTICAL, ALTURA_VERTICAL);
    if (!existsSync(png)) throw new Error('O navegador não gravou o PNG do story.');
    const buffer = readFileSync(png);
    const erro = conferirPngNoTamanho(buffer, LARGURA_VERTICAL, ALTURA_VERTICAL);
    if (erro) throw new Error(erro);
    writeFileSync(o.saida, buffer);
    return buffer;
  } finally {
    rmSync(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/** @param {string} ep @param {Record<string, string | true>} o */
async function stories(ep, o) {
  const { os, alvo, semana } = await semanaDoOs(ep);
  const final = texto(o, 'final') ?? semana.arquivoFinal;
  if (!final) throw new Error(`O ${alvo.apelido} não tem o vídeo final registrado: passe --final <vídeo final>.`);
  const video = exigirArquivo(final);
  const duracao = await duracaoDe(video);
  const pasta = pastaDaSemana(o, video, alvo.apelido);
  const feitas = [];
  for (const { n, peca, corte } of pecasParaRender(semana, 'story', o)) {
    // O começo do corte da matéria como está AGORA (o trecho pode ter sido editado); sem corte, o gravado; sem nada, o meio.
    const tempoSeg = typeof corte?.inicio === 'number' ? corte.inicio : typeof peca.tempoSeg === 'number' ? peca.tempoSeg : duracao / 2;
    const saida = join(pasta, nomeDoStory(alvo.apelido, n));
    avisar(`Story da matéria ${n} (frame em ${tempoSeg.toFixed(1)} s)…`);
    const png = await renderizarStory({ video, tempoSeg: Math.min(tempoSeg + 1, Math.max(0, duracao - 0.5)), texto: peca.corpo, chamada: peca.chamada ?? '', apelido: alvo.apelido, saida });
    avisar(`→ ${saida} (${Math.round(png.length / 1024)} kB)`);
    if (o['sem-enviar'] !== true) {
      await os.enviarImagemDaPeca(peca.id, 1, png, basename(saida));
      avisar(`Story da matéria ${n} enviado ao OS.`);
    }
    feitas.push({ n, arquivo: saida, bytes: png.length, enviado: o['sem-enviar'] !== true });
  }
  return { id: alvo.id, apelido: alvo.apelido, pasta, stories: feitas };
}

/** O render da máquina de carrossel instalado (com o playwright ao lado), ou nulo. */
function acharRenderDoCarrossel() {
  const cache = join(homedir(), '.claude', 'plugins', 'cache', 'maquina-carrossel-marketplace', 'maquina-carrossel');
  let versoes = [];
  try {
    versoes = readdirSync(cache);
  } catch {
    /* plugin fora do cache: segue com os outros candidatos */
  }
  return (
    candidatosDoRender(ambiente(), homedir(), versoes).find(
      (c) => existsSync(c) && existsSync(join(dirname(c), 'node_modules', 'playwright')),
    ) ?? null
  );
}

/** O @ da marca no brand pack da máquina (a marca d'água do slide). @param {string} marcaRef */
function handleDaMarca(marcaRef) {
  try {
    const h = JSON.parse(readFileSync(marcaRef, 'utf8'))?.handle;
    return typeof h === 'string' && h.trim() ? h.trim() : '@root';
  } catch {
    return '@root';
  }
}

/**
 * Um carrossel pela máquina de carrossel: o `slides.json` na pasta da peça, o
 * render do plugin (node, com o próprio Chromium do playwright) e os PNG de
 * `png/slide-NN.png` conferidos em 1080×1350.
 * @param {{ peca: any, apelido: string, dir: string, render: string, marcaRef: string }} o
 */
async function renderizarCarrossel({ peca, apelido, dir, render, marcaRef }) {
  mkdirSync(dir, { recursive: true });
  const slides = slidesParaAMaquina(peca, { handle: handleDaMarca(marcaRef), marcaRef, apelido });
  writeFileSync(join(dir, 'slides.json'), `${JSON.stringify(slides, null, 2)}\n`);
  await rodar(process.execPath, [render, dir]);
  let estourados = [];
  try {
    estourados = slidesEstourados(JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')));
  } catch {
    avisar(`A máquina de carrossel não gravou o report.json em ${dir}: o estouro de texto não foi conferido.`);
  }
  const pngs = [];
  for (let i = 1; i <= slides.slides.length; i++) {
    const arquivo = join(dir, 'png', `slide-${String(i).padStart(2, '0')}.png`);
    if (!existsSync(arquivo)) throw new Error(`A máquina de carrossel não gravou ${basename(arquivo)}.`);
    const buffer = readFileSync(arquivo);
    const erro = conferirPngNoTamanho(buffer, LARGURA_DO_SLIDE, ALTURA_DO_SLIDE);
    if (erro) throw new Error(`Slide ${i}: ${erro}`);
    pngs.push({ n: i, arquivo, buffer });
  }
  return { pngs, estourados };
}

/** @param {string} ep @param {Record<string, string | true>} o */
async function carrosseis(ep, o) {
  const render = acharRenderDoCarrossel();
  if (!render) {
    throw new Error(
      'Não achei o render da máquina de carrossel com o playwright ao lado. Rode /maquina-carrossel:setup ' +
        '(instalar é decisão sua) ou aponte ROOT_MIDIA_CARROSSEL_RENDER para o render.mjs.',
    );
  }
  const marcaRef = marcaDoCarrossel(ambiente(), homedir());
  if (!existsSync(marcaRef)) throw new Error(`O brand pack da marca não está em ${marcaRef} (ROOT_MIDIA_MARCA troca).`);
  const { os, alvo, semana } = await semanaDoOs(ep);
  const pasta = pastaDaSemana(o, semana.arquivoFinal && existsSync(semana.arquivoFinal) ? semana.arquivoFinal : null, alvo.apelido);
  const feitas = [];
  for (const { n, peca } of pecasParaRender(semana, 'carrossel', o)) {
    avisar(`Carrossel da matéria ${n}: ${peca.slides?.length ?? 0} slides, palavra ${peca.palavraChave}…`);
    const { pngs, estourados } = await renderizarCarrossel({ peca, apelido: alvo.apelido, dir: join(pasta, pastaDoCarrossel(alvo.apelido, n)), render, marcaRef });
    for (const e of estourados) {
      avisar(e.n ? `Carrossel da matéria ${n}, slide ${e.n}: o texto estourou a caixa em ${e.excessoPx} px (sai cortado).` : `Carrossel da matéria ${n}: o render acusou estouro de texto.`);
    }
    // Texto cortado não sobe sem querer: encurte o slide na tela e renderize de novo, ou --forcar.
    const enviar = o['sem-enviar'] !== true && (!estourados.length || o.forcar === true);
    if (enviar) {
      for (const p of pngs) await os.enviarImagemDaPeca(peca.id, p.n, p.buffer, basename(p.arquivo));
      avisar(`Carrossel da matéria ${n}: ${pngs.length} slide(s) enviados ao OS.`);
    } else if (o['sem-enviar'] !== true) {
      avisar(`Carrossel da matéria ${n}: não enviado ao OS por causa do estouro (encurte o texto ou rode com --forcar).`);
    }
    feitas.push({ n, pasta: dirname(pngs[0].arquivo), slides: pngs.length, estourados: estourados.map((e) => e.n), enviado: enviar });
  }
  return { id: alvo.id, apelido: alvo.apelido, pasta, render, carrosseis: feitas };
}

/** @param {string} ep */
async function semanaNaTela(ep) {
  const { alvo, semana } = await semanaDoOs(ep);
  if (semana.motivo) avisar(semana.motivo);
  for (const m of semana.materias ?? []) {
    const estado = ['carrossel', 'story', 'corte']
      .map((f) => {
        const p = m.pecas?.[f];
        if (!p) return `${f}: —`;
        const render =
          f === 'corte' ? (p.video ? 'mp4 no Mac' : 'sem mp4') : `${p.imagens?.length ?? 0} PNG`;
        return `${f}: ${p.status}, ${render}`;
      })
      .join(' · ');
    console.log(`${alvo.apelido} m${m.n}\t${estado}\t${m.titulo}`);
  }
  return 0;
}

/**
 * O ensaio da semana, sem falar com o OS: um vídeo sintético 1920×1080 com um
 * PiP cor-de-rosa onde a câmera fica, 1 corte vertical (confere 1080×1920, a
 * duração e que o rosa caiu embaixo), 1 story (1080×1920) e, com a máquina de
 * carrossel instalada, 1 carrossel (1080×1350).
 */
async function ensaioSemana({ manter = false }) {
  const pasta = mkdtempSync(join(tmpdir(), 'root-midia-ensaio-semana-'));
  const ffmpeg = binario('ffmpeg');
  try {
    const clipe = join(pasta, 'final.mp4');
    const p = REGIAO_DO_PIP_PADRAO;
    await rodar(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=30',
      '-vf', `drawbox=x=${p.x}:y=${p.y}:w=${p.largura}:h=${p.altura}:color=0xFF1F6B@1:t=fill`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clipe,
    ]);
    const inicio = 5.2;
    const fim = 17.6;
    const regioes = { canvas: CANVAS_PADRAO, tela: REGIAO_DA_TELA_PADRAO, pip: REGIAO_DO_PIP_PADRAO, origem: 'padrão' };
    const corte = await renderizarCorte({ video: clipe, inicio, fim, saida: join(pasta, nomeDoCorte('ep-00', 1)), regioes });
    // Um pixel do meio da faixa de baixo: tem de ser o rosa do PiP.
    const pixel = join(pasta, 'pixel.rgb');
    await rodar(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '2', '-i', corte.arquivo, '-frames:v', '1', '-vf', 'format=rgb24,crop=1:1:540:1420', '-f', 'rawvideo', '-pix_fmt', 'rgb24', pixel]);
    const [r, g, b] = readFileSync(pixel);
    const rostoEmbaixo = r > 200 && g < 90 && b > 60 && b < 160;

    const story = await renderizarStory({
      video: clipe,
      tempoSeg: inicio + 1,
      texto: 'A planilha de contas a pagar agora se preenche sozinha',
      chamada: 'O episódio completo está no link da bio.',
      apelido: 'ep-00',
      saida: join(tmpdir(), `root-midia-ensaio-${nomeDoStory('ep-00', 1)}`),
    });

    let carrossel = /** @type {{ slides: number } | { pulado: string }} */ ({ pulado: 'máquina de carrossel não instalada' });
    const render = acharRenderDoCarrossel();
    const marcaRef = marcaDoCarrossel(ambiente(), homedir());
    if (render && existsSync(marcaRef)) {
      const { pngs } = await renderizarCarrossel({
        render,
        marcaRef,
        apelido: 'ep-00',
        dir: join(pasta, pastaDoCarrossel('ep-00', 1)),
        peca: {
          titulo: 'Ensaio da semana',
          slides: [
            { titulo: 'A planilha que se preenche sozinha', texto: '' },
            { titulo: 'O que mudou', texto: 'O agente lê o e-mail do fornecedor e lança a conta a pagar.' },
            { titulo: 'Quanto tempo volta', texto: 'Duas horas por semana de quem fecha o caixa.' },
            { titulo: 'Palavra-chave: PLANILHA', texto: 'Comentário com PLANILHA → o link da matéria e o episódio completo chegam no direct.' },
          ],
          cta: { instrucao: 'Comentário com a palavra', palavra: 'PLANILHA', beneficio: 'O link da matéria e o episódio completo chegam no direct.' },
          palavraChave: 'PLANILHA',
        },
      });
      carrossel = { slides: pngs.length };
    }

    const ok =
      corte.largura === LARGURA_VERTICAL &&
      corte.altura === ALTURA_VERTICAL &&
      Math.abs(corte.duracaoSeg - (fim - inicio)) < 0.2 &&
      rostoEmbaixo &&
      conferirPngNoTamanho(story, LARGURA_VERTICAL, ALTURA_VERTICAL) === null &&
      (!('slides' in carrossel) || carrossel.slides === 4);
    escrever(
      {
        ok,
        pasta: manter ? pasta : null,
        corte: { ...corte, arquivo: manter ? corte.arquivo : null, esperadoSeg: fim - inicio, pixelDoRosto: [r, g, b], rostoEmbaixo },
        story: { png: join(tmpdir(), `root-midia-ensaio-${nomeDoStory('ep-00', 1)}`), bytes: story.length },
        carrossel,
      },
      undefined,
    );
    avisar(ok ? 'ENSAIO OK: corte 1080×1920 com o rosto embaixo e a duração do trecho; story 1080×1920.' : 'ENSAIO FALHOU: veja o relatório acima.');
    return ok;
  } finally {
    if (!manter) rmSync(pasta, { recursive: true, force: true });
  }
}

async function principal() {
  const [comando, ...resto] = process.argv.slice(2);
  const { posicionais, opcoes } = lerArgumentos(resto);
  if (!comando || comando === 'ajuda' || comando === '--help' || opcoes.ajuda) {
    console.log(AJUDA);
    return 0;
  }
  const cfg = configuracao(ambiente());

  switch (comando) {
    case 'pendentes': {
      exigirOs(cfg);
      const fila = await clienteDoOs(cfg).pendentes();
      if (!fila.items?.length) avisar('Nada na fila: nenhum episódio em gravação ou edição.');
      for (const e of fila.items ?? []) {
        console.log(`${e.apelido}\t${e.status}\tfalta ${e.falta}\tpalavra "${e.palavraDeCorte}"\t${e.titulo}`);
      }
      return 0;
    }
    case 'silencios': {
      const arquivo = exigirArquivo(posicionais[0]);
      const s = await detectarSilencios(arquivo, {
        ruidoDb: numero(opcoes, 'ruido', PADROES.ruidoDb),
        minimoSeg: numero(opcoes, 'minimo', PADROES.minimoSeg),
      });
      avisar(`${s.silencios.length} silêncio(s) em ${s.duracaoSeg.toFixed(1)} s.`);
      escrever(s, texto(opcoes, 'saida'));
      return 0;
    }
    case 'cortes': {
      // `cortes <ep-NN> [final]` é o corte vertical da semana (MC15); `cortes <arquivo>` segue sendo o plano do MC9.
      if (/^ep-?\d+$/i.test(posicionais[0] ?? '') && !existsSync(posicionais[0])) {
        escrever(await cortesVerticais(posicionais[0], posicionais[1], opcoes), undefined);
        return 0;
      }
      const arquivo = exigirArquivo(posicionais[0]);
      const minimoSeg = numero(opcoes, 'minimo', PADROES.minimoSeg);
      const s = texto(opcoes, 'silencios')
        ? lerJson(/** @type {string} */ (texto(opcoes, 'silencios')))
        : await detectarSilencios(arquivo, { ruidoDb: numero(opcoes, 'ruido', PADROES.ruidoDb), minimoSeg });
      const t = texto(opcoes, 'transcricao') ? lerJson(/** @type {string} */ (texto(opcoes, 'transcricao'))) : null;
      const duracao = s.duracaoSeg ?? (await duracaoDe(arquivo));
      const segmentos = t ? segmentosDaTranscricao(t) : null;
      if (t && !Array.isArray(t) && Number.isFinite(Number(t.duracaoSeg)) && Math.abs(Number(t.duracaoSeg) - duracao) > 0.5) {
        throw new Error(
          `A transcrição é de um arquivo com ${Number(t.duracaoSeg).toFixed(1)} s e o bruto tem ${duracao.toFixed(1)} s — ` +
            'a palavra de corte precisa da transcrição do BRUTO, não do final.',
        );
      }
      if (t && typeof t.arquivo === 'string' && t.arquivo !== arquivo) {
        avisar(`A transcrição foi feita de ${t.arquivo}; a duração bate com ${arquivo}, sigo.`);
      }
      const plano = planoDeCortes({
        duracao,
        silencios: s.silencios ?? [],
        segmentos,
        palavra: texto(opcoes, 'palavra') ?? cfg.palavra,
        minimoSeg,
        margemSeg: numero(opcoes, 'margem', PADROES.margemSeg),
      });
      if (!t) avisar('Sem --transcricao: só os silêncios saem (a palavra de corte precisa da transcrição do bruto).');
      avisar(
        `Mantém ${plano.manter.length} trecho(s): ${plano.duracaoBrutoSeg.toFixed(1)} s → ${plano.duracaoFinalSeg.toFixed(1)} s` +
          ` (${plano.tomadasErradas.length} tomada(s) errada(s)).`,
      );
      escrever({ arquivo, ...plano }, texto(opcoes, 'saida'));
      return 0;
    }
    case 'cortar': {
      const [entrada, cortesJson, saida] = posicionais;
      if (!saida) throw new Error('Uso: root-midia cortar <arquivo> <cortes.json> <saida>');
      const modo = opcoes.copiar ? 'copiar' : opcoes.reencodar ? 'reencodar' : 'auto';
      const r = await cortar(exigirArquivo(entrada), lerJson(cortesJson), garantirPastaDaSaida(saida, avisar), {
        modo,
        sobrescrever: opcoes.sobrescrever === true,
      });
      avisar(`${r.duracaoBrutoSeg.toFixed(1)} s → ${r.duracaoFinalSeg.toFixed(1)} s (esperado ${r.esperadoSeg.toFixed(1)} s).`);
      escrever({ saida: resolve(saida), ...r }, undefined);
      return 0;
    }
    case 'transcrever': {
      const destino = texto(opcoes, 'saida');
      if (destino) garantirPastaDaSaida(destino, avisar);
      const r = await transcrever(exigirArquivo(posicionais[0]), {
        idioma: texto(opcoes, 'idioma') ?? 'pt',
        modelo: cfg.modelo,
      });
      avisar(`${r.segmentos.length} segmento(s).`);
      const saida = texto(opcoes, 'saida');
      escrever(r, saida);
      if (saida) {
        const srt = `${resolve(saida).replace(/\.json$/i, '')}.srt`;
        writeFileSync(srt, srtDosSegmentos(r.segmentos));
        avisar(`→ ${srt}`);
      }
      return 0;
    }
    case 'enviar': {
      if (!posicionais[0]) throw new Error('Uso: root-midia enviar <ep-NN> [--final …] [--transcricao …]');
      escrever(await enviar(posicionais[0], opcoes), undefined);
      return 0;
    }
    case 'ensaio':
      return (await ensaio({ manter: opcoes.manter === true })) ? 0 : 1;
    case 'thumbs': {
      if (!posicionais[0]) throw new Error('Uso: root-midia thumbs <ep-NN> [--final …] [--sem-enviar]');
      escrever(await thumbs(posicionais[0], opcoes), undefined);
      return 0;
    }
    case 'ensaio-thumb':
      return (await ensaioThumb({ saida: texto(opcoes, 'saida'), manter: opcoes.manter === true })) ? 0 : 1;
    case 'semana':
      if (!posicionais[0]) throw new Error('Uso: root-midia semana <ep-NN>');
      return semanaNaTela(posicionais[0]);
    case 'cortes-verticais': {
      if (!posicionais[0]) throw new Error('Uso: root-midia cortes-verticais <ep-NN> [vídeo final]');
      escrever(await cortesVerticais(posicionais[0], posicionais[1], opcoes), undefined);
      return 0;
    }
    case 'stories': {
      if (!posicionais[0]) throw new Error('Uso: root-midia stories <ep-NN> [--final …] [--sem-enviar]');
      escrever(await stories(posicionais[0], opcoes), undefined);
      return 0;
    }
    case 'carrosseis': {
      if (!posicionais[0]) throw new Error('Uso: root-midia carrosseis <ep-NN> [--sem-enviar]');
      escrever(await carrosseis(posicionais[0], opcoes), undefined);
      return 0;
    }
    case 'agenda': {
      const de = texto(opcoes, 'de');
      if (de !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(de)) throw new Error('Uso: root-midia agenda [--de AAAA-MM-DD]');
      exigirOs(cfg);
      for (const linha of linhasDaAgenda(await clienteDoOs(cfg).agenda(de))) console.log(linha);
      return 0;
    }
    case 'ensaio-semana':
      return (await ensaioSemana({ manter: opcoes.manter === true })) ? 0 : 1;
    default:
      throw new Error(`Comando desconhecido: ${comando}. Veja \`root-midia ajuda\`.`);
  }
}

principal().then(
  (codigo) => process.exit(codigo),
  (e) => {
    avisar(`root-midia: ${e?.message ?? e}`);
    process.exit(typeof e?.codigo === 'number' ? e.codigo : 1);
  },
);
