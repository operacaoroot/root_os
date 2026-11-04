'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { COMERCIAL_ROTULO_DA_ETAPA, ROTULO_DA_MODALIDADE, type ComercialEtapa, type ModalidadeDeContrato } from '@mktos/shared';
import { ClienteEscopo, type ClienteDaCarteira } from '@/components/clientes/ClienteEscopo';
import { BOTAO_DA_CARTEIRA, SelecaoDaCarteira } from '@/components/clientes/SelecaoDaCarteira';
import { useAuth } from '@/lib/auth';
import { reaisOuAusente } from '@/lib/cockpit';
import { RegistrosPaginadosDaCarteira } from '@/components/clientes/RegistrosPaginadosDaCarteira';
import { diaCompleto } from '@/lib/datas-do-cartao';

type Lead = {
  leadId: string;
  clienteId: string;
  nome: string;
  empresa?: string | null;
  etapa: ComercialEtapa;
  produto?: string | null;
  valorCentavos?: number | null;
  etapaDesde?: string | null;
  telefone?: string | null;
  email?: string | null;
};
type Contrato = {
  id: string;
  clienteId: string;
  numero?: string | null;
  nome?: string | null;
  empresa?: string | null;
  tipo?: string | null;
  modalidade?: ModalidadeDeContrato | null;
  estado?: string | null;
  valorCentavos?: number | null;
  vigenciaInicio?: string | null;
  vigenciaFim?: string | null;
};
type Registro = Lead | Contrato;
type Secao = 'leads' | 'contratos';

const ESTADOS_DO_CONTRATO: Record<string, string> = {
  rascunho: 'Rascunho', a_emitir: 'A emitir', em_assinatura: 'Em assinatura', assinado: 'Assinado',
  ativo: 'Ativo', encerrado: 'Encerrado', cancelado: 'Cancelado',
};
const TIPOS_DO_CONTRATO: Record<string, string> = { contrato: 'Contrato', aditivo: 'Aditivo', distrato: 'Distrato' };

function idDoRegistro(r: Registro, secao: Secao) {
  if (secao === 'leads') return !('id' in r) ? r.leadId : undefined;
  return 'id' in r ? r.id : undefined;
}
function tituloDoRegistro(r: Registro) {
  return !('id' in r) ? r.nome : r.numero || (r.tipo && TIPOS_DO_CONTRATO[r.tipo]) || 'Contrato sem número';
}
function etapaDoRegistro(r: Registro) {
  return !('id' in r) ? COMERCIAL_ROTULO_DA_ETAPA[r.etapa] : r.estado && ESTADOS_DO_CONTRATO[r.estado];
}

export function ComercialEscopo({ children }: { children: ReactNode }) {
  const caminho = usePathname();
  const { can } = useAuth();
  return (
    <ClienteEscopo restrito={(clientes, token) => can('leads.ver')
      ? <ComercialDaCarteira key={caminho} clientes={clientes} token={token} inicial={caminho?.startsWith('/comercial/contratos') ? 'contratos' : 'leads'} />
      : <p className="text-sm text-muted">Seu acesso atual não permite abrir o Comercial.</p>}>
      {children}
    </ClienteEscopo>
  );
}

function ComercialDaCarteira({ clientes, token, inicial }: {
  clientes: ClienteDaCarteira[]; token: string; inicial: Secao;
}) {
  const [secao, setSecao] = useState(inicial);
  return (
    <section className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-lg font-semibold">Comercial por cliente</h1>
      <SelecaoDaCarteira clientes={clientes} rotulo="Cliente do Comercial">
        {(cliente) => (
          <>
            <div role="group" aria-label="Dados do Comercial" className="flex flex-wrap gap-2">
              {(['leads', 'contratos'] as const).map((s) => (
                <button key={s} type="button" aria-pressed={secao === s}
                  className={`${BOTAO_DA_CARTEIRA}${secao === s ? ' border-brand text-brand' : ''}`}
                  onClick={() => setSecao(s)}>
                  {s === 'leads' ? 'Leads' : 'Contratos'}
                </button>
              ))}
            </div>
            <RegistrosPaginadosDaCarteira<Registro> key={`${cliente.id}:${secao}`} clienteId={cliente.id}
              token={token} base={`/comercial/carteira/${secao}`}
              rotulo={secao === 'leads' ? 'Leads do cliente' : 'Contratos do cliente'}
              buscaRotulo={secao === 'leads' ? 'Buscar leads' : 'Buscar contratos'}
              vazio={secao === 'leads' ? 'Nenhum lead encontrado.' : 'Nenhum contrato encontrado.'}
              identificar={(r) => idDoRegistro(r, secao)} titulo={tituloDoRegistro} subtitulo={etapaDoRegistro}
              detalhe={(registro) => <CamposDoRegistro registro={registro} />} />
          </>
        )}
      </SelecaoDaCarteira>
    </section>
  );
}

function CamposDoRegistro({ registro: r }: { registro: Registro }) {
  const etapa = etapaDoRegistro(r);
  const campos = !('id' in r)
    ? [['Empresa', r.empresa], ['Etapa', etapa], ['Produto', r.produto], ['Valor', reaisOuAusente(r.valorCentavos)],
      ['Na etapa desde', diaCompleto(r.etapaDesde)], ['Telefone', r.telefone], ['E-mail', r.email]]
    : [['Nome', r.nome], ['Empresa', r.empresa], ['Tipo', r.tipo && TIPOS_DO_CONTRATO[r.tipo]], ['Modalidade', r.modalidade && ROTULO_DA_MODALIDADE[r.modalidade]],
      ['Estado', etapa], ['Valor do contrato', reaisOuAusente(r.valorCentavos)],
      ['Início da vigência', diaCompleto(r.vigenciaInicio)], ['Fim da vigência', diaCompleto(r.vigenciaFim)]];
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {campos.filter(([, valor]) => valor).map(([rotulo, valor]) => (
        <div key={rotulo} className="min-w-0 break-words">
          <dt className="text-muted">{rotulo}</dt>
          <dd>{valor}</dd>
        </div>
      ))}
    </dl>
  );
}
