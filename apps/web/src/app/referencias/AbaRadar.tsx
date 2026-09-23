'use client';

import { useEffect, useState } from 'react';
import { PAUTA_FONTE_ROTULOS, type PautaFonteList, type PautaFonteTipo } from '@mktos/shared';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';
import { Botao, Campo, Card, Chip, inputCls } from './ui';

interface Props {
  token: string | null;
  editavel: boolean;
  onErro: (m: string | null) => void;
  bump: number;
  onMudou: () => void;
}

type Destino = 'off' | 'local' | 'drive';

/** O que o Radar deixa cadastrar. `manual` nasce sozinho (grupo de links do WhatsApp). */
const TIPOS_CADASTRAVEIS: PautaFonteTipo[] = ['perfil', 'rss', 'gmail', 'busca'];
/** Os que têm "Coletar agora" — o mesmo despacho que a rodada usa. */
const TIPOS_COLETAVEIS: PautaFonteTipo[] = ['perfil', 'rss', 'gmail'];
/** Os que gastam run pago (Apify) e por isso têm teto no mês. */
const TIPOS_COM_TETO: PautaFonteTipo[] = ['perfil', 'busca'];

interface EspelhoEstado {
  destino: Destino;
  dir: string;
  folderId: string | null;
  alvo: string | null;
  disponivel: boolean;
  motivo: string | null;
}

