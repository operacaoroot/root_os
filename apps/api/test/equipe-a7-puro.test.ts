import { describe, expect, it } from 'vitest';
import {
  CADASTRO_DE_FUNCOES,
  FILTRO_PADRAO,
  filtrarCatalogo,
  filtroParaUrl,
  formatarWhatsappBr,
  lerFiltroDaUrl,
  lerWhatsappBr,
  motivoDaConta,
  pessoaDoDonoPadrao,
  pessoasDaEquipe,
  podeEditarDono,
  type ContaParaEquipe,
  type LinhaDoCatalogo,
} from '@mktos/shared';

import { donoEfetivo } from '../src/agents/equipe-donos';

/*
 * A EQUIPE E O CATÁLOGO NA TELA, AS REGRAS PURAS (rodada dos agentes, 21/10/2026, A7).
 *
 *  · quem aparece na Equipe (e o motivo exato de quem fica fora);
 *  · o dono padrão casado pelo primeiro nome, e o efetivo (banco > padrão);
 *  · o número de WhatsApp (E.164 do Brasil, sem mexer no nono dígito);
 *  · os filtros da tela `/agentes`, que moram no endereço.
 */

function conta(over: Partial<ContaParaEquipe> & { id: string }): ContaParaEquipe {
  return { nome: over.id, email: `${over.id}@root.local`, ativo: true, papeis: ['diretor'], ultimoAcesso: null, ...over };
}

const EMPRESA = { nome: 'Root', slug: 'root' };

describe('quem aparece na Equipe', () => {
  const contas: ContaParaEquipe[] = [
    conta({ id: 'rod', nome: 'Rodrigo Exemplo', papeis: ['admin_master'] }),
    conta({ id: 'luc', nome: 'Lucas Exemplo' }),
    conta({ id: 'ped-1', nome: 'Pedro Exemplo', ultimoAcesso: '2026-10-01T00:00:00Z' }),
    conta({ id: 'ped-2', nome: 'Pedro  Exemplo', email: 'pedro@outra.com', ultimoAcesso: '2026-10-20T00:00:00Z' }),
    conta({ id: 'admin', nome: 'Admin Root', email: 'admin@marketing-os.local', papeis: ['admin_master'] }),
    conta({ id: 'acao', nome: 'IA Ação', email: 'ia-acao@x.com', papeis: ['ia_acao'] }),
    conta({ id: 'misto', nome: 'Serviço misto', email: 'misto@x.com', papeis: ['diretor', 'ia_servico'] }),
    conta({ id: 'mesa', nome: 'Mesa (homologação)', email: 'mesa@root.homolog', papeis: ['gestor_marketing'] }),
    conta({ id: 'ex', nome: 'Exemplo', email: 'alguem@example.com' }),
    conta({ id: 'imp', nome: 'Importada do CRM', email: 'imp@cliente.com.br', papeis: [] }),
    conta({ id: 'off', nome: 'Saiu', ativo: false }),
    conta({ id: 'root', nome: 'Root', email: 'root@gmail.com', papeis: ['admin_master'] }),
  ];
  const r = pessoasDaEquipe(contas, EMPRESA);

  it('mostra só as três pessoas, em ordem de nome', () => {
    expect(r.pessoas.map((p) => p.nome)).toEqual(['Lucas Exemplo', 'Pedro  Exemplo', 'Rodrigo Exemplo']);
  });

  it('cada conta fora da vista tem o motivo exato, e nenhuma some sem motivo', () => {
    const motivos = Object.fromEntries(r.fora.map((f) => [f.id, f.motivo]));
    expect(motivos).toEqual({
      admin: 'sistema',
      acao: 'maquina',
      misto: 'maquina',
      mesa: 'teste',
      ex: 'teste',
      imp: 'importacao',
      off: 'desativada',
      root: 'empresa',
      'ped-1': 'duplicada',
    });
    expect(r.pessoas.length + r.fora.length).toBe(contas.length);
  });

  it('a mesma pessoa com duas contas aparece na que entrou por último, e a outra aponta para ela', () => {
    expect(r.canonica.get('ped-1')).toBe('ped-2');
    expect(r.pessoas.find((p) => p.id === 'ped-2')?.contas.sort()).toEqual(['ped-1', 'ped-2']);
  });

  it('`.local` sozinho não é teste (as pessoas de exemplo usam @root.local); o domínio da semente é sistema', () => {
    expect(motivoDaConta(conta({ id: 'a', email: 'rodrigo@root.local' }))).toBeNull();
    expect(motivoDaConta(conta({ id: 'b', email: 'mcp@marketing-os.local' }))).toBe('sistema');
    expect(motivoDaConta(conta({ id: 'c', email: 'x@algo.test' }))).toBe('teste');
  });
});

