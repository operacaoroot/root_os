'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  avaliarNaRegua,
  interpretarFrase,
  type ClienteDaBuscaDaAgenda,
  type ItemDaRegua,
  type NovoConviteDeAgenda,
  type PedidoDeEscrita,
  type RegrasDaAgenda,
  type ResultadoDaEscrita,
  type ResultadoDaRegua,
  type SocioDaAgenda,
} from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';

import {
  ROTULO_DO_TIPO,
  TIPOS_DO_PAINEL,
  UMA_PESSOA,
  aplicarFrase,
  comCliente,
  desfechoDa,
  duracoesAte,
  intervaloDoRascunho,
  lerConvidados,
  motivoSemLink,
  novaChave,
  ordenarSocios,
  pedidoDeAlterar,
  pedidoDeMarcar,
  propostaDoRascunho,
  tipoDoPainel,
  tituloDoRascunho,
  type DesfechoDaEscrita,
  type Rascunho,
} from './painel';
import { rotulosDoDia } from './semana';
import { QUEM, rotuloDaDuracao, type EventoV2 } from './v2';

/*
 * O PAINEL DE MARCAR (agenda v2, 29/10/2026, lane G3) — o `aside` do desenho
 * `Main`, fixo à direita da grade; abaixo de 860 px vira folha de baixo.
 *
 * O título NUNCA é digitado: sai de `montarTituloDeCompromisso`, a mesma função
 * do servidor. O semáforo é `avaliarNaRegua` (o motor puro do shared, o mesmo
 * que a API roda antes de escrever). O atalho por frase (`interpretarFrase`, sem
 * IA) preenche só o que a frase disse; apagar a palavra volta o campo.
 *
 * A escrita vai a `POST /agenda/escritas`: `executado` saiu no clique (com
 * "Desfazer"), `aguardando_aprovacao` foi para a fila, `regua` sem `forcado` é
 * o vermelho do servidor (pede "Marcar assim mesmo" com motivo), `recusado` diz
 * por quê. O rascunho de marcar fica no `sessionStorage` (sobrevive a recarregar
 * a aba, some ao fechá-la).
 */

export const CHAVE_DO_RASCUNHO = 'agenda.v2.rascunho';

export function lerRascunhoGuardado(): Rascunho | null {
  try {
    const bruto = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(CHAVE_DO_RASCUNHO) : null;
    if (!bruto) return null;
    const r = JSON.parse(bruto) as Rascunho;
    return r && typeof r === 'object' && typeof r.dia === 'string' && Array.isArray(r.responsaveis) ? r : null;
  } catch {
    return null;
  }
}

function guardarRascunho(r: Rascunho | null) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (r) sessionStorage.setItem(CHAVE_DO_RASCUNHO, JSON.stringify(r));
    else sessionStorage.removeItem(CHAVE_DO_RASCUNHO);
  } catch {
    /* navegador sem armazenamento: o rascunho só não sobrevive */
  }
}

const REGRAS_VAZIAS = { pessoas: [], ritos: [], feriados: [] };

const ROTULO_DO_NIVEL: Record<ItemDaRegua['nivel'], { texto: string; cor: string }> = {
  ok: { texto: 'OK', cor: 'text-info' },
  atencao: { texto: 'ATENÇÃO', cor: 'text-warn' },
  bloqueio: { texto: 'BLOQUEIO', cor: 'text-mag' },
};

const ROTULO_DA_COR: Record<ResultadoDaRegua['cor'], { texto: string; cor: string }> = {
  verde: { texto: 'verde · pode marcar', cor: 'text-info' },
  amarelo: { texto: 'amarelo · marca com atenção', cor: 'text-warn' },
  vermelho: { texto: 'vermelho · a régua não deixa marcar', cor: 'text-mag' },
};

const botao = 'rounded-[3px] border px-3 py-1.5 text-[13px]';
const ligado = 'border-brand bg-brand/[0.12] text-text';
const desligado = 'border-border bg-surface-2 text-text hover:border-brand-dim';
const campo = 'w-full rounded-[3px] border border-border bg-bg px-2.5 py-2 text-[13px] text-text outline-none focus:border-brand-dim';
const rotulo = 'font-os-mono text-[10px] uppercase tracking-[0.2em] text-muted';

