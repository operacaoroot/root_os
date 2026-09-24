import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  PAUTA_CHAVES_DOS_LINKS_DA_CASA,
  PAUTA_MARCADOR_DA_PAGINA_DE_LINKS,
  PAUTA_MAXIMO_DE_LINKS_DA_CASA,
  PAUTA_RESERVA_DA_PAGINA_DE_LINKS,
  BIO_HANDLE_RE,
  PautaPaginaDeLinksPublicarSchema,
  descricaoComPaginaDeLinks,
  type PautaItemCurado,
} from '@mktos/shared';

import {
  TETO_DO_ROTULO,
  cabeNaDescricao,
  chaveDoLink,
  handlesDaPagina,
  linksDaCasaDaNota,
  origemDaBio,
  origemDaChave,
  paginaParaATela,
  planoDaPagina,
  rotuloDoBotao,
  sincronia,
  urlDaPagina,
} from '../src/pauta/pagina-de-links-do-episodio';
import { detalheDoEpisodio } from '../src/pauta/episodio';
import { destinoDosItens } from '../src/pauta/curadoria-da-rodada';
import { montarDescricao, textoParaOYoutube } from '../src/pauta/pacote-do-episodio';
import { chaveDeCampanha, ehLinkDeCampanha, linkRedireciona } from '../src/bio/link-de-campanha';
import { PaginaDeLinksService } from '../src/pauta/pagina-de-links.service';
import { PaginaDeLinksController } from '../src/pauta/pagina-de-links.controller';
import { PublicacaoService } from '../src/pauta/publicacao.service';
import { EpisodioService } from '../src/pauta/episodio.service';
import { BioService } from '../src/bio/bio.service';
import { BioChallengeService } from '../src/bio/bio-challenge.service';
import { BioPublicController } from '../src/bio/bio-public.controller';
import { BioController } from '../src/bio/bio.controller';
import { BioTrackingService } from '../src/bio/bio-tracking.service';
import { AuditService } from '../src/audit/audit.service';
import type { MemoriaService } from '../src/memory/memoria.service';
import type { EvolutionService } from '../src/pauta/evolution.service';
import type { ClickupService } from '../src/integrations/clickup.service';
import { comContexto, novaCorrelacao } from '../src/common/contexto-execucao';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import type { PrismaService } from '../src/prisma/prisma.service';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * A PÁGINA DE LINKS DO EPISÓDIO — MC12.
 *
 * Quatro camadas:
 *   1. a parte pura: o handle (slug da empresa + ep-NN, com o segundo
 *      candidato), a URL que cabe na folga da descrição, os links da casa lidos
 *      da nota, o plano da página (nunca o link da newsletter) e a sincronia
 *      idempotente dos botões; a descrição que só aponta para página no ar;
 *   2. os contratos: o esquema e as permissões das rotas;
 *   3. os serviços DE VERDADE com dublês: a governança de publicar (o mesmo
 *      `BioService.publicar` do /bio) e o link da peça, que não cai mais na
 *      primeira página qualquer da empresa;
 *   4. com banco: montar, remontar sem duplicar, publicar, a página pública pelo
 *      caminho de sempre (GET /bio/public/page/:handle), o clique que vira
 *      PixelEvent pelo /r/:linkId e a descrição apontando para a página.
 */

const ORG = '7c0f0a8e-4444-4a5a-9c1e-0000000mc012';
const PESSOA = 'b1d2c3e4-0000-4000-8000-000000000012';

const ITENS: PautaItemCurado[] = [
  { id: 'c1', titulo: 'Preço do modelo caiu pela metade', url: 'https://noticia.exemplo/preco', origem: 'N' },
  { id: 'c2', titulo: 'Agente de planilha no Sheets', url: 'https://noticia.exemplo/sheets', origem: 'W' },
  // A newsletter como o episódio a recebe: sem o url.
  { id: 'c3', titulo: 'The Batch desta semana', url: '', origem: 'L', semLinkPublico: true },
  // Newsletter antiga, sem a marca: o permalink do Gmail ainda está no url.
  { id: 'c4', titulo: 'Resumo da Ben’s Bites', url: 'https://mail.google.com/mail/u/0/#inbox/18c2f0a', origem: 'L' },
  { id: 'c5', titulo: 'Ferramenta grátis de transcrição', url: 'https://noticia.exemplo/transcricao', origem: 'R' },
  // A mesma matéria colada duas vezes (grupo e RSS): um botão só.
  { id: 'c6', titulo: 'Preço do modelo (de novo)', url: 'https://noticia.exemplo/preco', origem: 'R' },
];
const PUBLICOS = ['https://noticia.exemplo/preco', 'https://noticia.exemplo/sheets', 'https://noticia.exemplo/transcricao'];

// ---------------------------------------------------------------------------
// 1. A parte pura
// ---------------------------------------------------------------------------

describe('página de links: o handle e a URL', () => {
  it('leva o slug da empresa na frente do ep-NN, e o segundo candidato leva um pedaço do id', () => {
    expect(handlesDaPagina('root', 7, 'ab12cd34-0000')).toEqual(['root-ep-07', 'root-ep-07-ab12']);
    expect(handlesDaPagina('Operação ROOT', 12, 'ff00')).toEqual(['operacao-root-ep-12', 'operacao-root-ep-12-ff00']);
  });

  it('todo candidato cabe no BIO_HANDLE_RE (30 caracteres), mesmo com slug enorme ou vazio', () => {
    const longos = handlesDaPagina('empresa-com-um-slug-muito-grande-demais-para-caber', 123, 'abcdef');
    expect(longos).toHaveLength(2);
    for (const h of longos) {
      expect(h, h).toMatch(BIO_HANDLE_RE);
      expect(h.endsWith('ep-123') || h.endsWith('ep-123-abcd')).toBe(true);
    }
    expect(handlesDaPagina('', 3, 'zz99')).toEqual(['ep-03', 'ep-03-zz99']);
    expect(handlesDaPagina('***', 3, '')).toEqual(['ep-03', 'ep-03-x']);
  });

  it('a URL é a origem da bio + /@handle, e cabe na folga que a descrição do MC11 guardou', () => {
    expect(origemDaBio(undefined)).toBe('https://bio.operacaoroot.com');
    expect(origemDaBio('https://bio.exemplo/ ')).toBe('https://bio.exemplo');
    expect(urlDaPagina('https://bio.exemplo/', 'root-ep-07')).toBe('https://bio.exemplo/@root-ep-07');
    // O pior caso: handle de 30 caracteres na origem padrão.
    const pior = urlDaPagina('', 'x'.repeat(30));
    expect(cabeNaDescricao(pior)).toBe(true);
    expect(new TextEncoder().encode(pior).length).toBeLessThan(PAUTA_RESERVA_DA_PAGINA_DE_LINKS);
    expect(cabeNaDescricao(`https://${'a'.repeat(PAUTA_RESERVA_DA_PAGINA_DE_LINKS)}`)).toBe(false);
  });
});

