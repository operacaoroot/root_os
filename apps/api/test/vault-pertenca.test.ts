import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextKind } from '@prisma/client';
import { resumoVazio } from '../src/memory/memoria.service';
import { lerNotaDaVault, resolverSubstitui } from '../src/obsidian/cabecalho-da-nota';
import { descobrirNaPasta } from '../src/obsidian/disco-da-vault';
import {
  atributosConvertem,
  lerConfigDoGit,
  lerRepositorioDaVault,
  motivoNaConfig,
  PRAZO_DA_BUSCA_MS,
  remotoDoFetchHead,
  ultimaLinhaDoReflog,
  urlSemCredencial,
} from '../src/obsidian/estado-do-git';
import { blobDoGit, lerIndiceDoGit, lerInteiroVariavel, type LeituraDoIndice } from '../src/obsidian/indice-do-git';
import { aplicarDiferenca, dataDoCommit, lerObjetoDoGit } from '../src/obsidian/objetos-do-git';
import { classificarAVault, type ArquivoNoDisco } from '../src/obsidian/pertenca-da-vault';
import {
  assinaturaDoRecibo,
  caminhosSigilosos,
  CAMINHOS_POR_SITUACAO,
  deveRegistrar,
  INTERVALO_DA_BATIDA_MS,
  resultadoDaVolta,
  type ReciboDaVault,
} from '../src/obsidian/recibo-da-vault';
import { git, iniciarGit, versionarVault } from './vault-com-git';

/*
 * ROOT-20 — A PERTENÇA À COLEÇÃO `vault:`, O RECIBO A MONTANTE E O CABEÇALHO, SEM BANCO.
 *
 * Os ensaios E-20.1, E-20.2, E-20.8 (a parte pura) e E-20.9 de
 * `relatorios/ROOT-19/ensaios-previstos.md`. Cada índice e cada repositório aqui
 * é feito pelo git DE VERDADE, numa pasta temporária (o runner da CI e o Mac têm
 * git; a imagem da API não, e é por isso que a leitura é pura). O git da suíte
 * não lê a configuração da máquina — ver `vault-com-git.ts`.
 *
 * Nenhum caso depende de sistema de arquivos sensível a normalização: a colisão
 * de NFC entre dois membros é montada com o índice do git e a listagem em bytes,
 * porque o APFS do Mac não guarda os dois nomes na mesma pasta e o ext4 da CI
 * guarda. A mesma prova roda igual nos dois.
 */

/*
 * Cada caso aqui chama o git várias vezes; sob a carga da suíte paralela, criar
 * e versionar meia dúzia de repositórios passa dos 5 s padrão do vitest.
 */
vi.setConfig({ testTimeout: 60_000 });

const pastas: string[] = [];
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

function pasta(prefixo = 'r20-vault-'): string {
  const p = mkdtempSync(path.join(os.tmpdir(), prefixo));
  pastas.push(p);
  return p;
}

function escrever(raiz: string, caminho: string, texto: string | Buffer): void {
  const alvo = path.join(raiz, caminho);
  mkdirSync(path.dirname(alvo), { recursive: true });
  writeFileSync(alvo, texto);
}

function vault(arquivos: Record<string, string>): string {
  const raiz = pasta();
  for (const [c, t] of Object.entries(arquivos)) escrever(raiz, c, t);
  return raiz;
}

/** Um corpo único, longo o bastante para formar par de movimento. */
function corpo(semente: string): string {
  return `# ${semente}\n\n${`Texto da nota ${semente}, que fala de uma regra da casa. `.repeat(6)}`;
}

/** O que `git ls-files -s` diz do índice, na forma que o leitor devolve. */
function lsFiles(raiz: string): Array<{ caminho: string; modo: number; blob: string; estagio: number }> {
  return git(raiz, 'ls-files', '-s', '-z')
    .split('\0')
    .filter(Boolean)
    .map((linha) => {
      const [meta, caminho] = linha.split('\t');
      const [modo, blob, estagio] = meta.split(' ');
      return { caminho, modo: parseInt(modo, 8), blob, estagio: Number(estagio) };
    });
}

function lidas(l: LeituraDoIndice) {
  if (!l.ok) throw new Error(`índice não lido: ${l.motivo}`);
  return l.entradas.map((e) => ({ caminho: e.caminho.toString('utf8'), modo: e.modo, blob: e.blob, estagio: e.estagio }));
}

function indiceDe(raiz: string): Buffer {
  return readFileSync(path.join(raiz, '.git', 'index'));
}

/** O passeio, o `.git` e a pertença — o mesmo caminho que `ObsidianService.reindex` faz. */
function classificar(raiz: string) {
  const d = descobrirNaPasta(raiz);
  const repositorio = lerRepositorioDaVault(raiz, d.atributos);
  return {
    repositorio,
    pertenca: classificarAVault({
      arquivos: d.arquivos,
      indice: repositorio.indice?.ok ? repositorio.indice.entradas : null,
      naoVerificavel: repositorio.naoVerificavel,
    }),
  };
}

const situacoes = (p: ReturnType<typeof classificarAVault>) =>
  p.foraDaColecao.map((f) => `${f.situacao}:${f.caminho}`).sort();
const membros = (p: ReturnType<typeof classificarAVault>) => p.membros.map((m) => m.caminho).sort();

/** Refaz a soma final de um índice montado à mão. */
function comSoma(corpoDoIndice: Buffer): Buffer {
  return Buffer.concat([corpoDoIndice, createHash('sha1').update(corpoDoIndice).digest()]);
}

// ===========================================================================
// E-20.1 — o índice do git, lido sem o git (C19-03, R-2)
// ===========================================================================

