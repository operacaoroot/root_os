/**
 * A ESPINHA DO COCKPIT (lane A, 13/10/2026) — a parte pura.
 *
 * O que se prova sem banco:
 *   · a ficha é projeção: cada campo sai do payload de um evento, nada é
 *     inventado, marco de "primeira vez" não é sobrescrito e proposta velha não
 *     volta as condições;
 *   · o alvo de etapa vem dos FATOS, e quem decide se o lead chega é o portão;
 *   · o portão recusa com a lista exata do que falta;
 *   · a configuração sem linha devolve os padrões da regra vigente (tudo falso,
 *     números [a decidir] = nulos, autonomia A0);
 *   · o lead parado abre uma decisão por período, não uma por passagem.
 */
import { describe, expect, it } from 'vitest';

import { COMERCIAL_ESTAGIOS, COMERCIAL_EVENTOS, LEAD_STATUS_DA_ETAPA, ComercialConfigSchema } from '@mktos/shared';

import { CONFIG_COMERCIAL_PADRAO, autonomiaDe, configDaLinha } from '../src/comercial/config.service';
import { SEM_PRAZO, decisaoSemPrazo, inicioDoDiaEmSaoPaulo } from '../src/comercial/decisoes.service';
import { camposDoEvento, estadoDaFicha } from '../src/comercial/ficha.service';
import { avancar, faltaParaSair } from '../src/comercial/portoes';
import { EVENTOS_QUE_PROJETAM, etapaPelosFatos } from '../src/comercial/reacoes-da-espinha';
import { periodoDoLeadParado } from '../src/comercial/relogio-da-espinha';

const EM = new Date('2026-10-13T12:00:00Z');

describe('a ficha é projeção do fio', () => {
  it('o formulário vira sistema, base, empresa e o produto-alvo; nada além do que veio', () => {
    const c = camposDoEvento('form.respondido', { sistema: 'Omie', baseOrganizada: true, maiorDor: 'fechamento em 9 dias', equipeFinanceiro: 3 }, EM, {});
    expect(c).toEqual({ sistemaErp: 'Omie', baseDados: true, produto: 'operacao' });
    const semBase = camposDoEvento('form.respondido', { sistema: 'planilhas', baseOrganizada: false, maiorDor: 'x', equipeFinanceiro: 1, empresa: 'Studio Lume' }, EM, {});
    expect(semBase).toEqual({ sistemaErp: 'planilhas', baseDados: false, empresa: 'Studio Lume', produto: 'imersao' });
    // Produto já escolhido não é trocado pela regra do qualificador.
    expect(camposDoEvento('form.respondido', { sistema: 'Omie', baseOrganizada: true }, EM, { produto: 'imersao' })).not.toHaveProperty('produto');
  });

  it('a primeira leitura da proposta é marco: a segunda não sobrescreve', () => {
    expect(camposDoEvento('proposta.lida', { versao: 1, bloco: 'ouvimos', visita: 1 }, EM, {})).toEqual({ propostaLidaPelaPrimeiraVezEm: EM });
    expect(camposDoEvento('proposta.lida', { versao: 1, bloco: 'custos', visita: 2 }, EM, { propostaLidaPelaPrimeiraVezEm: new Date('2026-10-10T00:00:00Z') })).toBeNull();
  });

  it('proposta de versão menor não volta as condições da vigente', () => {
    const v1 = { versao: 1, produto: 'operacao', valorCentavos: 1_199_700, parcelas: 3, parcelaCentavos: 399_900, formas: ['pix'], validaAte: '2026-10-20T00:00:00Z', dentroDaTabela: true, laudo: { ok: true, apontamentos: [] }, hash: 'a'.repeat(64) };
    expect(camposDoEvento('proposta.publicada', v1, EM, { propostaVersao: 2 })).toBeNull();
    const c = camposDoEvento('proposta.publicada', { ...v1, versao: 2, quadroDeCustos: { mesNormalCentavos: 10_000, piorMesCentavos: 20_000 } }, EM, { propostaVersao: 1 });
    expect(c).toMatchObject({ propostaVersao: 2, valorCentavos: 1_199_700, parcelas: 3, produto: 'operacao', quadroDeCustos: { mesNormalCentavos: 10_000 } });
  });

  it('proposta publicada direto da sessão marca a rota de proposta direta', () => {
    const p = { versao: 1, produto: 'imersao', valorCentavos: 297_000, parcelas: 10, parcelaCentavos: 29_700, formas: ['cartao'], validaAte: null, dentroDaTabela: true, laudo: { ok: true, apontamentos: [] }, hash: 'b'.repeat(64) };
    expect(camposDoEvento('proposta.publicada', p, EM, { etapa: 'sessao' })).toHaveProperty('rota', 'proposta_direta');
    expect(camposDoEvento('proposta.publicada', p, EM, { etapa: 'diagnostico', rota: 'diagnostico' })).not.toHaveProperty('rota');
  });

  it('evento sem campo de ficha não escreve nada (decisão, etapa, mensagem)', () => {
    for (const t of ['decisao.aberta', 'decisao.tomada', 'etapa.mudou', 'whats.enviada', 'vigia.premissa']) {
      expect(camposDoEvento(t, { qualquer: 1 }, EM, {}), t).toBeNull();
    }
  });

  it('o canal da entrada não sobrescreve um canal já conhecido', () => {
    expect(camposDoEvento('lead.chegou', { telefone: '5532999999999', texto: 'oi', canal: 'conteudo' }, EM, {})).toEqual({ canal: 'conteudo' });
    expect(camposDoEvento('lead.chegou', { telefone: '5532999999999', texto: 'oi', canal: 'site' }, EM, { canal: 'indicacao' })).toBeNull();
    expect(camposDoEvento('lead.chegou', { telefone: '5532999999999', texto: 'oi' }, EM, {})).toBeNull();
  });

  it('todo evento que projeta é do catálogo e tem campo para escrever', () => {
    for (const t of EVENTOS_QUE_PROJETAM) {
      expect((COMERCIAL_EVENTOS as readonly string[]).includes(t), t).toBe(true);
    }
    expect(EVENTOS_QUE_PROJETAM).toContain('form.respondido');
    expect(EVENTOS_QUE_PROJETAM).not.toContain('saida.registrada'); // a saída tem reação própria (podeSair)
  });
});

