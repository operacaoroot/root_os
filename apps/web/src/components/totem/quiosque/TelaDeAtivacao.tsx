'use client';

import { useEffect, useState } from 'react';
import {
  TOTEM_ALFABETO_CROCKFORD,
  TOTEM_TAMANHO_CODIGO_ATIVACAO,
  TotemCodigoAtivacaoSchema,
  totemNormalizarCodigo,
} from '@mktos/shared';

import { ErroDaApi } from '@/lib/api';
import { ehNaoEncontrado, ehSemRede } from '@/lib/totem/api-publica';
import { TecladoVirtual } from './TecladoVirtual';

/*
 * A primeira tela do aparelho: o código de 8 caracteres gerado no painel
 * (Totem > Aparelhos) vira o token que fica guardado no aparelho.
 */

export function mensagemDaFalhaDeAtivacao(e: unknown): string {
  if (ehSemRede(e)) return 'Sem conexão com a internet. Ligue o totem à rede da loja e tente de novo.';
  if (ehNaoEncontrado(e)) return 'Código inválido ou vencido. Gere um novo código no painel e tente de novo.';
  if (e instanceof ErroDaApi && e.status === 429) return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.';
  return 'Não foi possível ativar agora. Tente de novo em instantes.';
}

export function TelaDeAtivacao({ aoAtivar }: { aoAtivar: (codigo: string) => Promise<void> }) {
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const completo = TotemCodigoAtivacaoSchema.safeParse(codigo).success;

  function digitar(c: string) {
    const normal = totemNormalizarCodigo(c);
    if (normal.length !== 1 || !TOTEM_ALFABETO_CROCKFORD.includes(normal)) return;
    setErro(null);
    setCodigo((atual) => (atual + normal).slice(0, TOTEM_TAMANHO_CODIGO_ATIVACAO));
  }

  function apagar() {
    setErro(null);
    setCodigo((atual) => atual.slice(0, -1));
  }

  async function ativar() {
    const r = TotemCodigoAtivacaoSchema.safeParse(codigo);
    if (!r.success || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await aoAtivar(r.data);
    } catch (e) {
      setErro(mensagemDaFalhaDeAtivacao(e));
      setEnviando(false);
    }
  }

  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Backspace') apagar();
      else if (e.key === 'Enter') void ativar();
      else if (/^[a-z0-9]$/i.test(e.key)) digitar(e.key);
    }
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  });

  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-8 px-4 py-10 text-[color:var(--q-sobre-fundo)]">
      <div className="max-w-[900px] space-y-3 text-center">
        <h1 className="font-[family-name:var(--q-fonte-display)] text-[44px] font-semibold leading-tight">
          Ative este totem
        </h1>
        <p className="text-[22px] leading-relaxed text-[color:var(--q-sobre-fundo-suave)]">
          No painel, abra Totem, depois Aparelhos, e gere o código de ativação deste aparelho. Digite aqui os 8
          caracteres. O código vale por 30 minutos.
        </p>
      </div>

      <div className="flex gap-2" aria-live="polite" aria-label={`Código digitado: ${codigo || 'nenhum'}`}>
        {Array.from({ length: TOTEM_TAMANHO_CODIGO_ATIVACAO }, (_, i) => (
          <span
            key={i}
            className="grid h-[84px] w-[64px] place-items-center rounded-[10px] border-2 border-[color:var(--q-linha-forte)] bg-[color:var(--q-cartao)] font-[family-name:var(--q-fonte-chamada)] text-[44px] text-[color:var(--q-tinta)]"
          >
            {codigo[i] ?? ''}
          </span>
        ))}
      </div>

      {erro && (
        <p role="alert" className="max-w-[900px] rounded-[10px] bg-[color:var(--q-perigo-fundo)] px-5 py-4 text-center text-[22px] text-[color:var(--q-perigo)]">
          {erro}
        </p>
      )}

      <button
        type="button"
        disabled={!completo || enviando}
        onClick={() => void ativar()}
        className="min-h-[72px] min-w-[320px] rounded-[10px] bg-[color:var(--q-primaria)] px-8 text-[26px] font-semibold text-[color:var(--q-sobre-primaria)] disabled:opacity-40"
      >
        {enviando ? 'Ativando…' : 'Ativar este totem'}
      </button>

      <TecladoVirtual layout="codigo" aoTecla={digitar} aoApagar={apagar} />
    </main>
  );
}
