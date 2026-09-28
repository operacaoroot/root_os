import { describe, expect, it } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  PAUTA_TETO_DE_CANDIDATOS,
  PautaCuradoriaConfirmacaoSchema,
  PautaCuradoriaMarcacaoSchema,
  PautaGerarCuradoriaSchema,
} from '@mktos/shared';

import {
  aplicarSugestoes,
  candidatoDaCaptura,
  corpoDaCuradoria,
  destinoDosItens,
  itensDaCuradoria,
  lerCandidatos,
  marcar,
  sobraPorOrigem,
  tituloDaSugestao,
  type Candidato,
} from '../src/pauta/curadoria-da-rodada';
import { insumoDaRodadaComSobra, filtroDasOrigens } from '../src/pauta/origem-da-rodada';
import { planoDaPagina } from '../src/pauta/pagina-de-links-do-episodio';
import { linksDaDescricao } from '../src/pauta/pacote-do-episodio';
import { montarNewsletter } from '../src/pauta/newsletter-do-episodio';
import { RodadaService } from '../src/pauta/rodada.service';
import type { VozService } from '../src/pauta/voz.service';
import { TOM_DA_CASA } from '../src/pauta/voz-da-pauta';
import { AuditService } from '../src/audit/audit.service';
import type { LlmProvider } from '../src/llm/llm.provider';
import type { PrismaService } from '../src/prisma/prisma.service';

// MC10: sem perfil, as peças recebem o tom da casa.
const vozDaCasa = { bloco: async () => TOM_DA_CASA } as unknown as VozService;

/*
 * CURADORIA HUMANA ANTES DO ROTEIRO — MC6.
 *
 * Três camadas, sem banco e sem Nest:
 *   1. a parte pura (`pauta/curadoria-da-rodada.ts`): a captura que vira
 *      candidato com id estável, a sugestão da IA que só acende a marca, a
 *      marcação do operador, o que segue depois de confirmar e o link que pode
 *      ser publicado;
 *   2. os esquemas do shared que a rota usa para validar o corpo;
 *   3. o `RodadaService` DE VERDADE com um prisma de mentira: a rodada "para
 *      curadoria" nasce em `aguardando_curadoria` com todos os candidatos, a
 *      marcação e a confirmação só valem nesse status, confirmar exige um
 *      marcado, e derivar recusa a rodada que ainda não foi curada.
 */

const ORG = '7c0f0a8e-4444-4a5a-9c1e-00000000mc06';
const PESSOA = 'b1d2c3e4-0000-4000-8000-000000000006';

const hora = (h: number) => new Date(Date.now() - h * 3_600_000);

type Captura = {
  id: string;
  titulo: string | null;
  url: string | null;
  nota?: string | null;
  bruto: unknown;
  capturadoEm: Date;
  fonte: { nome: string; tipo: 'rss' | 'busca' | 'perfil' | 'gmail' | 'manual'; plataforma: string | null; handle: string | null };
};

const CAPTURAS: Captura[] = [
  { id: 'c1', titulo: null, url: 'https://noticia.exemplo/grupo', nota: 'olha isso  aqui\nimportante', bruto: {}, capturadoEm: hora(1), fonte: { nome: 'Grupo', tipo: 'manual', plataforma: 'whatsapp', handle: null } },
  { id: 'c2', titulo: 'Achado da busca', url: 'https://busca.exemplo/1', bruto: { resumo: 'desc da busca' }, capturadoEm: hora(2), fonte: { nome: 'IA PME', tipo: 'busca', plataforma: 'google', handle: 'ia' } },
  { id: 'c3', titulo: 'Matéria do feed', url: 'https://feed.exemplo/1', bruto: {}, capturadoEm: hora(3), fonte: { nome: 'InfoMoney', tipo: 'rss', plataforma: null, handle: null } },
  { id: 'c4', titulo: 'Vídeo do creator', url: 'https://youtube.com/watch?v=abc', bruto: { resumo: 'desc' }, capturadoEm: hora(4), fonte: { nome: 'Canal', tipo: 'perfil', plataforma: 'youtube', handle: 'canaldoia' } },
  { id: 'c5', titulo: 'The Batch', url: 'https://mail.google.com/mail/u/0/#all/n1', bruto: { resumo: 'news' }, capturadoEm: hora(5), fonte: { nome: 'Newsletters', tipo: 'gmail', plataforma: 'gmail', handle: 'newsletters' } },
  { id: 'c6', titulo: 'Outra do feed', url: 'https://feed.exemplo/2', bruto: {}, capturadoEm: hora(6), fonte: { nome: 'InfoMoney', tipo: 'rss', plataforma: null, handle: null } },
  { id: 'c7', titulo: 'Mais uma do feed', url: 'https://feed.exemplo/3', bruto: {}, capturadoEm: hora(7), fonte: { nome: 'InfoMoney', tipo: 'rss', plataforma: null, handle: null } },
];

