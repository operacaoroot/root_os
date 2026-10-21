import type { PrismaClient } from '@prisma/client';

import { FormatoDaSopInvalido, validarProcedimento } from '../sop';
import { ROSTER_DE_ENTRADA, type AgenteDoRoster } from './roster';
import { capacidadesDaEmpresa } from './capacidades-da-empresa';

/* ==========================================================================
 * SEMEAR O ROSTER DE UMA EMPRESA — idempotente, como o provisionamento
 * ==========================================================================
 *
 * A REGRA QUE GOVERNA ESTE ARQUIVO é a mesma de `tenants/provisionar.ts`:
 * rodar duas vezes produz o mesmo estado, sem duplicata e sem erro.
 *
 * QUEM CHAMA, E QUANDO — o cabeçalho anterior afirmava que "cada reabertura
 * passa por aqui" e isso era FALSO: a semente só rodava no cadastro. A
 * consequência era a que a revisão apontou — morte entre as duas escritas
 * (empresa criada, agentes não) deixava a empresa sem assistente para sempre, e
 * o cadastro ainda respondia sucesso, porque o controlador devolve a mesma
 * resposta para todo desfecho.
 *
 * Agora são DOIS chamadores, e a afirmação passou a ser verdade:
 *
 *   · `OnboardingService.cadastrar`, no nascimento da empresa;
 *   · `OnboardingService.estado`, em TODA leitura de estado da entrada — mas
 *     só quando `precisaSemear` (abaixo) diz que falta alguma coisa, para a
 *     leitura não pagar quinze comandos a cada recarga da tela.
 *
 * O QUE A SEGUNDA RODADA NÃO TOCA — e isto é o que separa "idempotente" de
 * "sobrescreve": `donoId`, `estado`, `autonomiaAte`, `ativo` e a linha de base
 * de minutos são decisão de GENTE. Um agente que alguém pausou de propósito
 * não pode voltar a rodar porque a carga foi reaberta. Missão, nome, pilar e
 * capacidades acompanham o código, pelo mesmo critério que
 * `prisma/seed-tripulacao.ts` já usa.
 *
 * AS CAPACIDADES PASSAM PELO FILTRO DE MÓDULO (rodada dos agentes, 21/10/2026,
 * A1): o roster declara a lista do cadastro único, e a empresa ganha só as que
 * alcança com os módulos ligados (`capacidades-da-empresa.ts`). É isso que deixa
 * o assistente ser UMA definição para a casa e para a empresa nova.
 *
 * O PROCEDIMENTO É VALIDADO ANTES DE SER GRAVADO, e a validação é a MESMA que
 * a tela usa (`validarProcedimento`, em `agents/sop.ts`). Não é zelo: um
 * roster escrito em código com um passo vazio ou um cabeçalho fixo forjado
 * dentro de um campo livre entraria no banco sem ninguém ver, e o defeito só
 * apareceria no prompt de sistema de uma empresa cliente. Aqui ele derruba a
 * semente, que é onde dá para consertar.
 *
 * A ÚNICA RECUSA QUE NÃO DERRUBA é a do DONO ausente. `validarProcedimento`
 * cobra os sete campos, e dois deles (`dono`, `pilar`) moram no agente. O
 * pilar vem do código e nunca falta; o dono é o primeiro administrador da
 * empresa, que pode não existir (empresa criada sem administrador). Nesse
 * caso o agente nasce assim mesmo e o resumo DIZ que ele está sem dono — um
 * agente sem procedimento seria pior, e o texto de escalação tem uma saída
 * declarada para isso ("o responsável pelo agente", em `nomeDeGenteParaPrompt`).
 *
 * SEM NEST, DE PROPÓSITO: nada que dependa de injeção roda sob o vitest
 * (esbuild não emite `emitDecoratorMetadata`), e esta função precisa ser
 * exercitada contra um banco de verdade pela suíte.
 */

export interface AvisoDoRoster {
  slug: string;
  codigo: 'sem-dono' | 'procedimento-mantido';
  texto: string;
}

export interface ResumoDoRoster {
  criados: string[];
  jaExistiam: string[];
  /** Procedimentos gravados nesta rodada (criação ou atualização do texto). */
  procedimentos: string[];
  avisos: AvisoDoRoster[];
}