describe('página de links: os links da casa, da nota da memória', () => {
  it('lê `Rótulo | url`, `Rótulo: url`, markdown e URL solta; ignora o resto', () => {
    const { links, avisos } = linksDaCasaDaNota({
      body: [
        '# Links da casa',
        '- Assine a newsletter | https://root.exemplo/news',
        'Fale com a Root: https://wa.me/5561999999999.',
        '* [Comunidade](https://root.exemplo/comunidade)',
        'https://root.exemplo/site',
        'linha sem link nenhum',
        'Repetida | https://root.exemplo/news',
      ].join('\n'),
    });
    expect(links).toEqual([
      { rotulo: 'Assine a newsletter', url: 'https://root.exemplo/news' },
      { rotulo: 'Fale com a Root', url: 'https://wa.me/5561999999999' },
      { rotulo: 'Comunidade', url: 'https://root.exemplo/comunidade' },
      { rotulo: 'root.exemplo', url: 'https://root.exemplo/site' },
    ]);
    expect(avisos).toEqual([]);
  });

  it(`no máximo ${PAUTA_MAXIMO_DE_LINKS_DA_CASA}, com aviso; nota arquivada ou ausente não vale`, () => {
    const body = Array.from({ length: 7 }, (_, i) => `L${i} | https://root.exemplo/${i}`).join('\n');
    const r = linksDaCasaDaNota({ body });
    expect(r.links).toHaveLength(PAUTA_MAXIMO_DE_LINKS_DA_CASA);
    expect(r.avisos[0]).toMatch(/2 ficaram de fora/);
    expect(linksDaCasaDaNota({ body, arquivadoEm: new Date() })).toEqual({ links: [], avisos: [] });
    expect(linksDaCasaDaNota(null)).toEqual({ links: [], avisos: [] });
  });

  it('as chaves lidas começam pela da pauta', () => {
    expect(PAUTA_CHAVES_DOS_LINKS_DA_CASA[0]).toBe('pauta.pagina-de-links.chamadas');
  });
});

describe('página de links: o plano (nunca o link da newsletter)', () => {
  it('um botão por matéria com link público, na ordem da rodada, sem repetir URL; a newsletter fica de fora com aviso', () => {
    const plano = planoDaPagina(ITENS, []);
    expect(plano.links.map((l) => l.destino)).toEqual(PUBLICOS);
    expect(plano.links.map((l) => l.rotulo)).toEqual([
      'Preço do modelo caiu pela metade',
      'Agente de planilha no Sheets',
      'Ferramenta grátis de transcrição',
    ]);
    expect(plano.materias).toBe(3);
    expect(JSON.stringify(plano)).not.toContain('mail.google');
    expect(plano.avisos).toEqual([expect.stringMatching(/^2 matéria\(s\) de newsletter ficaram de fora/)]);
    expect(plano.links.every((l) => l.origem === 'item' && !l.destaque)).toBe(true);
  });

  it('as chamadas da casa vêm depois, em destaque; a que repete uma matéria não entra de novo', () => {
    const plano = planoDaPagina(ITENS, [
      { rotulo: 'Assine', url: 'https://root.exemplo/news' },
      { rotulo: 'Repete a matéria', url: 'https://noticia.exemplo/sheets' },
    ]);
    expect(plano.links.map((l) => [l.origem, l.destino, l.destaque])).toEqual([
      ['item', PUBLICOS[0], false],
      ['item', PUBLICOS[1], false],
      ['item', PUBLICOS[2], false],
      ['casa', 'https://root.exemplo/news', true],
    ]);
    expect(plano.materias).toBe(3);
  });

  it('javascript:, URL longa e rótulo longo: fora ou cortados', () => {
    const plano = planoDaPagina(
      [
        { titulo: 'x', url: 'javascript:alert(1)' },
        { titulo: 'longa', url: `https://noticia.exemplo/${'a'.repeat(600)}` },
        { titulo: `${'palavra '.repeat(20)}fim`, url: 'https://noticia.exemplo/ok' },
      ],
      [],
    );
    expect(plano.links.map((l) => l.destino)).toEqual(['https://noticia.exemplo/ok']);
    expect(plano.links[0].rotulo.length).toBeLessThanOrEqual(TETO_DO_ROTULO);
    expect(plano.links[0].rotulo.endsWith('…')).toBe(true);
    expect(plano.avisos).toEqual([expect.stringMatching(/passam de 500/)]);
    expect(rotuloDoBotao('  <b>oi</b>  ')).toBe('boi/b');
    expect(rotuloDoBotao('', 'reserva')).toBe('reserva');
  });

  it('a chave é da URL, não da posição, e diz de onde o botão veio', () => {
    const a = chaveDoLink('item', 'https://x.exemplo/1');
    expect(a).toMatch(/^pauta:item:[0-9a-f]{16}$/);
    expect(chaveDoLink('item', 'https://x.exemplo/1')).toBe(a);
    expect(chaveDoLink('casa', 'https://x.exemplo/1')).not.toBe(a);
    expect(origemDaChave(a)).toBe('item');
    expect(origemDaChave(chaveDoLink('casa', 'https://x'))).toBe('casa');
    expect(origemDaChave(null)).toBe('painel');
  });
});

