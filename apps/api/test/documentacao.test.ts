/*
 * ============================================================================
 * O GERADOR DE DOCUMENTAÇÃO (RF-M-07) — a promessa do selo, provada
 * ============================================================================
 *
 * O critério de pronto da fatia é uma frase: "rodar duas vezes não sobrescreve
 * arquivo editado à mão depois da geração; o marcador é respeitado". Ela se
 * decompõe em SEIS estados de arquivo, e os seis têm caso aqui:
 *
 *   1. nossa e intocada        → pode reescrever (e não reescreve à toa)
 *   2. nossa e editada         → PRESERVA, no corpo E no cabeçalho
 *   3. nunca foi nossa         → PRESERVA
 *   4. nossa, de outro lugar   → PRESERVA (cópia, renomeação, arquivo movido)
 *   5. nossa, de outra empresa → PRESERVA (duas empresas na mesma pasta)
 *   6. marcador ilegível       → PRESERVA
 *
 * O CASO 2 COM O CABEÇALHO É O QUE ESTA SUÍTE MAIS DEVE AO REVISOR. Na primeira
 * versão o resumo cobria só o corpo, e o painel de propriedades do Obsidian —
 * que é o jeito mais comum de uma pessoa anotar uma nota gerada — editava
 * exatamente o que ficava de fora. A edição sobrevivia enquanto o registro não
 * mudasse e morria na primeira volta em que mudasse junto.
 *
 * A suíte roda SEM BANCO de propósito. `coletarEstado` é a única função que fala
 * com o Postgres, e ela foi deixada de fora da divisão justamente para que a
 * decisão de escrita — que é onde mora a promessa — pudesse ser provada em
 * qualquer máquina, sem `TEST_DATABASE_URL`. Um teste que se pula sozinho é um
 * teste que ninguém vê falhar.
 *
 * A vault é uma pasta temporária de verdade, não um mock de `fs`: o que se está
 * provando é o comportamento contra disco (arquivo que existe, arquivo que não
 * existe, arquivo com conteúdo alheio, PASTA QUE É ATALHO PARA FORA), e um mock
 * provaria a nossa ideia do disco em vez do disco.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ContextKind, type PrismaClient } from '@prisma/client';
import {
  aplicarNaVault,
  CHAVE_DO_SELO,
  ColapsoParcialError,
  corpoDaPagina,
  decidirEscrita,
  DestinoNaoProvadoError,
  estadoVazio,
  EstadoVazioError,
  lerMarcador,
  montarPagina,
  montarPaginas,
  nomeDaNota,
  PastaDeOutraEmpresaError,
  PISO_DE_REESCRITA,
  selarPagina,
  TETO_DE_REESCRITA,
  TIPOS_DOCUMENTAVEIS,
  type ContextoDaPagina,
  type EstadoDoTenant,
  type NotaDocumentavel,
  type SoNoServicoDeDonos,
} from '../src/memory/documentacao';

const AGORA = new Date('2026-09-11T12:00:00.000Z');

const ORG = 'org-1';
const DIR = 'root-os/documentacao/root';

/** O contexto de uma página: empresa desta volta + caminho onde ela mora. */
function ctx(caminho: string, over: Partial<ContextoDaPagina> = {}): ContextoDaPagina {
  return { orgId: ORG, empresa: 'root', caminho, ...over };
}

function nota(chave: string, title: string, body: string): NotaDocumentavel {
  return {
    chave,
    kind: ContextKind.regra,
    title,
    body,
    tags: [],
    sourceType: 'operador',
    sourceRef: 'ata de reunião',
    validFrom: null,
    validUntil: null,
    versao: 1,
    atualizadoEm: AGORA,
  };
}

function estadoDeTeste(over: Partial<EstadoDoTenant> = {}): EstadoDoTenant {
  return {
    orgId: ORG,
    nome: 'ROOT',
    slug: 'root',
    modulos: ['pauta'],
    notas: [
      nota('preco-primeiro-contato', 'Preço no primeiro contato', 'Não falamos de preço antes do diagnóstico.'),
      nota('cliente-ativo', 'Cliente ativo', 'Cliente ativo é quem comprou nos últimos 90 dias.'),
    ],
    agentes: [
      {
        slug: 'curador',
        nome: 'Curador de pauta',
        missao: 'Escolher o que vira conteúdo.',
        pilar: 'conteúdo',
        tipo: 'llm',
        estado: 'rodando',
        dono: 'Pedro',
        capacidades: ['pauta.curar'],
        autonomiaAte: 'R1',
        modelo: 'claude-opus-5',
        cron: '0 9 * * *',
        tz: 'America/Sao_Paulo',
        ativo: true,
        minutosPorExecucao: 30,
        tetoCustoUsd: '0.5',
        sop: {
          proposito: 'Curar a janela.',
          gatilho: 'Toda manhã.',
          passos: ['Ler os feeds', 'Escolher três'],
          definicaoDePronto: 'Três peças na fila.',
          observacoes: null,
          versao: 1,
        },
      },
    ],
    rotinas: [
      {
        slug: 'rodada-diaria',
        nome: 'Rodada diária',
        tipo: 'pauta.rodada',
        cron: '0 8 * * *',
        tz: 'America/Sao_Paulo',
        estado: 'rodando',
        ativo: true,
        origem: 'pauta',
        agenteSlug: 'curador',
        minutosPorExecucao: 0,
      },
    ],
    conexoes: [{ key: 'google', label: 'Google', status: 'connected', conectadaEm: '2026-08-01' }],
    ...over,
  };
}

