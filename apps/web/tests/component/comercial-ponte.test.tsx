import { webcrypto } from 'node:crypto';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PonteResposta, PonteCatalogos, ComercialPropostaExercicioDto, ComercialAceiteExercicioDto } from '@mktos/shared';
const get=vi.fn(),post=vi.fn();
let pessoa='11111111-1111-4111-8111-111111111111',token='qa-sessao-a';
const ORG='22222222-2222-4222-8222-222222222222',LEAD='33333333-3333-4333-8333-333333333333',PROP='44444444-4444-4444-8444-444444444444',ACE='55555555-5555-4555-8555-555555555555',PROJECT='66666666-6666-4666-8666-666666666666',TASK='77777777-7777-4777-8777-777777777777',LIST='88888888-8888-4888-8888-888888888888',STATUS='99999999-9999-4999-8999-999999999999',TX='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',VERSION='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',CAT='cccccccc-cccc-4ccc-8ccc-cccccccccccc',REQUEST='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NOW='2026-10-08T12:00:00.000Z',HASH='a'.repeat(64),BASE='/leads/'+LEAD+'/exercicio';
vi.mock('@/lib/api',async()=>({...await vi.importActual<typeof import('@/lib/api')>('@/lib/api'),apiGet:(...a:unknown[])=>get(...a),apiPost:(...a:unknown[])=>post(...a)}));
vi.mock('@/lib/auth',()=>({useAuth:()=>({token,user:{id:pessoa},can:()=>true})}));
import { PonteComercial } from '@/app/leads/PonteComercial';
import { ComercialExercicio } from '@/app/leads/ComercialExercicio';
import { OrigemComercialDaTarefa } from '@/app/leads/OrigemComercialDaTarefa';
import { chavePonte } from '@/app/leads/pedido-ponte';
const proposta:ComercialPropostaExercicioDto={id:PROP,versao:1,documento:{titulo:'Proposta QA',corpo:'Documento sintético do exercício.',hash:HASH},condicoes:{valorCanonico:'BRL 1500.00',inicio:null,prazo:null,periodicidade:null},condicoesHash:'b'.repeat(64),registradaEm:NOW,atorId:pessoa};
const aceite:ComercialAceiteExercicioDto={id:ACE,propostaId:PROP,propostaVersao:1,condicoesHash:'b'.repeat(64),evidencia:{tipo:'exercicio',texto:'Evidência sintética do exercício.'},alcada:{minima:'responsavel',verificada:'responsavel'},registradaEm:NOW,atorId:pessoa};
const origem={leadId:LEAD,aceiteId:ACE,propostaId:PROP,propostaVersao:1,documentoHash:HASH,condicoesHash:'b'.repeat(64)};
function resposta(projeto=false,obrigacao=false):PonteResposta {
 const config={listId:LIST,statusId:STATUS,title:'Projeto QA privado',assigneeUserId:null};
 return {modo:'exercicio',requestId:REQUEST,replayed:false,escopo:{orgId:ORG,userId:pessoa},
 projeto:projeto?{id:PROJECT,taskId:TASK,origem,configuracaoOriginal:config,atual:{...config,archived:false},criadaEm:NOW}:null,
 obrigacao:obrigacao?{id:REQUEST,transactionId:TX,versionId:VERSION,contentHash:HASH,expectedUpdatedAt:NOW,snapshot:{schemaVersion:1,modo:'exercicio',origem,projectId:PROJECT,taskId:TASK,transactionId:TX,condicoes:{tipo:'entrada',descricao:'Obrigação QA privada',valorCanonico:'BRL 1500.00',currency:'BRL',competencia:NOW,vencimento:NOW,accountId:CAT,partnerId:CAT,chartAccountId:CAT,projetoFinanceiroId:null,departamentoId:null,contractId:null,temRateio:false}},status:'previsto',approvalStatus:'aguardando',paidAt:null,reconciledAt:null,decisao:null,canDecide:true,impedimento:null}:null,
 financeiro:{situacao:obrigacao?'registrado':'pendente',pendencias:obrigacao?[]:['Identificar conta e datas.']},capacidades:{podeCriarProjeto:true,podeRegistrarObrigacao:projeto&&!obrigacao,podeDecidir:obrigacao},efeitos:{tarefaCriada:false,projetoCriado:false,obrigacaoCriada:false,decisaoRegistrada:false,pagamentoExecutado:false,cobrancaExecutada:false,conciliacaoExecutada:false}};
}
const catalogos=():PonteCatalogos=>({modo:'exercicio',escopo:{orgId:ORG,userId:pessoa},listas:[{id:LIST,nome:'Lista QA',etapas:[{id:STATUS,nome:'Etapa QA'}]}],responsaveis:[],financeiro:{contas:[{id:CAT,nome:'Conta manual QA',currency:'BRL'}],contrapartes:[{id:CAT,nome:'Contraparte QA'}],classificacoes:[{id:CAT,nome:'Serviço QA',codigo:'3.1'}],projetos:[],departamentos:[]}});
let state:PonteResposta;
beforeEach(()=>{
 vi.stubGlobal('crypto',webcrypto);localStorage.clear();get.mockReset();post.mockReset();pessoa='11111111-1111-4111-8111-111111111111';token='qa-sessao-a';state=resposta();
 get.mockImplementation(async(path:string)=>path.endsWith('/catalogos')?catalogos():structuredClone(state));
 post.mockImplementation(async(path:string,body:Record<string,unknown>)=>{
  state=resposta(true,path.endsWith('/obrigacao'));state.requestId=String(body.requestId);
  if(state.projeto&&!path.endsWith('/obrigacao')){state.projeto.configuracaoOriginal.title=String(body.title);state.projeto.atual.title=String(body.title);}
  if(state.obrigacao){const c=state.obrigacao.snapshot.condicoes;c.descricao=String(body.descricao);c.competencia=String(body.competencia);c.vencimento=String(body.vencimento);}
  return structuredClone(state);
 });
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function montar(){const perdido=vi.fn();return{...render(<PonteComercial leadId={LEAD} proposta={proposta} aceite={aceite} onIndisponivel={perdido}/>),perdido};}
async function preencherProjeto(u:ReturnType<typeof userEvent.setup>){
 await screen.findByRole('option',{name:'Lista QA'});await u.selectOptions(screen.getByLabelText('Lista do projeto'),LIST);await u.selectOptions(screen.getByLabelText('Etapa inicial do projeto'),STATUS);await u.type(screen.getByLabelText('Título do projeto'),'Projeto QA privado');
}
describe('ponte comercial com API simulada',()=>{
 it.each(['confirmado','loading','404','storage'])('ponte %s não reabre criação de entrega v1',async(modo)=>{
  const comercial={modo:'exercicio',lead:{id:LEAD,nome:'Oportunidade QA',ownerId:pessoa,status:'ganho',nextAction:null,updatedAt:NOW},origem:{tipo:'manual',ref:REQUEST},propostas:[proposta],versaoAtual:1,aceites:[aceite],entregas:[],financeiro:{situacao:'pendente',pendencias:['Pendência antiga QA']},podeAceitar:true,podeEntregar:true};
  if(modo==='storage')vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('Storage QA');});
  get.mockImplementation((path:string)=>{
   if(path===BASE)return Promise.resolve(structuredClone(comercial));
   if(path.endsWith('/catalogos'))return Promise.resolve(catalogos());
   if(modo==='loading')return new Promise(()=>{});
   if(modo==='404')return Promise.reject(Object.assign(Error('Ponte indisponível QA'),{status:404}));
   return Promise.resolve(resposta(modo==='confirmado'));
  });
  render(<ComercialExercicio leadId={LEAD} onChanged={vi.fn()} onIndisponivel={vi.fn()}/>);
  if(modo==='404')await screen.findByText('Oportunidade de exercício indisponível para esta conta.');
  else await screen.findByText('Documento sintético do exercício.');
  if(modo==='confirmado')await screen.findByRole('link',{name:/Abrir tarefa do projeto/});
  if(modo==='storage')await screen.findByText(/armazenamento do navegador está indisponível/);
  expect(screen.queryByRole('button',{name:'Abrir entrega de exercício'})).not.toBeInTheDocument();expect(post).not.toHaveBeenCalled();
 });
 it('retorno de origem sidecar usa o DTO do servidor e mostra navegação Comercial no Trabalho',async()=>{
  get.mockResolvedValueOnce({modo:'exercicio',leadId:LEAD,leadNome:'Origem sidecar QA',propostaVersao:1,aceiteId:ACE});render(<OrigemComercialDaTarefa taskId={TASK}/>);
  expect(await screen.findByRole('link',{name:'Origem sidecar QA · proposta v1'})).toHaveAttribute('href','/leads/'+LEAD);expect(get).toHaveBeenCalledWith('/leads/exercicio/entregas/'+TASK,'qa-sessao-a');expect(post).not.toHaveBeenCalled();
 });
 it('projeto exige destino e etapa explícitos e envia fonte exata',async()=>{
  const u=userEvent.setup();montar();await preencherProjeto(u);await u.click(screen.getByRole('button',{name:'Criar projeto de exercício'}));
  expect(await screen.findByRole('link',{name:/Abrir tarefa do projeto/})).toHaveAttribute('href','/trabalho?lista='+LIST+'&tarefa='+TASK);
  expect(post).toHaveBeenCalledOnce();expect(post.mock.calls[0][0]).toBe(BASE+'/projeto');expect(post.mock.calls[0][1]).toMatchObject({aceiteId:ACE,propostaId:PROP,expectedPropostaVersion:1,documentoHash:HASH,condicoesHash:'b'.repeat(64),listId:LIST,statusId:STATUS,title:'Projeto QA privado',assigneeUserId:null});
 });
 it('resposta perdida preserva só identificadores e recovery GET404 não libera outro POST',async()=>{
  const u=userEvent.setup();montar();await preencherProjeto(u);post.mockRejectedValueOnce(Error('Resposta perdida QA'));await u.click(screen.getByRole('button',{name:'Criar projeto de exercício'}));
  await screen.findByText('Resposta perdida QA');const p=post.mock.calls[0][1];const raw=localStorage.getItem(chavePonte({orgId:ORG,userId:pessoa},LEAD))!;
  expect(JSON.parse(raw)).toEqual({orgId:ORG,userId:pessoa,entityId:LEAD,action:'projeto',requestId:p.requestId});expect(raw).not.toContain('Projeto QA privado');expect(raw).not.toContain(HASH);
  get.mockRejectedValueOnce(Object.assign(Error('Não encontrado QA'),{status:404}));await u.click(screen.getByRole('button',{name:'Conferir pedido da ponte'}));
  await screen.findByText(/Pedido ainda sem confirmação/);expect(post).toHaveBeenCalledOnce();expect(screen.queryByRole('button',{name:'Criar projeto de exercício'})).not.toBeInTheDocument();expect(get.mock.calls.at(-1)?.[0]).toBe(BASE+'/ponte/pedidos/'+p.requestId);
 });
 it('remontagem recupera resultado original sem reconstruir o POST',async()=>{
  const u=userEvent.setup();const view=montar();await preencherProjeto(u);post.mockRejectedValueOnce(Error('Resposta perdida QA'));await u.click(screen.getByRole('button',{name:'Criar projeto de exercício'}));await screen.findByText('Resposta perdida QA');const id=post.mock.calls[0][1].requestId;
  view.unmount();state=resposta(true);state.requestId=id;state.replayed=true;montar();
  expect(await screen.findByText('Pedido confirmado pelo servidor. Nenhum efeito foi repetido.')).toBeInTheDocument();expect(post).toHaveBeenCalledOnce();expect(get.mock.calls.some(([path])=>path===BASE+'/ponte/pedidos/'+id)).toBe(true);
 });
 it('remontagem com pedido404 conserva incerteza e zero novo POST',async()=>{
  localStorage.setItem(chavePonte({orgId:ORG,userId:pessoa},LEAD),JSON.stringify({orgId:ORG,userId:pessoa,entityId:LEAD,action:'projeto',requestId:REQUEST}));
  get.mockImplementation(async(path:string)=>{if(path.includes('/pedidos/'))throw Object.assign(Error('404 QA'),{status:404});return path.endsWith('/catalogos')?catalogos():resposta();});
  montar();await screen.findByText(/Pedido ainda sem confirmação/);expect(post).not.toHaveBeenCalled();expect(localStorage.getItem(chavePonte({orgId:ORG,userId:pessoa},LEAD))).toContain(REQUEST);
 });
 it('GET de storage recusado bloqueia a montagem e nenhuma nova intenção é enviada',async()=>{
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('Storage recusado QA');});montar();await screen.findByText(/armazenamento do navegador está indisponível/);expect(screen.queryByRole('button',{name:'Criar projeto de exercício'})).not.toBeInTheDocument();expect(post).not.toHaveBeenCalled();
 });
 it('quota de storage impede POST antes de qualquer efeito',async()=>{
  const u=userEvent.setup();montar();await preencherProjeto(u);vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('Quota QA');});await u.click(screen.getByRole('button',{name:'Criar projeto de exercício'}));await screen.findByText(/pedido não foi enviado/);expect(post).not.toHaveBeenCalled();
 });
 it('resposta de outra empresa não confirma o pedido nem revela seu projeto',async()=>{
  const u=userEvent.setup();montar();await preencherProjeto(u);post.mockImplementationOnce(async(_path,body)=>{const r=resposta(true);r.requestId=body.requestId;r.escopo.orgId=CAT;r.projeto!.atual.title='Conteúdo privado de outra empresa';return r;});await u.click(screen.getByRole('button',{name:'Criar projeto de exercício'}));await screen.findByText(/não confirma este pedido e seu escopo/);expect(screen.queryByText(/Conteúdo privado de outra empresa/)).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Criar projeto de exercício'})).toBeDisabled();
 });
 it('catálogos de outra empresa não habilitam destinos',async()=>{
  get.mockImplementation(async(path:string)=>{if(path.endsWith('/catalogos')){const c=catalogos();c.escopo.orgId=CAT;return c;}return resposta();});montar();await screen.findByText('Catálogos sem escopo confirmado.');expect(screen.getByRole('button',{name:'Criar projeto de exercício'})).toBeDisabled();expect(post).not.toHaveBeenCalled();
 });
 it.each([403,409])('recusa %s fica legível e não reenvia pedido',async(status)=>{
  const u=userEvent.setup();const view=montar();await preencherProjeto(u);post.mockRejectedValueOnce(Object.assign(Error('Pedido recusado QA'),{status}));await u.click(screen.getByRole('button',{name:'Criar projeto de exercício'}));await screen.findByText('Pedido recusado QA');expect(post).toHaveBeenCalledOnce();if(status===403){expect(view.perdido).toHaveBeenCalledOnce();expect(screen.queryByLabelText('Título do projeto')).not.toBeInTheDocument();}else expect(screen.getByRole('button',{name:'Criar projeto de exercício'})).toBeDisabled();
 });
 it('obrigação usa seleções explícitas, valor integral e datas informadas',async()=>{
  state=resposta(true);const u=userEvent.setup();montar();await screen.findByRole('option',{name:'Conta manual QA · BRL'});
  await u.selectOptions(screen.getByLabelText('Contraparte da obrigação'),CAT);await u.selectOptions(screen.getByLabelText('Conta manual da obrigação'),CAT);await u.selectOptions(screen.getByLabelText('Classificação da obrigação'),CAT);await u.type(screen.getByLabelText('Descrição da obrigação'),'Obrigação QA privada');
  const {fireEvent}=await import('@testing-library/react');fireEvent.change(screen.getByLabelText('Competência da obrigação'),{target:{value:'2026-10-08'}});fireEvent.change(screen.getByLabelText('Vencimento da obrigação'),{target:{value:'2026-10-20'}});
  await u.click(screen.getByLabelText('Confirmo a obrigação de exercício com estas condições.'));await u.click(screen.getByRole('button',{name:'Registrar obrigação comercial de exercício'}));
  expect(await screen.findByRole('link',{name:'Conferir obrigação comercial'})).toHaveAttribute('href','/financeiro/obrigacoes/'+TX+'?origem=comercial');expect(post.mock.calls[0][0]).toBe(BASE+'/projetos/'+PROJECT+'/obrigacao');expect(post.mock.calls[0][1]).toMatchObject({accountId:CAT,partnerId:CAT,chartAccountId:CAT,valorCanonico:'BRL 1500.00',competencia:'2026-10-08T12:00:00.000Z',vencimento:'2026-10-20T12:00:00.000Z',projetoFinanceiroId:null,departamentoId:null,confirmacaoExercicio:true});
 });
 it('resposta antiga não reaparece após troca de pessoa/token',async()=>{
  let resolver!:(v:PonteResposta)=>void;get.mockImplementationOnce(()=>new Promise<PonteResposta>(r=>{resolver=r;}));const view=montar();const antiga=resposta(true);pessoa=CAT;token='qa-sessao-b';state=resposta();view.rerender(<PonteComercial leadId={LEAD} proposta={proposta} aceite={aceite} onIndisponivel={vi.fn()}/>);await screen.findByRole('option',{name:'Lista QA'});await act(async()=>resolver(antiga));expect(screen.queryByRole('link',{name:/Abrir tarefa do projeto/})).not.toBeInTheDocument();expect(post).not.toHaveBeenCalled();
 });
});
