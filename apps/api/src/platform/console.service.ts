import { Injectable, Logger } from '@nestjs/common';
import { tenantAtual } from '../common/contexto-execucao';
import { PrismaService } from '../prisma/prisma.service';
import { SUPERFICIE_DO_CONSOLE, cercar } from './plataforma';

/*
 * ============================================================================
 * O QUE O CONSOLE DA PLATAFORMA MOSTRA — RF-B-02
 * ============================================================================
 *
 * Saúde, uso e cobrança POR empresa. E só isso: cada número aqui sai de
 * `EmpresaNaPlataforma`, que é linha da PRÓPRIA empresa da plataforma. Nenhuma
 * consulta deste arquivo alcança tabela de cliente — e não é promessa, é cerca:
 * o cliente Prisma que este serviço recebe passou por `cercar()` com a
 * `SUPERFICIE_DO_CONSOLE`, que declara UM modelo e as operações dele. Qualquer
 * outra coisa LANÇA `ForaDaSuperficieError` na primeira tentativa.
 *
 * POR QUE A CERCA E NÃO SÓ O ISOLAMENTO POR LINHA
 * Porque hoje a aplicação conecta como DONA das tabelas, e sob conexão dona a
 * policy de linha é inerte (`anunciarPapel`, em `src/prisma/sessao-de-banco.ts`).
 * Um console que dependesse da policy estaria desprotegido exatamente no
 * ambiente em que ele vai rodar primeiro. Depois da virada para o papel
 * restrito, as duas defesas valem juntas; a suíte mede as duas situações.
 *
 * O `orgId` NO `where`, MESMO COM POLICY
 * A policy recorta, mas só depois da virada. Até lá o filtro escrito é o que
 * segura — e ele é o da empresa DA SESSÃO (`tenantAtual()`), nunca um id vindo
 * do pedido. Filtro por empresa do argumento é o desvio que o inventário da
 * sessão de banco denuncia, e aqui ele nem chega a existir.
 */

/** O recorte do cliente Prisma que este serviço usa. Ver `cercar()`. */
interface PrismaDoConsole {
  empresaNaPlataforma: {
    findMany(args: unknown): Promise<LinhaDaEmpresa[]>;
    findFirst(args: unknown): Promise<LinhaDaEmpresa | null>;
    count(args: unknown): Promise<number>;
    /*
     * SÓ `upsert`. `create` e `update` saíram da superfície na correção de
     * 11/09/2026: `update` endereça por `id` sozinho, e id sozinho não carrega
     * empresa nenhuma — a cerca passou a exigir `orgId` em todo `where`, e
     * `upsert` já traz a chave composta `(orgId, empresaId)`, que carrega.
     */
    upsert(args: unknown): Promise<LinhaDaEmpresa>;
  };
}

interface LinhaDaEmpresa {
  id: string;
  empresaId: string;
  nome: string;
  slug: string;
  plano: string;
  estado: string;
  saude: string;
  usuarios: number;
  agentesAtivos: number;
  gastoIaUsdMes: unknown;
  mensalidadeBrl: unknown;
  cobrancaEmDia: boolean;
  proximaCobranca: Date | null;
  medidoEm: Date | null;
  ultimaAtividadeEm: Date | null;
  observacao: string | null;
  atualizadoEm: Date;
}

/** A empresa como a tela a recebe. Decimal vira número: JSON não tem Decimal. */
export interface EmpresaNoConsole {
  empresaId: string;
  nome: string;
  slug: string;
  plano: string;
  estado: string;
  saude: string;
  usuarios: number;
  agentesAtivos: number;
  gastoIaUsdMes: number;
  mensalidadeBrl: number;
  cobrancaEmDia: boolean;
  proximaCobranca: string | null;
  medidoEm: string | null;
  ultimaAtividadeEm: string | null;
  observacao: string | null;
}

export interface ResumoDoConsole {
  empresas: number;
  ativas: number;
  suspensas: number;
  encerradas: number;
  comIncidente: number;
  inadimplentes: number;
  /** Soma das mensalidades das empresas ATIVAS, em real. */
  receitaMensalBrl: number;
  /** Soma do gasto de IA do mês, em dólar. */
  gastoIaUsdMes: number;
}

