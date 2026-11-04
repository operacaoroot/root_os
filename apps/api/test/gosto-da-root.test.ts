import { beforeEach, describe, expect, it } from 'vitest';

import type { PrismaService } from '../src/prisma/prisma.service';
import type { GoogleService } from '../src/google/google.service';
import type { LlmProvider } from '../src/llm/llm.provider';
import {
  arquivoDasDecisoes,
  dataDeSaoPaulo,
  juntarGosto,
  limparResumo,
  modeloDoGosto,
  notaParaAIa,
  precisaResumir,
  separarGosto,
  type Decisao,
} from '../src/marketing-estudio/gosto-da-root';
import { GostoDaRootService } from '../src/marketing-estudio/gosto-da-root.service';

/*
 * O Gosto da Root no Obsidian (04/11/2026, pedido do Lucas): o histórico com TODAS as decisões,
 * a nota que a IA lê, e a parte "Escrito pela equipe" que o OS nunca pode apagar.
 */

const RAIZ = '1WqCqI0gOxvVEhTPUQktATvj1lH1pOPSt';

function decisao(p: Partial<Decisao>): Decisao {
  return {
    titulo: 'Ideia',
    status: 'aprovada',
    motivo: null,
    comentario: null,
    decididaEm: new Date('2026-11-02T21:00:00Z'),
    decididaPor: 'Lucas Fernandes',
    fonteNome: 'Memória',
    url: null,
    formatoSugerido: 'Carrossel',
    ...p,
  };
}

/** Um Drive de mentira, em memória, com o pedaço da API que o gosto usa. */
function driveFalso() {
  let n = 0;
  const pastas = new Map<string, { id: string; nome: string; pai: string }>();
  const arquivos = new Map<string, { id: string; nome: string; pai: string; texto: string }>();
  const item = (id: string, nome: string, pai: string, pasta: boolean) => ({ id, nome, mimeType: pasta ? 'application/vnd.google-apps.folder' : 'text/markdown', url: null, pais: [pai] });
  const d = {
    gravacoes: [] as string[],
    falhar: false,
    async filhosDaPasta(_o: string, pai: string, f: { nome?: string; soPastas?: boolean } = {}) {
      if (d.falhar) throw new Error('Drive fora do ar');
      const saida = [...pastas.values()].filter((p) => p.pai === pai && (f.nome === undefined || p.nome === f.nome)).map((p) => item(p.id, p.nome, pai, true));
      if (!f.soPastas) saida.push(...[...arquivos.values()].filter((a) => a.pai === pai && (f.nome === undefined || a.nome === f.nome)).map((a) => item(a.id, a.nome, pai, false)));
      return saida;
    },
    async criarPasta(_o: string, pai: string, nome: string) {
      const id = `pasta-${++n}`;
      pastas.set(id, { id, nome, pai });
      return item(id, nome, pai, true);
    },
    async gravarArquivoNoDrive(_o: string, e: { folderId: string; nome: string; conteudo: string }) {
      d.gravacoes.push(e.nome);
      const existe = [...arquivos.values()].find((a) => a.pai === e.folderId && a.nome === e.nome);
      if (existe) {
        existe.texto = e.conteudo;
        return { id: existe.id, atualizado: true };
      }
      const id = `arq-${++n}`;
      arquivos.set(id, { id, nome: e.nome, pai: e.folderId, texto: e.conteudo });
      return { id, atualizado: false };
    },
    async baixarTextoDoDrive(_o: string, id: string) {
      return arquivos.get(id)!.texto;
    },
    ler(nome: string) {
      return [...arquivos.values()].find((a) => a.nome === nome)?.texto ?? null;
    },
    editar(nome: string, texto: string) {
      [...arquivos.values()].find((a) => a.nome === nome)!.texto = texto;
    },
    caminho(id: string): string[] {
      const p = pastas.get(id);
      return p ? [...d.caminho(p.pai), p.nome] : [];
    },
    pastaDe(nome: string) {
      return [...arquivos.values()].find((a) => a.nome === nome)!.pai;
    },
    paiDe(nomeDaPasta: string) {
      return [...pastas.values()].find((p) => p.nome === nomeDaPasta)?.pai ?? null;
    },
  };
  return d;
}

function montar(decisoes: Decisao[], opcoes: { drive?: ReturnType<typeof driveFalso> | null; ia?: boolean } = {}) {
  const prisma = {
    org: { findFirst: async ({ where }: { where: { id: string; slug: string } }) =>
      where.id === 'org' && where.slug === 'root' ? { id: 'org' } : null },
    marketingIdeiaCard: { findMany: async () => decisoes },
  } as unknown as PrismaService;
  const pedidos: { funcao?: string; user: string }[] = [];
  const llm = {
    configured: opcoes.ia !== false,
    complete: async (input: { funcao?: string; user: string }) => {
      pedidos.push(input);
      return '```markdown\n## O que a Root aprova\n- IA aplicada à operação — com caso real\n### O que a Root recusa\n- Promoção de ferramenta\n```';
    },
  } as unknown as LlmProvider;
  const drive = opcoes.drive === undefined ? driveFalso() : opcoes.drive;
  const s = new GostoDaRootService(prisma, llm, (drive ?? undefined) as unknown as GoogleService | undefined);
  return { s, drive, pedidos };
}