describe('página de links: a sincronia dos botões (idempotente)', () => {
  const plano = planoDaPagina(ITENS, [{ rotulo: 'Assine', url: 'https://root.exemplo/news' }]).links;
  const montada = plano.map((p, i) => ({ id: `l${i}`, chave: p.chave, ordem: i + 1, ativo: true, rotulo: p.rotulo, destino: p.destino, destaque: p.destaque }));

  it('página vazia: cria todos, na ordem', () => {
    const s = sincronia([], plano);
    expect(s.criar.map((c) => [c.ordem, c.destino])).toEqual(plano.map((p, i) => [i + 1, p.destino]));
    expect(s.atualizar).toEqual([]);
    expect(s.desativar).toEqual([]);
  });

  it('já montada com o mesmo plano: não cria, não atualiza, não mexe em ninguém', () => {
    const s = sincronia(montada, plano);
    expect(s).toEqual({ criar: [], atualizar: [], desativar: [], reordenar: [], atualizados: 0 });
  });

  it('matéria que saiu é desativada; rótulo mudado é atualizado; botão do painel vai para depois, na ordem dele', () => {
    const painel = [
      { id: 'p1', chave: null, ordem: 1, ativo: true, rotulo: 'Meu site', destino: 'https://meu.site', destaque: false },
      { id: 'camp', chave: null, ordem: 2, ativo: false, rotulo: 'campanha', destino: 'https://x', destaque: false },
    ];
    const novoPlano = plano.filter((p) => p.destino !== PUBLICOS[1]).map((p, i) => (i === 0 ? { ...p, rotulo: 'Novo rótulo' } : p));
    const s = sincronia([...painel, ...montada], novoPlano);
    expect(s.criar).toEqual([]);
    expect(s.desativar).toEqual(['l1']);
    expect(s.atualizar.find((a) => a.id === 'l0')).toMatchObject({ rotulo: 'Novo rótulo', ordem: 1, ativo: true });
    // l2 e l3 sobem uma posição
    expect(s.atualizar.map((a) => [a.id, a.ordem])).toEqual([
      ['l0', 1],
      ['l2', 2],
      ['l3', 3],
    ]);
    // o painel e a campanha, e o desativado, depois dos 3 do plano, na ordem em que estavam
    expect(s.reordenar).toEqual([
      { id: 'p1', ordem: 4 },
      { id: 'camp', ordem: 5 },
      { id: 'l1', ordem: 6 },
    ]);
  });

  it('botão desativado à mão volta ao montar de novo (a montagem é a dona dele)', () => {
    const s = sincronia(montada.map((l, i) => (i === 0 ? { ...l, ativo: false } : l)), plano);
    expect(s.atualizar).toEqual([expect.objectContaining({ id: 'l0', ativo: true })]);
  });
});

