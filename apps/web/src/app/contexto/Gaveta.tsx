'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, X } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { NotaAberta } from './NotaAberta';
import { useAuth } from '@/lib/auth';
import { rotuloDaArea, type EixoDoMapa, type ItemDoEixo, type Tom } from './grafo';
import {
  emHoras,
  quando,
  rotuloDaNatureza,
  type AgenteDoMapa,
  type DetalheDeAgente,
} from './tipos';

/*
 * ============================================================================
 * A GAVETA — clicar num ponto abre O REGISTRO, não um resumo dele
 * ============================================================================
 *
 * É a metade do critério de pronto da fatia 4.4 que mais fácil se fingiria: um
 * balão com o nome do nó "parece" que abriu o registro.
 *
 * DUAS FAMÍLIAS BUSCAM O REGISTRO, TRÊS ABREM A LINHA DA LISTAGEM — e isso está
 * escrito porque já esteve mal escrito. A nota busca `GET /memoria/:id` e
 * `GET /memoria/:id/versoes`, que é como o histórico versionado (RF-M-01) e a
 * procedência (RF-M-02) chegam à tela. O agente busca `GET /agents/:slug`, que
 * é onde mora o PROCEDIMENTO — o campo que a listagem não traz e que responde
 * "o que este agente faz aqui".
 *
 * Rotina, conexão e gente abrem o que a listagem devolveu, campo a campo, e não
 * há rota de registro individual para nenhuma das três: `/rotinas`,
 * `/integrations/catalog` e `/organograma` respondem em lista. Prometer
 * "registro" para as três seria promessa que a API não tem como cumprir; o que
 * a gaveta faz por elas é mostrar TODOS os campos da linha e o caminho para a
 * tela que manda no assunto.
 *
 * O CORPO DA NOTA É TEXTO, E ISSO É DECISÃO DE SEGURANÇA. Nota é conteúdo do
 * cliente — e, pela procedência `conector`, pode ser conteúdo que entrou de
 * fora. Renderizar markdown aqui significaria montar HTML a partir desse texto,
 * e a primeira travessura de quem escreve uma nota seria a última. `pre` com
 * quebra de linha preserva a leitura sem abrir superfície nenhuma.
 */

const TOM_CLS: Record<Tom, string> = {
  brand: 'text-brand',
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-info',
  muted: 'text-dim',
};

export type AlvoDaGaveta =
  | { tipo: 'registro'; item: ItemDoEixo }
  | { tipo: 'eixo'; eixo: EixoDoMapa; itens: ItemDoEixo[] };

export function Gaveta({
  alvo,
  onFechar,
  onAbrirItem,
  onFonteIndisponivel,
}: {
  alvo: AlvoDaGaveta;
  onFechar: () => void;
  onAbrirItem: (item: ItemDoEixo, origem?: Element) => void;
  onFonteIndisponivel?: () => void;
}) {
  const botaoFechar = useRef<HTMLButtonElement>(null);
  const chaveAlvo = alvo.tipo === 'registro' ? alvo.item.id : `eixo:${alvo.eixo.key}`;
  useEffect(() => { botaoFechar.current?.focus(); }, [chaveAlvo]);
  return (
    <aside
      aria-label="Registro selecionado"
      onKeyDown={(evento) => { if (evento.key === 'Escape') { evento.stopPropagation(); onFechar(); } }}
      className="flex max-h-[clamp(420px,62vh,760px)] flex-col overflow-hidden rounded-root border border-border bg-surface"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.16em] text-dim">
            {alvo.tipo === 'eixo' ? alvo.eixo.rotulo : rotuloDoEixo(alvo.item)}
          </div>
          <h2 className="truncate text-sm font-semibold text-text">
            {alvo.tipo === 'eixo' ? alvo.eixo.descricao : alvo.item.rotulo}
          </h2>
        </div>
        <button
          ref={botaoFechar}
          type="button"
          onClick={onFechar}
          aria-label="Fechar o registro"
          className="min-h-11 min-w-11 cursor-pointer rounded-root border border-border p-2 text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <X size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {alvo.tipo === 'eixo' ? (
          <ListaDoEixo eixo={alvo.eixo} itens={alvo.itens} onAbrirItem={onAbrirItem} />
        ) : (
          <>
            <div className="mb-3 rounded-root border border-border bg-surface-2 p-2 text-xs text-muted">
              <span className="block font-medium text-text">{alvo.item.areas.length
                ? alvo.item.areas.map(rotuloDaArea).join(', ')
                : 'Sem área definida'}</span>
              <span className="block">{alvo.item.origemDaArea ?? 'Nenhuma área declarada neste registro.'}</span>
            </div>
            <Registro item={alvo.item} onFonteIndisponivel={onFonteIndisponivel} />
          </>
        )}
      </div>
    </aside>
  );
}

