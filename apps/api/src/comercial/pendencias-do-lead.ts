import { COMERCIAL_ROTULO_DA_ETAPA, type AcaoDoPasso, type FichaDoLead, type PassoSugerido } from '@mktos/shared';

/*
 * OS PRÓXIMOS PASSOS DO LEAD (leva 5, L4, 27/10/2026) — a parte pura.
 *
 * A aba "Pendências e sugestões" do painel lista o que a casa já sabe que
 * falta, sem inventar nada: a PRÓXIMA AÇÃO da ficha (`proxima-acao.ts`), o que
 * o PORTÃO da etapa ainda pede (`portoes.ts`), as DECISÕES abertas na fila, a
 * AUTOMAÇÃO que não concluiu (a linha `ComercialReacao` em `erro`, o passo que
 * travava o Rodrigo no item 14 da reunião) e os FATOS de pendência que o fio já
 * grava (escrita do fechamento em erro, pasta ou documento que não subiu,
 * cliente a conciliar).
 *
 * Cada passo tem uma CHAVE. "Marcar como feito" grava uma `nota.manual` no fio
 * com essa chave, e a lista esconde o passo enquanto a nota for posterior a ele
 * (`desde`): se o passo nascer de novo depois (a etapa mudou, a automação
 * falhou outra vez), ele volta. Nada aqui escreve: quem grava é o serviço.
 *
 * Sem banco e sem Nest: a suíte mede tudo isto sem subir nada.
 */

export interface DecisaoParaOsPassos {
  id: string;
  titulo: string;
  expiraEm: Date | null;
  criadaEm: Date;
}

export interface ReacaoComErro {
  eventoId: string;
  reacao: string;
  erro: string | null;
  criadoEm: Date;
  /** O tipo do fato que a reação tentou atender (para a frase). */
  tipoDoEvento: string | null;
}

export interface FatoParaOsPassos {
  type: string;
  payload: unknown;
  occurredAt: Date;
}

export interface NotaFeita {
  feito: string | null;
  occurredAt: Date;
}

export interface EntradaDosPassos {
  ficha: Pick<FichaDoLead, 'etapa' | 'etapaDesde' | 'proximaAcao' | 'portao'>;
  decisoes: readonly DecisaoParaOsPassos[];
  reacoesComErro: readonly ReacaoComErro[];
  fatos: readonly FatoParaOsPassos[];
  notas: readonly NotaFeita[];
  agora: Date;
}

/** Para onde o botão "fazer" leva, pelo tipo da próxima ação da ficha. Sem destino conhecido, fica só "marcar como feito". */
const ACAO_DA_PROXIMA: Readonly<Record<string, AcaoDoPasso>> = {
  formulario: { tipo: 'aba', aba: 'whatsapp' },
  agenda: { tipo: 'aba', aba: 'whatsapp' },
  vespera: { tipo: 'aba', aba: 'whatsapp' },
  reuniao: { tipo: 'aba', aba: 'whatsapp' },
  ata: { tipo: 'aba', aba: 'sessao' },
  diagnostico: { tipo: 'aba', aba: 'sessao' },
  aprovar_diagnostico: { tipo: 'aba', aba: 'sessao' },
  proposta: { tipo: 'aba', aba: 'sessao' },
  publicar_proposta: { tipo: 'aba', aba: 'sessao' },
  m5: { tipo: 'aba', aba: 'whatsapp' },
  m6: { tipo: 'aba', aba: 'whatsapp' },
  resposta: { tipo: 'aba', aba: 'whatsapp' },
  aceite_dados: { tipo: 'aba', aba: 'dinheiro' },
  cobranca: { tipo: 'aba', aba: 'dinheiro' },
  pix: { tipo: 'aba', aba: 'dinheiro' },
  assinatura_cliente: { tipo: 'aba', aba: 'dinheiro' },
  assinatura_root: { tipo: 'aba', aba: 'dinheiro' },
  fechamento: { tipo: 'aba', aba: 'dinheiro' },
  kickoff: { tipo: 'aba', aba: 'sala' },
  contrato_vivo: { tipo: 'link', href: '/comercial/contratos' },
  data_da_geladeira: { tipo: 'aba', aba: 'geral', campo: 'etapa' },
  volta_da_geladeira: { tipo: 'aba', aba: 'geral', campo: 'etapa' },
  decisao: { tipo: 'link', href: '/caixa?aba=decisoes' },
};

