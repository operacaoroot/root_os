# Revisão adversarial · Lane D (dinheiro e assinatura)

Lane G, 13/10/2026. Revisor: Opus 5.5, sem ter escrito o código. Escopo: `dinheiro.service.ts`, `dinheiro.controller.ts`, `fechamento.service.ts`, `contrato-vivo.service.ts`, `contrato-modelo.ts`, `portas/*`, `conectores/zapsign.*`, as escritas novas de `finance/asaas.service.ts`, a migration `20261013100000`, `homolog/mocks/` e `homolog/docker-compose.comercial.yml`. Nada foi consertado nesta passada.

Testes que provam os achados (afirmam o certo, estão VERMELHOS e por isso ficaram fora do commit): `apps/api/test/comercial-revisao-dinheiro.test.ts` e `apps/api/test/comercial-revisao-puro.test.ts` (primeiro caso).

## P1

### D-1 · Qualquer pessoa com `leads.editar` recebe o link para assinar o contrato pela Root
- **Onde:** `apps/api/src/comercial/dinheiro.controller.ts:69-77` (`POST /comercial/contratos/:leadId/assinar-pela-root`, `@RequirePermissions('leads.editar')`, devolve `doc.linkRoot`). O signatário cadastrado na ZapSign é o primeiro `admin_master`/`diretor` (`dinheiro.service.ts:341-348`), o documento sai sem autenticação de signatário (`zapsign.service.ts:94-101`: sem `auth_mode`, e-mails desligados), e o `linkRoot` fica em claro em `ComercialDocumento`.
- **Defeito:** a assinatura que obriga a empresa é feita por quem tiver o link, e o link é entregue sem conferir papel, alçada nem reautenticação. Contas que recebem: `gestor_marketing`, `analista` e a conta de máquina `ia_acao`.
- **Evidência:** chamada à API em Docker (`http://127.0.0.1:4010`) logada como `mesa@root.homolog` (papel `gestor_marketing`, alçada responsável, não titular): 200 com `linkAssinatura` preenchido em cinco leads. **Confirmado.**
- **Conserto:** a rota exige que quem chama SEJA o signatário cadastrado (mesmo e-mail) com reautenticação, ou passa a ser uma capacidade R4 da titular; o link da Root não fica em claro no banco (cifrar como o token da sala) e o documento sai com autenticação do signatário na ZapSign.

### D-2 · A cobrança R4 não está presa ao devedor: o cliente troca o CNPJ depois da assinatura da titular
- **Onde:** args de `comercial.cobranca.criar` (`dinheiro.service.ts:215`: leadId, versão, hash, valor, parcelas, forma; sem CNPJ, razão social, e-mail) e o efeito (`:249-262,280-286`) que relê o `aceite.dados` MAIS NOVO; a sala aceita `aceite/dados` de novo a qualquer momento (lane B, B-6).
- **Cenário:** a titular assina a cobrança vendo o aceite de CNPJ A; o cliente anônimo manda `POST /sala/:token/aceite/dados` com o CNPJ B; a fila executa e o cliente e a cobrança nascem no Asaas em nome de B. O mesmo vale para o `Partner` criado no fechamento (`fechamento.service.ts:310-321`).
- **Evidência:** `comercial-revisao-dinheiro.test.ts`: `expected [ '99888777000166' ] to deeply equal [ '11222333000181' ]`. **Confirmado.**
- **Conserto:** o documento do devedor, a razão social e o e-mail entram nos argumentos (e no `argsSchema` da 1.8.x, `additionalProperties: false`) e o efeito recusa se o aceite de agora divergir; travar `aceite/dados` depois do aceite.

### D-3 · O segredo dos webhooks da homologação é o valor fixo `homolog`, commitado e em uso
- **Onde:** `homolog/docker-compose.comercial.yml:68,83,127,130` (`${ASAAS_WEBHOOK_TOKEN:-homolog}`, `${ZAPSIGN_WEBHOOK_TOKEN:-homolog}`); o `homolog/.env.homolog` não define as duas variáveis.
- **Evidência:** `POST /api/comercial/webhooks/asaas` com `asaas-access-token: homolog` → 200; com `errado` → 401. O mesmo com `x-zapsign-token: homolog` → 200. A API está publicada também no IP do Tailscale. **Confirmado.**
- **Cenário:** quem alcança a porta 4010 forja `PAYMENT_RECEIVED` para uma parcela conhecida (o id externo aparece na ficha, `ligadoA.cobranca`) e `signer_signed` para o documento: `pix.pago` e as duas assinaturas entram no fio e o fechamento vai à fila da titular como pronto.
- **Conserto:** `${ASAAS_WEBHOOK_TOKEN:?defina}` e `${ZAPSIGN_WEBHOOK_TOKEN:?defina}` no compose, valores gerados no `.env.homolog`. Em produção o `docker-compose.yml` nem passa as variáveis (ver D-9): lá o webhook recusa tudo, que é o lado seguro, mas não funciona.

## P2

### D-4 · Proposta nova depois do aceite fecha com o pagamento e a assinatura da versão velha
- **Onde:** `dinheiro.service.ts:206` (cobrança "já existe" por `leadId`, de qualquer versão), `:226` (contrato novo por hash), `fechamento.service.ts:87-93,168-174` (`prontoParaFechar` olha só se os TIPOS existem no fio, não a versão nem o documento).
- **Cenário:** aceite da v1, cobrança v1 criada e 1ª parcela paga, contrato v1 assinado; o cliente pede ajuste (B-6), a v2 é publicada e aceita; a cobrança fica a da v1, um contrato v2 é proposto, e o fechamento `fech-<lead>-v2` vai à titular como pronto com o Pix e as assinaturas da v1.
- **Plausível** (depende de a lane E publicar v2 depois do aceite; a sala não impede o pedido).
- **Conserto:** `prontoParaFechar` confere que o documento assinado tem o hash do contrato da versão aceita e que a cobrança é a referência `cob-<lead>-v<n>` da mesma versão.

