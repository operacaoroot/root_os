import { COBRANCA_PESSOAL_DIAS, LEMBRETE_DIAS, VALIDADE_DIAS } from './convite';

/* ==========================================================================
 * AS MENSAGENS — o que vai no grupo, pronto para copiar
 * ==========================================================================
 *
 * O OS PREPARA, o sócio manda. Mandar pelo OS passa por
 * `whatsapp.mensagem.enviar`, que é R3 com segunda pessoa — decisão da mesa
 * (ver `docs/ONBOARDING.md`, §9). Até lá, o botão é "copiar".
 *
 * A REGRA QUE VALE EM TODAS: DATA DE VERDADE OU NADA. O card 05 do ClickUp
 * circula com `XX/XX`; a nota do Pedro pede que a mensagem de próximos passos
 * saia com datas reais. Aqui, mensagem com data faltando não é gerada —
 * `SemDataError` — e a bancada mostra o que falta preencher.
 */

export class SemDataError extends Error {
  constructor(oQue: string) {
    super(`a mensagem precisa de ${oQue}, e não há data. Nada de "XX/XX": preencha e gere de novo.`);
    this.name = 'SemDataError';
  }
}

/**
 * DIA não é INSTANTE. `reuniaoEm`, `kickoffEm`, `propostaEnviadaEm` e as outras
 * datas do trilho chegam do formulário como "2026-09-22" e são gravadas à
 * meia-noite UTC — elas dizem o DIA, não a hora. Formatadas no fuso de
 * Brasília, voltariam um dia: a conversa de 22/09 aparecia como "21/09" no mapa
 * do cliente e na etiqueta "Da reunião de…" de cada confirmação.
 *
 * A régua, então: valor exatamente à meia-noite UTC é DIA e se formata em UTC;
 * qualquer outro é INSTANTE de verdade (resposta do cliente, acesso ao link,
 * marco do relógio) e continua em São Paulo, que é onde as pessoas estão.
 */
function fusoDaData(data: Date): string {
  const meiaNoiteUtc =
    data.getUTCHours() === 0 &&
    data.getUTCMinutes() === 0 &&
    data.getUTCSeconds() === 0 &&
    data.getUTCMilliseconds() === 0;
  return meiaNoiteUtc ? 'UTC' : 'America/Sao_Paulo';
}

export function formatarData(d: Date | string | null | undefined, comAno = false): string | null {
  if (!d) return null;
  const data = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(data.getTime())) return null;
  return data.toLocaleDateString('pt-BR', {
    timeZone: fusoDaData(data),
    day: '2-digit',
    month: '2-digit',
    ...(comAno ? { year: 'numeric' } : {}),
  });
}

export function formatarDataComDia(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const data = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(data.getTime())) return null;
  const dia = data.toLocaleDateString('pt-BR', { timeZone: fusoDaData(data), weekday: 'long' });
  return `${dia}, ${formatarData(data)}`;
}

function primeiroNome(nome: string | null | undefined): string {
  const n = String(nome ?? '').trim().split(/\s+/)[0];
  return n || 'tudo bem';
}

export interface ClienteParaMensagem {
  cliente: string;
  contatoNome: string | null;
}

/** Fase 0: o link do bloco A, com prazo (D-3 da reunião). */
export function mensagemDoLinkA(
  c: ClienteParaMensagem,
  link: string,
  reuniaoEm: Date | string | null,
  prazo: Date | string | null,
): string {
  const reuniao = formatarDataComDia(reuniaoEm);
  const ate = formatarData(prazo);
  if (!reuniao) throw new SemDataError('a data da reunião');
  if (!ate) throw new SemDataError('o prazo para responder');
  return [
    `Oi, ${primeiroNome(c.contatoNome)}! Antes da nossa conversa de ${reuniao}, cinco perguntas rápidas — uns 5 minutos, no celular:`,
    '',
    link,
    '',
    `Com elas a gente chega na reunião já falando da ${c.cliente}, e não de IA em geral. Se puder responder até ${ate}, ótimo.`,
  ].join('\n');
}

