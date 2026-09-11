import { BadRequestException, ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, RiskLevel } from '@prisma/client';
import {
  afrouxamentosDoDiff,
  avaliar,
  canonico,
  diffDePolitica,
  explicarRecusas,
  lerPolitica,
  lerDelta,
  recusasDaSobrescrita,
  redundanciasDoDelta,
  resolverPolitica,
  uniaoDosAfrouxamentos,
  verificarCatalogo,
  verificarReversibilidade,
  type Afrouxamento,
  type Capacidade,
  type Contexto,
  type Decisao,
  type DeltaPolitica,
  type DiffDePolitica,
  type Politica,
  type Sinal,
} from '@mktos/policy';
import politicaRoot from '@mktos/policy/politica-root.json';
import politicaMktos from '@mktos/policy/politica-marketing-os.json';
import { PrismaService } from '../prisma/prisma.service';
import { exigirTenant } from '../common/contexto-execucao';

/*
 * A CASCA do motor de política. A decisão em si continua sendo avaliar(), do
 * pacote puro, intocado — aqui mora só o I/O: carregar, cachear e persistir.
 * É essa divisão que permite o mesmo código decidir no painel, no MCP e no
 * simulador da tela da Régua.
 *
 * A POLÍTICA QUE VALE É A DO BANCO, NÃO A DO ARQUIVO
 * `recarregar()` prefere a `PolicyVersion` gravada à base empacotada no build.
 * Isso é de propósito — é o que permite cada empresa ter a sua —, mas tem um
 * efeito colateral que já custou tempo e vai custar de novo: **mudar um nível
 * em `politica-root.json` ou `politica-marketing-os.json` NÃO muda nada numa
 * instalação já semeada.** O arquivo diz R3, a produção continua decidindo R2,
 * e nada no código denuncia a diferença. Só volta a bater depois de
 * `pnpm --filter @mktos/api db:seed:politica` NAQUELE ambiente.
 *
 * Por isso o boot loga a procedência de cada política carregada (banco ou
 * arquivo) e a versão: é a linha que responde "por que a produção está
 * decidindo diferente do repositório" sem ninguém precisar abrir o banco.
 */
