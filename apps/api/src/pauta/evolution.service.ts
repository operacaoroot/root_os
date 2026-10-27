import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { ConexaoDaEvolution, EstadoDaEvolution, OrigemDaCredencialEvolution, QrDaEvolution } from '@mktos/shared';
import { CofreService, SegredoIndisponivelError } from '../cofre/cofre.service';
import { PrismaService } from '../prisma/prisma.service';
import { InterruptoresRegistry } from '../gateway/interruptores.registry';
import { CABECALHO_DO_SEGREDO, segredoDoCanal } from '../gateway/canais/configuracao-do-canal';
import {
  CONECTOR_EVOLUTION,
  type AdministracaoDaEvolution,
  type CredencialDaEvolutionParaGuardar,
  type EnvioPelaEvolution,
  type LeituraDaEvolution,
  type ChaveDaMensagemNaEvolution,
  type MensagemDoAgenteNoGrupo,
  type MidiaBaixadaDaEvolution,
  type MidiaDaCaixaPelaEvolution,
  type MidiaParaEnviarPelaEvolution,
  type RespostaDeGentePelaEvolution,
} from '../gateway/canais/evolution.port';
import { enderecoDeDentro, ipv4Embutido } from './endereco-de-dentro';
import { ipDaConexao, lerCorpoComTeto, pedirAoIp, type Conectar } from './pagina-publica';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { ConectoresConfiguradosRegistry } from '../gateway/conectores-configurados.registry';
import { TransporteDeCanalRegistry } from '../gateway/canais/transporte.registry';
import {
  PRAZO_DA_CHAMADA_DE_SONDA_MS,
  RegistroDeConectores,
} from '../integrations/conectores.registry';
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
} from '../integrations/contrato-de-conector';

/**
 * Quanto tempo a consulta de estado da instância pode demorar para QUEM NÃO É A
 * SONDA — hoje, o portão da publicação no WhatsApp.
 *
 * Dez segundos: o valor que este caminho sempre teve. Está escrito como
 * constante, e não solto no `fetch`, porque agora há dois prazos no arquivo e a
 * diferença entre eles é uma decisão, não um descuido (ver `estado`).
 */
export const PRAZO_DA_CONSULTA_DE_INSTANCIA_MS = 10_000;

/**
 * Quanto a leitura da caixa de WhatsApp (sincronização, produção 22C) pode
 * demorar: a lista de grupos com participantes é a mais lenta (numa instância
 * com centenas de grupos a Evolution passa de um minuto; ver o CLAUDE.md, "O
 * grupo de estratégia"). Trinta segundos: estourou, a rotina registra e tenta
 * na próxima passagem.
 */
export const PRAZO_DA_LEITURA_DA_CAIXA_MS = 30_000;

// Conector WhatsApp via Evolution API. Instância e número DEDICADOS do root —
// o ISOLATION.md proíbe reusar o canal do escritório, e um número compartilhado
// levaria banimento junto se algo aqui disparasse demais.
//
// Por que Evolution e não a Cloud API da Meta: a Cloud API **não envia para
// grupo**, e grupo é o destino. O preço é usar uma conexão não-oficial — daí o
// rate-limit conservador e o envio sempre atrás de aprovação humana.
@Injectable()
export class EvolutionService implements OnModuleInit {
  private readonly log = new Logger('EvolutionService');
  private readonly base = (process.env.EVOLUTION_URL ?? '').replace(/\/$/, '');
  private readonly apiKey = process.env.EVOLUTION_API_KEY ?? '';
  private readonly instancia = process.env.EVOLUTION_INSTANCIA ?? '';
  /** JID do grupo (termina em @g.us) — não é o número de telefone. */
  private readonly grupoPadrao = process.env.EVOLUTION_GRUPO_JID ?? '';

  constructor(
    private readonly efeitos: EfeitosRegistry,
    private readonly conectoresConfigurados: ConectoresConfiguradosRegistry,
    /** O contrato único de conector (fatia 5.4) — módulo `@Global`. */
    private readonly contrato: RegistroDeConectores,
    /*
     * O TRANSPORTE DO CANAL DE APROVAÇÃO (fatia 5.5, RF-A-06) — módulo
     * `@Global`, e `@Optional()` por um motivo concreto: as suítes constroem
     * este serviço À MÃO, com três argumentos posicionais
     * (`test/contrato-de-conector.test.ts`). Um quarto parâmetro obrigatório
     * quebraria uma suíte que não é desta fatia; opcional, ele chega `undefined`
     * ali e o conector se comporta exatamente como antes.
     *
     * Sem ele, o canal de aprovação simplesmente não existe — e não existir é o
     * padrão, não uma falha.
     */
    @Optional() private readonly canais?: TransporteDeCanalRegistry,
  ) {}

  get configured(): boolean {
    return this.base.length > 0 && this.apiKey.length > 0 && this.instancia.length > 0;
  }

  /**
   * O CONTRATO ÚNICO — autorizar, sincronizar, saúde, revogar (RF-X-01).
   *
   * Este conector é o caso em que a honestidade da saúde mais importa: ele é a
   * ÚNICA escrita externa de verdade ligada hoje (R3, `whatsapp.mensagem.enviar`),
   * e uma instância despareada responde "credencial presente" para quem só olha
   * variável de ambiente. A sonda pergunta à Evolution o estado da INSTÂNCIA,
   * que é o que de fato decide se a mensagem vai sair.
   */
  private descritorDoContrato(): ConectorDoContrato {
    return {
      chave: 'whatsapp',
      rotulo: 'WhatsApp (Evolution)',
      /*
       * Instância e número DEDICADOS do root, definidos no ambiente — não há uma
       * instância por empresa. O ISOLATION.md proíbe reusar o canal do
       * escritório justamente porque o número é compartilhado entre tudo o que
       * este processo manda.
       */
      escopoDaCredencial: 'processo',

      autorizar: async (): Promise<ResultadoDeAutorizacao> => ({
        tipo: 'manual',
        instrucao:
          'A Evolution não tem OAuth: a instância é PAREADA por QR code no painel dela, fora ' +
          'do OS, e as credenciais da API ficam no ambiente da API. Quando a sonda diz que a ' +
          'instância não está aberta, o conserto é abrir o painel da Evolution e reconectar o ' +
          'número — nenhuma tela daqui faz isso.',
      }),

      sincronizar: async (): Promise<ResultadoDeSincronizacao> => ({
        tipo: 'nao_se_aplica',
        motivo:
          'Não há espelho local de WhatsApp para trazer: este conector só ENVIA, e enviar é ' +
          'ação de nível R3 — passa pela porta, com aprovação de uma pessoa, nunca por um ' +
          'botão de sincronizar. O histórico de grupo, quando é preciso, é lido direto no ' +
          'banco da Evolution por consulta, fora do OS.',
      }),

      saude: async (): Promise<SaudeDeConector> => {
        const comecou = Date.now();
        // O prazo CURTO, só aqui: ver o cabeçalho de `estado`. O portão da
        // publicação (que roda com ação já aprovada) fica com o prazo longo.
        const e = await this.estado({ prazoMs: PRAZO_DA_CHAMADA_DE_SONDA_MS });
        if (!e.configurada) {
          return naoConfigurado(
            `${e.motivo ?? 'Credenciais da Evolution ausentes no ambiente da API.'} ` +
              'Sem elas nenhuma empresa envia WhatsApp — a instância é do processo, não desta ' +
              'empresa.',
          );
        }
        if (!e.conectada) {
          return erroDeConector(
            `${e.motivo ?? 'A instância não está aberta.'} Nenhuma mensagem sai enquanto isso.`,
            Date.now() - comecou,
          );
        }
        return conectado(
          Date.now() - comecou,
          `instância aberta${e.grupo ? ` · grupo de destino ${e.grupo}` : ' · sem grupo de destino definido'}.`,
        );
      },

      revogar: async (): Promise<ResultadoDeRevogacao> => ({
        tipo: 'nao_se_aplica',
        motivo:
          'A credencial da Evolution é do PROCESSO e o número é um só: queimá-la daqui pararia ' +
          'o WhatsApp de todas as empresas, e não há como fazê-lo só para esta. Para esta ' +
          'empresa parar de enviar AGORA, DESLIGUE o conector em Conexões — a porta recusa a ' +
          'ferramenta na próxima chamada, com motivo e registro no rastro. Para queimar a ' +
          'credencial de verdade, troque a chave no painel da Evolution e no ambiente da API.',
      }),
    };
  }

