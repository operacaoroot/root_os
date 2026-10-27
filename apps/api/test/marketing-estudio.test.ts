import { describe, expect, it } from 'vitest';
import {
  abasDoMarketing,
  arquivoDaNota,
  bonusDeRecencia,
  corpoDoVideo,
  grafoDasNotas,
  lerArquivoDaComunidade,
  limparTags,
  pesoDaFonte,
  primeiraUrl,
  problemaDaEnquete,
  proximoPassoDoPost,
  scoreDaIdeia,
  semTravessao,
  tagsDoTexto,
  tipoDeVideo,
  tituloDaIdeia,
} from '@mktos/shared';
import { autorDoInstagram, jsonDaIa } from '../src/marketing-estudio/leitura-de-link';

/*
 * Aba Marketing no jeito do ROOT Estúdio (26/10/2026): a lógica pura que veio do
 * Estúdio V1 tem de dar o mesmo resultado aqui.
 */
describe('Memória: captura e notas', () => {
  it('acha o link e o tipo de vídeo como o Estúdio', () => {
    expect(primeiraUrl('olha isso https://www.instagram.com/reel/abc123/?igsh=x. top')).toBe('https://www.instagram.com/reel/abc123/?igsh=x');
    expect(tipoDeVideo('https://www.instagram.com/reel/abc123/')).toBe('instagram');
    expect(tipoDeVideo('https://www.instagram.com/fulano/p/abc/')).toBe('instagram');
    expect(tipoDeVideo('https://www.instagram.com/fulano/')).toBeNull();
    expect(tipoDeVideo('https://www.tiktok.com/@x/video/1')).toBe('tiktok');
    expect(tipoDeVideo('https://youtu.be/xyz')).toBe('youtube');
    expect(tipoDeVideo('https://www.youtube.com/watch?v=1')).toBe('youtube');
    expect(tipoDeVideo('https://g1.globo.com/materia')).toBeNull();
  });

  it('tags, título da ideia e travessão', () => {
    expect(tagsDoTexto('ideia #IA e #operacao #2026')).toEqual(['ia', 'operacao']);
    expect(limparTags(['#IA', 'ia', 'x', 'Operação'])).toEqual(['ia', 'operação']);
    expect(tituloDaIdeia('#livro o gestor experiente decide pior\nresto')).toBe('o gestor experiente decide pior');
    expect(semTravessao('um — dois – três')).toBe('um, dois, três');
  });

  it('o .md do Obsidian leva YAML, título e o id do OS', () => {
    const md = arquivoDaNota({ id: 'n1', titulo: 'Waymo', tipo: 'video', pasta: 'Vídeos', tags: ['ia'], url: 'https://x.com', autor: 'a', via: 'whatsapp', criadaEm: '2026-10-26', atualizadaEm: '2026-10-26', corpo: 'corpo' });
    expect(md.startsWith('---\ntitulo: "Waymo"')).toBe(true);
    expect(md).toContain('root_os_id: n1');
    expect(md).toContain('\n# Waymo\n\ncorpo\n');
  });

  it('o corpo do vídeo segue as seções do Estúdio', () => {
    const c = corpoDoVideo({ url: 'https://i.com/reel/1', autor: 'perfil', analise: { summary: 'S', hook: 'G', structure: ['a', 'b'], adapt: ['x'] }, marca: 'a ROOT' });
    expect(c).toContain('> Fonte: https://i.com/reel/1 · @perfil');
    expect(c).toContain('## Gancho\nG');
    expect(c).toContain('## Estrutura\n- a\n- b');
    expect(c).toContain('## Como adaptar para a ROOT\n- x');
  });

  it('grafo liga nota à tag, ao [[título]] e ao mesmo autor', () => {
    const g = grafoDasNotas([
      { id: 'a', titulo: 'Alfa', tipo: 'nota', tags: ['ia'], url: null, autor: null, corpo: 'ver [[Beta]]' },
      { id: 'b', titulo: 'Beta', tipo: 'video', tags: ['ia'], url: null, autor: 'x', corpo: '' },
      { id: 'c', titulo: 'Gama', tipo: 'video', tags: [], url: null, autor: 'X', corpo: '' },
    ]);
    expect(g.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c', 'tag:ia']);
    const pares = g.links.map((l) => [l.source, l.target].sort().join('|'));
    expect(pares).toEqual(expect.arrayContaining(['a|tag:ia', 'b|tag:ia', 'a|b', 'b|c']));
  });

  it('lê o autor do Instagram pela URL e o JSON da IA com cerca', () => {
    expect(autorDoInstagram('https://www.instagram.com/lucasrezen.de/p/abc/')).toBe('@lucasrezen.de');
    expect(autorDoInstagram('https://www.instagram.com/reel/abc/', '', 'Fulano - @fulano.op on Instagram')).toBe('@fulano.op');
    expect(jsonDaIa('aqui:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});

describe('Triagem: peso da fonte e score', () => {
  it('peso começa em 1, sobe com aprovação e desce com recusa, entre 0,3 e 2', () => {
    expect(pesoDaFonte(0, 0)).toBe(1);
    expect(pesoDaFonte(6, 0)).toBe(1.6);
    expect(pesoDaFonte(0, 6)).toBe(0.4);
    expect(pesoDaFonte(100, 0)).toBeLessThanOrEqual(2);
    expect(pesoDaFonte(0, 1000)).toBe(0.3);
  });
  it('recência e score', () => {
    const agora = Date.parse('2026-10-26T12:00:00Z');
    expect(bonusDeRecencia('2026-10-26T00:00:00Z', agora)).toBe(15);
    expect(bonusDeRecencia('2026-10-24T00:00:00Z', agora)).toBe(8);
    expect(bonusDeRecencia('2026-10-20T00:00:00Z', agora)).toBe(3);
    expect(bonusDeRecencia('2026-09-01T00:00:00Z', agora)).toBe(0);
    expect(scoreDaIdeia(80, 1.5, '2026-10-26T00:00:00Z', agora)).toBe(135);
  });
});

describe('Comunidade Wpp', () => {
  it('vai do Banco direto para Agendar; os outros formatos passam por Design & Gravação', () => {
    expect(proximoPassoDoPost({ etapa: 'ideia', formato: 'Comunidade Wpp' })?.para).toBe('a_agendar');
    expect(proximoPassoDoPost({ etapa: 'ideia', formato: 'Reel' })?.para).toBe('producao');
  });
  it('confere a enquete do WhatsApp', () => {
    expect(problemaDaEnquete('Qual área primeiro?', ['Atendimento', 'Financeiro', 'Estoque'])).toBeNull();
    expect(problemaDaEnquete('x'.repeat(101), ['a', 'b', 'c'])).toMatch(/100/);
    expect(problemaDaEnquete('ok?', ['a', 'b'])).toMatch(/3 ou 4/);
    expect(problemaDaEnquete('ok?', ['a', 'b', 'uma opção comprida demais aqui'])).toMatch(/25/);
  });
  it('lê os arquivos da pasta semanas', () => {
    const s = lerArquivoDaComunidade('2026-10-27-root-semanal-07.md', '---\nx: 1\n---\n# Semanal\n```\n▓▓ ROOT SEMANAL · #07\nconteúdo\n```\n');
    expect(s).toMatchObject({ numero: '2026-10-27-root-semanal-07', data: '2026-10-27', subtipo: 'News semanal', titulo: 'Suco de IA 7' });
    expect(s!.texto).toBe('▓▓ ROOT SEMANAL · #07\nconteúdo');
    const e = lerArquivoDaComunidade('2026-10-29-enquete-quarta.md', '```\n*Qual área você automatiza primeiro?*\n▸ Atendimento\n▸ Financeiro\n▸ Estoque\n```');
    expect(e).toMatchObject({ subtipo: 'Enquete', opcoes: ['Atendimento', 'Financeiro', 'Estoque'] });
    expect(lerArquivoDaComunidade('exemplo-ESCRITA.md', '```\nx\n```')).toBeNull();
  });
  it('o Material da isca vai para o cta; sem a seção, fica vazio', () => {
    const md = [
      '# ROOT SEMANAL #02', '```', '▓▓ ROOT SEMANAL · #02', 'chegar a 30 corações libera o material', '```', '',
      '## Material da isca (vai no CTA da peça)', '', '```', '*O material*', 'link: os.operacaoroot.com/central', '```', '',
      '## Para a enquete de quarta', '```', 'não é isca', '```',
    ].join('\n');
    const s = lerArquivoDaComunidade('2026-10-27-root-semanal-02.md', md);
    expect(s!.texto).toBe('▓▓ ROOT SEMANAL · #02\nchegar a 30 corações libera o material');
    expect(s!.isca).toBe('*O material*\nlink: os.operacaoroot.com/central');
    expect(lerArquivoDaComunidade('2026-10-27-root-semanal-03.md', '```\nsó a news\n```')!.isca).toBe('');
    // Cerca ~~~: o material tem ``` próprio (monoespaçado do WhatsApp) e ele vem junto.
    const til = ['```', 'a news', '```', '## Material da isca (vai no CTA da peça)', '~~~', 'Cole no seu Claude:', '```', 'prompt aqui', '```', 'fim', '~~~', '## Bastidor', 'x'].join('\n');
    expect(lerArquivoDaComunidade('2026-10-27-root-semanal-01.md', til)!.isca).toBe('Cole no seu Claude:\n```\nprompt aqui\n```\nfim');
    expect(lerArquivoDaComunidade('2026-10-27-root-semanal-01.md', til)!.texto).toBe('a news');
  });
});

describe('Abas do Marketing', () => {
  const todas = ['pauta.ver', 'instagram.ver', 'tarefas.ver'];
  it('a aba ativa e as irmãs da seção, filtradas pela permissão', () => {
    const a = abasDoMarketing('/marketing/agendar', todas, ['pauta']);
    expect(a.map((x) => x.label)).toEqual(['Quadro', 'Banco de ideias', 'Agendar', 'Calendário', 'Formatos', 'Pauta (episódios)']);
    expect(a.find((x) => x.ativa)?.key).toBe('maquina-agendar');
    expect(abasDoMarketing('/marketing/performance', ['pauta.ver'], ['pauta']).map((x) => x.key)).toEqual(['marketing-performance', 'maquina-analise', 'marketing-relatorio']);
    expect(abasDoMarketing('/bio', todas)).toEqual([]);
  });
});
