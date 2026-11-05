import { createHash } from 'node:crypto';
import type { ModuleRef } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import type { OrigemArquivoClienteService } from '../src/clientes-escopo/origem-arquivo-cliente.service';
import { ARQUIVISTA_DO_CLIENTE } from '../src/clientes/portas';
import type { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { SalaService } from '../src/comercial/sala.service';
import { hashDoTokenDaSala } from '../src/comercial/sala-token';
import { TriagemDoWhatsappService } from '../src/comercial/triagem-do-whatsapp/triagem-do-whatsapp.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';

const ORG = 'empresa-teste';
const LEAD = 'lead-confirmado';
const CLIENTE = 'cliente-confirmado';
const RECIBO = { id: 'origem-confirmada', leadId: LEAD, partnerId: CLIENTE, atorId: null };
const buffer = Buffer.from('%PDF-1.7 teste');
const sha256 = createHash('sha256').update(buffer).digest('hex');
const tipoMime = 'application/pdf';
const conteudo = { chave: `clientes/arquivos/${ORG}/${sha256}`, sha256, bytes: buffer.length, tipoMime };
const conteudoSala = { ...conteudo, chave: `comercial/sala/sala-teste/${sha256}` };
const arquivo = { buffer, originalname: 'arquivo.pdf', mimetype: tipoMime, size: buffer.length };

function montarSala() {
  const token = 'token-ficticio';
  const registrar = vi.fn(async () => ({}));
  const fio = { registrar } as unknown as FioService;
  const put = vi.fn(async () => {});
  const arquivar = vi.fn().mockResolvedValue({ estado: 'na_fila', motivo: 'aguarda pasta' });
  const moduleRef = {
    get: (tipo: unknown) => tipo === StorageService ? { put } : tipo === ARQUIVISTA_DO_CLIENTE ? { arquivar } : null,
  } as ModuleRef;
  const origem = {
    registrarSala: vi.fn().mockResolvedValue(RECIBO),
    exigir: vi.fn().mockResolvedValue(RECIBO),
  };
  const sala = new SalaService({} as PrismaService, fio, {} as ReacoesRegistry, moduleRef, origem as unknown as OrigemArquivoClienteService);
  vi.spyOn(sala, 'resolver').mockResolvedValue({ orgId: ORG, leadId: LEAD, salaId: 'sala-teste' });
  vi.spyOn(sala as unknown as { projetar: () => Promise<unknown> }, 'projetar').mockResolvedValue({ slug: 'sala-teste' });
  return { sala, token, origem, put, registrar, arquivar };
}

function montarWhatsapp() {
  const prisma = {
    pendencia: { findUnique: vi.fn().mockResolvedValue(null) },
    leadEvent: { findFirst: vi.fn().mockResolvedValue(null) },
    comercialFicha: { findFirst: vi.fn().mockResolvedValue({ partnerId: 'cliente-da-entrada' }) },
    partner: { findFirst: vi.fn().mockResolvedValue({ id: 'cliente-pelo-telefone' }) },
  };
  const registrar = vi.fn(async () => ({}));
  const arquivar = vi.fn().mockResolvedValue({ estado: 'na_fila', motivo: 'aguarda pasta' });
  const origem = { registrarWhatsapp: vi.fn().mockResolvedValue(RECIBO) };
  const triagem = new TriagemDoWhatsappService(
    prisma as unknown as PrismaService, { registrar } as unknown as FioService,
    {} as never, {} as never, {} as never, {} as never, undefined, { arquivar }, origem as unknown as OrigemArquivoClienteService,
  );
  const mensagem = { telefone: '553297770001', leadId: 'lead-da-entrada', texto: null, nome: null,
    mensagemId: 'mensagem-real', documento: { nome: 'arquivo.pdf', mime: tipoMime, base64: buffer.toString('base64'), instancia: 'instancia-configurada' } };
  return { triagem, mensagem, origem, arquivar, prisma };
}

describe('origem dos arquivos produzidos pela sala pública', () => {
  it('valida a sala antes de gravar e revalida antes de arquivar', async () => {
    const m = montarSala();
    await m.sala.arquivo(m.token, arquivo);
    expect(m.origem.registrarSala).toHaveBeenCalledWith({ orgId: ORG, salaId: 'sala-teste', tokenHash: hashDoTokenDaSala(m.token), conteudo: conteudoSala });
    expect(m.put).toHaveBeenCalledWith(conteudoSala.chave, buffer, tipoMime);
    expect(m.origem.registrarSala.mock.invocationCallOrder[0]).toBeLessThan(m.put.mock.invocationCallOrder[0]);
    expect(m.origem.exigir.mock.invocationCallOrder[0]).toBeGreaterThan(m.put.mock.invocationCallOrder[0]);
    expect(m.arquivar).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG, leadId: LEAD, partnerId: CLIENTE, origem: 'sala', origemRecebidaId: RECIBO.id,
      ref: { tipo: 'OrigemArquivoCliente', id: RECIBO.id },
    }));
  });

  it('se a sala for revogada durante a escrita, conserva o arquivo no OS e registra o estado da cópia', async () => {
    const m = montarSala();
    m.origem.exigir.mockRejectedValue(new Error('Origem revogada.'));
    await expect(m.sala.arquivo(m.token, arquivo)).resolves.toMatchObject({ slug: 'sala-teste' });
    expect(m.put).toHaveBeenCalledTimes(1);
    expect(m.arquivar).not.toHaveBeenCalled();
    expect(m.registrar).toHaveBeenCalledWith(ORG, LEAD, 'documento.na_pasta', expect.any(String), expect.objectContaining({ estado: 'erro' }));
  });

  it('se a primeira validação negar, não grava o arquivo', async () => {
    const m = montarSala();
    m.origem.registrarSala.mockRejectedValue(new Error('Origem revogada.'));
    await expect(m.sala.arquivo(m.token, arquivo)).rejects.toThrow();
    expect(m.put).not.toHaveBeenCalled();
    expect(m.arquivar).not.toHaveBeenCalled();
  });
});

