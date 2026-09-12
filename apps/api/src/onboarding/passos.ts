import type { EstadoDaCarga } from './carga-guiada';

/* ==========================================================================
 * OS QUATRO PASSOS DA ENTRADA — e por que nenhum deles tem tabela
 * ==========================================================================
 *
 * cadastro → conectar fontes → carga guiada do contexto → primeira resposta.
 *
 * O ESTADO É DERIVADO, sempre. Não existe tabela `Onboarding` e não deve
 * existir: ela seria uma segunda verdade sobre fatos que já têm dono no banco —
 * a empresa existe (`Org`), o conector está autorizado (`IntegrationAccount`),
 * o tema virou nota (`ContextItem`), o retrato foi escrito (`ContextItem` com a
 * chave do retrato). Duas verdades divergem no primeiro erro entre gravar o
 * fato e marcar o passo, e a que fica para trás é sempre a que a tela mostra.
 *
 * Derivar também resolve o reinício de graça: a pessoa fechou o navegador no
 * meio, voltou dois dias depois, e a entrada continua de onde parou sem que
 * ninguém precise ter guardado "de onde parou".
 *
 * CONECTAR FONTE NÃO BLOQUEIA NADA, e isto é decisão de produto escrita em
 * código: o OAuth do Google e o da Meta dependem de App Review, de a pessoa ter
 * a conta certa na mão e de o provedor estar de pé. Amarrar o degrau de entrada
 * a isso entregaria um produto que, num dia ruim do fornecedor, não deixa
 * ninguém entrar. A carga do contexto e a primeira resposta funcionam sem
 * conector nenhum — elas falam da memória da empresa, que é dela.
 */

export type PassoDaEntrada = 'empresa' | 'fontes' | 'contexto' | 'primeira-resposta';

export type SituacaoDoPasso = 'pronto' | 'pendente' | 'opcional-pendente';

export interface RetratoDoPasso {
  passo: PassoDaEntrada;
  situacao: SituacaoDoPasso;
  /** A frase que a tela mostra. Escrita para quem chegou agora, não para o log. */
  texto: string;
}

/** O que o leitor de estado precisa saber do banco. Nada além disto. */
export interface FatosDaEntrada {
  empresa: { nome: string; slug: string };
  /** Conectores desta empresa com autorização válida. Pode estar vazio. */
  fontesConectadas: readonly string[];
  carga: EstadoDaCarga;
  /** O retrato já foi escrito na memória? */
  temRetrato: boolean;
}

export interface EstadoDaEntrada {
  empresa: { nome: string; slug: string };
  passos: RetratoDoPasso[];
  /** O passo em que a pessoa está agora. `null` = a entrada terminou. */
  atual: PassoDaEntrada | null;
  /** A entrada cumpriu a promessa: contexto carregado e primeira resposta dada. */
  concluida: boolean;
  carga: EstadoDaCarga;
  fontesConectadas: string[];
}

export function estadoDaEntrada(fatos: FatosDaEntrada): EstadoDaEntrada {
  const passos: RetratoDoPasso[] = [
    {
      passo: 'empresa',
      situacao: 'pronto',
      texto: `${fatos.empresa.nome} existe no OS, com você como administrador.`,
    },
    {
      passo: 'fontes',
      situacao: fatos.fontesConectadas.length ? 'pronto' : 'opcional-pendente',
      texto: fatos.fontesConectadas.length
        ? `Conectado: ${fatos.fontesConectadas.join(', ')}.`
        : 'Nenhuma fonte conectada ainda. Dá para seguir sem — e conectar depois, em Conexões.',
    },
    {
      passo: 'contexto',
      situacao: fatos.carga.pronta ? 'pronto' : 'pendente',
      texto: fatos.carga.pronta
        ? `${fatos.carga.respondidos.length} tema(s) carregado(s) na memória, com procedência.`
        : `Faltam ${fatos.carga.faltando.length} tema(s) obrigatório(s) para o OS saber do que ` +
          'você está falando.',
    },
    {
      passo: 'primeira-resposta',
      situacao: fatos.temRetrato ? 'pronto' : 'pendente',
      texto: fatos.temRetrato
        ? 'O OS já leu de volta o que entendeu, citando a nota de cada parte.'
        : 'Falta o OS ler de volta o que entendeu. É a primeira resposta, e ela cita as fontes.',
    },
  ];

  /*
   * O PASSO ATUAL pula o que é opcional. Uma tela que parasse em "conectar
   * fontes" faria do OAuth um pedágio — e o parágrafo do cabeçalho explica por
   * que ele não pode ser.
   */
  const atual = passos.find((p) => p.situacao === 'pendente')?.passo ?? null;

  return {
    empresa: fatos.empresa,
    passos,
    atual,
    concluida: fatos.carga.pronta && fatos.temRetrato,
    carga: fatos.carga,
    fontesConectadas: [...fatos.fontesConectadas],
  };
}

