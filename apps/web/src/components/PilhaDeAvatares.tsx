'use client';

import { AvatarDaPessoa, type TamanhoDoAvatar } from './AvatarDaPessoa';

/*
 * OS RESPONSÁVEIS SÓ COM A IMAGEM (produção 22B, I6).
 *
 * Onde a linha já diz o que é (cartão do quadro, linha da lista, tarefa do dia,
 * cartão do funil), o responsável aparece só como avatar: a foto, ou as
 * iniciais, com o nome no balão (`title`) e no nome acessível (`aria-label`).
 * Vários responsáveis: os avatares sobrepostos e, passando do teto, um "+N"
 * cujo balão diz quem são os outros. Ninguém: o círculo tracejado com a frase
 * de quem não tem responsável (cada tela diz a sua).
 *
 * `id` é o da conta: com ele o avatar acha a foto na lista da empresa
 * (`GET /perfil/pessoas`, lida uma vez por página). Sem id (o texto antigo
 * herdado do ClickUp), ficam as iniciais. Sem permissão para a lista, também.
 */

export interface PessoaNoAvatar {
  id?: string | null;
  nome: string;
  /** O balão, quando diz mais que o nome ("Ana (inativo)"). */
  rotulo?: string;
}

const LADO_DO_MAIS: Record<TamanhoDoAvatar, string> = {
  p: 'h-5 min-w-5 text-[9px]',
  m: 'h-7 min-w-7 text-[10.5px]',
  g: 'h-10 min-w-10 text-[13px]',
  gg: 'h-24 min-w-24 text-[28px]',
};

export function PilhaDeAvatares({
  pessoas,
  max = 3,
  tamanho = 'p',
  vazio = 'Sem responsável',
  prefixo,
  testId,
  className = '',
}: {
  pessoas: PessoaNoAvatar[];
  /** Quantos círculos no máximo, contando o "+N". */
  max?: number;
  tamanho?: TamanhoDoAvatar;
  /** O balão de quando não há ninguém. */
  vazio?: string;
  /** Vai antes do nome no balão ("Responsável: Ana"). */
  prefixo?: string;
  testId?: string;
  className?: string;
}) {
  const lado = LADO_DO_MAIS[tamanho];
  if (!pessoas.length) {
    return (
      <span
        role="img"
        aria-label={vazio}
        title={vazio}
        data-testid={testId}
        data-vazio="sim"
        className={`inline-grid flex-none place-items-center rounded-full border border-dashed border-border px-1 align-middle font-os-mono leading-none text-dim ${lado} ${className}`}
      >
        <span aria-hidden>?</span>
      </span>
    );
  }
  const cabem = pessoas.length > max ? Math.max(1, max - 1) : pessoas.length;
  const visiveis = pessoas.slice(0, cabem);
  const resto = pessoas.slice(cabem);
  const balao = (p: PessoaNoAvatar) => `${prefixo ? `${prefixo}: ` : ''}${p.rotulo ?? p.nome}`;
  const outros = resto.map((p) => p.rotulo ?? p.nome).join(', ');
  return (
    <span data-testid={testId} className={`inline-flex flex-none items-center align-middle ${className}`}>
      {visiveis.map((p, i) => (
        <AvatarDaPessoa
          key={`${p.id ?? p.nome}-${i}`}
          nome={p.nome}
          pessoaId={p.id ?? null}
          rotulo={balao(p)}
          tamanho={tamanho}
          className={i ? '-ml-1.5 ring-2 ring-surface' : ''}
        />
      ))}
      {resto.length > 0 && (
        <span
          role="img"
          aria-label={`Mais ${resto.length}: ${outros}`}
          title={`Também: ${outros}`}
          data-testid={testId ? `${testId}-mais` : undefined}
          className={`-ml-1.5 inline-grid flex-none place-items-center rounded-full border border-border bg-surface-2 px-1 font-os-mono font-medium leading-none text-muted ring-2 ring-surface ${lado}`}
        >
          <span aria-hidden>+{resto.length}</span>
        </span>
      )}
    </span>
  );
}
