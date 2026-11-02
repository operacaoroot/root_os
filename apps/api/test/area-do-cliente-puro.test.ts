import { describe, expect, it } from 'vitest';
import {
  AREA_BLOCOS, AREA_FASES_DO_FLUXO, AREA_IDS_DOS_ITENS, AREA_ITENS, AREA_ITENS_ESCRITOS, AreaItemRascunhoSchema, AreaLeituraSchema,
  ehConteudoDeItem, itemTemRascunho,
} from '@mktos/shared';

import { bancadaDaArea, fonteDoItem } from '../src/comercial/area-do-cliente-bancada';
import {
  areaParaOCliente, conteudoPublicadoParaOCliente, derivadosDaArea, edicoesPorVersao, faseDoFluxo, modoDaSala, type EntradaDaArea,
} from '../src/comercial/area-do-cliente-projecao';
import { escritoDoItem } from '../src/comercial/sala-versao.service';
import areaDoCliente from '../src/platform/area-do-cliente.json';
import fluxoDoCliente from '../src/platform/fluxo-do-cliente.json';
import type { AcompanhamentoDaSala, EventoDaSala } from '../src/comercial/sala-projecao';
import { projetarSala } from '../src/comercial/sala-projecao';

/*
 * A ÁREA DO CLIENTE SEM BANCO (leva A, 30/10/2026).
 *
 *  1. o shared e o desenho (`area-do-cliente.json`) dizem os MESMOS quinze itens,
 *     nos mesmos blocos, com a mesma fase de entrada e o mesmo "como chega"; as
 *     sete fases são as do Fluxo v6;
 *  2. o modo: lead em andamento abre a sala; fechado (ficha ou fato) ou com o
 *     card da implantação abre a área;
 *  3. a fase do fluxo sai de fatos com data e nunca pula para a frente sem eles;
 *  4. os derivados da leva A: contrato, escopo, dúvidas e a linha de execução,
 *     cada um só quando a fonte existe (o resto fica vazio dizendo a fase);
 *  5. a versão publicada vence o derivado; "novo" até a leitura daquela versão;
 *  6. a edição é a posição entre as versões do mesmo item (o número é por lead);
 *  7. a bancada: estado, ação e nota por item; derivado não tem ação;
 *  8. o rascunho recusa link em claro e o vazio; a leitura exige item e versão.
 */

const agora = new Date('2026-11-05T15:00:00Z');
const ev = (type: string, iso: string, payload: Record<string, unknown> = {}): EventoDaSala => ({ type, occurredAt: new Date(iso), payload });

const PROPOSTA = ev('proposta.publicada', '2026-10-20T12:00:00Z', { versao: 1, produto: 'operacao', valorCentavos: 1_200_000, parcelas: 12, parcelaCentavos: 100_000, formas: ['pix'], validaAte: '2026-10-30' });
const ACEITA = ev('proposta.aceita', '2026-10-22T12:00:00Z', { versao: 1, produto: 'operacao', valorCentavos: 1_200_000, parcelas: 12, forma: 'pix', hash: 'h' });
const ATIVO = ev('cliente.ativo', '2026-10-25T12:00:00Z', {});

function projecao(eventos: EventoDaSala[], ficha: Partial<NonNullable<EntradaDaArea['ficha']>> & { etapa?: string } = {}) {
  const fichaDaSala = {
    etapa: ficha.etapa ?? 'fechado',
    empresa: 'Construtora Alicerce',
    reuniaoEm: null,
    quadroDeCustos: null,
    grupoJid: null,
    kickoffEm: ficha.kickoffEm ?? null,
    clienteAtivoEm: ficha.clienteAtivoEm ?? null,
    trilhoId: null,
  };
  const estado = projetarSala({ slug: 'alicerce', nomeDoLead: 'Marina', validoAte: new Date('2027-01-01'), dados: {}, ficha: fichaDaSala, eventos, cobrancas: [], documentos: [], agora });
  return estado;
}

