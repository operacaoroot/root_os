'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { DICA_DO_NOME_DA_TAREFA, TRAB_CLIENTE_INTERNO, ehAListaDoComercial, listasForaDoArquivoDoClickUp, type TrabClienteDto, type TrabListaDto } from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { prazoDoDia } from './CalendarioDeTarefas';
import { SeletorDeCliente, type ClienteEscolhido } from './SeletorDeCliente';
import { SeletorDeLead, type LeadEscolhido } from './SeletorDeLead';

/*
 * Layout 26/10 (Lucas): A NOVA TAREFA RÁPIDA, a mesma no quadro, na Lista e no Calendário.
 *
 * "Na hora de criar uma nova tarefa eu quero conseguir colocar o nome, responsável e data
 * rapidinho." Nome + responsável (eu, de saída) + prazo + cliente, sem abrir a tarefa:
 *  · Enter cria e o formulário fica aberto para a próxima (o nome limpa; responsável,
 *    prazo, cliente e lista ficam); Esc limpa; Tab anda nome → responsável → prazo → cliente → Criar;
 *  · o cliente lembrado é o último escolhido nesta visita (como era no quadro);
 *  · "Toda tarefa deve ter um prazo": o campo fica à vista e avisa quando vazio, mas não trava;
 *  · na lista "Tarefas do comercial" o cliente é fixo, o da casa ("Root (interno)"), e o
 *    campo é o LEAD (opcional, com "+ criar lead");
 *  · com mais de uma lista possível (Todas, uma pasta), um seletor pequeno de lista; a
 *    última usada nesta visita vem marcada, senão a primeira.
 *  · Layout 27/10 (Lucas: "as pastas daqui são diferentes das de Tarefas"): com `pastas`, o
 *    seletor agrupa as listas pela pasta da árvore do Trabalho ("Operação", "Comercial"…),
 *    na ordem dela, e deixa de fora as do Arquivo do ClickUp, que a árvore guarda recolhidas.
 * Cria por `POST /trabalho/tarefas` (`assigneeUserId`, `dueDate` ao meio-dia de São Paulo,
 * como o calendário grava, `clienteId`, `leadId`).
 */

// O que a visita lembra entre o quadro, a Lista e o Calendário (recarregar a página esquece).
let ultimoClienteDaVisita: ClienteEscolhido | null = null;
let ultimaListaDaVisita: string | null = null;
/** Para os testes: começar a visita do zero. */
export function esquecerNovaTarefaDaVisita(): void { ultimoClienteDaVisita = null; ultimaListaDaVisita = null; }

/** O nome do cliente da casa ("Root (interno)"), o de `GET /trabalho/clientes`; antes de chegar, "cliente interno". */
export function useNomeDoClienteInterno(token: string | null): string {
  const [nome, setNome] = useState('cliente interno');
  useEffect(() => {
    if (!token) return;
    let vivo = true;
    apiGet<TrabClienteDto[]>('/trabalho/clientes?q=interno', token)
      .then((r) => { const casa = Array.isArray(r) ? r.find((c) => c.interno) : null; if (vivo && casa) setNome(casa.nome); })
      .catch(() => { /* fica "cliente interno" */ });
    return () => { vivo = false; };
  }, [token]);
  return nome;
}

/** A pasta como a árvore a mostra: o nome e o pai (para "Pai › Filha"). */
export type PastaDoSeletor = { id: string; name: string; parentId: string | null; lists: { id: string }[] };

const CAMPO = 'min-w-0 rounded border border-border bg-surface-2 px-1.5 py-1 text-[12px] outline-none focus:border-brand-dim';

