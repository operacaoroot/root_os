import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  NotFoundException,
} from '@nestjs/common';
import { Observable, from, mergeMap, throwError } from 'rxjs';
import { contextoAtual } from '../common/contexto-execucao';
import { ModulosService } from './modulos.service';
import { PrefixoNaoDeclaradoError, moduloDoCaminho } from './modulos';

/**
 * A empresa desta requisição, ou `null` quando não há nenhuma UTILIZÁVEL.
 *
 * O contexto de execução manda; `req.user.orgId` é a rede (mesma fonte, não um
 * segundo caminho). String em branco vira `null` de propósito: para a linguagem
 * `'   '` é verdadeira, escorregaria adiante e estouraria lá dentro como erro
 * interno. O valor devolvido é o BRUTO, sem `trim` — aparar aqui faria
 * `' abc '` virar consulta pela empresa `abc`, que é o oposto de recusar.
 */
function empresaDaRequisicao(req: { user?: { orgId?: unknown } } | undefined): string | null {
  const bruto: unknown = contextoAtual()?.orgId ?? req?.user?.orgId;
  return typeof bruto === 'string' && bruto.trim() !== '' ? bruto : null;
}

/*
 * O GATE DE MÓDULOS — RF-T-06
 *
 * Recusa a rota de um módulo que o tenant não contratou. É a metade que
 * importa: o menu do web já esconde o item, e menu que esconde sem a API
 * recusar é fachada — quem digitar a URL entra.
 *
 * POR QUE INTERCEPTOR E NÃO GUARD (a fatia pedia "um guard")
 * Porque um guard GLOBAL não teria como saber de que empresa é a requisição. No
 * Nest a ordem é: guards globais -> guards de controller -> guards de rota ->
 * interceptors -> handler. O `JwtAuthGuard` deste projeto é declarado POR
 * CONTROLLER (`@UseGuards(JwtAuthGuard, PermissionsGuard)`), então quando um
 * guard global roda, `req.user` ainda não existe e o contexto de execução ainda
 * não foi aberto — um guard de módulos veria toda requisição como anônima e
 * liberaria tudo, calado.
 *
 * As saídas eram três: (a) pôr o guard em cada controller, o que é editar 27
 * arquivos e esquecer o 28º; (b) verificar o token de novo aqui dentro,
 * duplicando a autenticação; (c) rodar depois dos guards, que é o que
 * interceptor faz. A (c) é a única que não cria um segundo caminho para a
 * mesma coisa. Do lado de fora nada muda: a resposta é o mesmo 404.
 *
 * COMO ELE ACHA O TENANT
 * Pelo contexto de execução (`contextoAtual()`), que é o caminho da casa desde
 * a fatia 1.2 — o `ContextoInterceptor` é registrado antes deste (o
 * `ContextoModule` é o primeiro import do `AppModule`) e interceptor registrado
 * antes ENVOLVE o registrado depois, então quando este código roda o escopo já
 * está aberto. `req.user?.orgId` fica como rede: é a MESMA fonte de onde o
 * contexto se abastece, não um segundo caminho, e cobre o dia em que alguém
 * reordenar os imports do `AppModule` sem perceber.
 *
 * SEM EMPRESA: PASSA SE FOR ANÔNIMA, RECUSA SE TIVER USUÁRIO
 * As duas coisas chegam aqui como "orgId nulo" e são opostas.
 *
 *  - REQUISIÇÃO ANÔNIMA é rota pública (nenhum guard rodou, `req.user` não
 *    existe). Não há tenant a resolver, e recusar seria recusar para TODO
 *    mundo, inclusive para quem contratou. Passa. Ver a lista abaixo.
 *  - USUÁRIO PRESENTE E EMPRESA AUSENTE é anomalia: todo token de sessão que
 *    este sistema emite carrega `orgId` (`AuthService.issueSession`). Um token
 *    válido sem empresa só aparece por engano ou por abuso — e o abuso EXISTE
 *    hoje: `GoogleLoginService.authUrl()` assina, com o MESMO `JwtService`, um
 *    token de PROPÓSITO (`{ purpose: 'google-login' }`, 10 min, sem `sub` e sem
 *    `orgId`) e o publica no parâmetro `state` da URL devolvida por
 *    `GET /api/auth/google/start`, que é anônima. O `JwtAuthGuard` só confere a
 *    assinatura, não o propósito: mandado como `Bearer`, esse token vira
 *    "usuário autenticado" sem empresa. Enquanto tratávamos isso como rota
 *    pública, ele atravessava TODAS as rotas de módulo; o que segurava era o
 *    `PermissionsGuard` — ou seja, a contenção era acidental, dependia de cada
 *    rota declarar permissão. Aqui a resposta é o mesmo 404.
 *    (O buraco em si é do módulo de autenticação e está em PERGUNTAS da fatia:
 *    token de propósito não deveria passar por guarda de sessão.)
 *  - EMPRESA EM BRANCO (`'   '`) conta como ausente. Para a linguagem ela é
 *    verdadeira e escorregaria adiante até `ModulosService`, que LANÇA
 *    `SemTenantError` — erro não-HTTP, que o Nest devolve como 500 com o
 *    interno cru no corpo.
 *
 * ROTA PÚBLICA NÃO É BLOQUEÁVEL — e isso é decisão, não esquecimento
 * Dentro de prefixos de módulo existem rotas sem autenticação nenhuma:
 *
 *   - `POST /api/events/track` (prefixo `events`, módulo `pixels`) — o pixel
 *     roda no browser do visitante;
 *   - `GET /api/bio/public/page/:handle`, `POST /api/bio/public/track`,
 *     `GET /api/bio/r/:linkId` e `GET /api/bio/avatar/:arquivo` (módulo `bio`);
 *   - `GET /api/conectar/:plataforma/callback` (módulo `bio`) — retorno do
 *     OAuth de Instagram/TikTok, path travado porque é a redirect cadastrada
 *     nos consoles (mudar exige recadastrar e refazer as conexões);
 *   - `GET /api/meta/callback` (prefixo `meta`, módulo `instagram`) — retorno
 *     do OAuth do Facebook, na mesma situação e esquecido da primeira versão
 *     desta lista.
 *
 * O QUE ISSO REALMENTE DEIXA ABERTO — medido, não estimado:
 *
 *   - `events/track` ESCREVE EM TENANT CLIENTE, e o gate não contém.
 *     Isto MUDOU na fatia 1.4 e a frase anterior aqui ficou falsa: até ela, a
 *     rota resolvia a empresa por `slug: 'root'` fixo, então desligar `pixels`
 *     de um cliente de fato não deixava superfície dele no ar. Hoje a empresa
 *     sai da CHAVE DO PIXEL (`events/pixel-tenant.service.ts`), que é o `id` da
 *     `Org`: quem tem a chave grava `PixelEvent` NAQUELA empresa, sem
 *     credencial nenhuma, **com o módulo `pixels` desligado inclusive** — a
 *     resolução é do controller, não passa por aqui, e este gate libera rota
 *     anônima de propósito. Sem chave, o evento continua caindo na empresa
 *     PADRÃO (o resto da mesma dívida herdada).
 *     O que limita o estrago não é este gate: é a chave ser uuid (não se
 *     adivinha) e a rota devolver sempre a mesma resposta (não serve de oráculo
 *     de "esta empresa existe"). Quem instala o pixel numa página pública
 *     publica a chave para quem ler o HTML — e essa pessoa injeta evento
 *     naquela empresa, `value` incluído. Fechar isso é a chave por SITE, com
 *     domínio declarado e teto de taxa (`PixelSite`), descrita em
 *     `pixel-tenant.service.ts`; enquanto ela não existir, **desligar o módulo
 *     `pixels` de um cliente NÃO desliga a ingestão dele**.
 *   - `conectar/:plataforma/callback` NÃO é porta: exige um `BioOauthState`
 *     gravado, e quem grava é `BioService` a partir de rota autenticada do
 *     prefixo `bio` — que este gate recusa. Sem o estado, o callback devolve
 *     "expirado".
 *   - `meta/callback` usa como `state` o próprio `orgId`, sem registro
 *     guardado. Ele não chega a escrever sem um `code` válido emitido pela Meta
 *     para este app, mas também não é contido por este gate. Fica declarado.
 *   - SOBRA A BIO, e é real: com o módulo `bio` desligado, a página pública, o
 *     redirecionamento de link, o avatar e o rastreamento continuam servindo — e
 *     `public/track` e `r/:linkId` continuam GRAVANDO (clique, `PixelEvent`) na
 *     empresa daquele handle. Desligar o módulo tira a tela e a API do painel,
 *     não a superfície pública; derrubá-la é despublicar a página, decisão do
 *     produto e não deste gate. Está em RISCOS do relatório da fatia.
 */
