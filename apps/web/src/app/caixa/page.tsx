'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  CaixaEstadoDoEixo,
  CaixaMotivoDaParada,
  CaixaResposta,
} from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCaixa } from '@/components/caixa';

/*
 * ==========================================================================
 * A CAIXA PESSOAL — "o que precisa de mim", fatia A7
 * ==========================================================================
 *
 * A única tela do OS que responde por PESSOA e não por empresa. Ela não tem
 * fonte própria: agrega três leituras que já existiam e estavam espalhadas —
 * `/atendimento` mostra a fila INTEIRA (inclusive o que você não assina), o
 * quadro mostra todas as tarefas (inclusive as que não são suas) e comentário do
 * quadro não chegava a ninguém.
 *
 * ONDE ESTA TELA SE OBRIGA A NÃO MENTIR, e cada linha custou uma decisão:
 *
 *  1. PERMISSÃO NÃO É ALÇADA, e a tela diz as duas coisas. `aprovacoes.decidir`
 *     é quem trabalha na fila; a alçada, lida do banco a cada confirmação, é de
 *     quem a assinatura vale em cada degrau. Quem acompanha e não decide vê a
 *     frase, não uma lista vazia com cara de vitória;
 *  2. O QUE VAI EXIGIR MOTIVO ESCRITO OU SENHA É DITO ANTES DO CLIQUE, como
 *     `/atendimento` faz. R4/R5 pedem motivo; reautenticação é a senha conferida
 *     contra o hash. Descobrir isso depois de clicar é o defeito da tela do
 *     Google, que anunciava "✅ enviado" em cima de um 200 de retenção;
 *  3. O CONTEÚDO EXATO NÃO PASSA POR AQUI. O corpo de uma ação retida tem UMA
 *     superfície neste repositório (`/atendimento`, e só para quem decide). A
 *     caixa mostra o resumo e leva para lá;
 *  4. "MINHAS TAREFAS" É CASAMENTO POR NOME, e a tela publica por quais nomes
 *     procurou. `WorkTask.assignee` é texto livre herdado do ClickUp, não
 *     ponteiro para `User`: se o seu nome lá é outro, a caixa não acha nada — e
 *     é melhor saber disso do que confiar numa caixa vazia;
 *  5. CONVERSA NÃO É MENÇÃO, e está escrito. Menção não existe como dado neste
 *     produto. O que existe é comentário de outra pessoa numa tarefa sua, na
 *     última semana — menos do que a fatia pediu, e honesto;
 *  6. TELA VAZIA É VITÓRIA E DIZ ISSO. Nunca uma caixa cinza sem explicação.
 */

/** A frase de cada motivo de parada. Espelha `FRASE_DO_MOTIVO`, na API. */
const FRASE_DO_MOTIVO: Record<CaixaMotivoDaParada, string> = {
  prazo_vencido: 'o prazo venceu',
  sem_movimento: 'sem movimento há mais de uma semana',
  presa_com_agente: 'travada com um agente há mais de 24h',
};

const CLS_NIVEL: Record<string, string> = {
  R2: 'text-warn',
  R3: 'text-warn',
  R4: 'text-bad',
  R5: 'text-bad',
};

/**
 * O que a tela escreve quando um eixo veio vazio POR MOTIVO.
 *
 * `ok` não aparece aqui de propósito: vazio com `ok` é vitória, e a frase da
 * vitória é de cada bloco (ela nomeia o que não está esperando).
 */
