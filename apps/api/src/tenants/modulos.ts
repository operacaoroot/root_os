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
 *    bio. O path é travado porque é a redirect cadastrada nos consoles; mudar
 *    exige recadastrar e refazer as conexões (ver CLAUDE.md). É público.
 *  - `midia-publica` é do módulo `pauta` (MD4): serve o JPEG e o mp4 da peça
 *    por URL assinada de 1 h, para a Graph da Meta baixar. É pública (sem
 *    token de sessão) e, como o gate deixa anônimo passar, o serviço confere
 *    o módulo da empresa do token por conta própria.
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
  'midia-publica': 'pauta',
  // MD10: o retorno do OAuth do canal do YouTube — o canal é da máquina de conteúdo.
  youtube: 'pauta',
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
 * `organograma`, `sessions`), o que está ligado (`integrations`, `google`), o
 * que o sistema sabe (`knowledge`, `memoria`), quando ele age sozinho
 * (`rotinas`), sob qual régua ele age (`policy`), quem autoriza (`users`,
 * `roles`), as preferências (`config`) e a própria resposta "quais módulos eu
 * tenho" (`tenants`) — que PRECISA continuar respondendo para um tenant sem
 * módulo nenhum, senão o web não consegue nem descobrir que não tem nada.
 *
 * `memoria`, `rotinas` e `organograma` entraram na onda 9, e os três são espinha
 * pelo mesmo motivo: a memória é o que o sistema sabe sobre a empresa (o
 * dicionário, as regras da casa, o histórico de decisões), a rotina é o relógio
 * dele e o organograma é quem trabalha aqui. Nenhum é módulo de negócio que se
 * contrata à parte. Enquanto `memoria` e `rotinas` não estavam declarados,
 * `moduloDoCaminho` LANÇAVA para toda rota das duas famílias — o preço de a
 * lista ser declarada em vez de deduzida, e o preço certo.
 *
 * `policy` É ESPINHA, e a decisão é esta: a régua R0–R5 não desliga para
 * empresa nenhuma. Ela é o que governa toda ação do OS — desligá-la por
 * contrato seria vender um sistema que age sem régua. O que a tela `/regua`
 * MOSTRA continua sendo filtrado pelos módulos da empresa (o catálogo de
 * capacidades de um módulo não contratado não aparece; ver `ReguaService`), mas
 * a rota em si responde sempre.
 *
 * `assinatura` ENTROU NA ONDA 11 (fatia 6.2, RF-O-03) e é espinha por duas
 * razões, a segunda decisiva. A primeira: a assinatura é o contrato que sustenta
 * TODOS os módulos; um módulo "cobrança" que a empresa pudesse não contratar
 * seria um contrato opcional sobre o próprio contrato. A segunda: se fosse
 * módulo, a fatia não funcionaria — empresa nova nasce com `modulos = []` e
 * receberia 404 na própria tela de assinatura, e empresa SUSPENSA não teria como
 * ver por que está fora nem avisar que pagou. O bloqueio ficaria correto e o
 * cliente, sem saída. (Este prefixo também está em
 * `PREFIXOS_LIBERADOS_NA_SUSPENSAO`, em `billing/assinatura.ts`: são duas
 * perguntas diferentes — "desliga por contrato?" e "responde para quem está
 * suspenso?" — e responder uma não responde a outra.)
 *
 * `linha-do-tempo` ENTROU NA FATIA A9 e é espinha pela mesma decisão de
 * `audit`, de quem ela é a outra leitura: o RASTRO não desliga por contrato. As
 * duas telas leem o MESMO `EventLog` — `/rastro` como prova (evento cru, cadeia,
 * verificação) e `/linha-do-tempo` como história (por dia, com ator e objeto
 * legíveis). Uma empresa que pudesse desligar a segunda ficaria com agentes
 * agindo e sem a tela que conta o que eles fizeram, que é exatamente o que a
 * frente do controle de agentes existe para dar.
 *
 * `caixa` ENTROU NA FATIA A7 e é espinha porque é a caixa PESSOAL de quem entra
 * no OS — "o que precisa de mim". Uma empresa que pudesse desligá-la ficaria com
 * aprovações esperando assinatura e tarefas paradas sem nenhuma tela dizendo que
 * esperam. Ela AGREGA dado de módulo (`trabalho`), e por isso o serviço pergunta
 * ao `ModulosService` antes de ler `WorkTask`: rota que nunca desliga servindo
 * dado de módulo não contratado é exatamente o vazamento silencioso que este
 * arquivo existe para impedir — espinha diz "a rota responde", não "o dado é
 * livre".
 *
 * `mapa-publico` ENTROU NA ONDA 11 (fatia 6.5) e é espinha porque não é
 * superfície de empresa nenhuma: é a ENTRADA do domínio, anônima, servindo a
 * vitrine da própria ROOT (`GET /api/mapa-publico`, sem guard). Um "módulo
 * vitrine" que uma empresa pudesse contratar não faria sentido — não há tenant
 * para contratá-lo, porque quem chega ali ainda não tem conta. O gate deixa
 * requisição anônima passar de propósito, então a declaração aqui não muda o
 * comportamento em execução; o que ela muda é a suíte estática parar de reprovar
 * e o `ModulosInterceptor` parar de gritar "prefixo não declarado" a cada visita
 * à home.
 */
export const PREFIXOS_DA_ESPINHA: readonly string[] = [
  // A rota PAT da memória tem guarda própria; espinha aqui só declara o
  // gate de módulos, não concede autenticação nem escopo de dados.
  'agent',
  'agents',
  'approvals',
  'assinatura',
  'audit',
  'auth',
  'caixa',
  'config',
  'conector',
  'ferramentas',
  'dashboard',
  'google',
  'health',
  'integrations',
  'knowledge',
  'linha-do-tempo',
  'mapa-publico',
  'memoria',
  'organograma',
  'policy',
  'roles',
  'rotinas',
  'sessions',
  'tenants',
  'users',
] as const;

/** Namespace reservado para ferramentas próprias; não é um módulo do catálogo core. */
export const PREFIXO_FERRAMENTAS = 'ferramentas' as const;

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

/* ------------------------------------------------- o catálogo de capacidades */

/**
 * O módulo que governa a ROTA declarada por uma capacidade do catálogo.
 *
 * A rota vem escrita como `"PATCH /leads/:id"` ou `"GET /tasks?overdue=1"` — o
 * verbo na frente, a query no fim. Aqui só o caminho interessa, e ele passa
 * pelo MESMO `moduloDoCaminho` que o gate de requisição usa: se um dia a rota
 * mudar de módulo, a tela e a porta mudam juntas.
 *
 * Devolve `null` em dois casos que são o mesmo para quem pergunta ("aparece
 * sempre"): capacidade sem rota declarada (a maior parte do catálogo herdado da
 * ROOT, que fala de sistemas externos e não de rota HTTP nenhuma) e rota de
 * espinha do OS. LANÇA `PrefixoNaoDeclaradoError` para prefixo desconhecido,
 * como o resto deste arquivo.
 */
export function moduloDaCapacidade(rota: string | null | undefined): ModuloKey | null {
  if (!rota) return null;
  const caminho = rota.trim().split(/\s+/).pop();
  if (!caminho || !caminho.startsWith('/')) return null;
  return moduloDoCaminho(caminho);
}

/**
 * O catálogo que esta empresa pode VER — RF-T-06.
 *
 * O gate de rota já recusa `/api/finance/*` para quem não contratou financeiro.
 * Sem este filtro, porém, o painel da Régua entregava a MESMA empresa a lista
 * completa de capacidades: identificador, descrição, rota e nome da ferramenta
 * de todo módulo que ela não tem. É exatamente a superfície que a fatia de
 * módulos por empresa existe para não mostrar.
 *
 * PREFIXO NÃO DECLARADO MANTÉM A CAPACIDADE VISÍVEL, e grita pelo `aoFalhar`.
 * É a mesma escolha do `ModulosInterceptor`: sumir com metade do catálogo por
 * causa de uma linha esquecida nesta tabela seria trocar um vazamento possível
 * por uma tela quebrada certa — e o teste estático pega o prefixo faltando
 * antes de qualquer deploy.
 */
export function catalogoVisivel<T extends { rota?: string | null }>(
  capacidades: readonly T[],
  modulosLigados: Iterable<string>,
  aoFalhar?: (erro: PrefixoNaoDeclaradoError, item: T) => void,
): T[] {
  const ligados = modulosLigados instanceof Set ? modulosLigados : new Set(modulosLigados);
  return capacidades.filter((c) => {
    let modulo: ModuloKey | null;
    try {
      modulo = moduloDaCapacidade(c.rota);
    } catch (e) {
      if (!(e instanceof PrefixoNaoDeclaradoError)) throw e;
      aoFalhar?.(e, c);
      return true;
    }
    return modulo === null || ligados.has(modulo);
  });
}
