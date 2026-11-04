import {ConflictException,NotFoundException} from '@nestjs/common';
import {PrismaService} from '../prisma/prisma.service';
import {ClienteEscopoService} from './cliente-escopo.service';
import {AuditService} from '../audit/audit.service';
/** Migração explícita: só vínculo por depósito/recibo, sem ler ou alterar o segredo. */
export async function classificarDeposito(db:PrismaService,escopo:ClienteEscopoService,audit:AuditService,input:{orgId:string;atorId:string;depositoId:string;clienteId:string}) {
 const {orgId,atorId,depositoId,clienteId}=input;
 return db.$transaction(async tx=>{
  await escopo.exigirAmplo(orgId,atorId,tx);
  await escopo.exigirCliente(orgId,atorId,clienteId,tx);
  await tx.$queryRaw`SELECT "id" FROM "CofreDeposito" WHERE "id"=${depositoId} AND "orgId"=${orgId} FOR UPDATE`;
  const d=await tx.cofreDeposito.findFirst({where:{id:depositoId,orgId}});
  if(!d) throw new NotFoundException('Depósito não encontrado.');
  if(d.clienteId!==null && d.clienteId!==clienteId) throw new ConflictException('O depósito já pertence a outro cliente.');
  // Impede classificação concorrente de itens entre a verificação e a atualização.
  await tx.$queryRaw`SELECT "id" FROM "CofreItem" WHERE "orgId"=${orgId}
    AND ("criadoPor"=${`deposito:${depositoId}`} OR "id" IN
      (SELECT "itemId" FROM "CofreDepositoRecibo" WHERE "orgId"=${orgId} AND "depositoId"=${depositoId}))
    ORDER BY "id" FOR UPDATE`;
  const recibos=await tx.cofreDepositoRecibo.findMany({where:{orgId,depositoId},select:{itemId:true}});
  const origem={orgId,OR:[{id:{in:recibos.map(r=>r.itemId)}},{criadoPor:`deposito:${depositoId}`}]};
  const conflitantes=await tx.cofreItem.count({where:{...origem,clienteId:{not:clienteId}}});
  if(conflitantes) throw new ConflictException('Há item classificado em outro cliente.');
  // A guarda no UPDATE evita sobrescrever uma classificação concorrente.
  const itens=await tx.cofreItem.updateMany({where:{...origem,clienteId:null},data:{clienteId}});
  await tx.cofreDeposito.update({where:{id:depositoId,orgId},data:{clienteId}});
  if(d.clienteId!==clienteId || itens.count) await audit.log({orgId,actorId:atorId,action:'cofre.deposito.classificar',entityType:'cofre_deposito',entityId:depositoId,
    before:{clienteId:d.clienteId},after:{clienteId,itens:itens.count}},tx);
  return {depositoId,clienteId,itens:itens.count,expiraEm:d.expiraEm,recebidos:d.recebidos};
 });
}
