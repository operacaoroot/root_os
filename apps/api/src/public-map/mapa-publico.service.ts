import { Injectable, Logger } from '@nestjs/common';

import { comTenantPublico, resolverOrgDoSlugInterno } from '../common/tenant-publico';
import { PrismaService } from '../prisma/prisma.service';
import { lerFontes } from './fontes';
import {
  MapaPublico,
  ORDENACAO,
  PROJECAO,
  SOMENTE_PUBLICADOS,
  TETO_DE_NOS,
  mapaVazio,
  montarMapa,
} from './mapa-publico';

/*
 * A LEITURA DO MAPA PÚBLICO — fatia 6.5
 * =====================================
 *
 * Esta é a única consulta de domínio que a entrada pública do domínio faz, e ela
 * é feita no desenho de DUAS METADES que `src/common/tenant-publico.ts`
 * estabeleceu na onda 4:
 *
 *   1. RESOLVER a empresa — `resolverOrgDoSlugInterno`, que roda sob a sentinela
 *      e devolve só o ENDEREÇO. É a única coisa que acontece fora de um tenant.
 *   2. TODO o resto dentro de `comTenantPublico`, com a empresa publicada no
 *      contexto: o `SET LOCAL app.org_id` sai com ela, o log carrega `org=`, e a
 *      policy de linha de `MapaPublicoItem` passa a valer.
 *
 * DE QUEM É ESTA PÁGINA — e por que o slug não pode vir do pedido
 * A vitrine é UMA: a da ROOT. Se o slug viesse da URL, a rota viraria um oráculo
 * anônimo de "esta empresa existe" — e, pior, qualquer cliente com uma linha
 * publicada por engano teria a própria vitrine servida no domínio da ROOT. O
 * slug é constante de código, com sobreposição por AMBIENTE (para ambiente de
 * teste e para o dia em que o domínio mudar de dono), e nunca por requisição.
 * `mapa()` não recebe nada do controller — e o teste cobra isso.
 *
 * O QUE A RESPOSTA CONTÉM, E O QUE ELA NÃO CONTÉM
 * Só linhas publicadas de `MapaPublicoItem`, projetadas coluna a coluna, mais os
 * números do registro fechado de fontes. NADA de `Org` chega à resposta — nem o
 * nome, nem o slug, nem o id. O nome que aparece no centro do mapa é o `rotulo`
 * de uma linha publicada, e não o `Org.name`: o dia em que a razão social mudar
 * para algo que ninguém quer na home, a home não muda sozinha.
 *
 * ----------------------------------------------------------------------------
 * A MEMÓRIA CURTA — e o defeito que a primeira versão dela tinha
 * ----------------------------------------------------------------------------
 * A rota é anônima e serve a raiz de um domínio: sem memória, cada visita são
 * cinco consultas (a resolução, a lista e as contagens). O valor vale segundos —
 * o bastante para absorver uma rajada, pouco o bastante para que publicar uma
 * linha apareça na home quase na hora.
 *
 * A PRIMEIRA VERSÃO GUARDAVA UMA COISA SÓ — o mapa montado, chaveado pelo SLUG —
 * e guardava também o MAPA VAZIO. Um revisor mediu o estrago, com o isolamento
 * por linha ligado e a aplicação conectando pelo papel restrito:
 *
 *   · `mapa()` é exportado, e `sobASentinela` (em `common/tenant-publico.ts`) só
 *     abre a sentinela quando NÃO há empresa resolvida — de propósito, para que
 *     um caminho autenticado não saia do próprio tenant;
 *   · logo, uma chamada feita de DENTRO do contexto de outra empresa resolve a
 *     vitrine sob a policy DAQUELA empresa. A policy de `Org` é
 *     `id = app_org_atual() OR sentinela`: não acha, devolve `null`;
 *   · o mapa vazio virava lembrança chaveada só pelo slug e era servido a TODO
 *     visitante anônimo pelos trinta segundos seguintes — a porta de entrada do
 *     produto anunciando que o mapa está fora do ar.
 *
 * Hoje isso é latente (a rota não tem guarda, ninguém chama de dentro de um
 * tenant), mas o serviço é exportado e a virada para o papel restrito é plano
 * declarado: latente é estado, não garantia.
 *
 * AS DUAS LEMBRANÇAS, que são a correção:
 *
 *   · o ENDEREÇO (`slug -> orgId`), guardado **só quando a resolução ACHOU**.
 *     Resolução que não achou não vira lembrança nenhuma: a próxima visita
 *     pergunta ao banco de novo, e uma chamada de dentro de outra empresa
 *     envenena no máximo a si mesma;
 *   · o MAPA, chaveado pela EMPRESA RESOLVIDA e não pelo slug. Lembrança de mapa
 *     carrega escrito de quem ela é; não há como servir a de uma empresa no
 *     lugar da de outra, nem quando um slug troca de dono entre duas janelas.
 *
 * `test/mapa-publico.test.ts` reproduz a sequência inteira — anônimo, de dentro
 * de outra empresa, anônimo de novo — nas duas conexões.
 */