/** Fase 2: o link dos blocos B–D, depois do kickoff. */
export function mensagemDoLinkBCD(
  c: ClienteParaMensagem,
  link: string,
  args: { jaVieram: number; faltam: number; validoAte: Date | string; kickoffEm: Date | string | null },
): string {
  const ate = formatarData(args.validoAte);
  if (!ate) throw new SemDataError('a validade do link');
  const quando = formatarData(args.kickoffEm);
  const abertura = quando
    ? `obrigado pela conversa de ${quando}.`
    : 'obrigado pela conversa.';
  const vieram =
    args.jaVieram > 0
      ? `${args.jaVieram} ${args.jaVieram === 1 ? 'item já veio' : 'itens já vieram'} do que você falou — é só confirmar.`
      : 'A gente não conseguiu aproveitar a gravação, então este é do zero.';
  const faltam =
    args.faltam > 0
      ? ` ${args.faltam === 1 ? 'Um item' : `Os outros ${args.faltam}`} você responde por texto ou áudio.`
      : '';
  return [
    `${primeiroNome(c.contatoNome)}, ${abertura} Aqui está o onboarding da ${c.cliente}: ${vieram}${faltam} Uns 8 minutos.`,
    '',
    link,
    '',
    `Vale até ${ate}. Pode fazer no celular, e pode parar e voltar — o link guarda de onde parou.`,
  ].join('\n');
}

/** Dia 3: o lembrete automático, nomeando o que falta. */
export function mensagemDeLembrete(
  c: ClienteParaMensagem,
  link: string,
  faltam: readonly string[],
): string {
  const lista =
    faltam.length === 0
      ? 'o onboarding'
      : faltam.length === 1
        ? `um item do onboarding: ${faltam[0]}`
        : `${faltam.length} itens do onboarding: ${faltam.slice(0, -1).join(', ')} e ${faltam.at(-1)}`;
  return [
    `Bom dia, ${primeiroNome(c.contatoNome)}. ${faltam.length ? `Faltam ${lista}` : `Falta ${lista}`} da ${c.cliente}. Sem isso a implantação não abre.`,
    '',
    `O link é o mesmo: ${link}`,
  ].join('\n');
}

/** Dia 5: o texto para o sócio cobrar pessoalmente (não é automático). */
export function mensagemDeCobrancaPessoal(c: ClienteParaMensagem, link: string): string {
  return [
    `${primeiroNome(c.contatoNome)}, posso te ajudar a fechar o onboarding da ${c.cliente}? Se preferir, a gente faz por telefone em 10 minutos e eu preencho aqui.`,
    '',
    link,
  ].join('\n');
}

export interface ProximoPassoParaMensagem {
  texto: string;
  data: Date | string | null;
  dono?: string | null;
}

/**
 * Card 04 + card 05: boas-vindas no grupo com os próximos passos e DATAS REAIS.
 * Passo sem data derruba a mensagem inteira — é o `XX/XX` que a nota proíbe.
 */
export function mensagemDeBoasVindas(
  c: ClienteParaMensagem,
  passos: readonly ProximoPassoParaMensagem[],
  dupla: { root: readonly string[] },
): string {
  if (!passos.length) throw new SemDataError('ao menos um próximo passo');
  const linhas = passos.map((p) => {
    const data = formatarDataComDia(p.data);
    if (!data) throw new SemDataError(`a data de "${p.texto}"`);
    return `• ${data} — ${p.texto}${p.dono ? ` (${p.dono})` : ''}`;
  });
  return [
    `Bem-vindos ao grupo da ${c.cliente} com a Root. Aqui vai ficar tudo o que acontece no projeto: os passos, os prazos e as notícias. Do nosso lado: ${dupla.root.join(', ')}.`,
    '',
    'Os próximos passos, com data:',
    ...linhas,
    '',
    'Uma regra da casa, para o bem de todo mundo: senha, token e dado bancário nunca entram por aqui. Quando precisarmos de um acesso, mandamos o jeito certo de dar.',
  ].join('\n');
}

/** Fase 4: alerta de N dias sem uso — o texto do contato ativo. */
export function mensagemDeAlertaSemUso(c: ClienteParaMensagem, dias: number): string {
  return [
    `${primeiroNome(c.contatoNome)}, faz ${dias} dias que o OS da ${c.cliente} não recebe uma pergunta sua. Normalmente isso quer dizer uma de duas coisas: ou está tudo resolvido, ou algo travou. Qual das duas?`,
    '',
    'Se travou, me diga onde — eu entro hoje.',
  ].join('\n');
}

/** A régua do relógio, para a tela explicar. */
export const REGUA_DO_LINK = {
  validadeDias: VALIDADE_DIAS,
  lembreteDias: LEMBRETE_DIAS,
  cobrancaPessoalDias: COBRANCA_PESSOAL_DIAS,
} as const;
