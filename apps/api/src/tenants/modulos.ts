import { MODULOS, type ModuloKey } from '@mktos/shared';

/*
 * QUAL MÓDULO GOVERNA CADA ROTA DA API — RF-T-06
 * ==============================================
 *
 * `bio`, `pauta`, `financeiro`, `leads` e o resto são produto INTERNO da ROOT.
 * Um tenant cliente não pode ver a navegação do que não contratou — e, muito
 * mais importante, não pode ALCANÇAR a rota do que não contratou. Esconder o
 * item do menu sem recusar a rota é fachada: quem digitar a URL entra.
 *
 * Este arquivo é o núcleo PURO da decisão. Nada aqui sabe de Nest, de HTTP ou
 * de banco: entra um caminho e um conjunto de módulos, sai "pode" ou "não
 * pode". É o que permite ao teste percorrer as 198 rotas da API uma a uma sem
 * subir aplicação nenhuma.
 *
 * A LISTA DE MÓDULOS NÃO MORA AQUI
 * Ela mora em `packages/shared/src/nav.ts` (`MODULOS`), que é a mesma lista que
 * o menu do web usa. O que mora aqui é o MAPA de rota para módulo, que é
 * conhecimento da API e não tem como viver no pacote de navegação: `/api/meta`
 * serve a tela `/instagram`, `/api/goals` serve `/metas`, `/api/finance` serve
 * `/financeiro`. Os nomes não coincidem, e fingir que coincidem seria adivinhar.
 *
 * O ACOPLAMENTO É COBRADO POR TESTE, NÃO POR CONVENÇÃO
 * `test/modulos-por-tenant.test.ts` varre os `@Controller()` do código-fonte e
 * exige que TODO prefixo encontrado esteja declarado num dos dois conjuntos
 * abaixo. Controller novo com prefixo novo reprova a suíte até alguém decidir,
 * por escrito, se ele é espinha ou módulo. Foi feito assim porque a falha que
 * importa aqui é silenciosa dos dois lados: prefixo esquecido no mapa vira rota
 * que nunca desliga (vazamento), e prefixo colocado no mapa por engano vira
 * rota que nunca liga (tela morta).
 */

/**
 * Primeiro segmento do caminho, já sem o prefixo global `api`.
 *
 * Três cuidados que parecem paranoia e não são:
 *
 *  - MINÚSCULAS. O Express casa rota SEM diferenciar maiúscula de minúscula
 *    (`caseSensitive` é falso por padrão, e o `main.ts` não muda isso). Logo
 *    `/api/BIO/paginas` entra no `BioController` de verdade. Comparar sem
 *    normalizar deixaria o gate passar ao largo com um shift.
 *  - PERCENT-DECODING. `/api/%62io` hoje não casa com rota nenhuma no Express
 *    (ele compara o caminho cru), mas comparar as DUAS formas custa nada e
 *    fecha a porta antes de alguém trocar o roteador.
 *  - QUERY E FRAGMENTO fora. O que chega ao interceptor é `originalUrl`, que
 *    carrega `?dias=7`.
 *
 * Devolve `null` para caminho que não tem segmento algum depois de `api`.
 */
