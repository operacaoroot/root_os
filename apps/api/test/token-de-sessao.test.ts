import { describe, it, expect, beforeAll } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import type { ExecutionContext } from '@nestjs/common';
import {
  FIM_DA_TOLERANCIA_SEM_TYP,
  JwtAuthGuard,
  TIPO_DA_SESSAO,
  ehTokenDeSessao,
} from '../src/auth/jwt-auth.guard';
import { enderecoDeOrigem } from '../src/auth/endereco-de-origem';
import { LOGIN_STATE_PREFIX, TIPO_DO_ESTADO } from '../src/auth/google-login.service';
import { TIPO_DA_PROVA } from '../src/auth/reauth.service';

/*
 * TOKEN DE PROPÓSITO NÃO É TOKEN DE SESSÃO.
 *
 * O achado, medido antes desta fatia: `GoogleLoginService.authUrl()` assina, com
 * o MESMO `JwtService` da sessão, um token de propósito — `{ purpose:
 * 'google-login' }`, 10 minutos, sem `sub` e sem `orgId` — e o publica no
 * parâmetro `state` da URL devolvida por `GET /api/auth/google/start`, que é
 * anônima. Como o `JwtAuthGuard` conferia só a ASSINATURA, bastava ler aquele
 * `state` no `Location`, devolvê-lo como `Authorization: Bearer` e virar
 * "usuário autenticado": `GET /api/auth/me` respondia 200.
 *
 * O que continha o resto era acidente de arquitetura — o `PermissionsGuard`
 * recusa quem não tem permissão declarada, e o gate de módulos devolve 404
 * quando há usuário sem empresa. Nenhum dos dois é o guarda de sessão, e nenhum
 * dos dois cobre rota autenticada sem permissão declarada, que é o caso de
 * `/auth/me`.
 *
 * Esta suíte NÃO precisa de banco: o que ela mede é a decisão do guarda sobre um
 * token, e é por isso que ela roda sempre — inclusive na CI sem
 * `TEST_DATABASE_URL`, onde as suítes de aprovação se pulam.
 */
