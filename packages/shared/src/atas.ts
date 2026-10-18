import { z } from 'zod';

/* ==========================================================================
 * O BANCO DE ATAS DO TRABALHO (rodada do painel P3, 18/10/2026)
 * ==========================================================================
 *
 * As atas da operação chegam por dois caminhos e moram em lugares diferentes:
 *
 *   · `vault` — notas do vault que o conector do Obsidian já indexa
 *     (`KnowledgeNote`), filtradas pela pasta das reuniões (padrão
 *     `80-Reunioes`, configurável pela nota da memória `trabalho.atas.pasta`);
 *   · `colada` — ata avulsa colada ou enviada na tela. Ela vira NOTA DA MEMÓRIA
 *     (chave `ata:<data>-<slug>`, procedência operador) pelo `MemoriaService`,
 *     o caminho da ADR-011. Nunca por fora.
 *
 * O id que a tela e a API trocam é a REFERÊNCIA da ata: `vault:<id da nota
 * indexada>` ou `memoria:<id da nota da memória>`. É ela que a sugestão de
 * tarefa guarda em `ataRef`, e é por ela que a tarefa aceita aponta de volta.
 *
 * As SUGESTÕES de tarefa nascem em rascunho, propostas pelo leitor de atas do
 * Trabalho; o parser confere cada trecho contra a ata e descarta o que não
 * está nela. Aceitar cria a tarefa pelo serviço do Trabalho; nada vira tarefa
 * sozinho.
 */

export const ATA_PASTA_PADRAO = '80-Reunioes';
/** A nota da memória que muda a pasta das atas do vault (primeira linha = a pasta). */
export const ATA_CHAVE_DA_PASTA = 'trabalho.atas.pasta';
/** O prefixo das chaves da memória das atas coladas. */
export const ATA_PREFIXO_DA_CHAVE = 'ata:';
export const ATA_MIN_CARACTERES = 120;
export const ATA_MAX_CARACTERES = 200_000;

export type TrabAtaFonte = 'vault' | 'colada';
export type TrabAtaSugestaoEstado = 'rascunho' | 'aceita' | 'descartada';

export interface TrabAtaContagem {
  rascunho: number;
  aceitas: number;
  descartadas: number;
}

export interface TrabAtaResumo {
  /** A referência da ata: `vault:<id>` ou `memoria:<id>`. */
  id: string;
  fonte: TrabAtaFonte;
  titulo: string;
  /** AAAA-MM-DD, quando a ata diz (cabeçalho, linha "Data:" ou nome do arquivo). */
  data: string | null;
  participantes: string[];
  resumo: string;
  /** O caminho no vault (só `vault`). */
  caminho: string | null;
  sugestoes: TrabAtaContagem;
  atualizadaEm: string;
}

export interface TrabAtaDetalhe extends TrabAtaResumo {
  texto: string;
  /** De onde veio, em uma linha (o caminho do vault ou a procedência da memória). */
  procedencia: string;
  sugestoesDaAta: TrabAtaSugestaoDto[];
}

export interface TrabAtaLista {
  atas: TrabAtaResumo[];
  /** A pasta do vault que está valendo. */
  pasta: string;
  /** Quantas notas do vault esta empresa tem indexadas (zero = só as coladas aparecem). */
  notasDoVault: number;
  iaConfigurada: boolean;
}

export interface TrabAtaSugestaoDto {
  id: string;
  ataRef: string;
  titulo: string;
  listaId: string | null;
  listaNome: string | null;
  donoSugerido: string | null;
  /** AAAA-MM-DD, só quando a ata disse a data. */
  vencimento: string | null;
  /** O pedaço da ata de onde a sugestão saiu (conferido contra a ata). */
  trecho: string;
  estado: TrabAtaSugestaoEstado;
  workTaskId: string | null;
  criadaEm: string;
  decididaEm: string | null;
  decididaPor: string | null;
}

export interface TrabAtaGeracao {
  criadas: TrabAtaSugestaoDto[];
  /** Sugestões que a leitura repetiu de uma rodada anterior (mesmo título). */
  repetidas: number;
  /** O que o parser descartou ou ajustou, para quem decide saber. */
  avisos: string[];
}

export const TrabAtaColarSchema = z.object({
  titulo: z.string().trim().min(3).max(200),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD').nullish(),
  participantes: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  texto: z.string().min(ATA_MIN_CARACTERES, `a ata precisa ter ao menos ${ATA_MIN_CARACTERES} caracteres`).max(ATA_MAX_CARACTERES),
});
export type TrabAtaColarInput = z.infer<typeof TrabAtaColarSchema>;

export const TrabAtaAceitarSchema = z.object({
  /** A lista escolhida na tela; sem ela vale a da sugestão. */
  listaId: z.string().uuid().optional(),
});
export type TrabAtaAceitarInput = z.infer<typeof TrabAtaAceitarSchema>;

/** A referência da ata, desmontada. `null` quando não é uma das duas formas. */
export function lerRefDaAta(ref: string): { fonte: TrabAtaFonte; id: string } | null {
  const m = /^(vault|memoria):([A-Za-z0-9_-]{1,80})$/.exec(String(ref ?? ''));
  if (!m) return null;
  return { fonte: m[1] === 'vault' ? 'vault' : 'colada', id: m[2] };
}

export function refDaAta(fonte: TrabAtaFonte, id: string): string {
  return `${fonte === 'vault' ? 'vault' : 'memoria'}:${id}`;
}
