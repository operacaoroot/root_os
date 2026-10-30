import { createHash, randomBytes } from 'node:crypto';

/*
 * O LINK DE ESCOLHA — a parte pura (agenda v2, 29/10/2026, lane G6).
 *
 * O TOKEN. São 32 bytes aleatórios (base64url, 43 caracteres) precedidos do id
 * da empresa: `<orgId>.<aleatório>`. O banco guarda só o sha256 do token
 * inteiro (`AgendaConvite.tokenHash`); o token cru existe uma vez, na resposta
 * de quem criou.
 *
 * POR QUE A EMPRESA VIAJA NO TOKEN, e não sai só do hash como no link do
 * onboarding: a policy de `AgendaConvite` (migration `20261029230000_agenda_v2`)
 * é a das outras tabelas da empresa e NÃO abre leitura para a sentinela pública
 * (`app_resolucao_publica()`), ao contrário da de `OnboardingConvite`. Uma
 * resolução só pelo hash, sob a sentinela, devolveria zero linhas assim que o
 * papel restrito (`mktos_app`) entrasse, e todo link responderia 404 sem
 * ninguém saber por quê. Com a empresa no token, a busca pelo hash roda DENTRO
 * da empresa (`comTenantPublico`), com o isolamento por linha valendo. O id da
 * empresa não é segredo (não abre nada sozinho); o segredo são os 256 bits.
 *
 * Sem relógio próprio (o `agora` vem de fora), sem rede, sem banco.
 */

export const VALIDADE_PADRAO_DIAS = 7;
export const VALIDADE_MAXIMA_DIAS = 30;
const DIA_MS = 86_400_000;

/** `<orgId>.<43 de base64url>`. Fora disto, nem consulta o banco. */
export const TOKEN_DO_CONVITE = /^([A-Za-z0-9-]{1,64})\.([A-Za-z0-9_-]{43})$/;

export function hashDoConvite(token: string): string {
  return createHash('sha256').update(String(token ?? ''), 'utf8').digest('hex');
}

