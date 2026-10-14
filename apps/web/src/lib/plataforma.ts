'use client';

import { useEffect, useState } from 'react';
import { ErroDaApi, apiGet } from './api';
import { useAuth } from './auth';

/*
 * A sessão é da plataforma (a própria ROOT)?
 *
 * Quem decide é a API: GET /tenants/plataforma/quem-sou responde 200 só para a
 * sessão da plataforma e 403 para qualquer empresa cliente. O menu usa isto para
 * mostrar as telas da ROOT (Propostas e Operação), que não cabem no NAV porque o NAV
 * é filtrado por permissão, e permissão toda empresa cliente também tem.
 *
 * Esconder no menu é desenho; quem recusa o acesso continua sendo a API. Na
 * dúvida (sem token, erro de rede) a resposta é false: tela da ROOT não aparece
 * para cliente por causa de uma falha. A resposta fica guardada por token, para
 * o menu não perguntar de novo a cada troca de tela.
 */
const respostas = new Map<string, boolean>();

export function useEhPlataforma(): boolean {
  const { token } = useAuth();
  const [eh, setEh] = useState(() => (token ? respostas.get(token) ?? false : false));

  useEffect(() => {
    if (!token) {
      setEh(false);
      return;
    }
    const sabida = respostas.get(token);
    if (sabida !== undefined) {
      setEh(sabida);
      return;
    }
    let vivo = true;
    apiGet<{ plataforma: true }>('/tenants/plataforma/quem-sou', token)
      .then(() => {
        respostas.set(token, true);
        if (vivo) setEh(true);
      })
      .catch((e) => {
        // Só o 403 é resposta definitiva; erro de rede pode ser perguntado de novo.
        if (e instanceof ErroDaApi && e.status === 403) respostas.set(token, false);
        if (vivo) setEh(false);
      });
    return () => {
      vivo = false;
    };
  }, [token]);

  return eh;
}