describe('o alvo vem dos fatos; o portão decide', () => {
  it('a etapa mais adiantada que os fatos sustentam', () => {
    expect(etapaPelosFatos({})).toBe('novo_lead');
    expect(etapaPelosFatos({ sistemaErp: 'Omie' })).toBe('qualificacao');
    expect(etapaPelosFatos({ baseDados: false })).toBe('qualificacao');
    expect(etapaPelosFatos({ sistemaErp: 'Omie', reuniaoEm: EM })).toBe('reuniao_agendada');
    expect(etapaPelosFatos({ ataHash: 'h' })).toBe('sessao');
    expect(etapaPelosFatos({ ataHash: 'h', diagnostico: { dores: [] } })).toBe('diagnostico');
    expect(etapaPelosFatos({ propostaPublicadaEm: EM })).toBe('proposta');
    expect(etapaPelosFatos({ propostaLidaPelaPrimeiraVezEm: EM })).toBe('follow_up');
    expect(etapaPelosFatos({ propostaAceitaEm: EM })).toBe('contrato');
    expect(etapaPelosFatos({ clienteAtivoEm: EM, propostaAceitaEm: EM })).toBe('fechado');
  });

  it('avancar recusa com a lista exata do que falta', () => {
    const v = avancar({ etapa: 'novo_lead', nome: 'Marina', telefone: '5532999999999' }, 'qualificacao');
    expect(v.ok).toBe(false);
    expect(v.faltando).toEqual(['canal de entrada', 'perfil P1, P2 ou P3 pontuado', 'dono do lead']);
    expect(avancar({ etapa: 'novo_lead', nome: 'Marina', telefone: '5532999999999' }, 'reuniao_agendada').faltando[0]).toMatch(/não se pula etapa/);
    expect(avancar({ etapa: 'proposta' }, 'qualificacao').faltando[0]).toMatch(/registre uma saída/);
  });

  it('a ficha montada para o portão lê o cadastro do aceite e o laudo da proposta', () => {
    const ficha = {
      etapa: 'contrato',
      canal: 'conteudo',
      cadastro: { cnpj: '12345678000199', endereco: 'Rua A, 1', quemAssina: 'Marina Duarte', email: 'marina@alicerce.local' },
      quadroDeCustos: { mesNormalCentavos: 1 },
      contratoAssinadoClienteEm: EM,
      contratoAssinadoRootEm: null,
      cobrancaCriadaEm: EM,
    } as never;
    const e = estadoDaFicha(ficha, { name: 'Marina', phone: '5532999999999' }, true);
    expect(e.cnpj).toBe('12345678000199');
    expect(e.quadroDeCustos).toBe(true);
    expect(e.laudoDoRevisorOk).toBe(true);
    expect(faltaParaSair(e)).toEqual(['contrato assinado pela Root']);
  });

  it('Lead.status segue o mapa fixo em todo estágio', () => {
    for (const etapa of COMERCIAL_ESTAGIOS) {
      expect(['novo', 'qualificado', 'oportunidade', 'reuniao', 'proposta', 'ganho', 'perdido']).toContain(LEAD_STATUS_DA_ETAPA[etapa]);
    }
    expect(LEAD_STATUS_DA_ETAPA.fechado).toBe('ganho');
    expect(LEAD_STATUS_DA_ETAPA.geladeira).toBe('qualificado');
  });
});