const acompanhamento = (over: Partial<AcompanhamentoDaSala> = {}): AcompanhamentoDaSala => ({
  etapa: { chave: 'fechado', rotulo: 'Negócio fechado', descricao: 'Bem-vindo.', ordem: 9, total: 9, saida: false },
  proximosPassos: [],
  documentos: [],
  contato: { whatsapp: null, rotulo: 'WhatsApp da Root: o número chega em breve nesta sala' },
  ...over,
});

function entrada(over: Partial<EntradaDaArea> = {}): EntradaDaArea {
  const eventos = over.eventos ?? [PROPOSTA, ACEITA, ATIVO];
  return {
    agora,
    empresa: 'Construtora Alicerce',
    ficha: { clienteAtivoEm: new Date('2026-10-25T12:00:00Z'), kickoffEm: null, cardId: 'card-1' },
    eventos,
    estado: projecao([...eventos], { clienteAtivoEm: new Date('2026-10-25T12:00:00Z') }),
    acompanhamento: acompanhamento(),
    salaPublicada: null,
    trilho: null,
    publicadas: [],
    leituras: [],
    quemCuida: { nome: 'Rodrigo', papel: 'dono da conta' },
    ...over,
  };
}

describe('o shared e o desenho dizem os mesmos quinze itens', () => {
  const doJson = areaDoCliente.itens as { id: string; bloco: string; entra_na_fase: string; como_chega: string; tarefa_do_fluxo: string | null }[];

  it('mesmos ids, nos mesmos blocos, com a mesma fase e o mesmo "como chega"', () => {
    expect([...AREA_IDS_DOS_ITENS].sort()).toEqual(doJson.map((i) => i.id).sort());
    expect(AREA_ITENS).toHaveLength(15);
    const comoChega: Record<string, string> = { misto: 'misto', 'escrito pela Root': 'escrito', derivado: 'derivado' };
    for (const i of AREA_ITENS) {
      const j = doJson.find((x) => x.id === i.id)!;
      expect(j.bloco, i.id).toBe(i.bloco);
      expect(j.entra_na_fase, i.id).toBe(i.entraNaFase);
      expect(comoChega[j.como_chega], i.id).toBe(i.comoChega);
      expect(j.tarefa_do_fluxo, i.id).toBe(i.tarefaDoFluxo);
      expect(AREA_BLOCOS).toContain(i.bloco);
    }
  });

  it('as sete fases são as do Fluxo do cliente v6, na ordem', () => {
    const fases = (fluxoDoCliente as { fases: { id: string; nome: string }[] }).fases;
    expect(AREA_FASES_DO_FLUXO.map((f) => f.id)).toEqual(fases.map((f) => f.id));
    // O nome curto é o começo do nome do fluxo ("Construção, 30 dias" → "Construção").
    for (const f of AREA_FASES_DO_FLUXO) expect(fases.find((x) => x.id === f.id)!.nome.startsWith(f.nome)).toBe(true);
  });

  it('cinco itens são derivados (sem rascunho) e dez são escritos pela Root', () => {
    expect(AREA_ITENS.filter((i) => i.comoChega === 'derivado').map((i) => i.id).sort()).toEqual(['agenda', 'contrato', 'duvidas', 'escopo', 'linha-de-execucao']);
    expect(AREA_ITENS_ESCRITOS).toHaveLength(10);
    expect(itemTemRascunho('atas')).toBe(true);
    expect(itemTemRascunho('contrato')).toBe(false);
    // O desenho tem o texto de fonte de todo item.
    for (const id of AREA_IDS_DOS_ITENS) expect(fonteDoItem(id).length, id).toBeGreaterThan(10);
  });
});

describe('o modo do link', () => {
  it('lead em andamento é sala; fechado pela ficha, pelo fato ou com o card da implantação é área', () => {
    expect(modoDaSala({ ficha: { clienteAtivoEm: null, cardId: null }, eventos: [PROPOSTA] })).toBe('sala');
    expect(modoDaSala({ ficha: null, eventos: [] })).toBe('sala');
    expect(modoDaSala({ ficha: { clienteAtivoEm: new Date(), cardId: null }, eventos: [] })).toBe('area');
    expect(modoDaSala({ ficha: { clienteAtivoEm: null, cardId: null }, eventos: [ATIVO] })).toBe('area');
    expect(modoDaSala({ ficha: { clienteAtivoEm: null, cardId: 'card' }, eventos: [] })).toBe('area');
  });
});

