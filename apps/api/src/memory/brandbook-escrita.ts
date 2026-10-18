import { z } from 'zod';
import { BrandbookDocumentoSchema } from '@mktos/shared';

// Capability interna: não participa de DTOs, JSON ou contratos do navegador.
export const ESCRITA_DO_BRANDBOOK = Symbol('escrita do brandbook');
const AtivoSchema = z.object({
  documento: BrandbookDocumentoSchema, aprovadoPor: z.string().uuid(), aprovadoEm: z.string().datetime(), draftHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const BrandbookEnvelopeSchema = z.object({ schemaVersion: z.literal(1), rascunho: BrandbookDocumentoSchema.nullable(), ativo: AtivoSchema.nullable() }).strict();
