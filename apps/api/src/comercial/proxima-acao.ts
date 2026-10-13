import { COMERCIAL_ROTULO_DA_ETAPA, ehSaida, type ComercialEtapa, type ComercialProximaAcao } from '@mktos/shared';

import { isoEmSP } from './agenda-de-homologacao';

/*
 * A PRÓXIMA AÇÃO E A SAÚDE DO LEAD (lane E, fase 2, 13/10/2026) — a parte pura.
 *
 * ACHADO DA LANE F: nenhum código escrevia `ComercialFicha.proximaAcao*` nem
 * `saude`, e o funil e a ficha mostravam os dois nulos. O conserto é PROJEÇÃO,
 * como o resto da ficha: a próxima ação é calculada a cada leitura a partir da
 * etapa, do que o portão ainda pede, do relógio (a config) e das decisões
 * abertas. Nenhuma tela grava, nenhuma coluna guarda: um valor guardado
 * envelheceria sozinho, porque o "quando" depende do relógio e da config.
 * As colunas `proximaAcao*` e `saude` da tabela ficam sem leitor nesta fase
 * (só a semente da lane F as escreve, como sobreposição de demonstração).
 *
 * A REGRA, por ordem (a primeira que vale):
 *   1. Saída: a geladeira com data volta na data; as outras saídas não têm
 *      próxima ação (o lead não está no funil).
 *   2. Decisão aberta: o padrão escrito é aplicado no vencimento. É a próxima
 *      coisa que acontece sozinha, e por isso vem antes da etapa.
 *   3. A etapa: o que o portão de saída ainda pede, e quando o relógio age
 *      (véspera, follow-up, publicação no horário). Sem número na config
 *      ([a decidir]), o "quando" fica nulo: nunca se inventa prazo.
 *
 * A SAÚDE fica NULA, de propósito. O mapa (tela 04) diz o que entra nela
 * ("leitura da sala, resposta no WhatsApp, tempo parado") e não diz o peso de
 * cada parte nem a escala do número. Somar com pesos escolhidos aqui seria
 * inventar uma nota que a tela mostraria como medida. [a decidir] pela mesa:
 * a fórmula da saúde (pesos e escala); quando vier, mora em `saudeDoLead`.
 */

const DIA_MS = 86_400_000;

/** O que a regra lê da ficha. Os nomes são os da tabela `ComercialFicha`. */
export interface FichaParaProximaAcao {
  etapa: string;
  voltaEm?: Date | null;
  etapaAntesDaSaida?: string | null;
  sistemaErp?: string | null;
  baseDados?: boolean | null;
  reuniaoEm?: Date | null;
  confirmacaoEnviadaEm?: Date | null;
  ataHash?: string | null;
  diagnostico?: unknown;
  diagnosticoAprovadoEm?: Date | null;
  propostaVersao?: number | null;
  propostaPublicadaEm?: Date | null;
  propostaLidaPelaPrimeiraVezEm?: Date | null;
  propostaAceitaEm?: Date | null;
  validade?: Date | null;
  cadastro?: unknown;
  cobrancaCriadaEm?: Date | null;
  pixPagoEm?: Date | null;
  contratoAssinadoClienteEm?: Date | null;
  contratoAssinadoRootEm?: Date | null;
  clienteAtivoEm?: Date | null;
  kickoffEm?: Date | null;
}

/** O que a regra lê da configuração (os números do relógio). */
export interface ConfigParaProximaAcao {
  fupLeuDias: number | null;
  fupSilencioDias: number | null;
  silencioAprova: boolean;
  horaPublicacaoProposta: number | null;
}

export interface DecisaoParaProximaAcao {
  titulo: string;
  padrao: string;
  expiraEm: Date;
  /** `true` quando a decisão não vence sozinha (prazo [a decidir]). */
  semPrazo: boolean;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const mais = (d: Date, dias: number): Date => new Date(d.getTime() + dias * DIA_MS);

/** A próxima hora cheia `hora` de São Paulo a partir de `agora` (a de hoje, se ainda não passou). */
export function proximaHoraEmSP(agora: Date, hora: number): Date {
  const local = new Date(agora.getTime() - 3 * 3_600_000);
  const hoje = new Date(isoEmSP(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), hora));
  return hoje.getTime() > agora.getTime() ? hoje : mais(hoje, 1);
}

function acao(tipo: string, descricao: string, quando: Date | null = null): ComercialProximaAcao {
  return { tipo, quando: iso(quando), descricao };
}

