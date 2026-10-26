import 'reflect-metadata';

import { describe, expect, it } from 'vitest';
import { ehGrupoDaEquipePeloNome, nomeDoGrupoSemPrefixo, normalizarNomeDeVinculo } from '@mktos/shared';

import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import {
  alvosComNomeIgual,
  decidirGrupo,
  decidirUmAUm,
  digitosDoTelefone,
  formasEmDigitos,
  ordenarCandidatos,
  semelhanca,
  telefoneCasa,
  type AlvoDaBusca,
  type NomesDoAlvo,
} from '../src/whatsapp/vinculo';
import { SoGenteNoVinculoGuard, VinculoDoWhatsappController } from '../src/whatsapp/vinculo.controller';
import { ID_DO_INDICE, ID_DO_WHATSAPP, montarTeia } from '../src/onboarding/trilho/teia-do-cliente';

/*
 * O VÍNCULO DA CONVERSA (produção 22C, W3): as regras puras. Todos os nomes e
 * números são FICTÍCIOS.
 */

const cliente = (id: string, ...nomes: string[]): NomesDoAlvo => ({ tipo: 'cliente', id, nome: nomes[0], nomes });
const lead = (id: string, ...nomes: string[]): NomesDoAlvo => ({ tipo: 'lead', id, nome: nomes[0], nomes });

describe('o nome do grupo', () => {
  it('os prefixos da casa saem: "ROOT | ", "Root | ", "ROOT - ", com espaço livre', () => {
    expect(nomeDoGrupoSemPrefixo('ROOT | Padaria Aurora')).toBe('Padaria Aurora');
    expect(nomeDoGrupoSemPrefixo('Root | Padaria Aurora')).toBe('Padaria Aurora');
    expect(nomeDoGrupoSemPrefixo('ROOT - Padaria Aurora')).toBe('Padaria Aurora');
    expect(nomeDoGrupoSemPrefixo('  root|Padaria Aurora  ')).toBe('Padaria Aurora');
    expect(nomeDoGrupoSemPrefixo('Padaria Aurora')).toBeNull();
    expect(nomeDoGrupoSemPrefixo('ROOT | ')).toBeNull();
  });

  it('a normalização tira acento, caixa e pontuação', () => {
    expect(normalizarNomeDeVinculo('Café  Serra Ltda.')).toBe('cafe serra ltda');
    expect(normalizarNomeDeVinculo('AÇÃO & Cia - ME')).toBe('acao cia me');
    expect(normalizarNomeDeVinculo(null)).toBe('');
  });

  it('a equipe pelo nome: estratégia, FullBPO e a comunidade; cliente não', () => {
    expect(ehGrupoDaEquipePeloNome('ROOT | Estratégia e Produto')).toBe(true);
    expect(ehGrupoDaEquipePeloNome('FullBPO | Operação Root')).toBe(true);
    expect(ehGrupoDaEquipePeloNome('Operação Root | IA para Negócios')).toBe(true);
    expect(ehGrupoDaEquipePeloNome('ROOT | Padaria Aurora')).toBe(false);
  });
});

describe('o grupo só SUGERE, e só pelo nome IGUAL', () => {
  const clientes = [cliente('c1', 'Padaria Aurora', 'Padaria Aurora Comércio de Pães Ltda'), cliente('c2', 'Oficina Boa Vista')];
  const leads = [lead('l1', 'Marcenaria Ipê'), lead('l2', 'Transportes Horizonte')];

  it('igual a um cliente (pela fantasia ou pela razão social) sugere o cliente', () => {
    expect(decidirGrupo('ROOT | Padaria Aurora', clientes, leads)).toEqual({ equipe: false, sugestao: { tipo: 'cliente', id: 'c1', nome: 'Padaria Aurora', como: 'nome_igual' } });
    expect(decidirGrupo('Root | padaria aurora comércio de pães ltda.', clientes, leads).sugestao?.id).toBe('c1');
  });

  it('sem cliente igual, um lead igual é sugerido', () => {
    expect(decidirGrupo('ROOT - Marcenaria Ipe', clientes, leads).sugestao).toEqual({ tipo: 'lead', id: 'l1', nome: 'Marcenaria Ipê', como: 'nome_igual' });
  });

  it('parecido não sugere; nada parecido não sugere; sem prefixo não sugere', () => {
    expect(decidirGrupo('ROOT | Padaria Aurora Filial', clientes, leads).sugestao).toBeNull();
    expect(decidirGrupo('ROOT | Padaria Auroras', clientes, leads).sugestao).toBeNull();
    expect(decidirGrupo('ROOT | Floricultura Lírio', clientes, leads).sugestao).toBeNull();
    expect(decidirGrupo('Padaria Aurora', clientes, leads).sugestao).toBeNull();
  });

  it('empate (dois clientes com o mesmo nome) não sugere ninguém, nem o lead', () => {
    const empate = [...clientes, cliente('c3', 'Padaria Aurora')];
    expect(decidirGrupo('ROOT | Padaria Aurora', empate, [lead('l9', 'Padaria Aurora')]).sugestao).toBeNull();
    expect(decidirGrupo('ROOT | Marcenaria Ipê', clientes, [...leads, lead('l3', 'Marcenaria Ipê')]).sugestao).toBeNull();
  });

  it('o mesmo cliente igual por dois nomes conta uma vez', () => {
    expect(alvosComNomeIgual('Padaria Aurora', [cliente('c1', 'Padaria Aurora', 'padaria aurora')])).toHaveLength(1);
  });

  it('grupo da equipe é equipe, sem sugestão', () => {
    expect(decidirGrupo('ROOT | Estratégia e Produto', clientes, leads)).toEqual({ equipe: true, sugestao: null });
  });
});

