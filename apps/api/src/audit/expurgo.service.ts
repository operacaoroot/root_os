import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventLogService, TIPO_EXPURGO } from '../gateway/event-log.service';
import { comContexto, novaCorrelacao } from '../common/contexto-execucao';
import { AuditService } from './audit.service';

/*
 * O EXPURGO POR RETENÇÃO — a única porta por onde linha do RASTRO sai do banco
 * (RF-R-06).
 *
 * ----------------------------------------------------------------------------
 * ESTE SERVIÇO NÃO ESTÁ AO ALCANCE DA APLICAÇÃO EM OPERAÇÃO NORMAL
 * ----------------------------------------------------------------------------
 * "Nunca apagar evento do RASTRO" é 02-CONSTRAINTS, e a retenção precisa apagar.
 * A tensão se resolve tirando o caminho do dia a dia, em quatro camadas — e
 * TRÊS delas estão no banco, não aqui:
 *
 *  1. ELE NÃO ESTÁ EM MÓDULO NENHUM. Não é provider do `AuditModule` nem de
 *     qualquer outro: o injetor da API que está no ar não conhece esta classe, e
 *     `app.get(ExpurgoService)` estoura. Quem o constrói é
 *     `src/scripts/expurgar-rastro.ts`, à mão, com a conexão DONA. Até
 *     11/09/2026 ele era exportado de um módulo `@Global`, o que significava
 *     alcançável de qualquer lugar da aplicação — e a única coisa que impedia
 *     uma rota era não existir uma.
 *  2. `app_rastro_expurgar` começa com `ALTER TABLE ... DISABLE RULE`, que exige
 *     ser DONO da tabela. O papel da aplicação (`mktos_app`) recebe
 *     `ERROR: must be owner of table EventLog`. Medido em 11/09/2026.
 *  3. O EXECUTE da função é revogado de PUBLIC e do papel: sob `mktos_app` a
 *     chamada morre antes disso, em `permission denied for function`.
 *  4. `mktos_app` não tem o privilégio de DELETE em `EventLog` (REVOKE de duas
 *     migrations), e a policy `tenant_expurgo_retencao` só alcança linha
 *     VENCIDA, da PRÓPRIA empresa, que não seja o registro de um expurgo.
 *
 * QUAL DELAS ESTÁ DE PÉ ONDE A APLICAÇÃO RODA HOJE, dito sem maquiagem: (2),
 * (3) e (4) valem para o papel restrito. Para a conexão DONA — que é
 * superusuário na imagem `pgvector/pgvector:pg16` — nenhuma das três vale: ela
 * é dona, tem EXECUTE e atravessa policy. Quando a aplicação conecta como dono
 * (o padrão sem `TENANT_DATABASE_URL`), o que separa o expurgo de uma requisição
 * HTTP é a camada (1), e só ela. Por isso a camada (1) deixou de ser convenção e
 * virou ausência de registro no injetor, com catraca que varre TODOS os
 * controllers em `rastro-retencao.test.ts`.
 *
 * `conferirQuePodeExpurgar()` abaixo é o complemento: chamado da conexão errada,
 * o serviço RECUSA em vez de apagar zero linha em silêncio. Ela confere DUAS
 * coisas — ser dono (o `ALTER TABLE` da função exige) e atravessar o isolamento
 * (FORCE ROW LEVEL SECURITY vale para o dono também) —, e o porquê de a segunda
 * não ser zelo está no cabeçalho da própria função.
 *
 * ----------------------------------------------------------------------------
 * POR QUE VARRE EMPRESA POR EMPRESA
 * ----------------------------------------------------------------------------
 * O expurgo roda fora de requisição, logo sem empresa na sessão — e o isolamento
 * por linha está ligado com modo forçado. Havia dois caminhos: declarar este
 * arquivo na lista de chamadores de plataforma (abre o contexto INTEIRO, tiro
 * largo) ou abrir o contexto de CADA empresa e expurgar dentro dele. É o
 * segundo, e por dois motivos que se somam: o isolamento continua valendo
 * durante a operação, e o evento do expurgo nasce com o dono certo — que é
 * exatamente o que esta fatia exige.
 *
 * A própria função do banco cobra isso: ela recusa quando a sessão não tem
 * empresa resolvida e recusa quando a empresa pedida não é a da sessão. Não dá
 * para "expurgar tudo" nem por engano.
 *
 * DUAS CONSULTAS AQUI RODAM SEM EMPRESA, e elas são legítimas: a conferência de
 * conexão (que lê `pg_class` e `pg_roles`, não dado de ninguém) e a descoberta de
 * quais empresas têm linha vencida. As duas saem com `app.org_id` vazio e
 * levantam o aviso de inventário do gancho de sessão.
 *
 * ELAS NÃO PRECISAM DE ENTRADA NA LISTA DE CHAMADORES DE PLATAFORMA, e o
 * argumento é de impossibilidade, não de descuido: `TENANT_MODO=impor` EXIGE a
 * conexão do papel restrito (`criarPrismaService` recusa subir sem ela), e o
 * expurgo EXIGE a conexão dona. Os dois estados são mutuamente exclusivos —
 * então este código nunca roda sob `impor`, e o modo `observar` avisa e segue.
 * Se um dia o expurgo passar a rodar sob o papel restrito, ele não funcionaria
 * de qualquer forma: `ALTER TABLE` pede ser dono.
 *
 * ----------------------------------------------------------------------------
 * O EVENTO DO EXPURGO NASCE DENTRO DA TRANSAÇÃO QUE APAGA
 * ----------------------------------------------------------------------------
 * Apagar por retenção é, ele mesmo, um evento. Até 11/09/2026 este serviço
 * chamava a função, recebia a faixa e ESCREVIA O EVENTO DEPOIS, em outra
 * transação e sem `try`. Qualquer soluço no meio — e não só processo morto:
 * bastava o `registrar()` estourar — deixava a lacuna de `seq` sem explicação E
 * abortava a varredura inteira. A varredura seguinte não conserta, porque ela é
 * idempotente: não acha mais o que apagar, logo não tem o que registrar.
 *
 * Agora o INSERT do evento está DENTRO de `app_rastro_expurgar`, que já conhece
 * a faixa e já segura o ACCESS EXCLUSIVE da tabela. Ou apaga e registra, ou não
 * faz nada. Ver a migration `20260911120000_expurgo_registra_de_dentro`.
 *
 * O evento continua perene por duas garantias independentes: ele nasce com
 * `retencaoAte` no ano 9999, e o banco recusa apagar esse tipo (na policy e no
 * DELETE da função).
 */