@Injectable()
export class PolicyService implements OnModuleInit {
  private readonly log = new Logger('PolicyService');
  /** Política resolvida por org. A chave '' é a base ROOT herdada. */
  private readonly cache = new Map<string, Politica>();
  /** Índice id → capacidade, por org, para não varrer o array a cada chamada. */
  private readonly indice = new Map<string, Map<string, Capacidade>>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.recarregar();
    await this.recarregarEmpresas();
  }

  /** A base empacotada no build. É o chão: nunca depende do banco estar bom. */
  private baseEmpacotada(): Politica {
    const base = lerPolitica(politicaRoot, 'politica-root.json');
    const delta = lerDelta(politicaMktos, 'politica-marketing-os.json');
    return resolverPolitica(base, delta);
  }

  async recarregar(orgId?: string): Promise<void> {
    const chave = orgId ?? '';
    try {
      const versao = await this.prisma.policyVersion.findFirst({
        where: { orgId: orgId ?? null, ativaAte: null },
        orderBy: { versao: 'desc' },
      });
      if (versao) {
        const doc = lerPolitica(versao.documento, `PolicyVersion ${versao.id}`);
        this.guardar(chave, doc);
        this.log.log(
          `política ${orgId ? `da empresa ${orgId} ` : 'base '}v${versao.versao} carregada ` +
            `DO BANCO (${doc.capacidades.length} capacidades) — os JSON do repositório não valem ` +
            'aqui até rodar db:seed:politica',
        );
        return;
      }
      /*
       * Empresa sem versão própria NÃO ganha entrada no cache: quem herda tem
       * de cair no '' a cada leitura, senão uma cópia da base fica congelada
       * sob a chave dela e a próxima mudança da base não a alcança.
       */
      if (orgId) {
        this.esquecer(orgId);
        return;
      }
    } catch (e) {
      /*
       * Documento malformado no banco NÃO pode derrubar a API inteira. Se o
       * onModuleInit lançar, o boot morre e ninguém entende por quê — e a
       * política volta a existir só no papel. Cai na base empacotada e grita.
       */
      this.log.error(
        `FALHA ao carregar a política do banco (${(e as Error).message}). ` +
          'Usando a base empacotada — a política POR EMPRESA não está valendo.',
      );
      if (orgId) {
        this.esquecer(orgId);
        return;
      }
    }
    this.guardar('', this.baseEmpacotada());
    this.log.warn(
      'nenhuma PolicyVersion base no banco: valendo a base EMPACOTADA do repositório. ' +
        'Rode db:seed:politica para que a política passe a ser versionada e auditável.',
    );
  }

  /**
   * Carrega a política PRÓPRIA de cada empresa que tem uma.
   *
   * Sem isto, a sobrescrita por empresa (RF-P-04) só valia até o próximo
   * restart: `onModuleInit` carregava a base e mais nada, `resolverCapacidade`
   * caía no índice de chave '' e a empresa voltava calada a decidir pela base
   * — com a versão dela gravada no banco, ativa, e ignorada.
   */
  async recarregarEmpresas(): Promise<void> {
    let orgIds: string[];
    try {
      const versoes = await this.prisma.policyVersion.findMany({
        where: { orgId: { not: null }, ativaAte: null },
        select: { orgId: true },
        distinct: ['orgId'],
      });
      orgIds = versoes.map((v) => v.orgId as string);
    } catch (e) {
      this.log.error(
        `FALHA ao listar as políticas por empresa (${(e as Error).message}). ` +
          'Todas as empresas vão decidir pela base — nenhuma sobrescrita está valendo.',
      );
      return;
    }
    for (const orgId of orgIds) await this.recarregar(orgId);
    if (orgIds.length) this.log.log(`${orgIds.length} empresa(s) com política própria carregada(s)`);
  }

  /** Tira a empresa do cache: a próxima leitura volta a cair na base herdada. */
  esquecer(orgId: string): void {
    this.cache.delete(orgId);
    this.indice.delete(orgId);
  }

  private guardar(chave: string, doc: Politica): void {
    this.cache.set(chave, doc);
    this.indice.set(chave, new Map(doc.capacidades.map((c) => [c.id, c as Capacidade])));
  }

  private politica(orgId: string): Politica {
    return this.cache.get(orgId) ?? this.cache.get('') ?? this.baseEmpacotada();
  }

  /** A base que TODA empresa herda: a do banco quando existe, a empacotada senão. */
  baseHerdada(): Politica {
    return this.cache.get('') ?? this.baseEmpacotada();
  }

  /**
   * O delta que esta empresa tem hoje. Vazio = ela herda tudo.
   *
   * Sai do banco e não do cache porque o cache guarda o documento RESOLVIDO —
   * o delta é o que a empresa escreveu, e é ele que se reaplica quando a base
   * muda.
   */
  async deltaDaEmpresa(orgId: string): Promise<DeltaPolitica | null> {
    const versao = await this.prisma.policyVersion.findFirst({
      where: { orgId: exigirTenant(orgId, 'PolicyService.deltaDaEmpresa'), ativaAte: null },
      orderBy: { versao: 'desc' },
      select: { delta: true },
    });
    if (!versao?.delta) return null;
    return lerDelta(versao.delta, `PolicyVersion de ${orgId}`);
  }

  /**
   * SOBRESCREVER A POLÍTICA DE UMA EMPRESA — RF-P-04 e RF-P-06.
   *
   * A empresa herda a base da ROOT e declara num delta só o que a operação dela
   * exigir. O resultado vira uma versão nova: a anterior é FECHADA (`ativaAte`),
   * nunca sobrescrita, porque o histórico existe para responder "o que estava
   * valendo naquele dia".
   *
   * Três travas, nesta ordem — e a ordem importa, porque cada uma só faz
   * sentido depois da anterior:
   *
   *  1. o documento resolvido é válido (esquema) e bate com a própria régua
   *     (`verificarCatalogo` + `verificarReversibilidade`). Catálogo inválido é
   *     erro de quem escreveu o delta, não decisão de ninguém: 400.
   *  2. documento igual ao que já está ativo não abre versão nova. Vem ANTES da
   *     trava seguinte de propósito: reaplicar a mesma sobrescrita (o que um
   *     provisionamento faz em todo deploy) não muda nada e não pode passar a
   *     exigir uma assinatura nova de quem já assinou.
   *  3. o que afrouxou exige responsável identificado e motivo escrito
   *     (`recusasDaSobrescrita`). Sem isso: 403 — é permissão, não sintaxe.
   *
   * CONTRA O QUE A TRAVA MEDE — o furo que custou esta fatia uma revisão
   * A trava come a UNIÃO dos afrouxamentos de DUAS referências: a base herdada
   * e o documento que estava valendo PARA ESTA EMPRESA. Medindo só contra a
   * base, toda redução em relação à versão anterior da própria empresa passava
   * sem responsável e sem motivo — bastava continuar igual ou acima da base.
   * A empresa subia uma capacidade de R2 para R4 e devolvia para R2 com um
   * delta VAZIO: versão nova, sem autor, motivo genérico, e o diff gravado
   * dizendo que nada mudou.
   *
   * TUDO DENTRO DE UMA TRANSAÇÃO, incluindo a LEITURA do número da versão:
   * lendo fora, duas sobrescritas simultâneas da mesma empresa calculavam o
   * mesmo `versao + 1` e a segunda morria em violação de unicidade — erro
   * interno onde o certo é tentar de novo com o número seguinte.
   */
  async sobrescrever(input: {
    orgId: string;
    delta: unknown;
    autorId?: string | null;
    motivo?: string | null;
  }): Promise<{
    versao: number;
    diffDaBase: DiffDePolitica;
    diffDaVersaoAnterior: DiffDePolitica | null;
    redundantes: string[];
    criada: boolean;
  }> {
    const orgId = exigirTenant(input.orgId, 'PolicyService.sobrescrever');
    const base = this.baseHerdada();

    let delta: DeltaPolitica;
    let resolvida: Politica;
    try {
      delta = lerDelta(input.delta, `sobrescrita da empresa ${orgId}`);
      resolvida = lerPolitica(resolverPolitica(base, delta), `sobrescrita da empresa ${orgId}`);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    const fora = [
      ...verificarCatalogo(resolvida)
        .filter((l) => !l.ok)
        .map((l) => `${l.id}: declarado=${l.declarado} calculado=${l.calculado}`),
      ...verificarReversibilidade(resolvida).map(
        (l) => `${l.id} (${l.nivel}): ${l.motivo}${l.desfazer ? ` → ${l.desfazer}` : ''}`,
      ),
    ];
    if (fora.length) {
      throw new BadRequestException(
        `a sobrescrita não bate com a régua e não foi aplicada:\n  ${fora.join('\n  ')}`,
      );
    }

    /*
     * O DIFF DE AUDITORIA é contra a BASE HERDADA: a pergunta que ele responde
     * é "o que esta empresa tem de diferente do que a ROOT entrega", e o ponto
     * de comparação precisa ser estável para o histórico servir de alguma
     * coisa. É o que vai na coluna `diffDaBase`.
     */
    const diffDaBase = diffDePolitica(base, resolvida);
    const redundantes = redundanciasDoDelta(base, delta);

    const aplicar = () =>
      this.prisma.$transaction(async (tx) => {
        const atual = await tx.policyVersion.findFirst({
          where: { orgId, ativaAte: null },
          orderBy: { versao: 'desc' },
        });

        /*
         * A IDEMPOTÊNCIA é contra a versão ATIVA, e não contra a base — foi
         * assim que o teste pegou o engano: reaplicar o mesmo delta tem diff
         * não-vazio contra a base (é justamente o que a empresa mudou) e abria
         * uma versão nova a cada chamada. Provisionamento roda em todo deploy;
         * a tabela que existe para dizer quem mudou o quê encheria de linhas
         * em que ninguém mudou nada.
         *
         * `canonico` e não `JSON.stringify`: o documento volta do Postgres como
         * JSONB, com as chaves em outra ordem — e `canonico` ignora chave com
         * valor indefinido, que é o que o banco descarta ao gravar.
         */
        const naoMudaNada = atual
          ? canonico(atual.documento) === canonico(resolvida)
          : diffDaBase.capacidades.length === 0 &&
            diffDaBase.limites.length === 0 &&
            diffDaBase.secoes.length === 0;
        if (naoMudaNada) {
          return { atual, diffDaVersaoAnterior: null, versao: atual?.versao ?? 0, criada: false };
        }

        /*
         * O DIFF DE TRAVA é contra o documento que estava VALENDO para esta
         * empresa. Documento anterior ilegível falha fechado: não dá para
         * provar que a mudança não afrouxa, então exige assinatura.
         */
        let diffDaVersaoAnterior: DiffDePolitica | null = null;
        let afrouxamentosDaAnterior: Afrouxamento[] = [];
        if (atual) {
          try {
            const anterior = lerPolitica(atual.documento, `PolicyVersion ${atual.id}`);
            diffDaVersaoAnterior = diffDePolitica(anterior, resolvida);
            afrouxamentosDaAnterior = afrouxamentosDoDiff(diffDaVersaoAnterior);
          } catch (e) {
            this.log.error(
              `empresa ${orgId}: a versão ativa v${atual.versao} não é um documento legível ` +
                `(${(e as Error).message}) — a sobrescrita passa a exigir assinatura`,
            );
            afrouxamentosDaAnterior = [
              {
                tipo: 'secao',
                alvo: 'documento',
                texto: `versão ativa v${atual.versao} ilegível: não dá para provar que esta mudança aperta`,
              },
            ];
          }
        }

        const afrouxamentos = uniaoDosAfrouxamentos(
          afrouxamentosDoDiff(diffDaBase),
          afrouxamentosDaAnterior,
        );
        const recusas = recusasDaSobrescrita(afrouxamentos, {
          autorId: input.autorId,
          motivo: input.motivo,
        });
        if (recusas.length) throw new ForbiddenException(explicarRecusas(recusas));

        const agora = new Date();
        const versao = (atual?.versao ?? 0) + 1;
        if (atual) {
          await tx.policyVersion.update({ where: { id: atual.id }, data: { ativaAte: agora } });
        }
        await tx.policyVersion.create({
          data: {
            orgId,
            versao,
            documento: resolvida as unknown as Prisma.InputJsonValue,
            delta: delta as unknown as Prisma.InputJsonValue,
            diffDaBase: diffDaBase as unknown as Prisma.InputJsonValue,
            diffDaVersaoAnterior: (diffDaVersaoAnterior ??
              Prisma.DbNull) as unknown as Prisma.InputJsonValue,
            motivo: input.motivo?.trim() || 'sobrescrita de política da empresa',
            autorId: input.autorId ?? null,
            ativaDe: agora,
          },
        });
        return { atual, diffDaVersaoAnterior, versao, criada: true };
      },
      /*
       * O padrão do Prisma para transação interativa é 5s, e aqui dentro há
       * trabalho de CPU: ler o documento anterior (60 capacidades), validá-lo
       * pelo esquema e tirar dois diffs. Num banco carregado isso encosta no
       * teto, e estourar o tempo viraria erro interno numa operação que não é
       * de caminho quente — sobrescrever política é evento raro.
       */
      { timeout: 15_000 },
    );

    let r: Awaited<ReturnType<typeof aplicar>>;
    try {
      r = await aplicar();
    } catch (e) {
      // Colisão no par (orgId, versao): outra sobrescrita da mesma empresa
      // entrou no meio. Tentar de novo lê o número já atualizado.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        this.log.warn(`empresa ${orgId}: colisão de versão na sobrescrita — tentando de novo`);
        r = await aplicar();
      } else {
        throw e;
      }
    }

    if (!r.criada) {
      this.log.log(`sobrescrita da empresa ${orgId} não muda nada — nenhuma versão aberta`);
      if (r.atual) this.guardar(orgId, resolvida);
      return {
        versao: r.versao,
        diffDaBase,
        diffDaVersaoAnterior: null,
        redundantes,
        criada: false,
      };
    }

    this.guardar(orgId, resolvida);
    this.log.log(
      `empresa ${orgId}: política v${r.versao} em vigor — ` +
        `${diffDaBase.capacidades.length} capacidade(s) e ${diffDaBase.limites.length} limite(s) ` +
        `diferentes da base, por ${input.autorId ?? 'seed/script'}`,
    );
    /*
     * O cache é DO PROCESSO. Com mais de uma réplica, as outras seguem com a
     * política antiga até reiniciarem — `recarregar(orgId)` existe e ninguém a
     * dispara de fora. Enquanto não houver um canal entre as réplicas, o aviso
     * é o que sobra: ele é a diferença entre "a mudança não pegou" e "a mudança
     * não pegou naquela réplica".
     */
    this.log.warn(
      `empresa ${orgId}: só ESTE processo recarregou a política. Outras réplicas continuam ` +
        'com a versão anterior até reiniciarem (não há canal de invalidação entre elas).',
    );
    if (redundantes.length) {
      this.log.warn(
        `empresa ${orgId}: ${redundantes.length} capacidade(s) copiadas idênticas da base ` +
          `(${redundantes.join(', ')}) — elas PARAM de herdar mudanças da ROOT`,
      );
    }
    return {
      versao: r.versao,
      diffDaBase,
      diffDaVersaoAnterior: r.diffDaVersaoAnterior,
      redundantes,
      criada: true,
    };
  }

  /**
   * O histórico da empresa: quem mudou o quê e quando (RF-P-04).
   *
   * Sem o `documento`, que é grande e não é o que a pergunta pede — quem
   * precisar do texto inteiro de uma versão busca por id.
   */
  async historico(orgId: string) {
    return this.prisma.policyVersion.findMany({
      where: { orgId: exigirTenant(orgId, 'PolicyService.historico') },
      orderBy: { versao: 'desc' },
      select: {
        versao: true,
        motivo: true,
        autorId: true,
        // Os DOIS, com a referência no nome: "o que difere da ROOT" e "o que
        // esta versão mudou". Numa tela, mostrar um chamando de "diff" faz a
        // pessoa ler direção errada — uma queda de R4 para R3 é `sobe` contra
        // a base, que é R2, e `desce` contra o que estava valendo.
        diffDaBase: true,
        diffDaVersaoAnterior: true,
        ativaDe: true,
        ativaAte: true,
        criadoEm: true,
      },
    });
  }

  /** Nulo = capacidade sem classificação. avaliar(null) devolve R5 bloqueado. */
  resolverCapacidade(orgId: string, id: string): Capacidade | null {
    return this.indice.get(orgId)?.get(id) ?? this.indice.get('')?.get(id) ?? null;
  }

  capacidades(orgId: string): Capacidade[] {
    return this.politica(orgId).capacidades as Capacidade[];
  }

  limites(orgId: string) {
    return this.politica(orgId).limitesPadrao;
  }

  /** Decide SEM persistir. É o simulador da tela da Régua (RF-P-09). */
  simular(orgId: string, capabilityId: string, ctx: Contexto = {}): Decisao {
    return avaliar(this.resolverCapacidade(orgId, capabilityId), ctx);
  }

  /**
   * Decide e REGISTRA. A recusa também vira linha — é dela que sai o número
   * "N decisões em 30 dias" da tela da Régua, e sem ela não há como provar
   * que a régua barrou alguma coisa.
   */
  async avaliarERegistrar(input: {
    orgId: string;
    capabilityId: string | null;
    ctx?: Contexto;
    modo?: 'impor' | 'observar';
  }): Promise<{ decisao: Decisao; decisionId: string }> {
    const cap = input.capabilityId ? this.resolverCapacidade(input.orgId, input.capabilityId) : null;
    const decisao = avaliar(cap, input.ctx ?? {});

    const linha = await this.prisma.policyDecision.create({
      data: {
        orgId: input.orgId,
        capabilityId: cap?.id ?? null,
        nivelBase: decisao.nivelBase as RiskLevel,
        nivel: decisao.nivel as RiskLevel,
        permitido: decisao.permitido,
        exigeAprovacao: decisao.exigeAprovacao,
        sinais: decisao.sinaisAcionados as string[],
        motivo: decisao.motivo,
        modo: input.modo ?? 'impor',
      },
      select: { id: true },
    });

    return { decisao, decisionId: linha.id };
  }
}

export type { Decisao, Sinal, Capacidade };