export interface OpcoesDaSemente {
  /**
   * O dono humano dos agentes — o primeiro administrador da empresa. É para
   * ele que o bloco de ESCALAÇÃO manda escalar.
   *
   * NÃO é sobrescrito em rodada posterior: se o agente já tem dono, ele fica
   * com o que tem. Trocar dono é decisão de gente, na tela de Agentes.
   */
  donoId?: string | null;
  /** O roster a semear. Existe para o teste poder medir um roster inválido. */
  roster?: readonly AgenteDoRoster[];
  /**
   * Os módulos ligados da empresa, para o filtro das capacidades. Ausente = lidos
   * de `Org.modulos` (empresa sem linha = nenhum módulo, só a espinha).
   */
  modulos?: readonly string[];
}

/**
 * Falta semear alguma coisa nesta empresa?
 *
 * Duas contagens, e as DUAS importam: o agente pode existir sem procedimento,
 * porque são duas escritas e não uma transação. Esse estado é o pior dos dois —
 * `impedimento()` (em `agents/agent-runtime.service.ts`) NÃO olha o
 * procedimento, então um agente sem SOP não é recusado: ele roda com o prompt
 * DEGRADADO, sem o bloco PROCEDIMENTO, e responde como se nada faltasse. Quem
 * recusa nesse caso é o degrau de entrada, e para recusar ele precisa saber —
 * é esta função que conta.
 *
 * Barata de propósito: uma busca pelos dois slugs (índice `@@unique([orgId,
 * slug])`) e uma contagem de procedimentos — duas consultas, para poder rodar em
 * toda leitura de estado sem virar peso.
 */
export async function precisaSemear(
  prisma: PrismaClient,
  orgId: string,
  roster: readonly AgenteDoRoster[] = ROSTER_DE_ENTRADA,
): Promise<boolean> {
  const slugs = roster.map((a) => a.slug);
  const agentes = await prisma.agent.findMany({
    where: { orgId, slug: { in: slugs } },
    select: { id: true },
  });
  if (agentes.length < slugs.length) return true;

  const procedimentos = await prisma.sop.count({
    where: { orgId, agentId: { in: agentes.map((a) => a.id) } },
  });
  return procedimentos < agentes.length;
}

/**
 * Garante que esta empresa tenha os agentes do roster de entrada.
 *
 * Devolve o retrato do que encontrou e do que fez — o mesmo contrato do
 * provisionamento, e pelo mesmo motivo: quem chama precisa poder afirmar "a
 * segunda rodada não mudou nada" sem reler o banco.
 */
