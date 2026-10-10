import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { z } from 'zod';
import { DemonstracaoSinteticaManifestoSchema, DemonstracaoSinteticaFontesSchema,
  type DemonstracaoSinteticaManifesto, type DemonstracaoSinteticaFontes } from '@mktos/shared';

export const MANIFESTO_SHA = '849ce9358e26ac6cd0be5a7189bc563e09291b473476fc6f8784b3016dbb6843';
export const ORG_ID = '7e4d6720-3a23-4933-9eef-ace27773c52b';
export const ACTOR_ID = '1803d3c5-bbc4-4140-90d9-fdc35c156ac8';
export class DemoError extends Error {
  constructor(readonly code: string) { super(code); }
}
export function exigir(condicao: unknown, code: string): asserts condicao {
  if (!condicao) throw new DemoError(code);
}
export const sha256 = (valor: string | Buffer) => createHash('sha256').update(valor).digest('hex');
export function canonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') {
    const text = JSON.stringify(valor); exigir(text !== undefined, 'demo_json_invalido'); return text;
  }
  if (Array.isArray(valor)) return '[' + valor.map(canonico).join(',') + ']';
  const obj = valor as Record<string, unknown>;
  return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + canonico(obj[k])).join(',') + '}';
}
export const hashCanonico = (valor: unknown) => sha256(canonico(valor));
export function lerDocumento(path: string, esperado?: string): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    exigir(stat.isFile() && stat.size <= 65536 && (stat.mode & 0o022) === 0, 'demo_arquivo_invalido');
    const buffer = Buffer.alloc(65537);
    let bytes = 0;
    while (bytes < buffer.length) {
      const n = readSync(fd, buffer, bytes, buffer.length - bytes, bytes);
      if (!n) break; bytes += n;
    }
    exigir(bytes <= 65536 && bytes === stat.size, 'demo_arquivo_alterado');
    const data = buffer.subarray(0, bytes);
    if (esperado) exigir(sha256(data) === esperado, 'demo_hash_documento_divergente');
    const texto = data.toString('utf8');
    exigir(Buffer.from(texto).equals(data), 'demo_utf8_invalido');
    return JSON.parse(texto);
  } finally { closeSync(fd); }
}
export function lerManifesto(path: string): DemonstracaoSinteticaManifesto {
  const m = DemonstracaoSinteticaManifestoSchema.parse(lerDocumento(path, MANIFESTO_SHA));
  exigir(m.orgId === ORG_ID && m.actorId === ACTOR_ID, 'demo_escopo_divergente'); return m;
}
export function lerFontes(path: string): DemonstracaoSinteticaFontes {
  return DemonstracaoSinteticaFontesSchema.parse(lerDocumento(path));
}
const texto = z.string().min(1).max(500);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const recurso = z.object({ id: sha, image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  created: z.string().datetime(), startedAt: z.string().datetime(), hostname: texto,
  project: texto, workingDir: texto, command: z.array(texto).min(1).max(30),
  networks: z.array(texto).min(1).max(10), ports: z.array(texto).max(10),
  mounts: z.array(z.object({ type: texto, source: texto, destination: texto, readOnly: z.boolean() }).strict()).max(15),
}).strict();
export const DestinoDemoSchema = z.object({ schemaVersion: z.literal(1), orgId: z.string().uuid(), actorId: z.string().uuid(),
  api: recurso, db: recurso, database: z.object({ name: texto, user: texto, schema: z.literal('public') }).strict(),
  resourcesSignatureHash: sha,
}).strict();
export type DestinoDemo = z.infer<typeof DestinoDemoSchema>;
export function lerDestino(path: string, esperado: string): DestinoDemo {
  exigir(sha.safeParse(esperado).success, 'demo_pin_destino_obrigatorio');
  const d = DestinoDemoSchema.parse(lerDocumento(path, esperado));
  exigir(d.orgId === ORG_ID && d.actorId === ACTOR_ID && d.api.project === d.db.project
    && d.api.workingDir === d.db.workingDir && !!process.env.HOSTNAME
    && process.env.HOSTNAME === d.api.hostname, 'demo_destino_divergente');
  exigir(hashCanonico({ api: d.api, db: d.db, database: d.database }) === d.resourcesSignatureHash,
    'demo_assinatura_destino_divergente');
  return d;
}
export function sourceHash(fontes: DemonstracaoSinteticaFontes): string {
  const { mountSignatureHash: _provaEfemera, ...estavel } = fontes;
  return hashCanonico({ ...estavel, bindings: [...estavel.bindings].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) });
}
export function inputFingerprint(m: DemonstracaoSinteticaManifesto, origemHash: string): string {
  return hashCanonico({ schemaVersion: 1, orgId: m.orgId, actorId: m.actorId, dataset: m.dataset,
    requestId: m.requestId, manifestHash: MANIFESTO_SHA, sourceHash: origemHash });
}
export function idInterno(m: DemonstracaoSinteticaManifesto, key: string): string {
  const bytes = createHash('sha256').update([m.namespace, m.dataset, m.orgId, m.actorId, key].join('\0')).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const h = bytes.toString('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
