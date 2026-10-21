import { Injectable } from '@nestjs/common';
import {
  CADASTRO_DE_FUNCOES,
  abaDoTipo,
  funcaoPorSlug,
  type CatalogoDeFuncoes,
  type EstadoDaFuncao,
  type FuncaoDoCadastro,
  type LinhaDoCatalogo,
} from '@mktos/shared';

import { PrismaService } from '../prisma/prisma.service';
import { GastoPorFuncaoService, type GastoDoMesPorFuncao } from '../llm/gasto-por-funcao.service';
import { modeloDaChamada } from '../llm/modelo-da-chamada';
import { env } from '../llm/env';
import { proximaOcorrencia } from '../pauta/cron';
import { carregarEquipe, donoDaFuncao, donoEfetivo, donosDosAgentes } from './equipe-donos';

/*
 * O CATÁLOGO DE FUNÇÕES COM O ESTADO DO BANCO (rodada dos agentes, 21/10/2026, A7)
 * — `GET /agents/cadastro`, a tela `/agentes` com as três abas.
 *
 * O cadastro único (`packages/shared/src/agentes.ts`) diz o que cada função é;
 * esta leitura junta o que o BANCO sabe dela, sem escrever nada:
 *
 *  · ESTADO: o declarado no cadastro, rebaixado a `desligado` quando o banco
 *    diz que está parado (agente pausado ou desligado no registro; todas as
 *    rotinas do tipo desligadas em `/rotinas`) e levado a `aposentado` quando o
 *    agente foi encerrado. A rotina vale também para cima: rotina declarada
 *    desligada que está ligada em `/rotinas` aparece `ativo`, porque é o
 *    relógio que manda nela.
 *  · DONO: o efetivo (banco > padrão), pela mesma regra da Equipe (`equipe-donos.ts`).
 *  · MODELO E ESFORÇO (só agentes): a escolha EFETIVA. O ajuste do registro
 *    `Agent` (coluna `modelo`, ou `effort` fora do padrão da coluna) é o que o
 *    laço passa explícito; senão `LLM_MODELO_<ID>`/`LLM_ESFORCO_<ID>` e as listas
 *    `LLM_MODELOS_POR_FUNCAO`/`LLM_ESFORCOS_POR_FUNCAO`; senão o cadastro; senão o
 *    padrão do provedor. A conta é a do provedor (`modeloDaChamada`).
 *  · ÚLTIMA E PRÓXIMA EXECUÇÃO: da rotina do tipo (`RotinaExecucao` pelo campo
 *    `rotina` do cadastro; próxima pela coluna ou pelo cron), do registro `Agent`,
 *    ou, para quem não tem nenhum dos dois, da última chamada no livro de gasto.
 *  · GASTO DO MÊS: `GastoPorFuncaoService.doMes`, pela função ou pelo slug.
 *
 * Agentes registrados que não estão no cadastro (criados pela tela, os
 * procedimentos locais) entram como "Fora do cadastro", para nenhuma função da
 * tela de hoje sumir.
 */

/** O padrão da coluna `Agent.effort`: igual a ele não é ajuste de ninguém (mesma regra do laço). */
const ESFORCO_PADRAO_DA_COLUNA = 'high';

function maisRecente(...xs: LinhaDoCatalogo['ultima'][]): LinhaDoCatalogo['ultima'] {
  return xs.filter((x): x is NonNullable<LinhaDoCatalogo['ultima']> => !!x).sort((a, b) => b.em.localeCompare(a.em))[0] ?? null;
}