  /*
   * O CONECTOR DECLARA A CAPACIDADE QUE ELE REALIZA — fatia 3.3.
   *
   * Este efeito morava em `agents/efeitos.service.ts`, que para escrevê-lo tinha
   * de IMPORTAR este serviço. Era a violação mais antiga da catraca de
   * arquitetura: o runtime do agente alcançando um conector por fora da porta.
   * O corpo do efeito não mudou — o que mudou foi de que lado da fronteira ele
   * mora. Quem precisa dele agora é a porta, que o busca no registro.
   */
  onModuleInit(): void {
    this.conectoresConfigurados.registrar('whatsapp', () => this.configured);
    // O contrato único (fatia 5.4). Antes de qualquer coisa, pelo mesmo motivo
    // da linha acima: "sem credencial" é uma RESPOSTA, e o registro derruba o
    // arranque quando um conector cobrado não se inscreve.
    this.contrato.registrar(this.descritorDoContrato(), 'EvolutionService');

    /*
     * O TRANSPORTE DO CANAL DE APROVAÇÃO — fatia 5.5, RF-A-06.
     *
     * O que sai por aqui é mensagem de SERVIÇO para o operador: o pedido de
     * decisão e a resposta a quem decidiu. NÃO é publicação — publicar continua
     * sendo `whatsapp.mensagem.enviar`, que é R3, passa pela porta e só sai com
     * assinatura de gente. O argumento inteiro está no cabeçalho de
     * `gateway/canais/envio-de-aprovacao.service.ts`, no bloco "POR QUE ISTO NÃO
     * É AÇÃO DO GATEWAY".
     *
     * DESTINO SEMPRE DIRETO, NUNCA O GRUPO. O parâmetro é a chave de identidade
     * (o número cadastrado em `ChannelIdentity`), e aqui ela vira o JID de
     * conversa individual. `this.grupo` não aparece nesta função de propósito:
     * mandar pedido de aprovação para o grupo poria o conteúdo exato diante de
     * quem não assina e transformaria uma conversa em superfície de decisão —
     * que é exatamente o que a fatia 5.5 recusa.
     */
    if (this.canais) {
      this.canais.registrar(
        'whatsapp',
        async (destino, texto) => {
          await this.enviarTexto(this.jidDireto(destino), texto);
        },
        'EvolutionService',
      );
    }

    this.efeitos.registrar({
      /*
       * R3: só chega aqui depois que uma pessoa aprovou, e com os argumentos
       * GRAVADOS na proposta — nunca com os que vieram na confirmação.
       *
       * O destino é SEMPRE o grupo configurado no ambiente. O modelo não escolhe
       * para quem manda: um `destino` proposto por ele é ignorado de propósito,
       * senão a régua controlaria o texto e não o destinatário.
       *
       * O terceiro parâmetro é quem pediu (RF-T-04, RNF-09). A Evolution não tem
       * campo para ator, então ele sai no RESULTADO — que é o que a porta grava
       * em `ToolCall.resultado` e o que volta para quem confirmou. Sem isso, o
       * registro do envio diz o que saiu e não diz por ordem de quem: nesta rota
       * o proponente é a IA e o executor é gente, e a diferença é o ponto inteiro
       * da aprovação.
       */
      'whatsapp.mensagem.enviar': async (
        a: Record<string, unknown>,
        _org: string,
        ctx: ContextoDoEfeito,
      ) => {
        const titulo = String(a.titulo ?? '').trim();
        const corpo = String(a.corpo ?? a.texto ?? a.mensagem ?? '').trim();
        if (!corpo) throw new Error('mensagem vazia: nada foi enviado');
        const texto = titulo ? `*${titulo}*\n\n${corpo}` : corpo;
        const r = await this.enviarTexto(this.grupo, texto);
        return {
          enviado: true,
          id: r.id,
          destino: this.grupo,
          caracteres: texto.length,
          porOrdemDe: ctx.actorId ?? null,
        };
      },
    }, 'EvolutionService');
  }

  get grupo(): string {
    return this.grupoPadrao;
  }

  /**
   * A chave de identidade vira o JID de CONVERSA INDIVIDUAL.
   *
   * Aceita a chave na forma canônica (só os dígitos) e na forma de JID inteiro,
   * que é como alguém pode tê-la cadastrado. O que ela nunca produz é um JID de
   * grupo: um valor terminado em `@g.us` chega aqui só se alguém o tiver
   * gravado como identidade de pessoa, e mandar o pedido de aprovação para lá
   * seria publicar o conteúdo exato num grupo. Falha fechada — lança.
   */
  private jidDireto(chave: string): string {
    const cru = chave.trim();
    if (cru.endsWith('@g.us')) {
      throw new Error('identidade de canal aponta para um GRUPO: pedido de aprovação não sai daqui');
    }
    return cru.includes('@') ? cru : `${cru}@s.whatsapp.net`;
  }

