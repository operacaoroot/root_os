'use client';

import { FormEvent, useEffect, useState } from 'react';
import type { TotemGestaoConfig, TotemGestaoConfigEntrada } from '@mktos/shared';
import { apiGet, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Botao, Campo, Card, inputCls } from '../../referencias/ui';
import { dataHoraBR } from '../lojas/apoio';

/*
 * A CONFIGURAÇÃO DO TOTEM — vale para a empresa inteira, em todas as lojas.
 *
 * Enquanto ninguém salvou, a tela mostra os valores padrão com o preço e o
 * cadastro desligados: ligar os dois é decisão de quem responde pela loja, e o
 * cadastro depende do controlador dos dados preenchido para a política.
 */

type Rascunho = Omit<TotemGestaoConfigEntrada, 'logoUrl' | 'controladorDocumento' | 'controladorEndereco' | 'encarregadoNome' | 'encarregadoContato' | 'mensagemBoasVindas'> & {
  logoUrl: string;
  controladorDocumento: string;
  controladorEndereco: string;
  encarregadoNome: string;
  encarregadoContato: string;
  mensagemBoasVindas: string;
};

function paraRascunho(c: TotemGestaoConfig): Rascunho {
  return {
    nomeExibicao: c.nomeExibicao,
    corPrimaria: c.corPrimaria,
    corFundo: c.corFundo,
    logoUrl: c.logoUrl ?? '',
    precoLigado: c.precoLigado,
    cadastroLigado: c.cadastroLigado,
    tempoOciosoSeg: c.tempoOciosoSeg,
    controladorNome: c.controladorNome,
    controladorDocumento: c.controladorDocumento ?? '',
    controladorEndereco: c.controladorEndereco ?? '',
    encarregadoNome: c.encarregadoNome ?? '',
    encarregadoContato: c.encarregadoContato ?? '',
    mensagemBoasVindas: c.mensagemBoasVindas ?? '',
  };
}

