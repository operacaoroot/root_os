'use client';

/*
 * OS DADOS DO CONTRATO: modalidade, vigência, número e o CNPJ que fatura como texto
 * (a decisão D6: vazio recusa o envio; o código não adivinha). `PATCH` só com o que
 * mudou. Encerrado, vira só leitura. Antes do envio, modalidade e CNPJ moram na seção
 * Emitir (entram no documento): aqui ficam número e vigência.
 */
import { useState } from 'react';
import { ContratoEditarSchema, MODALIDADES_DE_CONTRATO, ROTULO_DA_MODALIDADE, type ContratoEditarInput, type ContratoNaFicha, type ModalidadeDeContrato } from '@mktos/shared';

import { apiPatch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { reaisOuAusente } from '@/lib/cockpit';

import { BOTAO_PRIMARIO, CARTAO, INPUT, ROTULO, Rotulo } from '../_ui';
import { RetornoDaAcao, useAcaoDoContrato } from './acao';
import { CAMINHO_DO_REGISTRO, dataCompleta } from './regras';

interface Campos {
  modalidade: '' | ModalidadeDeContrato;
  numero: string;
  vigenciaInicio: string;
  vigenciaFim: string;
  faturaPor: string;
}

const dosDados = (c: ContratoNaFicha): Campos => ({
  modalidade: c.modalidade ?? '',
  numero: c.numero ?? '',
  vigenciaInicio: c.vigenciaInicio?.slice(0, 10) ?? '',
  vigenciaFim: c.vigenciaFim?.slice(0, 10) ?? '',
  faturaPor: c.faturaPor ?? '',
});

/** Só o que mudou; apagar um campo manda nulo. A modalidade não se apaga. */
function oQueMudou(antes: Campos, agora: Campos): ContratoEditarInput {
  const mudou: ContratoEditarInput = {};
  if (agora.modalidade && agora.modalidade !== antes.modalidade) mudou.modalidade = agora.modalidade;
  for (const k of ['numero', 'vigenciaInicio', 'vigenciaFim', 'faturaPor'] as const) {
    const v = agora[k].trim();
    if (v !== antes[k]) mudou[k] = v || null;
  }
  return mudou;
}

export function DadosDoContrato({ c, podeEditar, aoMudar }: { c: ContratoNaFicha; podeEditar: boolean; aoMudar: () => Promise<void> }) {
  const { token } = useAuth();
  const acao = useAcaoDoContrato(aoMudar);
  const editavel = podeEditar && c.estado !== 'encerrado' && c.estado !== 'cancelado';
  const lidos = dosDados(c);
  // O que a pessoa está escrevendo vence a releitura periódica; salvo ou desfeito, volta ao que a API diz.
  const [editados, setEditados] = useState<Campos | null>(null);
  const campos = editados ?? lidos;
  const mudou = oQueMudou(lidos, campos);
  const sujo = Object.keys(mudou).length > 0;
  const conferido = ContratoEditarSchema.safeParse(mudou);
  const ignorar = sujo ? {} : { 'data-painel-ignorar': '' };
  const naEmissao = !!c.emissao;
  const mudar = (parte: Partial<Campos>) => setEditados({ ...campos, ...parte });

  const salvar = async () => {
    if (!conferido.success) return;
    const valeu = await acao.rodar('salvar', () => apiPatch(`${CAMINHO_DO_REGISTRO}/${encodeURIComponent(c.id)}`, conferido.data, token), 'Dados salvos.');
    if (valeu) setEditados(null);
  };

  return (
    <section className={`${CARTAO} space-y-2`} aria-label="o contrato" data-testid="contrato-dados">
      <Rotulo>o contrato</Rotulo>
      <dl className="grid grid-cols-2 gap-2 text-[12.5px]">
        <div><dt className={ROTULO}>Valor</dt><dd className="font-os-mono tabular-nums">{c.valorCentavos == null ? 'sem valor' : reaisOuAusente(c.valorCentavos)}</dd></div>
        <div><dt className={ROTULO}>Hash do PDF</dt><dd className="font-os-mono" title={c.hashDoConteudo ?? undefined}>{c.hashDoConteudo ? `${c.hashDoConteudo.slice(0, 4)}…${c.hashDoConteudo.slice(-4)}` : 'sem PDF'}</dd></div>
      </dl>
      {editavel ? (
        <div className="grid grid-cols-2 gap-2">
          {!naEmissao && <label className="flex flex-col gap-1">
            <span className={ROTULO}>Modalidade</span>
            <select data-testid="contrato-modalidade" className={`${INPUT} max-md:min-h-[44px]`} value={campos.modalidade} onChange={(e) => mudar({ modalidade: e.target.value as ModalidadeDeContrato })}>
              {!campos.modalidade && <option value="">a definir</option>}
              {MODALIDADES_DE_CONTRATO.map((m) => <option key={m} value={m}>{ROTULO_DA_MODALIDADE[m]}</option>)}
            </select>
          </label>}
          <label className="flex flex-col gap-1">
            <span className={ROTULO}>Número</span>
            <input data-testid="contrato-numero" className={`${INPUT} font-os-mono max-md:min-h-[44px]`} maxLength={60} value={campos.numero} onChange={(e) => mudar({ numero: e.target.value })} {...ignorar} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ROTULO}>Vigência: início</span>
            <input data-testid="contrato-vigencia-inicio" type="date" className={`${INPUT} max-md:min-h-[44px]`} value={campos.vigenciaInicio} onChange={(e) => mudar({ vigenciaInicio: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ROTULO}>Vigência: fim</span>
            <input data-testid="contrato-vigencia-fim" type="date" className={`${INPUT} max-md:min-h-[44px]`} value={campos.vigenciaFim} onChange={(e) => mudar({ vigenciaFim: e.target.value })} />
          </label>
          {!naEmissao && <label className="col-span-2 flex flex-col gap-1">
            <span className={ROTULO}>CNPJ que fatura</span>
            <input data-testid="contrato-fatura-por" className={`${INPUT} max-md:min-h-[44px]`} maxLength={200} placeholder="a decidir: sem ele o envio é recusado" value={campos.faturaPor} onChange={(e) => mudar({ faturaPor: e.target.value })} {...ignorar} />
          </label>}
          <div className="col-span-2">
            <button type="button" data-testid="contrato-dados-salvar" className={BOTAO_PRIMARIO} disabled={!sujo || !conferido.success || acao.ocupado !== null} onClick={() => void salvar()}>Salvar dados</button>
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-2 text-[12.5px]">
          <div><dt className={ROTULO}>Modalidade</dt><dd>{c.modalidade ? ROTULO_DA_MODALIDADE[c.modalidade] : 'a definir'}</dd></div>
          <div><dt className={ROTULO}>Número</dt><dd className="font-os-mono">{c.numero ?? 'sem número'}</dd></div>
          <div><dt className={ROTULO}>Vigência</dt><dd>{c.vigenciaInicio || c.vigenciaFim ? `${dataCompleta(c.vigenciaInicio) || 'sem início'} a ${dataCompleta(c.vigenciaFim) || 'sem fim'}` : 'não lançada'}</dd></div>
          <div><dt className={ROTULO}>CNPJ que fatura</dt><dd className={c.faturaPor ? '' : 'text-warn'}>{c.faturaPor ?? 'a decidir'}</dd></div>
        </dl>
      )}
      <RetornoDaAcao acao={acao} testId="contrato-dados-retido" />
    </section>
  );
}
