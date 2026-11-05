/* Prova no AppModule publicado. Dados sintéticos próprios; sem provedores externos.
   seed/cleanup usam processo separado do runtime e exigem opt-in na produção. */
const fs=require('node:fs');const assert=require('node:assert/strict');const {randomUUID,randomBytes}=require('node:crypto');
const {createRequire}=require('node:module');const req=createRequire(process.cwd()+'/package.json');
const {PrismaClient}=req('@prisma/client');const bcrypt=req('bcryptjs');
const mode=process.argv[2];const manifest=process.env.QA_MANIFEST||'/qa/runtime-fixture.private.json';
const db=new PrismaClient();const base=process.env.QA_API_URL||'http://127.0.0.1:4001/api';
const target=new URL(process.env.DATABASE_URL);
if(!/test|homolog/.test(target.pathname)&&process.env.QA_ALLOW_PRODUCTION!=='1')throw new Error('Prova exige banco descartável ou autorização explícita de produção.');
const checks=[];
async function http(method,path,token,body){const r=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
async function seed(){
 assert.notEqual(target.username,'mktos_app','seed é processo separado');assert(!fs.existsSync(manifest),'Não sobrescrever fixtures de outra rodada');
 const f={id:randomUUID(),database:target.pathname,createdAt:new Date().toISOString(),orgs:[]};
 fs.writeFileSync(manifest,JSON.stringify(f),{mode:0o600,flag:'wx'});
 for(const suffix of ['a','b']){
  const id=randomUUID();const email=`qa-rls-${suffix}-${f.id}@example.invalid`;const password=randomBytes(24).toString('hex');
  const org=await db.org.create({data:{id,slug:`qa-rls-${suffix}-${f.id}`,name:'QA RLS temporária '+suffix,modulos:['pauta']}});
  f.orgs.push({id,slug:org.slug,email,password});fs.writeFileSync(manifest,JSON.stringify(f));
  const role=await db.role.create({data:{orgId:id,key:'qa_marketing',name:'QA Marketing',permissions:{connect:[{key:'pauta.ver'},{key:'pauta.editar'}]}}});
  const user=await db.user.create({data:{orgId:id,email,name:'QA temporária',passwordHash:await bcrypt.hash(password,10),roles:{connect:{id:role.id}}}});
  await db.clienteAcessoPerfil.create({data:{orgId:id,userId:user.id,modo:'ALL'}});
  const note=await db.marketingNota.create({data:{orgId:id,titulo:'Nota QA '+suffix,corpo:'Conteúdo sintético '+f.id,status:'pronto'}});
  const post=await db.marketingPost.create({data:{orgId:id,titulo:'Post QA '+suffix}});
  Object.assign(f.orgs.at(-1),{userId:user.id,roleId:role.id,noteId:note.id,postId:post.id});fs.writeFileSync(manifest,JSON.stringify(f));
 }
 console.log(JSON.stringify({seed:'ok',orgs:f.orgs.length}));
}
async function test(){
 const f=JSON.parse(fs.readFileSync(manifest));assert.equal(f.database,target.pathname);assert.equal(f.orgs.length,2);
 const [role]=await db.$queryRawUnsafe('SELECT current_user::text AS papel, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user');
 assert.deepEqual(role,{papel:'mktos_app',rolsuper:false,rolbypassrls:false});assert.equal(process.env.TENANT_MODO,'impor');checks.push('papel_efetivo');
 assert.equal(await db.marketingNota.count(),0,'Sessão sem empresa não lê notas');checks.push('sql_sem_empresa');
 for(const org of f.orgs){const login=await http('POST','/auth/login',null,{email:org.email,password:org.password});assert.equal(login.status,201);org.token=login.body.token;}
 checks.push('login_duas_empresas');
 for(const i of [0,1]){
  const a=f.orgs[i],b=f.orgs[1-i];
  await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe("SELECT set_config('app.org_id',$1,true)",a.id);
   assert(await tx.marketingNota.findUnique({where:{id:a.noteId}}));
   assert.equal(await tx.marketingNota.findUnique({where:{id:b.noteId}}),null);
   assert.equal((await tx.marketingNota.updateMany({where:{id:b.noteId},data:{titulo:'Tentativa SQL cruzada'}})).count,0);
  });
 }
 assert.equal(await db.marketingNota.count(),0);checks.push('sql_ids_cruzados_e_reset_pool');

 for(const i of [0,1,0]){
  const a=f.orgs[i],b=f.orgs[1-i];
  const list=await http('GET','/marketing/estudio/memoria',a.token);assert.equal(list.status,200);assert(JSON.stringify(list.body).includes(a.noteId));assert(!JSON.stringify(list.body).includes(b.noteId));
  const own=await http('GET','/marketing/estudio/memoria/notas/'+a.noteId,a.token);assert.equal(own.status,200);
  assert.equal((await http('GET','/marketing/estudio/memoria/notas/'+b.noteId,a.token)).status,404);
  const machine=await http('GET','/marketing/maquina',a.token);assert.equal(machine.status,200);assert(JSON.stringify(machine.body).includes(a.postId));assert(!JSON.stringify(machine.body).includes(b.postId));
  assert.equal((await http('PUT','/marketing/maquina/posts/'+b.postId,a.token,{titulo:'Tentativa cruzada'})).status,404);
  assert.equal((await http('PUT','/marketing/maquina/posts/'+a.postId,a.token,{titulo:'Revisado QA '+i})).status,200);
  assert.equal((await http('GET','/marketing/preparacao',a.token)).status,200);
 }
 checks.push('http_marketing_leitura_escrita_ids_cruzados');
 for(const path of ['/finance/accounts','/comercial/funil','/trabalho/tarefas','/bio/pages','/google/drive','/cofre-da-empresa/estado','/approvals/fila','/users']){
  assert.equal((await http('GET',path,f.orgs[0].token)).status,403,path);
 }
 assert.deepEqual((await http('GET','/tenants/modulos',f.orgs[0].token)).body.modulos,['pauta']);checks.push('somente_marketing');
 assert.deepEqual((await http('GET','/marketing/estudio/apify/uso',f.orgs[0].token)).body,{uso:null,configurado:false});checks.push('recurso_compartilhado_contido');
 const a=f.orgs[0],b=f.orgs[1];
 Object.assign(process.env,{MCP_ENV_FILE:'/arquivo-inexistente',MCP_API_URL:base,MCP_SERVICE_EMAIL:a.email,MCP_SERVICE_PASSWORD:a.password,MCP_OPERADOR_EMAIL:b.email,MCP_OPERADOR_SENHA:b.password});
 const m=await import(process.env.QA_MCP_CLIENT || '/app/packages/mcp/dist/client.js');
 const viaMcp=await m.apiGet('/marketing/estudio/memoria');assert(JSON.stringify(viaMcp).includes(b.noteId));assert(!JSON.stringify(viaMcp).includes(a.noteId));checks.push('mcp_operador_b_servico_a');
 const report={status:'passed',checks,orgs:2,role,at:new Date().toISOString()};
 fs.writeFileSync(process.env.QA_RESULT||'/qa/runtime-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
async function cleanup(){
 assert.notEqual(target.username,'mktos_app');const f=JSON.parse(fs.readFileSync(manifest));assert.equal(f.database,target.pathname);
 const ids=f.orgs.map(o=>o.id);assert(ids.length<=2);const where={orgId:{in:ids}};
 for(const org of f.orgs){const actual=await db.org.findUnique({where:{id:org.id}});assert.equal(actual?.slug,org.slug);assert(actual.slug.startsWith('qa-rls-'));}
 // Apenas as duas empresas registradas por esta rodada. Nenhum filtro por prefixo no DELETE.
 await db.$transaction(async tx=>{
  await tx.marketingPost.deleteMany({where});await tx.marketingIdeiaCard.deleteMany({where});await tx.marketingNota.deleteMany({where});
  await tx.rotina.deleteMany({where});await tx.auditLog.deleteMany({where});await tx.clienteAcessoPerfil.deleteMany({where});
  await tx.user.deleteMany({where});await tx.role.deleteMany({where});await tx.org.deleteMany({where:{id:{in:ids}}});
 });
 assert.equal(await db.org.count({where:{id:{in:ids}}}),0);console.log(JSON.stringify({cleanup:'ok',orgs:ids.length}));
}
(async()=>{try{await ({seed,test,cleanup}[mode])();}finally{await db.$disconnect();}})().catch(e=>{console.error(e.message);process.exit(1);});
