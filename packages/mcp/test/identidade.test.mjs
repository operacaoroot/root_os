import test from 'node:test';
import assert from 'node:assert/strict';

const chaves = ['MCP_ENV_FILE','MCP_SERVICE_EMAIL','MCP_SERVICE_PASSWORD','MCP_OPERADOR_EMAIL','MCP_OPERADOR_SENHA'];
let rodada = 0;
async function executar(env, fn) {
  const antes = Object.fromEntries(chaves.map(k=>[k,process.env[k]]));
  const fetchAnterior=globalThis.fetch;
  const chamadas=[];
  try {
    for(const k of chaves) delete process.env[k];
    Object.assign(process.env,{MCP_ENV_FILE:'/arquivo-inexistente-no-teste',...env});
    globalThis.fetch=async (url,init)=>{
      chamadas.push({url:String(url),...init});
      if(String(url).endsWith('/auth/login')) return new Response(JSON.stringify({token:JSON.parse(init.body).email}),{status:env.RECUSAR ? 401:200,headers:{'content-type':'application/json'}});
      return new Response(JSON.stringify({ator:init.headers.Authorization}),{headers:{'content-type':'application/json'}});
    };
    await fn(()=>import(`../dist/client.js?teste=${++rodada}`),chamadas);
  } finally {
    globalThis.fetch=fetchAnterior;
    for(const k of chaves) antes[k]===undefined ? delete process.env[k] : process.env[k]=antes[k];
  }
}

test('apiGet antigo e leitor usam a mesma pessoa mesmo com serviço de outra org configurado',()=>executar({MCP_SERVICE_EMAIL:'servico-a@test',MCP_SERVICE_PASSWORD:'sintetica',MCP_OPERADOR_EMAIL:'pessoa-b@test',MCP_OPERADOR_SENHA:'sintetica'},async(importar,chamadas)=>{
  const m=await importar();
  assert.deepEqual(await m.apiGet('/marketing/estudio/memoria'),{ator:'Bearer pessoa-b@test'});
  assert.deepEqual(await m.leitor().get('/marketing/estudio/memoria'),{ator:'Bearer pessoa-b@test'});
  assert.equal(chamadas.filter(c=>c.url.endsWith('/auth/login')).length,1);
  assert.equal(JSON.parse(chamadas[0].body).email,'pessoa-b@test');
}));
test('operador completo dispensa credencial de serviço',()=>executar({MCP_OPERADOR_EMAIL:'pessoa@test',MCP_OPERADOR_SENHA:'sintetica'},async(importar)=>{
  const m=await importar(); assert.deepEqual(await m.apiGet('/marketing/estudio/memoria'),{ator:'Bearer pessoa@test'});
}));
for(const parcial of [{MCP_OPERADOR_EMAIL:'pessoa@test'},{MCP_OPERADOR_SENHA:'sintetica'}]) test(`operador incompleto ${Object.keys(parcial)[0]} recusa antes da rede`,()=>executar({MCP_SERVICE_PASSWORD:'sintetica',...parcial},async(importar,chamadas)=>{
  await assert.rejects(async()=>{const m=await importar();await m.apiGet('/marketing/estudio/memoria');},/operador.*incomplet/i);
  assert.equal(chamadas.length,0);
}));
test('login do operador recusado nunca usa serviço como alternativa',()=>executar({MCP_SERVICE_EMAIL:'servico@test',MCP_SERVICE_PASSWORD:'sintetica',MCP_OPERADOR_EMAIL:'pessoa@test',MCP_OPERADOR_SENHA:'errada',RECUSAR:true},async(importar,chamadas)=>{
  const m=await importar(); await assert.rejects(()=>m.apiGet('/marketing/estudio/memoria'),/401/);
  assert.deepEqual(chamadas.map(c=>JSON.parse(c.body).email),['pessoa@test']);
}));
test('sem operador a conta de serviço permanece a identidade única de leitura',()=>executar({MCP_SERVICE_EMAIL:'servico@test',MCP_SERVICE_PASSWORD:'sintetica'},async(importar)=>{
  const m=await importar();assert.deepEqual(await m.apiGet('/marketing/estudio/memoria'),{ator:'Bearer servico@test'});
  assert.throws(()=>m.operador(),/Identidade do operador ausente/);
}));
