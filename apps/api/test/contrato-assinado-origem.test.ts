import { describe, expect, it, vi } from 'vitest';
import { AssinadoNaPastaService } from '../src/comercial/assinado-na-pasta.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import type { PortaDeAssinatura } from '../src/comercial/portas/assinatura.port';

describe('PDF assinado: conferir a fonte antes do download', () => {
  for (const caso of [
    { nome: 'ID externo de outro documento', externo: 'documento-B', alteracao: {} },
    { nome: 'assinatura da Root ausente', externo: 'documento-A', alteracao: { assinadoRootEm: null } },
    { nome: 'provedor divergente', externo: 'documento-A', alteracao: { provedor: 'outro' } },
  ]) it(caso.nome, async () => {
    const doc = { id: 'doc-A', orgId: 'org-A', leadId: 'lead-A', externoId: 'documento-A', provedor: 'zapsign', estado: 'assinado', assinadoRootEm: new Date(), assinadoClienteEm: new Date(), ...caso.alteracao };
    const prisma = { comercialDocumento: { findFirst: vi.fn().mockResolvedValue(doc) }, comercialFicha: { findFirst: vi.fn().mockResolvedValue({ partnerId: 'cliente-A' }) }, lead: { findFirst: vi.fn().mockResolvedValue({ name: 'Cliente A' }) } } as unknown as PrismaService;
    const baixar = vi.fn().mockResolvedValue({ buffer: Buffer.from('%PDF-1.7 teste'), tipoMime: 'application/pdf' });
    const arquivar = vi.fn().mockResolvedValue({ estado: 'na_fila', motivo: 'aguarda pasta' });
    const servico = new AssinadoNaPastaService(prisma, { registrar: vi.fn().mockResolvedValue({}) } as unknown as FioService, {} as ReacoesRegistry, { provedor: 'zapsign', baixarAssinado: baixar } as unknown as PortaDeAssinatura, { arquivar });
    const resultado = await servico.copiar('org-A', 'lead-A', 'doc-A', caso.externo);
    expect(baixar).not.toHaveBeenCalled();
    expect(arquivar).not.toHaveBeenCalled();
    expect(resultado.estado).toBe('erro');
  });
});