describe('E-20.1: o leitor do índice do git', () => {
  it('versão 2: as mesmas entradas que `git ls-files -s`, e os membros são os .md íntegros', () => {
    const raiz = vault({
      'a.md': corpo('a'),
      'pasta/b.md': corpo('b'),
      'pasta/sub/c.MD': corpo('c'),
      'z.txt': 'não é nota',
      '.obsidian/workspace.md': 'configuração do Obsidian, nunca entra',
    });
    versionarVault(raiz);
    const leitura = lerIndiceDoGit(indiceDe(raiz));
    expect(leitura.ok && leitura.versao).toBe(2);
    expect(lidas(leitura)).toEqual(lsFiles(raiz));
    const { pertenca } = classificar(raiz);
    expect(pertenca.rastreamento).toBe('ok');
    expect(membros(pertenca)).toEqual(['a.md', 'pasta/b.md', 'pasta/sub/c.MD']);
    expect(pertenca.contagens).toMatchObject({ mdNoDisco: 3, rastreados: 3, naoRastreados: 0, membros: 3 });
  });

  it('versão 3: `skip-worktree` liga a bandeira estendida; a entrada fica não verificável e vai aos vistos', () => {
    const raiz = vault({ 'a.md': corpo('a'), 'b.md': corpo('b') });
    versionarVault(raiz);
    git(raiz, 'update-index', '--skip-worktree', 'b.md');
    const leitura = lerIndiceDoGit(indiceDe(raiz));
    expect(leitura.ok && leitura.versao).toBe(3);
    expect(leitura.ok && leitura.entradas.find((e) => e.caminho.toString() === 'b.md')?.skipWorktree).toBe(true);
    const { pertenca } = classificar(raiz);
    expect(membros(pertenca)).toEqual(['a.md']);
    expect(situacoes(pertenca)).toEqual(['nao_verificavel:b.md']);
    expect(pertenca.vistos).toEqual(['b.md']);
  });

  it('versão 4: a compressão de prefixo é lida, não recusada, e dá as mesmas entradas', () => {
    const arquivos: Record<string, string> = {};
    for (const p of ['10-Empresa/Regras', '10-Empresa/Regras/Antigas', '20-Pessoas', '20-Pessoas/Funções']) {
      for (let i = 0; i < 4; i++) arquivos[`${p}/nota-${i}.md`] = corpo(`${p}-${i}`);
    }
    const raiz = vault(arquivos);
    versionarVault(raiz);
    const v2 = lidas(lerIndiceDoGit(indiceDe(raiz)));
    git(raiz, 'update-index', '--index-version', '4');
    const leitura = lerIndiceDoGit(indiceDe(raiz));
    expect(leitura.ok && leitura.versao).toBe(4);
    expect(lidas(leitura)).toEqual(v2);
    expect(lidas(leitura)).toEqual(lsFiles(raiz));
    expect(classificar(raiz).pertenca.contagens.membros).toBe(16);
  });

  it('soma adulterada: índice ilegível, nenhum membro e nenhum visto — a volta não escreve nada', () => {
    const raiz = vault({ 'a.md': corpo('a') });
    versionarVault(raiz);
    const bytes = indiceDe(raiz);
    bytes[20] ^= 0xff; // um campo de data da primeira entrada: a estrutura fica intacta
    writeFileSync(path.join(raiz, '.git', 'index'), bytes);
    const leitura = lerIndiceDoGit(bytes);
    expect(leitura).toEqual({ ok: false, motivo: expect.stringMatching(/soma final do índice não confere/) });
    const { pertenca } = classificar(raiz);
    expect(pertenca.rastreamento).toMatch(/soma final/);
    expect({ membros: pertenca.membros, vistos: pertenca.vistos }).toEqual({ membros: [], vistos: [] });
  });

  it('soma NULA (o que `index.skipHash` grava) é aceita; índice cortado não', () => {
    const raiz = vault({ 'a.md': corpo('a'), 'b.md': corpo('b') });
    versionarVault(raiz);
    const bytes = indiceDe(raiz);
    const nula = Buffer.concat([bytes.subarray(0, bytes.length - 20), Buffer.alloc(20)]);
    const leitura = lerIndiceDoGit(nula);
    expect(leitura.ok && leitura.somaNula).toBe(true);
    expect(lidas(leitura)).toEqual(lsFiles(raiz));
    const cortado = lerIndiceDoGit(bytes.subarray(0, bytes.length - 30));
    expect(cortado.ok).toBe(false);
  });

  it('extensão obrigatória: `link` (índice dividido, feito pelo git) e `sdir` (montada) recusam; maiúscula é pulada', () => {
    const raiz = vault({ 'a.md': corpo('a') });
    versionarVault(raiz);
    const limpo = indiceDe(raiz);
    const corpoLimpo = limpo.subarray(0, limpo.length - 20);
    const extensao = (assinatura: string, dados: Buffer) => {
      const cab = Buffer.alloc(8);
      cab.write(assinatura, 0, 'latin1');
      cab.writeUInt32BE(dados.length, 4);
      return Buffer.concat([cab, dados]);
    };
    const sdir = lerIndiceDoGit(comSoma(Buffer.concat([corpoLimpo, extensao('sdir', Buffer.alloc(0))])));
    expect(sdir).toEqual({ ok: false, motivo: expect.stringMatching(/extensão obrigatória "sdir".*índice esparso/) });
    const opcional = lerIndiceDoGit(comSoma(Buffer.concat([corpoLimpo, extensao('ZZZZ', Buffer.from('abc'))])));
    expect(opcional.ok && opcional.extensoes.at(-1)).toBe('ZZZZ');

    const link = lerIndiceDoGit(comSoma(Buffer.concat([corpoLimpo, extensao('link', Buffer.alloc(20))])));
    expect(link).toEqual({ ok: false, motivo: expect.stringMatching(/extensão obrigatória "link".*índice dividido/) });

    // O índice dividido de verdade: o git deixa as entradas no `sharedindex`, e a recusa diz isso.
    git(raiz, 'update-index', '--split-index');
    expect(lerIndiceDoGit(indiceDe(raiz)).ok).toBe(false);
    expect(classificar(raiz).pertenca.rastreamento).toMatch(/índice dividido/);
    const comConfig = vault({ 'a.md': corpo('a') });
    versionarVault(comConfig);
    git(comConfig, 'config', 'core.splitIndex', 'true');
    expect(classificar(comConfig).pertenca.rastreamento).toMatch(/índice dividido/);
  });

  it('objetos SHA-256: rastreamento não verificável (o blob muda de algoritmo e de tamanho)', () => {
    const raiz = vault({ 'a.md': corpo('a') });
    git(raiz, 'init', '-q', '--object-format=sha256', '-b', 'main');
    git(raiz, 'config', 'core.autocrlf', 'false');
    git(raiz, 'add', '-A');
    git(raiz, 'commit', '-q', '-m', 'sha256');
    const { pertenca } = classificar(raiz);
    expect(pertenca.rastreamento).toMatch(/objetos sha256/);
    expect(pertenca.membros).toEqual([]);
  });

  it('conversão de fim de linha ou filtro no clone: não verificável; atributo que não converte passa', () => {
    const comAutocrlf = vault({ 'a.md': corpo('a') });
    versionarVault(comAutocrlf);
    git(comAutocrlf, 'config', 'core.autocrlf', 'true');
    expect(classificar(comAutocrlf).pertenca.rastreamento).toMatch(/core\.autocrlf=true/);

    // A tabela de linhas, pela função pura que o passeio usa; o git de verdade, uma vez por lado.
    for (const [linha, convertida] of [
      ['*.md text eol=crlf', true],
      ['* text=auto', true],
      ['*.md filter=lfs diff=lfs merge=lfs -text', true],
      ['*.md ident', true],
      ['*.md working-tree-encoding=UTF-16', true],
      ['*.png binary', false],
      ['*.md -text diff', false],
      ['# só comentário', false],
    ] as const) {
      expect(Boolean(atributosConvertem(`${linha}\n`)), linha).toBe(convertida);
    }
    const converte = vault({ 'a.md': corpo('a'), 'sub/.gitattributes': '*.md text eol=crlf\n' });
    versionarVault(converte);
    expect(classificar(converte).pertenca.rastreamento).toMatch(/sub\/\.gitattributes liga conversão/);
    const naoConverte = vault({ 'a.md': corpo('a'), 'sub/.gitattributes': '*.png binary\n' });
    versionarVault(naoConverte);
    expect(classificar(naoConverte).pertenca.rastreamento).toBe('ok');
    const naInfo = vault({ 'a.md': corpo('a') });
    versionarVault(naInfo);
    escrever(naInfo, '.git/info/attributes', '*.md eol=crlf\n');
    expect(classificar(naInfo).pertenca.rastreamento).toMatch(/\.git\/info\/attributes/);
  });

  it('conflito de merge (estágios 1 a 3), `intent-to-add`, link simbólico e submódulo: não verificáveis', () => {
    const raiz = vault({ 'conflito.md': corpo('base'), 'a.md': corpo('a'), 'sub-alvo.md': corpo('alvo') });
    versionarVault(raiz);
    git(raiz, 'checkout', '-q', '-b', 'outro');
    escrever(raiz, 'conflito.md', corpo('lado de lá'));
    git(raiz, 'commit', '-q', '-am', 'lá');
    git(raiz, 'checkout', '-q', 'main');
    escrever(raiz, 'conflito.md', corpo('lado de cá'));
    git(raiz, 'commit', '-q', '-am', 'cá');
    expect(() => git(raiz, 'merge', '-q', 'outro')).toThrow();
    escrever(raiz, 'novo.md', corpo('novo'));
    git(raiz, 'add', '-N', 'novo.md');
    symlinkSync('a.md', path.join(raiz, 'atalho.md'));
    git(raiz, 'add', 'atalho.md');
    const head = git(raiz, 'rev-parse', 'HEAD').trim();
    git(raiz, 'update-index', '--add', '--cacheinfo', `160000,${head},submodulo.md`);

    const leitura = lerIndiceDoGit(indiceDe(raiz));
    expect(leitura.ok && leitura.entradas.filter((e) => e.caminho.toString() === 'conflito.md').map((e) => e.estagio)).toEqual([1, 2, 3]);
    const { pertenca } = classificar(raiz);
    expect(membros(pertenca)).toEqual(['a.md', 'sub-alvo.md']);
    expect(situacoes(pertenca)).toEqual([
      'nao_verificavel:atalho.md',
      'nao_verificavel:conflito.md',
      'nao_verificavel:novo.md',
      'nao_verificavel:submodulo.md',
    ]);
    expect(pertenca.vistos.sort()).toEqual(['atalho.md', 'conflito.md', 'novo.md', 'submodulo.md']);
  });

  it('inteiro variável do índice v4: a codificação do OFS_DELTA', () => {
    expect(lerInteiroVariavel(Buffer.from([0x05]), 0)).toEqual({ valor: 5, fim: 1 });
    // 0x81 0x00 = (1 + 1) * 128 + 0 = 256
    expect(lerInteiroVariavel(Buffer.from([0x81, 0x00]), 0)).toEqual({ valor: 256, fim: 2 });
  });
});

