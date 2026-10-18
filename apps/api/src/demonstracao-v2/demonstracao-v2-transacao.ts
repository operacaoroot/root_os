import { Prisma, RiskLevel, type ContextItem, type ContextItemVersion } from '@prisma/client';
import { z } from 'zod';
import { DemonstracaoSinteticaReciboSchema, DemonstracaoSinteticaResultadoSchema,
  TrabEspacoCreateSchema, TrabListaCreateSchema, CreateFinanceAccountSchema, CreateChartAccountSchema,
  CreatePartnerSchema, CreateContractSchema, ComercialEntradaExercicioSchema,
  type DemonstracaoSinteticaManifesto, type DemonstracaoSinteticaFontes,
  type DemonstracaoSinteticaRecibo, type DemonstracaoSinteticaResultado } from '@mktos/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { exigirAcessoAtual, podeLerFonte } from '../memory/acesso-memoria';
import { hashDoCorpo, chaveDaVault } from '../memory/procedencia';
import { normalizarPedidoDeContexto, fingerprintDeContexto } from '../memory/contexto-trabalho.service';
import { validarProcedimento } from '../agents/sop';
import { CriarProcedimentoSchema } from '../agents/procedimento-do-agente.service';
import { EditorialCreateSchema, editorialContentHash, editorialFingerprint } from '../pauta/editorial-contrato';
import { leadIdDaEntrada } from '../leads/entrada-de-lead';
import { idComercial, hashComercial } from '../leads/comercial-exercicio.service';
import { temPapelDeMaquina } from '../approvals/alcada';
import { exigir, MANIFESTO_SHA, ORG_ID, ACTOR_ID, canonico, hashCanonico, sha256, idInterno, inputFingerprint, sourceHash,
  type DestinoDemo } from './demonstracao-v2-manifesto';

type Tx = Prisma.TransactionClient;
type M = DemonstracaoSinteticaManifesto;
type Fontes = DemonstracaoSinteticaFontes;
type Objeto = DemonstracaoSinteticaRecibo['objects'][number];
const PERMISSOES = ['obsidian.ver', 'tarefas.ver', 'tarefas.editar', 'pauta.ver', 'pauta.editar',
  'leads.editar', 'financeiro.ver', 'financeiro.editar', 'automacoes.executar', 'admin.usuarios'];
const MODULOS = ['leads', 'trabalho', 'pauta', 'financeiro'];
const metadataSchema = z.object({ title: z.string(), kind: z.string(), tags: z.array(z.string()),
  validFrom: z.string().nullable(), validUntil: z.string().nullable(), sourceRef: z.string() }).strict();

