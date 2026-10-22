'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Settings } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useEhPlataforma } from '@/lib/plataforma';
import { useModulos } from './modulos';
import { modulosDeNavegacao } from './navegacao-modulos';

/*
 * A ENGRENAGEM NO TOPO (produção 22B, I1, 22/10/2026). "Ver o que foi apagado e os
 * logs de operação, para trazer de volta o que foi apagado por engano" (o Rodrigo).
 *
 * Ao lado da identificação da pessoa, um menu com:
 *  · Perfil (`/perfil`, a página da própria pessoa);
 *  · Lixeira (`/lixeira`), para quem pode editar tarefas (a mesma permissão de
 *    apagar e restaurar);
 *  · Registro de ações (`/rastro`, a base de logs que já existe e não muda de
 *    lugar), para quem tem `auditoria.ver`;
 *  · Configurações: a entrada da área Configurações do menu, quando a pessoa vê
 *    alguma tela dela.
 * Só aparece o que a pessoa pode abrir; sem nenhum, a engrenagem não aparece.
 * É cortesia, não segurança: quem recusa é a API e a porta de cada tela.
 * Abre pelo clique ou pelo teclado, as setas andam, Esc e clique fora fecham, e o
 * foco volta para a engrenagem.
 */

export interface ItemDaEngrenagem { chave: string; rotulo: string; href: string }

/** Os itens que a pessoa vê, na ordem fixa. Pura, para o teste. */
export function itensDaEngrenagem(
  permissoes: readonly string[], entradaDasConfiguracoes: string | null, trabalhoLigado = true,
): ItemDaEngrenagem[] {
  const tem = (p: string) => permissoes.includes(p);
  return [
    { chave: 'perfil', rotulo: 'Perfil', href: '/perfil' },
    ...(tem('tarefas.editar') && trabalhoLigado ? [{ chave: 'lixeira', rotulo: 'Lixeira', href: '/lixeira' }] : []),
    ...(tem('auditoria.ver') ? [{ chave: 'rastro', rotulo: 'Registro de ações', href: '/rastro' }] : []),
    ...(entradaDasConfiguracoes ? [{ chave: 'configuracoes', rotulo: 'Configurações', href: entradaDasConfiguracoes }] : []),
  ];
}

export function EngrenagemDoUsuario() {
  const { user } = useAuth();
  const { modulos, ligado } = useModulos();
  const ehPlataforma = useEhPlataforma();
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const permissoes = user?.permissions ?? [];
  const configuracoes = modulosDeNavegacao(permissoes, modulos ?? undefined, ehPlataforma).find((a) => a.key === 'configuracoes');
  const itens = itensDaEngrenagem(permissoes, configuracoes?.entrada.href ?? null, ligado('trabalho'));

  const fechar = (devolverFoco = true) => { setAberto(false); if (devolverFoco) botao.current?.focus(); };
  const opcoes = () => [...(menu.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') ?? [])];

  useEffect(() => {
    if (!aberto) return;
    opcoes()[0]?.focus();
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  if (!user || itens.length === 0) return null;

  const andar = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(); return; }
    if (e.key === 'Tab') { setAberto(false); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const lista = opcoes();
    const atual = lista.indexOf(document.activeElement as HTMLAnchorElement);
    const proximo = e.key === 'Home' ? 0 : e.key === 'End' ? lista.length - 1
      : e.key === 'ArrowDown' ? (atual + 1) % lista.length : (atual - 1 + lista.length) % lista.length;
    lista[proximo]?.focus();
  };

  return (
    <div ref={caixa} className="relative">
      <button
        ref={botao}
        type="button"
        aria-label="Configurações e registros"
        title="Configurações e registros"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? 'root-os-engrenagem' : undefined}
        data-testid="engrenagem"
        onClick={() => setAberto((a) => !a)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !aberto) { e.preventDefault(); setAberto(true); } }}
        className="grid h-[26px] w-[26px] flex-none place-items-center border border-border text-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand max-[819px]:h-11 max-[819px]:w-11"
      >
        <Settings size={13} aria-hidden />
      </button>
      {aberto && (
        <div
          ref={menu}
          id="root-os-engrenagem"
          role="menu"
          aria-label="Configurações e registros"
          onKeyDown={andar}
          className="absolute right-0 top-full z-50 mt-1 w-56 max-w-[calc(100vw-1rem)] rounded-root border border-border bg-bg2 p-1 font-os-mono shadow-lg"
        >
          {itens.map((it) => (
            <Link
              key={it.chave}
              href={it.href}
              role="menuitem"
              data-testid={`engrenagem-${it.chave}`}
              onClick={() => fechar(false)}
              className="block rounded-root px-3 py-2 text-[11.5px] text-text hover:bg-surface-2 focus:bg-surface-2 focus:outline-none max-[819px]:min-h-11"
            >
              {it.rotulo}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
