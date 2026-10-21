import { JwtService } from '@nestjs/jwt';
import { PrismaClient, type WorkFieldType, type WorkStatusType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classificar } from '@mktos/policy';
import { AVISO_DO_CONTRATO_IMPORTADO, IMPORTACAO_CRM_MARCA } from '@mktos/shared';

import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { ReauthService } from '../src/auth/reauth.service';
import { comContexto } from '../src/common/contexto-execucao';
import { cardIdDoLead, seloDoCard } from '../src/comercial/card-da-implantacao';
import { ConfigComercialService } from '../src/comercial/config.service';
import { ContratoVivoService, contratosImportados, ehClienteImportado } from '../src/comercial/contrato-vivo.service';
import { DecisoesRegistry, DecisoesService } from '../src/comercial/decisoes.service';
import { FechadoForaService } from '../src/comercial/fechado-fora.service';
import { FichaService } from '../src/comercial/ficha.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { MoverService } from '../src/comercial/mover.service';
import { EFEITO_DE_IMPORTAR_CRM, ImportadorCrmService, PASSOS_DO_IMPORTADOR, type RelatorioDoImportador } from '../src/comercial/importador-crm/importador-crm.service';
import {
  LISTAS_DE_CONTATO_A_TIRAR,
  LISTAS_SOLTAS_QUE_FICAM,
  acharLeadDuplicado,
  casarCitado,
  centavosDaMoeda,
  chavesDoLead,
  citacaoDoTitulo,
  cnpjDoCartao,
  dadosDoLead,
  destinoDaTarefaDoComercial,
  destinoDoStatus,
  diaDoCampo,
  donoPeloVendedor,
  empresaEContato,
  etapaNoDestino,
  hashDoNome,
  montarPlano,
  nomeParecido,
  normalizar,
  precisaMover,
  produtoDoCartao,
  type CartaoDoCrm,
} from '../src/comercial/importador-crm/plano';
import { LISTA_DO_COMERCIAL } from '../src/work/lista-do-comercial';
import { ReacoesDaEspinha } from '../src/comercial/reacoes-da-espinha';
import { RelogioDaEspinha } from '../src/comercial/relogio-da-espinha';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { SalaService } from '../src/comercial/sala.service';
import { WhatsappComercialService } from '../src/comercial/whatsapp.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { ConectoresService } from '../src/integrations/conectores.service';
import { leadIdDaEntrada } from '../src/leads/entrada-de-lead';
import { LeadsService } from '../src/leads/leads.service';
import { TrilhoService } from '../src/onboarding/trilho/trilho.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import { dentroDeGit } from '../src/comercial/importador-crm/detalhe';
import { MovimentoDoQuadroService } from '../src/work/movimento-do-quadro.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O IMPORTADOR DO CRM ANTIGO (rodada de produção 1, 21/10/2026).
 *
 *  1. a parte pura: a regra de etapa pelo nome do status, a leitura do cartão
 *     (empresa antes do parêntese, contato dentro, moeda, data, CNPJ, produto), o
 *     plano (sobras do status desconhecido, do contrato sem pai e do contrato de lead),
 *     o dedupe por CNPJ e por nome, e o nível pela escada (R0, fato passado);
 *  2. contra o Postgres, com fixture SINTÉTICA (nenhum dado real): simular não escreve;
 *     valer leva cada cartão ao lugar certo (lead novo, lead à mão reaproveitado pelo
 *     nome e pelo CNPJ, cliente com contrato vivo, cliente com dois contratos, card da
 *     implantação em Kickoff e em Implantação, Recorrente e Depoimento só com o
 *     contrato vivo), arquiva o cartão com o link e faz a limpeza da ata; valer de novo
 *     não muda nada; simular depois dá zero; nenhuma mensagem, aprovação, cobrança,
 *     documento, sala, contrato do Financeiro, reação ou decisão nasce (contados antes
 *     e depois); conta de máquina e quem perdeu a permissão são recusados.
 *  3. o adendo (A1/A2): a regra pura de qual tarefa da lista solta "Comercial" cita qual
 *     lead (nome citado, casamento igual e "começa pela chave", ambíguas que nunca ligam)
 *     e, no banco, as tarefas movidas para a lista do comercial (ligadas, lead criado em
 *     Qualificação, internas, ambíguas nas sobras, concluídas como concluídas), a lista
 *     Comercial arquivada e a lista de um contato (achada pelo hash do nome) arquivada.
 *     Os nomes são todos fictícios.
 */

const cartao = (p: Partial<CartaoDoCrm> & { id: string; titulo: string; status: string }): CartaoDoCrm => ({
  descricao: null,
  lista: 'gestao de leads',
  parentId: null,
  archived: false,
  criadoEm: new Date('2026-05-01T12:00:00Z'),
  assigneeUserId: null,
  campos: [],
  ...p,
});

