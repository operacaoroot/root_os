'use client';

import { aniversariantesDoDia, rotuloDoAniversario } from '@mktos/shared';
import { useAuth } from '@/lib/auth';
import { useAvatares } from '@/lib/avatares';
import { AvatarDaPessoa } from '@/components/AvatarDaPessoa';

/*
 * O ANIVERSÁRIO NO DIA A DIA (produção 22B, I6).
 *
 * Um bloco pequeno: quem da equipe faz aniversário hoje, pelo dia civil de São
 * Paulo, com o avatar. Só dia e mês (o ano nunca sai do perfil). Sem ninguém
 * de aniversário, o bloco não aparece.
 */
export function AniversariosDoDia({ agora }: { agora?: Date } = {}) {
  const { token } = useAuth();
  const pessoas = useAvatares(token);
  if (!pessoas) return null;
  const hoje = aniversariantesDoDia(pessoas, agora ?? new Date());
  if (!hoje.length) return null;
  return (
    <section
      aria-label="Aniversários de hoje"
      data-testid="aniversarios-do-dia"
      className="flex flex-wrap items-center gap-3 rounded-root border border-border bg-surface px-4 py-2.5"
    >
      <h2 className="font-os-mono text-[10px] uppercase tracking-[0.16em] text-brand">Aniversário hoje</h2>
      <ul className="flex flex-wrap items-center gap-3">
        {hoje.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-sm text-text">
            <AvatarDaPessoa nome={p.nome} fotoUrl={p.fotoUrl} tamanho="p" mostrarNome />
            <span className="font-os-mono text-[10px] text-muted">{p.aniversario ? rotuloDoAniversario(p.aniversario) : ''}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
