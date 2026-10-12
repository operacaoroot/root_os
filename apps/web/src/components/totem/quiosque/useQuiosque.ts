'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TOTEM_MINUTOS_SINCRONIZACAO,
  TotemAtivacaoSchema,
  type TotemCatalogo,
  type TotemTipoEvento,
} from '@mktos/shared';

import { ErroDaApi } from '@/lib/api';
import { ehNaoEncontrado, ehSemRede, ehTotemDesativado, totemApi } from '@/lib/totem/api-publica';
import { armazemDoAparelho } from './armazem';
import { esquecerAparelho, gravarAparelho, lerAparelho, type AparelhoAtivado } from './credencial';
import { criarFila, type DadosDoEvento } from './fila';
import {
  baixarCatalogo,
  enviarBatimento,
  enviarEventos,
  esquecerCatalogo,
  guardarCatalogo,
  lerCatalogoGuardado,
} from './sincronia';
import { preCarregar, urlsDeImagemDoCatalogo } from './vitrine';

/*
 * O ESTADO DO QUIOSQUE: aparelho, catálogo, rede e fila de eventos.
 *
 * Abre pelo que está guardado no aparelho e sincroniza em seguida, a cada 5
 * minutos, na volta da rede e pelo botão da manutenção. Um 401 em qualquer
 * chamada é o aparelho revogado no painel: apaga token, catálogo e fila e
 * volta para a ativação.
 */

export type FaseDoQuiosque = 'carregando' | 'ativacao' | 'pronto';

export interface EstadoDaSincronia {
  sincronizando: boolean;
  ultimaEm: string | null;
  erro: string | null;
}

const SEM_SINCRONIA: EstadoDaSincronia = { sincronizando: false, ultimaEm: null, erro: null };

export function mensagemDaFalhaDeSincronia(e: unknown): string {
  if (ehSemRede(e)) return 'Sem conexão com a internet. O totem segue com o catálogo guardado.';
  if (ehNaoEncontrado(e)) return 'A loja deste totem foi desativada, ou o módulo foi desligado no painel.';
  if (e instanceof ErroDaApi && e.status === 429) return 'Muitas sincronizações seguidas. O totem tenta de novo em alguns minutos.';
  return 'Não foi possível sincronizar agora. O totem tenta de novo em alguns minutos.';
}

async function baixarImagem(url: string): Promise<void> {
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok) throw new Error(`imagem ${r.status}`);
  await r.blob();
}

/*
 * Depois de cada sincronia, as fotos e os banners do catálogo passam pelo
 * service worker, poucos por vez, para o totem mostrá-los sem rede; e o
 * service worker apaga o que saiu do catálogo. Sem service worker no comando
 * da página (desenvolvimento, primeira abertura) não adianta baixar: a cópia
 * não ficaria guardada, e a próxima sincronia tenta de novo.
 */
function guardarImagensParaSemRede(catalogo: TotemCatalogo, jaCarregadas: Set<string>): Promise<void> | null {
  const sw = typeof navigator === 'undefined' ? null : navigator.serviceWorker?.controller;
  if (!sw) return null;
  const urls = urlsDeImagemDoCatalogo(catalogo);
  return preCarregar(urls, baixarImagem, { concorrencia: 3, jaCarregadas }).then(() => {
    try {
      sw.postMessage({ tipo: 'aparar-midia', manter: urls });
    } catch {
      /* service worker trocado no meio: o próximo apara */
    }
  });
}

