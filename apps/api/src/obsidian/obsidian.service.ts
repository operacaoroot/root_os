import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, dirname, sep } from 'node:path';
import { GoogleService } from '../google/google.service';
import type { KnowledgeList, NoteDetail, SearchResult } from '@mktos/shared';
import { comContexto, novaCorrelacao } from '../common/contexto-execucao';
import { comContextoDePlataforma } from '../prisma/contexto-de-plataforma';
import { PrismaService } from '../prisma/prisma.service';
import { ConectoresConfiguradosRegistry } from '../gateway/conectores-configurados.registry';
import {
  PRAZO_DA_CHAMADA_DE_SONDA_MS,
  RegistroDeConectores,
} from '../integrations/conectores.registry';
import { MemoriaService } from '../memory/memoria.service';
import { chaveDaVault } from '../memory/procedencia';
import { env } from '../llm/env';
import {
  FalhaDeEmbedding,
  PRAZO_DA_BUSCA_MS,
  PRAZO_DO_LOTE_MS,
  cortarParaEmbedding,
  descreverVetorizacao,
  mesclarComTextuais,
  vetoresDaResposta,
  vetorizarEmLotes,
  type ResultadoDaVetorizacao,
} from './embeddings-lotes';
import {
  type ConectorDoContrato,
  type ContextoDoVerbo,
  type ResultadoDeAutorizacao,
  type ResultadoDeRevogacao,
  type ResultadoDeSincronizacao,
  type SaudeDeConector,
  conectado,
  erroDeConector,
  frasedoErro,
  naoConfigurado,
} from '../integrations/contrato-de-conector';

/**
 * A empresa da casa, de onde o vault do Obsidian é indexado.
 *
 * Constante do código, nunca valor vindo de fora: era um `'root'` solto no meio
 * da consulta, e slug é adivinhável — o mesmo motivo que tirou o slug da chave
 * do pixel na fatia 1.4 (`src/events/pixel-tenant.service.ts`).
 */
const SLUG_DA_CASA = 'root';

// Base de conhecimento a partir de uma vault Obsidian (montada read-only no container).
// Ingesta .md → KnowledgeNote; embeddings OpenAI (text-embedding-3-small) → pgvector;
// busca SEMÂNTICA (KNN por cosseno) com fallback keyword. Só leitura.
const EMBED_MODEL = 'text-embedding-3-small';

interface ParsedNote {
  path: string;
  folder: string | null;
  title: string;
  tags: string[];
  content: string;
  links: string[];
  wordCount: number;
  fileTime: Date;
}

/**
 * Um arquivo da vault, do jeito que a reindexação precisa dele — e igual nas
 * duas fontes.
 *
 * `ler` é função e não campo porque no Drive cada leitura é uma chamada de
 * rede: quem decide se vale a pena buscar é `reindex`, depois de comparar
 * `modificadoEm` com o que já está indexado.
 */
interface ArquivoDaVault {
  caminho: string;
  modificadoEm: Date;
  ler: () => Promise<string>;
}

