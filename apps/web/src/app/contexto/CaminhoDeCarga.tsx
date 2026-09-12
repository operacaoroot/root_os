'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, RefreshCw } from 'lucide-react';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { EixoDoMapa, FamiliaKey, Mapa } from './grafo';
import { NATUREZAS, type NaturezaDaNota } from './tipos';

/*
 * ============================================================================
 * O CAMINHO DE CARGA — o que a tela mostra quando não há o que desenhar
 * ============================================================================
 *
 * A regra da fatia é curta: empresa vazia NÃO mostra tela vazia. Um mapa em
 * branco com "nenhum dado encontrado" é a pior primeira impressão possível de um
 * produto cujo argumento de venda é justamente carregar o contexto do negócio.
 *
 * TRÊS COISAS IMPORTAM AQUI:
 *
 *  1. CADA PASSO DIZ O ESTADO REAL DELE. O número ao lado de cada passo vem da
 *     mesma resposta que alimentaria o mapa; passo cumprido aparece cumprido.
 *     Nada é ilustração.
 *  2. CADA PASSO TEM AÇÃO DE VERDADE. Reindexar chama a rota que reindexa; a
 *     primeira nota é gravada por `POST /memoria`, com procedência obrigatória,
 *     como qualquer outra. Ninguém sai daqui com dado de mentira no banco.
 *  3. QUEM NÃO PODE ESCREVER VÊ O CAMINHO MESMO ASSIM, sem botão que recusa. A
 *     permissão de escrita é `obsidian.editar` — a mesma que governa a base de
 *     conhecimento desde antes da memória existir.
 *
 * ELE TAMBÉM APARECE COM A EMPRESA CHEIA, em versão curta, quando a MEMÓRIA está
 * vazia e o resto não: ter agente e conexão sem contexto nenhum carregado é
 * exatamente o estado em que o produto responde sem fonte.
 *
 * E APARECE AINDA NUM TERCEIRO CASO, com outra manchete: quando algum eixo não
 * pôde ser lido (erro ou permissão) e o resto veio vazio. Aí a tela NÃO afirma
 * que não há o que desenhar — ela diz o que não conseguiu ver, e nomeia cada
 * eixo. O caminho continua útil (o que dá para carregar, dá), mas a frase de
 * cima passa a ser "não deu para ver", que é a verdade.
 */

/** A chave estável de uma nota escrita na tela. Espelha `chaveDaVault` do outro lado. */
function chaveDoTitulo(titulo: string): string {
  const base = titulo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `operador:${base || 'nota'}`;
}

function totalDe(mapa: Mapa, familia: FamiliaKey): number | null {
  return mapa.eixos.find((e) => e.key === familia)?.total ?? null;
}