describe('importador do CRM: a parte pura', () => {
  it('o efeito é interno e a escada dá R0: importar fato passado não vai à porta', () => {
    expect(classificar(EFEITO_DE_IMPORTAR_CRM)).toBe('R0');
  });

  it('a regra de etapa pelo nome do status (normalizado); o desconhecido não vira nada', () => {
    expect(destinoDoStatus('Validar')).toEqual({ tipo: 'lead', etapa: 'qualificacao' });
    expect(destinoDoStatus(' followup ')).toEqual({ tipo: 'lead', etapa: 'follow_up' });
    expect(destinoDoStatus('Follow-up')).toEqual({ tipo: 'lead', etapa: 'follow_up' });
    expect(destinoDoStatus('KICKOFF')).toEqual({ tipo: 'cliente', etapaDoCard: 'Kickoff marcado' });
    expect(destinoDoStatus('Implantação')).toEqual({ tipo: 'cliente', etapaDoCard: 'Kit montado' });
    expect(destinoDoStatus('Recorrente')).toEqual({ tipo: 'cliente', etapaDoCard: null });
    expect(destinoDoStatus('Depoimento e indicação')).toEqual({ tipo: 'cliente', etapaDoCard: null });
    for (const s of ['Oportunidade', 'Negócio fechado', 'Perdido', 'Encerrado', '']) expect(destinoDoStatus(s)).toBeNull();
  });

  it('a leitura do cartão: empresa antes do parêntese, contato dentro, campos quando houver', () => {
    expect(empresaEContato('Padaria Sintética (Joana Teste)')).toEqual({ empresa: 'Padaria Sintética', contato: 'Joana Teste' });
    expect(empresaEContato('  Oficina Sintética - (Beto)  resto')).toEqual({ empresa: 'Oficina Sintética', contato: 'Beto' });
    expect(empresaEContato('Só a Empresa Sintética')).toEqual({ empresa: 'Só a Empresa Sintética', contato: null });
    expect(centavosDaMoeda('BRL 1500.00')).toBe(150_000);
    expect(centavosDaMoeda('BRL 9.9')).toBe(990);
    expect(centavosDaMoeda('1.234,56')).toBe(123_456);
    expect(centavosDaMoeda('quinze')).toBeNull();
    expect(diaDoCampo('2026-02-30')).toBeNull();
    expect(diaDoCampo('2026-03-15')).toBe('2026-03-15');
    expect(cnpjDoCartao({ campos: [], titulo: 'X', descricao: 'CNPJ 12.345.678/0001-90 na descrição' })).toBe('12345678000190');
    expect(cnpjDoCartao({ campos: [], titulo: 'X', descricao: 'sem documento' })).toBeNull();
    expect(produtoDoCartao({ campos: [{ nome: 'Produto', tipo: 'drop_down', valor: 'Operação ROOT' }] })).toEqual({ produto: 'operacao', rotulo: 'Operação ROOT' });
    expect(produtoDoCartao({ campos: [{ nome: 'Produto', tipo: 'drop_down', valor: 'Implantação ROOT OS' }] })).toEqual({ produto: null, rotulo: 'Implantação ROOT OS' });
    const d = dadosDoLead(cartao({
      id: 'c1', titulo: 'Alfa Sintética (Ana)', status: 'Validar',
      campos: [
        { nome: 'Telefone', tipo: 'texto', valor: '(32) 99999-0001' },
        { nome: 'E-mail', tipo: 'texto', valor: 'ANA@alfa.teste' },
        { nome: 'E-mail errado', tipo: 'texto', valor: 'nada' },
        { nome: 'Valor da proposta', tipo: 'moeda', valor: 'BRL 4500.00' },
        { nome: 'Data de Cadastro do Lead', tipo: 'data', valor: '2026-04-02' },
      ],
    }));
    expect(d).toMatchObject({ empresa: 'Alfa Sintética', contato: 'Ana', telefone: '(32) 99999-0001', email: 'ana@alfa.teste', valorCentavos: 450_000, cadastradoEm: '2026-04-02', cnpj: null, produto: null });
  });

  it('o plano: status desconhecido, subtarefa de lead, contrato sem pai e contrato de lead viram sobra', () => {
    const p = montarPlano([
      cartao({ id: 'a', titulo: 'A (x)', status: 'Validar' }),
      cartao({ id: 'b', titulo: 'B', status: 'Oportunidade' }),
      cartao({ id: 'c', titulo: 'C', status: 'Kickoff' }),
      cartao({ id: 'c1', titulo: 'Contrato C', status: 'Ativo', lista: 'contratos dos clientes', parentId: 'c' }),
      cartao({ id: 'a1', titulo: 'Contrato A', status: 'Ativo', lista: 'contratos dos clientes', parentId: 'a' }),
      cartao({ id: 'x1', titulo: 'Contrato solto', status: 'Ativo', lista: 'contratos dos clientes' }),
      cartao({ id: 'a2', titulo: 'Sub de A', status: 'Validar', parentId: 'a' }),
    ]);
    expect(p.cartoes.map((c) => [c.cartao.id, c.contratos.map((k) => k.cartao.id)])).toEqual([['a', []], ['c', ['c1']]]);
    expect(p.sobras.map((s) => s.cartaoId).sort()).toEqual(['a1', 'a2', 'b', 'x1']);
    expect(p.sobras.find((s) => s.cartaoId === 'b')?.motivo).toMatch(/fora da regra de etapa/);
  });

  it('o dedupe: CNPJ primeiro, depois o nome normalizado da empresa; nome curto não casa', () => {
    const leads = [
      { id: 'l1', nome: 'Lead 1', empresa: 'Beta Sintética Ltda', cnpj: null },
      { id: 'l2', nome: 'Gama Comércio', empresa: null, cnpj: '12.345.678/0001-90' },
      { id: 'l3', nome: 'AB', empresa: null, cnpj: null },
    ];
    expect(acharLeadDuplicado({ empresa: 'BETA sintética ltda.', cnpj: null }, leads)).toEqual({ id: 'l1', como: 'nome' });
    expect(acharLeadDuplicado({ empresa: 'Outro nome', cnpj: '12345678000190' }, leads)).toEqual({ id: 'l2', como: 'cnpj' });
    expect(acharLeadDuplicado({ empresa: 'ab', cnpj: null }, leads)).toBeNull();
    expect(acharLeadDuplicado({ empresa: 'Nova Sintética', cnpj: null }, leads)).toBeNull();
  });

  it('mover só para a frente; saída fica; o vendedor só vira dono sem ambiguidade; a etapa do destino', () => {
    expect(precisaMover('novo_lead', 'follow_up')).toBe('mover');
    expect(precisaMover('contrato', 'follow_up')).toBe('alem');
    expect(precisaMover('fechado', 'fechado')).toBe('ja_esta');
    expect(precisaMover('perdido', 'fechado')).toBe('saida');
    const gente = [{ id: 'u1', nome: 'Lucas Teste' }, { id: 'u2', nome: 'Pedro Um' }, { id: 'u3', nome: 'Pedro Dois' }];
    expect(donoPeloVendedor('Lucas', gente)).toBe('u1');
    expect(donoPeloVendedor('Pedro', gente)).toBeNull();
    expect(donoPeloVendedor(null, gente)).toBeNull();
    const etapas = [{ id: 's1', name: 'to do', type: 'open' }, { id: 's2', name: 'complete', type: 'closed' }];
    expect(etapaNoDestino(etapas, { name: 'Feito', type: 'closed' })?.id).toBe('s2');
    expect(etapaNoDestino(etapas, { name: 'TO DO', type: 'custom' })?.id).toBe('s1');
    expect(etapaNoDestino(etapas, { name: 'Fazendo', type: 'custom' })?.id).toBe('s1');
  });

  it('o contrato importado na tela e o cliente importado', () => {
    expect(contratosImportados([
      { payload: { origem: 'cartao:2', titulo: 'B', valorCentavos: 100, fechadoEm: '2026-03-01' } },
      { payload: { origem: 'cartao:1', titulo: 'A', valorCentavos: null, fechadoEm: '2026-01-01', produtoRotulo: 'Imersão' } },
    ])).toEqual([
      { origem: 'cartao:1', titulo: 'A', produtoRotulo: 'Imersão', valorCentavos: null, fechadoEm: '2026-01-01', semDocumento: true },
      { origem: 'cartao:2', titulo: 'B', produtoRotulo: null, valorCentavos: 100, fechadoEm: '2026-03-01', semDocumento: true },
    ]);
    expect(ehClienteImportado({ importado: true })).toBe(true);
    expect(ehClienteImportado({ chave: 'fech-x-v1' })).toBe(false);
    expect(AVISO_DO_CONTRATO_IMPORTADO).toBe('Contrato importado do CRM antigo · anexar o PDF');
  });

  it('o selo do card importado e a trava do arquivo de detalhe', () => {
    expect(seloDoCard({ leadId: 'l', criadoEm: new Date('2026-10-21T15:00:00Z'), etapa: 'fechado', motivoSaida: null, antecipado: false, fechadoEm: null, importado: true }))
      .toEqual({ tipo: 'fechamento', leadId: 'l', rotulo: 'importado do CRM antigo · 21/10/2026' });
    expect(dentroDeGit(`${process.cwd()}/qualquer.md`)).toBe(true);
    expect(normalizar('Gestão de Leads')).toBe('gestao de leads');
  });

  it('A1: o nome citado no título, pela forma (separador, prefixo de ação, conectivos); o resto é interna', () => {
    expect(citacaoDoTitulo('Fulana — Marcar onboarding')).toEqual({ tipo: 'citado', nome: 'Fulana' });
    expect(citacaoDoTitulo('Fulana Teste — Cobrar preenchimento e marcar nova conversa')).toEqual({ tipo: 'citado', nome: 'Fulana Teste' });
    expect(citacaoDoTitulo('FUP Oficina Sintética')).toEqual({ tipo: 'citado', nome: 'Oficina Sintética' });
    expect(citacaoDoTitulo('Proposta Lumen e instalação do OS')).toEqual({ tipo: 'citado', nome: 'Lumen e instalação do OS' });
    expect(citacaoDoTitulo('Proposta Ciclano Souza — fazer FUP')).toEqual({ tipo: 'citado', nome: 'Ciclano Souza' });
    expect(citacaoDoTitulo('Marcar reunião - Lexidoc')).toEqual({ tipo: 'citado', nome: 'Lexidoc' });
    expect(citacaoDoTitulo('Confirmar reunião com o Beltrano')).toEqual({ tipo: 'citado', nome: 'Beltrano' });
    expect(citacaoDoTitulo('Indicação do Tício')).toEqual({ tipo: 'indicacao', nome: 'Tício' });
    expect(citacaoDoTitulo('Acionar indicação do Tício')).toEqual({ tipo: 'indicacao', nome: 'Tício' });
    for (const t of [
      'Colher feedback dos clientes atuais',
      'Entrada no grupo de networking',
      'Atualizar pipe',
      'Estudar rede de contatos e abastecer pipeline',
      'Checar integração da Ferramenta Sintética',
      // verbo genérico no começo não é prefixo de nome, mesmo com separador
      'Cobrar preenchimento do formulário',
      'Atualizar pipe - semana que vem',
      'Marcar reunião',
      '',
    ]) expect(citacaoDoTitulo(t), t).toEqual({ tipo: 'interna' });
  });

  it('A1: o casamento (igual, começa pela chave), as ambíguas que nunca ligam e a tarefa concluída que não cria lead', () => {
    const leads = [
      { id: 'l-lumen', nome: 'Lumen | Carla Teste', empresa: null },
      { id: 'l-padaria', nome: 'Padaria Sintética', empresa: 'Padaria Sintética', contato: 'Fulana Teste' },
      { id: 'l-oficina', nome: 'Oficina Sintética', empresa: 'Oficina Sintética', contato: 'Beltrano Silva' },
      { id: 'l-lexi', nome: 'Lexidr.', empresa: null },
      { id: 'l-gama1', nome: 'Gama', empresa: null },
      { id: 'l-gama2', nome: 'Gama', empresa: null },
      { id: 'l-orion', nome: 'Orion (Rui Teste)', empresa: null },
    ];
    expect(chavesDoLead(leads[0])).toEqual([{ texto: 'lumen carla teste', tipo: 'empresa' }, { texto: 'lumen', tipo: 'empresa' }, { texto: 'carla teste', tipo: 'contato' }]);
    // igual: empresa, contato (duas palavras ou mais), a parte antes de "(" e a de dentro
    expect(casarCitado('Oficina Sintética', leads)).toEqual({ tipo: 'lead', leadId: 'l-oficina', como: 'igual' });
    expect(casarCitado('fulana  TESTE', leads)).toEqual({ tipo: 'lead', leadId: 'l-padaria', como: 'igual' });
    expect(casarCitado('Orion', leads)).toEqual({ tipo: 'lead', leadId: 'l-orion', como: 'igual' });
    expect(casarCitado('Rui Teste', leads)).toEqual({ tipo: 'lead', leadId: 'l-orion', como: 'igual' });
    // começa pela chave de empresa em palavras inteiras
    expect(casarCitado('Lumen e instalação do OS', leads)).toEqual({ tipo: 'lead', leadId: 'l-lumen', como: 'comeca' });
    expect(casarCitado('Lumenx e instalação', leads).tipo).not.toBe('lead');
    // ambíguas
    expect(casarCitado('Beltrano', leads)).toMatchObject({ tipo: 'ambigua', candidatos: ['l-oficina'] });
    expect(casarCitado('Fulana', leads)).toMatchObject({ tipo: 'ambigua', motivo: expect.stringMatching(/parecido/) });
    expect(casarCitado('Lexidoc', leads)).toMatchObject({ tipo: 'ambigua', candidatos: ['l-lexi'] });
    expect(casarCitado('Gama', leads)).toMatchObject({ tipo: 'ambigua', motivo: expect.stringMatching(/mais de um lead/) });
    expect(casarCitado('Carla', leads)).toMatchObject({ tipo: 'ambigua' });
    expect(casarCitado('Zeferino', leads)).toMatchObject({ tipo: 'ambigua', motivo: expect.stringMatching(/um nome só/) });
    expect(casarCitado('Oficina Norte', leads)).toMatchObject({ tipo: 'ambigua', candidatos: ['l-oficina'] });
    // sem casar e sem parecido, duas palavras: nenhum (o importador cria)
    expect(casarCitado('Ciclano Souza', leads)).toEqual({ tipo: 'nenhum' });
    expect(nomeParecido('vetordoc', 'vetordr')).toBe(true);
    expect(nomeParecido('maria lima', 'maria souza')).toBe(true);
    expect(nomeParecido('casa e cia', 'loja e cia')).toBe(false);

    expect(destinoDaTarefaDoComercial('FUP Oficina Sintética', false, leads)).toMatchObject({ tipo: 'lead', leadId: 'l-oficina' });
    expect(destinoDaTarefaDoComercial('Proposta Ciclano Souza — fazer FUP', false, leads)).toEqual({ tipo: 'criar', nome: 'Ciclano Souza' });
    expect(destinoDaTarefaDoComercial('Proposta Ciclano Souza — fazer FUP', true, leads)).toMatchObject({ tipo: 'interna', motivo: expect.stringMatching(/não cria lead/) });
    expect(destinoDaTarefaDoComercial('Indicação da Oficina Sintética', false, leads)).toMatchObject({ tipo: 'ambigua', motivo: expect.stringMatching(/indicação/) });
    expect(destinoDaTarefaDoComercial('Atualizar pipe', false, leads)).toMatchObject({ tipo: 'interna' });
  });

  it('A2 e as listas que ficam: a lista de contato pelo hash do nome; a Comercial deixou de ficar', () => {
    expect(hashDoNome('  CONTATO Fictício ')).toBe(hashDoNome('contato ficticio'));
    expect(hashDoNome('contato ficticio')).toMatch(/^[0-9a-f]{64}$/);
    expect(LISTAS_DE_CONTATO_A_TIRAR).toHaveLength(1);
    expect(LISTAS_DE_CONTATO_A_TIRAR[0]).toMatch(/^[0-9a-f]{64}$/);
    expect([...LISTAS_SOLTAS_QUE_FICAM]).toEqual(['operacao']);
  });
});

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (leads, fichas, cartões, listas, pastas, cards, trilhos, Partner, fio e auditoria)');
process.env.ENCRYPTION_KEY ??= 'chave-de-teste-da-sala-0123456789abcdef';
process.env.GATEWAY_MODO = 'impor';

