import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path, { join } from 'node:path';

/** A raiz de `apps/api`, do mesmo jeito que `adversarial.test.ts` a acha. */
const RAIZ_DA_API = join(__dirname, '..');

/*
 * ============================================================================
 * A VAULT DO OBSIDIAN LIDA DO GOOGLE DRIVE
 * ============================================================================
 *
 * POR QUE ESTA FONTE EXISTE, em uma frase: a vault nunca esteve montada nesta
 * instalação. `OBSIDIAN_VAULT_PATH=/vault` aponta para `/srv/marketing-os/vault`,
 * uma pasta VAZIA desde 13/07/2026 — e a vault real sempre morou no Google
 * Drive, que é onde o Pedro a mantém. O espelho da pauta já ESCREVE no Drive
 * desde a onda 8; esta é a metade da leitura, que faltava.
 *
 * O QUE ESTA SUÍTE MEDE, e por que cada caso está aqui:
 *
 *   1. o filtro de `.md` — a vault real tem 1.524 notas e, ao lado delas, 1.634
 *      jpg, 168 png e 146 mp4. Uma varredura sem filtro baixaria gigabytes de
 *      mídia a cada passada para jogar tudo fora;
 *   2. os dois tetos — o identificador da pasta vem de configuração, e uma letra
 *      trocada pode apontar para a raiz do Drive inteiro;
 *   3. a CHAVE das notas — o caminho relativo tem de sair igual nas duas fontes,
 *      senão trocar de fonte reindexa tudo como nota nova e arquiva a memória
 *      da origem anterior;
 *   4. o reaproveitamento do que não mudou — que é o que separa "ler a vault do
 *      Drive" de "baixar e vetorizar 1.500 notas 48 vezes por dia".
 *
 * SEM BANCO E SEM REDE: o Drive é um dublê que conta as chamadas. O que
 * interessa aqui é o COMPORTAMENTO da varredura — quantas chamadas, com que
 * consulta, e o que ela decide baixar.
 */

// ---------------------------------------------------------------------------
// Um Drive de mentira, que conta o que foi pedido
// ---------------------------------------------------------------------------

interface ArquivoFalso {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  parent: string;
  conteudo?: string;
}

const PASTA = 'application/vnd.google-apps.folder';

/**
 * Monta um `fetch` de mentira que responde à API do Drive a partir de uma
 * árvore declarada. Devolve também os contadores — é por eles que os casos de
 * custo afirmam alguma coisa.
 */
function driveFalso(arquivos: ArquivoFalso[]) {
  const chamadas = { listagens: 0, downloads: 0, consultas: [] as string[] };

  const fetchFalso = vi.fn(async (url: string) => {
    const u = new URL(url);

    if (u.pathname.endsWith('/drive/v3/files') && u.searchParams.get('q')) {
      chamadas.listagens++;
      const q = u.searchParams.get('q')!;
      chamadas.consultas.push(q);
      const pai = q.match(/^'([^']+)' in parents/)?.[1] ?? '';
      /*
       * O dublê imita o filtro do Drive de VERDADE, inclusive na parte tosca:
       * `name contains '.md'` casa "nota.md.bak" também. É de propósito — um dos
       * casos abaixo prova que a conferência exata acontece do nosso lado.
       */
      const filhos = arquivos.filter(
        (a) => a.parent === pai && (a.mimeType === PASTA || a.name.includes('.md')),
      );
      return {
        ok: true,
        json: async () => ({
          files: filhos.map((a) => ({
            id: a.id, name: a.name, mimeType: a.mimeType,
            modifiedTime: a.modifiedTime ?? '2026-09-01T00:00:00.000Z',
            size: String((a.conteudo ?? '').length),
          })),
        }),
      };
    }

    const baixando = u.pathname.match(/\/drive\/v3\/files\/([^/]+)$/);
    if (baixando && u.searchParams.get('alt') === 'media') {
      chamadas.downloads++;
      const alvo = arquivos.find((a) => a.id === decodeURIComponent(baixando[1]));
      if (alvo?.mimeType === 'application/vnd.google-apps.document') {
        return { ok: false, status: 403, text: async () => '{"reason":"fileNotDownloadable"}' };
      }
      return { ok: true, status: 200, text: async () => alvo?.conteudo ?? '' };
    }

    throw new Error(`o dublê do Drive não esperava esta chamada: ${url}`);
  });

  return { fetchFalso, chamadas };
}

