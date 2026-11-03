import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as criarNet } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Controller, Get, Param, type INestApplication } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { classificar } from '@mktos/policy';
import { ContratoFilhoSchema, ContratoReabrirSchema, DIAS_PARA_RENOVAR, acaoDoMovimento, diasAteOFim, etapaDoContrato } from '@mktos/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PermissionsGuard } from '../src/auth/permissions.guard';
import { ComercialModule } from '../src/comercial/comercial.module';
import { ZapsignService } from '../src/comercial/conectores/zapsign.service';
import { EFEITO_DE_ENCERRAR_CONTRATO } from '../src/comercial/contrato-vivo.service';
import { ContratosController } from '../src/comercial/contratos/contratos.controller';
import { ContratosService } from '../src/comercial/contratos/contratos.service';
import {
  FRASE_DO_IMPORTADO_NO_LOTE,
  assinaturasDoCartao,
  avisoDoFantasma,
  cartaoDoImportado,
  casarAssinaturas,
  chaveDoEncerramento,
  clienteDesativado,
  estadoDepoisDaAssinatura,
  estadoDoDocumento,
  faltaParaEnviar,
  fimVigente,
  idDoContratoDoDocumento,
  lerIdDoContrato,
  montarQuadro,
  motivoParaNaoAbrirFilho,
  motivoParaNaoCancelar,
  motivoParaNaoEditar,
  motivoParaNaoEncerrar,
  motivoParaNaoMexerNosSignatarios,
  motivoParaNaoReabrir,
  motivoParaNaoReenviar,
  type InsumosDoQuadro,
  type LeadParaOQuadro,
  type RegistroParaOQuadro,
} from '../src/comercial/contratos/contratos-puro';
import { DinheiroController } from '../src/comercial/dinheiro.controller';
import { assinaturaDoEstado, base64DoPdf, documentoDaZapsign, lerExternalId, lerWebhookDaZapsign, papelDe, signatariosComExternalId } from '../src/comercial/portas/assinatura.port';

/*
 * O MÓDULO DE CONTRATOS, A PARTE QUE RODA SEM BANCO (02/11/2026).
 *
 *   1. As etapas do quadro e o arrasto (shared): arrastar nunca marca assinado.
 *   2. O fantasma, o importado derivado do fio e o quadro inteiro.
 *   3. `external_id` novo e antigo, assinatura conjunta e o webhook com vários signatários.
 *   4. O adaptador contra o dublê da ZapSign de verdade (`homolog/mocks/zapsign`), subido por `child_process`:
 *      `base64_pdf`, signatários múltiplos, DELETE e o 404 do segundo DELETE.
 *   5. `GET comercial/contratos/quadro` não cai no `GET contratos/:leadId`, com os controllers de verdade.
 *   6. A migration: o backfill e o id em SQL são a mesma conta do código.
 */

const HOJE = '2026-11-02';

describe('as etapas do quadro', () => {
  const etapa = (estado: Parameters<typeof etapaDoContrato>[0]['estado'], extra: Partial<Parameters<typeof etapaDoContrato>[0]> = {}) =>
    etapaDoContrato({ estado, vigenciaFim: null, clienteDesativado: false, hoje: HOJE, ...extra });

  it('cada estado fica na sua coluna; sem vigência, nunca Renovar', () => {
    expect(etapa('a_emitir')).toBe('a_emitir');
    expect(etapa('rascunho')).toBe('minuta');
    expect(etapa('em_assinatura')).toBe('em_assinatura');
    expect(etapa('assinado')).toBe('ativo');
    expect(etapa('ativo')).toBe('ativo');
    expect(etapa('encerrado')).toBe('encerrado');
    expect(etapa('cancelado')).toBe('encerrado');
  });

  it('Renovar a 60 dias do fim, ou já vencido; A encerrar vem antes', () => {
    expect(DIAS_PARA_RENOVAR).toBe(60);
    expect(diasAteOFim('2027-01-01', HOJE)).toBe(60);
    expect(etapa('ativo', { vigenciaFim: '2027-01-01' })).toBe('renovar');
    expect(etapa('ativo', { vigenciaFim: '2027-01-02' })).toBe('ativo');
    expect(etapa('ativo', { vigenciaFim: '2026-10-01' })).toBe('renovar');
    expect(etapa('ativo', { vigenciaFim: '2026-10-01', clienteDesativado: true })).toBe('a_encerrar');
  });

  it('arrastar não inventa assinatura: em assinatura não vai a ativo, e o fantasma só vai a minuta', () => {
    expect(acaoDoMovimento({ fantasma: false, etapa: 'em_assinatura' }, 'ativo')).toBeNull();
    expect(acaoDoMovimento({ fantasma: true, etapa: 'a_emitir' }, 'minuta')).toBe('gerar_minuta');
    expect(acaoDoMovimento({ fantasma: true, etapa: 'a_emitir' }, 'encerrado')).toBeNull();
    expect(acaoDoMovimento({ fantasma: false, etapa: 'ativo' }, 'encerrado')).toBe('encerrar');
    expect(acaoDoMovimento({ fantasma: false, etapa: 'encerrado' }, 'ativo')).toBe('reabrir');
  });
});

