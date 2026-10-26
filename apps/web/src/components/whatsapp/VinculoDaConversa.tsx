'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CODIGO_LEAD_COM_OUTRO_TELEFONE, type CandidatoDeVinculo, type ConversaDaCaixa, type TipoDeVinculo } from '@mktos/shared';

import { ErroDaApi, apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * O VÍNCULO DA CONVERSA no cabeçalho da caixa de WhatsApp (produção 22C, W3).
 * A caixa (lane B) embute este componente; `aoMudar` é chamado depois de
 * qualquer mudança, para a caixa reler a conversa.
 *
 *   · ligada: "Lead: <nome>" (abre o painel do lead) ou "Cliente: <nome>"
 *     (abre a ficha do cliente), e "Desvincular";
 *   · com sugestão (grupo `ROOT | <nome>` com nome IGUAL): "Vincular a <nome>?",
 *     um clique; grupo NUNCA liga sem esse clique;
 *   · sem vínculo: "Vincular a lead", "Vincular a cliente" (busca, o igual
 *     primeiro) e, no 1:1, "este número não está em nenhum lead; pôr no lead X?";
 *   · "Marcar como equipe" / "Tirar da equipe".
 *
 * Sem `podeVincular` (sem `leads.editar`), tudo aparece desabilitado com a razão.
 */

const BOTAO =
  'inline-flex items-center justify-center rounded border border-border px-2.5 py-1 text-[12px] transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-[40px]';
const RAZAO_SEM_PERMISSAO = 'Vincular pede a permissão leads.editar.';

type Modo = { tipo: TipoDeVinculo | 'telefone' } | null;

/** O painel do lead aberto na aba WhatsApp. */
export function hrefDoLeadDaConversa(leadId: string): string {
  return `/comercial/funil?lead=${encodeURIComponent(leadId)}&aba=whatsapp`;
}

/** A ficha do cliente: a página acha o cartão do cliente e abre a ficha. */
export function hrefDoClienteDaConversa(clienteId: string): string {
  return `/comercial/ficha/cliente/${encodeURIComponent(clienteId)}`;
}

export function VinculoDaConversa({ conversa, podeVincular, aoMudar }: { conversa: ConversaDaCaixa; podeVincular: boolean; aoMudar: () => void | Promise<void> }) {
  const { token } = useAuth();
  const [modo, setModo] = useState<Modo>(null);
  const [q, setQ] = useState('');
  const [candidatos, setCandidatos] = useState<CandidatoDeVinculo[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [trocar, setTrocar] = useState<CandidatoDeVinculo | null>(null);
  const razao = podeVincular ? undefined : RAZAO_SEM_PERMISSAO;

  // Trocou de conversa: a busca aberta da anterior fecha.
  useEffect(() => {
    setModo(null);
    setQ('');
    setErro(null);
    setTrocar(null);
  }, [conversa.id]);

  // A busca: com a conversa (o igual primeiro), o tipo e o texto digitado.
  useEffect(() => {
    if (!modo || !token) return;
    let vivo = true;
    const tipo = modo.tipo === 'telefone' ? 'lead' : modo.tipo;
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ conversaId: conversa.id, tipo });
      if (q.trim()) qs.set('q', q.trim());
      apiGet<CandidatoDeVinculo[]>(`/whatsapp/vinculos/candidatos?${qs.toString()}`, token)
        .then((r) => vivo && setCandidatos(r))
        .catch((e: Error) => vivo && setErro(e.message));
    }, q ? 250 : 0);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [modo, q, conversa.id, token]);

  async function acao(caminho: string, corpo: unknown = {}): Promise<boolean> {
    setOcupado(true);
    setErro(null);
    try {
      await apiPost(`/whatsapp/vinculos/${encodeURIComponent(conversa.id)}${caminho}`, corpo, token);
      setModo(null);
      setQ('');
      setTrocar(null);
      await aoMudar();
      return true;
    } catch (e) {
      if (e instanceof ErroDaApi && e.codigo === CODIGO_LEAD_COM_OUTRO_TELEFONE) return false;
      setErro((e as Error).message);
      return true;
    } finally {
      setOcupado(false);
    }
  }

  async function escolher(c: CandidatoDeVinculo) {
    if (modo?.tipo === 'telefone') {
      const feito = await acao('/telefone-no-lead', { leadId: c.id });
      if (!feito) setTrocar(c);
      return;
    }
    await acao('', { tipo: c.tipo, id: c.id });
  }

  function abrir(tipo: TipoDeVinculo | 'telefone') {
    setCandidatos(null);
    setQ('');
    setErro(null);
    setTrocar(null);
    setModo(modo?.tipo === tipo ? null : { tipo });
  }

  const v = conversa.vinculo;
  const umAUmComNumero = !conversa.grupo && !!conversa.numero;

  return (
    <div data-testid="whats-vinculo" className="flex min-w-0 flex-col gap-1.5 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2">
        {v ? (
          <>
            <span className="text-muted">{v.tipo === 'lead' ? 'Lead:' : 'Cliente:'}</span>
            <Link
              href={v.tipo === 'lead' ? hrefDoLeadDaConversa(v.id) : hrefDoClienteDaConversa(v.id)}
              className="truncate font-medium text-brand underline"
              data-testid="whats-vinculo-link"
            >
              {v.nome}
            </Link>
            {!v.vinculadoPor && <span className="text-[11px] text-muted" title="casou pelo telefone gravado">pelo telefone</span>}
            <button type="button" className={BOTAO} disabled={!podeVincular || ocupado} title={razao} onClick={() => void acao('/desvincular')} data-testid="whats-desvincular">
              Desvincular
            </button>
          </>
        ) : conversa.equipe ? (
          <>
            <span className="rounded border border-border px-1.5 text-[11px] uppercase tracking-wide text-muted">Equipe</span>
            <button type="button" className={BOTAO} disabled={!podeVincular || ocupado} title={razao} onClick={() => void acao('/equipe', { equipe: false })} data-testid="whats-tirar-equipe">
              Tirar da equipe
            </button>
          </>
        ) : (
          <>
            <span className="text-muted">sem vínculo</span>
            {conversa.sugestao && (
              <button
                type="button"
                className={`${BOTAO} border-brand/60 text-brand`}
                disabled={!podeVincular || ocupado}
                title={razao ?? `O nome do grupo é igual ao de ${conversa.sugestao.tipo === 'lead' ? 'um lead' : 'um cliente'}. Um clique liga.`}
                onClick={() => void acao('/sugestao')}
                data-testid="whats-vinculo-sugestao"
              >
                Vincular a {conversa.sugestao.nome}?
              </button>
            )}
            <button type="button" className={BOTAO} disabled={!podeVincular} title={razao} aria-expanded={modo?.tipo === 'lead'} onClick={() => abrir('lead')} data-testid="whats-vincular-lead">
              Vincular a lead
            </button>
            <button type="button" className={BOTAO} disabled={!podeVincular} title={razao} aria-expanded={modo?.tipo === 'cliente'} onClick={() => abrir('cliente')} data-testid="whats-vincular-cliente">
              Vincular a cliente
            </button>
            <button type="button" className={BOTAO} disabled={!podeVincular || ocupado} title={razao} onClick={() => void acao('/equipe', { equipe: true })} data-testid="whats-marcar-equipe">
              Marcar como equipe
            </button>
          </>
        )}
      </div>

      {!v && !conversa.equipe && umAUmComNumero && (
        <p className="text-[12px] text-muted" data-testid="whats-convite-telefone">
          Este número não está em nenhum lead.{' '}
          <button type="button" className="text-brand underline disabled:cursor-not-allowed disabled:opacity-50" disabled={!podeVincular} title={razao} onClick={() => abrir('telefone')} data-testid="whats-telefone-no-lead">
            Pôr num lead
          </button>
        </p>
      )}

      {!podeVincular && <p className="text-[11.5px] text-muted">{RAZAO_SEM_PERMISSAO}</p>}

      {modo && (
        <div className="rounded border border-border bg-bg p-2" data-testid="whats-vinculo-painel">
          <label className="sr-only" htmlFor={`busca-vinculo-${conversa.id}`}>
            {modo.tipo === 'cliente' ? 'buscar cliente' : 'buscar lead'}
          </label>
          <input
            id={`busca-vinculo-${conversa.id}`}
            data-testid="whats-vinculo-busca"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={modo.tipo === 'cliente' ? 'Buscar cliente pelo nome' : 'Buscar lead pelo nome ou empresa'}
            className="w-full rounded border border-border bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-brand"
          />
          {modo.tipo === 'telefone' && <p className="mt-1 text-[11.5px] text-muted">O número desta conversa vai para o lead escolhido, e a conversa fica ligada a ele.</p>}
          {trocar ? (
            <div className="mt-2 space-y-1.5" role="alertdialog" aria-label="trocar o telefone do lead">
              <p className="text-[12.5px]">{trocar.nome} já tem outro telefone. Trocar pelo número desta conversa?</p>
              <div className="flex gap-2">
                <button type="button" className={BOTAO} disabled={ocupado} onClick={() => void acao('/telefone-no-lead', { leadId: trocar.id, substituir: true })} data-testid="whats-trocar-telefone">
                  Trocar
                </button>
                <button type="button" className={BOTAO} onClick={() => setTrocar(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : candidatos === null ? (
            <p className="mt-2 text-[12px] text-muted">buscando…</p>
          ) : candidatos.length === 0 ? (
            <p className="mt-2 text-[12px] text-muted">Nada encontrado{q ? ` para "${q}"` : ' parecido com o nome da conversa'}. Digite para buscar.</p>
          ) : (
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {candidatos.map((c) => (
                <li key={`${c.tipo}:${c.id}`}>
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => void escolher(c)}
                    data-testid={`whats-vinculo-candidato-${c.id}`}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-surface disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-text">{c.nome}</span>
                      {c.detalhe && <span className="block truncate text-[11px] text-muted">{c.detalhe}</span>}
                    </span>
                    {c.igual && <span className="shrink-0 rounded bg-brand/15 px-1.5 text-[10.5px] text-brand">nome igual</span>}
                    <span className="shrink-0 text-[10.5px] uppercase text-muted">{c.tipo}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* Integração 26/10: o cliente ainda não existe no OS? Cadastra com o nome digitado e já vincula. */}
          {modo.tipo === 'cliente' && !trocar && q.trim().length >= 2 && (
            <button
              type="button"
              disabled={!podeVincular || ocupado}
              title={razao}
              onClick={() => void acao('/cliente-novo', { nome: q.trim() })}
              data-testid="whats-cadastrar-cliente"
              className="mt-2 w-full rounded border border-dashed border-brand/60 px-2 py-1.5 text-left text-[12.5px] text-brand hover:bg-brand/10 disabled:opacity-50"
            >
              + cadastrar &ldquo;{q.trim()}&rdquo; como cliente e vincular
            </button>
          )}
        </div>
      )}

      {erro && (
        <p role="alert" className="text-[12px] text-bad">
          {erro}
        </p>
      )}
    </div>
  );
}
