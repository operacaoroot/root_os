# Entrega e validação — 04/11/2026

Primeiro lote publicado em https://os.operacaoroot.com/cofre às 09h59 (BRT). Revisão funcional `aa7ecee71220239f08137a6866987d5070ac760c`, imagem `rootos-official:clientes-aa7ecee`, API e web no mesmo digest `sha256:325e712fdb0184e38c8f59692776717abce363c24f4a5047098419bacbd3d635`. Base publicada preservada: Etapa 5, `7396c26f99ab121ee53a78c438438d34e8bf5a65`.

## Acesso

No cofre, entrar com a conta ROOT e destrancar com a senha pessoal. O seletor permite escolher Juma Consultoria Ambiental, outros clientes, ROOT interno e, para visão ampla, itens sem classificação. Novos itens e links exigem cliente cadastrado. O administrador com visão ampla administra a carteira no painel “Acesso por cliente”.

Perfis restritos só alcançam os métodos adaptados; as demais áreas da API ficam bloqueadas antes de efeitos como consumir aprovações. O restante da adaptação está descrito no PLANO.md. Nenhuma pessoa nova recebeu acesso durante esta entrega.

## Testes anteriores às alterações

- Cofre: três casos falharam comprovando lista de itens e depósitos de A/B/legado e criação em cliente não permitido; depois passaram com a implementação.
- Interface: três casos falharam por falta do seletor; os testes de gestão também foram executados em vermelho antes do painel.
- Identidade incompleta: teste comprovou consulta com filtro omitido; a autorização passou a negar antes de consultar.
- Provisionamento: novo administrador ficava sem carteira; teste em Postgres falhou antes da correção. Depois passou, junto da prova de rollback de organização/usuário quando o perfil falha.

## Evidências finais

| Verificação | Resultado |
| --- | --- |
| API: núcleo de escopo, HTTP/guards, banco, cofre, depósitos, sessão e administrador inicial | 74 passaram; 1 teste preexistente ignorado |
| Interface: seleção, segredo/download atrasados, troca de conta, criação, links, carteira e formulário público | 11 passaram; typecheck web passou |
| Artefato compilado, HTTP e Postgres descartável | Leitura autorizada; ID cruzado negado em revelação/edição/exclusão/download; link para cliente indevido negado; auditoria/agentes/financeiro bloqueados para SELECTED; revogação com mesmo JWT e cofre aberto bloqueou também o link público |
| Build | API e web passaram sobre a base Etapa 5; após ajuste exclusivo de provisionamento, API recompilada no artefato final, mantendo a web já validada |
| Inicialização | AppModule completo em NODE_ENV=production, credenciais sintéticas e cron desligado; injeção e rotas verificadas |
| Produção | Saúde e banco OK; cofre e formulário HTTP 200; versão das duas imagens conferida |

O banco de QA recebeu somente estrutura e dados sintéticos. A bateria de depósitos também foi executada com papel restrito. O teste HTTP do artefato usou conexão superusuária, comprovando que a autorização por cliente é imposta pela API independentemente de RLS.

## Suítes amplas e limites

A suíte de isolamento por organização terminou com **580 aprovados e 3 falhas preexistentes**: quatro tabelas `_diario_*` vindas do schema produtivo sem cobertura RLS/registro da suíte; e um chamador de plataforma não declarado em `marketing-estudio/memoria-do-marketing.service.ts`. As novas tabelas de carteira estão no registro e nas fixtures. Três problemas iniciais de permissões do papel de QA foram corrigidos apenas no ambiente descartável antes da execução final.

A suíte de provisionamento teve 38 aprovados e 2 falhas anteriores: formato do retrato de contexto e classe do erro sem tenant. Ambas foram reproduzidas no artefato anterior ao ajuste de administrador inicial. Na bateria conjunta: 112 aprovados, 2 falhas anteriores e 1 ignorado.

A suíte web completa não foi declarada aprovada. Em recorte do código anterior, foram reproduzidas 19 falhas: Navegação (2), Metas do Mês (16) e Agenda (1, timeout). Os testes específicos desta melhoria passaram.

Produção ainda usa papel superusuário e TENANT_MODO=observar. Portanto esta entrega não declara RLS produtivo por cliente nem liberação dos módulos restantes para carteira restrita. A camada aplicada neste lote é a autorização da API, apoiada por FKs compostas; o papel restrito e as áreas seguintes constam do plano.

## Preservação da JUMA

O depósito existente foi vinculado ao Partner canônico, junto de um item recebido. A classificação usou referência exata ao depósito/recibo e travas de linha. Foram comparados hash do token, vencimento, IDs e fingerprints do conteúdo cifrado antes/depois. O conteúdo, o token e o prazo permaneceram iguais. O link não foi reemitido e o estado público respondeu com envio disponível. Vencimento preservado: **10/11/2026 às 21h01 (BRT)**.

Nenhuma senha foi exibida, enviada por e-mail ou decifrada para esta migração. Os itens permanecem armazenados após encerrar o link.

## Publicação e recuperação

Release: `/srv/rootos/releases/clientes-aa7ecee-20261104/` na VPS ROOT. Contém `REPORT.json`, logs de build/QA/migration, script de publicação, `rollback.py`, fonte da alteração, `JUMA-RESULTADO.json` e backup do banco de **162.390.525 bytes**, em arquivo protegido. O diretório do backup foi validado por pg_restore; isso não equivale a uma restauração integral de produção.

A publicação preservou a cadeia Compose efetiva e alterou somente as imagens de API/web. A única migration pendente autorizada era `20261104020000_isolamento_clientes`. O rollback recusa voltar ao binário antigo se houver usuário ativo restrito ou sem perfil, para não reabrir acesso amplo. O snapshot protegido da JUMA contém apenas metadados/fingerprints para conferir preservação e não deve ser anexado a chats ou PRs.

Plano e modelos: PLANO.md. PR: https://github.com/operacaoroot/root_os/pull/47.