/**
 * Uma vault temporária que se PROVA vault: tem `.obsidian`.
 *
 * É o Obsidian que cria essa pasta. Nenhum caminho deste repositório escreve
 * nela — e é exatamente por isso que ela serve de prova e um `.md` não serve.
 */
function vaultDeTeste(): string {
  const raiz = mkdtempSync(path.join(os.tmpdir(), 'vault-docs-'));
  mkdirSync(path.join(raiz, '.obsidian'), { recursive: true });
  writeFileSync(path.join(raiz, '.obsidian', 'app.json'), '{}\n', 'utf8');
  writeFileSync(path.join(raiz, 'nota-de-alguem.md'), '# uma nota qualquer\n', 'utf8');
  return raiz;
}

function caminho(vault: string, nome: string): string {
  return path.join(vault, DIR, nome);
}

function ler(vault: string, nome: string): string {
  return readFileSync(caminho(vault, nome), 'utf8');
}

/** Todos os nomes sob a pasta da documentação, OCULTOS INCLUSIVE. */
function tudoQueSobrou(raiz: string, prefixo = ''): string[] {
  const saida: string[] = [];
  for (const e of readdirSync(raiz, { withFileTypes: true })) {
    const rel = prefixo ? `${prefixo}/${e.name}` : e.name;
    if (e.isDirectory()) saida.push(...tudoQueSobrou(path.join(raiz, e.name), rel));
    else saida.push(rel);
  }
  return saida;
}

// ===========================================================================
describe('o selo de geração', () => {
  it('volta a ser lido depois de escrito, com empresa e caminho declarados', () => {
    const corpo = '# Título\n\nUm corpo qualquer.\n';
    const c = ctx('regras-da-casa/x.md');
    const pagina = montarPagina({ corpo, ctx: c, tipo: 'regra', geradoEm: AGORA });

    const m = lerMarcador(pagina);
    expect(m.nosso).toBe(true);
    expect(m.selo).toMatch(/^[0-9a-f]{64}$/);
    expect(m.empresa).toBe('root');
    expect(m.caminho).toBe('regras-da-casa/x.md');
    expect(corpoDaPagina(pagina).trim()).toBe(corpo.trim());
    expect(decidirEscrita(pagina, corpo, c).acao).toBe('inalterada');
  });

  it('o `orgId` entra no selo e NÃO é escrito no arquivo', () => {
    // É o que separa "acidente" de "alguém quis": cópia, modelo e renomeação
    // param de passar, porque o valor que fecha a conta não está na vault.
    const corpo = '# x\n';
    const c = ctx('regras-da-casa/x.md');
    const pagina = montarPagina({ corpo, ctx: c, tipo: 'regra', geradoEm: AGORA });

    expect(pagina).not.toContain(ORG);
    const comOutraEmpresa = ctx('regras-da-casa/x.md', { orgId: 'outra-org' });
    expect(decidirEscrita(pagina, corpo, comOutraEmpresa)).toEqual({
      acao: 'preservar',
      motivo: 'editada',
    });
  });

  it('régua horizontal no meio do corpo não vira frontmatter', () => {
    // `---` em markdown é régua. Se `corpoDaPagina` tratasse a primeira
    // ocorrência no CORPO como fim do frontmatter, o corpo voltaria pela
    // metade e o selo nunca casaria — toda página viraria "editada à mão".
    const corpo = '# Título\n\nAntes.\n\n---\n\nDepois.\n';
    const c = ctx('regras-da-casa/x.md');
    const pagina = montarPagina({ corpo, ctx: c, tipo: 'regra', geradoEm: AGORA });

    expect(corpoDaPagina(pagina).trim()).toBe(corpo.trim());
    expect(decidirEscrita(pagina, corpo, c).acao).toBe('inalterada');
  });

  it('título com dois-pontos e com quebra de linha não quebra o cabeçalho', () => {
    const pagina = montarPagina({
      corpo: '# x\n',
      ctx: ctx('regras-da-casa/x.md', { empresa: 'root: a\nempresa' }),
      tipo: 'regra',
      geradoEm: AGORA,
    });
    // uma linha de frontmatter por chave, e o valor escapado e relido inteiro
    expect(lerMarcador(pagina).nosso).toBe(true);
    expect(pagina.split('\n').filter((l) => l.startsWith('gerado_para:')).length).toBe(1);
    expect(lerMarcador(pagina).empresa).toBe('root: a empresa');
  });

  it('arquivo sem frontmatter não é nosso', () => {
    const m = lerMarcador('# nota de alguém\n\ntexto\n');
    expect(m.nosso).toBe(false);
    expect(m.selo).toBeNull();
  });

  it('frontmatter aberto e nunca fechado não é frontmatter', () => {
    expect(lerMarcador('---\ngerado_por: root-os\nsem fechar\n').nosso).toBe(false);
  });
});

