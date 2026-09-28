import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PAUTA_CHAVE_DA_PALAVRA_DE_CORTE,
  PAUTA_CHAVES_DA_PALAVRA_DE_CORTE,
  PAUTA_PALAVRA_DE_CORTE_PADRAO,
  PAUTA_TETO_DO_ROTEIRO,
  PautaPalavraDeCorteDoEpisodioSchema,
  PautaPalavraDeCorteSchema,
  PautaRoteiroGerarSchema,
  PautaRoteiroSalvarSchema,
  comPalavraDeCorte,
  lembreteDaPalavraDeCorte,
  podeGerarRoteiro,
  type PautaEpisodioStatus,
  type PautaItemCurado,
} from '@mktos/shared';

import {
  RoteiroInvalidoError,
  entradaDoRoteiro,
  lerRoteiroDaIa,
  linkPublico,
  markdownDoEspelho,
  montarRoteiro,
  motivoParaNaoGerar,
  nomeDoArquivoDoEspelho,
  nomeDoArquivoDoRoteiro,
  ordemDoRoteiro,
  palavraDaNota,
  palavraDeCorteEfetiva,
  systemDoRoteiro,
} from '../src/pauta/roteiro-do-episodio';
import { TOM_DA_CASA, blocoDeVoz } from '../src/pauta/voz-da-pauta';
import { RoteiroService } from '../src/pauta/roteiro.service';
import { VozService } from '../src/pauta/voz.service';
import { RoteiroController } from '../src/pauta/roteiro.controller';
import { EpisodioService } from '../src/pauta/episodio.service';
import { MemoriaService } from '../src/memory/memoria.service';
import { AuditService } from '../src/audit/audit.service';
import type { LlmProvider } from '../src/llm/llm.provider';
import type { EspelhoService } from '../src/pauta/espelho.service';
import { comContexto } from '../src/common/contexto-execucao';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';
import { SAIDA_DA_GERACAO_LONGA } from '../src/pauta/saida-da-geracao';
import { semMarca } from './marca-de-teste';

/*
 * O ROTEIRO DO EPISÓDIO — MC8.
 *
 * Quatro camadas:
 *   1. a parte pura: o prompt com a ordem dramática e o bloco de voz, o pedido
 *      numerado, a leitura do JSON do modelo (e do que não é JSON), a ordem da
 *      gravação, o markdown com a palavra de corte no topo e os links que vêm
 *      do item — nunca do modelo;
 *   2. os contratos: a coluna nova, a migration e os esquemas da rota;
 *   3. o `RoteiroService` DE VERDADE com dublês de prisma, LLM, espelho e
 *      memória: gera dos itens mantidos e passa a gravação, respeita a edição à
 *      mão, recusa o que não pode, exporta e espelha sem quebrar; e o
 *      controller montado à mão (os cabeçalhos do .md, o parse dos corpos);
 *   4. com banco: gerar, editar e exportar pela sessão com empresa.
 */

const ORG = '7c0f0a8e-4444-4a5a-9c1e-00000000mc08';
const PESSOA = 'b1d2c3e4-0000-4000-8000-000000000008';

const ITENS: PautaItemCurado[] = [
  { id: 'c1', titulo: 'Preço do modelo caiu pela metade', url: 'https://noticia.exemplo/preco', origem: 'N', resumo: 'API mais barata.', porque: 'Custo da operação.' },
  { id: 'c2', titulo: 'Agente de planilha no Sheets', url: 'https://noticia.exemplo/sheets', origem: 'W', resumo: 'Planilha que se preenche.' },
  { id: 'c3', titulo: 'The Batch desta semana', url: '', origem: 'L', fonte: 'The Batch', semLinkPublico: true, resumo: 'Contexto da semana.' },
  { id: 'c4', titulo: 'Ferramenta grátis de transcrição', url: 'https://noticia.exemplo/transcricao', origem: 'R', ganchoBr: 'Ata de reunião sem custo.' },
];