describe('o 1:1 casa pelo telefone, por igualdade', () => {
  const numero = '5532988887777';

  it('com e sem o 55 casam; formatado casa', () => {
    expect(telefoneCasa('5532988887777', numero)).toBe(true);
    expect(telefoneCasa('32988887777', numero)).toBe(true);
    expect(telefoneCasa('(32) 98888-7777', numero)).toBe(true);
    expect(telefoneCasa('+55 32 98888-7777', numero)).toBe(true);
  });

  it('com e sem o 9 NÃO casam (são números diferentes)', () => {
    expect(telefoneCasa('553288887777', numero)).toBe(false);
    expect(telefoneCasa('3288887777', numero)).toBe(false);
    expect(telefoneCasa('5532988887777', '553288887777')).toBe(false);
  });

  it('vazio, curto ou outro número não casa', () => {
    expect(telefoneCasa(null, numero)).toBe(false);
    expect(telefoneCasa('', numero)).toBe(false);
    expect(telefoneCasa('88887777', numero)).toBe(false);
    expect(telefoneCasa('5532988887776', numero)).toBe(false);
  });

  it('as formas da consulta: com e sem o 55', () => {
    expect(formasEmDigitos(numero)).toEqual([numero, '32988887777']);
    expect(digitosDoTelefone('(32) 8888-7777')).toBe('553288887777');
  });

  it('um candidato casa; dois com o mesmo telefone não casam; equipe não liga', () => {
    expect(decidirUmAUm(false, ['l1'], [])).toEqual({ equipe: false, leadId: 'l1', clienteId: null });
    // Revisão 22C (A2): o lead que fechou vira cliente com o mesmo telefone; a conversa liga só ao cliente (CHECK no banco).
    expect(decidirUmAUm(false, ['l1'], ['c1'])).toEqual({ equipe: false, leadId: null, clienteId: 'c1' });
    expect(decidirUmAUm(false, ['l1'], ['c1', 'c2'])).toEqual({ equipe: false, leadId: 'l1', clienteId: null });
    expect(decidirUmAUm(false, ['l1', 'l2'], ['c1', 'c2'])).toEqual({ equipe: false, leadId: null, clienteId: null });
    expect(decidirUmAUm(false, ['l1', 'l1'], [])).toEqual({ equipe: false, leadId: 'l1', clienteId: null });
    expect(decidirUmAUm(true, ['l1'], ['c1'])).toEqual({ equipe: true, leadId: null, clienteId: null });
  });
});

