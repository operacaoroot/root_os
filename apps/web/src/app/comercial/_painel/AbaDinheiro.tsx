'use client';

/*
 * ABA DINHEIRO (eram as telas 08, 10 e 11: `lead/[id]/fechamento` e
 * `contratos/[leadId]`). Do aceite ao contrato vivo, numa coluna só: o aceite
 * e a cobrança, as parcelas com a régua, o documento e as assinaturas (assinar
 * pela Root só para quem a API deixar), as cinco escritas do fechamento e o
 * que acontece depois do sim. Tudo vem do fio e dos provedores; as escritas
 * vão à porta (R4) e esperam a titular em /atendimento.
 */
import { useState } from 'react';
import type { ContratoVivo, EscritaDoFechamento, FechamentoDoLead, FichaDoLead } from '@mktos/shared';
import { COMERCIAL_FATOS_DA_PRIMEIRA_PAGA, ehSaida } from '@mktos/shared';

import { apiBlob, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AUSENTE, ROTULO_DO_PRODUTO, contarParcelas, dataDoDia, ficouRetida, numeroOuAusente, quandoCurtoSP, reaisOuAusente, segundos } from '@/lib/cockpit';

import { AguardandoAprovacao, Aviso, BOTAO, BOTAO_PRIMARIO, CARTAO, Carregando, Chip, Erro, ErroDaAcao, INPUT, Rotulo, useCarregar } from '../_ui';
import { ContratosImportados } from './ContratosImportados';
import { usePainel } from './provedor';

/** T1b: `contratoAnexado` só vem para quem fechou fora do sistema (o PDF assinado, registrado à mão). */
type Fechamento = FechamentoDoLead & {
  aprovacao: { id: string; status: string } | null;
  vetado: boolean;
  contratoAnexado?: { nome: string; bytes: number; sha256: string; assinadoEm: string; por: string | null } | null;
};

const ROTULO_DA_ESCRITA: Record<EscritaDoFechamento['escrita'], string> = {
  cliente: 'cliente',
  contrato: 'contrato',
  cobranca: 'cobrança',
  kit_e_trilho: 'kit e trilho',
  card: 'card da implantação',
  grupo: 'grupo',
};

const ROTULO_DO_ESTADO: Record<FechamentoDoLead['estado'], string> = {
  pendente: 'pendente',
  em_curso: 'em curso',
  concluido: 'concluído',
  erro: 'com erro',
};

const ROTULO_DA_FORMA: Record<string, string> = { pix: 'Pix', boleto: 'boleto', cartao: 'cartão' };

/** O instante do primeiro fato de um tipo no fio (ou nulo). */
function quandoNoFio(f: FichaDoLead | null, ...tipos: string[]): string | null {
  const l = (f?.fio ?? []).find((x) => tipos.includes(x.type));
  return l?.em ?? null;
}