export function useQuiosque() {
  const armazem = useMemo(() => armazemDoAparelho(), []);
  const fila = useMemo(() => criarFila(armazem), [armazem]);

  const [fase, setFase] = useState<FaseDoQuiosque>('carregando');
  const [aparelho, setAparelho] = useState<AparelhoAtivado | null>(null);
  const [catalogo, setCatalogo] = useState<TotemCatalogo | null>(null);
  const [online, setOnline] = useState(true);
  const [sincronia, setSincronia] = useState<EstadoDaSincronia>(SEM_SINCRONIA);
  const [eventosNaFila, setEventosNaFila] = useState(0);

  const aparelhoRef = useRef<AparelhoAtivado | null>(null);
  const catalogoRef = useRef<TotemCatalogo | null>(null);
  const emAndamento = useRef<Promise<void> | null>(null);
  const imagensGuardadas = useRef(new Set<string>());
  const guardandoImagens = useRef(false);

  const desativar = useCallback(async () => {
    aparelhoRef.current = null;
    catalogoRef.current = null;
    await Promise.all([esquecerAparelho(armazem), esquecerCatalogo(armazem), fila.limpar()]);
    setAparelho(null);
    setCatalogo(null);
    setSincronia(SEM_SINCRONIA);
    setEventosNaFila(0);
    setFase('ativacao');
  }, [armazem, fila]);

  const sincronizar = useCallback((): Promise<void> => {
    const a = aparelhoRef.current;
    if (!a) return Promise.resolve();
    if (emAndamento.current) return emAndamento.current;
    const rodada = (async () => {
      setSincronia((s) => ({ ...s, sincronizando: true }));
      try {
        const r = await baixarCatalogo(a.token, catalogoRef.current?.versao ?? null);
        const agora = new Date().toISOString();
        let atual = catalogoRef.current;
        if (r.mudou) {
          atual = r.catalogo;
          catalogoRef.current = atual;
          setCatalogo(atual);
          await fila.registrar('sincronizou');
        }
        if (atual) await guardarCatalogo(armazem, { catalogo: atual, sincronizadoEm: agora });
        if (atual && !guardandoImagens.current) {
          const guardando = guardarImagensParaSemRede(atual, imagensGuardadas.current);
          if (guardando) {
            guardandoImagens.current = true;
            void guardando.finally(() => {
              guardandoImagens.current = false;
            });
          }
        }
        setOnline(true);
        setSincronia({ sincronizando: false, ultimaEm: agora, erro: null });
        await enviarBatimento(a.token, atual?.versao ?? null).catch((e: unknown) => {
          if (ehTotemDesativado(e)) throw e;
        });
        await fila.descarregar(enviarEventos(a.token));
      } catch (e) {
        if (ehTotemDesativado(e)) {
          await desativar();
          return;
        }
        if (ehSemRede(e)) setOnline(false);
        setSincronia((s) => ({ ...s, sincronizando: false, erro: mensagemDaFalhaDeSincronia(e) }));
      } finally {
        setEventosNaFila(fila.tamanho());
        emAndamento.current = null;
      }
    })();
    emAndamento.current = rodada;
    return rodada;
  }, [armazem, fila, desativar]);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const a = await lerAparelho(armazem);
      await fila.carregar();
      if (!vivo) return;
      setEventosNaFila(fila.tamanho());
      if (!a) {
        setFase('ativacao');
        return;
      }
      const guardado = await lerCatalogoGuardado(armazem);
      if (!vivo) return;
      aparelhoRef.current = a;
      setAparelho(a);
      if (guardado && guardado.catalogo.dispositivo.id === a.dispositivo.id) {
        catalogoRef.current = guardado.catalogo;
        setCatalogo(guardado.catalogo);
        setSincronia((s) => ({ ...s, ultimaEm: guardado.sincronizadoEm }));
      }
      setFase('pronto');
      void sincronizar();
    })();
    return () => {
      vivo = false;
    };
  }, [armazem, fila, sincronizar]);

  useEffect(() => {
    if (fase !== 'pronto') return;
    const relogio = setInterval(() => void sincronizar(), TOTEM_MINUTOS_SINCRONIZACAO * 60_000);
    const voltou = () => {
      setOnline(true);
      void sincronizar();
    };
    const caiu = () => setOnline(false);
    window.addEventListener('online', voltou);
    window.addEventListener('offline', caiu);
    if (!navigator.onLine) setOnline(false);
    return () => {
      clearInterval(relogio);
      window.removeEventListener('online', voltou);
      window.removeEventListener('offline', caiu);
    };
  }, [fase, sincronizar]);

  const ativar = useCallback(
    async (codigo: string) => {
      const r = TotemAtivacaoSchema.parse(await totemApi<unknown>('/totem-publico/ativar', { corpo: { codigo } }));
      const a: AparelhoAtivado = { ...r, ativadoEm: new Date().toISOString() };
      await Promise.all([esquecerCatalogo(armazem), fila.limpar()]);
      await gravarAparelho(armazem, a);
      aparelhoRef.current = a;
      catalogoRef.current = null;
      setAparelho(a);
      setCatalogo(null);
      setSincronia(SEM_SINCRONIA);
      setEventosNaFila(0);
      setOnline(true);
      setFase('pronto');
      void sincronizar();
    },
    [armazem, fila, sincronizar],
  );

  const registrar = useCallback(
    (tipo: TotemTipoEvento, dados?: DadosDoEvento) => {
      void fila.registrar(tipo, dados).then(() => setEventosNaFila(fila.tamanho()));
    },
    [fila],
  );

  return { fase, aparelho, catalogo, online, sincronia, eventosNaFila, ativar, sincronizar, registrar };
}
