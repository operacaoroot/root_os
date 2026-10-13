/**
 * O DINHEIRO DO COCKPIT, a parte pura (lane D, 13/10/2026).
 *
 * Sem banco e sem Nest: a leitura dos webhooks do Asaas e da ZapSign, o
 * segredo conferido em tempo constante, o contrato montado sem dado inventado
 * (e igual ao modelo de homologação), a régua de cobrança e o portão do
 * fechamento.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { avisoDevido, diasEntre, estadoDaParcela } from '../src/comercial/contrato-vivo.service';
import { CONTRATO_MODELO, documentoFormatado, hashDoContrato, lacunasDoContrato, montarContrato } from '../src/comercial/contrato-modelo';
import { chaveDoFechamento, escritasVazias, prontoParaFechar } from '../src/comercial/fechamento.service';
import { documentoDaZapsign, lerWebhookDaZapsign } from '../src/comercial/portas/assinatura.port';
import { billingTypeDoAsaas, centavosDe, lerWebhookDoAsaas, parcelaDoAsaas, segredoConfere } from '../src/comercial/portas/cobranca.port';

describe('o segredo do webhook', () => {
  it('confere só o igual; vazio de qualquer lado recusa', () => {
    expect(segredoConfere('abc', 'abc')).toBe(true);
    expect(segredoConfere('abc', 'abd')).toBe(false);
    expect(segredoConfere('abc', 'abcd')).toBe(false);
    expect(segredoConfere('', '')).toBe(false);
    expect(segredoConfere('', 'abc')).toBe(false);
    expect(segredoConfere('abc', undefined)).toBe(false);
  });
});

describe('o webhook do Asaas', () => {
  it('PAYMENT_RECEIVED vira pagamento com centavos e data', () => {
    const p = lerWebhookDoAsaas({ id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', value: 3999, paymentDate: '2026-10-13' } });
    expect(p).toEqual({ eventoId: 'evt_1', tipo: 'paga', externoId: 'pay_1', valorCentavos: 399_900, pagoEm: '2026-10-13' });
  });
  it('outro evento é "outro"; corpo sem cobrança é nulo', () => {
    expect(lerWebhookDoAsaas({ event: 'PAYMENT_CREATED', payment: { id: 'pay_1', value: 1 } })?.tipo).toBe('outro');
    expect(lerWebhookDoAsaas({ event: 'PAYMENT_RECEIVED' })).toBeNull();
    expect(lerWebhookDoAsaas('lixo')).toBeNull();
  });
  it('a parcela do Asaas e a forma no vocabulário dele', () => {
    expect(parcelaDoAsaas({ id: 'p', installmentNumber: 2, installmentCount: 3, value: 3999, dueDate: '2026-11-13', status: 'PENDING', invoiceUrl: 'http://x/fatura/p' })).toMatchObject({
      parcela: 2,
      parcelas: 3,
      valorCentavos: 399_900,
      estado: 'pendente',
      linkPagamento: 'http://x/fatura/p',
    });
    expect(billingTypeDoAsaas('cartao')).toBe('CREDIT_CARD');
    expect(centavosDe('297.00')).toBe(29_700);
  });
});

describe('o webhook da ZapSign', () => {
  const corpo = {
    event_type: 'signer_signed',
    token: 'doc-1',
    status: 'pending',
    signers: [
      { token: 's1', external_id: 'cliente', status: 'signed', signed_at: '2026-10-13T13:42:00Z' },
      { token: 's2', external_id: 'root', status: 'new', signed_at: null },
    ],
    signer_who_signed: { token: 's1', external_id: 'cliente', signed_at: '2026-10-13T13:42:00Z' },
  };
  it('quem assinou sai pelo papel; o documento todo só no doc_signed', () => {
    const w = lerWebhookDaZapsign(corpo);
    expect(w).toEqual({ externoId: 'doc-1', todosAssinaram: false, assinados: [{ papel: 'cliente', em: '2026-10-13T13:42:00Z' }], pdfUrl: null });
    const todos = lerWebhookDaZapsign({ ...corpo, event_type: 'doc_signed', status: 'signed', signed_file: 'http://x/doc', signers: corpo.signers.map((s) => ({ ...s, status: 'signed' })) });
    expect(todos?.todosAssinaram).toBe(true);
    expect(todos?.assinados.map((a) => a.papel).sort()).toEqual(['cliente', 'root']);
  });
  it('sem token de documento é nulo; o documento lê os links por papel', () => {
    expect(lerWebhookDaZapsign({ event_type: 'doc_signed' })).toBeNull();
    const d = documentoDaZapsign({ token: 'doc-1', status: 'pending', signers: [{ token: 's1', external_id: 'cliente', sign_url: 'http://z/assinar/s1', status: 'new' }] });
    expect(d.signatarios[0]).toEqual({ papel: 'cliente', token: 's1', link: 'http://z/assinar/s1', assinadoEm: null });
  });
});

describe('o contrato de homologação', () => {
  const dados = {
    razaoSocial: 'Construtora Alicerce Ltda',
    cnpj: '12345678000199',
    endereco: 'Rua A, 1, Juiz de Fora',
    quemAssina: 'Marina Duarte',
    email: 'marina@alicerce.test',
    produto: 'operacao' as const,
    valorCentavos: 1_199_700,
    parcelas: 3,
    forma: 'pix',
    propostaVersao: 1,
    propostaHash: 'a'.repeat(64),
    aceitoEm: new Date('2026-10-13T13:00:00-03:00'),
  };

  it('é o mesmo texto do modelo em homolog/fixtures', () => {
    const arquivo = readFileSync(path.resolve(__dirname, '../../../homolog/fixtures/contrato-modelo.md'), 'utf8').replace(/\r\n/g, '\n');
    expect(CONTRATO_MODELO).toBe(arquivo);
  });

  it('preenche os campos do aceite e da tabela, sem chave sobrando, e mantém as lacunas', () => {
    const md = montarContrato(dados);
    expect(md).toContain('Construtora Alicerce Ltda, inscrita no CPF/CNPJ sob o nº 12.345.678/0001-99');
    expect(md).toContain('**R$ 11.997,00**, em **3** parcela(s) de **R$ 3.999,00**, por **Pix**');
    expect(md).toContain('Operação ROOT');
    expect(md).toContain('13 de outubro de 2026');
    expect(md).not.toMatch(/\{\w+\}/);
    const lacunas = lacunasDoContrato(md);
    expect(lacunas).toContain('cidade');
    expect(lacunas).toContain('quem assina pela Operação ROOT');
    expect(lacunas.length).toBeGreaterThanOrEqual(8);
  });

  it('é determinístico: o mesmo aceite dá o mesmo hash; um dado diferente, outro', () => {
    expect(hashDoContrato(montarContrato(dados))).toBe(hashDoContrato(montarContrato({ ...dados })));
    expect(hashDoContrato(montarContrato({ ...dados, email: 'outra@alicerce.test' }))).not.toBe(hashDoContrato(montarContrato(dados)));
  });

  it('campo vazio vira lacuna, nunca valor inventado', () => {
    expect(montarContrato({ ...dados, endereco: '' })).toContain('[a decidir: endereco]');
    expect(documentoFormatado('12345678901')).toBe('123.456.789-01');
  });
});

describe('a régua de cobrança', () => {
  it('o aviso devido é o degrau mais recente alcançado', () => {
    expect(avisoDevido('2026-10-20', '2026-10-16')).toBeNull();
    expect(avisoDevido('2026-10-20', '2026-10-17')).toEqual({ aviso: 'D-3', dias: -3 });
    expect(avisoDevido('2026-10-20', '2026-10-19')).toEqual({ aviso: 'D-3', dias: -1 });
    expect(avisoDevido('2026-10-20', '2026-10-20')).toEqual({ aviso: 'D0', dias: 0 });
    expect(avisoDevido('2026-10-20', '2026-10-21')).toEqual({ aviso: 'D+1', dias: 1 });
    expect(avisoDevido('2026-10-20', '2026-10-27')).toEqual({ aviso: 'D+5', dias: 7 });
    expect(avisoDevido('2026-10-20', '2026-11-05')).toEqual({ aviso: 'D+10', dias: 16 });
  });
  it('dias pelo calendário e o estado da parcela', () => {
    expect(diasEntre('2026-10-31', '2026-11-01')).toBe(1);
    expect(estadoDaParcela('2026-10-20', null, '2026-10-21')).toBe('atrasada');
    expect(estadoDaParcela('2026-10-20', null, '2026-10-20')).toBe('pendente');
    expect(estadoDaParcela('2026-10-20', new Date(), '2026-10-25')).toBe('paga');
  });
});

describe('o portão do fechamento', () => {
  it('só com os três fatos no fio, e diz o que falta', () => {
    expect(prontoParaFechar(new Set(['pix.pago']))).toEqual({ pronto: false, falta: ['contrato assinado pelo cliente', 'contrato assinado pela Root'] });
    expect(prontoParaFechar(new Set(['pix.pago', 'contrato.assinado_cliente', 'contrato.assinado_root'])).pronto).toBe(true);
  });
  it('a chave casa com o argsSchema da capacidade e as cinco escritas nascem pendentes', () => {
    const chave = chaveDoFechamento('3f2c1a9e-0000-4000-8000-000000000001', 2);
    expect(chave).toMatch(/^fech-[0-9a-f-]{36}-v[0-9]{1,4}$/);
    expect(escritasVazias().map((e) => [e.escrita, e.estado])).toEqual([
      ['cliente', 'pendente'],
      ['contrato', 'pendente'],
      ['cobranca', 'pendente'],
      ['kit_e_trilho', 'pendente'],
      ['grupo', 'pendente'],
    ]);
  });
});