// ===========================================================================
describe('decidirEscrita: os seis estados de um arquivo', () => {
  const corpo = '# Regra\n\nprimeira versão\n';
  const c = ctx('regras-da-casa/regra.md');
  const nossa = montarPagina({ corpo, ctx: c, tipo: 'regra', geradoEm: AGORA });

  it('1. arquivo que nunca existiu → cria', () => {
    expect(decidirEscrita(null, corpo, c).acao).toBe('criar');
  });

  it('1a. nossa, intocada e com corpo igual → não reescreve (não mexe no mtime)', () => {
    expect(decidirEscrita(nossa, corpo, c).acao).toBe('inalterada');
  });

  it('1b. nossa, intocada e com corpo diferente → reescreve', () => {
    expect(decidirEscrita(nossa, '# Regra\n\nsegunda versão\n', c).acao).toBe('reescrever');
  });

  it('2. nossa e editada no CORPO → preserva', () => {
    const editado = nossa.replace('primeira versão', 'primeira versão, com um adendo do Pedro');
    expect(decidirEscrita(editado, '# Regra\n\nterceira versão\n', c)).toEqual({
      acao: 'preservar',
      motivo: 'editada',
    });
  });

  it('2a. O GRAVE: nossa e editada SÓ NO CABEÇALHO → preserva', () => {
    /*
     * O painel de propriedades do Obsidian edita exatamente isto. Marcar uma
     * nota gerada com etiqueta ou apelido é o jeito mais comum de uma pessoa
     * anotar, e com o resumo cobrindo só o corpo esta edição era invisível: a
     * página era reescrita e a propriedade morria, silenciosamente, na primeira
     * volta em que o registro também mudasse.
     */
    const comEtiqueta = nossa.replace(
      'tipo: regra\n',
      'tipo: regra\ntags: [revisar, lucas]\naliases: ["a regra dos 90 dias"]\n',
    );
    expect(decidirEscrita(comEtiqueta, '# Regra\n\nsegunda versão\n', c)).toEqual({
      acao: 'preservar',
      motivo: 'editada',
    });
    // e o caso em que o corpo NÃO mudou já era preservado antes — continua
    expect(decidirEscrita(comEtiqueta, corpo, c).acao).toBe('preservar');
  });

  it('2b. cabeçalho editado e depois re-selado sem o orgId → preserva', () => {
    // Quem edita a propriedade não tem como refazer o selo: falta o `orgId`.
    const semSelo = nossa
      .split('\n')
      .filter((l) => !l.startsWith(`${CHAVE_DO_SELO}:`))
      .join('\n');
    const cabecalhoSemSelo = lerMarcador(semSelo + '\n').cabecalhoSemSelo;
    const forjado = semSelo.replace(
      '\n---\n',
      `\n${CHAVE_DO_SELO}: ${selarPagina({
        cabecalhoSemSelo,
        corpo: corpoDaPagina(nossa),
        ctx: ctx('regras-da-casa/regra.md', { orgId: 'chute-de-quem-forja' }),
      })}\n---\n`,
    );
    expect(decidirEscrita(forjado, '# Regra\n\noutra\n', c)).toEqual({
      acao: 'preservar',
      motivo: 'editada',
    });
  });

  it('3. arquivo de outra pessoa com o mesmo nome → preserva', () => {
    expect(decidirEscrita('# anotação minha\n\nnada a ver\n', corpo, c)).toEqual({
      acao: 'preservar',
      motivo: 'alheia',
    });
  });

  it('4. nossa, mas gerada para OUTRO CAMINHO → preserva, e diz de onde veio', () => {
    // Página copiada, renomeada ou movida por cima do caminho de outra. Antes
    // era lida como nossa e intocada, e reescrita: o conteúdo movido morria.
    expect(decidirEscrita(nossa, corpo, ctx('regras-da-casa/outra.md'))).toEqual({
      acao: 'preservar',
      motivo: 'de-outro-lugar',
      declarado: 'regras-da-casa/regra.md',
    });
  });

  it('5. nossa, mas gerada para OUTRA EMPRESA → preserva, e diz qual', () => {
    expect(
      decidirEscrita(nossa, corpo, ctx('regras-da-casa/regra.md', { empresa: 'convergy' })),
    ).toEqual({ acao: 'preservar', motivo: 'de-outra-empresa', declarado: 'root' });
  });

  it('6. marcador nosso com o selo apagado → preserva', () => {
    const semSelo = nossa
      .split('\n')
      .filter((l) => !l.startsWith(`${CHAVE_DO_SELO}:`))
      .join('\n');
    expect(decidirEscrita(semSelo, corpo, c)).toEqual({
      acao: 'preservar',
      motivo: 'marcador-ilegivel',
    });
  });

  it('6a. marcador nosso sem `gerado_caminho` → preserva', () => {
    const semCaminho = nossa
      .split('\n')
      .filter((l) => !l.startsWith('gerado_caminho:'))
      .join('\n');
    expect(decidirEscrita(semCaminho, corpo, c)).toEqual({
      acao: 'preservar',
      motivo: 'marcador-ilegivel',
    });
  });

  it('re-salvo com quebra de linha de outro sistema CONTINUA sendo nosso', () => {
    /*
     * `---\r\n` fazia `startsWith('---\n')` responder "não é frontmatter". A
     * página deixava de ser reconhecida, virava "alheia", era preservada para
     * sempre e nunca mais recebia atualização — em silêncio, que é o pior jeito
     * de uma página parar de ser mantida. O BOM do Bloco de Notas fazia o mesmo.
     */
    const comCrlf = nossa.replace(/\n/g, '\r\n');
    expect(lerMarcador(comCrlf).nosso).toBe(true);
    expect(decidirEscrita(comCrlf, corpo, c).acao).toBe('inalterada');
    expect(decidirEscrita(comCrlf, '# Regra\n\nsegunda versão\n', c).acao).toBe('reescrever');

    const comBom = `\uFEFF${nossa}`;
    expect(decidirEscrita(comBom, '# Regra\n\nsegunda versão\n', c).acao).toBe('reescrever');
  });
});