async function travar(tx: Tx, m: M): Promise<void> {
  for (const k of [`demo-installation:${m.orgId}`, `demo-installation:${m.orgId}:${m.dataset}`,
    `obsidian-index:${m.orgId}`, `memoria:${m.orgId}`, `work-arvore:${m.orgId}`])
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${k}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'editorial:' + m.orgId},0))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'comercial-exercicio:' + m.orgId}))`;
}

/** Somente concessões cujas linhas foram travadas podem satisfazer o gate. */
export async function travarAutoridadeDaDemonstracao(tx: Tx, opcoes: { captura?: true } = {}): Promise<void> {
  const m = { orgId: ORG_ID, actorId: ACTOR_ID };
  const exigidas = opcoes.captura ? [...PERMISSOES, 'obsidian.editar'] : PERMISSOES;
  const orgs = await tx.$queryRaw<Array<{ id: string; modulos: string[] }>>`
    SELECT id,modulos FROM "Org" WHERE id=${m.orgId} AND "isActive" FOR SHARE`;
  exigir(orgs.length === 1 && MODULOS.every((k) => orgs[0].modulos.includes(k)), 'demo_modulo_indisponivel');
  const pessoas = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "User" WHERE id=${m.actorId} AND "orgId"=${m.orgId} AND "isActive" ORDER BY id FOR SHARE`;
  exigir(pessoas.length === 1, 'demo_pessoa_indisponivel');
  const ur = await tx.$queryRaw<Array<{ a: string; b: string }>>`
    SELECT ur."A" a,ur."B" b FROM "_UserRoles" ur JOIN "Role" r ON r.id=ur."A"
    WHERE ur."B"=${m.actorId} AND r."orgId"=${m.orgId} ORDER BY ur."A",ur."B" FOR SHARE OF ur`;
  const roleIds = [...new Set(ur.map((r) => r.a))].sort();
  exigir(roleIds.length > 0, 'demo_acesso_insuficiente');
  const roles = await tx.$queryRaw<Array<{ id: string; key: string }>>`
    SELECT id,key FROM "Role" WHERE "orgId"=${m.orgId} AND id IN (${Prisma.join(roleIds)}) ORDER BY id FOR SHARE`;
  exigir(roles.length === roleIds.length && !temPapelDeMaquina(roles.map((r) => r.key)), 'demo_papel_indisponivel');
  const rp = await tx.$queryRaw<Array<{ a: string; b: string }>>`
    SELECT rp."A" a,rp."B" b FROM "_RolePermissions" rp
    WHERE rp."B" IN (${Prisma.join(roleIds)}) ORDER BY rp."B",rp."A" FOR SHARE OF rp`;
  const permissionIds = [...new Set(rp.map((p) => p.a))].sort();
  exigir(permissionIds.length > 0, 'demo_acesso_insuficiente');
  const permissions = await tx.$queryRaw<Array<{ id: string; key: string }>>`
    SELECT id,key FROM "Permission" WHERE id IN (${Prisma.join(permissionIds)}) ORDER BY id FOR SHARE`;
  const keys = new Set(permissions.map((p) => p.key));
  exigir(permissions.length === permissionIds.length && exigidas.every((p) => keys.has(p)), 'demo_acesso_insuficiente');
  await reconferirAutoridade(tx, m, opcoes);
}
async function reconferirAutoridade(tx: Tx, m: Pick<M, 'orgId' | 'actorId'>, opcoes: { captura?: true } = {}): Promise<void> {
  await exigirAcessoAtual(tx, m.orgId, m.actorId, opcoes.captura ? [...PERMISSOES, 'obsidian.editar'] : PERMISSOES);
  const org = await tx.org.findUnique({ where: { id: m.orgId }, select: { modulos: true, isActive: true } });
  const user = await tx.user.findFirst({ where: { id: m.actorId, orgId: m.orgId, isActive: true },
    select: { roles: { where: { orgId: m.orgId }, select: { key: true } } } });
  exigir(org && org.isActive && MODULOS.every((k) => org.modulos.includes(k)) && user
    && !temPapelDeMaquina(user.roles.map((r) => r.key)), 'demo_autoridade_alterada');
}
type Fonte = { binding: Fontes['bindings'][number]; item: ContextItem; version: ContextItemVersion };
async function conferirFontes(tx: Tx, m: M, f: Fontes, novo: boolean): Promise<Fonte[]> {
  exigir(f.orgId === m.orgId && f.dataset === m.dataset
    && f.assetManifestHash === hashCanonico(m.assets), 'demo_fonte_escopo_divergente');
  await tx.$queryRaw`SELECT id FROM "ContextCollectionSelection" WHERE id=${f.selectionId} AND "orgId"=${m.orgId} FOR SHARE`;
  const selection = await tx.contextCollectionSelection.findFirst({ where: { id: f.selectionId, orgId: m.orgId } });
  exigir(selection && selection.collectionId === f.collectionId && selection.generation.toString() === f.generation
    && selection.sourceKind === 'vault_pasta' && selection.estado === 'projetado'
    && selection.verificadaEm && selection.membershipDigest === f.membershipDigest, 'demo_captura_indisponivel');
  const marca = z.object({ repositorioId: z.string(), head: z.string(), indiceHash: z.string(),
    indiceModificadoEm: z.number() }).strict();
  const antes = marca.parse(selection.marcaAntes), depois = marca.parse(selection.marcaDepois);
  exigir(antes.head === f.gitCommit && canonico(antes) === canonico(depois), 'demo_captura_divergente');
  if (novo) {
    const latest = await tx.contextCollectionSelection.findFirst({ where: { orgId: m.orgId, collectionId: f.collectionId },
      orderBy: { generation: 'desc' }, select: { id: true } });
    exigir(latest?.id === f.selectionId, 'demo_captura_alterada');
  }
  await tx.$queryRaw`SELECT id FROM "ContextCollectionMember" WHERE "selectionId"=${f.selectionId}
    AND "orgId"=${m.orgId} ORDER BY id FOR SHARE`;
  const members = await tx.contextCollectionMember.findMany({ where: { orgId: m.orgId, selectionId: f.selectionId } });
  exigir(members.length === 3, 'demo_captura_nao_sintetica');
  const digest = sha256(JSON.stringify([...members].sort((a,b) => Buffer.compare(Buffer.from(a.caminhoBytes),Buffer.from(b.caminhoBytes)))
    .map((r) => ({ chave: r.chave, caminhoBytes: Buffer.from(r.caminhoBytes).toString('hex'), blobGit: r.blobGit,
      hashArquivo: r.hashArquivo, contentHash: r.contentHash, metadataHash: r.metadataHash }))));
  exigir(digest === f.membershipDigest, 'demo_captura_hash_divergente');
  const sources: Fonte[] = [];
  for (const b of [...f.bindings].sort((a,b) => a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0)) {
    const asset = m.assets.find((a) => a.key === b.key), member = members.find((r) => r.id === b.memberId);
    exigir(asset && member && b.path === asset.path && b.hashArquivo === asset.sha256
      && member.hashArquivo === asset.sha256 && member.blobGit === b.blobGit
      && Buffer.from(member.caminhoBytes).equals(Buffer.from(asset.path)) && member.chave === chaveDaVault(asset.path)
      && member.estado === 'projetado' && member.itemId === b.itemId && member.versionId === b.versionId
      && member.versao === b.versao && member.contentHash === b.contentHash && member.metadataHash === b.metadataHash,
    'demo_associacao_divergente');
    await tx.$queryRaw`SELECT id FROM "ContextItem" WHERE id=${b.notaId} AND "orgId"=${m.orgId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "ContextItemVersion" WHERE id=${b.versionId} AND "orgId"=${m.orgId} ORDER BY id FOR SHARE`;
    const item = await tx.contextItem.findFirst({ where: { id: b.notaId, orgId: m.orgId } });
    const v = await tx.contextItemVersion.findFirst({ where: { id: b.versionId, orgId: m.orgId, itemId: b.notaId } });
    exigir(item && v && podeLerFonte(item,m.actorId) && v.itemId === b.itemId && item.id === b.itemId,
      'demo_fonte_indisponivel');
    const meta = metadataSchema.parse(member.metadata);
    const metaHash = sha256(JSON.stringify({ title: meta.title, kind: meta.kind, tags: [...meta.tags].sort(),
      validFrom: meta.validFrom, validUntil: meta.validUntil, sourceRef: meta.sourceRef }));
    const tags = b.key === 'nota-aviso' ? ['demo-sintetico']
      : ['demo-sintetico', b.key === 'nota-conteudo' ? 'area:conteudo' : 'area:financeiro'];
    exigir(metaHash === member.metadataHash && canonico([...meta.tags].sort()) === canonico(tags.sort())
      && meta.kind === 'nota' && meta.sourceRef === asset.path && meta.validFrom === null && meta.validUntil === null
      && v.title === meta.title && v.kind === meta.kind && v.sourceRef === meta.sourceRef
      && v.sourceType === 'vault' && v.versao === b.versao && v.contentHash === b.contentHash && hashDoCorpo(v.body) === b.contentHash,
    'demo_fonte_integridade_divergente');
    if (novo) exigir(!item.arquivadoEm && item.versao === b.expectedItemVersion && item.versao === v.versao
      && item.contentHash === v.contentHash && item.body === v.body && item.title === v.title
      && item.sourceType === v.sourceType && item.sourceRef === v.sourceRef
      && canonico([...item.tags].sort()) === canonico([...meta.tags].sort())
      && item.validFrom === null && item.validUntil === null,
    'demo_fonte_alterada');
    sources.push({ binding: b, item, version: v });
  }
  return sources;
}

