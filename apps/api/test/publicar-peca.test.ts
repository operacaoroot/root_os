import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
/*
 * O IMPORT É DO FONTE, NÃO DO PACOTE PUBLICADO, e isso não é preciosismo.
 *
 * `@mktos/shared` resolve para `packages/shared/dist/`, que é ARTEFATO DE
 * BUILD: numa árvore onde ninguém rodou `pnpm --filter @mktos/shared build` ele
 * está velho, e hoje mesmo ele está — falta-lhe `aprovacoes.decidir`, que é uma
 * das quatro permissões medidas aqui. Uma catraca que lesse o build mediria o
 * repositório de ontem e diria que o caminho está ainda mais fechado do que
 * está. O fonte é a verdade; o build é uma fotografia dela.
 */
import { ROLES, type Permission } from '../../../packages/shared/src/permissions';

/*
 * ============================================================================
 * PUBLICAR PEÇA PELA TELA NÃO FUNCIONA PARA NINGUÉM — dívida DECLARADA
 * ============================================================================
 *
 * Esta suíte não prova que uma coisa funciona. Ela MEDE um defeito conhecido e
 * o mantém medido, para que ele não seja esquecido nem "consertado pela metade".
 *
 * ----------------------------------------------------------------------------
 * O QUE ESTÁ QUEBRADO
 * ----------------------------------------------------------------------------
 * `POST /pauta/pecas/:id/publicar` é `@SensitiveWrite('content')`: a rota exige
 * um `x-approval-token` confirmado e casado com `{status:'publicada'}`. A tela
 * (`apps/web/src/app/pauta/aprovacao.ts`) monta esse token em três passos, na
 * MESMA sessão e com o MESMO usuário:
 *
 *   1. `POST /approvals`            → a pessoa vira a PROPONENTE;
 *   2. `POST /approvals/:id/confirm`→ a mesma pessoa tenta ASSINAR;
 *   3. `POST /pauta/pecas/:id/publicar` com o token.
 *
 * O passo 2 é recusado sempre. `ApprovalsService.confirm` aplica a invariante 7
 * da escada — quem propôs não aprova — e o passo 1 gravou a própria pessoa como
 * proponente. Não é intermitente e não depende de dado: é aritmética.
 *
 * QUANDO QUEBROU: 29/08/2026, commit `3adfdc1` ("F4 · a porta: nenhuma ação de
 * agente passa sem classificação e sem registro"), que introduziu a regra. O
 * fluxo da tela é anterior a ela e nunca foi revisto.
 *
 * ----------------------------------------------------------------------------
 * A SEGUNDA CAUSA, MAIS ANTIGA E INDEPENDENTE
 * ----------------------------------------------------------------------------
 * Mesmo que o passo 2 passasse, o passo 3 exige DUAS permissões juntas —
 * `pauta.publicar` E `whatsapp.enviar` — e o `PermissionsGuard` casa com
 * `every`. `whatsapp.enviar` mora só no `admin_master`. Quem de fato publica no
 * produto (`gestor_marketing`, `social_media`) tem a primeira e não tem a
 * segunda.
 *
 * As duas causas juntas fecham a porta para TODO MUNDO: só o `admin_master`
 * passa pelas permissões, e é justamente ele que, sendo um só na empresa da
 * ROOT, não tem uma segunda pessoa para assinar — e, mesmo havendo, a tela pede
 * a assinatura a quem acabou de propor.
 *
 * ----------------------------------------------------------------------------
 * O CONSERTO — e por que ele NÃO foi feito aqui
 * ----------------------------------------------------------------------------
 * O caminho apontado é PROPOR EM NOME DO AGENTE, não da pessoa que clicou: quem
 * propõe ali é o sistema derivando a peça, e quem assina é a pessoa. Isso NÃO
 * afrouxa a separação de funções — ao contrário, faz o campo `propostoPorId`
 * dizer a verdade, já que `create` hoje grava `propostoPorTipo: ActorType.ai`
 * com o id de um humano dentro.
 *
 * Mas ele mora em `apps/api/src/approvals/approvals.service.ts` (e/ou no
 * controlador), e o recorte desta onda não inclui aquele diretório. Mexer nele
 * sem combinar seria decidir, por conta própria, que uma pessoa sozinha passa a
 * publicar — e isso é decisão de produto, não dedução de agente. Está no
 * relatório da onda; esta suíte é a prova de que a medição foi feita.
 *
 * ----------------------------------------------------------------------------
 * ESTA CATRACA FICA VERMELHA QUANDO O DEFEITO FOR CONSERTADO
 * ----------------------------------------------------------------------------
 * É o padrão de dívida declarada da casa (ver `DESFAZER_PENDURADO` em
 * `packages/policy/test/politica.test.ts`). Quando alguém arrumar qualquer uma
 * das duas causas, o caso correspondente falha com a mensagem dizendo o que
 * apagar aqui. Dívida que some calada é dívida que volta.
 */

const RAIZ_DA_API = join(__dirname, '..');
const RAIZ_DO_REPO = resolve(RAIZ_DA_API, '..', '..');

const ler = (rel: string): string => readFileSync(join(RAIZ_DO_REPO, rel), 'utf8');

/** As quatro permissões que UMA sessão precisa ter para publicar pela tela. */
const O_CAMINHO_INTEIRO: Permission[] = [
  'mcp.executar', // POST /approvals
  'aprovacoes.decidir', // POST /approvals/:id/confirm
  'pauta.publicar', // POST /pauta/pecas/:id/publicar
  'whatsapp.enviar', // idem — a segunda exigência da mesma rota
];