// ===========================================================================
describe('as páginas', () => {
  it('nunca documentam `kind: nota` — é o que fecha o laço da vault', () => {
    // A vault é reindexada para KnowledgeNote e projetada para a memória como
    // ContextKind.nota. Documentar `nota` faria a memória voltar para dentro de
    // si mesma a cada volta.
    expect([...TIPOS_DOCUMENTAVEIS]).not.toContain(ContextKind.nota);
  });

  it('o nome do arquivo sai da CHAVE, não do título', () => {
    // Renomear a regra na tela não pode mover o arquivo e deixar um órfão.
    const n = nota('preco-primeiro-contato', 'Um título', 'x');
    const outroTitulo = { ...n, title: 'Outro título completamente diferente' };
    expect(nomeDaNota(n)).toBe(nomeDaNota(outroTitulo));
    expect(nomeDaNota(n)).toBe('regras-da-casa/preco-primeiro-contato.md');
  });

  it('cobre os seis assuntos que a fatia pede, mais o índice', () => {
    const nomes = montarPaginas(estadoDeTeste()).map((p) => p.nome);
    expect(nomes).toContain('indice.md');
    expect(nomes).toContain('conexoes.md');
    expect(nomes).toContain('regras-da-casa/preco-primeiro-contato.md');
    expect(nomes).toContain('agentes/curador.md');
    expect(nomes).toContain('rotinas/rodada-diaria.md');
  });

  it('corpo vazio vira "não consta", nunca texto inventado (RF-M-02)', () => {
    const e = estadoDeTeste({ notas: [nota('vazia', 'Vazia', '   ')] });
    const p = montarPaginas(e).find((x) => x.nome.endsWith('vazia.md'));
    expect(p?.corpo).toContain('_não consta_');
  });

  it('o dono do agente só aparece se quem coletou resolveu contra a empresa', () => {
    // `coletarEstado` usa `donosDaCasa`; aqui se prova o outro lado: dono nulo
    // vira "não consta" em vez de sumir da página ou virar string vazia.
    const e = estadoDeTeste();
    e.agentes[0].dono = null;
    const p = montarPaginas(e).find((x) => x.nome === 'agentes/curador.md');
    expect(p?.corpo).toContain('**Dono humano:** _não consta_');
  });

  it('o cliente cru do Prisma basta para `donosDaCasa` — prova de TIPO', () => {
    /*
     * Esta asserção vale no `pnpm typecheck`, não aqui: o vitest roda por
     * esbuild, que apaga tipo sem conferir. É de propósito — o lugar de a
     * mudança aparecer é o typecheck, e o que ela substitui é um `as never`,
     * que não avisava em lugar nenhum. No dia em que `donosDaCasa` passar a
     * pedir algo que só o `PrismaService` do Nest tem, `SoNoServicoDeDonos`
     * deixa de ser vazio e esta linha fica vermelha.
     */
    const prova: [SoNoServicoDeDonos] extends [never] ? true : never = true;
    expect(prova).toBe(true);
    // e o outro lado da mesma verdade, em runtime: `user` existe no cliente cru
    const chave: keyof PrismaClient | 'user' = 'user';
    expect(chave).toBe('user');
  });
});

