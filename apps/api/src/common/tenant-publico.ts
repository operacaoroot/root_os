import type { PrismaClient } from '@prisma/client';

import {
  ContextoExecucao,
  comContexto,
  contextoAtual,
  exigirTenant,
  novaCorrelacao,
} from './contexto-execucao';

/*
 * ROTA PÚBLICA RESOLVE O TENANT — RF-T-04
 * =======================================
 *
 * O PROBLEMA QUE ESTE ARQUIVO EXISTE PARA RESOLVER
 * Rota pública não tem token, logo o `ContextoInterceptor` abre o contexto com
 * `orgId: null` de propósito (ver `common/contexto.interceptor.ts`). Só que a
 * requisição não é "de ninguém": a página `@fulano` é de UMA empresa, o clique
 * em `/r/:linkId` é de UMA empresa, e o evento do pixel é de UMA empresa. A
 * empresa existe — o que falta é ALGUÉM RESOLVÊ-LA, e é isso que este arquivo
 * organiza.
 *
 * Enquanto a sessão de banco roda em `observar` (hoje), não resolver só produz
 * um aviso no log. Quando o isolamento por linha ligar (fatia 1.5), consulta sem
 * empresa deixa de devolver linha: a página pública fica 404 para todo mundo, o
 * link para de redirecionar e o pixel para de gravar. Esta fatia é o que impede
 * isso.
 *
 * AS DUAS METADES, E POR QUE SÃO DUAS
 *
 *   1. as FUNÇÕES DE RESOLUÇÃO (`resolverTenantDo*`) — as consultas que
 *      DESCOBREM de quem é a requisição. São, por definição, consultas sem
 *      empresa: é o handle, a chave do pixel ou o id do link que vão dizer qual
 *      é. Não dá para exigir tenant de quem está indo buscar o tenant.
 *
 *   2. `comTenantPublico(orgId, fn)` — TODO o resto do pedido, já dentro da
 *      empresa resolvida. Daqui em diante a rota pública é indistinguível de uma
 *      rota autenticada: o `SET LOCAL app.org_id` sai com a empresa certa, o log
 *      carrega `org=`, e um `where` esquecido passa a ser contido pelo banco.
 *
 * A SENTINELA — por que a resolução não roda simplesmente "sem empresa"
 * Se a consulta de resolução rodasse com empresa vazia, ela ficaria
 * indistinguível de um bug (o caso que `sessao-de-banco.ts` inventaria como
 * "consulta SEM empresa resolvida"), e a policy de RLS da fatia 1.5 teria de
 * abrir exceção para `app.org_id` VAZIO — que é o valor padrão de tudo o que
 * ninguém resolveu, no sistema inteiro. Seria abrir a porta para toda consulta
 * distraída, não para estas quatro.
 *
 * Com a sentinela, "estou resolvendo tenant" vira um estado DECLARADO: um valor
 * que só aparece em `app.org_id` quando uma das funções deste arquivo está
 * rodando.
 *
 * ------------------------------------------------------------------------
 * O INVÓLUCRO DA SENTINELA NÃO É EXPORTADO — e isso é a metade da defesa
 * ------------------------------------------------------------------------
 * A primeira versão desta fatia exportava `resolvendoTenant(fn)`. Um revisor
 * mediu as duas consequências, e as duas são reais:
 *
 *   · PROMESSA SOLTA. Uma promessa criada lá dentro e não aguardada (`void
 *     algo()`) continua no escopo da sentinela pela vida inteira dela — e o
 *     escopo é o que decide o `SET LOCAL` de cada consulta daquela continuação.
 *   · REABERTURA. O invólucro trocava a empresa mesmo quando JÁ HAVIA uma
 *     resolvida: um caminho autenticado que chamasse uma resolução sairia do
 *     próprio tenant por um instante, e nesse instante o banco não o conteria.
 *
 * Por isso o invólucro é PRIVADO e só as funções de resolução saem daqui. Cada
 * uma faz exatamente uma consulta, aguardada, e devolve o ENDEREÇO da empresa —
 * nunca conteúdo. Não há como um terceiro abrir a sentinela em volta de código
 * arbitrário sem editar este arquivo, e `apps/api/test/rotas-publicas-tenant.test.ts`
 * cobra que o conjunto de consultas feitas sob a sentinela seja EXATAMENTE o
 * destas funções.
 *
 * E a reabertura some por construção: `sobASentinela` respeita a empresa que já
 * estiver resolvida (ver a função).
 *
 * ------------------------------------------------------------------------
 * O QUE A FATIA 1.5 PRECISA LIBERAR PARA A SENTINELA — o contrato, e o que
 * ele CUSTA (medido no Postgres descartável, 11/09/2026)
 * ------------------------------------------------------------------------
 * A sentinela precisa LER, e só ler:
 *
 *   · `Org`      — por `id` (chave do pixel) ou por `slug` (a empresa padrão);
 *   · `BioPage`  — por `handle` ou por `id`;
 *   · `BioLink`  — por `id`.
 *
 * ESCREVER, NUNCA. A policy da fatia 1.5 tem de ser DUAS: uma de leitura, com a
 * cláusula da sentinela, e uma de escrita com `WITH CHECK` explícito, amarrada à
 * empresa da sessão e SEM a sentinela. Uma policy só, `FOR ALL` e sem
 * `WITH CHECK`, é o furo que o revisor mediu: o Postgres REUSA o `USING` como
 * verificação de escrita, e sob a sentinela isso libera UPDATE, INSERT e DELETE
 * em qualquer linha de qualquer empresa — inclusive `Org.modulos`, que é o gate
 * de módulos inteiro (RF-T-06). O SQL das duas está no rodapé de
 * `test/rotas-publicas-tenant.test.ts`, e lá ele é EXECUTADO.
 *
 * DECISÃO DE COLUNA, declarada porque policy de linha não a resolve:
 * **sob a sentinela as três tabelas são legíveis INTEIRAS** — todas as linhas,
 * todas as colunas. `USING` filtra linha, não coluna, e as três resoluções
 * precisam alcançar qualquer linha (o avatar resolve rascunho; o pixel resolve
 * qualquer empresa). Medido: sob a sentinela um `SELECT *` devolve o rascunho
 * não publicado de outra empresa e o destino do link dela.
 *
 * O que contém isso é o parágrafo anterior, não a policy: só estas quatro
 * funções rodam sob a sentinela, cada uma com `select` mínimo, e nenhuma devolve
 * para a resposta HTTP nada além do endereço.
 *
 * A ALTERNATIVA MAIS APERTADA, e por que ela não está aqui: trocar as
 * resoluções por três funções `SECURITY DEFINER` no banco (`resolver_org_do_id`,
 * `resolver_page_do_handle`, `resolver_link_do_id`), que devolvem só o `orgId` e
 * dispensam dar QUALQUER acesso de tabela à sentinela — aí a sentinela deixaria
 * de ler coisa alguma e a decisão de coluna desapareceria. Ela exige DDL, e DDL
 * mora em migration: `apps/api/prisma/` é de outra fatia, que roda neste mesmo
 * momento. Fazer o caminho de produção depender de uma função que nenhuma
 * migration cria quebraria as rotas públicas HOJE, com a RLS ainda desligada.
 * Fica escrito como o passo seguinte, para a fatia 1.5 fazer na mesma migration
 * que criar as policies.
 *
 * POR QUE A SENTINELA NÃO PODE COLIDIR COM EMPRESA DE VERDADE
 * `Org.id` é uuid e `Org.slug` é minúsculo-com-hífen: nenhum dos dois produz uma
 * string com `__`. E se alguém gravar a sentinela num `orgId` por engano, a
 * chave estrangeira de `Org` derruba o INSERT na hora — falha ruidosa, não linha
 * órfã (09-PADRÕES §3.4).
 */