export default function PaginaDaConfiguracao() {
  const { token, ready, can } = useAuth();
  const editavel = can('totem.lojas');
  const [config, setConfig] = useState<TotemGestaoConfig | null>(null);
  const [r, setR] = useState<Rascunho | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!ready || !token) return;
    apiGet<TotemGestaoConfig>('/totem-gestao/configuracao', token)
      .then((c) => {
        setConfig(c);
        setR(paraRascunho(c));
      })
      .catch((e: Error) => setErro(e.message));
  }, [ready, token]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!token || !r) return;
    setErro(null);
    setSalvo(false);
    setEnviando(true);
    try {
      const c = await apiPut<TotemGestaoConfig>('/totem-gestao/configuracao', r, token);
      setConfig(c);
      setR(paraRascunho(c));
      setSalvo(true);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (!ready) return null;
  if (!can('totem.ver')) return <p className="text-sm text-muted">Você não tem acesso ao painel do totem.</p>;
  if (!config || !r) return <p className="text-sm text-muted">{erro ?? 'Carregando a configuração…'}</p>;

  const campo = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => {
    setSalvo(false);
    setR({ ...r, [k]: v });
  };

  return (
    <form onSubmit={salvar} className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Configuração do totem</h1>
        <p className="text-sm text-muted">
          {config.existe
            ? `Vale para todas as lojas. Última alteração em ${dataHoraBR(config.atualizadoEm)}.`
            : 'Ainda não há configuração salva. Os valores abaixo são o padrão, com o preço e o cadastro desligados.'}
        </p>
        {!editavel && <p className="mt-1 text-sm text-muted">Você pode ver, mas só quem tem a permissão de lojas altera.</p>}
      </div>

      <fieldset disabled={!editavel || enviando} className="space-y-6">
        <Card titulo="Aparência">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Nome que aparece no totem">
              <input className={inputCls} required minLength={2} maxLength={80} value={r.nomeExibicao} onChange={(e) => campo('nomeExibicao', e.target.value)} />
            </Campo>
            <Campo label="Endereço do logotipo" hint="Precisa começar com https://. Deixe vazio para mostrar só o nome.">
              <input className={inputCls} type="url" value={r.logoUrl} onChange={(e) => campo('logoUrl', e.target.value)} />
            </Campo>
            <Cor rotulo="Cor principal" valor={r.corPrimaria} aoMudar={(v) => campo('corPrimaria', v)} />
            <Cor rotulo="Cor de fundo" valor={r.corFundo} aoMudar={(v) => campo('corFundo', v)} />
            <Campo label="Mensagem de boas-vindas" hint="Aparece na tela inicial do totem.">
              <input className={inputCls} maxLength={240} value={r.mensagemBoasVindas} onChange={(e) => campo('mensagemBoasVindas', e.target.value)} />
            </Campo>
            <Campo label="Volta à tela inicial depois de (segundos sem toque)" hint="Entre 15 e 600 segundos.">
              <input
                className={inputCls}
                type="number"
                min={15}
                max={600}
                required
                value={r.tempoOciosoSeg}
                onChange={(e) => campo('tempoOciosoSeg', Number(e.target.value))}
              />
            </Campo>
          </div>
        </Card>

        <Card titulo="O que o totem mostra">
          <div className="space-y-3">
            <Liga
              rotulo="Mostrar o preço dos produtos"
              explicacao="Desligado, o preço não sai do servidor para o totem nem para a ficha aberta pela etiqueta."
              ligado={r.precoLigado}
              aoMudar={(v) => campo('precoLigado', v)}
            />
            <Liga
              rotulo="Oferecer o cadastro do cliente"
              explicacao="O cadastro grava nome, telefone e CPF com consentimento. Preencha o controlador dos dados antes de ligar."
              ligado={r.cadastroLigado}
              aoMudar={(v) => campo('cadastroLigado', v)}
            />
          </div>
        </Card>

        <Card titulo="Dados pessoais (para a política de privacidade)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Controlador dos dados (razão social)">
              <input className={inputCls} required minLength={2} maxLength={160} value={r.controladorNome} onChange={(e) => campo('controladorNome', e.target.value)} />
            </Campo>
            <Campo label="CNPJ do controlador">
              <input className={inputCls} maxLength={30} value={r.controladorDocumento} onChange={(e) => campo('controladorDocumento', e.target.value)} />
            </Campo>
            <Campo label="Endereço do controlador">
              <input className={inputCls} maxLength={240} value={r.controladorEndereco} onChange={(e) => campo('controladorEndereco', e.target.value)} />
            </Campo>
            <Campo label="Encarregado de dados (nome)">
              <input className={inputCls} maxLength={120} value={r.encarregadoNome} onChange={(e) => campo('encarregadoNome', e.target.value)} />
            </Campo>
            <Campo label="Contato do encarregado" hint="E-mail ou telefone para o titular pedir acesso ou exclusão.">
              <input className={inputCls} maxLength={160} value={r.encarregadoContato} onChange={(e) => campo('encarregadoContato', e.target.value)} />
            </Campo>
            <Campo label="Versão da política">
              <input className={inputCls} value={config.politicaVersao} disabled readOnly />
            </Campo>
          </div>
        </Card>
      </fieldset>

      {erro && <p className="text-sm text-bad">{erro}</p>}
      {salvo && <p className="text-sm text-good">Configuração salva. Os totens recebem a mudança na próxima sincronização.</p>}
      {editavel && (
        <Botao type="submit" tone="brand" disabled={enviando}>
          {enviando ? 'Salvando…' : 'Salvar configuração'}
        </Botao>
      )}
    </form>
  );
}

function Cor({ rotulo, valor, aoMudar }: { rotulo: string; valor: string; aoMudar: (v: string) => void }) {
  return (
    <Campo label={rotulo} hint="No formato #RRGGBB.">
      <span className="flex gap-2">
        <input
          type="color"
          className="h-9 w-12 flex-none cursor-pointer rounded border border-border bg-surface-2"
          value={/^#[0-9a-fA-F]{6}$/.test(valor) ? valor : '#000000'}
          onChange={(e) => aoMudar(e.target.value.toUpperCase())}
          aria-label={rotulo}
        />
        <input className={inputCls} required pattern="#[0-9a-fA-F]{6}" value={valor} onChange={(e) => aoMudar(e.target.value)} />
      </span>
    </Campo>
  );
}

function Liga({
  rotulo,
  explicacao,
  ligado,
  aoMudar,
}: {
  rotulo: string;
  explicacao: string;
  ligado: boolean;
  aoMudar: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1 h-4 w-4 flex-none" checked={ligado} onChange={(e) => aoMudar(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium">{rotulo}</span>
        <span className="block text-[12px] text-muted">{explicacao}</span>
      </span>
    </label>
  );
}
