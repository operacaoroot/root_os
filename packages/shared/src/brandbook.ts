import { z } from 'zod';

export const BRANDBOOK_CHAVE = 'pauta.marca.brandbook';
export const BRANDBOOK_LOGO_MAX_CHARS = 24 * 1024;
const texto = (max = 2000) => z.string().trim().max(max).default('');
const lista = (max = 20) => z.array(texto(500)).max(max).default([]);
const cor = z.string().trim().max(7).refine((v) => !v || /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(v), 'Use uma cor hexadecimal, como #9bdb1f.').default('');
const CorSchema = z.object({ papel: texto(60), hex: cor }).strict();
const FonteSchema = z.object({ papel: texto(60), familia: texto(120) }).strict();

/** Campos vazios são permitidos no rascunho; ativação exige uma prévia sem pendências. */
export const BrandbookDocumentoSchema = z.object({
  origem: z.object({
    tipo: z.enum(['do_zero', 'site', 'documento', 'logo']).default('do_zero'),
    url: z.string().trim().max(2048).url().nullable().default(null),
    arquivoNome: z.string().trim().max(250).nullable().default(null),
    texto: texto(16000),
  }).strict().default({}),
  respostas: z.object({
    posicionamento: texto(), clienteIdeal: texto(), dor: texto(), desejo: texto(),
    diferencialPromessa: texto(), tomDeVoz: texto(), corPrimaria: cor,
  }).strict().default({}),
  identidade: z.object({
    nome: texto(200), descricao: texto(2000), assinatura: texto(400), nicho: texto(400), handle: texto(120),
  }).strict().default({}),
  voz: z.object({
    descricao: texto(),
    eixos: z.array(z.object({ de: texto(100), para: texto(100), valor: z.number().min(0).max(100).nullable().default(null) }).strict()).max(12).default([]),
    permitidas: lista(40), evitar: lista(40),
  }).strict().default({}),
  visual: z.object({
    cores: z.array(CorSchema).max(16).default([]), fontes: z.array(FonteSchema).max(8).default([]),
    logoDataUrl: z.string().max(BRANDBOOK_LOGO_MAX_CHARS).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/, 'Use logo PNG, JPG ou WebP.').nullable().default(null),
    regras: texto(4000), texturas: texto(2000), capas: texto(2000),
  }).strict().default({}),
  personas: z.array(z.object({ nome: texto(100), descricao: texto(1200) }).strict()).max(8).default([]),
  pilares: z.array(z.object({ nome: texto(40), cor, descricao: texto(240) }).strict()).max(8).default([]),
  modelos: z.array(z.object({ nome: texto(100), estrutura: texto(2000) }).strict()).max(12).default([]),
  perfilParaPauta: texto(4000),
}).strict().superRefine((d, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(d)).length > 64 * 1024) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'O brandbook excede 64 KB. Reduza os textos ou o logo.' });
});
export type BrandbookDocumento = z.infer<typeof BrandbookDocumentoSchema>;

export const BrandbookVersaoSchema = z.object({ versaoEsperada: z.number().int().positive().nullable() }).strict();
export const BrandbookSalvarSchema = z.object({ versaoEsperada: z.number().int().positive().nullable(), documento: BrandbookDocumentoSchema }).strict();
export const BrandbookAtivarSchema = z.object({
  versaoEsperada: z.number().int().positive().nullable(), draftHash: z.string().regex(/^[a-f0-9]{64}$/), aprovacao: z.literal(true),
}).strict();
export const BrandbookColetarSiteSchema = z.object({ url: z.string().trim().max(2048).url() }).strict();
export type BrandbookSalvarInput = z.infer<typeof BrandbookSalvarSchema>;
export type BrandbookAtivarInput = z.infer<typeof BrandbookAtivarSchema>;

export interface BrandbookAtivo {
  documento: BrandbookDocumento;
  aprovadoPor: string;
  aprovadoEm: string;
  draftHash: string;
}
export interface BrandbookPainel {
  id: string | null;
  versao: number | null;
  hash: string | null;
  estado: 'ausente' | 'rascunho' | 'ativo' | 'arquivado';
  rascunho: BrandbookDocumento | null;
  ativo: BrandbookAtivo | null;
}
export interface BrandbookPrevia {
  versao: number;
  draftHash: string;
  documento: BrandbookDocumento;
  pendencias: string[];
}
export interface BrandbookColeta {
  url: string;
  titulo: string;
  descricao: string;
  texto: string;
  cores: Array<{ papel: string; hex: string }>;
  fontes: Array<{ papel: string; familia: string }>;
  avisos: string[];
}
export interface BrandbookReferenciaRoot {
  documento: BrandbookDocumento;
  fonte: { nome: string; versao: string; hash: string; texto: string };
}
