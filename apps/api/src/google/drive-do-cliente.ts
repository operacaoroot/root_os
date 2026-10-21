/*
 * O DRIVE DA PASTA DO CLIENTE (rodada dos agentes, 21/10/2026, lane A4, TR-04/TR-05).
 *
 * A declaração do cliente que `clientes/` recebe por injeção (`DRIVE_DO_CLIENTE`)
 * e as partes puras: o nome sem colisão, a subida até a raiz e a cópia da
 * estrutura do `_modelo-cliente`. O HTTP mora SÓ em `google.service.ts` (o único
 * arquivo com o endereço do Google), que implementa a interface; a fiação é
 * `google.module.ts` (`useExisting: GoogleService`). É o desenho do MD6/MD10
 * (`GRAPH_DE_PUBLICACAO`, `CLIENTE_DO_YOUTUBE`): quem tem regra de negócio (o
 * ponteiro no `Partner`, a raiz da nota da memória, o binário do storage)
 * inscreve o efeito e recebe o cliente; o conector só fala com o Google.
 *
 * Nada aqui apaga, move nem sobrescreve: os métodos são criar, copiar, enviar
 * e ler. Não existe método de apagar porque não existe capacidade de apagar.
 */

export const DRIVE_DO_CLIENTE = Symbol('DRIVE_DO_CLIENTE');

export const MIME_DA_PASTA = 'application/vnd.google-apps.folder';
export const MIME_DO_ATALHO = 'application/vnd.google-apps.shortcut';

/** O teto de profundidade da subida até a raiz: mais que isso é atalho circular ou raiz errada. */
export const PROFUNDIDADE_MAXIMA_ATE_A_RAIZ = 20;
/** O teto da cópia do modelo: pastas e arquivos visitados. */
export const TETO_DA_COPIA_DO_MODELO = 300;
/** Acima disto o envio é resumable (duas chamadas) em vez de multipart. */
export const LIMITE_DO_ENVIO_MULTIPART = 5 * 1024 * 1024;

export interface ItemDoDrive {
  id: string;
  nome: string;
  mimeType: string;
  url: string | null;
  /** As pastas onde o item está (o Drive de hoje tem um pai só; a lista cobre o legado). */
  pais: string[];
  /** Atalho: o id do alvo. */
  alvoDoAtalho?: string | null;
}

export interface ResultadoDaCopia {
  pastasCriadas: number;
  arquivosCopiados: number;
  /** Já existiam no destino com o mesmo nome: não foram tocados. */
  jaExistiam: number;
  /** Itens do modelo que não são pasta nem `.md` (não copiados). */
  ignorados: number;
}

export interface DriveDoCliente {
  /** Metadados de um item; `null` se não existe, não é acessível ou está na lixeira. */
  itemDoDrive(orgId: string, id: string): Promise<ItemDoDrive | null>;
  /** A pasta de verdade por trás de um id (atalho vira o alvo); o que não é pasta volta `null`. */
  pastaReal(orgId: string, id: string): Promise<ItemDoDrive | null>;
  /** Os filhos diretos de uma pasta, sem lixeira; `nome` filtra pelo nome EXATO. */
  filhosDaPasta(orgId: string, pastaId: string, filtro?: { nome?: string; soPastas?: boolean }): Promise<ItemDoDrive[]>;
  /** `id` é a raiz ou está dentro dela? Sobe pelos pais, com teto de profundidade. */
  dentroDaRaiz(orgId: string, id: string, raizId: string): Promise<boolean>;
  /** Cria uma pasta vazia dentro de `paiId`. Nome com barra é recusado. */
  criarPasta(orgId: string, paiId: string, nome: string): Promise<ItemDoDrive>;
  /** Copia a estrutura do modelo para o destino: as pastas (vazias) e os `.md`. Nunca move nem apaga. */
  copiarEstrutura(orgId: string, modeloId: string, destinoId: string): Promise<ResultadoDaCopia>;
  /** Envia um binário para `paiId`; nome repetido ganha sufixo, nunca sobrescreve. */
  enviarArquivo(
    orgId: string,
    entrada: { paiId: string; nome: string; tipoMime: string; conteudo: Buffer },
  ): Promise<ItemDoDrive>;
}

/** Nome que o Drive e o sistema de arquivos aceitam sem estranhar: sem barra, sem controle. */
export function nomeValidoNoDrive(nome: string): boolean {
  const n = String(nome ?? '');
  return n.trim().length > 0 && n.length <= 200 && !/[\\/\u0000-\u001f]/.test(n);
}

