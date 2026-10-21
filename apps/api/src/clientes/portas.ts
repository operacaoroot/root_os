import type { OrigemDaPasta, OrigemDoArquivo, SubpastaDoCliente } from '@mktos/shared';

/*
 * AS DUAS PORTAS DA PASTA DO CLIENTE (rodada dos agentes, 21/10/2026, Lane 0).
 *
 * Contrato entre as lanes: o Comercial (fechamento, assinatura, minuta), a
 * Implantação (ata do kickoff, kit) e o Trabalho (ata aceita, anexo da tarefa)
 * CHAMAM estas portas; quem as implementa é `clientes/` (TR-04 e TR-05), que
 * fala com o Google pela porta do operador (`drive.pasta.criar` e
 * `drive.arquivo.enviar`, R3). Injete pelos símbolos, com `@Optional()` quando o
 * chamador puder viver sem elas; o `ClientesModule` é global.
 *
 * NINGUÉM ALÉM DE `clientes/` fala com o Drive por aqui: as portas recebem o
 * cliente (`Partner`), nunca um id de pasta do Drive — é o que impede um
 * chamador de mandar arquivo de um cliente para a pasta de outro.
 */

export const PASTA_DO_CLIENTE = Symbol('PASTA_DO_CLIENTE');
export const ARQUIVISTA_DO_CLIENTE = Symbol('ARQUIVISTA_DO_CLIENTE');

export type ResultadoDaPasta =
  /** A pasta existe (criada agora, ligada a uma de mesmo nome, ou já ligada antes). */
  | { estado: 'pronta'; pastaId: string; url: string; ligada: boolean }
  /** A criação foi à porta e espera a segunda pessoa (R3). */
  | { estado: 'aguardando_aprovacao'; approvalId: string }
  /** A empresa não configurou a raiz (`clientes.pasta.raiz`) ou não tem Google. */
  | { estado: 'sem_raiz'; motivo: string }
  | { estado: 'erro'; motivo: string };

export interface PedidoDePasta {
  orgId: string;
  /** O `Partner` cliente. */
  partnerId: string;
  origem: OrigemDaPasta;
  leadId?: string | null;
  /** Quem pediu (pessoa), para a porta e o RASTRO; ausente = o sistema. */
  atorId?: string | null;
}

export interface PastaDoClientePort {
  /** Idempotente pelo ponteiro `Partner.pastaDriveId`. Nunca lança por falha do Drive: devolve `erro`. */
  garantir(pedido: PedidoDePasta): Promise<ResultadoDaPasta>;
}

export type ResultadoDoArquivo =
  | { estado: 'enviado'; subpasta: SubpastaDoCliente; nome: string; arquivoId: string; url: string }
  | { estado: 'aguardando_aprovacao'; approvalId: string; subpasta: SubpastaDoCliente; nome: string }
  /** Sem pasta do cliente ainda: fica na fila e sai quando a pasta nascer. */
  | { estado: 'na_fila'; motivo: string }
  /** Confiança baixa: foi para `_fonte` e virou pendência "classificar à mão". */
  | { estado: 'classificar_a_mao'; pendenciaId: string }
  /** Cliente interno ("Root (interno)") ou sem cliente: fica só no storage do OS. */
  | { estado: 'so_no_os'; motivo: string }
  | { estado: 'erro'; motivo: string };

export interface PedidoDeArquivo {
  orgId: string;
  /** O `Partner` cliente; `null` = o arquivista tenta achar pelo lead ou fica no OS. */
  partnerId: string | null;
  leadId?: string | null;
  origem: OrigemDoArquivo;
  nomeOriginal: string;
  tipoMime: string;
  /** O binário: já no storage do OS (chave + hash) ou em memória (o arquivista guarda). */
  conteudo: { chave: string; sha256: string; bytes: number } | { buffer: Buffer };
  /** Quando o chamador já sabe (ex.: o contrato assinado vai a 02-contrato). */
  subpasta?: SubpastaDoCliente;
  /** O tipo e o título do nome padrão, quando o chamador já sabe. */
  tipo?: string;
  titulo?: string;
  data?: Date;
  /** Até as duas primeiras páginas de texto, quando o chamador já leu. */
  texto?: string;
  atorId?: string | null;
  /**
   * De onde o arquivo veio no OS (lane A4): o anexo da tarefa manda
   * `{ tipo: 'WorkAnexo', id }`. É a idempotência do chamador (o mesmo anexo
   * arquivado duas vezes cai no mesmo registro) e o que a lista de anexos lê.
   */
  ref?: { tipo: string; id: string } | null;
}

export interface ArquivistaDoClientePort {
  /** Nunca lança por falha do Drive ou do modelo: devolve o estado. */
  arquivar(pedido: PedidoDeArquivo): Promise<ResultadoDoArquivo>;
}
