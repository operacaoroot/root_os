/*
 * A porta do roster. Quem está de fora de `agents/roster/` importa daqui, para
 * que a arrumação interna da pasta não vire trabalho de outro módulo.
 */
export {
  CHAVE_DO_RETRATO,
  PROCEDIMENTO_DO_CARREGADOR,
  SLUG_DO_ASSISTENTE,
  SLUG_DO_CARREGADOR,
  TEMAS_DA_CARGA,
  TEMAS_OBRIGATORIOS,
  chaveDoTema,
  temaPorId,
  type TemaDaCarga,
} from './carregador-de-contexto';

export { ROSTER_DE_ENTRADA, agenteDoRoster, type AgenteDoRoster } from './roster';

export {
  ROSTER_DO_ONBOARDING,
  SLUG_DO_LEITOR_DE_ATA,
  SLUG_DO_PESQUISADOR_DE_CONTA,
  SLUG_DO_ROTEIRISTA,
} from './onboarding-da-root';

export {
  precisaSemear,
  semearRoster,
  type AvisoDoRoster,
  type OpcoesDaSemente,
  type ResumoDoRoster,
} from './semear';
