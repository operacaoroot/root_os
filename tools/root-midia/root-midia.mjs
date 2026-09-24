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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';
import { mesmoArquivo } from './lib/arquivos.mjs';
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

Variáveis: ROOT_OS_API_URL (padrão http://localhost:4001/api), ROOT_OS_EMAIL, ROOT_OS_SENHA,
WHISPER_MODEL (caminho do .bin ggml), ROOT_MIDIA_PALAVRA (padrão "root, corta"). Lidas do
ambiente e do arquivo ~/.config/root/root-midia.env (ou o de ROOT_MIDIA_ENV); o ambiente vence.`;

/** O ambiente mais o arquivo de variáveis do Mac, sem sobrescrever o que já foi exportado. */
function ambiente() {
  const caminho = process.env.ROOT_MIDIA_ENV?.trim() || join(homedir(), '.config', 'root', 'root-midia.env');
  if (!existsSync(caminho)) {
    if (process.env.ROOT_MIDIA_ENV?.trim()) throw new Error(`ROOT_MIDIA_ENV aponta para ${caminho}, que não existe.`);
    return process.env;
  }
  return juntarVariaveis(process.env, lerArquivoDeVariaveis(readFileSync(caminho, 'utf8')));
}

const BOOLEANAS = new Set(['copiar', 'reencodar', 'sobrescrever', 'manter', 'ajuda']);

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
    writeFileSync(resolve(saida), json);
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
      const r = await cortar(exigirArquivo(entrada), lerJson(cortesJson), resolve(saida), {
        modo,
        sobrescrever: opcoes.sobrescrever === true,
      });
      avisar(`${r.duracaoBrutoSeg.toFixed(1)} s → ${r.duracaoFinalSeg.toFixed(1)} s (esperado ${r.esperadoSeg.toFixed(1)} s).`);
      escrever({ saida: resolve(saida), ...r }, undefined);
      return 0;
    }
    case 'transcrever': {
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
