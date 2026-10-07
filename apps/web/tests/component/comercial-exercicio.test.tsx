import { webcrypto,randomUUID } from 'node:crypto';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComercialExercicioLeitura } from '@mktos/shared';
const get = vi.fn(),post = vi.fn(),push = vi.fn();
const userId = randomUUID(),leadId = randomUUID(),propId = randomUUID(),aceId = randomUUID(),taskId = randomUUID(),listId = randomUUID();
let permissions: string[] = [];
vi.mock('next/navigation',() => ({ useRouter: () => ({ push: (...a: unknown[]) => push(...a) }) }));
vi.mock('@/lib/api',async () => { const m = await vi.importActual<typeof import('@/lib/api')>('@/lib/api'); return { ...m,apiGet: (...a: unknown[]) => get(...a),apiPost: (...a: unknown[]) => post(...a) }; });
vi.mock('@/lib/auth',() => ({ useAuth: () => ({ token: 'qa',ready: true,user: { id: userId },can: (p: string) => permissions.includes(p) }) }));
import { ComercialExercicio } from '@/app/leads/ComercialExercicio';
import { NovaOportunidadeExercicio } from '@/app/leads/NovaOportunidadeExercicio';
import { OrigemComercialDaTarefa } from '@/app/leads/OrigemComercialDaTarefa';
const base = (): ComercialExercicioLeitura => ({ modo: 'exercicio',lead: { id: leadId,nome: '[QA] Oportunidade',ownerId: userId,status: 'novo',nextAction: null,updatedAt: '2026-10-07T12:00:00.000Z' },origem: { tipo: 'manual',ref: randomUUID() },
 propostas: [{ id: propId,versao: 1,documento: { titulo: 'Proposta QA v1',corpo: 'Material comercial sintético da versão um.',hash: 'a'.repeat(64) },condicoes: { valorCanonico: 'BRL 1500.00',inicio: null,prazo: '30 dias',periodicidade: null },condicoesHash: 'b'.repeat(64),registradaEm: '2026-10-07T12:00:00.000Z',atorId: userId }],versaoAtual: 1,aceites: [],entregas: [],financeiro: { situacao: 'pendente',pendencias: ['Identificar a contraparte financeira.'] },podeAceitar: true,podeEntregar: true });