describe('o dono padrão e o efetivo', () => {
  const pessoas = [
    { id: 'r', nome: 'Rodrigo Saggioro' },
    { id: 'l', nome: 'Lucas Fernandes' },
    { id: 'p', nome: 'Pedro Magnago' },
  ];
  const equipe = pessoasDaEquipe(
    pessoas.map((p) => conta({ id: p.id, nome: p.nome })),
    EMPRESA,
  );

  it('casa pelo primeiro nome, sem acento nem caixa', () => {
    expect(pessoaDoDonoPadrao('rodrigo', pessoas)?.id).toBe('r');
    expect(pessoaDoDonoPadrao('lucas', [{ id: 'x', nome: 'LÚCAS' }])?.id).toBe('x');
  });

  it('dois com o mesmo primeiro nome não resolvem (não chuta)', () => {
    expect(pessoaDoDonoPadrao('pedro', [...pessoas, { id: 'p2', nome: 'Pedro Outro' }])).toBeNull();
  });

  it('banco vale por cima do padrão; ponteiro fora da equipe cai no padrão e avisa', () => {
    expect(donoEfetivo('lucas', 'p', { equipe })).toMatchObject({ efetivo: { id: 'p' }, origem: 'banco' });
    expect(donoEfetivo('lucas', null, { equipe })).toMatchObject({ efetivo: { id: 'l' }, origem: 'padrao' });
    expect(donoEfetivo('lucas', 'conta-do-admin', { equipe })).toMatchObject({
      efetivo: { id: 'l' },
      origem: 'padrao',
      bancoForaDaEquipe: true,
    });
    expect(donoEfetivo('lucas', 'fora:x', { equipe }).bancoForaDaEquipe).toBe(true);
    expect(donoEfetivo(null, null, { equipe })).toMatchObject({ efetivo: null, origem: null });
  });

  it('quem edita o dono: admin.usuarios OU admin.permissoes', () => {
    expect(podeEditarDono(['admin.usuarios'])).toBe(true);
    expect(podeEditarDono(['admin.permissoes'])).toBe(true);
    expect(podeEditarDono(['dashboard.ver', 'aprovacoes.decidir'])).toBe(false);
  });
});

describe('o número de WhatsApp (E.164 do Brasil)', () => {
  it.each([
    ['+55 (32) 99999-8888', '5532999998888'],
    ['32999998888', '5532999998888'],
    ['55 32 9999 8888', '553299998888'],
    ['(11) 3333-4444', '551133334444'],
  ])('%s → %s (grava só dígitos, com o 55)', (entrada, digitos) => {
    const r = lerWhatsappBr(entrada);
    expect(r).toMatchObject({ ok: true, digitos });
  });

  it('não mexe no nono dígito: com e sem 9 são números diferentes', () => {
    const com = lerWhatsappBr('32 99999-8888');
    const sem = lerWhatsappBr('32 9999-8888');
    expect(com.ok && sem.ok && com.digitos !== sem.digitos).toBe(true);
  });

  it.each([
    ['', 'Informe'],
    ['abc', 'Use só números'],
    ['+1 415 555 0100', 'Só número do Brasil'],
    ['+55 20 99999-8888', 'DDD 20'],
    ['+55 32 89999-8888', 'começa por 9'],
    ['123', 'DDD'],
  ])('recusa %j', (entrada, motivo) => {
    const r = lerWhatsappBr(entrada);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain(motivo);
  });

  it('formata para a tela', () => {
    expect(formatarWhatsappBr('5532999998888')).toBe('+55 (32) 99999-8888');
    expect(formatarWhatsappBr('553299998888')).toBe('+55 (32) 9999-8888');
  });
});

