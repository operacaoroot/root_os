/*
 * O LEAD QUE JÁ EXISTE, NO "+ LEAD" (29/10/2026) — a parte pura, sem banco.
 *   · a chave do telefone (com e sem 55, com e sem o 9);
 *   · quem bate com o que foi digitado, e por quê (telefone, e-mail, empresa, contato);
 *   · a ordem (mais motivos, funil ativo antes das saídas) e o teto;
 *   · o pedido da venda nova (o schema do shared).
 */
import { describe, expect, it } from 'vitest';
import { VendaNovaDoClienteSchema, acharLeadsParecidos, chaveDoTelefone, paraLeadParecido, type CandidatoAParecido } from '@mktos/shared';

function lead(extra: Partial<CandidatoAParecido> & { leadId: string; nome: string }): CandidatoAParecido {
  return { empresa: null, telefone: null, email: null, etapa: 'novo_lead', produto: null, cadastroId: null, ...extra };
}

const CUSTEIO = lead({ leadId: 'l-custeio', nome: 'Custeio', empresa: 'Custeio', etapa: 'fechado', produto: 'operacao', cadastroId: 'p-custeio', telefone: '5561998887766' });
const CUSTEIO_IMERSAO = lead({ leadId: 'l-custeio-imersao', nome: 'Custeio (Imersão)', etapa: 'fechado', produto: 'imersao', cadastroId: 'p-custeio' });
const PET = lead({ leadId: 'l-pet', nome: 'Raul', empresa: 'Pet Cricao', etapa: 'proposta', email: 'raul@petcricao.com.br' });
const MARCELO = lead({ leadId: 'l-curral', nome: 'Marcelo Alves Meroto', empresa: 'Curral', etapa: 'fechado' });
const PERDIDO = lead({ leadId: 'l-perdido', nome: 'Custeio Agro', etapa: 'perdido' });
const TODOS = [CUSTEIO, CUSTEIO_IMERSAO, PET, MARCELO, PERDIDO];

const ids = (r: ReturnType<typeof acharLeadsParecidos>) => r.map((a) => a.candidato.leadId);

describe('chaveDoTelefone', () => {
  it('o mesmo celular com e sem 55, com e sem o 9, com máscara', () => {
    const k = chaveDoTelefone('5561998887766');
    expect(k).toBe('61:98887766');
    expect(chaveDoTelefone('(61) 99888-7766')).toBe(k);
    expect(chaveDoTelefone('61 9888-7766')).toBe(k);
    expect(chaveDoTelefone('556198887766')).toBe(k);
  });
  it('número incompleto ou sem DDD não vira chave', () => {
    expect(chaveDoTelefone('99888-7766')).toBeNull();
    expect(chaveDoTelefone('')).toBeNull();
    expect(chaveDoTelefone(null)).toBeNull();
  });
});

describe('acharLeadsParecidos', () => {
  it('a empresa digitada acha os dois cards da Custeio (o do parêntese também) e a saída vem por último', () => {
    const r = acharLeadsParecidos({ empresa: 'custeio' }, TODOS);
    expect(ids(r)).toEqual(['l-custeio', 'l-custeio-imersao', 'l-perdido']);
    expect(r[0].motivos).toEqual(['empresa']);
  });

  it('enquanto digita: a partir de 4 letras o começo do nome já acha; com 3, só palavra inteira', () => {
    expect(ids(acharLeadsParecidos({ empresa: 'Cust' }, TODOS))).toContain('l-custeio');
    expect(ids(acharLeadsParecidos({ empresa: 'Cus' }, TODOS))).toEqual([]);
    expect(ids(acharLeadsParecidos({ empresa: 'Pet' }, TODOS))).toEqual(['l-pet']);
  });

  it('a razão social com sobrenome acha o lead do nome curto ("Custeio Technology S/S Ltda" → "Custeio")', () => {
    expect(ids(acharLeadsParecidos({ empresa: 'Custeio Technology S/S Ltda' }, [CUSTEIO]))).toEqual(['l-custeio']);
  });

  it('acento, caixa e pontuação não contam', () => {
    expect(ids(acharLeadsParecidos({ empresa: 'PET CRICÃO' }, TODOS))).toEqual(['l-pet']);
  });

  it('telefone e e-mail acham mesmo com a empresa vazia', () => {
    expect(acharLeadsParecidos({ telefone: '(61) 9888-7766' }, TODOS).map((a) => [a.candidato.leadId, a.motivos])).toEqual([['l-custeio', ['telefone']]]);
    expect(acharLeadsParecidos({ email: ' RAUL@petcricao.com.br ' }, TODOS).map((a) => [a.candidato.leadId, a.motivos])).toEqual([['l-pet', ['email']]]);
  });

  it('o contato só conta com nome e sobrenome', () => {
    expect(ids(acharLeadsParecidos({ contato: 'Marcelo Alves Meroto' }, TODOS))).toEqual(['l-curral']);
    expect(ids(acharLeadsParecidos({ contato: 'Raul' }, TODOS))).toEqual([]);
  });

  it('mais motivos vem primeiro', () => {
    const r = acharLeadsParecidos({ empresa: 'Custeio', telefone: '61998887766' }, TODOS);
    expect(r[0].candidato.leadId).toBe('l-custeio');
    expect(r[0].motivos).toEqual(['telefone', 'empresa']);
  });

  it('nada digitado, nada achado; e o teto vale', () => {
    expect(acharLeadsParecidos({}, TODOS)).toEqual([]);
    const muitos = Array.from({ length: 9 }, (_, i) => lead({ leadId: `l${i}`, nome: `Custeio ${i}` }));
    expect(acharLeadsParecidos({ empresa: 'Custeio' }, muitos)).toHaveLength(5);
  });
});

describe('paraLeadParecido', () => {
  it('leva os rótulos da etapa e do produto e o cadastro', () => {
    expect(paraLeadParecido(CUSTEIO, ['empresa'])).toMatchObject({
      rotuloDaEtapa: 'E9 · Negócio fechado',
      rotuloDoProduto: 'Operação ROOT',
      cadastroId: 'p-custeio',
      motivos: ['empresa'],
    });
    expect(paraLeadParecido(PET, ['email']).rotuloDoProduto).toBeNull();
  });
});

describe('VendaNovaDoClienteSchema', () => {
  it('pede a referência do clique e aceita o contato desta venda', () => {
    expect(VendaNovaDoClienteSchema.safeParse({ ref: 'funil:1234-5678', contato: 'Lucas Moreira', email: 'Lucas@Custeio.com' })).toMatchObject({ success: true, data: { email: 'lucas@custeio.com' } });
    expect(VendaNovaDoClienteSchema.safeParse({ contato: 'Lucas' }).success).toBe(false);
    expect(VendaNovaDoClienteSchema.safeParse({ ref: 'funil:1234-5678', email: 'sem-arroba' }).success).toBe(false);
    expect(VendaNovaDoClienteSchema.safeParse({ ref: 'funil:1234-5678', partnerId: 'x' }).success).toBe(false);
  });
});
