'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CartoesDeConexaoSchema,
  ESTADOS_DO_CARTAO,
  ROTULO_DO_ESTADO_DO_CARTAO,
  type CartaoDeConexao as Linha,
  type CartoesDeConexao,
} from '@mktos/shared';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { CartaoDeConexao, type AcoesDoCartao } from './CartaoDeConexao';
import { ConexaoEvolution } from './ConexaoEvolution';
import { ConexaoGranola } from './ConexaoGranola';
import { ConexaoClaude } from './ConexaoClaude';

/*
 * A TELA DE CONEXÕES NUM PADRÃO SÓ — rodada dos agentes, lane A6 (21/10/2026).
 *
 * Todo conector é um `CartaoDeConexao`, com o estado SONDADO pelo servidor
 * (`GET /integrations/cartoes`) e as mesmas ações. O que é próprio de um conector
 * (o QR e o webhook da Evolution, a senha do Zap e a conexão direta do Granola, o
 * atalho para as páginas do Google e do Instagram) entra como FILHO do cartão
 * dele, nunca como cartão à parte.
 *
 * Produção 22B (I6): todo cartão tem o mesmo tamanho na grade. As ações próprias
 * da Evolution e do Granola moram na gaveta "Configurar" do cartão; os atalhos
 * pequenos (Google, Instagram, vault) seguem à vista. Asana, Extrato OFX e Zapier
 * não chegam mais aqui: a API os tira de `GET /integrations/cartoes`.
 */

const ROTA = '/integrations/cartoes';

type Saude = { estado: 'conectado' | 'nao_configurado' | 'erro' | 'nao_verificado'; mensagem: string | null; verificadoEm: string; latenciaMs: number | null };
type RespostaDeVerbo =
  | { tipo: 'redirecionar'; url: string }
  | { tipo: 'manual'; instrucao: string }
  | { tipo: 'pronto'; detalhe: string }
  | { tipo: 'nao_se_aplica'; motivo: string }
  | { tipo: 'feito'; resumo: string }
  | { tipo: 'revogado'; resumo: string };

function textoDoVerbo(r: RespostaDeVerbo): string {
  switch (r.tipo) {
    case 'manual': return r.instrucao;
    case 'pronto': return r.detalhe;
    case 'nao_se_aplica': return r.motivo;
    case 'feito': return r.resumo;
    case 'revogado': return r.resumo;
    default: return '';
  }
}

/** Para onde o "Conectar" pode mandar o navegador: https, ou http só na mesma origem. */
function destinoSeguro(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.username || u.password) return null;
    if (u.protocol === 'https:') return u.href;
    if (u.protocol === 'http:' && u.origin === window.location.origin) return u.href;
    return null;
  } catch {
    return null;
  }
}

const GOOGLE = new Set(['gmail', 'gcal', 'gdocs', 'drive']);

