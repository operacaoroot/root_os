import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BrandbookDocumentoSchema } from '@mktos/shared';
import { BrandbookService } from '../src/pauta/brandbook.service';
import { conferirUrlDaMarca, pendenciasDaMarca } from '../src/pauta/brandbook-documento';
import { comContexto } from '../src/common/contexto-execucao';
import type { MemoriaService } from '../src/memory/memoria.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import referencia from '../src/pauta/assets/brandbook-root.json';

// Contrato do serviço real; armazenamento em memória não prova PostgreSQL/RLS.
function exemplo() {
  let nota: { id: string; versao: number; body: string; contentHash: string; arquivadoEm: string | null; acessoRestrito: boolean } | null = null;
  let podeLer = true;
  const escrever = (body: string) => { nota = { id: 'livro-qa', versao: (nota?.versao ?? 0) + 1, body, contentHash: createHash('sha256').update(body).digest('hex'), arquivadoEm: null, acessoRestrito: false }; return structuredClone(nota); };
  const memoria = { porChave: async () => nota && structuredClone(nota), criar: async (_org: string, entrada: { body: string }) => escrever(entrada.body), alterar: async (_org: string, _id: string, entrada: { body: string; versaoEsperada: number }) => { if (entrada.versaoEsperada !== nota?.versao) throw new Error('conflito no armazenamento'); return escrever(entrada.body); } } as unknown as MemoriaService;
  const prisma = { contextItem: { findFirst: async () => nota && structuredClone(nota) }, user: { findFirst: async () => podeLer ? { roles: [{ permissions: [{ key: 'pauta.ver' }] }] } : null } } as unknown as PrismaService;
  return { service: new BrandbookService(memoria, prisma), revogar: () => { podeLer = false; }, arquivar: () => { nota!.arquivadoEm = new Date().toISOString(); } };
}
const documento = () => { const d = BrandbookDocumentoSchema.parse(referencia.documento); d.pilares = d.pilares.map(p => ({ ...p, cor: p.cor || '#123456' })); return d; };
describe('BrandbookService: rascunho, aprovação e leitura', () => {
  it('mantém explícitas as pendências da referência original antes de ativar', () => { expect(pendenciasDaMarca(BrandbookDocumentoSchema.parse(referencia.documento))).toContain('Cada pilar precisa de nome em uma linha e cor declarada.'); });
  it('salva, relê, confere e ativa a versão exata; outro rascunho preserva o ativo', async () => {
    const { service } = exemplo(); const d = documento(); expect(pendenciasDaMarca(d)).toEqual([]);
    const salvo = await service.salvar('org-qa', { documento: d, versaoEsperada: null }); expect(salvo.estado).toBe('rascunho'); expect((await service.painel('org-qa')).rascunho).toEqual(d);
    const previa = await service.previa('org-qa', salvo.versao);
    const ativo = await service.ativar('org-qa', '10000000-0000-4000-8000-000000000001', { versaoEsperada: previa.versao, draftHash: previa.draftHash, aprovacao: true }); expect(ativo.estado).toBe('ativo'); expect(ativo.ativo?.documento).toEqual(d);
    const mudado = { ...d, identidade: { ...d.identidade, nome: 'Outra versão de exercício' } };
    const proximo = await service.salvar('org-qa', { documento: mudado, versaoEsperada: ativo.versao }); expect(proximo.ativo?.documento).toEqual(d); expect(proximo.rascunho).toEqual(mudado);
  });
  it('recusa versão antiga e hash errado sem alterar o salvo', async () => {
    const { service } = exemplo(); await service.salvar('org-qa', { documento: documento(), versaoEsperada: null }); const antes = await service.painel('org-qa');
    await expect(service.salvar('org-qa', { documento: documento(), versaoEsperada: null })).rejects.toThrow('mudou desde a leitura');
    await expect(service.ativar('org-qa', '10000000-0000-4000-8000-000000000001', { versaoEsperada: 1, draftHash: '0'.repeat(64), aprovacao: true })).rejects.toThrow('prévia mudou'); expect(await service.painel('org-qa')).toEqual(antes);
  });
  it('lista campos ausentes e impede ativação incompleta', async () => {
    const { service } = exemplo(); await service.salvar('org-qa', { documento: BrandbookDocumentoSchema.parse({}), versaoEsperada: null }); const previa = await service.previa('org-qa', 1); expect(previa.pendencias.length).toBeGreaterThan(0);
    await expect(service.ativar('org-qa', '10000000-0000-4000-8000-000000000001', { versaoEsperada: 1, draftHash: previa.draftHash, aprovacao: true })).rejects.toThrow('Resolva as pendências');
  });
  it('desativa sem apagar rascunho e recusa livro arquivado', async () => {
    const { service, arquivar } = exemplo(); await service.salvar('org-qa', { documento: documento(), versaoEsperada: null }); const p = await service.previa('org-qa', 1);
    await service.ativar('org-qa', '10000000-0000-4000-8000-000000000001', { versaoEsperada: 1, draftHash: p.draftHash, aprovacao: true }); const r = await service.desativar('org-qa', 2); expect(r.ativo).toBeNull(); expect(r.rascunho).toEqual(documento());
    arquivar(); await expect(service.salvar('org-qa', { documento: documento(), versaoEsperada: 3 })).rejects.toThrow('arquivado');
  });
  it('recusa outra empresa e pessoa sem acesso no leitor real', async () => {
    const { service, revogar } = exemplo();
    await expect(comContexto({ orgId: 'outra-org', actorType: 'user', actorId: '10000000-0000-4000-8000-000000000001', origem: 'http', correlationId: 'qa' }, () => service.painel('org-qa'))).rejects.toThrow('outra empresa');
    revogar(); await expect(comContexto({ orgId: 'org-qa', actorType: 'user', actorId: '10000000-0000-4000-8000-000000000001', origem: 'http', correlationId: 'qa' }, () => service.painel('org-qa'))).rejects.toThrow('Acesso insuficiente');
  });
  it('mantém recusas de URL com credenciais e assinatura', () => {
    expect(() => conferirUrlDaMarca('https://example.com/?token=privado')).toThrow('tokens'); expect(() => conferirUrlDaMarca('https://user:pass@example.com')).toThrow('credenciais'); expect(() => conferirUrlDaMarca('file:///etc/passwd')).toThrow('http');
  });
});