/**
 * O valor que `app.org_id` carrega enquanto uma rota pública está DESCOBRINDO
 * de quem é a requisição. Ver o cabeçalho: é um estado declarado, não a falta de
 * um estado.
 */
export const ORG_RESOLUCAO_PUBLICA = '__resolucao_publica__';

/** Esta empresa é a sentinela da resolução pública? (para teste e para guarda) */
export function ehResolucaoPublica(orgId: string | null | undefined): boolean {
  return orgId === ORG_RESOLUCAO_PUBLICA;
}

/**
 * Monta o contexto de dentro a partir do de fora, trocando só a empresa.
 *
 * Quando não há contexto de fora (script, teste, chamada solta), cunha uma
 * correlação própria em vez de rodar sem nenhuma: linha de log sem correlação é
 * linha que não se liga a nada (RNF-09).
 */
function comEmpresa(orgId: string): ContextoExecucao {
  const fora = contextoAtual();
  return {
    ...fora,
    orgId,
    correlationId: fora?.correlationId ?? novaCorrelacao('publico'),
    origem: fora?.origem ?? 'http',
  };
}

/*
 * POR QUE `async () => await fn()` E NÃO `fn` DIRETO — a armadilha que custou
 * uma rodada inteira de teste vermelha.
 *
 * `comContexto` é `AsyncLocalStorage.run`: o escopo dura o que a função dura. E
 * o Prisma devolve promessa PREGUIÇOSA — `prisma.bioPage.findUnique(...)` não
 * consulta nada; ele só dispara quando alguém chama `.then`. Uma função que
 * apenas DEVOLVE essa promessa sai do escopo antes de a consulta começar, e o
 * gancho da sessão de banco lê o contexto já fechado: empresa nula, e
 * `SemTenantError` em modo `impor` (medido, não deduzido).
 *
 * O `await` aqui dentro é o que faz o `.then` ser chamado enquanto o escopo
 * ainda está aberto. É o mesmo motivo pelo qual o `ContextoInterceptor` assina o
 * observable de dentro do `run` em vez de devolvê-lo.
 */