export function CatalogoDeConexoes({ token, pessoaId, podeGerenciar }: { token: string; pessoaId: string; podeGerenciar: boolean }) {
  const [data, setData] = useState<CartoesDeConexao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const vivo = useRef(true);

  const carregar = useCallback(async () => {
    try {
      const bruto = await apiGet<unknown>(ROTA, token);
      const r = CartoesDeConexaoSchema.safeParse(bruto);
      if (!vivo.current) return;
      if (!r.success) throw new Error('A resposta de Conexões veio num formato que esta tela não conhece. Atualize a página.');
      setData(r.data);
      setErro(null);
    } catch (e) {
      if (vivo.current) setErro((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    vivo.current = true;
    void carregar();
    return () => {
      vivo.current = false;
    };
  }, [carregar, pessoaId]);

  const fazer = async (fn: () => Promise<string | null | void>) => {
    setOcupado(true);
    setErro(null);
    setAviso(null);
    try {
      const texto = await fn();
      if (texto) setAviso(texto);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  /** "Testar": uma sonda pela chave do contrato, que vale para as linhas irmãs também. */
  const testar = (l: Linha) => {
    if (!l.contrato) return;
    const chave = l.contrato.chave;
    setOcupado(true);
    setErro(null);
    apiGet<Saude>(`/integrations/${encodeURIComponent(chave)}/saude`, token)
      .then((s) => {
        setData((d) => d && {
          ...d,
          items: d.items.map((i) =>
            i.contrato?.chave !== chave || i.desligado
              ? i
              : { ...i, estado: s.estado, motivo: s.mensagem, medidoEm: s.verificadoEm, latenciaMs: s.latenciaMs, conta: s.estado === 'conectado' ? s.mensagem : null },
          ),
        });
      })
      .catch((e) => setErro((e as Error).message))
      .finally(() => setOcupado(false));
  };

  const acoesDe = (l: Linha, gerenciar: boolean): AcoesDoCartao => {
    const contrato = l.contrato ? encodeURIComponent(l.contrato.chave) : null;
    const alvo = encodeURIComponent(l.grupo ?? l.key);
    /*
     * Leva 5 (L8): o Claude (Anthropic) só tem Testar e a gaveta. Não há OAuth
     * (Conectar), não há o que sincronizar, a remoção da chave mora na gaveta com
     * a frase certa ("volta à variável de ambiente", não "queima sem volta"), e o
     * interruptor de desligamento não conhece a linha (ela é declarada pelo
     * conector, fora de `CONNECTORS`): desligar o modelo é a variável LLM_PROVIDER.
     */
    if (l.key === 'anthropic') return { testar: contrato ? () => testar(l) : undefined };
    return {
      testar: contrato ? () => testar(l) : undefined,
      // No Granola, o "Conectar ao Granola" do conteúdo é a mesma rota (autorização do contrato): não duplica.
      conectar: gerenciar && contrato && l.key !== 'granola'
        ? () => void fazer(async () => {
          const r = await apiPost<RespostaDeVerbo>(`/integrations/${contrato}/autorizacao`, {}, token);
          if (r.tipo === 'redirecionar') {
            const destino = destinoSeguro(r.url);
            if (!destino) throw new Error('O conector devolveu um endereço de autorização que esta tela não abre.');
            window.location.assign(destino);
            return null;
          }
          return textoDoVerbo(r);
        })
        : undefined,
      sincronizar: gerenciar && contrato
        ? () => void fazer(async () => textoDoVerbo(await apiPost<RespostaDeVerbo>(`/integrations/${contrato}/sincronizacao`, {}, token)))
        : undefined,
      desconectar: gerenciar && contrato
        ? (motivo) => void fazer(async () =>
          textoDoVerbo(await apiPost<RespostaDeVerbo>(`/integrations/${contrato}/revogacao`, { motivo: motivo || undefined }, token)))
        : undefined,
      desligar: gerenciar
        ? (motivo) => void fazer(async () => {
          await apiPost(`/integrations/${alvo}/desligamento`, { motivo: motivo || undefined }, token);
          return `${l.grupo ? 'As superfícies do Google foram desligadas' : `"${l.nome}" foi desligado`} nesta empresa.`;
        })
        : undefined,
      religar: gerenciar
        ? () => void fazer(async () => {
          await apiDelete(`/integrations/${alvo}/desligamento`, token);
          return `"${l.nome}" foi religado nesta empresa.`;
        })
        : undefined,
    };
  };

  /*
   * Produção 22B (I6): o conteúdo próprio da Evolution (QR, estado da instância,
   * webhook, segredo do webhook, credencial) e do Granola (conectar, senha do Zap,
   * conexão direta) vai para a gaveta "Configurar" do cartão. Todo cartão fica do
   * mesmo tamanho na grade; nenhuma ação some.
   */
  const configurarDe = (l: Linha, gerenciar: boolean): ReactNode => {
    if (l.key === 'evolution') return <ConexaoEvolution token={token} gerenciar={gerenciar} aoMudar={() => void carregar()} />;
    if (l.key === 'granola') return <ConexaoGranola token={token} gerenciar={gerenciar} desligado={l.desligado} aoMudar={() => void carregar()} />;
    // Leva 5 (L8): a chave do Claude pela tela, o modelo por função e o teto diário.
    if (l.key === 'anthropic') return <ConexaoClaude token={token} gerenciar={gerenciar} aoMudar={() => void carregar()} />;
    return undefined;
  };

  const conteudoDe = (l: Linha): ReactNode => {
    if (GOOGLE.has(l.key)) return <a href="/google" className="text-[11px] text-brand underline">Abrir a página do Google</a>;
    if (l.key === 'instagram') return <a href="/instagram" className="text-[11px] text-brand underline">Abrir a página do Instagram</a>;
    if (l.key === 'obsidian') return <a href="/contexto" className="text-[11px] text-brand underline">Ver a vault em Contexto</a>;
    return null;
  };

  const gerenciar = podeGerenciar && data?.autoridadeGerenciar === true;
  const comProblema = data?.items.filter((i) => i.estado === 'erro') ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-text">Cada conector num cartão só: estado medido agora, quem usa, e as mesmas ações.</p>
          <p className="mt-1 text-xs text-muted" data-testid="legenda-dos-estados">
            Estados: {ESTADOS_DO_CARTAO.filter((e) => e !== 'nao_verificado').map((e) => (e === 'erro' ? 'Erro: <motivo>' : ROTULO_DO_ESTADO_DO_CARTAO[e])).join(' · ')}.
          </p>
        </div>
        <button type="button" disabled={ocupado} onClick={() => void fazer(async () => null)}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted disabled:opacity-50">Atualizar</button>
      </div>

      {erro && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 p-3 text-sm text-bad">{erro}</p>}
      {aviso && (
        <div role="status" className="rounded-lg border border-border bg-surface-2 p-3 text-sm text-text">
          {aviso}
          <button type="button" onClick={() => setAviso(null)} className="ml-3 text-xs text-muted underline">fechar</button>
        </div>
      )}
      {comProblema.length > 0 && (
        <p className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-xs text-text" data-testid="aviso-de-problema">
          {comProblema.length} conector(es) com erro: {comProblema.map((i) => i.nome).join(', ')}. Só o que depende deles está degradado; os outros seguem.
        </p>
      )}
      {!data && !erro && <p className="text-sm text-muted">Medindo os conectores…</p>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data?.items.map((l) => (
          <CartaoDeConexao key={l.key} linha={l} ocupado={ocupado} acoes={acoesDe(l, gerenciar)} configurar={configurarDe(l, gerenciar)}>
            {conteudoDe(l)}
          </CartaoDeConexao>
        ))}
      </div>
      {data && <p className="text-[11px] text-muted">Medido às {new Date(data.geradoEm).toLocaleTimeString("pt-BR")}. A API reaproveita cada medição por até 30 s; "Testar" pede a medição de novo.</p>}
    </div>
  );
}
