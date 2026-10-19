import { webcrypto } from 'node:crypto';
import { render,screen,waitFor,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { PonteResposta } from '@mktos/shared';
const get=vi.fn(),post=vi.fn(),patch=vi.fn();
const USER='11111111-1111-4111-8111-111111111111',ORG='22222222-2222-4222-8222-222222222222',LEAD='33333333-3333-4333-8333-333333333333',PROP='44444444-4444-4444-8444-444444444444',ACE='55555555-5555-4555-8555-555555555555',PROJECT='66666666-6666-4666-8666-666666666666',TASK='77777777-7777-4777-8777-777777777777',LIST='88888888-8888-4888-8888-888888888888',STATUS='99999999-9999-4999-8999-999999999999',TX='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',VERSION='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',CAT='cccccccc-cccc-4ccc-8ccc-cccccccccccc',REQUEST='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NOW='2026-10-08T12:00:00.000Z',HASH='a'.repeat(64),PATH='/finance/exercicio/comercial/obrigacoes/'+TX;
let origem='comercial',permissions:string[]=[];
vi.mock('@/lib/api',async()=>({...await vi.importActual<typeof import('@/lib/api')>('@/lib/api'),apiGet:(...a:unknown[])=>get(...a),apiPost:(...a:unknown[])=>post(...a),apiPatch:(...a:unknown[])=>patch(...a)}));
vi.mock('@/lib/auth',()=>({useAuth:()=>({token:'qa-sessao',ready:true,user:{id:USER},can:(p:string)=>permissions.includes(p)})}));
vi.mock('next/navigation',()=>({useParams:()=>({id:TX}),useSearchParams:()=>({get:()=>origem})}));
import { PonteObrigacao } from '@/app/financeiro/obrigacoes/PonteObrigacao';
import FinanceiroPage from '@/app/financeiro/page';
import ObrigacaoPage from '@/app/financeiro/obrigacoes/[id]/page';
import { chavePonte } from '@/app/leads/pedido-ponte';
function resposta():PonteResposta {
 return {modo:'exercicio',requestId:REQUEST,replayed:false,escopo:{orgId:ORG,userId:USER},projeto:null,
 obrigacao:{id:REQUEST,transactionId:TX,versionId:VERSION,contentHash:HASH,expectedUpdatedAt:NOW,snapshot:{schemaVersion:1,modo:'exercicio',origem:{leadId:LEAD,aceiteId:ACE,propostaId:PROP,propostaVersao:1,documentoHash:HASH,condicoesHash:'b'.repeat(64)},projectId:PROJECT,taskId:TASK,transactionId:TX,condicoes:{tipo:'entrada',descricao:'Obrigação comercial privada QA',valorCanonico:'BRL 1500.00',currency:'BRL',competencia:NOW,vencimento:NOW,accountId:CAT,partnerId:CAT,chartAccountId:CAT,projetoFinanceiroId:null,departamentoId:null,contractId:null,temRateio:false}},status:'previsto',approvalStatus:'aguardando',paidAt:null,reconciledAt:null,decisao:null,canDecide:true,impedimento:null},
 financeiro:{situacao:'registrado',pendencias:[]},capacidades:{podeCriarProjeto:false,podeRegistrarObrigacao:false,podeDecidir:true},efeitos:{tarefaCriada:false,projetoCriado:false,obrigacaoCriada:false,decisaoRegistrada:false,pagamentoExecutado:false,cobrancaExecutada:false,conciliacaoExecutada:false}};
}
let state:PonteResposta;
beforeEach(()=>{
 vi.stubGlobal('crypto',webcrypto);localStorage.clear();get.mockReset();post.mockReset();patch.mockReset();origem='comercial';permissions=['financeiro.ver','financeiro.editar'];state=resposta();
 get.mockImplementation(async()=>structuredClone(state));
 post.mockImplementation(async(_path,body:Record<string,unknown>)=>{state=resposta();state.requestId=String(body.requestId);state.obrigacao!.approvalStatus=body.aprovar?'aprovado':'rejeitado';state.obrigacao!.canDecide=false;state.obrigacao!.decisao={id:REQUEST,atorId:USER,aprovar:!!body.aprovar,motivo:String(body.motivo),alcada:'responsavel',decididaEm:NOW};return structuredClone(state);});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function montar(){return render(<PonteObrigacao token="qa-sessao" userId={USER} transactionId={TX}/>);}
async function preencher(u:ReturnType<typeof userEvent.setup>){await screen.findByRole('heading',{name:'Obrigação comercial privada QA'});await u.click(screen.getByLabelText('Conferi a origem, o valor, a moeda e as condições comerciais.'));await u.type(screen.getByLabelText('Motivo da decisão comercial'),'Motivo privado sintético QA');}
describe('decisão comercial com API simulada',()=>{
 it('capacidade de decisão falsa mantém o botão bloqueado mesmo com detalhe divergente',async()=>{state.capacidades.podeDecidir=false;montar();await screen.findByRole('heading',{name:'Obrigação comercial privada QA'});expect(screen.getByRole('button',{name:'Aprovar condições comerciais'})).toBeDisabled();expect(post).not.toHaveBeenCalled();});
 it('mostra snapshot e decisão exige motivo e conferência, usando rota própria',async()=>{
  const u=userEvent.setup();montar();await screen.findByRole('heading',{name:'Obrigação comercial privada QA'});expect(screen.getByRole('button',{name:'Aprovar condições comerciais'})).toBeDisabled();await preencher(u);await u.click(screen.getByRole('button',{name:'Aprovar condições comerciais'}));
  expect(await screen.findByRole('heading',{name:'Condições aprovadas'})).toBeInTheDocument();expect(post.mock.calls[0][0]).toBe(PATH+'/decisoes');expect(post.mock.calls[0][1]).toMatchObject({versionId:VERSION,contentHash:HASH,expectedUpdatedAt:NOW,aprovar:true,motivo:'Motivo privado sintético QA'});expect(patch).not.toHaveBeenCalled();
 });
 it('leitor sem alçada não recebe decisão habilitada nem projeto omitido',async()=>{
  state.obrigacao!.canDecide=false;state.obrigacao!.impedimento='Alçada atual insuficiente.';state.capacidades.podeDecidir=false;montar();await screen.findByText('Alçada atual insuficiente.');expect(screen.getByRole('button',{name:'Aprovar condições comerciais'})).toBeDisabled();expect(screen.queryByRole('link',{name:'Abrir tarefa do projeto'})).not.toBeInTheDocument();expect(screen.queryByRole('link',{name:'Voltar à origem comercial'})).not.toBeInTheDocument();expect(post).not.toHaveBeenCalled();
 });
 it('origem e Trabalho aparecem somente quando o retorno e os acessos permitem',async()=>{
  permissions.push('leads.ver','tarefas.ver');state.projeto={id:PROJECT,taskId:TASK,origem:state.obrigacao!.snapshot.origem,configuracaoOriginal:{listId:LIST,statusId:STATUS,title:'Tarefa QA',assigneeUserId:null},atual:{listId:LIST,statusId:STATUS,title:'Tarefa QA',assigneeUserId:null,archived:false},criadaEm:NOW};montar();
  expect(await screen.findByRole('link',{name:'Voltar à origem comercial'})).toHaveAttribute('href','/leads/'+LEAD);expect(screen.getByRole('link',{name:'Abrir tarefa do projeto'})).toHaveAttribute('href','/trabalho?lista='+LIST+'&tarefa='+TASK);
 });
 it('motivo nunca entra em storage; recarga404 mantém pedido incerto e não reconstrói POST',async()=>{
  const u=userEvent.setup();const view=montar();await preencher(u);post.mockRejectedValueOnce(Error('Resposta perdida QA'));await u.click(screen.getByRole('button',{name:'Aprovar condições comerciais'}));await screen.findByText('Resposta perdida QA');const id=post.mock.calls[0][1].requestId;const key=chavePonte({orgId:ORG,userId:USER},TX),raw=localStorage.getItem(key)!;
  expect(JSON.parse(raw)).toEqual({orgId:ORG,userId:USER,entityId:TX,action:'decisao',requestId:id});expect(raw).not.toContain('Motivo privado');expect(raw).not.toContain(HASH);view.unmount();get.mockImplementation(async(path:string)=>{if(path.includes('/pedidos/'))throw Object.assign(Error('404 QA'),{status:404});return resposta();});montar();await screen.findByText(/Pedido ainda sem confirmação/);expect(post).toHaveBeenCalledOnce();expect(screen.queryByLabelText('Motivo da decisão comercial')).not.toBeInTheDocument();
 });
 it('recarga recupera decisão confirmada sem reexecutar',async()=>{
  localStorage.setItem(chavePonte({orgId:ORG,userId:USER},TX),JSON.stringify({orgId:ORG,userId:USER,entityId:TX,action:'decisao',requestId:REQUEST}));state.obrigacao!.approvalStatus='rejeitado';state.obrigacao!.canDecide=false;state.obrigacao!.decisao={id:REQUEST,atorId:USER,aprovar:false,motivo:'Decisão sintética original',alcada:'titular',decididaEm:NOW};state.replayed=true;montar();expect(await screen.findByText('Pedido confirmado pelo servidor. Nenhum efeito foi repetido.')).toBeInTheDocument();expect(screen.getByRole('heading',{name:'Condições rejeitadas'})).toBeInTheDocument();expect(get.mock.calls.some(([path])=>path===PATH+'/pedidos/'+REQUEST)).toBe(true);expect(post).not.toHaveBeenCalled();
 });
 it.each([401,403])('recusa %s retira condições e motivo privados',async(status)=>{
  const u=userEvent.setup();montar();await preencher(u);post.mockRejectedValueOnce(Object.assign(Error('Acesso recusado QA'),{status}));await u.click(screen.getByRole('button',{name:'Aprovar condições comerciais'}));await screen.findByText('Acesso recusado QA');expect(screen.queryByRole('heading',{name:'Obrigação comercial privada QA'})).not.toBeInTheDocument();expect(screen.queryByLabelText('Motivo da decisão comercial')).not.toBeInTheDocument();expect(post).toHaveBeenCalledOnce();
 });
 it('conflito409 mantém pedido original e não emite outra decisão',async()=>{
  const u=userEvent.setup();montar();await preencher(u);post.mockRejectedValueOnce(Object.assign(Error('Versão alterada QA'),{status:409}));await u.click(screen.getByRole('button',{name:'Aprovar condições comerciais'}));await screen.findByText('Versão alterada QA');expect(screen.getByRole('button',{name:'Aprovar condições comerciais'})).toBeDisabled();expect(post).toHaveBeenCalledOnce();
 });
 it('parâmetro comercial seleciona somente a rota própria e sem parâmetro preserva F08',async()=>{
  const view=render(<ObrigacaoPage/>);await screen.findByRole('heading',{name:'Obrigação comercial privada QA'});expect(get).toHaveBeenCalledWith(PATH,'qa-sessao');view.unmount();get.mockReset();get.mockImplementation(()=>new Promise(()=>{}));origem='';render(<ObrigacaoPage/>);await waitFor(()=>expect(get).toHaveBeenCalledWith('/finance/exercicio/obrigacoes/'+TX,'qa-sessao'));expect(get.mock.calls.some(([path])=>path===PATH)).toBe(false);
 });
});
describe('APR comercial aditivo',()=>{
 const row={id:TX,tipo:'entrada',description:'Registro comercial QA',partnerName:null,chartCodigo:null,amount:1500,dueDate:NOW,status:'previsto',approvalStatus:'aguardando',vencido:false,diasAtraso:0};
 function lista(items:object[]){return{items,total:items.length,totals:{aPagar:0,aReceber:1500,vencidoPagar:0,vencidoReceber:0,aguardandoAprovacao:1},approvalLimit:5000};}
 it('leitor abre comercial sem criar coluna extra nem ações genéricas',async()=>{
  permissions=['financeiro.ver'];get.mockImplementation((path:string)=>path==='/finance/payables'?Promise.resolve(lista([{...row,exercicioComercial:true,exercicioComercialHref:PATH}])):new Promise(()=>{}));render(<FinanceiroPage/>);await userEvent.setup().click(screen.getByRole('button',{name:'A Pagar/Receber'}));const link=await screen.findByRole('link',{name:'Conferir obrigação comercial'});expect(link.closest('tr')!.querySelectorAll('td')).toHaveLength(7);expect(within(link.closest('tr')!).queryByRole('button')).not.toBeInTheDocument();
 });
 it('flag comercial abre rota própria e preserva link F08 ao lado, sem ações genéricas',async()=>{
  get.mockImplementation((path:string)=>path==='/finance/payables'?Promise.resolve(lista([{...row,exercicioComercial:true,exercicioComercialHref:PATH},{...row,id:CAT,description:'Registro F08 QA',exercicioFinanceiro:true}])):new Promise(()=>{}));render(<FinanceiroPage/>);await userEvent.setup().click(screen.getByRole('button',{name:'A Pagar/Receber'}));
  const link=await screen.findByRole('link',{name:'Conferir obrigação comercial'});expect(link).toHaveAttribute('href','/financeiro/obrigacoes/'+TX+'?origem=comercial');expect(within(link.closest('tr')!).queryByRole('button',{name:/Aprovar|Rejeitar|Baixar/})).not.toBeInTheDocument();expect(screen.getByRole('link',{name:'Conferir obrigação'})).toHaveAttribute('href','/financeiro/obrigacoes/'+CAT);expect(post).not.toHaveBeenCalled();expect(patch).not.toHaveBeenCalled();
 });
 it('flag comercial com href divergente permanece fechado e não cai em ações genéricas',async()=>{
  get.mockImplementation((path:string)=>path==='/finance/payables'?Promise.resolve(lista([{...row,exercicioComercial:true,exercicioComercialHref:'/finance/exercicio/obrigacoes/'+TX}])):new Promise(()=>{}));render(<FinanceiroPage/>);await userEvent.setup().click(screen.getByRole('button',{name:'A Pagar/Receber'}));await screen.findByText('Vínculo comercial indisponível');expect(screen.queryByRole('button',{name:'Aprovar'})).not.toBeInTheDocument();expect(screen.queryByRole('link',{name:'Conferir obrigação comercial'})).not.toBeInTheDocument();
 });
});