/** Um valor entre aspas simples na consulta do Drive (`q`): barra invertida e aspas escapadas. */
export function valorNaConsultaDoDrive(v: string): string {
  return String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * O nome sem colisão: `nome.pdf`, `nome (2).pdf`, `nome (3).pdf`... A comparação
 * ignora maiúscula, que é como a pessoa lê a pasta. NUNCA sobrescreve: o Drive
 * aceitaria dois arquivos com o mesmo nome, e quem abre a pasta não saberia
 * qual é qual.
 */
export function nomeSemColisao(nome: string, existentes: Iterable<string>): string {
  const ocupados = new Set([...existentes].map((n) => n.toLowerCase()));
  if (!ocupados.has(nome.toLowerCase())) return nome;
  const m = /^(.*?)(\.[A-Za-z0-9]{1,10})?$/.exec(nome);
  const base = m?.[1] ?? nome;
  const ext = m?.[2] ?? '';
  for (let i = 2; i < 1000; i++) {
    const candidato = `${base} (${i})${ext}`;
    if (!ocupados.has(candidato.toLowerCase())) return candidato;
  }
  throw new Error('nomes demais iguais nesta pasta: confira a pasta no Drive.');
}

/**
 * Sobe pelos pais de `id` até achar `raizId`. `pais(x)` devolve os pais de `x`
 * (`null` quando o item não existe ou não é visível). Passou do teto, ou deu a
 * volta (atalho circular), é FORA: a dúvida recusa a escrita.
 */
export async function subirAteARaiz(
  id: string,
  raizId: string,
  pais: (id: string) => Promise<string[] | null>,
  teto = PROFUNDIDADE_MAXIMA_ATE_A_RAIZ,
): Promise<boolean> {
  if (!id || !raizId) return false;
  if (id === raizId) return true;
  const vistos = new Set<string>([id]);
  let nivel = [id];
  for (let profundidade = 0; profundidade < teto && nivel.length; profundidade++) {
    const proximo: string[] = [];
    for (const atual of nivel) {
      const deste = await pais(atual);
      for (const p of deste ?? []) {
        if (p === raizId) return true;
        if (!vistos.has(p)) {
          vistos.add(p);
          proximo.push(p);
        }
      }
    }
    nivel = proximo;
  }
  return false;
}

/**
 * A cópia da estrutura do modelo, pura sobre o cliente: para cada pasta do
 * modelo, a pasta de mesmo nome no destino (criada se falta, reaproveitada se
 * existe) e a descida; para cada `.md`, a cópia se o destino ainda não tem um
 * arquivo de mesmo nome. O resto do modelo (planilha, PDF) fica de fora: o
 * `_modelo-cliente` é esqueleto, e o que não é esqueleto não se replica a cada
 * cliente. Nada no destino é apagado, movido ou sobrescrito.
 */
export async function copiarEstruturaDoModelo(
  cliente: {
    filhosDaPasta: DriveDoCliente['filhosDaPasta'];
    criarPasta: DriveDoCliente['criarPasta'];
    copiarArquivo: (orgId: string, arquivoId: string, paiId: string, nome: string) => Promise<ItemDoDrive>;
  },
  orgId: string,
  modeloId: string,
  destinoId: string,
  teto = TETO_DA_COPIA_DO_MODELO,
): Promise<ResultadoDaCopia> {
  const r: ResultadoDaCopia = { pastasCriadas: 0, arquivosCopiados: 0, jaExistiam: 0, ignorados: 0 };
  let visitados = 0;
  const visitar = async (origem: string, destino: string, profundidade: number): Promise<void> => {
    if (profundidade > 10) throw new Error('o _modelo-cliente tem mais de 10 níveis: confira se não há atalho circular.');
    const doModelo = await cliente.filhosDaPasta(orgId, origem);
    const noDestino = await cliente.filhosDaPasta(orgId, destino);
    const porNome = new Map(noDestino.map((i) => [i.nome.toLowerCase(), i]));
    for (const item of doModelo) {
      if (++visitados > teto) throw new Error(`o _modelo-cliente passa de ${teto} itens: confira a pasta do modelo.`);
      const ja = porNome.get(item.nome.toLowerCase());
      if (item.mimeType === MIME_DA_PASTA) {
        if (ja && ja.mimeType === MIME_DA_PASTA) {
          r.jaExistiam++;
          await visitar(item.id, ja.id, profundidade + 1);
        } else if (ja) {
          // Um arquivo com o nome da pasta: não mexe em nada, só não desce.
          r.jaExistiam++;
        } else {
          const nova = await cliente.criarPasta(orgId, destino, item.nome);
          r.pastasCriadas++;
          await visitar(item.id, nova.id, profundidade + 1);
        }
        continue;
      }
      if (!/\.md$/i.test(item.nome)) {
        r.ignorados++;
        continue;
      }
      if (ja) {
        r.jaExistiam++;
        continue;
      }
      await cliente.copiarArquivo(orgId, item.id, destino, item.nome);
      r.arquivosCopiados++;
    }
  };
  await visitar(modeloId, destinoId, 0);
  return r;
}