describe('a fase do fluxo sai de fatos com data', () => {
  const base = { agora, eventos: [] as EventoDaSala[], trilho: null };

  it('sem fechamento é Fechamento; fechado é Abertura; kickoff que passou é Primeira semana', () => {
    expect(faseDoFluxo({ ...base, ficha: { clienteAtivoEm: null, kickoffEm: null, cardId: 'c' } }).atual).toBe('fase-1');
    expect(faseDoFluxo({ ...base, ficha: { clienteAtivoEm: new Date('2026-11-01'), kickoffEm: null, cardId: null } }).atual).toBe('fase-2');
    // Kickoff marcado para amanhã ainda não abre a primeira semana.
    expect(faseDoFluxo({ ...base, ficha: { clienteAtivoEm: new Date('2026-11-01'), kickoffEm: new Date('2026-11-06T12:00:00Z'), cardId: null } }).atual).toBe('fase-2');
    expect(faseDoFluxo({ ...base, ficha: { clienteAtivoEm: new Date('2026-11-01'), kickoffEm: new Date('2026-11-03T12:00:00Z'), cardId: null } }).atual).toBe('fase-3');
    // O kickoff marcado pela sala (o fato) vale como o da ficha.
    expect(faseDoFluxo({ ...base, eventos: [ATIVO, ev('kickoff.marcado', '2026-10-26T10:00:00Z', { horario: '2026-11-03T12:00:00Z' })], ficha: null }).atual).toBe('fase-3');
  });

  it('sete dias depois do kickoff é Construção; trinta, ou o trilho em operação, é Acompanhamento; trilho encerrado é a última', () => {
    const f = (kickoff: string, trilho: EntradaDaArea['trilho'] = null) => faseDoFluxo({ agora, eventos: [], trilho, ficha: { clienteAtivoEm: new Date('2026-09-01'), kickoffEm: new Date(kickoff), cardId: null } });
    expect(f('2026-10-30T12:00:00Z').atual).toBe('fase-3');
    expect(f('2026-10-28T12:00:00Z').atual).toBe('fase-4');
    expect(f('2026-10-01T12:00:00Z').atual).toBe('fase-5');
    expect(f('2026-10-30T12:00:00Z', { fase: 'operacao', marcos: [] }).atual).toBe('fase-5');
    expect(f('2026-10-30T12:00:00Z', { fase: 'imersao', marcos: [{ tipo: 'fase.avancou', em: agora, dados: { para: 'operacao' } }] }).atual).toBe('fase-5');
    expect(f('2026-10-30T12:00:00Z', { fase: 'encerrado', marcos: [] }).atual).toBe('fase-7');
    const r = f('2026-10-28T12:00:00Z');
    expect(r.fases.map((x) => x.estado)).toEqual(['feita', 'feita', 'feita', 'atual', 'futura', 'futura', 'futura']);
  });
});

