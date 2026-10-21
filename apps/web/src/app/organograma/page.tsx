'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { User as UserIcon } from 'lucide-react';
import {
  ROTULO_DO_ESTADO,
  ROTULO_DO_MOTIVO,
  lerWhatsappBr,
  type EquipeDaEmpresa,
  type FuncaoNaEquipe,
  type MotivoForaDaEquipe,
  type PessoaNaEquipe,
} from '@mktos/shared';
import { apiGet, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { KpiCard } from '@/components/KpiCard';

/*
 * A EQUIPE (rodada dos agentes, 21/10/2026, A7) — `GET /organograma/equipe`
 *
 * No ROOT OS a equipe são três pessoas, e os agentes aparecem ao lado delas:
 * sob cada pessoa, os agentes, rotinas e automações de que ela é dona, por área.
 *
 * QUEM APARECE é regra da API (`packages/shared/src/equipe-pessoas.ts`): contas
 * de máquina, do sistema, de teste, de importação, desativadas, a conta de uso
 * comum e a segunda conta da mesma pessoa ficam FORA DA VISTA, contadas no fim
 * da página, e nada é apagado.
 *
 * O DONO é o efetivo: o que foi trocado aqui (ou no registro do agente) vale
 * por cima do padrão do cadastro. Trocar é de `admin` ou `controle`, e a API
 * relê os papéis no banco; esta tela só esconde o seletor de quem não pode.
 *
 * O WHATSAPP de cada pessoa é a identidade que o canal de aprovação procura. A
 * própria pessoa cadastra o seu; o de outra, quem administra gente. A tela
 * confere o número com a mesma regra da API antes de mandar.
 *
 * `GET /organograma` (o organograma por pilar) continua no ar para o mapa do
 * Contexto, que o lê.
 */

const ROTULO_DO_TIPO: Record<FuncaoNaEquipe['tipo'], string> = {
  agente: 'agente',
  rotina: 'rotina',
  automacao: 'automação',
};

function SeletorDeDono({
  f,
  pessoas,
  aoTrocar,
}: {
  f: FuncaoNaEquipe;
  pessoas: PessoaNaEquipe[];
  aoTrocar: (slug: string, userId: string | null) => void;
}) {
  const atual = f.dono.origem === 'banco' ? f.dono.efetivo?.id ?? '' : '';
  return (
    <select
      aria-label={`Dono de ${f.nome}`}
      value={atual}
      onChange={(e) => aoTrocar(f.slug, e.target.value || null)}
      className="max-w-[160px] rounded-root border border-border bg-bg px-1 py-0.5 font-os-mono text-[9.5px] text-text"
    >
      <option value="">padrão do cadastro{f.dono.padrao ? ` (${f.dono.padrao})` : ''}</option>
      {pessoas.map((p) => (
        <option key={p.id} value={p.id}>{p.nome}</option>
      ))}
    </select>
  );
}

function LinhaDaFuncao({
  f,
  pessoas,
  podeEditar,
  aoTrocar,
}: {
  f: FuncaoNaEquipe;
  pessoas: PessoaNaEquipe[];
  podeEditar: boolean;
  aoTrocar: (slug: string, userId: string | null) => void;
}) {
  return (
    <li data-testid={`funcao-${f.slug}`} className="flex flex-wrap items-start gap-2 py-1">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-text" title={f.paraQueServe}>
          {f.nome}
          {f.id && <span className="ml-1 font-os-mono text-[9px] text-dim">{f.id}</span>}
        </p>
        <p className="font-os-mono text-[9px] leading-[1.6] text-dim">
          {ROTULO_DO_TIPO[f.tipo]} · {ROTULO_DO_ESTADO[f.estado]}
          {f.dono.origem === 'padrao' && ' · dono padrão'}
          {f.dono.bancoForaDaEquipe && ' · o dono gravado não é da equipe'}
        </p>
      </div>
      {podeEditar && <SeletorDeDono f={f} pessoas={pessoas} aoTrocar={aoTrocar} />}
    </li>
  );
}

function Whatsapp({ p, aoSalvar }: { p: PessoaNaEquipe; aoSalvar: (id: string, numero: string | null) => Promise<void> }) {
  const [numero, setNumero] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(valor: string | null) {
    if (valor !== null) {
      const leitura = lerWhatsappBr(valor);
      if (!leitura.ok) {
        setErro(leitura.motivo);
        return;
      }
    }
    setSalvando(true);
    try {
      await aoSalvar(p.id, valor);
      setNumero('');
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mt-2 space-y-1">
      <p className="font-os-mono text-[10px] text-muted">
        WhatsApp de aprovação:{' '}
        {p.whatsapp.cadastrado ? (
          <span className="text-text">{p.whatsapp.numero ?? p.whatsapp.final}</span>
        ) : (
          <span className="text-warn">sem número</span>
        )}
      </p>
      {p.podeEditarWhatsapp && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label={`WhatsApp de ${p.nome}`}
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="+55 (32) 99999-8888"
              className="w-[170px] rounded-root border border-border bg-bg px-2 py-1 font-os-mono text-[10px] text-text outline-none focus:border-brand"
            />
            <button
              type="button"
              disabled={salvando || !numero.trim()}
              onClick={() => salvar(numero)}
              className="rounded-root bg-brand px-2 py-1 font-os-mono text-[9.5px] uppercase text-ink disabled:opacity-50"
            >
              salvar número
            </button>
            {p.whatsapp.cadastrado && (
              <button
                type="button"
                disabled={salvando}
                onClick={() => salvar(null)}
                className="font-os-mono text-[9.5px] uppercase text-muted hover:text-text"
              >
                remover número
              </button>
            )}
          </div>
          <p className="font-os-mono text-[9px] leading-[1.5] text-dim">
            Cadastre como o WhatsApp mostra o número (com ou sem o 9): o canal confere por igualdade.
          </p>
        </>
      )}
      {erro && <p role="alert" className="font-os-mono text-[10px] text-bad">{erro}</p>}
    </div>
  );
}

export default function EquipePage() {
  const { token, ready } = useAuth();
  const [data, setData] = useState<EquipeDaEmpresa | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = () => {
    if (!token) return;
    apiGet<EquipeDaEmpresa>('/organograma/equipe', token)
      .then((r) => {
        setData(r);
        setErro(null);
      })
      .catch((e) => setErro((e as Error).message));
  };
  useEffect(carregar, [ready, token]);

  async function trocarDono(slug: string, userId: string | null) {
    try {
      await apiPut(`/organograma/dono/${encodeURIComponent(slug)}`, { userId }, token);
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function salvarWhatsapp(id: string, numero: string | null) {
    await apiPut(`/organograma/pessoas/${encodeURIComponent(id)}/whatsapp`, { numero }, token);
    carregar();
  }

  const fora = data
    ? (Object.entries(data.foraDaVista) as [MotivoForaDaEquipe, number][]).filter(([, n]) => n > 0)
    : [];

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Quem trabalha aqui: as pessoas e, sob cada uma, os agentes, rotinas e automações de que ela é
        dona, por área. O dono padrão vem do cadastro; o que for trocado aqui vale por cima dele.
      </p>

      {erro && <div className="rounded-root border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{erro}</div>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Pessoas" value={data?.totais.pessoas ?? '—'} icon="Users" tone="brand" />
        <KpiCard label="Agentes" value={data?.totais.agentes ?? '—'} hint="decidem com modelo" icon="Bot" />
        <KpiCard label="Rotinas" value={data?.totais.rotinas ?? '—'} hint="rodam no relógio" icon="Clock" />
        <KpiCard label="Automações" value={data?.totais.automacoes ?? '—'} hint="reagem a evento ou sincronizam" icon="Cable" />
      </div>

      {!data && !erro && <p className="text-sm text-muted">Carregando…</p>}

      {data && data.pessoas.length === 0 && (
        <p className="rounded-root border border-border bg-surface p-4 text-sm text-muted">
          Nenhuma pessoa ativa na equipe ainda.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.pessoas.map((p) => (
          <section key={p.id} aria-label={p.nome} className="rounded-root border border-border bg-surface p-4">
            <header className="border-b border-border pb-2">
              <div className="flex items-center gap-2">
                <UserIcon size={13} className="flex-none text-muted" />
                <h2 className="text-[14px] font-medium text-text">{p.nome}</h2>
              </div>
              <p className="font-os-mono text-[9px] text-dim">
                {p.papeis.join(' · ') || 'sem papel'} · {p.areas.reduce((s, a) => s + a.funcoes.length, 0)} função(ões)
              </p>
              <Whatsapp p={p} aoSalvar={salvarWhatsapp} />
            </header>

            {p.areas.length === 0 && (
              <p className="mt-3 font-os-mono text-[9.5px] text-dim">nenhum agente, rotina ou automação</p>
            )}
            {p.areas.map((a) => (
              <div key={a.area} className="mt-3">
                <h3 className="font-os-mono text-[9.5px] uppercase tracking-[0.14em] text-brand">{a.area}</h3>
                <ul className="divide-y divide-border">
                  {a.funcoes.map((f) => (
                    <LinhaDaFuncao key={f.slug} f={f} pessoas={data.pessoas} podeEditar={data.podeEditarDono} aoTrocar={trocarDono} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>

      {data && data.semDono.length > 0 && (
        <section aria-label="Sem dono" className="rounded-root border border-warn/40 bg-surface p-4">
          <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-warn">
            Sem dono ({data.semDono.length}): o padrão do cadastro não casou com ninguém da equipe
          </h2>
          <ul className="mt-2 divide-y divide-border">
            {data.semDono.map((f) => (
              <LinhaDaFuncao key={f.slug} f={f} pessoas={data.pessoas} podeEditar={data.podeEditarDono} aoTrocar={trocarDono} />
            ))}
          </ul>
        </section>
      )}

      {fora.length > 0 && (
        <p className="font-os-mono text-[9.5px] leading-[1.6] text-dim">
          Fora da vista, sem apagar nada: {fora.map(([m, n]) => `${ROTULO_DO_MOTIVO[m]}: ${n}`).join(' · ')}.
        </p>
      )}

      <Link
        href="/agentes"
        className="inline-flex font-os-mono text-[9.5px] uppercase tracking-[0.16em] text-muted hover:text-text"
      >
        ver o catálogo completo de agentes, rotinas e automações →
      </Link>
    </div>
  );
}
