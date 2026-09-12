import { Controller, Get, UnauthorizedException, UseGuards } from '@nestjs/common';
import { MODULOS } from '@mktos/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { ModulosService } from './modulos.service';

/**
 * O que ESTA empresa contratou — RF-T-06.
 *
 * Existe para o web poder esconder do menu o que a API vai recusar. Os dois
 * lados lendo do mesmo lugar é o que impede o menu de discordar da API.
 *
 * SEM `@RequirePermissions`, e é decisão. Todo usuário autenticado precisa
 * desta resposta para que a sidebar seja desenhada; exigir permissão aqui
 * deixaria quem tem pouco acesso com um menu construído em cima de "não sei" —
 * que, no `navPorSecao`, quer dizer "mostra tudo". A resposta não revela nada
 * além do escopo de produto da própria empresa de quem pergunta.
 *
 * `tenants` é prefixo de ESPINHA (ver `modulos.ts`): precisa continuar
 * respondendo mesmo para um tenant sem módulo nenhum, senão o web não consegue
 * nem descobrir que não tem nada.
 */
@UseGuards(JwtAuthGuard)
@Controller('tenants')
export class ModulosController {
  constructor(private readonly modulos: ModulosService) {}

  @Get('modulos')
  async meus(@CurrentUser() user: JwtUser) {
    /*
     * Token autenticado e sem empresa recebe 401, não 500.
     *
     * `tenants` é espinha, então o gate de módulos não passa por aqui — e sem
     * esta linha o `ModulosService` LANÇA `SemTenantError`, que não é exceção
     * HTTP: o Nest devolve 500. Medido com a API de pé: um token de propósito
     * do login com Google (`{purpose:'google-login'}`, assinado com o mesmo
     * segredo e sem `orgId`) tirava 500 desta rota. 401 é a resposta honesta —
     * a sessão é que está quebrada, não o servidor.
     */
    if (typeof user?.orgId !== 'string' || user.orgId.trim() === '') {
      throw new UnauthorizedException('Sessão sem empresa');
    }
    const ligados = await this.modulos.modulosDaOrg(user.orgId);
    return {
      /** Os módulos desta empresa, na ordem canônica de `MODULOS`. */
      modulos: MODULOS.filter((m) => ligados.has(m)),
      /** O catálogo inteiro — o web usa para saber o que EXISTE e está de fora. */
      catalogo: MODULOS,
    };
  }
}
