'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Icons from 'lucide-react';
import {
  CORES_DO_TRABALHO, EMOJIS_DO_TRABALHO, ICONES_DO_TRABALHO, NOME_DA_COR_DO_TRABALHO,
  aparenciaDoTrabalho, ehEmojiCurto, ehIconeDoCatalogo, type CorDoTrabalho,
} from '@mktos/shared';

/*
 * O ÍCONE E A COR NA FRENTE DA LISTA E DA PASTA (produção 22B, I1, 22/10/2026).
 *
 * `IconeDaLista` desenha o que está gravado: um emoji ou um ícone do catálogo
 * (lucide, os mesmos do menu), na cor do tema escolhida. Sem ícone e sem cor,
 * não desenha nada, e a linha fica como era. Com só a cor, um ponto na cor.
 *
 * `DialogoDeIcone` é o seletor pequeno: emojis comuns (ou um colado no campo),
 * os ícones do catálogo e as cores do tema. Quem salva é quem chama (o PATCH
 * de renomear a lista ou a pasta, auditado do mesmo jeito).
 */

type IconName = keyof typeof Icons;

/** A classe de texto de cada token (escrita por extenso para o Tailwind achar). */
export const CLASSE_DA_COR: Record<CorDoTrabalho, string> = {
  brand: 'text-brand',
  'brand-2': 'text-brand-2',
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-info',
  mag: 'text-mag',
  muted: 'text-muted',
};
const FUNDO_DA_COR: Record<CorDoTrabalho, string> = {
  brand: 'bg-brand',
  'brand-2': 'bg-brand-2',
  good: 'bg-good',
  warn: 'bg-warn',
  bad: 'bg-bad',
  info: 'bg-info',
  mag: 'bg-mag',
  muted: 'bg-muted',
};

export function IconeDaLista({ icone, cor, tamanho = 13, className = '' }: {
  icone?: string | null; cor?: string | null; tamanho?: number; className?: string;
}) {
  const a = aparenciaDoTrabalho({ icone, cor });
  if (!a.icone && !a.cor) return null;
  const classeDaCor = a.cor ? CLASSE_DA_COR[a.cor] : 'text-muted';
  if (!a.icone) {
    return <span aria-hidden data-testid="icone-da-lista" data-cor={a.cor} className={`inline-block h-2 w-2 shrink-0 rounded-full ${a.cor ? FUNDO_DA_COR[a.cor] : ''} ${className}`} />;
  }
  if (ehIconeDoCatalogo(a.icone)) {
    const Icone = (Icons[a.icone as IconName] ?? Icons.Circle) as React.ElementType;
    return <Icone aria-hidden data-testid="icone-da-lista" data-icone={a.icone} size={tamanho} className={`shrink-0 ${classeDaCor} ${className}`} />;
  }
  return (
    <span aria-hidden data-testid="icone-da-lista" data-icone={a.icone} className={`inline-flex shrink-0 items-center leading-none ${classeDaCor} ${className}`} style={{ fontSize: tamanho }}>
      {a.icone}
    </span>
  );
}

const BOTAO = 'min-h-10 rounded-lg border px-3 text-sm disabled:opacity-50';

