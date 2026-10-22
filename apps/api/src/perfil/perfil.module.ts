import { Module } from '@nestjs/common';
import { PerfilController } from './perfil.controller';
import { PerfilService } from './perfil.service';
import { AtribuicoesDoVaultService } from '../agents/atribuicoes-do-vault.service';

/** O perfil da pessoa (produção 22B, I6): cadastro, foto e a lista de avatares da empresa. */
@Module({
  controllers: [PerfilController],
  providers: [PerfilService, AtribuicoesDoVaultService],
})
export class PerfilModule {}