export function CaminhoDeCarga({
  mapa,
  compacto = false,
  incertos = [],
  onCarregou,
}: {
  mapa: Mapa;
  /** Versão curta, para quando só a memória está vazia. */
  compacto?: boolean;
  /** Eixos que ninguém conseguiu ler. Não vazio = a tela não afirma vazio. */
  incertos?: EixoDoMapa[];
  onCarregou: () => void;
}) {
  const { token, can } = useAuth();
  const podeEscrever = can('obsidian.editar');

  const [ocupado, setOcupado] = useState<'reindex' | 'nota' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [abrindoFormulario, setAbrindoFormulario] = useState(false);

  const notas = totalDe(mapa, 'memoria');
  const conexoes = totalDe(mapa, 'conexoes');
  const agentes = totalDe(mapa, 'agentes');

  const reindexar = () => {
    if (!token) return;
    setOcupado('reindex');
    setErro(null);
    setRecado(null);
    apiPost<{ ok: boolean; notes: number }>('/knowledge/reindex', {}, token)
      .then((r) => {
        setRecado(
          `${r.notes} nota(s) lida(s) da vault. O que mudou virou versão nova na memória; o que já estava igual não foi reescrito.`,
        );
        onCarregou();
      })
      .catch((e) => setErro(e.message))
      .finally(() => setOcupado(null));
  };

  return (
    <div className="rounded-root border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-text">
        {incertos.length > 0
          ? 'Não deu para ver o contexto inteiro desta empresa'
          : compacto
            ? 'A memória desta empresa ainda está vazia'
            : 'Este mapa ainda não tem o que desenhar'}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        {incertos.length > 0 ? (
          <>
            O que deu para consultar veio sem registro, mas {incertos.length} eixo(s) não
            responderam — então esta empresa pode ter contexto carregado que esta tela não está
            vendo. O caminho de carga continua valendo para o que falta.
          </>
        ) : (
          <>
            O mapa desenha o contexto que a empresa carregou — regras da casa, decisões, dicionário —
            e o que existe em volta dele. Nada aqui é exemplo: enquanto não houver registro, não há
            ponto. O caminho de carga é este.
          </>
        )}
      </p>

      {incertos.length > 0 && (
        <ul className="mt-3 space-y-1">
          {incertos.map((e) => (
            <li key={e.key} className="text-xs text-warn">
              {e.rotulo}:{' '}
              {e.estado === 'sem_permissao'
                ? 'seu papel não dá acesso a este eixo — não é zero, é não sei'
                : `não respondeu — ${e.erro ?? 'sem mensagem'}`}
            </li>
          ))}
        </ul>
      )}

      {erro && <p className="mt-3 text-sm text-bad">{erro}</p>}
      {recado && <p className="mt-3 text-sm text-good">{recado}</p>}

      <ol className="mt-4 space-y-3">
        <Passo
          numero={1}
          titulo="Ligue uma fonte"
          feito={(conexoes ?? 0) > 0}
          estado={
            conexoes === null
              ? 'não deu para consultar as conexões'
              : `${conexoes} conexão(ões) em uso nesta empresa`
          }
          explica="Drive, Gmail, Agenda, gestor de tarefas, vault do Obsidian. A conexão é autorizada na conta do próprio cliente — a ROOT não guarda credencial de terceiro."
        >
          <Link href="/conexoes" className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
            abrir Conexões <ArrowUpRight size={12} />
          </Link>
        </Passo>

        <Passo
          numero={2}
          titulo="Traga o que já está escrito"
          feito={(notas ?? 0) > 0}
          estado={notas === null ? 'não deu para consultar a memória' : `${notas} nota(s) na memória`}
          explica="A releitura da vault indexa o que está lá e projeta na memória versionada: o que mudou vira versão nova, o que sumiu é arquivado e nada é perdido."
        >
          {podeEscrever ? (
            <button
              type="button"
              onClick={reindexar}
              disabled={ocupado !== null}
              className="inline-flex items-center gap-2 rounded-root border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text disabled:opacity-60"
            >
              <RefreshCw size={12} className={ocupado === 'reindex' ? 'animate-spin' : ''} />
              reler a vault agora
            </button>
          ) : (
            <span className="text-xs text-dim">exige a permissão de editar a base.</span>
          )}
        </Passo>

        <Passo
          numero={3}
          titulo="Escreva a primeira regra da casa"
          feito={(notas ?? 0) > 0}
          estado="toda nota exige procedência — de onde veio, quem disse"
          explica="É o que o agente cita quando responde. Sem isso, a resposta não tem fonte — e resposta sem fonte é defeito, não estilo."
        >
          {podeEscrever ? (
            abrindoFormulario ? (
              <PrimeiraNota
                ocupado={ocupado === 'nota'}
                onEnviar={(dados) => {
                  if (!token) return;
                  setOcupado('nota');
                  setErro(null);
                  setRecado(null);
                  apiPost('/memoria', dados, token)
                    .then(() => {
                      setRecado('Nota gravada. Ela já está no mapa, com a versão 1 no histórico.');
                      setAbrindoFormulario(false);
                      onCarregou();
                    })
                    .catch((e) => setErro(e.message))
                    .finally(() => setOcupado(null));
                }}
                onCancelar={() => setAbrindoFormulario(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAbrindoFormulario(true)}
                className="rounded-root bg-brand px-3 py-1.5 text-xs font-medium text-ink hover:opacity-90"
              >
                escrever a primeira nota
              </button>
            )
          ) : (
            <span className="text-xs text-dim">exige a permissão de editar a base.</span>
          )}
        </Passo>

        {!compacto && (
          <Passo
            numero={4}
            titulo="Ponha quem trabalha no mapa"
            feito={(agentes ?? 0) > 0}
            estado={
              agentes === null ? 'não deu para consultar os agentes' : `${agentes} agente(s) declarado(s)`
            }
            explica="Cada agente tem nome, função, dono humano e procedimento escrito. É o que liga a memória a quem usa a memória."
          >
            <div className="flex gap-3">
              <Link href="/agentes" className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
                abrir Agentes <ArrowUpRight size={12} />
              </Link>
              <Link
                href="/organograma"
                className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
              >
                abrir Organograma <ArrowUpRight size={12} />
              </Link>
            </div>
          </Passo>
        )}
      </ol>
    </div>
  );
}

function Passo({
  numero,
  titulo,
  estado,
  explica,
  feito,
  children,
}: {
  numero: number;
  titulo: string;
  estado: string;
  explica: string;
  feito: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 rounded-root border border-border bg-surface-2/40 p-3">
      <span
        aria-hidden
        className={`flex h-6 w-6 flex-none items-center justify-center rounded-root border text-[11px] font-semibold tabular-nums ${
          feito ? 'border-good/40 bg-good/10 text-good' : 'border-border text-muted'
        }`}
      >
        {feito ? <Check size={12} /> : numero}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-medium text-text">{titulo}</span>
          <span className="text-[11px] text-dim">{estado}</span>
        </div>
        <p className="text-xs leading-relaxed text-muted">{explica}</p>
        <div>{children}</div>
      </div>
    </li>
  );
}

/**
 * O formulário da primeira nota.
 *
 * A PROCEDÊNCIA É OBRIGATÓRIA AQUI, e o passo acima promete isso em voz alta —
 * "toda nota exige procedência". A API aceita `sourceRef` nulo (o `sourceType`
 * já é procedência suficiente para ela), e enquanto este formulário aceitava
 * também, o passo prometia um rigor que a tela não cobrava: a primeira nota da
 * empresa entrava sem dizer de onde veio, que é justamente o que a fatia 4.3
 * chama de defeito quando o agente responde.
 */
function PrimeiraNota({
  ocupado,
  onEnviar,
  onCancelar,
}: {
  ocupado: boolean;
  onEnviar: (dados: Record<string, unknown>) => void;
  onCancelar: () => void;
}) {
  const [titulo, setTitulo] = useState('');
  const [kind, setKind] = useState<NaturezaDaNota>('regra');
  const [corpo, setCorpo] = useState('');
  const [fonte, setFonte] = useState('');

  const pronto = titulo.trim().length > 0 && corpo.trim().length > 0 && fonte.trim().length > 0;

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pronto || ocupado) return;
        onEnviar({
          chave: chaveDoTitulo(titulo),
          kind,
          title: titulo.trim(),
          body: corpo.trim(),
          sourceType: 'operador',
          sourceRef: fonte.trim(),
          motivo: 'primeira carga do contexto pela tela do mapa',
        });
      }}
    >
      <div className="flex flex-wrap gap-2">
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Título (ex.: não falamos de preço no primeiro contato)"
          aria-label="Título da nota"
          className="min-w-[240px] flex-1 rounded-root border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-brand-dim"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as NaturezaDaNota)}
          aria-label="Natureza da nota"
          className="rounded-root border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-brand-dim"
        >
          {NATUREZAS.map((n) => (
            <option key={n.valor} value={n.valor}>
              {n.rotulo}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={corpo}
        onChange={(e) => setCorpo(e.target.value)}
        rows={3}
        placeholder="O que vale nesta empresa, escrito como você diria para uma pessoa nova."
        aria-label="Corpo da nota"
        className="w-full rounded-root border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-brand-dim"
      />
      <input
        value={fonte}
        onChange={(e) => setFonte(e.target.value)}
        required
        placeholder="De onde veio — obrigatório (ex.: reunião de 10/09 com o dono)"
        aria-label="Procedência da nota"
        className="w-full rounded-root border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-brand-dim"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!pronto || ocupado}
          className="rounded-root bg-brand px-3 py-1.5 text-xs font-medium text-ink hover:opacity-90 disabled:opacity-60"
        >
          gravar a nota
        </button>
        <button type="button" onClick={onCancelar} className="text-xs text-muted hover:text-text">
          cancelar
        </button>
      </div>
    </form>
  );
}
