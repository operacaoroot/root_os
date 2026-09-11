import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/*
 * O GUARDA DE SESSÃO — e por que conferir a assinatura não bastava.
 *
 * Até 11/09/2026 este guarda fazia UMA pergunta: "este token foi assinado pela
 * nossa chave?". A resposta era sim para tokens que não são sessão nenhuma.
 *
 * O caso concreto, medido: `GoogleLoginService.authUrl()` assina, com o MESMO
 * `JwtService`, um token de PROPÓSITO — `{ purpose: 'google-login' }`, 10
 * minutos, sem `sub` e sem `orgId` — e o publica no parâmetro `state` da URL que
 * `GET /api/auth/google/start` devolve, que é anônima. Quem chamasse aquela rota
 * lia o `state` no `Location`, mandava de volta como `Authorization: Bearer` e
 * virava "usuário autenticado": `GET /api/auth/me` respondia 200, com os campos
 * vazios. O que segurava o resto era acidente — o `PermissionsGuard` recusa quem
 * não tem permissão, e o gate de módulos devolve 404 quando há usuário sem
 * empresa (`tenants/modulos.interceptor.ts`). Nenhum dos dois é o guarda de
 * sessão, e nenhum dos dois cobre rota sem permissão declarada.
 *
 * A partir daqui, todo token que este sistema emite diz para que serve (`typ`),
 * e este guarda só aceita `sessao`. A prova de reautenticação (`typ: 'reauth'`)
 * e o `state` do login com Google (`typ: 'estado-login'`) morrem aqui, mesmo
 * assinados com a chave certa.
 *
 * A TOLERÂNCIA, E A DATA EM QUE ELA SE FECHA SOZINHA
 * Token sem `typ` ainda é aceito, DESDE QUE tenha `sub` e `orgId` — é a sessão
 * emitida antes desta mudança, que vale por até oito horas. Ela não é forjável
 * (o `state` do Google não tem `sub` nem `orgId`, então não passa nem por aqui),
 * mas era uma janela sem prazo: nenhum teste ficava vermelho, nenhuma data
 * aparecia no código, e o comentário se lia como desenho definitivo. Toda
 * tolerância sem relógio vira permanente.
 *
 * Agora ela tem hora marcada. `FIM_DA_TOLERANCIA_SEM_TYP` é 12/09/2026 às 12:00
 * UTC — mais de oito horas depois do deploy desta mudança, que é o que a sessão
 * mais velha ainda viva pode durar (`signOptions.expiresIn: '8h'`). Passada a
 * data, token sem `typ` é recusado sem exceção, e a regra dupla morre sem
 * ninguém precisar lembrar de apagá-la.
 *
 * O `typ` da sessão mora AQUI, e não em `auth.service.ts`, porque quem o confere
 * é este guarda — e assim conferir um token não arrasta o serviço de
 * autenticação inteiro (prisma, bcrypt) para quem só quer validar.
 */
export const TIPO_DA_SESSAO = 'sessao';

/**
 * O instante em que a tolerância com o token sem `typ` acaba. Depois disto o
 * guarda exige `typ: 'sessao'` e ponto — inclusive nos testes, que congelam o
 * relógio dos dois lados desta data para provar as duas metades da regra.
 */
export const FIM_DA_TOLERANCIA_SEM_TYP = new Date('2026-09-12T12:00:00Z');

interface ClaimsDeSessao {
  typ?: string;
  sub?: string;
  orgId?: string;
}

/**
 * O token é uma SESSÃO de gente desta casa, e não outro token nosso qualquer?
 *
 * `agora` é parâmetro para que o teste possa medir os dois lados do prazo sem
 * mexer no relógio do processo inteiro.
 */
export function ehTokenDeSessao(
  claims: ClaimsDeSessao | null | undefined,
  agora: Date = new Date(),
): boolean {
  if (!claims) return false;
  if (claims.typ) return claims.typ === TIPO_DA_SESSAO;
  // Sem `typ`: a janela já fechou? Então nem a forma de sessão salva.
  if (agora >= FIM_DA_TOLERANCIA_SEM_TYP) return false;
  // Dentro da janela: só passa o que tem a forma de uma sessão. Ver acima.
  return typeof claims.sub === 'string' && claims.sub.length > 0 &&
    typeof claims.orgId === 'string' && claims.orgId.length > 0;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers['authorization'] as string | undefined;
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Sem token');
    }

    let claims: ClaimsDeSessao;
    try {
      claims = await this.jwt.verifyAsync<ClaimsDeSessao>(auth.slice(7));
    } catch {
      throw new UnauthorizedException('Token inválido');
    }

    /*
     * Mensagem propositalmente igual à do token inválido: quem apresenta um
     * token de propósito como se fosse sessão não precisa aprender, pela
     * resposta, que existem outros tipos de token e qual deles ele tem.
     */
    if (!ehTokenDeSessao(claims)) throw new UnauthorizedException('Token inválido');

    req.user = claims;
    return true;
  }
}