/** O slug da empresa cuja vitrine a raiz do domínio serve. */
export const SLUG_DA_VITRINE_PADRAO = 'root';

/**
 * O slug da vitrine, com sobreposição por ambiente.
 *
 * Ambiente é configuração do operador, não entrada de quem chama: continua
 * valendo a regra de `resolverOrgDoSlugInterno`, que só aceita slug que seja
 * constante do código — nunca valor vindo de fora da aplicação.
 */
export function slugDaVitrine(env: NodeJS.ProcessEnv = process.env): string {
  const bruto = (env.MAPA_PUBLICO_ORG_SLUG ?? '').trim();
  return bruto === '' ? SLUG_DA_VITRINE_PADRAO : bruto;
}

/** Quanto tempo o endereço resolvido e o mapa montado valem. */
export const VALIDADE_DA_MEMORIA_MS = 30_000;

/**
 * UMA PROMESSA EM VOO POR CHAVE.
 *
 * Memória sozinha segura FILA, não RAJADA: vinte pedidos em sequência fazem o
 * trabalho uma vez, mas vinte SIMULTÂNEOS com a memória fria fazem vinte vezes,
 * porque nenhum deles guardou nada ainda quando os outros começaram (medido:
 * sessenta consultas). Numa porta de entrada anônima, que é justamente onde a
 * rajada chega, isso é o caso que importa.
 *
 * Aqui o primeiro faz o trabalho e os outros dezenove esperam a MESMA promessa.
 * A chave sai no `finally`: trabalho que estourou não pode ficar pendurado
 * devolvendo o próprio erro a quem chegar depois.
 */
class UmaVezPorChave<T> {
  private readonly emVoo = new Map<string, Promise<T>>();

  async fazer(chave: string, trabalho: () => Promise<T>): Promise<T> {
    const jaEmVoo = this.emVoo.get(chave);
    if (jaEmVoo) return jaEmVoo;

    const promessa = trabalho();
    this.emVoo.set(chave, promessa);
    try {
      return await promessa;
    } finally {
      this.emVoo.delete(chave);
    }
  }
}

@Injectable()
export class MapaPublicoService {
  private readonly log = new Logger('MapaPublico');

  /** `slug -> orgId`. Só entra aqui resolução que ACHOU — ver o cabeçalho. */
  private endereco: { slug: string; orgId: string; expiraEm: number } | null = null;

  /** O mapa montado, chaveado pela EMPRESA RESOLVIDA — ver o cabeçalho. */
  private lembrado: { orgId: string; mapa: MapaPublico; expiraEm: number } | null = null;

  private readonly resolucoes = new UmaVezPorChave<{ orgId: string } | null>();
  private readonly montagens = new UmaVezPorChave<MapaPublico>();