function objeto(m: M, key: Objeto['key']) {
  const o = m.objects.find((o) => o.key === key); exigir(o,'demo_manifesto_incompleto'); return o;
}
function ids(m: M) {
  const o = (key: Objeto['key']) => objeto(m,key).logicalId;
  const requestId = objeto(m,'oportunidade').requestId;
  exigir(requestId, 'demo_pedido_ausente');
  return { space: o('espaco'), list: o('lista'), task: o('tarefa'), agent: o('agente'), material: o('material'),
    account: o('conta'), chart: o('classificacao'), partner: o('contraparte'), contract: o('contrato'),
    open: idInterno(m,'status-open'), doing: idInterno(m,'status-doing'), closed: idInterno(m,'status-closed'),
    link: idInterno(m,'work-source'), sop: idInterno(m,'sop'), editorialVersion: idInterno(m,'editorial-version'),
    lead: leadIdDaEntrada(m.orgId,{ tipo: 'manual', ref: o('oportunidade') }),
    event: idComercial([m.orgId,'comercial-exercicio-v1',requestId]) };
}
function conferirObjetosDoRecibo(m: M, receipt: DemonstracaoSinteticaRecibo): void {
  const i=ids(m);
  const tables:Record<string,Objeto['table']>={espaco:'WorkSpace',lista:'WorkList',tarefa:'WorkTask',agente:'Agent',material:'EditorialMaterial',
    oportunidade:'Lead',conta:'FinanceAccount',classificacao:'ChartAccount',contraparte:'Partner',contrato:'Contract'};
  const physical:Record<string,string>={espaco:i.space,lista:i.list,tarefa:i.task,agente:i.agent,material:i.material,
    oportunidade:i.lead,conta:i.account,classificacao:i.chart,contraparte:i.partner,contrato:i.contract};
  for(const o of receipt.objects){
    const planned=objeto(m,o.key), b=receipt.sourceBindings.bindings.find((b)=>b.key===o.key);
    const related:Record<string,string>=b?{versionId:b.versionId}:o.key==='lista'?{open:i.open,doing:i.doing,closed:i.closed}
      :o.key==='tarefa'?{sourceLink:i.link}:o.key==='agente'?{sop:i.sop}:o.key==='material'?{versionId:i.editorialVersion}
      :o.key==='oportunidade'?{eventId:i.event}:{};
    exigir(o.logicalId===planned.logicalId&&o.table===(b?'ContextItem':tables[o.key])
      &&o.databaseId===(b?b.itemId:physical[o.key])&&canonico(o.related)===canonico(related), 'demo_recibo_objeto_divergente');
    if(b)exigir(o.snapshot.versao===b.versao&&o.snapshot.contentHash===b.contentHash, 'demo_recibo_fonte_divergente');
    else exigir(o.snapshot.versao===(o.key==='agente'||o.key==='material'?1:null)
      &&(o.key==='material'?o.snapshot.contentHash!==null:o.snapshot.contentHash===null),'demo_recibo_snapshot_divergente');
  }
  exigir(receipt.auditIds.length===10&&new Set(receipt.auditIds).size===10,'demo_recibo_auditorias_divergente');
}
async function conferirColisoes(tx:Tx,m:M):Promise<void>{
  const i=ids(m),orgId=m.orgId;
  const materialRequest=objeto(m,'material').requestId;exigir(materialRequest,'demo_pedido_ausente');
  const ocupados=await Promise.all([
    tx.workSpace.count({where:{orgId,OR:[{id:i.space},{name:'DEMO — ROOT OS'}]}}),
    tx.workList.count({where:{orgId,OR:[{id:i.list},{name:'DEMO — Percursos locais'}]}}),
    tx.workTask.count({where:{orgId,OR:[{id:i.task},{title:'DEMO — Produzir rascunho com fonte'}]}}),
    tx.agent.count({where:{orgId,OR:[{id:i.agent},{nome:'DEMO — Leitor de fontes'},
      {slug:`procedimento-${objeto(m,'agente').requestId}`}]}}),
    tx.editorialMaterial.count({where:{orgId,OR:[{id:i.material},{requestId:materialRequest},
      {title:'DEMO — Texto com fonte preservada'}]}}),
    tx.lead.count({where:{orgId,OR:[{id:i.lead},{name:'[QA] DEMO — Empresa fictícia'}]}}),
    tx.financeAccount.count({where:{orgId,OR:[{id:i.account},{name:'DEMO — Caixa sem banco'}]}}),
    tx.chartAccount.count({where:{orgId,OR:[{id:i.chart},{codigo:'DEMO.V2.DESP'}]}}),
    tx.partner.count({where:{orgId,OR:[{id:i.partner},{razaoSocial:'DEMO — Fornecedor fictício'}]}}),
    tx.contract.count({where:{orgId,OR:[{id:i.contract},{descricao:'DEMO — Contrato mensal fictício'}]}}),
  ]);
  exigir(ocupados.every((n)=>n===0),'demo_identidade_ocupada');
}
async function disponibilidade(tx: Tx, receipt: DemonstracaoSinteticaRecibo) {
  const m = { orgId: receipt.orgId };
  const queries: Record<Objeto['table'], (id:string) => Promise<unknown>> = {
    ContextItem: (id) => tx.contextItem.findFirst({where:{id,...m,arquivadoEm:null},select:{id:true}}),
    WorkSpace: (id) => tx.workSpace.findFirst({where:{id,...m},select:{id:true}}),
    WorkList: (id) => tx.workList.findFirst({where:{id,...m},select:{id:true}}),
    WorkTask: (id) => tx.workTask.findFirst({where:{id,...m,archived:false},select:{id:true}}),
    Agent: (id) => tx.agent.findFirst({where:{id,...m},select:{id:true}}),
    EditorialMaterial: (id) => tx.editorialMaterial.findFirst({where:{id,...m},select:{id:true}}),
    Lead: (id) => tx.lead.findFirst({where:{id,...m},select:{id:true}}),
    FinanceAccount: (id) => tx.financeAccount.findFirst({where:{id,...m},select:{id:true}}),
    ChartAccount: (id) => tx.chartAccount.findFirst({where:{id,...m},select:{id:true}}),
    Partner: (id) => tx.partner.findFirst({where:{id,...m},select:{id:true}}),
    Contract: (id) => tx.contract.findFirst({where:{id,...m},select:{id:true}}),
  };
  const result = [];
  for (const o of receipt.objects) result.push({ key:o.key, disponivel:!!await queries[o.table](o.databaseId) });
  return result;
}

