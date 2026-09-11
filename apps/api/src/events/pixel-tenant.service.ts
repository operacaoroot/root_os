import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  MemoriaDeResolucao,
  resolverOrgDaChave,
  resolverOrgDoSlugInterno,
} from '../common/tenant-publico';

/*
 * DE QUEM É O EVENTO QUE ACABOU DE CHEGAR — RF-T-04
 * =================================================
 *
 * `POST /api/events/track` é a única rota da API que qualquer navegador do mundo
 * pode chamar sem credencial nenhuma: é o pixel rodando na página de vendas do
 * cliente. Até esta fatia ela resolvia a empresa com `slug: 'root'` FIXO, e o
 * próprio código anotava isso como pendência ("Fase 2: resolver org por pixel
 * key / domínio"). Enquanto a ROOT era o único tenant, funcionava; no primeiro
 * cliente de verdade, todo evento dele cairia na ROOT.
 *
 * A CHAVE DO PIXEL
 * Quem instala o pixel passa a declarar de quem ele é. A chave viaja no corpo do
 * evento (`pixel_key`) ou na query (`?k=`) — a query existe porque
 * `navigator.sendBeacon` manda corpo mas não manda cabeçalho, e há integração
 * que só consegue mexer na URL.
 *
 * A CHAVE É O `id` DA EMPRESA, E SÓ ELE — e isto é conserto, não preferência
 * A primeira versão desta fatia também aceitava o `slug` ("root", "fullbpo"),
 * "por conveniência de operação". Um revisor mediu o que isso abria, e o nome
 * certo para aquilo é ESCRITA ANÔNIMA EM EMPRESA ALHEIA: de posse do slug de um
 * cliente — que é adivinhável, aparece em URL e em conversa — qualquer pessoa
 * gravava evento na conta dele com nome, endereço, origem, campanha, data e
 * **valor** escolhidos por ela. `value` vira receita no painel e no funil. Não
 * há limite de taxa em lugar nenhum da API, e o gate de módulos não contém,
 * porque libera rota anônima de propósito.
 *
 * O `id` é uuid v4: quem não o recebeu não o adivinha. Ele já existe — não
 * precisou de coluna nova, nem de migration, nem de tela de rotação.
 *
 * O DESENHO CERTO — e por que ele não está aqui
 * Uma chave própria, por site, rotacionável, com o domínio de origem declarado
 * junto (`PixelSite { chave, dominio, orgId, ativo }`), conferindo o `Origin` da
 * requisição e com teto de taxa por chave. Isso exige tabela nova, e
 * `prisma/schema.prisma` é arquivo de outra fatia que roda neste mesmo momento.
 * Está no relatório da fatia 1.4, com o modelo pronto para colar. Enquanto não
 * existir, vale o que dá para afirmar do `id`: ele não se adivinha — mas quem
 * instala o pixel numa página o publica para quem ler o HTML daquela página, e
 * essa pessoa pode injetar evento naquela empresa. É o teto desta fatia.
 *
 * A EMPRESA PADRÃO — a dívida que sobra, agora DECLARADA e contável
 * Pixel já instalado não manda chave nenhuma. Recusar esses eventos apagaria o
 * painel de quem está no ar, então eles continuam caindo na empresa de sempre —
 * só que agora por um caminho com nome, uma constante e um aviso no log, em vez
 * de um `slug: 'root'` no meio de um `upsert`. Quando o inventário do aviso
 * zerar, a constante sai.
 *
 * CHAVE DESCONHECIDA NÃO CAI NO PADRÃO. Um erro de digitação na instalação do
 * cliente despejaria os eventos dele na empresa padrão — e nunca apareceria,
 * porque o painel do cliente ficaria apenas vazio. Chave que não resolve é
 * recusada. CHAVE PRESENTE E INUTILIZÁVEL TAMBÉM: número, lista, objeto, nulo ou
 * string vazia são recusa, não ausência (ver `chaveDoPixel`).
 */

/** A empresa que recebe evento sem chave. Herdada do `slug: 'root'` fixo. */
export const ORG_LEGADA_DO_PIXEL = 'root';