interface Props {
  modo: 'lado' | 'folha';
  /** O evento sendo editado; nulo = marcar um novo. */
  edicao: EventoV2 | null;
  inicial: Rascunho;
  eventos: readonly EventoV2[];
  regras: RegrasDaAgenda | null;
  hoje: string;
  clientesConhecidos: readonly string[];
  token: string | null;
  podeMarcar: boolean;
  aoMudarRascunho?: (r: Rascunho | null) => void;
  aoFechar: () => void;
  aoEscrever: () => void;
  agora?: Date;
}

export function PainelDeMarcar(props: Props) {
  const { modo, edicao, inicial, eventos, regras, hoje, clientesConhecidos, token, podeMarcar, aoMudarRascunho, aoFechar, aoEscrever } = props;
  const [r, setR] = useState<Rascunho>(inicial);
  const [frase, setFrase] = useState('');
  const base = useRef<Rascunho | null>(null);
  const [busca, setBusca] = useState<ClienteDaBuscaDaAgenda[]>([]);
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [ficha, setFicha] = useState<ClienteDaBuscaDaAgenda | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [desfecho, setDesfecho] = useState<DesfechoDaEscrita | null>(null);
  const [reguaDoServidor, setReguaDoServidor] = useState<ResultadoDaRegua | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [motivoForcado, setMotivoForcado] = useState('');
  const [link, setLink] = useState<{ url: string; validoAte: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const apenasHorario = !!edicao && tipoDoPainel(edicao) === null;

  // Um rascunho novo de fora (clique na grade, arrastar) recomeça o painel.
  useEffect(() => {
    setR(inicial);
    setDesfecho(null);
    setReguaDoServidor(null);
    setErro(null);
    setLink(null);
    setFrase('');
    base.current = null;
  }, [inicial]);

  useEffect(() => {
    aoMudarRascunho?.(r);
    if (!edicao) guardarRascunho(r);
  }, [r]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => aoMudarRascunho?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  // A busca do cliente no Funil e em Clientes (2 letras, com pausa).
  useEffect(() => {
    const q = r.cliente.trim();
    if (!buscaAberta || q.length < 2 || !token) { setBusca([]); return; }
    let vivo = true;
    const t = setTimeout(() => {
      apiGet<ClienteDaBuscaDaAgenda[]>(`/agenda/clientes?q=${encodeURIComponent(q)}`, token)
        .then((lista) => { if (vivo) setBusca(Array.isArray(lista) ? lista : []); })
        .catch(() => { if (vivo) setBusca([]); });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [r.cliente, buscaAberta, token]);

  const mudar = (parcial: Partial<Rascunho>) => {
    base.current = null;
    setReguaDoServidor(null);
    setR((atual) => ({ ...atual, ...parcial }));
  };

  const escreverFrase = (texto: string) => {
    if (!base.current) base.current = r;
    setFrase(texto);
    setReguaDoServidor(null);
    const campos = interpretarFrase(texto, { hoje, clientes: [...clientesConhecidos, ...busca.map((b) => b.nome)] });
    setR(aplicarFrase(base.current, campos));
  };

  const titulo = useMemo(() => tituloDoRascunho(r), [r]);
  const proposta = useMemo(() => propostaDoRascunho(r, edicao?.id ?? null), [r, edicao]);
  const reguaLocal: ResultadoDaRegua | null = useMemo(() => {
    if (!proposta || !proposta.responsaveis.length) return null;
    try {
      return avaliarNaRegua({ eventos, regras: regras ?? REGRAS_VAZIAS, proposta, agora: props.agora ?? new Date() });
    } catch {
      return null;
    }
  }, [eventos, regras, proposta, props.agora]);
  const regua = reguaDoServidor ?? reguaLocal;
  const vermelho = regua?.cor === 'vermelho';

  const { emails } = lerConvidados(r.convidados);
  const reuniao = r.tipo === 'cliente' || r.tipo === 'interna';
  const informativos: string[] = [];
  if (reuniao && r.modalidade === 'online') informativos.push('Meet nasce junto');
  if (reuniao && emails.length) informativos.push(`convite a ${ficha?.contato?.nome && emails.includes(ficha.contato.email ?? '') ? ficha.contato.nome : emails.join(', ')} por e-mail`);

  const escrever = async (pedido: PedidoDeEscrita) => {
    setEnviando(true);
    setErro(null);
    try {
      const res = await apiPost<ResultadoDaEscrita>('/agenda/escritas', { pedido }, token);
      const d = desfechoDa(res);
      setDesfecho(d);
      if (d.tipo === 'regua') setReguaDoServidor(res.regua ?? null);
      if (d.tipo === 'saiu' || d.tipo === 'fila') {
        setMotivoForcado('');
        if (!edicao && pedido.acao === 'marcar') guardarRascunho(null);
        aoEscrever();
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const enviar = (forcado?: { motivo: string }) => {
    setDesfecho(null);
    try {
      const chave = novaChave();
      if (edicao) {
        const p = pedidoDeAlterar(edicao, r, chave, forcado);
        if (!p) { setErro('Nada mudou.'); return; }
        void escrever(p);
      } else {
        void escrever(pedidoDeMarcar(r, chave, forcado));
      }
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  const desfazer = (pedido: PedidoDeEscrita) => {
    setDesfecho(null);
    void escrever({ ...pedido, chave: novaChave() } as PedidoDeEscrita);
  };

  const mandarLink = async () => {
    const semLink = motivoSemLink(r);
    if (semLink) { setErro(semLink); return; }
    setErro(null);
    const corpo: NovoConviteDeAgenda = {
      socio: r.responsaveis[0],
      tipo: r.tipo as 'cliente' | 'interna',
      modalidade: r.modalidade,
      duracaoMin: r.duracaoMin,
      ...(r.leadId ? { leadId: r.leadId } : {}),
      ...(r.clienteId ? { clienteId: r.clienteId } : {}),
    };
    try {
      setLink(await apiPost<{ url: string; validoAte: string }>('/agenda/convites', corpo, token));
      setCopiado(false);
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  const alternarSocio = (s: SocioDaAgenda) => {
    if (UMA_PESSOA.has(r.tipo)) { mudar({ responsaveis: [s] }); return; }
    mudar({ responsaveis: ordenarSocios(r.responsaveis.includes(s) ? r.responsaveis.filter((x) => x !== s) : [...r.responsaveis, s]) });
  };

  const mudarTipo = (tipo: Rascunho['tipo']) => {
    mudar({ tipo, responsaveis: UMA_PESSOA.has(tipo) ? r.responsaveis.slice(0, 1) : r.responsaveis });
  };

  const intervalo = intervaloDoRascunho(r);
  const pronto = (!!intervalo && !!titulo.titulo && !titulo.falta && r.responsaveis.length > 0) || (apenasHorario && !!intervalo);
  const r1 = r.dia ? rotulosDoDia(r.dia) : null;

  const corpo = (
    <div className="flex flex-col gap-3.5" data-painel-de-marcar={edicao ? 'editar' : 'marcar'}>
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="font-os-mono text-[10px] font-bold tracking-[0.4em] text-mag">{edicao ? '// editar' : '// marcar'}</div>
          <div className="text-xl font-bold tracking-tight">{edicao ? 'Editar compromisso' : 'Novo compromisso'}</div>
        </div>
        <button type="button" aria-label="Fechar painel" onClick={aoFechar} className={`${botao} ${desligado}`}>×</button>
      </div>

      {!edicao && (
        <div>
          <label className={rotulo} htmlFor="agenda-atalho">Atalho</label>
          <input
            id="agenda-atalho"
            className={`${campo} mt-1.5 font-os-mono text-xs`}
            value={frase}
            onChange={(e) => escreverFrase(e.target.value)}
            placeholder="online com andrade sexta 15h 1h rodrigo"
            autoComplete="off"
          />
          <div className="mt-1 text-[11.5px] text-muted">a frase preenche os campos abaixo; não usa IA</div>
        </div>
      )}

      {apenasHorario ? (
        <p className="rounded-[3px] border border-warn/50 bg-warn/[0.06] px-2.5 py-2 text-xs text-warn">
          O título deste compromisso está fora do padrão. Aqui só muda o horário; o título fica como está.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo">
            {TIPOS_DO_PAINEL.map((t) => (
              <button key={t} type="button" aria-pressed={r.tipo === t} onClick={() => mudarTipo(t)} className={`${botao} ${r.tipo === t ? ligado : desligado}`}>
                {ROTULO_DO_TIPO[t]}
              </button>
            ))}
          </div>
          {reuniao && (
            <div className="flex gap-1.5" role="group" aria-label="Modalidade">
              {(['online', 'presencial'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={r.modalidade === m} onClick={() => mudar({ modalidade: m })} className={`${botao} ${r.modalidade === m ? ligado : desligado}`}>
                  {m === 'online' ? 'Online' : 'Presencial'}
                </button>
              ))}
            </div>
          )}

          {r.tipo === 'cliente' && (
            <div className="relative">
              <label className={rotulo} htmlFor="agenda-cliente">Cliente</label>
              <input
                id="agenda-cliente"
                className={`${campo} mt-1.5`}
                value={r.cliente}
                onChange={(e) => { setFicha(null); mudar({ cliente: e.target.value, leadId: null, clienteId: null }); setBuscaAberta(true); }}
                onFocus={() => setBuscaAberta(true)}
                onBlur={() => setTimeout(() => setBuscaAberta(false), 150)}
                placeholder="buscar no Funil e em Clientes"
                autoComplete="off"
                role="combobox"
                aria-expanded={buscaAberta && busca.length > 0}
                aria-controls="agenda-cliente-lista"
              />
              {buscaAberta && busca.length > 0 && (
                <ul id="agenda-cliente-lista" role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-[3px] border border-border-strong bg-surface shadow-lg">
                  {busca.map((c) => (
                    <li key={`${c.tipo}-${c.id}`} role="option" aria-selected={false}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setFicha(c); setBuscaAberta(false); base.current = null; setR((atual) => comCliente(atual, c)); }}
                        className="flex w-full items-baseline justify-between gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-2"
                      >
                        <span className="min-w-0 truncate">{c.nome}</span>
                        <span className="shrink-0 font-os-mono text-[10px] uppercase text-muted">{c.tipo === 'lead' ? `lead${c.etapa ? ` · ${c.etapa}` : ''}` : 'cliente'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {ficha && ficha.nome === r.cliente && (
                <div className="mt-1.5 flex flex-col gap-1 rounded-[3px] border border-border bg-bg px-2.5 py-2" data-ficha-do-cliente="">
                  <div className="flex justify-between gap-2">
                    <span className="text-[13px] font-semibold">{ficha.nome}</span>
                    <span className="font-os-mono text-[10px] uppercase text-muted">{ficha.tipo === 'lead' ? `lead${ficha.etapa ? ` · ${ficha.etapa}` : ''}` : 'cliente'}</span>
                  </div>
                  {ficha.contato && (
                    <span className="text-xs text-muted">contato: {[ficha.contato.nome, ficha.contato.email].filter(Boolean).join(' · ')}</span>
                  )}
                  <span className="text-xs text-muted">
                    {ficha.naAgenda.vezes
                      ? `já esteve na agenda ${ficha.naAgenda.vezes}x${ficha.naAgenda.ultima ? ` · última ${rotulosDoDia(ficha.naAgenda.ultima.slice(0, 10)).data}` : ''}${ficha.naAgenda.com.length ? ` com ${ficha.naAgenda.com.join(', ')}` : ''}`
                      : 'ainda não esteve na agenda'}
                  </span>
                </div>
              )}
            </div>
          )}

          {r.tipo === 'fora' && (
            <div>
              <label className={rotulo} htmlFor="agenda-motivo">Motivo do Fora</label>
              <input id="agenda-motivo" className={`${campo} mt-1.5`} value={r.motivo} onChange={(e) => mudar({ motivo: e.target.value })} placeholder="viagem, férias, curso" />
            </div>
          )}

          <div>
            <span className={rotulo}>{UMA_PESSOA.has(r.tipo) ? 'De quem' : 'Responsáveis'}</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Responsáveis">
              {QUEM.filter((q): q is SocioDaAgenda => q !== 'Todos').map((s) => (
                <button key={s} type="button" aria-pressed={r.responsaveis.includes(s)} onClick={() => alternarSocio(s)} className={`${botao} ${r.responsaveis.includes(s) ? ligado : desligado}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="flex gap-2">
        <div className="flex-1">
          <label className={rotulo} htmlFor="agenda-dia">Quando</label>
          <div className="mt-1.5 flex gap-1.5">
            <input id="agenda-dia" type="date" className={`${campo} font-os-mono text-xs`} value={r.dia} onChange={(e) => mudar({ dia: e.target.value })} />
            <input aria-label="Hora" type="time" step={300} className={`${campo} w-[6.5rem] font-os-mono text-xs`} value={r.hora} onChange={(e) => mudar({ hora: e.target.value })} />
          </div>
          {r1 && <div className="mt-1 font-os-mono text-[10.5px] text-muted">{r1.semana} {r1.data} · {r.hora}</div>}
        </div>
        <div className="w-28">
          <label className={rotulo} htmlFor="agenda-duracao">Duração</label>
          <select id="agenda-duracao" className={`${campo} mt-1.5 font-os-mono text-xs`} value={r.duracaoMin} onChange={(e) => mudar({ duracaoMin: Number(e.target.value) })}>
            {[...new Set([...duracoesAte(r.hora), r.duracaoMin])].sort((a, b) => a - b).map((m) => (
              <option key={m} value={m}>{rotuloDaDuracao(m)}</option>
            ))}
          </select>
        </div>
      </div>

      {!apenasHorario && reuniao && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-xs text-muted">local, convidados e pauta</summary>
          <div className="mt-2 flex flex-col gap-2">
            {r.modalidade === 'presencial' && (
              <input aria-label="Local" className={campo} value={r.local} onChange={(e) => mudar({ local: e.target.value })} placeholder="onde é" />
            )}
            <input aria-label="Convidados" className={campo} value={r.convidados} onChange={(e) => mudar({ convidados: e.target.value })} placeholder="e-mails de fora, separados por vírgula" />
            <textarea aria-label="Pauta" className={`${campo} min-h-[56px]`} value={r.pauta} onChange={(e) => mudar({ pauta: e.target.value })} placeholder="vai na descrição do evento" />
          </div>
        </details>
      )}

      <div className="rounded-[3px] border border-border bg-bg p-2.5">
        <div className="font-os-mono text-[10px] uppercase tracking-[0.1em] text-muted">Título que vai para o Google</div>
        <div className={`mt-1.5 font-os-mono text-[12.5px] ${apenasHorario || titulo.titulo ? 'text-brand-2' : 'text-muted'}`} data-titulo-montado="">
          {apenasHorario ? edicao?.titulo : titulo.titulo && !titulo.falta ? titulo.titulo : titulo.falta}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 text-[12.5px]" data-semaforo={regua?.cor ?? 'sem'} aria-live="polite">
        {regua && (
          <div className={`font-os-mono text-[10.5px] uppercase ${ROTULO_DA_COR[regua.cor].cor}`}>{ROTULO_DA_COR[regua.cor].texto}</div>
        )}
        {regua && regua.itens.length === 0 && regua.cor === 'verde' && (
          <div><span className="font-os-mono text-info">OK</span> nada na régua contra este horário</div>
        )}
        {regua?.itens.map((it, i) => (
          <div key={`${it.regra}-${i}`}>
            <span className={`font-os-mono ${ROTULO_DO_NIVEL[it.nivel].cor}`}>{ROTULO_DO_NIVEL[it.nivel].texto}</span> {it.frase}
          </div>
        ))}
        {!reguaDoServidor && informativos.map((t) => (
          <div key={t}><span className="font-os-mono text-info">OK</span> {t}</div>
        ))}
        {!regua && (
          <div className="text-muted">
            {apenasHorario ? 'a régua não sabe de quem é este compromisso: o título não diz' : 'a régua avalia quando houver dia, hora e quem vai'}
          </div>
        )}
      </div>

      {desfecho && (
        <div
          role="status"
          className={`rounded-[3px] border px-2.5 py-2 text-[13px] ${desfecho.tipo === 'saiu' ? 'border-info/40 text-info' : desfecho.tipo === 'fila' ? 'border-warn/50 text-warn' : 'border-mag/50 text-mag'}`}
        >
          <span>{desfecho.texto}</span>
          {desfecho.tipo === 'fila' && (
            <a href="/atendimento" className="ml-2 underline underline-offset-2">ir para a fila</a>
          )}
          {desfecho.tipo === 'saiu' && desfecho.desfazer && (
            <button type="button" onClick={() => desfazer(desfecho.desfazer!)} disabled={enviando} className="ml-2 underline underline-offset-2">
              desfazer
            </button>
          )}
        </div>
      )}
      {erro && <div role="alert" className="rounded-[3px] border border-mag/50 px-2.5 py-2 text-[13px] text-mag">{erro}</div>}

      {podeMarcar && vermelho && (
        <div className="flex flex-col gap-1.5 rounded-[3px] border border-mag/50 p-2.5">
          <label className={rotulo} htmlFor="agenda-forcado">Marcar assim mesmo: por quê?</label>
          <textarea id="agenda-forcado" className={`${campo} min-h-[48px]`} value={motivoForcado} onChange={(e) => setMotivoForcado(e.target.value)} placeholder="o motivo fica no evento e nos Relatórios" />
          <button
            type="button"
            disabled={enviando || !motivoForcado.trim() || !pronto}
            onClick={() => enviar({ motivo: motivoForcado.trim() })}
            className={`${botao} border-mag text-mag disabled:opacity-50`}
          >
            Marcar assim mesmo
          </button>
        </div>
      )}

      {link && (
        <div className="flex flex-col gap-1 rounded-[3px] border border-border bg-bg p-2.5 text-xs" data-link-de-escolha="">
          <span className={rotulo}>Link de escolha</span>
          <span className="break-all font-os-mono text-brand-2">{link.url}</span>
          <span className="text-muted">vale até {new Date(link.validoAte).toLocaleDateString('pt-BR')}</span>
          <button
            type="button"
            className={`${botao} ${desligado} self-start`}
            onClick={() => { void navigator.clipboard?.writeText(link.url).then(() => setCopiado(true)).catch(() => {}); }}
          >
            {copiado ? 'copiado' : 'copiar o link'}
          </button>
        </div>
      )}

      {podeMarcar ? (
        <div className="mt-auto flex flex-col gap-1.5">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={enviando || !pronto || vermelho}
              onClick={() => enviar()}
              className="flex-1 rounded-[3px] border border-brand bg-brand px-3 py-2 text-[13px] font-semibold text-ink disabled:opacity-50"
            >
              {enviando ? 'Enviando…' : edicao ? 'Salvar' : 'Marcar'}
            </button>
            {!edicao && (
              <button type="button" onClick={() => void mandarLink()} disabled={enviando} className={`flex-1 ${botao} ${desligado}`}>
                Mandar link de escolha
              </button>
            )}
          </div>
          <div className="font-os-mono text-[10.5px] text-muted" data-linha-do-nivel="">
            {desfecho?.tipo === 'fila' ? 'nível R2 · esta escrita foi para a fila de aprovação' : 'nível R2 · sai no clique · fica no histórico com desfazer'}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">Marcar pede a permissão de editar a agenda.</p>
      )}
    </div>
  );

  if (modo === 'folha') {
    return (
      <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-label={edicao ? 'Editar compromisso' : 'Novo compromisso'}>
        <button type="button" aria-label="Fechar" className="absolute inset-0 bg-bg/70" onClick={aoFechar} />
        <div className="relative max-h-[88vh] overflow-y-auto rounded-t-[6px] border-t border-border-strong bg-surface px-4 pb-6 pt-4">{corpo}</div>
      </div>
    );
  }
  return (
    <aside aria-label={edicao ? 'Editar compromisso' : 'Marcar'} className="flex w-[372px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface px-[18px] py-4">
      {corpo}
    </aside>
  );
}
