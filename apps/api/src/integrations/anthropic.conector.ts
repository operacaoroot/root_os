import { Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import {
  CAMINHO_DO_TETO_DE_CUSTO,
  ChaveDaAnthropicService,
  type EstadoDaChave,
  type ResultadoDaSonda,
} from '../llm/chave-da-anthropic.service';
import { CONECTOR_ANTHROPIC, MODELOS_PERMITIDOS, type ModeloEmVigor } from '../llm/modelo-da-chamada';
import { TetoDeCustoIaService } from '../llm/teto-diario.service';
import { RegistroDeConectores } from './conectores.registry';
import {
  type ConectorDoContrato,
  type ContextoDoVerbo,
  type ResultadoDeAutorizacao,
  type ResultadoDeRevogacao,
  type ResultadoDeSincronizacao,
  type SaudeDeConector,
  conectado,
  erroDeConector,
  naoConfigurado,
} from './contrato-de-conector';

/*
 * ============================================================================
 * O CONECTOR "CLAUDE (ANTHROPIC)" EM CONEXÕES (leva 5, L8, 27/10/2026)
 * ============================================================================
 *
 * Pedido do Rodrigo (item 21 de 26/10): "coloca na parte de integrações a
 * possibilidade de incluirmos a API do Claude". Até aqui a chave só entrava por
 * variável de ambiente, e a produção já tem uma. Este conector põe o Claude no
 * mesmo cartão das outras conexões, com o contrato único dos quatro verbos:
 *
 *   · AUTORIZAR  — não há OAuth: a instrução é gravar a chave na gaveta
 *                  "Configurar" do cartão (ou "pronto", se já há chave no cofre);
 *   · SINCRONIZAR — não se aplica: cada chamada vai ao modelo na hora;
 *   · SAÚDE      — UMA chamada mínima à Anthropic com a chave efetiva (cofre →
 *                  variável), `GET /v1/models?limit=1`, sem gastar token;
 *   · REVOGAR    — tira a chave do COFRE desta empresa; volta a valer a
 *                  variável de ambiente, como antes da leva.
 *
 * QUEM FALA COM A ANTHROPIC É `src/llm/` (`ChaveDaAnthropicService`): a catraca
 * "o modelo tem uma casa só" não deixa este arquivo ler a credencial nem citar o
 * endereço, e é assim que deve ser. Este conector pede e traduz; a chave nunca
 * passa por aqui, só os 4 últimos caracteres.
 *
 * A LINHA DO CATÁLOGO é declarada pelo próprio conector (`linhasDoCatalogo: []`,
 * RF-X-06): `CONNECTORS` em `packages/shared` não muda. Por isso o interruptor
 * de desligamento (`conectores.ts`, que lê `CONNECTORS`) não conhece esta chave,
 * e a tela não oferece "Desligar" neste cartão: desligar o modelo que escreve
 * tudo não é um botão de emergência, é a variável `LLM_PROVIDER`.
 *
 * A AUDITORIA leva só os 4 últimos caracteres da chave, nunca o valor:
 * `integracao.anthropic.chave_gravada`, `integracao.anthropic.chave_removida`,
 * `integracao.anthropic.testada`.
 */

/** O que a gaveta "Configurar" do cartão lê (`GET /integrations/anthropic/estado`). */
export interface EstadoDaConexaoClaude {
  chave: EstadoDaChave;
  /** A lista que uma função pode receber (só leitura: trocar é no ambiente da API). */
  modelosPermitidos: readonly string[];
  modelosPorFuncao: ModeloEmVigor[];
  teto: {
    configurado: boolean;
    ativo: boolean;
    tetoUsd: number | null;
    comprometidoUsd: number | null;
    restanteUsd: number | null;
    dia: string | null;
  };
  caminhoDoTeto: string;
}

@Injectable()
export class AnthropicConector implements OnModuleInit {
  private readonly log = new Logger('ConectorAnthropic');

  constructor(
    private readonly chaves: ChaveDaAnthropicService,
    private readonly contrato: RegistroDeConectores,
    private readonly audit: AuditService,
    /** `@Optional()` porque a suíte monta à mão; sem ele o cartão só não mostra o teto. */
    @Optional() private readonly teto?: TetoDeCustoIaService,
  ) {}

  onModuleInit(): void {
    this.contrato.registrar(this.descritor(), 'AnthropicConector');
  }

  /** O que o registro do contrato guarda. Separado para a suíte interrogar sem Nest. */
  descritor(): ConectorDoContrato {
    return {
      chave: CONECTOR_ANTHROPIC,
      rotulo: 'Claude (Anthropic)',
      escopoDaCredencial: 'empresa',
      linhasDoCatalogo: [],
      categoria: 'ai',
      exige:
        'O modelo que escreve e decide nos agentes do OS. A chave da API vai no cofre desta empresa ' +
        '(gaveta Configurar); sem ela, vale a variável de ambiente da API.',
      autorizar: (ctx) => this.autorizar(ctx),
      sincronizar: () => this.sincronizar(),
      saude: (ctx) => this.saude(ctx),
      revogar: (ctx) => this.revogar(ctx),
    };
  }

  // ------------------------------------------------------------------ os verbos

  async autorizar(ctx: ContextoDoVerbo): Promise<ResultadoDeAutorizacao> {
    const estado = await this.chaves.estado(ctx.orgId);
    if (estado.origem === 'cofre') {
      return { tipo: 'pronto', detalhe: `Já há uma chave gravada no cofre desta empresa (····${estado.final}).` };
    }
    return {
      tipo: 'manual',
      instrucao:
        'A Anthropic não tem autorização pelo navegador. Abra "Configurar" no cartão Claude (Anthropic), ' +
        'cole a chave da API (começa com sk-ant-) e grave no cofre. Até lá vale a variável de ambiente da API' +
        (estado.ambienteTemChave ? ', que está preenchida.' : ', que está vazia.'),
    };
  }

  async sincronizar(): Promise<ResultadoDeSincronizacao> {
    return {
      tipo: 'nao_se_aplica',
      motivo: 'O Claude não tem o que sincronizar: cada chamada vai ao modelo na hora. Para conferir a chave, use Testar.',
    };
  }

  /** A sonda: conectado só com a Anthropic respondendo à chave efetiva. */
  async saude(ctx: ContextoDoVerbo): Promise<SaudeDeConector> {
    const r = await this.chaves.sondar(ctx.orgId);
    if (r.ok) return conectado(r.latenciaMs, this.fraseDaOrigem(r));
    if (r.origem === null) return naoConfigurado(r.erro ?? 'Nenhuma chave da Anthropic.');
    return erroDeConector(`${r.erro ?? 'a Anthropic não respondeu'} (${this.fraseDaOrigem(r)})`, r.latenciaMs);
  }

  async revogar(ctx: ContextoDoVerbo & { motivo?: string | null }): Promise<ResultadoDeRevogacao> {
    const r = await this.removerChave(ctx.orgId, ctx.actorId ?? null, ctx.motivo ?? null);
    if (!r.revogada) {
      return {
        tipo: 'nao_se_aplica',
        motivo:
          'Não há chave gravada no cofre desta empresa. A que vale é a da variável de ambiente da API, ' +
          'que não se tira daqui.',
      };
    }
    return {
      tipo: 'revogado',
      segredos: ['api_key'],
      resumo: r.voltaPara === 'ambiente'
        ? 'A chave do cofre foi removida. Volta a valer a variável de ambiente da API, como antes.'
        : 'A chave do cofre foi removida e não há variável de ambiente: os agentes ficam sem modelo até alguém gravar outra chave.',
    };
  }

  // -------------------------------------------------------- as rotas da gaveta

  /** O que a gaveta mostra. Nunca a chave: origem, data, versão e os 4 últimos. */
  async estado(orgId: string): Promise<EstadoDaConexaoClaude> {
    const [chave, consumo] = await Promise.all([
      this.chaves.estado(orgId),
      this.teto ? this.teto.consumo(orgId).catch((e: unknown) => {
        this.log.warn(`não consegui ler o teto de IA da empresa ${orgId}: ${(e as Error).message}`);
        return null;
      }) : Promise.resolve(null),
    ]);
    return {
      chave,
      modelosPermitidos: MODELOS_PERMITIDOS,
      modelosPorFuncao: this.chaves.modelosEmVigor(),
      teto: consumo
        ? {
            configurado: true,
            ativo: consumo.ativo,
            tetoUsd: consumo.tetoUsd,
            comprometidoUsd: consumo.comprometidoUsd,
            restanteUsd: consumo.restanteUsd,
            dia: consumo.dia,
          }
        : { configurado: false, ativo: false, tetoUsd: null, comprometidoUsd: null, restanteUsd: null, dia: null },
      caminhoDoTeto: CAMINHO_DO_TETO_DE_CUSTO,
    };
  }

  /** `PUT /integrations/anthropic/chave`: grava no cofre, esquece a sonda, audita só o final. */
  async gravarChave(orgId: string, chave: string, actorId: string): Promise<{ ok: true; final: string; versao: number }> {
    const r = await this.chaves.gravar({ orgId, chave, actorId });
    this.contrato.esquecer(orgId, CONECTOR_ANTHROPIC);
    await this.registrar(orgId, actorId, 'integracao.anthropic.chave_gravada', { final: r.final, versao: r.versao, origem: 'cofre' });
    return { ok: true, final: r.final, versao: r.versao };
  }

  /** `POST /integrations/anthropic/testar`: a sonda, sob demanda, auditada sem a chave. */
  async testar(orgId: string, actorId: string): Promise<ResultadoDaSonda> {
    const r = await this.chaves.sondar(orgId);
    this.contrato.esquecer(orgId, CONECTOR_ANTHROPIC);
    await this.registrar(orgId, actorId, 'integracao.anthropic.testada', {
      ok: r.ok,
      origem: r.origem,
      final: r.final,
      modelo: r.modelo,
      latenciaMs: r.latenciaMs,
      erro: r.erro,
    });
    return r;
  }

  /** `DELETE /integrations/anthropic/chave` (e o verbo revogar): tira do cofre; volta a variável. */
  async removerChave(
    orgId: string,
    actorId: string | null,
    motivo: string | null,
  ): Promise<{ ok: true; revogada: boolean; voltaPara: 'ambiente' | 'nenhuma' }> {
    const r = await this.chaves.remover({ orgId, actorId, motivo });
    this.contrato.esquecer(orgId, CONECTOR_ANTHROPIC);
    const voltaPara = this.chaves.temChaveNoAmbiente ? 'ambiente' : 'nenhuma';
    if (r.revogada) {
      await this.registrar(orgId, actorId, 'integracao.anthropic.chave_removida', { revogada: true, voltaPara, motivo });
    }
    return { ok: true, revogada: r.revogada, voltaPara };
  }

  // ------------------------------------------------------------------ internos

  private fraseDaOrigem(r: ResultadoDaSonda): string {
    return r.origem === 'cofre' ? `chave do cofre ····${r.final ?? ''}` : 'chave da variável de ambiente da API';
  }

  /**
   * A linha de auditoria. PROTEGIDA, como em `IntegrationsService.registrar`: a
   * falha de registro não desfaz o que já aconteceu, e o que se perde sai no log.
   */
  private async registrar(orgId: string, actorId: string | null, action: string, after: Record<string, unknown>): Promise<void> {
    try {
      await this.audit.log({
        orgId,
        actorId: actorId ?? undefined,
        action,
        entityType: 'integration',
        entityId: CONECTOR_ANTHROPIC,
        after: after as never,
      });
    } catch (e) {
      this.log.error(`${action} (empresa ${orgId}) NÃO foi auditado: ${(e as Error).message} — a ação JÁ ACONTECEU. Conteúdo: ${JSON.stringify(after)}`);
    }
  }
}