describe('os derivados da leva A', () => {
  it('escopo sai da proposta aceita, dúvidas sempre existe (com ou sem número), contrato só com documento, linha de execução só com passo', () => {
    const e = entrada();
    const d = derivadosDaArea(e);
    expect(d.escopo?.conteudo.resumo).toContain('aceito por você');
    expect(d.escopo?.conteudo.resumo).toContain('12×');
    expect(d.escopo?.abre).toEqual({ tipo: 'proposta' });
    expect(d.duvidas?.conteudo.resumo).toBe('WhatsApp da Root: o número chega em breve nesta sala');
    expect(d.duvidas?.abre).toBeNull();
    expect(d.contrato).toBeUndefined();
    expect(d['linha-de-execucao']).toBeUndefined();
    expect(d.agenda).toBeUndefined();
  });

  it('com o número da Root a dúvida abre o WhatsApp; com o contrato de assinatura o item traz o estado e o link do cliente', () => {
    const d = derivadosDaArea(entrada({
      acompanhamento: acompanhamento({
        contato: { whatsapp: '5532999990000', rotulo: 'Falar com a Root no WhatsApp' },
        documentos: [{ tipo: 'contrato', titulo: 'Contrato', estado: 'aguardando a sua assinatura', de: 'root', em: '2026-10-23T12:00:00Z', link: 'https://app.zapsign.com.br/verificar/x' }],
        proximosPassos: [{ texto: 'Escolher o horário do kickoff', quando: null, quandoTipo: null, deQuem: 'voce' }],
      }),
    }));
    expect(d.duvidas?.abre).toEqual({ tipo: 'externo', url: 'https://wa.me/5532999990000' });
    expect(d.contrato?.conteudo.resumo).toBe('Contrato · aguardando a sua assinatura');
    expect(d.contrato?.abre).toEqual({ tipo: 'externo', url: 'https://app.zapsign.com.br/verificar/x' });
    expect(d['linha-de-execucao']?.conteudo.topicos).toEqual(['você: Escolher o horário do kickoff']);
    expect(d['linha-de-execucao']?.conteudo.resumo).toBe('Negócio fechado');
  });

  it('os próximos passos da sala publicada entram antes dos derivados, com data e com quem', () => {
    const d = derivadosDaArea(entrada({
      salaPublicada: {
        versao: 2,
        publicadaEm: '2026-10-26T12:00:00Z',
        conteudo: { nome: 'Sala', estacoes: [], proximosPassos: [{ oque: 'Mapear os acessos', quando: '2026-11-07', comQuem: 'Pedro' }], publicados: [], combinado: [], quemCuida: null, whatsapp: { numero: null, rotulo: '' } },
      },
      acompanhamento: acompanhamento({ proximosPassos: [{ texto: 'Kickoff com a Root', quando: '2026-11-06T13:00:00Z', quandoTipo: 'em', deQuem: 'voce' }] }),
    }));
    expect(d['linha-de-execucao']?.conteudo.topicos).toEqual(['Mapear os acessos · 07/11 · com Pedro', 'você: Kickoff com a Root · 06/11']);
  });
});