export function NovaTarefaRapida({ listas, pastas, statusId, prazoInicial = '', pessoas, token, onDone, onErro, testid, testidCliente, compacto = false, autoFocus = false }: {
  /** As listas onde a tarefa pode nascer; com mais de uma, aparece o seletor de lista. */
  listas: TrabListaDto[];
  /** As pastas da árvore do Trabalho: com elas, o seletor de lista agrupa por pasta. */
  pastas?: PastaDoSeletor[];
  /** A etapa (a coluna do quadro); sem ela, a primeira da lista. Só vale com uma lista. */
  statusId?: string;
  /** AAAA-MM-DD (o dia do calendário). */
  prazoInicial?: string;
  /** Quem pode ser responsável (a equipe). */
  pessoas: { id: string; name: string; isActive?: boolean }[];
  token: string | null;
  onDone: () => void;
  onErro: (m: string) => void;
  testid: string;
  testidCliente?: string;
  /** A coluna do quadro: os campos aparecem embaixo do nome, depois de escrever. */
  compacto?: boolean;
  autoFocus?: boolean;
}) {
  const { user } = useAuth();
  const eu = user?.id ?? null;
  const gente = useMemo(() => pessoas.filter((p) => p.isActive !== false), [pessoas]);
  const [titulo, setTitulo] = useState('');
  const [listaId, setListaId] = useState<string>(() => (ultimaListaDaVisita && listas.some((l) => l.id === ultimaListaDaVisita) ? ultimaListaDaVisita : listas[0]?.id ?? ''));
  const [responsavel, setResponsavel] = useState<string>('');
  const [responsavelMexido, setResponsavelMexido] = useState(false);
  const [prazo, setPrazo] = useState(prazoInicial);
  const [cliente, setCliente] = useState<ClienteEscolhido | null>(ultimoClienteDaVisita);
  const [lead, setLead] = useState<LeadEscolhido | null>(null);
  const [criando, setCriando] = useState(false);
  const nome = useRef<HTMLInputElement>(null);

  // A lista escolhida tem de estar entre as possíveis (a pasta mudou, a estrutura recarregou).
  useEffect(() => {
    if (!listas.some((l) => l.id === listaId)) setListaId(listas[0]?.id ?? '');
  }, [listas, listaId]);
  useEffect(() => { setPrazo(prazoInicial); }, [prazoInicial]);
  // Eu, de saída, quando faço parte da equipe; a pessoa escolhida fica.
  useEffect(() => {
    if (!responsavelMexido) setResponsavel(eu && gente.some((p) => p.id === eu) ? eu : '');
  }, [eu, gente, responsavelMexido]);

  const lista = listas.find((l) => l.id === listaId) ?? null;
  // O seletor: sem as listas do Arquivo do ClickUp (salvo se só houver elas) e, com as pastas, agrupado como a árvore.
  const grupos = useMemo(() => {
    const fora = listasForaDoArquivoDoClickUp(listas);
    const visiveis = fora.length ? fora : listas;
    if (!pastas?.length) return [{ rotulo: "", listas: visiveis }];
    const porId = new Map(pastas.map((p) => [p.id, p]));
    const caminho = (p: PastaDoSeletor) => {
      const nomes: string[] = [];
      for (let a: PastaDoSeletor | undefined = p, n = 0; a && n < 6; a = a.parentId ? porId.get(a.parentId) : undefined, n++) nomes.unshift(a.name);
      return nomes.join(" › ");
    };
    const daLista = new Map<string, string>();
    const ordem: string[] = [];
    for (const p of pastas) {
      const r = caminho(p);
      if (!ordem.includes(r)) ordem.push(r);
      for (const l of p.lists) if (!daLista.has(l.id)) daLista.set(l.id, r);
    }
    const comercial = pastas.find((p) => !p.parentId && p.name.trim().toLowerCase() === "comercial");
    const porGrupo = new Map<string, TrabListaDto[]>();
    for (const l of visiveis) {
      const r = daLista.get(l.id) ?? (ehAListaDoComercial(l) ? (comercial ? caminho(comercial) : "Comercial") : "Sem pasta");
      porGrupo.set(r, [...(porGrupo.get(r) ?? []), l]);
    }
    return [...porGrupo.keys()]
      .sort((a, b) => (ordem.indexOf(a) < 0 ? 999 : ordem.indexOf(a)) - (ordem.indexOf(b) < 0 ? 999 : ordem.indexOf(b)))
      .map((rotulo) => ({ rotulo, listas: porGrupo.get(rotulo)! }));
  }, [listas, pastas]);
  const doComercial = ehAListaDoComercial(lista);
  const casa = useNomeDoClienteInterno(doComercial ? token : null);
  const pronto = !!titulo.trim() && !!lista && (doComercial || !!cliente) && !criando;
  const abertos = !compacto || !!titulo.trim();

  const limpar = () => { setTitulo(''); setLead(null); };
  const criar = () => {
    if (!titulo.trim() || !lista || criando) return;
    if (!doComercial && !cliente) { onErro('Escolha o cliente da tarefa. O trabalho da própria empresa vai para o cliente interno.'); return; }
    const corpo = {
      listId: lista.id,
      ...(statusId && listas.length === 1 ? { statusId } : {}),
      title: titulo.trim(),
      // Na lista do comercial o cliente é o interno (a API também o põe); o lead vai junto, se escolhido.
      // Layout 27/10: na do comercial, quem já é cliente vai como o cliente da tarefa (sem lead).
      clienteId: doComercial ? (lead?.tipo === 'cliente' ? lead.id : TRAB_CLIENTE_INTERNO) : cliente!.id,
      ...(doComercial && lead && lead.tipo !== 'cliente' ? { leadId: lead.id } : {}),
      ...(responsavel ? { assigneeUserId: responsavel } : {}),
      ...(prazo ? { dueDate: prazoDoDia(prazo) } : {}),
    };
    setCriando(true);
    apiPost('/trabalho/tarefas', corpo, token)
      .then(() => {
        ultimaListaDaVisita = lista.id;
        limpar();
        onDone();
        setTimeout(() => nome.current?.focus(), 0);
      })
      .catch((e) => onErro((e as Error).message))
      .finally(() => setCriando(false));
  };
  const teclas = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); criar(); }
    if (e.key === 'Escape') { e.stopPropagation(); limpar(); }
  };

  return (
    <div className={`space-y-1 rounded-lg border border-dashed border-border px-2 py-1.5 ${compacto ? '' : 'bg-surface'}`} data-testid={testid}>
      <div className={compacto ? 'space-y-1' : 'flex flex-wrap items-center gap-1.5'}>
        <div className={`flex items-center gap-1 ${compacto ? '' : 'min-w-[12rem] flex-1'}`}>
          <Plus size={12} className="shrink-0 text-muted" />
          <input
            ref={nome}
            autoFocus={autoFocus}
            value={titulo}
            aria-label="Nome da nova tarefa"
            title={DICA_DO_NOME_DA_TAREFA}
            onChange={(e) => setTitulo(e.target.value)}
            onKeyDown={teclas}
            placeholder="Nova tarefa…"
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted"
          />
        </div>
        {abertos && (
          <div className={compacto ? 'space-y-1' : 'flex flex-wrap items-center gap-1.5'}>
            {listas.length > 1 && (
              <select aria-label="Lista da nova tarefa" data-testid={`${testid}-lista`} value={listaId} onChange={(e) => setListaId(e.target.value)} className={`${CAMPO} max-w-[12rem]`}>
                {lista && !grupos.some((g) => g.listas.includes(lista)) && <option value={lista.id}>{lista.name}</option>}
                {grupos.map((g) => g.rotulo
                  ? <optgroup key={g.rotulo} label={g.rotulo}>{g.listas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>
                  : g.listas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>))}
              </select>
            )}
            <select
              aria-label="Responsável da nova tarefa" data-testid={`${testid}-responsavel`} value={responsavel} onKeyDown={teclas}
              onChange={(e) => { setResponsavel(e.target.value); setResponsavelMexido(true); }}
              className={`${CAMPO} ${compacto ? 'w-full' : 'max-w-[10rem]'}`}
            >
              <option value="">Sem responsável</option>
              {gente.map((p) => <option key={p.id} value={p.id}>{p.id === eu ? `${p.name} (eu)` : p.name}</option>)}
            </select>
            <input
              type="date" aria-label="Prazo da nova tarefa" data-testid={`${testid}-prazo`} value={prazo} onKeyDown={teclas}
              onChange={(e) => setPrazo(e.target.value)}
              className={`${CAMPO} ${compacto ? 'w-full' : 'w-[8.5rem]'} ${prazo ? '' : 'border-warn/60'}`}
            />
            {doComercial ? (
              <>
                <span className={compacto ? 'block' : 'min-w-[12rem]'}>
                  <SeletorDeLead valor={lead} token={token} onEscolher={setLead} comClientes testid={`${testid}-lead`} />
                </span>
                <span data-testid={`${testid}-cliente-fixo`} className="text-[10.5px] text-muted">cliente: {lead?.tipo === 'cliente' ? lead.nome : casa}</span>
              </>
            ) : (
              <span className={compacto ? 'block' : 'min-w-[12rem]'}>
                <SeletorDeCliente
                  valor={cliente} token={token} obrigatorio testid={testidCliente ?? `${testid}-cliente`}
                  onEscolher={(c) => { setCliente(c); ultimoClienteDaVisita = c; }}
                />
              </span>
            )}
            <button type="button" onClick={criar} disabled={!pronto} className={`rounded bg-brand/15 px-2 py-1 text-[11px] text-brand hover:bg-brand/25 disabled:opacity-50 ${compacto ? 'w-full' : ''}`}>
              Criar tarefa
            </button>
          </div>
        )}
      </div>
      {abertos && (
        <p className="text-[10.5px] leading-snug text-muted">
          {!prazo && <span className="text-warn">Sem prazo: toda tarefa deve ter um prazo. </span>}
          {titulo.trim() ? DICA_DO_NOME_DA_TAREFA : 'Enter cria e deixa aberto para a próxima; Esc limpa.'}
        </p>
      )}
    </div>
  );
}