export async function semearRoster(
  prisma: PrismaClient,
  orgId: string,
  opcoes: OpcoesDaSemente = {},
): Promise<ResumoDoRoster> {
  const roster = opcoes.roster ?? ROSTER_DE_ENTRADA;
  const modulos =
    opcoes.modulos ??
    (await prisma.org.findUnique({ where: { id: orgId }, select: { modulos: true } }))?.modulos ??
    [];
  const resumo: ResumoDoRoster = {
    criados: [],
    jaExistiam: [],
    procedimentos: [],
    avisos: [],
  };

  for (const semente of roster) {
    const existente = await prisma.agent.findUnique({
      where: { orgId_slug: { orgId, slug: semente.slug } },
      select: { id: true, donoId: true, pilar: true },
    });

    const donoEfetivo = existente?.donoId ?? opcoes.donoId ?? null;

    /*
     * A VALIDAÇÃO ACONTECE ANTES DA ESCRITA, com o lado do agente que a linha
     * VAI TER — não com o que ela tem agora. Validar contra o estado antigo
     * deixaria passar um procedimento que só é válido por causa de um dono que
     * esta rodada ainda não gravou.
     */
    const procedimento = validarOuExplicar(semente, {
      donoId: donoEfetivo,
      pilar: semente.pilar,
    });
    if (!donoEfetivo) {
      resumo.avisos.push({
        slug: semente.slug,
        codigo: 'sem-dono',
        texto:
          `o agente "${semente.slug}" nasceu sem dono humano. O bloco de ESCALAÇÃO do prompt ` +
          'dele vai dizer "escale para o responsável pelo agente", que é verdade e não é ' +
          'endereço. Defina o dono na tela de Agentes.',
      });
    }

    const agentId = existente
      ? existente.id
      : (
          await prisma.agent.create({
            data: {
              orgId,
              slug: semente.slug,
              nome: semente.nome,
              iniciais: semente.iniciais,
              missao: semente.missao,
              pilar: semente.pilar,
              tipo: semente.tipo,
              estado: semente.estado,
              autonomiaAte: semente.autonomiaAte,
              capacidades: capacidadesDaEmpresa(semente.capacidades, modulos),
              donoId: donoEfetivo,
            },
            select: { id: true },
          })
        ).id;

    if (existente) {
      // O que acompanha o código. `estado`, `autonomiaAte`, `ativo` e `donoId`
      // ficam de fora: ver o cabeçalho.
      await prisma.agent.update({
        where: { id: agentId },
        data: {
          nome: semente.nome,
          iniciais: semente.iniciais,
          missao: semente.missao,
          pilar: semente.pilar,
          tipo: semente.tipo,
          capacidades: capacidadesDaEmpresa(semente.capacidades, modulos),
          ...(existente.donoId ? {} : { donoId: donoEfetivo }),
        },
      });
      resumo.jaExistiam.push(semente.slug);
    } else {
      resumo.criados.push(semente.slug);
    }

    const sopAtual = await prisma.sop.findUnique({
      where: { agentId },
      select: { id: true, versao: true, atualizadoPor: true },
    });

    if (!sopAtual) {
      await prisma.sop.create({
        data: {
          orgId,
          agentId,
          proposito: procedimento.proposito,
          gatilho: procedimento.gatilho,
          passos: [...procedimento.passos],
          definicaoDePronto: procedimento.definicaoDePronto,
          observacoes: procedimento.observacoes ?? null,
        },
      });
      resumo.procedimentos.push(semente.slug);
      continue;
    }

    /*
     * PROCEDIMENTO QUE UMA PESSOA JÁ EDITOU NÃO É REESCRITO.
     *
     * `Sop.atualizadoPor` é preenchido por quem salva na tela; a semente nunca
     * o preenche. Então "tem autor" quer dizer "alguém da empresa mexeu nisto",
     * e reescrever por cima apagaria o trabalho dela na volta seguinte da carga
     * — silenciosamente, que é o pior jeito.
     */
    if (sopAtual.atualizadoPor) {
      resumo.avisos.push({
        slug: semente.slug,
        codigo: 'procedimento-mantido',
        texto:
          `o procedimento de "${semente.slug}" foi editado por alguém da empresa (versão ` +
          `${sopAtual.versao}) e NÃO foi reescrito pela semente.`,
      });
      continue;
    }

    const atualizacao = await prisma.sop.updateMany({
      where: {
        id: sopAtual.id,
        orgId,
        agentId,
        versao: sopAtual.versao,
        atualizadoPor: null,
      },
      data: {
        proposito: procedimento.proposito,
        gatilho: procedimento.gatilho,
        passos: [...procedimento.passos],
        definicaoDePronto: procedimento.definicaoDePronto,
        observacoes: procedimento.observacoes ?? null,
        versao: { increment: 1 },
      },
    });
    if (atualizacao.count === 1) resumo.procedimentos.push(semente.slug);
  }

  return resumo;
}

/**
 * Valida o procedimento da semente e devolve o que gravar.
 *
 * Recusa por FALTA DE DONO é tolerada (ver o cabeçalho); qualquer outra
 * recusa é defeito do roster escrito em código e derruba a semente com a lista
 * inteira de problemas, que é o que `FormatoDaSopInvalido` carrega.
 */
function validarOuExplicar(
  semente: AgenteDoRoster,
  lado: { donoId: string | null; pilar: string | null },
): AgenteDoRoster['sop'] {
  const entrada = {
    proposito: semente.sop.proposito,
    gatilho: semente.sop.gatilho,
    passos: [...semente.sop.passos],
    definicaoDePronto: semente.sop.definicaoDePronto,
    ...(semente.sop.observacoes === undefined ? {} : { observacoes: semente.sop.observacoes }),
  };

  try {
    validarProcedimento(entrada, lado);
    return semente.sop;
  } catch (e) {
    if (e instanceof FormatoDaSopInvalido && e.problemas.every((p) => p.campo === 'dono')) {
      return semente.sop;
    }
    throw new Error(
      `o roster de entrada declara um procedimento inválido para "${semente.slug}": ` +
        `${(e as Error).message}. Isto é defeito de código (agents/roster/), não de dado.`,
      { cause: e },
    );
  }
}
