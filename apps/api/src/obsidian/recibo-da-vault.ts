import { createHash } from 'node:crypto';
import { canonizar, sigiloso } from '../gateway/event-log.service';
import { COLECAO_DA_VAULT, TIPO_DO_RECIBO, type ResumoDaProjecao } from '../memory/memoria.service';
import type { MontanteDaVault } from './estado-do-git';
import type { PertencaDaVault } from './pertenca-da-vault';

/*
 * ============================================================================
 * O RECIBO A MONTANTE DA COLEÇÃO `vault:` (C19-08, R-9)
 * ============================================================================
 *
 * O recibo separa o que a tela e o agente costumavam ler como uma coisa só —
 * "o índice está atualizado" — em cinco perguntas, cada uma com bloco próprio:
 *
 *   montante     a vault no disco está no commit que a busca trouxe, e a busca
 *                anda? (o log do `pull` fica fora do container, então isto é o
 *                que dá para ver de dentro)
 *   descoberta   o que há no disco e o que disso pertence à coleção
 *   leitura      quantos arquivos foram lidos, quantos reaproveitados, falhas
 *   indexacao    o índice de busca foi regravado?
 *   vetorizacao  quantos vetores foram pedidos e quantos faltaram
 *   projecao     o que a memória criou, alterou, arquivou, moveu, segurou
 *
 * e um `resultado` que NUNCA diz `ok` quando qualquer um deles falhou: `ok`,
 * `parcial` (a volta rodou e deixou algo para trás) ou `falhou` (a volta não
 * fez o trabalho dela). "Última execução", "atraso" e "falha a montante" ficam
 * separados de "índice atualizado" — que é o aceite da ROOT-20.
 *
 * ----------------------------------------------------------------------------
 * QUANDO O RECIBO VIRA EVENTO DO RASTRO — opção (ii) da R-9
 * ----------------------------------------------------------------------------
 * Um recibo por volta são 48 eventos por dia. `GET /audit/verificar` confere
 * os primeiros 5.000 eventos da empresa, do mais velho para o mais novo
 * (`EventLogService.verificar`), e só os recibos encheriam essa janela em uns
 * 104 dias: daí em diante nenhum evento novo da casa seria conferido. A opção
 * (i) pedia mudar `verificar` para conferir também a cauda, que é arquivo de
 * outra frente. Esta fatia fica com a (ii):
 *
 *   · o recibo vira evento quando ALGO MUDA (a projeção escreveu na memória, ou
 *     a assinatura do estado difere da do último recibo) ou quando a volta FALHA
 *     de um jeito novo — falha e guarda que só se repetem saem quando começam,
 *     quando mudam e na batida;
 *   · mais uma BATIDA DIÁRIA, para quem lê o RASTRO saber que o coletor está
 *     vivo mesmo sem mudança;
 *   · e o FRESCOR de toda volta vai para `IntegrationHealth` (`checkedAt` é a
 *     última execução, `lastSyncAt` a última volta `ok`, `lastError` o motivo
 *     quando não é `ok`), sem migration.
 *
 * Toda volta que grava versão na memória também grava recibo, então o caminho
 * versão → evento → correlação → recibo da C19-08 continua valendo.
 */

export { TIPO_DO_RECIBO };
export const COLECAO = COLECAO_DA_VAULT;

/** A batida: sem recibo há mais que isto, a volta grava um mesmo sem mudança. */
export const INTERVALO_DA_BATIDA_MS = 24 * 60 * 60 * 1000;

/** Quantos caminhos de cada situação o recibo lista (sob `sigiloso`). O resto vai só na conta. */
export const CAMINHOS_POR_SITUACAO = 20;

export type ResultadoDaVolta = 'ok' | 'parcial' | 'falhou';

export interface ReciboDaVault {
  colecao: string;
  fonte: 'pasta' | 'drive';
  inicioEm: string;
  fimEm: string | null;
  montante: (MontanteDaVault & { mudouNoMeio: boolean }) | { naoSeAplica: string };
  descoberta:
    | (PertencaDaVault['contagens'] & { rastreamento: string; avisos: string[] })
    | { naoSeAplica: string };
  leitura: { lidos: number; reaproveitados: number; falhas: number };
  indexacao: { gravadas: number; preservadas: number; espelhoDoOnboardingPreservado: number | null } | null;
  vetorizacao: { pedidos: number; comVetor: number; semVetor: number; descricao: string } | null;
  projecao: (ResumoDaProjecao & { falhou: string | null }) | null;
  /** O erro que interrompeu a volta, se houve. */
  falha: string | null;
}