describe('os ids e o estado', () => {
  it('lê os três formatos do id do quadro', () => {
    expect(lerIdDoContrato('abc')).toEqual({ tipo: 'registro', id: 'abc' });
    expect(lerIdDoContrato('importado:lead-1')).toEqual({ tipo: 'importado', leadId: 'lead-1' });
    expect(lerIdDoContrato('sem-contrato:lead-2')).toEqual({ tipo: 'fantasma', leadId: 'lead-2' });
  });

  it('o id do contrato do documento é determinístico e tem formato de uuid', () => {
    const a = idDoContratoDoDocumento('doc-1');
    expect(a).toBe(idDoContratoDoDocumento('doc-1'));
    expect(a).not.toBe(idDoContratoDoDocumento('doc-2'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('o estado do documento segue a mesma regra do backfill', () => {
    expect(estadoDoDocumento('enviado', false)).toBe('em_assinatura');
    expect(estadoDoDocumento('assinado_parcial', true)).toBe('em_assinatura');
    expect(estadoDoDocumento('assinado', false)).toBe('assinado');
    expect(estadoDoDocumento('assinado', true)).toBe('ativo');
  });

  it('a assinatura nunca desce o estado, e o parcial não assina', () => {
    expect(estadoDepoisDaAssinatura('em_assinatura', false, false)).toBe('em_assinatura');
    expect(estadoDepoisDaAssinatura('em_assinatura', true, false)).toBe('assinado');
    expect(estadoDepoisDaAssinatura('em_assinatura', true, true)).toBe('ativo');
    expect(estadoDepoisDaAssinatura('cancelado', true, true)).toBe('cancelado');
    expect(estadoDepoisDaAssinatura('encerrado', true, true)).toBe('encerrado');
    expect(estadoDepoisDaAssinatura('ativo', false, false)).toBe('ativo');
  });

  it('os atos internos são R0 pela escada', () => {
    expect(classificar(EFEITO_DE_ENCERRAR_CONTRATO)).toBe('R0');
  });
});

describe('o que recusa cada ato', () => {
  it('signatários e campos do documento só antes de enviar; número e vigência valem depois', () => {
    expect(motivoParaNaoMexerNosSignatarios('a_emitir')).toBeNull();
    expect(motivoParaNaoMexerNosSignatarios('rascunho')).toBeNull();
    expect(motivoParaNaoMexerNosSignatarios('em_assinatura')).toMatch(/antes de o contrato ir/);
    expect(motivoParaNaoEditar('a_emitir', ['faturaPor'])).toBeNull();
    expect(motivoParaNaoEditar('em_assinatura', ['faturaPor'])).toMatch(/não mudam/);
    expect(motivoParaNaoEditar('ativo', ['vigenciaFim', 'numero'])).toBeNull();
    expect(motivoParaNaoEditar('encerrado', ['numero'])).toMatch(/reabra/);
  });

  it('encerrar só assinado; reabrir só encerrado, nunca cancelado', () => {
    expect(motivoParaNaoEncerrar('ativo', 'contrato')).toBeNull();
    expect(motivoParaNaoEncerrar('assinado', 'contrato')).toBeNull();
    expect(motivoParaNaoEncerrar('em_assinatura', 'contrato')).toMatch(/cancele/);
    expect(motivoParaNaoEncerrar('ativo', 'aditivo')).toMatch(/cancele o rascunho/);
    expect(motivoParaNaoReabrir('encerrado')).toBeNull();
    expect(motivoParaNaoReabrir('cancelado')).toMatch(/não reabre/);
    expect(motivoParaNaoReabrir('ativo')).toMatch(/Só contrato encerrado/);
  });

  it('cancelar só antes da assinatura de todos; reenviar só em assinatura com documento', () => {
    for (const e of ['a_emitir', 'rascunho', 'em_assinatura']) expect(motivoParaNaoCancelar(e), e).toBeNull();
    expect(motivoParaNaoCancelar('ativo')).toMatch(/não se cancela/);
    expect(motivoParaNaoCancelar('assinado')).toMatch(/não se cancela/);
    expect(motivoParaNaoReenviar('em_assinatura', 'doc')).toBeNull();
    expect(motivoParaNaoReenviar('em_assinatura', null)).toMatch(/Só contrato em assinatura/);
    expect(motivoParaNaoReenviar('rascunho', 'doc')).toMatch(/Só contrato em assinatura/);
  });

  it('aditivo e distrato só sobre contrato ativo', () => {
    expect(motivoParaNaoAbrirFilho({ tipo: 'contrato', estado: 'ativo' })).toBeNull();
    expect(motivoParaNaoAbrirFilho({ tipo: 'contrato', estado: 'rascunho' })).toMatch(/contrato ativo/);
    expect(motivoParaNaoAbrirFilho({ tipo: 'aditivo', estado: 'ativo' })).toMatch(/nascem de um contrato/);
    expect(ContratoFilhoSchema.safeParse({ tipo: 'distrato', motivo: 'o cliente pediu', cienteDasParcelas: true }).success).toBe(true);
  });

  it('o que falta para enviar diz cada coisa, e nada depois de enviado', () => {
    const vazio = { estado: 'a_emitir', modalidade: null, faturaPor: ' ', hashDoConteudo: null, minutaId: null, signatarios: [], assinaturaConfigurada: false };
    expect(faltaParaEnviar(vazio)).toHaveLength(6);
    const pronto = { estado: 'rascunho', modalidade: 'implantacao', faturaPor: '12.345.678/0001-90', hashDoConteudo: 'h', minutaId: 'm', signatarios: [{ papel: 'cliente' }, { papel: 'root' }], assinaturaConfigurada: true };
    expect(faltaParaEnviar(pronto)).toEqual([]);
    expect(faltaParaEnviar({ ...pronto, signatarios: [{ papel: 'cliente' }] })).toEqual(['Quem assina pela Root, entre os titulares.']);
    expect(faltaParaEnviar({ ...vazio, estado: 'em_assinatura' })).toEqual([]);
  });
});

describe('o fim do contrato lido do fio', () => {
  const fato = (type: string, dia: string, payload: unknown = {}) => ({ type, payload, occurredAt: new Date(`${dia}T12:00:00Z`) });

  it('vale o fim mais novo, e a reabertura depois dele o anula', () => {
    expect(fimVigente([])).toBeNull();
    expect(fimVigente([fato('contrato.concluido', '2026-10-01')])?.type).toBe('contrato.concluido');
    expect(fimVigente([fato('contrato.concluido', '2026-10-01'), fato('contrato.reaberto', '2026-10-05')])).toBeNull();
    expect(fimVigente([fato('contrato.concluido', '2026-10-01'), fato('contrato.reaberto', '2026-10-05'), fato('contrato.desativado', '2026-10-09')])?.type).toBe('contrato.desativado');
  });

  it('a chave de sempre na primeira vez, outra depois de reabrir', () => {
    expect(chaveDoEncerramento(0)).toBe('encerramento');
    expect(chaveDoEncerramento(2)).toBe('encerramento:2');
  });

  it('cliente desativado: contrato desativado à mão, ou lead que saiu do funil', () => {
    expect(clienteDesativado('fechado', [])).toBe(false);
    expect(clienteDesativado('perdido', [])).toBe(true);
    expect(clienteDesativado('fechado', [fato('contrato.desativado', '2026-10-01')])).toBe(true);
    expect(clienteDesativado('fechado', [fato('contrato.concluido', '2026-10-01')])).toBe(false);
    expect(clienteDesativado('fechado', [fato('contrato.desativado', '2026-10-01'), fato('contrato.reaberto', '2026-10-02')])).toBe(false);
  });
});

describe('o fantasma e o quadro', () => {
  const lead = (id: string, nome: string, extra: Partial<LeadParaOQuadro> = {}): LeadParaOQuadro => ({ id, nome, empresa: null, dono: 'Pedro', etapa: 'fechado', valorCentavos: null, temDocumento: false, importados: [], fatosDoFim: [], ...extra });
  const registro = (id: string, leadId: string, extra: Partial<RegistroParaOQuadro> = {}): RegistroParaOQuadro => ({ id, leadId, tipo: 'contrato', estado: 'ativo', modalidade: null, numero: null, valorCentavos: 100_00, vigenciaFim: null, origemImportada: null, documentoId: null, lacunas: null, signatarios: [], ...extra });
  const insumos = (leads: LeadParaOQuadro[], registros: RegistroParaOQuadro[], extra: Partial<InsumosDoQuadro> = {}): InsumosDoQuadro => ({
    registros, aditivosPorPai: new Map(), documentos: new Map(), leads: new Map(leads.map((l) => [l.id, l])), hoje: HOJE, assinaturaConfigurada: true, ...extra,
  });

  it('o aviso compara pelo começo, em palavras inteiras, sem acento nem caixa', () => {
    expect(avisoDoFantasma('Alicerce Filial Sul', ['Studio Lume', 'Alicerce'])).toBe('conferir: pode ser o mesmo contrato de Alicerce');
    expect(avisoDoFantasma('ÓTICA Vista', ['Otica'])).toBe('conferir: pode ser o mesmo contrato de Otica');
    expect(avisoDoFantasma('Alicerces Ltda', ['Alicerce'])).toBeNull();
    expect(avisoDoFantasma('Ab Comércio', ['Ab'])).toBeNull();
  });

  it('fantasma só em contrato ou fechado, sem contrato, sem importado e sem documento', () => {
    const q = montarQuadro(insumos(
      [
        lead('a', 'Sem Nada'),
        lead('b', 'Na Proposta', { etapa: 'proposta' }),
        lead('c', 'Com Registro'),
        lead('d', 'Com Importado', { importados: [{ origem: 'cartao:1', valorCentavos: 10, temPdf: false }] }),
        lead('e', 'Com Documento', { temDocumento: true }),
        lead('f', 'Na Etapa Contrato', { etapa: 'contrato' }),
      ],
      [registro('r1', 'c')],
    ));
    const fantasmas = q.itens.filter((i) => i.fantasma);
    expect(fantasmas.map((i) => i.id).sort()).toEqual(['sem-contrato:a', 'sem-contrato:f']);
    expect(fantasmas.every((i) => i.etapa === 'a_emitir' && i.estado === null)).toBe(true);
  });

  it('dois importados no mesmo lead são UM cartão com a soma; valor faltando cai no da ficha', () => {
    const soma = cartaoDoImportado(lead('a', 'Cliente', { importados: [{ origem: 'c:1', valorCentavos: 100, temPdf: false }, { origem: 'c:2', valorCentavos: 250, temPdf: true }] }), HOJE);
    expect(soma).toMatchObject({ id: 'importado:a', importado: true, etapa: 'ativo', estado: 'ativo', valorCentavos: 350, temPdf: true, assinaturas: null, aviso: null });
    const semValor = cartaoDoImportado(lead('b', 'Cliente', { valorCentavos: 900, importados: [{ origem: 'c:1', valorCentavos: null, temPdf: false }] }), HOJE);
    expect(semValor).toMatchObject({ valorCentavos: 900, aviso: 'Contrato importado do CRM antigo · anexar o PDF' });
    const q = montarQuadro(insumos([lead('a', 'Cliente', { importados: [{ origem: 'c:1', valorCentavos: 1, temPdf: false }, { origem: 'c:2', valorCentavos: 2, temPdf: false }] })], []));
    expect(q.itens).toHaveLength(1);
  });

  it('o importado assumido vira só o registro; o concluído no fio vai a Encerrado', () => {
    const importados = [{ origem: 'c:1', valorCentavos: 10, temPdf: true }];
    const q = montarQuadro(insumos([lead('a', 'Cliente', { importados })], [registro('r', 'a', { origemImportada: 'c:1' })]));
    expect(q.itens.map((i) => [i.id, i.importado, i.temPdf, i.assinaturas])).toEqual([['r', true, true, null]]);
    const fim = { type: 'contrato.concluido', payload: {}, occurredAt: new Date('2026-10-01T12:00:00Z') };
    expect(cartaoDoImportado(lead('b', 'Cliente', { importados, fatosDoFim: [fim] }), HOJE)).toMatchObject({ estado: 'encerrado', etapa: 'encerrado' });
  });

  it('o aviso do fantasma enxerga quem tem contrato de verdade e quem veio importado', () => {
    const q = montarQuadro(insumos(
      [lead('a', 'Alicerce'), lead('b', 'Alicerce Filial'), lead('c', 'Lume'), lead('d', 'Lume Dois'), lead('e', 'Sem Nada Parecido')],
      [registro('r', 'a')],
      {},
    ));
    const noQuadro = (id: string) => q.itens.find((i) => i.id === id);
    expect(noQuadro('sem-contrato:b')?.aviso).toBe('conferir: pode ser o mesmo contrato de Alicerce');
    // Fantasma não é "cliente com contrato": Lume Dois não ganha aviso por causa de Lume, que também é fantasma.
    expect(noQuadro('sem-contrato:d')?.aviso).toBeNull();
    expect(noQuadro('sem-contrato:e')?.aviso).toBeNull();
  });

  it('aditivo e distrato não viram cartão; o cartão conta os aditivos e as assinaturas', () => {
    const q = montarQuadro(insumos(
      [lead('a', 'Cliente', { empresa: 'Empresa' })],
      [registro('r', 'a', { signatarios: [{ assinadoEm: new Date() }, { assinadoEm: null }], estado: 'em_assinatura' }), registro('f', 'a', { tipo: 'aditivo', estado: 'rascunho' })],
      { aditivosPorPai: new Map([['r', 1]]) },
    ));
    expect(q.itens).toHaveLength(1);
    expect(q.itens[0]).toMatchObject({ id: 'r', cliente: 'Empresa', contato: 'Cliente', dono: 'Pedro', aditivos: 1, assinaturas: { feitas: 1, total: 2 }, etapa: 'em_assinatura' });
  });

  it('documento anterior ao módulo conta as assinaturas no próprio documento; sem nada, nulo', () => {
    expect(assinaturasDoCartao([], { assinadoClienteEm: new Date(), assinadoRootEm: null })).toEqual({ feitas: 1, total: 2 });
    expect(assinaturasDoCartao([], null)).toBeNull();
  });

  it('os totais: contratado só do que está vigente, e toda coluna aparece', () => {
    const q = montarQuadro(insumos(
      [lead('a', 'A'), lead('b', 'B'), lead('c', 'C'), lead('d', 'D', { etapa: 'perdido' }), lead('e', 'E')],
      [
        registro('1', 'a', { valorCentavos: 100 }),
        registro('2', 'b', { valorCentavos: 200, vigenciaFim: '2026-11-30' }),
        registro('3', 'c', { valorCentavos: 400, estado: 'encerrado' }),
        registro('4', 'd', { valorCentavos: 800 }),
        registro('5', 'e', { valorCentavos: 1600, estado: 'em_assinatura' }),
      ],
    ));
    expect(q.totais.contratadoCentavos).toBe(100 + 200 + 800);
    expect(q.totais.porEtapa).toEqual({ a_emitir: 0, minuta: 0, em_assinatura: 1, ativo: 1, renovar: 1, a_encerrar: 1, encerrado: 1 });
    expect(q.itens.find((i) => i.id === '2')?.aviso).toBe('Vence em 30/11/2026');
    expect(q.itens.find((i) => i.id === '4')?.aviso).toBe('Cliente desativado com contrato vivo');
    expect(q.assinaturaConfigurada).toBe(true);
  });
});

describe('o external_id e a assinatura conjunta', () => {
  it('numera dentro do papel, na ordem', () => {
    const lista = signatariosComExternalId([
      { papel: 'root', nome: 'R', email: 'r@x', ordem: 3 },
      { papel: 'cliente', nome: 'A', email: 'a@x', ordem: 1 },
      { papel: 'cliente', nome: 'B', email: 'b@x', ordem: 2 },
    ]);
    expect(lista.map((s) => s.externalId)).toEqual(['cliente:1', 'cliente:2', 'root:1']);
    expect(signatariosComExternalId([{ papel: 'cliente', nome: 'A', email: 'a@x' }, { papel: 'root', nome: 'R', email: 'r@x' }]).map((s) => s.externalId)).toEqual(['cliente:1', 'root:1']);
  });

  it('papelDe aceita o novo e o antigo, e recusa o resto', () => {
    expect(papelDe('cliente')).toBe('cliente');
    expect(papelDe('root')).toBe('root');
    expect(papelDe('cliente:2')).toBe('cliente');
    expect(papelDe('root:1')).toBe('root');
    for (const v of ['cliente:0', 'cliente:x', 'outro:1', 'cliente:', 'root:1:2', null, 7]) expect(papelDe(v), String(v)).toBeNull();
    expect(lerExternalId('cliente')).toEqual({ papel: 'cliente', n: null });
    expect(lerExternalId('cliente:2')).toEqual({ papel: 'cliente', n: 2 });
  });

  const assinou = (id: string, em: string | null = '2026-11-02T10:00:00Z') => ({ token: `t-${id}`, external_id: id, status: 'signed', signed_at: em });
  const falta = (id: string) => ({ token: `t-${id}`, external_id: id, status: 'new', signed_at: null });

  it('com dois do cliente, um só não é "o cliente assinou"; quem assinou sai pelo external_id', () => {
    const w = lerWebhookDaZapsign({ event_type: 'signer_signed', token: 'd', status: 'pending', signers: [assinou('cliente:1'), falta('cliente:2'), falta('root:1')], signer_who_signed: assinou('cliente:1') });
    expect(w?.assinados).toEqual([]);
    expect(w?.assinaturas).toEqual([{ externalId: 'cliente:1', papel: 'cliente', token: 't-cliente:1', em: '2026-11-02T10:00:00Z' }]);
    expect(w?.todosAssinaram).toBe(false);
  });

  it('todos do papel assinados: o papel assina, na hora do último', () => {
    const w = lerWebhookDaZapsign({ event_type: 'signer_signed', token: 'd', status: 'pending', signers: [assinou('cliente:1', '2026-11-02T10:00:00Z'), assinou('cliente:2', '2026-11-02T11:00:00Z'), falta('root:1')] });
    expect(w?.assinados).toEqual([{ papel: 'cliente', em: '2026-11-02T11:00:00Z' }]);
    expect(w?.assinaturas?.map((a) => a.externalId)).toEqual(['cliente:1', 'cliente:2']);
  });

  it('reentrega fora de ordem: o signer_who_signed conta mesmo com a lista atrasada', () => {
    const w = lerWebhookDaZapsign({ event_type: 'signer_signed', token: 'd', status: 'pending', signers: [falta('cliente:1'), falta('root:1')], signer_who_signed: assinou('cliente:1') });
    expect(w?.assinados.map((a) => a.papel)).toEqual(['cliente']);
    expect(w?.assinaturas).toHaveLength(1);
  });

  it('documento antigo: o papel de sempre, sem o campo novo', () => {
    const w = lerWebhookDaZapsign({ event_type: 'signer_signed', token: 'd', status: 'pending', signers: [assinou('cliente'), falta('root')] });
    expect(w).toEqual({ externoId: 'd', todosAssinaram: false, assinados: [{ papel: 'cliente', em: '2026-11-02T10:00:00Z' }], pdfUrl: null });
  });

  it('o documento consultado vira o mesmo vocabulário do webhook', () => {
    const consultado = documentoDaZapsign({ token: 'd', status: 'pending', signers: [assinou('cliente:1'), falta('cliente:2'), { ...assinou('root:1'), signed_at: undefined }] });
    expect(consultado.signatarios[0]?.externalId).toBe('cliente:1');
    const w = assinaturaDoEstado(consultado);
    expect(w.todosAssinaram).toBe(false);
    expect(w.assinados).toEqual([{ papel: 'root', em: null }]);
    expect(w.assinaturas?.map((a) => a.externalId)).toEqual(['cliente:1', 'root:1']);
    const antigo = assinaturaDoEstado(documentoDaZapsign({ token: 'd', status: 'signed', signed_file: 'http://x/d', signers: [assinou('cliente'), assinou('root')] }));
    expect(antigo).toEqual({ externoId: 'd', todosAssinaram: true, assinados: [{ papel: 'cliente', em: '2026-11-02T10:00:00Z' }, { papel: 'root', em: '2026-11-02T10:00:00Z' }], pdfUrl: 'http://x/d' });
  });

  it('casar: pelo token, depois pelo número no papel; o antigo marca o papel; quem tem data fica', () => {
    const agora = new Date('2026-11-02T15:00:00Z');
    const sig = [
      { id: 's1', ordem: 1, papel: 'cliente', tokenNoProvedor: 'tok-1', assinadoEm: null },
      { id: 's2', ordem: 2, papel: 'cliente', tokenNoProvedor: null, assinadoEm: null },
      { id: 's3', ordem: 3, papel: 'root', tokenNoProvedor: null, assinadoEm: new Date('2026-01-01T00:00:00Z') },
    ];
    const novos = casarAssinaturas(sig, { assinados: [], assinaturas: [
      { externalId: 'cliente:1', papel: 'cliente', token: 'tok-1', em: '2026-11-02T10:00:00Z' },
      { externalId: 'cliente:2', papel: 'cliente', token: 'desconhecido', em: null },
      { externalId: 'root:1', papel: 'root', token: null, em: null },
    ] }, agora);
    expect(novos).toEqual([{ id: 's1', em: new Date('2026-11-02T10:00:00Z') }, { id: 's2', em: agora }]);
    expect(casarAssinaturas(sig, { assinados: [{ papel: 'cliente', em: null }] }, agora).map((x) => x.id)).toEqual(['s1', 's2']);
  });

  it('o base64 do PDF sai sem o prefixo, e lixo não passa', () => {
    expect(base64DoPdf('data:application/pdf;base64,JVBERi0=')).toBe('JVBERi0=');
    expect(base64DoPdf('JVBE\nRi0=')).toBe('JVBERi0=');
    expect(() => base64DoPdf('não é base64!')).toThrow(/não é base64/);
    expect(() => base64DoPdf('')).toThrow(/não é base64/);
  });
});

describe('o adaptador contra o dublê da ZapSign', { timeout: 20_000 }, () => {
  let filho: ChildProcess;
  let estado = '';
  let porta = 0;
  let zapsign: ZapsignService;
  const ambiente = { base: process.env.ZAPSIGN_BASE_URL, token: process.env.ZAPSIGN_API_TOKEN };
  const PDF = Buffer.from('%PDF-1.4 dublê').toString('base64');

  beforeAll(async () => {
    porta = await new Promise<number>((ok, falha) => {
      const s = criarNet();
      s.once('error', falha);
      s.listen(0, '127.0.0.1', () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => ok(p));
      });
    });
    estado = mkdtempSync(path.join(tmpdir(), 'contratos-puro-'));
    filho = spawn(process.execPath, [path.resolve(__dirname, '../../../homolog/mocks/zapsign/server.mjs')], {
      env: { ...process.env, PORT: String(porta), WEBHOOK_URL: '', PUBLIC_URL: `http://127.0.0.1:${porta}`, ESTADO: path.join(estado, 'zap.json') },
      stdio: 'ignore',
    });
    const ate = Date.now() + 8_000;
    for (;;) {
      try {
        if ((await fetch(`http://127.0.0.1:${porta}/health`)).ok) break;
      } catch {
        /* ainda subindo */
      }
      if (Date.now() > ate) throw new Error('o dublê não subiu');
      await new Promise((r) => setTimeout(r, 100));
    }
    process.env.ZAPSIGN_BASE_URL = `http://127.0.0.1:${porta}/api/v1`;
    process.env.ZAPSIGN_API_TOKEN = 'token-de-teste';
    zapsign = new ZapsignService();
  });

  afterAll(() => {
    filho?.kill();
    rmSync(estado, { recursive: true, force: true });
    if (ambiente.base === undefined) delete process.env.ZAPSIGN_BASE_URL;
    else process.env.ZAPSIGN_BASE_URL = ambiente.base;
    if (ambiente.token === undefined) delete process.env.ZAPSIGN_API_TOKEN;
    else process.env.ZAPSIGN_API_TOKEN = ambiente.token;
  });

  const lista = [
    { papel: 'cliente' as const, nome: 'Sócia Um', email: 'um@cliente.teste', ordem: 1 },
    { papel: 'cliente' as const, nome: 'Sócio Dois', email: 'dois@cliente.teste', ordem: 2 },
    { papel: 'root' as const, nome: 'Titular', email: 't@root.teste', ordem: 3 },
  ];

  it('cria por PDF, sem o prefixo data:, com três signatários e o external_id novo; o assinado baixa como PDF', async () => {
    const d = await zapsign.criarDocumento({ nome: 'Contrato', pdfBase64: `data:application/pdf;base64,${PDF}`, referenciaExterna: 'ctr-1', signatarios: lista });
    expect(d.signatarios.map((s) => s.externalId)).toEqual(['cliente:1', 'cliente:2', 'root:1']);
    expect(d.signatarios.map((s) => s.papel)).toEqual(['cliente', 'cliente', 'root']);
    expect(d.estado).toBe('pendente');

    // O primeiro do cliente assina no dublê: o documento segue pendente e o papel não fecha.
    await fetch(`http://127.0.0.1:${porta}/simular/assinar/${d.signatarios[0]!.token}`, { method: 'POST', headers: { accept: 'application/json' } });
    let agora = await zapsign.consultarEstado(d.externoId);
    let w = assinaturaDoEstado(agora!);
    expect(w.assinados).toEqual([]);
    expect(w.assinaturas?.map((a) => a.externalId)).toEqual(['cliente:1']);

    for (const s of d.signatarios.slice(1)) await fetch(`http://127.0.0.1:${porta}/simular/assinar/${s.token}`, { method: 'POST', headers: { accept: 'application/json' } });
    agora = await zapsign.consultarEstado(d.externoId);
    w = assinaturaDoEstado(agora!);
    expect(w.todosAssinaram).toBe(true);
    expect(w.assinados.map((a) => a.papel).sort()).toEqual(['cliente', 'root']);
    const baixado = await zapsign.baixarAssinado(d.externoId);
    expect(baixado?.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('o markdown de sempre continua valendo', async () => {
    const d = await zapsign.criarDocumento({ nome: 'Contrato', markdown: '# texto', referenciaExterna: 'ctr-2', signatarios: lista.slice(1) });
    expect(d.signatarios.map((s) => s.externalId)).toEqual(['cliente:1', 'root:1']);
  });

  it('reenviar devolve os links atuais; cancelar tira o documento, e o segundo cancelar é "já não existia"', async () => {
    const d = await zapsign.criarDocumento({ nome: 'Contrato', markdown: '# texto', referenciaExterna: 'ctr-3', signatarios: lista });
    const links = await zapsign.reenviar(d.externoId);
    expect(links?.signatarios.map((s) => s.link)).toEqual(d.signatarios.map((s) => s.link));
    expect(await zapsign.cancelar(d.externoId)).toEqual({ externoId: d.externoId, jaNaoExistia: false });
    expect(await zapsign.consultarEstado(d.externoId)).toBeNull();
    expect(await zapsign.reenviar(d.externoId)).toBeNull();
    expect(await zapsign.cancelar(d.externoId)).toEqual({ externoId: d.externoId, jaNaoExistia: true });
  });
});

describe('a rota do quadro não cai em GET contratos/:leadId', () => {
  /** O mesmo conflito do módulo: um `:leadId` no mesmo prefixo. */
  it('ContratosController vem antes de DinheiroController no módulo', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ComercialModule) as unknown[];
    expect(controllers.indexOf(ContratosController)).toBeGreaterThanOrEqual(0);
    expect(controllers.indexOf(ContratosController)).toBeLessThan(controllers.indexOf(DinheiroController));
  });

  it('com a ordem do módulo, /quadro e /registro/:id chegam ao serviço novo, e /:leadId à rota antiga', async () => {
    const chamadas: string[] = [];
    @Controller('comercial')
    class RotaAntiga {
      @Get('contratos/:leadId')
      vivo(@Param('leadId') leadId: string) {
        chamadas.push(`vivo:${leadId}`);
        return { leadId };
      }

      @Get('contratos')
      lista() {
        chamadas.push('lista');
        return [];
      }
    }
    const servico = {
      quadro: async () => {
        chamadas.push('quadro');
        return { itens: [] };
      },
      ficha: async (_o: string, id: string) => {
        chamadas.push(`ficha:${id}`);
        return { id };
      },
    };
    const passa = { canActivate: (ctx: { switchToHttp: () => { getRequest: () => Record<string, unknown> } }) => {
      ctx.switchToHttp().getRequest().user = { sub: 'u', orgId: 'o', roles: [] };
      return true;
    } };
    Reflect.defineMetadata('design:paramtypes', [ContratosService], ContratosController);
    const modulo = await Test.createTestingModule({ controllers: [ContratosController, RotaAntiga], providers: [{ provide: ContratosService, useValue: servico }] })
      .overrideGuard(JwtAuthGuard).useValue(passa)
      .overrideGuard(PermissionsGuard).useValue(passa)
      .compile();
    const app: INestApplication = modulo.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    try {
      for (const caminho of ['quadro', 'registro/importado:lead-1', 'lead-9', '']) {
        const r = await fetch(`${base}/comercial/contratos${caminho ? `/${caminho}` : ''}`);
        expect(r.status, caminho).toBe(200);
      }
    } finally {
      await app.close();
    }
    expect(chamadas).toEqual(['quadro', 'ficha:importado:lead-1', 'vivo:lead-9', 'lista']);
  });
});

describe('o lote e o que a política retém', () => {
  /** Só o lote de verdade: os atos são dublês, para medir o que ele faz com cada resposta. */
  function comAtos(atos: { conferir?: unknown; encerrar?: unknown; reabrir?: unknown }) {
    const svc = Object.create(ContratosService.prototype) as ContratosService;
    Object.assign(svc, {
      exigirGente: async () => ({ id: 'u', nome: 'Mesa' }),
      ehImportado: async (_o: string, id: string) => id.startsWith('importado:'),
      ...atos,
    });
    return svc;
  }
  const quem = { id: 'u', nome: 'Mesa', papeis: [] };

  it('item retido vai em retidos, nem feito nem recusado; o erro de um não para os outros', async () => {
    const svc = comAtos({
      encerrar: async (_o: string, id: string) => {
        if (id === 'erro') throw new Error('não deu');
        return id === 'retido' ? { status: 'aguardando_aprovacao', approvalId: 'ap-1' } : { id };
      },
    });
    const r = await svc.lote('o', quem, { acao: 'encerrar', ids: ['a', 'retido', 'erro', 'b', 'a'], motivo: 'fim do ciclo' });
    expect(r).toEqual({ ok: ['a', 'b'], recusados: [{ id: 'erro', motivo: 'não deu' }], retidos: [{ id: 'retido', approvalId: 'ap-1' }] });
  });

  it('importado volta recusado com a frase da lista antiga em encerrar e reabrir, sem chamar o ato', async () => {
    let chamou = 0;
    const svc = comAtos({ encerrar: async () => { chamou++; return {}; }, reabrir: async () => { chamou++; return {}; } });
    for (const acao of ['encerrar', 'reabrir'] as const) {
      const r = await svc.lote('o', quem, { acao, ids: ['importado:l'], motivo: 'fim do ciclo' });
      expect(r.recusados).toEqual([{ id: 'importado:l', motivo: FRASE_DO_IMPORTADO_NO_LOTE }]);
    }
    expect(chamou).toBe(0);
  });

  it('o motivo: encerrar exige, reabrir não; a ficha aceita reabrir sem corpo', async () => {
    const motivos: unknown[] = [];
    const svc = comAtos({ reabrir: async (_o: string, _i: string, _q: unknown, input: { motivo?: string }) => { motivos.push(input.motivo); return {}; } });
    await expect(svc.lote('o', quem, { acao: 'encerrar', ids: ['a'] })).rejects.toThrow(/pede o motivo/);
    expect((await svc.lote('o', quem, { acao: 'reabrir', ids: ['a'] })).ok).toEqual(['a']);
    expect(motivos).toEqual([undefined]);
    expect(ContratoReabrirSchema.parse({})).toEqual({});
    expect(ContratoReabrirSchema.safeParse({ motivo: 'x' }).success).toBe(false);
    expect(ContratoReabrirSchema.parse({ motivo: ' voltou o escopo ' })).toEqual({ motivo: 'voltou o escopo' });
  });
});

describe('a migration', () => {
  const sql = readFileSync(path.resolve(__dirname, '../prisma/migrations/20261102120000_comercial_contrato/migration.sql'), 'utf8');

  it('o backfill usa a mesma conta do código, deixa a minuta de fora e confere o resultado', () => {
    expect(sql).toContain(`md5('comercial-contrato:' || d."id")`);
    expect(sql).toContain(`d."provedor" <> 'minuta'`);
    expect(sql).toContain('backfill incompleto');
    expect(sql).toContain('CAMINHO DE VOLTA');
  });

  it('não reescreve linha existente: só cria e insere', () => {
    const semComentario = sql.replace(/^--.*$/gm, '');
    expect(semComentario).not.toMatch(/\bUPDATE\s+"/);
    expect(semComentario).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(semComentario).not.toMatch(/\bALTER\s+TABLE\s+"(?!ComercialContrato)/);
  });
});
