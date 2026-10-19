'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { CartaoDoFunil, ComercialDestinoDoMover, ComercialPedidoDeMover, ComercialSaida, FunilVivo } from '@mktos/shared';
import { COMERCIAL_FILTROS_DO_FUNIL, COMERCIAL_MOTIVOS_DE_SAIDA, COMERCIAL_ROTULO_DA_ETAPA, COMERCIAL_SAIDAS } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ROTULO_DO_MOTIVO, ROTULO_DO_PRODUTO, descricaoJaDizQuando, diaSP, quandoRoda } from '@/lib/cockpit';

import { Aviso, BarraDaSaude, BOTAO, BOTAO_PRIMARIO, Carregando, Chip, Erro, FOCO, INPUT, useCarregar } from '../_ui';
import { LinkDoLead, useMudouNoPainel } from '../_painel/provedor';
import { moverFocoNoFunil } from '../_painel/teclado';
import {
  RELEITURA_DO_PEDIDO_MS,
  concluirMudanca,
  destinoDaColuna,
  esquecerPedido,
  fraseDoErro,
  fraseDoFim,
  guardarPedido,
  horaSP,
  lerEstadoDoPedido,
  lerPedidos,
  opcoesDoMenu,
  pedirMudanca,
  rotuloCurto,
  voltaEmDoDia,
  type EstadoDoPedido,
} from '../_funil/mover';
import { RegistrarFechadoFora } from '../_funil/RegistrarFechadoFora';

/*
 * TELA 04 · O FUNIL VIVO (lane C; painel na lane UX; mover na rodada do painel, P5).
 *
 * O cartão anda sozinho quando o fato chega. Uma PESSOA também pode movê-lo:
 * arrastando para outra coluna ou pelo menu "Mover para" (teclado e celular).
 * Mudar a etapa pela tela é escrita sensível, como sempre foi: o arraste vira
 * um PEDIDO, outra pessoa assina em /atendimento, e quem pediu conclui aqui.
 * Com portão em aberto a mudança executa e o cartão ganha um balão com o que
 * falta, até os fatos chegarem. E8 e E9 não aceitam arrasto (entram por efeito
 * de sistema) e voltar não é avanço; saída vai pelo registro de saída, com
 * motivo. Cada coluna rola sozinha; a barra de etapas leva até a coluna.
 */

type Coluna = FunilVivo['colunas'][number];