/** O `resultado` e os motivos. A regra é uma só: nada que falhou deixa sair `ok`. */
export function resultadoDaVolta(r: ReciboDaVault): { resultado: ResultadoDaVolta; motivos: string[] } {
  const falhou: string[] = [];
  const parcial: string[] = [];

  const rastreamentoOk = !('rastreamento' in r.descoberta) || r.descoberta.rastreamento === 'ok';
  if (r.falha) falhou.push(r.falha);
  if (!rastreamentoOk && 'rastreamento' in r.descoberta) {
    falhou.push(`rastreamento não verificável: ${r.descoberta.rastreamento}`);
  }
  if (r.projecao?.falhou) falhou.push(`a projeção na memória falhou: ${r.projecao.falhou}`);
  if (!r.falha && !r.projecao && rastreamentoOk) falhou.push('a projeção na memória não rodou');

  if ('commit' in r.montante) {
    if (r.montante.atrasado) parcial.push('a vault no disco está atrás do que a última busca trouxe (o pull buscou e não fundiu)');
    if (r.montante.buscaParada) {
      parcial.push(
        r.montante.ultimaBuscaFalhouEm
          ? `a última busca no remoto não trouxe nada (${r.montante.ultimaBuscaFalhouEm}); o git zera o FETCH_HEAD quando a busca falha`
          : r.montante.ultimaBuscaEm
            ? `nenhuma busca bem-sucedida desde ${r.montante.ultimaBuscaEm}`
            : 'a vault tem remoto e nunca buscou nada (sem FETCH_HEAD)',
      );
    }
    if (r.montante.mudouNoMeio) parcial.push('o HEAD ou o índice do git mudaram no meio da volta');
  }
  if ('alteradosForaDoGit' in r.descoberta) {
    const d = r.descoberta;
    if (d.alteradosForaDoGit) parcial.push(`${d.alteradosForaDoGit} arquivo(s) alterado(s) na VPS fora do git`);
    if (d.apagadosForaDoGit) parcial.push(`${d.apagadosForaDoGit} arquivo(s) rastreado(s) apagado(s) do disco fora do git`);
    if (d.naoVerificaveis) parcial.push(`${d.naoVerificaveis} entrada(s) do índice não verificável(is)`);
    if (d.colisoesNFC) parcial.push(`${d.colisoesNFC} arquivo(s) em colisão de normalização (NFC)`);
    if (d.nomesIlegiveis) parcial.push(`${d.nomesIlegiveis} arquivo(s) com nome fora de UTF-8`);
  }
  if (r.leitura.falhas) parcial.push(`${r.leitura.falhas} arquivo(s) não lidos`);
  if (r.vetorizacao?.semVetor) parcial.push(`${r.vetorizacao.semVetor} nota(s) ficaram sem vetor nesta volta`);
  if (r.projecao) {
    if (r.projecao.falhas) parcial.push(`${r.projecao.falhas} nota(s) falharam na projeção`);
    if (r.projecao.arquivamentoRecusado) {
      parcial.push(`${r.projecao.arquivamentoRecusado} arquivamento(s) segurados pela guarda (acima do teto)`);
    }
    if (r.projecao.movimentosRecusados) {
      parcial.push(`${r.projecao.movimentosRecusados} movimento(s) segurados pela guarda (acima do teto)`);
    }
  }

  if (falhou.length) return { resultado: 'falhou', motivos: [...falhou, ...parcial] };
  if (parcial.length) return { resultado: 'parcial', motivos: parcial };
  return { resultado: 'ok', motivos: [] };
}

/**
 * A assinatura do ESTADO, sem o que muda a cada volta sem significar nada (a
 * hora da busca, que anda a cada 5 minutos; quantos arquivos foram relidos por
 * data). Igual à do último recibo, e sem escrita na memória, a volta não vira
 * evento — só frescor em `IntegrationHealth`.
 */