/**
 * Roda a consulta de resolução. PRIVADA de propósito — ver o cabeçalho.
 *
 * Só abre a sentinela quando NÃO há empresa resolvida. Dentro de um tenant (uma
 * rota autenticada que chame uma destas resoluções, o painel pedindo o avatar da
 * própria página) a consulta roda na empresa de quem chamou, e o banco continua
 * contendo aquele caminho como contém todos os outros dele.
 */
async function sobASentinela<T>(fn: () => PromiseLike<T>): Promise<T> {
  const atual = contextoAtual()?.orgId;
  const jaResolvida = typeof atual === 'string' && atual.trim() !== '';
  if (jaResolvida) return await fn();
  return comContexto(comEmpresa(ORG_RESOLUCAO_PUBLICA), async () => await fn());
}

/**
 * Roda o resto do pedido dentro da empresa resolvida.
 *
 * Recusa a sentinela: publicar "estou resolvendo" como se fosse empresa de
 * verdade faria a rota inteira rodar num tenant que não existe, e o estrago
 * apareceria longe daqui — no `orgId` gravado numa linha. Recusa também vazio,
 * pelo mesmo motivo de sempre (RF-T-04: ausência de empresa é erro, nunca
 * "todos").
 */
export async function comTenantPublico<T>(orgId: string, fn: () => PromiseLike<T>): Promise<T> {
  const id = exigirTenant(orgId, 'rota pública');
  if (ehResolucaoPublica(id)) {
    throw new Error(
      'a sentinela de resolução pública não é empresa: ' +
        'resolva o tenant de verdade antes de abrir o contexto do pedido (RF-T-04)',
    );
  }
  return comContexto(comEmpresa(id), async () => await fn());
}

/*
 * AS QUATRO RESOLUÇÕES.
 *
 * Recebem o cliente do banco por parâmetro em vez de importar o `PrismaService`:
 * assim este arquivo continua sendo `common/` — sem saber de módulo nenhum — e o
 * teste consegue passar um cliente próprio sem levantar o Nest.
 *
 * Todas devolvem o ENDEREÇO e o mínimo que decide o 404. Cada coluna a mais aqui
 * é uma coluna que a sentinela lê no banco.
 */

/** A empresa dona do handle. `publicada` vem junto porque decide o 404. */
export async function resolverTenantDoHandle(
  prisma: PrismaClient,
  handle: string,
): Promise<{ pageId: string; orgId: string; publicada: boolean } | null> {
  const page = await sobASentinela(() =>
    prisma.bioPage.findUnique({
      where: { handle: handle.toLowerCase() },
      select: { id: true, orgId: true, publicada: true },
    }),
  );
  return page ? { pageId: page.id, orgId: page.orgId, publicada: page.publicada } : null;
}

/**
 * A empresa dona do link de saída.
 *
 * Lê o `orgId` do PRÓPRIO `BioLink`, não o da página: desde a fatia 1.1 a
 * coluna existe na filha e é mantida por gatilho (`BioLink_orgId_do_pai`), e
 * resolver pelo pai obrigaria a policy da sentinela a liberar também um `join`
 * com `BioPage`.
 */
export async function resolverTenantDoLink(
  prisma: PrismaClient,
  linkId: string,
): Promise<{ orgId: string } | null> {
  const link = await sobASentinela(() =>
    prisma.bioLink.findUnique({ where: { id: linkId }, select: { orgId: true } }),
  );
  return link && link.orgId ? { orgId: link.orgId } : null;
}

