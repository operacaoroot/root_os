import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AgentEstado } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { donosDaCasa } from './donos-da-casa';
import {
  CAMPOS_DO_PROCEDIMENTO,
  FormatoDaSopInvalido,
  ONDE_MORA_O_CAMPO,
  ROTULO_DO_CAMPO,
  camposFaltando,
  escalacaoPara,
  validarProcedimento,
  vetoDeCabecalhoFixo,
} from './sop';

/*
 * A LISTA BRANCA DE CAMPOS DO AGENTE (item 18 da auditoria, `AUDITORIA-SEGURANCA.md`).
 *
 * `atualizar` recebia `Prisma.AgentUpdateInput` CRU. Era método morto, e a
 * auditoria registrou exatamente o risco que isso guarda: "no dia em que alguém
 * ligar uma tela de agente nela, o item sai de 'caminho não existe' para
 * 'caminho aberto sem validação' sem que nada no código denuncie". Esta fatia é
 * esse dia — a tela de Agentes passa a escrever —, então o recorte vem antes.
 *
 * O QUE FICA DE FORA, E POR QUÊ:
 *
 *   · `capacidades` — é a declaração de menor privilégio do agente. A porta
 *     recusa capacidade fora dela (`tool-gateway.service.ts`, ramo
 *     `fora_da_declaracao`), então editar a lista É ALARGAR O ALCANCE de quem
 *     chega a conector. Isso não pode virar caixa de seleção numa tela guardada
 *     só por permissão de papel;
 *   · `autonomiaAte` — o teto de risco declarado. Mesmo argumento;
 *   · `contextoFixo` — vira o bloco "O QUE VALE NESTA EMPRESA" no prompt de
 *     sistema. É o item da auditoria "contexto do cliente virando regra da casa";
 *   · `modelo`, `effort`, `maxPassos`, `tetoCustoUsd`, `tetoSegundos` — governam
 *     gasto de IA e pertencem à fatia do teto, não a esta;
 *   · `cron`, `tz`, `ativo`, `estado` — são a superfície de ROTINAS (fatia 5.1),
 *     que está sendo escrita em paralelo. Fora daqui para não haver dois donos.
 *
 * O que sobra é a IDENTIFICAÇÃO do agente: quem ele é, o que faz, de quem é e
 * em que pilar mora — que é o que o organograma e os sete campos precisam.
 *
 * E O QUE ENTRA NOS CAMPOS QUE SOBRARAM (correção de 11/09/2026). Lista branca
 * fecha QUAIS campos entram; não fecha O QUE entra neles. `nome`, `missao` e
 * `pilar` são texto livre e viram as três primeiras linhas do prompt de sistema
 * (`montarSop`): escrever `ESCALAÇÃO\n…` na missão abria ali o mesmo bloco
 * rival que o procedimento recusava num passo. Os três passam pelo veto de
 * cabeçalho — o MESMO de `sop.ts`, não uma segunda regra.
 */
export const AgenteIdentidadeSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, 'nome: curto demais')
      .max(80, 'nome: longo demais')
      .superRefine(vetoDeCabecalhoFixo('nome')),
    missao: z
      .string()
      .trim()
      .min(10, 'missão: curta demais')
      .max(400, 'missão: longa demais')
      .superRefine(vetoDeCabecalhoFixo('missão')),
    pilar: z
      .string()
      .trim()
      .min(2, 'pilar: curto demais')
      .max(60, 'pilar: longo demais')
      .superRefine(vetoDeCabecalhoFixo('pilar')),
    /*
     * Sem `.uuid()`: identificador de usuário é uuid por padrão, mas semente e
     * suíte gravam ids legíveis ("pedro-do-contexto"), e recusar por FORMATO
     * daria a impressão de trava onde não há. A trava de verdade é a consulta
     * logo abaixo, que exige o usuário existir NESTA empresa.
     */
    donoId: z.string().trim().min(1, 'dono: obrigatório').max(64, 'dono: identificador longo demais'),
  })
  .strict()
  .partial();