/** O `GoogleService` com o mínimo para a varredura andar: um token e o `fetch` trocado. */
async function googleCom(arquivos: ArquivoFalso[]) {
  const { fetchFalso, chamadas } = driveFalso(arquivos);
  const { GoogleService } = await import('../src/google/google.service');
  const svc = new GoogleService(
    { googleAccount: { findUnique: async () => ({ accessToken: 't', expiresAt: new Date(Date.now() + 3_600_000) }) } } as never,
    { log: async () => undefined } as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
  // `token()` é privado e fala com o banco; aqui ele só precisa devolver algo.
  (svc as unknown as { token: () => Promise<string> }).token = async () => 'token-de-mentira';
  vi.stubGlobal('fetch', fetchFalso);
  return { svc, chamadas };
}

// ---------------------------------------------------------------------------
// 1. A varredura: o que ela lista e o que ela se recusa a baixar
// ---------------------------------------------------------------------------

describe('a varredura da vault no Drive', () => {
  const vaultComum: ArquivoFalso[] = [
    { id: 'raiz-1', name: 'Início.md', mimeType: 'text/markdown', parent: 'VAULT', conteudo: '# Início' },
    { id: 'sub', name: '20-empresa', mimeType: PASTA, parent: 'VAULT' },
    { id: 'sub-1', name: 'plano.md', mimeType: 'text/markdown', parent: 'sub', conteudo: '# Plano' },
    { id: 'oculta', name: '.obsidian', mimeType: PASTA, parent: 'VAULT' },
    { id: 'oculta-1', name: 'workspace.md', mimeType: 'text/markdown', parent: 'oculta', conteudo: 'lixo' },
  ];

  it('desce nas subpastas e devolve o caminho RELATIVO com barra', async () => {
    const { svc } = await googleCom(vaultComum);
    const achados = await svc.listarVaultNoDrive('org-1', 'VAULT');
    /*
     * A chave da nota. Ela tem de sair idêntica ao que o lado do filesystem
     * produz com `relative()` — o serviço normaliza o separador do Windows por
     * isso. Chave diferente = nota nova = memória da origem antiga arquivada.
     */
    expect(achados.map((a) => a.caminho).sort()).toEqual(['20-empresa/plano.md', 'Início.md']);
  });

  it('IGNORA pasta oculta — `.obsidian` e `.trash` não são conteúdo', async () => {
    const { svc } = await googleCom(vaultComum);
    const achados = await svc.listarVaultNoDrive('org-1', 'VAULT');
    expect(achados.find((a) => a.caminho.includes('workspace'))).toBeUndefined();
  });

  it('NÃO LISTA anexo: a vault real tem mais imagem que nota', async () => {
    /*
     * Números da vault de verdade, medidos em 13/09/2026: 1.524 `.md` contra
     * 1.634 jpg, 168 png e 146 mp4. Sem filtro, cada passada baixaria as mídias
     * para descartá-las — e são 48 passadas por dia.
     */
    const { svc, chamadas } = await googleCom([
      { id: 'n', name: 'nota.md', mimeType: 'text/markdown', parent: 'VAULT', conteudo: '# n' },
      { id: 'i', name: 'captura.jpg', mimeType: 'image/jpeg', parent: 'VAULT' },
      { id: 'v', name: 'aula.mp4', mimeType: 'video/mp4', parent: 'VAULT' },
    ]);
    const achados = await svc.listarVaultNoDrive('org-1', 'VAULT');
    expect(achados.map((a) => a.nome)).toEqual(['nota.md']);
    // E o filtro está na CONSULTA, não depois: o anexo nem chega a ser listado.
    expect(chamadas.consultas[0]).toContain("name contains '.md'");
  });

  it('o filtro do Drive é frouxo, e a conferência exata é nossa', async () => {
    // `name contains '.md'` casa isto; `endsWith` não.
    const { svc } = await googleCom([
      { id: 'a', name: 'nota.md', mimeType: 'text/markdown', parent: 'VAULT', conteudo: '# a' },
      { id: 'b', name: 'nota.md.bak', mimeType: 'text/plain', parent: 'VAULT', conteudo: 'backup' },
      { id: 'c', name: 'README.mdx', mimeType: 'text/plain', parent: 'VAULT', conteudo: 'outra coisa' },
    ]);
    const achados = await svc.listarVaultNoDrive('org-1', 'VAULT');
    expect(achados.map((a) => a.nome)).toEqual(['nota.md']);
  });

  it('pede ao Drive para ignorar a LIXEIRA', async () => {
    /*
     * Arquivo na lixeira continua respondendo à consulta por pasta. Sem
     * `trashed = false` ele voltaria para o índice como nota viva — e a nota
     * que alguém apagou de propósito reapareceria na busca.
     */
    const { svc, chamadas } = await googleCom(vaultComum);
    await svc.listarVaultNoDrive('org-1', 'VAULT');
    for (const q of chamadas.consultas) expect(q).toContain('trashed = false');
  });

  it('pede os dois `AllDrives` — a vault aqui é COMPARTILHADA', async () => {
    /*
     * O caso real desta casa: a vault é do Drive de pedro.magnago@fullbpo.com e
     * o OS entra por operacao.root@gmail.com. Sem estes dois parâmetros, uma
     * pasta em Drive compartilhado lista VAZIA — sem erro nenhum, que é o pior
     * jeito de falhar: parece vault vazia.
     */
    const { svc } = await googleCom(vaultComum);
    await svc.listarVaultNoDrive('org-1', 'VAULT');
    const fonte = readFileSync(path.join(RAIZ_DA_API, 'src', 'google', 'google.service.ts'), 'utf8');
    expect(fonte).toContain('supportsAllDrives=true');
    expect(fonte).toContain('includeItemsFromAllDrives=true');
  });

  it('`apenasRaiz` não desce — é a sonda, que tem 4,5 s', async () => {
    const { svc, chamadas } = await googleCom(vaultComum);
    const achados = await svc.listarVaultNoDrive('org-1', 'VAULT', { apenasRaiz: true });
    expect(achados.map((a) => a.caminho)).toEqual(['Início.md']);
    expect(chamadas.listagens, 'a sonda desceu na subpasta').toBe(1);
  });

  it('CONTROLE NEGATIVO: sem `apenasRaiz`, ela desce — senão o caso acima não mede nada', async () => {
    const { svc, chamadas } = await googleCom(vaultComum);
    await svc.listarVaultNoDrive('org-1', 'VAULT');
    expect(chamadas.listagens).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Os tetos: meia vault nunca passa por vault inteira
// ---------------------------------------------------------------------------

describe('os tetos da varredura', () => {
  it('estourar o teto de arquivos LANÇA — não devolve o que coube', async () => {
    /*
     * Devolver a lista parcial seria o pior dos dois mundos: `reindex`
     * SUBSTITUI o índice, então meia vault apagaria a outra metade e arquivaria
     * a memória dela, sem nada acusar.
     */
    const muitos: ArquivoFalso[] = Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`, name: `nota-${i}.md`, mimeType: 'text/markdown', parent: 'VAULT', conteudo: '#',
    }));
    const { svc } = await googleCom(muitos);
    await expect(svc.listarVaultNoDrive('org-1', 'VAULT', { maxArquivos: 5 })).rejects.toThrow(
      /mais de 5 arquivos/i,
    );
  });

  it('estourar a profundidade LANÇA — atalho circular ou pasta errada', async () => {
    const fundo: ArquivoFalso[] = [
      { id: 'a', name: 'a', mimeType: PASTA, parent: 'VAULT' },
      { id: 'b', name: 'b', mimeType: PASTA, parent: 'a' },
      { id: 'c', name: 'c', mimeType: PASTA, parent: 'b' },
      { id: 'd', name: 'nota.md', mimeType: 'text/markdown', parent: 'c', conteudo: '#' },
    ];
    const { svc } = await googleCom(fundo);
    await expect(svc.listarVaultNoDrive('org-1', 'VAULT', { maxProfundidade: 2 })).rejects.toThrow(
      /níveis/i,
    );
  });

  it('CONTROLE NEGATIVO: dentro dos tetos, a mesma vault passa', async () => {
    const { svc } = await googleCom([
      { id: 'a', name: 'a', mimeType: PASTA, parent: 'VAULT' },
      { id: 'd', name: 'nota.md', mimeType: 'text/markdown', parent: 'a', conteudo: '#' },
    ]);
    await expect(svc.listarVaultNoDrive('org-1', 'VAULT', { maxArquivos: 5, maxProfundidade: 2 }))
      .resolves.toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. O download, e o documento nativo do Google
// ---------------------------------------------------------------------------

describe('baixar o conteúdo', () => {
  it('devolve o texto CRU, não JSON', async () => {
    /*
     * `api()` manda `Content-Type: application/json` e faz `res.json()` no
     * retorno. Usá-lo aqui faria um `.md` entrar no índice como erro de parse —
     * defeito que aparece como "a busca não acha nada", três telas adiante.
     */
    const { svc } = await googleCom([
      { id: 'n1', name: 'n.md', mimeType: 'text/markdown', parent: 'VAULT', conteudo: '# Título\n\nCorpo com "aspas" e {chaves}.' },
    ]);
    await expect(svc.baixarTextoDoDrive('org-1', 'n1')).resolves.toBe(
      '# Título\n\nCorpo com "aspas" e {chaves}.',
    );
  });

  it('documento NATIVO do Google recusa com a frase que diz o que fazer', async () => {
    /*
     * Medido em 13/09/2026: a vault real tem ZERO arquivos nativos — nem .gdoc,
     * nem .gsheet. Este caminho não é morto por desenho, é o que ainda não
     * aconteceu. Quando acontecer, a recusa explica em vez de deixar um 403
     * solto subir como "erro do Google".
     */
    const { svc } = await googleCom([
      { id: 'doc', name: 'nota.md', mimeType: 'application/vnd.google-apps.document', parent: 'VAULT' },
    ]);
    await expect(svc.baixarTextoDoDrive('org-1', 'doc')).rejects.toThrow(/NATIVO do Google/i);
  });
});

// ---------------------------------------------------------------------------
// 4. O contrato que o conector do Obsidian espera, lido do fonte
// ---------------------------------------------------------------------------

describe('a fiação do conector', () => {
  const fonte = readFileSync(path.join(RAIZ_DA_API, 'src', 'obsidian', 'obsidian.service.ts'), 'utf8');

  it('a fonte é lida no construtor e valor desconhecido LANÇA', () => {
    /*
     * Cair no padrão seria o defeito: uma vault que se acha configurada e lê da
     * pasta errada indexa o vazio e some com o índice de quem confiou nela.
     */
    expect(fonte).toMatch(/OBSIDIAN_FONTE/);
    expect(fonte).toMatch(/não existe\. Valores: pasta \| drive/);
  });

  it('a leitura do conteúdo é PREGUIÇOSA — é o que deixa pular o que não mudou', () => {
    /*
     * `ler` é função, não campo. No filesystem ler é barato; no Drive é uma
     * chamada de rede por arquivo. Devolver o conteúdo junto obrigaria a baixar
     * a vault inteira a cada meia hora para descobrir que nada mudou.
     */
    expect(fonte).toMatch(/ler:\s*\(\)\s*=>\s*Promise<string>/);
  });

  it('a comparação de data é por SEGUNDO, e isso não é detalhe', () => {
    /*
     * `modifiedTime` do Drive e `mtime` do filesystem não têm a mesma precisão,
     * e a ida e volta do banco mexe em microssegundos. Comparando exato, TODA
     * nota apareceria como mudada — e o reaproveitamento, que é a razão de ele
     * existir, nunca aconteceria.
     */
    expect(fonte).toMatch(/Math\.floor\(d\.getTime\(\) \/ 1000\)/);
  });

  it('o conector do Google é OPCIONAL, e a ausência RECUSA em vez de devolver vazio', () => {
    /*
     * Vazio é o estado que apaga índice e arquiva memória. A guarda de `reindex`
     * pegaria adiante, mas com a frase errada — diria "a vault está vazia"
     * quando o problema é que ninguém montou a fiação.
     */
    expect(fonte).toMatch(/@Optional\(\) private readonly google\?: GoogleService/);
    expect(fonte).toMatch(/o conector do Google não está montado neste processo/);
  });

  it('a sonda sabe distinguir as duas fontes, e diz o que conferir no Drive', () => {
    /*
     * A causa nº 1 de a vault do Drive não abrir nesta casa é a pasta não estar
     * compartilhada com a conta ligada ao OS — que é uma por empresa e pode não
     * ser a de quem está olhando a tela. A mensagem precisa dizer isso.
     */
    expect(fonte).toMatch(/não está compartilhada com a conta do/);
    expect(fonte).toMatch(/Confira em Conexões qual conta está ligada/);
  });
});
