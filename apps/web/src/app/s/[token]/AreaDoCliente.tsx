'use client';

import { useRef, useState } from 'react';
import type { AreaDoClienteParaOCliente, EstadoDaSala, ItemDaAreaParaOCliente } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { dataCurta } from '@/lib/sala-do-cliente';

/*
 * A ÁREA DO CLIENTE (leva A, 30/10/2026): o que o cliente vê no MESMO link
 * `/s/<token>` depois que o negócio fechou. Nada de app novo, nada de login:
 * a sala muda de modo e passa a mostrar quatro blocos com os quinze itens do
 * painel do Fluxo do cliente v6.
 *
 * O cabeçalho diz a empresa e o selo ("no ar · atualizado dd/mm"); a régua
 * das sete fases do fluxo marca onde estamos; cada bloco lista os seus itens.
 * Item vazio diz em que fase chega (tracejado). Item preenchido abre num
 * toque: o resumo, o texto, os tópicos, a data, o documento. O selo "novo"
 * fica no item publicado pela Root até o cliente abrir: abrir grava a leitura
 * daquela versão (`POST /sala/:token/area/leitura`, uma vez por versão) e o
 * selo some. O que o OS monta sozinho (derivado) não tem "novo" nem leitura.
 *
 * No celular é uma coluna só, com o botão do WhatsApp fixo embaixo, como a
 * sala já faz. Tema e componentes do próprio OS, claro e escuro.
 */

const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
const CARTAO = 'rounded-xl border border-border bg-surface p-4';
const ROTULO = 'font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted';

type EstadoComArea = EstadoDaSala & { area?: AreaDoClienteParaOCliente | null };

