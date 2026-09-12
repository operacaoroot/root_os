import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, mergeMap, throwError } from 'rxjs';

import { contextoAtual } from '../common/contexto-execucao';
import { AssinaturaService } from './assinatura.service';
import {
  CODIGO_ASSINATURA_SUSPENSA,
  acessoBloqueado,
  liberadoNaSuspensao,
  type EstadoDeAssinatura,
} from './assinatura';

/*
 * ============================================================================
 * O GATE DA SUSPENSÃO — RF-O-03
 * ============================================================================
 *
 * Recusa as rotas do produto para uma empresa suspensa, e deixa passar as poucas
 * de que ela precisa para entrar, entender e pagar (ver
 * `LIBERADOS_NA_SUSPENSAO`).
 *
 * ----------------------------------------------------------------------------
 * ELE SÓ ALCANÇA REQUISIÇÃO — e o que roda por temporizador NÃO passa por aqui
 * ----------------------------------------------------------------------------
 * `getType() !== 'http'` sai fora, e isso é honesto mas insuficiente: as ROTINAS
 * (`routines/rotinas.scheduler.ts`) rodam por tique, fora de qualquer rota, e
 * uma empresa suspensa continuaria com os agentes dela publicando para fora e
 * gastando o teto de modelo da ROOT depois de a plataforma ter cortado o acesso.
 * Quem fecha essa porta é o próprio agendador, que pergunta o estado de acesso
 * antes de disparar — ver a nota em `varrerEmpresa`. Não dá para fazer daqui:
 * interceptor não intercepta `setInterval`.
 *
 * ----------------------------------------------------------------------------
 * ELE NÃO APAGA NADA, E É POR ISSO QUE ELE EXISTE
 * ----------------------------------------------------------------------------
 * Esta é a única coisa que "suspender" faz com o sistema: uma resposta HTTP
 * muda. Nenhuma linha é removida, nenhum módulo é desligado, nenhuma credencial
 * é revogada, nenhum agendamento é cancelado. Reativar é a mesma coluna voltando
 * ao valor anterior, e o produto inteiro reaparece no estado em que estava —
 * porque ele nunca saiu de lá.
 *
 * ----------------------------------------------------------------------------
 * POR QUE INTERCEPTOR, E NÃO GUARD
 * ----------------------------------------------------------------------------
 * O mesmo motivo do `ModulosInterceptor`, e vale repetir porque é contraintuitivo:
 * no Nest, guard GLOBAL roda ANTES dos guards de controller — e o `JwtAuthGuard`
 * deste projeto é declarado por controller. Um guard global veria toda requisição
 * como anônima, e um gate que não enxerga o tenant libera tudo em silêncio.
 *
 * ----------------------------------------------------------------------------
 * O CACHE, E O QUE ELE CUSTA
 * ----------------------------------------------------------------------------
 * O gate roda em TODA requisição; sem memória, cada chamada de tela viraria uma
 * consulta a mais. Dez segundos, e não trinta como o gate de módulos: aqui a
 * janela tem consequência direta na experiência de quem acabou de pagar — quem
 * clica em "já paguei" e volta a ver a tela de bloqueio por meio minuto acha que
 * não funcionou. Por isso `AssinaturaService` não é quem guarda: o cache é deste
 * gate, e o caminho que reativa o esquece explicitamente (`esquecer`).
 *
 * NA DIREÇÃO OPOSTA a janela é inofensiva: uma empresa recém-suspensa continua
 * respondendo por até dez segundos. Suspensão por inadimplência não é revogação
 * de acesso de emergência.
 *
 * ----------------------------------------------------------------------------
 * FALHA ABERTA, DECLARADA
 * ----------------------------------------------------------------------------
 * Se a consulta de estado falhar (banco fora, timeout), o gate LIBERA e grita no
 * log. A escolha oposta — fechar — transformaria qualquer soluço de banco numa
 * suspensão geral da carteira, que é exatamente o acidente que a fatia existe
 * para não ter. O risco que ela assume é o inverso: uma empresa suspensa
 * atravessa enquanto o banco estiver ruim. Entre cobrar de menos por um minuto e
 * trancar quem pagou, a fatia escolhe o primeiro, por escrito.
 */