export function assinaturaDoRecibo(r: ReciboDaVault, resultado: { resultado: ResultadoDaVolta; motivos: string[] }): string {
  const m = 'commit' in r.montante ? r.montante : null;
  const estado = {
    colecao: r.colecao,
    fonte: r.fonte,
    commit: m?.commit ?? null,
    remotoNaBusca: m?.remotoNaBusca ?? null,
    atrasado: m?.atrasado ?? null,
    buscaParada: m?.buscaParada ?? null,
    descoberta: 'membros' in r.descoberta ? { ...r.descoberta } : r.descoberta,
    resultado: resultado.resultado,
    motivos: resultado.motivos,
    arquivamentoRecusado: r.projecao?.arquivamentoRecusado ?? null,
    movimentosRecusados: r.projecao?.movimentosRecusados ?? null,
    // O conjunto segurado: mudou o conjunto, muda o recibo — é dele que o comando de liberação lê (R-6).
    guardas: r.projecao?.guardas ?? null,
    falhasDaProjecao: r.projecao?.falhas ?? null,
    substituicoesSemAlvo: r.projecao?.substituicoes.semAlvo ?? null,
  };
  return createHash('sha256').update(canonizar(estado)).digest('hex');
}

/**
 * A projeção ESCREVEU na memória (ou consumiu uma liberação)? Então o recibo sai
 * nesta volta, e a correlação liga cada versão nova a ele. O que só se repete —
 * a guarda segurando o mesmo conjunto, a mesma nota falhando — entra pela
 * assinatura: sai quando começa, quando muda e na batida diária.
 */
function projecaoMexeu(p: ReciboDaVault['projecao']): boolean {
  if (!p) return false;
  return p.criadas + p.alteradas + p.arquivadas + p.restauradas + p.movidas > 0 || Boolean(p.liberacaoUsada);
}

/** Grava o recibo como evento nesta volta? E por quê — o porquê vai no próprio evento. */
export function deveRegistrar(entrada: {
  anterior: { assinatura: string | null; ocorreuEm: Date } | null;
  assinatura: string;
  recibo: ReciboDaVault;
  agora: Date;
}): { registrar: boolean; porque: string } {
  const { anterior, assinatura, recibo, agora } = entrada;
  if (!anterior) return { registrar: true, porque: 'primeiro recibo desta coleção' };
  if (projecaoMexeu(recibo.projecao)) return { registrar: true, porque: 'a projeção escreveu na memória nesta volta' };
  if (anterior.assinatura !== assinatura) return { registrar: true, porque: 'o estado da coleção mudou desde o último recibo' };
  if (agora.getTime() - anterior.ocorreuEm.getTime() >= INTERVALO_DA_BATIDA_MS) {
    return { registrar: true, porque: 'batida diária (nada mudou desde o último recibo)' };
  }
  return { registrar: false, porque: 'nada mudou desde o último recibo' };
}

/** Os caminhos de cada situação, sob `sigiloso`, com teto. */
export function caminhosSigilosos(
  fora: PertencaDaVault['foraDaColecao'],
  semListaDeAlterados: boolean,
): Record<string, { total: number; caminhos: unknown[] }> {
  const porSituacao: Record<string, { total: number; caminhos: unknown[] }> = {};
  for (const f of fora) {
    const grupo = (porSituacao[f.situacao] ??= { total: 0, caminhos: [] });
    grupo.total++;
    const listar = !(semListaDeAlterados && f.situacao === 'alterado_fora_do_git');
    if (listar && grupo.caminhos.length < CAMINHOS_POR_SITUACAO) {
      grupo.caminhos.push(sigiloso(f.caminho, `caminho na vault (${f.situacao})`));
    }
  }
  return porSituacao;
}

/** Uma linha que cabe no `resumo` do evento e no `lastError` da saúde. */
export function linhaDoRecibo(r: ReciboDaVault, resultado: { resultado: ResultadoDaVolta; motivos: string[] }): string {
  const m = 'commit' in r.montante ? r.montante : null;
  const membros = 'membros' in r.descoberta ? r.descoberta.membros : null;
  const partes = [
    `volta da vault: ${resultado.resultado}`,
    membros !== null ? `${membros} membro(s)` : null,
    m?.commit ? `commit ${m.commit.slice(0, 7)}` : null,
    r.projecao
      ? `${r.projecao.criadas} criada(s), ${r.projecao.alteradas} alterada(s), ${r.projecao.arquivadas} arquivada(s), ` +
        `${r.projecao.movidas} movida(s)`
      : null,
  ].filter(Boolean);
  return [partes.join(' · '), ...resultado.motivos].join(' — ');
}
