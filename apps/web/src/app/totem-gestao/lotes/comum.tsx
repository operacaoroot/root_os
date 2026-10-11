'use client';

import { useEffect, useState } from 'react';
import type {
  TotemLojaDoLote,
  TotemProdutoDoLote,
  TotemSituacaoValidade,
  TotemStatusRemessa,
} from '@mktos/shared';
import { apiGet } from '@/lib/api';
import { Chip } from '../../referencias/ui';

/*
 * Peças das telas de lote, remessa, reposição e etiqueta do painel do totem
 * (frente C). As quatro leem as mesmas lojas do escopo e os mesmos produtos.
 */

export function mensagemDoErro(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'A operação falhou. Tente de novo.';
}

export function useCadastrosDoLote(token: string | null) {
  const [lojas, setLojas] = useState<TotemLojaDoLote[]>([]);
  const [produtos, setProdutos] = useState<TotemProdutoDoLote[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      apiGet<TotemLojaDoLote[]>('/totem-lotes/lojas', token),
      apiGet<TotemProdutoDoLote[]>('/totem-lotes/produtos', token),
    ])
      .then(([l, p]) => {
        setLojas(l);
        setProdutos(p);
      })
      .catch((e: unknown) => setErro(mensagemDoErro(e)));
  }, [token]);

  return { lojas, produtos, erro };
}

const instante = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** `DD/MM/AAAA HH:mm` de um instante ISO, no horário de Brasília. */
export function dataHoraBR(iso: string): string {
  return instante.format(new Date(iso));
}

export function ChipDaValidade({ situacao }: { situacao: TotemSituacaoValidade }) {
  if (situacao === 'vencido') return <Chip tone="bad">Vencido</Chip>;
  if (situacao === 'atencao') return <Chip tone="warn">Vence em até 15 dias</Chip>;
  return <Chip tone="good">No prazo</Chip>;
}

export function ChipDaRemessa({ status }: { status: TotemStatusRemessa }) {
  if (status === 'recebida') return <Chip tone="good">Recebida</Chip>;
  if (status === 'cancelada') return <Chip tone="muted">Cancelada</Chip>;
  return <Chip tone="warn">Enviada</Chip>;
}