export default function FunilVivoPage() {
  const { token, can } = useAuth();
  const [filtro, setFiltro] = useState('todos');
  // T1b: a porta única de quem fechou fora do sistema (a implantação não tem mais "+ adicionar").
  const [registrando, setRegistrando] = useState(false);
  const { dados, erro, carregando, recarregar } = useCarregar<FunilVivo>(`/comercial/funil?filtro=${encodeURIComponent(filtro)}`, 30_000);
  useMudouNoPainel(recarregar);
  const [pedidos, setPedidos] = useState<Record<string, ComercialPedidoDeMover>>({});
  const [avisos, setAvisos] = useState<Record<string, { texto: string; tom: 'neutro' | 'bom' | 'ruim' }>>({});
  const [saidaAberta, setSaidaAberta] = useState<{ leadId: string; saida: ComercialSaida | null } | null>(null);
  const [ocupados, setOcupados] = useState<Record<string, boolean>>({});
  const ocupar = (leadId: string, sim: boolean) => setOcupados(({ [leadId]: _, ...resto }) => (sim ? { ...resto, [leadId]: true } : resto));
  const [arrastando, setArrastando] = useState<CartaoDoFunil | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  useEffect(() => setPedidos(lerPedidos()), []);

  /*
   * O ESTADO DE CADA PEDIDO DESTA ABA (revisão PA-7): relido do servidor, só
   * leitura e sem token, para "concluir a mudança" acender quando a assinatura
   * chega. Pedido usado, recusado ou vencido sai da aba com a frase do porquê.
   */
  const [estados, setEstados] = useState<Record<string, EstadoDoPedido>>({});
  const chavesDosPedidos = Object.entries(pedidos)
    .map(([leadId, p]) => `${leadId}:${p.approvalId}`)
    .sort()
    .join('|');
  useEffect(() => {
    const vivos = Object.entries(pedidos);
    if (!vivos.length) return;
    let parou = false;
    const reler = async () => {
      for (const [leadId, p] of vivos) {
        try {
          const e = await lerEstadoDoPedido(leadId, p.approvalId, token);
          if (parou) return;
          if (!e) continue;
          const fim = fraseDoFim(e);
          if (fim) {
            esquecerPedido(leadId);
            setPedidos(({ [leadId]: _, ...resto }) => resto);
            setEstados(({ [leadId]: _, ...resto }) => resto);
            avisar(leadId, fim, e.estado === 'usada' ? 'neutro' : 'ruim');
          } else {
            setEstados((x) => ({ ...x, [leadId]: e }));
          }
        } catch {
          /* rede caiu: a próxima volta tenta de novo; o pedido continua na aba */
        }
      }
    };
    void reler();
    const t = window.setInterval(() => void reler(), RELEITURA_DO_PEDIDO_MS);
    return () => {
      parou = true;
      window.clearInterval(t);
    };
    // A lista de pedidos muda de identidade a cada render; a chave é o que importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chavesDosPedidos, token]);

  /* As dicas das etiquetas fecham com Esc, mesmo abertas pelo mouse (WCAG 1.4.13). */
  const [dicasCaladas, setDicasCaladas] = useState(false);
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDicasCaladas(true);
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, []);

  const avisar = (leadId: string, texto: string, tom: 'neutro' | 'bom' | 'ruim' = 'neutro') => setAvisos((a) => ({ ...a, [leadId]: { texto, tom } }));
  const calar = (leadId: string) => setAvisos(({ [leadId]: _, ...resto }) => resto);

  async function agir(c: CartaoDoFunil, d: ComercialDestinoDoMover) {
    calar(c.leadId);
    if (!d.permitido) return avisar(c.leadId, `${rotuloCurto(d.para)} não aceita este cartão: ${d.motivo}.`);
    if (d.caminho === 'saida') return setSaidaAberta({ leadId: c.leadId, saida: (COMERCIAL_SAIDAS as readonly string[]).includes(d.para) ? (d.para as ComercialSaida) : null });
    ocupar(c.leadId, true);
    try {
      const p = await pedirMudanca(c.leadId, d.para, token);
      guardarPedido(c.leadId, p);
      setPedidos((x) => ({ ...x, [c.leadId]: p }));
    } catch (e) {
      avisar(c.leadId, fraseDoErro(e), 'ruim');
    } finally {
      ocupar(c.leadId, false);
    }
  }

  async function concluir(c: CartaoDoFunil, p: ComercialPedidoDeMover) {
    ocupar(c.leadId, true);
    try {
      const r = await concluirMudanca(c.leadId, p, token);
      setPedidos(({ [c.leadId]: _, ...resto }) => resto);
      avisar(c.leadId, r.balao ? `Movido para ${rotuloCurto(r.para)}, com pendências.` : `Movido para ${rotuloCurto(r.para)}.`, 'bom');
      await recarregar();
    } catch (e) {
      setPedidos(lerPedidos());
      avisar(c.leadId, fraseDoErro(e), /ainda não veio/.test(fraseDoErro(e)) ? 'neutro' : 'ruim');
    } finally {
      ocupar(c.leadId, false);
    }
  }

  function desistir(leadId: string) {
    esquecerPedido(leadId);
    setPedidos(({ [leadId]: _, ...resto }) => resto);
    const p = pedidos[leadId];
    avisar(leadId, p ? `Pedido esquecido nesta tela. Na fila ele vence às ${horaSP(p.expiraEm)}, sem mudar nada.` : 'Pedido esquecido nesta tela.');
  }

  function soltar(e: React.DragEvent, coluna: Coluna) {
    e.preventDefault();
    setSobre(null);
    const id = e.dataTransfer?.getData('text/plain') || arrastando?.leadId;
    const c = dados?.colunas.flatMap((x) => x.cartoes).find((x) => x.leadId === id);
    setArrastando(null);
    if (!c || c.etapa === coluna.etapa || (coluna.etapa === 'saidas' && (COMERCIAL_SAIDAS as readonly string[]).includes(c.etapa))) return;
    void agir(c, destinoDaColuna(c, coluna.etapa));
  }

  function irParaColuna(etapa: Coluna['etapa']) {
    const col = document.querySelector<HTMLElement>(`[data-testid="funil-coluna-${etapa}"]`);
    col?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    col?.querySelector<HTMLElement>('[data-cabecalho-da-coluna]')?.focus({ preventScroll: true });
  }

  const colunas = dados?.colunas ?? [];

  return (
    <div className="flex flex-col gap-3 md:h-[calc(100dvh-52px-2rem)] min-[820px]:h-[calc(100dvh-46px-3rem)]">
      <header className="shrink-0 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="filtro">
          {COMERCIAL_FILTROS_DO_FUNIL.map((f) => (
            <span key={f.chave} className="group relative inline-flex" onMouseEnter={() => setDicasCaladas(false)} onFocus={() => setDicasCaladas(false)}>
              <button
                type="button"
                data-testid={`funil-etiqueta-${f.chave}`}
                aria-pressed={filtro === f.chave}
                aria-describedby={`funil-etiqueta-dica-${f.chave}`}
                onClick={() => setFiltro(f.chave)}
                className={`rounded border px-2.5 py-1 text-[12px] max-md:min-h-[44px] ${filtro === f.chave ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:border-brand'} ${FOCO}`}
              >
                {f.rotulo}
              </button>
              <span
                id={`funil-etiqueta-dica-${f.chave}`}
                role="tooltip"
                className={`pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-64 rounded border border-border bg-surface-2 px-2.5 py-1.5 text-[11.5px] leading-snug text-text shadow-sm max-md:fixed max-md:inset-x-4 max-md:w-auto ${dicasCaladas ? '' : 'group-focus-within:block group-hover:block'}`}
              >
                {f.explicacao}
              </span>
            </span>
          ))}
          {can('leads.editar') && (
            <button
              type="button"
              data-testid="funil-registrar-fechado-fora"
              aria-expanded={registrando}
              onClick={() => setRegistrando((v) => !v)}
              className={`ml-auto ${BOTAO}`}
            >
              Registrar cliente já fechado
            </button>
          )}
          <Link href="/caixa?aba=decisoes" className={`${can('leads.editar') ? '' : 'ml-auto '}${BOTAO}`}>decisões em Pendências</Link>
        </div>
        <p className="text-[12.5px] text-muted">
          O cartão anda sozinho com os fatos. Para mover à mão, arraste para outra coluna ou use &quot;mover&quot;: outra pessoa assina o pedido em /atendimento e você conclui aqui. Com etapa pendente, o cartão muda e fica marcado com o que falta. Setas do teclado andam entre os cartões, Enter abre o lead.
        </p>
        {registrando && <RegistrarFechadoFora aoFechar={() => setRegistrando(false)} aoRegistrar={() => void recarregar()} />}
        <Erro erro={erro} aoTentar={() => void recarregar()} />
        {/* C-20: acima do teto de leitura a API corta os mais antigos na etapa e diz quantos ficaram de fora. */}
        {dados?.aviso && <Aviso>{dados.aviso}</Aviso>}
        {carregando && !dados && !erro && <Carregando linhas={2} altura="h-32" />}
      </header>

      {dados && (
        <>
          <nav aria-label="etapas do funil" className="flex shrink-0 gap-1.5 overflow-x-auto pb-1">
            {colunas.map((col) => (
              <button
                key={col.etapa}
                type="button"
                data-testid={`funil-chip-${col.etapa}`}
                aria-label={`${col.etapa === 'saidas' ? 'Saídas' : COMERCIAL_ROTULO_DA_ETAPA[col.etapa]}: ${col.cartoes.length} ${col.cartoes.length === 1 ? 'lead' : 'leads'}. Ir para a coluna`}
                title={col.etapa === 'saidas' ? 'Saídas' : COMERCIAL_ROTULO_DA_ETAPA[col.etapa]}
                onClick={() => irParaColuna(col.etapa)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded border border-border px-2 py-1 font-os-mono text-[11px] text-muted hover:border-brand hover:text-text max-md:min-h-[44px] ${FOCO}`}
              >
                <span>{rotuloCurto(col.etapa)}</span>
                <span className={`tabular-nums ${col.cartoes.length ? 'text-brand' : 'text-dim'}`}>{col.cartoes.length}</span>
              </button>
            ))}
          </nav>

          <div
            className="relative flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:snap-none"
            onKeyDown={moverFocoNoFunil}
          >
            {colunas.map((col) => {
              const destino = arrastando ? destinoDaColuna(arrastando, col.etapa) : null;
              const recusa = destino && !destino.permitido && arrastando?.etapa !== col.etapa;
              return (
                <section
                  key={col.etapa}
                  aria-label={col.etapa === 'saidas' ? 'Saídas' : COMERCIAL_ROTULO_DA_ETAPA[col.etapa]}
                  data-coluna-do-funil
                  data-testid={`funil-coluna-${col.etapa}`}
                  className={`flex w-[17rem] min-w-0 shrink-0 snap-start flex-col rounded border bg-bg2 p-2 max-md:max-h-[72dvh] max-md:w-[86%] md:min-h-0 ${sobre === col.etapa ? (recusa ? 'border-warn/70' : 'border-brand') : 'border-border'}`}
                  onDragOver={(e) => {
                    if (!arrastando) return;
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = recusa ? 'none' : 'move';
                    if (sobre !== col.etapa) setSobre(col.etapa);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setSobre(null);
                  }}
                  onDrop={(e) => soltar(e, col)}
                >
                  <h2
                    tabIndex={-1}
                    data-cabecalho-da-coluna
                    className={`flex shrink-0 items-baseline justify-between rounded-sm px-1 pb-2 font-os-mono text-[10.5px] uppercase tracking-[0.14em] text-muted ${FOCO}`}
                  >
                    <span className="truncate" title={col.rotulo}>{col.etapa === 'saidas' ? 'Saídas' : COMERCIAL_ROTULO_DA_ETAPA[col.etapa]}</span>
                    <span className="tabular-nums">{col.cartoes.length}</span>
                  </h2>
                  {sobre === col.etapa && recusa && destino?.motivo && (
                    <p className="mb-2 shrink-0 rounded border border-warn/50 bg-warn/10 px-2 py-1 text-[11.5px] text-warn">não aceita: {destino.motivo}</p>
                  )}
                  <ul className="relative min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
                    {col.cartoes.map((c) => (
                      <li key={c.leadId}>
                        <Cartao
                          c={c}
                          pedido={pedidos[c.leadId] ?? null}
                          estado={estados[c.leadId] ?? null}
                          aviso={avisos[c.leadId] ?? null}
                          ocupado={!!ocupados[c.leadId]}
                          saida={saidaAberta?.leadId === c.leadId ? saidaAberta : null}
                          aoEscolher={(d) => void agir(c, d)}
                          aoConcluir={(p) => void concluir(c, p)}
                          aoDesistir={() => desistir(c.leadId)}
                          aoFecharSaida={() => setSaidaAberta(null)}
                          aoSairFeito={() => {
                            setSaidaAberta(null);
                            avisar(c.leadId, 'Saída registrada.', 'bom');
                            void recarregar();
                          }}
                          aoArrastar={(sim) => setArrastando(sim ? c : null)}
                          aoCalar={() => calar(c.leadId)}
                        />
                      </li>
                    ))}
                    {col.cartoes.length === 0 && <li className="px-1 py-2 text-[12px] text-dim">ninguém aqui</li>}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Cartao({
  c,
  pedido,
  estado,
  aviso,
  ocupado,
  saida,
  aoEscolher,
  aoConcluir,
  aoDesistir,
  aoFecharSaida,
  aoSairFeito,
  aoArrastar,
  aoCalar,
}: {
  c: CartaoDoFunil;
  pedido: ComercialPedidoDeMover | null;
  /** O estado relido do pedido (revisão PA-7); `null` antes da primeira leitura. */
  estado: EstadoDoPedido | null;
  aviso: { texto: string; tom: 'neutro' | 'bom' | 'ruim' } | null;
  ocupado: boolean;
  saida: { leadId: string; saida: ComercialSaida | null } | null;
  aoEscolher: (d: ComercialDestinoDoMover) => void;
  aoConcluir: (p: ComercialPedidoDeMover) => void;
  aoDesistir: () => void;
  aoFecharSaida: () => void;
  aoSairFeito: () => void;
  aoArrastar: (sim: boolean) => void;
  aoCalar: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const quando = descricaoJaDizQuando(c.proximaAcao?.descricao) ? '' : quandoRoda(c.proximaAcao?.quando);
  const rotuloDaSaida = c.motivoSaida ? `${COMERCIAL_ROTULO_DA_ETAPA[c.etapa].replace('Saída · ', '').toLowerCase()} · ${ROTULO_DO_MOTIVO[c.motivoSaida]}` : null;
  const fecharMenu = () => {
    setMenu(false);
    botao.current?.focus();
  };
  // O botão fica com `aria-disabled` (e não `disabled`) para poder receber o foco de volta quando o menu fecha.
  const travado = ocupado || !!pedido;
  const assinado = estado?.estado === 'confirmada';

  return (
    <div
      data-testid={`funil-card-${c.leadId}`}
      draggable={!pedido}
      onDragStart={(e) => {
        e.dataTransfer?.setData('text/plain', c.leadId);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        aoArrastar(true);
      }}
      onDragEnd={() => aoArrastar(false)}
      onClick={(e) => {
        // O cartão inteiro abre o painel; o menu, os formulários e o próprio link cuidam de si.
        if ((e.target as HTMLElement).closest('a, button, input, select, textarea, label, [role="menu"]')) return;
        e.currentTarget.querySelector<HTMLAnchorElement>('[data-cartao-do-funil]')?.click();
      }}
      className={`cursor-pointer rounded border bg-surface p-2.5 transition hover:border-brand/70 ${c.balao ? 'border-warn/70' : c.precisaDeDecisao ? 'border-brand/60' : c.parado ? 'border-warn/60' : 'border-border'}`}
    >
      <div className="flex items-start gap-2">
        <LinkDoLead leadId={c.leadId} aba="fio" data-cartao-do-funil className={`min-w-0 flex-1 rounded-sm ${FOCO}`}>
          <p className="truncate text-[13.5px] font-semibold" title={c.empresa ?? c.nome}>{c.empresa ?? c.nome}</p>
          {c.empresa && c.empresa !== c.nome && <p className="truncate text-[11.5px] text-muted" title={c.nome}>{c.nome}</p>}
        </LinkDoLead>
        <button
          ref={botao}
          type="button"
          data-testid={`funil-mover-${c.leadId}`}
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-label={`mover ${c.empresa ?? c.nome} para outra etapa`}
          aria-disabled={travado}
          title={pedido ? 'Já há um pedido de mudança para este cartão' : undefined}
          onClick={() => {
            if (!travado) setMenu((m) => !m);
          }}
          className={`shrink-0 rounded border border-border px-1.5 font-os-mono text-[10px] text-muted max-md:min-h-[44px] max-md:min-w-[44px] ${travado ? 'cursor-not-allowed opacity-50' : 'hover:border-brand hover:text-text'} ${FOCO}`}
        >
          mover
        </button>
      </div>
      {menu && (
        <MenuMover
          c={c}
          botao={botao}
          aoEscolher={(d) => {
            fecharMenu();
            aoEscolher(d);
          }}
          aoFechar={fecharMenu}
          aoSair={() => setMenu(false)}
        />
      )}
      <BarraDaSaude saude={c.saude} />
      <p className="mt-1.5 text-[12px] text-muted">
        {rotuloDaSaida ?? c.proximaAcao?.descricao ?? 'próxima ação ausente'}
        {quando && !rotuloDaSaida && <span className="text-dim"> · {quando}</span>}
        {c.voltaEm && <span className="text-dim"> · volta {diaSP(c.voltaEm)}</span>}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className="font-os-mono text-[10px] text-dim">{rotuloCurto(c.etapa)}</span>
        {c.perfil && <Chip>{c.perfil}</Chip>}
        {c.produto && <Chip>{ROTULO_DO_PRODUTO[c.produto]}</Chip>}
        {c.precisaDeDecisao && <Chip tom="brand">decisão sua</Chip>}
        {c.parado && <Chip tom="alerta">parado {c.diasNaEtapa} d</Chip>}
      </div>

      {c.balao && (
        <div role="note" data-testid={`funil-balao-${c.leadId}`} className="mt-2 rounded border border-warn/50 bg-warn/10 px-2 py-1.5 text-[11.5px] leading-snug">
          <p className="font-os-mono text-[9.5px] uppercase tracking-[0.12em] text-warn">movido com pendências</p>
          <p className="mt-0.5 text-text">{c.balao.pendencias.join('; ')}</p>
          <p className="mt-0.5 text-dim">{c.balao.movidoPor ? `por ${c.balao.movidoPor} · ` : ''}{diaSP(c.balao.em)} · some quando o que falta chegar</p>
        </div>
      )}

      {pedido && (
        <div role="status" data-testid={`funil-pedido-${c.leadId}`} className="mt-2 space-y-1.5 rounded border border-brand/40 bg-brand/5 px-2 py-1.5 text-[11.5px] leading-snug">
          <p>
            <span className="font-os-mono text-[9.5px] uppercase tracking-[0.12em] text-brand">mudança pedida</span>{' '}
            para {rotuloCurto(pedido.para)}.{' '}
            {assinado ? (
              <span id={`funil-pedido-assinado-${c.leadId}`} data-testid={`funil-pedido-assinado-${c.leadId}`}>
                Assinado{estado?.confirmadaPor ? ` por ${estado.confirmadaPor}` : ''}
                {estado?.confirmadaEm ? ` às ${horaSP(estado.confirmadaEm)}` : ''}: conclua até {horaSP(pedido.expiraEm)}.
              </span>
            ) : (
              <>
                Outra pessoa assina em{' '}
                <Link href="/atendimento" className={`underline decoration-brand underline-offset-2 ${FOCO}`}>/atendimento</Link> até{' '}
                {horaSP(pedido.expiraEm)}.
              </>
            )}
          </p>
          {pedido.pendencias.length > 0 && <p className="text-warn">Vai mover, mas ainda não foi feito: {pedido.pendencias.join('; ')}.</p>}
          <p className="text-dim" data-testid={`funil-pedido-aviso-${c.leadId}`}>
            O pedido vale até {horaSP(pedido.expiraEm)} e só existe nesta aba: fechar a aba perde o pedido, e aí é pedir de novo.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={ocupado}
              onClick={() => aoConcluir(pedido)}
              className={assinado ? BOTAO_PRIMARIO : BOTAO}
              aria-describedby={assinado ? `funil-pedido-assinado-${c.leadId}` : undefined}
            >
              concluir a mudança
            </button>
            <button type="button" disabled={ocupado} onClick={aoDesistir} className={BOTAO}>desistir</button>
          </div>
        </div>
      )}

      {saida && <FormDaSaida c={c} inicial={saida.saida} aoFechar={aoFecharSaida} aoFeito={aoSairFeito} />}

      {aviso && (
        <div className="mt-2 flex items-start gap-1.5" aria-live="polite">
          <Aviso tom={aviso.tom}>{aviso.texto}</Aviso>
          <button type="button" className={BOTAO} onClick={aoCalar}>ok</button>
        </div>
      )}
    </div>
  );
}

/**
 * O menu "Mover para": cada etapa e cada saída; as desligadas dizem por quê.
 * Esc e a escolha fecham e devolvem o foco ao botão; Tab para fora ou clique
 * fora fecham sem roubar o foco de onde ele foi.
 */
function MenuMover({
  c,
  botao,
  aoEscolher,
  aoFechar,
  aoSair,
}: {
  c: CartaoDoFunil;
  botao: React.RefObject<HTMLButtonElement | null>;
  aoEscolher: (d: ComercialDestinoDoMover) => void;
  aoFechar: () => void;
  aoSair: () => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    caixa.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, []);
  const opcoes = opcoesDoMenu(c);
  return (
    <div
      ref={caixa}
      role="menu"
      aria-label={`Mover ${c.empresa ?? c.nome} para`}
      onBlur={(e) => {
        const para = e.relatedTarget as Node | null;
        // O clique no próprio botão "mover" é dele (alterna); o resto fora do menu fecha.
        if (para && (caixa.current?.contains(para) || botao.current?.contains(para))) return;
        aoSair();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          aoFechar();
          return;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const itens = Array.from(caixa.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        const i = itens.indexOf(document.activeElement as HTMLElement);
        itens[(i + (e.key === 'ArrowDown' ? 1 : itens.length - 1)) % itens.length]?.focus();
      }}
      className="mt-2 rounded border border-border bg-surface-2 p-1"
    >
      <p className="px-2 pb-1 pt-0.5 font-os-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">mover para</p>
      {opcoes.map((d) => (
        <button
          key={d.para}
          type="button"
          role="menuitem"
          data-testid={`funil-mover-para-${d.para}`}
          aria-disabled={!d.permitido}
          aria-describedby={d.motivo ? `funil-mover-porque-${c.leadId}-${d.para}` : undefined}
          onClick={() => {
            if (d.permitido) aoEscolher(d);
          }}
          className={`block w-full rounded-sm px-2 py-1.5 text-left text-[12.5px] max-md:min-h-[44px] ${d.permitido ? 'hover:bg-brand/10' : 'cursor-not-allowed text-dim'} ${FOCO}`}
        >
          <span className="block">
            {COMERCIAL_ROTULO_DA_ETAPA[d.para]}
            {d.caminho === 'saida' && <span className="text-dim"> · pede motivo</span>}
          </span>
          {d.motivo && (
            <span id={`funil-mover-porque-${c.leadId}-${d.para}`} className="mt-0.5 block text-[11px] leading-snug text-dim">
              {d.motivo}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** A saída pelo caminho que já existe (`POST /comercial/lead/:id/saida`): motivo obrigatório, data de volta na geladeira, parceiro no parceiro. */
function FormDaSaida({ c, inicial, aoFechar, aoFeito }: { c: CartaoDoFunil; inicial: ComercialSaida | null; aoFechar: () => void; aoFeito: () => void }) {
  const { token } = useAuth();
  const [saida, setSaida] = useState<ComercialSaida | ''>(inicial ?? '');
  const [motivo, setMotivo] = useState('');
  const [detalhe, setDetalhe] = useState('');
  const [volta, setVolta] = useState('');
  const [parceiro, setParceiro] = useState('');
  const [erro, setErro] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);
  const pronto = !!saida && !!motivo && (saida !== 'geladeira' || !!volta) && (saida !== 'parceiro' || !!parceiro.trim());
  const id = `funil-saida-${c.leadId}`;

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    if (!pronto) return;
    setEnviando(true);
    setErro(null);
    try {
      await apiPost(
        `/comercial/lead/${c.leadId}/saida`,
        {
          saida,
          motivo,
          ...(detalhe.trim() ? { detalhe: detalhe.trim() } : {}),
          ...(saida === 'geladeira' ? { voltaEm: voltaEmDoDia(volta) } : {}),
          ...(saida === 'parceiro' ? { parceiro: parceiro.trim() } : {}),
        },
        token,
      );
      aoFeito();
    } catch (er) {
      setErro(er);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form data-testid={id} onSubmit={registrar} className="mt-2 space-y-1.5 rounded border border-border bg-surface-2 p-2 text-[12px]" aria-label={`Registrar saída de ${c.empresa ?? c.nome}`}>
      <p className="font-os-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">saída com motivo</p>
      <label className="block">
        <span className="text-muted">qual saída</span>
        <select value={saida} onChange={(e) => setSaida(e.target.value as ComercialSaida)} className={INPUT} required>
          <option value="">escolha</option>
          {COMERCIAL_SAIDAS.map((s) => <option key={s} value={s}>{COMERCIAL_ROTULO_DA_ETAPA[s].replace('Saída · ', '')}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-muted">motivo</span>
        <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={INPUT} required>
          <option value="">escolha</option>
          {COMERCIAL_MOTIVOS_DE_SAIDA.map((m) => <option key={m} value={m}>{ROTULO_DO_MOTIVO[m]}</option>)}
        </select>
      </label>
      {saida === 'geladeira' && (
        <label className="block">
          <span className="text-muted">volta em</span>
          <input type="date" value={volta} onChange={(e) => setVolta(e.target.value)} className={INPUT} required />
        </label>
      )}
      {saida === 'parceiro' && (
        <label className="block">
          <span className="text-muted">para quem</span>
          <input value={parceiro} onChange={(e) => setParceiro(e.target.value)} className={INPUT} maxLength={120} required />
        </label>
      )}
      <label className="block">
        <span className="text-muted">detalhe (opcional)</span>
        <input value={detalhe} onChange={(e) => setDetalhe(e.target.value)} className={INPUT} maxLength={400} />
      </label>
      <Erro erro={erro} />
      <div className="flex flex-wrap gap-1.5">
        <button type="submit" disabled={!pronto || enviando} className={BOTAO_PRIMARIO}>registrar saída</button>
        <button type="button" onClick={aoFechar} className={BOTAO}>cancelar</button>
      </div>
    </form>
  );
}

