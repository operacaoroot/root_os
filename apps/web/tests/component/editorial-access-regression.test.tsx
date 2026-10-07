import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EditorialPanel } from '../../src/app/pauta/producao/EditorialPanel';
import { ErroDaApi } from '../../src/lib/api';
const {get,post}=vi.hoisted(()=>({get:vi.fn(),post:vi.fn()}));
vi.mock('../../src/lib/api',async(importOriginal)=>{const actual=await importOriginal<typeof import('../../src/lib/api')>();return {...actual,apiGet:get,apiPost:post};});
const task='qa-task',user='qa-approver',token='qa-only';
const v1={id:'qa-v1',number:1,title:'Histórico QA um',body:'Texto histórico visto pelo aprovador',files:[],sourceRef:'fixture v1',contentHash:'a'.repeat(64),actorId:'qa-author',createdAt:'2026-10-07T12:00:00Z'};
const v2={...v1,id:'qa-v2',number:2,title:'Selecionada QA dois',body:'Texto corrente diferente que não está sendo exibido',sourceRef:'fixture v2',contentHash:'b'.repeat(64)};
const data={task:{id:task,title:'QA revisão',description:'Texto próprio',externalId:null,statusId:'release',statusName:'QA liberação',archived:false,statuses:[{id:'release',name:'QA liberação'}]},material:{id:'qa-material',title:'QA material',selectedVersionId:v2.id,releaseStatusId:'release',revision:2},versions:[v2,v1],decisions:[],productions:[],canDecide:true};
beforeEach(()=>{get.mockReset();post.mockReset();localStorage.clear();get.mockResolvedValue(data);post.mockResolvedValue({});});
describe('Editorial: decisões sobre a versão mostrada e sessão expirada',()=>{
 it('aprovação permanece bloqueada enquanto o corpo mostrado é uma versão histórica',async()=>{
  render(<EditorialPanel token={token} userId={user} taskId={task} initialVersionId={v1.id}/>);await screen.findByText(v1.body);fireEvent.change(screen.getByLabelText('Motivo da decisão'),{target:{value:'Conferi este texto mostrado'}});expect(screen.getByRole('button',{name:'Aprovar conteúdo exato'})).toBeDisabled();expect(post).not.toHaveBeenCalled();
 });
 it('HTTP401 da escrita remove conteúdo e pedido privado em cache',async()=>{
  render(<EditorialPanel token={token} userId={user} taskId={task}/>);await screen.findByText(v2.body);fireEvent.change(screen.getByLabelText('Motivo da decisão'),{target:{value:'Aprovação própria QA'}});post.mockRejectedValueOnce(new ErroDaApi('Sessão expirada na revisão',401));fireEvent.click(screen.getByRole('button',{name:'Aprovar conteúdo exato'}));await screen.findByText('Sessão expirada na revisão');expect(screen.queryByText(v2.body)).not.toBeInTheDocument();expect(localStorage.getItem('rootos.editorial:'+user+':'+task)).toBeNull();
 });
});
