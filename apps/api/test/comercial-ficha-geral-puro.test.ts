/*
 * A FICHA GERAL E AS PENDÊNCIAS DO LEAD (leva 5, L4, 27/10/2026) — a parte pura, sem banco.
 *   · os próximos passos derivados do que já está gravado (próxima ação, portão,
 *     decisão, automação que falhou, fatos de pendência) e a nota "feito" que esconde o passo;
 *   · o fato `nota.manual` no catálogo, com fonte e resumo;
 *   · o PATCH da ficha e a nota manual (os schemas do shared).
 */
import { describe, expect, it } from 'vitest';
import { COMERCIAL_EVENTOS, FichaGeralPatchSchema, NotaManualSchema, type FichaDoLead } from '@mktos/shared';

import { FONTE_DO_EVENTO, resumoDoEvento, TIPOS_DO_CATALOGO } from '../src/comercial/eventos';
import { passoFoiFeito, passosDoLead, type EntradaDosPassos } from '../src/comercial/pendencias-do-lead';
import { NEGOCIO_TRAVADO } from '../src/comercial/ficha-geral.service';

const AGORA = new Date('2026-10-27T12:00:00.000Z');
const ONTEM = new Date('2026-10-26T12:00:00.000Z');
const ANTEONTEM = new Date('2026-10-25T12:00:00.000Z');

function ficha(extra: Partial<EntradaDosPassos['ficha']> = {}): EntradaDosPassos['ficha'] {
  return {
    etapa: 'qualificacao',
    etapaDesde: ONTEM.toISOString(),
    proximaAcao: null,
    portao: { proxima: 'reuniao_agendada', faltando: [], itens: [] },
    ...extra,
  } as EntradaDosPassos['ficha'];
}

function entrada(e: Partial<EntradaDosPassos> = {}): EntradaDosPassos {
  return { ficha: ficha(), decisoes: [], reacoesComErro: [], fatos: [], notas: [], agora: AGORA, ...e };
}

