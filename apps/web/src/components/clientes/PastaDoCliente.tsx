'use client';

import { useState } from 'react';

import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/*
 * "ABRIR PASTA DO CLIENTE" (rodada dos agentes, 21/10/2026, Lane 0).
 *
 * Um componente só para o card da Implantação, a ficha do comercial e a tela do
 * cliente. Com o ponteiro (`Partner.pastaDriveUrl`), é o link para o Drive; sem
 * ele, "Criar pasta" chama `POST /clientes/:id/pasta` (a lane do Drive), que vai
 * à porta (`drive.pasta.criar`, R3): a resposta pode ser a pasta pronta ou
 * "aguardando aprovação", e a tela diz qual. O erro do Drive aparece com o
 * motivo e o botão vira "Criar pasta de novo".
 */

interface RespostaDaPasta {
  estado: 'pronta' | 'aguardando_aprovacao' | 'sem_raiz' | 'erro';
  url?: string;
  motivo?: string;
  approvalId?: string;
}

export function PastaDoCliente({
  partnerId,
  url,
  erro: erroInicial,
  compacto = false,
}: {
  partnerId: string | null;
  url: string | null;
  /** O motivo da última tentativa que falhou, quando o servidor guardou. */
  erro?: string | null;
  compacto?: boolean;
}) {
  const { token, can } = useAuth();
  const [link, setLink] = useState<string | null>(url);
  const [aviso, setAviso] = useState<string | null>(erroInicial ? `A pasta não foi criada: ${erroInicial}` : null);
  const [falhou, setFalhou] = useState<boolean>(Boolean(erroInicial));
  const [enviando, setEnviando] = useState(false);

  if (link) {
    return (
      <a
        href={link}
        target="_blank"
        rel="noreferrer noopener"
        className={`inline-flex items-center gap-1 text-xs text-brand hover:underline ${compacto ? '' : 'font-medium'}`}
      >
        Abrir pasta do cliente
      </a>
    );
  }
  if (!partnerId) return <span className="text-xs text-muted">Sem cliente ligado: a pasta nasce com o cliente.</span>;

  const criar = async () => {
    setEnviando(true);
    setAviso(null);
    try {
      const r = await apiPost<RespostaDaPasta>(`/clientes/${encodeURIComponent(partnerId)}/pasta`, {}, token);
      if (r.estado === 'pronta' && r.url) {
        setLink(r.url);
        setFalhou(false);
      } else if (r.estado === 'aguardando_aprovacao') {
        setAviso('Pedido de criação da pasta enviado: espera a liberação em Aprovações.');
        setFalhou(false);
      } else {
        setAviso(r.motivo ?? 'A pasta não foi criada.');
        setFalhou(true);
      }
    } catch (e) {
      setAviso((e as Error).message);
      setFalhou(true);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {can('tarefas.editar') && (
        <button type="button" onClick={criar} disabled={enviando} className="text-xs text-brand hover:underline disabled:opacity-50">
          {enviando ? 'Criando…' : falhou ? 'Criar pasta de novo' : 'Criar pasta do cliente'}
        </button>
      )}
      {aviso && <span className="text-xs text-muted" role="status">{aviso}</span>}
    </span>
  );
}