const aceitado = (): ComercialExercicioLeitura => { const s = base(); s.aceites = [{ id: aceId,propostaId: propId,propostaVersao: 1,condicoesHash: 'b'.repeat(64),evidencia: { tipo: 'exercicio',texto: 'Evidência sintética de exercício.' },alcada: { minima: 'responsavel',verificada: 'responsavel' },registradaEm: '2026-10-07T12:01:00.000Z',atorId: userId }]; return s; };
const estrutura = { folders: [],listasSoltas: [{ id: listId,name: 'Lista QA de entrega',statuses: [] }],pessoas: [{ id: userId,name: 'Pessoa QA',email: 'qa@qa.invalid',isActive: true }] };
let estado: ComercialExercicioLeitura;
beforeEach(() => {
 vi.stubGlobal('crypto',webcrypto); localStorage.clear(); get.mockReset(); post.mockReset(); push.mockReset(); permissions = ['leads.ver','leads.editar','tarefas.ver','tarefas.editar']; estado = base();
 get.mockImplementation(async (path: string) => { if (path === '/trabalho/estrutura') return estrutura; if (path.includes('/exercicio')) return structuredClone(estado); throw Error('GET inesperado'); });
 post.mockImplementation(async () => ({ leadId,eventoId: randomUUID(),replayed: false }));
});
function montar() { const perdido = vi.fn(); render(<ComercialExercicio leadId={leadId} onChanged={vi.fn()} onIndisponivel={perdido}/>); return perdido; }
describe('Comercial QA na interface',() => {
 it('mostra origem, versão, condições e pendência sem anunciar cliente ou cobrança',async () => {
  montar(); expect(await screen.findByText('Material comercial sintético da versão um.')).toBeInTheDocument();
  expect(screen.getByText('BRL 1500.00')).toBeInTheDocument(); expect(screen.getByText(/Origem manual única/)).toHaveTextContent(estado.origem.ref);
  expect(screen.getByText('Identificar a contraparte financeira.')).toBeInTheDocument(); expect(screen.getByText(/Não representam aceite de cliente/)).toBeInTheDocument();
 });
 it('perfil leitor não recebe formulários; conta sem alçada não recebe botão de aceite',async () => {
  permissions = ['leads.ver']; estado.podeAceitar = false; estado.podeEntregar = false; montar();
  await screen.findByText('Material comercial sintético da versão um.');
  expect(screen.queryByRole('button',{ name: 'Salvar proposta de exercício' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{ name: 'Registrar aceite de exercício' })).not.toBeInTheDocument();
 });
 it('aceite usa a versão exata e exige evidência e confirmação de exercício',async () => {
  const u = userEvent.setup(); montar(); await screen.findByText('Material comercial sintético da versão um.');
  const b = screen.getByRole('button',{ name: 'Registrar aceite de exercício' }); expect(b).toBeDisabled();
  await u.type(screen.getByLabelText('Evidência do aceite de exercício'),'Concordância apenas para o exercício de QA.'); expect(b).toBeDisabled();
  await u.click(screen.getByLabelText('Confirmo que é um exercício')); await u.click(b);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0][0]).toBe(`/leads/${leadId}/exercicio/aceites`);
  expect(post.mock.calls[0][1]).toMatchObject({ propostaId: propId,expectedPropostaVersion: 1,condicoesHash: 'b'.repeat(64),confirmacaoExercicio: true,evidencia: { tipo: 'exercicio' } });
 });
 it('mudar etapa para ganho envia apenas acompanhamento',async () => {
  const u = userEvent.setup(); montar(); await screen.findByText('Material comercial sintético da versão um.');
  await u.selectOptions(screen.getByLabelText('Etapa do exercício'),'ganho'); await u.click(screen.getByRole('button',{ name: 'Salvar acompanhamento de exercício' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1)); expect(post.mock.calls[0][0]).toContain('/exercicio/acompanhamento'); expect(post.mock.calls[0][1].status).toBe('ganho');
 });
 it('salva proposta com versão esperada e valores informados, sem completar financeiro',async () => {
  const u = userEvent.setup(); montar(); await screen.findByText('Material comercial sintético da versão um.');
  await u.type(screen.getByLabelText('Título da proposta'),'Proposta nova QA'); await u.type(screen.getByLabelText('Documento da proposta'),'Corpo da nova proposta de exercício.');
  await u.type(screen.getByLabelText('Valor comercial canônico'),'BRL 100.00'); await u.click(screen.getByRole('button',{ name: 'Salvar proposta de exercício' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1)); expect(post.mock.calls[0][1]).toMatchObject({ expectedPropostaVersion: 1,documento: { titulo: 'Proposta nova QA' },condicoes: { valorCanonico: 'BRL 100.00',inicio: null,periodicidade: null } });
  const cache = localStorage.getItem(`root_comercial_pedido:${userId}:${leadId}:propostas`)!; expect(cache).not.toContain('Corpo da nova'); expect(cache).not.toContain('BRL 100.00');
 });
 it('resposta perdida reutiliza identidade da entrega e abre o mesmo cartão confirmado',async () => {
  estado = aceitado(); const u = userEvent.setup(); montar(); await screen.findByText(/Alçada verificada: responsavel/);
  await u.click(screen.getByRole('button',{ name: 'Escolher destino da entrega' })); await screen.findByLabelText('Lista da entrega');
  await u.selectOptions(screen.getByLabelText('Lista da entrega'),listId); await u.type(screen.getByLabelText('Título da entrega'),'Entrega QA');
  post.mockRejectedValueOnce(Error('Resposta perdida após confirmação'));
  await u.click(screen.getByRole('button',{ name: 'Abrir entrega de exercício' })); await screen.findByRole('alert');
  const pedido = post.mock.calls[0][1]; post.mockImplementationOnce(async () => { estado.entregas = [{ taskId,listId,title: 'Entrega QA',aceiteId: aceId,propostaId: propId,propostaVersao: 1,condicoesHash: 'b'.repeat(64),criadaEm: '2026-10-07T12:02:00.000Z',atorId: userId }]; return { leadId,eventoId: randomUUID(),taskId,replayed: true }; });
  await u.click(screen.getByRole('button',{ name: 'Abrir entrega de exercício' }));
  expect(await screen.findByRole('link',{ name: /Abrir entrega em Trabalho/ })).toHaveAttribute('href',`/trabalho?lista=${listId}&tarefa=${taskId}`);
  expect(post.mock.calls[1][1].requestId).toBe(pedido.requestId); expect(post.mock.calls[1][1]).toEqual(pedido);
 });
 it('recusa de acesso limpa a versão, evidência e vínculo que estavam na tela',async () => {
  estado = aceitado(); const u = userEvent.setup(),perdido = montar(); await screen.findByText('Material comercial sintético da versão um.');
  get.mockRejectedValueOnce(Object.assign(Error('Permissão revogada'),{ status: 403 })); await u.click(screen.getByRole('button',{ name: 'Reabrir exercício' }));
  await waitFor(() => expect(perdido).toHaveBeenCalledTimes(1)); expect(screen.queryByText('Material comercial sintético da versão um.')).not.toBeInTheDocument(); expect(screen.queryByText(/Evidência sintética de exercício/)).not.toBeInTheDocument();
 });
 it('conflito relê a versão nova e deixa a anterior disponível apenas como histórico',async () => {
  const u = userEvent.setup(); montar(); await screen.findByText('Material comercial sintético da versão um.');
  await u.type(screen.getByLabelText('Evidência do aceite de exercício'),'Evidência do exercício sintético.'); await u.click(screen.getByLabelText('Confirmo que é um exercício'));
  post.mockImplementationOnce(async () => { estado.propostas.push({ ...estado.propostas[0],id: randomUUID(),versao: 2,documento: { ...estado.propostas[0].documento,corpo: 'Material da versão dois do exercício.' } }); estado.versaoAtual = 2; throw Object.assign(Error('Proposta alterada'),{ status: 409 }); });
  await u.click(screen.getByRole('button',{ name: 'Registrar aceite de exercício' })); await screen.findByText('Material da versão dois do exercício.');
  await u.selectOptions(screen.getByLabelText('Versão da proposta'),'1'); expect(screen.getByText('Material comercial sintético da versão um.')).toBeInTheDocument(); expect(screen.queryByRole('button',{ name: 'Registrar aceite de exercício' })).not.toBeInTheDocument();
 });
 it('origem no cartão usa link interno e desaparece após recusa',async () => {
  get.mockResolvedValueOnce({ modo: 'exercicio',leadId,leadNome: '[QA] Oportunidade',propostaVersao: 1,aceiteId: aceId });
  const { rerender } = render(<OrigemComercialDaTarefa taskId={taskId}/>);
  expect(await screen.findByRole('link',{ name: /Oportunidade · proposta v1/ })).toHaveAttribute('href',`/leads/${leadId}`);
  get.mockRejectedValueOnce(Object.assign(Error('Revogado'),{ status: 403 })); rerender(<OrigemComercialDaTarefa taskId={randomUUID()}/>);
  await waitFor(() => expect(screen.queryByRole('link',{ name: /Oportunidade · proposta v1/ })).not.toBeInTheDocument());
 });
 it('entrada ambígua recupera a mesma origem e pedido, sem enviar mensagem externa',async () => {
  const u = userEvent.setup(); render(<NovaOportunidadeExercicio/>); await u.click(screen.getByRole('button',{ name: 'Nova oportunidade (exercício)' }));
  await u.type(screen.getByLabelText('Nome da oportunidade de exercício'),'Oportunidade QA'); post.mockRejectedValueOnce(Error('Resposta perdida'));
  await u.click(screen.getByRole('button',{ name: 'Registrar oportunidade de exercício' })); await screen.findByRole('alert'); const p = post.mock.calls[0][1];
  await u.click(screen.getByRole('button',{ name: 'Registrar oportunidade de exercício' })); await waitFor(() => expect(push).toHaveBeenCalledWith(`/leads/${leadId}`));
  expect(post.mock.calls[1][1]).toEqual(p); expect(post.mock.calls.every(([path]) => path === '/leads/exercicio/entrada')).toBe(true);
 });
 it('resposta antiga de outra oportunidade não reaparece após navegação',async () => {
  let resolver!: (v: ComercialExercicioLeitura) => void;
  get.mockImplementationOnce(() => new Promise<ComercialExercicioLeitura>((r) => { resolver = r; }));
  const { rerender } = render(<ComercialExercicio leadId={leadId} onChanged={vi.fn()} onIndisponivel={vi.fn()}/>);
  const novo = randomUUID(); estado.propostas[0].documento.corpo = 'Corpo exclusivo da oportunidade nova.';
  rerender(<ComercialExercicio leadId={novo} onChanged={vi.fn()} onIndisponivel={vi.fn()}/>); await screen.findByText('Corpo exclusivo da oportunidade nova.');
  resolver(base()); await waitFor(() => expect(screen.queryByText('Material comercial sintético da versão um.')).not.toBeInTheDocument());
 });
});
