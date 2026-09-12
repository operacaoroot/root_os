'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { CapacidadeDaRegua, FatiaDoAgente, PainelDaRegua } from './tipos';
import { Cartao, Etiqueta, Selo, Vazio, inputCls } from './ui';

/*
 * O CATÁLOGO, E QUEM DECLAROU CADA CAPACIDADE.
 *
 * A coluna "agentes" é a relação que a porta já impõe e ninguém enxergava: o
 * Tool Gateway recusa `fora_da_declaracao` ANTES de olhar nível nenhum
 * (RF-N-03), então uma capacidade que nenhum agente declarou existe na régua e
 * não é alcançável por ninguém. A tela mostra a relação como ela é.
 *
 * Três alertas que só aparecem porque o servidor os calcula:
 *  - `sem agente`: existe no catálogo e ninguém a declarou;
 *  - `sem ferramenta`: nem com declaração seria alcançável — o adaptador de
 *    ferramentas filtra pelo nome que o modelo enxerga, e sem ele a capacidade
 *    é decorativa;
 *  - `acima da autonomia`: o agente declarou a capacidade, mas o teto declarado
 *    dele é mais baixo que o nível dela. Quem impõe é a porta; aqui é leitura.
 *
 * O CATÁLOGO QUE CHEGA JÁ VEM PODADO pelos módulos que esta empresa contratou
 * (RF-T-06). O painel entregava a lista inteira do produto a qualquer empresa
 * autenticada — id, descrição, rota e nome de ferramenta de financeiro, pauta,
 * leads, instagram, metas e pixels inclusive. Quem poda é o servidor; aqui a
 * única marca disso é a contagem de declaradas que o agente não alcança.
 *
 * E NADA NESTE ARQUIVO DECIDE NÍVEL. O rótulo de uma capacidade declarada e
 * ausente do catálogo mostra `nivelEfetivo`, que o servidor calculou com
 * `avaliar(null)`. Aqui havia um `?? 'R5'` — uma segunda régua de uma linha só,
 * que continuaria dizendo R5 no dia em que a política mudasse esse degrau.
 */
