'use client';

import type { EstadoDaSala, SalaVersaoPublica } from '@mktos/shared';

import { dataCurta } from '@/lib/sala-do-cliente';

/*
 * A SALA PUBLICADA POR VERSÃO (rodada da implantação I3, pranchetas 2 e 3 do
 * mockup aprovado).
 *
 * O cliente vê a ÚLTIMA versão que a Root publicou: o cabeçalho com o selo "no
 * ar · versão N · data", "Onde estamos" (as cinco estações, data só nas
 * feitas), "Próximos passos" (o quê, quando, com quem), "Publicado para você"
 * e, no rail, "O combinado", o WhatsApp e quem cuida da conta. O que é ação do
 * cliente (formulário, horário, aceite, kickoff) continua logo abaixo, vindo da
 * página de sempre (`children`).
 *
 * No celular (prancheta 3) é uma coluna só: estações na vertical, passos,
 * publicados, e o botão do WhatsApp fixo embaixo com alvo de 48 px.
 *
 * O número do WhatsApp da Root é decisão pendente da mesa: até lá o botão
 * mostra o marcador e não abre conversa com número inventado.
 */

const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
const CARTAO = 'rounded-xl border border-border bg-surface p-4';
const ROTULO = 'font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted';

const diaDoPasso = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : d);

function linkDoPublicado(tipo: string, token: string, estado: EstadoDaSala): string | null {
  if (tipo === 'proposta' && estado.proposta) return `/s/${token}/proposta`;
  if (tipo === 'contrato' && estado.aceite?.contrato?.linkAssinatura) return estado.aceite.contrato.linkAssinatura;
  if (tipo === 'roteiro' && estado.comeco?.linkDoTrilho) return estado.comeco.linkDoTrilho;
  return null;
}

export function SalaPublicada({ publicada, estado, token, marca, children }: {
  publicada: SalaVersaoPublica;
  estado: EstadoDaSala;
  token: string;
  marca: React.ReactNode;
  children: React.ReactNode;
}) {
  const c = publicada.conteudo;
  const numero = c.whatsapp.numero;
  return (
    <div data-os-app data-testid="sala-publicada" className="min-h-screen bg-bg p-4 pb-24 text-text [overflow-wrap:anywhere] md:pb-6">
      <div className="mx-auto w-full min-w-0 max-w-md py-6 md:max-w-3xl lg:max-w-5xl">
        {marca}
        <header className="mb-5">
          <p className={ROTULO}>link privado · sem login</p>
          <h1 className="mt-1 text-[24px] font-bold leading-tight">{c.nome}</h1>
          <p className="mt-2 inline-flex items-center gap-2 rounded border border-brand/40 px-2 py-1 font-os-mono text-[11px] text-brand" data-testid="sala-selo">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand" />
            no ar · versão {publicada.versao} · {dataCurta(publicada.publicadaEm)}
          </p>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <main className="min-w-0 space-y-4">
            <section className={CARTAO} aria-label="onde estamos">
              <h2 className={ROTULO}>onde estamos</h2>
              <ol className="mt-3 flex flex-col gap-3 md:flex-row md:gap-2" data-testid="sala-estacoes">
                {c.estacoes.map((e, i) => (
                  <li key={e.chave} className="flex min-w-0 items-start gap-2 md:flex-1 md:flex-col md:gap-1.5" aria-current={e.estado === 'atual' ? 'step' : undefined}>
                    <span
                      aria-hidden
                      className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border font-os-mono text-[10px] ${e.estado === 'feita' ? 'border-brand bg-brand text-ink' : e.estado === 'atual' ? 'border-brand text-brand' : 'border-border text-dim'}`}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-[13.5px] ${e.estado === 'futura' ? 'text-dim' : 'font-semibold'}`}>{e.rotulo}</span>
                      <span className="block font-os-mono text-[10.5px] text-muted">
                        {e.estado === 'feita' ? (e.em ? `feita · ${dataCurta(e.em)}` : 'feita') : e.estado === 'atual' ? 'agora' : 'depois'}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            <section className={CARTAO} aria-label="próximos passos">
              <h2 className={ROTULO}>próximos passos</h2>
              {c.proximosPassos.length ? (
                <ul className="mt-2 divide-y divide-border" data-testid="sala-passos">
                  {c.proximosPassos.map((p, i) => (
                    <li key={i} className="grid gap-0.5 py-2 md:grid-cols-[minmax(0,1fr)_6rem_10rem] md:items-baseline md:gap-3">
                      <span className="text-[14px]">{p.oque}</span>
                      <span className="font-os-mono text-[12px] text-brand">{diaDoPasso(p.quando)}</span>
                      <span className="text-[12.5px] text-muted">com {p.comQuem}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[13px] text-muted">A Root escreve os próximos passos na próxima versão.</p>
              )}
            </section>

            <section className={CARTAO} aria-label="publicado para você">
              <h2 className={ROTULO}>publicado para você</h2>
              <ul className="mt-2 grid gap-2 md:grid-cols-2" data-testid="sala-publicados">
                {c.publicados.map((p) => {
                  const link = p.disponivel ? linkDoPublicado(p.tipo, token, estado) : null;
                  const corpo = (
                    <>
                      <span className="block text-[13.5px] font-semibold">{p.titulo}</span>
                      <span className="block text-[12px] text-muted">{p.estado}</span>
                    </>
                  );
                  return (
                    <li key={p.tipo} className={p.disponivel ? '' : 'opacity-50'}>
                      {link ? (
                        <a href={link} className={`block min-h-[44px] rounded-lg border border-border px-3 py-2 hover:border-brand ${FOCO}`}>{corpo}</a>
                      ) : (
                        <div className="min-h-[44px] rounded-lg border border-dashed border-border px-3 py-2">{corpo}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            {children}
          </main>

          <aside className="min-w-0 space-y-4" aria-label="o combinado e o contato">
            <section className={CARTAO} aria-label="o combinado">
              <h2 className={ROTULO}>o combinado</h2>
              <ul className="mt-2 space-y-1.5 text-[13.5px]" data-testid="sala-combinado">
                {c.combinado.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </section>
            {c.quemCuida && (
              <section className={CARTAO} aria-label="quem cuida da conta">
                <h2 className={ROTULO}>quem cuida da sua conta</h2>
                <p className="mt-2 text-[14px] font-semibold">{c.quemCuida.nome}</p>
                {c.quemCuida.papel && <p className="text-[12.5px] text-muted">{c.quemCuida.papel}</p>}
              </section>
            )}
            <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/95 p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
              {numero ? (
                <a href={`https://wa.me/${numero.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" data-testid="sala-whatsapp" className={`flex min-h-[48px] w-full items-center justify-center rounded-lg bg-brand px-4 text-[14px] font-semibold text-ink ${FOCO}`}>
                  falar no WhatsApp
                </a>
              ) : (
                <button type="button" disabled data-testid="sala-whatsapp" title="O número da Root ainda não foi definido" className="flex min-h-[48px] w-full cursor-not-allowed items-center justify-center rounded-lg border border-border px-4 text-[14px] text-muted">
                  falar no WhatsApp · {c.whatsapp.rotulo}
                </button>
              )}
            </div>
          </aside>
        </div>

        <p className="mt-6 text-center text-[11px] text-muted">
          Cada visita sua fica registrada para a Root saber o que você já viu. Este endereço é só seu e vale até {dataCurta(estado.validoAte)}.
        </p>
      </div>
    </div>
  );
}
