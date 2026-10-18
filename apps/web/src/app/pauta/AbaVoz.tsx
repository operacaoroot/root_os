'use client';

import { useEffect, useState } from 'react';
import {
  PAUTA_PISO_DO_PERFIL_DE_VOZ,
  PAUTA_PISO_DO_TEXTO_DA_VOZ,
  PAUTA_TETO_DE_EPISODIOS_DA_VOZ,
  PAUTA_TETO_DE_TEXTOS_DA_VOZ,
  PAUTA_TETO_DO_PERFIL_DE_VOZ,
  PAUTA_TETO_DO_TEXTO_DA_VOZ,
  PAUTA_TETO_DA_CHAVE_DA_VOZ,
  PAUTA_TETO_DOS_TEXTOS_DA_VOZ,
  PAUTA_CHAVE_DA_CHAVE_DA_VOZ, PautaChaveDaVozSchema, PautaVozHumanoPainelSchema, PautaVozSalvarHumanoSchema, PautaVozChaveHumanaSchema,
  palavrasProibidasEm,
  type PautaVozAprendida,
} from '@mktos/shared';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useEdicaoHumana, ConferenciaEdicaoHumana } from './InterruptorDaAutomacao';
import { Botao, inputCls } from '../referencias/ui';
import { RoteiroMarkdown } from './roteiro-markdown';

/*
 * A VOZ DO AUTOR (MC10). O perfil é uma nota da memória: cada perfil aprendido
 * ou editado à mão vira versão nova, e as anteriores ficam no histórico. O
 * roteiro e as peças escrevem com ele; sem ele, no tom da casa.
 */

interface Props {
  token: string | null;
  editavel: boolean;
  /** Aprender gasta IA: exige `automacoes.executar`, como gerar o roteiro. */
  podeGastarIa: boolean;
  bump: number;
  onErro: (m: string | null) => void;
}

const MUDANCA: Record<string, string> = {
  criacao: 'criado',
  alteracao: 'nova versão',
  arquivamento: 'arquivado',
  restauracao: 'restaurado',
};

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const mil = (n: number) => n.toLocaleString('pt-BR');