  /**
   * Quando o aviso de "vitrine não existe" saiu pela última vez.
   *
   * Sem isto, um banco sem a semente transforma a raiz do domínio em torneira de
   * log: uma linha por visita anônima. Memorizar a RESPOSTA NEGATIVA fecharia a
   * torneira também — e é exatamente o que não se pode fazer aqui, porque a
   * negativa pode ter vindo de uma chamada feita de dentro de outra empresa.
   * Então o que se limita é o aviso, não a consulta.
   */
  private avisadoEm = 0;

  constructor(private readonly prisma: PrismaService) {}

  /** Só para o teste, e para quem publicar uma linha e quiser ver na hora. */
  esquecer(): void {
    this.endereco = null;
    this.lembrado = null;
    this.avisadoEm = 0;
  }

  /**
   * O mapa público da vitrine.
   *
   * `slug` é parâmetro para o teste poder apontar para a empresa que ele mesmo
   * semeou — o controller NUNCA o passa, e é por isso que o valor padrão é a
   * constante e não um argumento obrigatório.
   */
  async mapa(slug: string = slugDaVitrine(), agora: Date = new Date()): Promise<MapaPublico> {
    const alvo = await this.resolver(slug, agora);

    /*
     * Empresa não resolvida devolve MAPA VAZIO, não 404 — e o vazio NÃO é
     * lembrado. A raiz do domínio responder "não encontrado" porque uma linha de
     * semente não rodou seria trocar uma home sem mapa por uma home fora do ar;
     * lembrar o vazio seria pior ainda, porque quem não resolveu pode ser uma
     * chamada de dentro de outra empresa (ver o cabeçalho).
     */
    if (!alvo) {
      this.avisarUmaVezPorJanela(slug, agora);
      return mapaVazio(agora);
    }

    const lembranca = this.lembrado;
    if (lembranca && lembranca.orgId === alvo.orgId && lembranca.expiraEm > agora.getTime()) {
      return lembranca.mapa;
    }

    const mapa = await this.montagens.fazer(alvo.orgId, () => this.montar(alvo.orgId, agora));
    this.lembrado = { orgId: alvo.orgId, mapa, expiraEm: agora.getTime() + VALIDADE_DA_MEMORIA_MS };
    return mapa;
  }

  /** O endereço da vitrine. Lembra o positivo; o negativo, nunca. */
  private async resolver(slug: string, agora: Date): Promise<{ orgId: string } | null> {
    const lembrado = this.endereco;
    if (lembrado && lembrado.slug === slug && lembrado.expiraEm > agora.getTime()) {
      return { orgId: lembrado.orgId };
    }

    const alvo = await this.resolucoes.fazer(slug, () =>
      resolverOrgDoSlugInterno(this.prisma, slug),
    );
    if (!alvo) return null;

    this.endereco = { slug, orgId: alvo.orgId, expiraEm: agora.getTime() + VALIDADE_DA_MEMORIA_MS };
    return alvo;
  }

  private avisarUmaVezPorJanela(slug: string, agora: Date): void {
    if (this.avisadoEm > agora.getTime() - VALIDADE_DA_MEMORIA_MS) return;
    this.avisadoEm = agora.getTime();
    this.log.warn(
      `vitrine "${slug}" não resolveu neste pedido: a entrada pública sai sem mapa. ` +
        'Confira MAPA_PUBLICO_ORG_SLUG e a semente do mapa — e, se a chamada partiu ' +
        'de dentro de outra empresa, ela resolve sob a policy daquela empresa e não acha.',
    );
  }

  private async montar(orgId: string, agora: Date): Promise<MapaPublico> {
    return comTenantPublico(orgId, async () => {
      const linhas = await this.prisma.mapaPublicoItem.findMany({
        where: SOMENTE_PUBLICADOS(orgId),
        select: PROJECAO,
        orderBy: [...ORDENACAO],
        take: TETO_DE_NOS,
      });

      const numeros = await lerFontes(
        this.prisma,
        orgId,
        linhas.map((l) => l.fonte).filter((f): f is string => f != null),
        agora,
        (chave, erro) =>
          this.log.warn(`fonte "${chave}" falhou: o nó sai sem número — ${String(erro)}`),
      );

      return montarMapa(linhas, numeros, agora);
    });
  }
}