function dataDoItem(v: string | null): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}`;
  return dataCurta(v);
}

export function AreaDoCliente<E extends EstadoComArea>({ area, estado, token, base, marca, whatsapp, aoAtualizar, children }: {
  area: AreaDoClienteParaOCliente;
  estado: E;
  token: string;
  /** `/sala/<token>`: a base das rotas anônimas. */
  base: string;
  marca: React.ReactNode;
  /** O número da Root derivado na leitura (a nota da mesa); sem ele o botão fica desligado, sem inventar número. */
  whatsapp: string | null;
  aoAtualizar: (e: E) => void;
  /** O que ainda pede ação do cliente (kickoff, aceite): continua embaixo, vindo da página de sempre. */
  children?: React.ReactNode;
}) {
  const faseAtual = area.fase.fases.find((f) => f.id === area.fase.atual) ?? null;
  const numero = whatsapp ? whatsapp.replace(/\D/g, '') : '';
  return (
    <div data-os-app data-testid="area-do-cliente" className="min-h-screen bg-bg p-4 pb-24 text-text [overflow-wrap:anywhere] md:pb-6">
      <div className="mx-auto w-full min-w-0 max-w-md py-6 md:max-w-3xl lg:max-w-5xl">
        {marca}
        <header className="mb-5">
          <p className={ROTULO}>link privado · sem login</p>
          <h1 className="mt-1 text-[24px] font-bold leading-tight">{area.empresa}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="inline-flex items-center gap-2 rounded border border-brand/40 px-2 py-1 font-os-mono text-[11px] text-brand" data-testid="area-selo">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand" />
              {area.atualizadoEm ? `no ar · atualizado ${dataCurta(area.atualizadoEm)}` : 'a sua área está sendo montada'}
            </p>
            <p className="font-os-mono text-[11px] text-muted" data-testid="area-no-ar">{area.noAr} de {area.total} itens no ar</p>
          </div>
        </header>

        <section className={`${CARTAO} mb-4`} aria-label="fase do projeto" data-testid="area-fase">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className={ROTULO}>onde estamos no fluxo</h2>
            {faseAtual && <p className="font-os-mono text-[11px] text-brand">fase {faseAtual.numero} de {area.fase.fases.length} · {faseAtual.nome}</p>}
          </div>
          <ol className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="as sete fases">
            {area.fase.fases.map((f) => (
              <li key={f.id} className="min-w-[7.5rem] flex-1" aria-current={f.estado === 'atual' ? 'step' : undefined} data-testid={`area-fase-${f.id}`}>
                <div className={`h-[3px] rounded-full ${f.estado === 'atual' ? 'bg-brand' : f.estado === 'feita' ? 'bg-brand/40' : 'bg-surface-3'}`} />
                <p className={`mt-1 text-[12px] leading-tight ${f.estado === 'futura' ? 'text-dim' : 'font-semibold'}`}>
                  <span className="font-os-mono text-[10px] text-muted">{String(f.numero).padStart(2, '0')} </span>
                  {f.nome}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <main className="min-w-0 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              {area.blocos.map((b) => (
                <section key={b.id} className={`${CARTAO} min-w-0 ${b.id === 'como-usar' ? 'md:col-span-2' : ''}`} aria-label={b.nome} data-testid={`area-bloco-${b.id}`}>
                  <h2 className="text-[15px] font-bold leading-tight">{b.nome}</h2>
                  <p className="mt-0.5 text-[12px] text-muted">{b.paraOCliente}</p>
                  <ul className={`mt-3 divide-y divide-border ${b.id === 'como-usar' ? 'md:grid md:grid-cols-2 md:gap-x-6 md:divide-y-0' : ''}`}>
                    {b.itens.map((i) => (
                      <Item key={i.id} item={i} token={token} base={base} estado={estado} aoAtualizar={aoAtualizar} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            {children}
          </main>

          <aside className="min-w-0 space-y-4" aria-label="quem cuida e o contato">
            {area.quemCuida && (
              <section className={CARTAO} aria-label="quem cuida da conta" data-testid="area-quem-cuida">
                <h2 className={ROTULO}>quem cuida da sua conta</h2>
                <p className="mt-2 text-[14px] font-semibold">{area.quemCuida.nome}</p>
                {area.quemCuida.papel && <p className="text-[12.5px] text-muted">{area.quemCuida.papel}</p>}
              </section>
            )}
            <section className={CARTAO} aria-label="como esta área funciona">
              <h2 className={ROTULO}>como esta área funciona</h2>
              <ul className="mt-2 space-y-1.5 text-[12.5px] text-muted">
                <li>O que a Root publica aqui passou por duas pessoas da equipe antes de chegar a você.</li>
                <li>Item marcado como <span className="font-os-mono text-[10.5px] text-brand">novo</span> ainda não foi aberto por você.</li>
                <li>Item tracejado chega na fase indicada. Nada aqui é inventado: sem dado, o campo diz "ainda não".</li>
              </ul>
            </section>
            <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/95 p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
              {numero ? (
                <a href={`https://wa.me/${numero}`} target="_blank" rel="noreferrer" data-testid="area-whatsapp" className={`flex min-h-[48px] w-full items-center justify-center rounded-lg bg-brand px-4 text-[14px] font-semibold text-ink ${FOCO}`}>
                  falar no WhatsApp
                </a>
              ) : (
                <button type="button" disabled data-testid="area-whatsapp" title="O número da Root ainda não foi definido" className="flex min-h-[48px] w-full cursor-not-allowed items-center justify-center rounded-lg border border-border px-4 text-[14px] text-muted">
                  falar no WhatsApp · número em breve
                </button>
              )}
            </div>
          </aside>
        </div>

        <p className="mt-6 text-center text-[11px] text-muted">
          Cada item que você abre fica registrado para a Root saber o que você já viu. Este endereço é só seu e vale até {dataCurta(estado.validoAte)}.
        </p>
      </div>
    </div>
  );
}

