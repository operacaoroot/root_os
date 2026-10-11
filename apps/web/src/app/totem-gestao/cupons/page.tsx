'use client';

import { useEffect, useRef, useState } from 'react';
import {
  TOTEM_ROTULO_DO_STATUS_CUPOM,
  type TotemCupomBaixa,
  type TotemCupomDetalhe,
  type TotemLojaDoEscopo,
} from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, Chip, inputCls } from '@/app/referencias/ui';
import {
  TOM_DO_STATUS,
  codigoDigitado,
  codigoNaTela,
  dataBR,
  dataHoraBR,
  guardarLoja,
  lerLojaGuardada,
  lojaInicial,
  motivoSemBaixa,
  textoDasLojasValidas,
} from './cupom-na-tela';

/*
 * A tela do caixa (frente D). O cliente mostra o código, o caixa digita,
 * confere o resultado e dá a baixa. Tudo grande e numa coluna só, porque a
 * tela é usada de pé, com fila, às vezes num tablet no balcão.
 */

const BOTAO_GRANDE = 'rounded-xl px-6 py-3 text-lg font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const BOTAO_PRINCIPAL = `${BOTAO_GRANDE} bg-brand text-bg hover:bg-brand/90`;
const BOTAO_SECUNDARIO = `${BOTAO_GRANDE} border border-border bg-surface-2 hover:border-brand-dim`;

type Acao = 'consultar' | 'baixa' | 'cancelar';