/** Chamaram o expurgo da conexão errada. Tipo próprio para o teste cobrar. */
export class ExpurgoIndisponivelError extends Error {
  constructor(motivo: string) {
    super(
      `expurgo do rastro indisponível nesta conexão: ${motivo}. ` +
        'Ele roda com a conexão DONA das tabelas, num processo de manutenção — ' +
        'nunca pela aplicação em operação normal (RF-R-06).',
    );
    this.name = 'ExpurgoIndisponivelError';
  }
}

export interface ExpurgoDeEmpresa {
  orgId: string;
  apagados: number;
  /** A faixa de `seq` que sumiu. É ela que explica o buraco na cadeia. */
  seqDe: string | null;
  seqAte: string | null;
  diasDeRetencao: number;
  eventoId: string | null;
  /** Preenchido quando ESTA empresa falhou. A varredura segue nas outras. */
  erro?: string;
}

export interface ResumoDoExpurgo {
  corte: string;
  empresas: ExpurgoDeEmpresa[];
  apagados: number;
  /** Quantas empresas falharam. Zero é o normal; qualquer coisa acima pede olho. */
  falhas: number;
}

@Injectable()
export class ExpurgoService {
  private readonly log = new Logger('ExpurgoDoRastro');

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventLogService,
    /** O log antigo continua escrevendo em paralelo — é ele que a tela lê. */
    private readonly auditoria: AuditService,
  ) {}

  /**
   * Recusa alto quando a conexão não consegue expurgar — e são DUAS perguntas.
   *
   * ------------------------------------------------------------------------
   * POR QUE DUAS, e por que "sou o dono" sozinho era a pergunta errada
   * ------------------------------------------------------------------------
   * Até 11/09/2026 esta função perguntava só `pg_get_userbyid(relowner) =
   * current_user`. Ser dono é necessário — `app_rastro_expurgar` começa com
   * `ALTER TABLE "EventLog" DISABLE RULE`, e `ALTER TABLE` exige ser dono —,
   * mas NÃO é suficiente, e o comentário logo abaixo (em
   * `empresasComRastroVencido`) descrevia como "limite conhecido" exatamente o
   * desfecho que este conserto tira do caminho:
   *
   *   `EventLog` nasce com FORCE ROW LEVEL SECURITY, e **FORCE vale para o dono
   *   também**. Num banco em que o dono NÃO seja superusuário nem tenha
   *   BYPASSRLS, a varredura de descoberta roda sem empresa na sessão, a policy
   *   recorta tudo, `empresasComRastroVencido` devolve vazio, e o script
   *   imprime "Nenhuma empresa com rastro vencido" e sai com código 0. Zero
   *   apagado com ar de sucesso — obrigação de retenção descumprida sem ninguém
   *   saber, que é precisamente o modo de falha que esta conferência existe
   *   para impedir.
   *
   * O mesmo defeito foi encontrado e provado na fatia do COFRE
   * (`cofre/rotacao.service.ts`, `conferirQueAtravessaOIsolamento`): com um
   * papel dono e sem bypass, a rotação enxergava só a empresa da sessão — que
   * num script não existe — e reportava "nada a rotacionar". Aqui é a mesma
   * pergunta, sobre outra tabela.
   *
   * O atributo de papel NÃO é herdado por pertencimento a grupo em PostgreSQL,
   * então perguntar por `current_user` em `pg_roles` é a pergunta exata.
   *
   * A conferência de bypass é condicionada a `ligado AND forcado` para não dar
   * alarme falso onde o isolamento nunca foi ligado nesta tabela (um banco
   * descartável em que `app_rls_ligar()` não rodou): ali qualquer papel enxerga
   * tudo e a varredura é completa de qualquer jeito.
   *
   * Na implantação de hoje o dono (`mkt`) é superusuário e as duas passam. A
   * conferência existe para o dia em que isso mudar — e para que, quando mudar,
   * o expurgo PARE em vez de mentir.
   */
  async conferirQuePodeExpurgar(): Promise<void> {
    const r = await this.prisma.$queryRaw<
      { dono: boolean; papel: string; ignora: boolean; ligado: boolean; forcado: boolean }[]
    >`
      SELECT pg_get_userbyid(c.relowner) = current_user AS dono,
             current_user::text AS papel,
             COALESCE((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS ignora,
             c.relrowsecurity AS ligado,
             c.relforcerowsecurity AS forcado
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'EventLog'`;
    const linha = r[0];
    if (!linha) throw new ExpurgoIndisponivelError('a tabela EventLog não existe neste banco');

    if (!linha.dono) {
      throw new ExpurgoIndisponivelError(
        `conectado como "${linha.papel}", que não é dono de EventLog — ` +
          '`app_rastro_expurgar` começa com `ALTER TABLE ... DISABLE RULE` e estouraria dentro ' +
          'da função, no meio de um cron',
      );
    }

    if (!linha.ignora && linha.ligado && linha.forcado) {
      throw new ExpurgoIndisponivelError(
        `conectado como "${linha.papel}", que é dono de EventLog mas NÃO ignora o isolamento por ` +
          'linha (não é superusuário nem tem BYPASSRLS) numa tabela com FORCE ROW LEVEL SECURITY. ' +
          'Ser dono não basta: FORCE vale para o dono também. Sob este papel a varredura de ' +
          'descoberta enxergaria só a empresa da sessão — que num script não existe — e o expurgo ' +
          'sairia dizendo "nenhuma empresa com rastro vencido" com ar de sucesso, deixando a ' +
          'obrigação de retenção descumprida em silêncio. Use a MESMA conexão que roda migration ' +
          '(DATABASE_URL), ou dê BYPASSRLS ao papel de manutenção.',
      );
    }
  }

  /**
   * As empresas que têm linha vencida esperando.
   *
   * RODA SEM EMPRESA NA SESSÃO, de propósito: é a pergunta que descobre quais
   * empresas varrer. Só funciona numa conexão que ATRAVESSE o isolamento, e
   * `conferirQuePodeExpurgar()` já garantiu isso antes — ser dono não basta,
   * porque `EventLog` tem FORCE ROW LEVEL SECURITY e FORCE vale para o dono.
   *
   * ESTE É O CAMINHO DE PRODUÇÃO. Até 11/09/2026 ele nunca era exercitado: a
   * única chamada de `varrer()` era do teste, sempre com a lista de empresas
   * explícita. Agora o script de manutenção chama sem lista, e há caso próprio
   * em `rastro-retencao.test.ts` que passa por aqui.
   *
   * O QUE ERA "LIMITE CONHECIDO" AQUI VIROU RECUSA. Num PostgreSQL em que o dono
   * não ignore o isolamento, esta consulta devolveria vazio e o expurgo
   * reportaria zero apagados com ar de sucesso. Hoje ele nem chega aqui: a
   * conferência acima recusa alto. O aviso abaixo continua porque zero empresa
   * com rastro vencido é plausível — mas agora é plausível de verdade, não
   * mascarando policy.
   */
  async empresasComRastroVencido(corte: Date): Promise<string[]> {
    const linhas = await this.prisma.$queryRaw<{ orgId: string }[]>`
      SELECT DISTINCT "orgId"
        FROM "EventLog"
       WHERE "retencaoAte" < ${corte} AND "tipo" <> ${TIPO_EXPURGO}
       ORDER BY "orgId"`;
    if (linhas.length === 0) {
      this.log.log('nenhuma empresa com rastro vencido neste corte.');
    }
    return linhas.map((l) => l.orgId);
  }

  /**
   * Expurga todas as empresas que têm o que expurgar.
   *
   * `orgIds` explícito quando quem chama já sabe quais são (um expurgo de uma
   * empresa só, o teste). Sem ele, o serviço descobre — e é essa forma que o
   * script de manutenção usa.
   *
   * UMA EMPRESA QUE FALHA NÃO DERRUBA A VARREDURA. Antes, um erro em qualquer
   * empresa abortava tudo e as seguintes ficavam sem expurgo — sem ninguém
   * perceber, porque a obrigação de retenção não tem quem reclame dela. Agora a
   * falha fica na linha daquela empresa (`erro`), conta em `falhas`, e as outras
   * seguem. O estado de quem falhou é íntegro de qualquer jeito: o apagar e o
   * registrar são a mesma transação no banco.
   */
  async varrer(opcoes: { corte?: Date; orgIds?: string[] } = {}): Promise<ResumoDoExpurgo> {
    await this.conferirQuePodeExpurgar();

    const agora = new Date();
    /*
     * CORTE NO FUTURO É RECUSADO AQUI, e o piso de verdade está DENTRO da função
     * do banco (`LEAST(p_corte, now())`). Os dois, e não um só: este erro diz
     * ao operador que ele pediu algo sem sentido, em vez de silenciosamente
     * fazer outra coisa; o piso da função é o que protege quando a chamada não
     * passa por aqui. A policy não serve de piso na implantação de hoje — o dono
     * é superusuário e a atravessa.
     */
    const corte = opcoes.corte ?? agora;
    if (corte.getTime() > agora.getTime()) {
      throw new ExpurgoIndisponivelError(
        `corte em ${corte.toISOString()}, que é no futuro. Expurgo apaga o que JÁ venceu; ` +
          'uma data adiantada só poderia alcançar linha dentro do prazo.',
      );
    }

    const orgIds = opcoes.orgIds ?? (await this.empresasComRastroVencido(corte));

    const empresas: ExpurgoDeEmpresa[] = [];
    for (const orgId of orgIds) {
      // Uma de cada vez, e cada uma no contexto dela. Em paralelo, a transação
      // com `ALTER TABLE` de uma seguraria ACCESS EXCLUSIVE em `EventLog`
      // enquanto a outra espera — só serve para transformar o expurgo em fila
      // com cara de concorrência.
      try {
        empresas.push(await this.expurgarEmpresa(orgId, corte));
      } catch (e) {
        const erro = (e as Error).message;
        this.log.error(
          `[rastro] empresa ${orgId}: o expurgo FALHOU (${erro}). Nada foi apagado nela — o ` +
            'apagar e o registrar são a mesma transação. A varredura segue nas outras.',
        );
        empresas.push({
          orgId,
          apagados: 0,
          seqDe: null,
          seqAte: null,
          diasDeRetencao: 0,
          eventoId: null,
          erro,
        });
      }
    }

    return {
      corte: corte.toISOString(),
      empresas,
      apagados: empresas.reduce((s, e) => s + e.apagados, 0),
      falhas: empresas.filter((e) => e.erro).length,
    };
  }

  private async expurgarEmpresa(orgId: string, corte: Date): Promise<ExpurgoDeEmpresa> {
    return comContexto(
      {
        orgId,
        actorType: 'system',
        actorId: null,
        correlationId: novaCorrelacao('expurgo'),
        origem: 'cron',
      },
      async () => {
        const dias = await this.eventos.diasDeRetencao(orgId);

        /*
         * A chamada vai pelo cliente embrulhado de propósito: é ele que põe
         * `SET LOCAL app.org_id` na frente, e é disso que a função do banco
         * precisa para conferir que a empresa pedida é a da sessão.
         *
         * `dias` entra como parâmetro porque a HERANÇA do prazo (política quando
         * não há linha em `RastroRetencao`) é regra deste lado — reimplementá-la
         * em plpgsql criaria uma segunda fonte da verdade sobre quanto tempo a
         * prova de cada empresa fica.
         *
         * O EVENTO `rastro.expurgo` SAI DE DENTRO DESTA CHAMADA. Não escreva
         * outro aqui: seriam dois eventos para um expurgo, e o segundo, por
         * estar fora da transação, é justamente o que não se pode garantir.
         *
         * `::int` no terceiro parâmetro, e não é firula: o Prisma manda número
         * de JavaScript como `int8`, e `app_rastro_expurgar(text, timestamptz,
         * bigint)` NÃO EXISTE — o PostgreSQL devolve "function … does not
         * exist" em vez de chamar a de `int`. Medido em 11/09/2026: sem o cast,
         * TODA empresa falhava e a varredura reportava zero apagados.
         */
        const linhas = await this.prisma.$queryRaw<
          { apagados: bigint; seq_de: bigint | null; seq_ate: bigint | null; evento_id: string | null }[]
        >`SELECT * FROM app_rastro_expurgar(${orgId}, ${corte}, ${dias}::int)`;

        const r = linhas[0];
        const apagados = Number(r?.apagados ?? 0n);
        const seqDe = r?.seq_de != null ? r.seq_de.toString() : null;
        const seqAte = r?.seq_ate != null ? r.seq_ate.toString() : null;

        if (apagados === 0) {
          return { orgId, apagados: 0, seqDe: null, seqAte: null, diasDeRetencao: dias, eventoId: null };
        }

        /*
         * O LOG ANTIGO, em paralelo — é ele que a tela de auditoria lê enquanto
         * ela não passar a ler o novo (a fatia pede os dois vivos).
         *
         * Dentro de `try` porque ele NÃO é o rastro: o evento encadeado já está
         * gravado e comitado junto com o DELETE. Deixar uma falha de `AuditLog`
         * derrubar a varredura seria trocar a obrigação grande pela pequena.
         */
        try {
          await this.auditoria.log({
            orgId,
            actorType: 'system',
            action: TIPO_EXPURGO,
            entityType: 'EventLog',
            entityId: r?.evento_id ?? undefined,
            after: { apagados, seqDe, seqAte, diasDeRetencao: dias, corte: corte.toISOString() },
          });
        } catch (e) {
          this.log.warn(
            `[rastro] empresa ${orgId}: o expurgo foi gravado no RASTRO, mas o log antigo ` +
              `(AuditLog) recusou (${(e as Error).message}). A tela de auditoria não vai mostrar ` +
              'esta linha até o log antigo ser aposentado.',
          );
        }

        this.log.warn(
          `[rastro] empresa ${orgId}: ${apagados} evento(s) apagados por retenção ` +
            `(${dias} dias, seq ${seqDe}–${seqAte}). Registrado em ${r?.evento_id}.`,
        );

        return { orgId, apagados, seqDe, seqAte, diasDeRetencao: dias, eventoId: r?.evento_id ?? null };
      },
    );
  }
}
