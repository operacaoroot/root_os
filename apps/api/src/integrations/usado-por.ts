import { CADASTRO_DE_FUNCOES, type FuncaoDoCadastro, type QuemUsaOConector } from '@mktos/shared';
import { CONECTOR_DA_CAPACIDADE } from './conectores';

/*
 * QUEM USA CADA CONECTOR — rodada dos agentes, lane A6 (21/10/2026).
 *
 * O cartão de Conexões diz quais agentes, rotinas e automações dependem de cada
 * linha do catálogo. A fonte é o CADASTRO ÚNICO (`packages/shared/src/agentes.ts`),
 * por dois caminhos:
 *
 *   1. PELA CAPACIDADE: a função declara capacidades da política, e cada
 *      capacidade aponta o conector que ela usa (`CONECTOR_DA_CAPACIDADE`, o
 *      mesmo mapa do interruptor). É o caminho que não envelhece: capacidade
 *      nova no cadastro aparece no cartão sozinha;
 *   2. À MÃO, abaixo: o que não passa por capacidade (rotina que fala com o
 *      fornecedor direto, entrada por webhook, leitura de vetores). Cada linha
 *      diz por quê. Função que não existe mais no cadastro é ignorada (e a
 *      suíte acusa), para o mapa não segurar nome velho.
 *
 * Função aposentada não aparece: ela não usa mais nada.
 */
export const USO_SEM_CAPACIDADE: Readonly<Record<string, readonly string[]>> = {
  // A rotina da casa que espelha o ClickUp (RO-01), direto pelo token do processo.
  clickup: ['RO-01'],
  // O coletor da bio (RO-02) lê as plataformas da Meta para a página de links.
  instagram: ['RO-02'],
  // A vault indexada (CE-05) e o leitor da Ficha/Contexto.
  obsidian: ['CE-05'],
  // Os vetores da vault (CE-05) e a transcrição do áudio do link do onboarding (IM-06).
  openai: ['CE-05', 'IM-06'],
  // O Granola: o leitor de atas do Trabalho (TR-02) e a reunião que chega no card (TR-03).
  granola: ['TR-02', 'TR-03'],
  // A conciliação (FI-02) puxa extrato e cobranças do Asaas e dos bancos; o cobrador (FI-04) lê o Asaas.
  asaas: ['FI-02', 'FI-04'],
  pluggy: ['FI-02'],
  // O OFX entra pelo Financeiro e a conciliação (FI-02) casa os lançamentos.
  ofx: ['FI-02'],
  // A ficha da referência (CT-02) e a coleta da Pauta (CT-03) rodam actors do Apify.
  apify: ['CT-02', 'CT-03'],
  // O WhatsApp do processo: o aviso de aprovação (CA-02) e o grupo de links da Pauta (CT-18).
  whatsapp: ['CA-02', 'CT-18'],
  // O WhatsApp do comercial: as mensagens ao lead (CO-01, CO-02, CO-07 pela capacidade do comercial,
  // que o interruptor mapeia para a linha do processo), o grupo do cliente no fechamento (CO-10) e a
  // entrada das respostas com a triagem (CO-16).
  evolution: ['CO-01', 'CO-02', 'CO-07', 'CO-10', 'CO-16'],
};

function resumo(f: FuncaoDoCadastro): QuemUsaOConector {
  return { id: f.id, nome: f.nome, tipo: f.tipo, estado: f.estado };
}

/** As funções vivas que usam a linha `chave` do catálogo, na ordem do cadastro. */
export function quemUsa(chave: string, cadastro: readonly FuncaoDoCadastro[] = CADASTRO_DE_FUNCOES): QuemUsaOConector[] {
  const aMao = new Set(USO_SEM_CAPACIDADE[chave] ?? []);
  return cadastro
    .filter((f) => f.estado !== 'aposentado')
    .filter((f) => aMao.has(f.id) || (f.capacidades ?? []).some((c) => CONECTOR_DA_CAPACIDADE[c] === chave))
    .map(resumo);
}
