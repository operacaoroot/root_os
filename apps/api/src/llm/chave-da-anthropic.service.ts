import { BadRequestException, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

import { CofreService, EmpresaDivergenteNoCofreError, SegredoIndisponivelError } from '../cofre/cofre.service';
import { MemoriaDeResolucao } from '../common/tenant-publico';
import { env, envOpcional } from './env';
import { CONECTOR_ANTHROPIC, modelosPorFuncaoEmVigor, type ModeloEmVigor } from './modelo-da-chamada';
import type { LlmEffort } from './llm.provider';

/*
 * ============================================================================
 * A CHAVE DA ANTHROPIC POR EMPRESA (leva 5, L8, 27/10/2026)
 * ============================================================================
 *
 * Até esta leva a chave só entrava por variável de ambiente, e a produção já
 * tem uma. O pedido (item 21 da reunião de 26/10) é poder gravar a chave pela
 * tela de Conexões, como as outras conexões, SEM quebrar o que está no ar.
 *
 * A REGRA, por chamada: cofre da empresa da chamada (`SegredoDeConector`,
 * conector `anthropic`, nome `api_key`) → senão a variável de ambiente → senão
 * nenhuma. Enquanto ninguém gravar chave pela tela, nada muda: o cofre não tem a
 * linha, a leitura cai na variável como sempre caiu.
 *
 * MORA EM `src/llm/` DE PROPÓSITO: a catraca "o modelo tem uma casa só"
 * (`test/arquitetura.test.ts`) só deixa esta pasta ler a credencial do modelo e
 * falar com `api.anthropic.com`. O conector de Conexões (`integrations/`) pede a
 * este serviço o que precisa: nunca vê a chave, só o final dela.
 *
 * A MEMÓRIA DE 60 s por empresa existe porque toda chamada ao modelo passaria a
 * custar uma ida ao cofre; ela é esquecida ao gravar e ao remover, então a troca
 * vale na hora neste processo. Fraqueza declarada, igual à do próprio cofre: numa
 * segunda instância da API a chave antiga vale por até um minuto. Hoje há uma.
 *
 * SEM CONTEXTO DE EMPRESA (script, cron sem `comContexto`), o cofre recusa a
 * leitura (`EmpresaDivergenteNoCofreError`) e a chave é a da variável, como hoje.
 * Cofre fora do ar também cai na variável, com aviso no log: a chave da tela é um
 * acréscimo, e indisponibilidade dela não pode parar a IA que já funcionava.
 */

/** O nome do segredo no cofre. Um só: a Anthropic autentica com uma chave. */
export const NOME_DA_CHAVE_NO_COFRE = 'api_key';
export const VALIDADE_DA_CHAVE_EM_MEMORIA_MS = 60_000;
/** O prazo da sonda ("Testar"): abaixo dos 6 s do registro do contrato, com folga. */
export const PRAZO_DA_SONDA_MS = 4_500;
/** O caminho da tela que mostra o teto diário de custo de IA (link do cartão). */
export const CAMINHO_DO_TETO_DE_CUSTO = '/painel/custo-ia';

const FORMATO_DA_CHAVE = /^sk-ant-[A-Za-z0-9_-]{20,}$/;
const TETO_DE_MEMORIA = 500;

export type OrigemDaChave = 'cofre' | 'ambiente';

export interface ChaveEfetiva {
  chave: string;
  origem: OrigemDaChave;
}

export interface ResultadoDaSonda {
  ok: boolean;
  /** De onde saiu a chave testada; `null` quando não havia chave nenhuma. */
  origem: OrigemDaChave | null;
  /** Os 4 últimos caracteres da chave testada. Nunca mais do que isso. */
  final: string | null;
  /** O primeiro modelo que a Anthropic listou para esta chave. */
  modelo: string | null;
  latenciaMs: number;
  erro: string | null;
}

export interface EstadoDaChave {
  origem: OrigemDaChave | 'nenhuma';
  /** Quando a chave do cofre foi gravada (nulo fora do cofre). */
  gravadaEm: string | null;
  versao: number | null;
  final: string | null;
  /** Há chave na variável de ambiente da API (o fato, nunca o valor). */
  ambienteTemChave: boolean;
}

/** Por que uma chave digitada não serve, em português; `null` quando serve. */
export function motivoParaRecusarChave(chave: unknown): string | null {
  if (typeof chave !== 'string' || !chave.trim()) return 'Cole a chave da API da Anthropic.';
  const limpa = chave.trim();
  if (/\s/.test(limpa)) return 'A chave veio com espaço ou quebra de linha no meio. Cole só a chave.';
  if (!limpa.startsWith('sk-ant-')) return 'Isto não parece uma chave da Anthropic: ela começa com "sk-ant-".';
  if (limpa.length > 400) return 'A chave veio comprida demais para ser uma chave da Anthropic.';
  if (!FORMATO_DA_CHAVE.test(limpa)) return 'A chave tem caracteres que uma chave da Anthropic não tem. Confira se copiou inteira.';
  return null;
}

/** Os 4 últimos caracteres, para a tela e para a auditoria. */
export function finalDaChave(chave: string): string {
  return chave.trim().slice(-4);
}

/** Tira qualquer chave que apareça num texto de erro antes de ele sair daqui. */
export function semChaveNoTexto(texto: string): string {
  return texto.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-…');
}

/** A frase de um erro do SDK, em português quando o código diz o bastante. */
function fraseDaFalha(e: unknown): string {
  const status = (e as { status?: number })?.status;
  if (status === 401) return 'A Anthropic recusou a chave (401): inválida ou revogada.';
  if (status === 403) return 'A Anthropic aceitou a chave mas negou o acesso (403): confira as permissões da chave na console.';
  if (status === 429) return 'A Anthropic respondeu 429: limite de uso atingido para esta chave.';
  if ((e as { name?: string })?.name === 'APIConnectionTimeoutError') return `A Anthropic não respondeu em ${PRAZO_DA_SONDA_MS} ms.`;
  const m = e instanceof Error ? e.message : String(e ?? '');
  return (m.replace(/\s+/g, ' ').trim() || 'erro sem mensagem').slice(0, 300);
}

@Injectable()
export class ChaveDaAnthropicService {
  private readonly log = new Logger('ChaveDaAnthropic');
  /** A chave do cofre por empresa, por até 60 s. `null` guardado = a empresa não tem linha no cofre. */
  private readonly memoria = new MemoriaDeResolucao<string>({
    validadeMs: VALIDADE_DA_CHAVE_EM_MEMORIA_MS,
    validadeNegativaMs: VALIDADE_DA_CHAVE_EM_MEMORIA_MS,
    teto: TETO_DE_MEMORIA,
  });
  private cofreJaRespondeu = false;

  constructor(
    /** `@Optional()` porque a suíte monta à mão; sem cofre vale só a variável de ambiente. */
    @Optional() private readonly cofre?: CofreService,
  ) {}

  /** A chave da variável de ambiente da API (vazia quando não há). */
  get doAmbiente(): string {
    return envOpcional('ANTHROPIC_API_KEY');
  }

  get temChaveNoAmbiente(): boolean {
    return this.doAmbiente.length > 0;
  }

  /**
   * Alguma empresa já teve chave do cofre lida ou gravada NESTE processo. É o
   * que deixa `AnthropicProvider.configured` responder "sim" numa instalação sem
   * variável de ambiente, depois da primeira chave gravada pela tela.
   */
  get jaViuCofre(): boolean {
    return this.cofreJaRespondeu;
  }

  /** A chave guardada no cofre desta empresa, ou `null`. Passa pela memória de 60 s. */
  async doCofre(orgId: string | null | undefined): Promise<string | null> {
    if (!this.cofre || !orgId) return null;
    const lembrada = this.memoria.lembrar(orgId);
    if (lembrada.lembrada) return lembrada.valor;
    try {
      const chave = await this.cofre.envolver(
        { orgId, conector: CONECTOR_ANTHROPIC, nome: NOME_DA_CHAVE_NO_COFRE },
        (c) => c.usar(async (segredo) => segredo),
      );
      this.memoria.guardar(orgId, chave);
      this.cofreJaRespondeu = true;
      return chave;
    } catch (e) {
      if (e instanceof SegredoIndisponivelError) {
        // Sem linha (ou revogada): a resposta negativa também vale 60 s.
        this.memoria.guardar(orgId, null);
        return null;
      }
      if (e instanceof EmpresaDivergenteNoCofreError) {
        // Contexto sem empresa (script, cron): não é verdade sobre a empresa, não guarda.
        return null;
      }
      this.log.warn(
        `cofre indisponível para a chave da Anthropic (empresa ${orgId}): ${(e as Error).message}. ` +
          'Vale a variável de ambiente da API nesta chamada.',
      );
      return null;
    }
  }

  /** A chave desta chamada: cofre da empresa → variável de ambiente → nenhuma. */
  async chaveEfetiva(orgId?: string | null): Promise<ChaveEfetiva | null> {
    const doCofre = await this.doCofre(orgId ?? null);
    if (doCofre) return { chave: doCofre, origem: 'cofre' };
    const doAmbiente = this.doAmbiente;
    return doAmbiente ? { chave: doAmbiente, origem: 'ambiente' } : null;
  }

  /** Esquece a memória desta empresa: a próxima chamada relê o cofre. */
  esquecer(orgId: string): void {
    this.memoria.guardar(orgId, null, 0);
  }

  /** Grava (ou troca) a chave desta empresa no cofre. Devolve só a versão e o final. */
  async gravar(entrada: { orgId: string; chave: string; actorId?: string | null }): Promise<{ versao: number; final: string }> {
    const motivo = motivoParaRecusarChave(entrada.chave);
    if (motivo) throw new BadRequestException(motivo);
    if (!this.cofre) {
      throw new ServiceUnavailableException('O cofre não está de pé: sem ele a chave não tem onde ficar guardada.');
    }
    const chave = entrada.chave.trim();
    const r = await this.cofre.guardar({
      orgId: entrada.orgId,
      conector: CONECTOR_ANTHROPIC,
      nome: NOME_DA_CHAVE_NO_COFRE,
      valor: chave,
      origem: 'conexoes',
      actorId: entrada.actorId ?? null,
    });
    this.esquecer(entrada.orgId);
    this.cofreJaRespondeu = true;
    return { versao: r.versao, final: finalDaChave(chave) };
  }

  /** Tira a chave do cofre desta empresa: volta a valer a variável de ambiente. */
  async remover(entrada: { orgId: string; actorId?: string | null; motivo?: string | null }): Promise<{ revogada: boolean }> {
    if (!this.cofre) return { revogada: false };
    const r = await this.cofre.revogar({
      orgId: entrada.orgId,
      conector: CONECTOR_ANTHROPIC,
      nome: NOME_DA_CHAVE_NO_COFRE,
      motivo: entrada.motivo ?? 'chave removida em Conexões; volta a valer a variável de ambiente',
      por: entrada.actorId ?? null,
    });
    this.esquecer(entrada.orgId);
    return { revogada: r.revogados.length > 0 };
  }

  /** O que a tela mostra da chave: de onde vem, quando foi gravada, os 4 últimos. Nunca o valor. */
  async estado(orgId: string): Promise<EstadoDaChave> {
    let linha: { versao: number; atualizadoEm: string } | null = null;
    if (this.cofre) {
      try {
        const { items } = await this.cofre.estado(orgId);
        const l = items.find((i) => i.conector === CONECTOR_ANTHROPIC && i.nome === NOME_DA_CHAVE_NO_COFRE && !i.revogadoEm);
        if (l) linha = { versao: l.versao, atualizadoEm: l.atualizadoEm };
      } catch (e) {
        this.log.warn(`não consegui ler o estado da chave da Anthropic no cofre (empresa ${orgId}): ${(e as Error).message}`);
      }
    }
    const doCofre = linha ? await this.doCofre(orgId) : null;
    if (linha && doCofre) {
      return { origem: 'cofre', gravadaEm: linha.atualizadoEm, versao: linha.versao, final: finalDaChave(doCofre), ambienteTemChave: this.temChaveNoAmbiente };
    }
    return {
      origem: this.temChaveNoAmbiente ? 'ambiente' : 'nenhuma',
      gravadaEm: null,
      versao: null,
      final: null,
      ambienteTemChave: this.temChaveNoAmbiente,
    };
  }

  /**
   * UMA chamada mínima à Anthropic com a chave efetiva: `GET /v1/models?limit=1`,
   * pelo SDK (que é quem conhece o endereço). Não gasta token nem entra no teto
   * de custo: listar modelos não é geração. Nunca lança: o resultado diz.
   */
  async sondar(orgId: string): Promise<ResultadoDaSonda> {
    const efetiva = await this.chaveEfetiva(orgId);
    if (!efetiva) {
      return {
        ok: false,
        origem: null,
        final: null,
        modelo: null,
        latenciaMs: 0,
        erro: 'Nenhuma chave da Anthropic: grave uma aqui em Conexões ou defina a variável de ambiente da API.',
      };
    }
    const comecou = Date.now();
    try {
      const pagina = await this.clienteDaSonda(efetiva.chave).models.list({ limit: 1 });
      return {
        ok: true,
        origem: efetiva.origem,
        final: finalDaChave(efetiva.chave),
        modelo: pagina.data[0]?.id ?? null,
        latenciaMs: Date.now() - comecou,
        erro: null,
      };
    } catch (e) {
      return {
        ok: false,
        origem: efetiva.origem,
        final: finalDaChave(efetiva.chave),
        modelo: null,
        latenciaMs: Date.now() - comecou,
        erro: semChaveNoTexto(fraseDaFalha(e)),
      };
    }
  }

  /** O cliente da sonda, com prazo próprio e sem repetição. Separado para a suíte trocar por um dublê. */
  clienteDaSonda(chave: string): Pick<Anthropic, 'models'> {
    return new Anthropic({ apiKey: chave, maxRetries: 0, timeout: PRAZO_DA_SONDA_MS });
  }

  /** O bloco "Modelo por função" do cartão, com o padrão do provedor que vale neste processo. */
  modelosEmVigor(ambiente: Readonly<Record<string, string | undefined>> = process.env): ModeloEmVigor[] {
    const padrao = { modelo: env('ANTHROPIC_MODEL', 'claude-opus-5-5'), esforco: env('ANTHROPIC_EFFORT', 'high') as LlmEffort };
    return modelosPorFuncaoEmVigor(padrao, ambiente);
  }
}