describe('publicar peça pela tela: a regressão de 29/08, medida', () => {
  it('CAUSA 1 — a tela propõe e confirma com o MESMO usuário, na mesma requisição', () => {
    const tela = ler('apps/web/src/app/pauta/aprovacao.ts');
    const ordem = [
      tela.indexOf("apiPost<Ticket>(\n    '/approvals'"),
      tela.indexOf('/confirm`'),
      tela.indexOf('/publicar`'),
    ];
    expect(
      ordem.every((i) => i >= 0),
      'o fluxo da tela mudou de forma — releia `publicarComAprovacao` antes de confiar nesta suíte',
    ).toBe(true);
    expect(ordem[0], 'propor tem de vir antes de confirmar').toBeLessThan(ordem[1]);
    expect(ordem[1], 'confirmar tem de vir antes de publicar').toBeLessThan(ordem[2]);

    // Um `token` só, o da sessão de quem clicou, nos três passos. É isto que
    // faz proponente e signatário serem a mesma pessoa.
    expect(
      (tela.match(/apiPost[<(]/g) ?? []).length,
      'propor e confirmar deixaram de ser duas chamadas de `apiPost` — releia o fluxo',
    ).toBe(2);
    expect(tela).toContain('token: string | null,');
    expect(tela).toContain('`Bearer ${token}`');
    // E nenhum segundo ator entra no caminho: um parâmetro `token` só, do começo
    // ao fim. É a assinatura do defeito.
    expect((tela.match(/\btoken\b(?!Hash)/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('CAUSA 1 — e o serviço grava quem clicou como proponente, e depois o recusa', () => {
    const servico = ler('apps/api/src/approvals/approvals.service.ts');

    // `create` (a superfície antiga, que é a que a tela usa) carimba o ator.
    expect(servico).toContain('propostoPorId: input.actorId,');
    // ...e declara que a proposta é da IA, com o id de um humano dentro. A
    // incoerência é o próprio conserto esperando para ser feito.
    expect(servico).toContain('propostoPorTipo: ActorType.ai,');

    // `confirm` recusa exatamente essa combinação.
    expect(servico).toContain('if (rec.propostoPorId === actorId) {');
    expect(servico).toContain("throw new ForbiddenException('Quem propôs a ação não pode aprová-la.');");

    /*
     * A REGRA NÃO É O DEFEITO, e não é ela que se mexe. O defeito é o
     * proponente carimbado. Se este caso ficar vermelho porque a regra saiu,
     * alguém afrouxou a separação de funções para fazer a tela funcionar — que
     * é exatamente o que o hand-off desta onda proíbe.
     */
  });

  it('CAUSA 2 — a rota de publicar exige duas permissões, e só o Admin Master tem as duas', () => {
    const rota = ler('apps/api/src/pauta/rodada.controller.ts');
    expect(rota).toContain("@RequirePermissions('pauta.publicar', 'whatsapp.enviar')");

    // O guard casa com `every`: são as DUAS, não uma delas.
    expect(ler('apps/api/src/auth/permissions.guard.ts')).toContain(
      'const ok = required.every((p) => perms.includes(p));',
    );

    const quemPublica = Object.entries(ROLES)
      .filter(([, papel]) =>
        O_CAMINHO_INTEIRO.every((p) => (papel.permissions as readonly Permission[]).includes(p)),
      )
      .map(([chave]) => chave);

    expect(
      quemPublica,
      '\nO CONJUNTO DE PERFIS QUE ALCANÇA O CAMINHO INTEIRO MUDOU.\n' +
        '  Se algum perfil de operação (gestor_marketing, social_media) entrou na lista,\n' +
        '  a CAUSA 2 foi consertada — apague este caso e diga isso no relatório.\n' +
        '  Se a lista esvaziou, alguém tirou permissão do Admin Master e piorou.\n',
    ).toEqual(['admin_master']);

    // E os dois perfis que de fato publicam no produto continuam de fora.
    for (const papel of ['gestor_marketing', 'social_media'] as const) {
      expect(
        (ROLES[papel].permissions as readonly Permission[]).includes('whatsapp.enviar'),
        `${papel} ganhou whatsapp.enviar — a CAUSA 2 mudou`,
      ).toBe(false);
      expect((ROLES[papel].permissions as readonly Permission[]).includes('pauta.publicar')).toBe(
        true,
      );
    }
  });

  it('CONCLUSÃO — nenhum perfil do repositório consegue publicar hoje', () => {
    /*
     * O fechamento das duas causas em uma frase, e é este caso que muda no dia
     * do conserto.
     *
     * `admin_master` é o único que passa pelas permissões — e é o único usuário
     * com alçada na empresa da ROOT hoje, então não existe segunda pessoa para
     * assinar. Mesmo que existisse, a tela pede a assinatura a quem acabou de
     * propor, na mesma requisição: o fluxo recusa antes de chegar em gente.
     */
    const soUmPerfilPassa = Object.entries(ROLES).filter(([, papel]) =>
      O_CAMINHO_INTEIRO.every((p) => (papel.permissions as readonly Permission[]).includes(p)),
    );
    expect(soUmPerfilPassa).toHaveLength(1);

    const tela = ler('apps/web/src/app/pauta/aprovacao.ts');
    const proponenteEhQuemAssina =
      tela.includes("'/approvals',") && tela.includes('/confirm`') && !tela.includes('agentSlug');
    expect(
      proponenteEhQuemAssina,
      '\nA TELA DEIXOU DE PROPOR EM NOME DE QUEM CLICOU.\n' +
        '  Se a proposta passou a sair em nome do AGENTE, a regressão foi consertada:\n' +
        '  apague esta suíte inteira e registre a data no relatório.\n',
    ).toBe(true);
  });
});