/** O item do portão que é campo da ficha geral leva ao campo; o resto, à aba onde se resolve. */
const ACAO_DO_PORTAO: Readonly<Record<string, AcaoDoPasso>> = {
  nome: { tipo: 'aba', aba: 'geral', campo: 'nome' },
  whatsapp: { tipo: 'aba', aba: 'geral', campo: 'telefone' },
  canal: { tipo: 'aba', aba: 'geral', campo: 'canal' },
  origem_indicacao: { tipo: 'aba', aba: 'geral', campo: 'origemIndicacao' },
  dono: { tipo: 'aba', aba: 'geral', campo: 'vendedorId' },
  socio_da_conta: { tipo: 'aba', aba: 'geral', campo: 'socioDaConta' },
  produto_alvo: { tipo: 'aba', aba: 'geral', campo: 'produto' },
  produto: { tipo: 'aba', aba: 'geral', campo: 'produto' },
  valor: { tipo: 'aba', aba: 'geral', campo: 'valorNegociado' },
  parcelas: { tipo: 'aba', aba: 'geral', campo: 'parcelas' },
  perfil: { tipo: 'aba', aba: 'sessao' },
  perfil_confirmado: { tipo: 'aba', aba: 'sessao' },
  sistema: { tipo: 'aba', aba: 'whatsapp' },
  base: { tipo: 'aba', aba: 'whatsapp' },
  reuniao: { tipo: 'aba', aba: 'whatsapp' },
  confirmacao: { tipo: 'aba', aba: 'whatsapp' },
  ata: { tipo: 'aba', aba: 'sessao' },
  rota: { tipo: 'aba', aba: 'sessao' },
  diagnostico_aprovado: { tipo: 'aba', aba: 'sessao' },
  quadro_de_custos: { tipo: 'aba', aba: 'sessao' },
  validade: { tipo: 'aba', aba: 'sessao' },
  laudo: { tipo: 'aba', aba: 'sessao' },
  resposta: { tipo: 'aba', aba: 'sala' },
  cnpj: { tipo: 'aba', aba: 'dinheiro' },
  endereco: { tipo: 'aba', aba: 'dinheiro' },
  quem_assina: { tipo: 'aba', aba: 'dinheiro' },
  assinado_cliente: { tipo: 'aba', aba: 'dinheiro' },
  assinado_root: { tipo: 'aba', aba: 'dinheiro' },
  cobranca: { tipo: 'aba', aba: 'dinheiro' },
};

/** A automação que mexe com documento ou pasta aceita "subir documento" como saída à mão. */
const AUTOMACAO_DE_DOCUMENTO = /contrato|pasta|documento|minuta|assinado|anexo/i;