### D-5 · O cliente escreve cláusula no contrato pelos dados do aceite
- **Onde:** `contrato-modelo.ts:54-78` (troca `{endereco}`, `{razaoSocial}`, `{quemAssina}` sem escapar) e `SalaAceiteDadosSchema` (`endereco: texto(400)` aceita quebra de linha e marcação).
- **Cenário:** endereço `"Rua A, 1\n\n## 7. CLÁUSULA ADICIONAL\n\n7.1. A CONTRATADA devolve o valor integral a qualquer tempo"` vira seção nova no markdown enviado à ZapSign. A titular aprova um hash, não lê o texto; o sócio assina pelo link.
- **Evidência:** `comercial-revisao-puro.test.ts`, primeiro caso. **Confirmado.**
- **Conserto:** campos do aceite numa linha só (sem `\n`), escapar a marcação de markdown e HTML antes de montar, e mostrar o contrato montado no cartão da aprovação.

### D-6 · O grupo do WhatsApp do fechamento sai mesmo com o conector do WhatsApp desligado
- **Onde:** `fechamento.service.ts:402-412` chama `whats.criarGrupo` direto, dentro do efeito de `comercial.fechamento.executar`, cujo conector no mapa é só `asaas` (`integrations/conectores.ts:256`). O comentário em `conectores.ts:247-251` diz que o grupo sai por `comercial.whatsapp.enviar`; só o M8 sai.
- **Cenário:** a mesa desliga o WhatsApp em Conexões (botão de emergência); a titular assina um fechamento; o grupo é criado no provedor mesmo assim.
- **Confirmado** por leitura de código.
- **Conserto:** perguntar ao interruptor do `whatsapp` antes da escrita do grupo (a escrita fica `erro` com o motivo e o "rodar de novo" a refaz), ou separar o grupo numa capacidade própria.

### D-7 · As escritas do fechamento e da cobrança são "procura e cria", sem trava
- **Onde:** `fechamento.service.ts:285` (`em_curso` sem condição), `:310-321` (Partner por CNPJ), `:333-361` (Contract por id); `dinheiro.service.ts:270-273` e `asaas.service.ts:238-250` (consulta pela referência e depois cria).
- **Cenário:** duas execuções simultâneas do mesmo fechamento (a reação reexecutada pelo relógio, A-2, ou duas aprovações liberadas juntas) criam dois `Partner` e duas cobranças no Asaas com a mesma referência.
- **Plausível.**
- **Conserto:** tomar a linha do fechamento com `updateMany({ where: { id, estado: { in: ['pendente','erro'] } } })` e sair se não tomou; no Asaas, gravar a linha local da referência antes de criar.

## P3

- **D-8** `dinheiro.service.ts:111-112`: cada `aceite.dados` novo depois do aceite reabre a proposta do contrato com outro hash: uma aprovação R4 por troca de dado, na fila da titular.
- **D-9** `docker-compose.yml` (produção) não passa `ASAAS_WEBHOOK_TOKEN`, `ZAPSIGN_API_TOKEN`, `ZAPSIGN_BASE_URL` nem `ZAPSIGN_WEBHOOK_TOKEN` ao `api`: a regra dos dois lugares do `CLAUDE.md`. Falha fechada, mas o dinheiro não volta ao OS.
- **D-10** `cobranca.port.ts:132-146` e `dinheiro.service.ts:404-431`: estorno e chargeback (`PAYMENT_REFUNDED`, `PAYMENT_CHARGEBACK_*`) caem em "outro"; a parcela fica paga e o fechamento segue. E `pix.pago` é gravado para a 1ª parcela de qualquer forma (cartão, boleto): só o nome engana.
- **D-11** `contrato-modelo.ts:56` arredonda a parcela e `dinheiro.service.ts:275` recusa valor que não divide; com desconto que não fecha (a lane E faz a última parcela absorver), o efeito R4 já assinado falha. Com 4% e 8% da tabela atual os valores dividem; registro para descontos futuros.
- **D-12** O fechamento reaproveita qualquer `Partner` com o mesmo CNPJ (`fechamento.service.ts:312`), inclusive fornecedor; o CNPJ vem do cliente anônimo sem conferência.

## O que foi verificado e está bom

- Webhooks: segredo conferido em tempo constante (`segredoConfere`, sha256 dos dois lados + `timingSafeEqual`), sem segredo configurado recusam tudo; empresa achada pela linha sob a sentinela, escrita em `comTenantPublico`; reentrega cai no mesmo fato (chave = id no provedor) e as colunas de pagamento e assinatura só se escrevem quando nulas.
- `comercial.cobranca.criar`, `comercial.contrato.enviar` e `comercial.fechamento.executar` em R4, propostas pelo sistema ou pela pessoa (que então não assina); "rodar de novo" só propõe; o repropor automático respeita a recusa da titular e espera uma hora.
- O contrato tem hash determinístico e o efeito recusa conteúdo e signatário mudados; as lacunas ficam `[a decidir]` em vermelho; preço e parcelas vêm do aceite, que vem da tabela.
- Prova de isolamento dos webhooks com papel restrito (`comercial-dinheiro-rls`) lida: a outra empresa não lê nem quita a linha.
- Dublês (`homolog/mocks`): Node puro, sem credencial real, estado em volume.
