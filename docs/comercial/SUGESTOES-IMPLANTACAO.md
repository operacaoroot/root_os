# Sugestões para a Implantação de clientes (rodada de produção 1, 21/10/2026)

Para o Rodrigo escolher. Nesta rodada entraram só duas coisas: as datas legíveis no cartão
(`na etapa há N d`, a próxima data em `dd/mm` com o dia da semana no balão) e a seção "Quem
trabalha nesta etapa" no painel do card. O resto fica aqui, cada item com o problema que
resolve e o custo.

## Por que a Implantação aparecia vazia

O card da implantação só nasce por três portas: o fechamento do funil, "Registrar cliente já
fechado" e "Iniciar onboarding". Os clientes da produção estavam no CRM antigo (listas
`cadastro` do Trabalho) e nunca passaram por nenhuma delas. E os agentes do onboarding
trabalham sobre o trilho, quando alguém entrega uma ata ou pede um dossiê na bancada; nada na
tela dizia isso. O importador do CRM (P5) abre o card de quem estava em Kickoff ou
Implantação, com o trilho, e o painel passa a mostrar quem trabalha em cada etapa.

## Sugestões

| # | Sugestão | Problema que resolve | Custo |
|---|---|---|---|
| 1 | **A próxima reunião do cliente no cartão**, lida da Agenda (Google) pelo e-mail do contato, pela porta (capacidade de leitura já existente). | Hoje o cartão só sabe o prazo da tarefa e o do próximo passo; a reunião marcada fica fora, e o kickoff some do quadro. | Médio: uma leitura por cliente pela porta, com cache curto; precisa decidir o que casa (e-mail do contato, nome do evento). |
| 2 | **Etapa do card puxa a fase do trilho** (Kickoff marcado → Contrato e onboarding, Imersão → Imersão), com aviso quando divergem. | O card e o trilho andam separados: dá para o card estar em Imersão e o trilho ainda na fase 1, e ninguém percebe. | Baixo: só leitura e um selo "fase do trilho diferente"; mover sozinho fica para depois. |
| 3 | **Botão "Pedir agora" em cada agente** de "Quem trabalha nesta etapa" (ler ata, gerar dossiê, personalizar roteiro), abrindo a bancada no ponto certo. | A seção diz o que cada agente faria, mas a pessoa ainda precisa achar onde pedir. | Baixo: os três já têm rota; é atalho na tela. |
| 4 | **Limite por etapa (WIP) na lista "Onboarding de cliente"**, com o número combinado na mesa (por exemplo, 3 em Imersão). | Com os clientes importados, várias implantações podem empilhar na mesma etapa sem alarme. | Baixo: o limite já existe (`WorkStatus.limite`, avisa e não trava); falta o número. |
| 5 | **Relógio do onboarding com aviso no dia a dia** (Visão geral), além do marco no trilho: "3 clientes sem próximo passo". | O relógio grava a pendência no trilho, mas quem não abre o trilho não vê. | Baixo: leitura das pendências que já existem; cartão novo no painel. |
| 6 | **Anexar o PDF do contrato importado** direto do cartão de Contratos vivos, virando `contrato.anexado` (o mesmo do "Registrar cliente já fechado"). | Os contratos que vieram do CRM antigo estão sem documento; a tela pede, mas não oferece o caminho. | Médio: reaproveita o armazém do fechado fora; sem cobrança, sem R4 (fato passado). |
| 7 | **Parcelas e vencimentos dos contratos importados** decididos pela mesa e lançados à mão, ligando a régua só depois. | O contrato importado não avisa cobrança nenhuma (decisão desta rodada); sem as parcelas, a régua nunca vai valer para ele. | Médio: tela de lançamento e decisão de quem confere; a régua já existe. |