describe('os próximos passos do lead', () => {
  it('a próxima ação da ficha vira passo com o destino do "fazer"; vencida vem primeiro', () => {
    const { passos } = passosDoLead(
      entrada({
        ficha: ficha({ proximaAcao: { tipo: 'ata', quando: ANTEONTEM.toISOString(), descricao: 'subir a ata da conversa' } }),
        decisoes: [{ id: 'd1', titulo: 'pediu desconto', expiraEm: new Date('2026-10-30T12:00:00.000Z'), criadaEm: ONTEM }],
      }),
    );
    expect(passos[0]).toMatchObject({ chave: 'proxima:ata', titulo: 'subir a ata da conversa', origem: 'proxima_acao', vencido: true, acao: { tipo: 'aba', aba: 'sessao' } });
    expect(passos[1]).toMatchObject({ chave: 'decisao:d1', origem: 'decisao', vencido: false, acao: { tipo: 'link', href: '/caixa?aba=decisoes' } });
  });

  it('a decisão aberta não entra duas vezes: a próxima ação do tipo decisão é pulada (a decisão vem com o link da fila)', () => {
    const { passos } = passosDoLead(
      entrada({
        ficha: ficha({ proximaAcao: { tipo: 'decisao', quando: null, descricao: 'decisão na fila: x' } }),
        decisoes: [{ id: 'd1', titulo: 'x', expiraEm: null, criadaEm: ONTEM }],
      }),
    );
    expect(passos.map((p) => p.chave)).toEqual(['decisao:d1']);
  });

  it('o portão da próxima etapa: cada item que falta vira passo, e o que é campo da ficha geral leva ao campo', () => {
    const { passos } = passosDoLead(
      entrada({
        ficha: ficha({
          portao: {
            proxima: 'reuniao_agendada',
            faltando: ['WhatsApp do contato', 'sistema ou ERP em uso'],
            itens: [
              { chave: 'whatsapp', rotulo: 'WhatsApp do contato', cumprido: false },
              { chave: 'sistema', rotulo: 'sistema ou ERP em uso', cumprido: false },
              { chave: 'nome', rotulo: 'nome do contato', cumprido: true },
            ],
          },
        }),
      }),
    );
    expect(passos.map((p) => p.chave)).toEqual(['portao:reuniao_agendada:whatsapp', 'portao:reuniao_agendada:sistema']);
    expect(passos[0]).toMatchObject({ titulo: 'Para avançar a E3 · Reunião agendada: WhatsApp do contato', acao: { tipo: 'aba', aba: 'geral', campo: 'telefone' } });
    expect(passos[1].acao).toEqual({ tipo: 'aba', aba: 'whatsapp' });
  });

  it('a automação que não concluiu vira o passo "fazer à mão" (e "subir documento" quando mexe com documento), antes dos demais', () => {
    const { passos } = passosDoLead(
      entrada({
        ficha: ficha({ proximaAcao: { tipo: 'proposta', quando: null, descricao: 'o construtor monta a proposta pela tabela' } }),
        reacoesComErro: [
          { eventoId: 'e1', reacao: 'inteligencia.proposta', erro: 'o modelo não respondeu', criadoEm: ONTEM, tipoDoEvento: 'diagnostico.pronto' },
          { eventoId: 'e2', reacao: 'contrato.na_pasta', erro: 'Drive sem permissão', criadoEm: ONTEM, tipoDoEvento: 'contrato.assinado' },
        ],
      }),
    );
    expect(passos.map((p) => p.chave)).toEqual(['automacao:e1:inteligencia.proposta', 'automacao:e2:contrato.na_pasta', 'proxima:proposta']);
    expect(passos[0]).toMatchObject({ origem: 'automacao', detalhe: 'o modelo não respondeu', podeFazerAMao: true, podeSubirDocumento: false, vencido: true });
    expect(passos[0].titulo).toContain('depois de "diagnostico.pronto"');
    expect(passos[1].podeSubirDocumento).toBe(true);
  });

  it('os fatos de pendência: só o último de cada família conta, e só se ainda diz erro; o cliente a conciliar sai quando o cliente fica ativo', () => {
    const fato = (type: string, payload: unknown, occurredAt: Date) => ({ type, payload, occurredAt });
    const { passos } = passosDoLead(
      entrada({
        fatos: [
          fato('fechamento.escrita', { chave: 'k', escrita: 'contrato', estado: 'erro' }, ANTEONTEM),
          fato('fechamento.escrita', { chave: 'k', escrita: 'contrato', estado: 'criado' }, ONTEM), // consertou: não é mais pendência
          fato('fechamento.escrita', { chave: 'k', escrita: 'kit_e_trilho', estado: 'erro' }, ONTEM),
          fato('pasta.do_cliente', { partnerId: 'p', origem: 'fechamento', estado: 'erro', motivo: 'sem raiz configurada' }, ONTEM),
          fato('documento.na_pasta', { origem: 'contrato', ref: 'r', estado: 'ok', subpasta: null, nome: null, motivo: null }, ONTEM),
          fato('cliente.a_conciliar', { chave: 'k', partnerDaFicha: 'a', partnerDoFechamento: 'b', motivo: 'mesmo CNPJ' }, ANTEONTEM),
          fato('cliente.ativo', { importado: false }, ONTEM),
        ],
      }),
    );
    expect(passos.map((p) => p.chave).sort()).toEqual(['fato:fechamento:kit_e_trilho', 'fato:pasta.do_cliente']);
    expect(passos.find((p) => p.chave === 'fato:pasta.do_cliente')).toMatchObject({ detalhe: 'sem raiz configurada', podeFazerAMao: true, podeSubirDocumento: true, acao: null });
    expect(passos.find((p) => p.chave === 'fato:fechamento:kit_e_trilho')).toMatchObject({ podeSubirDocumento: true, acao: { tipo: 'aba', aba: 'dinheiro' } });
  });

  it('"marcar como feito" esconde o passo só com nota posterior a ele; o passo que nasce de novo volta', () => {
    const base = entrada({
      ficha: ficha({ proximaAcao: { tipo: 'resposta', quando: null, descricao: 'esperar a resposta do cliente' } }),
      reacoesComErro: [{ eventoId: 'e1', reacao: 'x', erro: null, criadoEm: AGORA, tipoDoEvento: null }],
    });
    // Nota anterior à etapa (ANTEONTEM < etapaDesde ONTEM): não esconde.
    expect(passosDoLead({ ...base, notas: [{ feito: 'proxima:resposta', occurredAt: ANTEONTEM }] }).passos.map((p) => p.chave)).toContain('proxima:resposta');
    // Nota de agora: esconde e conta em `feitos`.
    const r = passosDoLead({ ...base, notas: [{ feito: 'proxima:resposta', occurredAt: AGORA }] });
    expect(r.passos.map((p) => p.chave)).toEqual(['automacao:e1:x']);
    expect(r.feitos).toBe(1);
    // A automação que falhou de novo DEPOIS da nota volta.
    expect(passoFoiFeito('automacao:e1:x', AGORA, [{ feito: 'automacao:e1:x', occurredAt: ONTEM }])).toBe(false);
    expect(passoFoiFeito('automacao:e1:x', ONTEM, [{ feito: 'automacao:e1:x', occurredAt: AGORA }])).toBe(true);
  });

  it('a geladeira sem data e a volta marcada levam ao campo da etapa; o cliente ativo leva aos contratos', () => {
    const geladeira = passosDoLead(entrada({ ficha: ficha({ etapa: 'geladeira', proximaAcao: { tipo: 'data_da_geladeira', quando: null, descricao: 'marcar a data' } }) })).passos[0];
    expect(geladeira.acao).toEqual({ tipo: 'aba', aba: 'geral', campo: 'etapa' });
    const vivo = passosDoLead(entrada({ ficha: ficha({ etapa: 'fechado', proximaAcao: { tipo: 'contrato_vivo', quando: null, descricao: 'cliente ativo' } }) })).passos[0];
    expect(vivo.acao).toEqual({ tipo: 'link', href: '/comercial/contratos' });
  });
});

