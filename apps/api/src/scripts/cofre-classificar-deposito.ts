import 'reflect-metadata';
import {z} from 'zod';
import {criarPrismaService} from '../prisma/prisma.service';
import {comContexto,novaCorrelacao} from '../common/contexto-execucao';
import {AuditService} from '../audit/audit.service';
import {ClienteEscopoService} from '../clientes-escopo/cliente-escopo.service';
import {classificarDeposito} from '../clientes-escopo/classificar-deposito';
async function main(){
 const [orgId,atorId,depositoId,clienteId]=z.tuple([z.string().uuid(),z.string().uuid(),z.string().uuid(),z.string().uuid()]).parse(process.argv.slice(2));
 const db=await criarPrismaService(),audit=new AuditService(db),escopo=new ClienteEscopoService(db,audit);
 try{const resultado=await comContexto({orgId,actorType:'user',actorId:atorId,correlationId:novaCorrelacao('cli'),origem:'script'},async()=>await classificarDeposito(db,escopo,audit,{orgId,atorId,depositoId,clienteId}));console.log(JSON.stringify(resultado));}
 finally{await db.$disconnect();}
}
main().catch(()=>{console.error('Falha ao classificar depósito. Confira vínculos e auditoria antes de tentar novamente.');process.exitCode=1;});
