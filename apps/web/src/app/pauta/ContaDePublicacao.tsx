'use client';

import { useCallback, useEffect, useState } from 'react';
import { diaNoFuso, type PautaContaDePublicacao } from '@mktos/shared';
import { apiGet, apiPost } from '@/lib/api';
import { Botao, Chip } from '../referencias/ui';

/*
 * MD5: a conta do Instagram por onde o OS vai publicar (MD6), no topo da aba
 * Semana. Conectar leva à tela da Meta pela trilha do Login do Instagram e volta
 * para cá com `?conexao=` — o motivo vem do callback da bio.
 */

interface Props {
  token: string | null;
  /** `pauta.publicar` e `bio.editar`, as duas que a rota pede. */
  podeConectar: boolean;
  /** O `conexao=` com que o callback devolveu para cá, se veio. */
  aviso: string | null;
  onErro: (m: string | null) => void;
  /** Para onde o navegador vai com a URL da Meta. Parâmetro só para a suíte, que não navega. */
  navegar?: (url: string) => void;
}

const TEXTO_DO_RETORNO: Record<string, string> = {
  ok: 'Conta de publicação conectada.',
  publicacao_sem_escopo:
    'A Meta não concedeu publicar. A conta ficou só para a bio. Confira se o @ tem papel no app (Instagram Tester, convite aceito) e reconecte aceitando a permissão de publicar.',
  cancelado: 'A autorização foi cancelada na tela da Meta. Nada mudou.',
  expirado: 'O pedido de conexão expirou. Tente de novo.',
  sem_credencial: 'Falta a credencial do app do Instagram. Cadastre em Bio › Conexões.',
  conta_pessoal: 'Conta pessoal não tem API. Converta o @ para profissional e tente de novo.',
  erro: 'Não deu para concluir a conexão.',
};

const STATUS: Record<string, { rotulo: string; tom: 'good' | 'warn' | 'bad' }> = {
  ok: { rotulo: 'conectada', tom: 'good' },
  token_expirado: { rotulo: 'token vencido', tom: 'bad' },
  conta_pessoal: { rotulo: 'conta pessoal', tom: 'bad' },
  privada: { rotulo: 'privada', tom: 'warn' },
  erro: { rotulo: 'com erro', tom: 'bad' },
};

const dataCurta = (iso: string) => {
  const d = diaNoFuso(new Date(iso));
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
};

/** A resposta tem a forma que a tela espera? Protege de proxy ou versão velha da API. */
function ehConta(x: unknown): x is PautaContaDePublicacao {
  return !!x && typeof x === 'object' && Array.isArray((x as PautaContaDePublicacao).escoposPedidos);
}

export function ContaDePublicacao({ token, podeConectar, aviso, onErro, navegar = (u) => window.location.assign(u) }: Props) {
  const [conta, setConta] = useState<PautaContaDePublicacao | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [indo, setIndo] = useState(false);

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      const r = await apiGet<unknown>('/pauta/instagram/conexao', token);
      setConta(ehConta(r) ? r : null);
      setFalhou(!ehConta(r));
    } catch {
      setFalhou(true);
    }
  }, [token]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const conectar = async () => {
    onErro(null);
    setIndo(true);
    try {
      const { url } = await apiPost<{ url: string }>('/pauta/instagram/conectar', {}, token);
      navegar(url);
    } catch (e) {
      onErro((e as Error).message);
      setIndo(false);
    }
  };

  const c = conta?.conexao ?? null;
  const status = c ? STATUS[c.status] ?? STATUS.erro : null;
  const bomRetorno = aviso === 'ok';

  return (
    <section className="space-y-2 rounded-lg border border-border p-3" aria-label="Conta de publicação">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Conta de publicação</h3>
        {c && status && <Chip tone={c.podePublicar ? status.tom : 'warn'}>{c.podePublicar ? status.rotulo : 'sem publicar'}</Chip>}
        {conta && !c && <Chip>não conectada</Chip>}
      </div>

      {aviso && (
        <p
          role="status"
          className={`rounded-lg border px-3 py-2 text-sm ${bomRetorno ? 'border-good/40 bg-good/10 text-good' : 'border-warn/40 bg-warn/10 text-warn'}`}
        >
          {TEXTO_DO_RETORNO[aviso] ?? TEXTO_DO_RETORNO.erro}
        </p>
      )}

      {falhou && <p className="text-xs text-muted">A conta de publicação não carregou.</p>}

      {c && (
        <div className="space-y-1 text-sm">
          <p className="break-words">
            <span className="font-medium">@{c.handle}</span>
            {c.expiraEm && <span className="text-muted"> · token vale até {dataCurta(c.expiraEm)}</span>}
          </p>
          <ul className="flex flex-wrap gap-1" aria-label="Escopos concedidos">
            {c.escopos.map((e) => (
              <li key={e} className="break-all rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                {e}
              </li>
            ))}
          </ul>
          {c.ultimoErro && <p className="break-words text-xs text-bad">{c.ultimoErro}</p>}
        </div>
      )}

      {conta && !conta.credencialConfigurada && (
        <p className="text-xs text-warn">Falta a credencial do app do Instagram. Cadastre em Bio › Conexões.</p>
      )}

      <p className="text-xs text-muted">
        Publicar na conta da própria Root não passa por App Review; a conta precisa ter papel no app.
      </p>

      {podeConectar && conta && (
        <Botao tone={c?.podePublicar ? 'default' : 'brand'} onClick={conectar} disabled={indo || !conta.credencialConfigurada}>
          {indo ? 'Abrindo a Meta…' : c ? 'Reconectar' : 'Conectar'}
        </Botao>
      )}
    </section>
  );
}
