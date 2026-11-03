'use client';

/*
 * QUEM ASSINA. Lista com o estado em palavra; antes do envio, edição da lista inteira
 * (`PUT .../signatarios`). Assinatura conjunta é mais uma linha do cliente. O contrato
 * da Root não leva testemunha.
 */
import { useState } from 'react';
import { SignatariosSchema, type ContratoNaFicha, type SignatarioNovoDoContrato } from '@mktos/shared';

import { apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';

import { BOTAO, BOTAO_PRIMARIO, CARTAO, Chip, INPUT, Rotulo } from '../_ui';
import { RetornoDaAcao, useAcaoDoContrato } from './acao';
import { CAMINHO_DO_REGISTRO, dataCompleta } from './regras';

const ROTULO_DO_PAPEL = { cliente: 'cliente', root: 'pela Root' } as const;

export function SignatariosDoContrato({ c, passo, podeEditar, aoMudar }: { c: ContratoNaFicha; passo?: number; podeEditar: boolean; aoMudar: () => Promise<void> }) {
  const [editando, setEditando] = useState(false);
  const antesDoEnvio = c.estado === 'a_emitir' || c.estado === 'rascunho';
  return (
    <section className={`${CARTAO} space-y-2`} aria-label="quem assina" data-testid="contrato-signatarios">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Rotulo>{passo ? `passo ${passo} · quem assina` : 'quem assina'}</Rotulo>
        {podeEditar && antesDoEnvio && !editando && (
          <button type="button" data-testid="signatarios-editar" className={BOTAO} onClick={() => setEditando(true)}>Editar</button>
        )}
      </div>
      {editando ? (
        <EditorDeSignatarios c={c} aoFechar={() => setEditando(false)} aoMudar={aoMudar} />
      ) : c.signatarios.length === 0 ? (
        <p className="text-[12.5px] text-warn" data-testid="signatarios-vazio">Ninguém definido ainda. Sem quem assine pelos dois lados, o contrato não sai.</p>
      ) : (
        <ol className="divide-y divide-border">
          {[...c.signatarios].sort((a, b) => a.ordem - b.ordem).map((s, i) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-1.5 text-[12.5px]" data-testid={`signatario-${s.id}`}>
              <span className="font-os-mono text-[11px] text-dim">{i + 1}</span>
              <span className="min-w-0 flex-1">{s.nome} <span className="text-dim">· {ROTULO_DO_PAPEL[s.papel]} · {s.email}</span></span>
              {s.assinadoEm ? <Chip>assinou {dataCompleta(s.assinadoEm)}</Chip> : <Chip tom={c.estado === 'em_assinatura' ? 'alerta' : 'neutro'}>{c.estado === 'em_assinatura' ? 'pendente' : 'a assinar'}</Chip>}
            </li>
          ))}
        </ol>
      )}
      <p className="text-[11.5px] text-dim">Contrato social que pede assinatura conjunta: uma linha para cada administrador. O contrato da Root não leva testemunha.</p>
    </section>
  );
}

function fraseDoErro(issue: { message: string; path: (string | number)[] }): string {
  const campo = issue.path[2];
  if (campo === 'nome') return `Linha ${Number(issue.path[1]) + 1}: escreva o nome.`;
  if (campo === 'email') return `Linha ${Number(issue.path[1]) + 1}: o e-mail não parece certo.`;
  if (issue.path[0] === 'signatarios' && issue.path.length === 1) return 'O contrato precisa de ao menos um signatário do cliente e um da Root, e no máximo dez.';
  return issue.message;
}

