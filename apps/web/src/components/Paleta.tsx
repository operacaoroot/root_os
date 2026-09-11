'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NAV, SECOES, navPorSecao } from '@mktos/shared';
import * as Icons from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useModulos } from './modulos';

type IconName = keyof typeof Icons;

interface Comando {
  chave: string;
  rotulo: string;
  dica: string;
  icone: string;
  ir: string;
}

/*
 * A paleta ⌘K.
 *
 * Ela navega, e por enquanto SÓ navega — o placeholder da busca prometia
 * "buscar leads, campanhas, tarefas" e não buscava nada. Prometer busca e
 * entregar navegação é o tipo de mentira pequena que faz o usuário parar de
 * confiar no resto da tela.
 */
export function Paleta({ aberto, fechar }: { aberto: boolean; fechar: () => void }) {
  const { user } = useAuth();
  const { modulos } = useModulos();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const campo = useRef<HTMLInputElement>(null);

  const comandos = useMemo<Comando[]>(() => {
    const perms = new Set(user?.permissions ?? []);
    const dicaDaSecao = new Map(SECOES.map((s) => [s.key, s.hint]));
    // Os mesmos dois filtros da sidebar — permissão e módulo contratado.
    // A paleta navega, e não pode navegar para tela que a API vai recusar.
    return navPorSecao(perms, modulos ?? undefined)
      .flatMap((g) => g.itens)
      .map((n) => ({
        chave: n.key,
        rotulo: n.label,
        dica: dicaDaSecao.get(n.secao) ?? '',
        icone: n.icon,
        ir: n.href,
      }));
  }, [user, modulos]);

  const filtrados = useMemo(() => {
    const termo = q.trim().toLowerCase();
    if (!termo) return comandos;
    return comandos.filter(
      (c) => c.rotulo.toLowerCase().includes(termo) || c.dica.toLowerCase().includes(termo),
    );
  }, [q, comandos]);

  useEffect(() => {
    if (aberto) {
      setQ('');
      setI(0);
      // o autofocus do input não vence a montagem do portal
      setTimeout(() => campo.current?.focus(), 0);
    }
  }, [aberto]);

  useEffect(() => setI(0), [q]);

  if (!aberto) return null;

  const escolher = (c: Comando) => {
    fechar();
    router.push(c.ir);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ir para"
      className="fixed inset-0 z-50 flex items-start justify-center bg-bg/70 pt-[12vh]"
      onClick={fechar}
    >
      <div
        className="w-[min(560px,92vw)] overflow-hidden rounded-root border border-border bg-bg2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={campo}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') fechar();
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setI((v) => Math.min(v + 1, filtrados.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setI((v) => Math.max(v - 1, 0));
            }
            if (e.key === 'Enter' && filtrados[i]) escolher(filtrados[i]);
          }}
          placeholder="ir para…"
          className="w-full border-b border-border bg-transparent px-4 py-3 font-os-mono text-[13px] text-text outline-none placeholder:text-dim"
        />
        <ul className="max-h-[52vh] overflow-y-auto py-1">
          {filtrados.length === 0 && (
            <li className="px-4 py-3 text-[12px] text-muted">Nada com esse nome no menu.</li>
          )}
          {filtrados.map((c, k) => {
            const Icone = (Icons[c.icone as IconName] ?? Icons.Circle) as React.ElementType;
            return (
              <li key={c.chave}>
                <button
                  type="button"
                  onMouseEnter={() => setI(k)}
                  onClick={() => escolher(c)}
                  className={`flex w-full items-center gap-[10px] px-4 py-[7px] text-left transition-colors ${k === i ? 'bg-brand/10 text-brand' : 'text-muted hover:text-text'}`}
                >
                  <Icone size={13} className="flex-none" />
                  <span className="text-[12.5px]">{c.rotulo}</span>
                  <span className="truncate font-os-mono text-[9.5px] text-dim">{c.dica}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-border px-4 py-2 font-os-mono text-[9px] uppercase tracking-[0.12em] text-dim">
          ↑↓ navega · enter abre · esc fecha
        </p>
      </div>
    </div>
  );
}
