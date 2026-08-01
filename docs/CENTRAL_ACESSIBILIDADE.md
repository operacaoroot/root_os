# Acessibilidade — Root Central

Meta: boas práticas equivalentes a WCAG 2.2 AA. Este documento registra as decisões e onde cada uma vive no código.

## Estrutura e navegação

- **Skip link** (`components/layout/SkipLink.tsx`): primeiro elemento focável, pula direto pro `#conteudo`.
- **Landmarks**: `header` sticky, `main` por página, `footer`, `nav` com `aria-label` distinto (principal, móvel, breadcrumb, rodapé).
- **Hierarquia de headings**: um `h1` por página; seções em `h2`; passos dos materiais em `h2` dentro de `article`.
- **Navegação por teclado**: todos os controles são `button`/`a` nativos; nada de `div` clicável. `aria-current="page"` no link ativo do menu.
- **Foco visível**: anel verde da marca em `:focus-visible` global (`globals.css`), inclusive nos cards.

## Componentes

- **Menu móvel e drawer de filtros**: Radix Dialog — focus trap, `Escape` fecha, foco devolvido ao gatilho, `aria-modal`, fundo sem rolagem. (A referência estudada não tinha nada disso — foi correção deliberada.)
- **Card de material**: o link cobre capa+título com `aria-label` completo; o botão de favorito é controle independente com `aria-pressed` — sem link aninhado.
- **Favoritar**: `aria-pressed` + rótulo que muda ("Salvar"/"Tirar dos favoritos").
- **Copiar prompt/comando**: feedback visual ("✓ Copiado") + `aria-live` polido; conteúdo em `<pre>` preservando quebras.
- **Busca**: `role="search"`, label associado (`sr-only`), contagem de resultados em `aria-live="polite"`.
- **Trilhas**: progresso em `role="progressbar"` com `aria-valuenow`; marcar concluído tem `aria-pressed` e rótulo por item.
- **Links externos**: domínio de destino visível por extenso, `rel="noopener noreferrer"`, aviso `sr-only` "(abre em nova aba)".

## Conteúdo e cor

- **Nada comunicado só por cor**: situação do material vem em texto (badge "Descontinuado", faixa na capa, aviso no topo da página).
- **Contraste**: tema escuro usa tinta `#DFFFE8` sobre `#070A08` (razão ≈ 17:1). No tema claro, o verde-limão puro não passa AA sobre branco — texto de acento usa `#4D7208` (≈ 6,7:1 sobre `#F4F8EE`); o verde-limão puro fica restrito a fundos de botão com texto preto (≈ 12:1).
- **`prefers-reduced-motion`**: bloco global zera animação e transição.
- **`prefers-color-scheme`**: respeitado por padrão; toggle manual persiste a escolha (`useTema`).
- **Idioma**: `<html lang="pt-BR">`; datas e ordenação em `pt-BR`.

## Estados

- Vazio de busca orienta o próximo passo (sugestões + catálogo completo abaixo) — nunca beco sem saída.
- Vazio de favoritos explica onde o marcador fica e leva pra biblioteca.
- Storage bloqueado (modo anônimo): a página explica em texto em vez de falhar em silêncio.

## Dívida conhecida

- Testes automatizados de acessibilidade (axe) ainda não rodam no CI — entrar junto com o Playwright.
- A command palette (⌘K) ficou fora da v1; quando entrar, seguir o padrão Radix + `aria-activedescendant`.