/** A chave do portão a partir do rótulo, quando o item não trouxe chave (só o texto). */
function chaveDoItemDoPortao(item: { chave?: string; rotulo: string }): string {
  return item.chave ?? item.rotulo.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function vencido(quando: Date | null, agora: Date): boolean {
  return !!quando && quando.getTime() < agora.getTime();
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * A nota "feito" esconde o passo só se for POSTERIOR a ele: um passo que nasce
 * de novo (outra falha, outra etapa) volta à lista.
 */
export function passoFoiFeito(chave: string, desde: Date, notas: readonly NotaFeita[]): boolean {
  return notas.some((n) => n.feito === chave && n.occurredAt.getTime() >= desde.getTime());
}

/** Os fatos de pendência do fio: só o ÚLTIMO de cada família, e só se ele ainda diz "erro" ou "a conciliar". */
function passosDosFatos(fatos: readonly FatoParaOsPassos[]): PassoSugerido[] {
  const ordenados = [...fatos].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const ultimo = new Map<string, FatoParaOsPassos>();
  for (const f of ordenados) {
    const p = (f.payload ?? {}) as Record<string, unknown>;
    if (f.type === 'fechamento.escrita') ultimo.set(`fechamento:${String(p.escrita ?? '')}`, f);
    else if (f.type === 'pasta.do_cliente') ultimo.set('pasta.do_cliente', f);
    else if (f.type === 'documento.na_pasta') ultimo.set(`documento.na_pasta:${String(p.origem ?? '')}`, f);
    else if (f.type === 'cliente.a_conciliar') ultimo.set('cliente.a_conciliar', f);
    else if (f.type === 'implantacao.fechamento_registrado' || f.type === 'cliente.ativo') ultimo.delete('cliente.a_conciliar');
  }
  const passos: PassoSugerido[] = [];
  for (const [familia, f] of ultimo) {
    const p = (f.payload ?? {}) as Record<string, unknown>;
    const estado = String(p.estado ?? '');
    const comErro = estado === 'erro' || estado === 'falhou' || estado === 'recusada';
    if (f.type === 'cliente.a_conciliar') {
      passos.push({
        chave: `fato:${familia}`,
        titulo: 'Cliente a conciliar: o fechamento achou outro cadastro com o mesmo CNPJ',
        detalhe: typeof p.motivo === 'string' ? p.motivo : null,
        origem: 'fato',
        quando: null,
        vencido: false,
        desde: f.occurredAt.toISOString(),
        acao: { tipo: 'link', href: '/clientes' },
        podeFazerAMao: true,
        podeSubirDocumento: false,
      });
      continue;
    }
    if (!comErro) continue;
    const titulo =
      f.type === 'fechamento.escrita'
        ? `A escrita "${String(p.escrita ?? '')}" do fechamento não concluiu`
        : f.type === 'pasta.do_cliente'
          ? 'A pasta do cliente no Drive não foi criada'
          : `O documento (${String(p.origem ?? 'contrato')}) não subiu para a pasta do cliente`;
    passos.push({
      chave: `fato:${familia}`,
      titulo,
      detalhe: typeof p.motivo === 'string' ? p.motivo : typeof p.ref === 'string' ? `ref. ${p.ref}` : null,
      origem: 'fato',
      quando: null,
      vencido: false,
      desde: f.occurredAt.toISOString(),
      acao: f.type === 'fechamento.escrita' ? { tipo: 'aba', aba: 'dinheiro' } : null,
      podeFazerAMao: true,
      podeSubirDocumento: f.type !== 'fechamento.escrita' || /contrato|kit/i.test(String(p.escrita ?? '')),
    });
  }
  return passos;
}

/**
 * Os passos do lead, prontos para a tela: vencidos primeiro, depois as
 * automações que falharam, depois o resto pelo prazo (quem não tem prazo vai
 * para o fim). Os marcados como feitos saem e são contados em `feitos`.
 */
export function passosDoLead(e: EntradaDosPassos): { passos: PassoSugerido[]; feitos: number } {
  const desdeDaEtapa = new Date(e.ficha.etapaDesde);
  const lista: PassoSugerido[] = [];

  // 1. A próxima ação da ficha (a decisão aberta é listada à parte, com o link da fila).
  const pa = e.ficha.proximaAcao;
  if (pa && pa.tipo !== 'decisao') {
    const quando = pa.quando ? new Date(pa.quando) : null;
    lista.push({
      chave: `proxima:${pa.tipo}`,
      titulo: pa.descricao,
      detalhe: null,
      origem: 'proxima_acao',
      quando: iso(quando),
      vencido: vencido(quando, e.agora),
      desde: desdeDaEtapa.toISOString(),
      acao: ACAO_DA_PROXIMA[pa.tipo] ?? null,
      podeFazerAMao: false,
      podeSubirDocumento: false,
    });
  }

  // 2. O que o portão da próxima etapa ainda pede.
  const proxima = e.ficha.portao.proxima;
  for (const item of e.ficha.portao.itens.filter((i) => !i.cumprido)) {
    const chave = chaveDoItemDoPortao(item);
    lista.push({
      chave: `portao:${proxima ?? e.ficha.etapa}:${chave}`,
      titulo: proxima ? `Para avançar a ${COMERCIAL_ROTULO_DA_ETAPA[proxima]}: ${item.rotulo}` : `Falta: ${item.rotulo}`,
      detalhe: null,
      origem: 'portao',
      quando: null,
      vencido: false,
      desde: desdeDaEtapa.toISOString(),
      acao: ACAO_DO_PORTAO[chave] ?? null,
      podeFazerAMao: false,
      podeSubirDocumento: false,
    });
  }

  // 3. As decisões abertas na fila.
  for (const d of e.decisoes) {
    lista.push({
      chave: `decisao:${d.id}`,
      titulo: `Decisão na fila: ${d.titulo}`,
      detalhe: null,
      origem: 'decisao',
      quando: iso(d.expiraEm),
      vencido: vencido(d.expiraEm, e.agora),
      desde: d.criadaEm.toISOString(),
      acao: { tipo: 'link', href: '/caixa?aba=decisoes' },
      podeFazerAMao: false,
      podeSubirDocumento: false,
    });
  }

  // 4. A automação que não concluiu: o passo que a casa faz à mão.
  for (const r of e.reacoesComErro) {
    lista.push({
      chave: `automacao:${r.eventoId}:${r.reacao}`,
      titulo: `A automação "${r.reacao}" não concluiu${r.tipoDoEvento ? ` depois de "${r.tipoDoEvento}"` : ''}`,
      detalhe: r.erro,
      origem: 'automacao',
      quando: null,
      vencido: true,
      desde: r.criadoEm.toISOString(),
      acao: null,
      podeFazerAMao: true,
      podeSubirDocumento: AUTOMACAO_DE_DOCUMENTO.test(r.reacao),
    });
  }

  // 5. Os fatos de pendência que o fio já grava.
  lista.push(...passosDosFatos(e.fatos));

  // Os feitos saem; o resto vai na ordem da urgência.
  const visiveis = lista.filter((p) => !passoFoiFeito(p.chave, new Date(p.desde), e.notas));
  const peso = (p: PassoSugerido) => (p.vencido && p.origem !== 'automacao' ? 0 : p.origem === 'automacao' || p.origem === 'fato' ? 1 : 2);
  visiveis.sort((a, b) => {
    const d = peso(a) - peso(b);
    if (d !== 0) return d;
    if (a.quando && b.quando) return a.quando.localeCompare(b.quando);
    if (a.quando) return -1;
    if (b.quando) return 1;
    return a.desde.localeCompare(b.desde);
  });
  return { passos: visiveis, feitos: lista.length - visiveis.length };
}
