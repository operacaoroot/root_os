# Release — papel restrito do banco

Status: publicado e verificado em produção em 04/11/2026, 21:53 em São Paulo (05/11, 00:53 UTC). API com `mktos_app`, sem SUPERUSER/BYPASSRLS, e `TENANT_MODO=impor`; sem credencial dona no runtime. Frontend e checkout de Lucas preservados.

Solicitação: issue [#51](https://github.com/operacaoroot/root_os/issues/51). Revisão: [PR #52](https://github.com/operacaoroot/root_os/pull/52).

## Proveniência

- Base publicada: `99c02cb235ce9cb7377b165ac1061ce33edc1cf1`, etapa 10. Checkout de Lucas preservado.
- Código da candidata: `d8c0453b05dbaf7d428fa438c884929626946389`.
- Imagem: `rootos-rls:marketing-d8c0453b`, digest `sha256:bbceb623bbdd9d16bb2ce79bf41c994f6533fd1d9da68969e35ec3f376eed910`.
- `6405329f0c6d728ea3db641a6116442ee2037474` altera somente CI e whitelist pública; `9d2640bcf43eb326eed446ce1119ae475ee2bfd0` adiciona a proteção de overlays e os ajustes dos testes web ao layout já publicado. `97c93fb1a29e3396257a647bc11cf98c14674b4f` estabiliza datas de teste em UTC/São Paulo e aguarda a releitura da fila de decisões, além de permitir diagnóstico da API após falha web no CI. Código executável da API, web e MCP idêntico ao da imagem; o script de publicação usado deve ser o de `9d2640bc`.
- Revisão de testes enviada ao CI: `d72bdb44f4de5b33110fcd1ef131c41b6f2f2109` (inclui `9598e45a`). São ajustes de testes; nenhuma diferença executável de API/web/MCP em relação a `d8c0453b`.
- Frontend preservado da imagem publicada `rootos-official:etapa10-99c02cb`. Esta release troca somente a API.
- A branch de base do PR é uma referência à produção, `release-base/rls-99c02cb`. `main` diverge da produção; não foi mesclada por conveniência.

## Testes antes do código

| Frente | Falha reproduzida | Evidência local |
| --- | --- | --- |
| Boot | 9 negativas de papel desconhecido/privilegiado; depois 2 de CREATE/TRUNCATE | `boot-red.log`, `boot-ddl-red.log` |
| Crons | Leitura de negócios sem tenant e identidade humana herdada pelo cron | `contexto-red.log`, `cron-ator-red.log` |
| Marketing HTTP | Apify, Drive e referência ROOT compartilhados com empresa externa | `marketing-http-red.log`, `marketing-gosto-red.log`, `marketing-apify-red.log` |
| Bio | Resolução/consumo do state falhavam sob papel restrito | `bio-red.log` |
| Provisionamento | Slug repetido, origem indevida, ator contraditório e corrida sob RLS | `provisionamento-red.log`, `provisionamento-identidade-red.log`, `provisionamento-corrida-red.log` |
| Trilho/kit | Empresa adotada pela coincidência do slug e conteúdo estrangeiro no kit | `trilho-red.log`, `trilho-kit-red.log` |
| MCP | Leituras antigas usavam serviço A enquanto operador era B | `mcp-identidade-red.log` |
| Publicação | Divergências de configuração, destino e evidências; falhas antes de escrita e limpeza de env privilegiado | `release-hardening-red.log` e testes do script |

Logs locais em `/tmp/root-rls-producao`. As provas completas no servidor ficam no diretório privado da release, `/srv/rootos/releases/rls-marketing-20261104`; configuração e dumps não foram copiados para o repositório.

## Validação por ambiente

- Local: build API/MCP, tipos dos 23 arquivos de teste alterados; 593 casos de isolamento; 10 HTTP Marketing; 56 rotas públicas sob RLS; 15 MCP; 83 Trilho, incluindo 5 sob papel real; regressões de crons e provisionamento. Os números se referem a execuções distintas, com sobreposição; não somá-los como testes únicos.
- Homologação: cópia restaurada da produção, com 194 tabelas, rede Docker interna, sem credenciais de provedores. Duas migrations aplicadas. AppModule completo iniciado com somente `mktos_app`/`impor`; 52 casos de plataforma em sete arquivos, zero pulos.
- HTTP na imagem: dois logins reais, alternância A/B, leitura/escrita própria, IDs cruzados recusados, outras áreas recusadas, módulo pauta, Apify compartilhado contido. MCP real por HTTP com operador B e serviço A devolve somente B. Sessão SQL sem empresa não lê notas.
- Recuperação: backup imediatamente anterior restaurado em `rls_rollback_test`; falha deliberada do container (exit 23), recriação com imagem restrita, migrations e oito verificações SQL/HTTP/MCP aprovadas. Catálogo restaurado: 194 tabelas, zero tabelas acessíveis sem RLS/FORCE, zero TRUNCATE e CREATE, duas migrations novas aplicadas.
- Reparos do CI: fixtures web alinhadas ao layout já publicado; datas de Agenda fixas na virada UTC/São Paulo; conclusão assíncrona da Caixa aguardada; dublê do agendador adaptado à descoberta de organizações, com prova do contexto de assinatura e suspensão; exceção do verificador de credenciais limitada à atribuição de contas sintéticas no harness. As falhas correspondentes foram reproduzidas antes dos ajustes, sem alterar o comportamento de produto para fazer testes passarem.
- Backup adicional da janela: `publication-window.dump`, gerado em 05/11/2026 00:36:55 UTC (04/11, 21:36:55 em São Paulo), 165.865.641 bytes, SHA-256 `fafdf6eabf01438bf83e63575f14426032e972ddc21502665687158bf4c8d184`. Restaurado integralmente em `rls_final_restore_test`, migrations aplicadas e catálogo restrito aprovado às 00:38:16 UTC. Backup privado de papéis também preservado; não restaurar definições antigas por cima do papel restrito sem reconciliação.
- CI final: [run 41942407241](https://github.com/operacaoroot/root_os/actions/runs/41942407241), revisão `d72bdb44`, todos os três jobs aprovados. Policy 118/118, web 2.300/2.300, API 6.699/6.699, MCP 15/15 e script de publicação 13/13; verificadores de cobertura recusam pulos. Isolamento e migrations aprovados. Alterações posteriores deste fechamento são somente documentação.
- Produção: saúde pública `https://os.operacaoroot.com/api/health` respondeu 200 às 00:53:17 UTC. Oito verificações SQL/HTTP/MCP no container publicado passaram às 00:53:21 UTC, usando duas empresas temporárias e papel Marketing mínimo. IDs cruzados recusados, escrita própria permitida, áreas fora de Marketing recusadas, identidade MCP B preservada e sessão SQL sem tenant vazia. As duas empresas foram removidas pelo manifesto exato após a prova.
- Catálogo publicado: `mktos_app` com LOGIN, sem SUPERUSER, BYPASSRLS, CREATEDB, CREATEROLE ou REPLICATION; zero memberships e zero tabelas acessíveis sem RLS/FORCE. As duas migrations estão concluídas. Configuração da API validada sem URL dona. Web manteve imagem e instante de início anteriores; somente API foi recriada. Evidências privadas: `production-runtime-result.json`, `production-catalog.json`, `production-health.json`, `production-qa-cleanup.log`.

## O que ficou de fora

- Usuário, convite e credenciais reais de Lucas Rezende. O onboarding deve usar empresa própria, módulo `pauta`, perfil `ALL` apenas nessa organização e papel mínimo específico. Não atribuir `admin_master` ou `gestor_marketing` padrão como acesso externo.
- Instalações MCP dos computadores de operadores: o pacote corrigido foi compilado e testado por HTTP na imagem, mas a release não atualiza automaticamente essas instalações. Não distribuir a configuração antiga com serviço ROOT a um usuário externo.
- Conectores financeiros próprios de empresa externa: Asaas e Pluggy ainda usam credenciais do processo. A conferência de produção encontrou uma conexão Asaas, pertencente à ROOT, e nenhuma conexão bancária externa. Cron foi testado quanto ao contexto de banco; isso não certifica a origem ou autorização dos dados no provedor. O papel Marketing não recebe `financeiro.conciliar` ou `automacoes.executar`.
- Integrações próprias de Apify/Drive de outra organização. Recursos globais ficam contidos à empresa ROOT; nenhuma mensagem, assinatura, pagamento, publicação social ou upload externo foi disparado pelos testes.
- Lote 7 e os lotes ainda isolados que não faziam parte da produção. Nenhuma migração desse lote foi incluída.
- RLS por carteira dentro da mesma organização. Este lote restringe por `Org`; a autorização de carteira continua na API.
- Reconciliação de vínculos antigos de onboarding sem prova de criação. A carga de memória é recusada; o kit usa o contexto da origem. A release não fabrica prova retroativa nem adota empresa por slug.
- A corrida funcional preexistente entre dois states Bio diferentes da mesma conta/empresa. O consumo concorrente do mesmo state foi coberto; a corrida entre states distintos não é certificada por esta release.
- Benchmark de carga. As provas cobrem isolamento e funcionamento, não capacidade sob pico de tráfego.

## Recuperação e próximos deploys

O ensaio cobre recuperação de configuração/arranque com a candidata validada e restauração do backup em banco separado. Não certifica troca para uma versão anterior do código. A imagem antiga depende de acesso privilegiado e não é rollback válido depois da virada. A recuperação deve manter `mktos_app` e `TENANT_MODO=impor`, usando imagem compatível e o backup restaurado. Não voltar ao modo observar para contornar um erro. O rollback de imagem preserva o banco; não há restauração automática por cima da produção. Se uma recuperação de dados for necessária, preservar o estado corrente e reconciliar gravações posteriores ao backup antes de restaurar.

O comando de recuperação de configuração, mantendo a imagem restrita ensaiada e o banco corrente, é:

```sh
python3 /srv/rootos/releases/rls-marketing-20261104/release-9d2640bc.py \
  /srv/rootos/releases/rls-marketing-20261104 \
  --image rootos-rls:marketing-d8c0453b \
  --expected /srv/rootos/releases/rls-marketing-20261104/production-expected.json \
  --rollback
```

Esse snapshot é o capturado após a publicação. Uma mudança posterior de container ou configuração exige reconciliar o estado antes de usar outro snapshot. O script não restaura dados automaticamente; a prova de restauração está nas cópias separadas. A imagem antiga não deve ser usada para contornar a restrição.

O script confere container, início, imagem, configuração, montagens, cadeia Compose e hashes de seus arquivos antes da mudança; preserva os demais serviços e compara o container resultante. O lock é cooperativo. Os scripts atuais de Lucas não usam esse lock: não há promessa de exclusão atômica entre publicadores distintos. A janela exige ausência de outro processo de publicação e nova conferência do estado. Publicações futuras precisam incorporar este código e manter o overlay restrito.
