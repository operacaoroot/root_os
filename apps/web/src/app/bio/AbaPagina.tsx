'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Star, Trash2 } from 'lucide-react';
import { apiDelete, apiPatch, apiPost, apiUpload } from '@/lib/api';
import { BioPageView } from '@/components/BioPageView';
import type { BioPublicPage } from '@mktos/shared';
import type { BioPageDetalhe, BioLinkRow } from './tipos';
import { Botao, Campo, Card, Chip, inputCls } from './ui';

const TIPOS = [
  { v: 'url', label: 'Link', hint: 'https://…' },
  { v: 'whatsapp', label: 'WhatsApp', hint: 'DDI+DDD+número, só dígitos: 5527999998888' },
  { v: 'email', label: 'E-mail', hint: 'contato@dominio.com' },
] as const;

export function AbaPagina({
  detalhe,
  token,
  editavel,
  onMudou,
  onErro,
}: {
  detalhe: BioPageDetalhe;
  token: string | null;
  editavel: boolean;
  onMudou: () => void;
  onErro: (m: string) => void;
}) {
  const { page } = detalhe;
  const [handle, setHandle] = useState(page.handle);
  const [titulo, setTitulo] = useState(page.titulo);
  const [subtitulo, setSubtitulo] = useState(page.subtitulo ?? '');
  const [avatarUrl, setAvatarUrl] = useState(page.avatarUrl ?? '');
  const [salvando, setSalvando] = useState(false);
  const [enviandoAvatar, setEnviandoAvatar] = useState(false);

  const [novoTipo, setNovoTipo] = useState<'url' | 'whatsapp' | 'email'>('url');
  const [novoRotulo, setNovoRotulo] = useState('');
  const [novoDestino, setNovoDestino] = useState('');

  const chamar = (p: Promise<unknown>) => p.then(onMudou).catch((e: Error) => onErro(e.message));

  const salvarIdentidade = () => {
    setSalvando(true);
    apiPost(
      '/bio/pages',
      {
        id: page.id,
        handle: handle.trim().toLowerCase(),
        titulo: titulo.trim(),
        subtitulo: subtitulo.trim() || null,
        avatarUrl: avatarUrl.trim() || null,
      },
      token,
    )
      .then(onMudou)
      .catch((e: Error) => onErro(e.message))
      .finally(() => setSalvando(false));
  };

  // O upload já grava o avatar no banco — não depende do "Salvar" ao lado.
  const enviarAvatar = (arquivo: File) => {
    setEnviandoAvatar(true);
    apiUpload<{ avatarUrl: string }>(`/bio/pages/${page.id}/avatar`, arquivo, token)
      .then((r) => {
        setAvatarUrl(r.avatarUrl);
        onMudou();
      })
      .catch((e: Error) => onErro(e.message))
      .finally(() => setEnviandoAvatar(false));
  };

  const criarLink = () => {
    if (!novoRotulo.trim() || !novoDestino.trim()) return;
    chamar(
      apiPost(
        `/bio/pages/${page.id}/links`,
        { tipo: novoTipo, rotulo: novoRotulo.trim(), destino: novoDestino.trim() },
        token,
      ),
    ).then(() => {
      setNovoRotulo('');
      setNovoDestino('');
    });
  };

  // A prévia usa o MESMO componente da página pública — o que o dono confere
  // aqui é exatamente o que o visitante vê.
  const previa: BioPublicPage = {
    handle: page.handle,
    titulo: page.titulo,
    subtitulo: page.subtitulo,
    avatarUrl: page.avatarUrl,
    links: page.links
      .filter((l) => l.ativo)
      .map((l) => ({
        id: l.id,
        tipo: l.tipo,
        rotulo: l.rotulo,
        icone: l.icone,
        destaque: l.destaque,
      })),
    desafio: detalhe.desafio
      ? {
          titulo: detalhe.desafio.titulo,
          feitos: detalhe.desafio.contagem,
          meta: detalhe.desafio.meta,
          diaAtual: detalhe.desafio.diaAtual,
          totalDias: detalhe.desafio.diasTotais,
          pctFeito: detalhe.desafio.progresso,
          pctTempo: Math.round((detalhe.desafio.diaAtual / detalhe.desafio.diasTotais) * 1000) / 10,
          ritmoNecessario: detalhe.desafio.porDia,
          saldo: detalhe.desafio.saldo,
        }
      : null,
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
      <div className="space-y-5">
        <Card
          titulo="Identidade"
          acao={
            editavel && (
              <Botao tone="brand" onClick={salvarIdentidade} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </Botao>
            )
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Handle" hint={`bio.operacaoroot.com/@${handle || '…'}`}>
              <input
                className={inputCls}
                value={handle}
                disabled={!editavel}
                onChange={(e) => setHandle(e.target.value)}
              />
            </Campo>
            <Campo label="Título">
              <input
                className={inputCls}
                value={titulo}
                disabled={!editavel}
                onChange={(e) => setTitulo(e.target.value)}
              />
            </Campo>
            <Campo label="Subtítulo">
              <input
                className={inputCls}
                value={subtitulo}
                disabled={!editavel}
                onChange={(e) => setSubtitulo(e.target.value)}
              />
            </Campo>
            <Campo
              label="Avatar"
              hint="Envie a imagem (até 2 MB). Link de rede social expira e some da página."
            >
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  value={avatarUrl}
                  disabled={!editavel}
                  placeholder="https://… ou envie um arquivo"
                  onChange={(e) => setAvatarUrl(e.target.value)}
                />
                <label
                  className={`shrink-0 cursor-pointer rounded-md border border-white/15 px-3 py-2 text-sm ${
                    editavel && !enviandoAvatar ? 'hover:bg-white/5' : 'cursor-not-allowed opacity-50'
                  }`}
                >
                  {enviandoAvatar ? 'Enviando…' : 'Enviar'}
                  <input
                    type="file"
                    className="hidden"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    disabled={!editavel || enviandoAvatar}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      // limpa o input pra permitir reenviar o MESMO arquivo depois
                      e.target.value = '';
                      if (f) enviarAvatar(f);
                    }}
                  />
                </label>
              </div>
            </Campo>
          </div>
        </Card>

        <Card titulo={`Botões (${page.links.length})`}>
          <div className="space-y-2">
            {page.links.map((l, i) => (
              <LinhaDoLink
                key={l.id}
                link={l}
                primeiro={i === 0}
                ultimo={i === page.links.length - 1}
                editavel={editavel}
                onPatch={(body) => chamar(apiPatch(`/bio/links/${l.id}`, body, token))}
                onMover={(direcao) => chamar(apiPost(`/bio/links/${l.id}/move`, { direcao }, token))}
                onRemover={() => chamar(apiDelete(`/bio/links/${l.id}`, token))}
              />
            ))}
            {page.links.length === 0 && (
              <p className="text-xs text-muted">Nenhum botão ainda.</p>
            )}
          </div>

          {editavel && (
            <div className="mt-4 grid gap-2 border-t border-border pt-4 sm:grid-cols-[130px_1fr_1fr_auto]">
              <select
                className={inputCls}
                value={novoTipo}
                onChange={(e) => setNovoTipo(e.target.value as 'url' | 'whatsapp' | 'email')}
              >
                {TIPOS.map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                className={inputCls}
                placeholder="Rótulo"
                value={novoRotulo}
                onChange={(e) => setNovoRotulo(e.target.value)}
              />
              <input
                className={inputCls}
                placeholder={TIPOS.find((t) => t.v === novoTipo)?.hint}
                value={novoDestino}
                onChange={(e) => setNovoDestino(e.target.value)}
              />
              <Botao onClick={criarLink}>Adicionar</Botao>
            </div>
          )}
        </Card>
      </div>

      <Card titulo="Prévia">
        <div className="overflow-hidden rounded-lg border border-border bg-bio-bg">
          <div className="origin-top scale-[0.88]">
            <BioPageView dados={previa} previa rascunho={!page.publicada} />
          </div>
        </div>
      </Card>
    </div>
  );
}