/**
 * A empresa dona da página cujo avatar está sendo pedido.
 *
 * Não exige `publicada`: a prévia do painel usa a MESMA URL pública de avatar,
 * e exigir publicação aqui deixaria o rascunho sem foto na própria tela de
 * quem o está escrevendo.
 */
export async function resolverTenantDaPage(
  prisma: PrismaClient,
  pageId: string,
): Promise<{ orgId: string } | null> {
  const page = await sobASentinela(() =>
    prisma.bioPage.findUnique({ where: { id: pageId }, select: { orgId: true } }),
  );
  return page ? { orgId: page.orgId } : null;
}

/**
 * A empresa de uma chave de pixel — que é o `id` da `Org`, e só ele.
 *
 * O `slug` FOI aceito aqui e saiu: ele é adivinhável, e com ele qualquer pessoa
 * gravava evento na empresa de um cliente (ver `events/pixel-tenant.service.ts`).
 */
export async function resolverOrgDaChave(
  prisma: PrismaClient,
  id: string,
): Promise<{ orgId: string } | null> {
  const org = await sobASentinela(() =>
    prisma.org.findUnique({ where: { id }, select: { id: true } }),
  );
  return org ? { orgId: org.id } : null;
}

/**
 * A empresa de um slug — usada SÓ para a empresa padrão do pixel, que é uma
 * constante do código (`ORG_LEGADA_DO_PIXEL`), nunca um valor vindo de fora.
 *
 * Está aqui, e não no serviço do pixel, porque a sentinela não sai deste arquivo.
 */
export async function resolverOrgDoSlugInterno(
  prisma: PrismaClient,
  slug: string,
): Promise<{ orgId: string } | null> {
  const org = await sobASentinela(() =>
    prisma.org.findUnique({ where: { slug }, select: { id: true } }),
  );
  return org ? { orgId: org.id } : null;
}

/*
 * A MEMÓRIA CURTA DAS RESOLUÇÕES.
 *
 * Toda resolução pública é uma consulta ao banco disparada por quem não se
 * autenticou. Sem memória, a mesma pergunta ("de quem é esta chave?", "de que
 * página é este avatar?") vira uma ida ao banco por requisição — e, no caso da
 * resposta NEGATIVA, vira uma ida ao banco por tentativa de quem estiver
 * chutando nome.
 *
 * Por isso a resposta negativa também é guardada, e é ela que fecha a torneira.
 * Vale menos tempo que a positiva de propósito: chave errada costuma ser
 * instalação recém-feita que ainda vai ser corrigida, e ninguém merece esperar
 * um minuto para ver o primeiro evento entrar.
 *
 * O TETO não é enfeite: a chave vem de fora, e sem teto um atacante com chaves
 * aleatórias transforma o cache em vazamento de memória. Cheio, esvazia — perder
 * o cache custa uma consulta indexada por chave viva.
 */
export interface OpcoesDaMemoria {
  /** Quanto tempo a resposta POSITIVA vale. */
  validadeMs: number;
  /** Quanto tempo a resposta NEGATIVA vale. */
  validadeNegativaMs: number;
  /** Quantas chaves cabem antes de esvaziar. */
  teto: number;
}

export type Lembranca<V> = { lembrada: true; valor: V | null } | { lembrada: false };

export class MemoriaDeResolucao<V> {
  private readonly itens = new Map<string, { valor: V | null; expiraEm: number }>();

  constructor(private readonly opcoes: OpcoesDaMemoria) {}

  lembrar(chave: string, agora = Date.now()): Lembranca<V> {
    const item = this.itens.get(chave);
    if (!item || item.expiraEm <= agora) return { lembrada: false };
    return { lembrada: true, valor: item.valor };
  }

  guardar(chave: string, valor: V | null, agora = Date.now()): void {
    if (this.itens.size >= this.opcoes.teto) this.itens.clear();
    this.itens.set(chave, {
      valor,
      expiraEm: agora + (valor === null ? this.opcoes.validadeNegativaMs : this.opcoes.validadeMs),
    });
  }

  /** Só para o teste: a memória é por instância e sobrevive entre casos. */
  esquecer(): void {
    this.itens.clear();
  }

  get tamanho(): number {
    return this.itens.size;
  }
}

