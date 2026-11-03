/*
 * A PORTA DE ASSINATURA DO COMERCIAL (lane D, 13/10/2026).
 *
 * Mesmo desenho da porta de cobrança: o comercial recebe esta interface por
 * injeção (`PORTA_DE_ASSINATURA`), ligada ao conector da ZapSign na fiação da
 * pasta dele (`comercial/conectores/zapsign.module.ts`). Endereço, token da API
 * e segredo do webhook moram só no conector. Aqui: o contrato e a leitura pura
 * do webhook.
 *
 * O papel de cada signatário viaja como `external_id` do signatário: é por ele
 * que o webhook diz QUEM assinou, sem casar nome nem e-mail. Desde o módulo de
 * contratos (02/11/2026) o formato é `<papel>:<n>` (`cliente:1`, `cliente:2`,
 * `root:1`), para a assinatura conjunta; o formato antigo (`cliente`, `root`)
 * continua valendo, porque há documento aberto na ZapSign com ele.
 *
 * ASSINADO POR PAPEL = TODOS DAQUELE PAPEL ASSINARAM. `assinados` alimenta os
 * fatos `contrato.assinado_cliente` e `_root`, e o fechamento lê esses fatos:
 * com dois administradores do cliente, o primeiro sozinho não é "o cliente
 * assinou". Quem assinou um a um sai em `assinaturas`.
 */

export const PORTA_DE_ASSINATURA = Symbol('PORTA_DE_ASSINATURA');

export type PapelDoSignatario = 'cliente' | 'root';

export interface SignatarioNovo {
  papel: PapelDoSignatario;
  nome: string;
  email: string;
  /** A posição na lista. Sem ela, vale a ordem do array. O envio é em paralelo: a ZapSign não recebe sequência obrigatória. */
  ordem?: number;
}

export interface SignatarioNoProvedor {
  papel: PapelDoSignatario | null;
  token: string;
  link: string | null;
  assinadoEm: string | null;
  /** O `external_id` completo (`cliente:2`). Ausente em documento antigo, em que o papel já diz tudo. */
  externalId?: string;
}

export interface DocumentoNoProvedor {
  externoId: string;
  estado: 'pendente' | 'assinado' | 'outro';
  signatarios: SignatarioNoProvedor[];
  pdfUrl: string | null;
}

/** O conteúdo vai como UM dos dois: markdown (a ZapSign renderiza) ou PDF pronto em base64, sem o prefixo `data:`. */
export type ConteudoDoDocumento = { markdown: string; pdfBase64?: undefined } | { pdfBase64: string; markdown?: undefined };

export type NovoDocumento = ConteudoDoDocumento & {
  nome: string;
  referenciaExterna: string;
  signatarios: SignatarioNovo[];
};

/** Quem assinou, um a um. Só vem em documento com `external_id` novo. */
export interface AssinaturaIndividual {
  externalId: string;
  papel: PapelDoSignatario;
  token: string | null;
  em: string | null;
}

export interface AssinaturaNoWebhook {
  externoId: string;
  todosAssinaram: boolean;
  /** Os PAPÉIS cujos signatários já assinaram todos (o corpo traz a lista inteira). */
  assinados: { papel: PapelDoSignatario; em: string | null }[];
  pdfUrl: string | null;
  /** Quem assinou pelo `external_id` completo (`cliente:2`). Ausente quando o documento é do formato antigo. */
  assinaturas?: AssinaturaIndividual[];
}

/** O que `cancelar` responde. `jaNaoExistia`: o provedor respondeu 404, e o resultado é o mesmo. */
export interface DocumentoCancelado {
  externoId: string;
  jaNaoExistia: boolean;
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
  /**
   * Módulo de contratos (F3): tira o documento do provedor. Na ZapSign é `DELETE /docs/{token}/`, e o
   * link de assinatura deixa de valer. Quem chama confere antes que o documento não está todo assinado.
   * Opcional: o dublê da suíte vive sem.
   */
  cancelar?(externoId: string): Promise<DocumentoCancelado>;
  /**
   * Módulo de contratos (F3): os links ATUAIS de cada signatário, para mandar de novo. A ZapSign NÃO
   * reenvia e-mail aqui: o documento nasce com `disable_signer_emails: true` (quem fala com o cliente
   * é o WhatsApp da Root, pela M7). Reenviar é entregar de novo o mesmo link. `null` = o provedor não acha o documento.
   */
  reenviar?(externoId: string): Promise<DocumentoNoProvedor | null>;
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

/** Lê o `external_id`: `cliente:2`, `root:1` ou o formato antigo (`cliente`, `root`). */
export function lerExternalId(v: unknown): { papel: PapelDoSignatario; n: number | null } | null {
  if (v === 'cliente' || v === 'root') return { papel: v, n: null };
  if (typeof v !== 'string') return null;
  const m = /^(cliente|root):([1-9]\d{0,2})$/.exec(v);
  return m ? { papel: m[1] as PapelDoSignatario, n: Number(m[2]) } : null;
}

export function papelDe(v: unknown): PapelDoSignatario | null {
  return lerExternalId(v)?.papel ?? null;
}

/** A lista na ordem de assinar, com o `external_id` de cada um (`n` contado dentro do papel). */
export function signatariosComExternalId<T extends SignatarioNovo>(lista: readonly T[]): (T & { externalId: string })[] {
  const ordenada = lista.map((s, i) => ({ s, ordem: s.ordem ?? i + 1, i })).sort((a, b) => a.ordem - b.ordem || a.i - b.i);
  const contagem: Record<PapelDoSignatario, number> = { cliente: 0, root: 0 };
  return ordenada.map(({ s }) => {
    contagem[s.papel] += 1;
    return { ...s, externalId: `${s.papel}:${contagem[s.papel]}` };
  });
}

/** O base64 do PDF sem o prefixo `data:`: a ZapSign recusa com ele. Só base64 válido passa. */
export function base64DoPdf(bruto: string): string {
  const limpo = bruto.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!limpo || !/^[A-Za-z0-9+/]+={0,2}$/.test(limpo)) throw new Error('o PDF do contrato não é base64 válido: nada foi enviado');
  return limpo;
}