const MARCA = `ic${Date.now().toString(36).slice(-6)}`;
const ORG = `org-importar-crm-${MARCA}`;
const CNPJ_GAMA = `4${Date.now().toString().slice(-13)}`;

describe.skipIf(!URL)('importador do CRM contra o Postgres (fixture sintética)', { timeout: 120_000 }, () => {
  let prisma: PrismaClient;
  let svc: ImportadorCrmService;
  let contratos: ContratoVivoService;
  let movimento: MovimentoDoQuadroService;
  let euId = '';
  let maquinaId = '';
  let semTarefasId = '';
  let lucasId = '';
  const ids: Record<string, string> = {};
  const naEmpresa = <T>(fn: () => Promise<T>): Promise<T> => comContexto({ orgId: ORG, correlationId: `ic-${MARCA}`, origem: 'script' }, fn);
  const eu = () => ({ id: euId, nome: 'Rodrigo da Root', papeis: ['admin_master'] });
  // A lista de um contato do teste (nome fictício), injetada pelo hash: a constante do código é a da produção.
  const NOME_DO_CONTATO = 'Contato Fictício Sintético';
  const rodar = (valer: boolean) => naEmpresa(() => svc.executar(ORG, eu(), { valer, web: 'https://os.exemplo.teste', listasDeContatoATirar: [hashDoNome(NOME_DO_CONTATO)] }));
  const soma = (r: RelatorioDoImportador, k: 'feitos' | 'aFazer') => PASSOS_DO_IMPORTADOR.reduce((s, p) => s + r.passos[p][k], 0);

  async function lista(nome: string, folderId: string | null, natureza: 'tarefas' | 'cadastro', etapas: [string, WorkStatusType][], campos: [string, WorkFieldType, string[]?][] = []) {
    const l = await prisma.workList.create({ data: { orgId: ORG, folderId, name: nome, natureza }, select: { id: true } });
    await prisma.workStatus.createMany({ data: etapas.map(([name, type], i) => ({ orgId: ORG, listId: l.id, name, type, order: i })) });
    const st = await prisma.workStatus.findMany({ where: { listId: l.id }, select: { id: true, name: true } });
    const fd: Record<string, { id: string; opcoes: Record<string, string> }> = {};
    for (const [i, [name, type, opcoes]] of campos.entries()) {
      const f = await prisma.workField.create({ data: { orgId: ORG, listId: l.id, name, type, order: i }, select: { id: true } });
      fd[name] = { id: f.id, opcoes: {} };
      for (const [j, o] of (opcoes ?? []).entries()) fd[name].opcoes[o] = (await prisma.workFieldOption.create({ data: { orgId: ORG, fieldId: f.id, name: o, order: j }, select: { id: true } })).id;
    }
    return { id: l.id, etapa: (n: string) => st.find((s) => s.name === n)!.id, campo: fd };
  }

  type Lista = Awaited<ReturnType<typeof lista>>;
  async function tarefa(l: Lista, titulo: string, etapa: string, extra: { parentId?: string; descricao?: string; campos?: Record<string, string>; criadoEm?: Date } = {}) {
    const t = await prisma.workTask.create({
      data: { orgId: ORG, listId: l.id, statusId: l.etapa(etapa), title: titulo, description: extra.descricao ?? null, parentId: extra.parentId ?? null, ...(extra.criadoEm ? { createdAt: extra.criadoEm } : {}) },
      select: { id: true },
    });
    for (const [nome, valor] of Object.entries(extra.campos ?? {})) {
      const f = l.campo[nome];
      await prisma.workFieldValue.create({ data: { taskId: t.id, fieldId: f.id, ...(f.opcoes[valor] ? { optionId: f.opcoes[valor] } : { value: valor }) } });
    }
    return t.id;
  }

  async function leadAMao(nome: string, etapa: 'qualificacao' | 'contrato', ficha: { empresa?: string | null; cnpj?: string | null } = {}) {
    const l = await prisma.lead.create({ data: { orgId: ORG, name: nome }, select: { id: true } });
    await prisma.comercialFicha.create({ data: { leadId: l.id, etapa, empresa: ficha.empresa ?? null, cnpj: ficha.cnpj ?? null } });
    return l.id;
  }

  const fotografia = async () => ({
    leadEvents: await prisma.leadEvent.count({ where: { lead: { orgId: ORG } } }),
    auditoria: await prisma.auditLog.count({ where: { orgId: ORG } }),
    arquivadas: await prisma.workTask.count({ where: { orgId: ORG, archived: true } }),
    leads: await prisma.lead.count({ where: { orgId: ORG } }),
    listasArquivadas: await prisma.workList.count({ where: { orgId: ORG, arquivadaEm: { not: null } } }),
    pastas: await prisma.workFolder.count({ where: { orgId: ORG } }),
    listas: await prisma.workList.count({ where: { orgId: ORG } }),
    partners: await prisma.partner.count({ where: { orgId: ORG } }),
    trilhos: await prisma.onboardingTrilho.count({ where: { orgId: ORG } }),
    comentarios: await prisma.workComment.count({ where: { orgId: ORG } }),
  });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    const p = prisma as unknown as PrismaService;
    await prisma.org.create({ data: { id: ORG, name: `Importar CRM ${MARCA}`, slug: `importar-crm-${MARCA}` } });
    for (const key of ['leads.editar', 'tarefas.editar']) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    const admin = await prisma.role.create({ data: { orgId: ORG, key: 'admin_master', name: 'Admin', permissions: { connect: [{ key: 'leads.editar' }, { key: 'tarefas.editar' }] } }, select: { id: true } });
    const ia = await prisma.role.create({ data: { orgId: ORG, key: 'ia_servico', name: 'IA', permissions: { connect: [{ key: 'leads.editar' }, { key: 'tarefas.editar' }] } }, select: { id: true } });
    const soLeads = await prisma.role.create({ data: { orgId: ORG, key: 'gestor_marketing', name: 'Só leads', permissions: { connect: [{ key: 'leads.editar' }] } }, select: { id: true } });
    const hash = await bcrypt.hash('senha-de-teste-ic', 4);
    euId = (await prisma.user.create({ data: { orgId: ORG, email: `rodrigo-${MARCA}@ic.teste`, name: 'Rodrigo da Root', passwordHash: hash, roles: { connect: { id: admin.id } } }, select: { id: true } })).id;
    lucasId = (await prisma.user.create({ data: { orgId: ORG, email: `lucas-${MARCA}@ic.teste`, name: 'Lucas Sintético', passwordHash: hash, roles: { connect: { id: admin.id } } }, select: { id: true } })).id;
    maquinaId = (await prisma.user.create({ data: { orgId: ORG, email: `ia-${MARCA}@ic.teste`, name: 'Conta de serviço', passwordHash: hash, roles: { connect: { id: ia.id } } }, select: { id: true } })).id;
    semTarefasId = (await prisma.user.create({ data: { orgId: ORG, email: `sem-${MARCA}@ic.teste`, name: 'Sem tarefas', passwordHash: hash, roles: { connect: { id: soLeads.id } } }, select: { id: true } })).id;

    // As reações de produção inscritas: se o importador disparasse alguma, as contagens de efeito subiriam.
    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    const reauth = new ReauthService(p, new JwtService({ secret: `segredo-${MARCA}` }), audit);
    const approvals = new ApprovalsService(p, audit, reauth);
    const eventos = new EventLogService(p);
    const efeitos = new EfeitosRegistry();
    const interruptores = new InterruptoresRegistry();
    new ConectoresService(p, audit, eventos, interruptores).onModuleInit();
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, eventos, undefined, interruptores, efeitos);
    const porta = new PortaDoOperador(gateway, efeitos);
    const reacoes = new ReacoesRegistry();
    const fio = new FioService(p, reacoes);
    const relogio = new RelogioComercialRegistry();
    const sala = new SalaService(p, fio, reacoes);
    sala.onModuleInit();
    const whats = new WhatsappComercialService(p, fio, reacoes, relogio, sala, efeitos, porta);
    whats.onModuleInit();
    const config = new ConfigComercialService(p);
    const registroDeDecisoes = new DecisoesRegistry();
    const decisoes = new DecisoesService(p, fio, config, registroDeDecisoes);
    const fichas = new FichaService(p, fio, config);
    new ReacoesDaEspinha(p, fio, reacoes, fichas, decisoes, registroDeDecisoes, new RelogioDaEspinha(p, new ExecutoresDeRotinaRegistry(), relogio, decisoes, fio, config, fichas)).inscrever();
    const leads = new LeadsService(p, audit, {} as never);
    new FechadoForaService(p, fio, reacoes, fichas, {} as never, leads).onModuleInit();
    const trilhos = new TrilhoService(p, undefined as never, eventos, undefined as never);
    svc = new ImportadorCrmService(p, fio, fichas, leads, new MoverService(p, fichas), trilhos);
    contratos = new ContratoVivoService(p, fio, relogio, decisoes);
    movimento = new MovimentoDoQuadroService(p);

    // ---- a árvore do Trabalho, como a da produção (nomes de estrutura, clientes sintéticos)
    const crm = await prisma.workFolder.create({ data: { orgId: ORG, name: 'CRM' }, select: { id: true } });
    const gl = await lista('Gestão de Leads', crm.id, 'cadastro',
      [['Validar', 'open'], ['Oportunidade', 'custom'], ['Followup', 'custom'], ['Kickoff', 'custom'], ['Implantação', 'custom'], ['Depoimento e indicação', 'custom'], ['Recorrente', 'custom'], ['Perdido', 'closed']],
      [['Telefone', 'texto'], ['E-mail', 'texto'], ['Produto', 'drop_down', ['Imersão', 'Operação ROOT', 'Implantação ROOT OS']], ['Valor da proposta', 'moeda'], ['Vendedor', 'drop_down', ['Lucas', 'Pedro']], ['Data de Cadastro do Lead', 'data']]);
    const cc = await lista('Contratos dos clientes', crm.id, 'cadastro', [['Ativo', 'open'], ['Concluído', 'closed']], [['Fechado em', 'data'], ['Valor', 'moeda']]);
    let t0 = Date.parse('2026-04-01T12:00:00Z');
    const quando = () => new Date((t0 += 86_400_000));
    ids.alfa = await tarefa(gl, 'Alfa Sintética (Ana Teste)', 'Validar', { criadoEm: quando(), campos: { Telefone: '(32) 99999-0001', 'E-mail': 'ana@alfa.teste', Vendedor: 'Lucas', 'Data de Cadastro do Lead': '2026-04-02' } });
    ids.beta = await tarefa(gl, 'Beta Sintética (Bruno Teste)', 'Followup', { criadoEm: quando(), campos: { 'Valor da proposta': 'BRL 4500.00', Produto: 'Operação ROOT' } });
    ids.gama = await tarefa(gl, 'Gama Sintética (Gil)', 'Followup', { criadoEm: quando(), descricao: `CNPJ ${CNPJ_GAMA} no cadastro` });
    ids.delta = await tarefa(gl, 'Delta Sintética (Dora)', 'Kickoff', { criadoEm: quando(), campos: { Produto: 'Imersão', Telefone: '(32) 99999-0004' } });
    ids.epsilon = await tarefa(gl, 'Épsilon Sintética (Eva)', 'Implantação', { criadoEm: quando(), campos: { Produto: 'Implantação ROOT OS' } });
    ids.zeta = await tarefa(gl, 'Zeta Sintética', 'Recorrente', { criadoEm: quando() });
    ids.eta = await tarefa(gl, 'Eta Sintética (Elo)', 'Depoimento e indicação', { criadoEm: quando() });
    ids.teta = await tarefa(gl, 'Teta Sintética', 'Oportunidade', { criadoEm: quando() });
    ids.kDelta = await tarefa(cc, 'Contrato Delta', 'Ativo', { parentId: ids.delta, criadoEm: quando(), campos: { 'Fechado em': '2026-06-10', Valor: 'BRL 2970.00' } });
    ids.kEps1 = await tarefa(cc, 'Contrato Épsilon um', 'Ativo', { parentId: ids.epsilon, criadoEm: quando(), campos: { 'Fechado em': '2026-07-01', Valor: 'BRL 1000.00' } });
    ids.kEps2 = await tarefa(cc, 'Contrato Épsilon dois', 'Ativo', { parentId: ids.epsilon, criadoEm: quando(), campos: { 'Fechado em': '2026-05-20', Valor: 'BRL 500.50' } });
    ids.kZeta = await tarefa(cc, 'Contrato Zeta', 'Ativo', { parentId: ids.zeta, criadoEm: quando(), campos: { Valor: 'BRL 800.00' } });
    ids.kEta = await tarefa(cc, 'Contrato Eta', 'Ativo', { parentId: ids.eta, criadoEm: quando(), campos: { 'Fechado em': '2026-03-03' } });
    ids.kSolto = await tarefa(cc, 'Contrato sem cliente', 'Ativo', { criadoEm: quando() });

    // os leads criados à mão: o mesmo cliente de um cartão em Followup (pelo nome) e outro pelo CNPJ, já além
    ids.leadBeta = await leadAMao('Beta Sintética', 'qualificacao', { empresa: 'Beta Sintética' });
    ids.leadGama = await leadAMao('Gama Comércio Sintético', 'contrato', { cnpj: CNPJ_GAMA });

    // a limpeza da ata
    const mkt = await prisma.workFolder.create({ data: { orgId: ORG, name: 'Demandas internas / Marketing' }, select: { id: true } });
    const dg = await lista('Demandas gerais', mkt.id, 'tarefas', [['to do', 'open'], ['complete', 'closed']]);
    const ms = await lista('Marketing', null, 'tarefas', [['A fazer', 'open'], ['Feito', 'closed']]);
    ids.tarefaMkt = await tarefa(ms, 'Tarefa real de marketing', 'Feito');
    ids.listaMkt = ms.id;
    ids.demandasGerais = dg.id;
    const tt = await lista('Teste teste', null, 'cadastro', [['Implantação', 'open']]);
    ids.teste1 = await tarefa(tt, 'lixo um', 'Implantação');
    ids.teste2 = await tarefa(tt, 'lixo dois', 'Implantação');
    ids.listaTeste = tt.id;
    ids.administrativa = (await prisma.workFolder.create({ data: { orgId: ORG, name: 'Administrativa' }, select: { id: true } })).id;
    const adm = await lista('Administrativo', null, 'tarefas', [['A fazer', 'open']]);
    ids.listaAdm = adm.id;
    ids.tarefaAdm = await tarefa(adm, 'Tarefa administrativa', 'A fazer');
    await lista('Financeiro', null, 'tarefas', [['A fazer', 'open']]);
    await lista('Operação', null, 'tarefas', [['A fazer', 'open']]);

    // A1: a lista da ÁREA Comercial, solta (espaço, sem pasta), com as formas de título da produção (nomes fictícios).
    ids.leadLumen = await leadAMao('Lumen | Carla Teste', 'qualificacao');
    ids.leadLexi = await leadAMao('Lexidr.', 'qualificacao');
    const area = await prisma.workArea.create({ data: { orgId: ORG, nome: 'Comercial', cor: '#2a78d6' }, select: { id: true } });
    ids.areaComercial = area.id;
    const espacoDaArea = await prisma.workSpace.create({ data: { orgId: ORG, name: 'Áreas' }, select: { id: true } });
    const com = await lista('Comercial', null, 'tarefas', [['A fazer', 'open'], ['Feito', 'closed']]);
    await prisma.workList.update({ where: { id: com.id }, data: { spaceId: espacoDaArea.id, areaPadraoId: area.id } });
    ids.listaComercial = com.id;
    let t1 = Date.parse('2026-09-01T12:00:00Z');
    const depois = () => new Date((t1 += 3_600_000));
    const tc = async (k: string, titulo: string, etapa: 'A fazer' | 'Feito', assigneeUserId: string | null = euId) => {
      ids[k] = await tarefa(com, titulo, etapa, { criadoEm: depois() });
      await prisma.workTask.update({ where: { id: ids[k] }, data: { areaId: area.id, assigneeUserId, dueDate: new Date('2026-10-30T12:00:00Z') } });
    };
    await tc('cAna', 'Ana Teste — Cobrar preenchimento e marcar nova conversa', 'A fazer'); // contato do lead que o CRM cria: liga
    await tc('cDora', 'Dora — Marcar onboarding', 'A fazer'); // primeiro nome sozinho (contato de um lead): ambígua
    await tc('cBeta', 'FUP Beta Sintética', 'A fazer'); // lead à mão, nome igual: liga
    await tc('cLumen', 'Proposta Lumen e instalação do OS', 'A fazer'); // "Lumen | Carla Teste": começa pela chave, liga
    await tc('cCiclano', 'Proposta Ciclano Souza — fazer FUP', 'A fazer', lucasId); // ninguém parecido: cria o lead
    await tc('cLexi', 'Marcar reunião - Lexidoc', 'A fazer'); // grafia abreviada: ambígua
    await tc('cBruno', 'Confirmar reunião com o Bruno', 'A fazer'); // primeiro nome: ambígua
    await tc('cIndica', 'Indicação do Tício Sintético', 'A fazer'); // indicação: ambígua
    await tc('cAciona', 'Acionar indicação do Tício Sintético', 'Feito'); // indicação concluída
    await tc('cFeedback', 'Colher feedback dos clientes atuais', 'Feito'); // interna concluída
    await tc('cPipe', 'Atualizar pipe', 'A fazer'); // interna
    await tc('cIntegra', 'Checar integração da Ferramenta Sintética', 'A fazer', null); // interna
    await tc('cCiclano2', 'FUP Ciclano Souza', 'A fazer'); // liga ao lead criado pela tarefa de antes
    await tc('cMevio', 'Proposta Mévio Prado — fazer FUP', 'Feito'); // concluída sem lead: não cria, interna

    // A2: a lista solta de um contato, com um cartão de lixo (achada pelo hash do nome fictício).
    const lc = await lista(NOME_DO_CONTATO, null, 'tarefas', [['A fazer', 'open']]);
    ids.listaContato = lc.id;
    ids.cartaoContato = await tarefa(lc, 'cartão de lixo', 'A fazer');
    const pt = await lista('Lista Que Parece Teste', null, 'tarefas', [['A fazer', 'open']]);
    ids.listaParece = pt.id;
    await tarefa(pt, 'uma só', 'A fazer');
  }, 120_000);

  afterAll(async () => {
    const leadIds = (await prisma.lead.findMany({ where: { orgId: ORG }, select: { id: true } })).map((l) => l.id);
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = $1', ORG),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    const trilhos = (await prisma.onboardingTrilho.findMany({ where: { orgId: ORG }, select: { id: true } })).map((t) => t.id);
    await prisma.onboardingMarco.deleteMany({ where: { trilhoId: { in: trilhos } } });
    await prisma.onboardingTrilho.deleteMany({ where: { orgId: ORG } });
    await prisma.workComment.deleteMany({ where: { orgId: ORG } });
    await prisma.workFieldValue.deleteMany({ where: { orgId: ORG } });
    await prisma.workTask.updateMany({ where: { orgId: ORG }, data: { parentId: null } });
    await prisma.workTask.deleteMany({ where: { orgId: ORG } });
    await prisma.workFieldOption.deleteMany({ where: { orgId: ORG } });
    await prisma.workField.deleteMany({ where: { orgId: ORG } });
    await prisma.workStatus.deleteMany({ where: { orgId: ORG } });
    await prisma.workList.deleteMany({ where: { orgId: ORG } });
    await prisma.workFolder.deleteMany({ where: { orgId: ORG, parentId: { not: null } } });
    await prisma.workFolder.deleteMany({ where: { orgId: ORG } });
    await prisma.workSpace.deleteMany({ where: { orgId: ORG } });
    await prisma.workArea.deleteMany({ where: { orgId: ORG } });
    await prisma.partner.deleteMany({ where: { orgId: ORG } });
    await prisma.comercialReacao.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.comercialDecisao.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.comercialFicha.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.leadEvent.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.lead.deleteMany({ where: { orgId: ORG } });
    await prisma.auditLog.deleteMany({ where: { orgId: ORG } });
    await prisma.user.deleteMany({ where: { orgId: ORG } });
    await prisma.role.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
  }, 120_000);

  it('conta de máquina e quem perdeu tarefas.editar são recusados, sem escrever nada', async () => {
    const antes = await fotografia();
    await expect(naEmpresa(() => svc.executar(ORG, { id: euId, nome: 'IA', papeis: ['ia_acao'] }, { valer: true }))).rejects.toMatchObject({ status: 403 });
    await expect(naEmpresa(() => svc.executar(ORG, { id: maquinaId, nome: 'IA', papeis: ['admin_master'] }, { valer: true }))).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/de gente/) });
    await expect(naEmpresa(() => svc.executar(ORG, { id: semTarefasId, nome: 'Sem', papeis: ['gestor_marketing'] }, { valer: true }))).rejects.toMatchObject({ status: 403 });
    await expect(naEmpresa(() => svc.executarSemPessoa(ORG, { valer: true as false }))).rejects.toMatchObject({ status: 403 });
    expect(await fotografia()).toEqual(antes);
  });

  let primeiro: RelatorioDoImportador;
  it('simular não escreve nada e conta o plano inteiro', async () => {
    const antes = await fotografia();
    const r = await rodar(false);
    expect(await fotografia()).toEqual(antes);
    expect(r.modo).toBe('simular');
    expect(r.crmEncontrado).toBe(true);
    expect(r.cartoes).toEqual({ leads: 8, contratos: 6, noPlano: 7 });
    expect(soma(r, 'feitos')).toBe(0);
    expect(r.passos['leads.criados'].aFazer).toBe(5);
    expect(r.passos['leads.reaproveitados'].aFazer).toBe(2);
    expect(r.passos['contratos.importados'].aFazer).toBe(5);
    expect(r.passos['implantacao.card'].aFazer).toBe(2);
    expect(r.passos['cartoes.arquivados'].aFazer).toBe(12);
    expect(r.passos['marketing.tarefas'].aFazer).toBe(1);
    expect(r.passos['teste.cartoes'].aFazer).toBe(2);
    expect(r.passos['administrativa.pasta'].aFazer).toBe(1);
    // Gestão e Clientes (pastas), Pessoas e as três listas de Clientes (criadas), Administrativo e Financeiro (movidas).
    expect(r.passos.estrutura.aFazer).toBe(8);
    // A1: 14 tarefas da lista Comercial = 4 ligadas + 1 que cria lead + 4 internas + 5 ambíguas; a lista do comercial e o arquivo da Comercial.
    const c = (p: (typeof PASSOS_DO_IMPORTADOR)[number]) => r.passos[p].aFazer;
    expect([c('comercial.destino'), c('comercial.tarefas'), c('comercial.ligadas'), c('comercial.leads'), c('comercial.internas'), c('comercial.ambiguas'), c('comercial.lista')]).toEqual([1, 14, 4, 1, 4, 5, 1]);
    // A2: o cartão e a lista do contato.
    expect([c('contato.cartoes'), c('contato.lista')]).toEqual([1, 1]);
    expect(r.sobrasDetalhe.filter((s) => s.onde === 'Trabalho / Comercial').map((s) => s.cartaoId).sort()).toEqual([ids.cDora, ids.cLexi, ids.cBruno, ids.cIndica, ids.cAciona].sort());
    expect(r.sobrasDetalhe.some((s) => s.cartaoId === ids.listaContato || s.cartaoId === ids.listaComercial)).toBe(false);
    expect(r.efeitos.antes).toEqual(r.efeitos.depois);
  });

  it('valer: cada cartão no lugar certo, a limpeza feita, e nenhum efeito para fora', async () => {
    primeiro = await rodar(true);
    const r = primeiro;
    expect(r.erros).toBe(0);
    expect(soma(r, 'aFazer')).toBe(0);
    // Nada sai para fora: nem mensagem, nem aprovação, nem cobrança, documento, sala, contrato do Financeiro, reação ou decisão.
    expect(r.efeitos.depois).toEqual(r.efeitos.antes);
    const tipos = new Set((await prisma.leadEvent.findMany({ where: { lead: { orgId: ORG } }, select: { type: true } })).map((e) => e.type));
    for (const t of ['lead.chegou', 'whats.enviada', 'sala.aberta', 'sala.publicada', 'cobranca.criada', 'contrato.gerado', 'fechamento.escrita']) expect(tipos.has(t as never), t).toBe(false);

    // Alfa: lead novo pela entrada idempotente, em qualificação, com o vendedor como dono e a data do CRM.
    const alfa = leadIdDaEntrada(ORG, { tipo: 'manual', ref: `cartao:${ids.alfa}` });
    const la = await prisma.lead.findUniqueOrThrow({ where: { id: alfa }, include: { ficha: true } });
    expect([la.name, la.phone, la.email, la.ownerId, la.ficha?.etapa, la.ficha?.empresa, la.ficha?.donoId]).toEqual(['Alfa Sintética', '(32) 99999-0001', 'ana@alfa.teste', lucasId, 'qualificacao', 'Alfa Sintética', lucasId]);
    expect(la.enteredAt.toISOString().slice(0, 10)).toBe('2026-04-02');

    // Beta: o lead à mão, reaproveitado pelo nome, levado a follow-up com o valor e o produto do cartão.
    const lb = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId: ids.leadBeta } });
    expect([lb.etapa, lb.valorCentavos, lb.produto, lb.donoId]).toEqual(['follow_up', 450_000, 'operacao', euId]);
    expect(await prisma.lead.count({ where: { id: leadIdDaEntrada(ORG, { tipo: 'manual', ref: `cartao:${ids.beta}` }) } })).toBe(0);
    const mov = await prisma.auditLog.findFirstOrThrow({ where: { orgId: ORG, action: 'comercial.etapa.movida_a_mao', entityId: ids.leadBeta } });
    expect([mov.actorId, (mov.after as { etapa: string }).etapa]).toEqual([euId, 'follow_up']);
    // Gama: pelo CNPJ, e já além do follow-up (contrato): a etapa fica.
    expect((await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId: ids.leadGama } })).etapa).toBe('contrato');

    // Os clientes: fechado, Partner, cliente ativo importado, os contratos vivos.
    const cli = async (k: string) => leadIdDaEntrada(ORG, { tipo: 'manual', ref: `cartao:${ids[k]}` });
    for (const k of ['delta', 'epsilon', 'zeta', 'eta']) {
      const id = await cli(k);
      const f = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId: id } });
      expect(f.etapa, k).toBe('fechado');
      expect(f.partnerId, k).toBeTruthy();
      expect(f.clienteAtivoEm, k).toBeTruthy();
      const p = await prisma.partner.findUniqueOrThrow({ where: { id: f.partnerId! } });
      expect(p.isCliente).toBe(true);
      const ativo = await prisma.leadEvent.findFirstOrThrow({ where: { leadId: id, type: 'cliente.ativo' } });
      expect(ativo.payload).toMatchObject({ importado: true, origem: `cartao:${ids[k]}` });
    }
    // O cliente ativo leva a data real do primeiro contrato (Épsilon: 20/05, não 01/07), nunca a da importação.
    const eps = await cli('epsilon');
    expect((await prisma.leadEvent.findFirstOrThrow({ where: { leadId: eps, type: 'cliente.ativo' } })).occurredAt.toISOString().slice(0, 10)).toBe('2026-05-20');

    const vivos = await naEmpresa(() => contratos.lista(ORG));
    expect(vivos.map((c) => c.cliente).sort()).toEqual(['Delta Sintética', 'Eta Sintética', 'Zeta Sintética', 'Épsilon Sintética'].sort());
    const ve = vivos.find((c) => c.leadId === eps)!;
    expect(ve.importados?.map((x) => [x.titulo, x.valorCentavos, x.fechadoEm, x.semDocumento])).toEqual([
      ['Contrato Épsilon dois', 50_050, '2026-05-20', true],
      ['Contrato Épsilon um', 100_000, '2026-07-01', true],
    ]);
    expect(ve.valorCentavos).toBe(150_050);
    expect(ve.parcelas).toEqual([]);
    expect(ve.marcos.find((x) => x.chave === 'dia_15_indicacao')?.quando).toBeNull();
    // A régua e os marcos do relógio não tocam cliente importado.
    const relogio = await naEmpresa(() => contratos.regua(ORG, new Date()));
    const marcos = await naEmpresa(() => contratos.marcos(ORG, new Date()));
    expect([relogio.avisos, marcos.marcos]).toEqual([0, 0]);

    // O card da implantação: Kickoff em "Kickoff marcado", Implantação em "Kit montado", com trilho e selo; Recorrente e Depoimento sem card.
    const delta = await cli('delta');
    const cd = await prisma.workTask.findUniqueOrThrow({ where: { id: cardIdDoLead(ORG, delta) }, include: { status: true, list: { include: { folder: true } } } });
    expect([cd.list.folder?.name, cd.list.name, cd.status.name, cd.title]).toEqual(['Clientes', 'Onboarding de cliente', 'Kickoff marcado', 'Delta Sintética']);
    expect(cd.description).toContain('Procedência: importado do CRM antigo');
    const ce = await prisma.workTask.findUniqueOrThrow({ where: { id: cardIdDoLead(ORG, eps) }, include: { status: true } });
    expect(ce.status.name).toBe('Kit montado');
    for (const k of ['zeta', 'eta']) expect(await prisma.workTask.count({ where: { id: cardIdDoLead(ORG, await cli(k)) } }), k).toBe(0);
    expect(await prisma.onboardingTrilho.count({ where: { orgId: ORG } })).toBe(2);
    const m = await naEmpresa(() => movimento.daLista(ORG, cd.listId));
    expect(m.itens.find((i) => i.tarefaId === cd.id)?.procedencia?.rotulo).toMatch(/^importado do CRM antigo · /);

    // O cartão de origem: arquivado, com o link do lead; o contrato também. Teta (status desconhecido) e o contrato sem pai ficam.
    const ca = await prisma.workTask.findUniqueOrThrow({ where: { id: ids.alfa }, include: { comments: true } });
    expect(ca.archived).toBe(true);
    expect(ca.comments.map((c) => c.text)).toEqual([`Importado para o Comercial: https://os.exemplo.teste/comercial/lead/${alfa}`]);
    expect((await prisma.workTask.findUniqueOrThrow({ where: { id: ids.kEps1 } })).archived).toBe(true);
    for (const k of ['teta', 'kSolto']) expect((await prisma.workTask.findUniqueOrThrow({ where: { id: ids[k] } })).archived, k).toBe(false);
    expect(r.sobrasDetalhe.map((s) => s.cartaoId)).toEqual(expect.arrayContaining([ids.teta, ids.kSolto, ids.listaParece]));
    // Com sobras, as listas e a pasta do CRM ficam.
    expect(await prisma.workList.count({ where: { orgId: ORG, name: { in: ['Gestão de Leads', 'Contratos dos clientes'] }, arquivadaEm: { not: null } } })).toBe(0);

    // A limpeza: a tarefa de marketing foi para Demandas gerais (etapa fechada de lá), a lista vazia foi arquivada.
    const tm = await prisma.workTask.findUniqueOrThrow({ where: { id: ids.tarefaMkt }, include: { status: true } });
    expect([tm.listId, tm.status.name]).toEqual([ids.demandasGerais, 'complete']);
    expect((await prisma.workList.findUniqueOrThrow({ where: { id: ids.listaMkt } })).arquivadaEm).toBeTruthy();
    expect(await prisma.workTask.count({ where: { id: { in: [ids.teste1, ids.teste2] }, archived: true } })).toBe(2);
    expect((await prisma.workList.findUniqueOrThrow({ where: { id: ids.listaTeste } })).arquivadaEm).toBeTruthy();
    // A estrutura: Administrativo (a mesma lista, com a tarefa) em Gestão, Financeiro também, Pessoas criada; Administrativa arquivada.
    const gestao = await prisma.workFolder.findFirstOrThrow({ where: { orgId: ORG, name: 'Gestão' }, include: { lists: true } });
    expect(gestao.lists.map((l) => l.name).sort()).toEqual(['Administrativo', 'Financeiro', 'Pessoas']);
    expect(gestao.lists.find((l) => l.name === 'Administrativo')?.id).toBe(ids.listaAdm);
    expect((await prisma.workTask.findUniqueOrThrow({ where: { id: ids.tarefaAdm } })).listId).toBe(ids.listaAdm);
    expect((await prisma.workFolder.findUniqueOrThrow({ where: { id: ids.administrativa } })).arquivadaEm).toBeTruthy();
    // Nada foi apagado: as listas e as pastas continuam no banco.
    expect(await prisma.workList.count({ where: { id: { in: [ids.listaMkt, ids.listaTeste] } } })).toBe(2);

    // A marca em toda escrita do importador, com a pessoa.
    const marcadas = await prisma.auditLog.findMany({ where: { orgId: ORG, action: { startsWith: `${IMPORTACAO_CRM_MARCA}.` } }, select: { actorId: true, actorType: true, metadata: true } });
    expect(marcadas.length).toBeGreaterThan(20);
    expect(marcadas.every((a) => a.actorId === euId && a.actorType === 'user' && (a.metadata as { marca?: string }).marca === IMPORTACAO_CRM_MARCA)).toBe(true);
  });

  it('A1/A2 no valer: as tarefas da lista Comercial no Comercial, ligadas só quando é seguro; as duas listas arquivadas', async () => {
    const r = primeiro;
    const f = (p: (typeof PASSOS_DO_IMPORTADOR)[number]) => r.passos[p].feitos;
    expect([f('comercial.destino'), f('comercial.tarefas'), f('comercial.ligadas'), f('comercial.leads'), f('comercial.internas'), f('comercial.ambiguas'), f('comercial.lista')]).toEqual([1, 14, 4, 1, 4, 5, 1]);
    expect([f('contato.cartoes'), f('contato.lista')]).toEqual([1, 1]);

    const destino = await prisma.workList.findFirstOrThrow({ where: { orgId: ORG, externalId: LISTA_DO_COMERCIAL }, include: { statuses: true } });
    expect([destino.name, destino.folderId, destino.areaPadraoId]).toEqual(['Tarefas do comercial', null, ids.areaComercial]);
    const tarefas = await prisma.workTask.findMany({
      where: { orgId: ORG, id: { in: Object.keys(ids).filter((k) => /^c[A-Z]/.test(k)).map((k) => ids[k]) } },
      include: { status: true },
    });
    expect(tarefas).toHaveLength(14);
    const por = (k: string) => tarefas.find((t) => t.id === ids[k])!;
    // O mesmo id, na lista do comercial, com a área Comercial; responsável e prazo intactos.
    for (const t of tarefas) {
      expect([t.listId, t.areaId, t.archived], t.title).toEqual([destino.id, ids.areaComercial, false]);
      expect(t.dueDate?.toISOString()).toBe('2026-10-30T12:00:00.000Z');
    }
    expect(por('cIntegra').assigneeUserId).toBeNull();
    // Concluída continua concluída; aberta vai para "A fazer".
    for (const k of ['cAciona', 'cFeedback', 'cMevio']) expect([por(k).status.name, por(k).status.type], k).toEqual(['Feito', 'closed']);
    for (const k of ['cAna', 'cPipe', 'cLumen']) expect(por(k).status.name, k).toBe('A fazer');

    // Ligadas: ao lead que o CRM criou (contato igual), ao lead à mão (nome igual) e ao "Nome | Contato" (começa pela chave).
    const alfa = leadIdDaEntrada(ORG, { tipo: 'manual', ref: `cartao:${ids.alfa}` });
    expect(por('cAna').leadId).toBe(alfa);
    expect(por('cBeta').leadId).toBe(ids.leadBeta);
    expect(por('cLumen').leadId).toBe(ids.leadLumen);
    // O lead criado pela tarefa: em Qualificação, com o responsável dela como dono, pelo fato importado (sem reação).
    const ciclano = leadIdDaEntrada(ORG, { tipo: 'manual', ref: `cartao:${ids.cCiclano}` });
    expect(por('cCiclano').leadId).toBe(ciclano);
    expect(por('cCiclano2').leadId).toBe(ciclano);
    const lc = await prisma.lead.findUniqueOrThrow({ where: { id: ciclano }, include: { ficha: true } });
    expect([lc.name, lc.ownerId, lc.ficha?.etapa, lc.ficha?.empresa, lc.ficha?.donoId]).toEqual(['Ciclano Souza', lucasId, 'qualificacao', 'Ciclano Souza', lucasId]);
    const fato = await prisma.leadEvent.findFirstOrThrow({ where: { leadId: ciclano, type: 'lead.importado' } });
    expect(fato.payload).toMatchObject({ origem: `cartao:${ids.cCiclano}`, lista: 'Trabalho / Comercial', destino: 'qualificacao', marca: IMPORTACAO_CRM_MARCA });
    // Nenhum lead novo para quem só foi citado de forma ambígua ou numa concluída.
    for (const k of ['cDora', 'cLexi', 'cBruno', 'cIndica', 'cAciona', 'cMevio', 'cFeedback', 'cPipe', 'cIntegra']) {
      expect(por(k).leadId, k).toBeNull();
      expect(await prisma.lead.count({ where: { id: leadIdDaEntrada(ORG, { tipo: 'manual', ref: `cartao:${ids[k]}` }) } }), k).toBe(0);
    }
    expect(r.sobrasDetalhe.find((s) => s.cartaoId === ids.cDora)?.motivo).toMatch(/primeiro nome/);
    expect(r.sobrasDetalhe.find((s) => s.cartaoId === ids.cLexi)?.motivo).toMatch(/parecido/);
    expect(r.sobrasDetalhe.find((s) => s.cartaoId === ids.cIndica)?.motivo).toMatch(/indicação/);
    expect(r.detalhe.find((l) => l.passo === 'sobra' && l.id === ids.cBruno)?.acao).toBe('entra como tarefa do comercial sem lead');

    // A lista Comercial e a do contato: arquivadas, não apagadas; o cartão do contato arquivado com o porquê.
    expect((await prisma.workList.findUniqueOrThrow({ where: { id: ids.listaComercial } })).arquivadaEm).toBeTruthy();
    expect(await prisma.workTask.count({ where: { listId: ids.listaComercial } })).toBe(0);
    expect((await prisma.workList.findUniqueOrThrow({ where: { id: ids.listaContato } })).arquivadaEm).toBeTruthy();
    const cc = await prisma.workTask.findUniqueOrThrow({ where: { id: ids.cartaoContato }, include: { comments: true } });
    expect([cc.archived, cc.listId, cc.comments.length]).toEqual([true, ids.listaContato, 1]);

    // A auditoria de cada tarefa movida, com a pessoa e a marca.
    const movidas = await prisma.auditLog.findMany({ where: { orgId: ORG, action: `${IMPORTACAO_CRM_MARCA}.tarefa_do_comercial` } });
    expect(movidas).toHaveLength(14);
    expect(movidas.every((a) => a.actorId === euId && (a.before as { listId: string }).listId === ids.listaComercial)).toBe(true);
  });

  it('valer de novo não muda nada; simular depois dá zero', async () => {
    const antes = await fotografia();
    const r2 = await rodar(true);
    expect(soma(r2, 'feitos')).toBe(0);
    expect(r2.erros).toBe(0);
    expect(await fotografia()).toEqual(antes);
    const r3 = await rodar(false);
    expect(soma(r3, 'aFazer')).toBe(0);
    expect(r3.passos['cartoes.arquivados'].jaEstava).toBe(12);
    // A lista Comercial e a do contato já arquivadas: nada a mover, nada a ligar, nenhum lead novo.
    expect([r3.passos['comercial.lista'].jaEstava, r3.passos['contato.lista'].jaEstava, r3.passos['contato.cartoes'].jaEstava, r3.passos['comercial.tarefas'].jaEstava]).toEqual([1, 1, 1, 0]);
    expect(r3.efeitos.depois).toEqual(primeiro.efeitos.antes);
    expect(await fotografia()).toEqual(antes);
  });

  it('com as sobras decididas à mão, a próxima passada arquiva as listas e a pasta do CRM (nunca apaga)', async () => {
    await prisma.workTask.updateMany({ where: { id: { in: [ids.teta, ids.kSolto] } }, data: { archived: true } });
    const r = await rodar(true);
    expect([r.passos['crm.listas'].feitos, r.passos['crm.pasta'].feitos, r.erros]).toEqual([2, 1, 0]);
    expect(await prisma.workList.count({ where: { orgId: ORG, name: { in: ['Gestão de Leads', 'Contratos dos clientes'] }, arquivadaEm: { not: null } } })).toBe(2);
    expect((await prisma.workFolder.findFirstOrThrow({ where: { orgId: ORG, name: 'CRM' } })).arquivadaEm).toBeTruthy();
    // Os cartões arquivados à mão antes da importação NÃO viram lead: ficam como estão.
    expect(r.sobrasDetalhe.some((s) => s.cartaoId === ids.teta)).toBe(true);
    const z = await rodar(false);
    expect(soma(z, 'aFazer')).toBe(0);
    expect(z.efeitos.depois).toEqual(primeiro.efeitos.antes);
  });
});