describe('os filtros da tela /agentes (no endereço)', () => {
  function linha(over: Partial<LinhaDoCatalogo>): LinhaDoCatalogo {
    return {
      id: 'CO-03',
      slug: 's',
      nome: 'n',
      area: 'Comercial',
      tipo: 'agente',
      aba: 'agentes',
      paraQueServe: '',
      estado: 'ativo',
      estadoDeclarado: 'ativo',
      estadoMotivo: null,
      dono: { efetivo: { id: 'l', nome: 'Lucas' }, origem: 'padrao', padrao: 'lucas', bancoForaDaEquipe: false },
      modelo: null,
      modeloExterno: null,
      gatilho: '',
      frequencia: '',
      nivel: '',
      capacidades: [],
      ultima: null,
      proxima: null,
      rotina: null,
      gastoMes: null,
      onde: '',
      soNoPapel: false,
      registrado: false,
      ...over,
    };
  }
  const linhas = [
    linha({ slug: 'a' }),
    linha({ slug: 'b', estado: 'desligado' }),
    linha({ slug: 'c', estado: 'aposentado' }),
    linha({ slug: 'd', area: 'Implantação', dono: { efetivo: { id: 'p', nome: 'Pedro' }, origem: 'padrao', padrao: 'pedro', bancoForaDaEquipe: false } }),
    linha({ slug: 'e', tipo: 'rotina', aba: 'rotinas' }),
    linha({ slug: 'f', dono: { efetivo: null, origem: null, padrao: 'lucas', bancoForaDaEquipe: false } }),
  ];

  it('o padrão é "ativos" na aba Agentes, e o aposentado nunca aparece fora do filtro próprio', () => {
    expect(filtrarCatalogo(linhas, FILTRO_PADRAO).map((l) => l.slug)).toEqual(['a', 'd', 'f']);
    expect(filtrarCatalogo(linhas, { ...FILTRO_PADRAO, estado: 'todos' }).map((l) => l.slug)).toEqual(['a', 'b', 'd', 'f']);
    expect(filtrarCatalogo(linhas, { ...FILTRO_PADRAO, estado: 'aposentados' }).map((l) => l.slug)).toEqual(['c']);
  });

  it('área, dono e "sem dono"', () => {
    expect(filtrarCatalogo(linhas, { ...FILTRO_PADRAO, area: 'Implantação' }).map((l) => l.slug)).toEqual(['d']);
    expect(filtrarCatalogo(linhas, { ...FILTRO_PADRAO, dono: 'l' }).map((l) => l.slug)).toEqual(['a']);
    expect(filtrarCatalogo(linhas, { ...FILTRO_PADRAO, dono: 'sem-dono' }).map((l) => l.slug)).toEqual(['f']);
    expect(filtrarCatalogo(linhas, { ...FILTRO_PADRAO, aba: 'rotinas' }).map((l) => l.slug)).toEqual(['e']);
  });

  it('o endereço ida e volta; o padrão deixa o endereço limpo; valor torto cai no padrão', () => {
    const f = { aba: 'rotinas' as const, estado: 'todos' as const, area: 'Comercial', dono: 'u-1' };
    expect(lerFiltroDaUrl(filtroParaUrl(f))).toEqual(f);
    expect(filtroParaUrl(FILTRO_PADRAO)).toBe('');
    expect(lerFiltroDaUrl('?aba=xyz&estado=nada')).toEqual(FILTRO_PADRAO);
  });

  it('o cadastro tem os três tipos (as três abas não nascem vazias)', () => {
    const tipos = new Set(CADASTRO_DE_FUNCOES.map((f) => f.tipo));
    expect([...tipos].sort()).toEqual(['agente', 'automacao', 'rotina']);
  });
});
