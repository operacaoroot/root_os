# Integração do Marketing com a operação nativa — 29/09/2026

## Base e escopo

Integra os dez commits de `root-os/marketing-interno` (98b78fb) com a main b12e6c4, que já contém a sidebar reorganizada, contexto editorial e projeções de Trabalho em Agenda/Pauta. Preserva as 33 rotas existentes e acrescenta seis destinos de Marketing. A marca fica em Empresa e contexto; Marketing fica em Conteúdo. Todas as novas rotas exigem `pauta.ver` e módulo `pauta`.

A integração mantém o histórico de Lucas. O conflito de `nav.ts` foi resolvido sobre a organização atual. Os atalhos de Concorrentes e Agenda do mês abrem respectivamente `/referencias#concorrentes` e `/pauta?aba=semana`. As cinco abas de Referências quebram linha em telas estreitas.

## Consistência do banco de ideias

Editar e aprovar a mesma ideia concorrentemente antes podia produzir uma peça diferente da ideia salva. As duas operações agora obtêm um bloqueio de linha, limitado por empresa, antes da leitura, dentro da transação. A aprovação usa o texto salvo; uma edição que chegar depois recebe conflito. Duas aprovações devolvem a mesma peça. Os testes PostgreSQL cobrem essas três ordens de execução.

A peça de ideia continua sem rodada ou episódio inventado. WhatsApp/ClickUp continuam recusando esse tipo de peça quando a operação exige curadoria. Aprovar uma ideia não contorna a política de publicação externa.

## Fronteiras preservadas

- Trabalho mantém os cartões importados do ClickUp; o banco de ideias cria propostas editoriais novas. Não copia nem substitui silenciosamente os cartões existentes. A intenção de produto já definida por Pedro é adotar o OS após migração verificada.
- Metas semanais e estratégia mensal permanecem separadas. Não houve remoção de telas pelo nome parecido.
- O guia editorial importado como nota `editorial:marca:...` não preenche automaticamente a configuração `pauta.marca` usada pelo MK. A adoção do conteúdo existente exige um mapeamento explícito e verificado.
- OpenRouter, Instagram e Apify não tiveram credenciais alteradas. A leitura de insights reais da Meta segue dependente da conexão.

## Banco e publicação

A migration `20260928180000_pauta_ideia` cria PautaIdeia e permite `PautaPeca.rodadaId` nulo. Ela precisa ser aplicada antes de publicar a API e as telas MK. Merge do código não significa publicação do módulo.

O comando `deploy/mc/vps.sh` não deve ser executado sem adaptação ao estado atual: produção usa imagens e overrides versionados posteriores à base da frente MK. A publicação precisa registrar as imagens realmente em execução, ensaiar a migration em cópia isolada do banco, guardar backup e preservar os overrides atuais. Este lote de integração não altera o banco de produção.
