'use client';

/*
 * As peças comuns da caixa de entrada (rodada do painel P1, 18/10/2026).
 *
 * Tudo no tema do OS (tokens `bg`, `surface`, `border`, `brand`...), que troca
 * entre escuro e claro pelo `data-os-theme` do <html>. As classes repetem as do
 * cockpit comercial de propósito, sem importar de lá: aquela pasta é de outra
 * frente, e uma caixa que quebra quando o comercial muda um botão é acoplamento
 * que ninguém pediu.
 */
import type { CaixaEstadoDoEixo } from '@mktos/shared';

export const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';
// No celular o botão tem 44 px de altura (o alvo do polegar); no desktop, a do texto.
export const BOTAO = `inline-flex items-center justify-center rounded border border-border px-3 py-1.5 text-[12.5px] transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-[44px] ${FOCO}`;
export const BOTAO_PEQUENO = `inline-flex items-center justify-center rounded border border-border px-2 py-1 text-[11.5px] text-muted transition hover:border-brand hover:text-text disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-[44px] max-md:min-w-[44px] ${FOCO}`;
export const ROTULO = 'font-os-mono text-[10px] uppercase tracking-[0.16em] text-muted';
export const CARTAO = 'rounded border border-border bg-surface';
export const SELECT = `rounded border border-border bg-bg px-2 py-1.5 text-[12.5px] outline-none focus:border-brand max-md:min-h-[44px] ${FOCO}`;

/** "há 5 min", "há 3 h", "ontem", "há 4 dias". */
export function haQuanto(iso: string, agora: Date): string {
  const ms = agora.getTime() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  return `há ${d} dias`;
}

/** Data e hora curtas, no fuso de Brasília. */
export function quandoCompleto(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** O dia, no fuso de Brasília. */
export function dia(iso: string | null): string {
  if (!iso) return 'sem prazo';
  return new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * O que a tela escreve quando o quadro veio vazio POR MOTIVO. `ok` não aparece
 * aqui: vazio com `ok` é vitória, e a frase da vitória é de cada aba.
 */
export function fraseDoQuadro(estado: CaixaEstadoDoEixo): string | null {
  if (estado === 'ok') return null;
  if (estado === 'fora_da_casa') {
    return 'Sua sessão não corresponde a um usuário ativo desta empresa. Saia e entre de novo.';
  }
  if (estado === 'sem_permissao') {
    return 'Seu perfil não vê o quadro de trabalho, então esta parte da caixa fica fora. O papel de cada pessoa define o que ela vê.';
  }
  if (estado === 'modulo_desligado') {
    return 'O módulo Trabalho não está contratado por esta empresa, então não há tarefas para mostrar aqui.';
  }
  if (estado === 'sem_identidade') {
    return 'Seu cadastro está sem nome e sem e-mail, e a caixa não tem por qual nome procurar você no responsável das tarefas.';
  }
  return 'Nada a mostrar aqui.';
}

/** Erro com "tentar de novo", no padrão das telas do comercial. */
export function ErroComRetentativa({ mensagem, onTentar }: { mensagem: string; onTentar: () => void }) {
  return (
    <div role="alert" className={`${CARTAO} space-y-2 p-4`}>
      <p className="text-sm text-bad">Não foi possível carregar: {mensagem}</p>
      <button type="button" onClick={onTentar} className={BOTAO}>
        tentar de novo
      </button>
    </div>
  );
}

export function Carregando({ texto }: { texto: string }) {
  return (
    <p className="text-sm text-muted" aria-live="polite">
      {texto}
    </p>
  );
}

export function Vazio({ children }: { children: React.ReactNode }) {
  return <p className={`${CARTAO} px-4 py-6 text-sm text-muted`}>{children}</p>;
}