  private assert(): void {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Evolution não configurada. Defina EVOLUTION_URL, EVOLUTION_API_KEY e ' +
          'EVOLUTION_INSTANCIA no .env (instância própria do root) e reinicie a API.',
      );
    }
  }

  private async chamar<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      // Só o status (21/10/2026): o corpo do erro da Evolution leva o número de destino.
      await res.text().catch(() => '');
      this.log.error(`Evolution ${path.split('/').slice(0, 3).join('/')} HTTP ${res.status}`);
      throw new ServiceUnavailableException(`Evolution respondeu HTTP ${res.status}.`);
    }
    return (await res.json()) as T;
  }

  /**
   * Estado da conexão — a tela usa para dizer se dá para publicar.
   *
   * ==========================================================================
   * DOIS CHAMADORES, DOIS PRAZOS — e a diferença é deliberada
   * ==========================================================================
   * Quem chama isto não é só a tela de diagnóstico:
   *
   *  · `PautaPublicacaoService.publicarWhatsapp` chama ANTES DE PUBLICAR. É o
   *    portão da única escrita externa viva do produto (R3), e ela chega ali
   *    JÁ APROVADA POR UMA PESSOA. Baixar o prazo desse portão faz uma Evolution
   *    lenta REPROVAR uma publicação já assinada — a mesma mensagem, um efeito
   *    completamente diferente. Por isso o padrão continua sendo
   *    `PRAZO_DA_CONSULTA_DE_INSTANCIA_MS`, os 10 s que este caminho sempre
   *    teve: esta fatia não muda o comportamento de quem já estava em produção;
   *  · a SONDA do contrato passa o prazo curto de propósito (ver `saude`): a
   *    tela de Conexões tem um relógio de fora de 6 s, e o corte de dentro
   *    precisa vencê-lo para que a frase útil ("Instância em 'close' —
   *    reconecte o número") chegue no lugar do "a sonda passou de 6000 ms".
   */
  async estado(
    opcoes: { prazoMs?: number } = {},
  ): Promise<{ configurada: boolean; conectada: boolean; motivo: string | null; grupo: string | null }> {
    if (!this.configured) {
      return { configurada: false, conectada: false, motivo: 'Credenciais ausentes no .env.', grupo: null };
    }
    try {
      const res = await fetch(`${this.base}/instance/connectionState/${this.instancia}`, {
        headers: { apikey: this.apiKey },
        signal: AbortSignal.timeout(opcoes.prazoMs ?? PRAZO_DA_CONSULTA_DE_INSTANCIA_MS),
      });
      if (!res.ok) {
        return {
          configurada: true,
          conectada: false,
          motivo: `A Evolution respondeu HTTP ${res.status} ao consultar a instância.`,
          grupo: this.grupoPadrao || null,
        };
      }
      const j = (await res.json()) as { instance?: { state?: string } };
      const estado = j.instance?.state ?? 'desconhecido';
      return {
        configurada: true,
        conectada: estado === 'open',
        motivo: estado === 'open' ? null : `Instância em "${estado}" — reconecte o número.`,
        grupo: this.grupoPadrao || null,
      };
    } catch (e) {
      return {
        configurada: true,
        conectada: false,
        motivo: `Não deu para falar com a Evolution: ${(e as Error).message}`,
        grupo: this.grupoPadrao || null,
      };
    }
  }

  /** Envia texto para um JID (grupo termina em @g.us). */
  async enviarTexto(jid: string, texto: string): Promise<{ id: string | null }> {
    this.assert();
    const destino = jid || this.grupoPadrao;
    if (!destino) throw new ServiceUnavailableException('Nenhum grupo de destino definido.');

    const r = await this.chamar<{ key?: { id?: string } }>(`/message/sendText/${this.instancia}`, {
      number: destino,
      text: texto,
    });
    return { id: r.key?.id ?? null };
  }
}

// ============================================================================
// A EVOLUTION DA EMPRESA — o WhatsApp do comercial (Rodada de produção 1, 21/10/2026, P8)
// ============================================================================
//
// A classe de cima é a do PROCESSO: a instância da Root no ambiente, que o
// canal de aprovação e a publicação da pauta usam. Esta é a da EMPRESA: o
// comercial de cada empresa fala com o lead pela instância dela, com a
// credencial (endereço, chave da API e nome da instância) no COFRE, por
// empresa. As variáveis `EVOLUTION_URL`, `EVOLUTION_API_KEY` e
// `EVOLUTION_INSTANCIA` ficam como reserva SÓ da empresa da casa (slug `root`):
// empresa cliente nunca usa a credencial do processo, e credencial revogada no
// cofre não cai para o ambiente (revogar é parar).
//
// POR QUE MORA NESTE ARQUIVO, e não num conector novo em `gateway/canais/`:
// a catraca de arquitetura diz que a credencial e o endereço de
// um fornecedor são lidos só pelo conector dele (`CREDENCIAIS`), e o conector
// da Evolution é este arquivo. Um segundo arquivo lendo `EVOLUTION_*` (a reserva
// da casa) seria uma exceção nova na catraca; um segundo cliente HTTP da mesma
// Evolution, um segundo lugar para errar. A classe é provida por
// `gateway/canais/canais.module.ts` (a pasta da porta pode importar conector) e
// chega ao comercial pelas duas portas de `gateway/canais/evolution.port.ts`.
//
// O QUE FOI USADO DA API DA EVOLUTION (v2; rotas conferidas no código-fonte do
// EvolutionAPI/evolution-api: `src/api/routes/instance.router.ts`,
// `group.router.ts`, `src/validate/group.schema.ts` e `message.schema.ts`):
//
//   auth     cabeçalho `apikey: <chave da API>`
//   estado   GET  /instance/connectionState/{instancia}  → { instance: { state: open|connecting|close } }
//   QR       GET  /instance/connect/{instancia}          → { pairingCode, code, base64, count }
//   texto    POST /message/sendText/{instancia}          { number, text }  → { key: { id } }
//   grupo    POST /group/create/{instancia}              { subject, participants: [dígitos], description? }
//                                                         → metadata do grupo, `id` termina em `@g.us`
//   no grupo POST /message/sendText/{instancia}          { number: <jid do grupo>, text }
//
// O ENDEREÇO (a regra contra SSRF, `baseDaEvolution` + `enderecosPermitidos`):
// a Evolution é instalada por quem a usa, então não há domínio oficial para
// conferir. O endereço é escrito por um admin da empresa e
// chamado de dentro da rede dos containers; a regra é:
//
//   · http ou https, sem usuário e senha na URL, sem query nem fragmento, com
//     caminho de prefixo opcional (`https://host/evolution`) e nada de `..`;
//   · nome com ponto (domínio público): só https, e o nome resolvido não pode
//     cair em rede interna (privada, loopback, link-local, ULA);
//   · nome sem ponto (o serviço na rede do Docker, como `http://root_evolution:8080`):
//     só para a EMPRESA DA CASA, em http ou https;
//   · IP literal: nunca. A única exceção é o loopback em ambiente de TESTE
//     (`NODE_ENV=test`), onde o dublê escuta;
//   · link-local (169.254.x.x, fe80::, os metadados da nuvem) e loopback ficam
//     fora para todo mundo, inclusive para a casa, mesmo atrás de um nome.
//
// Redirecionamento não é seguido. A regra de "rede interna" é a da casa
// inteira (`endereco-de-dentro.ts`, Produção 22, M4).
//
// O REBINDING (Produção 22, revisão): para empresa que NÃO é a casa, a conexão
// vai ao IP que foi conferido (`pedirAoIp` de `pagina-publica.ts`, com o
// `Host` e o nome do TLS originais), como a captura da pauta faz. Antes o
// `fetch` resolvia o nome de novo: um DNS com TTL zero respondia público na
// conferência e rede privada na conexão, e a chamada (com a chave da Evolution
// no cabeçalho) ia para dentro. A ÚNICA exceção é a casa: ela pode chamar rede
// privada e nome sem ponto (o `root_evolution` na rede do Docker), então segue
// no `fetch` de sempre, com a conferência antes (loopback e link-local fora).
//
// O que a Evolution responde de erro NÃO vai para a tela nem para o log: só o
// status. O corpo de erro do `sendText` traz o número do destino.