async function criar(tx: Tx, audit: AuditService, m: M, fontes: Fontes, sources: Fonte[], destination: DestinoDemo): Promise<DemonstracaoSinteticaRecibo> {
  const i=ids(m), orgId=m.orgId, actorId=m.actorId;
  const req = (key: Objeto['key']) => { const r=objeto(m,key).requestId; exigir(r,'demo_pedido_ausente'); return r; };
  const s = sources.find((r) => r.binding.key === 'nota-conteudo'); exigir(s,'demo_fonte_ausente');
  const space=TrabEspacoCreateSchema.parse({name:'DEMO — ROOT OS'});
  const list=TrabListaCreateSchema.parse({name:'DEMO — Percursos locais',spaceId:i.space});
  const account=CreateFinanceAccountSchema.parse({name:'DEMO — Caixa sem banco',type:'caixa',institution:null,openingBalance:0});
  const chart=CreateChartAccountSchema.parse({codigo:'DEMO.V2.DESP',nome:'DEMO — Despesa de exercício',tipo:'despesa',nivel:3,parentId:null,dreCodigo:null,permiteLancamento:true});
  const partner=CreatePartnerSchema.parse({razaoSocial:'DEMO — Fornecedor fictício',cnpjCpf:null,email:null,phone:null,isFornecedor:true,isCliente:false});
  const contract=CreateContractSchema.parse({tipo:'saida',partnerId:i.partner,descricao:'DEMO — Contrato mensal fictício',valor:100,
    diaVencimento:15,periodicidade:'mensal',chartAccountId:i.chart,accountId:i.account,dataInicio:m.contractStart,dataFim:null});
  const taskInput=normalizarPedidoDeContexto({requestId:req('tarefa'),versionId:s.version.id,contentHash:s.version.contentHash,
    expectedItemVersion:s.item.versao,listId:i.list,statusId:i.open,title:'DEMO — Produzir rascunho com fonte',assigneeUserId:actorId});
  const taskFp=fingerprintDeContexto(orgId,actorId,s.item.id,taskInput);
  const agentInput=CriarProcedimentoSchema.parse({requestId:req('agente'),nome:'DEMO — Leitor de fontes',
    missao:'Ler fontes sintéticas e conservar a versão de origem no rascunho.',pilar:'conteudo',donoId:actorId,modelo:null,
    procedimento:{proposito:'Preparar um rascunho interno a partir de uma fonte sintética identificada.',
      gatilho:'Somente quando a pessoa responsável pedir uma leitura nesta demonstração.',
      passos:['Conferir a fonte e a versão escolhidas pela pessoa.','Conservar a origem no rascunho e registrar pendências.'],
      definicaoDePronto:'Rascunho interno com a origem e a versão citadas, sem ação externa.',
      observacoes:'A demonstração não autoriza execução automática, postagem ou contato externo.'}});
  const sop=validarProcedimento(agentInput.procedimento,{donoId:actorId,pilar:agentInput.pilar});
  const agentFp=sha256(JSON.stringify({pessoaId:actorId,input:{...agentInput,procedimento:sop}}));
  const editorial=EditorialCreateSchema.parse({requestId:req('material'),taskId:i.task,releaseStatusId:i.closed,
    title:'DEMO — Texto com fonte preservada',body:'Rascunho sintético para revisão interna.\n\n'+s.version.body,
    files:[],sourceRef:`contexto:${s.item.id}@${s.version.id}`});
  exigir(editorial.files.length===0,'demo_anexos_nao_previstos');
  const editorialFp=editorialFingerprint(orgId,actorId,'material',editorial), editorialHash=editorialContentHash({...editorial,files:[]});
  const commercial=ComercialEntradaExercicioSchema.parse({requestId:req('oportunidade'),origemRef:objeto(m,'oportunidade').logicalId,
    nome:'DEMO — Empresa fictícia',ownerId:actorId});
  const commercialFp=hashComercial({orgId,actorId,acao:'entrada',leadId:i.lead,pedido:commercial});
  const auditIds:string[]=[];
  const log=async(action:string,entityType:string,entityId:string,after:Prisma.InputJsonValue,metadata?:Prisma.InputJsonValue) => {
    await audit.log({orgId,actorId,action,entityType,entityId,after,metadata},tx);
    // AuditService usa UUID próprio; recuperar a linha criada pela identidade fixa neste compromisso.
    const rows=await tx.auditLog.findMany({where:{orgId,actorId,action,entityId},select:{id:true}});
    exigir(rows.length===1,'demo_auditoria_ambigua'); auditIds.push(rows[0].id);
  };
  // Não há adoção: todas as criações são INSERT; qualquer unique ocupado aborta a transação inteira.
  await tx.workSpace.create({data:{id:i.space,orgId,...space}});
  await log('work.space.create','work_space',i.space,{name:space.name});
  await tx.workList.create({data:{id:i.list,orgId,name:list.name,spaceId:i.space}});
  for (const [id,name,type,color,order] of [[i.open,'A fazer','open','#87909e',0],
    [i.doing,'Em andamento','custom','#f9d900',1],[i.closed,'Concluída','closed','#6bc950',2]] as const)
    await tx.workStatus.create({data:{id,orgId,listId:i.list,name,type,color,order}});
  await log('work.list.create','work_list',i.list,{name:list.name,spaceId:i.space});
  await tx.workTask.create({data:{id:i.task,orgId,listId:i.list,statusId:i.open,title:taskInput.title,assigneeUserId:actorId}});
  await tx.workContextSource.create({data:{id:i.link,orgId,taskId:i.task,itemId:s.item.id,versionId:s.version.id,
    requestId:taskInput.requestId,fingerprint:taskFp,actorId,chave:s.item.chave,versao:s.version.versao,
    contentHash:s.version.contentHash,sourceType:s.version.sourceType,sourceRef:s.version.sourceRef,title:s.version.title}});
  await log('work.task.create.contexto','work_task',i.task,{listId:i.list,requestId:taskInput.requestId,itemId:s.item.id,
    versionId:s.version.id,versao:s.version.versao,contentHash:s.version.contentHash});
  await tx.agent.create({data:{id:i.agent,orgId,slug:`procedimento-${agentInput.requestId}`,nome:agentInput.nome,
    iniciais:'DL',missao:agentInput.missao,pilar:agentInput.pilar,donoId:actorId,estado:'planejado',ativo:false,tipo:'llm',
    autonomiaAte:RiskLevel.R1,capacidades:['contexto.memoria.buscar'],contextoFixo:[],cron:null,modelo:null,maxPassos:1,tetoSegundos:90,tetoCustoUsd:0}});
  await tx.sop.create({data:{id:i.sop,orgId,agentId:i.agent,...sop,atualizadoPor:actorId}});
  await log('agent.procedimento.create','agent',i.agent,{sintetico:true},
    {requestId:agentInput.requestId,fingerprint:agentFp,modo:'sintese_local_sem_ferramentas'});
  await tx.editorialMaterial.create({data:{id:i.material,orgId,taskId:i.task,title:editorial.title,
    releaseStatusId:i.closed,requestId:editorial.requestId,actorId,fingerprint:editorialFp}});
  await tx.editorialVersion.create({data:{id:i.editorialVersion,orgId,materialId:i.material,number:1,title:editorial.title,
    body:editorial.body,files:[],sourceRef:editorial.sourceRef,contentHash:editorialHash,requestId:editorial.requestId,actorId,fingerprint:editorialFp}});
  await tx.editorialMaterial.update({where:{id:i.material},data:{selectedVersionId:i.editorialVersion}});
  await log('editorial.material.created','editorial',i.material,{taskId:i.task,versionId:i.editorialVersion,contentHash:editorialHash,releaseStatusId:i.closed});
  await tx.lead.create({data:{id:i.lead,orgId,name:'[QA] '+commercial.nome,ownerId:actorId}});
  const response={leadId:i.lead,eventoId:i.event,replayed:false};
  await tx.leadEvent.create({data:{id:i.event,orgId,leadId:i.lead,type:'comercial_qa_entrada',payload:{modo:'exercicio',
    contrato:'comercial-exercicio-v1',acao:'entrada',requestId:commercial.requestId,fingerprint:commercialFp,atorId:actorId,
    dados:{origemRef:commercial.origemRef,nome:commercial.nome,ownerId:actorId},resposta:response}}});
  await log('comercial.exercicio.entrada','lead',i.lead,{modo:'exercicio',eventoId:i.event,requestId:commercial.requestId});
  await tx.financeAccount.create({data:{id:i.account,orgId,...account,openingBalance:new Prisma.Decimal(0),provider:'manual',currency:'BRL'}});
  await log('finance.account.create','finance_account',i.account,{name:account.name,type:account.type});
  await tx.chartAccount.create({data:{id:i.chart,orgId,codigo:chart.codigo,nome:chart.nome,tipo:chart.tipo,
    nivel:chart.nivel,parentId:null,dreLineId:null,permiteLancamento:true}});
  await log('finance.chart.create','chart_account',i.chart,{codigo:chart.codigo,nome:chart.nome});
  await tx.partner.create({data:{id:i.partner,orgId,...partner}});
  await log('finance.partner.create','partner',i.partner,{razaoSocial:partner.razaoSocial});
  // Mesma regra da criação APR vigente; não gera parcela nem inscrição F08.
  const inicio=new Date(contract.dataInicio), prox=new Date(inicio.getFullYear(),inicio.getMonth(),Math.min(contract.diaVencimento,28));
  if(prox<inicio)prox.setMonth(prox.getMonth()+1);
  await tx.contract.create({data:{id:i.contract,orgId,tipo:contract.tipo,partnerId:i.partner,descricao:contract.descricao,
    valor:new Prisma.Decimal('100.00'),diaVencimento:contract.diaVencimento,periodicidade:contract.periodicidade,
    chartAccountId:i.chart,accountId:i.account,dataInicio:inicio,dataFim:null,proximoVencimento:prox}});
  await log('finance.contract.create','contract',i.contract,{descricao:contract.descricao,valor:100});
  const tables:Record<string,Objeto['table']>={espaco:'WorkSpace',lista:'WorkList',tarefa:'WorkTask',agente:'Agent',material:'EditorialMaterial',
    oportunidade:'Lead',conta:'FinanceAccount',classificacao:'ChartAccount',contraparte:'Partner',contrato:'Contract'};
  const physical:Record<string,string>={espaco:i.space,lista:i.list,tarefa:i.task,agente:i.agent,material:i.material,
    oportunidade:i.lead,conta:i.account,classificacao:i.chart,contraparte:i.partner,contrato:i.contract};
  const objects:Objeto[]=m.objects.map((o) => {
    const src=sources.find((f)=>f.binding.key===o.key);
    if(src)return{key:o.key,logicalId:o.logicalId,databaseId:src.item.id,table:'ContextItem',related:{versionId:src.version.id},
      snapshot:{versao:src.version.versao,contentHash:src.version.contentHash}};
    const related:Record<string,string>=o.key==='lista'?{open:i.open,doing:i.doing,closed:i.closed}
      :o.key==='tarefa'?{sourceLink:i.link}:o.key==='agente'?{sop:i.sop}:o.key==='material'?{versionId:i.editorialVersion}
      :o.key==='oportunidade'?{eventId:i.event}:{};
    exigir(physical[o.key]&&tables[o.key],'demo_objeto_incompleto');
    return{key:o.key,logicalId:o.logicalId,databaseId:physical[o.key],table:tables[o.key],related,
      snapshot:{versao:o.key==='agente'||o.key==='material'?1:null,contentHash:o.key==='material'?editorialHash:null}};
  });
  const origemHash = sourceHash(fontes);
  return DemonstracaoSinteticaReciboSchema.parse({schemaVersion:1,tipo:'demo_installation_v1',sintetico:true,
    installationId:idInterno(m,'installation'),orgId,actorId,dataset:m.dataset,requestId:m.requestId,
    manifestHash:MANIFESTO_SHA,sourceHash:origemHash,inputFingerprint:inputFingerprint(m,origemHash),
    destinationSignatureHashDaCriacao:destination.resourcesSignatureHash,createdAt:new Date().toISOString(),
    selectionId:fontes.selectionId,sourceBindings:fontes,objects,auditIds,
    effects:{modelo:false,cron:false,provider:false,publicacao:false,cobranca:false,aprovacao:false,F08gerado:false}});
}

