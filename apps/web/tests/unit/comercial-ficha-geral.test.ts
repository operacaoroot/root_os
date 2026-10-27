/*
 * A FICHA GERAL E O FUNIL FLUIDO (leva 5, L4/L5/L2, 27/10/2026): as regras puras.
 *   · os campos da ficha geral e o que conta como "falta preencher";
 *   · o PATCH da ficha (o que a API aceita e recusa);
 *   · a lista fechada "Como conheceu" convivendo com os canais do C07;
 *   · o funil fluido: a confirmação de E8/E9, o cartão otimista, o estado local
 *     por cima da lista da API e quando ele sai;
 *   · o menu do lead: o que a pessoa pode fazer e os destinos do "mover".
 */
import { describe, expect, it } from 'vitest';
import {
  CANAIS_ACEITOS_NA_FICHA,
  COMERCIAL_CANAIS_DE_ENTRADA,
  COMO_CONHECEU,
  FichaGeralPatchSchema,
  NotaManualSchema,
  camposVazios,
  canalPedeOrigemDaIndicacao,
  destinoDoMover,
  lerVariante,
  rotuloDoCanal,
  valoresDaFichaGeral,
  type CartaoDoFunil,
  type ComercialResultadoDoMover,
  type FichaGeralExtra,
  type FunilVivo,
} from '@mktos/shared';

import { aplicarMovimentosLocais, avisoDaConfirmacao, cartaoDepoisDoMover, cartaoOtimista, locaisQueAindaValem, precisaDeConfirmacao } from '@/app/comercial/_funil/mover';
import { destinosDoMenuDoLead, razaoParaNaoFazerNoLead } from '@/app/comercial/_funil/MenuDoLead';
import { lerReais } from '@/app/comercial/_painel/AbaGeral';

const ficha = {
  nome: 'Marina Duarte', empresa: 'Construtora Alicerce', telefone: null, email: null, canal: 'indicacao_cliente', origemIndicacao: null,
  vendedor: null, socioDaConta: null, produto: null, tipoNegocio: 'pagante' as const, valorNegociadoCentavos: null, parcelas: null, etapa: 'follow_up' as const,
};
const extra: FichaGeralExtra = { leadId: 'l1', tipoDePessoa: null, preferenciasDeAtendimento: null, parcelaCentavos: null, proposta: { origem: 'sala', link: null, ref: null, versao: 2 }, negocioTravado: false };

