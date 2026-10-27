import {
  COMERCIAL_ROTULO_DA_ETAPA,
  COMERCIAL_TIPOS_DE_NEGOCIO,
  PARTES_DO_CLIENTE,
  tituloNormalizado,
  type ClienteAtivo,
  type ComercialEtapa,
  type ComercialTipoDeNegocio,
  type ListaDeClientesAtivos,
  type ParteDoCliente,
  type SituacaoDoContrato,
} from '@mktos/shared';

/*
 * CLIENTES ATIVOS NUMA LISTA SÓ (P-84, 27/10/2026): a junção, sem banco, para a suíte medir.
 * O serviço (`clientes-ativos.service.ts`) só lê e entrega estes insumos.
 *
 * A linha é do CADASTRO (`Partner`, o principal quando há duplicado) sempre que ele existe;
 * sem cadastro, do lead fechado; sem os dois, do acordo. As partes se acham assim:
 *   · lead → cadastro: o ponteiro da ficha; sem ele, o nome (empresa ou nome do lead);
 *   · acordo → cadastro: o `partnerId`; sem ele, o nome ou um dos apelidos;
 *   · contrato vivo → a linha do lead dele; conversa e implantação → cadastro ou lead.
 * Entra quem tem acordo, lead em E9, contrato vivo aberto, ou cadastro de cliente com
 * conversa do WhatsApp. Contrato concluído ou desativado não põe ninguém na lista.
 */

export interface InsumosDosClientesAtivos {
  cadastros: { id: string; razaoSocial: string; nomeFantasia: string | null; principalId: string | null; isCliente: boolean }[];
  acordos: { id: string; cliente: string; apelidos: string | null; produto: string; tipo: string; valor: number; fechadoEm: Date | null; partnerId: string | null }[];
  fichas: { leadId: string; leadNome: string; empresa: string | null; etapa: string; partnerId: string | null; tipoNegocio: string | null; valorCentavos: number | null; valorNegociadoCentavos: number | null }[];
  contratos: { leadId: string; situacao: SituacaoDoContrato }[];
  conversas: { id: string; nome: string; clienteId: string | null; leadId: string | null }[];
  implantacoes: { taskId: string; etapa: string; clienteId: string | null; leadId: string | null }[];
}

const nomeDoCadastro = (c: { razaoSocial: string; nomeFantasia: string | null }) => (c.nomeFantasia?.trim() || c.razaoSocial).trim();
const tipoValido = (t: string | null | undefined): ComercialTipoDeNegocio | null =>
  t && (COMERCIAL_TIPOS_DE_NEGOCIO as readonly string[]).includes(t) ? (t as ComercialTipoDeNegocio) : null;
const CONTRATO_ABERTO: readonly SituacaoDoContrato[] = ['ativo', 'em_implantacao'];

type Linha = Omit<ClienteAtivo, 'faltam' | 'podeCriarCadastro' | 'tipo' | 'valor'> & { fichas: InsumosDosClientesAtivos['fichas'] };

