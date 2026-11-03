'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { DiaLivre, EstadoDoConvitePublico } from '@mktos/shared';

import { API_BASE, apiGet, apiPost } from '@/lib/api';

/*
 * O LINK DE ESCOLHA — `/agendar/<token>`, desenho `Link` (agenda v2, 29/10/2026, lane G6).
 *
 * Sem login (a rota está em `PUBLICAS` do AppShell; o middleware só age no host
 * da bio): o token na URL é a credencial. A página vê SÓ horários livres da
 * régua (nenhum título, nenhum nome de outro cliente). Confirmar reserva o
 * horário; o convite do Google com o Meet sai quando uma pessoa da Root
 * confirma (R2 do link público fica na fila, decisão 2). Depois: "Adicionar ao
 * Google Agenda" e o `.ics`.
 *
 * Identidade da Root: fundo carvão esverdeado, Space Grotesk no texto, JetBrains
 * Mono em rótulo e número, verde-limão só onde informa. Responsiva a 390 px.
 */

const COR = {
  fundo: '#070A08',
  cartao: '#0C120D',
  borda: '#1C3010',
  texto: '#DFFFE8',
  mudo: '#A9BCAD',
  apagado: '#7E9183',
  acento: '#9BDB1F',
  magenta: '#FF1F6B',
} as const;

const FUSO = 'America/Sao_Paulo';
const ROTULO = 'font-central-mono text-[10px] uppercase tracking-[2px]';
const BOTAO_BASE = 'min-h-[44px] rounded-[3px] border font-central-mono text-[13px] transition focus-visible:outline-none focus-visible:ring-2';

interface Confirmado extends EstadoDoConvitePublico {
  mensagem?: string;
}

const diaCurto = (dia: string): { semana: string; data: string } => {
  const d = new Date(`${dia}T12:00:00-03:00`);
  return {
    semana: d.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: FUSO }).replace('.', ''),
    data: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: FUSO }),
  };
};

const duracao = (min: number): string => (min % 60 === 0 ? `${min / 60} h` : min > 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

const quandoPorExtenso = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: FUSO });

const utc = (iso: string): string => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** O link de "Adicionar ao Google Agenda" (o próprio Google monta o evento na agenda da pessoa). */
function linkDoGoogleAgenda(e: { inicio: string; fim: string }, socio: string, online: boolean): string {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Reunião ${online ? 'online' : 'presencial'} com ${socio} · Root`,
    dates: `${utc(e.inicio)}/${utc(e.fim)}`,
    details: online ? 'O convite oficial com o link do Meet chega no seu e-mail.' : 'O endereço chega no convite oficial, no seu e-mail.',
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

function Topo({ estado }: { estado: EstadoDoConvitePublico }) {
  const online = estado.modalidade === 'online';
  return (
    <div>
      <div className="font-central-mono text-[10px] font-bold tracking-[4px]" style={{ color: COR.magenta }}>
        {`// reunião ${online ? 'online' : 'presencial'} · ${duracao(estado.duracaoMin)}`}
      </div>
      <h1 className="mt-1 text-[24px] font-bold leading-[1.15] tracking-[-0.8px]">
        {estado.nome ? `${estado.nome}, escolha` : 'Escolha'} um horário com o <span style={{ color: COR.acento }}>{estado.socio}.</span>
      </h1>
      <p className="mt-1.5 text-[13.5px]" style={{ color: COR.mudo }}>
        Só aparecem horários livres. {online ? 'O convite com o link do Meet chega no seu e-mail.' : 'O convite com o endereço chega no seu e-mail.'}
      </p>
    </div>
  );
}