export function AbaDinheiro({ leadId, ficha: f, aoMudar }: { leadId: string; ficha: FichaDoLead | null; aoMudar: () => Promise<void> }) {
  const id = encodeURIComponent(leadId);
  const fech = useCarregar<Fechamento>(`/comercial/fechamentos/${id}`, 15_000);
  const vivo = useCarregar<ContratoVivo>(`/comercial/contratos/${id}`, 60_000);
  const mudou = async () => {
    await Promise.all([fech.recarregar(), vivo.recarregar(), aoMudar()]);
  };

  if (!f && (fech.carregando || vivo.carregando)) return <Carregando linhas={4} altura="h-24" />;

  const aceitaEm = quandoNoFio(f, 'proposta.aceita');
  const cobrancaEm = quandoNoFio(f, 'cobranca.criada');
  const pagaEm = quandoNoFio(f, ...COMERCIAL_FATOS_DA_PRIMEIRA_PAGA);
  const geradoEm = quandoNoFio(f, 'contrato.gerado');
  const clienteEm = quandoNoFio(f, 'contrato.assinado_cliente');
  const rootEm = quandoNoFio(f, 'contrato.assinado_root');
  const ativoEm = quandoNoFio(f, 'cliente.ativo');
  const emSaida = f ? ehSaida(f.etapa) : false;
  // Sem a ficha, o fio não foi lido: os marcos ficam ausentes, nunca "ainda não".
  if (!f) {
    return (
      <div className="space-y-4">
        <p className="text-[12.5px] text-muted">O lead não pôde ser lido agora: aceite, cobrança e assinaturas ficam ausentes até a ficha voltar.</p>
        <section className={`${CARTAO} space-y-2`} aria-label="fechamento">
          <Fechamento leadId={leadId} f={fech.dados} erro={fech.erro} aoTentar={() => void fech.recarregar()} aoMudar={mudou} />
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className={`${CARTAO} space-y-2`} aria-label="aceite e cobrança">
        <Rotulo>aceite e cobrança</Rotulo>
        {f && (
          <p className="text-[13px] tabular-nums">
            {f.produto ? ROTULO_DO_PRODUTO[f.produto] : 'produto ausente'} · {reaisOuAusente(f.valorCentavos)}
            {f.parcelas ? ` em ${f.parcelas}×` : ''}
            {f.forma ? ` · ${ROTULO_DA_FORMA[f.forma] ?? f.forma}` : ' · forma ausente'}
            {f.validade ? ` · proposta vale até ${quandoCurtoSP(f.validade)}` : ''}
          </p>
        )}
        <ul className="space-y-1 text-[12.5px]">
          <Marco feito={aceitaEm} rotulo="proposta aceita na sala" />
          <Marco feito={cobrancaEm} rotulo={`cobrança criada no Asaas${f?.ligadoA.cobranca ? ` · ${f.ligadoA.cobranca}` : ''}`} />
          <Marco feito={pagaEm} rotulo="primeira parcela paga" />
        </ul>
        {aceitaEm && !cobrancaEm && !emSaida && <ProporAceite leadId={leadId} aoMudar={mudou} />}
        {!aceitaEm && <p className="text-[12px] text-dim">O aceite acontece na sala do cliente. Até lá, nada de cobrança.</p>}
      </section>

      <section className={CARTAO} aria-label="parcelas">
        <Rotulo>parcelas e régua de cobrança</Rotulo>
        {vivo.erro ? (
          <div className="mt-2"><Erro erro={vivo.erro} aoTentar={() => void vivo.recarregar()} /></div>
        ) : !vivo.dados ? (
          <div className="mt-2"><Carregando linhas={2} altura="h-6" /></div>
        ) : vivo.dados.parcelas.length === 0 && vivo.dados.importados?.length ? (
          <ContratosImportados itens={vivo.dados.importados} />
        ) : vivo.dados.parcelas.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-muted">Nenhuma parcela ainda: elas nascem com a cobrança.</p>
        ) : (
          <Parcelas c={vivo.dados} />
        )}
      </section>

      <section className={`${CARTAO} space-y-2`} aria-label="documento e assinaturas">
        <Rotulo>documento e assinaturas</Rotulo>
        <ul className="space-y-1 text-[12.5px]">
          <Marco feito={geradoEm} rotulo={`contrato gerado${f?.ligadoA.contrato ? ` · ${f.ligadoA.contrato}` : ''}`} />
          <Marco feito={clienteEm} rotulo="assinado pelo cliente" />
          <Marco feito={rootEm} rotulo="assinado pela Root" />
        </ul>
        {geradoEm && !rootEm && <AssinarPelaRoot leadId={leadId} aoMudar={mudou} />}
        {!geradoEm && <p className="text-[12px] text-dim">O contrato é gerado depois do aceite, pela porta (R4: pede a titular).</p>}
      </section>

      <section className={`${CARTAO} space-y-2`} aria-label="fechamento">
        <Fechamento leadId={leadId} f={fech.dados} erro={fech.erro} aoTentar={() => void fech.recarregar()} aoMudar={mudou} />
      </section>

      <section className={`${CARTAO} space-y-2`} aria-label="contrato vivo">
        <Rotulo>contrato vivo</Rotulo>
        {!ativoEm ? (
          <p className="text-[12.5px] text-muted">O contrato vivo nasce quando o fechamento conclui: entregas, marcos e saúde aparecem aqui.</p>
        ) : vivo.dados ? (
          <ContratoVivoResumo c={vivo.dados} ativoEm={ativoEm} />
        ) : (
          <Carregando linhas={2} altura="h-6" />
        )}
      </section>
    </div>
  );
}

function Marco({ feito, rotulo }: { feito: string | null; rotulo: string }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden className={feito ? 'text-good' : 'text-dim'}>{feito ? '●' : '○'}</span>
      <span className={feito ? '' : 'text-muted'}>{rotulo}</span>
      <span className="ml-auto font-os-mono text-[11.5px] tabular-nums text-dim">{feito ? quandoCurtoSP(feito) : 'ainda não'}</span>
      <span className="sr-only">{feito ? 'feito' : 'a fazer'}</span>
    </li>
  );
}