/** Um documento da ZapSign (API v1) no vocabulário do comercial. */
export function documentoDaZapsign(d: P): DocumentoNoProvedor {
  const signers = Array.isArray(d.signers) ? (d.signers as P[]) : [];
  const status = String(d.status ?? '');
  return {
    externoId: String(d.token ?? ''),
    estado: status === 'signed' ? 'assinado' : status === 'pending' ? 'pendente' : 'outro',
    signatarios: signers.map((s) => {
      const id = lerExternalId(s.external_id);
      return {
        papel: id?.papel ?? null,
        token: String(s.token ?? ''),
        link: typeof s.sign_url === 'string' ? s.sign_url : null,
        // Assinado sem data no corpo vira '' (assinado, hora desconhecida), nunca `null` (que quer dizer "não assinou").
        assinadoEm: s.status === 'signed' ? (typeof s.signed_at === 'string' ? s.signed_at : '') : null,
        ...(id?.n ? { externalId: String(s.external_id) } : {}),
      };
    }),
    pdfUrl: typeof d.signed_file === 'string' && d.signed_file ? d.signed_file : null,
  };
}

interface SignatarioLido {
  externalId: string;
  papel: PapelDoSignatario;
  novo: boolean;
  token: string | null;
  assinou: boolean;
  em: string | null;
}

/** O mais novo entre dois instantes ISO, com o nulo (hora desconhecida) perdendo. */
function maisNovo(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** Papel assinado = todos os signatários dele assinaram. A hora é a da última assinatura do papel. */
function papeisAssinados(lidos: readonly SignatarioLido[]): { papel: PapelDoSignatario; em: string | null }[] {
  const papeis = new Map<PapelDoSignatario, { todos: boolean; em: string | null }>();
  for (const l of lidos) {
    const atual = papeis.get(l.papel) ?? { todos: true, em: null };
    papeis.set(l.papel, { todos: atual.todos && l.assinou, em: l.assinou ? maisNovo(atual.em, l.em) : atual.em });
  }
  return [...papeis.entries()].filter(([, v]) => v.todos).map(([papel, v]) => ({ papel, em: v.em }));
}

function individuais(lidos: readonly SignatarioLido[]): { assinaturas?: AssinaturaIndividual[] } {
  if (!lidos.some((l) => l.novo)) return {};
  return {
    assinaturas: lidos.filter((l) => l.assinou).map((l) => ({ externalId: l.externalId, papel: l.papel, token: l.token, em: l.em })),
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
  const lidos = new Map<string, SignatarioLido>();
  const ler = (s: P, assinou: boolean): void => {
    const id = lerExternalId(s.external_id);
    if (!id) return;
    const externalId = String(s.external_id);
    const em = assinou && typeof s.signed_at === 'string' && s.signed_at ? s.signed_at : null;
    const antes = lidos.get(externalId);
    lidos.set(externalId, {
      externalId,
      papel: id.papel,
      novo: id.n !== null,
      token: typeof s.token === 'string' && s.token ? s.token : antes?.token ?? null,
      assinou: assinou || antes?.assinou === true,
      em: em ?? antes?.em ?? null,
    });
  };
  for (const s of signers) ler(s, s.status === 'signed');
  const quem = (c.signer_who_signed ?? null) as P | null;
  if (quem) ler(quem, true);
  const lista = [...lidos.values()];
  return {
    externoId: token,
    todosAssinaram: c.event_type === 'doc_signed' || c.status === 'signed',
    assinados: papeisAssinados(lista),
    pdfUrl: typeof c.signed_file === 'string' && c.signed_file ? c.signed_file : null,
    ...individuais(lista),
  };
}

/**
 * O estado consultado no provedor, no vocabulário do webhook: a conferência (botão, lote e relógio)
 * grava pelo MESMO caminho (`DinheiroService.aplicarAssinatura`), sem segunda regra de quem assinou.
 */
export function assinaturaDoEstado(d: DocumentoNoProvedor): AssinaturaNoWebhook {
  const lidos: SignatarioLido[] = d.signatarios.flatMap((s) =>
    s.papel
      ? [{
          externalId: s.externalId ?? s.papel,
          papel: s.papel,
          novo: Boolean(s.externalId),
          token: s.token || null,
          assinou: s.assinadoEm !== null,
          em: s.assinadoEm || null,
        }]
      : [],
  );
  return {
    externoId: d.externoId,
    todosAssinaram: d.estado === 'assinado',
    assinados: papeisAssinados(lidos),
    pdfUrl: d.pdfUrl,
    ...individuais(lidos),
  };
}