function candidato(over: Partial<Candidato> & { id: string }): Candidato {
  return { titulo: over.id, url: `https://x.exemplo/${over.id}`, sugerido: false, marcado: false, porque: '', resumo: '', ...over };
}

// ---------------------------------------------------------------------------
// 1. A parte pura
// ---------------------------------------------------------------------------

describe('curadoria: a captura vira candidato', () => {
  it('o id é o da captura, a origem é a da fonte, nada vem marcado nem sugerido', () => {
    const c = candidatoDaCaptura(CAPTURAS[1]);
    expect(c).toEqual({
      id: 'c2',
      titulo: 'Achado da busca',
      url: 'https://busca.exemplo/1',
      fonte: 'IA PME',
      resumo: 'desc da busca',
      origem: 'N',
      sugerido: false,
      porque: '',
      marcado: false,
    });
  });

  it('o link do grupo sem título leva o domínio como título; a mensagem fica só no resumo', () => {
    const c = candidatoDaCaptura(CAPTURAS[0]);
    expect(c.titulo).toBe('noticia.exemplo');
    expect(c.resumo).toBe('olha isso aqui importante');
    expect(c.origem).toBe('W');
  });

  it('a mensagem do grupo não sai no botão da página, na descrição nem na newsletter', () => {
    const mensagem = 'Pedro, liga pro João 61 99999-0000 sobre isso, cliente X quer https://www.site.exemplo/materia';
    const captura: Captura = {
      id: 'w1',
      titulo: null,
      url: 'https://www.site.exemplo/materia',
      nota: mensagem,
      bruto: {},
      capturadoEm: hora(1),
      fonte: { nome: 'Grupo', tipo: 'manual', plataforma: 'whatsapp', handle: null },
    };
    const itens = itensDaCuradoria([{ ...candidatoDaCaptura(captura), marcado: true }]);
    const pagina = planoDaPagina(itens, []);
    const descricao = linksDaDescricao(itens);
    const news = montarNewsletter(JSON.stringify({ titulo: 'A semana', secoes: [{ n: 1, texto: 'A matéria do site.' }] }), {
      tituloDoEpisodio: 'Ep 1',
      itens,
      segmentos: [],
    });
    expect(pagina.links[0].rotulo).toBe('site.exemplo');
    expect(descricao[0].titulo).toBe('site.exemplo');
    expect(news.markdown).toContain('Fonte: [site.exemplo](');
    for (const saida of [JSON.stringify(pagina), JSON.stringify(descricao), news.markdown]) {
      expect(saida).not.toContain('99999');
      expect(saida).not.toContain('João');
    }
  });

  it('a captura de texto, sem link, ainda mostra o começo da nota (nada dela sai como link)', () => {
    const c = candidatoDaCaptura({ ...CAPTURAS[0], id: 't1', url: null });
    expect(c.titulo).toBe('olha isso aqui importante');
  });

  it('a newsletter é candidata, mas marcada como sem link público', () => {
    const c = candidatoDaCaptura(CAPTURAS[4]);
    expect(c.origem).toBe('L');
    expect(c.semLinkPublico).toBe(true);
  });

  it('a mesma matéria em duas origens leva as duas letras, W primeiro', () => {
    const c = candidatoDaCaptura({ ...CAPTURAS[2], origens: ['W', 'R'] });
    expect(c.origem).toBe('W');
    expect(c.origens).toEqual(['W', 'R']);
  });

  it('o resumo cabe no teto e não traz quebra de linha', () => {
    const c = candidatoDaCaptura({ ...CAPTURAS[2], bruto: { resumo: 'a\n'.repeat(500) } });
    expect(c.resumo!.length).toBeLessThanOrEqual(400);
    expect(c.resumo).not.toContain('\n');
  });
});