// ===========================================================================
describe('rodar o comando contra uma vault de verdade', () => {
  let vault: string;
  beforeEach(() => {
    vault = vaultDeTeste();
  });
  afterEach(() => rmSync(vault, { recursive: true, force: true }));

  function rodar(estado: EstadoDoTenant, opcoes = {}) {
    return aplicarNaVault(vault, DIR, estado, montarPaginas(estado), {
      geradoEm: AGORA,
      ...opcoes,
    });
  }

  it('a primeira volta cria tudo; a segunda não reescreve nada', () => {
    const e = estadoDeTeste();

    const um = rodar(e);
    expect(um.criadas.length).toBeGreaterThan(0);
    expect(um.reescritas).toEqual([]);

    const mtimeAntes = statSync(caminho(vault, 'indice.md')).mtimeMs;

    const dois = rodar(e);
    expect(dois.criadas).toEqual([]);
    expect(dois.reescritas).toEqual([]);
    expect(dois.inalteradas.length).toBe(um.criadas.length);
    // nem o mtime muda: é ele que dispara a reindexação da vault
    expect(statSync(caminho(vault, 'indice.md')).mtimeMs).toBe(mtimeAntes);
  });

  it('O CRITÉRIO DA FATIA: arquivo editado à mão sobrevive à volta seguinte', () => {
    const e = estadoDeTeste();
    rodar(e);

    const alvo = 'regras-da-casa/cliente-ativo.md';
    const editado = ler(vault, alvo).replace(
      'Cliente ativo é quem comprou nos últimos 90 dias.',
      'Cliente ativo é quem comprou nos últimos 90 dias. (Lucas: mudamos para 120 em set/26.)',
    );
    writeFileSync(caminho(vault, alvo), editado, 'utf8');

    // o estado do sistema muda — é o caso em que o gerador QUERIA reescrever
    const e2 = estadoDeTeste();
    e2.notas[1] = nota('cliente-ativo', 'Cliente ativo', 'Cliente ativo é quem comprou em 60 dias.');

    const r = rodar(e2);

    expect(r.editadasAMao).toEqual([alvo]);
    expect(r.reescritas).not.toContain(alvo);
    expect(ler(vault, alvo)).toBe(editado);

    // e continua sobrevivendo na volta seguinte, e na seguinte
    rodar(e2);
    expect(ler(vault, alvo)).toBe(editado);
  });

  it('O CRITÉRIO DA FATIA, PELO PAINEL DE PROPRIEDADES: etiqueta sobrevive', () => {
    // Mesma promessa, pelo caminho que o revisor mostrou ser o comum: a pessoa
    // não abre o markdown, ela põe uma etiqueta na barra de propriedades.
    const e = estadoDeTeste();
    rodar(e);

    const alvo = 'regras-da-casa/cliente-ativo.md';
    const comEtiqueta = ler(vault, alvo).replace('tipo: regra\n', 'tipo: regra\ntags: [revisar]\n');
    writeFileSync(caminho(vault, alvo), comEtiqueta, 'utf8');

    const e2 = estadoDeTeste();
    e2.notas[1] = nota('cliente-ativo', 'Cliente ativo', 'Cliente ativo é quem comprou em 60 dias.');

    const r = rodar(e2);
    expect(r.editadasAMao).toEqual([alvo]);
    expect(ler(vault, alvo)).toBe(comEtiqueta);
    rodar(e2);
    expect(ler(vault, alvo)).toBe(comEtiqueta);
  });

  it('página nossa COPIADA por cima de outro caminho não é reescrita', () => {
    const e = estadoDeTeste();
    rodar(e);

    const origem = 'regras-da-casa/preco-primeiro-contato.md';
    const destino = 'regras-da-casa/cliente-ativo.md';
    const copiada = ler(vault, origem);
    writeFileSync(caminho(vault, destino), copiada, 'utf8');

    const r = rodar(e);

    expect(r.deOutroLugar).toEqual([{ nome: destino, declarado: origem }]);
    expect(r.reescritas).not.toContain(destino);
    expect(ler(vault, destino)).toBe(copiada);
  });

  it('duas empresas na mesma pasta: a biblioteca sozinha não mistura', () => {
    /*
     * O COMANDO se protege acrescentando o apelido da empresa ao caminho. Esta
     * é a prova de que a BIBLIOTECA também se protege — é ela que promete, e
     * quem chama pode ser outro amanhã. Antes, gerar a segunda empresa aqui
     * reescrevia as páginas da primeira com o conteúdo da segunda.
     */
    const root = estadoDeTeste();
    rodar(root);
    const antes = ler(vault, 'indice.md');
    const antesDaRegra = ler(vault, 'regras-da-casa/preco-primeiro-contato.md');
    const quantosAntes = tudoQueSobrou(path.join(vault, DIR)).length;

    const convergy = estadoDeTeste({
      orgId: 'org-2',
      nome: 'Convergy',
      slug: 'convergy',
      notas: [
        nota('preco-primeiro-contato', 'Preço', 'Outra empresa, outra regra.'),
        nota('so-da-convergy', 'Só da Convergy', 'Esta regra a ROOT não tem.'),
      ],
    });

    expect(() =>
      aplicarNaVault(vault, DIR, convergy, montarPaginas(convergy), { geradoEm: AGORA }),
    ).toThrow(PastaDeOutraEmpresaError);

    // nada reescrito E nada criado: a metade aditiva também mistura
    expect(ler(vault, 'indice.md')).toBe(antes);
    expect(ler(vault, 'regras-da-casa/preco-primeiro-contato.md')).toBe(antesDaRegra);
    expect(tudoQueSobrou(path.join(vault, DIR)).length).toBe(quantosAntes);
  });

  it('mas a pasta de outra empresa DENTRO da nossa não trava a geração', () => {
    /*
     * A recusa acima é sobre disputar CAMINHO, não sobre estar debaixo da
     * pasta. `--pasta root-os/documentacao/root` para a vizinha produz
     * `.../root/vizinha/`, uma árvore inteira e coerente que não encosta em
     * nenhuma página da ROOT. Recusar aí travaria a ROOT por um vizinho que
     * não disputa nada com ela — e isso aconteceu na primeira tentativa deste
     * conserto, contra o banco de verdade.
     */
    const root = estadoDeTeste();
    rodar(root);

    const vizinha = estadoDeTeste({
      orgId: 'org-2',
      nome: 'Vizinha',
      slug: 'vizinha',
      notas: [nota('so-da-vizinha', 'Só da vizinha', 'Nada a ver com a ROOT.')],
    });
    aplicarNaVault(vault, `${DIR}/vizinha`, vizinha, montarPaginas(vizinha), { geradoEm: AGORA });

    const r = rodar(root);
    expect(r.inalteradas.length).toBe(montarPaginas(root).length);
    // e as páginas da vizinha não contam como órfãs nossas
    expect(r.orfas).toEqual([]);
  });

  it('arquivo que nunca foi nosso não é tocado', () => {
    const alheio = '# Minhas anotações\n\nnada a ver com o sistema\n';
    mkdirSync(path.join(vault, DIR, 'regras-da-casa'), { recursive: true });
    writeFileSync(caminho(vault, 'regras-da-casa/cliente-ativo.md'), alheio, 'utf8');

    const r = rodar(estadoDeTeste());

    expect(r.alheias).toEqual(['regras-da-casa/cliente-ativo.md']);
    expect(ler(vault, 'regras-da-casa/cliente-ativo.md')).toBe(alheio);
    // e o resto foi escrito normalmente
    expect(r.criadas).toContain('indice.md');
  });

  it('--simular decide tudo e não encosta no disco', () => {
    const r = rodar(estadoDeTeste(), { simular: true });
    expect(r.simulado).toBe(true);
    expect(r.criadas.length).toBeGreaterThan(0);
    expect(() => ler(vault, 'indice.md')).toThrow();
  });

  it('página que deixou de corresponder vira órfã e NÃO é apagada', () => {
    rodar(estadoDeTeste());
    const orfa = 'regras-da-casa/cliente-ativo.md';
    const antes = ler(vault, orfa);

    const e2 = estadoDeTeste({
      notas: [
        nota('preco-primeiro-contato', 'Preço no primeiro contato', 'Não falamos de preço antes do diagnóstico.'),
      ],
    });
    const r = rodar(e2);

    expect(r.orfas).toContain(orfa);
    expect(ler(vault, orfa)).toBe(antes);
  });

  it('nome de página com ".." não escreve fora da pasta', () => {
    const e = estadoDeTeste();
    const paginas = montarPaginas(e);
    paginas[0] = { ...paginas[0], nome: '../../fora.md' };
    expect(() => aplicarNaVault(vault, DIR, e, paginas, { geradoEm: AGORA })).toThrow();
  });

  it('a gravação é atômica: não sobra arquivo parcial nem temporário', () => {
    rodar(estadoDeTeste());
    const sobras = tudoQueSobrou(path.join(vault, DIR)).filter((n) =>
      n.split('/').some((p) => p.startsWith('.')),
    );
    expect(sobras).toEqual([]);
    // e o conteúdo está inteiro
    expect(ler(vault, 'indice.md').trimEnd().endsWith('[[conexoes|Conexões]]')).toBe(true);
  });

  it('arquivo que muda ENTRE a decisão e a gravação não é sobrescrito', () => {
    /*
     * A decisão e a escrita estão separadas pela volta inteira: coleta, teto,
     * dezenas de gravações. Quem está com o Obsidian aberto pode editar a
     * página nesse intervalo, e sem reler a promessa valeria para o estado do
     * disco no COMEÇO do comando, não para o arquivo que vai ser sobrescrito.
     */
    const e = estadoDeTeste();
    rodar(e);

    const alvo = 'regras-da-casa/cliente-ativo.md';
    const e2 = estadoDeTeste();
    e2.notas[1] = nota('cliente-ativo', 'Cliente ativo', 'Cliente ativo é quem comprou em 60 dias.');

    const intruso = '# escrito por outra mão no meio da volta\n';
    const r = rodar(e2, {
      antesDeGravar: (nome: string) => {
        if (nome === alvo) writeFileSync(caminho(vault, alvo), intruso, 'utf8');
      },
    });

    expect(r.mudouDuranteAVolta).toEqual([alvo]);
    expect(r.reescritas).not.toContain(alvo);
    expect(ler(vault, alvo)).toBe(intruso);
  });
});

