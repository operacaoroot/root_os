'use client';

import { useLayoutEffect, useMemo, useState } from 'react';
import { apiGet } from './api';

type Resposta<T> = { dados: T; erro?: never } | { dados?: never; erro: string };

export function useConsultaPorEscopo<T>(path: string, token: string, revisao = 0) {
  const consulta = useMemo(() => ({ path, token, revisao }), [path, token, revisao]);
  const [resultado, setResultado] = useState<{ consulta: typeof consulta; resposta: Resposta<T> }>();

  useLayoutEffect(() => {
    const controle = new AbortController();
    apiGet<T>(consulta.path, consulta.token, controle.signal)
      .then((dados) => {
        if (!controle.signal.aborted) setResultado({ consulta, resposta: { dados } });
      })
      .catch((e: Error) => {
        if (!controle.signal.aborted) setResultado({ consulta, resposta: { erro: e.message } });
      });
    return () => controle.abort();
  }, [consulta]);

  return resultado?.consulta === consulta ? resultado.resposta : undefined;
}
