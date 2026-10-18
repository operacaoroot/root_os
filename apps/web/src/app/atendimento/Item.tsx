'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CAPACIDADE_DE_APROVAR_A_SEMANA } from '@mktos/shared';
import { diaHoraSP, prazoEmPalavras } from '@/lib/cockpit';
import { Conteudo } from './Conteudo';
import { CartaoDoLote } from './CartaoDoLote';
import { CAPACIDADE_DA_PROPOSTA, CartaoDaProposta } from './CartaoDaProposta';
import { fraseDoPedido } from './frase-do-pedido';
import {
  condicoesDeAssinatura,
  grupoDoItem,
  motivoDaEspera,
  nivelEmPalavras,
  passoDoItem,
  quemPodeAssinar,
} from './organizar-fila';
import { EXPLICACAO_DA_GAVETA, Etiqueta, Selo, TITULO_DA_GAVETA, esperaLegivel, horaLegivel, inputCls } from './ui';
import type { ItemDaFila } from './tipos';

/*
 * UM ITEM DA FILA — tudo o que quem assina precisa ler antes de dizer sim.
 *
 * Desde a rodada do painel P4 (18/10/2026) o item nasce FECHADO, numa linha só:
 * quem pediu · o que o pedido faz (verbo + objeto, `frase-do-pedido.ts`) · o
 * nível em palavras · há quanto tempo e quando vence · o botão do passo. Abrir
 * mostra o conteúdo exato como sempre, e o botão de assinar mora DENTRO do item
 * aberto: na linha fechada ele se chama "Ler e confirmar" e só abre. Assinar é
 * assinar o que se leu.
 *
 * A regra da tela é uma só: NÃO OFERECER BOTÃO QUE A API VAI RECUSAR.
 *
 * São CINCO travas do lado de lá, e a tela espelha as cinco, na mesma ordem, com
 * o `porQueNao` que o servidor calculou:
 *
 *   1. a aprovação ainda está esperando;
 *   2. a PORTA ainda deixaria esta ação sair — capacidade no catálogo, régua de
 *      hoje permitindo, argumentos no formato de hoje (`item.impedimento`).
 *      Esta é a única que não fala de quem olha: ninguém executa aquela linha;
 *   3. quem propôs NÃO assina (invariante 7 da escada);
 *   4. quem decide é gente, tem `aprovacoes.decidir` no BANCO e no TOKEN desta
 *      sessão — a trava da rota lê o token, que dura horas;
 *   5. a alçada do banco alcança a `alcadaMinima` gravada na linha.
 *
 * RECUSAR É OUTRA HISTÓRIA, e o botão aparece em mais casos de propósito: do
 * lado da API, `reject` pede gente ativa com a permissão de decidir — e NÃO pede
 * alçada nem proíbe o proponente. É a única saída que quem propôs tem para
 * cancelar o que propôs, e negar nunca é mais arriscado do que deixar como está.
 * Por isso ele fica também na linha fechada.
 *
 * E É A SAÍDA DA GAVETA "CONFIRMADA, AGUARDANDO EXECUÇÃO": `updateMany` de
 * `reject` aceita `pendente` E `confirmada` (`approvals.service.ts`), então a
 * MESMA rota que a tela já chama resolve. O que não existe é confirmar de novo.
 */

interface Props {
  item: ItemDaFila;
  /**
   * Quem está olhando decide na fila NESTA SESSÃO — banco e token concordando
   * (`fila.eu.decideNestaSessao`). O banco sozinho ofereceria botão a quem foi
   * promovido no meio da sessão, e a trava da rota lê o token.
   */
  euDecido: boolean;
  souOProponente: boolean;
  ocupado: boolean;
  aoAprovar: (id: string, motivo: string, senha: string) => void;
  aoRecusar: (id: string) => void;
  /** Quem olha, para dizer "falta a titular" e afins. Sem ele, a linha usa só o que o item traz. */
  eu?: { id: string; alcada: string };
  /** O relógio do servidor (`fila.agora`), para "vence em 10 min" não depender do navegador. */
  agora?: string;
}