describe('página de links: o detalhe do episódio e a descrição', () => {
  const pagina = {
    id: 'pg1',
    handle: 'root-ep-03',
    titulo: 'Semana 39',
    publicada: false,
    links: [
      { id: 'b2', rotulo: 'Sheets', destino: PUBLICOS[1], ativo: true, chave: chaveDoLink('item', PUBLICOS[1]), ordem: 2 },
      { id: 'b1', rotulo: 'Preço', destino: PUBLICOS[0], ativo: true, chave: chaveDoLink('item', PUBLICOS[0]), ordem: 1 },
      { id: 'camp', rotulo: 'campanha', destino: PUBLICOS[0], ativo: false, chave: null, ordem: 3 },
      { id: 'p1', rotulo: 'Meu site', destino: 'https://meu.site', ativo: true, chave: null, ordem: 4 },
    ],
  };
  const DESCRICAO = `Abertura.\n\nOs links deste episódio, numa página só: ${PAUTA_MARCADOR_DA_PAGINA_DE_LINKS}`;
  const linha = (bioPage: typeof pagina | null) => ({
    id: 'e1', numero: 3, titulo: 'Semana 39', status: 'pacote' as const, rodadaId: 'r1',
    criadoEm: new Date(), atualizadoEm: new Date(),
    rodada: { titulo: 'Semana 39', itens: ITENS, janelaIni: new Date(), janelaFim: new Date() },
    roteiro: '', descricao: DESCRICAO, midia: {}, transcricao: [], transcricaoTexto: '', titulos: [], thumbs: [],
    bioPageId: bioPage?.id ?? null, bioPage, criadoPor: null,
  });

  it('a página sai na ordem, sem o link de campanha, com a origem de cada botão', () => {
    const p = paginaParaATela(pagina, 'https://bio.exemplo');
    expect(p.url).toBe('https://bio.exemplo/@root-ep-03');
    expect(p.links.map((l) => [l.id, l.origem])).toEqual([
      ['b1', 'item'],
      ['b2', 'item'],
      ['p1', 'painel'],
    ]);
  });

  it('sem página ou com a página em rascunho, a descrição guarda o marcador', () => {
    expect(detalheDoEpisodio(linha(null), 'https://bio.exemplo').descricao).toBe(DESCRICAO);
    expect(detalheDoEpisodio(linha(null), 'https://bio.exemplo').paginaDeLinks).toBeNull();
    expect(detalheDoEpisodio(linha(pagina), 'https://bio.exemplo').descricao).toContain(PAUTA_MARCADOR_DA_PAGINA_DE_LINKS);
  });

  it('link de campanha de peça nunca vira botão na tela, nem ativo', () => {
    const comCampanha = {
      ...pagina,
      links: [...pagina.links, { id: 'c2', rotulo: 'peça', destino: PUBLICOS[1], ativo: true, chave: chaveDeCampanha('peca', 'p9'), ordem: 5 }],
    };
    expect(paginaParaATela(comCampanha, 'https://bio.exemplo').links.map((l) => l.id)).toEqual(['b1', 'b2', 'p1']);
  });

  it('um marcador vindo de título de fora não multiplica a URL: só a linha da montagem é trocada', () => {
    const url = 'https://bio.exemplo/@root-ep-03';
    expect(textoParaOYoutube(`Matéria ${PAUTA_MARCADOR_DA_PAGINA_DE_LINKS} esperta`, 120)).toBe('Matéria esperta');
    const descricao = montarDescricao({
      abertura: 'Abertura.',
      capitulos: null,
      duracaoSeg: 0,
      links: [{ titulo: textoParaOYoutube(`Título ${PAUTA_MARCADOR_DA_PAGINA_DE_LINKS}`, 120), url: PUBLICOS[0] }],
      hashtags: [],
    });
    expect(descricao.split(PAUTA_MARCADOR_DA_PAGINA_DE_LINKS)).toHaveLength(2);
    // Mesmo com um marcador a mais já gravado, a URL entra uma vez só, no último.
    const dois = `Texto ${PAUTA_MARCADOR_DA_PAGINA_DE_LINKS}\n\nOs links: ${PAUTA_MARCADOR_DA_PAGINA_DE_LINKS}\n\n#ia`;
    expect(descricaoComPaginaDeLinks(dois, url)).toBe(`Texto ${PAUTA_MARCADOR_DA_PAGINA_DE_LINKS}\n\nOs links: ${url}\n\n#ia`);
    expect(descricaoComPaginaDeLinks(dois, null)).toBe(dois);
  });

  it('com a página no ar, a descrição aponta para ela', () => {
    const d = detalheDoEpisodio(linha({ ...pagina, publicada: true }), 'https://bio.exemplo');
    expect(d.descricao).toBe('Abertura.\n\nOs links deste episódio, numa página só: https://bio.exemplo/@root-ep-03');
    expect(d.paginaDeLinks?.publicada).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Contratos
// ---------------------------------------------------------------------------

describe('página de links: contratos e rotas', () => {
  it('publicar exige o booleano', () => {
    expect(PautaPaginaDeLinksPublicarSchema.parse({ publicada: false })).toEqual({ publicada: false });
    expect(() => PautaPaginaDeLinksPublicarSchema.parse({})).toThrow();
    expect(() => PautaPaginaDeLinksPublicarSchema.parse({ publicada: 'sim' })).toThrow();
  });

  it('montar é pauta.editar; publicar é pauta.publicar + bio.editar (a permissão do /bio para publicar)', () => {
    expect(Reflect.getMetadata('path', PaginaDeLinksController)).toBe('pauta/episodios');
    const proto = PaginaDeLinksController.prototype as unknown as Record<string, object>;
    expect(Reflect.getMetadata('path', proto.montar)).toBe(':id/pagina-de-links');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.montar)).toEqual(['pauta.editar']);
    expect(Reflect.getMetadata('path', proto.publicar)).toBe(':id/pagina-de-links/publicar');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.publicar)).toEqual(['pauta.publicar', 'bio.editar']);
    // A rota do /bio que publica pede a mesma bio.editar.
    expect(Reflect.getMetadata(PERMISSIONS_KEY, (BioController.prototype as unknown as Record<string, object>).publish)).toEqual(['bio.editar']);
  });

  it('o controller passa as permissões do token e recusa corpo inválido antes do serviço', async () => {
    const chamadas: unknown[][] = [];
    const duble = {
      montar: async (...a: unknown[]) => void chamadas.push(['montar', ...a]),
      publicar: async (...a: unknown[]) => void chamadas.push(['publicar', ...a]),
    } as unknown as PaginaDeLinksService;
    const c = new PaginaDeLinksController(duble);
    const usuario = { sub: PESSOA, orgId: ORG, permissions: ['pauta.editar'] } as never;
    await c.montar(usuario, 'e1');
    expect(chamadas[0]).toEqual(['montar', ORG, 'e1', { sub: PESSOA, permissions: ['pauta.editar'] }]);
    await c.publicar(usuario, 'e1', { publicada: true });
    expect(chamadas[1]).toEqual(['publicar', ORG, 'e1', PESSOA, true]);
    expect(() => c.publicar(usuario, 'e1', undefined)).toThrow();
    expect(chamadas).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Os serviços com dublês
// ---------------------------------------------------------------------------

describe('página de links: a governança (dublês)', () => {
  function servico(ep: Record<string, unknown> | null, opts: { ativos?: number; modulos?: string[] } = {}) {
    const escritas: string[] = [];
    const publicados: unknown[][] = [];
    const prisma = {
      org: { findUnique: async () => ({ modulos: opts.modulos ?? ['pauta', 'bio'] }) },
      pautaEpisodio: { findFirst: async () => ep },
      bioLink: { count: async () => opts.ativos ?? 0 },
      bioPage: new Proxy({}, { get: (_t, k) => async () => void escritas.push(`bioPage.${String(k)}`) }),
      $transaction: async () => void escritas.push('$transaction'),
    } as unknown as PrismaService;
    const bio = { publicar: async (...a: unknown[]) => void publicados.push(a) } as unknown as BioService;
    const episodios = { obter: async () => ({ id: 'e1' }) } as unknown as EpisodioService;
    const memoria = { porChave: async () => null } as unknown as MemoriaService;
    const audit = { log: async () => undefined } as unknown as AuditService;
    return { s: new PaginaDeLinksService(prisma, audit, memoria, bio, episodios), escritas, publicados };
  }
  const ep = (over: Record<string, unknown> = {}) => ({
    id: 'e1', numero: 3, titulo: 'Semana 39', bioPageId: 'pg1', rodada: { itens: ITENS }, bioPage: { publicada: true }, ...over,
  });

  it('página no ar + sem bio.editar = 403 antes de qualquer escrita', async () => {
    const { s, escritas } = servico(ep());
    await expect(s.montar(ORG, 'e1', { sub: PESSOA, permissions: ['pauta.editar'] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(escritas).toEqual([]);
  });

  it('nenhum link público e nenhuma chamada da casa = 400, sem criar página', async () => {
    const { s, escritas } = servico(ep({ bioPageId: null, bioPage: null, rodada: { itens: [ITENS[2], ITENS[3]] } }));
    await expect(s.montar(ORG, 'e1', { sub: PESSOA, permissions: ['pauta.editar'] })).rejects.toBeInstanceOf(BadRequestException);
    expect(escritas).toEqual([]);
  });

  it('empresa sem o módulo bio: montar e publicar são 403 antes de qualquer escrita (o /bio daria 404)', async () => {
    const semBio = servico(ep({ bioPageId: null, bioPage: null }), { modulos: ['pauta'], ativos: 3 });
    await expect(semBio.s.montar(ORG, 'e1', { sub: PESSOA, permissions: ['pauta.editar', 'bio.editar'] })).rejects.toThrow(
      /não contrata o módulo bio/,
    );
    const noAr = servico(ep(), { modulos: ['pauta'], ativos: 3 });
    await expect(noAr.s.publicar(ORG, 'e1', PESSOA, true)).rejects.toBeInstanceOf(ForbiddenException);
    expect([...semBio.escritas, ...noAr.escritas]).toEqual([]);
    expect(noAr.publicados).toEqual([]);
  });

  it('publicar sem página, ou sem botão ativo, é 400; com botão, passa pelo BioService.publicar do /bio', async () => {
    await expect(servico(ep({ bioPageId: null })).s.publicar(ORG, 'e1', PESSOA, true)).rejects.toThrow(/monte a página/);
    await expect(servico(ep(), { ativos: 0 }).s.publicar(ORG, 'e1', PESSOA, true)).rejects.toThrow(/nenhum botão ativo/);
    const ok = servico(ep(), { ativos: 3 });
    await ok.s.publicar(ORG, 'e1', PESSOA, true);
    expect(ok.publicados).toEqual([[ORG, 'pg1', true, PESSOA]]);
    // Tirar do ar não confere botão nenhum.
    const tirar = servico(ep(), { ativos: 0 });
    await tirar.s.publicar(ORG, 'e1', PESSOA, false);
    expect(tirar.publicados).toEqual([[ORG, 'pg1', false, PESSOA]]);
  });
});

describe('o link da peça (linkRastreado): nunca mais a primeira página qualquer da empresa', () => {
  function publicacao(episodio: { bioPageId: string | null } | null, paginas: Record<string, { publicada: boolean }>) {
    const antes = process.env.PUBLIC_BIO_ORIGIN;
    process.env.PUBLIC_BIO_ORIGIN = 'https://bio.exemplo';
    const consultas: Array<Record<string, unknown>> = [];
    const criados: Array<Record<string, unknown>> = [];
    const auditoria: Array<Record<string, unknown>> = [];
    const enviados: string[] = [];
    const prisma = {
      pautaPeca: {
        findFirst: async () => ({
          id: 'p1', orgId: ORG, canal: 'whatsapp', status: 'rascunho', titulo: 't', corpo: 'Corpo da peça',
          rodada: { titulo: 'Semana 39', itens: ITENS, episodio },
        }),
        update: async ({ data }: { data: Record<string, unknown> }) => ({ externalId: 'msg1', ...data }),
      },
      bioPage: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          consultas.push(where);
          const id = where.id as string | undefined;
          return id && paginas[id] ? { id, ...paginas[id] } : null;
        },
      },
      bioLink: {
        findFirst: async () => ({ ordem: 4 }),
        upsert: async ({ create }: { create: Record<string, unknown> }) => {
          criados.push(create);
          return { id: 'link-novo', ...create };
        },
        delete: async () => undefined,
      },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => void auditoria.push(data) },
    } as unknown as PrismaService;
    const evolution = {
      estado: async () => ({ conectada: true }),
      grupo: 'grupo@g.us',
      enviarTexto: async (_jid: string, texto: string) => {
        enviados.push(texto);
        return { id: 'msg1' };
      },
    } as unknown as EvolutionService;
    const s = new PublicacaoService(prisma, new AuditService(prisma), evolution, {} as ClickupService);
    process.env.PUBLIC_BIO_ORIGIN = antes;
    return { s, consultas, criados, auditoria, enviados };
  }

  it('rodada sem episódio: não procura página nenhuma, a peça sai com o link cru e o motivo vai ao RASTRO', async () => {
    const t = publicacao(null, { qualquer: { publicada: true } });
    await t.s.publicar(ORG, 'p1', PESSOA);
    expect(t.consultas).toEqual([]);
    expect(t.criados).toEqual([]);
    expect(t.enviados[0].endsWith(`\n\n${PUBLICOS[0]}`)).toBe(true);
    expect(t.auditoria[0].after).toMatchObject({ bioLinkId: null, rastreio: 'sem_pagina_do_episodio' });
  });

  it('episódio com página em rascunho: link cru (o /r/ de rascunho perde o clique)', async () => {
    const t = publicacao({ bioPageId: 'pg-ep' }, { 'pg-ep': { publicada: false } });
    await t.s.publicar(ORG, 'p1', PESSOA);
    expect(t.criados).toEqual([]);
    expect(t.auditoria[0].after).toMatchObject({ rastreio: 'pagina_do_episodio_fora_do_ar' });
  });

  it('episódio com página no ar: o link de campanha vai para ELA, fora da página mas com chave de campanha, e a mensagem leva o /r/', async () => {
    const t = publicacao({ bioPageId: 'pg-ep' }, { 'pg-ep': { publicada: true } });
    await t.s.publicar(ORG, 'p1', PESSOA);
    // Toda consulta de página é pelo id da página do episódio — nunca "a primeira da empresa".
    expect(t.consultas).toEqual([{ id: 'pg-ep', orgId: ORG }]);
    expect(t.criados).toEqual([
      expect.objectContaining({ pageId: 'pg-ep', destino: PUBLICOS[0], ativo: false, ordem: 5, chave: 'campanha:peca:p1' }),
    ]);
    expect(t.enviados[0].endsWith('\n\nhttps://bio.exemplo/r/link-novo')).toBe(true);
    expect(t.auditoria[0].after).toMatchObject({ bioLinkId: 'link-novo', rastreio: 'pagina_do_episodio' });
  });
});

describe('o link de campanha e o destino da peça', () => {
  it('o /r/ segue link ativo ou de campanha, e só com a página no ar; botão desativado à mão continua morto', () => {
    const noAr = { publicada: true };
    expect(ehLinkDeCampanha(chaveDeCampanha('peca', 'p1'))).toBe(true);
    expect(ehLinkDeCampanha(chaveDoLink('item', PUBLICOS[0]))).toBe(false);
    expect(ehLinkDeCampanha(null)).toBe(false);
    expect(linkRedireciona({ ativo: false, chave: chaveDeCampanha('peca', 'p1'), page: noAr })).toBe(true);
    expect(linkRedireciona({ ativo: true, chave: null, page: noAr })).toBe(true);
    expect(linkRedireciona({ ativo: false, chave: null, page: noAr })).toBe(false);
    expect(linkRedireciona({ ativo: false, chave: chaveDoLink('item', PUBLICOS[0]), page: noAr })).toBe(false);
    expect(linkRedireciona({ ativo: true, chave: chaveDeCampanha('peca', 'p1'), page: { publicada: false } })).toBe(false);
  });

  it('o destino da peça segue a regra da página: a newsletter antiga, sem a marca, não vaza o permalink do Gmail', () => {
    // c3 (sem url) e c4 (origem L com o permalink) vêm antes: nenhum dos dois é o destino.
    expect(destinoDosItens([ITENS[2], ITENS[3], ITENS[4]])).toBe(PUBLICOS[2]);
    expect(destinoDosItens([ITENS[3]])).toBeNull();
    expect(destinoDosItens([{ url: 'https://outlook.live.com/mail/0/id/x' }])).toBeNull();
    expect(destinoDosItens(ITENS)).toBe(PUBLICOS[0]);
  });
});

// ---------------------------------------------------------------------------
// 4. Com banco
// ---------------------------------------------------------------------------

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (duas empresas, páginas da bio, uma rodada, um episódio e cliques)');

const MARCA = `pl${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

describe.skipIf(!URL)('página de links com banco: montar, remontar, publicar, a página pública e o clique', () => {
  let admin: PrismaClient;
  let cru: PrismaClient;
  let app: PrismaService;
  let paginas: PaginaDeLinksService;
  let episodios: EpisodioService;
  let publico: BioPublicController;
  let bio: BioService;
  const rid = `rid-${MARCA}-visitante`;
  let orgId = '';
  let outraOrg = '';
  const notas: Record<string, { body: string } | null> = {};
  const origemAntes = process.env.PUBLIC_BIO_ORIGIN;

  const na = <T>(fn: () => Promise<T>) =>
    comContexto({ orgId, actorType: 'user', actorId: null, correlationId: `teste-${MARCA}`, origem: 'http' }, fn);
  const comoVisitante = <T>(fn: () => Promise<T>) =>
    comContexto({ orgId: null, correlationId: novaCorrelacao('http'), origem: 'http' }, fn);
  const quem = (...permissions: string[]) => ({ sub: PESSOA, permissions });

  beforeAll(async () => {
    process.env.PUBLIC_BIO_ORIGIN = 'https://bio.exemplo';
    admin = new PrismaClient({ datasources: { db: { url: URL } } });
    cru = new PrismaClient({ datasourceUrl: URL });
    app = comTenantNaSessao(cru, { modo: 'impor' }) as unknown as PrismaService;
    const audit = new AuditService(app);
    bio = new BioService(app, audit, new BioChallengeService(app, audit) as never, {} as never);
    episodios = new EpisodioService(app, audit);
    const memoria = { porChave: async (_org: string, chave: string) => notas[chave] ?? null } as unknown as MemoriaService;
    paginas = new PaginaDeLinksService(app, audit, memoria, bio, episodios);
    publico = new BioPublicController(bio, new BioTrackingService(app), {} as never);

    const o = await admin.org.create({ data: { name: `Página ${MARCA}`, slug: `pl-${MARCA}`, modulos: ['pauta', 'bio'] } });
    orgId = o.id;
    const outra = await admin.org.create({ data: { name: `Outra ${MARCA}`, slug: `pl-outra-${MARCA}`, modulos: ['bio'] } });
    outraOrg = outra.id;
  }, 60_000);

  afterAll(async () => {
    process.env.PUBLIC_BIO_ORIGIN = origemAntes;
    const orgs = [orgId, outraOrg].filter(Boolean);
    if (orgs.length) {
      await admin.pixelEvent.deleteMany({ where: { orgId: { in: orgs } } });
      await admin.bioEvent.deleteMany({ where: { orgId: { in: orgs } } });
      await admin.bioVisit.deleteMany({ where: { orgId: { in: orgs } } });
      await admin.bioVisitor.deleteMany({ where: { id: rid } });
      await admin.pautaPeca.deleteMany({ where: { orgId: { in: orgs } } });
      await admin.pautaEpisodio.deleteMany({ where: { orgId: { in: orgs } } });
      await admin.pautaRodada.deleteMany({ where: { orgId: { in: orgs } } });
      await admin.bioLink.deleteMany({ where: { page: { orgId: { in: orgs } } } });
      await admin.bioPage.deleteMany({ where: { orgId: { in: orgs } } });
      await admin.auditLog.deleteMany({ where: { orgId: { in: orgs } } });
      await admin.org.deleteMany({ where: { id: { in: orgs } } });
    }
    await admin?.$disconnect();
    await cru?.$disconnect();
  });

  async function episodio(itens: PautaItemCurado[] = ITENS) {
    const rodada = await admin.pautaRodada.create({
      data: { orgId, status: 'curada', titulo: `Semana ${MARCA}`, janelaIni: new Date(), janelaFim: new Date(), itens: itens as never },
    });
    const e = await na(() => episodios.criar(orgId, PESSOA, { rodadaId: rodada.id }));
    return { rodadaId: rodada.id, e };
  }

  it('todo link público do roteiro aparece na página, a newsletter não; remontar não duplica; o handle respeita o da outra empresa', async () => {
    // Uma página "pessoal" da empresa, criada antes — a que o linkRastreado antigo pegaria.
    await admin.bioPage.create({ data: { orgId, handle: `pessoal-${MARCA}`, titulo: 'Pessoal', publicada: true } });
    const { e, rodadaId } = await episodio();
    // Outra empresa já tem o primeiro handle candidato: o índice único acusa e vai o segundo.
    const [primeiro, segundo] = handlesDaPagina(`pl-${MARCA}`, e.numero, e.id);
    await admin.bioPage.create({ data: { orgId: outraOrg, handle: primeiro, titulo: 'De outra empresa' } });
    notas['pauta.pagina-de-links.chamadas'] = { body: 'Assine a newsletter | https://root.exemplo/news' };

    const r = await na(() => paginas.montar(orgId, e.id, quem('pauta.editar')));
    const pg = r.episodio.paginaDeLinks!;
    expect(pg.handle).toBe(segundo);
    expect(pg.url).toBe(`https://bio.exemplo/@${segundo}`);
    expect(pg.publicada).toBe(false);
    expect(pg.links.map((l) => [l.origem, l.destino])).toEqual([...PUBLICOS.map((u) => ['item', u]), ['casa', 'https://root.exemplo/news']]);
    expect(JSON.stringify(r.episodio.paginaDeLinks)).not.toContain('mail.google');
    expect(r).toMatchObject({ criados: 4, atualizados: 0, desativados: 0 });
    expect(r.avisos).toEqual([expect.stringMatching(/newsletter ficaram de fora/)]);
    expect(r.episodio.bioPageId).toBe(pg.id);

    const denovo = await na(() => paginas.montar(orgId, e.id, quem('pauta.editar')));
    expect(denovo).toMatchObject({ criados: 0, atualizados: 0, desativados: 0 });
    expect(denovo.episodio.paginaDeLinks!.id).toBe(pg.id);
    expect(await admin.bioLink.count({ where: { pageId: pg.id } })).toBe(4);
    expect(await admin.bioPage.count({ where: { orgId } })).toBe(2);

    // A chamada da casa saiu da nota: remontar desativa o botão dela, sem apagar.
    notas['pauta.pagina-de-links.chamadas'] = null;
    const sem = await na(() => paginas.montar(orgId, e.id, quem('pauta.editar')));
    expect(sem).toMatchObject({ criados: 0, desativados: 1 });
    expect(await admin.bioLink.count({ where: { pageId: pg.id } })).toBe(4);
    expect(await admin.bioLink.count({ where: { pageId: pg.id, ativo: true } })).toBe(3);

    const acoes = await admin.auditLog.findMany({ where: { orgId, entityId: { in: [e.id, pg.id] } }, select: { action: true } });
    expect(acoes.map((a) => a.action)).toEqual(expect.arrayContaining(['bio.page_create', 'pauta.episodio_pagina_de_links']));
    // O RASTRO guarda o antes de cada botão tirado, como o bio.link_update do /bio.
    const ultimo = await admin.auditLog.findFirst({
      where: { orgId, entityId: e.id, action: 'pauta.episodio_pagina_de_links' },
      orderBy: { createdAt: 'desc' },
    });
    expect((ultimo!.after as { botoes: unknown[] }).botoes).toEqual([
      expect.objectContaining({ mudanca: 'desativado', antes: { rotulo: 'Assine a newsletter', destino: 'https://root.exemplo/news', ativo: true } }),
    ]);

    // As matérias saíram do episódio: montar de novo NÃO é 400 com a página existindo — limpa os botões dela.
    await admin.pautaRodada.update({ where: { id: rodadaId }, data: { itens: [ITENS[2]] as never } });
    const limpa = await na(() => paginas.montar(orgId, e.id, quem('pauta.editar')));
    expect(limpa).toMatchObject({ criados: 0, desativados: 3 });
    expect(limpa.avisos).toEqual(expect.arrayContaining([expect.stringMatching(/Nada mais a pôr/)]));
    expect(await admin.bioLink.count({ where: { pageId: pg.id, ativo: true } })).toBe(0);
  }, 60_000);

  it('publicada pelo mesmo caminho do /bio, a página renderiza pelo GET público, o clique vira PixelEvent e a descrição aponta para ela', async () => {
    const { e } = await episodio([ITENS[0], ITENS[2]]);
    await admin.pautaEpisodio.update({
      where: { id: e.id },
      data: { descricao: `Abertura.\n\nOs links deste episódio, numa página só: ${PAUTA_MARCADOR_DA_PAGINA_DE_LINKS}` },
    });
    const montada = await na(() => paginas.montar(orgId, e.id, quem('pauta.editar')));
    const pg = montada.episodio.paginaDeLinks!;
    expect(montada.episodio.descricao).toContain(PAUTA_MARCADOR_DA_PAGINA_DE_LINKS);

    // Rascunho: 404 lá fora, como qualquer rascunho da bio.
    await expect(comoVisitante(() => publico.page(pg.handle))).rejects.toThrow(/não encontrada/);

    const detalhe = await na(() => paginas.publicar(orgId, e.id, PESSOA, true));
    expect(detalhe.paginaDeLinks?.publicada).toBe(true);
    expect(detalhe.descricao).toBe(`Abertura.\n\nOs links deste episódio, numa página só: https://bio.exemplo/@${pg.handle}`);
    const registro = await admin.auditLog.findFirst({ where: { orgId, entityId: pg.id, action: 'bio.page_publish' } });
    expect(registro).not.toBeNull();

    const pagina = await comoVisitante(() => publico.page(pg.handle));
    expect(pagina.links.map((l) => l.rotulo)).toEqual([ITENS[0].titulo]);

    // No ar, remontar sem bio.editar é 403 — igual a mexer num botão pelo /bio.
    await expect(na(() => paginas.montar(orgId, e.id, quem('pauta.editar')))).rejects.toBeInstanceOf(ForbiddenException);
    await na(() => paginas.montar(orgId, e.id, quem('pauta.editar', 'bio.editar')));

    const estado = { status: 0, destino: '' };
    const res = {
      redirect: (a: number | string, b?: string) => {
        estado.status = typeof a === 'number' ? a : 302;
        estado.destino = typeof a === 'number' ? (b ?? '') : a;
        return res;
      },
    };
    const linkId = pagina.links[0].id;
    await comoVisitante(() =>
      publico.redirect(linkId, { headers: { cookie: `rid=${rid}`, 'user-agent': 'teste' }, originalUrl: `/api/bio/r/${linkId}` } as never, res as never),
    );
    expect(estado).toEqual({ status: 302, destino: ITENS[0].url });

    const limite = Date.now() + 15_000;
    let pixel = null;
    while (!pixel && Date.now() < limite) {
      pixel = await admin.pixelEvent.findFirst({ where: { orgId, eventName: 'link_click', anonymousId: rid } });
      if (!pixel) await new Promise((ok) => setTimeout(ok, 50));
    }
    expect(pixel).not.toBeNull();
    expect(pixel!.metadata).toMatchObject({ fonte: 'bio', pageId: pg.id, linkId });
  }, 60_000);

  it('a peça da rodada do episódio pendura o link na página do episódio; sem episódio, em página nenhuma', async () => {
    const antes = process.env.PUBLIC_BIO_ORIGIN;
    process.env.PUBLIC_BIO_ORIGIN = 'https://bio.exemplo';
    const enviados: string[] = [];
    const evolution = {
      estado: async () => ({ conectada: true }),
      grupo: 'grupo@g.us',
      enviarTexto: async (_j: string, t: string) => {
        enviados.push(t);
        return { id: `msg-${enviados.length}` };
      },
    } as unknown as EvolutionService;
    const pub = new PublicacaoService(app, new AuditService(app), evolution, {} as ClickupService);
    process.env.PUBLIC_BIO_ORIGIN = antes;

    const { e, rodadaId } = await episodio([ITENS[1]]);
    await na(() => paginas.montar(orgId, e.id, quem('pauta.editar')));
    await na(() => paginas.publicar(orgId, e.id, PESSOA, true));
    const doEpisodio = (await admin.pautaEpisodio.findUnique({ where: { id: e.id } }))!.bioPageId!;
    const peca = await admin.pautaPeca.create({
      data: { orgId, rodadaId, canal: 'whatsapp', formato: 'texto', titulo: 'Peça', corpo: 'Corpo' },
    });
    const linksAntes = await admin.bioLink.count({ where: { page: { orgId } } });
    await na(() => pub.publicar(orgId, peca.id, PESSOA));
    const gravada = await admin.pautaPeca.findUnique({ where: { id: peca.id } });
    const link = await admin.bioLink.findUnique({ where: { id: gravada!.bioLinkId! } });
    expect(link).toMatchObject({ pageId: doEpisodio, destino: ITENS[1].url, ativo: false, chave: `campanha:peca:${peca.id}` });
    expect(enviados[0].endsWith(`/r/${link!.id}`)).toBe(true);
    expect(await admin.bioLink.count({ where: { page: { orgId } } })).toBe(linksAntes + 1);

    // O link da peça não é botão da página pública...
    const handle = (await admin.bioPage.findUnique({ where: { id: doEpisodio } }))!.handle;
    const publica = await comoVisitante(() => publico.page(handle));
    expect(publica.links.map((l) => l.id)).not.toContain(link!.id);
    // ...mas quem clica no grupo cai NA MATÉRIA, e o clique vira PixelEvent com o link da peça.
    const estado = { status: 0, destino: '' };
    const res = {
      redirect: (a: number | string, b?: string) => {
        estado.status = typeof a === 'number' ? a : 302;
        estado.destino = typeof a === 'number' ? (b ?? '') : a;
        return res;
      },
    };
    await comoVisitante(() =>
      publico.redirect(link!.id, { headers: { cookie: `rid=${rid}`, 'user-agent': 'teste' }, originalUrl: `/api/bio/r/${link!.id}` } as never, res as never),
    );
    expect(estado).toEqual({ status: 302, destino: ITENS[1].url });
    const limite = Date.now() + 15_000;
    let pixel = null;
    while (!pixel && Date.now() < limite) {
      pixel = await admin.pixelEvent.findFirst({ where: { orgId, eventName: 'link_click', anonymousId: rid, metadata: { path: ['linkId'], equals: link!.id } } });
      if (!pixel) await new Promise((ok) => setTimeout(ok, 50));
    }
    expect(pixel).not.toBeNull();
    expect(pixel!.metadata).toMatchObject({ fonte: 'bio', pageId: doEpisodio, linkId: link!.id });

    // Rodada sem episódio: a empresa tem página publicada (a "pessoal"), e mesmo assim nada é pendurado nela.
    const solta = await admin.pautaRodada.create({
      data: { orgId, status: 'curada', titulo: `Solta ${MARCA}`, janelaIni: new Date(), janelaFim: new Date(), itens: [ITENS[4]] as never },
    });
    const peca2 = await admin.pautaPeca.create({
      data: { orgId, rodadaId: solta.id, canal: 'whatsapp', formato: 'texto', titulo: 'Peça 2', corpo: 'Corpo 2' },
    });
    await na(() => pub.publicar(orgId, peca2.id, PESSOA));
    expect((await admin.pautaPeca.findUnique({ where: { id: peca2.id } }))!.bioLinkId).toBeNull();
    expect(enviados[1].endsWith(`\n\n${ITENS[4].url}`)).toBe(true);
    expect(await admin.bioLink.count({ where: { page: { orgId } } })).toBe(linksAntes + 1);
  }, 60_000);
});
