import { describe, expect, it } from 'vitest';
import { SALA_COMBINADO_PADRAO, SALA_WHATSAPP_PLACEHOLDER, SalaRascunhoSchema } from '@mktos/shared';

import { conteudoDaVersao, estacoesDaSala, hashDaSala, publicadosDaSala, type EntradaDaVersao } from '../src/comercial/sala-versao';

/*
 * A SALA PUBLICADA POR VERSÃO (rodada da implantação I3): a parte pura.
 *
 *  1. as estações saem de fato com data e nunca inventam: a feita mais adiante
 *     decide a posição, o que vem antes fica feito (data só com fonte), a
 *     seguinte é a atual;
 *  2. os publicados saem do fio (proposta, contrato) e do trilho (roteiro); o
 *     kit chega depois do kickoff, esmaecido;
 *  3. o conteúdo padrão usa o combinado do mockup e o marcador do WhatsApp;
 *  4. o hash muda com qualquer mudança e não com a ordem das chaves;
 *  5. o rascunho exige passo com o quê, data e com quem.
 */

const agora = new Date('2026-10-18T15:00:00Z');
const ev = (type: string, iso: string, payload: Record<string, unknown> = {}) => ({ type, occurredAt: new Date(iso), payload });

function entrada(over: Partial<EntradaDaVersao> = {}): EntradaDaVersao {
  return {
    agora,
    nomeDoLead: 'Marina Duarte',
    empresa: 'Construtora Alicerce',
    eventos: [],
    reuniaoEm: null,
    kickoffEm: null,
    temTrilho: false,
    marcos: [],
    dono: null,
    escrito: null,
    passoDoTrilho: null,
    ...over,
  };
}

describe('sala por versão: onde estamos', () => {
  it('sem nada: a conversa é a atual e o resto é futuro, sem data', () => {
    const e = estacoesDaSala(entrada());
    expect(e.map((x) => [x.chave, x.estado, x.em])).toEqual([
      ['conversa', 'atual', null],
      ['acordo', 'futura', null],
      ['kickoff', 'futura', null],
      ['contexto', 'futura', null],
      ['frente', 'futura', null],
    ]);
  });

  it('a ata e o cliente ativo marcam conversa e acordo com a data do fato; o kickoff é a atual', () => {
    const e = estacoesDaSala(entrada({ eventos: [ev('ata.chegou', '2026-10-10T14:00:00Z'), ev('cliente.ativo', '2026-10-16T18:00:00Z')] }));
    expect(e.map((x) => [x.chave, x.estado, x.em])).toEqual([
      ['conversa', 'feita', '2026-10-10T14:00:00.000Z'],
      ['acordo', 'feita', '2026-10-16T18:00:00.000Z'],
      ['kickoff', 'atual', null],
      ['contexto', 'futura', null],
      ['frente', 'futura', null],
    ]);
  });

  it('kickoff marcado no futuro não conta como feito; no passado, sim', () => {
    const base = { eventos: [ev('cliente.ativo', '2026-10-16T18:00:00Z')] };
    expect(estacoesDaSala(entrada({ ...base, kickoffEm: new Date('2026-10-20T13:00:00Z') }))[2].estado).toBe('atual');
    expect(estacoesDaSala(entrada({ ...base, kickoffEm: new Date('2026-10-17T13:00:00Z') }))[2]).toMatchObject({ estado: 'feita', em: '2026-10-17T13:00:00.000Z' });
  });

  it('a posição é a afirmação: o contexto carregado sem ata faz a conversa feita SEM data inventada', () => {
    const e = estacoesDaSala(entrada({ marcos: [{ tipo: 'memoria.carregada', em: new Date('2026-10-18T10:00:00Z'), dados: {} }] }));
    expect(e.map((x) => [x.chave, x.estado, x.em])).toEqual([
      ['conversa', 'feita', null],
      ['acordo', 'feita', null],
      ['kickoff', 'feita', null],
      ['contexto', 'feita', '2026-10-18T10:00:00.000Z'],
      ['frente', 'atual', null],
    ]);
  });

  it('frente rodando só com o marco de avanço PARA operação', () => {
    const outro = estacoesDaSala(entrada({ marcos: [{ tipo: 'fase.avancou', em: agora, dados: { de: 'qualificar', para: 'diagnostico' } }] }));
    expect(outro.every((x) => x.estado !== 'feita')).toBe(true);
    const op = estacoesDaSala(entrada({ marcos: [{ tipo: 'fase.avancou', em: new Date('2026-10-18T11:00:00Z'), dados: { de: 'imersao', para: 'operacao' } }] }));
    expect(op[4]).toMatchObject({ estado: 'feita', em: '2026-10-18T11:00:00.000Z' });
  });
});

