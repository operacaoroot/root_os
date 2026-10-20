# ROOT OS — autonomia de desenvolvimento

> Trazido de `pedro/operacao-painel-20261014` (7ed42fb) em 19/10/2026, parágrafo a parágrafo, só com o que não contradiz a branch `homolog/final-20261019`. Onde o texto do Pedro contradizia o que as rodadas de 13 a 19/10 escreveram (quem pode fazer merge e deploy sem nova confirmação, o que substitui as regras dos roteiros, o papel de `/srv/marketing-os`), vale o da branch e o parágrafo ficou de fora. A lista do que ficou de fora e o porquê está em `homolog/RESULTADO-AJUSTES.md` §A1. As regras da homologação no Predator seguem em `docs/comercial/PASSAGEM-PREDATOR-COMERCIAL.md` §0, e a virada em `docs/comercial/VIRADA-PRODUCAO.md`.

Autorização de Pedro em 11/10/2026, neste chat: Rodrigo assume o desenvolvimento; retirar os bloqueios de aprovação repetida para a equipe já autorizada no projeto.

## Trabalho autorizado

Rodrigo coordena a continuidade do desenvolvimento. Antes de escrever, confira branch, diff e alterações dos demais. Preserve trabalho existente e combine a autoria quando houver edição simultânea. Faça verificações proporcionais à mudança e assuma os testes técnicos, sem depender de Pedro para QA rotineiro. Antes de migrations ou deploy, preserve a possibilidade de recuperação e confira a configuração efetiva. Registre commit, resultado e o que ficou pendente.

## Alcance

A autorização cobre o desenvolvimento e a operação técnica do ROOT OS com os acessos existentes. Não concede acesso a novas pessoas, não autoriza apagar dados de negócio ou trabalho alheio e não se estende a outros projetos. Preserve segredos e os controles de autenticação, isolamento e permissões do produto. Aprovações de negócio, como pagamentos, assinaturas e envio de mensagens a terceiros, continuam sujeitas à autorização da operação correspondente.

Não use este documento para desativar controles da plataforma de programação ou contornar permissões de SSH, GitHub ou provedores. Se houver bloqueio técnico real, identifique a ferramenta, o erro e a ação afetada; continue o trabalho independente. Não confunda esse bloqueio com falta de autorização de Pedro para desenvolver ou publicar código.

## Referência de produção

Em 11/10/2026, o endereço oficial é https://os.operacaoroot.com e o projeto Compose é `root_marketing-os`, com diretório base `/etc/easypanel/projects/root/marketing-os/code`. O estado efetivo deve ser conferido nos containers, imagens e na cadeia de arquivos Compose antes de um deploy. Não substitua essa cadeia apenas pelo compose de um checkout antigo.