export function AbaRadar({ token, editavel, onErro, bump, onMudou }: Props) {
  const [data, setData] = useState<PautaFonteList | null>(null);
  const [espelho, setEspelho] = useState<EspelhoEstado | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  // formulário de nova fonte
  const [tipo, setTipo] = useState<PautaFonteTipo>('perfil');
  const [nome, setNome] = useState('');
  const [handle, setHandle] = useState('');
  const [url, setUrl] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [teto, setTeto] = useState(30);

  useEffect(() => {
    if (!token) return;
    apiGet<PautaFonteList>('/pauta/fontes', token)
      .then(setData)
      .catch((e: Error) => onErro(e.message));
    apiGet<EspelhoEstado>('/pauta/espelho', token)
      .then(setEspelho)
      .catch((e: Error) => onErro(e.message));
  }, [token, bump, onErro]);

  const criar = async () => {
    onErro(null);
    try {
      await apiPost(
        '/pauta/fontes',
        {
          tipo,
          nome: nome.trim(),
          handle:
            tipo === 'perfil' ? handle.trim().replace(/^@/, '') : tipo === 'gmail' ? etiqueta.trim() : null,
          url: tipo === 'rss' ? url.trim() : null,
          plataforma: tipo === 'perfil' ? 'instagram' : tipo === 'gmail' ? 'gmail' : null,
          tetoRunsMes: teto,
        },
        token,
      );
      setNome('');
      setHandle('');
      setUrl('');
      setEtiqueta('');
      onMudou();
    } catch (e) {
      onErro((e as Error).message);
    }
  };

  const coletar = async (id: string) => {
    onErro(null);
    setOcupado(id);
    try {
      const r = await apiPost<{ novas: number }>(`/pauta/fontes/${id}/coletar`, {}, token);
      onErro(r.novas === 0 ? 'Nada novo nessa fonte — tudo já estava na fila ou no acervo.' : null);
      onMudou();
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const alternar = async (id: string, ativo: boolean) => {
    try {
      await apiPatch(`/pauta/fontes/${id}`, { ativo }, token);
      onMudou();
    } catch (e) {
      onErro((e as Error).message);
    }
  };

  const remover = async (id: string) => {
    try {
      await apiDelete(`/pauta/fontes/${id}`, token);
      onMudou();
    } catch (e) {
      onErro((e as Error).message);
    }
  };

  const salvarEspelho = async (patch: Partial<EspelhoEstado>) => {
    onErro(null);
    try {
      const r = await apiPut<EspelhoEstado>('/pauta/espelho', patch, token);
      setEspelho(r);
    } catch (e) {
      onErro((e as Error).message);
    }
  };

  const sincronizarEspelho = async () => {
    onErro(null);
    setOcupado('espelho');
    try {
      const r = await apiPost<{ espelhadas: number; falhas: number }>(
        '/pauta/espelho/sincronizar',
        {},
        token,
      );
      onErro(
        r.falhas > 0
          ? `${r.espelhadas} ficha(s) espelhada(s), ${r.falhas} falha(s).`
          : null,
      );
      onMudou();
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="space-y-4">
      {data && !data.apifyConfigurado && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          APIFY_TOKEN não configurado — perfis do Instagram/TikTok não coletam. Defina no{' '}
          <code className="text-xs">.env</code> e reinicie a API.
        </div>
      )}

      <Card titulo="Espelho .md no Obsidian">
        <p className="mb-4 text-sm text-muted">
          O registro canônico é o do sistema; o vault recebe uma cópia em markdown. Escrita numa
          direção só — editar o .md não volta pro banco.
        </p>

        <div className="mb-4 flex flex-wrap gap-2">
          {([
            { v: 'off' as Destino, t: 'Desligado', d: 'Só no banco do OS' },
            { v: 'local' as Destino, t: 'Vault montada', d: 'Filesystem (OBSIDIAN_VAULT_PATH)' },
            { v: 'drive' as Destino, t: 'Google Drive', d: 'Pela conta OAuth conectada' },
          ]).map((o) => (
            <button
              key={o.v}
              onClick={() => editavel && salvarEspelho({ destino: o.v })}
              disabled={!editavel}
              className={`rounded-lg border px-3 py-2 text-left disabled:opacity-50 ${
                espelho?.destino === o.v
                  ? 'border-brand text-brand'
                  : 'border-border text-muted hover:text-text'
              }`}
            >
              <span className="block text-sm font-medium">{o.t}</span>
              <span className="block text-[11px] opacity-80">{o.d}</span>
            </button>
          ))}
        </div>

        {espelho?.destino === 'local' && (
          <Campo label="Subpasta dentro da vault" hint="Caminho relativo, sem “..”.">
            <input
              className={inputCls}
              defaultValue={espelho.dir}
              onBlur={(e) => salvarEspelho({ dir: e.target.value })}
              disabled={!editavel}
            />
          </Campo>
        )}

        {espelho?.destino === 'drive' && (
          <Campo
            label="ID da pasta no Drive"
            hint="Abra a pasta no Drive e copie o trecho depois de /folders/ na URL."
          >
            <input
              className={inputCls}
              placeholder="1A2b3C4d5E6f7G8h9I0j"
              defaultValue={espelho.folderId ?? ''}
              onBlur={(e) => salvarEspelho({ folderId: e.target.value.trim() || null })}
              disabled={!editavel}
            />
          </Campo>
        )}

        {espelho && espelho.destino !== 'off' && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3">
            {espelho.disponivel ? (
              <Chip tone="good">pronto</Chip>
            ) : (
              <Chip tone="bad">indisponível</Chip>
            )}
            {espelho.alvo && (
              <code className="truncate text-[11px] text-muted">{espelho.alvo}</code>
            )}
            <Botao
              onClick={sincronizarEspelho}
              disabled={!editavel || !espelho.disponivel || ocupado === 'espelho'}
            >
              {ocupado === 'espelho' ? 'Sincronizando…' : 'Sincronizar todas'}
            </Botao>
            {espelho.motivo && <span className="text-sm text-bad">{espelho.motivo}</span>}
          </div>
        )}
      </Card>

      <Card titulo="Nova fonte">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo label="Tipo">
            <select
              className={inputCls}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as PautaFonteTipo)}
              disabled={!editavel}
            >
              {TIPOS_CADASTRAVEIS.map((t) => (
                <option key={t} value={t}>
                  {PAUTA_FONTE_ROTULOS[t]}
                </option>
              ))}
            </select>
          </Campo>

          <Campo label="Nome">
            <input
              className={inputCls}
              placeholder="Blank School"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              disabled={!editavel}
            />
          </Campo>

          {tipo === 'perfil' ? (
            <Campo label="@handle">
              <input
                className={inputCls}
                placeholder="@blankschool"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                disabled={!editavel}
              />
            </Campo>
          ) : tipo === 'gmail' ? (
            <Campo
              label="Etiqueta do Gmail"
              hint="Os e-mails dos últimos 7 dias com esta etiqueta viram capturas. Precisa do Google conectado em Integrações."
            >
              <input
                className={inputCls}
                placeholder="newsletters"
                value={etiqueta}
                onChange={(e) => setEtiqueta(e.target.value)}
                disabled={!editavel}
              />
            </Campo>
          ) : (
            <Campo label="URL">
              <input
                className={inputCls}
                placeholder="https://…/feed.xml"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={!editavel}
              />
            </Campo>
          )}

          {TIPOS_COM_TETO.includes(tipo) && (
            <Campo label="Teto de execuções/mês" hint="Trava de gasto do Apify.">
              <input
                type="number"
                min={0}
                className={inputCls}
                value={teto}
                onChange={(e) => setTeto(Number(e.target.value))}
                disabled={!editavel}
              />
            </Campo>
          )}
        </div>

        <div className="mt-3">
          <Botao
            tone="brand"
            onClick={criar}
            disabled={!editavel || nome.trim().length < 2 || (tipo === 'gmail' && !etiqueta.trim())}
          >
            Adicionar fonte
          </Botao>
        </div>
      </Card>

      {data && data.items.length > 0 && (
        <div className="space-y-2">
          {data.items.map((f) => (
            <div
              key={f.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={f.ativo ? 'good' : 'muted'}>{f.ativo ? 'ativa' : 'pausada'}</Chip>
                  <Chip>{PAUTA_FONTE_ROTULOS[f.tipo] ?? f.tipo}</Chip>
                  {TIPOS_COM_TETO.includes(f.tipo) && (
                    <Chip
                      tone={f.runsNoMes >= f.tetoRunsMes ? 'bad' : f.runsNoMes > f.tetoRunsMes * 0.7 ? 'warn' : 'muted'}
                    >
                      {f.runsNoMes}/{f.tetoRunsMes} runs no mês
                    </Chip>
                  )}
                </div>
                <p className="mt-1 text-sm">
                  {f.nome}
                  {f.handle && f.tipo === 'gmail' && <span className="text-muted"> · etiqueta {f.handle}</span>}
                  {f.handle && f.tipo !== 'gmail' && <span className="text-muted"> · @{f.handle}</span>}
                  {f.tipo === 'manual' && f.plataforma === 'whatsapp' && (
                    <span className="text-muted"> · link colado no grupo entra sozinho; pausar cala o grupo</span>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {f.capturas} captura(s)
                  {f.ultimaLeitura &&
                    ` · última leitura ${new Date(f.ultimaLeitura).toLocaleString('pt-BR')}`}
                </p>
                {f.ultimoErro && <p className="mt-0.5 text-xs text-bad">{f.ultimoErro}</p>}
              </div>

              <div className="flex items-center gap-2">
                {TIPOS_COLETAVEIS.includes(f.tipo) && (
                  <Botao
                    tone="brand"
                    onClick={() => coletar(f.id)}
                    disabled={
                      !editavel || ocupado === f.id || (f.tipo === 'perfil' && !data.apifyConfigurado)
                    }
                  >
                    {ocupado === f.id ? 'Coletando…' : 'Coletar agora'}
                  </Botao>
                )}
                <Botao onClick={() => alternar(f.id, !f.ativo)} disabled={!editavel}>
                  {f.ativo ? 'Pausar' : 'Ativar'}
                </Botao>
                {!(f.tipo === 'manual' && f.plataforma === 'whatsapp') && (
                  <Botao tone="bad" onClick={() => remover(f.id)} disabled={!editavel}>
                    Remover
                  </Botao>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted">
        A rotina da pauta coleta sozinha os feeds RSS e as etiquetas do Gmail antes de cada rodada;
        perfis só no “Coletar agora”, que respeita o teto de execuções do mês. Ver{' '}
        <code>docs/PAUTA.md</code>.
      </p>
    </div>
  );
}