function Parcelas({ c }: { c: ContratoVivo }) {
  const p = contarParcelas(c.parcelas);
  return (
    <>
      <p className="mt-2 text-[12.5px] tabular-nums text-muted">
        {p.pagas} de {p.total} pagas{p.atrasadas ? ` · ${p.atrasadas} atrasada${p.atrasadas > 1 ? 's' : ''}` : ''}
      </p>
      <ul className="mt-1 divide-y divide-border text-[13px]">
        {c.parcelas.map((x) => (
          <li key={x.n} className="flex flex-wrap items-center gap-2 py-1.5 tabular-nums">
            <span className="font-os-mono">{x.n}/{x.total}</span>
            <span>{reaisOuAusente(x.valorCentavos)}</span>
            <Chip tom={x.estado === 'paga' ? 'bom' : x.estado === 'atrasada' ? 'ruim' : 'neutro'}>{x.estado}</Chip>
            <span className="text-muted">{x.estado === 'paga' && x.pagaEm ? `paga ${quandoCurtoSP(x.pagaEm)}` : `vence ${dataDoDia(x.vence)}`}</span>
            {x.aviso && <span className="w-full text-[12px] text-warn">{x.aviso}</span>}
          </li>
        ))}
      </ul>
      {c.reguaDeCobranca.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[12px] text-muted">
          {c.reguaDeCobranca.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
    </>
  );
}

function ContratoVivoResumo({ c, ativoEm }: { c: ContratoVivo; ativoEm: string }) {
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] tabular-nums text-muted">
        cliente ativo desde {quandoCurtoSP(ativoEm)}
        {c.descontoPct != null ? ` · ${c.descontoPct}% aprovado` : ''}
        {' · '}implantação {c.faseDaImplantacao ? `fase ${c.faseDaImplantacao.atual} de ${c.faseDaImplantacao.total}` : AUSENTE}
        {' · '}saúde {numeroOuAusente(c.saude)} (fórmula [a decidir] pela mesa)
      </p>
      <div>
        <Rotulo>entregas</Rotulo>
        <ul className="mt-1 space-y-1 text-[13px]">
          {c.entregas.map((e) => (
            <li key={e.texto} className="flex gap-2">
              <span aria-hidden className={e.feito ? 'text-good' : 'text-dim'}>{e.feito ? '●' : '○'}</span>
              <span className={e.feito ? '' : 'text-muted'}>{e.texto}</span>
              <span className="sr-only">{e.feito ? 'feito' : 'a fazer'}</span>
            </li>
          ))}
          {c.entregas.length === 0 && <li className="text-muted">Nenhuma entrega listada ainda.</li>}
        </ul>
        <p className="mt-1 text-[12.5px] text-muted">Primeiro valor percebido: {c.primeiroValorEm ? quandoCurtoSP(c.primeiroValorEm) : AUSENTE}.</p>
      </div>
      <div>
        <Rotulo>próximos marcos, já agendados</Rotulo>
        <ul className="mt-1 space-y-1 text-[13px]">
          {c.marcos.map((m) => (
            <li key={m.chave} className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
              <span className="font-os-mono text-[12px] tabular-nums text-brand">{m.quando ? quandoCurtoSP(m.quando) : 'sem data'}</span>
              <span className={m.feito ? 'text-muted line-through' : ''}>{m.rotulo}</span>
            </li>
          ))}
          {c.marcos.length === 0 && <li className="text-muted">Nenhum marco agendado.</li>}
        </ul>
        {/* C-17: aditivo só aparece quando a API contar; nulo não vira "nenhum". */}
        {c.aditivos != null && <p className="mt-1 text-[12.5px] text-muted">Aditivos: {c.aditivos === 0 ? 'nenhum' : c.aditivos}.</p>}
      </div>
    </div>
  );
}