/** O seletor: escolhe ícone e cor e devolve os dois (null = sem). */
export function DialogoDeIcone({ titulo, inicial, aoSalvar, aoFechar }: {
  titulo: string;
  inicial: { icone?: string | null; cor?: string | null };
  /** Grava (o PATCH); a recusa volta como erro na própria caixa. */
  aoSalvar: (v: { icone: string | null; cor: CorDoTrabalho | null }) => Promise<void>;
  aoFechar: () => void;
}) {
  const atual = aparenciaDoTrabalho(inicial);
  const [icone, setIcone] = useState<string | null>(atual.icone);
  const [cor, setCor] = useState<CorDoTrabalho | null>(atual.cor);
  const [colado, setColado] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const salvar = () => {
    setOcupado(true); setErro(null);
    aoSalvar({ icone, cor })
      .then(aoFechar)
      .catch((e) => setErro((e as Error).message))
      .finally(() => setOcupado(false));
  };
  const escolha = (valor: string | null, rotulo: string, conteudo: React.ReactNode, testId: string) => (
    <button
      key={testId} type="button" data-testid={testId} aria-label={rotulo} title={rotulo} aria-pressed={icone === valor}
      onClick={() => { setIcone(valor); setErro(null); }}
      className={`grid h-9 w-9 place-items-center rounded-md border text-base ${icone === valor ? 'border-brand bg-brand/10' : 'border-border hover:bg-surface-2'}`}
    >
      {conteudo}
    </button>
  );
  return (
    <Dialog.Root open onOpenChange={(a) => { if (!a) aoFechar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          data-testid="dialogo-de-icone"
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 space-y-3 overflow-y-auto rounded-xl border border-border bg-surface p-4"
        >
          <div className="flex items-start justify-between gap-2">
            <Dialog.Title className="min-w-0 break-words text-base font-semibold">{titulo}</Dialog.Title>
            <Dialog.Close aria-label="Fechar" className="text-muted hover:text-text"><Icons.X size={16} /></Dialog.Close>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Agora:</span>
            {icone || cor ? <IconeDaLista icone={icone} cor={cor} tamanho={18} /> : <span className="text-muted">sem ícone</span>}
          </div>
          <fieldset className="space-y-1">
            <legend className="text-[12px] text-muted">Emoji</legend>
            <div className="flex flex-wrap gap-1">
              {escolha(null, 'Sem ícone', <Icons.Ban size={14} className="text-muted" />, 'icone-sem')}
              {EMOJIS_DO_TRABALHO.map((e) => escolha(e, `Emoji ${e}`, e, `icone-emoji-${e}`))}
            </div>
            <label className="mt-1 flex items-center gap-2 text-[12px] text-muted">
              Outro emoji
              <input
                data-testid="icone-colado" value={colado} maxLength={16} placeholder="cole aqui"
                onChange={(e) => {
                  const v = e.target.value.trim();
                  setColado(e.target.value);
                  if (!v) return;
                  if (ehEmojiCurto(v)) { setIcone(v); setErro(null); } else setErro('Cole um emoji só.');
                }}
                className="w-24 rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none focus:border-brand-dim"
              />
            </label>
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="text-[12px] text-muted">Ícone</legend>
            <div className="flex flex-wrap gap-1">
              {ICONES_DO_TRABALHO.map((nome) => {
                const Icone = (Icons[nome as IconName] ?? Icons.Circle) as React.ElementType;
                return escolha(nome, `Ícone ${nome}`, <Icone size={15} className={cor ? CLASSE_DA_COR[cor] : 'text-text'} />, `icone-catalogo-${nome}`);
              })}
            </div>
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="text-[12px] text-muted">Cor</legend>
            <div className="flex flex-wrap gap-1">
              <button
                type="button" data-testid="cor-sem" aria-pressed={cor === null} onClick={() => setCor(null)}
                className={`min-h-9 rounded-md border px-2 text-[12px] ${cor === null ? 'border-brand bg-brand/10' : 'border-border hover:bg-surface-2'}`}
              >
                Sem cor
              </button>
              {CORES_DO_TRABALHO.map((c) => (
                <button
                  key={c} type="button" data-testid={`cor-${c}`} aria-pressed={cor === c} aria-label={NOME_DA_COR_DO_TRABALHO[c]} title={NOME_DA_COR_DO_TRABALHO[c]}
                  onClick={() => setCor(c)}
                  className={`grid h-9 w-9 place-items-center rounded-md border ${cor === c ? 'border-brand bg-brand/10' : 'border-border hover:bg-surface-2'}`}
                >
                  <span aria-hidden className={`h-4 w-4 rounded-full ${FUNDO_DA_COR[c]}`} />
                </button>
              ))}
            </div>
          </fieldset>
          {erro && <p role="alert" className="text-sm text-bad">{erro}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Dialog.Close className={`${BOTAO} border-border text-muted`}>Cancelar</Dialog.Close>
            <button type="button" data-testid="icone-salvar" disabled={ocupado} onClick={salvar} className={`${BOTAO} border-brand-dim text-brand`}>
              {ocupado ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