function respostaDaIa(ordem: number[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    abertura: 'O preço da IA caiu pela metade esta semana.',
    materias: ordem.map((n) => ({
      n,
      titulo: `Matéria ${n} curta`,
      resumo: `O que aconteceu na ${n}, em duas linhas.`,
      naTela: `A página da ${n}`,
      gancho: `Na ${n}, quem toca o negócio economiza tempo.`,
    })),
    fechamento: 'Semana que vem tem mais — e dá para usar amanhã.',
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// 1. A parte pura
// ---------------------------------------------------------------------------

describe('roteiro: o prompt e a voz', () => {
  it('o prompt pede a ordem dramática, todas as matérias, e proíbe inventar URL', () => {
    const s = systemDoRoteiro(blocoDeVoz(null));
    expect(s).toContain('Abre com a matéria de maior impacto');
    expect(s).toContain('O meio leva as mais densas');
    expect(s).toContain('Fecha em alta');
    expect(s).toContain('TODAS as matérias fornecidas');
    expect(s).toMatch(/Nunca invente notícia, número, nome ou URL/);
    expect(s).toContain('"naTela"');
    expect(s).toContain('"gancho"');
  });

  it('o bloco de voz é o ponto único: sem perfil o tom da casa, com ele o perfil do autor (MC10)', () => {
    expect(blocoDeVoz(null)).toBe(TOM_DA_CASA);
    expect(blocoDeVoz('   ')).toBe(TOM_DA_CASA);
    expect(systemDoRoteiro(blocoDeVoz(null)).endsWith(TOM_DA_CASA)).toBe(true);
    const perfil = blocoDeVoz('Fala curta, exemplos de BPO.');
    expect(perfil).toContain('Fala curta, exemplos de BPO.');
    expect(perfil).not.toContain('Tom da casa');
    // O perfil tem teto de 4 mil; o que sobra é o cabeçalho e as regras da marca.
    expect(blocoDeVoz('x'.repeat(10_000)).length).toBeLessThan(4_600);
  });

  it('o pedido numera as matérias com origem e link; a newsletter vai sem link, com a fonte', () => {
    const u = entradaDoRoteiro({ apelido: 'ep-03', titulo: 'Semana 39', itens: ITENS });
    expect(u).toContain('Episódio: ep-03 · Semana 39');
    expect(u).toContain('Matérias mantidas pela curadoria (4)');
    expect(u).toContain('[1] (N · ');
    expect(u).toContain('link: https://noticia.exemplo/preco');
    expect(u).toContain('[3] (L · ');
    expect(u).toContain('link: sem link público (fonte: The Batch)');
    expect(u).toContain('gancho BR: Ata de reunião sem custo.');
  });

  it('só http(s) é link público; item de caixa de entrada nunca é', () => {
    expect(linkPublico({ url: 'https://a.exemplo/x' })).toBe('https://a.exemplo/x');
    expect(linkPublico({ url: 'javascript:alert(1)' })).toBeNull();
    expect(linkPublico({ url: '' })).toBeNull();
    expect(linkPublico({ url: 'https://mail.google.com/x', semLinkPublico: true })).toBeNull();
  });
});

describe('roteiro: a leitura do que o modelo devolveu', () => {
  it('lê o JSON, inclusive embrulhado em cerca de código', () => {
    const r = lerRoteiroDaIa('```json\n' + respostaDaIa([2, 1]) + '\n```', 4);
    expect(r.materias.map((m) => m.n)).toEqual([2, 1]);
    expect(r.abertura).toContain('caiu pela metade');
  });

  it('markdown no lugar de JSON é roteiro inválido — e o erro diz que nada foi gravado', () => {
    const md = '# Roteiro\n\n## 1. Preço caiu\n\nTexto solto sem JSON.';
    expect(() => lerRoteiroDaIa(md, 4)).toThrow(RoteiroInvalidoError);
    expect(() => lerRoteiroDaIa(md, 4)).toThrow(/nada foi gravado/);
  });

  it('JSON sem a lista, lista em vez de objeto e lista vazia são inválidos', () => {
    expect(() => lerRoteiroDaIa('{"abertura":"x"}', 4)).toThrow(/sem a lista/);
    expect(() => lerRoteiroDaIa('[1,2]', 4)).toThrow(RoteiroInvalidoError);
    expect(() => lerRoteiroDaIa('{"materias":[]}', 4)).toThrow(/nenhuma matéria/);
  });

  it('número fora da lista, repetido ou sem título fica de fora; número em texto vale', () => {
    const r = lerRoteiroDaIa(
      JSON.stringify({
        materias: [
          { n: 9, titulo: 'fora' },
          { n: '2', titulo: 'dois em texto' },
          { n: 2, titulo: 'repetido' },
          { n: 3 },
          { n: 1.5, titulo: 'quebrado' },
          null,
          { n: 1, titulo: '## 1. Um' },
        ],
      }),
      4,
    );
    expect(r.materias.map((m) => [m.n, m.titulo])).toEqual([[2, 'dois em texto'], [1, '1. Um']]);
  });

  it('URL escrita pelo modelo é tirada do texto — o link da matéria é o do item', () => {
    const r = lerRoteiroDaIa(
      JSON.stringify({
        abertura: 'Veja em https://inventado.exemplo/golpe agora.',
        materias: [{ n: 1, titulo: 'Preço', resumo: 'Leia [aqui](https://outro.exemplo/x).', naTela: '<http://tela.exemplo>', gancho: 'ok' }],
      }),
      4,
    );
    const tudo = JSON.stringify(r);
    expect(tudo).not.toMatch(/inventado|outro\.exemplo|tela\.exemplo/);
  });

  it('a ordem é a do modelo; a esquecida entra antes do fechamento, com o que a curadoria disse', () => {
    const blocos = ordemDoRoteiro(lerRoteiroDaIa(respostaDaIa([4, 2, 1]), 4), ITENS);
    expect(blocos.map((b) => b.materia.n)).toEqual([4, 2, 3, 1]);
    const esquecida = blocos[2];
    expect(esquecida.daIa).toBe(false);
    expect(esquecida.materia.titulo).toBe('The Batch desta semana');
    expect(esquecida.materia.resumo).toBe('Contexto da semana.');
    expect(blocos.filter((b) => b.daIa)).toHaveLength(3);
  });

  it('com uma matéria só da IA, as esquecidas vêm antes dela', () => {
    const blocos = ordemDoRoteiro(lerRoteiroDaIa(respostaDaIa([3]), 4), ITENS);
    expect(blocos.map((b) => b.materia.n)).toEqual([1, 2, 4, 3]);
  });
});

describe('roteiro: o markdown', () => {
  const md = () =>
    montarRoteiro({
      apelido: 'ep-03',
      titulo: 'Semana 39',
      palavraDeCorte: 'root, corta',
      abertura: 'Abre forte.',
      blocos: ordemDoRoteiro(lerRoteiroDaIa(respostaDaIa([4, 1, 3, 2]), 4), ITENS),
      fechamento: 'Fecha em alta.',
    });

  it('a palavra de corte é a primeira coisa depois do título', () => {
    const linhas = md().split('\n');
    expect(linhas[0]).toBe('# ep-03 · Semana 39');
    expect(linhas[2]).toMatch(/^> \*\*Palavra de corte: “root, corta”\.\*\*/);
  });

  it('as matérias saem numeradas na ordem da gravação, entre a abertura e o fechamento', () => {
    const titulos = md()
      .split('\n')
      .filter((l) => l.startsWith('## '));
    expect(titulos).toEqual(['## Abertura', '## 1. Matéria 4 curta', '## 2. Matéria 1 curta', '## 3. Matéria 3 curta', '## 4. Matéria 2 curta', '## Fechamento']);
  });

  it('todo link público está lá, e o da newsletter não — nem o da caixa de entrada', () => {
    const texto = md();
    for (const i of ITENS.filter((x) => !x.semLinkPublico)) expect(texto).toContain(`- **Link:** ${i.url}`);
    expect(texto).toContain('- **Link:** sem link público — cite The Batch');
    expect(texto).not.toContain('mail.google');
  });

  it('cada matéria leva "na tela" e o gancho para quem toca o negócio', () => {
    const texto = md();
    expect(texto.match(/- \*\*Na tela:\*\* /g)).toHaveLength(4);
    expect(texto).toContain('- **Para quem toca o negócio:** Na 4, quem toca o negócio economiza tempo.');
  });

  it('sem abertura nem fechamento, as seções não aparecem vazias', () => {
    const texto = montarRoteiro({ apelido: 'ep-01', titulo: 'x', palavraDeCorte: 'corta', abertura: '', blocos: [], fechamento: '' });
    expect(texto).not.toContain('## Abertura');
    expect(texto).not.toContain('## Fechamento');
  });

  it('o espelho leva o cabeçalho do vault e o roteiro inteiro; o nome é estável por episódio', () => {
    const e = markdownDoEspelho({ id: 'e1', apelido: 'ep-03', titulo: 'Semana "39"', roteiro: md(), atualizadoEm: new Date('2026-09-24T01:00:00Z') });
    expect(e.startsWith('---\ntype: roteiro-episodio\nepisodio: ep-03\nname: "Semana \\"39\\""')).toBe(true);
    expect(e).toContain('updated: 2026-09-24');
    expect(e).toContain('# ep-03 · Semana 39');
    expect(nomeDoArquivoDoRoteiro('ep-03')).toBe('ep-03-roteiro.md');
  });

  it('no espelho, o ep-01 de duas empresas não cai no mesmo arquivo: o nome leva o começo do id', () => {
    const a = nomeDoArquivoDoEspelho('ep-01', '0a1b2c3d-1111-4000-8000-000000000001');
    const b = nomeDoArquivoDoEspelho('ep-01', '9f8e7d6c-2222-4000-8000-000000000002');
    expect(a).toBe('ep-01-roteiro-0a1b2c3d.md');
    expect(b).toBe('ep-01-roteiro-9f8e7d6c.md');
    expect(nomeDoArquivoDoEspelho('ep-01', '0a1b2c3d-1111-4000-8000-000000000001')).toBe(a);
  });

  it('trocar a palavra reescreve só a linha do lembrete; sem o lembrete, o texto fica como está', () => {
    const trocado = comPalavraDeCorte(md(), 'ops, de novo');
    expect(trocado.split('\n')[2]).toBe(lembreteDaPalavraDeCorte('ops, de novo'));
    expect(trocado.replace(lembreteDaPalavraDeCorte('ops, de novo'), '')).toBe(md().replace(lembreteDaPalavraDeCorte('root, corta'), ''));
    expect(comPalavraDeCorte('# à mão\n\nsem lembrete', 'ops')).toBe('# à mão\n\nsem lembrete');
    // `$&` na palavra é texto, não padrão de substituição.
    expect(comPalavraDeCorte(md(), 'corta $& já')).toContain('“corta $& já”');
    expect(comPalavraDeCorte(comPalavraDeCorte(md(), 'a “b” c'), 'root, corta')).toBe(md());
  });
});

describe('roteiro: a palavra de corte (D-MC2)', () => {
  it('o padrão é "root, corta"; a da empresa é lida da chave própria e, depois, da nota que a tela Contexto cria', () => {
    expect(PAUTA_PALAVRA_DE_CORTE_PADRAO).toBe('root, corta');
    expect(PAUTA_CHAVE_DA_PALAVRA_DE_CORTE).toBe('pauta.palavra-de-corte');
    expect(PAUTA_CHAVES_DA_PALAVRA_DE_CORTE).toEqual(['pauta.palavra-de-corte', 'operador:palavra-de-corte']);
  });

  it('a do episódio vence a da empresa, que vence o padrão', () => {
    expect(palavraDeCorteEfetiva('corta aí', 'ops')).toEqual({ efetiva: 'corta aí', origem: 'episodio' });
    expect(palavraDeCorteEfetiva(null, 'ops')).toEqual({ efetiva: 'ops', origem: 'empresa' });
    expect(palavraDeCorteEfetiva('  ', null)).toEqual({ efetiva: 'root, corta', origem: 'padrao' });
  });

  it('a da empresa sai da primeira linha da nota, sem aspas nem marcação', () => {
    expect(palavraDaNota({ body: '"Root, corta de novo"\n\nexplicação' })).toBe('Root, corta de novo');
    expect(palavraDaNota({ body: '\n# **ops, volta**' })).toBe('ops, volta');
    expect(palavraDaNota({ body: '- “corta”' })).toBe('corta');
  });

  it('nota arquivada, vazia ou fora do esquema não vale — cai no padrão em vez de travar', () => {
    expect(palavraDaNota({ body: 'corta', arquivadoEm: '2026-09-01T00:00:00Z' })).toBeNull();
    expect(palavraDaNota({ body: '   \n  ' })).toBeNull();
    expect(palavraDaNota({ body: 'x'.repeat(41) })).toBeNull();
    expect(palavraDaNota(null)).toBeNull();
  });
});

describe('roteiro: quando dá para gerar', () => {
  it('só no roteiro e na gravação, e com item', () => {
    expect(podeGerarRoteiro('roteiro')).toBe(true);
    expect(podeGerarRoteiro('gravacao')).toBe(true);
    expect(podeGerarRoteiro('edicao')).toBe(false);
    expect(motivoParaNaoGerar('roteiro', 3)).toBeNull();
    expect(motivoParaNaoGerar('edicao', 3)).toMatch(/já passou da gravação \(está em Edição\)/);
    expect(motivoParaNaoGerar('gravacao', 0)).toMatch(/não guardou nenhum item/);
  });
});

// ---------------------------------------------------------------------------
// 2. Os contratos
// ---------------------------------------------------------------------------

describe('roteiro: contratos', () => {
  const raiz = join(__dirname, '../prisma');

  it('a palavra do episódio é coluna anulável da tabela do episódio', () => {
    const modelo = readFileSync(join(raiz, 'schema.prisma'), 'utf8').match(/model PautaEpisodio \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(modelo).toMatch(/palavraDeCorte\s+String\?/);
  });

  it('a migration existe e ordena depois da do episódio', () => {
    const pastas = readdirSync(join(raiz, 'migrations')).filter((p) => /^\d{14}_/.test(p)).sort();
    const minha = pastas.indexOf('20260924070000_pauta_episodio_palavra_de_corte');
    expect(minha).toBeGreaterThan(pastas.indexOf('20260924060000_pauta_episodio'));
    const sql = readFileSync(join(raiz, 'migrations', pastas[minha], 'migration.sql'), 'utf8');
    expect(sql).toContain('ADD COLUMN     "palavraDeCorte" TEXT');
    expect(existsSync(join(raiz, 'migrations', pastas[minha]))).toBe(true);
  });

  it('gerar só substitui com confirmação explícita', () => {
    expect(PautaRoteiroGerarSchema.parse({})).toEqual({ substituir: false });
    expect(PautaRoteiroGerarSchema.parse({ substituir: true })).toEqual({ substituir: true });
    expect(PautaRoteiroGerarSchema.safeParse({ substituir: 'sim' }).success).toBe(false);
  });

  it('salvar aceita roteiro vazio, recusa o que passa do teto e versão que não é data', () => {
    expect(PautaRoteiroSalvarSchema.parse({ roteiro: '' })).toEqual({ roteiro: '' });
    expect(PautaRoteiroSalvarSchema.safeParse({ roteiro: 'x'.repeat(PAUTA_TETO_DO_ROTEIRO + 1) }).success).toBe(false);
    expect(PautaRoteiroSalvarSchema.safeParse({ roteiro: 'x', versao: 'ontem' }).success).toBe(false);
    expect(PautaRoteiroSalvarSchema.safeParse({}).success).toBe(false);
  });

  it('a palavra é uma linha de 2 a 40, aparada; nulo volta à da empresa', () => {
    expect(PautaPalavraDeCorteSchema.parse('  root, corta  ')).toBe('root, corta');
    expect(PautaPalavraDeCorteSchema.safeParse('x').success).toBe(false);
    expect(PautaPalavraDeCorteSchema.safeParse('x'.repeat(41)).success).toBe(false);
    expect(PautaPalavraDeCorteSchema.safeParse('corta\naí').success).toBe(false);
    expect(PautaPalavraDeCorteDoEpisodioSchema.parse({ palavraDeCorte: null })).toEqual({ palavraDeCorte: null });
    expect(PautaPalavraDeCorteDoEpisodioSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. O serviço com dublês
// ---------------------------------------------------------------------------

type Ep = {
  id: string; orgId: string; numero: number; titulo: string; status: PautaEpisodioStatus;
  roteiro: string; palavraDeCorte: string | null; atualizadoEm: Date; rodada: { itens: unknown };
};

function ep(over: Partial<Ep> = {}): Ep {
  return {
    id: 'e1', orgId: ORG, numero: 3, titulo: 'Semana 39', status: 'roteiro', roteiro: '', palavraDeCorte: null,
    atualizadoEm: new Date('2026-09-23T12:00:00.000Z'), rodada: { itens: ITENS }, ...over,
  };
}

function servico(opts: {
  episodios?: Ep[];
  saida?: string;
  llm?: Partial<LlmProvider>;
  nota?: { body: string; arquivadoEm?: string | null } | null;
  notaDaTela?: { body: string; arquivadoEm?: string | null } | null;
  memoriaFalha?: Error;
  espelho?: string | null | Error;
  duranteIa?: (lista: Ep[]) => void;
} = {}) {
  const lista = opts.episodios ?? [ep()];
  const chamadas: Array<{ system: string; user: string; orgId?: string; maxTokens?: number }> = [];
  const condicionais: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const auditoria: Array<Record<string, unknown>> = [];
  const espelhados: Array<{ orgId: string; nome: string; conteudo: string; subpastaLocal?: string }> = [];
  let relogio = Date.parse('2026-09-23T12:00:00.000Z');

  const llm = {
    name: 'dublê',
    model: 'dublê-1',
    configured: true,
    supportsTools: false,
    complete: async (m: { system: string; user: string; orgId?: string; maxTokens?: number }) => {
      chamadas.push(m);
      opts.duranteIa?.(lista);
      return opts.saida ?? respostaDaIa([4, 2, 3, 1]);
    },
    ...opts.llm,
  } as unknown as LlmProvider;

  const prisma = {
    pautaEpisodio: {
      findFirst: async ({ where }: { where: { id: string; orgId: string } }) => {
        const e = lista.find((x) => x.id === where.id && x.orgId === where.orgId);
        return e ? { ...e } : null;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        condicionais.push({ where, data });
        const alvo = lista.filter((e) =>
          Object.entries(where).every(([k, v]) => {
            const atual = (e as Record<string, unknown>)[k];
            return v instanceof Date && atual instanceof Date ? v.getTime() === atual.getTime() : atual === v;
          }),
        );
        for (const e of alvo) Object.assign(e, data, { atualizadoEm: new Date((relogio += 1000)) });
        return { count: alvo.length };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditoria.push(data);
        return data;
      },
    },
  } as unknown as PrismaService;

  const espelho = {
    espelharDocumento: async (orgId: string, doc: { nome: string; conteudo: string; subpastaLocal?: string }) => {
      espelhados.push({ orgId, ...doc });
      if (opts.espelho instanceof Error) throw opts.espelho;
      return opts.espelho === undefined ? null : opts.espelho;
    },
  } as unknown as EspelhoService;

  const memoria = {
    porChave: async (orgId: string, chave: string) => {
      if (opts.memoriaFalha) throw opts.memoriaFalha;
      if (orgId !== ORG) return null;
      if (chave === PAUTA_CHAVE_DA_PALAVRA_DE_CORTE) return opts.nota ?? null;
      if (chave === 'operador:palavra-de-corte') return opts.notaDaTela ?? null;
      return null;
    },
  } as unknown as MemoriaService;

  return {
    roteiros: new RoteiroService(prisma, new AuditService(prisma), llm, espelho, memoria, new VozService(prisma, new AuditService(prisma), llm, memoria), semMarca),
    lista,
    chamadas,
    condicionais,
    auditoria,
    espelhados,
  };
}

describe('roteiro: gerar', () => {
  it('sai dos itens mantidos, com a empresa pagando, na ordem da IA, e o episódio vai para a gravação', async () => {
    const s = servico();
    const p = await s.roteiros.gerar(ORG, 'e1', PESSOA, { substituir: false });

    expect(s.chamadas).toHaveLength(1);
    expect(s.chamadas[0].orgId).toBe(ORG);
    // MC-R: o roteiro é geração longa — pede o teto de saída maior.
    expect(s.chamadas[0].maxTokens).toBe(SAIDA_DA_GERACAO_LONGA);
    expect(s.chamadas[0].system).toContain(TOM_DA_CASA);
    for (const i of ITENS) expect(s.chamadas[0].user).toContain(i.titulo);

    expect(p.status).toBe('gravacao');
    const titulos = p.roteiro.split('\n').filter((l) => /^## \d/.test(l));
    expect(titulos).toEqual(['## 1. Matéria 4 curta', '## 2. Matéria 2 curta', '## 3. Matéria 3 curta', '## 4. Matéria 1 curta']);
    expect(p.roteiro.split('\n')[2]).toContain('Palavra de corte: “root, corta”');
    expect(p.palavraDeCorte).toMatchObject({ efetiva: 'root, corta', origem: 'padrao' });
    expect(s.condicionais[0].where).toEqual({ id: 'e1', orgId: ORG, status: 'roteiro', atualizadoEm: new Date('2026-09-23T12:00:00.000Z') });
    expect(s.condicionais[0].data).toMatchObject({ status: 'gravacao' });
  });

  it('registra no RASTRO quem gerou, com provider, modelo, a ordem e a origem da palavra', async () => {
    const s = servico({ saida: respostaDaIa([4, 2, 1]) });
    await s.roteiros.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(s.auditoria.at(-1)).toMatchObject({
      action: 'pauta.episodio_roteiro_gerado',
      actorId: PESSOA,
      entityId: 'e1',
      before: { status: 'roteiro' },
      after: { status: 'gravacao', ordem: [4, 2, 3, 1], completadas: [3], palavraDeCorte: 'padrao', provider: 'dublê', model: 'dublê-1' },
    });
  });

  it('a palavra do episódio vence; sem ela, a da nota da empresa; memória fora do ar cai no padrão', async () => {
    const doEp = servico({ episodios: [ep({ palavraDeCorte: 'ops, de novo' })], nota: { body: 'corta, Pedro' } });
    expect((await doEp.roteiros.gerar(ORG, 'e1', PESSOA, { substituir: false })).roteiro).toContain('“ops, de novo”');

    const daEmpresa = servico({ nota: { body: '"corta, Pedro"' } });
    const p = await daEmpresa.roteiros.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(p.roteiro).toContain('“corta, Pedro”');
    expect(p.palavraDeCorte).toEqual({ efetiva: 'corta, Pedro', origem: 'empresa', doEpisodio: null, daEmpresa: 'corta, Pedro' });

    const daTela = servico({ nota: { body: 'x' }, notaDaTela: { body: 'ops, Pedro\n\nfalo isso quando erro' } });
    expect((await daTela.roteiros.painel(ORG, 'e1')).palavraDeCorte).toMatchObject({ efetiva: 'ops, Pedro', origem: 'empresa' });

    const semMemoria = servico({ memoriaFalha: new Error('banco caiu') });
    expect((await semMemoria.roteiros.gerar(ORG, 'e1', PESSOA, { substituir: false })).roteiro).toContain('“root, corta”');
  });

  it('resposta em markdown (não JSON) é 503 e o episódio fica como estava', async () => {
    const s = servico({ saida: '# Roteiro\n\n1. Preço caiu\n2. Sheets' });
    await expect(s.roteiros.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(s.condicionais).toHaveLength(0);
    expect(s.auditoria).toHaveLength(0);
    expect(s.espelhados).toHaveLength(0);
    expect(s.lista[0]).toMatchObject({ status: 'roteiro', roteiro: '' });
  });

  it('já tem roteiro: 409 sem gastar IA; com a confirmação, substitui', async () => {
    const s = servico({ episodios: [ep({ status: 'gravacao', roteiro: '# à mão' })] });
    await expect(s.roteiros.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toBeInstanceOf(ConflictException);
    expect(s.chamadas).toHaveLength(0);
    const p = await s.roteiros.gerar(ORG, 'e1', PESSOA, { substituir: true });
    expect(p.roteiro).not.toBe('# à mão');
    expect(p.status).toBe('gravacao');
  });

  it('depois da gravação é 400 sem gastar IA; rodada sem item também', async () => {
    const tarde = servico({ episodios: [ep({ status: 'edicao' })] });
    await expect(tarde.roteiros.gerar(ORG, 'e1', PESSOA, { substituir: true })).rejects.toThrow(/já passou da gravação/);
    await expect(tarde.roteiros.gerar(ORG, 'e1', PESSOA, { substituir: true })).rejects.toBeInstanceOf(BadRequestException);
    const vazio = servico({ episodios: [ep({ rodada: { itens: [] } })] });
    await expect(vazio.roteiros.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toThrow(/nenhum item/);
    expect(tarde.chamadas.length + vazio.chamadas.length).toBe(0);
  });

  it('IA sem credencial é 503 antes de chamar', async () => {
    const s = servico({ llm: { configured: false } });
    await expect(s.roteiros.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(s.chamadas).toHaveLength(0);
  });

  it('editado em outra aba enquanto a IA pensava: 409, e a edição à mão fica', async () => {
    const s = servico({
      duranteIa: (l) => Object.assign(l[0], { roteiro: '# escrito à mão', atualizadoEm: new Date('2026-09-23T12:05:00.000Z') }),
    });
    await expect(s.roteiros.gerar(ORG, 'e1', PESSOA, { substituir: false })).rejects.toBeInstanceOf(ConflictException);
    expect(s.lista[0]).toMatchObject({ roteiro: '# escrito à mão', status: 'roteiro' });
    expect(s.auditoria).toHaveLength(0);
  });

  it('episódio de outra empresa é 404', async () => {
    const s = servico();
    await expect(s.roteiros.gerar('outra-org', 'e1', PESSOA, { substituir: false })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('roteiro: espelho no vault', () => {
  it('ligado, grava ep-NN-roteiro.md com o cabeçalho do vault e devolve o caminho', async () => {
    const s = servico({ espelho: 'Cerebro-Conteudo/fichas-os/episodios/ep-03-roteiro.md' });
    const p = await s.roteiros.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(s.espelhados).toHaveLength(1);
    expect(s.espelhados[0]).toMatchObject({ orgId: ORG, nome: 'ep-03-roteiro-e1.md', subpastaLocal: 'episodios' });
    expect(s.espelhados[0].conteudo).toContain('type: roteiro-episodio');
    expect(s.espelhados[0].conteudo).toContain('Palavra de corte');
    expect(p.espelho).toEqual({ caminho: 'Cerebro-Conteudo/fichas-os/episodios/ep-03-roteiro.md', erro: null });
  });

  it('desligado não quebra: caminho nulo, sem erro', async () => {
    const p = await servico({ espelho: null }).roteiros.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(p.espelho).toEqual({ caminho: null, erro: null });
  });

  it('falhando, o roteiro fica gravado e o erro volta para a tela', async () => {
    const s = servico({ espelho: new Error('Espelho local indisponível: a vault "" não existe nesta máquina.') });
    const p = await s.roteiros.gerar(ORG, 'e1', PESSOA, { substituir: false });
    expect(p.status).toBe('gravacao');
    expect(p.espelho?.erro).toMatch(/vault/);
    expect(s.lista[0].roteiro).toContain('## 1.');
  });
});

describe('roteiro: editar, exportar e a palavra do episódio', () => {
  it('editar grava o texto (sem \\r), não mexe no status, audita o tamanho e espelha', async () => {
    const s = servico({ episodios: [ep({ status: 'gravacao', roteiro: 'velho' })], espelho: 'x/ep-03-roteiro.md' });
    const p = await s.roteiros.salvar(ORG, 'e1', PESSOA, { roteiro: '# novo\r\ntexto', versao: '2026-09-23T12:00:00.000Z' });
    expect(p.roteiro).toBe('# novo\ntexto');
    expect(p.status).toBe('gravacao');
    expect(s.condicionais[0].data).toEqual({ roteiro: '# novo\ntexto' });
    expect(s.auditoria.at(-1)).toMatchObject({ action: 'pauta.episodio_roteiro_editado', before: { caracteres: 5 }, after: { caracteres: 12 } });
    expect(p.espelho?.caminho).toBe('x/ep-03-roteiro.md');
    expect(p.atualizadoEm).not.toBe('2026-09-23T12:00:00.000Z');
  });

  it('editar com a versão velha (outra aba salvou antes) é 409 e nada é gravado', async () => {
    const s = servico({ episodios: [ep({ roteiro: 'da outra aba', atualizadoEm: new Date('2026-09-23T12:09:00.000Z') })] });
    await expect(s.roteiros.salvar(ORG, 'e1', PESSOA, { roteiro: 'meu', versao: '2026-09-23T12:00:00.000Z' })).rejects.toBeInstanceOf(ConflictException);
    expect(s.condicionais).toHaveLength(0);
    expect(s.lista[0].roteiro).toBe('da outra aba');
  });

  it('roteiro vazio não se espelha', async () => {
    const s = servico({ episodios: [ep({ roteiro: 'x' })], espelho: 'x.md' });
    const p = await s.roteiros.salvar(ORG, 'e1', PESSOA, { roteiro: '' });
    expect(s.espelhados).toHaveLength(0);
    expect(p.espelho).toEqual({ caminho: null, erro: null });
  });

  it('exportar devolve o nome do arquivo e o markdown com quebra final; sem roteiro, 404', async () => {
    const s = servico({ episodios: [ep({ roteiro: '# ep-03 · Semana 39' })] });
    expect(await s.roteiros.exportar(ORG, 'e1')).toEqual({ nome: 'ep-03-roteiro.md', conteudo: '# ep-03 · Semana 39\n' });
    await expect(servico().roteiros.exportar(ORG, 'e1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.roteiros.exportar('outra-org', 'e1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a palavra do episódio grava aparada, volta à da empresa com nulo, e audita', async () => {
    const s = servico({ nota: { body: 'corta, Pedro' } });
    const p = await s.roteiros.definirPalavraDeCorte(ORG, 'e1', PESSOA, '  ops  ');
    expect(p.palavraDeCorte).toMatchObject({ efetiva: 'ops', origem: 'episodio' });
    expect(s.auditoria.at(-1)).toMatchObject({ action: 'pauta.episodio_palavra_de_corte', before: { palavraDeCorte: null }, after: { palavraDeCorte: 'ops' } });
    const volta = await s.roteiros.definirPalavraDeCorte(ORG, 'e1', PESSOA, null);
    expect(volta.palavraDeCorte).toMatchObject({ efetiva: 'corta, Pedro', origem: 'empresa' });
  });

  it('trocar a palavra depois de gerar: roteiro gravado, painel, .md e espelho trazem a nova', async () => {
    const s = servico({ espelho: 'x/ep-03-roteiro-e1.md' });
    await s.roteiros.gerar(ORG, 'e1', PESSOA, { substituir: false });
    const p = await s.roteiros.definirPalavraDeCorte(ORG, 'e1', PESSOA, 'ops');
    expect(p.palavraDeCorte.efetiva).toBe('ops');
    expect(p.roteiro.split('\n')[2]).toBe(lembreteDaPalavraDeCorte('ops'));
    expect(p.roteiro).not.toContain('root, corta');
    expect(s.lista[0].roteiro).toContain('“ops”');
    expect(s.condicionais.at(-1)?.where).toMatchObject({ id: 'e1', orgId: ORG, atualizadoEm: expect.any(Date) });
    expect((await s.roteiros.exportar(ORG, 'e1')).conteudo).toContain('Palavra de corte: “ops”');
    expect(s.espelhados.at(-1)?.conteudo).toContain('Palavra de corte: “ops”');
    expect(p.espelho?.caminho).toBe('x/ep-03-roteiro-e1.md');
  });

  it('a nota da empresa muda depois de gerar: painel e .md já trazem a nova, sem escrita no episódio', async () => {
    const roteiro = montarRoteiro({ apelido: 'ep-03', titulo: 'Semana 39', palavraDeCorte: 'root, corta', abertura: 'a', blocos: [], fechamento: 'f' });
    const s = servico({ episodios: [ep({ status: 'gravacao', roteiro })], nota: { body: 'corta, Pedro' } });
    expect((await s.roteiros.painel(ORG, 'e1')).roteiro).toContain('“corta, Pedro”');
    expect((await s.roteiros.exportar(ORG, 'e1')).conteudo).toContain('“corta, Pedro”');
    expect(s.condicionais).toHaveLength(0);
  });

  it('salvar um texto que partiu da palavra antiga grava com a que vale agora', async () => {
    const velho = montarRoteiro({ apelido: 'ep-03', titulo: 'Semana 39', palavraDeCorte: 'root, corta', abertura: 'a', blocos: [], fechamento: 'f' });
    const s = servico({ episodios: [ep({ status: 'gravacao', roteiro: velho, palavraDeCorte: 'ops' })] });
    const p = await s.roteiros.salvar(ORG, 'e1', PESSOA, { roteiro: `${velho}\nnota à mão` });
    expect(s.lista[0].roteiro).toContain('“ops”');
    expect(s.lista[0].roteiro).not.toContain('root, corta');
    expect(p.roteiro.endsWith('nota à mão')).toBe(true);
  });

  it('o painel diz por que não dá para gerar depois da gravação', async () => {
    const p = await servico({ episodios: [ep({ status: 'pacote', roteiro: '# gravado' })] }).roteiros.painel(ORG, 'e1');
    expect(p).toMatchObject({ podeGerar: false, apelido: 'ep-03', roteiro: '# gravado' });
    expect(p.motivo).toMatch(/Pacote/);
    expect(p.espelho).toBeUndefined();
  });
});

describe('roteiro: o controller', () => {
  const usuario = { sub: PESSOA, orgId: ORG } as never;

  function controller() {
    const chamadas: Array<{ metodo: string; args: unknown[] }> = [];
    const anota = (metodo: string) => async (...args: unknown[]) => {
      chamadas.push({ metodo, args });
      return metodo === 'exportar' ? { nome: 'ep-03-roteiro.md', conteudo: '# ep-03\n' } : {};
    };
    const duble = {
      painel: anota('painel'),
      gerar: anota('gerar'),
      salvar: anota('salvar'),
      definirPalavraDeCorte: anota('definirPalavraDeCorte'),
      exportar: anota('exportar'),
    } as unknown as RoteiroService;
    return { c: new RoteiroController(duble), chamadas };
  }

  it('exportar responde text/markdown para baixar, com o nome do episódio e sem cache', async () => {
    const { c } = controller();
    const cabecalhos: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => (cabecalhos[k] = v) } as never;
    expect(await c.exportar(usuario, 'e1', res)).toBe('# ep-03\n');
    expect(cabecalhos).toEqual({
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ep-03-roteiro.md"',
      'Cache-Control': 'no-store',
    });
  });

  it('gerar com corpo vazio chega sem substituir; a palavra nula chega nula; corpo fora do esquema é recusado', async () => {
    const { c, chamadas } = controller();
    await c.gerar(usuario, 'e1', undefined);
    expect(chamadas[0]).toEqual({ metodo: 'gerar', args: [ORG, 'e1', PESSOA, { substituir: false }] });
    await c.palavraDeCorte(usuario, 'e1', { palavraDeCorte: null });
    expect(chamadas[1]).toEqual({ metodo: 'definirPalavraDeCorte', args: [ORG, 'e1', PESSOA, null] });
    expect(() => c.palavraDeCorte(usuario, 'e1', { palavraDeCorte: 'x' })).toThrow();
    expect(() => c.salvar(usuario, 'e1', { roteiro: 'y'.repeat(PAUTA_TETO_DO_ROTEIRO + 1) })).toThrow();
    expect(chamadas).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 4. Com banco
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (uma empresa, uma rodada e um episódio)');

const MARCA = `rt${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

describe.skipIf(!URL)('roteiro com banco: gerar, editar e exportar pela sessão da empresa', () => {
  let admin: PrismaClient;
  let cru: PrismaClient;
  let roteiros: RoteiroService;
  let episodios: EpisodioService;
  let orgId = '';

  const na = <T>(fn: () => Promise<T>) =>
    comContexto({ orgId, actorType: 'user', actorId: null, correlationId: `teste-${MARCA}`, origem: 'http' }, fn);

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: URL } } });
    cru = new PrismaClient({ datasourceUrl: URL });
    const app = comTenantNaSessao(cru, { modo: 'impor' }) as unknown as PrismaService;
    const llm = { name: 'dublê', model: 'd', configured: true, supportsTools: false, complete: async () => respostaDaIa([2, 1]) } as unknown as LlmProvider;
    const espelhoDesligado = { espelharDocumento: async () => null } as unknown as EspelhoService;
    // `porChave` só lê o prisma: o livro do RASTRO não entra nesta leitura.
    const memoria = new MemoriaService(app, {} as never);
    roteiros = new RoteiroService(app, new AuditService(app), llm, espelhoDesligado, memoria, new VozService(app, new AuditService(app), llm, memoria), semMarca);
    episodios = new EpisodioService(app, new AuditService(app));
    const o = await admin.org.create({ data: { name: `Roteiro ${MARCA}`, slug: `rt-${MARCA}`, modulos: ['pauta'] } });
    orgId = o.id;
  }, 60_000);

  afterAll(async () => {
    if (orgId) {
      await admin.pautaEpisodio.deleteMany({ where: { orgId } });
      await admin.pautaRodada.deleteMany({ where: { orgId } });
      await admin.auditLog.deleteMany({ where: { orgId } });
      await admin.org.deleteMany({ where: { id: orgId } });
    }
    await admin?.$disconnect();
    await cru?.$disconnect();
  });

  it('gera dos itens mantidos, vai para a gravação, recusa a versão velha e exporta o mesmo texto', async () => {
    const rodada = await admin.pautaRodada.create({
      data: {
        orgId, status: 'curada', titulo: `Semana ${MARCA}`, janelaIni: new Date(), janelaFim: new Date(),
        itens: [{ titulo: 'Um', url: 'https://um.exemplo' }, { titulo: 'Dois', url: 'https://dois.exemplo' }],
      },
    });
    const e = await na(() => episodios.criar(orgId, 'pessoa', { rodadaId: rodada.id }));

    const gerado = await na(() => roteiros.gerar(orgId, e.id, 'pessoa', { substituir: false }));
    expect(gerado.status).toBe('gravacao');
    expect(gerado.roteiro).toContain('https://um.exemplo');
    expect(gerado.roteiro).toContain('https://dois.exemplo');
    expect(gerado.palavraDeCorte.origem).toBe('padrao');

    await expect(na(() => roteiros.salvar(orgId, e.id, 'pessoa', { roteiro: 'x', versao: '2020-01-01T00:00:00.000Z' }))).rejects.toBeInstanceOf(ConflictException);
    const editado = await na(() => roteiros.salvar(orgId, e.id, 'pessoa', { roteiro: `${gerado.roteiro}\nnota à mão`, versao: gerado.atualizadoEm }));
    expect(editado.roteiro.endsWith('nota à mão')).toBe(true);

    await na(() => roteiros.definirPalavraDeCorte(orgId, e.id, 'pessoa', 'ops, de novo'));
    expect((await admin.pautaEpisodio.findUnique({ where: { id: e.id } }))?.palavraDeCorte).toBe('ops, de novo');

    const md = await na(() => roteiros.exportar(orgId, e.id));
    expect(md.nome).toBe(`${e.apelido}-roteiro.md`);
    expect(md.conteudo).toBe(`${comPalavraDeCorte(editado.roteiro, 'ops, de novo')}\n`);
    expect(md.conteudo).toContain('Palavra de corte: “ops, de novo”');
  }, 60_000);
});
