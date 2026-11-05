# Papel restrito do banco

Issue: https://github.com/operacaoroot/root_os/issues/51. Autorização de Pedro em 04/11/2026: antecipar antes do lote 7, ensaiar em cópia e publicar com backup e rollback.

## Base e escopo

Checkout próprio `codex/rls-producao-marketing`, base publicada `99c02cb235ce9cb7377b165ac1061ce33edc1cf1` (etapa 10). O checkout de integração de Lucas não é alterado. O lote 7 permanece separado. Antes de publicar, comparar novamente imagem e cadeia Compose; uma versão posterior exige reconciliação.

Produção de partida: papel `mkt` SUPERUSER/BYPASSRLS, modo observar. Alvo: conexão efetiva `mktos_app`, sem superusuário, BYPASSRLS, memberships ou propriedade de tabelas; modo impor; runtime sem credencial dona. Migrations e backup são operações separadas do processo HTTP.

## Responsabilidades e provas

| Frente | Modelo | Prova antes do código |
| --- | --- | --- |
| Plataforma, provisionamento, Bio público e MCP | GPT-6 Astra high | Repetição de slug e origem inválida; state consumido uma vez; identidade MCP única, sem fallback para ROOT |
| Crons Financeiro, Bio, rotinas e teto de IA | GPT-6.1 Terra high | Descoberta de Org e operação por empresa; PostgreSQL com papel restrito |
| Marketing e acesso externo mínimo | GPT-6.1 Sol high | HTTP autenticado em duas empresas, IDs cruzados, relações, módulo e permissões; recursos externos compartilhados recusados |
| Boot, catálogo, integração e release | Coordenador | Arranque recusa papel inseguro/desconhecido; diário sem RLS inacessível; restauração, imagem compilada e HTTP na cópia |
| Revisão independente | Astra/Terra/Sol, conforme autoria | Revisar fronteiras de outra frente; repetir provas com os arquivos finais |

## Aceite de publicação

1. Testes RED e GREEN registrados. HTTP Marketing alterna A/B com `mktos_app`, incluindo escrita própria e negativas por IDs e relações.
2. Login, provisionamento, callbacks públicos, crons e MCP têm escopo explícito. Sentinelas não escrevem dados de negócio.
3. Homologação usa cópia restaurada, rede sem saída e credenciais de provedores ausentes. Não testar pagamento, assinatura, mensagem ou upload real.
4. Runtime usa somente credencial restrita. O boot verifica catálogo, RLS/FORCE e papel; não admite diagnóstico desconhecido em impor.
5. Backup imediatamente anterior, configuração efetiva privada e imagem fixada. Ensaio de recuperação mantém a restrição; imagem antiga incompatível não é rollback seguro.
6. REPORT informa evidência por ambiente, diferenças, limitações e o que ficou fora. Não criar usuário real de Lucas nesta etapa.

## Limites a registrar

RLS deste lote separa organizações. A carteira de clientes dentro da organização continua sendo autorização da API. Apify, pasta global do Drive e referência de marca ROOT ficam limitados à empresa da casa; habilitar integrações próprias de outra empresa exige configuração específica. Permissões mínimas e módulo pauta precisam ser conferidos no onboarding; não usar admin_master ou gestor_marketing padrão como papel externo.