describe('a configuração nasce com a regra vigente', () => {
  it('sem linha: interruptores falsos, números nulos ([a decidir]), autonomia no degrau vigente da régua', () => {
    const c = configDaLinha(null);
    expect(c.gravada).toBe(false);
    expect(c.envioAutomatico).toBe(false);
    expect(c.fechamentoAutomatico).toBe(false);
    expect(c.silencioAprova).toBe(false);
    for (const k of ['janelaDeVetoMinutos', 'fupLeuDias', 'fupSilencioDias', 'prazoDiagnosticoDiasUteis', 'validadePropostaDias', 'leadParadoDias', 'decisaoExpiraHoras', 'horaPublicacaoProposta', 'cobrancaSemWebhookDias', 'efeitoRetidoHoras'] as const) {
      expect(c[k], k).toBeNull();
    }
    // Lane E, fase 2: sem nível gravado vale o degrau que a régua já dá (R4 → A2), nunca A0.
    expect(autonomiaDe(c, 'fechador')).toBe('A2');
    expect(c.valoresDeHomologacao).toBe(false);
    expect(Object.isFrozen(CONFIG_COMERCIAL_PADRAO)).toBe(true);
  });

  it('a autonomia gravada torta é ignorada, nunca promovida', () => {
    const c = configDaLinha({ envioAutomatico: false, fechamentoAutomatico: false, silencioAprova: false, autonomia: { vigia: 'A3', fechador: 'A9', inexistente: 'A2' }, valoresDeHomologacao: true, atualizadoEm: EM } as never);
    expect(c.autonomia).toEqual({ vigia: 'A3' });
    expect(autonomiaDe(c, 'fechador')).toBe('A2');
  });

  it('o esquema recusa chave desconhecida e número fora da faixa', () => {
    expect(ComercialConfigSchema.safeParse({ envioAutomatico: true, inventado: 1 }).success).toBe(false);
    expect(ComercialConfigSchema.safeParse({ leadParadoDias: 0 }).success).toBe(false);
    expect(ComercialConfigSchema.safeParse({ leadParadoDias: null }).success).toBe(true);
  });
});

describe('o relógio e o prazo', () => {
  it('o lead parado abre uma decisão por período de N dias, com a chave do período', () => {
    const desde = new Date('2026-10-01T10:00:00Z');
    expect(periodoDoLeadParado('proposta', desde, new Date('2026-10-03T10:00:00Z'), 3)).toBeNull();
    const a = periodoDoLeadParado('proposta', desde, new Date('2026-10-04T11:00:00Z'), 3);
    const b = periodoDoLeadParado('proposta', desde, new Date('2026-10-06T09:00:00Z'), 3);
    const c = periodoDoLeadParado('proposta', desde, new Date('2026-10-07T11:00:00Z'), 3);
    expect(a).toBe('proposta:2026-10-01:p1');
    expect(b).toBe(a); // mesma janela: a mesma decisão
    expect(c).toBe('proposta:2026-10-01:p2'); // período novo: pergunta de novo
  });

  it('sem prazo configurado a decisão não vence sozinha', () => {
    expect(decisaoSemPrazo(SEM_PRAZO)).toBe(true);
    expect(decisaoSemPrazo(new Date('2026-10-14T00:00:00Z'))).toBe(false);
  });

  it('o dia de São Paulo começa às 03:00 UTC', () => {
    expect(inicioDoDiaEmSaoPaulo(new Date('2026-10-13T02:00:00Z')).toISOString()).toBe('2026-10-12T03:00:00.000Z');
    expect(inicioDoDiaEmSaoPaulo(new Date('2026-10-13T15:00:00Z')).toISOString()).toBe('2026-10-13T03:00:00.000Z');
  });
});