describe('sala por versão: publicado para você', () => {
  it('antes de tudo: só ausências, nenhuma disponível', () => {
    const p = publicadosDaSala(entrada());
    expect(p.map((x) => [x.tipo, x.disponivel])).toEqual([['proposta', false], ['contrato', false], ['roteiro', false], ['kit', false]]);
  });

  it('proposta aceita, contrato assinado por você, roteiro do trilho e kit depois do kickoff', () => {
    const p = publicadosDaSala(entrada({
      eventos: [ev('proposta.publicada', '2026-10-12T10:00:00Z', { versao: 2 }), ev('proposta.aceita', '2026-10-14T10:00:00Z'), ev('contrato.gerado', '2026-10-14T11:00:00Z'), ev('contrato.assinado_cliente', '2026-10-15T11:00:00Z')],
      temTrilho: true,
    }));
    expect(p).toEqual([
      { tipo: 'proposta', titulo: 'Proposta v2', estado: 'aceita', disponivel: true },
      { tipo: 'contrato', titulo: 'Contrato', estado: 'assinado por você · falta a Root', disponivel: true },
      { tipo: 'roteiro', titulo: 'Roteiro do kickoff', estado: 'pronto para você ler antes da conversa', disponivel: true },
      { tipo: 'kit', titulo: 'Kit de implantação', estado: 'chega após o kickoff', disponivel: false },
    ]);
  });
});

describe('sala por versão: o conteúdo e o hash', () => {
  it('o padrão usa o nome da empresa, o combinado do mockup, o marcador do WhatsApp e o dono', () => {
    const c = conteudoDaVersao(entrada({ dono: 'Pedro Magnago' }));
    expect(c.nome).toBe('Sala · Construtora Alicerce');
    expect(c.combinado).toEqual([...SALA_COMBINADO_PADRAO]);
    expect(c.combinado.some((l) => l.includes('[a decidir'))).toBe(true);
    expect(c.whatsapp).toEqual({ numero: null, rotulo: SALA_WHATSAPP_PLACEHOLDER });
    expect(c.quemCuida).toEqual({ nome: 'Pedro Magnago', papel: 'cuida da sua conta na Root' });
    expect(c.proximosPassos).toEqual([]);
  });

  it('o passo do trilho com dono e data entra como primeiro passo padrão; o escrito pela bancada vence', () => {
    const passo = { oque: 'kickoff', quando: '2026-10-20', comQuem: 'Pedro' };
    expect(conteudoDaVersao(entrada({ passoDoTrilho: passo })).proximosPassos).toEqual([passo]);
    const escrito = { proximosPassos: [{ oque: 'mandar os acessos', quando: '2026-10-21', comQuem: 'Marina' }], combinado: ['x'], quemCuida: null };
    const c = conteudoDaVersao(entrada({ passoDoTrilho: passo, escrito }));
    expect(c.proximosPassos).toEqual(escrito.proximosPassos);
    expect(c.combinado).toEqual(['x']);
    expect(c.quemCuida).toBeNull();
  });

  it('o hash muda com o conteúdo e não com a ordem das chaves', () => {
    const c = conteudoDaVersao(entrada());
    const reordenado = JSON.parse(JSON.stringify({ whatsapp: c.whatsapp, quemCuida: c.quemCuida, combinado: c.combinado, publicados: c.publicados, proximosPassos: c.proximosPassos, estacoes: c.estacoes, nome: c.nome }));
    expect(hashDaSala(reordenado)).toBe(hashDaSala(c));
    expect(hashDaSala({ ...c, nome: 'outro' })).not.toBe(hashDaSala(c));
    expect(hashDaSala(c)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('o rascunho exige o quê, data AAAA-MM-DD e com quem; recusa campo a mais', () => {
    expect(SalaRascunhoSchema.safeParse({ proximosPassos: [{ oque: 'a', quando: '2026-10-21', comQuem: 'b' }], combinado: [], quemCuida: null }).success).toBe(true);
    expect(SalaRascunhoSchema.safeParse({ proximosPassos: [{ oque: 'a', quando: '21/10', comQuem: 'b' }], combinado: [], quemCuida: null }).success).toBe(false);
    expect(SalaRascunhoSchema.safeParse({ proximosPassos: [{ oque: '', quando: '2026-10-21', comQuem: 'b' }], combinado: [], quemCuida: null }).success).toBe(false);
    expect(SalaRascunhoSchema.safeParse({ proximosPassos: [], combinado: [], quemCuida: null, estacoes: [] }).success).toBe(false);
  });
});