describe('curadoria: o teto de candidatos e a sobra', () => {
  it('todas as capturas da janela entram quando cabem — ninguém corta em 5', () => {
    const { escolhidas, deFora } = insumoDaRodadaComSobra([CAPTURAS], { janelaIni: hora(24), teto: 200 });
    expect(escolhidas).toHaveLength(CAPTURAS.length);
    expect(deFora).toEqual([]);
  });

  it('o que passa do teto sai contado por origem', () => {
    const { escolhidas, deFora } = insumoDaRodadaComSobra([CAPTURAS], { janelaIni: hora(24), teto: 3 });
    expect(escolhidas).toHaveLength(3);
    expect(deFora).toHaveLength(CAPTURAS.length - 3);
    const sobra = sobraPorOrigem(deFora);
    expect(Object.values(sobra).reduce((a, b) => a + (b ?? 0), 0)).toBe(CAPTURAS.length - 3);
  });
});

describe('curadoria: a sugestão da IA', () => {
  const lista = [candidato({ id: 'a' }), candidato({ id: 'b' }), candidato({ id: 'c' })];

  it('acende a marca e o porquê pelo número do item, sem tirar ninguém', () => {
    const saida = aplicarSugestoes(lista, { sugeridos: [{ n: 2, porque: ' muda preço ' }] });
    expect(saida).toHaveLength(3);
    expect(saida.map((c) => c.sugerido)).toEqual([false, true, false]);
    expect(saida[1].porque).toBe('muda preço');
    expect(saida.every((c) => c.marcado === false)).toBe(true);
  });

  it('número fora da lista, repetido, fracionário ou em texto é ignorado', () => {
    const saida = aplicarSugestoes(lista, {
      sugeridos: [{ n: 0 }, { n: 4 }, { n: 1.5 }, { n: '1' }, { n: 3, porque: 'primeira' }, { n: 3, porque: 'segunda' }, null],
    });
    expect(saida.map((c) => c.sugerido)).toEqual([false, false, true]);
    expect(saida[2].porque).toBe('primeira');
  });

  it('saída sem lista não derruba nada', () => {
    expect(aplicarSugestoes(lista, { sugeridos: 'todos' })).toEqual(lista);
    expect(tituloDaSugestao({ titulo: 42 })).toBeNull();
    expect(tituloDaSugestao({ titulo: '  Edição 12 ' })).toBe('Edição 12');
  });
});

describe('curadoria: a marcação do operador', () => {
  const lista = [candidato({ id: 'a' }), candidato({ id: 'b', marcado: true }), candidato({ id: 'c' })];

  it('marcado é quem veio na lista; o resto fica desmarcado', () => {
    const r = marcar(lista, ['a', 'c', 'a']);
    if ('erro' in r) throw new Error(r.erro);
    expect(r.candidatos.map((c) => c.marcado)).toEqual([true, false, true]);
    expect(r.marcados).toBe(2);
  });

  it('id que não é candidato desta rodada recusa a marcação inteira', () => {
    const r = marcar(lista, ['a', 'zzz']);
    expect(r).toEqual({ erro: expect.stringContaining('zzz') });
  });

  it('lista vazia desmarca tudo', () => {
    const r = marcar(lista, []);
    if ('erro' in r) throw new Error(r.erro);
    expect(r.marcados).toBe(0);
    expect(r.candidatos.every((c) => !c.marcado)).toBe(true);
  });

  it('o JSON gravado sem id não é candidato', () => {
    expect(lerCandidatos([{ id: 'a', titulo: 'A', url: 'u' }, { titulo: 'sem id' }, null, 'x'])).toEqual([
      { id: 'a', titulo: 'A', url: 'u', sugerido: false, marcado: false },
    ]);
    expect(lerCandidatos('nada')).toEqual([]);
  });
});