describe('o fato nota.manual', () => {
  it('está no catálogo, tem fonte pessoa e o resumo diz se foi "feito à mão" ou só nota, com quem escreveu', () => {
    expect((COMERCIAL_EVENTOS as readonly string[]).includes('nota.manual')).toBe(true);
    expect(FONTE_DO_EVENTO['nota.manual']).toBe('pessoa');
    expect(resumoDoEvento('nota.manual', { texto: 'liguei e combinei a reunião', feito: null, referencia: null, por: 'Ana', porId: 'u1' })).toEqual({ fonte: 'pessoa', resumo: 'nota: liguei e combinei a reunião · por Ana' });
    expect(resumoDoEvento('nota.manual', { texto: 'kit montado', feito: 'automacao:e1:kit', referencia: null, por: null, porId: null }).resumo).toBe('feito à mão: kit montado');
  });

  it('nenhum tipo do catálogo ficou sem fonte', () => {
    for (const t of TIPOS_DO_CATALOGO) expect(FONTE_DO_EVENTO[t], t).toBeDefined();
  });
});

describe('o que a API aceita na ficha geral', () => {
  it('o PATCH recusa etapa, próxima ação e campo desconhecido; aceita os campos da Geral; vazio vira nulo', () => {
    expect(FichaGeralPatchSchema.safeParse({ etapa: 'fechado' }).success).toBe(false);
    expect(FichaGeralPatchSchema.safeParse({ proximaAcaoQuando: '2026-11-01' }).success).toBe(false);
    const r = FichaGeralPatchSchema.parse({ empresa: '', tipoDePessoa: 'PF', canal: 'bni', valorNegociado: 2970, parcela: 297, linkDaProposta: 'https://proposta.operacaoroot.com/x/y' });
    expect(r).toEqual({ empresa: null, tipoDePessoa: 'PF', canal: 'bni', valorNegociado: 2970, parcela: 297, linkDaProposta: 'https://proposta.operacaoroot.com/x/y' });
  });

  it('a nota manual pede texto; a frase do negócio travado cita o aceite e a aba Dinheiro', () => {
    expect(NotaManualSchema.safeParse({}).success).toBe(false);
    expect(NotaManualSchema.safeParse({ texto: 'ok', feito: 'x', extra: 1 }).success).toBe(false);
    expect(NEGOCIO_TRAVADO).toMatch(/aceite/);
    expect(NEGOCIO_TRAVADO).toMatch(/Dinheiro/);
  });
});