export default function PaginaDosCupons() {
  const { token, ready, can } = useAuth();
  const [lojas, setLojas] = useState<TotemLojaDoEscopo[] | null>(null);
  const [lojaId, setLojaId] = useState('');
  const [texto, setTexto] = useState('');
  const [cupom, setCupom] = useState<TotemCupomDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [acao, setAcao] = useState<Acao | null>(null);
  const campo = useRef<HTMLInputElement>(null);

  const podeConsultar = can('totem.cupons');

  useEffect(() => {
    if (!ready || !token || !podeConsultar) return;
    apiGet<TotemLojaDoEscopo[]>('/totem-campanhas/lojas', token)
      .then((l) => {
        setLojas(l);
        setLojaId(lojaInicial(l, lerLojaGuardada()));
      })
      .catch((e: Error) => setErro(e.message));
  }, [ready, token, podeConsultar]);

  function trocarLoja(id: string) {
    setLojaId(id);
    guardarLoja(id);
  }

  function digitar(valor: string) {
    setTexto(valor.toUpperCase());
    setCupom(null);
    setErro(null);
    setAviso(null);
  }

  function recomecar() {
    digitar('');
    campo.current?.focus();
  }

  async function executar(qual: Acao, pedido: () => Promise<TotemCupomDetalhe>, sucesso: string | null) {
    setAcao(qual);
    setErro(null);
    setAviso(null);
    try {
      setCupom(await pedido());
      setAviso(sucesso);
    } catch (err) {
      if (qual === 'consultar') setCupom(null);
      setErro((err as Error).message);
    } finally {
      setAcao(null);
    }
  }

  function consultar(e: React.FormEvent) {
    e.preventDefault();
    const lido = codigoDigitado(texto);
    if (!lido) {
      setErro('Digite o código que o cliente mostrou.');
      return;
    }
    if ('problema' in lido) {
      setErro(lido.problema);
      return;
    }
    void executar('consultar', () => apiGet<TotemCupomDetalhe>(`/totem-campanhas/cupons/${lido.codigo}`, token), null);
  }

  function darBaixa() {
    if (!cupom) return;
    const corpo: TotemCupomBaixa = { lojaId };
    void executar(
      'baixa',
      () => apiPost<TotemCupomDetalhe>(`/totem-campanhas/cupons/${cupom.codigo}/baixa`, corpo, token),
      'Baixa feita. Aplique o benefício nesta compra; o cupom não vale mais.',
    );
  }

  function cancelar() {
    if (!cupom) return;
    const ok = window.confirm(
      `Cancelar o cupom ${codigoNaTela(cupom.codigo)}? Depois de cancelado, ele não vale mais em loja nenhuma.`,
    );
    if (!ok) return;
    void executar(
      'cancelar',
      () => apiPost<TotemCupomDetalhe>(`/totem-campanhas/cupons/${cupom.codigo}/cancelar`, {}, token),
      'Cupom cancelado.',
    );
  }

  const ativas = lojas?.filter((l) => l.ativa) ?? [];
  const lojaDoCaixa = ativas.find((l) => l.id === lojaId) ?? null;
  const motivo = cupom ? motivoSemBaixa(cupom, lojaId) : null;

  return (
    <section className="mx-auto max-w-2xl space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Cupons</h1>
        <p className="text-sm text-muted">
          Digite o código que o cliente mostra no celular ou no totem para conferir o cupom e dar a baixa.
        </p>
      </div>

      {!ready && <p className="text-sm text-muted">Carregando…</p>}
      {ready && !podeConsultar && <p className="text-sm text-muted">O seu acesso não inclui a consulta de cupons.</p>}

      {ready && podeConsultar && (
        <>
          <Card titulo="Loja deste caixa">
            {lojas === null && !erro && <p className="text-sm text-muted">Carregando as lojas…</p>}
            {lojas !== null && ativas.length === 0 && (
              <p className="text-sm text-muted">
                Nenhuma loja ativa está liberada para o seu acesso. Peça a quem administra o totem para incluir a sua
                loja.
              </p>
            )}
            {ativas.length === 1 && lojaDoCaixa && <p className="text-base font-medium">{lojaDoCaixa.nome}</p>}
            {ativas.length > 1 && (
              <select
                aria-label="Loja deste caixa"
                className={`${inputCls} text-base`}
                value={lojaId}
                onChange={(e) => trocarLoja(e.target.value)}
              >
                <option value="">Escolha a loja</option>
                {ativas.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome}
                  </option>
                ))}
              </select>
            )}
          </Card>

          <form onSubmit={consultar} className="space-y-3 rounded-xl border border-border bg-surface p-5">
            <label htmlFor="codigo-do-cupom" className="block text-sm font-medium">
              Código do cupom
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="codigo-do-cupom"
                ref={campo}
                value={texto}
                onChange={(e) => digitar(e.target.value)}
                placeholder="ABCD-2345"
                maxLength={12}
                autoFocus
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="w-full rounded-xl border-2 border-border bg-surface-2 px-4 py-3 font-os-mono text-3xl uppercase tracking-[0.2em] outline-none focus:border-brand-dim"
              />
              <button type="submit" disabled={acao !== null} className={BOTAO_PRINCIPAL}>
                {acao === 'consultar' ? 'Consultando…' : 'Consultar'}
              </button>
            </div>
            <p className="text-xs text-muted">São 8 letras ou números. O hífen e os espaços não fazem diferença.</p>
          </form>

          {erro && (
            <div role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-base text-bad">
              {erro}
            </div>
          )}

          {aviso && (
            <div role="status" className="rounded-lg border border-good/40 bg-good/10 px-4 py-3 text-base text-good">
              {aviso}
            </div>
          )}

          {cupom && (
            <section aria-label="Resultado da consulta" className="space-y-4 rounded-xl border border-border bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-os-mono text-3xl tracking-[0.15em]">{codigoNaTela(cupom.codigo)}</p>
                <Chip tone={TOM_DO_STATUS[cupom.status]}>{TOTEM_ROTULO_DO_STATUS_CUPOM[cupom.status]}</Chip>
              </div>

              {motivo ? (
                <p className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-lg font-medium text-warn">
                  {motivo}
                </p>
              ) : (
                <p className="rounded-lg border border-good/40 bg-good/10 px-4 py-3 text-lg font-medium text-good">
                  O cupom vale nesta loja.
                </p>
              )}

              <div className="space-y-1">
                <p className="text-2xl font-semibold">{cupom.beneficio}</p>
                {cupom.detalhe && <p className="text-base">{cupom.detalhe}</p>}
              </div>

              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted">Campanha</dt>
                  <dd>{cupom.campanha}</dd>
                </div>
                <div>
                  <dt className="text-muted">Lojas onde vale</dt>
                  <dd>{textoDasLojasValidas(cupom.lojasValidas)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Emitido em</dt>
                  <dd>{dataBR(cupom.emitidoEm)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Vale até</dt>
                  <dd>{dataBR(cupom.validoAte)}</dd>
                </div>
                {cupom.usadoEm && (
                  <div className="sm:col-span-2">
                    <dt className="text-muted">Usado em</dt>
                    <dd>
                      {dataHoraBR(cupom.usadoEm)}
                      {cupom.usadoLoja && `, na loja ${cupom.usadoLoja.nome}`}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                {cupom.status === 'emitido' && (
                  <button
                    type="button"
                    onClick={darBaixa}
                    disabled={acao !== null || motivo !== null}
                    className={BOTAO_PRINCIPAL}
                  >
                    {acao === 'baixa' ? 'Dando a baixa…' : 'Dar baixa'}
                  </button>
                )}
                <button type="button" onClick={recomecar} className={BOTAO_SECUNDARIO}>
                  Consultar outro cupom
                </button>
                {cupom.status === 'emitido' && (
                  <button
                    type="button"
                    onClick={cancelar}
                    disabled={acao !== null}
                    className="ml-auto text-sm text-bad hover:underline disabled:opacity-50"
                  >
                    {acao === 'cancelar' ? 'Cancelando…' : 'Cancelar cupom'}
                  </button>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