beforeEach(() => {
  delete process.env.MEMORIA_DRIVE_DESLIGADO;
  delete process.env.MARKETING_IA_SIMULADA;
  delete process.env.MEMORIA_DRIVE_RAIZ_ID;
});

describe('Gosto da Root: as notas', () => {
  it('a data sai no horário de São Paulo', () => {
    expect(dataDeSaoPaulo(new Date('2026-11-02T21:22:12Z'))).toBe('02/11/2026 18h22');
    expect(dataDeSaoPaulo(null)).toBe('');
  });

  it('o histórico leva TODAS as decisões, inclusive a recusa sem comentário nem motivo', () => {
    const t = arquivoDasDecisoes(
      [
        decisao({ titulo: 'Carrossel tosco', status: 'recusada' }),
        decisao({ titulo: 'Palantir', comentario: 'Contar a história da Palantir\ne como fazemos', url: 'https://x.com/1' }),
      ],
      new Date('2026-11-04T12:00:00Z'),
    );
    expect(t).toContain('2 decisões: 1 aprovada e 1 recusada. 1 sem comentário nem motivo');
    expect(t).toContain('- **Recusou** · 02/11/2026 18h00 · Carrossel tosco · Carrossel · por Lucas Fernandes\n  - (sem comentário nem motivo)');
    expect(t).toContain('  - comentário: Contar a história da Palantir e como fazemos');
    expect(t).toContain('  - fonte: Memória https://x.com/1');
    expect(t.startsWith('---\ntitulo: "Decisões da triagem"')).toBe(true);
  });

  it('separar e juntar devolvem a parte da equipe como estava, e o resumo antigo some', () => {
    const daEquipe = `${modeloDoGosto()}- Nada de notícia de game.\n- Caso real vale mais que opinião.\n`;
    const nota = juntarGosto(daEquipe, '### O que a Root aprova\n- velho', { total: 3, ultima: '2026-11-02T21:22:12.611Z' });
    const s = separarGosto(nota);
    expect(s.daEquipe.trimEnd()).toBe(daEquipe.trimEnd());
    expect(s.marca).toEqual({ total: 3, ultima: '2026-11-02T21:22:12.611Z' });
    const nova = juntarGosto(s.daEquipe, '### O que a Root aprova\n- novo', { total: 4, ultima: '2026-11-03T10:00:00.000Z' });
    expect(nova).toContain('- Nada de notícia de game.');
    expect(nova).toContain('- novo');
    expect(nova).not.toContain('- velho');
    expect(nova.match(/^## Resumo da IA$/gm)).toHaveLength(1);
  });

  it('a nota editada no Windows (CRLF) e sem o título do resumo fica inteira com a equipe', () => {
    const s = separarGosto('# Gosto\r\n\r\n- escrito à mão\r\n');
    expect(s.resumo).toBeNull();
    expect(s.marca).toBeNull();
    expect(s.daEquipe).toBe('# Gosto\n\n- escrito à mão\n');
    expect(juntarGosto(s.daEquipe, '- resumo', { total: 0, ultima: null })).toContain('- escrito à mão\n\n## Resumo da IA');
  });

  it('o resumo só é refeito quando muda o total ou a última decisão', () => {
    const marca = { total: 3, ultima: '2026-11-02T21:22:12.611Z' };
    expect(precisaResumir(null, marca)).toBe(true);
    expect(precisaResumir(marca, { ...marca })).toBe(false);
    expect(precisaResumir(marca, { ...marca, total: 2 })).toBe(true);
    expect(precisaResumir(marca, { ...marca, ultima: '2026-11-03T00:00:00.000Z' })).toBe(true);
    const semDecisao = separarGosto(juntarGosto('# G\n', '- nada', { total: 0, ultima: null })).marca;
    expect(precisaResumir(semDecisao, { total: 0, ultima: null })).toBe(false);
  });

  it('a IA lê a nota sem o cabeçalho e sem os comentários de instrução', () => {
    const nota = juntarGosto(`${modeloDoGosto()}- Nada de game.\n`, '### O que a Root aprova\n- caso real', { total: 1, ultima: 'x' });
    const t = notaParaAIa(nota);
    expect(t).not.toContain('titulo:');
    expect(t).not.toContain('<!--');
    expect(t).toContain('- Nada de game.');
    expect(t).toContain('## Resumo da IA');
    expect(t).toContain('- caso real');
    expect(notaParaAIa('a'.repeat(50), 10)).toContain('nota cortada');
  });

  it('a saída da IA entra limpa: sem cerca de código, sem título de nível 1 ou 2, sem travessão', () => {
    const r = limparResumo('```markdown\n## O que a Root aprova\n# Outro\n### Fica\n- IA — com caso\n```');
    expect(r).toBe('### O que a Root aprova\n### Outro\n### Fica\n- IA, com caso');
  });
});

describe('Gosto da Root: o serviço', () => {
  const decisoes = [
    decisao({ titulo: 'Palantir', comentario: 'Contar a história da Palantir', decididaEm: new Date('2026-11-02T21:22:12.611Z') }),
    decisao({ titulo: 'E-book de R$ 47', status: 'recusada', decididaEm: new Date('2026-11-02T21:19:00Z') }),
  ];

  it('na primeira passagem cria a pasta, as duas notas e o resumo; na segunda, sem decisão nova, não chama a IA', async () => {
    const { s, drive, pedidos } = montar(decisoes);
    expect(await s.atualizarResumo('org')).toBe('resumido');
    expect(drive!.caminho(drive!.pastaDe('Gosto da Root.md'))).toEqual(['40-marca-e-conteudo', 'Memória', 'Algoritmo']);
    expect(drive!.ler('Decisões da triagem.md')).toContain('E-book de R$ 47');
    const nota = drive!.ler('Gosto da Root.md')!;
    expect(nota).toContain('## Escrito pela equipe');
    expect(nota).toContain('### O que a Root aprova\n- IA aplicada à operação, com caso real');
    expect(nota).toContain('<!-- os: 2 decisões, a última em 2026-11-02T21:22:12.611Z.');
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].funcao).toBe('CT-21');
    expect(pedidos[0].user).toContain('comentário: "Contar a história da Palantir"');
    expect(pedidos[0].user).toContain('RECUSOU · 02/11/2026 · "E-book de R$ 47"');

    expect(await s.atualizarResumo('org')).toBe('sem-novidade');
    expect(pedidos).toHaveLength(1);
  });

  it('o que a equipe escreveu na nota fica, e a IA passa a ler', async () => {
    const lista = [...decisoes];
    const { s, drive } = montar(lista);
    await s.atualizarResumo('org');
    const nota = drive!.ler('Gosto da Root.md')!;
    drive!.editar('Gosto da Root.md', nota.replace('## Escrito pela equipe\n', '## Escrito pela equipe\n\n- Nada de notícia de game.\n'));
    lista.unshift(decisao({ titulo: 'Novo', comentario: 'Topo de funil', decididaEm: new Date('2026-11-04T12:00:00Z') }));
    expect(await s.atualizarResumo('org')).toBe('resumido');
    const depois = drive!.ler('Gosto da Root.md')!;
    expect(depois).toContain('- Nada de notícia de game.');
    expect(depois.match(/^## Resumo da IA$/gm)).toHaveLength(1);
    const lido = await s.paraAIa('org');
    expect(lido).toContain('- Nada de notícia de game.');
    expect(lido).toContain('### O que a Root recusa');
    expect(lido).not.toContain('<!--');
  });

  it('sem Drive, sem IA ou com o Drive fora do ar, não lança: a triagem segue com o banco', async () => {
    const semDrive = montar(decisoes, { drive: null });
    expect(await semDrive.s.atualizarResumo('org')).toBe('sem-drive');
    expect(await semDrive.s.paraAIa('org')).toBe('');
    expect(await semDrive.s.gravarDecisoes('org')).toBe(false);

    const semIa = montar(decisoes, { ia: false });
    expect(await semIa.s.atualizarResumo('org')).toBe('sem-ia');
    expect(semIa.drive!.ler('Gosto da Root.md')).toBeNull();

    const fora = montar(decisoes);
    fora.drive!.falhar = true;
    expect(await fora.s.atualizarResumo('org')).toBe('falhou');
    expect(await fora.s.paraAIa('org')).toBe('');
    expect(await fora.s.gravarDecisoes('org')).toBe(false);

    process.env.MEMORIA_DRIVE_DESLIGADO = '1';
    const desligado = montar(decisoes);
    expect(await desligado.s.atualizarResumo('org')).toBe('sem-drive');
    expect(desligado.drive!.gravacoes).toHaveLength(0);
  });

  it('paraAIa não cria pasta e devolve vazio enquanto a nota não existe', async () => {
    const { s, drive } = montar(decisoes);
    expect(await s.paraAIa('org')).toBe('');
    expect(drive!.gravacoes).toHaveLength(0);
  });

  it('sem nenhuma decisão, a nota nasce sem chamar a IA', async () => {
    const { s, drive, pedidos } = montar([]);
    expect(await s.atualizarResumo('org')).toBe('resumido');
    expect(pedidos).toHaveLength(0);
    expect(drive!.ler('Gosto da Root.md')).toContain('Ainda sem decisões.');
  });

  it('a raiz do Drive é a pasta Root, salvo configuração', async () => {
    const { s, drive } = montar(decisoes);
    await s.gravarDecisoes('org');
    expect(drive!.paiDe('40-marca-e-conteudo')).toBe(RAIZ);

    process.env.MEMORIA_DRIVE_RAIZ_ID = 'outraPastaRaiz123';
    const outro = montar(decisoes);
    await outro.s.gravarDecisoes('org');
    expect(outro.drive!.paiDe('40-marca-e-conteudo')).toBe('outraPastaRaiz123');
  });
});