describe('a área inteira', () => {
  it('quinze slots nos quatro blocos; os derivados preenchidos, o resto vazio dizendo a fase; nada "novo" sem versão publicada', () => {
    const a = areaParaOCliente(entrada());
    const itens = a.blocos.flatMap((b) => b.itens);
    expect(a.blocos.map((b) => b.id)).toEqual(['onde-estamos', 'o-combinado', 'como-usar', 'novidades']);
    expect(itens).toHaveLength(15);
    expect(a.total).toBe(15);
    // Sem documento de contrato nem passo: só escopo e dúvidas preenchidos.
    expect(a.noAr).toBe(2);
    expect(itens.filter((i) => i.estado === 'publicado').map((i) => i.id).sort()).toEqual(['duvidas', 'escopo']);
    expect(itens.every((i) => i.estado !== 'publicado' || i.origem === 'derivado')).toBe(true);
    expect(itens.some((i) => i.novo)).toBe(false);
    const prd = itens.find((i) => i.id === 'prd')!;
    expect(prd.estado).toBe('vazio');
    expect(prd.chegaNaFase).toEqual({ id: 'fase-3', numero: 3, nome: 'Primeira semana' });
    expect(a.atualizadoEm).toBeNull();
    expect(a.fase.atual).toBe('fase-2');
    expect(a.quemCuida).toEqual({ nome: 'Rodrigo', papel: 'dono da conta' });
  });

  it('a versão publicada vence o derivado; "novo" até a leitura daquela versão; a leitura de uma edição antiga não tira o novo da nova', () => {
    const publicadas = [
      { item: 'escopo', numero: 3, edicao: 1, publicadaEm: new Date('2026-10-27T10:00:00Z'), conteudo: { item: 'escopo', resumo: 'Operação assistida, 12 meses', topicos: ['Fechamento mensal', 'Conciliação'] } },
      { item: 'atas', numero: 4, edicao: 1, publicadaEm: new Date('2026-10-28T10:00:00Z'), conteudo: { item: 'atas', resumo: 'Ata da abertura', quando: '2026-10-28' } },
      { item: 'atas', numero: 6, edicao: 2, publicadaEm: new Date('2026-11-02T10:00:00Z'), conteudo: { item: 'atas', resumo: 'Ata da primeira semana', oQueMudou: 'nova reunião' } },
    ];
    const a = areaParaOCliente(entrada({ publicadas, leituras: [{ item: 'atas', versao: 4 }, { item: 'escopo', versao: 3 }] }));
    const itens = a.blocos.flatMap((b) => b.itens);
    const escopo = itens.find((i) => i.id === 'escopo')!;
    expect(escopo.origem).toBe('publicado');
    expect(escopo.conteudo?.resumo).toBe('Operação assistida, 12 meses');
    expect(escopo.conteudo?.topicos).toEqual(['Fechamento mensal', 'Conciliação']);
    expect(escopo.novo).toBe(false);
    expect(escopo.abre).toBeNull();
    const atas = itens.find((i) => i.id === 'atas')!;
    expect(atas.versao).toBe(6);
    expect(atas.edicao).toBe(2);
    expect(atas.novo).toBe(true);
    expect(atas.conteudo?.oQueMudou).toBe('nova reunião');
    expect(a.atualizadoEm).toBe('2026-11-02T10:00:00.000Z');
    expect(a.noAr).toBe(3);
  });

  it('o conteúdo publicado chega ao cliente sem o id do item nem o id do documento', () => {
    const c = conteudoPublicadoParaOCliente({ item: 'prd', resumo: 'PRD v1', documentoId: '2c1c7e1a-5d1d-4f5f-9a5b-3d2e1f0a9b8c', topicos: ['', 'um'] });
    expect(c).toEqual({ resumo: 'PRD v1', texto: null, topicos: ['um'], quando: null, documento: { titulo: 'Documento anexado pela Root', link: null }, oQueMudou: null });
    expect(conteudoPublicadoParaOCliente({ nome: 'sala' }).resumo).toBeNull();
  });
});

describe('a edição e o escrito de uma versão de item', () => {
  it('a edição é a posição entre as versões do mesmo item; a sala (item nulo) fica de fora', () => {
    const ed = edicoesPorVersao([
      { numero: 1, item: null },
      { numero: 2, item: 'atas' },
      { numero: 3, item: 'cronograma' },
      { numero: 5, item: 'atas' },
      { numero: 4, item: null },
      { numero: 9, item: 'atas' },
    ]);
    expect(ed.get(2)).toBe(1);
    expect(ed.get(5)).toBe(2);
    expect(ed.get(9)).toBe(3);
    expect(ed.get(3)).toBe(1);
    expect(ed.has(1)).toBe(false);
  });

  it('o escrito volta sem o id do item; conteúdo da sala não é conteúdo de item', () => {
    expect(escritoDoItem({ item: 'atas', resumo: 'x', topicos: ['a'] })).toEqual({ resumo: 'x', topicos: ['a'] });
    expect(escritoDoItem({ nome: 'Sala', estacoes: [] })).toBeNull();
    expect(ehConteudoDeItem({ item: 'nao-existe' })).toBe(false);
  });
});