// ===========================================================================
// As quatro condições e a tabela de situações (C19-03, R-3)
// ===========================================================================

describe('C19-03: as quatro condições de pertença, e as duas linhas da R-3', () => {
  it('não rastreado, alterado e apagado fora do git, página do gerador, 90-OS/ e onboarding/', () => {
    const raiz = vault({
      'intacta.md': corpo('intacta'),
      'sera-alterada.md': corpo('alterada'),
      'sera-apagada.md': corpo('apagada'),
      'gerada.md': `---\ngerado_por: root-os\ngerado_para: root\n---\n${corpo('gerada')}`,
      '90-OS/anexo.md': corpo('dado do OS'),
      'onboarding/tema.md': corpo('pasta reservada ao espelho'),
    });
    versionarVault(raiz);
    escrever(raiz, 'solta.md', corpo('solta'));
    escrever(raiz, 'sera-alterada.md', `${corpo('alterada')}\nmexida na VPS, fora do git`);
    rmSync(path.join(raiz, 'sera-apagada.md'));

    const { pertenca } = classificar(raiz);
    expect(membros(pertenca)).toEqual(['intacta.md']);
    expect(situacoes(pertenca)).toEqual([
      'alterado_fora_do_git:sera-alterada.md',
      'apagado_fora_do_git:sera-apagada.md',
      'gerado_pelo_os:gerada.md',
      'nao_rastreado:solta.md',
      'pasta_fora_da_colecao:90-OS/anexo.md',
      'pasta_fora_da_colecao:onboarding/tema.md',
    ]);
    // R-3: só o que ficou fora por anomalia do clone é visto (não arquiva, não altera).
    expect(pertenca.vistos.sort()).toEqual(['sera-alterada.md', 'sera-apagada.md']);
    expect(pertenca.contagens).toMatchObject({
      mdNoDisco: 6,
      rastreados: 3,
      naoRastreados: 1,
      alteradosForaDoGit: 1,
      apagadosForaDoGit: 1,
      geradosExcluidos: 1,
      pastasForaDaColecao: { '90-OS': 1, onboarding: 1 },
      membros: 1,
    });
  });

  it('a condição 3 é o blob: mesmo tamanho e mesma data, um byte trocado já tira a nota', () => {
    const raiz = vault({ 'a.md': corpo('a') });
    versionarVault(raiz);
    const alvo = path.join(raiz, 'a.md');
    const antes = statSync(alvo);
    const bytes = readFileSync(alvo);
    bytes[bytes.length - 2] = bytes[bytes.length - 2] === 0x61 ? 0x62 : 0x61;
    writeFileSync(alvo, bytes);
    utimesSync(alvo, antes.atime, antes.mtime);
    expect(blobDoGit(bytes)).not.toBe(lsFiles(raiz)[0].blob);
    expect(situacoes(classificar(raiz).pertenca)).toEqual(['alterado_fora_do_git:a.md']);
  });

  it('o blob calculado é o do git: `sha1("blob " + tamanho + "\\0" + bytes)`', () => {
    const raiz = vault({ 'a.md': 'conteúdo com acento\r\ne CRLF\n' });
    versionarVault(raiz);
    expect(blobDoGit(readFileSync(path.join(raiz, 'a.md')))).toBe(lsFiles(raiz)[0].blob);
  });

  it('taxa alta de "alterado fora do git" vira UM aviso de conversão provável (R-2)', () => {
    const arquivos: Record<string, string> = {};
    for (let i = 0; i < 8; i++) arquivos[`n-${i}.md`] = corpo(`n${i}`);
    const raiz = vault(arquivos);
    versionarVault(raiz);
    for (let i = 0; i < 6; i++) escrever(raiz, `n-${i}.md`, corpo(`n${i}`).replace(/\n/g, '\r\n'));
    const { pertenca } = classificar(raiz);
    expect(pertenca.contagens.alteradosForaDoGit).toBe(6);
    expect(pertenca.avisos).toEqual([expect.stringMatching(/^6 de 8 arquivo\(s\) rastreado\(s\).*conversão de fim de linha/)]);
    const lista = caminhosSigilosos(pertenca.foraDaColecao, true);
    expect(lista.alterado_fora_do_git).toEqual({ total: 6, caminhos: [] });
  });

  it('vault sem .git, ou com .git que é arquivo: rastreamento não verificável', () => {
    const sem = vault({ 'a.md': corpo('a') });
    expect(classificar(sem).pertenca.rastreamento).toMatch(/não tem \.git/);
    const comArquivo = vault({ 'a.md': corpo('a'), '.git': 'gitdir: ../outro/.git\n' });
    expect(classificar(comArquivo).pertenca.rastreamento).toMatch(/\.git é arquivo/);
  });
});

