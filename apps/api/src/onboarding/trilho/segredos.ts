/* ==========================================================================
 * A VARREDURA DE SEGREDOS — o que nunca entra no formulário nem na base
 * ==========================================================================
 *
 * A nota do Pedro (§6 e §10) é direta: senha, token, chave e dado bancário
 * entram pelo cofre ou pelo conector, nunca por texto. Em 22/09 uma senha de
 * wi-fi foi ditada numa reunião, ficou na transcrição e foi escrita no grupo.
 * Foi inofensivo; é o padrão a evitar.
 *
 * Esta varredura roda em TODA entrada de texto do trilho: a ata antes de ir ao
 * modelo, a resposta do cliente antes de virar nota, a transcrição do áudio. O
 * que parece credencial é trocado por `[segredo removido]` e CONTADO — a
 * contagem vai para `OnboardingAta.segredosRemovidos` e para o marco, para
 * alguém saber que a reunião precisou disso.
 *
 * É REGEX BARATA DE PROPÓSITO, e ela erra dos dois lados: mascara um número de
 * pedido que pareça cartão; deixa passar uma senha dita sem rótulo ("é abacaxi
 * 123"). Chamar o modelo para achar segredo mandaria o segredo ao modelo — o
 * oposto do que a varredura existe para fazer. O que ela promete é o caso
 * comum, rotulado: "a senha é X", "token: Y", "chave da API Z".
 */

export interface AchadoDeSegredo {
  tipo: 'senha' | 'token' | 'chave-api' | 'cartao' | 'conta-bancaria' | 'pix' | 'string-longa';
  /** O rótulo que denunciou, ou o formato. Nunca o valor. */
  pista: string;
}

export interface Varredura {
  texto: string;
  removidos: number;
  achados: AchadoDeSegredo[];
}

export const MARCA_DE_SEGREDO = '[segredo removido]';

interface Regra {
  tipo: AchadoDeSegredo['tipo'];
  padrao: RegExp;
  /** Qual grupo é o VALOR a mascarar (o resto da correspondência fica). */
  grupoDoValor: number;
}

/*
 * Cada regra tem um grupo de rótulo (fica) e um grupo de valor (sai). Os
 * rótulos são os que aparecem em português falado e transcrito: "a senha é",
 * "senha:", "token", "chave da api", "api key", "client secret", "bearer".
 */
const REGRAS: readonly Regra[] = [
  {
    tipo: 'senha',
    padrao:
      /\b((?:senha|password|passcode|pwd|pass)(?:\s+d[oa]\s+[\w-]+)?(?:\s+(?:é|e|eh|:|=|is|seria|fica))?)\s*[:=]?\s*["'“”]?([^\s"'“”,.;)]{3,})/gi,
    grupoDoValor: 2,
  },
  {
    tipo: 'token',
    padrao: /\b((?:token|bearer|access[_ -]?token|refresh[_ -]?token)(?:\s+(?:é|e|eh|:|=|is))?)\s*[:=]?\s*["'“”]?([A-Za-z0-9._\-]{8,})/gi,
    grupoDoValor: 2,
  },
  {
    tipo: 'chave-api',
    padrao:
      /\b((?:api[_ -]?key|chave(?:\s+d[ae])?\s+api|client[_ -]?secret|secret[_ -]?key|app[_ -]?secret|chave\s+secreta|chave\s+privada)(?:\s+(?:é|e|eh|:|=|is))?)\s*[:=]?\s*["'“”]?([A-Za-z0-9._\-]{8,})/gi,
    grupoDoValor: 2,
  },
  {
    // Cartão: 13 a 19 dígitos com ou sem separador. Precede de rótulo para não
    // engolir número de pedido — "cartão", "card", "número do cartão".
    tipo: 'cartao',
    padrao: /\b((?:cart[ãa]o|card)(?:\s+de\s+cr[ée]dito|\s+de\s+d[ée]bito)?(?:\s+(?:é|e|eh|:|=|n[úu]mero))?)\s*[:=]?\s*((?:\d[ -]?){13,19})/gi,
    grupoDoValor: 2,
  },
  {
    tipo: 'conta-bancaria',
    padrao: /\b((?:ag[êe]ncia|conta(?:\s+corrente)?)\s*[:=]?\s*)(\d{3,6}-?\d?(?:\s*(?:,|e)\s*(?:conta|c\/c)?\s*[:=]?\s*\d{4,12}-?\d?)?)/gi,
    grupoDoValor: 2,
  },
  {
    // Chave PIX aleatória (uuid) ou rotulada. CPF/e-mail/telefone como chave
    // pix NÃO são mascarados: são dados de contato, não credencial.
    tipo: 'pix',
    padrao: /\b((?:chave\s+)?pix(?:\s+(?:é|e|eh|:|=|aleat[óo]ria))?)\s*[:=]?\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
    grupoDoValor: 2,
  },
  {
    // Strings longas sem espaço com cara de token (letras E dígitos, 32+).
    tipo: 'string-longa',
    padrao: /()(\b(?=[A-Za-z0-9_\-]*\d)(?=[A-Za-z0-9_\-]*[A-Za-z])[A-Za-z0-9_\-]{32,}\b)/g,
    grupoDoValor: 2,
  },
];

export function varrerSegredos(entrada: string): Varredura {
  let texto = String(entrada ?? '');
  const achados: AchadoDeSegredo[] = [];

  for (const regra of REGRAS) {
    texto = texto.replace(regra.padrao, (...m: unknown[]) => {
      const inteiro = String(m[0]);
      const rotulo = String(m[1] ?? '');
      const valor = String(m[regra.grupoDoValor] ?? '');
      if (!valor) return inteiro;
      achados.push({ tipo: regra.tipo, pista: rotulo.trim() || regra.tipo });
      // Mantém o rótulo (é ele que explica o buraco) e troca só o valor.
      const inicio = inteiro.lastIndexOf(valor);
      return inteiro.slice(0, inicio) + MARCA_DE_SEGREDO + inteiro.slice(inicio + valor.length);
    });
  }

  return { texto, removidos: achados.length, achados };
}

/** Só a pergunta "tem segredo?", sem mascarar. */
export function temSegredo(entrada: string): boolean {
  return varrerSegredos(entrada).removidos > 0;
}
