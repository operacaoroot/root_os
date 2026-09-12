/**
 * O QUE A TELA SABE SOBRE UM ERRO DA API — e por que ela precisa saber mais do
 * que a frase.
 *
 * Desde o gancho da porta (RF-G-06), confirmar uma aprovação pode ser recusado
 * porque alguém desligou o conector daquela empresa. A frase que a API manda já
 * explica o que houve, mas ela terminava numa caixa vermelha igual a todas as
 * outras: quem lia "religar em Conexões" tinha de sair procurando a tela no
 * menu. O conserto foi o CÓDIGO da recusa viajar junto, e a caixa decidir por
 * ele — nunca por substring do texto em português, que quebra na primeira
 * reescrita e quebra em silêncio.
 *
 * Estes casos travam as duas metades: o tradutor de resposta de erro
 * (`erroDaResposta`) e a pergunta que a tela faz (`ehConectorDesligado`).
 */
import { describe, expect, it } from 'vitest';

import {
  CODIGO_CONECTOR_DESLIGADO,
  ErroDaApi,
  ehConectorDesligado,
  erroDaResposta,
} from '@/lib/api';

/** A recusa como a API a monta (`corpoDaRecusa`, em integrations/conectores.ts). */
const RECUSA = {
  statusCode: 403,
  error: CODIGO_CONECTOR_DESLIGADO,
  message:
    'O conector "WhatsApp" está desligado para esta empresa desde 11/09/2026 14:32. ' +
    'Nada foi enviado. A credencial continua guardada: religar em Conexões restabelece o uso ' +
    'sem nova autorização.',
  conector: 'whatsapp',
  rotuloDoConector: 'WhatsApp',
};

describe('erroDaResposta', () => {
  it('preserva a frase E o código da recusa de conector desligado', () => {
    const e = erroDaResposta(RECUSA, 403);
    expect(e).toBeInstanceOf(ErroDaApi);
    expect(e.message).toBe(RECUSA.message);
    expect(e.status).toBe(403);
    expect(e.codigo).toBe(CODIGO_CONECTOR_DESLIGADO);
  });

  /*
   * O CONTRATO COM A API, repetido à mão dos dois lados.
   *
   * `apps/api/src/integrations/conectores.ts` declara o mesmo literal, e um caso
   * de lá o trava igual. Não dá para importar: o pacote compartilhado não expõe
   * nada da porta, e criar essa dependência só por uma string custaria mais do
   * que a duplicação — o que não pode é a duplicação ser tácita.
   */
  it('o código é o mesmo literal que a API declara', () => {
    expect(CODIGO_CONECTOR_DESLIGADO).toBe('conector_desligado');
  });

  it('desdobra o issues do ZodExceptionFilter, que não manda message', () => {
    const e = erroDaResposta(
      { error: 'ValidationError', issues: [{ path: 'motivo', message: 'muito longo' }] },
      400,
    );
    expect(e.message).toBe('motivo: muito longo');
    expect(e.codigo).toBe('ValidationError');
  });

  it('junta a lista de frases do ValidationPipe em vez de coagir o array', () => {
    const e = erroDaResposta({ message: ['campo a inválido', 'campo b inválido'] }, 400);
    expect(e.message).toBe('campo a inválido · campo b inválido');
  });

  it('sem message e sem error, sobra o status — nunca "undefined" na tela', () => {
    expect(erroDaResposta({}, 500).message).toBe('Erro 500');
  });

  it('com error e sem message, mostra o error (comportamento antigo preservado)', () => {
    expect(erroDaResposta({ error: 'Forbidden' }, 403).message).toBe('Forbidden');
  });
});

describe('ehConectorDesligado', () => {
  it('reconhece a recusa pelo código', () => {
    expect(ehConectorDesligado(erroDaResposta(RECUSA, 403))).toBe(true);
  });

  it('não confunde com outro 403', () => {
    const e = erroDaResposta({ error: 'Forbidden', message: 'sem permissão' }, 403);
    expect(ehConectorDesligado(e)).toBe(false);
  });

  /*
   * A ARMADILHA que a decisão por código existe para evitar: um `Error` cru com
   * a MESMA frase não é a recusa. Se a tela casasse por texto, qualquer caminho
   * que repetisse a mensagem (um log ecoado, um erro embrulhado por engano)
   * ganharia o link para Conexões sem ter vindo da API.
   */
  it('frase igual, sem código, não vira recusa de conector', () => {
    expect(ehConectorDesligado(new Error(RECUSA.message))).toBe(false);
    expect(ehConectorDesligado(new ErroDaApi(RECUSA.message, 403))).toBe(false);
  });

  it('aguenta o que não é erro nenhum', () => {
    expect(ehConectorDesligado(null)).toBe(false);
    expect(ehConectorDesligado('conector_desligado')).toBe(false);
  });
});