// ===========================================================================
describe('as guardas — a lição da onda 9, com a prova certa', () => {
  let vault: string;
  let fora: string | null = null;
  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
    if (fora) rmSync(fora, { recursive: true, force: true });
    fora = null;
  });

  it('pasta sem `.obsidian` NÃO é prova de vault: recusa', () => {
    // O `OBSIDIAN_VAULT_HOST` da VPS aponta para /srv/marketing-os/vault, que o
    // CLAUDE.md do projeto diz não ser a vault real.
    vault = mkdtempSync(path.join(os.tmpdir(), 'vault-morta-'));
    const e = estadoDeTeste();

    expect(() => aplicarNaVault(vault, DIR, e, montarPaginas(e), { geradoEm: AGORA })).toThrow(
      DestinoNaoProvadoError,
    );
    expect(() => ler(vault, 'indice.md')).toThrow();
  });

  it('A PROVA NÃO PODE SER PRODUZIDA PELO PRÓPRIO SISTEMA', () => {
    /*
     * A guarda antiga exigia um `.md` em algum lugar da árvore. Ela pegava a
     * pasta VAZIA (o caso da onda 9) e não pegava o caso real: basta um arquivo
     * aparecer em `/srv/marketing-os/vault` para a sonda passar dali em diante
     * — e quem faz o arquivo aparecer é o próprio gerador, na volta anterior.
     * Recusa na primeira volta, alguém destrava "só desta vez", e a partir da
     * segunda ela nunca mais recusa.
     */
    vault = mkdtempSync(path.join(os.tmpdir(), 'vault-fabricada-'));
    const e = estadoDeTeste();

    const primeira = aplicarNaVault(vault, DIR, e, montarPaginas(e), {
      geradoEm: AGORA,
      aceitarPastaNaoProvada: true,
    });
    expect(primeira.criadas.length).toBeGreaterThan(0);
    // a pasta agora está cheia de .md escritos por nós
    expect(tudoQueSobrou(path.join(vault, DIR)).some((n) => n.endsWith('.md'))).toBe(true);

    // e mesmo assim a guarda continua recusando: `.md` nosso não é identidade
    expect(() => aplicarNaVault(vault, DIR, e, montarPaginas(e), { geradoEm: AGORA })).toThrow(
      DestinoNaoProvadoError,
    );
  });

  it('a recusa de pasta se destrava conscientemente, e só assim', () => {
    vault = mkdtempSync(path.join(os.tmpdir(), 'vault-nova-'));
    const e = estadoDeTeste();
    const r = aplicarNaVault(vault, DIR, e, montarPaginas(e), {
      geradoEm: AGORA,
      aceitarPastaNaoProvada: true,
    });
    expect(r.criadas).toContain('indice.md');
  });

  it('ATALHO dentro da vault não escreve fora dela', () => {
    /*
     * A conferência de escape era só LEXICAL — `resolve()` + prefixo responde
     * sobre o texto do caminho, e um link simbólico não aparece no texto. Com
     * `<vault>/fuga` apontando para fora, a árvore inteira da documentação era
     * escrita fora da vault, sem erro nenhum e com código de saída zero.
     */
    vault = vaultDeTeste();
    fora = mkdtempSync(path.join(os.tmpdir(), 'fora-da-vault-'));
    symlinkSync(fora, path.join(vault, 'fuga'), 'dir');

    const e = estadoDeTeste();
    expect(() =>
      aplicarNaVault(vault, 'fuga/documentacao', e, montarPaginas(e), { geradoEm: AGORA }),
    ).toThrow(/atalho/i);
    expect(readdirSync(fora)).toEqual([]);
  });

  it('ATALHO no meio do nome de uma página também não escapa', () => {
    vault = vaultDeTeste();
    fora = mkdtempSync(path.join(os.tmpdir(), 'fora-da-vault-'));
    mkdirSync(path.join(vault, DIR), { recursive: true });
    symlinkSync(fora, path.join(vault, DIR, 'regras-da-casa'), 'dir');

    const e = estadoDeTeste();
    expect(() => aplicarNaVault(vault, DIR, e, montarPaginas(e), { geradoEm: AGORA })).toThrow(
      /atalho/i,
    );
    expect(readdirSync(fora)).toEqual([]);
  });

  it('banco que devolve NADA com documentação nossa no disco: recusa antes de escrever', () => {
    vault = vaultDeTeste();
    const cheio = estadoDeTeste();
    aplicarNaVault(vault, DIR, cheio, montarPaginas(cheio), { geradoEm: AGORA });
    const antes = ler(vault, 'indice.md');

    // é assim que um papel de banco sem BYPASSRLS enxerga a empresa
    const vazio = estadoDeTeste({ notas: [], agentes: [], rotinas: [], conexoes: [] });
    expect(estadoVazio(vazio)).toBe(true);

    expect(() =>
      aplicarNaVault(vault, DIR, vazio, montarPaginas(vazio), { geradoEm: AGORA }),
    ).toThrow(EstadoVazioError);

    expect(ler(vault, 'indice.md')).toBe(antes);
  });

  it('LEITURA PARCIAL: uma família inteira que some derruba a volta', () => {
    /*
     * `estadoVazio` é conjuntiva e só pega o colapso total. Mas leitura parcial
     * não é um pouco de cada tabela: é ZERO na tabela que a conexão não alcança
     * e tudo nas outras. Sem esta guarda o índice era reescrito afirmando que a
     * empresa não tem regra nenhuma — mentira publicada com a nossa assinatura.
     */
    vault = vaultDeTeste();
    const cheio = estadoDeTeste();
    aplicarNaVault(vault, DIR, cheio, montarPaginas(cheio), { geradoEm: AGORA });
    const indiceAntes = ler(vault, 'indice.md');

    const semRegras = estadoDeTeste({ notas: [] });
    expect(estadoVazio(semRegras)).toBe(false); // a conferência antiga deixava passar

    expect(() =>
      aplicarNaVault(vault, DIR, semRegras, montarPaginas(semRegras), { geradoEm: AGORA }),
    ).toThrow(ColapsoParcialError);
    expect(ler(vault, 'indice.md')).toBe(indiceAntes);

    // e destravar é um ato de alguém, com as páginas viradas em órfãs
    const r = aplicarNaVault(vault, DIR, semRegras, montarPaginas(semRegras), {
      geradoEm: AGORA,
      aceitarColapsoParcial: true,
    });
    expect(r.orfas).toContain('regras-da-casa/cliente-ativo.md');
    expect(ler(vault, 'regras-da-casa/cliente-ativo.md')).toContain('90 dias');
  });

  it('`ColapsoParcialError` é um `EstadoVazioError` — quem trata um trata os dois', () => {
    expect(new ColapsoParcialError('x')).toBeInstanceOf(EstadoVazioError);
  });

  it('empresa realmente nova (nada no banco, nada no disco) não é recusada', () => {
    vault = vaultDeTeste();
    const vazio = estadoDeTeste({ notas: [], agentes: [], rotinas: [], conexoes: [] });
    const r = aplicarNaVault(vault, DIR, vazio, montarPaginas(vazio), { geradoEm: AGORA });
    expect(r.criadas).toContain('indice.md');
  });

  it('reescrita em massa passa do teto: faz as criações e DIZ quais segurou', () => {
    vault = vaultDeTeste();
    const muitas = Array.from({ length: 10 }, (_, i) =>
      nota(`regra-${i}`, `Regra ${i}`, `texto original ${i}`),
    );
    const e = estadoDeTeste({ notas: muitas });
    const primeira = aplicarNaVault(vault, DIR, e, montarPaginas(e), { geradoEm: AGORA });
    expect(primeira.reescritasSeguradas).toEqual([]);

    // todas mudam de uma vez, e uma regra NOVA aparece junto
    const e2 = estadoDeTeste({
      notas: [
        ...muitas.map((n, i) => ({ ...n, body: `texto trocado ${i}` })),
        nota('regra-nova', 'Regra nova', 'nasceu agora'),
      ],
    });
    const r = aplicarNaVault(vault, DIR, e2, montarPaginas(e2), { geradoEm: AGORA });

    expect(r.reescritasSeguradas.length).toBeGreaterThan(
      Math.max(PISO_DE_REESCRITA, Math.ceil(primeira.criadas.length * TETO_DE_REESCRITA)),
    );
    // o que o revisor pediu: a lista é inspecionável ANTES de destravar
    expect(r.reescritasSeguradas).toContain('regras-da-casa/regra-0.md');
    expect(r.reescritas).toEqual([]);
    // a criação passa: é aditiva e reversível, como na onda 9
    expect(r.criadas).toContain('regras-da-casa/regra-nova.md');
    expect(ler(vault, 'regras-da-casa/regra-0.md')).toContain('texto original 0');

    // e destravar é um ato de alguém
    const forcado = aplicarNaVault(vault, DIR, e2, montarPaginas(e2), {
      geradoEm: AGORA,
      aceitarReescritaEmMassa: true,
    });
    expect(forcado.reescritas.length).toBeGreaterThan(0);
    expect(ler(vault, 'regras-da-casa/regra-0.md')).toContain('texto trocado 0');
  });

  it('ÓRFÃ não entra no denominador do teto', () => {
    /*
     * Contar órfã afrouxa o teto na exata proporção do lixo acumulado: a
     * proteção fica mais fraca justamente na pasta mais bagunçada. Aqui, com 40
     * órfãs, o teto antigo (25) deixaria a volta passar; o teto certo (5) segura.
     */
    vault = vaultDeTeste();
    const vivas = Array.from({ length: 6 }, (_, i) => nota(`a-${i}`, `A ${i}`, `original ${i}`));
    const aVirarOrfa = Array.from({ length: 40 }, (_, i) => nota(`b-${i}`, `B ${i}`, `b ${i}`));
    const e = estadoDeTeste({ notas: [...vivas, ...aVirarOrfa] });
    aplicarNaVault(vault, DIR, e, montarPaginas(e), { geradoEm: AGORA });

    const e2 = estadoDeTeste({ notas: vivas.map((n, i) => ({ ...n, body: `trocado ${i}` })) });
    const r = aplicarNaVault(vault, DIR, e2, montarPaginas(e2), {
      geradoEm: AGORA,
      // o sumiço das 40 é real neste teste; o que está em prova é o teto
      aceitarColapsoParcial: true,
    });

    expect(r.orfas.length).toBe(40);
    const vivasNoDisco = 10; // 6 regras + índice + conexões + agente + rotina
    const tetoCerto = Math.max(PISO_DE_REESCRITA, Math.ceil(vivasNoDisco * TETO_DE_REESCRITA));
    const tetoSeContasseOrfas = Math.max(
      PISO_DE_REESCRITA,
      Math.ceil((vivasNoDisco + r.orfas.length) * TETO_DE_REESCRITA),
    );

    expect(r.reescritasSeguradas.length).toBeGreaterThan(tetoCerto);
    expect(r.reescritasSeguradas.length).toBeLessThanOrEqual(tetoSeContasseOrfas);
    expect(r.reescritas).toEqual([]);
    expect(ler(vault, 'regras-da-casa/a-0.md')).toContain('original 0');
  });

  it('o teto NÃO atrapalha a primeira volta, que é toda criação', () => {
    vault = vaultDeTeste();
    const muitas = Array.from({ length: 40 }, (_, i) => nota(`r-${i}`, `R ${i}`, `t ${i}`));
    const e = estadoDeTeste({ notas: muitas });
    const r = aplicarNaVault(vault, DIR, e, montarPaginas(e), { geradoEm: AGORA });
    expect(r.criadas.length).toBe(44); // 40 regras + índice + agente + rotina + conexões
    expect(r.reescritasSeguradas).toEqual([]);
  });
});