@Injectable()
export class CadastroService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gasto: GastoPorFuncaoService,
  ) {}

  async catalogo(orgId: string, agora: Date = new Date()): Promise<CatalogoDeFuncoes> {
    const tiposDeRotina = [...new Set(CADASTRO_DE_FUNCOES.map((f) => f.rotina).filter((t): t is string => !!t))];
    const [ctx, agentes, rotinas, gastoDoMes] = await Promise.all([
      carregarEquipe(this.prisma, orgId),
      this.prisma.agent.findMany({
        where: { orgId },
        orderBy: { nome: 'asc' },
        select: {
          slug: true,
          nome: true,
          missao: true,
          tipo: true,
          estado: true,
          ativo: true,
          donoId: true,
          modelo: true,
          effort: true,
          cron: true,
          tz: true,
          ultimaExecucaoEm: true,
          ultimoStatus: true,
          proximaExecucaoEm: true,
        },
      }),
      this.prisma.rotina.findMany({
        where: { orgId, tipo: { in: tiposDeRotina } },
        select: {
          id: true,
          tipo: true,
          ativo: true,
          estado: true,
          cron: true,
          tz: true,
          ultimaExecucaoEm: true,
          ultimoStatus: true,
          proximaExecucaoEm: true,
        },
      }),
      this.gasto.doMes(orgId).catch(() => ({ mes: '', itens: [] as GastoDoMesPorFuncao[], totalUsd: 0 })),
    ]);
    const ultimasExecucoes = rotinas.length
      ? await this.prisma.rotinaExecucao.findMany({
          where: { orgId, rotinaId: { in: rotinas.map((r) => r.id) } },
          orderBy: { inicioEm: 'desc' },
          distinct: ['rotinaId'],
          select: { rotinaId: true, inicioEm: true, status: true },
        })
      : [];

    const donos = await donosDosAgentes(this.prisma, orgId, agentes);
    const porSlug = new Map(agentes.map((a) => [a.slug, a]));
    const padrao = { modelo: env('ANTHROPIC_MODEL', 'claude-opus-5-5'), esforco: env('ANTHROPIC_EFFORT', 'high') };

    const gastoDe = (id: string | null, slug: string) => {
      const itens = gastoDoMes.itens.filter((i) => (id && i.funcao === id) || i.agentSlug === slug);
      if (!itens.length) return { gasto: null, ultimo: null };
      return {
        gasto: {
          totalUsd: Number(itens.reduce((s, i) => s + i.totalUsd, 0).toFixed(6)),
          chamadas: itens.reduce((s, i) => s + i.chamadas, 0),
        },
        ultimo: itens.map((i) => i.ultimoEm).filter((x): x is string => !!x).sort().pop() ?? null,
      };
    };

    const execucaoDoAgente = (a: (typeof agentes)[number] | undefined) => {
      if (!a) return { ultima: null, proxima: null };
      const ultima = a.ultimaExecucaoEm
        ? { em: a.ultimaExecucaoEm.toISOString(), status: a.ultimoStatus, fonte: 'agente' as const }
        : null;
      let proximaEm = a.proximaExecucaoEm;
      if (!proximaEm && a.ativo && a.estado === 'ativo' && a.cron) {
        try {
          proximaEm = proximaOcorrencia(a.cron, a.tz, agora);
        } catch {
          proximaEm = null;
        }
      }
      return { ultima, proxima: proximaEm ? { em: proximaEm.toISOString(), fonte: 'agente' as const } : null };
    };

    const linhas: LinhaDoCatalogo[] = [];

    for (const f of CADASTRO_DE_FUNCOES) {
      const agente = porSlug.get(f.slug);
      const { dono } = donoDaFuncao(f, donos, ctx);
      const doTipo = f.rotina ? rotinas.filter((r) => r.tipo === f.rotina) : [];
      const ligadas = doTipo.filter((r) => r.ativo && r.estado !== 'pausado');

      // ----- estado
      let estado: EstadoDaFuncao = f.estado;
      let estadoMotivo: string | null = null;
      if (f.estado !== 'aposentado') {
        if (agente?.estado === 'encerrado') {
          estado = 'aposentado';
          estadoMotivo = 'encerrado na tela de Agentes';
        } else if (agente && (agente.estado === 'pausado' || !agente.ativo)) {
          estado = 'desligado';
          estadoMotivo = agente.estado === 'pausado' ? 'pausado na tela de Agentes' : 'desligado no registro do agente';
        } else if (doTipo.length && !ligadas.length && f.estado !== 'desligado') {
          estado = 'desligado';
          estadoMotivo = 'rotina desligada em /rotinas';
        } else if (doTipo.length && ligadas.length && f.estado === 'desligado' && f.tipo === 'rotina') {
          estado = 'ativo';
          estadoMotivo = 'rotina ligada em /rotinas';
        }
      }

      // ----- modelo
      let modelo: LinhaDoCatalogo['modelo'] = null;
      if (f.tipo === 'agente' && !f.modeloExterno) {
        const ajustado = !!agente && (!!agente.modelo || (!!agente.effort && agente.effort !== ESFORCO_PADRAO_DA_COLUNA));
        const escolha = modeloDaChamada(
          {
            funcao: f.id,
            model: ajustado ? agente!.modelo ?? undefined : undefined,
            effort: ajustado ? (agente!.effort as never) : undefined,
          },
          { modelo: padrao.modelo, esforco: padrao.esforco as never },
        );
        modelo = {
          modelo: escolha.modelo,
          esforco: escolha.esforco,
          origem: escolha.origem === 'explicito' ? 'registro' : escolha.origem,
        };
      }

      // ----- execução
      const { gasto, ultimo: ultimoGasto } = gastoDe(f.id, f.slug);
      let ultima: LinhaDoCatalogo['ultima'] = null;
      let proxima: LinhaDoCatalogo['proxima'] = null;
      if (doTipo.length) {
        const execs = ultimasExecucoes.filter((e) => doTipo.some((r) => r.id === e.rotinaId));
        const doLog = execs.sort((a, b) => b.inicioEm.getTime() - a.inicioEm.getTime())[0];
        const daColuna = doTipo
          .filter((r) => r.ultimaExecucaoEm)
          .sort((a, b) => b.ultimaExecucaoEm!.getTime() - a.ultimaExecucaoEm!.getTime())[0];
        ultima = doLog
          ? { em: doLog.inicioEm.toISOString(), status: doLog.status, fonte: 'rotina' }
          : daColuna
            ? { em: daColuna.ultimaExecucaoEm!.toISOString(), status: daColuna.ultimoStatus, fonte: 'rotina' }
            : null;
        const proximas = ligadas
          .map((r) => {
            if (r.proximaExecucaoEm) return r.proximaExecucaoEm;
            try {
              return proximaOcorrencia(r.cron, r.tz, agora);
            } catch {
              return null;
            }
          })
          .filter((d): d is Date => !!d)
          .sort((a, b) => a.getTime() - b.getTime());
        proxima = proximas[0] ? { em: proximas[0].toISOString(), fonte: 'rotina' } : null;
      } else {
        const doAgente = execucaoDoAgente(agente);
        ultima = maisRecente(doAgente.ultima, ultimoGasto ? { em: ultimoGasto, status: null, fonte: 'gasto' as const } : null);
        proxima = doAgente.proxima;
      }

      linhas.push({
        id: f.id,
        slug: f.slug,
        nome: f.nome,
        area: f.area,
        tipo: f.tipo,
        aba: abaDoTipo(f.tipo),
        paraQueServe: f.paraQueServe,
        estado,
        estadoDeclarado: f.estado,
        estadoMotivo,
        dono,
        modelo,
        modeloExterno: f.modeloExterno ?? null,
        gatilho: f.gatilho,
        frequencia: f.frequencia,
        nivel: f.nivel,
        capacidades: f.capacidades,
        ultima,
        proxima,
        rotina: f.rotina ? { tipo: f.rotina, cadastradas: doTipo.length, ativas: ligadas.length } : null,
        gastoMes: gasto,
        onde: f.onde,
        soNoPapel: !!f.soNoPapel,
        registrado: !!agente,
      });
    }

    // Os registros `Agent` fora do cadastro: nada da tela de hoje some.
    for (const a of agentes) {
      if (funcaoPorSlug(a.slug)) continue;
      const tipo: FuncaoDoCadastro['tipo'] = a.tipo === 'llm' ? 'agente' : 'automacao';
      const estado: EstadoDaFuncao =
        a.estado === 'encerrado' ? 'aposentado' : a.estado === 'ativo' && a.ativo ? 'ativo' : 'desligado';
      const { gasto, ultimo } = gastoDe(null, a.slug);
      const doAgente = execucaoDoAgente(a);
      const ajustado = !!a.modelo || (!!a.effort && a.effort !== ESFORCO_PADRAO_DA_COLUNA);
      linhas.push({
        id: null,
        slug: a.slug,
        nome: a.nome,
        area: 'Fora do cadastro',
        tipo,
        aba: abaDoTipo(tipo),
        paraQueServe: a.missao,
        estado,
        estadoDeclarado: null,
        estadoMotivo: estado === 'ativo' ? null : `estado no registro: ${a.estado}${a.ativo ? '' : ' (desligado)'}`,
        dono: donoEfetivo(null, donos.get(a.slug), ctx),
        modelo:
          tipo === 'agente'
            ? {
                modelo: a.modelo || padrao.modelo,
                esforco: ajustado ? a.effort : padrao.esforco,
                origem: ajustado ? 'registro' : 'padrao',
              }
            : null,
        modeloExterno: null,
        gatilho: a.cron ? `relógio (${a.cron})` : 'sob demanda',
        frequencia: a.cron ?? 'sob demanda',
        nivel: '',
        capacidades: [],
        ultima: maisRecente(doAgente.ultima, ultimo ? { em: ultimo, status: null, fonte: 'gasto' as const } : null),
        proxima: doAgente.proxima,
        rotina: null,
        gastoMes: gasto,
        onde: 'apps/api/src/agents/ (registro criado pela tela)',
        soNoPapel: false,
        registrado: true,
      });
    }

    return {
      mes: gastoDoMes.mes,
      provedor: env('LLM_PROVIDER', 'anthropic'),
      padrao,
      linhas,
      geradoEm: agora.toISOString(),
    };
  }
}