export async function prepararDemonstracao(prisma: PrismaService, audit: AuditService, m: M, destination: DestinoDemo,
  modo:'aplicar'|'recuperar'|'conferir', f?: Fontes):Promise<DemonstracaoSinteticaResultado> {
  exigir(process.env.ROOTOS_QA_PREVIEW==='1'&&process.env.OBSIDIAN_REINDEX_MIN==='0','demo_ambiente_indisponivel');
  if(modo==='aplicar')exigir(f,'demo_prova_fonte_obrigatoria');
  return prisma.$transaction(async(tx)=>{
    exigir(m.orgId===ORG_ID&&m.actorId===ACTOR_ID,'demo_escopo_divergente');
    await travar(tx,m);await travarAutoridadeDaDemonstracao(tx);
    const db=await tx.$queryRaw<Array<{name:string;user:string;schema:string}>>`
      SELECT current_database() name,current_user "user",current_schema() "schema"`;
    exigir(db.length===1&&db[0].name===destination.database.name&&db[0].user===destination.database.user
      &&db[0].schema===destination.database.schema,'demo_banco_divergente');
    const old=await tx.demoInstallation.findFirst({where:{orgId:m.orgId,OR:[{dataset:m.dataset},{requestId:m.requestId}]}});
    if(old){
      exigir(old.actorId===m.actorId&&old.dataset===m.dataset&&old.requestId===m.requestId&&old.manifestHash===MANIFESTO_SHA,
        'demo_pedido_conflito');
      const receipt=DemonstracaoSinteticaReciboSchema.parse(old.receipt);
      conferirObjetosDoRecibo(m,receipt);
      exigir(hashCanonico(receipt)===old.receiptHash&&receipt.installationId===old.id&&receipt.orgId===old.orgId
        &&receipt.actorId===old.actorId&&receipt.dataset===old.dataset&&receipt.requestId===old.requestId
        &&receipt.manifestHash===old.manifestHash&&receipt.selectionId===old.selectionId&&receipt.sourceHash===old.sourceHash
        &&receipt.inputFingerprint===old.inputFingerprint&&receipt.destinationSignatureHashDaCriacao===old.destinationSignatureHash
        &&sourceHash(receipt.sourceBindings)===old.sourceHash&&inputFingerprint(m,old.sourceHash)===old.inputFingerprint,
      'demo_recibo_inconsistente');
      if(f)exigir(sourceHash(f)===old.sourceHash,'demo_fonte_pedido_conflito');
      await conferirFontes(tx,m,receipt.sourceBindings,false);
      const availability=await disponibilidade(tx,receipt);await reconferirAutoridade(tx,m);
      return DemonstracaoSinteticaResultadoSchema.parse({tipo:'confirmado',recibo:receipt,replayed:true,disponibilidadeAtual:availability});
    }
    if(modo!=='aplicar'){
      if(f)await conferirFontes(tx,m,f,true);
      await reconferirAutoridade(tx,m);
      return DemonstracaoSinteticaResultadoSchema.parse({tipo:'ausencia_conferida',orgId:m.orgId,actorId:m.actorId,dataset:m.dataset,requestId:m.requestId});
    }
    exigir(f,'demo_prova_fonte_obrigatoria');const sources=await conferirFontes(tx,m,f,true);
    await conferirColisoes(tx,m);
    const receipt=await criar(tx,audit,m,f,sources,destination),originHash=sourceHash(f);
    conferirObjetosDoRecibo(m,receipt);
    await tx.demoInstallation.create({data:{id:receipt.installationId,orgId:m.orgId,actorId:m.actorId,dataset:m.dataset,
      requestId:m.requestId,manifestHash:MANIFESTO_SHA,sourceHash:originHash,inputFingerprint:receipt.inputFingerprint,
      destinationSignatureHash:destination.resourcesSignatureHash,selectionId:f.selectionId,
      receipt,receiptHash:hashCanonico(receipt),createdAt:new Date(receipt.createdAt)}});
    await conferirFontes(tx,m,f,true);await reconferirAutoridade(tx,m);
    return DemonstracaoSinteticaResultadoSchema.parse({tipo:'confirmado',recibo:receipt,replayed:false,
      disponibilidadeAtual:await disponibilidade(tx,receipt)});
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,timeout:30000});
}