/**
 * As fontes que o cliente autoriza NA CONTA DELE.
 *
 * São as de escopo `empresa` do contrato de conector (`EscopoDaCredencial`):
 * cada empresa autoriza a sua, revogar faz sentido e a saúde varia de empresa
 * para empresa. As de escopo `processo` (ClickUp, vault, Evolution) usam
 * credencial do ambiente e valem para todas — não é "a conta do cliente", e
 * oferecê-las na entrada prometeria o que a entrada não entrega.
 *
 * A AUTORIZAÇÃO EM SI NÃO É REESCRITA AQUI: quem faz é
 * `POST /api/integrations/:chave/autorizacao`, que já devolve para onde mandar
 * o navegador e já grava a credencial no COFRE por empresa. A entrada só
 * aponta para lá.
 */
export interface FonteDaEntrada {
  /** A chave do CONTRATO — a unidade de credencial, e o `:chave` da rota. */
  chave: string;
  rotulo: string;
  oQueTraz: string;
  /**
   * AS LINHAS QUE O HUB GRAVA, que NÃO são a chave do contrato.
   *
   * Esta distinção já custou uma leitura errada, e ela é fácil de repetir:
   * `POST /api/integrations/google/autorizacao` usa a chave do CONTRATO, mas o
   * que fica em `IntegrationAccount.key` são as SUPERFÍCIES — `gmail`, `gcal`,
   * `gdocs`, `drive` (ver `GoogleService.upsertIntegration`) e `instagram`
   * (ver `MetaService.upsertIntegration`). Filtrar o hub por `'google'` não
   * devolve linha nenhuma, nunca: a tela diria "nada conectado" para uma
   * empresa que acabou de autorizar, e a promessa ficaria verde no código e
   * falsa na tela.
   *
   * `contrato-de-conector.ts` chama isto de `linhasDoCatalogo`, e é a mesma
   * lista. Ela é repetida aqui, e não importada, porque o descritor é montado
   * em tempo de execução dentro de cada serviço de conector — não há constante
   * a importar. O caso "as linhas do hub não são a chave do contrato" em
   * `test/onboarding.test.ts` é o que impede as duas de divergirem em silêncio.
   */
  linhasNoHub: readonly string[];
}

export const FONTES_DA_ENTRADA: readonly FonteDaEntrada[] = [
  {
    chave: 'google',
    rotulo: 'Conta Google',
    oQueTraz: 'agenda, e-mail, documentos e arquivos do Drive da sua conta',
    linhasNoHub: ['gmail', 'gcal', 'gdocs', 'drive'],
  },
  {
    chave: 'meta',
    rotulo: 'Instagram',
    oQueTraz: 'as métricas e as publicações do perfil da sua empresa',
    linhasNoHub: ['instagram'],
  },
] as const;

/**
 * As linhas do hub que interessam à entrada, e a quem cada uma pertence.
 *
 * Devolve a chave do CONTRATO para uma linha do hub — é a tradução que a
 * leitura de estado precisa fazer, e o único lugar onde ela acontece.
 */
export function fonteDaLinhaDoHub(key: string): string | null {
  return FONTES_DA_ENTRADA.find((f) => f.linhasNoHub.includes(key))?.chave ?? null;
}

/** Todas as linhas do hub que a entrada consulta, sem repetição. */
export const LINHAS_NO_HUB: readonly string[] = [
  ...new Set(FONTES_DA_ENTRADA.flatMap((f) => f.linhasNoHub)),
];