export function segmentoDaApi(caminho: string): { cru: string; decodificado: string } | null {
  const semQuery = caminho.split(/[?#]/)[0];
  const partes = semQuery.split('/').filter((p) => p !== '');
  if (partes[0]?.toLowerCase() === 'api') partes.shift();
  const cru = partes[0]?.toLowerCase();
  if (!cru) return null;
  let decodificado = cru;
  try {
    decodificado = decodeURIComponent(cru).toLowerCase();
  } catch {
    // `%zz` não é escape válido: fica o cru, que é o que o Express veria.
  }
  return { cru, decodificado };
}

/**
 * Prefixo da API -> módulo que o governa.
 *
 * Escrito nesta direção (e não módulo -> prefixos) porque é assim que a
 * pergunta chega em tempo de execução: veio `/api/goals/panel`, de quem é?
 * A visão invertida é derivada logo abaixo, para o teste e para a leitura.
 *
 * OS QUE NÃO SÃO ÓBVIOS, um por um:
 *  - `tasks` E `trabalho` são o mesmo módulo (`trabalho`): a tela `/tarefas` é
 *    a lista simples e `/trabalho` é o quadro; desligar uma e deixar a outra
 *    de pé seria desligar metade de um módulo.
 *  - `funnel` é do módulo `leads`: o funil é a leitura agregada do mesmo dado.
 *  - `events` é do módulo `pixels`: a tela `/pixels` é a única que consome
 *    `/api/events/*`. O `POST /api/events/track` mora aqui dentro e é PÚBLICO —
 *    ver a nota sobre rota pública no interceptor.
 *  - `meta` é do módulo `instagram`: a Graph API da Meta serve a tela do
 *    Instagram, e só ela (`/conexoes` usa `integrations`, que é espinha).
 *  - `conectar` é do módulo `bio`: é o callback OAuth de Instagram/TikTok da
 *    bio. O path é travado por App Review (ver CLAUDE.md) e é público.
 */
export const MODULO_POR_PREFIXO: Readonly<Record<string, ModuloKey>> = {
  trabalho: 'trabalho',
  tasks: 'trabalho',
  reports: 'relatorios',
  leads: 'leads',
  funnel: 'leads',
  campaigns: 'campanhas',
  events: 'pixels',
  content: 'conteudo',
  pauta: 'pauta',
  meta: 'instagram',
  bio: 'bio',
  conectar: 'bio',
  goals: 'metas',
  finance: 'financeiro',
};

/**
 * Prefixos da ESPINHA DO OS: nunca desligam, para tenant nenhum.
 *
 * A lista é declarada e não deduzida ("o que não está no mapa é espinha") de
 * propósito. Deduzir faria um controller novo nascer liberado em silêncio — e
 * "liberado em silêncio" num sistema multiempresa é exatamente o acidente que a
 * fatia existe para impedir. Declarado, o controller novo REPROVA a suíte até
 * alguém escrever de que lado ele está.
 *
 * Cada um destes fala do SISTEMA, não do negócio do cliente: quem entra
 * (`auth`), se está de pé (`health`), o pulso (`dashboard`), o que aconteceu
 * (`audit`), o que precisa de gente (`approvals`), quem trabalha (`agents`,
 * `sessions`), o que está ligado (`integrations`, `google`), o que o sistema
 * sabe (`knowledge`), quem autoriza (`users`, `roles`), as preferências
 * (`config`) e a própria resposta "quais módulos eu tenho" (`tenants`) — que
 * PRECISA continuar respondendo para um tenant sem módulo nenhum, senão o web
 * não consegue nem descobrir que não tem nada.
 */
export const PREFIXOS_DA_ESPINHA: readonly string[] = [
  'agents',
  'approvals',
  'audit',
  'auth',
  'config',
  'dashboard',
  'google',
  'health',
  'integrations',
  'knowledge',
  'roles',
  'sessions',
  'tenants',
  'users',
] as const;

const ESPINHA = new Set<string>(PREFIXOS_DA_ESPINHA);

/** Índice derivado de `MODULO_POR_PREFIXO` — módulo -> prefixos que ele governa. */
export const PREFIXOS_POR_MODULO: Readonly<Record<ModuloKey, readonly string[]>> = (() => {
  const mapa = Object.fromEntries(MODULOS.map((m) => [m, [] as string[]])) as Record<
    ModuloKey,
    string[]
  >;
  for (const [prefixo, modulo] of Object.entries(MODULO_POR_PREFIXO)) mapa[modulo].push(prefixo);
  return mapa;
})();

/**
 * As chaves de módulo conhecidas, como conjunto. DERIVADO de `MODULOS`, nunca
 * redigitado: uma segunda lista é uma lista que um dia diverge (a contagem de
 * ferramentas do MCP dizia 10 quando eram 35).
 */
const CHAVES = new Set<string>(MODULOS);

/** O valor é um módulo conhecido? `Org.modulos` é `TEXT[]`, sem enum no banco. */
export function ehModulo(valor: unknown): valor is ModuloKey {
  return typeof valor === 'string' && CHAVES.has(valor);
}

/**
 * Só os módulos conhecidos do que veio do banco, sem repetição e na ordem
 * canônica de `MODULOS`. Chave desconhecida gravada em `Org.modulos` nunca
 * libera rota — o gate pergunta "o módulo X está ligado?", e um `'xyz'`
 * sobrando não é resposta para pergunta nenhuma —, mas devolvê-la ao web
 * espalharia o lixo. Aqui ele para.
 */
export function modulosConhecidos(brutos: Iterable<string>): ModuloKey[] {
  const veio = new Set<string>(brutos);
  return MODULOS.filter((m) => veio.has(m));
}

/**
 * O módulo que governa este caminho, ou `null` quando ele é espinha do OS.
 *
 * LANÇA para prefixo que não está em nenhum dos dois conjuntos. É a escolha
 * ruidosa de propósito: caminho desconhecido só existe se alguém acrescentou
 * controller sem declarar de que lado ele está, e nesse ponto tanto "libera"
 * quanto "bloqueia" seriam um palpite. O teste estático pega isso antes de
 * qualquer deploy; se ainda assim chegar aqui em produção, quem decide o que
 * fazer com o erro é o interceptor — e ele escolhe LIBERAR, com log, porque
 * derrubar rota de cliente por causa de uma tabela incompleta seria pior. Ver
 * `modulos.interceptor.ts`.
 */
export function moduloDoCaminho(caminho: string): ModuloKey | null {
  const seg = segmentoDaApi(caminho);
  // `/api` cru, ou `/`: não é rota de nada; quem responde 404 é o roteador.
  if (!seg) return null;
  for (const forma of [seg.cru, seg.decodificado]) {
    const modulo = MODULO_POR_PREFIXO[forma];
    if (modulo) return modulo;
  }
  if (ESPINHA.has(seg.cru) && ESPINHA.has(seg.decodificado)) return null;
  throw new PrefixoNaoDeclaradoError(seg.cru);
}

/** Prefixo de rota que não foi declarado nem como módulo nem como espinha. */
export class PrefixoNaoDeclaradoError extends Error {
  constructor(readonly prefixo: string) {
    super(
      `prefixo de rota "${prefixo}" não está em MODULO_POR_PREFIXO nem em PREFIXOS_DA_ESPINHA ` +
        `(apps/api/src/tenants/modulos.ts): declare de que lado ele está — RF-T-06`,
    );
    this.name = 'PrefixoNaoDeclaradoError';
  }
}

/**
 * Este caminho está liberado para quem tem estes módulos ligados?
 *
 * Espinha do OS: sempre. Módulo: só se ligado. Prefixo não declarado: a
 * exceção sobe — quem chama decide.
 */
export function caminhoLiberado(caminho: string, modulosLigados: Iterable<string>): boolean {
  const modulo = moduloDoCaminho(caminho);
  if (!modulo) return true;
  const ligados = modulosLigados instanceof Set ? modulosLigados : new Set(modulosLigados);
  return ligados.has(modulo);
}