export function juntarClientesAtivos(e: InsumosDosClientesAtivos): ListaDeClientesAtivos {
  const cadastroPorId = new Map(e.cadastros.map((c) => [c.id, c]));
  const principal = (id: string | null | undefined): string | null => {
    if (!id) return null;
    const c = cadastroPorId.get(id);
    if (!c) return null;
    return c.principalId && cadastroPorId.has(c.principalId) ? c.principalId : c.id;
  };
  const duplicados = new Map<string, number>();
  for (const c of e.cadastros) if (c.principalId && cadastroPorId.has(c.principalId)) duplicados.set(c.principalId, (duplicados.get(c.principalId) ?? 0) + 1);
  // O nome normalizado → cadastro principal (só os de cliente; o primeiro que chega fica).
  const porNome = new Map<string, string>();
  for (const c of e.cadastros) {
    if (!c.isCliente) continue;
    const p = principal(c.id)!;
    for (const n of [c.razaoSocial, c.nomeFantasia]) {
      const k = tituloNormalizado(n ?? '');
      if (k && !porNome.has(k)) porNome.set(k, p);
    }
  }
  const cadastroPeloNome = (...nomes: (string | null | undefined)[]) => {
    for (const n of nomes) {
      const k = tituloNormalizado(n ?? '');
      if (k && porNome.has(k)) return porNome.get(k)!;
    }
    return null;
  };

  const linhas = new Map<string, Linha>();
  const linhaDoLead = new Map<string, string>();
  const nova = (chave: string, nome: string): Linha => {
    let l = linhas.get(chave);
    if (!l) {
      l = { chave, nome, funil: null, cadastro: null, acordos: [], contrato: null, whatsapp: [], implantacao: null, fichas: [] };
      linhas.set(chave, l);
    }
    return l;
  };
  const doCadastro = (pid: string): Linha => {
    const c = cadastroPorId.get(pid)!;
    const l = nova(`partner:${pid}`, nomeDoCadastro(c));
    l.cadastro = { id: pid, nome: nomeDoCadastro(c), duplicados: duplicados.get(pid) ?? 0 };
    return l;
  };
  const fichaPorLead = new Map(e.fichas.map((f) => [f.leadId, f]));
  const cadastroDaFicha = (f: InsumosDosClientesAtivos['fichas'][number]) => principal(f.partnerId) ?? cadastroPeloNome(f.empresa, f.leadNome);
  const ligarFicha = (l: Linha, f: InsumosDosClientesAtivos['fichas'][number]) => {
    if (l.fichas.some((x) => x.leadId === f.leadId)) return;
    l.fichas.push(f);
    linhaDoLead.set(f.leadId, l.chave);
  };
  const linhaDaFicha = (f: InsumosDosClientesAtivos['fichas'][number]): Linha => {
    const ja = linhaDoLead.get(f.leadId);
    if (ja) return linhas.get(ja)!;
    const pid = cadastroDaFicha(f);
    const l = pid ? doCadastro(pid) : nova(`lead:${f.leadId}`, (f.empresa?.trim() || f.leadNome).trim());
    ligarFicha(l, f);
    return l;
  };

  // 1. Quem entra: lead em E9, contrato vivo aberto, acordo, cadastro com conversa.
  for (const f of e.fichas) if (f.etapa === 'fechado') linhaDaFicha(f);
  for (const c of e.contratos) {
    if (!CONTRATO_ABERTO.includes(c.situacao)) continue;
    const f = fichaPorLead.get(c.leadId);
    if (f) linhaDaFicha(f).contrato = { leadId: c.leadId, situacao: c.situacao };
  }
  for (const a of e.acordos) {
    const pid = principal(a.partnerId) ?? cadastroPeloNome(a.cliente, ...(a.apelidos ?? '').split(','));
    let l: Linha | undefined = pid ? doCadastro(pid) : undefined;
    if (!l) {
      const k = tituloNormalizado(a.cliente);
      l = [...linhas.values()].find((x) => !x.cadastro && tituloNormalizado(x.nome) === k) ?? nova(`acordo:${a.id}`, a.cliente.trim());
    }
    l.acordos.push({ id: a.id, produto: a.produto, tipo: a.tipo, valor: a.valor, fechadoEm: a.fechadoEm ? a.fechadoEm.toISOString().slice(0, 10) : null });
  }
  for (const c of e.conversas) {
    const pid = principal(c.clienteId);
    if (pid && cadastroPorId.get(pid)?.isCliente) doCadastro(pid);
  }

  // 2. As outras partes de quem entrou: fichas de outra etapa, conversas, implantação.
  for (const f of e.fichas) {
    if (linhaDoLead.has(f.leadId)) continue;
    const pid = principal(f.partnerId);
    const l = pid ? linhas.get(`partner:${pid}`) : undefined;
    if (l) ligarFicha(l, f);
  }
  for (const c of e.conversas) {
    const pid = principal(c.clienteId);
    const chave = (pid && linhas.has(`partner:${pid}`) ? `partner:${pid}` : null) ?? (c.leadId ? linhaDoLead.get(c.leadId) : undefined);
    const l = chave ? linhas.get(chave) : undefined;
    if (l && !l.whatsapp.some((w) => w.conversaId === c.id)) l.whatsapp.push({ conversaId: c.id, nome: c.nome });
  }
  for (const t of e.implantacoes) {
    const pid = principal(t.clienteId);
    const chave = (pid && linhas.has(`partner:${pid}`) ? `partner:${pid}` : null) ?? (t.leadId ? linhaDoLead.get(t.leadId) : undefined);
    const l = chave ? linhas.get(chave) : undefined;
    if (l && !l.implantacao) l.implantacao = { taskId: t.taskId, etapa: t.etapa };
  }
  for (const c of e.contratos) {
    if (!CONTRATO_ABERTO.includes(c.situacao)) continue;
    const chave = linhaDoLead.get(c.leadId);
    const l = chave ? linhas.get(chave) : undefined;
    if (l && !l.contrato) l.contrato = { leadId: c.leadId, situacao: c.situacao };
  }

  const clientes: ClienteAtivo[] = [...linhas.values()].map((l) => {
    // O lead da linha: o fechado antes; senão o que estiver mais adiante no funil.
    const f = l.fichas.find((x) => x.etapa === 'fechado') ?? l.fichas[0] ?? null;
    const funil = f ? { leadId: f.leadId, etapa: f.etapa, rotulo: COMERCIAL_ROTULO_DA_ETAPA[f.etapa as ComercialEtapa] ?? f.etapa } : null;
    const tipo = tipoValido(f?.tipoNegocio) ?? tipoValido(l.acordos[0]?.tipo) ?? 'pagante';
    const somaAcordos = l.acordos.reduce((s, a) => s + a.valor, 0);
    const daFicha = f ? (f.valorNegociadoCentavos ?? f.valorCentavos) : null;
    const valor = l.acordos.length ? somaAcordos : daFicha != null ? daFicha / 100 : null;
    const tem: Record<ParteDoCliente, boolean> = {
      funil: funil?.etapa === 'fechado',
      cadastro: !!l.cadastro,
      acordo: l.acordos.length > 0,
      contrato: !!l.contrato,
      whatsapp: l.whatsapp.length > 0,
      implantacao: !!l.implantacao,
    };
    const { fichas: _f, ...resto } = l;
    return {
      ...resto,
      funil,
      tipo,
      valor,
      faltam: PARTES_DO_CLIENTE.filter((p) => !tem[p]),
      podeCriarCadastro: !l.cadastro && !!funil && (funil.etapa === 'fechado' || funil.etapa === 'contrato'),
    };
  });
  clientes.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const porTipo = COMERCIAL_TIPOS_DE_NEGOCIO.map((tipo) => ({ tipo, total: clientes.filter((c) => c.tipo === tipo).length })).filter((t) => t.total > 0);
  return { clientes, porTipo, comLacuna: clientes.filter((c) => c.faltam.length > 0).length };
}
