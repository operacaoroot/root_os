import { z } from 'zod';

const uuid = z.string().uuid().transform((v) => v.toLowerCase());
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const git = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const texto = (max: number) => z.string().min(1).max(max);
const keys = ['nota-aviso', 'nota-conteudo', 'nota-financeiro', 'espaco', 'lista', 'tarefa', 'agente',
  'material', 'oportunidade', 'conta', 'classificacao', 'contraparte', 'contrato'] as const;
const key = z.enum(keys);
const limitada = <T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T, z.output<T>, z.input<T>> => schema.superRefine((v, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(v)).length > 65536)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'O documento excede 64 KiB.' });
});
const asset = z.object({ key: z.enum(['nota-aviso', 'nota-conteudo', 'nota-financeiro']),
  path: texto(100), sha256: sha, bytes: z.number().int().positive().max(4096) }).strict();
const object = z.object({ key, logicalId: uuid, requestId: uuid.nullable() }).strict();

export const DemonstracaoSinteticaManifestoSchema = limitada(z.object({
  schemaVersion: z.literal(1), dataset: z.literal('rootos-v2-demo-2026-10-v1'), namespace: uuid,
  orgId: uuid, actorId: uuid, requestId: uuid,
  assets: z.array(asset).length(3), objects: z.array(object).length(13),
  contractStart: z.literal('2026-10-01T12:00:00.000Z'),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.objects.map((o) => o.key)).size !== keys.length
    || new Set(v.objects.map((o) => o.logicalId)).size !== keys.length
    || new Set(v.assets.map((a) => a.key)).size !== 3
    || new Set(v.assets.map((a) => a.path)).size !== 3)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'O conjunto sintético contém identidades repetidas.' });
}));
export type DemonstracaoSinteticaManifesto = z.infer<typeof DemonstracaoSinteticaManifestoSchema>;

const binding = z.object({
  key: z.enum(['nota-aviso', 'nota-conteudo', 'nota-financeiro']), path: texto(100),
  hashArquivo: sha, blobGit: git, metadataHash: sha, memberId: uuid,
  notaId: uuid, itemId: uuid, versionId: uuid,
  versao: z.number().int().positive(), expectedItemVersion: z.number().int().positive(), contentHash: sha,
}).strict();
export const DemonstracaoSinteticaFontesSchema = limitada(z.object({
  schemaVersion: z.literal(1), orgId: uuid, dataset: z.literal('rootos-v2-demo-2026-10-v1'),
  gitCommit: git, assetManifestHash: sha, mountSignatureHash: sha,
  selectionId: uuid, collectionId: texto(200), generation: z.string().regex(/^[1-9][0-9]{0,18}$/),
  membershipDigest: sha, bindings: z.array(binding).length(3),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.bindings.map((b) => b.key)).size !== 3
    || new Set(v.bindings.map((b) => b.itemId)).size !== 3
    || new Set(v.bindings.map((b) => b.memberId)).size !== 3)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A captura contém associações repetidas.' });
}));
export type DemonstracaoSinteticaFontes = z.infer<typeof DemonstracaoSinteticaFontesSchema>;

const receiptObject = z.object({
  key, logicalId: uuid, databaseId: uuid,
  table: z.enum(['ContextItem', 'WorkSpace', 'WorkList', 'WorkTask', 'Agent', 'EditorialMaterial',
    'Lead', 'FinanceAccount', 'ChartAccount', 'Partner', 'Contract']),
  related: z.record(uuid).refine((r) => Object.keys(r).length <= 10),
  snapshot: z.object({ versao: z.number().int().positive().nullable(), contentHash: sha.nullable() }).strict(),
}).strict();
const effects = z.object({ modelo: z.literal(false), cron: z.literal(false), provider: z.literal(false),
  publicacao: z.literal(false), cobranca: z.literal(false), aprovacao: z.literal(false), F08gerado: z.literal(false) }).strict();
export const DemonstracaoSinteticaReciboSchema = limitada(z.object({
  schemaVersion: z.literal(1), tipo: z.literal('demo_installation_v1'), sintetico: z.literal(true),
  installationId: uuid, orgId: uuid, actorId: uuid, dataset: z.literal('rootos-v2-demo-2026-10-v1'), requestId: uuid,
  manifestHash: sha, sourceHash: sha, inputFingerprint: sha, destinationSignatureHashDaCriacao: sha,
  createdAt: z.string().datetime(), selectionId: uuid, sourceBindings: DemonstracaoSinteticaFontesSchema,
  objects: z.array(receiptObject).length(13), auditIds: z.array(uuid).max(30), effects,
}).strict().superRefine((v, ctx) => {
  if (new Set(v.objects.map((o) => o.key)).size !== keys.length
    || v.sourceBindings.orgId !== v.orgId || v.sourceBindings.dataset !== v.dataset
    || v.sourceBindings.selectionId !== v.selectionId)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'O recibo não corresponde ao conjunto sintético.' });
}));
export type DemonstracaoSinteticaRecibo = z.infer<typeof DemonstracaoSinteticaReciboSchema>;
const availability = z.object({ key, disponivel: z.boolean() }).strict();
export const DemonstracaoSinteticaResultadoSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('confirmado'), recibo: DemonstracaoSinteticaReciboSchema,
    replayed: z.boolean(), disponibilidadeAtual: z.array(availability).length(13) }).strict(),
  z.object({ tipo: z.literal('ausencia_conferida'), orgId: uuid, actorId: uuid,
    dataset: z.literal('rootos-v2-demo-2026-10-v1'), requestId: uuid }).strict(),
]);
export type DemonstracaoSinteticaResultado = z.infer<typeof DemonstracaoSinteticaResultadoSchema>;
