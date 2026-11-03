'use client';

/*
 * A AÇÃO SOBRE UM CONTRATO: ocupado, erro, retenção e a frase do que aconteceu.
 *
 * Ação retida pela política responde `status: 'aguardando_aprovacao'` com 200: nada
 * mudou ainda, então a tela diz que foi para Aprovações e nunca dá sucesso.
 */
import { useCallback, useState } from 'react';
import Link from 'next/link';

import { apiBlob } from '@/lib/api';

import { ErroDaAcao, FOCO } from '../_ui';
import { FRASE_RETIDA, foiParaAprovacoes } from './regras';

/**
 * Abre um PDF que a API só entrega com o token. A aba abre antes de esperar a resposta: depois do `await` o navegador já
 * não considera clique e bloqueia. Falhou, a aba fecha e o erro volta para a tela (o 409 da prévia traz a lista).
 */
export async function abrirPdfDaApi(caminho: string, token: string | null | undefined): Promise<void> {
  const aba = window.open('', '_blank');
  try {
    const url = URL.createObjectURL(await apiBlob(caminho, token));
    if (aba) aba.location.href = url;
    else window.location.assign(url);
  } catch (e) {
    aba?.close();
    throw e;
  }
}

export function FaixaRetida({ testId = 'contrato-retido', frase = FRASE_RETIDA }: { testId?: string; frase?: string }) {
  return (
    <div role="status" data-testid={testId} className="flex flex-wrap items-center gap-2 rounded border border-warn/50 bg-warn/10 px-3 py-2 text-[13px]">
      <span>{frase}</span>
      <Link href="/atendimento" className={`ml-auto underline decoration-brand underline-offset-2 ${FOCO}`}>abrir Aprovações</Link>
    </div>
  );
}

export function useAcaoDoContrato(aoMudar: () => void | Promise<void>) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [retida, setRetida] = useState(false);
  const [frase, setFrase] = useState<string | null>(null);

  /** Roda a ação. Devolve se ela valeu: retida ou com erro, o formulário fica aberto e a tela não dá sucesso. */
  const rodar = useCallback(async <T,>(chave: string, fazer: () => Promise<T>, dizer?: string | ((r: T) => string)): Promise<boolean> => {
    setOcupado(chave);
    setErro(null);
    setRetida(false);
    setFrase(null);
    try {
      const r = await fazer();
      if (foiParaAprovacoes(r)) {
        setRetida(true);
        await aoMudar();
        return false;
      }
      setFrase(typeof dizer === 'function' ? dizer(r) : dizer ?? null);
      await aoMudar();
      return true;
    } catch (e) {
      setErro(e);
      return false;
    } finally {
      setOcupado(null);
    }
  }, [aoMudar]);

  return { ocupado, erro, retida, frase, rodar };
}

export function RetornoDaAcao({ acao, testId }: { acao: { erro: unknown; retida: boolean; frase: string | null }; testId?: string }) {
  return (
    <>
      <ErroDaAcao erro={acao.erro} />
      {acao.retida && <FaixaRetida testId={testId} />}
      {acao.frase && <p role="status" className="text-[12.5px] text-muted">{acao.frase}</p>}
    </>
  );
}
