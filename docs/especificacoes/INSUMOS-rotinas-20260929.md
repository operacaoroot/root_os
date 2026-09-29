# Entradas e horário da coleta em Rotinas

A página Rotinas passa a reunir os caminhos para Radar, Captura e Pauta, além das fontes já cadastradas. A leitura usa o contrato existente de `/pauta/fontes`, com a sessão atual, `pauta.ver` e confirmação do módulo `pauta`. Falha nas fontes não impede carregar rotinas e histórico. Respostas de uma sessão anterior são descartadas.

O painel distingue fonte ativa/pausada, ausência de leitura registrada, última leitura, contagem total de capturas e erro/aviso persistido. Apify configurado não vira conexão saudável. A etiqueta do Gmail não prova que conta e etiqueta estejam acessíveis. O recebimento do WhatsApp depende do grupo conectado. Captura pelo formulário não entra automaticamente na rodada, pois não recebe uma fonte W/N/R/C/L.

Os caminhos de edição são rotulados como consulta para quem não tem `pauta.editar`. Os materiais autorais continuam em Trabalho e o guia continua em Conhecimento da empresa; nenhum material é reimportado ou regenerado por este lote.

## Horário

A criação da coleta começa com dia da semana e horário, mantendo quinta 22h, America/Sao_Paulo e janela de 168 horas. O corpo enviado continua sendo `cron`, `tz` e os campos existentes; não muda a API nem rotinas já cadastradas.

O modo avançado permite a expressão original de cinco campos. Uma expressão com lista, intervalo, passos ou restrição por mês/data permanece no avançado quando não cabe no modo simples. A tela avisa antes de qualquer perda. Trocar o modo ou cancelar não cria rotina; apenas o clique Criar rotina envia o pedido existente.

## Aceite e limites

- Fontes só consultadas com sessão, permissão e módulo confirmados; sem resposta atrasada de outra sessão.
- Estados de fonte distintos e sem afirmar conexão que não foi testada; erro local não esconde a operação.
- Domingo/meia-noite, sábado 23:59, fuso informado, alternância de modos e frequência avançada preservados.
- Criar/pausar/executar mantém o contrato existente. Nenhuma coleta paga ou publicação usada para verificar UI.
- Marca, 39 destinos e áreas de outros responsáveis preservados. Sem schema, credenciais ou políticas novas.

A main inclui a PR 23 e depende da migration MK ainda não aplicada em produção. Este lote pode ser integrado após revisão/CI, mas não deve ser publicado enquanto essa dependência não for autorizada e resolvida. Produção permanece na imagem da PR 22.