/**
 * Formato aceito de chave, conferido ANTES de qualquer ida ao banco.
 *
 * Não é validação de beleza: a rota é anônima e aberta à internet, e sem isto
 * cada string aleatória vira uma consulta. É a forma de uuid, que é a forma do
 * `Org.id` — e qualquer coisa fora dela não é chave deste sistema.
 */
const CHAVE_ACEITAVEL =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Quanto tempo a resposta de uma chave vale sem reler o banco.
 *
 * Mesma razão do cache de módulos (`tenants/modulos.service.ts`): a pergunta é a
 * mesma o dia inteiro e a rota é a mais quente da API. Constante, e não variável
 * de ambiente, porque variável nova precisa entrar em DOIS lugares (o bloco
 * `environment:` do compose e o `.env`) e isso é decisão de operação.
 */
const VALIDADE_MS = 60_000;
const VALIDADE_NEGATIVA_MS = 10_000;
const TETO_DE_CHAVES = 1_000;

/** De quanto em quanto tempo o inventário de recusas vai para o log. */
const INTERVALO_DO_RELATO_MS = 60_000;

/**
 * O que veio no lugar da chave. TRÊS estados, não dois — e é o conserto de um
 * furo medido: `pixel_key: 12345`, `pixel_key: ['a','b']` e `?k=a&k=b` (o
 * Express entrega lista quando o parâmetro se repete) viravam "não veio chave" e
 * caíam na EMPRESA PADRÃO, que é exatamente o que o comentário acima jura não
 * permitir. Ausência e lixo não são a mesma coisa: ausência é o pixel antigo,
 * lixo é instalação errada ou sonda.
 */
export type ChaveDoPixel =
  | { tipo: 'ausente' }
  | { tipo: 'chave'; valor: string }
  | { tipo: 'inutilizavel'; motivo: 'tipo' | 'vazia' };

/** O que uma das duas fontes (corpo, query) tinha a dizer. */
function daFonte(bruto: unknown): ChaveDoPixel {
  if (bruto === undefined) return { tipo: 'ausente' };
  if (typeof bruto !== 'string') return { tipo: 'inutilizavel', motivo: 'tipo' };
  const limpa = bruto.trim();
  return limpa === '' ? { tipo: 'inutilizavel', motivo: 'vazia' } : { tipo: 'chave', valor: limpa };
}

/**
 * A chave que veio junto do evento — do corpo primeiro, da query depois.
 *
 * O CORPO GANHA de propósito. Query string atravessa log de acesso, proxy
 * reverso e histórico de navegador; o corpo, não. A query existe só porque
 * `navigator.sendBeacon` não manda cabeçalho e há integração que só consegue
 * mexer na URL — é a porta de serviço, não a da frente.
 *
 * Só a AUSÊNCIA no corpo passa a vez para a query: corpo com lixo é recusa ali
 * mesmo. Caso contrário bastaria mandar `pixel_key: 0` junto de um `?k=` para
 * escolher qual fonte vale.
 */
export function chaveDoPixel(corpo: unknown, naQuery?: unknown): ChaveDoPixel {
  const doCorpo =
    typeof corpo === 'object' && corpo !== null
      ? (corpo as { pixel_key?: unknown }).pixel_key
      : undefined;
  const resultado = daFonte(doCorpo);
  return resultado.tipo === 'ausente' ? daFonte(naQuery) : resultado;
}

export type ViaDaResolucao = 'chave' | 'padrao';

export interface TenantDoPixel {
  orgId: string;
  /** Como chegamos nela. Só para log e teste — não muda decisão nenhuma. */
  via: ViaDaResolucao;
}

/** Por que um evento não foi gravado. Vira contador, nunca resposta HTTP. */
export type MotivoDaRecusa = 'inutilizavel' | 'formato' | 'desconhecida' | 'padrao-ausente';