describe('a bancada', () => {
  const versoes = [
    { item: 'atas', numero: 4, estado: 'substituida', approvalId: null, publicadaEm: new Date('2026-10-28'), atualizadoEm: new Date('2026-10-28'), publicadaPor: 'u1', hash: 'a'.repeat(64) },
    { item: 'atas', numero: 6, estado: 'publicada', approvalId: null, publicadaEm: new Date('2026-11-02'), atualizadoEm: new Date('2026-11-02'), publicadaPor: 'u2', hash: 'b'.repeat(64) },
    { item: 'prd', numero: 7, estado: 'rascunho', approvalId: null, publicadaEm: null, atualizadoEm: new Date('2026-11-03'), publicadaPor: null, hash: 'c'.repeat(64) },
    { item: 'cronograma', numero: 8, estado: 'na_porta', approvalId: 'ap-1', publicadaEm: null, atualizadoEm: new Date('2026-11-04'), publicadaPor: null, hash: 'd'.repeat(64) },
  ];

  it('estado, ação e nota por item; o derivado não tem ação; o lido traz a data', () => {
    const area = areaParaOCliente(entrada());
    const b = bancadaDaArea({ leadId: 'l1', temSala: true, modo: 'area', area, versoes, leituras: [{ item: 'atas', versao: 6, em: new Date('2026-11-03T09:00:00Z') }] });
    const por = Object.fromEntries(b.itens.map((i) => [i.id, i]));
    expect(b.itens).toHaveLength(15);
    expect(por.atas).toMatchObject({ estado: 'lido', acao: 'escrever', lidoEm: '2026-11-03T09:00:00.000Z', publicada: { versao: 6, edicao: 2, publicadaPor: 'u2' } });
    expect(por.prd).toMatchObject({ estado: 'rascunho', acao: 'publicar', aberta: { versao: 7, estado: 'rascunho' } });
    expect(por.cronograma).toMatchObject({ estado: 'na_porta', acao: 'nada', aberta: { versao: 8, approvalId: 'ap-1' } });
    expect(por.escopo).toMatchObject({ estado: 'derivado', acao: 'nada', publicada: null });
    expect(por.contrato).toMatchObject({ estado: 'vazio', acao: 'nada', comoChega: 'derivado' });
    expect(por.videos).toMatchObject({ estado: 'vazio', acao: 'escrever', entraNaFase: { numero: 3 } });
    expect(por.videos.nota).toContain('fase 3');
    expect(por.manutencao.tarefaDoFluxo).toBeNull();
    // No ar: atas (lida), escopo e dúvidas (derivados).
    expect(b.noAr).toBe(3);
    expect(b.total).toBe(15);
  });

  it('sem sala e em modo sala, tudo vazio e a nota diz que a área chega com o fechamento', () => {
    const b = bancadaDaArea({ leadId: 'l2', temSala: false, modo: 'sala', area: null, versoes: [], leituras: [] });
    expect(b.noAr).toBe(0);
    expect(b.itens.every((i) => i.estado === 'vazio')).toBe(true);
    expect(b.itens.find((i) => i.id === 'contrato')!.nota).toContain('quando o negócio fechar');
  });
});

describe('os esquemas', () => {
  it('o rascunho exige algo escrito e recusa link em claro em qualquer campo', () => {
    expect(AreaItemRascunhoSchema.safeParse({}).success).toBe(false);
    expect(AreaItemRascunhoSchema.safeParse({ resumo: 'Ata da abertura' }).success).toBe(true);
    expect(AreaItemRascunhoSchema.safeParse({ topicos: ['um combinado'] }).success).toBe(true);
    expect(AreaItemRascunhoSchema.safeParse({ documentoId: '2c1c7e1a-5d1d-4f5f-9a5b-3d2e1f0a9b8c' }).success).toBe(true);
    expect(AreaItemRascunhoSchema.safeParse({ resumo: 'veja em https://drive.google.com/x' }).success).toBe(false);
    expect(AreaItemRascunhoSchema.safeParse({ resumo: 'ok', topicos: ['www.exemplo.com'] }).success).toBe(false);
    expect(AreaItemRascunhoSchema.safeParse({ resumo: 'ok', quando: '07/11/2026' }).success).toBe(false);
    expect(AreaItemRascunhoSchema.safeParse({ resumo: 'ok', quando: '2026-11-07', extra: 1 }).success).toBe(false);
  });

  it('a leitura exige um item conhecido e uma versão inteira', () => {
    expect(AreaLeituraSchema.safeParse({ item: 'atas', versao: 6 }).success).toBe(true);
    expect(AreaLeituraSchema.safeParse({ item: 'sala', versao: 6 }).success).toBe(false);
    expect(AreaLeituraSchema.safeParse({ item: 'atas', versao: 0 }).success).toBe(false);
    expect(AreaLeituraSchema.safeParse({ item: 'atas', versao: '6' }).success).toBe(false);
  });
});
