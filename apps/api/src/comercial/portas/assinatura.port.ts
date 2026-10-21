/*
 * A PORTA DE ASSINATURA DO COMERCIAL (lane D, 13/10/2026).
 *
 * Mesmo desenho da porta de cobrança: o comercial recebe esta interface por
 * injeção (`PORTA_DE_ASSINATURA`), ligada ao conector da ZapSign na fiação da
 * pasta dele (`comercial/conectores/zapsign.module.ts`). Endereço, token da API
 * e segredo do webhook moram só no conector. Aqui: o contrato e a leitura pura
 * do webhook.
 *
 * O papel de cada signatário viaja como `external_id` do signatário
 * (`cliente` ou `root`): é por ele que o webhook diz QUEM assinou, sem casar
 * nome nem e-mail.
 */

export const PORTA_DE_ASSINATURA = Symbol('PORTA_DE_ASSINATURA');

export type PapelDoSignatario = 'cliente' | 'root';

export interface SignatarioNovo {
  papel: PapelDoSignatario;
  nome: string;
  email: string;
}

export interface SignatarioNoProvedor {
  papel: PapelDoSignatario | null;
  token: string;
  link: string | null;
  assinadoEm: string | null;
}

export interface DocumentoNoProvedor {
  externoId: string;
  estado: 'pendente' | 'assinado' | 'outro';
  signatarios: SignatarioNoProvedor[];
  pdfUrl: string | null;
}

export interface NovoDocumento {
  nome: string;
  markdown: string;
  referenciaExterna: string;
  signatarios: SignatarioNovo[];
}

export interface AssinaturaNoWebhook {
  externoId: string;
  todosAssinaram: boolean;
  /** Os signatários que JÁ assinaram, pelo papel (o corpo traz a lista inteira). */
  assinados: { papel: PapelDoSignatario; em: string | null }[];
  pdfUrl: string | null;
}

export interface PortaDeAssinatura {
  readonly provedor: string;
  configurada(): boolean;
  criarDocumento(d: NovoDocumento): Promise<DocumentoNoProvedor>;
  /**
   * "Enviar para assinar": na ZapSign o documento criado já tem um link por
   * signatário; o envio ao cliente é a M7 pelo WhatsApp da Root (porta do
   * WhatsApp, R3) e a sala. Devolve os links atuais.
   */
  enviarParaAssinar(externoId: string): Promise<DocumentoNoProvedor | null>;
  consultarEstado(externoId: string): Promise<DocumentoNoProvedor | null>;
  webhookAutentico(token: string | undefined | null): boolean;
  interpretarWebhook(corpo: unknown): AssinaturaNoWebhook | null;
  /**
   * CO-08 (rodada dos agentes, 21/10/2026): o PDF ASSINADO do documento, baixado pelo conector a
   * partir do estado que o PROVEDOR devolve agora (nunca da URL que veio no corpo do webhook).
   * `null` = o documento não está assinado ou não tem PDF. Opcional: o dublê da suíte vive sem.
   */
  baixarAssinado?(externoId: string): Promise<PdfAssinado | null>;
}

/** O PDF assinado, já conferido pelo conector (assinatura `%PDF-` e teto de tamanho). */
export interface PdfAssinado {
  buffer: Buffer;
  tipoMime: 'application/pdf';
  bytes: number;
}

/** O maior PDF assinado que o conector baixa. */
export const MAX_BYTES_DO_PDF_ASSINADO = 25 * 1024 * 1024;

/** O começo de todo PDF (`%PDF-`). */
export function pareceSerPdf(b: Buffer): boolean {
  return b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-';
}

type P = Record<string, unknown>;

function papelDe(v: unknown): PapelDoSignatario | null {
  return v === 'cliente' || v === 'root' ? v : null;
}

/** Um documento da ZapSign (API v1) no vocabulário do comercial. */
export function documentoDaZapsign(d: P): DocumentoNoProvedor {
  const signers = Array.isArray(d.signers) ? (d.signers as P[]) : [];
  const status = String(d.status ?? '');
  return {
    externoId: String(d.token ?? ''),
    estado: status === 'signed' ? 'assinado' : status === 'pending' ? 'pendente' : 'outro',
    signatarios: signers.map((s) => ({
      papel: papelDe(s.external_id),
      token: String(s.token ?? ''),
      link: typeof s.sign_url === 'string' ? s.sign_url : null,
      // Assinado sem data no corpo vira '' (assinado, hora desconhecida), nunca `null` (que quer dizer "não assinou").
      assinadoEm: s.status === 'signed' ? (typeof s.signed_at === 'string' ? s.signed_at : '') : null,
    })),
    pdfUrl: typeof d.signed_file === 'string' && d.signed_file ? d.signed_file : null,
  };
}

/**
 * Lê o webhook da ZapSign (`signer_signed` / `doc_signed`). Quem assinou sai
 * da lista inteira de signatários (não só do `signer_who_signed`): a reentrega
 * fora de ordem não perde ninguém.
 */
export function lerWebhookDaZapsign(corpo: unknown): AssinaturaNoWebhook | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const c = corpo as P;
  const token = typeof c.token === 'string' ? c.token : '';
  if (!token) return null;
  const signers = Array.isArray(c.signers) ? (c.signers as P[]) : [];
  const quem = (c.signer_who_signed ?? null) as P | null;
  const assinados = new Map<PapelDoSignatario, string | null>();
  for (const s of signers) {
    const papel = papelDe(s.external_id);
    if (papel && s.status === 'signed') assinados.set(papel, typeof s.signed_at === 'string' && s.signed_at ? s.signed_at : null);
  }
  const papelDeQuem = quem ? papelDe(quem.external_id) : null;
  if (papelDeQuem && !assinados.has(papelDeQuem)) assinados.set(papelDeQuem, typeof quem?.signed_at === 'string' ? (quem.signed_at as string) : null);
  return {
    externoId: token,
    todosAssinaram: c.event_type === 'doc_signed' || c.status === 'signed',
    assinados: [...assinados.entries()].map(([papel, em]) => ({ papel, em })),
    pdfUrl: typeof c.signed_file === 'string' && c.signed_file ? c.signed_file : null,
  };
}