function rotuloDoEixo(item: ItemDoEixo): string {
  const r = item.registro;
  if (r.familia === 'memoria') return `Memória · ${rotuloDaNatureza(r.nota.kind)}`;
  if (r.familia === 'agentes') return 'Agente';
  if (r.familia === 'rotinas') return 'Rotina';
  if (r.familia === 'conexoes') return 'Conexão';
  return 'Gente';
}

function ListaDoEixo({
  eixo,
  itens,
  onAbrirItem,
}: {
  eixo: EixoDoMapa;
  itens: ItemDoEixo[];
  onAbrirItem: (item: ItemDoEixo, origem?: Element) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        {eixo.total === null
          ? 'esta fonte não respondeu'
          : `${eixo.total} registro(s) · ${eixo.mostrados} desenhado(s) no mapa`}
      </p>
      {eixo.rota && (
        <Link href={eixo.rota} className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
          abrir {eixo.rota} <ArrowUpRight size={12} />
        </Link>
      )}
      <div className="divide-y divide-border">
        {itens.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={(evento) => onAbrirItem(i, evento.currentTarget)}
            className="flex min-h-11 w-full cursor-pointer items-start gap-2 py-2 text-left hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            <span
              aria-hidden
              className={`mt-1.5 h-[7px] w-[7px] flex-none rounded-full bg-current ${TOM_CLS[i.tom]}`}
            />
            <span className="min-w-0">
              <span className="block truncate text-sm text-text">{i.rotulo}</span>
              <span className="block truncate text-[11px] text-muted">{i.sub}</span>
            </span>
          </button>
        ))}
        {itens.length === 0 && <p className="py-4 text-sm text-muted">Nada aqui ainda.</p>}
      </div>
    </div>
  );
}

function Registro({ item, onFonteIndisponivel }: { item: ItemDoEixo; onFonteIndisponivel?: () => void }) {
  const r = item.registro;
  if (r.familia === 'memoria') return <NotaAberta notaId={r.nota.id} onIndisponivel={onFonteIndisponivel} />;
  if (r.familia === 'agentes') return <AgenteAberto agente={r.agente} />;

  if (r.familia === 'rotinas') {
    const t = r.rotina;
    return (
      <Campos
        rota="/rotinas"
        rotaRotulo="ver em Rotinas"
        linhas={[
          ['estado', t.dispara ? `${t.estado} · dispara` : `${t.estado} · não dispara`],
          ['agenda', `${t.cron} (${t.tz})`],
          ['próxima', quando(t.proximaExecucaoEm)],
          ['última', `${quando(t.ultimaExecucaoEm)}${t.ultimoStatus ? ` · ${t.ultimoStatus}` : ''}`],
          ['passagens', `${t.execucoes} · ${t.falhas} falha(s)`],
          ['agente', t.agenteSlug ?? 'sem agente'],
          ['origem', t.origem],
          /*
           * ACUMULADO, COM ESSE NOME, E SÓ AS PASSAGENS BOAS — ver o comentário
           * de `minutosPorExecucao` em `tipos.ts`. O rótulo diz o período
           * porque "tempo devolvido" sem período, ao lado de um cartão que diz
           * "por semana" em `/rotinas`, é o mesmo defeito que a fatia A3
           * consertou na tela de Agentes.
           */
          [
            'horas acumuladas',
            t.minutosPorExecucao === null
              ? 'sem linha de base informada'
              : `${emHoras(t.minutosPorExecucao * Math.max(t.execucoes - t.falhas, 0))} · só as passagens boas`,
          ],
        ]}
      />
    );
  }

  if (r.familia === 'conexoes') {
    const c = r.conexao;
    return (
      <Campos
        rota="/conexoes"
        rotaRotulo="ver em Conexões"
        /*
         * A MENSAGEM É A DO CONECTOR, em vermelho e sem tradução. A tela de
         * Conexões recusa manter tabela de "erro conhecido → texto bonito", e o
         * mapa não pode inventar uma por conta própria.
         */
        alerta={c.saude?.estado === 'erro' ? c.saude?.mensagem ?? 'erro sem mensagem' : null}
        /*
         * O MAPA NÃO MEDE SAÚDE (`?sondar=0` — ver `page.tsx`), e quando é esse
         * o caso a própria API manda a frase que explica. Ela entra em cinza, e
         * não em vermelho: não medir não é erro, e pintar de vermelho faria esta
         * gaveta acusar de quebrado um conector que ninguém tentou usar.
         */
        nota={c.saude?.apuracao === 'nao_verificado' ? c.saude.mensagem : null}
        linhas={[
          [
            'saúde',
            c.saude
              ? `${c.saude.estado.replace(/_/g, ' ')} · apurada por ${c.saude.apuracao.replace(/_/g, ' ')}`
              : 'não medida nesta volta',
          ],
          ['medida em', quando(c.saude?.verificadoEm ?? null)],
          ['registro', c.status],
          ['categoria', c.category],
          ['autenticação', c.authType],
          ['exige', c.requires],
          ['conectada em', quando(c.connectedAt)],
          ['última sincronização', quando(c.lastSyncAt)],
          ...(c.desligado ? ([['desligada', c.motivoDesligado ?? 'sem motivo registrado']] as [string, string][]) : []),
        ]}
      />
    );
  }

  const p = r.pessoa;
  return (
    <Campos
      rota="/organograma"
      rotaRotulo="ver no Organograma"
      linhas={[
        ['estado', p.ativo === null ? 'não vem desta fonte' : p.ativo ? 'ativa' : 'inativa'],
        [
          'papéis',
          p.papeis === null ? 'não vem desta fonte' : p.papeis.length ? p.papeis.join(', ') : 'sem papel declarado',
        ],
        ['pilares', p.pilares.length ? p.pilares.join(', ') : 'ainda sem pilar'],
        ['agentes', p.agentes.length ? p.agentes.join(', ') : 'não é dona de nenhum agente'],
      ]}
    />
  );
}