function ProporAceite({ leadId, aoMudar }: { leadId: string; aoMudar: () => Promise<void> }) {
  const { token } = useAuth();
  const painel = usePainel();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const [retida, setRetida] = useState<string | null>(null);
  async function propor() {
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await apiPost<{ pulado?: string; approvalIds?: string[] }>(`/comercial/aceites/${leadId}/propor`, {}, token);
      if (r?.pulado) painel.avisar(`Nada novo foi proposto: ${r.pulado}.`, 'neutro');
      else {
        setRetida(r?.approvalIds?.[0] ?? null);
        painel.avisar('A cobrança e o contrato foram à porta. A titular assina em /atendimento.');
      }
      await aoMudar();
    } catch (e) {
      setErro(e);
    } finally {
      setEnviando(false);
    }
  }
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted">Aceita e sem cobrança: a aprovação anterior pode ter vencido. Propor de novo não duplica nada.</p>
      <button type="button" className={BOTAO} disabled={enviando} onClick={() => void propor()}>
        {enviando ? 'Propondo…' : 'Propor a cobrança e o contrato de novo'}
      </button>
      {retida && <AguardandoAprovacao approvalId={retida} oQue="A cobrança (R4) espera a assinatura da titular." />}
      <ErroDaAcao erro={erro} />
    </div>
  );
}

function AssinarPelaRoot({ leadId, aoMudar }: { leadId: string; aoMudar: () => Promise<void> }) {
  const { token, can } = useAuth();
  const painel = usePainel();
  const [r, setR] = useState<{ linkAssinatura: string | null; assinadoRootEm: string | null } | null>(null);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);
  async function pedir() {
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await apiPost<{ linkAssinatura: string | null; assinadoRootEm: string | null }>(`/comercial/contratos/${leadId}/assinar-pela-root`, { senha }, token);
      setR(r);
      painel.avisar(r?.assinadoRootEm ? 'A Root já assinou este contrato.' : r?.linkAssinatura ? 'Senha conferida: o link de assinatura da Root está logo abaixo.' : 'Senha conferida. O link da Root ainda não chegou do provedor.', 'neutro');
      await aoMudar();
    } catch (e) {
      setErro(e);
    } finally {
      setSenha('');
      setEnviando(false);
    }
  }
  if (!can('leads.editar')) return <p className="text-[12px] text-dim">Assinar pela Root pede o perfil que opera o comercial e a titularidade cadastrada.</p>;
  return (
    <form
      className="space-y-2 rounded border border-border bg-bg p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void pedir();
      }}
    >
      <p className="text-[12.5px] text-muted">Só o sócio titular cadastrado para assinar recebe o link, depois de confirmar a senha. A assinatura volta pelo provedor e entra no fio.</p>
      <label className="block text-[12.5px]">
        sua senha
        <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} className={`mt-1 ${INPUT}`} />
      </label>
      <button type="submit" className={BOTAO_PRIMARIO} disabled={!senha || enviando}>{enviando ? 'Conferindo…' : 'Assinar pela Root'}</button>
      {r && (
        <p className="text-[12.5px]">
          {r.assinadoRootEm ? `Assinado pela Root ${quandoCurtoSP(r.assinadoRootEm)}.` : r.linkAssinatura ? (
            <a href={r.linkAssinatura} target="_blank" rel="noreferrer" className="underline decoration-brand underline-offset-2">abrir o link de assinatura</a>
          ) : 'O link de assinatura da Root ainda não chegou do provedor.'}
        </p>
      )}
      <ErroDaAcao erro={erro} />
    </form>
  );
}

