'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * OS MÓDULOS CONTRATADOS PELA EMPRESA — RF-T-06.
 *
 * `bio`, `pauta`, `financeiro`, `leads` e o resto são produto INTERNO da ROOT.
 * Um tenant cliente não pode ver nem a navegação do que não contratou.
 *
 * QUEM DE FATO RECUSA É A API. Este provedor não é segurança: é cortesia. O
 * gate de verdade mora em `apps/api/src/tenants/` e responde 404 na rota do
 * módulo desligado, independentemente do que esta tela ache. O papel daqui é
 * não mostrar porta que não abre.
 *
 * POR QUE "NÃO SEI" SIGNIFICA "MOSTRA TUDO"
 * Enquanto a resposta não chega — e se ela FALHAR —, `modulos` fica `null` e
 * tudo continua visível. É a direção segura para esta metade do problema: o
 * risco de mostrar por um instante um item que vai sumir é uma piscada; o risco
 * de esconder por falta de resposta é a pessoa perder acesso à tela que ela tem
 * e não descobrir por quê. "Nenhuma rota fica inalcançável por engano" é
 * critério da fatia, e é esta linha que o cumpre no web.
 */

export interface ModulosContextValue {
  /** `null` = ainda não sei (carregando, ou a chamada falhou). */
  modulos: string[] | null;
  /** O catálogo inteiro, para a tela poder dizer o que existe e está de fora. */
  catalogo: string[] | null;
  /** O módulo está ligado? `true` enquanto não se sabe — ver o cabeçalho. */
  ligado: (modulo: string | null | undefined) => boolean;
}

const ModulosContext = createContext<ModulosContextValue | null>(null);

const VAZIO: ModulosContextValue = {
  modulos: null,
  catalogo: null,
  ligado: () => true,
};

interface Resposta {
  modulos: string[];
  catalogo: string[];
}

export function ModulosProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [estado, setEstado] = useState<{ modulos: string[] | null; catalogo: string[] | null }>({
    modulos: null,
    catalogo: null,
  });

  useEffect(() => {
    if (!token) {
      setEstado({ modulos: null, catalogo: null });
      return;
    }
    let vivo = true;
    apiGet<Resposta>('/tenants/modulos', token)
      .then((r) => {
        if (!vivo) return;
        setEstado({
          modulos: Array.isArray(r.modulos) ? r.modulos : null,
          catalogo: Array.isArray(r.catalogo) ? r.catalogo : null,
        });
      })
      .catch(() => {
        // API velha, rede caída, sessão expirando: fica no "não sei", que
        // mostra tudo. A API continua recusando o que tiver de recusar.
        if (vivo) setEstado({ modulos: null, catalogo: null });
      });
    return () => {
      vivo = false;
    };
  }, [token]);

  const valor: ModulosContextValue = {
    modulos: estado.modulos,
    catalogo: estado.catalogo,
    ligado: (modulo) => {
      if (!modulo) return true; // espinha do OS: não desliga
      if (estado.modulos === null) return true; // ainda não sei
      return estado.modulos.includes(modulo);
    },
  };

  return <ModulosContext.Provider value={valor}>{children}</ModulosContext.Provider>;
}

/**
 * Fora do provedor devolve o estado "não sei" em vez de lançar — ao contrário
 * do `useAuth`. É de propósito: a `Sidebar` e a `Paleta` também aparecem em
 * teste e em página que não monta a casca inteira, e derrubar a árvore por
 * causa de um filtro cosmético seria trocar um item a mais no menu por uma tela
 * branca.
 */
export function useModulos(): ModulosContextValue {
  return useContext(ModulosContext) ?? VAZIO;
}