function Escolhido({ estado, token, mensagem }: { estado: EstadoDoConvitePublico; token: string; mensagem?: string }) {
  if (!estado.escolhido) return null;
  const online = estado.modalidade === 'online';
  return (
    <section className="flex flex-col gap-3 rounded-[3px] border p-4" style={{ borderColor: COR.acento, background: 'rgba(155,219,31,.08)' }} aria-live="polite">
      <span className={ROTULO} style={{ color: COR.acento }}>Horário escolhido</span>
      <p className="text-[18px] font-semibold first-letter:uppercase">{quandoPorExtenso(estado.escolhido.inicio)}</p>
      <p className="text-[13.5px]" style={{ color: COR.mudo }}>
        {mensagem ?? `O convite ${online ? 'com o link do Meet ' : ''}chega no seu e-mail assim que a Root confirmar.`}
      </p>
      <a
        className={`${BOTAO_BASE} flex items-center justify-center px-4 font-central-sans text-[15px] font-semibold`}
        style={{ background: COR.acento, borderColor: COR.acento, color: COR.fundo }}
        href={linkDoGoogleAgenda(estado.escolhido, estado.socio, online)}
        target="_blank"
        rel="noreferrer noopener"
      >
        Adicionar ao Google Agenda
      </a>
      <a
        className={`${BOTAO_BASE} flex items-center justify-center px-4`}
        style={{ borderColor: COR.borda, background: COR.cartao, color: COR.texto }}
        href={`${API_BASE}/agendar/${encodeURIComponent(token)}/ics`}
      >
        Baixar o arquivo .ics
      </a>
    </section>
  );
}

