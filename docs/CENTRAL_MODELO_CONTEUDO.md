# Modelo de conteúdo — Root Central

Derivado da leitura da referência ([`reference-analysis.md`](reference-analysis.md)), corrigindo os pontos onde o modelo dela trava. Tudo em TypeScript estrito, validado com Zod no build.

---

## 1. O que mudou em relação à referência

| Referência | Root Central | Por quê |
|---|---|---|
| `palavra` + `aliases` (colide entre materiais) | `codigo` **único** + `aliases` (busca ampla) | o código resolve a promessa do reel sem ambiguidade; os aliases servem pra descoberta, não pra resgate |
| `Conteudo` = componente React | `blocos: Bloco[]` tipado (ou MDX) | conteúdo vira dado: editável, validável, sem rebuild do bundle inteiro |
| sem categoria/tipo/nível | `categoria`, `tipo`, `nivel`, `custo`, `ferramentas` | filtro, trilha e CTA por tipo dependem disso |
| sem sinal de frescor | `verificadoEm` + `situacao` | em IA, material de 60 dias pode estar errado |
| capa única (frame do reel) | `capa` + `capaAlt` + fallback tipográfico versionado | acessibilidade e resiliência |
| CTA fixo "Resgatar material" | `ctaLabel` derivado de `tipo` | "Copiar prompt" ≠ "Fazer o curso" |

---

## 2. Tipos

```ts
export type Nivel   = "iniciante" | "intermediario" | "avancado";
export type Custo   = "gratuito" | "freemium" | "pago";
export type Situacao = "verificado" | "atualizado" | "requer-revisao" | "descontinuado";

export type TipoMaterial =
  | "tutorial" | "prompt" | "repositorio" | "curso" | "template"
  | "automacao" | "skill" | "mcp" | "ferramenta" | "checklist" | "estudo-de-caso";

/** Bloco de conteúdo — o "design system" executável.
 *  Herdado da referência (8 primitivas), acrescido de comando e requisitos. */
export type Bloco =
  | { tipo: "passo";     n: number; titulo: string; sub?: string; blocos: Bloco[] }
  | { tipo: "texto";     conteudo: string }                                   // markdown inline
  | { tipo: "callout";   variante: "info" | "nota" | "atencao" | "risco"; titulo?: string; conteudo: string }
  | { tipo: "link";      label: string; selo?: string; href: string }         // mostra o domínio
  | { tipo: "prompt";    rotulo: string; conteudo: string }                   // botão copiar
  | { tipo: "comando";   linguagem: string; conteudo: string; aviso?: string } // copiar + aviso se altera arquivos
  | { tipo: "lista";     estilo: "letras" | "numeros" | "marcadores"; itens: string[] }
  | { tipo: "requisitos"; itens: { texto: string; obrigatorio: boolean; href?: string; nota?: string }[] }
  | { tipo: "exemplo";   contexto: string; prompt: string; resultado: string }
  | { tipo: "dialogo";   linhas: [quem: string, texto: string][] };

export interface Material {
  id: string;
  slug: string;                 // /materiais/[slug]
  codigo: string;               // ÚNICO. o que a pessoa comenta no reel. validado no build
  aliases: string[];            // descoberta; PODE repetir entre materiais

  card: string;                 // título do card (curto, com benefício)
  tagline: string;              // subtítulo do card (1 linha, concreta)
  titulo: string;               // H1 da página (pode ser mais longo que o card)
  resumo: string;               // 2–3 linhas, usado no OG e no topo da página

  capa?: string;                // 720×1280 (frame do reel), object-cover em 4:5
  capaAlt?: string;

  categoriaId: string;
  tipo: TipoMaterial;
  nivel: Nivel;
  custo: Custo;
  ferramentas: string[];        // "Claude Code", "n8n", "Obsidian"
  plataformas: string[];        // "macOS", "Windows", "terminal", "web"
  tags: string[];
  resolve: string[];            // PROBLEMAS em linguagem de gente: "meu Claude esquece tudo"
  minutosEstimados?: number;
  prerequisitos?: string[];

  blocos: Bloco[];              // o conteúdo

  publicadoEm: string;          // ISO
  ativoEm?: string;             // drip: só aparece a partir daqui
  verificadoEm?: string;
  situacao: Situacao;
  destaque: boolean;

  origemUrl?: string;           // o reel/vídeo que originou
  relacionados?: string[];      // ids
}

export interface Categoria {
  id: string; slug: string; nome: string; descricao: string; icone: string; ordem: number;
}

export interface Trilha {
  id: string; slug: string; titulo: string; descricao: string;
  paraQuem: string; nivel: Nivel; minutosTotais: number;
  itens: { materialId: string; ordem: number; nota?: string }[];
  prerequisitos?: string[];
}
```

---

## 3. `codigo` — a regra que a referência não tem

O `codigo` é o contrato com o reel. Regras:

1. **único em todo o catálogo** — teste de build falha se houver repetido (é o defeito nº 2 da referência);
2. normalizado sem acento e sem caixa na comparação, mas **exibido** em caixa alta;
3. quando um tema se repete, o código ganha número ou qualificador: `AGENTE1`, `AGENTE2` — nunca dois materiais respondendo "AGENTE";
4. o `codigo` também vira rota curta: **`/r/<codigo>`** → 302 pra `/materiais/<slug>`. Isso dá um link de uma palavra pra colar na bio, no comentário e no story;
5. `aliases` são livres pra colidir — eles alimentam a busca ampla, não o resgate.

---

## 4. Busca — três camadas

A referência tem só a camada 1, e exata.

| Camada | Casa contra | Comportamento |
|---|---|---|
| 1. Resgate | `codigo` (exato, normalizado) | acerto único → abre o material direto |
| 2. Termo | `aliases`, `tags`, `ferramentas`, `categoria` | lista filtrada |
| 3. Texto | `card`, `tagline`, `titulo`, `resumo`, `resolve`, texto dos blocos | parcial, sem acento, tolerante a erro de digitação |

Ordem: 1 → 2 → 3. Sem resultado em nenhuma → mensagem clara + sugestões + **catálogo completo abaixo** (isso a referência acerta e a gente mantém).

O campo `resolve` é o que habilita a "busca orientada a problema": a pessoa digita *"o Claude esquece tudo"* e chega em memória/contexto sem saber o nome de nenhuma ferramenta.

---

## 5. CTA por tipo

Substitui o "Resgatar material" único:

| `tipo` | CTA |
|---|---|
| `tutorial` | Ver o passo a passo |
| `prompt` | Copiar o prompt |
| `repositorio` | Abrir o repositório |
| `curso` | Fazer o curso |
| `template` | Baixar o template |
| `automacao` | Montar a automação |
| `skill` / `mcp` | Instalar |
| `ferramenta` | Conhecer a ferramenta |
| `checklist` | Ver o checklist |
| `estudo-de-caso` | Ler o caso |

---

## 6. Frescor

`situacao` é derivada, não digitada à mão:

- `verificadoEm` nos últimos 30 dias → **verificado**
- entre 30 e 90 dias → **atualizado**
- mais de 90 dias → **requer revisão** (aparece no card, em texto, não só em cor)
- marcado à mão → **descontinuado** (card com faixa e aviso; continua acessível, nunca some — link antigo não pode quebrar)