function frasesDoEixo(estado: CaixaEstadoDoEixo, eixo: 'aprovacoes' | 'quadro'): string | null {
  if (estado === 'ok') return null;
  if (estado === 'fora_da_casa') {
    return 'Sua sessão não corresponde a um usuário ativo desta empresa. Saia e entre de novo — até lá esta caixa não consegue dizer o que espera por você.';
  }
  if (estado === 'sem_permissao') {
    return eixo === 'aprovacoes'
      ? 'Seu perfil não acompanha a fila de aprovação, então esta parte da caixa fica fora. Não é erro: é decisão de papel.'
      : 'Seu perfil não vê o quadro de trabalho, então esta parte da caixa fica fora. Não é erro: é decisão de papel.';
  }
  if (estado === 'nao_decide') {
    return 'Você acompanha a fila de aprovação, mas não decide nela (falta "aprovacoes.decidir"). Nada aqui espera a sua assinatura — e quem pode assinar cada item aparece em Aprovações.';
  }
  if (estado === 'modulo_desligado') {
    return 'O módulo Trabalho não está contratado por esta empresa, então não há quadro nem tarefas para esperar por você.';
  }
  // sem_identidade
  return 'Não há por qual nome procurar você no campo de responsável do quadro (seu cadastro está sem nome e sem e-mail). Sem isso, a caixa não consegue dizer quais tarefas são suas.';
}