@Injectable()
export class ObsidianService implements OnModuleInit {
  private readonly log = new Logger('ObsidianService');
  private readonly vault = process.env.OBSIDIAN_VAULT_PATH ?? '';
  private readonly openaiKey = process.env.OPENAI_API_KEY ?? '';
  private readonly openaiBase = env('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, '');

  /*
   * DE ONDE VEM A VAULT — pasta montada ou Google Drive.
   *
   * `pasta` é o desenho original: um caminho no sistema de arquivos do
   * container. Ele pressupõe que a vault esteja montada ali, e nesta instalação
   * isso nem sempre foi verdade: `OBSIDIAN_VAULT_PATH=/vault` apontou para
   * `/srv/marketing-os/vault`, uma pasta VAZIA desde 13/07/2026. Desde
   * 17/09/2026 esse caminho aponta para o clone da root-base, e a vault lida
   * por `pasta` é esse clone. Se a vault da casa passa a ser lida do Google
   * Drive em vez do clone é decisão em aberto (D1, com o Pedro); este texto não
   * a antecipa.
   *
   * `drive` lê a vault direto do Drive, pela pasta que `OBSIDIAN_DRIVE_FOLDER_ID`
   * apontar — do mesmo jeito que o Obsidian pede uma pasta para ser a vault. O
   * espelho da pauta já ESCREVE no Drive desde a onda 8; isto é a metade que
   * faltava, a da leitura.
   *
   * LIDO NO CONSTRUTOR, como `GATEWAY_MODO`: a fonte aparece no log de arranque
   * e não muda no meio da vida do processo. Trocar exige recriar o container.
   *
   * Valor desconhecido LANÇA em vez de cair no padrão. Uma vault que se acha
   * configurada e lê da pasta errada é pior que uma que recusa subir: a primeira
   * indexa o vazio e some com o índice de quem confiou nela.
   */
  private readonly fonte: 'pasta' | 'drive' = (() => {
    const bruto = (process.env.OBSIDIAN_FONTE ?? 'pasta').trim().toLowerCase();
    if (bruto === 'pasta' || bruto === 'drive') return bruto;
    throw new Error(
      `OBSIDIAN_FONTE="${process.env.OBSIDIAN_FONTE}" não existe. Valores: pasta | drive ` +
        '(vazio = pasta). Preferimos derrubar aqui a indexar a fonte errada em silêncio.',
    );
  })();

  private readonly pastaNoDrive = (process.env.OBSIDIAN_DRIVE_FOLDER_ID ?? '').trim();

  constructor(
    private readonly prisma: PrismaService,
    /*
     * Vem do `GatewayModule`, que é `@Global`: injetar aqui NÃO acrescenta
     * dependência de módulo nenhuma, e é por isso que a inscrição cabe numa
     * linha. Ver o cabeçalho de `gateway/conectores-configurados.registry.ts`.
     */
    private readonly conectoresConfigurados: ConectoresConfiguradosRegistry,
    /**
     * O contrato único de conector (fatia 5.4). Vem de um módulo `@Global`, como
     * o registro acima: injetar aqui não acrescenta aresta de módulo nenhuma.
     */
    private readonly contrato: RegistroDeConectores,
    /**
     * A MEMÓRIA (fatia 4.1+4.2). Esta É uma aresta nova de módulo:
     * `ObsidianModule` passa a importar `MemoryModule`. A direção é essa — e não
     * a contrária — porque quem fala com o fornecedor de embedding é este
     * arquivo, e a catraca de arquitetura existe para que endereço e credencial
     * de fornecedor não escapem do conector. Ver `memory/memoria.module.ts`
     * sobre onde este módulo deveria entrar quando o `AppModule` puder ser
     * editado.
     */
    private readonly memoria: MemoriaService,
    /**
     * O Google, para a fonte `drive` — e este import é EXCEÇÃO DECLARADA na
     * catraca de arquitetura, pelo mesmo motivo que o do espelho da pauta.
     *
     * A regra proíbe um arquivo fora de `src/gateway/` importar conector, e ela
     * está certa: é o que impede endereço e credencial de fornecedor de vazarem
     * para fora da porta. A exceção do espelho foi aceita porque ele chama um
     * método de DESTINO FIXO (`gravarArquivoNoDrive`), por rotina, no Drive da
     * própria casa — não ação proposta por agente, e sem URL arbitrária, já que
     * o passa-tudo `api()` é privado desde a fatia 3.3.
     *
     * Aqui é a mesma coisa ao contrário: `listarVaultNoDrive` e
     * `baixarTextoDoDrive` recebem pasta e arquivo, nunca URL, e são a LEITURA
     * do Drive da casa pela rotina de reindexação. Virar capacidade do catálogo
     * exigiria entrada nova, e capacidade nova em produção só entra por semente
     * assinada.
     *
     * `@Optional()` porque quatro suítes montam este serviço à mão e nenhuma
     * delas usa Drive. A ausência não é silenciosa: com `OBSIDIAN_FONTE=drive`
     * e sem ele, `listarArquivos` recusa em vez de devolver vazio — vault vazia
     * é o estado que apaga índice.
     */
    @Optional() private readonly google?: GoogleService,
  ) {}

  get configured(): boolean {
    if (this.fonte === 'drive') return this.pastaNoDrive.length > 0;
    return this.vault.length > 0 && existsSync(this.vault);
  }

  /** Uma frase curta dizendo de onde esta instalação lê a vault. Vai para o log e para a tela. */
  private get origemLegivel(): string {
    return this.fonte === 'drive'
      ? `Google Drive, pasta ${this.pastaNoDrive || '(não apontada)'}`
      : `pasta ${this.vault || '(não apontada)'}`;
  }

  /**
   * O CONTRATO ÚNICO — autorizar, sincronizar, saúde, revogar (RF-X-01).
   *
   * O Obsidian é o conector que mais exercita a parte "não se aplica" do
   * contrato, e é bom que exercite: ele não tem OAuth, não tem token e não tem
   * nada a revogar. O contrato não o esconde atrás de métodos ausentes — ele diz
   * as três coisas com todas as letras, e é isso que a tela mostra em vez de um
   * botão cinza sem explicação.
   */
  private descritorDoContrato(): ConectorDoContrato {
    return {
      chave: 'obsidian',
      rotulo: 'Obsidian',
      /*
       * `POST knowledge/reindex` sempre exigiu `obsidian.editar`. O verbo do
       * contrato faz a mesma coisa e por isso exige o mesmo — ver
       * `permissaoParaSincronizar`.
       */
      permissaoParaSincronizar: 'obsidian.editar',
      /*
       * A vault é um CAMINHO NO DISCO da máquina que roda a API, montado pelo
       * operador. Não é credencial desta empresa: todas as empresas do processo
       * enxergam a mesma pasta. O que É por empresa são as notas indexadas — e é
       * por isso que a sonda de saúde conta as notas DESTA empresa, não as da
       * pasta.
       */
      escopoDaCredencial: 'processo',

      autorizar: async (): Promise<ResultadoDeAutorizacao> => ({
        tipo: 'manual',
        instrucao:
          'O Obsidian não tem autorização a pedir: a vault é uma pasta montada no disco da ' +
          'máquina que roda a API (só leitura), apontada por variável de ambiente pelo ' +
          'operador da VPS. Se a sonda diz que não está configurado, o conserto é montar a ' +
          'pasta e reiniciar a API — não há tela em que alguém clique "permitir".',
      }),

      sincronizar: async (ctx: ContextoDoVerbo): Promise<ResultadoDeSincronizacao> => {
        const n = await this.reindex(ctx.orgId);
        return {
          tipo: 'feito',
          resumo: `${n} nota(s) relidas da vault e reindexadas para esta empresa.`,
          numeros: { notas: n },
        };
      },

      /**
       * A sonda: LÊ a pasta de verdade, SEM BLOQUEAR O PROCESSO.
       *
       * `existsSync` responde à pergunta errada — uma vault desmontada no meio do
       * dia continua com o caminho "existindo" em alguns arranjos de bind mount,
       * e uma pasta sem permissão de leitura existe e não serve para nada. Abrir
       * o diretório é a tentativa contra a dependência real, que é o que separa
       * verde de verde inventado.
       *
       * ----------------------------------------------------------------------
       * POR QUE `readdir` ASSÍNCRONO, E POR QUE ISSO NÃO É PREFERÊNCIA DE ESTILO
       * ----------------------------------------------------------------------
       * `readdirSync` num ponto de montagem PENDURADO (um NFS/sshfs cujo
       * servidor sumiu — que é o modo normal de uma vault montada morrer)
       * bloqueia a thread principal. E o relógio de fora do registro, que existe
       * justamente para que um conector travado não segure a tela, NÃO PODE
       * DISPARAR enquanto o laço de eventos está preso: ele é um `setTimeout`.
       * O resultado seria a API inteira parada — não a linha do Obsidian em
       * vermelho, que é o que esta fatia promete. A versão assíncrona faz a
       * chamada de disco no pool de threads do libuv: o laço continua girando, o
       * relógio dispara, e uma pasta travada derruba a LINHA dela.
       *
       * O prazo de dentro (`Promise.race`) existe pelo mesmo motivo dos outros
       * conectores: vencer o relógio de fora para que a frase que chegue à tela
       * seja esta, que diz o que fazer.
       */
      saude: async (ctx: ContextoDoVerbo): Promise<SaudeDeConector> => {
        /*
         * "NINGUÉM APONTOU NADA" — e SÓ isso.
         *
         * Não use `configured` aqui: no caminho da pasta ele também responde
         * `existsSync`, e uma vault apontada que sumiu do disco cairia como
         * "não configurado". São dois estados diferentes e o operador faz coisas
         * diferentes com cada um: um pede configuração, o outro pede conserto —
         * e o segundo precisa chegar à tela com a CAUSA REAL, que só o `readdir`
         * lá embaixo conhece. Foi exatamente isso que a suíte do contrato pegou
         * quando a fonte Drive entrou.
         */
        const nadaApontado = this.fonte === 'drive' ? !this.pastaNoDrive : !this.vault;
        if (nadaApontado) {
          return naoConfigurado(
            this.fonte === 'drive'
              ? 'A fonte da vault é o Google Drive, mas nenhuma pasta foi apontada ' +
                '(OBSIDIAN_DRIVE_FOLDER_ID vazio). Enquanto não houver pasta, a base de ' +
                'conhecimento fica vazia para todas as empresas.'
              : 'Nenhuma vault do Obsidian foi apontada no ambiente da API. Enquanto não houver ' +
                'pasta montada, a base de conhecimento fica vazia para todas as empresas.',
          );
        }
        const comecou = Date.now();
        let arquivos: number;
        try {
          /*
           * A RAIZ, E SÓ A RAIZ — nas duas fontes.
           *
           * A pergunta da sonda é "consigo alcançar e ler esta vault AGORA?", e
           * para isso a raiz basta. Percorrer a vault inteira aqui seria uma
           * chamada de rede por subpasta contra o prazo de 4,5 s da sonda: a
           * linha ficaria vermelha por lentidão, não por defeito — e o operador
           * iria procurar um problema que não existe.
           */
          arquivos =
            this.fonte === 'drive'
              ? (await this.lerRaizDaVaultNoDrive(ctx.orgId)).length
              : (await this.lerRaizDaVault()).length;
        } catch (e) {
          return erroDeConector(
            this.fonte === 'drive'
              ? `Não consegui ler a pasta ${this.pastaNoDrive} no Drive: ${frasedoErro(e)}. ` +
                'As causas comuns, nesta ordem: a pasta não está compartilhada com a conta do ' +
                'Google ligada ao OS; o identificador da pasta está errado; ou a autorização do ' +
                'Google expirou. Confira em Conexões qual conta está ligada.'
              : `Não consegui ler a vault em "${this.vault}": ${frasedoErro(e)}. ` +
                'A pasta pode ter sido desmontada, estar pendurada, ou o processo da API pode ter ' +
                'perdido permissão de leitura.',
            Date.now() - comecou,
          );
        }
        /*
         * A PARTE POR EMPRESA. O disco é do processo; o índice é do cliente.
         *
         * ZERO NOTA NÃO É VERDE, e a primeira versão desta fatia dizia o
         * contrário de si mesma aqui: escrevia que responder "a pasta abre" seria
         * verde verdadeiro sobre a pergunta errada — o mesmo defeito do Google —
         * e em seguida devolvia verde com zero nota indexada, mudando só a
         * mensagem. A pergunta desta sonda é "ESTA EMPRESA consegue usar a base
         * de conhecimento AGORA?", e com o índice vazio a resposta é não.
         *
         * `nao_configurado` e não `erro`: nada falhou. Falta rodar a indexação —
         * e o botão que faz isso está na mesma linha da tela.
         */
        const notas = await this.prisma.knowledgeNote.count({ where: { orgId: ctx.orgId } });
        if (notas === 0) {
          return naoConfigurado(
            `A vault abre (${arquivos} entrada(s) na raiz), mas NENHUMA nota está indexada para ` +
              'esta empresa — a base de conhecimento responde vazia a qualquer busca. Rode ' +
              '"sincronizar" nesta linha para indexar.',
          );
        }
        return conectado(
          Date.now() - comecou,
          `vault legível (${arquivos} entrada(s) na raiz) · ${notas} nota(s) indexada(s) para ` +
            'esta empresa.',
        );
      },

      revogar: async (): Promise<ResultadoDeRevogacao> => ({
        tipo: 'nao_se_aplica',
        motivo:
          'Não há credencial do Obsidian para queimar: a vault é uma pasta lida do disco, sem ' +
          'token nem senha. Para esta empresa parar de usar a base de conhecimento agora, ' +
          'DESLIGUE o conector em Conexões. Esvaziar a base rodando "sincronizar" com a vault ' +
          'vazia DEIXOU DE FUNCIONAR na fatia 4.1+4.2, de propósito: vault vazia passou a ser ' +
          'recusada, porque hoje ela arquivaria também a MEMÓRIA versionada — e histórico não ' +
          'vence. O índice continua sendo substituído a cada reindexação legítima.',
      }),
    };
  }

  /**
   * Lê a raiz da vault com prazo próprio, sem bloquear o laço de eventos.
   *
   * `readdir` do `fs/promises` roda no pool de threads do libuv — o laço
   * continua girando, e por isso o relógio de fora do registro consegue
   * disparar. O `race` daqui é o corte de DENTRO: ele vence o de fora e entrega
   * à tela a frase deste conector em vez da genérica.
   *
   * O que o prazo NÃO faz é cancelar a chamada de disco: `readdir` não aceita
   * `AbortSignal` em todas as versões suportadas, e uma thread do pool presa num
   * ponto de montagem morto fica presa. São quatro threads por padrão, então o
   * pior caso conhecido está escrito aqui: quatro sondas simultâneas contra uma
   * vault pendurada esgotam o pool e outras operações de disco esperam. Não é o
   * mesmo que travar a API — e é por isso que a resposta de erro sai na hora,
   * com o nome do problema, em vez de a tela ficar girando.
   */
  /*
   * A raiz da vault quando ela mora no Drive — UM nível, uma chamada.
   *
   * Não reusa `listarVaultNoDrive` de propósito: aquela desce nas subpastas, e
   * a sonda tem 4,5 s. Aqui a pergunta é só "a pasta responde e eu a enxergo?".
   *
   * A ausência do conector do Google LANÇA em vez de devolver vazio: vazio
   * viraria "a pasta abriu e não tem nada", que manda o operador procurar o
   * problema na vault em vez de na fiação.
   */
  private async lerRaizDaVaultNoDrive(orgId: string): Promise<unknown[]> {
    if (!this.google) throw new Error('o conector do Google não está montado neste processo');
    return this.google.listarVaultNoDrive(orgId, this.pastaNoDrive, { apenasRaiz: true });
  }

  private async lerRaizDaVault(prazoMs = PRAZO_DA_CHAMADA_DE_SONDA_MS): Promise<string[]> {
    let relogio: ReturnType<typeof setTimeout> | null = null;
    const estouro = new Promise<never>((_, rejeitar) => {
      relogio = setTimeout(
        () =>
          rejeitar(
            new Error(
              `a pasta não respondeu em ${prazoMs} ms — provavelmente é um ponto de montagem ` +
                'pendurado (o servidor do NFS/sshfs sumiu sem fechar a conexão)',
            ),
          ),
        prazoMs,
      );
      relogio.unref?.();
    });
    try {
      return await Promise.race([readdir(this.vault), estouro]);
    } finally {
      if (relogio) clearTimeout(relogio);
    }
  }

  onModuleInit(): void {
    /*
     * A INSCRIÇÃO VEM ANTES DE QUALQUER RETORNO ANTECIPADO — e a ordem é o
     * ponto, não detalhe.
     *
     * A tela de Conexões lia `OBSIDIAN_VAULT_PATH` por conta própria para
     * decidir o selo "conectado" (`integrations/integrations.service.ts`). O
     * nome da variável virava um contrato duplicado entre a tela e este
     * serviço: renomear aqui — ou passar a ler de outro lugar — faria a tela
     * afirmar "desconectado" sobre uma vault montada, sem erro de compilação e
     * sem nada no log. Agora ela PERGUNTA, e quem responde é quem sabe.
     *
     * Se esta linha ficasse depois do `return` abaixo, uma máquina sem vault
     * não se inscreveria — e o `onApplicationBootstrap` do registro DERRUBA a
     * aplicação quando um conector cobrado não responde. "Sem credencial" é
     * uma RESPOSTA (`false`), não uma ausência de resposta: as duas coisas são
     * diferentes e a tela precisa das duas.
     */
    this.conectoresConfigurados.registrar('obsidian', () => this.configured);

    /*
     * O CONTRATO ÚNICO (fatia 5.4), pela mesma razão e com a mesma ordem: ANTES
     * do retorno antecipado. Uma máquina sem vault precisa responder "não
     * configurado, e aqui está o porquê" — e o registro do contrato derruba o
     * arranque quando um conector cobrado não se inscreve, exatamente como o de
     * cima.
     */
    this.contrato.registrar(this.descritorDoContrato(), 'ObsidianService');

    if (this.vault && !this.configured) {
      this.log.warn(`OBSIDIAN_VAULT_PATH="${this.vault}" não existe — base de conhecimento off.`);
    }

    /*
     * O LAÇO SOBE COM VAULT **OU** COM CHAVE DE EMBEDDING — e a mudança é
     * conserto de um defeito, não generosidade.
     *
     * Ele só subia com vault, e o único caminho que vetoriza nota da MEMÓRIA
     * (`vetorizarPendentesDaMemoria`) morava dentro de `reindex`, que recusa sem
     * vault. Resultado: empresa que não usa Obsidian — que é a maioria delas —
     * NUNCA teria busca semântica na memória. Não "só na volta seguinte":
     * nunca. Nota digitada na tela e resposta promovida (RF-M-06) ficariam para
     * sempre encontráveis só por busca textual.
     *
     * São duas dependências independentes: a vault é uma pasta no disco do
     * processo; a chave de embedding é uma credencial do processo. Sem nenhuma
     * das duas não há o que fazer e o laço não sobe.
     */
    if (!this.configured && !this.openaiKey) return;
    const min = Number(process.env.OBSIDIAN_REINDEX_MIN ?? 30);
    /*
     * A REINDEXAÇÃO É UM CAMINHO DE PLATAFORMA — RF-T-02, RF-T-04.
     *
     * Ela roda 25s depois do arranque e de meia em meia hora, FORA de qualquer
     * requisição: não há token, não há interceptor, não há empresa no contexto.
     * E a primeira consulta é justamente a que DESCOBRE a empresa (a da casa,
     * pelo slug fixo) — não dá para exigir empresa de quem está indo buscá-la.
     *
     * São duas metades, e elas são diferentes de propósito:
     *
     *  1. a busca da empresa roda sob a SENTINELA DE PLATAFORMA, que a política
     *     de linha libera só para LER `Org` (ver `src/prisma/contexto-de-plataforma.ts`
     *     e a migration `20260911050000_isolamento_por_linha`);
     *  2. a indexação inteira — que ESCREVE em `KnowledgeNote` — roda dentro da
     *     empresa encontrada. Daqui em diante este cron é indistinguível de uma
     *     rota autenticada: `app.org_id` sai com a empresa certa e o banco contém
     *     a escrita.
     *
     * Sem a metade 2, sob isolamento por linha a escrita seria recusada (a
     * sentinela não escreve em lugar nenhum) e a base de conhecimento pararia de
     * indexar — em silêncio, porque o `catch` abaixo só avisa.
     */
    /*
     * DUAS METADES COM ALCANCES DIFERENTES, e a diferença é o conserto:
     *
     *  · REINDEXAR é só da CASA. A vault é uma pasta do processo, e indexá-la
     *    para todas as empresas copiaria o contexto da ROOT para dentro de cada
     *    cliente. Continua exatamente como era.
     *  · VETORIZAR A MEMÓRIA é de TODA empresa. A memória de cada uma é dela —
     *    nota digitada na tela, resposta promovida (RF-M-06) — e a chave de
     *    embedding é do processo, não da vault. Antes, este laço só tocava a
     *    casa e só dentro de `reindex`: toda empresa que não fosse a ROOT, e a
     *    própria ROOT quando não houvesse vault, ficavam SEM busca semântica na
     *    memória para sempre. Não "só na volta seguinte": nunca.
     *
     * Falha de uma empresa não derruba as outras: o `catch` é por empresa.
     */
    const run = async () => {
      try {
        const empresas = await comContextoDePlataforma(() =>
          this.prisma.org.findMany({ select: { id: true, slug: true } }),
        );
        const casa = empresas.find((o) => o.slug === SLUG_DA_CASA);

        if (this.configured) {
          if (!casa) {
            this.log.warn(
              `Obsidian reindex: empresa "${SLUG_DA_CASA}" não encontrada — nada a indexar.`,
            );
          } else {
            /*
             * O erro da casa fica na casa. `reindex` lança também quando a
             * vetorização sai incompleta, DEPOIS de indexar e projetar; sem este
             * `catch`, o lançamento pulava o laço abaixo e a memória das outras
             * empresas ficava sem vetorizar nesta volta.
             */
            await comContexto(
              {
                orgId: casa.id,
                actorType: 'system',
                correlationId: novaCorrelacao('obsidian'),
                origem: 'cron',
              },
              async () => this.log.log(`Obsidian reindex: ${await this.reindex(casa.id)} nota(s)`),
            ).catch((e: unknown) => this.log.warn(`Obsidian reindex falhou: ${(e as Error).message}`));
          }
        }

        for (const org of empresas) {
          // A casa já vetorizou dentro do `reindex`, e refazer custaria dinheiro.
          if (this.configured && org.id === casa?.id) continue;
          try {
            await comContexto(
              {
                orgId: org.id,
                actorType: 'system',
                correlationId: novaCorrelacao('obsidian'),
                origem: 'cron',
              },
              () => this.vetorizarPendentesDaMemoria(org.id),
            );
          } catch (e) {
            this.log.warn(
              `memória da empresa ${org.id}: vetorização falhou (${(e as Error).message}). ` +
                'As outras empresas seguiram.',
            );
          }
        }
      } catch (e) {
        this.log.warn(`Obsidian reindex falhou: ${(e as Error).message}`);
      }
    };
    setTimeout(run, 25_000);
    if (min > 0) setInterval(run, min * 60_000);
    this.log.log(
      this.configured
        ? `Obsidian vault "${this.vault}" — reindex a cada ${min} min`
        : `Sem vault do Obsidian: o laço de ${min} min roda só para vetorizar a MEMÓRIA.`,
    );
  }

  // ---------- ingestão ----------
  private walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue; // .obsidian, .trash, etc.
      const full = join(dir, entry.name);
      if (entry.isDirectory()) this.walk(full, acc);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) acc.push(full);
    }
    return acc;
  }

  /*
   * A VAULT, VISTA IGUAL PELAS DUAS FONTES.
   *
   * Cada arquivo chega como caminho, data de modificação e uma função que
   * BUSCA o conteúdo — e a função é preguiçosa de propósito. No filesystem ler
   * é barato; no Drive é uma chamada de rede por arquivo. Devolver o conteúdo
   * junto obrigaria a baixar 152 notas a cada meia hora para descobrir que
   * nenhuma mudou.
   *
   * `modificadoEm` vem de graça na listagem do Drive, e é isso que deixa a
   * reindexação pular o que não mudou — ver `reindex`.
   */
  private async listarArquivos(orgId: string): Promise<ArquivoDaVault[]> {
    if (this.fonte === 'pasta') {
      return this.walk(this.vault).map((full) => ({
        caminho: relative(this.vault, full).split(sep).join('/'),
        modificadoEm: statSync(full).mtime,
        ler: async () => readFileSync(full, 'utf8'),
      }));
    }

    /*
     * As duas recusas abaixo existem porque o retorno delas seria uma lista
     * VAZIA, e lista vazia é o estado que apaga índice e arquiva memória. A
     * guarda de `reindex` pegaria isso adiante, mas com a frase errada — diria
     * "a vault está vazia" quando o problema é que ninguém a apontou.
     */
    if (!this.pastaNoDrive) {
      throw new ServiceUnavailableException(
        'OBSIDIAN_FONTE=drive, mas OBSIDIAN_DRIVE_FOLDER_ID está vazio: nenhuma pasta do Drive ' +
          'foi apontada como vault. Nada foi lido.',
      );
    }
    if (!this.google) {
      throw new ServiceUnavailableException(
        'OBSIDIAN_FONTE=drive, mas o conector do Google não está montado neste processo. Sem ele ' +
          'não há como ler a pasta. Nada foi lido.',
      );
    }

    const arquivos = await this.google.listarVaultNoDrive(orgId, this.pastaNoDrive);
    return arquivos.map((a) => ({
      caminho: a.caminho,
      modificadoEm: a.modificadoEm,
      ler: async () => this.google!.baixarTextoDoDrive(orgId, a.id),
    }));
  }

  /** A leitura do filesystem. O que interpreta é `parseConteudo`, que as duas fontes dividem. */
  private parse(full: string): ParsedNote {
    return this.parseConteudo(relative(this.vault, full), readFileSync(full, 'utf8'), statSync(full).mtime);
  }

  /*
   * A INTERPRETAÇÃO, e ela não sabe de onde o texto veio.
   *
   * Separada de `parse` quando a fonte Drive entrou: sem isso, ler do Drive
   * significaria uma segunda implementação de frontmatter, tags e wikilinks —
   * e duas implementações da mesma leitura divergem na primeira nota estranha,
   * com a busca semântica achando a nota por uma fonte e não pela outra.
   *
   * `caminhoRelativo` usa `/` e é relativo à raiz da vault, nas DUAS fontes: é
   * a chave da nota no índice e na memória. Trocar de fonte com a mesma vault
   * precisa gerar as mesmas chaves, senão a reindexação lê tudo como nota nova
   * e arquiva a memória da origem anterior inteira.
   */
  private parseConteudo(caminhoRelativo: string, raw: string, modificadoEm: Date): ParsedNote {
    const rel = caminhoRelativo;
    const folderRel = dirname(rel);
    const st = { mtime: modificadoEm };

    let body = raw;
    const tags = new Set<string>();
    // frontmatter YAML simples
    const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
    if (fm) {
      body = raw.slice(fm[0].length);
      const inline = fm[1].match(/^tags:\s*\[([^\]]*)\]/m);
      if (inline) inline[1].split(',').forEach((t) => t.trim() && tags.add(t.trim().replace(/['"]/g, '')));
      const block = fm[1].match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
      if (block) block[1].split('\n').forEach((l) => { const m = l.match(/-\s*(.+)/); if (m) tags.add(m[1].trim()); });
    }
    // #tags inline
    for (const m of body.matchAll(/(?:^|\s)#([a-z0-9_\-/]{2,})/gi)) tags.add(m[1]);
    // wikilinks
    const links = [...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim());
    // título: 1º # ou nome do arquivo
    const h1 = body.match(/^#\s+(.+)$/m);
    const title = (h1?.[1] ?? rel.replace(/\.md$/i, '').split('/').pop() ?? rel).trim();

    return {
      path: rel,
      folder: folderRel === '.' ? null : folderRel,
      title,
      tags: [...tags],
      content: body.trim(),
      links: [...new Set(links)],
      wordCount: body.split(/\s+/).filter(Boolean).length,
      fileTime: st.mtime,
    };
  }

  /**
   * UM pedido ao fornecedor. Quem decide quantos textos vão nele é
   * `vetorizarEmLotes`; aqui cada texto é cortado em bytes, o pedido tem prazo
   * e a resposta é conferida antes de virar vetor. Toda falha sai como
   * `FalhaDeEmbedding`, com o status HTTP quando houve um.
   */
  private async embed(texts: string[], prazoMs = PRAZO_DO_LOTE_MS): Promise<number[][]> {
    if (!texts.length) return [];
    const input = texts.map((t) => cortarParaEmbedding(t));
    try {
      const res = await fetch(`${this.openaiBase}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.openaiKey}` },
        body: JSON.stringify({ model: EMBED_MODEL, input }),
        signal: AbortSignal.timeout(prazoMs),
      });
      if (!res.ok) throw new FalhaDeEmbedding(`OpenAI embeddings HTTP ${res.status}`, res.status);
      return vetoresDaResposta(await res.json(), input.length);
    } catch (e) {
      if (e instanceof FalhaDeEmbedding) throw e;
      throw new FalhaDeEmbedding(`OpenAI embeddings sem resposta utilizável (${(e as Error).message})`);
    }
  }

  /**
   * @param completo Refaz a leitura e a vetorização de TODA nota, mesmo as que
   *   não mudaram. É o que se usa quando a INTERPRETAÇÃO muda — `parseConteudo`
   *   ganhando um jeito novo de achar tags, por exemplo. O reaproveitamento
   *   abaixo é por data de modificação do arquivo, e um arquivo que não mudou
   *   continua com a leitura antiga até alguém pedir o contrário.
   *
   * Só a empresa da casa reindexa — ver `exigirEmpresaDaCasa`, que roda antes
   * de qualquer leitura.
   */
  async reindex(orgId: string, completo = false): Promise<number> {
    await this.exigirEmpresaDaCasa(orgId);
    if (!this.configured) {
      throw new ServiceUnavailableException(
        this.fonte === 'drive'
          ? 'OBSIDIAN_DRIVE_FOLDER_ID não configurado.'
          : 'OBSIDIAN_VAULT_PATH não configurado.',
      );
    }
    const files = await this.listarArquivos(orgId);

    /*
     * VAULT QUE EXISTE E ESTÁ VAZIA NÃO É VAULT — É PONTO DE MONTAGEM CAÍDO.
     *
     * `configured` só pergunta se o caminho EXISTE, e um bind mount que morreu,
     * uma variável apontando para a pasta errada ou um volume ainda não montado
     * deixam para trás um diretório vazio que passa nessa pergunta. O que vinha
     * depois era destrutivo em dois níveis: `deleteMany` zerava o índice desta
     * empresa e, desde a fatia 4.1+4.2, a projeção arquivava a MEMÓRIA inteira
     * daquela origem — uma versão e um evento por nota, e outro par quando a
     * pasta voltasse. O índice é descartável; o histórico não vence nunca.
     *
     * NESTA INSTALAÇÃO ISSO JÁ ACONTECEU: o caminho `/srv/marketing-os/vault`,
     * para onde o `OBSIDIAN_VAULT_HOST` da VPS continua apontando, esteve vazio e
     * não era a vault real. Desde 17/09/2026 ele aponta para o clone da
     * root-base, que é a vault lida hoje; a decisão sobre o Drive está em aberto.
     *
     * A recusa vem ANTES de qualquer escrita, e diz o que fazer. Esvaziar a
     * base de propósito continua possível: desligue o conector em Conexões.
     */
    if (files.length === 0) {
      throw new ServiceUnavailableException(
        `A vault (${this.origemLegivel}) existe mas não tem NENHUM arquivo .md. Isso é ponto de ` +
          'montagem caído, pasta errada ou pasta não compartilhada muito mais vezes do que é ' +
          'vault vazia de propósito — e reindexar apagaria o índice desta empresa e arquivaria ' +
          'a memória inteira que veio dela. Nada foi tocado. Confira a origem na API; para ' +
          'esvaziar a base de propósito, DESLIGUE o conector em Conexões.',
      );
    }

    /*
     * O QUE JÁ ESTÁ INDEXADO — e por que ele é lido ANTES de apagar.
     *
     * Sem isto, toda passada relê a vault inteira e vetoriza a vault inteira.
     * No filesystem isso é lento; no Drive é uma chamada de rede por arquivo, a
     * cada meia hora, para descobrir que nada mudou. E a vetorização é dinheiro
     * de verdade: a vault real tem ~1.500 notas, o relógio bate 48 vezes por
     * dia, e esse gasto NÃO passa pelo teto de IA por empresa — quem chama o
     * fornecedor de embedding é este arquivo, direto.
     *
     * A semântica não muda: o índice continua sendo SUBSTITUÍDO, porque a vault
     * é a fonte da verdade dele. O que muda é que uma nota intocada volta com o
     * texto e o vetor que já tinha, em vez de ser baixada e vetorizada de novo.
     *
     * A comparação é por SEGUNDO, não por milissegundo: `modifiedTime` do Drive
     * e `mtime` do filesystem não têm a mesma precisão, e uma diferença de
     * microssegundos na ida e volta do banco marcaria toda nota como mudada —
     * que é exatamente o custo que este bloco existe para evitar.
     */
    const emSegundos = (d: Date): number => Math.floor(d.getTime() / 1000);
    const anteriores = completo
      ? []
      : await this.prisma.knowledgeNote.findMany({
          where: { orgId },
          select: {
            path: true, folder: true, title: true, tags: true,
            content: true, links: true, wordCount: true, fileTime: true,
          },
        });
    const jaIndexado = new Map(anteriores.map((n) => [n.path, n]));

    const vetoresAnteriores = new Map<string, number[]>();
    if (!completo && anteriores.length) {
      const linhas = await this.prisma.$queryRaw<Array<{ path: string; vetor: string | null }>>`
        SELECT "path", embedding::text AS vetor
          FROM "KnowledgeNote"
         WHERE "orgId" = ${orgId} AND embedding IS NOT NULL`;
      for (const l of linhas) {
        if (!l.vetor) continue;
        vetoresAnteriores.set(l.path, l.vetor.replace(/^\[|\]$/g, '').split(',').map(Number));
      }
    }

    const notes: ParsedNote[] = [];
    const reaproveitadas: string[] = [];
    for (const f of files) {
      const antiga = jaIndexado.get(f.caminho);
      if (antiga && emSegundos(antiga.fileTime) === emSegundos(f.modificadoEm)) {
        notes.push({ ...antiga, folder: antiga.folder ?? null });
        reaproveitadas.push(f.caminho);
        continue;
      }
      notes.push(this.parseConteudo(f.caminho, await f.ler(), f.modificadoEm));
    }
    if (reaproveitadas.length) {
      this.log.log(
        `Obsidian reindex: ${reaproveitadas.length} de ${files.length} nota(s) intocadas — ` +
          'não foram relidas nem vetorizadas de novo.',
      );
    }

    // substitui o índice do org (a vault é a fonte da verdade)
    await this.prisma.knowledgeNote.deleteMany({ where: { orgId } });
    for (const n of notes) {
      await this.prisma.knowledgeNote.create({
        data: {
          orgId,
          path: n.path,
          folder: n.folder,
          title: n.title,
          tags: n.tags,
          content: n.content,
          links: n.links,
          wordCount: n.wordCount,
          fileTime: n.fileTime,
        },
      });
    }

    /*
     * O VETOR DE CADA NOTA, guardado pelo CAMINHO e não pela ordem do `findMany`.
     *
     * Ele é reaproveitado logo abaixo pela projeção na MEMÓRIA (fatia 4.1+4.2):
     * é o mesmo texto, vetorizado uma vez só. Vetorizar de novo custaria dinheiro
     * no fornecedor e produziria números diferentes para o mesmo conteúdo — o
     * modelo de embedding muda de versão sem avisar.
     */
    const vetorPorCaminho = new Map<string, number[]>();
    let vetorizacao: ResultadoDaVetorizacao | null = null;

    // embeddings (se houver chave) — em lote, e SÓ do que não tem vetor guardado
    if (this.openaiKey && notes.length) {
      const rows = await this.prisma.knowledgeNote.findMany({ where: { orgId }, select: { id: true, path: true, title: true, content: true } });

      /*
       * A NOTA INTOCADA VOLTA COM O VETOR QUE JÁ TINHA.
       *
       * O texto é o mesmo, então o vetor é o mesmo — e revetorizar não seria só
       * gasto: o modelo de embedding muda de versão sem avisar, e a mesma nota
       * passaria a ter números diferentes dos vizinhos que não foram tocados,
       * com a busca por similaridade ficando torta sem nada acusar.
       */
      const semVetor: typeof rows = [];
      for (const r of rows) {
        const guardado = vetoresAnteriores.get(r.path);
        if (guardado && jaIndexado.has(r.path) && reaproveitadas.includes(r.path)) {
          await this.prisma.$executeRawUnsafe(
            'UPDATE "KnowledgeNote" SET embedding = $1::vector WHERE id = $2',
            `[${guardado.join(',')}]`,
            r.id,
          );
          vetorPorCaminho.set(r.path, guardado);
          continue;
        }
        semVetor.push(r);
      }

      /*
       * EM LOTES COM TETO, e o que falha não segura o resto. Antes ia tudo num
       * pedido só (em 01/10/2026, 399 textos e 1.772.124 caracteres), e
       * qualquer falha lançava daqui, antes da projeção, deixando a memória
       * parada junto com o índice. Cada lote é gravado assim que volta; o que não voltou fica sem
       * vetor, entra na projeção com `embedding: null` e é pedido de novo na
       * próxima volta, que reaproveita o que já foi gravado.
       */
      if (semVetor.length) {
        vetorizacao = await vetorizarEmLotes(
          semVetor.map((r) => `${r.title}\n\n${r.content}`),
          (lote) => this.embed(lote),
          {
            gravar: async (indices, vetores) => {
              for (let k = 0; k < indices.length; k++) {
                const r = semVetor[indices[k]];
                const vec = `[${vetores[k].join(',')}]`;
                await this.prisma.$executeRawUnsafe('UPDATE "KnowledgeNote" SET embedding = $1::vector WHERE id = $2', vec, r.id);
                vetorPorCaminho.set(r.path, vetores[k]);
              }
            },
          },
        );
        this.log.log(`Obsidian reindex: ${descreverVetorizacao(vetorizacao)} (de ${rows.length} nota(s)).`);
      }
    }

    await this.projetarNaMemoria(orgId, notes, vetorPorCaminho);

    /*
     * O RECIBO NÃO DIZ QUE DEU CERTO QUANDO NÃO DEU. Índice e projeção já
     * rodaram; o que faltou foi vetor. A rota e o verbo `sincronizar` só têm
     * "terminou" e "lançou", e terminar aqui viraria `{ ok: true }` na tela com
     * nota sem vetor. Lançar depois do trabalho feito é o que deixa a falha à
     * vista sem desfazer nada.
     */
    if (vetorizacao?.semVetor) {
      const incompleta =
        `A vault foi relida (${notes.length} nota(s)) e projetada na memória, mas a vetorização ` +
        `ficou incompleta: ${descreverVetorizacao(vetorizacao)}. As notas sem vetor continuam ` +
        'encontráveis pela busca textual e entram na próxima volta.';
      this.log.warn(`empresa ${orgId}: ${incompleta}`);
      throw new ServiceUnavailableException(incompleta);
    }
    return notes.length;
  }

  /**
   * A VAULT É DA CASA, E SÓ A CASA A REINDEXA (C2 da ROOT-05).
   *
   * A pasta é do processo: toda empresa enxerga o mesmo `OBSIDIAN_VAULT_PATH`, ou
   * a mesma pasta do Drive. O laço do `onModuleInit` sempre reindexou só a casa,
   * mas as duas portas que chegam aqui por requisição — `POST /knowledge/reindex`
   * e o verbo `sincronizar` do contrato — conferem permissão de PAPEL, e o admin
   * de um cliente tem as mesmas permissões que o da casa. Por elas, uma empresa
   * cliente apagava o próprio índice (o espelho do onboarding mora nele) e o
   * enchia com a vault da casa, que ainda virava memória versionada dela. Com o
   * fornecedor fora do ar a cópia acontecia do mesmo jeito (S4 da ROOT-05ab-REV).
   *
   * A pergunta é a do `SessaoDaPlataformaGuard`: o id da PRÓPRIA empresa e o slug
   * fixo na mesma consulta, que devolve a própria linha ou nada e não enxerga
   * outra empresa, com ou sem policy de linha. Roda antes de tudo: nada é lido da
   * vault, nada sai do índice desta empresa e nenhum pedido vai ao fornecedor.
   */
  private async exigirEmpresaDaCasa(orgId: string): Promise<void> {
    const daCasa = await this.prisma.org.findFirst({
      where: { id: orgId, slug: SLUG_DA_CASA },
      select: { id: true },
    });
    if (!daCasa) {
      throw new ForbiddenException(
        'A vault do Obsidian pertence à empresa da casa, e só ela reindexa. Nada foi lido da ' +
          'vault nem gravado nesta empresa; as notas que já são dela continuam na busca.',
      );
    }
  }

  /**
   * A VAULT VIRA MEMÓRIA VERSIONADA — fatia 4.1+4.2, RF-M-01.
   *
   * `KnowledgeNote` é ÍNDICE: a reindexação apaga tudo e recria, porque a vault é
   * a fonte da verdade dele. `ContextItem` é MEMÓRIA: ela versiona, guarda
   * procedência e não perde histórico quando um arquivo some. As duas continuam
   * vivas de propósito — o índice serve à busca de hoje e a memória serve ao
   * "por que a gente decidiu isso". Ver `docs/adr/ADR-011-memoria.md`.
   *
   * POR QUE O CONECTOR CHAMA A MEMÓRIA, E NÃO O CONTRÁRIO. Quem fala com o
   * fornecedor de embedding é este arquivo, e a catraca de arquitetura existe
   * justamente para que endereço e credencial de fornecedor não escapem do
   * conector. A memória recebe o vetor pronto e não conhece fornecedor nenhum.
   *
   * FALHA AQUI NÃO DERRUBA A REINDEXAÇÃO. O índice já foi gravado; perder a
   * projeção é perder o versionamento desta volta, não a busca. Sai como aviso
   * porque uma memória que para de acompanhar a vault em silêncio é pior do que
   * uma que para com barulho no log.
   */
  private async projetarNaMemoria(
    orgId: string,
    notes: ParsedNote[],
    vetorPorCaminho: Map<string, number[]>,
  ): Promise<void> {
    /*
     * DOIS PASSOS, DOIS TRATAMENTOS. Um `try` só em volta dos dois fazia a
     * mensagem culpar sempre a PROJEÇÃO — inclusive quando quem falhava era a
     * vetorização (chave da OpenAI vencida, cota estourada, dimensão errada), e
     * aí quem lê o log vai procurar defeito na memória em vez de no fornecedor.
     */
    try {
      const resumo = await this.memoria.projetarDaVault(
        orgId,
        notes.map((n) => ({
          caminho: n.path,
          title: n.title,
          body: n.content,
          tags: n.tags,
          embedding: vetorPorCaminho.get(n.path) ?? null,
        })),
      );
      if (resumo.criadas || resumo.alteradas || resumo.arquivadas || resumo.falhas) {
        this.log.log(
          `memória da empresa ${orgId}: ${resumo.criadas} nota(s) nova(s), ` +
            `${resumo.alteradas} alterada(s), ${resumo.arquivadas} arquivada(s), ` +
            `${resumo.inalteradas} sem mudança, ${resumo.falhas} com falha.`,
        );
      }
    } catch (e) {
      this.log.warn(
        `empresa ${orgId}: a vault foi indexada mas a PROJEÇÃO na MEMÓRIA falhou ` +
          `(${(e as Error).message}). A busca continua funcionando pelo índice; o que esta ` +
          'volta perdeu foi o versionamento.',
      );
    }

    /*
     * AS NOTAS DESTA VAULT FICAM FORA DA FILA DA MEMÓRIA NESTA VOLTA (R2 da
     * ROOT-05ab-REV). Quem dá vetor a elas é o índice, pela projeção acima. Com um
     * lote do índice falhando e o fornecedor respondendo logo depois, a fila
     * pagava agora os textos que o índice pede de novo na volta seguinte: 35 de 60
     * pagos duas vezes na sonda S3. A nota que ficou sem vetor no índice volta a
     * ser pedida por ele na próxima volta e chega à memória pela projeção; a fila
     * segue com o que só ela alcança — a nota digitada na tela, a resposta
     * promovida e a da vault que saiu da pasta sem ser arquivada.
     */
    try {
      await this.vetorizarPendentesDaMemoria(orgId, {
        excetoChaves: notes.map((n) => chaveDaVault(n.path)),
      });
    } catch (e) {
      this.log.warn(
        `empresa ${orgId}: a memória está versionada, mas a VETORIZAÇÃO das notas pendentes ` +
          `falhou (${(e as Error).message}) — isto é o fornecedor de embedding, não a memória. ` +
          'As notas continuam encontráveis pela busca textual e entram na volta seguinte.',
      );
    }
  }

  /**
   * Vetoriza as notas da memória que ainda não têm vetor.
   *
   * É a ponte para as notas que NÃO vieram da vault — a digitada na tela, a
   * resposta promovida (RF-M-06). A memória não chama fornecedor; quem chama é
   * este conector, que já tem a chave e já paga o custo. Enquanto a nota não é
   * vetorizada, ela é encontrada pela busca TEXTUAL, que é o que RF-M-03 pede
   * como piso ("menos inteligência, zero indisponibilidade").
   *
   * NÃO DEPENDE DA VAULT, e isso é conserto de defeito, não generalidade
   * gratuita. Este método só era alcançado de DENTRO de `reindex`, que recusa
   * sem vault — então empresa sem o conector do Obsidian NUNCA teria busca
   * semântica na memória. Não "só na volta seguinte": nunca. A chave de
   * embedding é do processo, a vault é uma pasta; são coisas independentes e
   * agora o código diz isso. Público (não `private`) porque o laço do
   * `onModuleInit` o chama direto quando não há vault a reindexar.
   *
   * O TETO DE 100 POR VOLTA é o freio: um envio grande não pode virar uma conta
   * de embedding inesperada numa única passada do cron. O resto entra na volta
   * seguinte, meia hora depois.
   *
   * O VETOR VOLTA PARA O CORPO QUE FOI LIDO, e só para ele. Cada pendente traz o
   * `contentHash` da leitura, e `gravarVetor` só grava se a nota ainda tem esse
   * hash: editada durante o pedido, o vetor do texto antigo é descartado e a
   * nota, sem vetor, entra numa volta seguinte com o corpo novo.
   *
   * `excetoChaves` são as notas que outro caminho vetoriza nesta mesma volta —
   * ver o fim de `projetarNaMemoria`.
   */
  async vetorizarPendentesDaMemoria(
    orgId: string,
    opcoes: { excetoChaves?: readonly string[] } = {},
  ): Promise<void> {
    if (!this.openaiKey) return;
    const pendentes = await this.memoria.semVetor(orgId, 100, { excetoChaves: opcoes.excetoChaves });
    if (!pendentes.length) return;
    let descartados = 0;
    // As 100 da volta iam num pedido só, até 800 kB; agora vão em lotes com teto.
    const r = await vetorizarEmLotes(
      pendentes.map((n) => `${n.title}\n\n${n.body}`),
      (lote) => this.embed(lote),
      {
        gravar: async (indices, vetores) => {
          for (let k = 0; k < indices.length; k++) {
            const nota = pendentes[indices[k]];
            const gravadas = await this.memoria.gravarVetor(orgId, nota.id, vetores[k], nota.contentHash);
            if (gravadas === 0) descartados++;
          }
        },
      },
    );
    this.log.log(
      `memória da empresa ${orgId}: ${descreverVetorizacao(r)}` +
        (descartados
          ? `; ${descartados} vetor(es) descartado(s): a nota mudou durante o pedido e o ` +
            'vetor era do texto anterior.'
          : '.'),
    );
    // Quem chama registra o aviso; o que foi gravado fica, e o resto volta na próxima.
    if (r.semVetor) throw new Error(descreverVetorizacao(r));
  }

  // ---------- leitura ----------
  async list(orgId: string): Promise<KnowledgeList> {
    const rows = await this.prisma.knowledgeNote.findMany({
      where: { orgId },
      orderBy: { fileTime: 'desc' },
      select: { id: true, path: true, folder: true, title: true, tags: true, links: true, wordCount: true, fileTime: true },
    });
    const withEmb = await this.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      'SELECT count(*)::bigint AS n FROM "KnowledgeNote" WHERE "orgId" = $1 AND embedding IS NOT NULL',
      orgId,
    );
    return {
      items: rows.map((r) => ({ ...r, fileTime: r.fileTime.toISOString() })),
      total: rows.length,
      folders: [...new Set(rows.map((r) => r.folder).filter(Boolean) as string[])].sort(),
      indexedNotes: Number(withEmb[0]?.n ?? 0),
      source: { tool: 'obsidian', generatedAt: new Date().toISOString() },
    };
  }

  async get(orgId: string, id: string): Promise<NoteDetail | null> {
    const r = await this.prisma.knowledgeNote.findFirst({ where: { id, orgId } });
    if (!r) return null;
    return {
      id: r.id, path: r.path, folder: r.folder, title: r.title, tags: r.tags, links: r.links,
      wordCount: r.wordCount, fileTime: r.fileTime.toISOString(), content: r.content,
    };
  }

  async search(orgId: string, query: string, limit = 8): Promise<SearchResult> {
    const q = query.trim();
    const take = Math.min(Math.max(limit, 1), 20);
    let mode: 'semantic' | 'keyword' = 'keyword';
    let rows: Array<any> = [];

    if (this.openaiKey && q) {
      try {
        const [qv] = await this.embed([q], PRAZO_DA_BUSCA_MS);
        const vec = `[${qv.join(',')}]`;
        const semanticas: Array<any> = await this.prisma.$queryRawUnsafe(
          `SELECT id, path, folder, title, tags, links, "wordCount", "fileTime", content,
                  1 - (embedding <=> $1::vector) AS score
             FROM "KnowledgeNote"
            WHERE "orgId" = $2 AND embedding IS NOT NULL
            ORDER BY embedding <=> $1::vector
            LIMIT $3`,
          vec, orgId, take,
        );
        /*
         * O KNN só enxerga nota COM vetor. Sem nenhuma, a resposta era vazia e
         * marcada como semântica; agora cai para o texto logo abaixo. Com parte
         * delas, a nota sem vetor que tem o texto pedido entra pela mescla (ver
         * `mesclarComTextuais`). Com todas vetorizadas, a consulta de texto
         * volta vazia e o resultado é o semântico de antes.
         */
        if (semanticas.length) {
          const semVetor: Array<any> = await this.prisma.$queryRawUnsafe(
            `SELECT id, path, folder, title, tags, links, "wordCount", "fileTime", content, 0 AS score
               FROM "KnowledgeNote"
              WHERE "orgId" = $2 AND embedding IS NULL AND (title ILIKE $1 OR content ILIKE $1)
              ORDER BY "fileTime" DESC
              LIMIT $3`,
            `%${q}%`, orgId, take,
          );
          rows = mesclarComTextuais(semanticas, semVetor, take);
          mode = 'semantic';
        }
      } catch (e) {
        this.log.warn(`busca semântica falhou (${(e as Error).message}); usando keyword`);
      }
    }
    if (mode === 'keyword') {
      rows = await this.prisma.$queryRawUnsafe(
        `SELECT id, path, folder, title, tags, links, "wordCount", "fileTime", content, 0 AS score
           FROM "KnowledgeNote"
          WHERE "orgId" = $2 AND (title ILIKE $1 OR content ILIKE $1)
          LIMIT $3`,
        `%${q}%`, orgId, take,
      );
    }

    return {
      query: q,
      mode,
      items: rows.map((r) => ({
        id: r.id, path: r.path, folder: r.folder, title: r.title,
        tags: r.tags ?? [], links: r.links ?? [], wordCount: r.wordCount,
        fileTime: new Date(r.fileTime).toISOString(),
        score: Math.round(Number(r.score) * 1000) / 1000,
        snippet: snippet(r.content, q),
      })),
      source: { tool: 'obsidian', generatedAt: new Date().toISOString() },
    };
  }
}

function snippet(content: string, q: string): string {
  const text = content.replace(/\s+/g, ' ').trim();
  const term = q.split(/\s+/)[0]?.toLowerCase();
  const idx = term ? text.toLowerCase().indexOf(term) : -1;
  if (idx < 0) return text.slice(0, 180);
  const start = Math.max(0, idx - 70);
  return (start > 0 ? '…' : '') + text.slice(start, start + 180) + '…';
}