// ===========================================================================
// E-20.2 — a montante (C19-08)
// ===========================================================================

describe('E-20.2: o bloco `montante`, lido do .git da vault', () => {
  function cenario() {
    const base = pasta('r20-montante-');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', 'remoto.git'], { cwd: base, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    const autor = path.join(base, 'autor');
    mkdirSync(autor);
    iniciarGit(autor);
    git(autor, 'remote', 'add', 'origin', path.join(base, 'remoto.git'));
    escrever(autor, 'a.md', corpo('a'));
    escrever(autor, 'grande.md', Array.from({ length: 800 }, (_, i) => `linha ${i} de uma nota longa da base`).join('\n'));
    git(autor, 'add', '-A');
    git(autor, 'commit', '-q', '-m', 'primeiro');
    git(autor, 'push', '-q', 'origin', 'main');
    git(base, 'clone', '-q', path.join(base, 'remoto.git'), 'vault');
    const v = path.join(base, 'vault');
    git(v, 'config', 'core.autocrlf', 'false');
    return { base, autor, vault: v };
  }
  const fetchHead = (v: string) => path.join(v, '.git', 'FETCH_HEAD');

  it('busca que funciona, HEAD atrás do remoto, busca que falha e busca parada', () => {
    const { base, autor, vault: v } = cenario();
    git(v, 'fetch', '-q', 'origin');
    let r = lerRepositorioDaVault(v, []);
    const head1 = git(v, 'rev-parse', 'HEAD').trim();
    expect(r.naoVerificavel).toBeNull();
    expect(r.montante).toMatchObject({
      repositorio: path.join(base, 'remoto.git'),
      commit: head1,
      remotoNaBusca: head1,
      atrasado: false,
      buscaParada: false,
      errosDoPull: 'não visível no container',
      ultimaBuscaEm: statSync(fetchHead(v)).mtime.toISOString(),
    });
    expect(r.montante.commitEm).toBe(new Date(Number(git(v, 'log', '-1', '--format=%ct')) * 1000).toISOString());

    // O remoto anda; a vault só busca (o merge que o pull faria não acontece).
    escrever(autor, 'b.md', corpo('b'));
    git(autor, 'add', '-A');
    git(autor, 'commit', '-q', '-m', 'segundo');
    git(autor, 'push', '-q', 'origin', 'main');
    git(v, 'fetch', '-q', 'origin');
    const novo = git(autor, 'rev-parse', 'HEAD').trim();
    r = lerRepositorioDaVault(v, []);
    expect(r.montante).toMatchObject({ commit: head1, remotoNaBusca: novo, atrasado: true });

    /*
     * A BUSCA QUE FALHA, MEDIDA (a ROOT-19 tinha isto como inferência): o git
     * ZERA o FETCH_HEAD e atualiza a data dele. A data do arquivo, sozinha,
     * diria "buscou agora" — o recibo separa a busca que trouxe o remoto da que
     * não trouxe nada, e a segunda deixa a montante parada.
     */
    const marca = new Date(Date.now() - 10 * 60_000);
    utimesSync(fetchHead(v), marca, marca);
    expect(readFileSync(fetchHead(v), 'utf8')).toContain(novo);
    renameSync(path.join(base, 'remoto.git'), path.join(base, 'remoto-sumido.git'));
    expect(() => git(v, 'fetch', '-q', 'origin')).toThrow();
    const depoisDaFalha = statSync(fetchHead(v));
    expect({ conteudo: readFileSync(fetchHead(v), 'utf8'), andou: depoisDaFalha.mtimeMs > marca.getTime() }).toEqual({
      conteudo: '',
      andou: true,
    });
    r = lerRepositorioDaVault(v, []);
    expect(r.montante).toMatchObject({
      ultimaBuscaEm: null,
      ultimaBuscaFalhouEm: depoisDaFalha.mtime.toISOString(),
      remotoNaBusca: null,
      buscaParada: true,
    });
    expect(resultadoDaVolta({ ...reciboOk(), montante: { ...r.montante, mudouNoMeio: false } }).motivos).toEqual([
      expect.stringMatching(/a última busca no remoto não trouxe nada .*zera o FETCH_HEAD/),
    ]);

    // O remoto volta: a busca seguinte traz a linha de novo, e a montante anda.
    renameSync(path.join(base, 'remoto-sumido.git'), path.join(base, 'remoto.git'));
    git(v, 'fetch', '-q', 'origin');
    expect(lerRepositorioDaVault(v, []).montante).toMatchObject({ remotoNaBusca: novo, ultimaBuscaFalhouEm: null, buscaParada: false });

    // Sem busca boa há mais que o prazo: a montante está parada.
    const velha = new Date(Date.now() - PRAZO_DA_BUSCA_MS - 60_000);
    utimesSync(fetchHead(v), velha, velha);
    expect(lerRepositorioDaVault(v, []).montante.buscaParada).toBe(true);
  });

  it('`ultimoAvancoEm` é a última linha de `logs/HEAD`; nome e e-mail do reflog não saem', () => {
    const { vault: v } = cenario();
    git(v, 'pull', '-q', '--ff-only');
    const reflog = readFileSync(path.join(v, '.git', 'logs', 'HEAD'), 'utf8');
    const ultima = ultimaLinhaDoReflog(reflog);
    const ts = Number(/ (\d+) [+-]\d{4}\t[^\n]*\n?$/.exec(reflog)![1]);
    expect(ultima?.em.toISOString()).toBe(new Date(ts * 1000).toISOString());
    expect(lerRepositorioDaVault(v, []).montante.ultimoAvancoEm).toBe(new Date(ts * 1000).toISOString());
    expect(JSON.stringify(lerRepositorioDaVault(v, []).montante)).not.toContain('suite@teste.local');
  });

  it('a data do commit sai do objeto solto, do pacote e de objeto guardado como diferença', () => {
    const { autor, vault: v } = cenario();
    const esperado = () => new Date(Number(git(v, 'log', '-1', '--format=%ct')) * 1000).toISOString();
    expect(lerRepositorioDaVault(v, []).montante.commitEm).toBe(esperado());

    // Uma versão nova do arquivo grande: o pacote agressivo guarda uma como diferença da outra.
    escrever(autor, 'grande.md', Array.from({ length: 800 }, (_, i) => `linha ${i} de uma nota longa da base${i % 97 === 0 ? ' (revista)' : ''}`).join('\n'));
    git(autor, 'commit', '-q', '-am', 'revisão');
    git(autor, 'push', '-q', 'origin', 'main');
    git(v, 'pull', '-q', '--ff-only');
    git(v, 'gc', '-q', '--aggressive', '--prune=now');
    expect(lerRepositorioDaVault(v, []).montante.commitEm).toBe(esperado());

    const dirDoPacote = path.join(v, '.git', 'objects', 'pack');
    const indices = readdirSync(dirDoPacote).filter((n) => n.endsWith('.idx')).map((n) => path.join(dirDoPacote, n));
    const pacote = git(v, 'verify-pack', '-v', ...indices);
    const deltas = pacote
      .split('\n')
      .map((l) => l.trim().split(/\s+/))
      .filter((c) => c.length >= 7 && /^[0-9a-f]{40}$/.test(c[0]) && Number(c[5]) >= 1);
    expect(deltas.length).toBeGreaterThan(0);
    for (const [sha] of deltas) {
      const lido = lerObjetoDoGit(path.join(v, '.git'), sha);
      const doGit = execFileSync('git', ['cat-file', '-p', sha], { cwd: v, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
      expect(lido.motivo).toBeNull();
      expect(lido.objeto?.conteudo.equals(doGit)).toBe(true);
    }
  });

  it('remoto com credencial no endereço: o recibo leva o endereço sem ela', () => {
    expect(urlSemCredencial('https://usuario:token-secreto@github.com/operacaoroot/root-base.git?x=1#y')).toBe(
      'https://github.com/operacaoroot/root-base.git',
    );
    expect(urlSemCredencial('git@github-root-base:operacaoroot/root-base.git')).toBe('git@github-root-base:operacaoroot/root-base.git');
    const { vault: v } = cenario();
    git(v, 'remote', 'set-url', 'origin', 'https://pedro:ghp_abc123@example.com/base.git');
    expect(lerRepositorioDaVault(v, []).montante.repositorio).toBe('https://example.com/base.git');
  });

  it('FETCH_HEAD: o remoto da busca é a linha que o pull funde, não a `not-for-merge`', () => {
    const texto =
      'aaaa000000000000000000000000000000000000\tnot-for-merge\tbranch \'outro\' of x\n' +
      'bbbb000000000000000000000000000000000000\t\tbranch \'main\' of x\n';
    expect(remotoDoFetchHead(texto)).toBe('bbbb000000000000000000000000000000000000');
    expect(remotoDoFetchHead('')).toBeNull();
  });

  it('a configuração do git, lida sem o git: seção, subseção, aspas, comentário e o último valor', () => {
    const c = lerConfigDoGit(
      '[core]\n\tautocrlf = false ; comentário\n[remote "origin"]\n\turl = "git@x:y.git"\n[Core]\n\tAutoCRLF = input\n',
    );
    expect(motivoNaConfig(c)).toMatch(/core\.autocrlf=input/);
    expect(motivoNaConfig(lerConfigDoGit('[include]\n\tpath = ~/.outro\n'))).toMatch(/inclui outro arquivo/);
    expect(motivoNaConfig(lerConfigDoGit('[core]\n\tautocrlf = false\n'))).toBeNull();
    expect(atributosConvertem('*.md\t!text\n*.png -crlf\n')).toBeNull();
    expect(atributosConvertem('[attr]texto text eol=lf\n')).toMatch(/attr/);
  });

  it('a diferença de pacote: cópia e inserção, e a recusa quando a base não é a dela', () => {
    const base = Buffer.from('abcdefghij');
    // origem 10, destino 7; copia 3 bytes do deslocamento 2 ("cde"), insere "XYZW".
    const delta = Buffer.from([10, 7, 0x91, 2, 3, 4, ...Buffer.from('XYZW')]);
    expect(aplicarDiferenca(base, delta).toString()).toBe('cdeXYZW');
    expect(() => aplicarDiferenca(Buffer.from('curta'), delta)).toThrow(/não é desta base/);
    expect(dataDoCommit(Buffer.from('tree x\ncommitter A <a@b> 1790812502 +0000\n\nmsg'))?.toISOString()).toBe(
      new Date(1790812502 * 1000).toISOString(),
    );
  });
});

// ===========================================================================
// E-20.8 — NFC só na identidade (C19-02, R-1)
// ===========================================================================

describe('E-20.8: o NFC monta a chave; a pertença usa os bytes do disco', () => {
  const NFC = 'Decisões/aprovação.md'.normalize('NFC');
  const NFD = NFC.normalize('NFD');

  it('nome em NFD no disco e no índice: é membro, com a chave em NFC e os bytes certos lidos', () => {
    const raiz = pasta();
    escrever(raiz, NFD, corpo('nfd'));
    versionarVault(raiz);
    expect(lsFiles(raiz)[0].caminho).toBe(NFD);
    const { pertenca } = classificar(raiz);
    expect(membros(pertenca)).toEqual([NFC]);
    expect(pertenca.membros[0].nota.content).toBe(corpo('nfd').trim());
    expect(pertenca.foraDaColecao).toEqual([]);
  });

  it('dois MEMBROS que viram a mesma chave em NFC: os dois saem, e a chave vai aos vistos', () => {
    const raiz = pasta();
    iniciarGit(raiz);
    const texto = Buffer.from(corpo('colisão'));
    escrever(raiz, 'fonte.md', texto);
    const blob = git(raiz, 'hash-object', '-w', 'fonte.md').trim();
    git(raiz, 'update-index', '--add', '--cacheinfo', `100644,${blob},${NFC}`);
    git(raiz, 'update-index', '--add', '--cacheinfo', `100644,${blob},${NFD}`);
    const indice = lerIndiceDoGit(indiceDe(raiz));
    const arquivos: ArquivoNoDisco[] = [NFC, NFD].map((c) => ({ caminho: Buffer.from(c), bytes: texto, modificadoEm: new Date() }));
    const pertenca = classificarAVault({ arquivos, indice: indice.ok ? indice.entradas : null, naoVerificavel: null });
    expect(pertenca.membros).toEqual([]);
    expect(pertenca.contagens.colisoesNFC).toBe(2);
    expect(pertenca.vistos).toEqual([NFC]);
  });

  it('um arquivo solto em NFD ao lado da nota rastreada em NFC não tira a nota da atualização (R-1)', () => {
    const raiz = pasta();
    iniciarGit(raiz);
    const texto = Buffer.from(corpo('legítima'));
    escrever(raiz, 'fonte.md', texto);
    const blob = git(raiz, 'hash-object', '-w', 'fonte.md').trim();
    git(raiz, 'update-index', '--add', '--cacheinfo', `100644,${blob},${NFC}`);
    const indice = lerIndiceDoGit(indiceDe(raiz));
    const arquivos: ArquivoNoDisco[] = [
      { caminho: Buffer.from(NFC), bytes: texto, modificadoEm: new Date() },
      { caminho: Buffer.from(NFD), bytes: Buffer.from('criado à mão na VPS'), modificadoEm: new Date() },
    ];
    const pertenca = classificarAVault({ arquivos, indice: indice.ok ? indice.entradas : null, naoVerificavel: null });
    expect(membros(pertenca)).toEqual([NFC]);
    expect(situacoes(pertenca)).toEqual([`nao_rastreado:${NFC}`]);
    expect(pertenca.vistos).toEqual([]);
  });
});

// ===========================================================================
// E-20.9 — o cabeçalho (C19-05), e a leitura de antes intacta
// ===========================================================================

/** A leitura de antes da ROOT-20, copiada de `obsidian.service.ts` em e1100f0. */
function leituraAntiga(rel: string, raw: string) {
  let body = raw;
  const tags = new Set<string>();
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    body = raw.slice(fm[0].length);
    const inline = fm[1].match(/^tags:\s*\[([^\]]*)\]/m);
    if (inline) inline[1].split(',').forEach((t) => t.trim() && tags.add(t.trim().replace(/['"]/g, '')));
    const block = fm[1].match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
    if (block) block[1].split('\n').forEach((l) => { const m = l.match(/-\s*(.+)/); if (m) tags.add(m[1].trim()); });
  }
  for (const m of body.matchAll(/(?:^|\s)#([a-z0-9_\-/]{2,})/gi)) tags.add(m[1]);
  const links = [...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim());
  const h1 = body.match(/^#\s+(.+)$/m);
  const title = (h1?.[1] ?? rel.replace(/\.md$/i, '').split('/').pop() ?? rel).trim();
  return { title, tags: [...tags], content: body.trim(), links: [...new Set(links)], wordCount: body.split(/\s+/).filter(Boolean).length };
}

describe('E-20.9: o cabeçalho da base, com `\\r\\n`, e a leitura de antes intacta para `\\n`', () => {
  const cabecalho = [
    '---',
    'kind: decisao          # obrigatório: regra | definicao | dicionario | decisao | fato | nota',
    'dono: Rodrigo',
    'valido_de: 2026-09-15',
    'valido_ate:            # opcional: vazio = vigente',
    'substitui: "[[50-Projetos/Antiga decisão]]"',
    'tags: [root, governanca]',
    '---',
  ];
  const corpoDaNota = '# VPS própria\n\nDecidido em 15/09: plano mensal. Ver [[Outra nota|apelido]] #infra.';

  it('com `\\n`, com `\\r\\n` e com BOM: o mesmo cabeçalho, o mesmo título e o corpo sem o cabeçalho', () => {
    const lf = `${cabecalho.join('\n')}\n${corpoDaNota}`;
    for (const raw of [lf, lf.replace(/\n/g, '\r\n'), `﻿${lf}`]) {
      const n = lerNotaDaVault('60-Decisoes/vps.md', raw);
      expect(n.cabecalho).toEqual({
        presente: true,
        geradoPeloOs: false,
        kind: ContextKind.decisao,
        validFrom: new Date(Date.UTC(2026, 8, 15)),
        validUntil: null,
        substitui: '[[50-Projetos/Antiga decisão]]',
        avisos: [],
      });
      expect(n.title).toBe('VPS própria');
      expect(n.content.replace(/\r\n/g, '\n')).toBe(corpoDaNota);
      expect(n.content).not.toContain('kind:');
      expect(n.tags.sort()).toEqual(['governanca', 'infra', 'root']);
    }
  });

  it('para arquivo com `\\n` a leitura é a de antes, byte a byte — nenhuma nota muda de hash no deploy', () => {
    const corpus = [
      'sem cabeçalho nenhum\n# Título no meio\n',
      `${cabecalho.join('\n')}\n${corpoDaNota}`,
      '---\ntags:\n  - a\n  - b\n---\ncorpo com --- régua\n---\nfim',
      '---\naberto e nunca fechado\n# H1\n',
      '---\nkind: regra\n---no-meio\nresto',
      '---\n---\nvazio',
      '# só título',
      '',
    ];
    for (const raw of corpus) {
      const { cabecalho: _c, path: _p, folder: _f, ...nova } = lerNotaDaVault('pasta/nota.md', raw);
      expect(nova, JSON.stringify(raw)).toEqual(leituraAntiga('pasta/nota.md', raw));
    }
  });

  it('`kind` sem acento e sem caixa; desconhecido vira nota com aviso; data inválida fica vazia com aviso', () => {
    expect(lerNotaDaVault('x.md', '---\nkind: Definição\n---\nx').cabecalho.kind).toBe(ContextKind.definicao);
    expect(lerNotaDaVault('x.md', '---\nkind: dicionário\n---\nx').cabecalho.kind).toBe(ContextKind.dicionario);
    const torta = lerNotaDaVault('x.md', '---\nkind: politica\nvalido_de: 2026-02-30\nvalido_ate: amanhã\n---\nx').cabecalho;
    expect(torta).toMatchObject({ kind: ContextKind.nota, validFrom: null, validUntil: null });
    expect(torta.avisos).toHaveLength(3);
    expect(lerNotaDaVault('x.md', 'sem cabeçalho').cabecalho).toMatchObject({ presente: false, kind: ContextKind.nota });
  });

  it('a marca do gerador é lida pela mesma função do gerador, com `\\r\\n` também', () => {
    const gerada = '---\ngerado_por: root-os\ngerado_para: root\nkind: regra\n---\n# Regra\n\ncorpo';
    expect(lerNotaDaVault('regras-da-casa/x.md', gerada).cabecalho.geradoPeloOs).toBe(true);
    expect(lerNotaDaVault('regras-da-casa/x.md', gerada.replace(/\n/g, '\r\n')).cabecalho.geradoPeloOs).toBe(true);
    expect(lerNotaDaVault('x.md', '---\ngerado_por: alguem\n---\nx').cabecalho.geradoPeloOs).toBe(false);
  });
});

describe('R-8: `substitui` normalizado antes do NFC', () => {
  const membrosDaVolta = new Set(['50-Projetos/Antiga decisão.md', '60-Decisoes/vps.md', 'a/Única.md', 'x/Dup.md', 'y/Dup.md']);
  const casos: Array<[string, string, string | null]> = [
    ['[[50-Projetos/Antiga decisão]]', '60-Decisoes/vps.md', '50-Projetos/Antiga decisão.md'],
    ['[[50-Projetos/Antiga decisão|a antiga]]', '60-Decisoes/vps.md', '50-Projetos/Antiga decisão.md'],
    ['[[50-Projetos/Antiga decisão#Contexto]]', '60-Decisoes/vps.md', '50-Projetos/Antiga decisão.md'],
    ['./vps-anterior', '60-Decisoes/vps.md', '60-Decisoes/vps-anterior.md'],
    ['../50-Projetos/Antiga decisão.md', '60-Decisoes/vps.md', '50-Projetos/Antiga decisão.md'],
    ['Única', '60-Decisoes/vps.md', 'a/Única.md'],
    ['[[Antiga decisão]]', '60-Decisoes/vps.md', '50-Projetos/Antiga decisão.md'],
    ['Dup', '60-Decisoes/vps.md', null],
    ['../../fora.md', '60-Decisoes/vps.md', null],
    ['[[vps]]', '60-Decisoes/vps.md', null],
  ];
  for (const [valor, nota, esperado] of casos) {
    it(`"${valor}" a partir de ${nota}`, () => {
      expect(resolverSubstitui(valor, nota, membrosDaVolta).caminho).toBe(esperado);
    });
  }
  it('o NFC vem depois: `substitui` em NFD resolve para a chave em NFC', () => {
    const r = resolverSubstitui('[[50-Projetos/Antiga decisão]]'.normalize('NFD'), '60-Decisoes/vps.md', membrosDaVolta);
    expect(r.caminho).toBe('50-Projetos/Antiga decisão.md'.normalize('NFC'));
  });
});

// ===========================================================================
// O recibo (C19-08, R-9) — regras puras
// ===========================================================================

function reciboOk(): ReciboDaVault {
  return {
    colecao: 'vault:root-base',
    fonte: 'pasta',
    inicioEm: '2026-10-02T12:00:00.000Z',
    fimEm: '2026-10-02T12:00:05.000Z',
    montante: {
      repositorio: 'git@github-root-base:operacaoroot/root-base.git',
      commit: 'e2a21785cd101eb2b73c4d5628dd32d94773c72f',
      commitEm: '2026-09-30T23:54:30.000Z',
      commitEmMotivo: null,
      ultimaBuscaEm: '2026-10-02T11:55:00.000Z',
      ultimaBuscaFalhouEm: null,
      ultimoAvancoEm: '2026-09-30T23:55:02.000Z',
      remotoNaBusca: 'e2a21785cd101eb2b73c4d5628dd32d94773c72f',
      atrasado: false,
      buscaParada: false,
      errosDoPull: 'não visível no container',
      mudouNoMeio: false,
    },
    descoberta: {
      mdNoDisco: 399,
      rastreados: 397,
      naoRastreados: 2,
      alteradosForaDoGit: 0,
      apagadosForaDoGit: 0,
      naoVerificaveis: 0,
      colisoesNFC: 0,
      geradosExcluidos: 0,
      nomesIlegiveis: 0,
      pastasForaDaColecao: {},
      membros: 397,
      rastreamento: 'ok',
      avisos: [],
    },
    leitura: { lidos: 0, reaproveitados: 397, falhas: 0 },
    indexacao: { gravadas: 397, preservadas: 0, espelhoDoOnboardingPreservado: 0 },
    vetorizacao: null,
    projecao: { ...resumoVazio(), inalteradas: 397, falhou: null },
    falha: null,
  };
}

describe('C19-08: o resultado do recibo nunca diz `ok` com falha', () => {
  it('a volta limpa é `ok`, e não leva motivo', () => {
    expect(resultadoDaVolta(reciboOk())).toEqual({ resultado: 'ok', motivos: [] });
  });

  const perturbacoes: Array<[string, (r: ReciboDaVault) => void, 'parcial' | 'falhou']> = [
    ['falha lançada', (r) => { r.falha = 'banco fora do ar'; }, 'falhou'],
    ['rastreamento não verificável', (r) => { (r.descoberta as { rastreamento: string }).rastreamento = 'índice ilegível'; }, 'falhou'],
    ['projeção que falhou', (r) => { r.projecao!.falhou = 'VaultSuspeitaError'; }, 'falhou'],
    ['projeção que não rodou', (r) => { r.projecao = null; }, 'falhou'],
    ['vault atrás do remoto', (r) => { (r.montante as { atrasado: boolean }).atrasado = true; }, 'parcial'],
    ['busca parada', (r) => { (r.montante as { buscaParada: boolean }).buscaParada = true; }, 'parcial'],
    ['HEAD que andou no meio', (r) => { (r.montante as { mudouNoMeio: boolean }).mudouNoMeio = true; }, 'parcial'],
    ['alterado fora do git', (r) => { (r.descoberta as { alteradosForaDoGit: number }).alteradosForaDoGit = 1; }, 'parcial'],
    ['apagado fora do git', (r) => { (r.descoberta as { apagadosForaDoGit: number }).apagadosForaDoGit = 1; }, 'parcial'],
    ['entrada não verificável', (r) => { (r.descoberta as { naoVerificaveis: number }).naoVerificaveis = 1; }, 'parcial'],
    ['colisão NFC', (r) => { (r.descoberta as { colisoesNFC: number }).colisoesNFC = 2; }, 'parcial'],
    ['arquivo que não leu', (r) => { r.leitura.falhas = 1; }, 'parcial'],
    ['nota sem vetor', (r) => { r.vetorizacao = { pedidos: 2, comVetor: 1, semVetor: 1, descricao: 'x' }; }, 'parcial'],
    ['nota que falhou na projeção', (r) => { r.projecao!.falhas = 1; }, 'parcial'],
    ['arquivamento segurado', (r) => { r.projecao!.arquivamentoRecusado = 9; }, 'parcial'],
    ['movimento segurado', (r) => { r.projecao!.movimentosRecusados = 9; }, 'parcial'],
  ];
  for (const [nome, mexer, esperado] of perturbacoes) {
    it(`${nome} → ${esperado}, com o motivo escrito`, () => {
      const r = reciboOk();
      mexer(r);
      const saida = resultadoDaVolta(r);
      expect(saida.resultado).toBe(esperado);
      expect(saida.motivos.length).toBeGreaterThan(0);
    });
  }
});

describe('R-9 (ii): quando o recibo vira evento', () => {
  const agora = new Date('2026-10-02T12:00:00Z');
  it('primeiro recibo, escrita na memória, mudança de estado e a batida diária', () => {
    const r = reciboOk();
    const a = assinaturaDoRecibo(r, resultadoDaVolta(r));
    expect(deveRegistrar({ anterior: null, assinatura: a, recibo: r, agora }).registrar).toBe(true);
    const recente = { assinatura: a, ocorreuEm: new Date(agora.getTime() - 60_000) };
    expect(deveRegistrar({ anterior: recente, assinatura: a, recibo: r, agora })).toEqual({
      registrar: false,
      porque: 'nada mudou desde o último recibo',
    });
    expect(deveRegistrar({ anterior: { ...recente, assinatura: 'outra' }, assinatura: a, recibo: r, agora }).registrar).toBe(true);
    const velho = { assinatura: a, ocorreuEm: new Date(agora.getTime() - INTERVALO_DA_BATIDA_MS) };
    expect(deveRegistrar({ anterior: velho, assinatura: a, recibo: r, agora }).porque).toMatch(/batida diária/);
    const escreveu = reciboOk();
    escreveu.projecao!.alteradas = 1;
    expect(deveRegistrar({ anterior: recente, assinatura: a, recibo: escreveu, agora }).porque).toMatch(/escreveu na memória/);
  });

  it('a assinatura ignora o que anda a cada volta (hora da busca, leitura) e pega o que importa', () => {
    const base = reciboOk();
    const a = assinaturaDoRecibo(base, resultadoDaVolta(base));
    const outraHora = reciboOk();
    (outraHora.montante as { ultimaBuscaEm: string }).ultimaBuscaEm = '2026-10-02T11:59:59.000Z';
    outraHora.inicioEm = '2026-10-02T12:30:00.000Z';
    outraHora.leitura = { lidos: 3, reaproveitados: 394, falhas: 0 };
    expect(assinaturaDoRecibo(outraHora, resultadoDaVolta(outraHora))).toBe(a);
    const outroCommit = reciboOk();
    (outroCommit.montante as { commit: string }).commit = 'f'.repeat(40);
    expect(assinaturaDoRecibo(outroCommit, resultadoDaVolta(outroCommit))).not.toBe(a);
    const outroConjunto = reciboOk();
    outroConjunto.projecao!.guardas.arquivamento = { quantidade: 9, conjunto: 'abc' };
    expect(assinaturaDoRecibo(outroConjunto, resultadoDaVolta(outroConjunto))).not.toBe(a);
  });

  it('os caminhos vão sob `sigiloso`, com teto por situação', () => {
    const fora = Array.from({ length: CAMINHOS_POR_SITUACAO + 5 }, (_, i) => ({
      caminho: `pasta/nao-rastreada-${i}.md`,
      situacao: 'nao_rastreado' as const,
    }));
    const lista = caminhosSigilosos(fora, false);
    expect(lista.nao_rastreado.total).toBe(CAMINHOS_POR_SITUACAO + 5);
    expect(lista.nao_rastreado.caminhos).toHaveLength(CAMINHOS_POR_SITUACAO);
    expect(lista.nao_rastreado.caminhos[0]).toMatchObject({ __sigiloso: true });
  });
});
