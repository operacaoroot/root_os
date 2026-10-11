'use client';

import { useEffect, useState } from 'react';
import { TextoDaPolitica } from './TextoDaPolitica';
import { buscarPolitica, credencialDaPagina, lerTokenGuardado, type PoliticaNaTela } from './buscar-politica';

/**
 * A política vista no navegador. A busca roda aqui, no aparelho de quem lê,
 * e não no servidor da página: o limite por hora da API conta por endereço de
 * origem, e uma busca feita pelo servidor poria todos os leitores na mesma conta.
 */
export function ConteudoDaPrivacidade({ etiqueta }: { etiqueta: string | null }) {
  const [tela, setTela] = useState<PoliticaNaTela | null>(null);

  useEffect(() => {
    let vivo = true;
    void buscarPolitica(credencialDaPagina(etiqueta, lerTokenGuardado())).then((r) => {
      if (vivo) setTela(r);
    });
    return () => {
      vivo = false;
    };
  }, [etiqueta]);

  if (!tela) {
    return (
      <p className="text-base" role="status">
        Carregando a política de privacidade.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {tela.fonte === 'base' && tela.politica.camposAConfirmar.length > 0 && (
        <p className="rounded-lg border border-[#28371D]/25 px-4 py-3 text-sm opacity-80" role="note">
          Os dados da empresa aparecem como (a confirmar) porque a página não conseguiu buscá-los agora. Abra a
          política pelo totem ou pelo QR da etiqueta, com internet, para ver o texto completo.
        </p>
      )}
      <TextoDaPolitica politica={tela.politica} />
    </div>
  );
}