const SLUG_DA_CASA_EVOLUTION = 'root';
const PRAZO_DO_ENVIO_DA_EMPRESA_MS = 20_000;
/** Layout 27/10: baixar ou mandar um arquivo de até 100 MB leva mais que um texto. */
const PRAZO_DA_MIDIA_DA_CAIXA_MS = 120_000;
const CAPACIDADE_DO_ENVIO_DO_COMERCIAL = 'comercial.whatsapp.enviar';
const NOMES_NO_COFRE = { url: 'url', chave: 'chave', instancia: 'instancia' } as const;
const ORIGEM_NO_COFRE = 'Integrações (WhatsApp pela Evolution)';

type CorpoDaEvolution = Record<string, unknown>;

interface CredencialDaEvolution {
  base: string;
  chave: string;
  instancia: string;
  origem: Exclude<OrigemDaCredencialEvolution, 'nenhuma'>;
  daCasa: boolean;
}

/** A empresa ainda não tem Evolution configurada (ou revogou, ou desligou). */
export class EvolutionNaoConfiguradaError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'EvolutionNaoConfiguradaError';
  }
}

/** A Evolution respondeu fora do 2xx. Só o status e a rota: o corpo fica de fora. */
export class EvolutionRespondeuErro extends Error {
  constructor(
    readonly status: number,
    metodo: string,
    rota: string,
  ) {
    super(`A Evolution respondeu HTTP ${status} em ${metodo} ${rota}.`);
    this.name = 'EvolutionRespondeuErro';
  }
}

const emTeste = () => process.env.NODE_ENV === 'test';

function loopbackLiteral(host: string): boolean {
  return host === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * O endereço da Evolution, normalizado (esquema, host, porta e o prefixo de
 * caminho, sem barra no fim), ou `null` quando a regra do cabeçalho recusa.
 * Esta é a parte que não precisa de DNS; a resolução é conferida a cada
 * chamada por `enderecosPermitidos`.
 */
export function baseDaEvolution(entrada: string | null | undefined, opcoes: { daCasa: boolean; teste?: boolean }): string | null {
  const cru = String(entrada ?? '').trim();
  if (!cru) return null;
  let u: URL;
  try {
    u = new URL(cru);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password || u.search || u.hash) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return null;
  const teste = opcoes.teste ?? emTeste();
  if (isIP(host)) {
    if (!(teste && loopbackLiteral(host))) return null;
  } else if (host === 'localhost' || host.endsWith('.localhost')) {
    if (!teste) return null;
  } else if (!host.includes('.')) {
    // Nome sem ponto: o serviço na rede do Docker. Só a casa chama a rede interna.
    if (!opcoes.daCasa) return null;
    if (!/^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/.test(host)) return null;
  } else {
    if (u.protocol !== 'https:') return null;
    if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null;
  }
  const caminho = u.pathname.replace(/\/+$/, '');
  if (caminho && (!/^(\/[A-Za-z0-9._~-]+)+$/.test(caminho) || caminho.split('/').some((p) => p === '..' || p === '.'))) return null;
  return `${u.protocol}//${u.host}${caminho}`;
}

/**
 * Os endereços resolvidos servem? Link-local, loopback e o "qualquer" ficam
 * fora para todo mundo (metadados da nuvem, a própria API); rede privada, só
 * para a casa (é onde mora o `root_evolution`).
 */
export function enderecosPermitidos(enderecos: readonly string[], daCasa: boolean): boolean {
  if (!enderecos.length) return false;
  return enderecos.every((ip) => {
    const x = ip.toLowerCase();
    // O IPv4 embutido em qualquer forma (mapeado em texto ou em hexadecimal, SIIT, compatível, NAT64, 6to4).
    const v4 = isIP(x) === 4 ? x : ipv4Embutido(x);
    if (v4) {
      const [a, b] = v4.split('.').map(Number);
      if (a === 0 || a === 127 || (a === 169 && b === 254) || a >= 224) return false;
    } else if (x === '::' || x === '::1' || /^fe[89ab]/.test(x) || /^ff/.test(x)) {
      return false;
    }
    return daCasa || !enderecoDeDentro(ip);
  });
}

/** O texto que a Evolution espera de um número: só dígitos, de 10 a 15. */
function digitosDoNumero(numero: string): string {
  const d = String(numero ?? '').replace(/\D/g, '');
  if (d.length < 10 || d.length > 15) throw new Error('número de WhatsApp inválido: nada foi enviado');
  return d;
}

/** O QR como `data:` de imagem, ou `null` quando a Evolution não mandou um que sirva. */
function qrComoImagem(v: unknown): string | null {
  if (typeof v !== 'string' || !v || v.length > 300_000) return null;
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) return v;
  if (/^[A-Za-z0-9+/=]+$/.test(v)) return `data:image/png;base64,${v}`;
  return null;
}

const MENSAGEM_DO_ESTADO: Record<'open' | 'connecting' | 'close' | 'desconhecido', string> = {
  open: 'Instância conectada.',
  connecting: 'QR pendente: gere o QR e leia com o WhatsApp do número.',
  close: 'Instância desconectada: gere o QR para ligar o número.',
  desconhecido: 'A Evolution não disse o estado da instância.',
};

