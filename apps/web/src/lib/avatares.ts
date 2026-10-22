'use client';

import { useEffect, useState } from 'react';
import type { AvatarDaEmpresa, AvataresDaEmpresa } from '@mktos/shared';
import { apiBlob, apiGet } from '@/lib/api';

/*
 * OS AVATARES DA EMPRESA (produção 22B, I6).
 *
 * Uma leitura só de `GET /perfil/pessoas` por sessão de página, partilhada por
 * todo avatar da tela: quem desenha o responsável de um cartão passa o id e o
 * nome, e o avatar acha a foto aqui. A foto vem pela rota autenticada (o token
 * no cabeçalho, como toda imagem do OS) e vira URL de blob, guardada por
 * endereço: a rota leva a versão (`?v=`), então foto nova é endereço novo.
 *
 * `esquecerAvatares()` limpa a lista (o perfil chama depois de trocar a foto).
 */

let lista: { token: string; promessa: Promise<AvatarDaEmpresa[]> } | null = null;
const fotos = new Map<string, Promise<string | null>>();
const ouvintes = new Set<() => void>();

export function esquecerAvatares(): void {
  lista = null;
  for (const o of ouvintes) o();
}

function carregarLista(token: string): Promise<AvatarDaEmpresa[]> {
  if (!lista || lista.token !== token) {
    const promessa = apiGet<AvataresDaEmpresa>('/perfil/pessoas', token)
      .then((r) => r.pessoas)
      .catch(() => {
        // Falhou (sem permissão, API fora): as telas seguem com as iniciais.
        if (lista?.promessa === promessa) lista = null;
        return [] as AvatarDaEmpresa[];
      });
    lista = { token, promessa };
  }
  return lista.promessa;
}

/** As pessoas da empresa com a rota da foto e o aniversário (dia e mês). */
export function useAvatares(token: string | null | undefined): AvatarDaEmpresa[] | null {
  const [pessoas, setPessoas] = useState<AvatarDaEmpresa[] | null>(null);
  const [geracao, setGeracao] = useState(0);
  useEffect(() => {
    const ouvir = () => setGeracao((g) => g + 1);
    ouvintes.add(ouvir);
    return () => {
      ouvintes.delete(ouvir);
    };
  }, []);
  useEffect(() => {
    if (!token) return;
    let vivo = true;
    void carregarLista(token).then((p) => vivo && setPessoas(p));
    return () => {
      vivo = false;
    };
  }, [token, geracao]);
  return pessoas;
}

/** A URL de blob da foto (ou nulo enquanto carrega ou se falhar). */
export function useFoto(rota: string | null | undefined, token: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!rota || !token || typeof URL.createObjectURL !== 'function') {
      setUrl(null);
      return;
    }
    let vivo = true;
    let promessa = fotos.get(rota);
    if (!promessa) {
      promessa = apiBlob(rota, token)
        .then((b) => URL.createObjectURL(b))
        .catch(() => {
          fotos.delete(rota);
          return null;
        });
      fotos.set(rota, promessa);
    }
    void promessa.then((u) => vivo && setUrl(u));
    return () => {
      vivo = false;
    };
  }, [rota, token]);
  return url;
}