export function gerarTokenDoConvite(orgId: string): { token: string; hash: string } {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(orgId)) throw new Error('id de empresa fora do formato do token do convite');
  const token = `${orgId}.${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashDoConvite(token) };
}

/** A empresa do token, quando ele tem a forma certa. */
export function empresaDoToken(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const m = TOKEN_DO_CONVITE.exec(token);
  return m ? m[1] : null;
}

export function validadeDoConvite(agora: Date, dias?: number | null): Date {
  const d = Math.min(Math.max(Math.trunc(dias ?? VALIDADE_PADRAO_DIAS) || VALIDADE_PADRAO_DIAS, 1), VALIDADE_MAXIMA_DIAS);
  return new Date(agora.getTime() + d * DIA_MS);
}

export interface ConviteLido {
  validoAte: Date;
  usadoEm: Date | null;
  revogadoEm: Date | null;
  escolhidoInicio: Date | null;
}

/**
 * O convite abre? Errado, vencido, revogado e "usado sem escolha" respondem o
 * MESMO 404 (distinguir contaria a quem sondasse que um convite existiu). O
 * usado COM escolha abre, para a página mostrar o horário escolhido.
 */
export function conviteAbre(c: ConviteLido | null, agora: Date): boolean {
  if (!c) return false;
  if (c.revogadoEm) return false;
  if (c.validoAte.getTime() <= agora.getTime()) return false;
  if (c.usadoEm && !c.escolhidoInicio) return false;
  return true;
}

/** O que o convite precisa saber da aprovação do seu `marcar` (a linha de `Approval`, ou nada). */
export interface AprovacaoDoPedido {
  status: 'pendente' | 'confirmada' | 'consumida' | 'rejeitada' | 'expirada';
  expiraEm: Date;
  capabilityId: string | null;
}

/**
 * O pedido do link CAIU? (A1 da revisão adversarial.) O `marcar` do link fica
 * R2 na fila, e a aprovação R2 vale 15 min: se ninguém confirmar a tempo, se
 * alguém recusar ou se a linha sumir, o evento nunca nasce e o convite ficaria
 * "escolhido" para sempre. Caiu = havia pedido (`approvalId`) e a aprovação está
 * recusada, expirada, sumiu ou passou do prazo sem execução (a mesma regra de
 * "vencida" da fila). Consumida ou confirmada pela porta (executando) não caiu.
 * Quem chama confere também que o evento não está no espelho.
 */
export function pedidoDoConviteCaiu(
  c: { usadoEm: Date | null; escolhidoInicio: Date | null; approvalId: string | null },
  aprovacao: AprovacaoDoPedido | null,
  agora: Date,
): boolean {
  if (!c.usadoEm || !c.escolhidoInicio || !c.approvalId) return false;
  if (!aprovacao) return true;
  if (aprovacao.status === 'rejeitada' || aprovacao.status === 'expirada') return true;
  if (aprovacao.status === 'consumida') return false;
  if (aprovacao.expiraEm.getTime() > agora.getTime()) return false;
  return aprovacao.status === 'pendente' || (aprovacao.status === 'confirmada' && !aprovacao.capabilityId);
}

/**
 * O nome que a pessoa digitou no link, pronto para entrar no título (M4). A
 * gramática do título separa as partes com ` - ` (e lê também ` – `, ` — `):
 * um nome como `X - Lucas` faria a leitura achar outro cliente ou outro
 * responsável. Separadores cercados de espaço, `·` e `|` viram espaço; o tamanho
 * é limitado. Vazio = nulo.
 */
export const NOME_DIGITADO_MAX = 60;
export function nomeDigitadoParaTitulo(digitado: string | null | undefined): string | null {
  const n = String(digitado ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s[-‐-―−]+(?=\s)/g, ' ')
    .replace(/^[-‐-―−]+\s|\s[-‐-―−]+$/g, ' ')
    .replace(/[·|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NOME_DIGITADO_MAX)
    .trim();
  return n || null;
}

/** `AAAA-MM-DD` de hoje em São Paulo. */
export function diaEmSaoPaulo(agora: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Dia e hora de São Paulo para o instante. São Paulo não tem horário de verão
 * desde 2019 (Decreto 9.772): o deslocamento é -03:00 o ano inteiro.
 */
export function instanteEmSaoPaulo(dia: string, hora: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return null;
  const d = new Date(`${dia}T${hora}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** O primeiro nome, para a página ("Marcos, escolha um horário…"). */
export function primeiroNome(nome: string | null | undefined): string | null {
  const n = (nome ?? '').replace(/\s+/g, ' ').trim().split(' ')[0] ?? '';
  return n ? n.slice(0, 40) : null;
}

const icsData = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsTexto = (v: string): string => v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** O `.ics` do horário escolhido. Sem nome de cliente nenhum além do que a pessoa já sabe. */
export function icsDoConvite(c: { uid: string; inicio: Date; fim: Date; titulo: string; descricao: string; agora: Date }): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Operacao ROOT//ROOT OS Agenda//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${c.uid}`,
    `DTSTAMP:${icsData(c.agora)}`,
    `DTSTART:${icsData(c.inicio)}`,
    `DTEND:${icsData(c.fim)}`,
    `SUMMARY:${icsTexto(c.titulo)}`,
    `DESCRIPTION:${icsTexto(c.descricao)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/** Teto por origem e por hora, em memória (como o link do onboarding). */
export class TetoPorOrigem {
  private readonly baldes = new Map<string, { ate: number; n: number }>();

  constructor(private readonly janelaMs = 3_600_000) {}

  registrar(origem: string | null | undefined, teto: number, agora = Date.now()): boolean {
    const chave = origem ?? 'desconhecida';
    const b = this.baldes.get(chave);
    if (!b || b.ate <= agora) {
      if (this.baldes.size > 5000) this.baldes.clear();
      this.baldes.set(chave, { ate: agora + this.janelaMs, n: 1 });
      return 1 <= teto;
    }
    b.n += 1;
    return b.n <= teto;
  }
}