describe('curadoria: o que segue depois de confirmar', () => {
  it('só os marcados, sem a marca de tela', () => {
    const itens = itensDaCuradoria([
      candidato({ id: 'a', marcado: true, sugerido: true, porque: 'p' }),
      candidato({ id: 'b' }),
    ]);
    expect(itens).toEqual([{ id: 'a', titulo: 'a', url: 'https://x.exemplo/a', sugerido: true, porque: 'p', resumo: '' }]);
  });

  it('o miolo lista os itens com o link público e sem o da newsletter', () => {
    const corpo = corpoDaCuradoria([
      { titulo: 'A', url: 'https://a.exemplo', porque: 'importa', resumo: 'resumo A' },
      { titulo: 'News', url: 'https://mail.google.com/x', semLinkPublico: true, resumo: 'contexto' },
    ]);
    expect(corpo).toBe('- **A** (https://a.exemplo): importa — resumo A\n- **News**: contexto');
  });

  it('o link publicado é o primeiro item com link público', () => {
    expect(
      destinoDosItens([
        { url: 'https://mail.google.com/x', semLinkPublico: true },
        { url: '' },
        { url: 'https://b.exemplo' },
      ]),
    ).toBe('https://b.exemplo');
    expect(destinoDosItens([{ url: 'https://mail.google.com/x', semLinkPublico: true }])).toBeNull();
    expect(destinoDosItens(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. O corpo que a rota aceita
// ---------------------------------------------------------------------------

describe('curadoria: os esquemas do shared', () => {
  it('a marcação é uma lista de ids, vazia inclusive, até o teto', () => {
    expect(PautaCuradoriaMarcacaoSchema.parse({ marcados: [] })).toEqual({ marcados: [] });
    expect(PautaCuradoriaMarcacaoSchema.safeParse({}).success).toBe(false);
    expect(PautaCuradoriaMarcacaoSchema.safeParse({ marcados: 'a' }).success).toBe(false);
    expect(PautaCuradoriaMarcacaoSchema.safeParse({ marcados: [''] }).success).toBe(false);
    expect(PautaCuradoriaMarcacaoSchema.safeParse({ marcados: [1] }).success).toBe(false);
    const demais = Array.from({ length: PAUTA_TETO_DE_CANDIDATOS + 1 }, (_, i) => `id-${i}`);
    expect(PautaCuradoriaMarcacaoSchema.safeParse({ marcados: demais }).success).toBe(false);
  });

  it('confirmar aceita corpo vazio (vale a marcação salva) ou a marcação junto', () => {
    expect(PautaCuradoriaConfirmacaoSchema.parse({})).toEqual({});
    expect(PautaCuradoriaConfirmacaoSchema.parse({ marcados: ['a'] })).toEqual({ marcados: ['a'] });
  });

  it('gerar para curadoria confere janela e origens', () => {
    expect(PautaGerarCuradoriaSchema.parse({})).toEqual({});
    expect(PautaGerarCuradoriaSchema.parse({ horas: 168, origens: ['W', 'L'] })).toEqual({ horas: 168, origens: ['W', 'L'] });
    expect(PautaGerarCuradoriaSchema.safeParse({ horas: 1000 }).success).toBe(false);
    expect(PautaGerarCuradoriaSchema.safeParse({ origens: ['Z'] }).success).toBe(false);
    expect(PautaGerarCuradoriaSchema.safeParse({ origens: [] }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. O RodadaService de verdade
// ---------------------------------------------------------------------------

function servico(opts: {
  capturas?: Captura[];
  llm?: Partial<LlmProvider> & { saida?: string; falha?: Error };
  rodada?: Record<string, unknown> | null;
} = {}) {
  const capturas = opts.capturas ?? CAPTURAS;
  const prompts: Array<{ system: string; user: string; orgId?: string; maxTokens?: number }> = [];
  const criadas: Array<Record<string, unknown>> = [];
  const gravadas: Array<Record<string, unknown>> = [];
  const condicionais: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const auditoria: Array<Record<string, unknown>> = [];
  let rodada = opts.rodada === undefined ? null : opts.rodada;

  type OndeFonte = { where: { fonte: { tipo: string; plataforma?: string } } };
  const daFonte = ({ where }: OndeFonte) =>
    capturas.filter((c) => c.fonte.tipo === where.fonte.tipo && (!where.fonte.plataforma || c.fonte.plataforma === where.fonte.plataforma));
  const contagens: OndeFonte[] = [];
  const prisma = {
    pautaCaptura: {
      findMany: async (a: OndeFonte & { take: number }) => daFonte(a).slice(0, a.take),
      count: async (a: OndeFonte) => {
        contagens.push(a);
        return daFonte(a).length;
      },
    },
    pautaReferencia: { findMany: async () => [{ id: 'ficha-1' }] },
    pautaRodada: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        criadas.push(data);
        return { id: 'rodada-1', ...data };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        gravadas.push(data);
        return { id: 'rodada-1', ...data };
      },
      findFirst: async ({ where }: { where: { id: string; orgId: string } }) =>
        rodada && rodada.id === where.id && rodada.orgId === where.orgId ? { pecas: [], ...rodada } : null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        condicionais.push({ where, data });
        if (!rodada || rodada.status !== where.status) return { count: 0 };
        rodada = { ...rodada, ...data };
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditoria.push(data);
        return data;
      },
    },
  } as unknown as PrismaService;

  const llm = {
    name: 'falso',
    model: 'falso-1',
    configured: true,
    complete: async (p: { system: string; user: string; orgId?: string; maxTokens?: number }) => {
      prompts.push(p);
      if (opts.llm?.falha) throw opts.llm.falha;
      return opts.llm?.saida ?? JSON.stringify({ titulo: 'Semana 39', sugeridos: [{ n: 1, porque: 'mandado pelo grupo' }] });
    },
    ...opts.llm,
  } as unknown as LlmProvider;

  const rodadas = new RodadaService(prisma, new AuditService(prisma), {} as never, llm, vozDaCasa);
  return { rodadas, prompts, criadas, gravadas, condicionais, auditoria, contagens, atual: () => rodada };
}

describe('curadoria: gerar a rodada para curadoria', () => {
  it('nasce em aguardando_curadoria com TODOS os candidatos e a sugestão da IA, sem nada marcado', async () => {
    const s = servico();
    const r = await s.rodadas.gerarParaCuradoria(ORG, PESSOA);

    expect(s.criadas[0]).toMatchObject({ orgId: ORG, status: 'coletando' });
    const final = s.gravadas.at(-1)!;
    expect(final.status).toBe('aguardando_curadoria');
    expect(final.titulo).toBe('Semana 39');
    expect(final.fichasUsadas).toEqual(['ficha-1']);
    expect(final.erro).toBeNull();
    const itens = final.itens as Candidato[];
    // 7 capturas → 7 candidatos: o modo antigo pararia em 5.
    expect(itens.map((i) => i.id).sort()).toEqual(CAPTURAS.map((c) => c.id).sort());
    expect(itens.every((i) => i.marcado === false)).toBe(true);
    expect(itens.filter((i) => i.sugerido)).toEqual([expect.objectContaining({ id: 'c1', porque: 'mandado pelo grupo', origem: 'W' })]);
    expect(r.status).toBe('aguardando_curadoria');

    // A IA recebe a lista inteira, com o prompt que só sugere, e o gasto é da empresa.
    expect(s.prompts).toHaveLength(1);
    expect(s.prompts[0].orgId).toBe(ORG);
    // MC-R: a sugestão não é geração longa e sai com o teto padrão do provider.
    expect(s.prompts[0].maxTokens).toBeUndefined();
    expect(s.prompts[0].system).toContain('Você não corta a lista');
    expect(s.prompts[0].user).toContain('Itens coletados (7)');
    expect(s.prompts[0].user).not.toContain('mail.google.com');

    expect(s.auditoria.at(-1)).toMatchObject({
      action: 'pauta.rodada_para_curadoria',
      after: { candidatos: 7, sugeridos: 1, deFora: 0, teto: PAUTA_TETO_DE_CANDIDATOS },
    });
  });

  it('a janela padrão é a semana, e as origens pedidas restringem a consulta', async () => {
    const s = servico();
    await s.rodadas.gerarParaCuradoria(ORG, PESSOA, { origens: ['R'] });
    const criada = s.criadas[0] as { janelaIni: Date; janelaFim: Date };
    expect(Math.round((criada.janelaFim.getTime() - criada.janelaIni.getTime()) / 3_600_000)).toBe(168);
    expect((s.gravadas.at(-1)!.itens as Candidato[]).map((i) => i.origem)).toEqual(['R', 'R', 'R']);
    expect(filtroDasOrigens(['R'])).toEqual([{ tipo: 'rss' }]);
  });

  it('lista vazia: sem nenhuma captura na janela, recusa antes de criar a rodada e de chamar a IA', async () => {
    const s = servico({ capturas: [] });
    await expect(s.rodadas.gerarParaCuradoria(ORG, PESSOA)).rejects.toBeInstanceOf(BadRequestException);
    expect(s.criadas).toHaveLength(0);
    expect(s.prompts).toHaveLength(0);
  });

  it('um só item basta: quem decide é a pessoa, não o mínimo de 3 da IA', async () => {
    const s = servico({ capturas: [CAPTURAS[2]] });
    await s.rodadas.gerarParaCuradoria(ORG, PESSOA);
    expect(s.gravadas.at(-1)).toMatchObject({ status: 'aguardando_curadoria' });
  });

  it('a IA falhando não trava a curadoria: a lista nasce sem sugeridos e o motivo fica em erro', async () => {
    const s = servico({ llm: { falha: new Error('teto de custo atingido') } });
    await s.rodadas.gerarParaCuradoria(ORG, PESSOA);
    const final = s.gravadas.at(-1)!;
    expect(final.status).toBe('aguardando_curadoria');
    expect(final.erro).toContain('teto de custo atingido');
    expect((final.itens as Candidato[]).some((i) => i.sugerido)).toBe(false);
    expect(final).not.toHaveProperty('provider');
  });

  it('a IA devolvendo lixo também não trava: vira aviso', async () => {
    const s = servico({ llm: { saida: 'não sei' } });
    await s.rodadas.gerarParaCuradoria(ORG, PESSOA);
    expect(s.gravadas.at(-1)).toMatchObject({ status: 'aguardando_curadoria', erro: expect.stringContaining('JSON') });
  });

  it('sem IA configurada, a lista nasce sem chamar ninguém', async () => {
    const s = servico({ llm: { configured: false } });
    await s.rodadas.gerarParaCuradoria(ORG, PESSOA);
    expect(s.prompts).toHaveLength(0);
    expect(s.gravadas.at(-1)).toMatchObject({ status: 'aguardando_curadoria', erro: expect.stringContaining('credencial') });
  });

  it('a origem que enche a consulta é contada inteira: o que passou do teto entra na sobra da auditoria', async () => {
    const muitas: Captura[] = Array.from({ length: PAUTA_TETO_DE_CANDIDATOS + 5 }, (_, i) => ({
      ...CAPTURAS[2],
      id: `feed-${i}`,
      url: `https://feed.exemplo/muitas/${i}`,
      capturadoEm: hora(1 + i / 100),
    }));
    const s = servico({ capturas: [CAPTURAS[0], ...muitas] });
    await s.rodadas.gerarParaCuradoria(ORG, PESSOA);

    // Só a origem que bateu o teto da consulta é contada; o grupo, com uma captura, não.
    expect(s.contagens.map((c) => c.where.fonte)).toEqual([{ tipo: 'rss' }]);
    expect((s.gravadas.at(-1)!.itens as Candidato[])).toHaveLength(PAUTA_TETO_DE_CANDIDATOS);
    const after = s.auditoria.at(-1)!.after as { deFora: number; sobraPorOrigem: Record<string, number>; origensNoTeto: string[] };
    // 206 na janela para 200 vagas: 5 nem vieram na consulta, 1 caiu no corte.
    expect(after.deFora).toBe(6);
    expect(after.sobraPorOrigem).toEqual({ R: 6 });
    expect(after.origensNoTeto).toEqual(['R']);
  });

  it('origem desconhecida é recusada antes de consultar', async () => {
    const s = servico();
    await expect(s.rodadas.gerarParaCuradoria(ORG, PESSOA, { origens: ['Z'] })).rejects.toBeInstanceOf(BadRequestException);
    expect(s.criadas).toHaveLength(0);
  });
});

const EM_CURADORIA = () => ({
  id: 'rodada-9',
  orgId: ORG,
  status: 'aguardando_curadoria',
  erro: 'Sem sugestão da IA: teto de custo atingido',
  titulo: 'Semana 39',
  corpo: '',
  fichasUsadas: [],
  itens: [
    candidato({ id: 'c1', origem: 'W', sugerido: true, porque: 'do grupo' }),
    candidato({ id: 'c2', origem: 'N' }),
    candidato({ id: 'c5', origem: 'L', url: 'https://mail.google.com/x', semLinkPublico: true }),
  ],
});

describe('curadoria: salvar a marcação', () => {
  it('grava quem ficou, condicionada ao status, e audita', async () => {
    const s = servico({ rodada: EM_CURADORIA() });
    const r = await s.rodadas.salvarMarcacao(ORG, 'rodada-9', PESSOA, ['c2', 'c5']);
    expect(r).toEqual({ ok: true, marcados: 2, candidatos: 3 });
    expect(s.condicionais[0].where).toEqual({ id: 'rodada-9', orgId: ORG, status: 'aguardando_curadoria' });
    expect((s.atual()!.itens as Candidato[]).map((i) => i.marcado)).toEqual([false, true, true]);
    expect(s.atual()!.status).toBe('aguardando_curadoria');
    expect(s.auditoria.at(-1)).toMatchObject({ action: 'pauta.curadoria_marcada', after: { marcados: 2 } });
  });

  it('id que não é candidato é 400 e nada é gravado', async () => {
    const s = servico({ rodada: EM_CURADORIA() });
    await expect(s.rodadas.salvarMarcacao(ORG, 'rodada-9', PESSOA, ['c1', 'de-outra-rodada'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(s.condicionais).toHaveLength(0);
  });

  it('rodada em status errado (já curada) recusa a marcação', async () => {
    const s = servico({ rodada: { ...EM_CURADORIA(), status: 'curada' } });
    await expect(s.rodadas.salvarMarcacao(ORG, 'rodada-9', PESSOA, ['c1'])).rejects.toThrow(/curada/);
    expect(s.condicionais).toHaveLength(0);
  });

  it('rodada de outra empresa não existe', async () => {
    const s = servico({ rodada: { ...EM_CURADORIA(), orgId: 'outra-org' } });
    await expect(s.rodadas.salvarMarcacao(ORG, 'rodada-9', PESSOA, ['c1'])).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('curadoria: confirmar', () => {
  it('só os marcados seguem, a rodada vira curada e o miolo sai deles', async () => {
    const s = servico({ rodada: EM_CURADORIA() });
    await s.rodadas.salvarMarcacao(ORG, 'rodada-9', PESSOA, ['c1', 'c5']);
    const r = await s.rodadas.confirmarCuradoria(ORG, 'rodada-9', PESSOA);

    expect(r).toEqual({ ok: true, status: 'curada', itens: 2 });
    const atual = s.atual()!;
    expect(atual.status).toBe('curada');
    // O aviso de "sem sugestão" era da lista; a rodada curada não fica com erro vermelho.
    expect(atual.erro).toBeNull();
    expect((atual.itens as Candidato[]).map((i) => i.id)).toEqual(['c1', 'c5']);
    expect((atual.itens as Candidato[]).some((i) => 'marcado' in i)).toBe(false);
    expect(atual.corpo).toContain('**c1** (https://x.exemplo/c1): do grupo');
    expect(atual.corpo).not.toContain('mail.google.com');
    expect(s.auditoria.at(-1)).toMatchObject({
      action: 'pauta.curadoria_confirmada',
      after: { mantidos: ['c1', 'c5'], descartados: 1, sugeridosMantidos: 1 },
    });
  });

  it('a marcação pode vir junto com a confirmação', async () => {
    const s = servico({ rodada: EM_CURADORIA() });
    await s.rodadas.confirmarCuradoria(ORG, 'rodada-9', PESSOA, ['c2']);
    expect((s.atual()!.itens as Candidato[]).map((i) => i.id)).toEqual(['c2']);
  });

  it('lista vazia: sem nenhum marcado, recusa e a rodada continua aguardando', async () => {
    const s = servico({ rodada: EM_CURADORIA() });
    await expect(s.rodadas.confirmarCuradoria(ORG, 'rodada-9', PESSOA)).rejects.toThrow(/pelo menos um/);
    await expect(s.rodadas.confirmarCuradoria(ORG, 'rodada-9', PESSOA, [])).rejects.toThrow(/pelo menos um/);
    expect(s.atual()!.status).toBe('aguardando_curadoria');
    expect(s.condicionais).toHaveLength(0);
  });

  it('rodada em status errado: confirmar duas vezes, ou uma rodada do modo antigo, é 400', async () => {
    const s = servico({ rodada: EM_CURADORIA() });
    await s.rodadas.confirmarCuradoria(ORG, 'rodada-9', PESSOA, ['c1']);
    await expect(s.rodadas.confirmarCuradoria(ORG, 'rodada-9', PESSOA, ['c1'])).rejects.toBeInstanceOf(BadRequestException);

    const antiga = servico({ rodada: { ...EM_CURADORIA(), status: 'falhou' } });
    await expect(antiga.rodadas.confirmarCuradoria(ORG, 'rodada-9', PESSOA, ['c1'])).rejects.toThrow(/falhou/);
  });

  it('a corrida: se outra aba confirmou entre a leitura e a escrita, a escrita condicionada não sobrescreve', async () => {
    const s = servico({ rodada: EM_CURADORIA() });
    // A leitura ainda vê `aguardando_curadoria`; a escrita, condicionada ao status, não acha a linha.
    (s.rodadas as unknown as { prisma: { pautaRodada: { updateMany: unknown } } }).prisma.pautaRodada.updateMany =
      async () => ({ count: 0 });
    await expect(s.rodadas.confirmarCuradoria(ORG, 'rodada-9', PESSOA, ['c2'])).rejects.toThrow(/já foi confirmada/);
    await expect(s.rodadas.salvarMarcacao(ORG, 'rodada-9', PESSOA, ['c2'])).rejects.toThrow(/saiu da curadoria/);
    expect(s.auditoria).toHaveLength(0);
  });

  it('derivar recusa a rodada que ainda aguarda a curadoria, antes de chamar a IA', async () => {
    const s = servico({ rodada: EM_CURADORIA() });
    await expect(s.rodadas.derivar(ORG, 'rodada-9', PESSOA)).rejects.toThrow(/aguardando curadoria/);
    expect(s.prompts).toHaveLength(0);
  });

  it('depois de confirmar, derivar manda os itens ao prompt sem o link da newsletter', async () => {
    const s = servico({
      rodada: EM_CURADORIA(),
      llm: { saida: JSON.stringify({ whatsapp: { titulo: 'T', corpo: 'C' } }) },
    });
    (s.rodadas as unknown as { prisma: { pautaPeca: unknown } }).prisma.pautaPeca = { create: async () => ({}) };
    await s.rodadas.confirmarCuradoria(ORG, 'rodada-9', PESSOA, ['c1', 'c5']);
    await s.rodadas.derivar(ORG, 'rodada-9', PESSOA);
    expect(s.prompts.at(-1)!.user).toContain('- c1 — https://x.exemplo/c1');
    expect(s.prompts.at(-1)!.user).toContain('- c5 (newsletter, sem link público)');
    expect(s.prompts.at(-1)!.user).not.toContain('mail.google.com');
  });
});
