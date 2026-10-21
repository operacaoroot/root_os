'use client';

import { useState } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { ForaDoPadraoDaAgenda, ItemForaDoPadrao } from '@mktos/shared';

import { apiPost } from '@/lib/api';
import { Botao, Card, Chip, inputCls } from '../referencias/ui';
import { acaoDoItem, mensagemDoPedido, origemDaProposta, rotuloDaProposta, situacaoDoItem, textoDoSelo } from './fora-do-padrao';
import { FUSO_DA_AGENDA } from './semana';

/*
 * O VIGIA DA AGENDA NA TELA (AG-01): o selo "N fora do padrão" e a lista com a
 * proposta de cada reunião. "Aprovar aqui" leva à MESMA porta
 * (`agenda.evento.padronizar`, R3): o clique abre ou cria a aprovação, e a
 * correção só acontece quando alguém com alçada confirma em `/atendimento`.
 * A pendência ("qual é o cliente?") se responde aqui mesmo, pela rota das
 * pendências — a resposta também vai à fila.
 */

/** O selo do topo da tela. Não desenha nada quando não sabe ou quando é zero. */
export function SeloForaDoPadrao({ dados }: { dados: ForaDoPadraoDaAgenda | null }) {
  const texto = textoDoSelo(dados);
  if (!texto) return null;
  return (
    <a href="#fora-do-padrao" title="Reuniões que o vigia da agenda achou fora do padrão, de ontem a 60 dias" data-selo-fora-do-padrao="">
      <Chip tone="warn">
        <span className="inline-flex items-center gap-1"><AlertTriangle size={11} /> {texto}</span>
      </Chip>
    </a>
  );
}

const quando = (iso: string | null): string => {
  if (!iso) return 'sem data';
  if (/^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(iso)) {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  }
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: FUSO_DA_AGENDA });
};

function Linha({
  item,
  token,
  podeEditar,
  aoMudar,
}: {
  item: ItemForaDoPadrao;
  token: string | null;
  podeEditar: boolean;
  aoMudar: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const acao = acaoDoItem(item, podeEditar);
  const proposta = rotuloDaProposta(item);
  const origem = origemDaProposta(item);

  const pedir = () => {
    setEnviando(true);
    setErro(null);
    apiPost<{ status?: string; jaNaFila?: boolean; precisaDeOutraPessoa?: boolean }>(`/agenda/padronizar/${encodeURIComponent(item.eventoId)}`, {}, token)
      .then((r) => { setAviso(mensagemDoPedido(r)); aoMudar(); })
      .catch((e) => setErro(e.message))
      .finally(() => setEnviando(false));
  };

  const responder = (escolha: string, complemento?: string) => {
    if (!item.pendencia) return;
    setEnviando(true);
    setErro(null);
    apiPost(`/pendencias/${encodeURIComponent(item.pendencia.id)}/responder`, { escolha, ...(complemento ? { complemento } : {}) }, token)
      .then(() => {
        setAviso(
          escolha === 'nao-e-reuniao'
            ? 'Anotado: não é reunião. O vigia não pergunta mais por este evento.'
            : 'A correção foi para a fila de aprovações e espera a confirmação de OUTRA pessoa com alçada.',
        );
        aoMudar();
      })
      .catch((e) => setErro(e.message))
      .finally(() => setEnviando(false));
  };

  return (
    <li className="space-y-2 py-3" data-item-fora-do-padrao={item.eventoId}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-os-mono text-xs text-muted">{quando(item.inicio)}</span>
        <span className="font-os-mono text-warn" title="título de hoje">{item.tituloAtual || '(sem título)'}</span>
        {proposta && (
          <>
            <ArrowRight size={13} className="text-muted" aria-label="vira" />
            <span className="font-os-mono text-text" data-proposta="">{proposta}</span>
          </>
        )}
      </div>
      {item.problemas.length > 0 && <p className="text-xs text-muted">Fora do padrão: {item.problemas.join('; ')}.</p>}
      <p className="text-xs text-muted">
        {situacaoDoItem(item)}
        {origem ? ` Proposta ${origem}.` : ''}
      </p>

      {acao.tipo === 'pedir' && (
        <Botao tone="brand" onClick={pedir} disabled={enviando}>{enviando ? 'Enviando…' : acao.rotulo}</Botao>
      )}
      {acao.tipo === 'fila' && (
        <a href={acao.href} className="inline-block rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm hover:border-brand-dim">
          {acao.rotulo}
        </a>
      )}
      {acao.tipo === 'responder' && item.pendencia && (
        <div className="flex flex-wrap items-center gap-2">
          {item.pendencia.opcoes.map((o) =>
            o.pedeNome ? (
              <span key={o.chave} className="inline-flex items-center gap-1">
                <input
                  className={`${inputCls} w-44`}
                  placeholder="nome do cliente"
                  value={nome}
                  onChange={(ev) => setNome(ev.target.value)}
                  aria-label={o.rotulo}
                />
                <Botao onClick={() => responder(o.chave, nome.trim())} disabled={enviando || !nome.trim()} title={o.rotulo}>
                  {o.rotulo.replace(/\s*\(.*\)\s*$/, '')}
                </Botao>
              </span>
            ) : (
              <Botao key={o.chave} tone={o.chave === 'nao-e-reuniao' ? 'ghost' : 'default'} onClick={() => responder(o.chave)} disabled={enviando}>
                {o.rotulo}
              </Botao>
            ),
          )}
        </div>
      )}
      {acao.tipo === 'nenhuma' && podeEditar === false && item.estado === 'proposta' && <p className="text-[11px] text-muted">({acao.motivo})</p>}
      {aviso && <p className="text-xs text-good" role="status">{aviso}</p>}
      {erro && <p className="text-xs text-bad" role="alert">{erro}</p>}
    </li>
  );
}

/** A lista do vigia. Some quando não há nada fora do padrão. */
export function ListaForaDoPadrao({
  dados,
  erro,
  token,
  podeEditar,
  aoMudar,
}: {
  dados: ForaDoPadraoDaAgenda | null;
  erro: string | null;
  token: string | null;
  podeEditar: boolean;
  aoMudar: () => void;
}) {
  if (erro) {
    return (
      <p className="text-xs text-muted" role="status">
        O vigia da agenda não respondeu agora: {erro}
      </p>
    );
  }
  if (!dados || !Array.isArray(dados.itens) || dados.itens.length === 0) return null;
  return (
    <div id="fora-do-padrao">
      <Card titulo={`Fora do padrão · ${dados.total}`}>
        <p className="mb-2 text-xs text-muted">
          O vigia da agenda confere as reuniões de ontem a 60 dias e propõe o título no padrão. A correção só troca o
          título e acrescenta o Meet na reunião online; o título antigo fica na descrição. Nada muda na agenda sem a
          confirmação na fila de aprovações.
          {dados.ultimaPassagemEm ? ` Última passagem com mudança: ${quando(dados.ultimaPassagemEm)}.` : ''}
        </p>
        <ul className="divide-y divide-border">
          {dados.itens.map((i) => (
            <Linha key={i.eventoId} item={i} token={token} podeEditar={podeEditar} aoMudar={aoMudar} />
          ))}
        </ul>
      </Card>
    </div>
  );
}