function quandoVence(ms: number): string {
  const horas = Math.floor(ms / 3_600_000);
  if (horas < 1) return `vence em ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (horas < 48) return `vence em ${horas}h`;
  return `vence em ${Math.floor(horas / 24)} dias`;
}

function desdeQuando(iso: string, agora: Date): string {
  const dias = Math.floor((agora.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (dias < 1) return 'hoje';
  if (dias === 1) return 'ontem';
  return `há ${dias} dias`;
}

export default function CaixaPage() {
  const { token, ready } = useAuth();
  const { recarregar } = useCaixa();
  const [caixa, setCaixa] = useState<CaixaResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const buscar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = await apiGet<CaixaResposta>('/caixa', token);
      setCaixa(r);
      /*
       * Remede o selo da barra no mesmo instante em que a lista aparece: sem
       * isto a barra ficaria com a contagem da navegação anterior e as duas
       * superfícies publicariam números diferentes do mesmo número — o defeito
       * que a fatia A3 pagou nas horas devolvidas.
       */
      recarregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [token, recarregar]);

  useEffect(() => {
    if (!ready || !token) return;
    void buscar();
    // `buscar` entra nas dependências e NÃO causa laço porque `recarregar` é
    // estável (`useCallback` sem dependências, em `caixa.tsx`): se um dia ele
    // passar a trocar de identidade a cada medição, esta tela se rebusca em
    // laço — e é ali que o conserto mora, não aqui.
  }, [ready, token, buscar]);

  if (erro) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-bad">{erro}</p>
        <button
          onClick={() => void buscar()}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-text"
        >
          tentar de novo
        </button>
      </div>
    );
  }

  if (!caixa) {
    return <p className="text-sm text-muted">{carregando ? 'medindo o que espera por você…' : ''}</p>;
  }

  const agora = new Date(caixa.agora);
  const medido = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const nada = caixa.total === 0;

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------ cabeçalho */}
      <div className="space-y-1">
        <p className="text-sm text-muted">
          {nada ? (
            <>Nada esperando por você.</>
          ) : (
            <>
              <span className="text-text">
                {caixa.total}
                {caixa.totalParcial ? '+' : ''}
              </span>{' '}
              item(ns) esperando uma ação sua.
            </>
          )}{' '}
          Medido às {medido}.
        </p>
        <p className="text-xs text-muted">
          Esta caixa não guarda nada: ela lê a fila de aprovação, o quadro de trabalho e os
          comentários dele. Quem age é a tela de destino, com a permissão dela.
          {caixa.totalParcial &&
            ' Algum eixo bateu no teto da consulta — o total acima é um PISO, não o número exato.'}
        </p>
        {!caixa.eu.ativo && (
          <p className="text-xs text-bad">
            Sua sessão não corresponde a um usuário ativo desta empresa. Saia e entre de novo.
          </p>
        )}
      </div>

      {/* ==================================================== APROVAÇÕES ====== */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
            Aprovações que você pode assinar
          </h2>
          <span className="text-xs text-muted">
            sua alçada: <span className="text-text">{caixa.eu.alcada}</span>
            {caixa.eu.decide && !caixa.eu.decideNestaSessao && (
              <>
                {' · '}
                <span className="text-warn">
                  seu perfil passou a decidir depois que esta sessão começou — saia e entre para
                  valer
                </span>
              </>
            )}
          </span>
        </div>

        {frasesDoEixo(caixa.aprovacoes.estado, 'aprovacoes') ? (
          <p className="rounded-xl border border-border px-4 py-4 text-sm text-muted">
            {frasesDoEixo(caixa.aprovacoes.estado, 'aprovacoes')}
          </p>
        ) : caixa.aprovacoes.itens.length === 0 ? (
          <p className="rounded-xl border border-border px-4 py-6 text-sm text-muted">
            Nenhuma aprovação esperando a sua assinatura. O que outra pessoa precisa assinar
            continua em{' '}
            <Link href="/atendimento" className="text-brand hover:underline">
              Aprovações
            </Link>
            .
          </p>
        ) : (
          <ol className="overflow-hidden rounded-xl border border-border">
            {caixa.aprovacoes.itens.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-3 last:border-b-0 hover:bg-surface-2"
              >
                <span className={`text-[11px] font-medium ${CLS_NIVEL[a.nivel] ?? 'text-muted'}`}>
                  {a.nivel}
                </span>
                <span className="text-sm font-medium">{a.resumo}</span>
                {a.capacidade && (
                  <span className="font-mono text-[11px] text-muted">{a.capacidade}</span>
                )}
                <span className="text-xs text-muted">
                  proposta por <span className="text-text">{a.proponente}</span>
                </span>
                {/*
                 * O QUE VAI SER PEDIDO NO CLIQUE, DITO ANTES DELE. R4/R5 exigem
                 * motivo escrito e a senha conferida contra o hash — descobrir
                 * isso na hora é o que faz a pessoa desistir no meio.
                 */}
                {a.exigeMotivo && (
                  <span
                    className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-warn"
                    title="Este nível exige motivo escrito na confirmação."
                  >
                    pede motivo escrito
                  </span>
                )}
                {a.exigeReauth && (
                  <span
                    className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-warn"
                    title="A confirmação pede a sua senha outra vez, conferida contra o hash."
                  >
                    pede sua senha
                  </span>
                )}
                <span className="text-xs text-muted">{quandoVence(a.venceEmMs)}</span>
                <Link
                  href="/atendimento"
                  className="ml-auto text-xs text-brand hover:underline"
                  title="O conteúdo exato da ação e o botão de assinar ficam na fila de aprovação, que pede permissão própria."
                >
                  abrir na fila →
                </Link>
              </li>
            ))}
          </ol>
        )}

        {caixa.aprovacoes.retidasPorImpedimento > 0 && (
          <p className="text-xs text-warn">
            {caixa.aprovacoes.retidasPorImpedimento} aprovação(ões) alcançam a sua alçada e a porta
            recusaria hoje (capacidade fora do catálogo, régua mudada ou argumento fora do formato).
            Elas não esperam por você — esperam por um conserto, e{' '}
            <Link href="/atendimento" className="text-brand hover:underline">
              Aprovações
            </Link>{' '}
            diz qual é.
          </p>
        )}
        {caixa.aprovacoes.truncado && (
          <p className="text-xs text-muted">
            Mostrando as {caixa.aprovacoes.teto} primeiras a vencer — há mais.
          </p>
        )}
      </section>

      {/* ======================================================= TAREFAS ====== */}
      <section className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
          Suas tarefas paradas
        </h2>

        {frasesDoEixo(caixa.tarefas.estado, 'quadro') ? (
          <p className="rounded-xl border border-border px-4 py-4 text-sm text-muted">
            {frasesDoEixo(caixa.tarefas.estado, 'quadro')}
          </p>
        ) : caixa.tarefas.itens.length === 0 ? (
          <p className="rounded-xl border border-border px-4 py-6 text-sm text-muted">
            Nenhuma tarefa sua parada: nada com prazo vencido, nada sem movimento há mais de{' '}
            {caixa.tarefas.diasSemMovimento} dias e nada travado com um agente há mais de{' '}
            {caixa.tarefas.horasPresa}h.
          </p>
        ) : (
          <ol className="overflow-hidden rounded-xl border border-border">
            {caixa.tarefas.itens.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-3 last:border-b-0 hover:bg-surface-2"
              >
                <span className="text-sm font-medium">{t.titulo}</span>
                <span className="text-[11px] text-muted">{t.status}</span>
                {t.lista && <span className="text-[11px] text-muted">{t.lista}</span>}
                {t.motivos.map((m) => (
                  <span key={m} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-warn">
                    {FRASE_DO_MOTIVO[m]}
                  </span>
                ))}
                {/*
                 * O NOME DO AGENTE RESOLVE DENTRO DA EMPRESA. Slug preenchido e
                 * nome nulo = ponteiro que não é desta casa: a tela diz "outro
                 * agente" em vez de publicar o nome do vizinho.
                 */}
                {t.agenteDesde && (
                  <span className="text-[11px] text-muted">
                    com {t.agenteNome ?? 'outro agente'} desde{' '}
                    {desdeQuando(t.agenteDesde, agora)}
                  </span>
                )}
                <Link href="/trabalho" className="ml-auto text-xs text-brand hover:underline">
                  abrir no quadro →
                </Link>
              </li>
            ))}
          </ol>
        )}

        {caixa.tarefas.estado === 'ok' && caixa.tarefas.identidades.length > 0 && (
          <p className="text-xs text-muted">
            O responsável de uma tarefa é texto livre (veio da fotografia do ClickUp), então a caixa
            te procura por nome:{' '}
            <span className="text-text">{caixa.tarefas.identidades.join(', ')}</span>. Se o seu nome
            no quadro é outro, as suas tarefas não aparecem aqui — e é melhor você saber disso do
            que confiar numa caixa vazia.
          </p>
        )}
        {caixa.tarefas.truncado && (
          <p className="text-xs text-muted">
            Mostrando as {caixa.tarefas.teto} mais atrasadas — há mais.
          </p>
        )}
      </section>

      {/* ====================================================== CONVERSA ====== */}
      <section className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
          Conversa recente nas suas tarefas
        </h2>
        {/*
         * A FRASE QUE A FATIA PEDIU E O PRODUTO NÃO TEM. "Menção" não existe
         * como dado: `WorkComment` guarda autor e texto, e nada mais — sem
         * tabela de menção, sem convenção de @nome e sem estado de lido.
         * Escrever isto na tela é o que impede a pessoa de confiar que citá-la
         * num comentário a avisa.
         */}
        <p className="text-xs text-muted">
          Não é menção: este produto não registra menção em comentário. O que está aqui é
          comentário de <span className="text-text">outra pessoa</span> em tarefa em que você é o
          responsável, nos últimos {caixa.conversa.dias} dias. Por isso ele{' '}
          <span className="text-text">não entra no contador</span> — sem estado de lido, um
          comentário nunca sairia da conta.
        </p>

        {frasesDoEixo(caixa.conversa.estado, 'quadro') ? (
          <p className="rounded-xl border border-border px-4 py-4 text-sm text-muted">
            {frasesDoEixo(caixa.conversa.estado, 'quadro')}
          </p>
        ) : caixa.conversa.itens.length === 0 ? (
          <p className="rounded-xl border border-border px-4 py-6 text-sm text-muted">
            Ninguém comentou nas suas tarefas nos últimos {caixa.conversa.dias} dias.
          </p>
        ) : (
          <ol className="overflow-hidden rounded-xl border border-border">
            {caixa.conversa.itens.map((c) => (
              <li
                key={c.id}
                className="space-y-1 border-b border-border px-4 py-3 last:border-b-0 hover:bg-surface-2"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-sm font-medium">{c.autor}</span>
                  <span className="text-xs text-muted">em {c.tarefaTitulo}</span>
                  <span className="text-xs text-muted">{desdeQuando(c.criadaEm, agora)}</span>
                  <Link href="/trabalho" className="ml-auto text-xs text-brand hover:underline">
                    abrir no quadro →
                  </Link>
                </div>
                <p className="text-sm text-muted">
                  {c.trecho}
                  {c.trechoCortado && (
                    <span className="text-xs text-dim"> (trecho — o resto está no quadro)</span>
                  )}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