export interface RegistroDeEmpresa {
  nome?: string;
  slug?: string;
  plano?: string;
  estado?: string;
  saude?: string;
  usuarios?: number;
  agentesAtivos?: number;
  gastoIaUsdMes?: number;
  mensalidadeBrl?: number;
  cobrancaEmDia?: boolean;
  proximaCobranca?: string | null;
  ultimaAtividadeEm?: string | null;
  observacao?: string | null;
}

const ESTADOS = ['ativa', 'suspensa', 'encerrada'] as const;
const SAUDES = ['ok', 'atencao', 'incidente'] as const;

@Injectable()
export class ConsoleDaPlataformaService {
  private readonly log = new Logger('ConsolePlataforma');
  private readonly cerca: PrismaDoConsole;

  constructor(prisma: PrismaService) {
    this.cerca = cercar(prisma, SUPERFICIE_DO_CONSOLE, 'console') as PrismaDoConsole;
  }

  /**
   * As empresas que a plataforma registrou.
   *
   * Ordem: incidente primeiro, inadimplente depois, e o resto por nome. Quem
   * abre o console quer ver o que está pegando fogo sem procurar.
   */
  async empresas(): Promise<EmpresaNoConsole[]> {
    const orgId = tenantAtual('console da plataforma');
    const linhas = await this.cerca.empresaNaPlataforma.findMany({
      where: { orgId },
      orderBy: [{ saude: 'asc' }, { nome: 'asc' }],
    });
    return linhas.map((l) => paraTela(l)).sort(ordemDoConsole);
  }

  /** Os totais do topo da tela. Somados aqui, sobre as mesmas linhas. */
  async resumo(): Promise<ResumoDoConsole> {
    const lista = await this.empresas();
    const soma = (f: (e: EmpresaNoConsole) => number) => lista.reduce((t, e) => t + f(e), 0);
    return {
      empresas: lista.length,
      ativas: lista.filter((e) => e.estado === 'ativa').length,
      suspensas: lista.filter((e) => e.estado === 'suspensa').length,
      encerradas: lista.filter((e) => e.estado === 'encerrada').length,
      comIncidente: lista.filter((e) => e.saude === 'incidente').length,
      inadimplentes: lista.filter((e) => !e.cobrancaEmDia).length,
      receitaMensalBrl: soma((e) => (e.estado === 'ativa' ? e.mensalidadeBrl : 0)),
      gastoIaUsdMes: soma((e) => e.gastoIaUsdMes),
    };
  }

  /** Uma empresa registrada, ou `null`. */
  async empresa(empresaId: string): Promise<EmpresaNoConsole | null> {
    const orgId = tenantAtual('console da plataforma');
    const linha = await this.cerca.empresaNaPlataforma.findFirst({ where: { orgId, empresaId } });
    return linha ? paraTela(linha) : null;
  }