@Injectable()
export class ModulosInterceptor implements NestInterceptor {
  private readonly log = new Logger('Modulos');

  constructor(private readonly modulos: ModulosService) {}

  intercept(execCtx: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Cron e chamada interna não passam por rota: não há caminho para gatear.
    if (execCtx.getType() !== 'http') return next.handle();

    const req = execCtx.switchToHttp().getRequest();
    const caminho: string = req?.originalUrl ?? req?.url ?? '';

    let modulo: ReturnType<typeof moduloDoCaminho>;
    try {
      modulo = moduloDoCaminho(caminho);
    } catch (erro) {
      if (!(erro instanceof PrefixoNaoDeclaradoError)) throw erro;
      /*
       * Prefixo que ninguém declarou. O teste estático (`modulos-por-tenant`)
       * reprova isso antes de qualquer deploy, então chegar aqui significa que
       * a suíte foi pulada. LIBERA, e grita: derrubar rota de cliente por causa
       * de uma linha esquecida numa tabela seria trocar um vazamento potencial
       * por uma queda certa. A escolha oposta (fechar) transformaria todo
       * controller novo em 404 até alguém descobrir por quê.
       */
      this.log.error(`${erro.message} — rota LIBERADA; declare o prefixo`);
      return next.handle();
    }

    // Espinha do OS: nunca desliga, para tenant nenhum.
    if (!modulo) return next.handle();

    const orgId = empresaDaRequisicao(req);
    if (!orgId) {
      /*
       * Anônima: é rota pública dentro de prefixo de módulo. Passa — ver o
       * cabeçalho. `req.user` é o sinal certo de "algum guard autenticou",
       * porque o token de propósito do login com Google não tem nem `sub` nem
       * `orgId`: pelo contexto de execução ele seria indistinguível de anônimo.
       */
      if (req?.user == null) return next.handle();
      /*
       * Autenticado e sem empresa: RECUSA, com o mesmo 404 do módulo
       * desligado. Nenhum token de sessão deste sistema nasce assim; deixar
       * passar é o que fazia um token de propósito atravessar todo prefixo de
       * módulo (ver cabeçalho).
       */
      this.log.warn(`token autenticado sem empresa em rota de módulo: ${caminho}`);
      return throwError(() => new NotFoundException('Não encontrado'));
    }

    return from(this.modulos.modulosDaOrg(orgId)).pipe(
      mergeMap((ligados) => {
        if (ligados.has(modulo)) return next.handle();
        /*
         * 404 e não 403, de propósito. 403 confirmaria que a rota existe e que
         * o módulo existe — para um tenant que não contratou o produto, essa é
         * informação sobre o produto de outro cliente. Do lado de fora, módulo
         * não contratado tem de ser indistinguível de rota que não existe.
         * A mensagem também não nomeia o módulo pelo mesmo motivo; quem
         * precisa do diagnóstico tem a correlação no cabeçalho e esta linha de
         * log.
         */
        this.log.warn(`módulo "${modulo}" não habilitado para a org ${orgId}: ${caminho}`);
        return throwError(() => new NotFoundException('Não encontrado'));
      }),
    );
  }
}