export function proximaAcaoDoLead(
  f: FichaParaProximaAcao,
  cfg: ConfigParaProximaAcao,
  decisoes: readonly DecisaoParaProximaAcao[],
  agora: Date,
): ComercialProximaAcao | null {
  const etapa = f.etapa as ComercialEtapa;

  // 1. Saída.
  if (ehSaida(etapa)) {
    if (etapa !== 'geladeira') return null;
    // A-4: geladeira sem data (a régua não deu os dias) não volta sozinha: a data é de uma pessoa.
    if (!f.voltaEm) return acao('data_da_geladeira', 'marcar a data de volta da geladeira (a regra não dá a data: [a decidir])');
    const volta = f.etapaAntesDaSaida && f.etapaAntesDaSaida in COMERCIAL_ROTULO_DA_ETAPA ? COMERCIAL_ROTULO_DA_ETAPA[f.etapaAntesDaSaida as ComercialEtapa] : 'a etapa de antes';
    return acao('volta_da_geladeira', `volta da geladeira para ${volta}`, f.voltaEm);
  }

  // 2. Decisão aberta: a que vence primeiro.
  if (decisoes.length) {
    const d = [...decisoes].sort((a, b) => a.expiraEm.getTime() - b.expiraEm.getTime())[0];
    return d.semPrazo
      ? acao('decisao', `decisão na fila: ${d.titulo} (sem prazo: espera alguém responder)`)
      : acao('decisao', `decisão na fila: ${d.titulo} · no vencimento vale o padrão "${d.padrao}"`, d.expiraEm);
  }

  // 3. A etapa.
  switch (etapa) {
    case 'novo_lead':
    case 'qualificacao':
      if (!f.sistemaErp || typeof f.baseDados !== 'boolean') return acao('formulario', 'o lead responde as 4 perguntas na sala (M1 com o link)');
      if (!f.reuniaoEm) return acao('agenda', 'o lead escolhe um dos horários oferecidos (M2)');
      return acao('reuniao', 'a conversa marcada', f.reuniaoEm);
    case 'reuniao_agendada':
      if (!f.reuniaoEm) return acao('agenda', 'o lead escolhe um dos horários oferecidos (M2)');
      if (!f.confirmacaoEnviadaEm) return acao('vespera', 'confirmação de véspera (M3, liberada por uma pessoa)', new Date(f.reuniaoEm.getTime() - DIA_MS));
      return acao('reuniao', 'a conversa marcada', f.reuniaoEm);
    case 'sessao':
      if (!f.ataHash) return acao('ata', 'subir a ata da conversa');
      return acao('diagnostico', 'o leitor de ata monta o diagnóstico');
    case 'diagnostico':
      if (!f.diagnostico) return acao('diagnostico', 'o leitor de ata monta o diagnóstico');
      if (!f.diagnosticoAprovadoEm) return acao('aprovar_diagnostico', 'o sócio aprova o diagnóstico (solta a proposta)');
      return acao('proposta', 'o construtor monta a proposta pela tabela');
    case 'proposta':
      if (!f.propostaVersao) return acao('proposta', 'o construtor monta a proposta pela tabela');
      if (cfg.silencioAprova && cfg.horaPublicacaoProposta != null) {
        return acao('publicar_proposta', `a proposta sai às ${cfg.horaPublicacaoProposta}h se ninguém segurar (e a porta ainda pede a liberação)`, proximaHoraEmSP(agora, cfg.horaPublicacaoProposta));
      }
      return acao('publicar_proposta', 'liberar a proposta (outra pessoa confirma)');
    case 'follow_up':
      if (f.propostaLidaPelaPrimeiraVezEm) {
        return cfg.fupLeuDias
          ? acao('m5', 'M5 se o cliente não responder', mais(f.propostaLidaPelaPrimeiraVezEm, cfg.fupLeuDias))
          : acao('resposta', 'esperar a resposta do cliente (prazo do M5 [a decidir])', f.validade ?? null);
      }
      if (cfg.fupSilencioDias && f.propostaPublicadaEm) return acao('m6', 'M6 com novidade se a proposta não for aberta', mais(f.propostaPublicadaEm, cfg.fupSilencioDias));
      return acao('resposta', 'esperar o cliente abrir a proposta (prazo do M6 [a decidir])', f.validade ?? null);
    case 'contrato': {
      if (!f.cadastro) return acao('aceite_dados', 'o cliente confere os dados do contrato na sala');
      if (!f.cobrancaCriadaEm) return acao('cobranca', 'a cobrança nasce no Asaas (R4: a titular assina)');
      if (!f.pixPagoEm) return acao('pix', 'o cliente paga a 1ª parcela');
      if (!f.contratoAssinadoClienteEm) return acao('assinatura_cliente', 'o cliente assina o contrato');
      if (!f.contratoAssinadoRootEm) return acao('assinatura_root', 'o sócio assina pela Root');
      return acao('fechamento', 'o fechamento roda as cinco escritas (R4: a titular assina)');
    }
    case 'fechado':
      // Depois do kickoff o cliente segue no contrato vivo: tem próximo passo, não é lead parado (revisão E-10).
      if (f.kickoffEm) return f.kickoffEm.getTime() > agora.getTime() ? acao('kickoff', 'o kickoff', f.kickoffEm) : acao('contrato_vivo', 'cliente ativo: o contrato vivo segue pelas parcelas e marcos');
      return acao('kickoff', 'o cliente marca o kickoff na sala');
    default:
      return null;
  }
}

/**
 * A saúde do lead. [a decidir]: o mapa dá as entradas (leitura da sala,
 * resposta no WhatsApp, tempo parado) e não dá a fórmula. Até a mesa decidir
 * os pesos e a escala, a saúde é nula, e a tela mostra "sem medida".
 */
export function saudeDoLead(): number | null {
  return null;
}
