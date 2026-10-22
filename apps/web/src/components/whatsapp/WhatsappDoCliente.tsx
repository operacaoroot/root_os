'use client';

import { useCallback, useEffect, useState } from 'react';
import type { WhatsappDaFicha } from '@mktos/shared';

import { ErroDaApi, apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

import { ConversasLigadas, TelefoneEditavel } from './ConversasLigadas';

/*
 * O BLOCO "WHATSAPP" DA FICHA DO CLIENTE (produção 22C, W3): o grupo (ou o
 * 1:1) ligado ao cliente, as últimas mensagens e o link para a caixa, e o
 * telefone do cliente (`Partner.phone`), editável por quem tem `leads.editar`.
 * Quem não vê leads não vê o bloco (a caixa é do módulo comercial).
 */
export function WhatsappDoCliente({ clienteId }: { clienteId: string }) {
  const { token } = useAuth();
  const [dados, setDados] = useState<WhatsappDaFicha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [escondido, setEscondido] = useState(false);
  const caminho = `/whatsapp/vinculos/cliente/${encodeURIComponent(clienteId)}`;

  const carregar = useCallback(async () => {
    if (!token) return;
    try {
      setDados(await apiGet<WhatsappDaFicha>(caminho, token));
      setErro(null);
    } catch (e) {
      // Sem permissão ou sem o módulo: o bloco não aparece (a ficha segue inteira).
      if (e instanceof ErroDaApi && (e.status === 403 || e.status === 404)) setEscondido(true);
      else setErro((e as Error).message);
    }
  }, [caminho, token]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (escondido) return null;
  return (
    <section className="rounded-md border border-border bg-surface px-5 py-4" aria-label="WhatsApp do cliente" data-testid="ficha-whatsapp">
      <h2 className="text-[1.05rem] font-semibold">WhatsApp</h2>
      <div className="mt-3 space-y-3">
        {erro && (
          <p role="alert" className="text-[12.5px] text-bad">
            {erro}
          </p>
        )}
        {dados ? (
          <>
            <TelefoneEditavel
              caminho={`${caminho}/telefone`}
              telefone={dados.telefone}
              podeEditar={dados.podeEditar}
              testId="ficha-whatsapp-telefone"
              convite="Com o telefone do cliente, a conversa 1:1 com ele liga sozinha. O grupo se liga pela caixa de WhatsApp."
              aoSalvar={carregar}
            />
            <ConversasLigadas
              conversas={dados.conversas}
              ultimas={dados.ultimas}
              vazio={<span data-testid="ficha-whatsapp-vazio">Nenhuma conversa de WhatsApp ligada a este cliente. Ligue o grupo pela caixa de WhatsApp.</span>}
            />
          </>
        ) : !erro ? (
          <p className="text-[12.5px] text-muted">carregando…</p>
        ) : null}
      </div>
    </section>
  );
}
