'use client';

import { useState } from 'react';
import { Conteudo } from './Conteudo';
import { Etiqueta, Selo, esperaLegivel, horaLegivel, inputCls } from './ui';
import type { ItemDaFila } from './tipos';

/*
 * UM ITEM DA FILA — tudo o que quem assina precisa ler antes de dizer sim.
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
 *
 * E É A SAÍDA DA GAVETA "CONFIRMADA, AGUARDANDO EXECUÇÃO". Essa gaveta já foi
 * descrita aqui como beco sem saída — "só um script tira de lá" —, e não é
 * verdade: `updateMany` de `reject` aceita `pendente` E `confirmada`
 * (`approvals.service.ts`), então a MESMA rota que a tela já chama resolve. O
 * que não existe é confirmar de novo. Esconder o botão ali deixava o item
 * parado até expirar por uma limitação que era só da tela.
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
}

export function Item({ item, euDecido, souOProponente, ocupado, aoAprovar, aoRecusar }: Props) {
  const [motivo, setMotivo] = useState('');
  const [senha, setSenha] = useState('');

  const esperando = item.gaveta === 'esperando';
  const emLimbo = item.gaveta === 'confirmada';
  const podeRecusar = (esperando || emLimbo) && euDecido;
  const subiu = item.nivelBase && item.nivelBase !== item.nivel;

  return (
    <article className="rounded-xl border border-border bg-surface p-5" data-testid={`item-${item.id}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Selo nivel={item.nivel} marca={`nivel-${item.id}`} />
            <h3 className="text-sm font-medium">{item.resumo}</h3>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            {item.capacidade && <span className="font-mono">{item.capacidade}</span>}
            {item.canal && <Etiqueta>canal: {item.canal}</Etiqueta>}
            {item.agente && <Etiqueta>agente: {item.agente}</Etiqueta>}
            <Etiqueta>alçada mínima: {item.alcadaMinima}</Etiqueta>
            {item.exigeReauth && <Etiqueta tom="quente">exige senha de novo</Etiqueta>}
            {item.exigeMotivo && <Etiqueta tom="quente">exige motivo escrito</Etiqueta>}
          </p>
        </div>
        <div className="text-right text-xs text-muted">
          <div>
            proposta por{' '}
            <span className="text-text">
              {item.proponente.nome}
              {item.proponente.tipo === 'ai' ? ' (agente)' : ''}
            </span>
          </div>
          <div>{esperaLegivel(item.esperandoMs)}</div>
          <div>
            {esperando ? 'expira' : 'expirava'} {horaLegivel(item.expiraEm)}
          </div>
        </div>
      </header>

      {/* ---------------------------------------------- o que vai ser executado */}
      <section className="mt-4">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted">
          O que vai ser executado
        </h4>
        <div className="mt-2">
          <Conteudo valor={item.conteudo} oculto={item.conteudoOculto} />
        </div>
        {/*
          "hash gravado", e não "assinatura do conteúdo": o rótulo antigo
          prometia uma verificação que não acontece em lugar nenhum desta tela —
          nem no navegador, nem na rota que a alimenta. Ninguém recalcula o hash
          sobre o texto acima. Ele é o identificador que amarra esta linha à do
          RASTRO e à do `ToolCall`, e quem o confere de verdade é a porta, na
          hora de propor.
        */}
        <p className="mt-2 font-mono text-[10px] text-muted">
          hash gravado na aprovação (não conferido aqui): {item.hashDoConteudo}… ·{' '}
          {item.recurso.tipo} {item.recurso.id}
        </p>
      </section>

      {/* ------------------------------------------ o que impede a execução -- */}
      {item.impedimento && (
        <p
          className="mt-4 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad"
          data-testid={`impedimento-${item.id}`}
        >
          {item.impedimento}
        </p>
      )}

      {/* -------------------------------------------------- por que este degrau */}
      <section className="mt-4">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted">
          Por que parou em {item.nivel}
        </h4>
        {item.gatilhos.length ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {subiu && (
              <span className="text-muted">
                o efeito da capacidade dá {item.nivelBase}; subiu por:
              </span>
            )}
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
        QUEM PODE ASSINAR — SÓ NA GAVETA QUE ESPERA.
        Nas outras três a pergunta não existe mais: a ação já foi decidida,
        expirou ou foi recusada. Pior, a caixa de "ninguém pode assinar" afirma
        que "a ação fica retida até <prazo> — nada sai", que é falso sobre uma
        linha já confirmada e sobre uma que venceu semana passada. Uma tela que
        descreve errado o que aconteceu manda o operador procurar o problema
        errado.
      */}
      {esperando && (
        <section className="mt-4">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted">Quem pode aprovar</h4>
          {item.aprovadores.length ? (
            <ul className="mt-2 flex flex-wrap gap-2 text-xs" data-testid={`aprovadores-${item.id}`}>
              {item.aprovadores.map((a) => (
                <li key={a.id} className="rounded bg-surface-2 px-2 py-1">
                  <span className="text-text">{a.nome}</span>{' '}
                  <span className="text-muted">· {a.alcada}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p
              className="mt-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn"
              data-testid={`sem-aprovador-${item.id}`}
            >
              Ninguém desta empresa pode assinar esta ação hoje. Quem propõe não assina, e não há
              outra pessoa ativa com alçada &quot;{item.alcadaMinima}&quot; e permissão de decidir. A
              ação fica retida até {horaLegivel(item.expiraEm)} — nada sai. O caminho é criar um
              segundo usuário com essa alçada.
            </p>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------- a decisão */}
      {item.decididoPor && (
        <p className="mt-4 text-xs text-muted">
          decidida por <span className="text-text">{item.decididoPor}</span>
          {item.decididoEm ? ` em ${horaLegivel(item.decididoEm)}` : ''}
          {item.motivo ? ` — “${item.motivo}”` : ''}
        </p>
      )}

      {item.euPossoAprovar ? (
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
              className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-ink hover:opacity-90 disabled:opacity-50"
            >
              Aprovar e executar
            </button>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => aoRecusar(item.id)}
              className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-text disabled:opacity-50"
            >
              Recusar
            </button>
          </div>
          <p className="text-[11px] text-muted">
            Aprovar EXECUTA a ação com o conteúdo acima e fecha o evento no rastro. Não há
            desfazer por esta tela.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          <p className="text-xs text-muted" data-testid={`porque-nao-${item.id}`}>
            {item.porQueNao}
          </p>
          {podeRecusar && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => aoRecusar(item.id)}
              className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-text disabled:opacity-50"
              data-testid={`recusar-${item.id}`}
            >
              {emLimbo
                ? 'Recusar e tirar da fila'
                : souOProponente
                  ? 'Cancelar o que eu propus'
                  : 'Recusar'}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