export function Item({ item, euDecido, souOProponente, ocupado, aoAprovar, aoRecusar, eu, agora }: Props) {
  const [aberto, setAberto] = useState(false);
  const [focar, setFocar] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [senha, setSenha] = useState('');
  const detalhe = useRef<HTMLDivElement>(null);
  const idDoDetalhe = useId();

  const quem = {
    id: souOProponente ? item.proponente.id : (eu?.id ?? ''),
    alcada: eu?.alcada ?? '',
    decideNestaSessao: euDecido,
  };
  const esperando = item.gaveta === 'esperando';
  const grupo = grupoDoItem(item, quem);
  const passo = passoDoItem(item, quem);
  const frase = fraseDoPedido(item);
  const subiu = item.nivelBase && item.nivelBase !== item.nivel;

  /*
   * MD8: o lote da semana guarda só o hash da lista. A titular assina depois de
   * ver o conteúdo de cada post (o cartão); até ele carregar, não há botão. O
   * cartão só monta com o item aberto, e fechar o item zera a leitura.
   */
  const ehLote = item.capacidade === CAPACIDADE_DE_APROVAR_A_SEMANA;
  const [loteLido, setLoteLido] = useState(false);
  const aoLerLote = useCallback((ok: boolean) => setLoteLido(ok), []);
  /*
   * E-7: a proposta do comercial guarda nos argumentos só produto, valor,
   * parcelas e o hash. O cartão mostra a versão inteira que o hash prende; sem
   * ele carregado e conferido, não há botão.
   */
  const ehProposta = item.capacidade === CAPACIDADE_DA_PROPOSTA;
  const [propostaLida, setPropostaLida] = useState(false);
  const aoLerProposta = useCallback((ok: boolean) => setPropostaLida(ok), []);
  const hashDaProposta = typeof item.conteudo?.hash === 'string' ? item.conteudo.hash : null;
  const podeAprovarAgora = item.euPossoAprovar && (!ehLote || loteLido) && (!ehProposta || propostaLida);

  const alternar = () => {
    if (aberto) {
      setLoteLido(false);
      setPropostaLida(false);
    }
    setAberto(!aberto);
  };
  const abrirParaLer = () => {
    setAberto(true);
    setFocar(true);
  };
  useEffect(() => {
    if (aberto && focar) {
      detalhe.current?.focus();
      setFocar(false);
    }
  }, [aberto, focar]);

  const quando = linhaDoTempo(item, agora);
  const espera = grupo === 'outra' ? `${motivoDaEspera(item, quem)} · ${quemPodeAssinar(item)}` : null;

  const botaoRecusar = (rotulo: string) => (
    <button
      type="button"
      disabled={ocupado}
      onClick={() => aoRecusar(item.id)}
      className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:text-text disabled:opacity-50"
      data-testid={`aprov-recusar-${item.id}`}
    >
      {rotulo}
    </button>
  );

  return (
    <article className="rounded-lg border border-border bg-surface" data-testid={`aprov-item-${item.id}`}>
      {/* ---------------------------------------------------- a linha compacta */}
      <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
        <button
          type="button"
          onClick={alternar}
          aria-expanded={aberto}
          aria-controls={idDoDetalhe}
          className="flex min-w-0 flex-1 items-start gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          data-testid={`aprov-expandir-${item.id}`}
        >
          <span aria-hidden className="mt-0.5 w-3 shrink-0 font-mono text-xs text-muted">
            {aberto ? '−' : '+'}
          </span>
          <Selo nivel={item.nivel} marca={`nivel-${item.id}`} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm" title={`${item.proponente.nome} · ${frase}`}>
              <span className="text-muted">
                {item.proponente.nome}
                {item.proponente.tipo === 'ai' ? ' (agente)' : ''}
              </span>
              <span className="text-muted"> · </span>
              <span className="font-medium text-text" data-testid={`aprov-frase-${item.id}`}>
                {frase}
              </span>
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
              <span className="font-mono">{nivelEmPalavras(item.nivel)}</span>
              <span aria-hidden className="hidden sm:inline">
                ·
              </span>
              <span>{quando}</span>
              {esperando && item.exigeReauth && <Etiqueta tom="quente">pede senha</Etiqueta>}
              {esperando && item.exigeMotivo && <Etiqueta tom="quente">pede motivo escrito</Etiqueta>}
              {espera && (
                <span className="text-warn" title={item.porQueNao ?? undefined} data-testid={`aprov-espera-${item.id}`}>
                  {espera}
                </span>
              )}
            </span>
          </span>
        </button>
        {!aberto && (passo.assinar || passo.recusar) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 pl-5 sm:pl-0">
            {passo.assinar && (
              <button
                type="button"
                onClick={abrirParaLer}
                title="Abre o conteúdo exato: você assina depois de ler"
                className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-ink hover:opacity-90"
                data-testid={`aprov-acao-${item.id}`}
              >
                {passo.assinar.fechado}
              </button>
            )}
            {passo.recusar && botaoRecusar(passo.recusar)}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------ o item aberto */}
      {aberto && (
        <div
          id={idDoDetalhe}
          ref={detalhe}
          tabIndex={-1}
          className="border-t border-border px-4 py-4 outline-none sm:px-5"
          data-testid={`item-${item.id}`}
        >
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {item.capacidade && <span className="font-mono">{item.capacidade}</span>}
            {item.canal && <Etiqueta>canal: {item.canal}</Etiqueta>}
            {item.agente && <Etiqueta>agente: {item.agente}</Etiqueta>}
            <Etiqueta>alçada mínima: {item.alcadaMinima}</Etiqueta>
            {item.exigeReauth && <Etiqueta tom="quente">exige senha de novo</Etiqueta>}
            {item.exigeMotivo && <Etiqueta tom="quente">exige motivo escrito</Etiqueta>}
          </p>
          <p className="mt-1 text-xs text-muted">
            Resumo do servidor: <span className="text-text">{item.resumo}</span> · proposta{' '}
            {horaLegivel(item.propostaEm)} · {esperando ? 'expira' : 'expirava'} {horaLegivel(item.expiraEm)}
          </p>

          {!esperando && (
            <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">
              <span className="font-medium text-text">{TITULO_DA_GAVETA[item.gaveta]}.</span>{' '}
              {EXPLICACAO_DA_GAVETA[item.gaveta]}
            </p>
          )}

          {/* -------------------------------------------- o que vai ser executado */}
          <section className="mt-4">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted">O que vai ser executado</h4>
            <div className="mt-2">
              <Conteudo valor={item.conteudo} oculto={item.conteudoOculto} />
            </div>
            {ehLote && !item.conteudoOculto && (
              <div className="mt-3">
                <CartaoDoLote loteId={item.recurso.id} onPronto={aoLerLote} />
              </div>
            )}
            {ehProposta && !item.conteudoOculto && (
              <div className="mt-3">
                <CartaoDaProposta recursoId={item.recurso.id} hashAssinado={hashDaProposta} onPronto={aoLerProposta} />
              </div>
            )}
            {/*
              "hash gravado", e não "assinatura do conteúdo": ninguém recalcula o
              hash sobre o texto acima, nem aqui nem na rota que alimenta a fila.
              Ele é o identificador que amarra esta linha à do RASTRO e à do
              `ToolCall`; quem o confere de verdade é a porta, na hora de propor.
            */}
            <p className="mt-2 break-all font-mono text-[10px] text-muted">
              hash gravado na aprovação (não conferido aqui): {item.hashDoConteudo}… · {item.recurso.tipo}{' '}
              {item.recurso.id}
            </p>
          </section>

          {/* ---------------------------------------- o que impede a execução -- */}
          {item.impedimento && (
            <p
              className="mt-4 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad"
              data-testid={`impedimento-${item.id}`}
            >
              {item.impedimento}
            </p>
          )}

          {/* ------------------------------------------------ por que este degrau */}
          <section className="mt-4">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted">Por que parou em {item.nivel}</h4>
            {item.gatilhos.length ? (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {subiu && <span className="text-muted">o efeito da capacidade dá {item.nivelBase}; subiu por:</span>}
                {item.gatilhos.map((g) => (
                  <span
                    key={g}
                    data-testid={`gatilho-${g}`}
                    className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-[10px] text-warn"
                  >
                    {g}
                  </span>
                ))}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted">
                Nenhum gatilho acendeu: o degrau vem do próprio efeito da capacidade.
              </p>
            )}
            {item.motivoDaRegua && <p className="mt-1 text-xs text-muted">{item.motivoDaRegua}</p>}
          </section>

          {/*
            QUEM PODE ASSINAR, E O QUE A ASSINATURA PEDE — SÓ NA GAVETA QUE ESPERA.
            Nas outras três a pergunta não existe mais: a ação já foi decidida,
            expirou ou foi recusada, e "a ação fica retida até <prazo>" seria
            falso sobre elas.
          */}
          {esperando && (
            <section className="mt-4">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted">Quem pode aprovar</h4>
              {item.aprovadores.length ? (
                <ul className="mt-2 flex flex-wrap gap-2 text-xs" data-testid={`aprovadores-${item.id}`}>
                  {item.aprovadores.map((a) => (
                    <li key={a.id} className="rounded bg-surface-2 px-2 py-1">
                      <span className="text-text">{a.nome}</span> <span className="text-muted">· {a.alcada}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p
                  className="mt-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn"
                  data-testid={`sem-aprovador-${item.id}`}
                >
                  Ninguém desta empresa pode assinar esta ação hoje. Quem propõe não assina, e não há outra pessoa
                  ativa com alçada &quot;{item.alcadaMinima}&quot; e permissão de decidir. A ação fica retida até{' '}
                  {horaLegivel(item.expiraEm)}, e nada sai. O caminho é criar um segundo usuário com essa alçada.
                </p>
              )}
              <h4 className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">O que a assinatura pede</h4>
              <ul className="mt-1 space-y-0.5 text-xs text-text" data-testid={`aprov-condicoes-${item.id}`}>
                {condicoesDeAssinatura(item).map((c) => (
                  <li key={c} className="flex gap-2">
                    <span aria-hidden className="font-mono text-muted">·</span>
                    {c}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ----------------------------------------------------------- a decisão */}
          {item.decididoPor && (
            <p className="mt-4 text-xs text-muted">
              decidida por <span className="text-text">{item.decididoPor}</span>
              {item.decididoEm ? ` em ${horaLegivel(item.decididoEm)}` : ''}
              {item.motivo ? `: “${item.motivo}”` : ''}
            </p>
          )}

          {/* Sem o cartão, não se assina; recusar continua ao alcance, para o pedido não ficar na fila até vencer. */}
          {item.euPossoAprovar && ehLote && !loteLido && (
            <div className="mt-4 space-y-2 border-t border-border pt-4">
              <p className="text-xs text-muted" data-testid={`lote-esperando-${item.id}`}>
                O botão de assinar aparece quando os posts do lote estiverem na tela: assinar é assinar o que você
                leu.
              </p>
              {passo.recusar && botaoRecusar('Recusar')}
            </div>
          )}
          {item.euPossoAprovar && ehProposta && !propostaLida && (
            <div className="mt-4 space-y-2 border-t border-border pt-4">
              <p className="text-xs text-muted" data-testid={`proposta-esperando-${item.id}`}>
                O botão de assinar aparece quando a proposta inteira estiver na tela e conferir com o hash da
                aprovação.
              </p>
              {passo.recusar && botaoRecusar('Recusar')}
            </div>
          )}
          {podeAprovarAgora && passo.assinar ? (
            <div className="mt-4 space-y-3 border-t border-border pt-4">
              {item.exigeMotivo && (
                <label className="block text-xs text-muted">
                  Por que esta ação deve sair? ({item.nivel} exige motivo escrito)
                  <textarea
                    className={`${inputCls} mt-1`}
                    rows={2}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="ex.: o cliente confirmou por telefone às 14h"
                  />
                </label>
              )}
              {item.exigeReauth && (
                <label className="block text-xs text-muted">
                  Sua senha ({item.nivel} exige que você prove de novo que é você)
                  <input
                    type="password"
                    autoComplete="current-password"
                    className={`${inputCls} mt-1`}
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                  />
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => aoAprovar(item.id, motivo, senha)}
                  className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50"
                  data-testid={`aprov-acao-${item.id}`}
                >
                  {passo.assinar.aberto}
                </button>
                {passo.recusar && botaoRecusar('Recusar')}
              </div>
              <p className="text-[11px] text-muted">
                {passo.assinar.aberto} EXECUTA a ação com o conteúdo acima e fecha o evento no rastro. Não há
                desfazer por esta tela.
              </p>
            </div>
          ) : item.euPossoAprovar ? null : (
            <div className="mt-4 space-y-2 border-t border-border pt-4">
              <p className="text-xs text-muted" data-testid={`porque-nao-${item.id}`}>
                {item.porQueNao}
              </p>
              {passo.recusar && botaoRecusar(passo.recusar)}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** "há 5 min · vence em 10 min", "venceu 11/09 12:15", "recusada 11/09 12:03". */
function linhaDoTempo(item: ItemDaFila, agora?: string): string {
  const relogio = agora ? new Date(agora) : new Date();
  if (item.gaveta === 'esperando') {
    const prazo = prazoEmPalavras(item.expiraEm, relogio);
    return `${esperaLegivel(item.esperandoMs)} · ${prazo.startsWith('em ') ? `vence ${prazo}` : prazo}`;
  }
  if (item.gaveta === 'expirou') return `venceu ${diaHoraSP(item.expiraEm)}`;
  if (item.gaveta === 'recusada') {
    return `recusada${item.decididoPor ? ` por ${item.decididoPor}` : ''}${item.decididoEm ? ` ${diaHoraSP(item.decididoEm)}` : ''}`;
  }
  return `confirmada${item.decididoPor ? ` por ${item.decididoPor}` : ''}, sem executar`;
}