export type AgenteIdentidade = z.infer<typeof AgenteIdentidadeSchema>;

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ======================================================================== *
   * O DONO, CONFERIDO CONTRA A EMPRESA — a regra dos QUATRO lugares
   * ======================================================================== *
   *
   * A resolução em si mora em `donos-da-casa.ts`, e o porquê de ela morar lá
   * está no cabeçalho daquele arquivo: eram QUATRO lugares expondo o nome do
   * dono, e o quarto (`AgentRuntime.executar`, o caminho real de execução) não
   * é deste serviço. Método privado de um dos dois donos daria o quinto.
   *
   * O organograma já fazia o cruzamento (contra o mapa de gente que ele
   * carrega inteiro); `roster` e `detalhe` continuavam por relação e vazavam
   * nome da empresa vizinha — inclusive para dentro do prompt de sistema, pelo
   * `escalacaoPara` do detalhe. Correção de 11/09/2026.
   *
   * E A CONSEQUÊNCIA SOBRE OS SETE CAMPOS. Se o ponteiro atravessado não
   * resolve em nome, ele também não conta como DONO: `camposFaltando` e
   * `validarProcedimento` recebem o id JÁ CRUZADO, e não a coluna crua. Sem
   * isso a tela dizia "sem dono" ao lado de uma lista de faltantes que não
   * citava o dono, e a gravação aceitava um procedimento cuja escalação sairia
   * apontando para "o responsável pelo agente" — sete campos completos no
   * papel, seis na prática.
   */
  private donosDesta(orgId: string, ids: (string | null)[]) {
    return donosDaCasa(this.prisma, orgId, ids);
  }

  async roster(orgId: string) {
    const agentes = await this.prisma.agent.findMany({
      where: { orgId },
      orderBy: [{ estado: 'asc' }, { nome: 'asc' }],
      include: {
        // Os quatro campos do procedimento, e não só `proposito`: é o que
        // `camposFaltando` precisa para dizer a verdade sobre cada agente.
        sop: {
          select: {
            proposito: true,
            gatilho: true,
            passos: true,
            definicaoDePronto: true,
            versao: true,
            atualizadoEm: true,
          },
        },
      },
    });

    const donos = await this.donosDesta(orgId, agentes.map((a) => a.donoId));

    return {
      items: agentes.map((a) => ({
        slug: a.slug,
        nome: a.nome,
        iniciais: a.iniciais,
        missao: a.missao,
        pilar: a.pilar,
        dono: (a.donoId && donos.get(a.donoId)) || null,
        tipo: a.tipo,
        estado: a.estado,
        autonomiaAte: a.autonomiaAte,
        rebaixadoAte: a.rebaixadoAte?.toISOString() ?? null,
        capacidades: a.capacidades,
        cron: a.cron,
        ultimaExecucaoEm: a.ultimaExecucaoEm?.toISOString() ?? null,
        ultimoStatus: a.ultimoStatus,
        execucoes: a.execucoes,
        falhas: a.falhas,
        // "—" na tela até alguém declarar a linha de base. Nunca um número
        // inventado: a fórmula fica visível e a procedência também.
        horasDevolvidas:
          a.minutosPorExecucao > 0
            ? Number(((a.minutosPorExecucao * a.execucoes) / 60).toFixed(1))
            : null,
        linhaDeBase:
          a.minutosPorExecucao > 0
            ? {
                minutosPorExecucao: a.minutosPorExecucao,
                informadaEm: a.baselineEm?.toISOString() ?? null,
                informadaPor: a.baselinePorId,
              }
            : null,
        temProcedimento: !!a.sop,
        procedimento: a.sop
          ? { versao: a.sop.versao, atualizadoEm: a.sop.atualizadoEm.toISOString() }
          : null,
        /*
         * Dos sete campos do formato fixo, quais faltam NESTE agente. A tela usa
         * para dizer o que impede o procedimento de ser aceito antes de a pessoa
         * escrever uma linha — e para não oferecer "salvar" sabendo que a API vai
         * recusar por falta de dono ou de pilar.
         */
        faltando: camposFaltando({ donoId: donos.get(a.donoId ?? '')?.id ?? null, pilar: a.pilar, sop: a.sop }),
      })),
      kpis: {
        rodando: agentes.filter((a) => a.estado === AgentEstado.rodando).length,
        // A soma só existe se ALGUÉM declarou base. Somar zeros e mostrar
        // "0 h devolvidas" é diferente de "ninguém mediu ainda".
        horasSemana: agentes.some((a) => a.minutosPorExecucao > 0)
          ? Number(
              agentes
                .reduce((t, a) => t + (a.minutosPorExecucao * a.execucoes) / 60, 0)
                .toFixed(1),
            )
          : null,
        semLinhaDeBase: agentes.filter((a) => a.minutosPorExecucao === 0).length,
        semProcedimento: agentes.filter((a) => !a.sop).length,
      },
    };
  }

  /**
   * O agente com o procedimento inteiro — e com o texto de escalação JÁ
   * RESOLVIDO, vindo da constante do código.
   *
   * A escalação viaja na resposta de propósito: a tela precisa mostrá-la (ela é
   * um dos sete campos), e a alternativa seria uma segunda cópia do texto dentro
   * do web, que um dia diverge. Vem com `escalacaoEditavel: false` ao lado para
   * que o front não precise deduzir isso de lugar nenhum.
   *
   * O DONO SAI COMO `{ id, nome }`, igual ao roster. Vinha como `{ id, name }`
   * — o campo cru do Prisma, porque o método devolvia `...a` com a relação
   * dentro —, e a tela (`apps/web/src/app/agentes/Procedimento.tsx`) lê `nome`:
   * o campo aparecia em branco e a conferência de tipos não pegava, porque a
   * leitura no web é convertida à força pelo genérico do `apiGet`. Correção de
   * 11/09/2026.
   */
  async detalhe(orgId: string, slug: string) {
    const a = await this.prisma.agent.findFirst({
      where: { orgId, slug },
      include: { sop: true },
    });
    if (!a) return null;

    const donos = await this.donosDesta(orgId, [a.donoId]);
    const dono = (a.donoId && donos.get(a.donoId)) || null;

    return {
      ...a,
      /*
       * `donoId` SOBRESCRITO com o id cruzado, e não deixado como veio do
       * banco. O nome já não vaza; a coluna crua ainda entregava o
       * identificador de um usuário da empresa vizinha para quem lesse o JSON,
       * e deixava a resposta contradizendo a si mesma (`dono: null` ao lado de
       * um `donoId` preenchido). A tela não usa o campo; a verdade, sim.
       */
      donoId: dono?.id ?? null,
      dono,
      escalacao: escalacaoPara(dono?.nome),
      escalacaoEditavel: false as const,
      formato: {
        campos: CAMPOS_DO_PROCEDIMENTO.map((c) => ({
          campo: c,
          rotulo: ROTULO_DO_CAMPO[c],
          onde: ONDE_MORA_O_CAMPO[c],
        })),
        faltando: camposFaltando({ donoId: dono?.id ?? null, pilar: a.pilar, sop: a.sop }),
      },
    };
  }

  /** A linha de base é DECLARADA por uma pessoa, com nome e data. */
  async declararLinhaDeBase(orgId: string, slug: string, minutos: number, userId: string) {
    if (minutos <= 0) throw new Error('a linha de base precisa ser maior que zero');
    const a = await this.prisma.agent.updateMany({
      where: { orgId, slug },
      data: { minutosPorExecucao: minutos, baselinePorId: userId, baselineEm: new Date() },
    });
    if (a.count === 0) throw new Error(`agente "${slug}" não existe`);
    return { ok: true as const };
  }

  /**
   * Grava o procedimento — RF-N-02, o formato fixo com os sete campos.
   *
   * Recusa antes de tocar no banco quando falta qualquer um dos sete, quando a
   * entrada tenta carregar um campo que não é editável (escalação à frente) ou
   * quando um campo livre abre linha com um dos cabeçalhos do sistema.
   *
   * A versão sobe a cada gravação e o autor fica registrado: procedimento é o
   * método de operação da empresa, e saber quem mudou o quê é metade do valor.
   */
  async salvarSop(orgId: string, slug: string, entrada: unknown, userId: string) {
    const agente = await this.prisma.agent.findFirst({
      where: { orgId, slug },
      select: { id: true, donoId: true, pilar: true, sop: true },
    });
    if (!agente) throw new NotFoundException(`agente "${slug}" não existe`);

    // O dono conferido contra ESTA empresa — ver o cabeçalho de `donosDesta`.
    // Ponteiro atravessado não é dono, e procedimento sem dono é recusado.
    const donos = await this.donosDesta(orgId, [agente.donoId]);
    const donoDaCasa = (agente.donoId && donos.get(agente.donoId)?.id) || null;

    let dados;
    try {
      dados = validarProcedimento(entrada, { donoId: donoDaCasa, pilar: agente.pilar });
    } catch (e) {
      if (e instanceof FormatoDaSopInvalido) {
        throw new BadRequestException({
          error: 'ValidationError',
          message: e.message,
          issues: e.problemas.map((p) => ({ path: p.campo, message: p.motivo })),
        });
      }
      throw e;
    }

    const antes = agente.sop;
    const comum = {
      proposito: dados.proposito,
      gatilho: dados.gatilho,
      passos: dados.passos,
      definicaoDePronto: dados.definicaoDePronto,
      observacoes: dados.observacoes ?? null,
      atualizadoPor: userId,
    };

    const sop = await this.prisma.sop.upsert({
      where: { agentId: agente.id },
      create: { orgId, agentId: agente.id, ...comum },
      update: { ...comum, versao: { increment: 1 } },
    });

    /*
     * O RASTRO administrativo. É `AuditService` e não `EventLogService` porque
     * isto é escrita INTERNA, sem efeito fora do OS — mesma família de
     * `user.create` e do módulo Trabalho. Se um dia editar procedimento passar a
     * exigir aprovação (a pergunta aberta desta fatia), é aqui que a porta entra.
     */
    await this.audit.log({
      orgId,
      actorId: userId,
      action: antes ? 'agent.sop.update' : 'agent.sop.create',
      entityType: 'agent',
      entityId: agente.id,
      before: antes
        ? {
            proposito: antes.proposito,
            gatilho: antes.gatilho,
            passos: antes.passos,
            definicaoDePronto: antes.definicaoDePronto,
            observacoes: antes.observacoes,
            versao: antes.versao,
          }
        : undefined,
      after: { ...comum, versao: sop.versao },
      metadata: { slug },
    });

    return { ok: true as const, versao: sop.versao };
  }

  /**
   * Identificação do agente: nome, missão, pilar e dono. NADA de capacidade,
   * autonomia ou contexto fixo — ver o cabeçalho de `AgenteIdentidadeSchema`.
   */
  async atualizar(orgId: string, slug: string, entrada: unknown, userId: string) {
    const dados = AgenteIdentidadeSchema.parse(entrada);
    if (Object.keys(dados).length === 0) {
      throw new BadRequestException('nada a atualizar');
    }

    /*
     * O DONO PRECISA SER GENTE DESTA EMPRESA.
     *
     * Sem esta conferência, `donoId` aceitaria o identificador de um usuário de
     * OUTRO tenant: o nome dele apareceria no organograma e no prompt do agente
     * ("DONO HUMANO: ..."), que é vazamento de gente entre empresas pela porta
     * dos fundos. O `updateMany` abaixo escopa o AGENTE; o dono é o outro lado.
     */
    if (dados.donoId) {
      const dono = await this.prisma.user.findFirst({
        where: { id: dados.donoId, orgId },
        select: { id: true },
      });
      if (!dono) throw new BadRequestException('dono: não é um usuário desta empresa');
    }

    const r = await this.prisma.agent.updateMany({ where: { orgId, slug }, data: dados });
    if (r.count === 0) throw new NotFoundException(`agente "${slug}" não existe`);

    await this.audit.log({
      orgId,
      actorId: userId,
      action: 'agent.update',
      entityType: 'agent',
      entityId: slug,
      after: dados,
    });

    return { ok: true as const };
  }

  /* ======================================================================== *
   * O ORGANOGRAMA (RF-N-06) — gente e agentes lado a lado, por pilar
   * ======================================================================== *
   *
   * DUAS CONSULTAS ESCOPADAS POR EMPRESA, e o cruzamento feito na memória — é
   * a mesma regra de `donosDesta` (ver o cabeçalho dela), aplicada aqui contra
   * o mapa de gente que esta tela já carrega inteiro, porque o organograma
   * precisa mostrar também quem não é dono de agente nenhum.
   *
   * O E-MAIL NÃO ENTRA. O organograma responde "quem trabalha aqui e no quê";
   * endereço de e-mail é dado pessoal que a pergunta não precisa, e esta tela é
   * a mais aberta das três de gente (`dashboard.ver`, contra `admin.usuarios`
   * de /config). Menos dado, mesmo desenho.
   */
  async organograma(orgId: string) {
    const [pessoas, agentes] = await Promise.all([
      this.prisma.user.findMany({
        where: { orgId },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          isActive: true,
          roles: { select: { key: true, name: true } },
        },
      }),
      this.prisma.agent.findMany({
        where: { orgId },
        orderBy: [{ pilar: 'asc' }, { nome: 'asc' }],
        select: {
          slug: true,
          nome: true,
          iniciais: true,
          missao: true,
          pilar: true,
          donoId: true,
          tipo: true,
          estado: true,
          autonomiaAte: true,
          cron: true,
        },
      }),
    ]);

    const gente = new Map(pessoas.map((p) => [p.id, p]));

    const agentesDto = agentes.map((a) => {
      const dono = a.donoId ? gente.get(a.donoId) : undefined;
      return {
        slug: a.slug,
        nome: a.nome,
        iniciais: a.iniciais,
        missao: a.missao,
        pilar: a.pilar,
        tipo: a.tipo,
        estado: a.estado,
        autonomiaAte: a.autonomiaAte,
        cron: a.cron,
        dono: dono ? { id: dono.id, nome: dono.name } : null,
      };
    });

    /*
     * O PILAR DE UMA PESSOA É DERIVADO, e isso é procedência, não invenção:
     * `User` não tem coluna de pilar, então o pilar de alguém é o dos agentes de
     * que ela é dona. Quem não é dona de nenhum cai em "sem pilar ainda" — que é
     * informação verdadeira e acionável, diferente de chutá-la num quadrado.
     */
    const pilaresDaPessoa = new Map<string, Set<string>>();
    for (const a of agentes) {
      if (!a.donoId || !a.pilar || !gente.has(a.donoId)) continue;
      const atual = pilaresDaPessoa.get(a.donoId) ?? new Set<string>();
      atual.add(a.pilar);
      pilaresDaPessoa.set(a.donoId, atual);
    }

    const pessoasDto = pessoas.map((p) => ({
      id: p.id,
      nome: p.name,
      ativo: p.isActive,
      papeis: p.roles.map((r) => r.name),
      pilares: [...(pilaresDaPessoa.get(p.id) ?? [])].sort(),
      agentes: agentesDto.filter((a) => a.dono?.id === p.id).map((a) => a.slug),
    }));

    const nomesDePilar = [
      ...new Set(agentes.map((a) => a.pilar).filter((p): p is string => !!p)),
    ].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    const pilares = nomesDePilar.map((nome) => ({
      pilar: nome,
      pessoas: pessoasDto.filter((p) => p.pilares.includes(nome)),
      agentes: agentesDto.filter((a) => a.pilar === nome),
    }));

    return {
      pilares,
      semPilar: {
        pessoas: pessoasDto.filter((p) => p.pilares.length === 0),
        agentes: agentesDto.filter((a) => !a.pilar),
      },
      totais: {
        pessoas: pessoasDto.length,
        agentes: agentesDto.length,
        agentesSemDono: agentesDto.filter((a) => !a.dono).length,
        pilares: nomesDePilar.length,
      },
      fonte: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }
}
