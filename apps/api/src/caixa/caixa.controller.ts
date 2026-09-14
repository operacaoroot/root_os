import { Controller, Get, UseGuards } from '@nestjs/common';
import type { CaixaContador, CaixaResposta } from '@mktos/shared';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { CaixaService } from './caixa.service';

/**
 * `GET /api/caixa` — o que espera por MIM, fatia A7.
 *
 * ---------------------------------------------------------------------------
 * A PERMISSÃO DA ROTA É `dashboard.ver`, E CADA EIXO TEM A SUA
 * ---------------------------------------------------------------------------
 * A caixa é pessoal: toda pessoa que entra no OS tem uma, mesmo quem só lê. Se
 * a rota pedisse `aprovacoes.ver`, quem não acompanha a fila perderia também as
 * tarefas paradas dele — e a única tela que responde "o que preciso fazer" viria
 * com 403 inteiro por causa de um eixo.
 *
 * Então a rota pede a chave que todo perfil de gente tem, e o SERVIÇO consulta
 * cada eixo só quando a sessão carrega a permissão dele: `aprovacoes.ver` (mais
 * `aprovacoes.decidir`, porque permissão não é alçada) para as aprovações e
 * `tarefas.ver` — com o módulo `trabalho` contratado — para o quadro. Eixo sem
 * permissão volta com `estado: 'sem_permissao'` e lista vazia, e a tela diz
 * isso. É o desenho de `/contexto` (fatia 4.4): cinco fontes, cinco permissões,
 * nenhuma obrigatória, e 403 vira "sem permissão" em vez de caixa de erro.
 *
 * NENHUMA PERMISSÃO NOVA, e isso é decisão e não economia: chave nova custa três
 * passos de implantação (build do `@mktos/shared`, `db:sync-permissions` — que
 * NÃO é aditivo — e todo mundo sair e entrar, porque a permissão viaja no JWT)
 * para comprar exatamente nada. A caixa não abre nada que as telas de destino
 * não abram: ela mostra MENOS que `/atendimento` (não devolve o conteúdo exato
 * da ação retida) e menos que `/trabalho`.
 *
 * ---------------------------------------------------------------------------
 * PREFIXO PRÓPRIO, E ELE PRECISA ESTAR DECLARADO
 * ---------------------------------------------------------------------------
 * `caixa` é prefixo NOVO, e prefixo não declarado em `src/tenants/modulos.ts`
 * LANÇA em tempo de execução — foi assim que as famílias `memoria` e `rotinas`
 * nasceram quebradas inteiras. Está em `PREFIXOS_DA_ESPINHA`: o controle de
 * agentes não desliga por contrato, e uma empresa que pudesse desligar a caixa
 * ficaria sem a tela que diz o que espera por ela.
 *
 * Espinha NÃO significa que o dado do quadro escapa do gate do módulo: o serviço
 * pergunta ao `ModulosService` antes de ler `WorkTask`. Rota que nunca desliga
 * servindo dado de módulo não contratado é o vazamento silencioso que aquele
 * arquivo existe para impedir.
 *
 * ---------------------------------------------------------------------------
 * DUAS ROTAS, UMA ARITMÉTICA
 * ---------------------------------------------------------------------------
 * `GET /api/caixa` monta a tela; `GET /api/caixa/contador` devolve só o número
 * que a barra lateral mostra, DERIVADO da mesma montagem. Um `count()` próprio
 * seria mais barato e mentiria: o impedimento da porta não cabe em SQL, então o
 * selo diria 4 e a tela mostraria 3 — o defeito que a fatia A3 acabou de pagar
 * nas horas devolvidas.
 *
 * `contador` DECLARADO ANTES de qualquer rota com parâmetro (não há nenhuma
 * hoje, e é por isso que a ordem se anota agora): o Nest casa rota na ordem em
 * que o método aparece na classe, e um `:id` futuro engoliria `contador`.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('caixa')
export class CaixaController {
  constructor(private readonly caixa: CaixaService) {}

  @Get('contador')
  @RequirePermissions('dashboard.ver')
  contador(@CurrentUser() user: JwtUser): Promise<CaixaContador> {
    return this.caixa.contar({
      orgId: user.orgId,
      usuarioId: user.sub,
      permissoes: user.permissions ?? [],
    });
  }

  @Get()
  @RequirePermissions('dashboard.ver')
  minha(@CurrentUser() user: JwtUser): Promise<CaixaResposta> {
    return this.caixa.montar({
      orgId: user.orgId,
      usuarioId: user.sub,
      permissoes: user.permissions ?? [],
      comConversa: true,
    });
  }
}