  /**
   * (Re)registra o que a plataforma sabe sobre uma empresa.
   *
   * É a única escrita do console, e ela escreve em tabela DA PLATAFORMA. Nada
   * aqui toca a empresa descrita — registrar "suspensa" no console não suspende
   * cliente nenhum (quem faz isso é a fatia 6.2); o console REGISTRA, e é por
   * isso que a coluna se chama estado e não interruptor.
   */
  async registrar(empresaId: string, dados: RegistroDeEmpresa): Promise<EmpresaNoConsole> {
    const orgId = tenantAtual('console da plataforma');
    const id = (empresaId ?? '').trim();
    if (!id) throw new Error('registrar: empresaId vazio');

    const estado = escolher(dados.estado, ESTADOS);
    const saude = escolher(dados.saude, SAUDES);

    const comuns = {
      ...(dados.nome !== undefined ? { nome: dados.nome.trim() } : {}),
      ...(dados.slug !== undefined ? { slug: dados.slug.trim() } : {}),
      ...(dados.plano !== undefined ? { plano: dados.plano.trim() } : {}),
      ...(estado ? { estado } : {}),
      ...(saude ? { saude } : {}),
      ...(dados.usuarios !== undefined ? { usuarios: inteiro(dados.usuarios) } : {}),
      ...(dados.agentesAtivos !== undefined
        ? { agentesAtivos: inteiro(dados.agentesAtivos) }
        : {}),
      ...(dados.gastoIaUsdMes !== undefined ? { gastoIaUsdMes: dados.gastoIaUsdMes } : {}),
      ...(dados.mensalidadeBrl !== undefined ? { mensalidadeBrl: dados.mensalidadeBrl } : {}),
      ...(dados.cobrancaEmDia !== undefined ? { cobrancaEmDia: !!dados.cobrancaEmDia } : {}),
      ...(dados.proximaCobranca !== undefined
        ? { proximaCobranca: data(dados.proximaCobranca) }
        : {}),
      ...(dados.ultimaAtividadeEm !== undefined
        ? { ultimaAtividadeEm: data(dados.ultimaAtividadeEm) }
        : {}),
      ...(dados.observacao !== undefined ? { observacao: dados.observacao?.trim() || null } : {}),
    };

    // `medidoEm` sobe junto com qualquer contador: número sem carimbo de quando
    // foi medido é número velho com cara de número de agora.
    const mediu =
      dados.usuarios !== undefined ||
      dados.agentesAtivos !== undefined ||
      dados.gastoIaUsdMes !== undefined;

    const linha = await this.cerca.empresaNaPlataforma.upsert({
      where: { orgId_empresaId: { orgId, empresaId: id } },
      create: {
        orgId,
        empresaId: id,
        nome: dados.nome?.trim() || id,
        slug: dados.slug?.trim() || id,
        ...comuns,
        ...(mediu ? { medidoEm: new Date() } : {}),
      },
      update: { ...comuns, ...(mediu ? { medidoEm: new Date() } : {}) },
    });
    this.log.log(`empresa ${id} registrada no console da plataforma`);
    return paraTela(linha);
  }
}

/* ---------------------------------------------------------------- ajudantes */

function paraTela(l: LinhaDaEmpresa): EmpresaNoConsole {
  return {
    empresaId: l.empresaId,
    nome: l.nome,
    slug: l.slug,
    plano: l.plano,
    estado: l.estado,
    saude: l.saude,
    usuarios: l.usuarios,
    agentesAtivos: l.agentesAtivos,
    gastoIaUsdMes: numero(l.gastoIaUsdMes),
    mensalidadeBrl: numero(l.mensalidadeBrl),
    cobrancaEmDia: l.cobrancaEmDia,
    proximaCobranca: l.proximaCobranca?.toISOString() ?? null,
    medidoEm: l.medidoEm?.toISOString() ?? null,
    ultimaAtividadeEm: l.ultimaAtividadeEm?.toISOString() ?? null,
    observacao: l.observacao,
  };
}

/** Decimal do Prisma vira número. `toString()` antes de `Number` preserva a escala. */
function numero(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(typeof v === 'object' ? String(v) : v);
  return Number.isFinite(n) ? n : 0;
}

function inteiro(v: number): number {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function data(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Valor de vocabulário fechado, ou `undefined` para "não mexe". */
function escolher<T extends readonly string[]>(
  v: string | undefined,
  validos: T,
): T[number] | undefined {
  if (v === undefined) return undefined;
  const limpo = v.trim();
  return (validos as readonly string[]).includes(limpo) ? (limpo as T[number]) : undefined;
}

const PESO_DA_SAUDE: Record<string, number> = { incidente: 0, atencao: 1, ok: 2 };

function ordemDoConsole(a: EmpresaNoConsole, b: EmpresaNoConsole): number {
  const s = (PESO_DA_SAUDE[a.saude] ?? 3) - (PESO_DA_SAUDE[b.saude] ?? 3);
  if (s !== 0) return s;
  const c = Number(a.cobrancaEmDia) - Number(b.cobrancaEmDia);
  if (c !== 0) return c;
  return a.nome.localeCompare(b.nome, 'pt-BR');
}
