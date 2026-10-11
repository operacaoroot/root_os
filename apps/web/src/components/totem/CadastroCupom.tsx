'use client';

import type { TotemCredencial } from '@/lib/totem/api-publica';

/*
 * O CADASTRO QUE GERA O CUPOM (CONTRATO.md, seções 4 e 8).
 *
 * Um componente só para os dois caminhos: o quiosque (`origem="totem"`, com o
 * token do aparelho) e o celular que leu o QR da etiqueta (`origem="qr"`, com o
 * código dela). Quem abre o cadastro só decide o que fazer quando ele termina
 * ou é cancelado.
 *
 * CORPO PROVISÓRIO DA BASE. A frente D escreve o formulário e mantém as props.
 */

export interface CadastroCupomProps {
  origem: 'totem' | 'qr';
  credencial: TotemCredencial;
  aoConcluir: () => void;
  aoCancelar: () => void;
}

export function CadastroCupom({ aoCancelar }: CadastroCupomProps) {
  return (
    <div role="dialog" aria-label="Cadastro" className="rounded-xl border border-border bg-surface p-6 text-center">
      <p className="text-sm text-muted">O cadastro para ganhar o cupom ainda está em construção.</p>
      <button
        type="button"
        onClick={aoCancelar}
        className="mt-4 rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-2"
      >
        Voltar
      </button>
    </div>
  );
}