@Injectable()
export class PixelTenantService {
  private readonly log = new Logger('PixelTenant');
  private readonly memoria = new MemoriaDeResolucao<string>({
    validadeMs: VALIDADE_MS,
    validadeNegativaMs: VALIDADE_NEGATIVA_MS,
    teto: TETO_DE_CHAVES,
  });
  private avisouDoPadrao = false;
  private readonly recusas = new Map<MotivoDaRecusa, number>();
  private ultimoRelato = 0;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * A empresa dona deste evento, ou `null` quando não há como saber.
   *
   * `null` é resposta legítima: o chamador NÃO grava — e responde a mesma coisa
   * que responderia se tivesse gravado (ver `events.controller.ts`). Ausência de
   * empresa é erro, nunca "todos" (RF-T-04).
   */
  async resolver(chave: ChaveDoPixel): Promise<TenantDoPixel | null> {
    if (chave.tipo === 'inutilizavel') {
      // Não vai ao banco: a rota é anônima e isto não é sequer uma chave.
      this.contar('inutilizavel');
      return null;
    }

    if (chave.tipo === 'ausente') {
      const orgId = await this.empresaPadrao();
      if (orgId) return { orgId, via: 'padrao' };
      this.contar('padrao-ausente');
      return null;
    }

    if (!CHAVE_ACEITAVEL.test(chave.valor)) {
      this.contar('formato');
      return null;
    }

    const orgId = await this.porId(chave.valor);
    if (orgId) return { orgId, via: 'chave' };
    this.contar('desconhecida');
    return null;
  }

  /** O inventário de recusas, para o teste e para quem for ler o log. */
  contadores(): Record<MotivoDaRecusa, number> {
    return {
      inutilizavel: this.recusas.get('inutilizavel') ?? 0,
      formato: this.recusas.get('formato') ?? 0,
      desconhecida: this.recusas.get('desconhecida') ?? 0,
      'padrao-ausente': this.recusas.get('padrao-ausente') ?? 0,
    };
  }

  /** Só para o teste: a memória e os contadores são por instância. */
  esquecer(): void {
    this.memoria.esquecer();
    this.recusas.clear();
    this.avisouDoPadrao = false;
    this.ultimoRelato = 0;
  }

  /*
   * A RECUSA É CONTADA, NÃO RESPONDIDA.
   *
   * Quem chamou recebe sempre a mesma coisa — senão esta rota anônima vira
   * oráculo de "esta empresa existe" (ver `events.controller.ts`). O log é o
   * único lugar onde a diferença aparece, e mesmo ali em RESUMO periódico: uma
   * linha por recusa deixaria qualquer pessoa na internet encher o disco de
   * quem hospeda.
   */
  private contar(motivo: MotivoDaRecusa): void {
    this.recusas.set(motivo, (this.recusas.get(motivo) ?? 0) + 1);
    const agora = Date.now();
    if (agora - this.ultimoRelato < INTERVALO_DO_RELATO_MS) return;
    this.ultimoRelato = agora;
    const c = this.contadores();
    this.log.warn(
      `eventos de pixel recusados desde o boot — ` +
        `chave inutilizável: ${c.inutilizavel} · formato inválido: ${c.formato} · ` +
        `chave desconhecida: ${c.desconhecida} · empresa padrão ausente: ${c['padrao-ausente']}. ` +
        'A resposta ao chamador é a mesma nos quatro casos, de propósito (RF-T-04).',
    );
  }

  private async porId(id: string): Promise<string | null> {
    return this.lembrando(`id:${id}`, () => resolverOrgDaChave(this.prisma, id));
  }

  private async empresaPadrao(): Promise<string | null> {
    if (!this.avisouDoPadrao) {
      this.avisouDoPadrao = true;
      this.log.warn(
        `evento de pixel SEM chave: caiu na empresa padrão "${ORG_LEGADA_DO_PIXEL}". ` +
          'Instale o pixel com a chave da empresa (data-key / pixel_key) — ' +
          'esta rota deixa de adivinhar quando o inventário zerar.',
      );
    }
    // Pelo SLUG, e só aqui: o valor é uma constante do código, não veio de fora.
    return this.lembrando(`slug:${ORG_LEGADA_DO_PIXEL}`, () =>
      resolverOrgDoSlugInterno(this.prisma, ORG_LEGADA_DO_PIXEL),
    );
  }

  /** Uma ida ao banco por chave viva, e a resposta negativa também lembrada. */
  private async lembrando(
    chave: string,
    consultar: () => Promise<{ orgId: string } | null>,
  ): Promise<string | null> {
    const agora = Date.now();
    const lembrada = this.memoria.lembrar(chave, agora);
    if (lembrada.lembrada) return lembrada.valor;

    const achado = await consultar();
    const orgId = achado?.orgId ?? null;
    this.memoria.guardar(chave, orgId, agora);
    return orgId;
  }
}
