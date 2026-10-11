'use client';

import { RefreshCw, X } from 'lucide-react';
import type { TotemCatalogo } from '@mktos/shared';

import type { AparelhoAtivado } from './credencial';
import { dataEHoraLocal, dataLocal } from './formato';
import { TOTEM_VERSAO_DO_QUIOSQUE } from './sincronia';
import type { EstadoDaSincronia } from './useQuiosque';

/*
 * Aberta pelo gesto escondido (5 toques no canto superior esquerdo). Mostra o
 * que quem instala ou dá suporte precisa conferir, sem nada que deixe o
 * cliente da loja mexer na configuração.
 */

export interface TelaDeManutencaoProps {
  aparelho: AparelhoAtivado;
  catalogo: TotemCatalogo | null;
  online: boolean;
  sincronia: EstadoDaSincronia;
  eventosNaFila: number;
  aoSincronizar: () => void;
  aoFechar: () => void;
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-b border-[color:var(--q-linha)] py-3">
      <dt className="text-[color:var(--q-tinta-suave)]">{rotulo}</dt>
      <dd className="font-semibold">{valor}</dd>
    </div>
  );
}

export function TelaDeManutencao({
  aparelho,
  catalogo,
  online,
  sincronia,
  eventosNaFila,
  aoSincronizar,
  aoFechar,
}: TelaDeManutencaoProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manutenção do totem"
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
    >
      <div className="max-h-full w-full max-w-[760px] overflow-y-auto rounded-[18px] bg-[color:var(--q-cartao)] p-6 text-[22px] text-[color:var(--q-tinta)]">
        <div className="flex items-center justify-between gap-4 pb-2">
          <h1 className="font-[family-name:var(--q-fonte-display)] text-[34px] font-semibold">Manutenção</h1>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar a manutenção"
            className="grid h-16 w-16 place-items-center rounded-full border border-[color:var(--q-linha)]"
          >
            <X aria-hidden className="h-8 w-8" />
          </button>
        </div>
        <dl>
          <Linha rotulo="Loja" valor={catalogo?.loja.nome ?? aparelho.loja.nome} />
          <Linha rotulo="Aparelho" valor={catalogo?.dispositivo.nome ?? aparelho.dispositivo.nome} />
          <Linha rotulo="Ativado em" valor={dataLocal(aparelho.ativadoEm)} />
          <Linha
            rotulo="Última sincronização"
            valor={sincronia.ultimaEm ? dataEHoraLocal(sincronia.ultimaEm) : 'Ainda não sincronizou.'}
          />
          <Linha rotulo="Versão do catálogo" valor={catalogo ? catalogo.versao.slice(0, 12) : 'Nenhum catálogo guardado.'} />
          <Linha rotulo="Produtos no catálogo" valor={String(catalogo?.produtos.length ?? 0)} />
          <Linha rotulo="Conexão" valor={online ? 'Com internet' : 'Sem internet'} />
          <Linha rotulo="Eventos esperando envio" valor={String(eventosNaFila)} />
          <Linha rotulo="Versão do quiosque" valor={TOTEM_VERSAO_DO_QUIOSQUE} />
        </dl>
        {sincronia.erro && (
          <p role="alert" className="mt-4 rounded-[10px] bg-[color:var(--q-atencao-fundo)] px-4 py-3 text-[color:var(--q-atencao)]">
            {sincronia.erro}
          </p>
        )}
        <button
          type="button"
          onClick={aoSincronizar}
          disabled={sincronia.sincronizando}
          className="mt-6 flex min-h-[72px] w-full items-center justify-center gap-3 rounded-[10px] bg-[color:var(--q-primaria)] text-[24px] font-semibold text-[color:var(--q-sobre-primaria)] disabled:opacity-60"
        >
          <RefreshCw aria-hidden className={`h-7 w-7 ${sincronia.sincronizando ? 'animate-spin' : ''}`} />
          {sincronia.sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}
        </button>
      </div>
    </div>
  );
}
