import { describe, expect, it } from 'vitest';
import { juntarClientesAtivos, type InsumosDosClientesAtivos } from '../src/comercial/clientes-ativos';

/*
 * P-84 (27/10/2026): a junção dos cinco lugares onde o cliente mora, sem banco.
 * Casos fictícios no formato dos de verdade: cadastro duplicado, parceria com o lead
 * ainda aberto no funil, lead fechado sem cadastro, só acordo, só conversa, contrato
 * desativado.
 */

const vazio = (): InsumosDosClientesAtivos => ({ cadastros: [], acordos: [], fichas: [], contratos: [], conversas: [], implantacoes: [] });
const cad = (id: string, nome: string, extra: Partial<InsumosDosClientesAtivos['cadastros'][number]> = {}) => ({ id, razaoSocial: `${nome} Ltda`, nomeFantasia: nome, principalId: null, isCliente: true, ...extra });
const ficha = (leadId: string, empresa: string, etapa: string, extra: Partial<InsumosDosClientesAtivos['fichas'][number]> = {}) =>
  ({ leadId, leadNome: `Contato ${empresa}`, empresa, etapa, partnerId: null, tipoNegocio: null, valorCentavos: null, valorNegociadoCentavos: null, ...extra });
const acordo = (id: string, cliente: string, extra: Partial<InsumosDosClientesAtivos['acordos'][number]> = {}) =>
  ({ id, cliente, apelidos: null, produto: 'Operação', tipo: 'pagante', valor: 1000, fechadoEm: null, partnerId: null, ...extra });

describe('Clientes ativos numa lista só', () => {
  it('junta o cadastro principal, o duplicado, o lead fechado, o acordo, o contrato, a conversa e a implantação numa linha', () => {
    const e = vazio();
    e.cadastros.push(cad('p-curral', 'Curral'), cad('p-curral-2', 'Curral', { principalId: 'p-curral' }));
    e.fichas.push(ficha('l-curral', 'Curral', 'fechado', { partnerId: 'p-curral-2', valorCentavos: 770000 }));
    e.acordos.push(acordo('a-curral', 'Curral', { valor: 7700, partnerId: 'p-curral' }));
    e.contratos.push({ leadId: 'l-curral', situacao: 'ativo' });
    e.conversas.push({ id: 'c-curral', nome: 'ROOT | Curral', clienteId: 'p-curral', leadId: null });
    e.implantacoes.push({ taskId: 't-curral', etapa: 'Kickoff marcado', clienteId: 'p-curral-2', leadId: null });
    const r = juntarClientesAtivos(e);
    expect(r.clientes).toHaveLength(1);
    expect(r.clientes[0]).toMatchObject({
      chave: 'partner:p-curral', nome: 'Curral', tipo: 'pagante', valor: 7700,
      funil: { leadId: 'l-curral', etapa: 'fechado' }, cadastro: { id: 'p-curral', duplicados: 1 },
      contrato: { situacao: 'ativo' }, whatsapp: [{ conversaId: 'c-curral' }], implantacao: { taskId: 't-curral' },
      faltam: [], podeCriarCadastro: false,
    });
    expect(r.comLacuna).toBe(0);
  });

  it('mostra o que falta: parceria com o lead aberto, fechado sem cadastro, só acordo, só conversa', () => {
    const e = vazio();
    // Campo Bom: acordo de parceria ligado ao cadastro; o lead ainda em Qualificação.
    e.cadastros.push(cad('p-campo', 'Campo Bom'));
    e.acordos.push(acordo('a-campo', 'Campo Bom', { tipo: 'parceria', partnerId: 'p-campo', valor: 12000 }));
    e.fichas.push(ficha('l-campo', 'Campo Bom', 'qualificacao', { partnerId: 'p-campo' }));
    // Papeleira: E9 sem cadastro nenhum.
    e.fichas.push(ficha('l-papel', 'Papeleira', 'fechado', { valorNegociadoCentavos: 1000000 }));
    // Guiando: só o acordo, com o nome em texto.
    e.acordos.push(acordo('a-guia', 'Lucas da Guiando', { tipo: 'parceria', valor: 2997 }));
    // Rezende: cadastro de cliente com o grupo do WhatsApp, nada mais.
    e.cadastros.push(cad('p-rez', 'Lucas Rezende'));
    e.conversas.push({ id: 'c-rez', nome: 'ROOT | Lucas Rezende', clienteId: 'p-rez', leadId: null });
    // Fora: contrato desativado e lead aberto sem nada.
    e.fichas.push(ficha('l-fora', 'Saiu', 'contrato'), ficha('l-aberto', 'Aberto', 'qualificacao'));
    e.contratos.push({ leadId: 'l-fora', situacao: 'desativado' });
    // Um cadastro de fornecedor de nome igual não puxa ninguém.
    e.cadastros.push(cad('p-forn', 'Papeleira', { isCliente: false }));

    const r = juntarClientesAtivos(e);
    const por = Object.fromEntries(r.clientes.map((c) => [c.nome, c]));
    expect(r.clientes.map((c) => c.nome)).toEqual(['Campo Bom', 'Lucas da Guiando', 'Lucas Rezende', 'Papeleira']);
    expect(por['Campo Bom']).toMatchObject({ tipo: 'parceria', funil: { etapa: 'qualificacao' }, faltam: ['funil', 'contrato', 'whatsapp', 'implantacao'] });
    expect(por['Papeleira']).toMatchObject({ chave: 'lead:l-papel', valor: 10000, cadastro: null, podeCriarCadastro: true, faltam: ['cadastro', 'acordo', 'contrato', 'whatsapp', 'implantacao'] });
    expect(por['Lucas da Guiando']).toMatchObject({ chave: 'acordo:a-guia', tipo: 'parceria', faltam: ['funil', 'cadastro', 'contrato', 'whatsapp', 'implantacao'] });
    expect(por['Lucas Rezende']).toMatchObject({ chave: 'partner:p-rez', faltam: ['funil', 'acordo', 'contrato', 'implantacao'] });
    expect(r.porTipo).toEqual([{ tipo: 'pagante', total: 2 }, { tipo: 'parceria', total: 2 }]);
    expect(r.comLacuna).toBe(4);
  });

  it('acha o cadastro pelo nome quando a ficha ou o acordo não apontam (e pelo apelido do acordo)', () => {
    const e = vazio();
    e.cadastros.push(cad('p-pro', 'ProMedical'));
    e.fichas.push(ficha('l-pro', 'ProMedical', 'fechado'));
    e.acordos.push(acordo('a-pro', 'Pro Medical Clínica', { apelidos: 'ProMedical, PM' }));
    const r = juntarClientesAtivos(e);
    expect(r.clientes).toHaveLength(1);
    expect(r.clientes[0]).toMatchObject({ chave: 'partner:p-pro', funil: { leadId: 'l-pro' }, acordos: [{ id: 'a-pro' }] });
  });
});
