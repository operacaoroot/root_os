# Ajustes da versão final — 19/10/2026 (noite)

> Respostas do Rodrigo aos quatro pontos em aberto do `homolog/RESULTADO-FINAL.md`.
> Branch: **`homolog/final-20261019`** (continua nela, sobre a tag `final-entrega-20261020`, 17b95d24).
> Ambiente: SÓ homologação no Predator. Nada em produção.
> Encerramento: `homolog/RESULTADO-AJUSTES.md` + tag `final-ajustes-20261020` + bundle delta `C:\Users\User\dev\ajustes-delta.bundle` (`homolog/final-20261019` + a tag, `^17b95d24`) + `rootos-final` (3030) e `rootos-final-seed` (3031) de pé com a imagem nova.

## As respostas

1. **Textos operacionais do Pedro** (o que difere entre 7ed42fb e o snapshot f5552402: `AGENTS.md`, cabeçalhos "Autorização vigente" do `CLAUDE.md`, `README.md`, `docs/DEPLOY.md`, `docs/PLANO-CONTINUIDADE.md`, 5 linhas do `.env.example`): **entram se não interferirem no que o Rodrigo fez; se contradisserem, o do Rodrigo é a referência.**
2. **Onboarding sem negócio fechado**: "quero que eu possa iniciar um onboarding sem o lead ter chegado em negócio fechado."
3. Tarefas dentro de Marketing e de Financeiro: **ficam como estão. Não mexer.**
4. Pendências no menu: **fica.** Não mexer.

## A1 — os textos do Pedro
- Para cada arquivo, trazer de `pedro/operacao-painel-20261014` (7ed42fb) o trecho que falta na branch, **parágrafo a parágrafo**. Entra o que é informação nova e não contradiz o que está na branch (o que as rodadas de 13 a 19/10 escreveram: `CLAUDE.md`, `docs/comercial/*`, `docs/DEPLOY.md` se tocado, `.env.example` com as variáveis novas). Onde contradiz (ex.: quem pode fazer deploy, onde roda a homologação, ordem da virada, regra de módulo, variável com outro sentido), **fica o da branch**, e o trecho do Pedro NÃO entra.
- `.env.example`: variáveis do Pedro que não existem na branch entram com o comentário dele; variável que existe nos dois com valor-padrão ou sentido diferente fica com o da branch.
- Tabela no RESULTADO: arquivo · trecho do Pedro (resumo, sem segredo) · entrou / ficou de fora · porquê. Nenhum segredo, token ou senha entra (conferir).

## A2 — iniciar o onboarding antes do negócio fechado
Hoje a Implantação só recebe card de duas portas: o fechamento (6ª escrita) e "Registrar cliente já fechado" (exige o PDF). A tela antiga de criar trilho à mão sumiu no merge (achado 2.2 da revisão). O Rodrigo quer **começar o onboarding com o lead ainda em andamento**.

- **Uma terceira porta, a partir do lead**: botão **"Iniciar onboarding"** no painel do lead (cabeçalho do painel ou aba Fio), disponível em qualquer etapa antes de fechado e fora das saídas (desqualificado, perdido, geladeira). Também na Implantação: **"Iniciar onboarding"** no topo do quadro, que abre a busca de leads do funil (não cria cartão solto sem lead; a porta única continua valendo para cartão avulso).
- **O que cria**: o card na lista "Onboarding de cliente", com os dados copiados do lead/ficha (empresa, CNPJ se houver, contato, telefone, e-mail, produto e valor se houver), **selo "Iniciado antes do fechamento · lead em <etapa>"**, retrolinks lead ↔ card ↔ trilho (`ComercialFicha.cardId`, `OnboardingTrilho.cardId`), e o fato `implantacao.iniciada_antes_do_fechamento` no fio do lead e na auditoria. **Etapa de entrada: escolhida no ato**, padrão "Kickoff marcado" (o card não entra em "Fechado no comercial", porque o lead não fechou).
- **Cliente** (T4, cliente obrigatório): cria ou reaproveita o `Partner` cliente desse lead (dedupe por CNPJ, senão telefone/e-mail, senão nome normalizado). Uma pessoa, um `Partner`, sempre.
- **Quando o lead fechar depois**: a transação de fechamento **reaproveita o card que já existe** (pelo `cardId` da ficha; o id do card continua derivado do lead), não cria outro, tira o selo de "antes do fechamento" e registra o fechamento no card. O `Partner` também é o mesmo. Provar que **rodar o fechamento com o card antecipado não duplica nada**.
- **Se o lead for perdido/desqualificado com o onboarding iniciado**: o card NÃO some; ganha o aviso "lead saiu do funil: <motivo>" e fica para alguém decidir (arquivar ou seguir). Nada é apagado automaticamente.
- **Nível pela escada** (`nivelPorEfeito`): efeito interno (sem mensagem ao cliente, sem cobrança, sem documento) → sem segunda pessoa. Permissões: `leads.editar` + `tarefas.editar`. Conta de máquina e agente não iniciam (só gente), como o mover do funil.
- A rota antiga de criar trilho segue viva; a tela usa a porta nova.

## A3 — provas e fechamento
- Testes de API: iniciar em lead em proposta → card na lista certa com selo, cliente `Partner`, fato no fio; iniciar duas vezes → um card só; fechar depois → o mesmo card, sem selo, nenhum `Partner` novo; lead perdido → card fica com aviso; agente/máquina → 403; lead fechado ou em saída → recusa com o motivo.
- e2e: novo roteiro curto `homolog/e2e/onboarding-antecipado.mjs` (no seed 3031): lead em proposta → Iniciar onboarding pelo painel → card na Implantação com o selo → clique abre o pop-up com o trilho → fecha o negócio pela jornada → continua um card só. Mais os 5 roteiros de sempre e o `final.mjs` na cópia (3030), verdes.
- Imagem nova nas duas stacks (`rootos-final` 3030 e `rootos-final-seed` 3031), sem perder os dados da 3030 (só migrations novas, se houver, por cima). `docs/comercial/VIRADA-PRODUCAO.md` atualizado se a virada mudar.
- `homolog/RESULTADO-AJUSTES.md`, tag `final-ajustes-20261020`, bundle delta, linha "Ajustes da final" no progresso.

## Regras duras
As de sempre (porta e política não afrouxam; migração aditiva; RLS; nada de dado de cliente no git ou em log; nada em produção). Revisor adversarial curto antes de fechar: a porta nova não vira caminho para cartão solto, não duplica card nem `Partner`, não deixa agente iniciar onboarding.