export default function AgendarPage() {
  const { token } = useParams<{ token: string }>();
  const [estado, setEstado] = useState<Confirmado | null>(null);
  const [naoAbre, setNaoAbre] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [dia, setDia] = useState<string | null>(null);
  const [hora, setHora] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    apiGet<EstadoDoConvitePublico>(`/agendar/${encodeURIComponent(token)}`)
      .then((e) => {
        setEstado(e);
        const primeiro = e.dias.find((d) => d.manha.length || d.tarde.length);
        setDia(primeiro?.dia ?? null);
      })
      .catch((e: Error & { status?: number }) => {
        if (e.status === 404 || /não encontrado/.test(e.message)) setNaoAbre(true);
        else setErro(e.message);
      });
  }, [token]);

  const dias = useMemo<DiaLivre[]>(() => (estado?.dias ?? []).filter((d) => d.manha.length || d.tarde.length), [estado]);
  const doDia = dias.find((d) => d.dia === dia) ?? null;
  const emailOk = !estado?.emailObrigatorio || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const pronto = !!dia && !!hora && emailOk && !enviando;

  const confirmar = async () => {
    if (!dia || !hora || !estado) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await apiPost<Confirmado>(`/agendar/${encodeURIComponent(token)}/confirmar`, {
        dia,
        hora,
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(!estado.nome && nome.trim() ? { nome: nome.trim() } : {}),
      });
      setEstado(r);
    } catch (e) {
      setErro((e as Error).message);
      // O horário pode ter acabado de ser tomado: a lista volta atualizada.
      apiGet<EstadoDoConvitePublico>(`/agendar/${encodeURIComponent(token)}`).then((novo) => { setEstado(novo); setHora(null); }).catch(() => undefined);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="min-h-screen font-central-sans" style={{ background: COR.fundo, color: COR.texto }}>
      <div className="mx-auto flex min-h-screen w-full max-w-[440px] flex-col gap-[14px] px-4 pb-5 pt-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marca/ROOT-logo-principal-TRANSPARENTE.svg" alt="ROOT" className="-mb-2 -ml-1 h-[56px] w-auto self-start" />

        {naoAbre && (
          <section className="flex flex-col gap-2">
            <h1 className="text-[22px] font-bold tracking-[-0.6px]">Este link não abre.</h1>
            <p className="text-[14px]" style={{ color: COR.mudo }}>
              Ele pode ter vencido, já ter sido usado ou ter sido trocado por outro. Peça um link novo à Root pelo WhatsApp.
            </p>
          </section>
        )}

        {!naoAbre && !estado && !erro && <p className="text-[14px]" style={{ color: COR.mudo }}>Carregando os horários…</p>}

        {estado && (
          <>
            <Topo estado={estado} />

            {estado.pedidoAnteriorCaiu && !estado.escolhido && (
              <p role="status" className="rounded-[3px] border px-3 py-2.5 text-[13.5px]" style={{ borderColor: COR.magenta, color: COR.texto }}>
                O pedido anterior não foi confirmado a tempo. Escolha de novo.
              </p>
            )}

            {estado.escolhido ? (
              <Escolhido estado={estado} token={token} mensagem={estado.mensagem} />
            ) : dias.length === 0 ? (
              <p className="text-[14px]" style={{ color: COR.mudo }}>
                Não há horário livre nos próximos 14 dias. Fale com a Root pelo WhatsApp e combinamos outro.
              </p>
            ) : (
              <>
                <div>
                  <span className={ROTULO} style={{ color: COR.mudo }}>Dia</span>
                  <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1" role="listbox" aria-label="Dia">
                    {dias.map((d) => {
                      const r = diaCurto(d.dia);
                      const marcado = d.dia === dia;
                      return (
                        <button
                          key={d.dia}
                          type="button"
                          role="option"
                          aria-selected={marcado}
                          onClick={() => { setDia(d.dia); setHora(null); }}
                          className={`${BOTAO_BASE} min-w-[64px] flex-1 px-2 py-2 text-[12px] leading-tight`}
                          style={{ borderColor: marcado ? COR.acento : COR.borda, background: marcado ? 'rgba(155,219,31,.12)' : COR.cartao, color: COR.texto }}
                        >
                          {r.semana}
                          <br />
                          {r.data}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {doDia && (['manha', 'tarde'] as const).map((parte) => (
                  doDia[parte].length > 0 && (
                    <div key={parte}>
                      <span className={ROTULO} style={{ color: COR.mudo }}>{parte === 'manha' ? 'Manhã' : 'Tarde'}</span>
                      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                        {doDia[parte].map((h) => {
                          const marcado = h === hora;
                          return (
                            <button
                              key={h}
                              type="button"
                              aria-pressed={marcado}
                              onClick={() => setHora(h)}
                              className={BOTAO_BASE}
                              style={{ borderColor: marcado ? COR.acento : COR.borda, background: marcado ? 'rgba(155,219,31,.12)' : COR.cartao, color: COR.texto }}
                            >
                              {h}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )
                ))}

                {!estado.nome && (
                  <div>
                    <label className={ROTULO} style={{ color: COR.mudo }} htmlFor="agendar-nome">Seu nome</label>
                    <input
                      id="agendar-nome"
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      autoComplete="name"
                      maxLength={120}
                      className="mt-1.5 w-full rounded-[3px] border px-3 py-2.5 text-[16px] outline-none"
                      style={{ background: COR.fundo, borderColor: COR.borda, color: COR.texto }}
                    />
                  </div>
                )}

                <div>
                  <label className={ROTULO} style={{ color: COR.mudo }} htmlFor="agendar-email">
                    Seu e-mail{estado.emailObrigatorio ? '' : ' (opcional)'}
                  </label>
                  <input
                    id="agendar-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    maxLength={254}
                    className="mt-1.5 w-full rounded-[3px] border px-3 py-2.5 text-[16px] outline-none"
                    style={{ background: COR.fundo, borderColor: COR.borda, color: COR.texto }}
                  />
                </div>

                <button
                  type="button"
                  onClick={confirmar}
                  disabled={!pronto}
                  className={`${BOTAO_BASE} font-central-sans text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-50`}
                  style={{ background: COR.acento, borderColor: COR.acento, color: COR.fundo }}
                >
                  {enviando
                    ? 'Confirmando…'
                    : dia && hora
                      ? `Confirmar ${diaCurto(dia).semana} ${diaCurto(dia).data} às ${hora}`
                      : 'Escolha o dia e o horário'}
                </button>
                <p className="text-center text-[12.5px]" style={{ color: COR.mudo }}>
                  Depois de confirmar: botão para o Google Agenda e arquivo .ics
                </p>
              </>
            )}
          </>
        )}

        {erro && <p role="alert" className="text-[13.5px]" style={{ color: COR.magenta }}>{erro}</p>}

        <div className="mt-auto text-center font-central-mono text-[10.5px]" style={{ color: COR.apagado }}>operacaoroot.com</div>
      </div>
    </main>
  );
}