/** Quanto tempo o estado de uma empresa vale sem reler o banco. */
const VALIDADE_MS = 10_000;

@Injectable()
export class SuspensaoInterceptor implements NestInterceptor {
  private readonly log = new Logger('Suspensao');
  private readonly cache = new Map<string, { status: EstadoDeAssinatura | null; expiraEm: number }>();

  constructor(private readonly assinaturas: AssinaturaService) {}

  /** Descarta o que está guardado. Chamado por quem acabou de mudar o estado. */
  esquecer(orgId?: string): void {
    if (orgId) this.cache.delete(orgId);
    else this.cache.clear();
  }

  intercept(execCtx: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Cron e chamada interna não passam por rota: não há caminho para gatear.
    if (execCtx.getType() !== 'http') return next.handle();

    const req = execCtx.switchToHttp().getRequest();
    const caminho: string = req?.originalUrl ?? req?.url ?? '';

    /*
     * O CAMINHO INTEIRO, e não o primeiro segmento.
     *
     * Era `segmentoDaApi(caminho).cru`, e o gate liberava FAMÍLIAS. `tenants`
     * estava na lista por causa de `GET /tenants/modulos`, e com isso três
     * controllers novos da mesma onda (`tenants/onboarding`,
     * `tenants/plataforma`, `tenants/suporte`) nasceram alcançáveis por empresa
     * suspensa sem ninguém decidir isso. A normalização das duas grafias
     * continua — mora dentro de `liberadoNaSuspensao` agora, porque a decisão
     * precisa de mais de um segmento e `segmentoDaApi` só devolve o primeiro.
     */
    if (liberadoNaSuspensao(caminho)) return next.handle();

    /*
     * Sem empresa: passa. Ou é rota pública (a página da bio de um cliente
     * suspenso continua no ar — derrubá-la seria apagar a presença dele da
     * internet por causa de uma fatura, e isso é destruição de valor, não
     * cobrança), ou é anomalia que o gate de módulos já recusa com 404.
     */
    const bruto: unknown = contextoAtual()?.orgId ?? req?.user?.orgId;
    const orgId = typeof bruto === 'string' && bruto.trim() !== '' ? bruto : null;
    if (!orgId) return next.handle();

    return from(this.estado(orgId)).pipe(
      mergeMap((status) => {
        if (!acessoBloqueado(status)) return next.handle();
        return throwError(
          () =>
            new ForbiddenException({
              statusCode: 403,
              error: CODIGO_ASSINATURA_SUSPENSA,
              message:
                status === 'cancelada'
                  ? 'A assinatura desta empresa foi encerrada. Os dados continuam guardados: ' +
                    'reativar devolve o acesso completo, sem perda.'
                  : 'A assinatura desta empresa está suspensa por falta de pagamento. ' +
                    'Nada foi apagado: assim que o pagamento for confirmado, o acesso volta inteiro.',
              statusDaAssinatura: status,
            }),
        );
      }),
    );
  }

  private async estado(orgId: string): Promise<EstadoDeAssinatura | null> {
    const agora = Date.now();
    const guardado = this.cache.get(orgId);
    if (guardado && guardado.expiraEm > agora) return guardado.status;

    try {
      const status = await this.assinaturas.estadoDeAcesso(orgId);
      this.cache.set(orgId, { status, expiraEm: agora + VALIDADE_MS });
      return status;
    } catch (erro) {
      // Falha aberta, e alto. Ver o cabeçalho.
      this.log.error(
        `[assinatura] não consegui ler o estado da empresa ${orgId} — acesso LIBERADO: ` +
          `${erro instanceof Error ? erro.name : 'erro'}`,
      );
      return null;
    }
  }
}