/** O que o perfil ENSINA: tudo antes do "Nunca diz", onde a palavra proibida é o certo. */
const ensinado = (t: string) => {
  const i = t.search(/^##\s*Nunca diz/im);
  return i >= 0 ? t.slice(0, i) : t;
};

export function AbaVoz(props: Props) {
  const { user } = useAuth();
  return <VozDaSessao key={`${props.token ?? ''}|${user?.id ?? ''}|${user?.permissions.join(',') ?? ''}`} {...props} />;
}
function VozDaSessao({ token, editavel, podeGastarIa, bump, onErro }: Props) {
  const perfilEditor = useEdicaoHumana({ token, path: '/pauta/voz', schema: PautaVozHumanoPainelSchema,
    destino: p => p.destinos.perfil, texto: p => p.destinos.perfil.estado === 'existente' ? p.destinos.perfil.conteudo.corpo : '',
    conferir: p => p.destinos.perfil.chave === p.configuracao.chaveEfetiva && p.painel.chave === p.configuracao.chaveEfetiva && p.destinos.configuracao.chave === PAUTA_CHAVE_DA_CHAVE_DA_VOZ });
  const chaveEditor = useEdicaoHumana({ token, path: '/pauta/voz', schema: PautaVozHumanoPainelSchema,
    destino: p => p.destinos.configuracao, texto: p => p.configuracao.chaveEfetiva,
    conferir: p => p.destinos.perfil.chave === p.configuracao.chaveEfetiva && p.painel.chave === p.configuracao.chaveEfetiva && p.destinos.configuracao.chave === PAUTA_CHAVE_DA_CHAVE_DA_VOZ });
  const [aviso, setAviso] = useState<string | null>(null);
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [textos, setTextos] = useState<string[]>(['']);
  const [editando, setEditando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const rascunho = perfilEditor.texto, chave = chaveEditor.texto;
  const mesmaEmpresa = perfilEditor.atual?.escopo.orgId === chaveEditor.atual?.escopo.orgId && perfilEditor.atual?.escopo.actorId === chaveEditor.atual?.escopo.actorId;
  const painel = perfilEditor.visivel && chaveEditor.visivel && mesmaEmpresa ? perfilEditor.atual?.painel ?? null : null;
  useEffect(() => { if (bump) { void perfilEditor.conferir(); void chaveEditor.conferir(); } }, [bump]);
  if (!painel) return <div className="space-y-3"><ConferenciaEdicaoHumana editor={{ ...perfilEditor, destinoBase: null, destinoAtual: null, visivel: false, mensagem: perfilEditor.privado ? perfilEditor.mensagem : null }} /><ConferenciaEdicaoHumana editor={{ ...chaveEditor, destinoBase: null, destinoAtual: null, visivel: false, mensagem: chaveEditor.privado ? chaveEditor.mensagem : null }} /></div>;
  const escrevendo = perfilEditor.ocupado || chaveEditor.ocupado;
  const perfil = painel.perfil;
  const vigente = perfil && !perfil.arquivado ? perfil : null;
  const colados = textos.map((t) => t.trim()).filter(Boolean);
  const textoCurto = colados.some((t) => t.length < PAUTA_PISO_DO_TEXTO_DA_VOZ);
  const somaDosTextos = colados.reduce((n, t) => n + t.length, 0);
  const textosDemais = somaDosTextos > PAUTA_TETO_DOS_TEXTOS_DA_VOZ;
  const podeAprender = (escolhidos.length > 0 || colados.length > 0) && !textoCurto && !textosDemais;
  const semIa = !podeGastarIa
    ? 'Aprender gasta IA: precisa da permissão automacoes.executar.'
    : !painel.iaConfigurada
      ? 'A IA não está configurada nesta instalação.'
      : undefined;
  const proibidasNoRascunho = palavrasProibidasEm(ensinado(rascunho));
  const rascunhoValido =
    rascunho.trim().length >= PAUTA_PISO_DO_PERFIL_DE_VOZ && rascunho.trim().length <= PAUTA_TETO_DO_PERFIL_DE_VOZ;
  const chaveValida = PautaChaveDaVozSchema.safeParse(chave).success;

  const aprender = async () => {
    setOcupado('aprender'); setAviso(null); onErro(null);
    const r = await perfilEditor.executarExterno(() => apiPost<PautaVozAprendida>('/pauta/voz/aprender',
      { episodios: escolhidos, textos: colados.map(texto => ({ texto })) }, token));
    if (r) setAviso(`O aprendizado respondeu com perfil versão ${r.perfil?.versao ?? '?'}. O texto manual foi conservado; confira o estado atual antes de escolher outra base.`);
    setOcupado(null);
  };
  const salvar = (reativar = false) => perfilEditor.enviar({ schema: PautaVozSalvarHumanoSchema,
    campos: { perfil: rascunho, chaveVozEsperada: perfilEditor.base?.configuracao.chaveEfetiva }, acao: 'salvar_voz', reativar });
  const trocarChave = (reativar = false) => chaveEditor.enviar({ path: '/pauta/voz/chave', schema: PautaVozChaveHumanaSchema,
    campos: { chave: chave.trim(), chaveEfetivaEsperada: chaveEditor.base?.configuracao.chaveEfetiva }, acao: 'mudar_chave_voz', reativar });

  return (
    <div className="space-y-5" aria-label="Voz do autor">
      <ConferenciaEdicaoHumana editor={perfilEditor} />
      <section className="space-y-2 rounded-lg border border-border bg-surface-2 p-3">
        <h3 className="font-os-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Perfil vigente</h3>
        {vigente ? (
          <>
            <p className="text-xs text-muted">
              Versão {vigente.versao} · {quando(vigente.atualizadoEm)} · de onde saiu:{' '}
              <span className="break-words text-text">{vigente.sourceRef ?? vigente.procedencia}</span>
            </p>
            {!editando && (
              <div className="rounded-lg border border-border bg-surface p-3" aria-label="Texto do perfil">
                <RoteiroMarkdown texto={vigente.corpo} />
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">
            {perfil?.arquivado
              ? 'O perfil está arquivado: a pauta escreve no tom da casa até ele voltar.'
              : 'Sem perfil: o roteiro e as peças saem no tom da casa. Aprenda a partir de episódios transcritos ou de um texto seu.'}
          </p>
        )}

        {editando ? (
          <div className="space-y-2">
            <textarea
              className={`${inputCls} min-h-[14rem] font-mono text-[13px] leading-relaxed`}
              value={rascunho}
              maxLength={PAUTA_TETO_DO_PERFIL_DE_VOZ}
              onChange={(e) => perfilEditor.alterar(e.target.value)}
              disabled={escrevendo}
              aria-label="Editar o perfil"
            />
            <p className="text-[11px] text-muted">
              {mil(rascunho.trim().length)} de {mil(PAUTA_TETO_DO_PERFIL_DE_VOZ)} caracteres (mínimo {PAUTA_PISO_DO_PERFIL_DE_VOZ}). Salvar
              grava uma versão nova; a atual fica no histórico.
            </p>
            {proibidasNoRascunho.length > 0 && (
              <p className="text-xs text-warn" role="status">
                O perfil cita {proibidasNoRascunho.map((p) => `“${p}”`).join(', ')} — a marca proíbe; deixe só no “Nunca diz”.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Botao tone="brand" onClick={() => void salvar()} disabled={!perfilEditor.editavel || escrevendo || !rascunhoValido}>
                {perfilEditor.ocupado ? 'Salvando…' : perfilEditor.destinoBase?.estado === 'existente' && perfilEditor.destinoBase.arquivada ? 'Salvar mantendo arquivada' : 'Salvar versão'}
              </Botao>
              {perfilEditor.destinoBase?.estado === 'existente' && perfilEditor.destinoBase.arquivada && <Botao tone="brand" onClick={() => void salvar(true)} disabled={!perfilEditor.editavel || escrevendo || !rascunhoValido}>Salvar e reativar</Botao>}
              <Botao
                tone="ghost"
                onClick={() => {
                  setEditando(false);
                }}
                disabled={escrevendo}
              >
                Cancelar
              </Botao>
            </div>
          </div>
        ) : (
          <Botao
            onClick={() => {
              setEditando(true);
            }}
            disabled={!editavel || escrevendo}
          >
            {vigente ? 'Editar à mão' : 'Escrever à mão'}
          </Botao>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-surface-2 p-3" aria-label="Aprender a voz">
        <h3 className="font-os-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Aprender</h3>
        <p className="text-xs text-muted">
          A IA lê o que você disse e escreveu e descreve o ritmo, o tamanho de frase, o vocabulário, como abre, como fecha,
          como explica termo técnico e o que você nunca diz. O resultado vira a versão nova do perfil.
        </p>

        <fieldset className="space-y-1">
          <legend className="text-xs text-muted">
            Episódios transcritos (até {PAUTA_TETO_DE_EPISODIOS_DA_VOZ})
          </legend>
          {painel.episodios.length === 0 && <p className="text-sm text-muted">Nenhum episódio transcrito ainda.</p>}
          {painel.episodios.map((e) => {
            const marcado = escolhidos.includes(e.id);
            const cheio = !marcado && escolhidos.length >= PAUTA_TETO_DE_EPISODIOS_DA_VOZ;
            return (
              <label key={e.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={marcado}
                  disabled={!editavel || escrevendo || cheio}
                  onChange={() => setEscolhidos((l) => (marcado ? l.filter((x) => x !== e.id) : [...l, e.id]))}
                />
                <span className="min-w-0 break-words">
                  <span className="font-mono">{e.apelido}</span> · {e.titulo}{' '}
                  <span className="text-xs text-muted">({mil(e.caracteres)} caracteres)</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="space-y-2">
          {textos.map((t, i) => (
            <div key={i} className="space-y-1">
              <textarea
                className={`${inputCls} min-h-[6rem]`}
                value={t}
                maxLength={PAUTA_TETO_DO_TEXTO_DA_VOZ}
                placeholder="Cole um texto seu: post, e-mail, legenda, transcrição de áudio."
                onChange={(ev) => setTextos((l) => l.map((x, j) => (j === i ? ev.target.value : x)))}
                disabled={!editavel || escrevendo}
                aria-label={`Texto colado ${i + 1}`}
              />
              <p className="text-[11px] text-muted">
                {mil(t.trim().length)} de {mil(PAUTA_TETO_DO_TEXTO_DA_VOZ)} caracteres
                {t.trim() && t.trim().length < PAUTA_PISO_DO_TEXTO_DA_VOZ ? ` — mínimo ${PAUTA_PISO_DO_TEXTO_DA_VOZ}` : ''}
              </p>
            </div>
          ))}
          {colados.length > 1 && (
            <p className={`text-[11px] ${textosDemais ? 'text-warn' : 'text-muted'}`}>
              Somados: {mil(somaDosTextos)} de {mil(PAUTA_TETO_DOS_TEXTOS_DA_VOZ)} caracteres
              {textosDemais ? ' — encurte algum texto para aprender' : ''}
            </p>
          )}
          {textos.length < PAUTA_TETO_DE_TEXTOS_DA_VOZ && (
            <Botao tone="ghost" onClick={() => setTextos((l) => [...l, ''])} disabled={!editavel || escrevendo}>
              Adicionar outro texto
            </Botao>
          )}
        </div>

        <Botao
          tone="brand"
          onClick={aprender}
          disabled={!editavel || perfilEditor.bloqueado || Boolean(semIa) || escrevendo || editando || !podeAprender}
          title={
            semIa ??
            (editando
              ? 'Termine ou cancele a edição à mão antes de aprender.'
              : !podeAprender
                ? 'Escolha um episódio ou cole um texto.'
                : undefined)
          }
        >
          {ocupado === 'aprender' ? 'Aprendendo…' : 'Aprender a voz'}
        </Botao>
        {semIa && <p className="text-xs text-muted">{semIa}</p>}
        {!semIa && editando && <p className="text-xs text-muted">Termine ou cancele a edição à mão antes de aprender.</p>}
      </section>

      {aviso && (
        <p className="text-sm text-good" role="status">
          {aviso}
        </p>
      )}

      <section className="space-y-2">
        <h3 className="font-os-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Regras da marca</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {painel.regrasDaMarca.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="text-[11px] text-muted">Valem sempre, com ou sem perfil.</p>
      </section>

      {painel.historico.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-os-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Histórico</h3>
          <ul className="space-y-1 text-sm" aria-label="Versões do perfil">
            {painel.historico.map((v) => (
              <li key={v.versao} className="break-words">
                <span className="font-mono">v{v.versao}</span> · {MUDANCA[v.mudanca] ?? v.mudanca} · {quando(v.criadoEm)}
                <span className="block text-xs text-muted">{v.procedencia}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-os-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Chave na memória</h3>
        <p className="text-xs text-muted">
          O perfil é a nota <code>{painel.chave}</code> ({painel.origemDaChave === 'empresa' ? 'escolhida pela empresa' : 'padrão'}).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${inputCls} min-w-0 flex-1`}
            value={chave}
            maxLength={PAUTA_TETO_DA_CHAVE_DA_VOZ}
            onChange={(e) => chaveEditor.alterar(e.target.value)}
            disabled={!editavel || escrevendo || editando}
            aria-label="Chave da voz"
          />
          <Botao onClick={() => void trocarChave()} disabled={!editavel || !chaveEditor.editavel || escrevendo || editando || !chaveValida || chave.trim() === chaveEditor.base?.configuracao.chaveEfetiva}>
            {chaveEditor.ocupado ? 'Salvando…' : chaveEditor.destinoBase?.estado === 'existente' && chaveEditor.destinoBase.arquivada ? 'Salvar mantendo arquivada' : 'Usar esta chave'}
          </Botao>
        </div>
        {chaveEditor.destinoBase?.estado === 'existente' && chaveEditor.destinoBase.arquivada && <Botao onClick={() => void trocarChave(true)} disabled={!editavel || !chaveEditor.editavel || escrevendo || editando || !chaveValida}>Salvar e reativar configuração</Botao>}
        <ConferenciaEdicaoHumana editor={chaveEditor} />
        {!chaveValida && <p className="text-xs text-warn">A chave começa com “voz.” (ex.: voz.pedro).</p>}
      </section>
    </div>
  );
}
