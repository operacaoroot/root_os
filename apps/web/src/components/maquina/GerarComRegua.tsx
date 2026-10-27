'use client';

import { useState } from 'react';
import type { MaquinaPost } from '@mktos/shared';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { btn, btnPrimario } from './pecas';
import type { Maquina } from './useMaquina';

/*
 * "Gerar com a régua" (ROOT Estúdio, 26/10/2026): a IA escreve gancho, roteiro,
 * slides e legenda do post seguindo a régua do formato (Produção › Formatos).
 * Com texto já escrito, pede o ajuste; a versão anterior fica nos comentários.
 * Comunidade Wpp ganha também "Copiar mensagem", pronta para colar no grupo.
 */
export function GerarComRegua({ m, post }: { m: Maquina; post: MaquinaPost }) {
  const { token } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [instrucao, setInstrucao] = useState('');
  const [gerando, setGerando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const temTexto = !!(post.headline || post.roteiro || post.legenda || post.slides.length);

  const gerar = async () => {
    setGerando(true);
    const ok = await m.agir(() => apiPost(`/marketing/estudio/posts/${post.id}/gerar`, { instrucao: instrucao.trim() || undefined }, token));
    setGerando(false);
    if (ok !== null) {
      setAberto(false);
      setInstrucao('');
      await m.recarregar();
    }
  };

  const copiar = async () => {
    const texto = [post.roteiro, post.subtipo === 'Enquete' && post.subHeadline ? `\n${post.subHeadline}\n${post.slides.map((o) => `▸ ${o}`).join('\n')}` : '']
      .filter(Boolean).join('\n');
    await navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1600);
  };

  return (
    <>
      {post.formato === 'Comunidade Wpp' && post.roteiro && (
        <button className={btn} onClick={() => void copiar()}>
          {copiado ? 'Copiado' : 'Copiar mensagem'}
        </button>
      )}
      {!aberto ? (
        <button className={btn} onClick={() => (temTexto ? setAberto(true) : void gerar())} disabled={gerando}>
          {gerando ? 'Gerando…' : temTexto ? 'Ajustar com a régua' : 'Gerar com a régua'}
        </button>
      ) : (
        <div className="flex w-full flex-wrap items-center gap-2">
          <input
            autoFocus
            value={instrucao}
            onChange={(e) => setInstrucao(e.target.value)}
            placeholder="O que mudar? (vazio = versão nova)"
            className="min-w-[14rem] flex-1 rounded border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-brand"
          />
          <button className={btnPrimario} onClick={() => void gerar()} disabled={gerando}>
            {gerando ? 'Gerando…' : 'Gerar'}
          </button>
          <button className={btn} onClick={() => setAberto(false)}>
            Cancelar
          </button>
        </div>
      )}
    </>
  );
}
