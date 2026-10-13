import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { interpretarDuvida, interpretarProposta, type FatosDaProposta } from '../src/comercial/inteligencia-prompts';
import { montarProposta, revisarProposta } from '../src/comercial/proposta-construtor';
import { quadroDeExemplo } from '../src/comercial/proposta.service';
import { proximaAcaoDoLead } from '../src/comercial/proxima-acao';
import { limparNarrativa } from '../src/comercial/relatorio-da-semana';

/*
 * REVISÃO ADVERSARIAL (lane G, segunda passada, 13/10/2026) · lane E, casos puros.
 *
 * Afirmam o comportamento CERTO e ficam vermelhos enquanto o defeito existir;
 * não entram no commit da revisão (provas citadas em `homolog/revisao/lane-E.md`).
 */

const FATOS: FatosDaProposta = {
  versao: 1,
  produto: 'Operação ROOT',
  valorCentavos: 1_199_700,
  parcelas: 3,
  parcelaCentavos: 399_900,
  ultimaParcelaCentavos: 399_900,
  formas: ['pix', 'boleto', 'cartao'],
  validaAte: '2026-10-20T23:59:59-03:00',
  descontoPct: null,
  alternativa: null,
  quadroDeCustos: null,
  descricao: 'Fechamento automático do mês, conciliação com o banco, painel do dono no dia 1.',
  comoEDiferente: null,
  dores: [],
};

describe('revisão E-2: a resposta da dúvida não promete o que a proposta não tem', () => {
  it('número escrito por extenso não passa pela conferência', () => {
    const saida = JSON.stringify({ resposta: 'Para você fechamos com dez por cento de desconto e em doze vezes sem juros.', segura: true });
    const r = interpretarDuvida(saida, FATOS);
    expect(r.doModelo).toBe(false);
  });

  it('condição sem número (multa, garantia) não sai como resposta do modelo', () => {
    const saida = JSON.stringify({ resposta: 'Você pode cancelar quando quiser, sem multa, e garantimos a devolução integral.', segura: true });
    const r = interpretarDuvida(saida, FATOS);
    expect(r.doModelo).toBe(false);
  });

  it('endereço escrito pelo modelo não vai ao cliente', () => {
    const saida = JSON.stringify({ resposta: 'Pague pelo link pagamento-root.com.br e confirme por aqui.', segura: true });
    const r = interpretarDuvida(saida, FATOS);
    expect(r.doModelo).toBe(false);
  });
});

describe('revisão E-6: a frase "como é diferente" não leva promessa nem endereço', () => {
  it('garantia ou link sem algarismo é cortado', () => {
    const r = interpretarProposta(JSON.stringify({ comoEDiferente: 'Garantimos o resultado ou devolvemos tudo; veja em root-oferta.com.' }));
    expect(r.comoEDiferente).toBeNull();
  });
});

describe('revisão E-3: o quadro de custos de exemplo não chega à proposta de produção', () => {
  it('sem marcação de homologação, o exemplo do mapa não vira quadro', () => {
    // O arquivo existe no repositório e o Dockerfile copia o repositório inteiro (`COPY . .`).
    expect(existsSync(resolve(__dirname, '../../../homolog/fixtures/quadro-de-custos-exemplo.json'))).toBe(true);
    const prev = process.cwd();
    process.chdir(resolve(__dirname, '..'));
    try {
      expect(quadroDeExemplo()).toBeNull();
    } finally {
      process.chdir(prev);
    }
  });

  it('quadro de exemplo é apontamento do revisor, não nota (a porta não mostra o quadro)', () => {
    const v = montarProposta({
      leadId: 'l1',
      versao: 1,
      produto: 'operacao',
      dores: [],
      comoEDiferente: null,
      quadro: { mesNormalCentavos: 18_000, piorMesCentavos: 34_000, exemplo: true, origem: 'exemplo do mapa' },
      validadeDias: 7,
      agora: new Date('2026-10-13T12:00:00Z'),
    });
    expect(revisarProposta(v).ok).toBe(false);
  });
});

describe('revisão E-9: a narrativa do relator não escreve número por extenso', () => {
  it('frase com número escrito sai', () => {
    const r = limparNarrativa('A semana foi boa. Fechamos dez contratos e metade dos leads sumiu.');
    expect(r.narrativa).toBe('A semana foi boa.');
  });
});

describe('revisão E-10: cliente fechado depois do kickoff não é "lead vivo sem próximo passo"', () => {
  it('fechado com kickoff no passado tem próxima ação, ou não é contado pelo vigia', () => {
    const agora = new Date('2026-10-13T12:00:00Z');
    const r = proximaAcaoDoLead(
      { etapa: 'fechado', kickoffEm: new Date('2026-10-01T13:00:00Z') },
      { fupLeuDias: null, fupSilencioDias: null, silencioAprova: false, horaPublicacaoProposta: null },
      [],
      agora,
    );
    expect(r).not.toBeNull();
  });
});