@Injectable()
export class EvolutionDaEmpresaService
  implements
    OnModuleInit,
    EnvioPelaEvolution,
    AdministracaoDaEvolution,
    LeituraDaEvolution,
    RespostaDeGentePelaEvolution,
    MidiaDaCaixaPelaEvolution,
    MensagemDoAgenteNoGrupo
{
  private readonly log = new Logger('EvolutionDaEmpresa');
  /** A reserva da casa. Lida uma vez; trocar exige recriar o container, como toda variável. */
  private readonly ambiente = {
    url: (process.env.EVOLUTION_URL ?? '').trim(),
    chave: (process.env.EVOLUTION_API_KEY ?? '').trim(),
    instancia: (process.env.EVOLUTION_INSTANCIA ?? '').trim(),
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly cofre: CofreService,
    /** `@Optional()` porque a suíte monta à mão; sem registro, o conector só não aparece no contrato. */
    @Optional() private readonly contrato?: RegistroDeConectores,
    @Optional() private readonly interruptores?: InterruptoresRegistry,
  ) {}

  /** Resolve o nome do host. Só a suíte troca (para provar a recusa de rede interna sem DNS de verdade). */
  resolver: (host: string) => Promise<string[]> = async (host) => (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);

  onModuleInit(): void {
    this.contrato?.registrar(this.descritor(), 'EvolutionDaEmpresaService');
  }

  // --------------------------------------------------------------- credencial

  private async daCasa(orgId: string): Promise<boolean> {
    const linha = await this.prisma.org.findFirst({ where: { id: orgId, slug: SLUG_DA_CASA_EVOLUTION }, select: { id: true } });
    return !!linha;
  }

  /** Lê um valor do cofre. `undefined` = não existe; `null` = revogado. */
  private async doCofre(orgId: string, nome: string): Promise<string | null | undefined> {
    try {
      return await this.cofre.envolver({ orgId, conector: CONECTOR_EVOLUTION, nome }, (c) => c.usar((v) => v));
    } catch (e) {
      if (e instanceof SegredoIndisponivelError) return e.revogado ? null : undefined;
      throw e;
    }
  }

  private async credencial(orgId: string): Promise<CredencialDaEvolution | { motivo: string }> {
    const casa = await this.daCasa(orgId);
    const chave = await this.doCofre(orgId, NOMES_NO_COFRE.chave);
    if (chave === null) return { motivo: 'A chave da Evolution desta empresa foi revogada. Salve uma chave nova em Integrações.' };
    if (chave) {
      const base = baseDaEvolution(await this.doCofre(orgId, NOMES_NO_COFRE.url), { daCasa: casa });
      const instancia = (await this.doCofre(orgId, NOMES_NO_COFRE.instancia)) ?? '';
      if (!base) return { motivo: 'O endereço da Evolution guardado no cofre não vale mais. Salve de novo em Integrações.' };
      if (!instancia) return { motivo: 'Falta o nome da instância da Evolution. Salve em Integrações.' };
      return { base, chave, instancia, origem: 'cofre', daCasa: casa };
    }
    if (casa && this.ambiente.chave && this.ambiente.instancia) {
      const base = baseDaEvolution(this.ambiente.url, { daCasa: true });
      if (!base) return { motivo: 'EVOLUTION_URL ausente ou fora da regra de endereço no ambiente da API.' };
      return { base, chave: this.ambiente.chave, instancia: this.ambiente.instancia, origem: 'ambiente', daCasa: true };
    }
    return { motivo: 'Evolution não configurada nesta empresa: salve o endereço, a chave e a instância em Integrações.' };
  }

  private async exigirCredencial(orgId: string): Promise<CredencialDaEvolution> {
    const c = await this.credencial(orgId);
    if ('motivo' in c) throw new EvolutionNaoConfiguradaError(c.motivo);
    return c;
  }

  /** O botão de emergência: conector desligado nesta empresa não manda nada. */
  private async exigirLigado(orgId: string): Promise<void> {
    const recusa = await this.interruptores?.consultar({ orgId, conector: CONECTOR_EVOLUTION, capabilityId: CAPACIDADE_DO_ENVIO_DO_COMERCIAL });
    if (recusa) throw new EvolutionNaoConfiguradaError(recusa.motivo);
  }

  /**
   * Quem conecta no IP conferido (empresa que não é a casa). Só a suíte troca,
   * para provar que a conexão vai ao IP da conferência e nunca a uma segunda
   * resolução do nome.
   */
  conectar: Conectar = pedirAoIp;

  /**
   * O host da base resolve para onde a regra deixa? Devolve o IP em que a
   * conexão vai ser aberta. Loopback literal (ou `localhost`) só em teste, onde
   * o dublê escuta.
   */
  private async conferirDestino(base: string, daCasa: boolean): Promise<string> {
    const host = new URL(base).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (isIP(host) || host === 'localhost' || host.endsWith('.localhost')) {
      if (emTeste()) return isIP(host) ? host : '127.0.0.1';
      throw new EvolutionNaoConfiguradaError('O endereço da Evolution não pode ser um IP: use o nome do servidor.');
    }
    let enderecos: string[];
    try {
      enderecos = await this.resolver(host);
    } catch {
      throw new EvolutionNaoConfiguradaError(`Não achei o endereço ${host}.`);
    }
    if (!enderecosPermitidos(enderecos, daCasa)) {
      throw new EvolutionNaoConfiguradaError('O endereço da Evolution aponta para uma rede que esta empresa não pode chamar.');
    }
    return ipDaConexao(enderecos);
  }

  // ---------------------------------------------------------------------- HTTP

  /** Layout 27/10: `tetoDaResposta` corta a leitura da resposta (o base64 de um arquivo) nesse tanto de bytes. */
  private async chamar<T>(
    c: CredencialDaEvolution,
    metodo: 'GET' | 'POST',
    rota: string,
    corpo?: unknown,
    prazoMs = PRAZO_DO_ENVIO_DA_EMPRESA_MS,
    tetoDaResposta?: number,
  ): Promise<T | null> {
    const ip = await this.conferirDestino(c.base, c.daCasa);
    const headers = { apikey: c.chave, 'Content-Type': 'application/json', Accept: 'application/json' };
    const body = corpo === undefined ? undefined : JSON.stringify(corpo);
    const signal = AbortSignal.timeout(prazoMs);
    // A casa segue no `fetch` (rede privada e nome sem ponto são dela); quem não
    // é a casa conecta no IP conferido, sem segunda resolução (rebinding).
    // `pedirAoIp` nunca segue redirecionamento: o 3xx volta como resposta fora do 2xx.
    const res = c.daCasa
      ? await fetch(`${c.base}${rota}`, { method: metodo, headers, ...(body === undefined ? {} : { body }), redirect: 'error', signal })
      : await this.conectar(new URL(`${c.base}${rota}`), ip, { method: metodo, headers, body, signal });
    if (!res.ok) {
      await res.text().catch(() => '');
      throw new EvolutionRespondeuErro(res.status, metodo, rota.split('/').slice(0, 3).join('/'));
    }
    const texto = tetoDaResposta === undefined ? await res.text().catch(() => '') : await lerCorpoComTeto(res, tetoDaResposta);
    if (!texto) return null;
    try {
      return JSON.parse(texto) as T;
    } catch {
      return null;
    }
  }

  private rota(c: CredencialDaEvolution, prefixo: string): string {
    return `${prefixo}/${encodeURIComponent(c.instancia)}`;
  }

  private idDaMensagem(r: CorpoDaEvolution | null): string {
    const key = r && typeof r.key === 'object' && r.key ? (r.key as CorpoDaEvolution) : null;
    const id = key && typeof key.id === 'string' ? key.id : null;
    if (!id) throw new Error('a Evolution não devolveu o id da mensagem enviada');
    return id;
  }

  // -------------------------------------------------------------------- envio

  async enviarAoNumero(orgId: string, numero: string, texto: string): Promise<{ id: string }> {
    await this.exigirLigado(orgId);
    const c = await this.exigirCredencial(orgId);
    const r = await this.chamar<CorpoDaEvolution>(c, 'POST', this.rota(c, '/message/sendText'), { number: digitosDoNumero(numero), text: texto });
    return { id: this.idDaMensagem(r) };
  }

  async abrirGrupo(orgId: string, nome: string, numeros: string[], descricao?: string): Promise<{ jid: string }> {
    await this.exigirLigado(orgId);
    const c = await this.exigirCredencial(orgId);
    const participantes = numeros.map((n) => String(n).replace(/\D/g, '')).filter((n) => n.length >= 10 && n.length <= 15);
    if (!participantes.length) throw new Error('grupo sem participante com número de WhatsApp: nada foi criado');
    const corpo: Record<string, unknown> = { subject: nome.trim().slice(0, 100) || 'Grupo', participants: participantes };
    if (descricao?.trim()) corpo.description = descricao.trim().slice(0, 500);
    const r = await this.chamar<CorpoDaEvolution>(c, 'POST', this.rota(c, '/group/create'), corpo);
    const meta = r && typeof r.groupMetadata === 'object' && r.groupMetadata ? (r.groupMetadata as CorpoDaEvolution) : r;
    const jid = meta && typeof meta.id === 'string' ? meta.id : null;
    if (!jid || !/^[0-9-]+@g\.us$/.test(jid)) throw new Error('a Evolution não devolveu o grupo criado');
    return { jid };
  }

  async enviarAoGrupo(orgId: string, jidDoGrupo: string, texto: string): Promise<{ id: string }> {
    await this.exigirLigado(orgId);
    if (!/^[0-9-]+@g\.us$/.test(String(jidDoGrupo ?? ''))) throw new Error('o destino não é um grupo do WhatsApp (@g.us): nada foi enviado');
    const c = await this.exigirCredencial(orgId);
    const r = await this.chamar<CorpoDaEvolution>(c, 'POST', this.rota(c, '/message/sendText'), { number: jidDoGrupo, text: texto });
    return { id: this.idDaMensagem(r) };
  }

  // ------------------------------------------- caixa de WhatsApp (produção 22C)

  /** O conector ligado nesta empresa, para quem só LÊ ou responde como pessoa (sem a capacidade do comercial). */
  private async exigirConectorLigado(orgId: string): Promise<void> {
    const recusa = await this.interruptores?.consultar({ orgId, conector: CONECTOR_EVOLUTION });
    if (recusa) throw new EvolutionNaoConfiguradaError(recusa.motivo);
  }

  /** W1: os chats que a Evolution guarda (cru). Só leitura. */
  async conversas(orgId: string): Promise<unknown[]> {
    await this.exigirConectorLigado(orgId);
    const c = await this.exigirCredencial(orgId);
    const r = await this.chamar<unknown>(c, 'POST', this.rota(c, '/chat/findChats'), {}, PRAZO_DA_LEITURA_DA_CAIXA_MS);
    return Array.isArray(r) ? r : [];
  }

  /** W1: os grupos da instância, com os participantes (cru). Só leitura. */
  async grupos(orgId: string): Promise<unknown[]> {
    await this.exigirConectorLigado(orgId);
    const c = await this.exigirCredencial(orgId);
    const r = await this.chamar<unknown>(c, 'GET', `${this.rota(c, '/group/fetchAllGroups')}?getParticipants=true`, undefined, PRAZO_DA_LEITURA_DA_CAIXA_MS);
    return Array.isArray(r) ? r : [];
  }

  /** W1: uma página de mensagens de uma conversa (cru; a página 1 é a mais nova). Só leitura. */
  async mensagens(orgId: string, remoteJid: string, pagina: number, porPagina: number): Promise<{ registros: unknown[]; paginas: number }> {
    if (!/^[0-9A-Za-z._:-]{1,80}@(s\.whatsapp\.net|g\.us|lid|c\.us)$/.test(String(remoteJid ?? ''))) {
      throw new Error('conversa do WhatsApp inválida: nada foi lido');
    }
    await this.exigirConectorLigado(orgId);
    const c = await this.exigirCredencial(orgId);
    const corpo = {
      where: { key: { remoteJid } },
      page: Math.max(1, Math.floor(pagina)),
      offset: Math.min(100, Math.max(1, Math.floor(porPagina))),
    };
    const r = await this.chamar<CorpoDaEvolution>(c, 'POST', this.rota(c, '/chat/findMessages'), corpo, PRAZO_DA_LEITURA_DA_CAIXA_MS);
    const msgs = r && typeof r.messages === 'object' && r.messages ? (r.messages as CorpoDaEvolution) : null;
    const registros = Array.isArray(msgs?.records) ? (msgs!.records as unknown[]) : Array.isArray(r) ? (r as unknown[]) : [];
    const paginas =
      typeof msgs?.pages === 'number' && Number.isFinite(msgs.pages) ? Math.max(0, Math.floor(msgs.pages)) : registros.length ? 1 : 0;
    return { registros, paginas };
  }

  /** W1: a URL da foto de um contato ou grupo, ou null. Só leitura; falha vira null. */
  async foto(orgId: string, jid: string): Promise<string | null> {
    try {
      await this.exigirConectorLigado(orgId);
      const c = await this.exigirCredencial(orgId);
      const r = await this.chamar<CorpoDaEvolution>(c, 'POST', this.rota(c, '/chat/fetchProfilePictureUrl'), { number: jid }, PRAZO_DA_LEITURA_DA_CAIXA_MS);
      const url = r && typeof r.profilePictureUrl === 'string' ? r.profilePictureUrl : null;
      return url && /^https:\/\//.test(url) && url.length <= 2000 ? url : null;
    } catch {
      return null;
    }
  }

  /**
   * W2: o texto de uma PESSOA pela caixa. Não é o envio do comercial (que é o
   * efeito de `comercial.whatsapp.enviar`, R3): quem chama é só o serviço da
   * caixa, depois da permissão `whatsapp.conversar` e de conferir que é gente.
   */
  async responderComoPessoa(orgId: string, chatJid: string, texto: string): Promise<{ id: string }> {
    const numero = this.destinoDaCaixa(chatJid);
    if (!String(texto ?? '').trim()) throw new Error('mensagem vazia: nada foi enviado');
    await this.exigirConectorLigado(orgId);
    const c = await this.exigirCredencial(orgId);
    const r = await this.chamar<CorpoDaEvolution>(c, 'POST', this.rota(c, '/message/sendText'), { number: numero, text: texto });
    return { id: this.idDaMensagem(r) };
  }

  /** O `number` da Evolution para uma conversa da caixa (grupo, telefone ou lid), ou lança. */
  private destinoDaCaixa(chatJid: string): string {
    const jid = String(chatJid ?? '');
    if (/^[0-9-]+@g\.us$/.test(jid)) return jid;
    if (/^\d{10,15}@s\.whatsapp\.net$/.test(jid)) return jid.split('@')[0];
    if (/^\d{5,30}@lid$/.test(jid)) return jid;
    throw new Error('o destino não é uma conversa do WhatsApp: nada foi enviado');
  }

  /**
   * Layout 27/10: o arquivo de uma mensagem, para abrir na caixa. Só leitura.
   * A Evolution v2 acha a mensagem guardada pelo `key.id` e baixa a mídia do
   * WhatsApp; o que ela não guarda mais (ou o WhatsApp já apagou) volta fora
   * do 2xx. A resposta é lida até `teto` bytes.
   */
  async baixarMidia(orgId: string, chave: ChaveDaMensagemNaEvolution, teto: number): Promise<MidiaBaixadaDaEvolution> {
    const id = String(chave?.id ?? '');
    if (!id || id.length > 200 || /[\u0000-\u001f\s]/.test(id)) throw new Error('mensagem do WhatsApp inválida: nada foi baixado');
    await this.exigirConectorLigado(orgId);
    const c = await this.exigirCredencial(orgId);
    const key: Record<string, unknown> = { id, remoteJid: chave.remoteJid, fromMe: chave.fromMe === true };
    if (chave.participant) key.participant = chave.participant;
    // O base64 ocupa 4/3 do arquivo, mais o resto do JSON.
    const tetoDoCorpo = Math.ceil((teto * 4) / 3) + 64 * 1024;
    const r = await this.chamar<CorpoDaEvolution>(
      c,
      'POST',
      this.rota(c, '/chat/getBase64FromMediaMessage'),
      { message: { key }, convertToMp4: false },
      PRAZO_DA_MIDIA_DA_CAIXA_MS,
      tetoDoCorpo,
    );
    const base64 = r && typeof r.base64 === 'string' ? r.base64.replace(/^data:[^,]*,/, '') : '';
    return {
      base64,
      mime: r && typeof r.mimetype === 'string' ? r.mimetype : null,
      nome: r && typeof r.fileName === 'string' ? r.fileName : null,
    };
  }

  /**
   * Layout 27/10: o arquivo que uma PESSOA mandou pela caixa. Foto, vídeo e
   * documento por `sendMedia` (com legenda e nome); áudio por
   * `sendWhatsAppAudio` (chega como mensagem de voz, sem legenda).
   */
  async responderMidiaComoPessoa(orgId: string, chatJid: string, midia: MidiaParaEnviarPelaEvolution): Promise<{ id: string }> {
    const numero = this.destinoDaCaixa(chatJid);
    if (!midia?.base64) throw new Error('arquivo vazio: nada foi enviado');
    await this.exigirConectorLigado(orgId);
    const c = await this.exigirCredencial(orgId);
    const r =
      midia.tipo === 'audio'
        ? await this.chamar<CorpoDaEvolution>(c, 'POST', this.rota(c, '/message/sendWhatsAppAudio'), { number: numero, audio: midia.base64 }, PRAZO_DA_MIDIA_DA_CAIXA_MS)
        : await this.chamar<CorpoDaEvolution>(
            c,
            'POST',
            this.rota(c, '/message/sendMedia'),
            {
              number: numero,
              mediatype: midia.tipo,
              mimetype: midia.mime,
              media: midia.base64,
              fileName: midia.nome,
              ...(midia.legenda ? { caption: midia.legenda } : {}),
            },
            PRAZO_DA_MIDIA_DA_CAIXA_MS,
          );
    return { id: this.idDaMensagem(r) };
  }

  /**
   * O agente de tarefas (TR-12) no grupo da equipe — e só nele: o destino é o
   * `AGENTE_TAREFAS_JID` do processo, não um argumento. Menção vira o
   * `mentioned` da Evolution (telefone@s.whatsapp.net); o texto já leva o @.
   */
  async falarNoGrupoDoAgente(orgId: string, texto: string, mencoes: string[] = []): Promise<{ id: string }> {
    const jid = (process.env.AGENTE_TAREFAS_JID ?? '').trim().toLowerCase();
    if (!/^[0-9-]+@g\.us$/.test(jid)) throw new Error('AGENTE_TAREFAS_JID não é um grupo do WhatsApp: nada foi enviado');
    if (!String(texto ?? '').trim()) throw new Error('mensagem vazia: nada foi enviado');
    await this.exigirConectorLigado(orgId);
    const c = await this.exigirCredencial(orgId);
    const mentioned = [...new Set(mencoes.map((m) => String(m).replace(/\D/g, '')).filter((m) => m.length >= 10 && m.length <= 15))]
      .map((m) => `${m}@s.whatsapp.net`);
    const r = await this.chamar<CorpoDaEvolution>(c, 'POST', this.rota(c, '/message/sendText'), {
      number: jid, text: texto, ...(mentioned.length ? { mentioned } : {}),
    });
    return { id: this.idDaMensagem(r) };
  }

  // ----------------------------------------------------------- administração

  async conexao(orgId: string): Promise<Omit<ConexaoDaEvolution, 'provedorDoComercial'>> {
    const { items } = await this.cofre.estado(orgId);
    const chave = items.find((i) => i.conector === CONECTOR_EVOLUTION && i.nome === NOMES_NO_COFRE.chave) ?? null;
    const c = await this.credencial(orgId);
    const desligado = await this.prisma.conectorDesligado.findFirst({ where: { orgId, conector: CONECTOR_EVOLUTION }, select: { conector: true } });
    return {
      origem: 'motivo' in c ? 'nenhuma' : c.origem,
      url: 'motivo' in c ? null : c.base,
      instancia: 'motivo' in c ? null : c.instancia,
      chaveGuardada: !!chave && !chave.revogadoEm,
      chaveRevogadaEm: chave?.revogadoEm ?? null,
      chaveAtualizadaEm: chave && !chave.revogadoEm ? chave.atualizadoEm : null,
      caminhoDoWebhook: `/api/approvals/canal/whatsapp/${orgId}`,
      cabecalhoDoSegredo: CABECALHO_DO_SEGREDO,
      entradaLigada: !!segredoDoCanal(),
      desligado: !!desligado,
    };
  }

  /** Guarda a credencial no cofre. A chave é opcional quando já há uma guardada, e nunca volta. */
  async guardarCredencial(orgId: string, entrada: CredencialDaEvolutionParaGuardar, actorId: string | null): Promise<Omit<ConexaoDaEvolution, 'provedorDoComercial'>> {
    const casa = await this.daCasa(orgId);
    const base = baseDaEvolution(entrada.url, { daCasa: casa });
    if (!base) {
      throw new BadRequestException(
        casa
          ? 'Endereço da Evolution inválido: use https://<servidor> ou o nome do serviço na rede interna (http://root_evolution:8080).'
          : 'Endereço da Evolution inválido: use https://<servidor da Evolution>, sem IP, sem usuário na URL.',
      );
    }
    try {
      await this.conferirDestino(base, casa);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const instancia = String(entrada.instancia ?? '').trim();
    if (!instancia || instancia.length > 100 || !/^[A-Za-z0-9._ -]+$/.test(instancia)) throw new BadRequestException('Informe o nome da instância da Evolution.');
    const chave = String(entrada.chave ?? '').trim();
    if (!chave) {
      const atual = await this.doCofre(orgId, NOMES_NO_COFRE.chave);
      if (!atual) throw new BadRequestException('Informe a chave da API da Evolution.');
    }
    if (chave) await this.cofre.guardar({ orgId, conector: CONECTOR_EVOLUTION, nome: NOMES_NO_COFRE.chave, valor: chave, origem: ORIGEM_NO_COFRE, actorId });
    await this.cofre.guardar({ orgId, conector: CONECTOR_EVOLUTION, nome: NOMES_NO_COFRE.url, valor: base, origem: ORIGEM_NO_COFRE, actorId });
    await this.cofre.guardar({ orgId, conector: CONECTOR_EVOLUTION, nome: NOMES_NO_COFRE.instancia, valor: instancia, origem: ORIGEM_NO_COFRE, actorId });
    return this.conexao(orgId);
  }

  async estadoDaInstancia(orgId: string, prazoMs = PRAZO_DA_CONSULTA_DE_INSTANCIA_MS): Promise<EstadoDaEvolution> {
    const verificadoEm = new Date().toISOString();
    if (!(await this.ligado(orgId))) return { estado: 'desligada', mensagem: 'Conector desligado nesta empresa: nada sai nem entra.', verificadoEm };
    const c = await this.credencial(orgId);
    if ('motivo' in c) return { estado: 'nao_configurada', mensagem: c.motivo, verificadoEm };
    try {
      const r = await this.chamar<CorpoDaEvolution>(c, 'GET', this.rota(c, '/instance/connectionState'), undefined, prazoMs);
      const inst = r && typeof r.instance === 'object' && r.instance ? (r.instance as CorpoDaEvolution) : r;
      const s = inst && typeof inst.state === 'string' ? inst.state : '';
      const estado = s === 'open' || s === 'connecting' || s === 'close' ? s : 'desconhecido';
      return { estado, mensagem: MENSAGEM_DO_ESTADO[estado], verificadoEm };
    } catch (e) {
      const msg =
        e instanceof EvolutionRespondeuErro || e instanceof EvolutionNaoConfiguradaError
          ? e.message
          : 'A Evolution não respondeu a tempo.';
      return { estado: 'erro', mensagem: msg, verificadoEm };
    }
  }

  async gerarQr(orgId: string, actorId: string | null): Promise<QrDaEvolution> {
    const agora = await this.estadoDaInstancia(orgId);
    if (agora.estado === 'open') return { estado: 'open', base64: null, codigoDePareamento: null, mensagem: 'A instância já está conectada: não há QR para ler.' };
    if (agora.estado === 'desligada' || agora.estado === 'nao_configurada') return { estado: agora.estado, base64: null, codigoDePareamento: null, mensagem: agora.mensagem };
    const c = await this.exigirCredencial(orgId);
    const r = await this.chamar<CorpoDaEvolution>(c, 'GET', this.rota(c, '/instance/connect'));
    const base64 = qrComoImagem(r?.base64);
    const codigo = typeof r?.pairingCode === 'string' && /^[A-Z0-9-]{4,16}$/i.test(r.pairingCode) ? r.pairingCode : null;
    // Só o fato vai ao log: o QR liga o número a quem o ler, e não é guardado em lugar nenhum.
    this.log.log(`QR da instância pedido (${orgId}) por ${actorId ?? 'desconhecido'}`);
    return {
      estado: agora.estado,
      base64,
      codigoDePareamento: codigo,
      mensagem: base64 ? 'Leia o QR com o WhatsApp do número (Aparelhos conectados › Conectar um aparelho). Ele vale por poucos segundos.' : 'A Evolution não mandou um QR agora. Tente de novo em alguns segundos.',
    };
  }

  async ligado(orgId: string): Promise<boolean> {
    const recusa = await this.interruptores?.consultar({ orgId, conector: CONECTOR_EVOLUTION });
    return !recusa;
  }

  async instanciaDaEmpresa(orgId: string): Promise<string | null> {
    const c = await this.credencial(orgId);
    return 'motivo' in c ? null : c.instancia;
  }

  // ----------------------------------------------------------------- contrato

  private descritor(): ConectorDoContrato {
    return {
      chave: CONECTOR_EVOLUTION,
      rotulo: 'WhatsApp do comercial (Evolution)',
      escopoDaCredencial: 'empresa',
      linhasDoCatalogo: [CONECTOR_EVOLUTION],
      autorizar: async (): Promise<ResultadoDeAutorizacao> => ({
        tipo: 'manual',
        instrucao:
          'A Evolution não tem OAuth. Em Integrações, no cartão WhatsApp (Evolution), salve o endereço da Evolution, a chave ' +
          'da API e o nome da instância. Se a instância pedir, gere o QR e leia com o WhatsApp do número. Depois aponte o ' +
          'webhook da instância para a URL que o cartão mostra, com o cabeçalho do segredo e o evento de mensagem nova.',
      }),
      sincronizar: async (): Promise<ResultadoDeSincronizacao> => ({
        tipo: 'nao_se_aplica',
        motivo:
          'O espelho do WhatsApp da empresa (a caixa) é mantido pelo webhook, que grava tudo o que chega, e pela rotina ' +
          '"whatsapp.sincronizar" (em /rotinas, a cada 5 minutos, só leitura). Não há o que puxar por aqui.',
      }),
      saude: async (ctx: ContextoDoVerbo): Promise<SaudeDeConector> => {
        const comecou = Date.now();
        const e = await this.estadoDaInstancia(ctx.orgId, PRAZO_DA_CHAMADA_DE_SONDA_MS);
        if (e.estado === 'nao_configurada' || e.estado === 'desligada') return naoConfigurado(e.mensagem);
        if (e.estado === 'open') return conectado(Date.now() - comecou, e.mensagem);
        return erroDeConector(e.mensagem, Date.now() - comecou);
      },
      revogar: async (ctx: ContextoDoVerbo & { motivo?: string | null }): Promise<ResultadoDeRevogacao> => {
        const r = await this.cofre.revogar({ orgId: ctx.orgId, conector: CONECTOR_EVOLUTION, motivo: ctx.motivo ?? null, por: ctx.actorId ?? null });
        if (!r.revogados.length && !r.jaRevogados.length) {
          return {
            tipo: 'nao_se_aplica',
            motivo:
              'Não há credencial da Evolution no cofre desta empresa. Se a casa usa as variáveis EVOLUTION_*, elas são do ' +
              'processo: para parar agora, desligue o conector; para queimar, troque a chave no painel da Evolution.',
          };
        }
        return {
          tipo: 'revogado',
          segredos: r.revogados,
          resumo: 'O endereço, a chave e a instância da Evolution foram queimados no cofre. Nada sai até salvar de novo.',
        };
      },
    };
  }
}