function EditorDeSignatarios({ c, aoFechar, aoMudar }: { c: ContratoNaFicha; aoFechar: () => void; aoMudar: () => Promise<void> }) {
  const { token } = useAuth();
  const titulares = c.emissao?.titulares ?? [];
  const inicial: SignatarioNovoDoContrato[] = c.signatarios.length > 0
    ? [...c.signatarios].sort((a, b) => a.ordem - b.ordem).map((s) => ({ papel: s.papel, nome: s.nome, email: s.email }))
    : [{ papel: 'cliente', nome: '', email: '' }, { papel: 'root', nome: '', email: '' }];
  const [linhas, setLinhas] = useState<SignatarioNovoDoContrato[]>(inicial);
  const [sujo, setSujo] = useState(false);
  const acao = useAcaoDoContrato(aoMudar);
  const conferido = SignatariosSchema.safeParse({ signatarios: linhas });
  const problema = conferido.success ? null : fraseDoErro(conferido.error.issues[0]);
  // O que veio da API não é "texto não salvo": o painel só pergunta depois de a pessoa mexer.
  const ignorar = sujo ? {} : { 'data-painel-ignorar': '' };

  const mudar = (i: number, parte: Partial<SignatarioNovoDoContrato>) => {
    setSujo(true);
    setLinhas((l) => l.map((x, j) => (j === i ? { ...x, ...parte } : x)));
  };
  const salvar = async () => {
    if (!conferido.success) return;
    const valeu = await acao.rodar('salvar', () => apiPut(`${CAMINHO_DO_REGISTRO}/${encodeURIComponent(c.id)}/signatarios`, conferido.data, token));
    if (valeu) aoFechar();
  };

  return (
    <div className="space-y-2" data-testid="signatarios-editor">
      <ul className="space-y-2">
        {linhas.map((s, i) => (
          <li key={i} className="grid gap-1.5 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <select aria-label={`Lado do signatário ${i + 1}`} data-testid={`signatario-papel-${i}`} className={`${INPUT} max-md:min-h-[44px]`} value={s.papel} onChange={(e) => mudar(i, { papel: e.target.value as SignatarioNovoDoContrato['papel'] })}>
              <option value="cliente">Cliente</option>
              <option value="root">Pela Root</option>
            </select>
            <input aria-label={`Nome do signatário ${i + 1}`} data-testid={`signatario-nome-${i}`} placeholder="Nome" maxLength={200} className={`${INPUT} max-md:min-h-[44px]`} value={s.nome} onChange={(e) => mudar(i, { nome: e.target.value })} {...ignorar} />
            <input aria-label={`E-mail do signatário ${i + 1}`} data-testid={`signatario-email-${i}`} type="email" placeholder="E-mail" maxLength={254} className={`${INPUT} max-md:min-h-[44px]`} value={s.email} onChange={(e) => mudar(i, { email: e.target.value })} {...ignorar} />
            <button type="button" aria-label={`Tirar o signatário ${i + 1}`} className={BOTAO} onClick={() => { setSujo(true); setLinhas((l) => l.filter((_, j) => j !== i)); }}>Tirar</button>
            {s.papel === 'root' && titulares.length > 0 && (
              <select
                aria-label={`Escolher quem assina pela Root na linha ${i + 1}`}
                data-testid={`signatario-titular-${i}`}
                className={`${INPUT} sm:col-span-4 max-md:min-h-[44px]`}
                value={titulares.some((t) => t.email === s.email) ? s.email : ''}
                onChange={(e) => {
                  const t = titulares.find((x) => x.email === e.target.value);
                  if (t) mudar(i, { nome: t.nome, email: t.email });
                }}
              >
                <option value="">Escolher entre os titulares</option>
                {titulares.map((t) => <option key={t.email} value={t.email}>{t.nome} · {t.email}</option>)}
              </select>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="signatario-mais-cliente" className={BOTAO} disabled={linhas.length >= 10} onClick={() => { setSujo(true); setLinhas((l) => [...l, { papel: 'cliente', nome: '', email: '' }]); }}>+ do cliente</button>
        <button type="button" data-testid="signatario-mais-root" className={BOTAO} disabled={linhas.length >= 10} onClick={() => { setSujo(true); setLinhas((l) => [...l, { papel: 'root', nome: '', email: '' }]); }}>+ pela Root</button>
      </div>
      {problema && <p className="text-[12px] text-warn" data-testid="signatarios-problema">{problema}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="signatarios-salvar" className={BOTAO_PRIMARIO} disabled={!conferido.success || acao.ocupado !== null} onClick={() => void salvar()}>Salvar quem assina</button>
        <button type="button" className={BOTAO} onClick={aoFechar}>Voltar</button>
      </div>
      <RetornoDaAcao acao={acao} testId="signatarios-retido" />
    </div>
  );
}