/**
 * O AGENTE, COM O PROCEDIMENTO — buscado na hora em `GET /agents/:slug`.
 *
 * A listagem responde estado, dono e contagem; ela NÃO traz o procedimento, que
 * é o que alguém quer ler ao clicar num agente no mapa: o propósito, o gatilho,
 * os passos e a definição de pronto. Sem esta chamada a gaveta abria a mesma
 * linha que já estava desenhada, com outro enquadramento — e o cabeçalho deste
 * arquivo prometia "o registro".
 *
 * A LINHA DA LISTAGEM APARECE DE IMEDIATO e a busca só acrescenta. Falha de
 * rede aqui não apaga o que já se sabe: vira uma linha de aviso embaixo.
 */
function AgenteAberto({ agente }: { agente: AgenteDoMapa }) {
  const { token } = useAuth();
  const [detalhe, setDetalhe] = useState<DetalheDeAgente | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setDetalhe(null);
    setErro(null);
    if (!token) return;
    let vivo = true;
    apiGet<DetalheDeAgente>(`/agents/${encodeURIComponent(agente.slug)}`, token)
      .then((d) => vivo && setDetalhe(d))
      .catch((e: Error) => vivo && setErro(e.message));
    return () => {
      vivo = false;
    };
  }, [agente.slug, token]);

  const rebaixado = agente.rebaixadoAte && new Date(agente.rebaixadoAte).getTime() > Date.now();
  const sop = detalhe?.sop ?? null;

  /* Enquanto o detalhe não chega, quem responde é a linha da listagem. */
  const escrito = detalhe ? detalhe.sop !== null : agente.temProcedimento;
  const faltando = detalhe?.formato.faltando ?? agente.faltando;
  const resumoDoProcedimento = !escrito
    ? 'não escrito'
    : faltando.length
      ? `incompleto — falta ${faltando.join(', ')}`
      : 'completo';

  return (
    <Campos
      rota="/agentes"
      rotaRotulo="ver em Agentes"
      texto={agente.missao}
      alerta={erro}
      linhas={[
        [
          'estado',
          rebaixado
            ? `${agente.estado} · autonomia rebaixada até ${quando(agente.rebaixadoAte)}`
            : agente.estado,
        ],
        ['tipo', agente.tipo],
        ['pilar', agente.pilar ?? 'sem pilar'],
        ['dono', agente.dono?.nome ?? 'sem dono'],
        ['autonomia', agente.autonomiaAte],
        [
          'capacidades',
          agente.capacidades.length ? agente.capacidades.join(', ') : 'nenhuma declarada',
        ],
        ['agenda', agente.cron ?? 'sem agenda'],
        ['execuções', `${agente.execucoes} · ${agente.falhas} falha(s)`],
        [
          'última passagem',
          `${quando(agente.ultimaExecucaoEm)}${agente.ultimoStatus ? ` · ${agente.ultimoStatus}` : ''}`,
        ],
        /*
         * O PERÍODO ENTRA NO RÓTULO (fatia A3). Este campo dizia "horas
         * devolvidas" e mostrava o acumulado de vida inteira com as falhas
         * dentro — o mesmo número que a tela de Agentes publicava como
         * semanal. Agora são duas linhas, cada uma com o período dela, e
         * "não medido" tem texto próprio em vez de virar zero.
         */
        [
          `horas devolvidas · ${agente.horas.diasDaJanela} dias`,
          agente.horas.naSemana === null
            ? agente.horas.estado === 'sem-linha-de-base'
              ? 'sem linha de base informada'
              : 'não deu para contar as passagens'
            : `${agente.horas.naSemana}h · ${agente.horas.passagensNaSemana} passagem(ns)`,
        ],
        [
          'horas acumuladas',
          agente.horasAcumuladas === null
            ? 'sem linha de base informada'
            : `${agente.horasAcumuladas}h · vida inteira`,
        ],
        ['procedimento', resumoDoProcedimento],
      ]}
    >
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-dim">procedimento</div>
        {detalhe === null && !erro ? (
          <p className="text-xs text-muted">abrindo o procedimento…</p>
        ) : sop === null ? (
          <p className="text-xs text-muted">
            não escrito. É o que diz para que este agente existe, quando ele dispara, o que ele faz e
            quando está pronto.
          </p>
        ) : (
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
            <Linha rotulo="propósito" valor={sop.proposito} />
            <Linha rotulo="gatilho" valor={sop.gatilho} />
            <Linha rotulo="passos" valor={sop.passos.map((p, i) => `${i + 1}. ${p}`).join(' · ')} />
            <Linha rotulo="pronto quando" valor={sop.definicaoDePronto} />
            {detalhe?.escalacao && <Linha rotulo="escalação" valor={detalhe.escalacao} />}
            {sop.observacoes && <Linha rotulo="observações" valor={sop.observacoes} />}
            <Linha rotulo="versão" valor={`v${sop.versao} · ${quando(sop.atualizadoEm)}`} />
          </dl>
        )}
      </div>
    </Campos>
  );
}