describe('a ficha geral: campos e o que falta preencher', () => {
  it('lista os vazios na ordem dos cartões; tipo do negócio e etapa nunca contam; a origem da indicação só com canal de indicação', () => {
    const vazios = camposVazios(ficha, extra).map((c) => c.chave);
    expect(vazios).toEqual(['tipoDePessoa', 'telefone', 'email', 'preferenciasDeAtendimento', 'origemIndicacao', 'vendedorId', 'socioDaConta', 'produto', 'valorNegociado', 'parcelas', 'parcela']);
    expect(vazios).not.toContain('tipoNegocio');
    expect(vazios).not.toContain('etapa');
    // A proposta da sala (v2) preenche o link.
    expect(vazios).not.toContain('linkDaProposta');
    expect(camposVazios({ ...ficha, canal: 'site' }, extra).map((c) => c.chave)).not.toContain('origemIndicacao');
  });

  it('sem o extra, os campos dele não são cobrados (a tela não cobra o que ainda não leu); extra pela metade não lança', () => {
    const semExtra = camposVazios(ficha, null).map((c) => c.chave);
    for (const c of ['tipoDePessoa', 'preferenciasDeAtendimento', 'parcela', 'linkDaProposta']) expect(semExtra).not.toContain(c);
    expect(() => valoresDaFichaGeral(ficha, {} as FichaGeralExtra)).not.toThrow();
    expect(valoresDaFichaGeral(ficha, { ...extra, proposta: { origem: 'servico', link: null, ref: 'servico:cli/escopo', versao: null } }).linkDaProposta).toBe('servico:cli/escopo');
    expect(valoresDaFichaGeral(ficha, { ...extra, proposta: { origem: 'manual', link: 'https://x', ref: null, versao: null } }).linkDaProposta).toBe('https://x');
  });

  it('"como conheceu": a lista nova vai na coluna canal e os três canais antigos seguem legíveis e aceitos', () => {
    expect([...COMO_CONHECEU]).toEqual(['indicacao_cliente', 'indicacao_parceiro', 'bni', 'evento', 'rede_social', 'site', 'comunidade', 'outro']);
    for (const c of COMERCIAL_CANAIS_DE_ENTRADA) expect(CANAIS_ACEITOS_NA_FICHA).toContain(c);
    expect(rotuloDoCanal('bni')).toBe('BNI');
    expect(rotuloDoCanal('erp_parceiro')).toBe('ERP parceiro');
    expect(rotuloDoCanal('desconhecido')).toBe('desconhecido');
    expect(canalPedeOrigemDaIndicacao('indicacao')).toBe(true);
    expect(canalPedeOrigemDaIndicacao('indicacao_parceiro')).toBe(true);
    expect(canalPedeOrigemDaIndicacao('bni')).toBe(false);
  });

  it('o PATCH da ficha: vazio vira nulo, e-mail e link tortos são recusados, campo a mais é recusado, reais são número', () => {
    expect(FichaGeralPatchSchema.safeParse({ email: '' }).success && FichaGeralPatchSchema.parse({ email: '' }).email).toBeNull();
    expect(FichaGeralPatchSchema.safeParse({ email: 'sem-arroba' }).success).toBe(false);
    expect(FichaGeralPatchSchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
    expect(FichaGeralPatchSchema.safeParse({ linkDaProposta: 'http://inseguro' }).success).toBe(false);
    expect(FichaGeralPatchSchema.safeParse({ linkDaProposta: 'https://proposta.operacaoroot.com/x/y' }).success).toBe(true);
    expect(FichaGeralPatchSchema.safeParse({ tipoDePessoa: 'XX' }).success).toBe(false);
    expect(FichaGeralPatchSchema.safeParse({ tipoDePessoa: 'PJ', valorNegociado: 1200.5, parcelas: 10, parcela: 120.05 }).success).toBe(true);
    expect(FichaGeralPatchSchema.safeParse({ parcelas: 0 }).success).toBe(false);
    expect(FichaGeralPatchSchema.safeParse({ nome: '' }).success).toBe(false);
    expect(FichaGeralPatchSchema.safeParse({ etapa: 'fechado' }).success).toBe(false); // a etapa é do mover
    expect(FichaGeralPatchSchema.safeParse({ proximaAcaoTexto: 'x' }).success).toBe(false); // a régua protege
  });

  it('a nota manual pede texto; "feito" é a chave do passo; a variante lida do navegador cai na A', () => {
    expect(NotaManualSchema.safeParse({ texto: '  ' }).success).toBe(false);
    expect(NotaManualSchema.safeParse({ texto: 'feito: ligar', feito: 'proxima:resposta' }).success).toBe(true);
    expect(lerVariante('B')).toBe('B');
    expect(lerVariante('qualquer')).toBe('A');
    expect(lerVariante(null)).toBe('A');
  });

  it('reais da tela: "1.200,50" e "1200.50" valem 1200.5; vazio é nulo', () => {
    expect(lerReais('1.200,50')).toBe(1200.5);
    expect(lerReais('1200.50')).toBe(1200.5);
    expect(lerReais('R$ 297')).toBe(297);
    expect(lerReais('')).toBeNull();
  });
});

const cartao = (leadId: string, etapa: CartaoDoFunil['etapa']): CartaoDoFunil => ({
  leadId, nome: leadId, empresa: null, etapa, saude: null, proximaAcao: null, precisaDeDecisao: false, parado: false, diasNaEtapa: 3,
  motivoSaida: null, voltaEm: null, perfil: null, produto: null, voltaPara: null, balao: { pendencias: ['x'], movidoPor: null, em: '2026-10-20T00:00:00.000Z' },
});
const colunas = (...cs: CartaoDoFunil[]): FunilVivo['colunas'] => [
  { etapa: 'novo_lead', rotulo: 'E1', cartoes: cs.filter((c) => c.etapa === 'novo_lead') },
  { etapa: 'qualificacao', rotulo: 'E2', cartoes: cs.filter((c) => c.etapa === 'qualificacao') },
  { etapa: 'saidas', rotulo: 'Saídas', cartoes: cs.filter((c) => c.etapa === 'perdido') },
];

describe('L5: o funil fluido', () => {
  it('E8 e E9 pedem confirmação com o aviso da regra; as outras etapas não; a saída tem caminho próprio', () => {
    expect(precisaDeConfirmacao(destinoDoMover('proposta', 'contrato'))).toBe(true);
    expect(precisaDeConfirmacao(destinoDoMover('contrato', 'fechado'))).toBe(true);
    expect(precisaDeConfirmacao(destinoDoMover('proposta', 'qualificacao'))).toBe(false);
    expect(precisaDeConfirmacao(destinoDoMover('proposta', 'perdido'))).toBe(false);
    expect(avisoDaConfirmacao(destinoDoMover('proposta', 'contrato'))).toMatch(/só a etapa muda: o contrato e a cobrança nascem do aceite/);
  });

  it('o cartão otimista anda para a etapa, zera a idade e tira o balão; a resposta do mover devolve o balão e o aviso da API', () => {
    const agora = new Date('2026-10-27T12:00:00.000Z');
    const c = cartao('a', 'novo_lead');
    const o = cartaoOtimista(c, 'qualificacao', agora);
    expect(o).toMatchObject({ etapa: 'qualificacao', diasNaEtapa: 0, parado: false, balao: null, avisoDoMover: null, etapaDesde: agora.toISOString() });
    expect(cartaoOtimista(c, 'geladeira', agora).voltaPara).toBe('novo_lead');
    const r: ComercialResultadoDoMover = { ok: true, mudou: true, de: 'novo_lead', para: 'qualificacao', balao: { pendencias: ['dono do lead (E1)'], movidoPor: 'Ana', em: agora.toISOString() }, pendencias: ['dono do lead (E1)'], semConclusoesDe: ['novo_lead'], mensagem: 'Movido.', aviso: 'Só a etapa mudou.' };
    const d = cartaoDepoisDoMover(c, r, agora);
    expect(d.balao?.pendencias).toEqual(['dono do lead (E1)']);
    expect(d.avisoDoMover?.texto).toBe('Só a etapa mudou.');
  });

  it('o estado local põe o cartão na coluna de destino (no fim) e o tira da antiga; coluna sem cartões não derruba', () => {
    const a = cartao('a', 'novo_lead');
    const b = cartao('b', 'novo_lead');
    const movido = cartaoOtimista(a, 'qualificacao');
    const vistas = aplicarMovimentosLocais(colunas(a, b, cartao('c', 'qualificacao')), { a: movido });
    expect(vistas[0].cartoes.map((c) => c.leadId)).toEqual(['b']);
    expect(vistas[1].cartoes.map((c) => c.leadId)).toEqual(['c', 'a']);
    // Sem a coluna de destino na tela (leitura filtrada), o cartão fica onde a API o tem: a lista volta intacta.
    const soE1 = [{ etapa: 'novo_lead', rotulo: 'E1', cartoes: [a] } as FunilVivo['colunas'][number]];
    expect(aplicarMovimentosLocais(soE1, { a: movido })).toBe(soE1);
    expect(() => aplicarMovimentosLocais([{ etapa: 'novo_lead', rotulo: 'E1' } as unknown as FunilVivo['colunas'][number]], { a: movido })).not.toThrow();
    // A saída vai à coluna Saídas.
    expect(aplicarMovimentosLocais(colunas(a), { a: cartaoOtimista(a, 'perdido') })[2].cartoes.map((c) => c.leadId)).toEqual(['a']);
    // Sem movimentos, a lista é a da API, intacta.
    const originais = colunas(a, b);
    expect(aplicarMovimentosLocais(originais, {})).toBe(originais);
  });

  it('o movimento local sai quando a API já mostra o cartão na etapa nova; fica enquanto ela mostra a antiga; some se o cartão saiu da leitura', () => {
    const a = cartao('a', 'novo_lead');
    const locais = { a: cartaoOtimista(a, 'qualificacao') };
    expect(locaisQueAindaValem(colunas(a), locais)).toEqual(locais); // a API ainda tem o cartão em E1
    expect(locaisQueAindaValem(colunas(cartao('a', 'qualificacao')), locais)).toEqual({}); // a API alcançou
    expect(locaisQueAindaValem(colunas(cartao('b', 'novo_lead')), locais)).toEqual({}); // saiu do filtro: nada a sobrepor
  });
});

describe('L2: o menu do lead', () => {
  it('abrir e histórico valem para todo mundo; o resto pede gente com leads.editar', () => {
    const gente = { podeEditar: true, ehGente: true };
    for (const a of ['abrir', 'mover', 'copiar-link-da-sala', 'vincular-whatsapp', 'editar-valor', 'historico'] as const) expect(razaoParaNaoFazerNoLead(a, gente)).toBeNull();
    expect(razaoParaNaoFazerNoLead('mover', { podeEditar: false, ehGente: true })).toMatch(/leads\.editar/);
    expect(razaoParaNaoFazerNoLead('copiar-link-da-sala', { podeEditar: true, ehGente: false })).toMatch(/gente/);
    expect(razaoParaNaoFazerNoLead('abrir', { podeEditar: false, ehGente: false })).toBeNull();
  });

  it('os destinos do "mover": todas as etapas e saídas menos a atual; sem a etapa conhecida, todas, e a saída continua pedindo motivo', () => {
    const com = destinosDoMenuDoLead({ etapa: 'proposta' });
    expect(com.map((d) => d.para)).not.toContain('proposta');
    expect(com.find((d) => d.para === 'contrato')?.dica).toMatch(/só a etapa muda/);
    const sem = destinosDoMenuDoLead({});
    expect(sem).toHaveLength(13);
    expect(sem.find((d) => d.para === 'perdido')?.caminho).toBe('saida');
    expect(sem.every((d) => d.permitido)).toBe(true);
  });
});
