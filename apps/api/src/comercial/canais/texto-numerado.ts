import type { BotaoInterativo, FormularioInterativo } from './whatsapp.port';

/*
 * O TEXTO NUMERADO DO WHATSAPP DO COMERCIAL.
 *
 * Nasceu na rodada da interface (20/10, U6) e saiu para cá na rodada de
 * produção 1 (21/10/2026, P8), porque a Evolution faz o mesmo: botões e
 * formulário viram texto numerado (sai em qualquer conexão, sem cadastro de
 * mensagem interativa), e a resposta numerada é lida na entrada contra a última
 * mensagem interativa enviada ao lead. Um formatador só, para os dois provedores.
 */

/** O rodapé que diz como responder aos botões. */
export function textoComBotoes(texto: string, botoes: readonly BotaoInterativo[]): string {
  const linhas = botoes.map((b, i) => `${i + 1}. ${b.rotulo}`);
  return `${texto}\n\n${linhas.join('\n')}\n\nResponda com o número da opção.`;
}

const DICA_DO_TIPO: Record<string, string> = { sim_nao: ' (sim ou não)', numero: ' (um número)' };

/** As perguntas do formulário, numeradas, com a instrução de resposta. */
export function textoComFormulario(texto: string, formulario: FormularioInterativo): string {
  const linhas = formulario.campos.map((c, i) => `${i + 1}. ${c.rotulo}${DICA_DO_TIPO[c.tipo] ?? ''}`);
  return `${texto}\n\n${formulario.titulo}:\n${linhas.join('\n')}\n\nResponda numa mensagem só, com o número de cada pergunta antes da resposta.`;
}

/** "2", "2.", "opção 2" → a chave do segundo botão. Fora da faixa ou ambíguo = `null`. */
export function escolhaNumerada(texto: string, botoes: readonly BotaoInterativo[]): string | null {
  const m = /^\s*(?:op[cç][aã]o\s*)?(\d{1,2})\s*[.)]?\s*$/i.exec(String(texto ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= botoes.length ? botoes[n - 1].chave : null;
}

function simOuNao(v: string): boolean | null {
  const t = v.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/^(s|sim|ss|yes|esta|está|organizada)\b/.test(t)) return true;
  if (/^(n|nao|no|nope)\b/.test(t)) return false;
  return null;
}

/**
 * As respostas numeradas de um formulário: "1. Omie\n2. sim\n3. conciliação\n4. 3"
 * (ou na mesma linha, "1) Omie 2) sim …"). Devolve os campos pela chave, com o
 * tipo convertido, só quando TODAS as perguntas foram respondidas e cada valor
 * fecha com o tipo. Senão `null`, e a mensagem segue como texto livre.
 */
export function respostaDoFormulario(texto: string, formulario: FormularioInterativo): Record<string, string | number | boolean> | null {
  const n = formulario.campos.length;
  const partes = new Map<number, string>();
  const re = /(?:^|\s)(\d{1,2})\s*[.)\-:]\s*/g;
  const marcas: Array<{ n: number; inicio: number; fim: number }> = [];
  let m: RegExpExecArray | null;
  // Só a sequência 1, 2, 3…: um número solto na resposta ("4. 3.") não abre pergunta nova.
  while ((m = re.exec(String(texto ?? ''))) !== null) {
    const num = Number(m[1]);
    if (num === marcas.length + 1 && num <= n) marcas.push({ n: num, inicio: m.index, fim: m.index + m[0].length });
  }
  for (let i = 0; i < marcas.length; i++) {
    const valor = String(texto).slice(marcas[i].fim, i + 1 < marcas.length ? marcas[i + 1].inicio : undefined).trim();
    if (valor && !partes.has(marcas[i].n)) partes.set(marcas[i].n, valor);
  }
  if (partes.size !== n) return null;
  const saida: Record<string, string | number | boolean> = {};
  for (let i = 0; i < n; i++) {
    const campo = formulario.campos[i];
    const valor = partes.get(i + 1)!;
    if (campo.tipo === 'sim_nao') {
      const b = simOuNao(valor);
      if (b === null) return null;
      saida[campo.chave] = b;
    } else if (campo.tipo === 'numero') {
      const d = /\d+/.exec(valor);
      if (!d) return null;
      saida[campo.chave] = Number(d[0]);
    } else {
      saida[campo.chave] = valor.slice(0, 400);
    }
  }
  return saida;
}