function Fechamento({ leadId, f, erro, aoTentar, aoMudar }: { leadId: string; f: Fechamento | null; erro: unknown; aoTentar: () => void; aoMudar: () => Promise<void> }) {
  const { token } = useAuth();
  const painel = usePainel();
  const [resposta, setResposta] = useState<unknown>(null);
  const [erroDaAcao, setErroDaAcao] = useState<unknown>(null);
  const [ocupado, setOcupado] = useState(false);

  async function rodar() {
    if (ocupado) return;
    setOcupado(true);
    setErroDaAcao(null);
    try {
      const r = await apiPost(`/comercial/fechamentos/${leadId}/rodar`, {}, token);
      setResposta(r);
      const pulado = r && typeof r === 'object' && 'pulado' in r ? String((r as { pulado: string }).pulado) : null;
      painel.avisar(pulado ? `Nada novo foi proposto: ${pulado}.` : 'Fechamento proposto. A titular assina em /atendimento.', pulado ? 'neutro' : 'bom');
      await aoMudar();
    } catch (e) {
      setErroDaAcao(e);
    } finally {
      setOcupado(false);
    }
  }

  if (erro) return <><Rotulo>fechamento</Rotulo><Erro erro={erro} aoTentar={aoTentar} /></>;
  if (!f) return <><Rotulo>fechamento</Rotulo><Carregando linhas={2} altura="h-6" /></>;
  const retida = ficouRetida(resposta) ? (resposta as { approvalId: string }).approvalId : f.aprovacao?.id ?? null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Rotulo>fechamento · as cinco escritas</Rotulo>
        <Chip tom={f.estado === 'concluido' ? 'bom' : f.estado === 'erro' ? 'ruim' : 'alerta'}>{ROTULO_DO_ESTADO[f.estado] ?? f.estado}</Chip>
        {f.vetado && <Chip tom="ruim">vetado</Chip>}
        {f.chave && <span className="ml-auto font-os-mono text-[11px] text-dim">chave {f.chave}</span>}
      </div>
      {retida && f.estado !== 'concluido' && <AguardandoAprovacao approvalId={retida} oQue="O fechamento (R4) espera a assinatura da titular." />}
      {f.contratoAnexado && <ContratoAnexado leadId={leadId} anexo={f.contratoAnexado} />}
      <ul className="divide-y divide-border">
        {f.escritas.map((e) => (
          <li key={e.escrita} className="grid gap-1 py-2 text-[13px] sm:grid-cols-[96px_minmax(0,1fr)_64px] sm:gap-3">
            <span className="font-semibold">{ROTULO_DA_ESCRITA[e.escrita] ?? e.escrita}</span>
            <span className="min-w-0 break-words">
              <Chip tom={e.estado === 'erro' ? 'ruim' : e.estado === 'pendente' || e.estado === 'pulado' ? 'neutro' : 'bom'}>{e.estado}</Chip>
              <span className="ml-1.5 text-muted">{e.onde}</span>
              {e.detalhe && <span className="ml-1.5 text-muted">· {e.detalhe}</span>}
              <span className="block text-[11.5px] text-dim">se rodar de novo: {e.seRodarDeNovo}</span>
            </span>
            <span className="font-os-mono text-[12px] tabular-nums text-muted sm:text-right">{e.ms == null ? AUSENTE : segundos(e.ms)}</span>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-muted">
        Copiado sem redigitar: {f.copiadoSemRedigitar.length ? f.copiadoSemRedigitar.join(', ') : 'nada ainda'}.{' '}
        {f.iniciadoEm ? `Começou ${quandoCurtoSP(f.iniciadoEm)}` : 'Ainda não começou'}{f.concluidoEm ? `, terminou ${quandoCurtoSP(f.concluidoEm)}` : ''}. Versão {f.versao || AUSENTE}.
      </p>
      {f.estado !== 'concluido' && (
        <div className="space-y-2">
          <p className="text-[12px] text-dim">
            {f.contratoAnexado
              ? 'Cliente fechado fora do sistema: o fechamento vai à fila quando o registro é feito, e quem registrou não assina. Se a aprovação venceu, proponha de novo: a chave impede duplicar.'
              : 'O fechamento é proposto sozinho quando a primeira parcela está paga e as duas assinaturas estão no fio. Se a aprovação venceu, proponha de novo: a chave impede duplicar, e quem propõe não assina.'}
          </p>
          <button type="button" className={BOTAO} disabled={ocupado} onClick={() => void rodar()}>
            {ocupado ? 'Propondo…' : 'Propor o fechamento de novo'}
          </button>
          <ErroDaAcao erro={erroDaAcao} />
        </div>
      )}
      {f.estado === 'concluido' && <Aviso tom="bom">Fechado: as cinco escritas terminaram e o cliente está ativo.</Aviso>}
    </>
  );
}

/** T1b: o contrato assinado fora do sistema, para baixar e conferir antes de assinar o fechamento. */
function ContratoAnexado({ leadId, anexo }: { leadId: string; anexo: NonNullable<Fechamento['contratoAnexado']> }) {
  const { token } = useAuth();
  const [erro, setErro] = useState<unknown>(null);
  async function baixar() {
    setErro(null);
    try {
      const blob = await apiBlob(`/comercial/lead/${leadId}/contrato-anexado`, token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = anexo.nome;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setErro(e);
    }
  }
  return (
    <div className="space-y-1 rounded border border-border px-3 py-2 text-[12.5px]" data-testid="contrato-anexado">
      <p>
        Contrato assinado fora do sistema{anexo.assinadoEm ? ` em ${dataDoDia(anexo.assinadoEm)}` : ''}, registrado à mão{anexo.por ? ` por ${anexo.por}` : ''}.{' '}
        <button type="button" className="underline decoration-dotted hover:text-brand" onClick={() => void baixar()}>
          baixar o PDF ({anexo.nome})
        </button>
      </p>
      <ErroDaAcao erro={erro} />
    </div>
  );
}