function Item<E extends EstadoComArea>({ item: i, token, base, estado, aoAtualizar }: { item: ItemDaAreaParaOCliente; token: string; base: string; estado: E; aoAtualizar: (e: E) => void }) {
  const [aberto, setAberto] = useState(false);
  const [novoLocal, setNovoLocal] = useState<boolean | null>(null);
  const enviadas = useRef(new Set<string>());
  const novo = novoLocal ?? i.novo;
  const vazio = i.estado === 'vazio';
  const quando = i.publicadoEm ? dataCurta(i.publicadoEm) : i.conteudo?.quando ? dataDoItem(i.conteudo.quando) : null;

  function abrir() {
    const vai = !aberto;
    setAberto(vai);
    if (!vai || i.origem !== 'publicado' || !i.versao || !novo) return;
    const chave = `${i.id}:${i.versao}`;
    if (enviadas.current.has(chave)) return;
    enviadas.current.add(chave);
    setNovoLocal(false);
    apiPost<E>(`${base}/area/leitura`, { item: i.id, versao: i.versao })
      .then(aoAtualizar)
      .catch(() => undefined);
  }

  const link = i.abre?.tipo === 'proposta' ? `/s/${encodeURIComponent(token)}/proposta` : i.abre?.tipo === 'externo' ? i.abre.url : null;

  return (
    <li className="py-2" data-testid={`area-item-${i.id}`} data-estado={i.estado}>
      <button
        type="button"
        disabled={vazio}
        aria-expanded={vazio ? undefined : aberto}
        onClick={vazio ? undefined : abrir}
        className={`flex w-full items-start justify-between gap-3 rounded-lg text-left ${vazio ? 'cursor-default' : `hover:text-brand ${FOCO}`}`}
      >
        <span className="min-w-0">
          <span className={`block text-[13.5px] ${vazio ? 'text-dim' : 'font-semibold'}`}>{i.titulo}</span>
          <span className={`block text-[12px] ${vazio ? 'text-dim' : 'text-muted'}`}>
            {vazio ? `chega na fase ${i.chegaNaFase.numero} · ${i.chegaNaFase.nome}` : i.conteudo?.resumo ?? (i.origem === 'derivado' ? 'montado pelo OS' : 'publicado pela Root')}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {novo && i.origem === 'publicado' && (
            <span className="rounded border border-brand/50 px-1.5 py-0.5 font-os-mono text-[10px] uppercase tracking-[0.12em] text-brand" data-testid={`area-item-novo-${i.id}`}>
              novo
            </span>
          )}
          {!vazio && quando && <span className="font-os-mono text-[10.5px] text-muted">{quando}</span>}
          {!vazio && i.edicao && i.edicao > 1 && <span className="font-os-mono text-[10px] text-dim">{i.edicao}ª edição</span>}
          {vazio && <span aria-hidden className="h-5 w-5 rounded border border-dashed border-border" />}
        </span>
      </button>
      {aberto && !vazio && i.conteudo && (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-bg p-3 text-[13px]" data-testid={`area-item-detalhe-${i.id}`}>
          {i.conteudo.oQueMudou && <p className="text-[12px] text-brand">o que mudou: {i.conteudo.oQueMudou}</p>}
          {i.conteudo.texto && <p className="whitespace-pre-line">{i.conteudo.texto}</p>}
          {i.conteudo.topicos.length > 0 && (
            <ul className="list-disc space-y-1 pl-5">
              {i.conteudo.topicos.map((t, k) => <li key={k}>{t}</li>)}
            </ul>
          )}
          {i.conteudo.documento && (
            <p className="text-[12.5px] text-muted">
              {i.conteudo.documento.titulo}
              {i.conteudo.documento.link ? (
                <> · <a href={i.conteudo.documento.link} target="_blank" rel="noreferrer" className={`text-brand underline underline-offset-2 ${FOCO}`}>abrir</a></>
              ) : (
                <> · a Root entrega o arquivo pelo grupo</>
              )}
            </p>
          )}
          {link && (
            <a href={link} target={link.startsWith('/') ? undefined : '_blank'} rel={link.startsWith('/') ? undefined : 'noreferrer'} className={`inline-flex min-h-[40px] items-center rounded-lg border border-brand/50 px-3 text-[13px] font-semibold text-brand hover:border-brand ${FOCO}`}>
              {i.abre?.tipo === 'proposta' ? 'abrir a proposta' : 'abrir'}
            </a>
          )}
          {!i.conteudo.texto && !i.conteudo.topicos.length && !i.conteudo.documento && !link && (
            <p className="text-[12.5px] text-muted">É isto por enquanto. A Root acrescenta o detalhe nas próximas edições.</p>
          )}
        </div>
      )}
    </li>
  );
}
