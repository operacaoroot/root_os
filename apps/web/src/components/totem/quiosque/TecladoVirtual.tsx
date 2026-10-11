'use client';

import { Delete, Space } from 'lucide-react';

/*
 * O teclado do quiosque. Tela de toque de loja nem sempre tem teclado do
 * sistema, e quando tem ele cobre metade da tela sem aviso; este fica sempre no
 * mesmo lugar, com teclas de 64 px ou mais.
 *
 * `qwerty` é o da busca (com Ç); `codigo` é o da ativação, só com os
 * caracteres que um código de ativação pode ter.
 */

const LINHAS_QWERTY = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKLÇ', 'ZXCVBNM'];
const LINHAS_CODIGO = ['1234567890', 'ABCDEFGH', 'JKMNPQRS', 'TVWXYZ'];

export interface TecladoVirtualProps {
  layout: 'qwerty' | 'codigo';
  aoTecla: (caractere: string) => void;
  aoApagar: () => void;
  aoLimpar?: () => void;
}

const TECLA =
  'grid min-h-16 min-w-0 flex-1 select-none place-items-center rounded-[10px] border border-[color:var(--q-linha)] bg-[color:var(--q-cartao)] text-[28px] font-semibold text-[color:var(--q-tinta)] shadow-[0_1px_2px_rgba(31,43,23,0.10)] active:translate-y-px active:bg-[color:var(--q-afundado)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[color:var(--q-destaque)]';

export function TecladoVirtual({ layout, aoTecla, aoApagar, aoLimpar }: TecladoVirtualProps) {
  const linhas = layout === 'qwerty' ? LINHAS_QWERTY : LINHAS_CODIGO;
  return (
    <div
      role="group"
      aria-label="Teclado"
      className="mx-auto flex w-full max-w-[1100px] flex-col gap-2 p-3"
      onPointerDown={(e) => e.preventDefault()}
    >
      {linhas.map((linha, i) => (
        <div key={linha} className="flex gap-2">
          {[...linha].map((c) => (
            <button key={c} type="button" className={TECLA} onClick={() => aoTecla(c)}>
              {c}
            </button>
          ))}
          {i === linhas.length - 1 && (
            <button type="button" className={`${TECLA} flex-[1.6]`} onClick={aoApagar} aria-label="Apagar">
              <Delete aria-hidden className="h-8 w-8" />
            </button>
          )}
        </div>
      ))}
      {layout === 'qwerty' && (
        <div className="flex gap-2">
          {aoLimpar && (
            <button type="button" className={`${TECLA} flex-[1.4] text-[22px]`} onClick={aoLimpar}>
              Limpar
            </button>
          )}
          <button type="button" className={`${TECLA} flex-[5]`} onClick={() => aoTecla(' ')} aria-label="Espaço">
            <Space aria-hidden className="h-8 w-8" />
          </button>
        </div>
      )}
    </div>
  );
}