describe('origem dos arquivos recebidos pelo WhatsApp', () => {
  it('usa o recibo da mensagem real para escolher o lead e o cliente', async () => {
    const m = montarWhatsapp();
    await expect(m.triagem.triar(ORG, m.mensagem)).resolves.toContain('arquivista: na_fila');
    expect(m.origem.registrarWhatsapp).toHaveBeenCalledWith({
      orgId: ORG, instancia: 'instancia-configurada', mensagemExternaId: 'mensagem-real',
      remetenteNumero: m.mensagem.telefone, conteudo,
    });
    expect(m.arquivar).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG, leadId: LEAD, partnerId: CLIENTE, origem: 'whatsapp', origemRecebidaId: RECIBO.id,
      ref: { tipo: 'OrigemArquivoCliente', id: RECIBO.id },
    }));
    expect(m.prisma.comercialFicha.findFirst).not.toHaveBeenCalled();
    expect(m.prisma.partner.findFirst).not.toHaveBeenCalled();
  });

  it.each(['sem mensagem externa', 'sem instância'] as const)('recusa documento %s antes do arquivista', async (caso) => {
    const m = montarWhatsapp();
    const mensagem = caso === 'sem mensagem externa' ? { ...m.mensagem, mensagemId: null }
      : { ...m.mensagem, documento: { ...m.mensagem.documento, instancia: '' } };
    await m.triagem.triar(ORG, mensagem);
    expect(m.arquivar).not.toHaveBeenCalled();
  });

  it('deixa a reentrega tentar novamente se o arquivista devolver erro', async () => {
    const m = montarWhatsapp();
    m.arquivar.mockResolvedValueOnce({ estado: 'erro', motivo: 'storage indisponível' });
    expect(await m.triagem.triar(ORG, m.mensagem)).toContain('erro');
    expect(await m.triagem.triar(ORG, m.mensagem)).toContain('arquivista: na_fila');
    expect(m.arquivar).toHaveBeenCalledTimes(2);
  });
});