describe('a busca de vínculo', () => {
  const alvos: AlvoDaBusca[] = [
    { tipo: 'cliente', id: 'c1', nome: 'Padaria Aurora', nomes: ['Padaria Aurora'], detalhe: null },
    { tipo: 'cliente', id: 'c2', nome: 'Padaria Aurora Filial', nomes: ['Padaria Aurora Filial'], detalhe: null },
    { tipo: 'lead', id: 'l1', nome: 'Oficina Boa Vista', nomes: ['Oficina Boa Vista'], detalhe: null },
    { tipo: 'lead', id: 'l2', nome: 'Padoca Aurora', nomes: ['Padoca Aurora'], detalhe: null },
  ];

  it('o igual primeiro, depois o mais parecido; o diferente não aparece sem busca', () => {
    const r = ordenarCandidatos(alvos, { nomeDaConversa: 'Padaria Aurora', busca: null });
    expect(r[0]).toMatchObject({ id: 'c1', igual: true });
    expect(r.map((c) => c.id)).toContain('c2');
    expect(r.map((c) => c.id)).toContain('l2');
    expect(r.map((c) => c.id)).not.toContain('l1');
    expect(r.filter((c) => c.igual)).toHaveLength(1);
  });

  it('com a busca digitada, filtra por ela e o igual continua marcado', () => {
    const r = ordenarCandidatos(alvos, { nomeDaConversa: 'Padaria Aurora', busca: 'oficina' });
    expect(r.map((c) => c.id)).toEqual(['l1']);
    expect(ordenarCandidatos(alvos, { nomeDaConversa: 'Padaria Aurora', busca: 'aurora' })[0]).toMatchObject({ id: 'c1', igual: true });
  });

  it('teto de 20', () => {
    const muitos: AlvoDaBusca[] = Array.from({ length: 40 }, (_, i) => ({ tipo: 'lead', id: `x${i}`, nome: `Loja Exemplo ${i}`, nomes: [`Loja Exemplo ${i}`], detalhe: null }));
    expect(ordenarCandidatos(muitos, { nomeDaConversa: null, busca: 'loja' })).toHaveLength(20);
  });

  it('a semelhança só ordena: igual é 1, diferente é baixo', () => {
    expect(semelhanca('Padaria Aurora', 'padaria aurora')).toBe(1);
    expect(semelhanca('Padaria Aurora', 'Padaria Aurora Filial')).toBeGreaterThan(0.7);
    expect(semelhanca('Padaria Aurora', 'Oficina Boa Vista')).toBeLessThan(0.3);
  });
});

describe('as rotas', () => {
  it('ler é leads.ver; toda escrita é leads.editar e só de gente', () => {
    const h = VinculoDoWhatsappController.prototype;
    for (const m of [h.candidatos, h.doLead, h.doCliente]) expect(Reflect.getMetadata(PERMISSIONS_KEY, m)).toEqual(['leads.ver']);
    for (const m of [h.vincular, h.aceitarSugestao, h.desvincular, h.equipe, h.comunidade, h.telefoneNoLead, h.telefoneDoLead, h.telefoneDoCliente]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, m)).toEqual(['leads.editar']);
      expect(Reflect.getMetadata('__guards__', m)).toEqual([SoGenteNoVinculoGuard]);
    }
  });

  it('o guarda recusa conta de máquina e sem usuário', () => {
    const ctx = (user: unknown) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as never;
    const g = new SoGenteNoVinculoGuard();
    expect(g.canActivate(ctx({ sub: 'u1', roles: ['admin_master'] }))).toBe(true);
    expect(() => g.canActivate(ctx({ sub: 'u2', roles: ['ia_acao'] }))).toThrow(/de gente/);
    expect(() => g.canActivate(ctx(undefined))).toThrow();
  });
});

describe('a teia do cliente conta a conversa', () => {
  const base = { slug: 'cliente-ficticio', nivel: null, blocosDoLink: 'BCD' as const, itens: [], notasDaConversa: [] };

  it('com conversa ligada, um nó "da conversa" ligado ao índice e aos canais; sem texto de mensagem', () => {
    const t = montarTeia({ ...base, whatsapp: { conversas: 1, mensagens: 12 } });
    const no = t.nos.find((n) => n.id === ID_DO_WHATSAPP);
    expect(no).toMatchObject({ tipo: 'conversa', estado: 'conversa' });
    expect(no?.corpo).toContain('12 mensagens');
    expect(no?.ligacoes).toContain(ID_DO_INDICE);
    expect(no?.ligacoes).toContain('canais');
    expect(t.contagem.daConversa).toBe(1);
  });

  it('sem conversa (ou zero), a teia é a de antes', () => {
    const antes = montarTeia(base);
    expect(montarTeia({ ...base, whatsapp: null })).toEqual(antes);
    expect(montarTeia({ ...base, whatsapp: { conversas: 0, mensagens: 0 } })).toEqual(antes);
    expect(antes.nos.some((n) => n.id === ID_DO_WHATSAPP)).toBe(false);
  });
});
