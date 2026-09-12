/*
 * Passo 1 da porta: validar os argumentos ANTES de classificar.
 *
 * Existe porque faltava. Sem schema declarado, a ferramenta chega ao modelo
 * como `{type:'object', properties:{}}` — ele não tem como saber o nome do
 * parâmetro e inventa um. Em 01/09/2026 isso custou uma aprovação queimada: o
 * modelo propôs `{message: "..."}`, a régua reteve certo, a pessoa aprovou, e
 * o efeito morreu com "mensagem vazia" porque esperava `corpo`.
 *
 * A recusa tem que vir na PORTA, com o motivo, para o modelo poder corrigir —
 * e não num `if` defensivo lá no fundo, depois de gastar a aprovação de alguém.
 *
 * Validador pequeno de propósito: cobre o que o catálogo usa (objeto, campos
 * obrigatórios, tipo primitivo, enum, tamanho mínimo). Schema mais exótico que
 * isso é sinal de capacidade mal desenhada, não de validador incompleto.
 */

export interface ErroDeArgumento {
  campo: string;
  problema: string;
}

interface Propriedade {
  type?: string;
  enum?: unknown[];
  minLength?: number;
  description?: string;
}

interface SchemaObjeto {
  type?: string;
  properties?: Record<string, Propriedade>;
  required?: string[];
  additionalProperties?: boolean;
}

const tipoDe = (v: unknown): string => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
};

const casa = (valor: unknown, esperado: string): boolean => {
  const t = tipoDe(valor);
  if (esperado === 'number') return t === 'number' || t === 'integer';
  if (esperado === 'integer') return t === 'integer';
  return t === esperado;
};

export function validarArgs(
  schema: unknown,
  args: Record<string, unknown>,
): ErroDeArgumento[] {
  const s = schema as SchemaObjeto | null | undefined;
  // Sem schema não há o que validar. É permissivo de propósito: uma capacidade
  // sem schema declarado é um problema do CATÁLOGO, e recusá-la aqui deixaria
  // dez leituras que funcionam hoje pararem de funcionar.
  if (!s || typeof s !== 'object' || s.type !== 'object' || !s.properties) return [];

  const erros: ErroDeArgumento[] = [];
  const props = s.properties;
  // Um campo que já falhou por estar faltando não volta a falhar por tamanho:
  // a mensagem vai para o MODELO, e reclamar duas vezes da mesma coisa é ruído
  // que atrapalha ele corrigir.
  const jaReclamados = new Set<string>();

  for (const nome of s.required ?? []) {
    const v = args?.[nome];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      const p = props[nome];
      erros.push({
        campo: nome,
        problema: `obrigatório e não veio${p?.description ? ` (${p.description})` : ''}`,
      });
      jaReclamados.add(nome);
    }
  }

  for (const [nome, valor] of Object.entries(args ?? {})) {
    const p = props[nome];
    if (!p) {
      // Campo inventado é o sintoma exato do que quebrou: aponta o certo.
      if (s.additionalProperties === false) {
        erros.push({
          campo: nome,
          problema: `não existe nesta ferramenta — os campos são: ${Object.keys(props).join(', ')}`,
        });
      }
      continue;
    }
    if (valor === undefined || valor === null || jaReclamados.has(nome)) continue;
    if (p.type && !casa(valor, p.type)) {
      // 'integer' é distinção interna; quem lê a mensagem é o modelo, e para
      // ele "veio number" é mais útil do que "veio integer".
      const veio = tipoDe(valor) === 'integer' ? 'number' : tipoDe(valor);
      erros.push({ campo: nome, problema: `esperava ${p.type}, veio ${veio}` });
    }
    if (p.enum && !p.enum.includes(valor)) {
      erros.push({ campo: nome, problema: `valor inválido; aceita: ${p.enum.join(', ')}` });
    }
    if (p.minLength && typeof valor === 'string' && valor.trim().length < p.minLength) {
      erros.push({ campo: nome, problema: `precisa de ao menos ${p.minLength} caractere(s)` });
    }
  }

  return erros;
}

export function mensagemDeErro(erros: ErroDeArgumento[]): string {
  return `argumentos inválidos: ${erros.map((e) => `${e.campo} ${e.problema}`).join(' · ')}`;
}