/**
 * A empresa dona de um convite de onboarding, pelo HASH do token (23/09/2026).
 *
 * O link público `/e/<token>` não tem empresa até achar o convite. É a mesma
 * forma das quatro resoluções acima: consulta mínima sob a sentinela, devolve o
 * endereço e o que decide o 404 — e nada mais. O token cru nunca chega aqui:
 * quem chama já o transformou em hash (`onboarding/trilho/convite.ts`).
 */
export async function resolverTenantDoConvite(
  prisma: PrismaClient,
  tokenHash: string,
): Promise<{
  conviteId: string;
  trilhoId: string;
  orgId: string;
  blocos: string;
  validoAte: Date;
  revogadoEm: Date | null;
  concluidoEm: Date | null;
} | null> {
  const c = await sobASentinela(() =>
    prisma.onboardingConvite.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        trilhoId: true,
        orgId: true,
        blocos: true,
        validoAte: true,
        revogadoEm: true,
        concluidoEm: true,
      },
    }),
  );
  return c && c.orgId
    ? {
        conviteId: c.id,
        trilhoId: c.trilhoId,
        orgId: c.orgId,
        blocos: c.blocos,
        validoAte: c.validoAte,
        revogadoEm: c.revogadoEm,
        concluidoEm: c.concluidoEm,
      }
    : null;
}

/*
 * AS TRÊS RESOLUÇÕES DO TOTEM (11/10/2026, docs/totem/CONTRATO.md).
 *
 * O quiosque e o QR da etiqueta não têm login: a empresa sai do aparelho (pelo
 * hash do código de ativação ou do token) ou da etiqueta (pelo código impresso).
 * Mesma forma das resoluções acima. A policy de LEITURA de `TotemDispositivo` e
 * `TotemEtiqueta` aceita a sentinela por causa destas três funções; a de
 * escrita não. Quem chama ainda confere `exigirModuloTotem` dentro da empresa
 * resolvida, porque o gate de módulos deixa a requisição anônima passar.
 */

/** O aparelho que está trocando o código de ativação pelo token. */
export async function resolverTenantDaAtivacao(
  prisma: PrismaClient,
  codigoHash: string,
): Promise<{
  dispositivoId: string;
  orgId: string;
  lojaId: string;
  ativacaoExpiraEm: Date | null;
  revogadoEm: Date | null;
} | null> {
  const d = await sobASentinela(() =>
    prisma.totemDispositivo.findUnique({
      where: { codigoAtivacaoHash: codigoHash },
      select: { id: true, orgId: true, lojaId: true, ativacaoExpiraEm: true, revogadoEm: true },
    }),
  );
  return d
    ? {
        dispositivoId: d.id,
        orgId: d.orgId,
        lojaId: d.lojaId,
        ativacaoExpiraEm: d.ativacaoExpiraEm,
        revogadoEm: d.revogadoEm,
      }
    : null;
}

/** O aparelho dono do token mandado em `X-Totem-Token`. Revogado decide o 401. */
export async function resolverTenantDoTotem(
  prisma: PrismaClient,
  tokenHash: string,
): Promise<{ dispositivoId: string; orgId: string; lojaId: string; revogadoEm: Date | null } | null> {
  const d = await sobASentinela(() =>
    prisma.totemDispositivo.findUnique({
      where: { tokenHash },
      select: { id: true, orgId: true, lojaId: true, revogadoEm: true },
    }),
  );
  return d ? { dispositivoId: d.id, orgId: d.orgId, lojaId: d.lojaId, revogadoEm: d.revogadoEm } : null;
}

/**
 * A etiqueta do QR. O código já chega normalizado (`totemNormalizarCodigo`) e
 * validado pelo schema de `@mktos/shared`; ele é aleatório e não deriva de id.
 */
export async function resolverTenantDaEtiqueta(
  prisma: PrismaClient,
  codigo: string,
): Promise<{
  etiquetaId: string;
  orgId: string;
  lojaId: string;
  produtoId: string;
  loteId: string | null;
  revogadaEm: Date | null;
} | null> {
  const e = await sobASentinela(() =>
    prisma.totemEtiqueta.findUnique({
      where: { codigo },
      select: { id: true, orgId: true, lojaId: true, produtoId: true, loteId: true, revogadaEm: true },
    }),
  );
  return e
    ? {
        etiquetaId: e.id,
        orgId: e.orgId,
        lojaId: e.lojaId,
        produtoId: e.produtoId,
        loteId: e.loteId,
        revogadaEm: e.revogadaEm,
      }
    : null;
}