export function AbaCapacidades({ painel }: { painel: PainelDaRegua }) {
  const [busca, setBusca] = useState('');
  const [visao, setVisao] = useState<'capacidade' | 'agente'>('capacidade');
  const sobrescritos = useMemo(
    () => new Set(painel.sobrescritas.idsSobrescritos),
    [painel.sobrescritas.idsSobrescritos],
  );

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const ordenada = [...painel.capacidades].sort(
      (a, b) => a.nivel.localeCompare(b.nivel) || a.id.localeCompare(b.id),
    );
    if (!q) return ordenada;
    return ordenada.filter(
      (c) =>
        c.id.toLowerCase().includes(q) ||
        c.descricao.toLowerCase().includes(q) ||
        (c.ferramenta ?? '').toLowerCase().includes(q) ||
        c.agentes.some((a) => a.nome.toLowerCase().includes(q) || a.slug.includes(q)),
    );
  }, [painel.capacidades, busca]);

  const semAgente = painel.capacidades.filter((c) => c.agentes.length === 0).length;

  return (
    <div className="space-y-5">
      <Cartao
        titulo={`${painel.capacidades.length} capacidades classificadas`}
        aviso={
          semAgente > 0
            ? `${semAgente} delas não foram declaradas por agente nenhum — existem na régua e ninguém as alcança.`
            : 'Toda capacidade do catálogo tem pelo menos um agente que a declarou.'
        }
      >
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por id, descrição, ferramenta ou agente"
          aria-label="Buscar capacidade"
          className={`w-full ${inputCls}`}
        />
        {painel.capacidadesOcultasPorModulo > 0 && (
          <p className="mt-2 text-xs text-muted">
            {painel.capacidadesOcultasPorModulo} capacidade(s) do produto não aparecem aqui
            porque pertencem a módulos que esta empresa não contratou.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Visao ativo={visao === 'capacidade'} onClick={() => setVisao('capacidade')}>
            Por capacidade
          </Visao>
          <Visao ativo={visao === 'agente'} onClick={() => setVisao('agente')}>
            Por agente
          </Visao>
        </div>
      </Cartao>

      {visao === 'agente' ? (
        painel.agentes.length === 0 ? (
          <Vazio>Nenhum agente cadastrado nesta empresa.</Vazio>
        ) : (
          <div className="space-y-3">
            {painel.agentes.map((a) => (
              <Agente key={a.slug} a={a} />
            ))}
          </div>
        )
      ) : lista.length === 0 ? (
        <Vazio>Nenhuma capacidade bate com essa busca.</Vazio>
      ) : (
        <div className="space-y-3">
          {lista.map((c) => (
            <Capacidade key={c.id} c={c} sobrescrita={sobrescritos.has(c.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Visao({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={ativo}
      className={`rounded-lg border px-3 py-1 text-[12px] ${
        ativo ? 'border-brand-dim bg-brand/15 text-brand' : 'border-border text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}

/** A fatia do catálogo que este agente declarou poder usar (RF-N-03). */
function Agente({ a }: { a: FatiaDoAgente }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{a.nome}</h3>
        <Etiqueta>{a.slug}</Etiqueta>
        <Etiqueta>{a.estado}</Etiqueta>
        {!a.ativo && <Etiqueta>inativo</Etiqueta>}
        <span className="text-xs text-muted">
          teto declarado <Selo nivel={a.autonomiaAte} />
        </span>
      </header>

      <p className="mt-2 text-xs text-muted">
        {a.capacidades.length === 0
          ? 'não declarou capacidade nenhuma — a porta recusa qualquer chamada dele'
          : `${a.capacidades.length} capacidade(s) declaradas. Fora desta lista, a porta recusa antes de olhar nível.`}
      </p>

      {a.semClassificacao.length > 0 && (
        <p className="mt-2 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">
          {a.semClassificacao.length} id(s) declarados não existem no catálogo (
          {a.semClassificacao.join(', ')}): eles passam pela declaração e caem bloqueados no
          degrau que a régua reserva à capacidade sem classificação.
        </p>
      )}

      {a.ocultasPorModulo > 0 && (
        <p className="mt-2 text-xs text-muted">
          + {a.ocultasPorModulo} declarada(s) de módulo que esta empresa não contratou: o agente
          não as alcança e elas não aparecem aqui.
        </p>
      )}

      {a.capacidades.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1">
          {a.capacidades.map((c) => (
            <li key={c.id}>
              {/* O nível e a explicação vêm prontos do servidor: aqui só a cor. */}
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] ${
                  c.nivel === null
                    ? 'bg-bad/15 text-bad'
                    : c.acimaDaAutonomia
                      ? 'bg-warn/15 text-warn'
                      : 'bg-surface-2 text-muted'
                }`}
                title={c.porque}
              >
                {c.id}
                <span className="opacity-60">· {c.nivelEfetivo}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Capacidade({ c, sobrescrita }: { c: CapacidadeDaRegua; sobrescrita: boolean }) {
  const divergente = c.nivel !== c.nivelCalculado;
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <header className="flex flex-wrap items-center gap-2">
        <Selo nivel={c.nivel} />
        <h3 className="font-mono text-[13px] font-medium">{c.id}</h3>
        {sobrescrita && (
          <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] text-brand">
            sobrescrita desta empresa
          </span>
        )}
        {divergente && (
          <span className="inline-flex items-center gap-1 rounded bg-bad/15 px-1.5 py-0.5 text-[10px] text-bad">
            <AlertTriangle size={10} aria-hidden /> declarada {c.nivel}, o efeito calcula{' '}
            {c.nivelCalculado}
          </span>
        )}
      </header>

      <p className="mt-2 text-sm text-muted">{c.descricao}</p>

      <div className="mt-3 flex flex-wrap gap-1">
        {c.ferramenta ? (
          <Etiqueta>ferramenta: {c.ferramenta}</Etiqueta>
        ) : (
          <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn">
            sem ferramenta — nenhum modelo a enxerga
          </span>
        )}
        {c.rota && <Etiqueta>{c.rota}</Etiqueta>}
        {c.desfazer && <Etiqueta>desfaz por {c.desfazer}</Etiqueta>}
        {!c.validaArgumentos && (
          <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn">
            sem esquema de argumentos
          </span>
        )}
      </div>

      <div className="mt-3">
        <div className="text-xs uppercase text-muted">Agentes que a declararam</div>
        {c.agentes.length === 0 ? (
          <p className="mt-1 text-xs text-bad">
            nenhum — a porta recusaria qualquer chamada a ela como &quot;fora da declaração&quot;
          </p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1">
            {c.agentes.map((a) => (
              <li key={a.slug}>
                <span
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${
                    a.acimaDaAutonomia ? 'bg-warn/15 text-warn' : 'bg-surface-2 text-muted'
                  }`}
                  title={
                    a.acimaDaAutonomia
                      ? `teto declarado ${a.autonomiaAte}, abaixo do nível ${c.nivel} desta capacidade`
                      : `teto declarado ${a.autonomiaAte}`
                  }
                >
                  {a.nome}
                  <span className="opacity-60">· {a.autonomiaAte}</span>
                  {!a.ativo && <span className="opacity-60">· inativo</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