function LinhaDoLink({
  link,
  primeiro,
  ultimo,
  editavel,
  onPatch,
  onMover,
  onRemover,
}: {
  link: BioLinkRow;
  primeiro: boolean;
  ultimo: boolean;
  editavel: boolean;
  onPatch: (body: Record<string, unknown>) => void;
  onMover: (direcao: 'cima' | 'baixo') => void;
  onRemover: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2 ${
        link.ativo ? '' : 'opacity-50'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm">{link.rotulo}</span>
          {link.destaque && <Chip tone="brand">destaque</Chip>}
          <Chip>{link.tipo}</Chip>
        </div>
        <p className="truncate text-[11px] text-muted">{link.destino}</p>
      </div>
      {editavel && (
        <div className="flex shrink-0 items-center gap-1">
          <IconeBotao title="Subir" disabled={primeiro} onClick={() => onMover('cima')}>
            <ArrowUp size={14} />
          </IconeBotao>
          <IconeBotao title="Descer" disabled={ultimo} onClick={() => onMover('baixo')}>
            <ArrowDown size={14} />
          </IconeBotao>
          <IconeBotao
            title={link.destaque ? 'Tirar destaque' : 'Destacar'}
            ativo={link.destaque}
            onClick={() => onPatch({ destaque: !link.destaque })}
          >
            <Star size={14} />
          </IconeBotao>
          <IconeBotao
            title={link.ativo ? 'Ocultar' : 'Mostrar'}
            onClick={() => onPatch({ ativo: !link.ativo })}
          >
            {link.ativo ? <Eye size={14} /> : <EyeOff size={14} />}
          </IconeBotao>
          <IconeBotao title="Remover" perigo onClick={onRemover}>
            <Trash2 size={14} />
          </IconeBotao>
        </div>
      )}
    </div>
  );
}

function IconeBotao({
  children,
  title,
  onClick,
  disabled,
  ativo,
  perigo,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  ativo?: boolean;
  perigo?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded p-1.5 disabled:opacity-25 ${
        perigo ? 'text-muted hover:text-bad' : ativo ? 'text-brand' : 'text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}