/**
 * A NOTA, COMPLETA — buscada na hora, e não a linha que veio na listagem.
 *
 * A listagem já traz o corpo, mas o histórico não: quem clica num ponto quer ver
 * POR QUE aquela regra está ali, e isso mora nas versões. Buscar as duas coisas
 * também é o que garante que a gaveta mostre o estado de agora, e não o de
 * quando a tela carregou.
 */
function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <>
      <dt className="whitespace-nowrap text-dim">{rotulo}</dt>
      <dd className="break-words text-muted">{valor}</dd>
    </>
  );
}

function Campos({
  linhas,
  texto,
  alerta,
  nota,
  rota,
  rotaRotulo,
  children,
}: {
  linhas: [string, string][];
  texto?: string;
  /** O que está errado. Vermelho. */
  alerta?: string | null;
  /** O que apenas não se sabe. Cinza — a diferença importa. */
  nota?: string | null;
  rota: string;
  rotaRotulo: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      {texto && <p className="text-[13px] leading-relaxed text-muted">{texto}</p>}
      {alerta && <p className="rounded-root bg-bad/10 px-2 py-1.5 text-xs text-bad">{alerta}</p>}
      {nota && <p className="rounded-root bg-surface-2 px-2 py-1.5 text-xs text-muted">{nota}</p>}
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
        {linhas.map(([rotulo, valor]) => (
          <Linha key={rotulo} rotulo={rotulo} valor={valor} />
        ))}
      </dl>
      {children}
      <Link href={rota} className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
        {rotaRotulo} <ArrowUpRight size={12} />
      </Link>
    </div>
  );
}