describe('o guarda de sessão só aceita token de sessão', () => {
  let jwt: JwtService;

  /** Um contexto de execução do Nest com o cabeçalho que interessa. */
  const contextoCom = (authorization?: string) => {
    const req: { headers: Record<string, string>; user?: unknown } = {
      headers: authorization ? { authorization } : {},
    };
    return {
      req,
      ctx: {
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext,
    };
  };

  beforeAll(() => {
    jwt = new JwtService({ secret: 'segredo-desta-suite' });
  });

  it('aceita a sessão que o produto emite', async () => {
    const guarda = new JwtAuthGuard(jwt);
    const token = jwt.sign({
      typ: TIPO_DA_SESSAO,
      sub: 'u-1',
      orgId: 'org-1',
      roles: ['admin_master'],
      permissions: ['mcp.executar'],
    });

    const { ctx, req } = contextoCom(`Bearer ${token}`);
    await expect(guarda.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toMatchObject({ sub: 'u-1', orgId: 'org-1' });
  });

  it('RECUSA o `state` do login com Google apresentado como sessão', async () => {
    const guarda = new JwtAuthGuard(jwt);
    // Exatamente o que `authUrl()` assina, e que sai numa rota anônima.
    const estado = jwt.sign({ typ: TIPO_DO_ESTADO, purpose: 'google-login' }, { expiresIn: '10m' });

    const { ctx, req } = contextoCom(`Bearer ${estado}`);
    await expect(guarda.canActivate(ctx)).rejects.toThrow(/Token inválido/i);
    expect(req.user).toBeUndefined();

    // E o valor que vai na URL é o token com prefixo — o prefixo sozinho não
    // muda nada para o guarda, que recebe o `Bearer` sem ele.
    expect(`${LOGIN_STATE_PREFIX}${estado}`.startsWith(LOGIN_STATE_PREFIX)).toBe(true);
  });

  it('RECUSA o `state` no formato ANTIGO, que nem `typ` tinha', async () => {
    // A versão que estava no ar: sem `typ`, sem `sub`, sem `orgId`. É a que
    // atravessava o guarda. A tolerância a tokens sem `typ` (sessões emitidas
    // antes do deploy) não a alcança, porque ela exige `sub` E `orgId`.
    const guarda = new JwtAuthGuard(jwt);
    const antigo = jwt.sign({ purpose: 'google-login' }, { expiresIn: '10m' });

    const { ctx } = contextoCom(`Bearer ${antigo}`);
    await expect(guarda.canActivate(ctx)).rejects.toThrow(/Token inválido/i);
  });

  it('RECUSA a prova de reautenticação apresentada como sessão', async () => {
    // A prova de R4 é assinada com a mesma chave e TEM `sub`. Sem o `typ`, ela
    // seria um token de sessão de cinco minutos com os poderes da pessoa.
    const guarda = new JwtAuthGuard(jwt);
    const prova = jwt.sign(
      { typ: TIPO_DA_PROVA, sub: 'u-1', org: 'org-1', apr: 'aprovacao-1' },
      { expiresIn: '5m' },
    );

    const { ctx } = contextoCom(`Bearer ${prova}`);
    await expect(guarda.canActivate(ctx)).rejects.toThrow(/Token inválido/i);
  });

  it('a tolerância a token SEM `typ` só cobre o que tem cara de sessão', () => {
    // A regra dupla existe por uma janela de 8h após o deploy: sessão emitida
    // antes desta mudança não declara `typ`. Ela passa por ter `sub` e `orgId`
    // — e é isso que nenhum token de propósito tem.
    expect(ehTokenDeSessao({ sub: 'u-1', orgId: 'org-1' })).toBe(true);
    expect(ehTokenDeSessao({ sub: 'u-1' })).toBe(false);
    expect(ehTokenDeSessao({ orgId: 'org-1' })).toBe(false);
    expect(ehTokenDeSessao({})).toBe(false);
    expect(ehTokenDeSessao(null)).toBe(false);
    // `typ` declarado manda sozinho: um token que diz o que é não ganha a
    // tolerância de volta por acaso.
    expect(ehTokenDeSessao({ typ: TIPO_DA_PROVA, sub: 'u-1', orgId: 'org-1' })).toBe(false);
    expect(ehTokenDeSessao({ typ: TIPO_DA_SESSAO })).toBe(true);
  });

  it('a tolerância tem PRAZO, e ela se fecha sozinha', () => {
    /*
     * A tolerância não é forjável — nenhum token de propósito nosso tem `sub` e
     * `orgId` —, mas era uma janela sem relógio: nada a fechava, nenhum teste
     * ficava vermelho, e o comentário se lia como desenho definitivo. Toda
     * tolerância sem prazo vira permanente.
     *
     * Agora ela tem data (`FIM_DA_TOLERANCIA_SEM_TYP`, mais de 8h depois do
     * deploy — o tempo de vida da sessão mais velha). Estas duas linhas são os
     * dois lados do prazo, sem depender do relógio de quem roda a suíte.
     */
    const umMinuto = 60 * 1000;
    const antes = new Date(FIM_DA_TOLERANCIA_SEM_TYP.getTime() - umMinuto);
    const depois = new Date(FIM_DA_TOLERANCIA_SEM_TYP.getTime() + umMinuto);

    expect(ehTokenDeSessao({ sub: 'u-1', orgId: 'org-1' }, antes)).toBe(true);
    expect(ehTokenDeSessao({ sub: 'u-1', orgId: 'org-1' }, depois)).toBe(false);

    // O que declara `typ` não depende do prazo, nos dois sentidos.
    expect(ehTokenDeSessao({ typ: TIPO_DA_SESSAO, sub: 'u-1', orgId: 'org-1' }, depois)).toBe(true);
    expect(ehTokenDeSessao({ typ: TIPO_DA_PROVA, sub: 'u-1', orgId: 'org-1' }, antes)).toBe(false);
  });

  it('o endereço registrado vem do proxy confiado, e nunca de um cabeçalho solto', () => {
    /*
     * `req.ip` atrás do Traefik era o endereço do PROXY: toda linha do RASTRO
     * gravava o mesmo, e a auditoria de tentativa repetida de senha ficava sem
     * a única coluna que diz de onde veio. `app.set('trust proxy', 1)` entrou em
     * `src/main.ts` na estabilização da onda 5 (11/09/2026), e a partir dele o
     * Express popula `req.ips` com a cadeia JÁ PODADA pelo salto confiado.
     * Medido de ponta a ponta na API compilada: login com
     * `X-Forwarded-For: 203.0.113.77, 10.1.1.1` gravou `10.1.1.1` (o endereço
     * que falou com o proxy), e não `203.0.113.77` (o que o chamador digitou).
     *
     * O que NÃO pode acontecer é este código ler `X-Forwarded-For` por conta
     * própria: o cabeçalho é escrito por quem chama, e aceitá-lo sem um proxy
     * declarado confiável trocaria um endereço inútil por um endereço FALSO,
     * escolhido pelo atacante. Quem decide em quem confiar é o `trust proxy`,
     * num lugar só.
     */
    expect(enderecoDeOrigem({ ip: '10.0.0.7' })).toBe('10.0.0.7');
    // Com `trust proxy` ligado, o Express entrega a cadeia já podada.
    expect(enderecoDeOrigem({ ip: '172.18.0.2', ips: ['203.0.113.9', '172.18.0.2'] })).toBe(
      '203.0.113.9',
    );
    // Sem `trust proxy`, `req.ips` vem vazio mesmo com o cabeçalho presente.
    expect(enderecoDeOrigem({ ip: '172.18.0.2', ips: [] })).toBe('172.18.0.2');
    expect(enderecoDeOrigem(undefined)).toBeUndefined();
    expect(enderecoDeOrigem({})).toBeUndefined();
  });

  it('sem cabeçalho, ou com assinatura de outra chave, continua recusando', async () => {
    const guarda = new JwtAuthGuard(jwt);
    await expect(guarda.canActivate(contextoCom().ctx)).rejects.toThrow(/Sem token/i);

    const outro = new JwtService({ secret: 'outra-chave-qualquer' });
    const forjado = outro.sign({ typ: TIPO_DA_SESSAO, sub: 'u-1', orgId: 'org-1' });
    await expect(guarda.canActivate(contextoCom(`Bearer ${forjado}`).ctx)).rejects.toThrow(
      /Token inválido/i,
    );
  });
});
