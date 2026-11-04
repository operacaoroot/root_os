# Depósito temporário de credenciais

Pedido de Pedro em 03/11/2026: Tarcilla entrega os acessos da JUMA; somente a equipe ROOT consulta. O link aceita envios por 7 dias. As credenciais permanecem até o encerramento do trabalho. Não há exclusão automática vinculada ao contrato: a equipe faz a remoção no encerramento.

## Uso

No cofre destrancado, abrir **Receber acessos de um cliente**, informar o cliente e gerar o link. Copiar imediatamente: o servidor guarda somente o hash. O painel mostra quantidade de envios e permite encerrar o link. Encerrar ou expirar não apaga itens já recebidos.

A página `/entregar-acessos#<token>` permite apenas depósito, sem criar conta. O portador do link pode enviar até 100 itens. O fragmento sai do endereço após abrir; para recarregar, reabrir o link original. Usuário, senha e observações são cifrados pelo mesmo mecanismo do cofre. O título do sistema recebe o prefixo do cliente. Nenhum endpoint público lista ou revela itens. Não encaminhar senhas por e-mail.

## Controles e limites

- Token aleatório de 256 bits; o prefixo de empresa apenas escolhe a partição. Hash, validade, revogação e permissão atual do emissor validam a capacidade. Acesso de consulta continua exigindo login, permissão atual e desbloqueio pessoal.
- Criação/gestão pela tela exige cofre aberto. O CLI operacional exige acesso ao servidor e identifica uma conta ativa com permissão de edição; cria somente a capacidade de depósito, sem destrancar o cofre. Escreve o link em arquivo exclusivo com modo 0600.
- RLS forçada nas duas tabelas novas; recibo não pode apontar para link de outra empresa.
- Cada entrega é uma transação com bloqueio de linha: cifra o item, grava recibo, incrementa contador e audita sem o conteúdo. Repetir o mesmo envio não cria outro item.
- O navegador não salva credenciais no armazenamento local. Após confirmação, limpa os campos. Em resposta incerta mantém o mesmo identificador e corpo para a confirmação.
- Limite de 120 pedidos por origem/hora, por processo, e corpo JSON de 100 kB. O teto persistido de 100 itens/link vale entre processos e reinícios.
- Expiração e revogação são verificadas no recebimento. Link expirado, revogado ou inválido responde com a mesma recusa. Sem leitura do segredo por IA/MCP.

## Validação em 03/11/2026

17 testes unitários do depósito/cofre e 3 testes do formulário passaram. Mais 5 testes passaram contra Postgres descartável com a estrutura atual de produção e papel restrito, cobrindo RLS, chave estrangeira entre empresas, concorrência, rollback e retenção. Fluxo HTTP compilado validou login, bloqueio do cofre, origem, recibo idempotente, teto do corpo e revogação. Formulário conferido no navegador com dados sintéticos, incluindo limpeza da senha e recibo.

Build da API e tipos do frontend e dos novos testes passaram. A suíte de módulos teve 91 casos passando, 9 sem banco e uma falha anterior à alteração: migrations `20261027010000_marketing_comentario_da_triagem` e `20261027010000_arquivo_do_clickup` têm o mesmo carimbo. Não foram renomeadas migrations já publicadas. A checagem de tipos de toda a suíte esgotou a memória; a checagem específica dos novos testes passou.

## Publicação

Base verificada: `root-os/cadastro-unico`, commit `1ce14f76248c12be9bcbf448ed0411193552e147`, imagem `rootos-official:cadastro-1ce14f7`. O Dockerfile incremental preserva essa versão e compila API/web com a alteração. Se a produção mudar durante o trabalho, revalidar/rebasear antes de publicar. Registrar backup, imagem e cadeia Compose efetiva; acrescentar somente o override da imagem. Aplicar apenas a migration nova após conferir o estado atual. Rollback volta à imagem anterior e mantém as tabelas adicionadas, preservando eventuais depósitos.

## Estado publicado

Publicado em 03/11/2026 às 20h40 (Brasília), imagem `rootos-official:cofre-deposito-eda5696`, revisão funcional `eda5696d7c36c1bae8d23fd339c065b1c4b00452`. API e web usam a mesma imagem. Backup de 158.446.694 bytes conferido; migration aplicada. `/api/health` confirmou API/banco e a página pública respondeu HTTP 200 com os cabeçalhos definidos. Registro operacional e retorno em `/srv/rootos/releases/cofre-deposito-eda5696-20261103/` na VPS ROOT.

O link JUMA foi emitido em 03/11/2026 às 21h01, conferido pela rota pública (sem depósito real) e enviado ao e-mail da operação; expira em 10/11/2026 às 21h01. O link completo não é armazenado neste documento nem no Git.

Limitação herdada da produção: a aplicação ainda conecta ao Postgres com um papel superusuário, que ignora RLS. Os testes com papel restrito comprovaram as policies novas, mas em produção a contenção deste fluxo depende dos filtros explícitos de empresa, da capacidade aleatória, da validade/revogação e das permissões verificadas na aplicação. Esta entrega não alterou o papel de conexão do restante do OS.
