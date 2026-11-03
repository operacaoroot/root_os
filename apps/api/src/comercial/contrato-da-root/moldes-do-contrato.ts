/*
 * OS DOIS MOLDES DO CONTRATO DA ROOT, COMO DADO VERSIONADO (Contratos, F2, 02/11/2026) — puro.
 *
 * Texto copiado por script de `references/clausulas.md` da skill root-contrato (versão do
 * Drive de 2026-10-26), sem alterar uma vírgula. Sem dado de cliente nem da contratada: `[[campo]]`
 * fica como está e quem troca é `preencher-molde.ts`.
 *
 * Formato do texto: `# ` título, `### ` cláusula, `- (a) ` alínea, uma linha por parágrafo.
 * A catraca de `comercial-contrato-moldes.test.ts` guarda o sha256 de cada molde: mudar
 * cláusula aqui é mudar o contrato da Root, decisão dos sócios, e o teste tem de ser
 * trocado de propósito junto.
 *
 * NÃO estão aqui, porque não são cláusula: o bloco de assinatura (vem de `signatarios`, sem
 * testemunhas) e o rótulo "QUALIFICAÇÃO DAS PARTES" do .docx, que `clausulas.md` não tem.
 */
import type { ModalidadeDeContrato } from '@mktos/shared';

/** A data do texto dos moldes (a última revisão de `clausulas.md` no Drive). */
export const DATA_DO_MOLDE = '2026-10-26';

const TEXTO_DE_IMPLANTACAO = `# CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE IMPLANTAÇÃO E ACOMPANHAMENTO

CONTRATADA: [[contratada_nome]], [[contratada_qualificacao]] (doravante “CONTRATADA” ou “Root”).

CONTRATANTE: [[contratante_nome]], [[contratante_qualificacao]] (doravante “CONTRATANTE”[[contratante_apelido|apelido]]).

As partes acima identificadas têm, entre si, justo e contratado o presente Contrato de Prestação de Serviços de Implantação e Acompanhamento (“Contrato”), que se regerá pelas cláusulas e condições seguintes.

### CLÁUSULA PRIMEIRA: DO OBJETO

1.1. Constitui objeto deste Contrato a prestação, pela CONTRATADA, de serviços de implantação de [[objeto_implantacao]], com as entregas descritas no item 1.2, seguida de acompanhamento pelo prazo previsto no item 1.5.

1.2. A implantação compreende as seguintes entregas:

- (a) [[lista:entregas]]

1.3. A implantação será executada em [[prazo_implantacao_dias|num]] dias, contados do início previsto no item 3.1, em [[numero_encontros|num]] encontros [[periodicidade_encontros]], com a seguinte pauta:

- (a) [[lista:pauta_encontros]]

1.4. Os encontros serão presenciais quando for preciso decidir com a CONTRATANTE ou ligar algum equipamento ou sistema em suas instalações, e online nos demais casos. Os encontros online serão gravados, e cada encontro terminará com o registro de quem participou, do que foi combinado e dos acessos solicitados e liberados.

1.5. Concluída a implantação, a CONTRATADA prestará acompanhamento por [[prazo_acompanhamento_dias|num]] dias, para ajustes, esclarecimento de dúvidas e conferência de números que não baterem, mediante solicitação da CONTRATANTE.

1.6. Os serviços serão conduzidos por profissionais indicados pela CONTRATADA, que atuam sob a responsabilidade desta e não mantêm vínculo de qualquer natureza com a CONTRATANTE.

### CLÁUSULA SEGUNDA: DO QUE NÃO ESTÁ COMPREENDIDO NO OBJETO

2.1. Não integram o objeto deste Contrato, salvo aditivo escrito com escopo e preço próprios:

- (a) [[lista:exclusoes]]
- (b) a configuração, a alteração ou a customização dos sistemas que a CONTRATANTE já utiliza, que caberão a quem presta esse serviço à CONTRATANTE;
- (c) as assinaturas, o servidor e o consumo de serviços de terceiros, na forma da Cláusula Quinta;
- (d) a licença de uso de sistema ou de programa de computador da CONTRATADA, ressalvado o direito de uso previsto no item 8.3; e
- (e) o acompanhamento após o término do prazo previsto no item 1.5.

### CLÁUSULA TERCEIRA: DA EXECUÇÃO

3.1. O primeiro encontro ocorrerá em [[data_primeiro_encontro]] ou, se este Contrato for assinado depois dessa data, em até 7 (sete) dias contados da assinatura. Os encontros seguintes ocorrerão com a periodicidade prevista no item 1.3, em dia e horário combinados entre as partes.

3.2. Qualquer das partes poderá remarcar um encontro mediante aviso com antecedência mínima de 24 (vinte e quatro) horas, e o encontro deverá ser reagendado preferencialmente para a mesma semana. A ausência da CONTRATANTE sem esse aviso será considerada encontro realizado.

3.3. O atraso na entrega de informação, acesso, autorização ou aprovação que dependa da CONTRATANTE prorroga o prazo do item 1.3 pelo mesmo período.

3.4. Os serviços não prestados durante a suspensão prevista no item 4.5 não serão repostos, e a suspensão não prorroga a vigência deste Contrato.

### CLÁUSULA QUARTA: DO PREÇO E DAS CONDIÇÕES DE PAGAMENTO

4.1. Pelos serviços, a CONTRATANTE pagará à CONTRATADA o valor total de [[valor_total|reais]], da seguinte forma:

- (a) entrada de [[valor_entrada|reais]], em até 48h (quarenta e oito horas) contadas da data da assinatura deste Contrato; e
- (b) saldo de [[valor_saldo|reais]], na entrega da implantação, em até 48h (quarenta e oito horas) contadas do último encontro previsto no item 1.3.

4.2. Se a entrega da implantação for adiada por fato atribuível à CONTRATANTE, na forma do item 3.3, o saldo previsto no item 4.1, alínea “b”, vencerá no [[prazo_implantacao_dias|ordinal]] dia contado do primeiro encontro.

4.3. Os pagamentos serão feitos por PIX, para a chave [[contratada_pix]], ou por boleto bancário, em favor da CONTRATADA, que emitirá a nota fiscal de serviço correspondente a cada pagamento.

4.4. O atraso no pagamento sujeitará a CONTRATANTE à multa de 10% (dez por cento) sobre o valor em aberto, juros de mora de 1% (um por cento) ao mês e correção monetária pelo IGP-M/FGV, calculados pro rata die.

4.5. O atraso superior a 10 (dez) dias faculta à CONTRATADA suspender os serviços até a regularização, mediante comunicação escrita à CONTRATANTE.

4.6. [[opcional:credito_continuidade]]Se as partes celebrarem contrato de continuidade dos serviços, o valor efetivamente pago por este Contrato será abatido do preço do novo contrato.

### CLÁUSULA QUINTA: DAS FERRAMENTAS E DOS CUSTOS DE TERCEIROS

5.1. O ambiente será montado em contas de titularidade da CONTRATANTE e não gera licença nem mensalidade em favor da CONTRATADA. A assinatura do Claude, o servidor e o consumo dos demais serviços utilizados serão contratados em nome da CONTRATANTE, que os pagará diretamente aos respectivos fornecedores, fora do preço deste Contrato.

5.2. Se a nuvem já contratada pela CONTRATANTE atender ao ambiente, ela será utilizada no lugar de um servidor novo.

5.3. O consumo de inteligência artificial fora da assinatura do Claude só ocorrerá quando uma rotina o exigir, e ficará limitado a um teto mensal definido pela CONTRATANTE.

5.4. Sempre que uma demanda exigir a contratação de novo serviço pago, a CONTRATADA informará previamente o custo estimado, e a contratação dependerá de aprovação expressa da CONTRATANTE.

5.5. A inteligência artificial será utilizada em plano comercial, no qual o conteúdo da CONTRATANTE não é usado para treinar modelos por padrão. Cabe à CONTRATANTE definir, nas contas de sua titularidade, as configurações de privacidade e de retenção de dados oferecidas pelos fornecedores, com a orientação da CONTRATADA.

### CLÁUSULA SEXTA: DAS OBRIGAÇÕES DA CONTRATADA

6.1. São obrigações da CONTRATADA:

- (a) conduzir os encontros e executar as entregas previstas na Cláusula Primeira;
- (b) registrar cada encontro na forma do item 1.4;
- (c) trabalhar com acesso somente de leitura aos sistemas, aos bancos de dados e às contas bancárias da CONTRATANTE, sem alterar dado ou configuração desses sistemas sem autorização escrita da CONTRATANTE;
- (d) montar o ambiente exclusivamente em contas de titularidade da CONTRATANTE;
- (e) utilizar os acessos recebidos exclusivamente para a execução deste Contrato; e
- (f) tratar os dados da CONTRATANTE com confidencialidade, na forma da Cláusula Oitava.

### CLÁUSULA SÉTIMA: DAS OBRIGAÇÕES DA CONTRATANTE

7.1. São obrigações da CONTRATANTE:

- (a) liberar os acessos [[acessos_contratante]], fornecendo as credenciais por meio seguro, sem compartilhá-las em texto aberto;
- (b) indicar a pessoa que cuidará do ambiente e reservar o tempo dela para o treinamento;
- (c) garantir a participação de [[participantes_encontros]] nos encontros;
- (d) contratar e manter ativos, em seu nome, as contas e os serviços previstos na Cláusula Quinta;
- (e) assegurar a base legal para o tratamento dos dados pessoais de empregados, clientes e demais titulares contidos nos sistemas ligados ao ambiente; e
- (f) efetuar os pagamentos nos prazos da Cláusula Quarta.

### CLÁUSULA OITAVA: DA PROPRIEDADE DO CONTEXTO E DOS MATERIAIS, DA PROTEÇÃO DE DADOS E DA CONFIDENCIALIDADE

8.1. As informações, os dados, as regras de negócio e os processos que a CONTRATANTE compartilhar com a CONTRATADA, antes ou durante este Contrato, formam o “Contexto da CONTRATANTE” e são de propriedade exclusiva desta. A CONTRATADA poderá usar o Contexto da CONTRATANTE apenas para executar este Contrato.

8.2. O ambiente, os painéis, as rotinas, o manual e os demais materiais construídos para a CONTRATANTE são de sua propriedade, e ela poderá usá-los e alterá-los livremente, inclusive após o término deste Contrato.

8.3. Permanecem de titularidade da CONTRATADA os seus métodos, modelos genéricos e ferramentas próprias preexistentes, desde que não contenham o Contexto da CONTRATANTE. Fica assegurado à CONTRATANTE o direito de uso, gratuito, não exclusivo e por prazo indeterminado, dos elementos preexistentes incorporados ao ambiente, na medida necessária para operá-lo e alterá-lo.

8.4. A CONTRATADA não poderá usar o Contexto da CONTRATANTE para atender a outros clientes, criar produtos nem treinar modelos de inteligência artificial.

8.5. As partes observarão a Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais). Quanto aos dados pessoais tratados, a CONTRATANTE figura como controladora e a CONTRATADA como operadora, que os tratará apenas para a execução deste Contrato e conforme as instruções da CONTRATANTE.

8.6. A CONTRATADA comunicará à CONTRATANTE, em até 48 (quarenta e oito) horas contadas da ciência, qualquer incidente de segurança que envolva o ambiente ou os dados da CONTRATANTE.

8.7. Cada parte manterá sigilo sobre as informações confidenciais da outra, inclusive sobre o Contexto da CONTRATANTE, por prazo indeterminado, mesmo após o término deste Contrato.

8.8. O uso do nome ou do caso da CONTRATANTE em material comercial da CONTRATADA depende de autorização prévia e escrita da CONTRATANTE.

8.9. Ao término deste Contrato, a CONTRATADA revogará os próprios acessos ao ambiente e aos sistemas da CONTRATANTE e devolverá ou eliminará todo o Contexto da CONTRATANTE que estiver em seu poder, ressalvada a guarda exigida por lei.

### CLÁUSULA NONA: DA VIGÊNCIA E DA RESCISÃO

9.1. Este Contrato vigorará da data de sua assinatura até o término do acompanhamento previsto no item 1.5, e não será renovado automaticamente.

9.2. O Contrato poderá ser rescindido:

- (a) por mútuo acordo;
- (b) por qualquer das partes, mediante aviso escrito com antecedência de 30 (trinta) dias; ou
- (c) pela parte inocente, em caso de inadimplemento contratual não sanado em 10 (dez) dias contados do recebimento da notificação.

9.3. A entrada prevista no item 4.1, alínea “a”, não é reembolsável.

9.4. Na rescisão pela CONTRATANTE na forma do item 9.2, alínea “b”, ou pela CONTRATADA por inadimplemento da CONTRATANTE, na forma da alínea “c”, serão devidos os valores proporcionais às entregas executadas até a data da rescisão, compensados os valores já pagos.

### CLÁUSULA DÉCIMA: DA LIMITAÇÃO DE RESPONSABILIDADE

10.1. Salvo em caso de dolo, a responsabilidade da CONTRATADA por perdas e danos comprovados limita-se ao valor efetivamente pago pela CONTRATANTE por este Contrato, e a CONTRATADA não responde por danos indiretos nem por lucros cessantes.

10.2. A CONTRATADA não responde por indisponibilidade ou falha dos sistemas da CONTRATANTE, das instituições financeiras, do servidor ou de outros serviços de terceiros, nem por erro contido nos dados de origem.

10.3. Os apontamentos e alertas gerados pelo ambiente servem de apoio à conferência da CONTRATANTE, a quem cabem as decisões tomadas a partir deles.

10.4. A limitação do item 10.1 não se aplica ao descumprimento do dever de confidencialidade previsto na Cláusula Oitava.

### CLÁUSULA DÉCIMA PRIMEIRA: DAS DISPOSIÇÕES GERAIS

11.1. As partes são independentes entre si, e este Contrato não cria vínculo societário, trabalhista ou de subordinação entre elas, nem entre uma parte e os prepostos da outra.

11.2. Qualquer alteração deste Contrato somente terá validade se formalizada por aditivo escrito, com escopo e preço definidos antes da execução.

11.3. A tolerância de qualquer das partes quanto ao descumprimento de obrigação da outra não constitui novação nem renúncia de direito.

11.4. É vedada a cessão deste Contrato, por qualquer das partes, sem a anuência prévia e escrita da outra.

11.5. A nulidade de qualquer cláusula não prejudica a validade das demais.

11.6. As comunicações entre as partes serão feitas por escrito, para os e-mails indicados na qualificação. Os avisos de remarcação de encontro e os pedidos de acompanhamento poderão ser feitos por aplicativo de mensagens; as notificações e o aviso de rescisão serão feitos exclusivamente por e-mail.

11.7. As partes reconhecem a validade da assinatura eletrônica deste Contrato, nos termos da lei, e o consideram celebrado em Juiz de Fora/MG, na data da última assinatura.

11.8. Este Contrato constitui título executivo extrajudicial, nos termos do art. 784, inciso III e § 4º, do Código de Processo Civil.

### CLÁUSULA DÉCIMA SEGUNDA: DO FORO

12.1. As partes buscarão resolver qualquer divergência decorrente deste Contrato por negociação direta ou por mediação, nos termos da Lei nº 13.140/2015, sem prejuízo das medidas judiciais urgentes.

12.2. Fica eleito o foro da Comarca de Juiz de Fora/MG para dirimir as questões oriundas deste Contrato, com renúncia a qualquer outro, por mais privilegiado que seja.

E, por estarem assim justas e contratadas, as partes assinam este Contrato eletronicamente, em via única.

Juiz de Fora/MG, na data da última assinatura eletrônica.
`;

const TEXTO_DE_CONTINUIDADE = `# CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE CONSULTORIA E ACOMPANHAMENTO

CONTRATADA: [[contratada_nome]], [[contratada_qualificacao]] (doravante “CONTRATADA” ou “Root”).

CONTRATANTE: [[contratante_nome]], [[contratante_qualificacao]] (doravante “CONTRATANTE”[[contratante_apelido|apelido]]).

As partes acima identificadas têm, entre si, justo e contratado o presente Contrato de Prestação de Serviços de Consultoria e Acompanhamento (“Contrato”), que se regerá pelas cláusulas e condições seguintes.

### CLÁUSULA PRIMEIRA: DO OBJETO

1.1. Constitui objeto deste Contrato a prestação, pela CONTRATADA, de serviços de consultoria e acompanhamento individual para a construção, a revisão e a validação de relatórios, consultas, agentes de inteligência artificial e rotinas aplicados às entregas da CONTRATANTE, notadamente [[foco_consultoria]].

1.2. Os serviços serão prestados em [[frequencia_encontros]], com duração de [[duracao_encontro_horas|num_f]] horas, pelo prazo de [[prazo_meses|num]] meses.

1.3. Os encontros serão conduzidos por [[condutor]], profissional indicado pela CONTRATADA, que atua sob a responsabilidade desta e não mantém vínculo de qualquer natureza com a CONTRATANTE. Na impossibilidade de condução pelo profissional indicado, a CONTRATADA indicará substituto com qualificação equivalente, mediante comunicação prévia à CONTRATANTE.

1.4. Cada encontro observará o seguinte método:

- (a) escolher: a CONTRATANTE apresenta a demanda, e as partes definem o que cabe no encontro e como o resultado será conferido;
- (b) desenvolver: construção conjunta, com base nas regras de negócio da CONTRATANTE;
- (c) validar: comparação do resultado com a fonte, de modo que cada número possa ser conferido no sistema de origem, inclusive quando houver divergência; e
- (d) registrar: documentação do que foi feito, do que ficou pendente e do próximo passo.

### CLÁUSULA SEGUNDA: DO QUE NÃO ESTÁ COMPREENDIDO NO OBJETO

2.1. Não integram o objeto deste Contrato, salvo aditivo escrito com escopo e preço próprios:

- (a) a execução de trabalho pela CONTRATADA fora dos encontros, ressalvado o registro previsto no item 6.1, alínea “b”;
- (b) a prestação de serviços diretamente aos clientes da CONTRATANTE, bem como qualquer responsabilidade técnica perante eles;
- (c) a escrita, a alteração ou a customização de dados, parâmetros ou programas em ERP ou em qualquer sistema de produção da CONTRATANTE ou de seus clientes;
- (d) as licenças, as assinaturas de ferramentas de inteligência artificial, a hospedagem, a infraestrutura e o consumo de serviços de terceiros, na forma da Cláusula Quinta; e
- (e) a licença de uso de sistema ou de programa de computador da CONTRATADA.

### CLÁUSULA TERCEIRA: DA AGENDA DOS ENCONTROS

3.1. O primeiro encontro ocorrerá em até 7 (sete) dias contados da assinatura deste Contrato, e os seguintes, em dia e horário fixos combinados entre as partes.

3.2. Qualquer das partes poderá remarcar um encontro mediante aviso com antecedência mínima de 24 (vinte e quatro) horas, e o encontro deverá ser reagendado preferencialmente para a mesma semana. A ausência da CONTRATANTE sem esse aviso será considerada encontro realizado.

3.3. Os encontros cancelados ou remarcados pela CONTRATADA serão repostos. Os encontros remarcados pela CONTRATANTE com o aviso do item 3.2 poderão ser repostos até 30 (trinta) dias após o término do prazo previsto no item 1.2, sem alteração do preço.

3.4. Os encontros não realizados durante a suspensão prevista no item 4.4 não serão repostos, e a suspensão não prorroga a vigência deste Contrato.

### CLÁUSULA QUARTA: DO PREÇO E DAS CONDIÇÕES DE PAGAMENTO

4.1. Pelos serviços, a CONTRATANTE pagará à CONTRATADA o valor total de [[valor_total|reais]], da seguinte forma:

- (a) entrada de [[valor_entrada|reais]], à vista, em até 48h (quarenta e oito horas) contadas da data da assinatura deste Contrato; e
- (b) saldo de [[valor_saldo|reais]], em [[numero_parcelas|num_f]] parcelas mensais e sucessivas de [[valor_parcela|reais]] cada, a primeira com vencimento em 30 (trinta) dias contados da assinatura e as demais no mesmo dia dos meses subsequentes.

4.2. Os pagamentos serão feitos por PIX, para a chave [[contratada_pix]], ou por boleto bancário, em favor da CONTRATADA, que emitirá a nota fiscal de serviço correspondente a cada pagamento.

4.3. O atraso no pagamento sujeitará a CONTRATANTE à multa de 10% (dez por cento) sobre o valor em aberto, juros de mora de 1% (um por cento) ao mês e correção monetária pelo IGP-M/FGV, calculados pro rata die.

4.4. O atraso superior a 10 (dez) dias faculta à CONTRATADA suspender os encontros até a regularização, mediante comunicação escrita à CONTRATANTE.

### CLÁUSULA QUINTA: DAS FERRAMENTAS E DOS CUSTOS DE TERCEIROS

5.1. As assinaturas de ferramentas de inteligência artificial, a infraestrutura, a hospedagem e o consumo dos serviços utilizados serão contratados em nome e nas contas da CONTRATANTE, que os pagará diretamente aos respectivos fornecedores, fora do preço deste Contrato.

5.2. Sempre que uma demanda exigir a contratação de novo serviço pago, a CONTRATADA informará previamente o custo estimado, e a contratação dependerá de aprovação expressa da CONTRATANTE.

5.3. Cabe à CONTRATANTE definir, nas contas de sua titularidade, as configurações de privacidade e de retenção de dados oferecidas pelos fornecedores, inclusive a opção de não uso dos dados para treinamento de modelos, com a orientação da CONTRATADA.

### CLÁUSULA SEXTA: DAS OBRIGAÇÕES DA CONTRATADA

6.1. São obrigações da CONTRATADA:

- (a) conduzir os encontros na forma da Cláusula Primeira;
- (b) registrar, ao fim de cada encontro, o que foi feito, o que ficou pendente e o próximo passo;
- (c) trabalhar exclusivamente com acesso de leitura às bases de dados e aos sistemas de gestão; e
- (d) tratar os dados da CONTRATANTE e de seus clientes com confidencialidade, na forma da Cláusula Oitava.

### CLÁUSULA SÉTIMA: DAS OBRIGAÇÕES DA CONTRATANTE

7.1. São obrigações da CONTRATANTE:

- (a) comparecer aos encontros e apresentar a demanda de cada semana;
- (b) obter de seus clientes a autorização necessária para o uso dos respectivos dados nos encontros;
- (c) executar pessoalmente os acessos que dependam de credencial, senha, conexão remota ou ambiente de cliente, compartilhando apenas o resultado necessário ao trabalho;
- (d) manter sob sua guarda as credenciais de seus clientes, sem repassá-las à CONTRATADA em texto aberto; e
- (e) efetuar os pagamentos nos prazos da Cláusula Quarta.

### CLÁUSULA OITAVA: DA PROPRIEDADE DO CONTEXTO E DOS MATERIAIS, DA PROTEÇÃO DE DADOS E DA CONFIDENCIALIDADE

8.1. As informações, os dados, as regras de negócio e os processos que a CONTRATANTE compartilhar com a CONTRATADA, antes ou durante este Contrato, formam o “Contexto da CONTRATANTE” e são de propriedade exclusiva desta. A CONTRATADA poderá usar o Contexto da CONTRATANTE apenas para executar este Contrato.

8.2. Os materiais, as consultas, os agentes e as rotinas construídos para a CONTRATANTE são de sua propriedade, e ela poderá usá-los livremente, inclusive após o término deste Contrato.

8.3. A CONTRATADA não poderá usar o Contexto da CONTRATANTE para atender a outros clientes, criar produtos nem treinar modelos de inteligência artificial. Permanecem de titularidade da CONTRATADA apenas os seus métodos e ferramentas próprios que não contenham o Contexto da CONTRATANTE.

8.4. As partes observarão a Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais). Quanto aos dados pessoais tratados, a CONTRATANTE figura como controladora e a CONTRATADA como operadora, que os tratará apenas para a execução deste Contrato e conforme as instruções da CONTRATANTE.

8.5. A CONTRATADA comunicará à CONTRATANTE, em até 48 (quarenta e oito) horas contadas da ciência, qualquer incidente de segurança que envolva dados da CONTRATANTE ou de seus clientes.

8.6. Cada parte manterá sigilo sobre as informações confidenciais da outra, inclusive sobre o Contexto da CONTRATANTE e os dados de seus clientes, por prazo indeterminado, mesmo após o término deste Contrato.

8.7. O uso do nome ou do caso da CONTRATANTE em material comercial da CONTRATADA depende de autorização prévia e escrita da CONTRATANTE.

8.8. Ao término deste Contrato, a CONTRATADA devolverá ou eliminará todo o Contexto da CONTRATANTE e os dados de seus clientes que estiverem em seu poder, ressalvada a guarda exigida por lei.

### CLÁUSULA NONA: DA VIGÊNCIA E DA RESCISÃO

9.1. Este Contrato vigorará por [[prazo_meses|num]] meses, contados da data de sua assinatura, acrescidos do prazo de reposição previsto no item 3.3, e não será renovado automaticamente.

9.2. O Contrato poderá ser rescindido:

- (a) por mútuo acordo;
- (b) por qualquer das partes, mediante aviso escrito com antecedência de 30 (trinta) dias; ou
- (c) pela parte inocente, em caso de inadimplemento contratual não sanado em 10 (dez) dias contados do recebimento da notificação.

9.3. A entrada prevista no item 4.1, alínea “a”, não é reembolsável.

9.4. Na rescisão pela CONTRATANTE na forma do item 9.2, alínea “b”, ou pela CONTRATADA por inadimplemento da CONTRATANTE, na forma da alínea “c”, serão devidos os meses de serviço transcorridos até o fim do aviso prévio ou até a data da rescisão.

### CLÁUSULA DÉCIMA: DA LIMITAÇÃO DE RESPONSABILIDADE

10.1. Salvo em caso de dolo, a responsabilidade da CONTRATADA por perdas e danos comprovados limita-se ao valor efetivamente pago pela CONTRATANTE por este Contrato, e a CONTRATADA não responde por danos indiretos, lucros cessantes ou indisponibilidade de serviços de terceiros.

10.2. A limitação do item 10.1 não se aplica ao descumprimento do dever de confidencialidade previsto na Cláusula Oitava.

### CLÁUSULA DÉCIMA PRIMEIRA: DAS DISPOSIÇÕES GERAIS

11.1. As partes são independentes entre si, e este Contrato não cria vínculo societário, trabalhista ou de subordinação entre elas, nem entre uma parte e os prepostos da outra.

11.2. Qualquer alteração deste Contrato somente terá validade se formalizada por aditivo escrito, com escopo e preço definidos antes da execução.

11.3. A tolerância de qualquer das partes quanto ao descumprimento de obrigação da outra não constitui novação nem renúncia de direito.

11.4. É vedada a cessão deste Contrato, por qualquer das partes, sem a anuência prévia e escrita da outra.

11.5. A nulidade de qualquer cláusula não prejudica a validade das demais.

11.6. As comunicações entre as partes serão feitas por escrito, para os e-mails indicados na qualificação. Os avisos de remarcação de encontro poderão ser feitos por aplicativo de mensagens; as notificações e o aviso de rescisão serão feitos exclusivamente por e-mail.

11.7. As partes reconhecem a validade da assinatura eletrônica deste Contrato, nos termos da lei, e o consideram celebrado em Juiz de Fora/MG, na data da última assinatura.

11.8. Este Contrato constitui título executivo extrajudicial, nos termos do art. 784, inciso III e § 4º, do Código de Processo Civil.

### CLÁUSULA DÉCIMA SEGUNDA: DO FORO

12.1. As partes buscarão resolver qualquer divergência decorrente deste Contrato por negociação direta ou por mediação, nos termos da Lei nº 13.140/2015, sem prejuízo das medidas judiciais urgentes.

12.2. Fica eleito o foro da Comarca de Juiz de Fora/MG para dirimir as questões oriundas deste Contrato, com renúncia a qualquer outro, por mais privilegiado que seja.

E, por estarem assim justas e contratadas, as partes assinam este Contrato eletronicamente, em via única.

Juiz de Fora/MG, na data da última assinatura eletrônica.
`;

export interface CampoDoMolde {
  nome: string;
  tipo: 'texto' | 'lista' | 'opcional';
  /** O formato depois da barra: reais, num, num_f, ordinal, apelido. */
  formato: string | null;
}

export interface MoldeDoContrato {
  modalidade: ModalidadeDeContrato;
  titulo: string;
  /** A segunda linha da faixa do timbre (identidade visual, seção 7). */
  tipoDoServico: string;
  data: string;
  texto: string;
  campos: CampoDoMolde[];
}

/** Os `[[campos]]` de um texto de molde, sem repetir, na ordem em que aparecem. */
export function camposDoTexto(texto: string): CampoDoMolde[] {
  const vistos = new Map<string, CampoDoMolde>();
  for (const m of texto.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const bruto = m[1].trim();
    const tipo = bruto.startsWith('lista:') ? 'lista' : bruto.startsWith('opcional:') ? 'opcional' : 'texto';
    const [nome, formato] = bruto.replace(/^(?:lista|opcional):/, '').split('|');
    const chave = `${nome}|${formato ?? ''}`;
    if (!vistos.has(chave)) vistos.set(chave, { nome, tipo, formato: formato ?? null });
  }
  return [...vistos.values()];
}

const MOLDES: Record<ModalidadeDeContrato, Omit<MoldeDoContrato, 'campos' | 'data' | 'modalidade'>> = {
  implantacao: {
    titulo: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE IMPLANTAÇÃO E ACOMPANHAMENTO',
    tipoDoServico: 'PRESTAÇÃO DE SERVIÇOS · IMPLANTAÇÃO E ACOMPANHAMENTO',
    texto: TEXTO_DE_IMPLANTACAO,
  },
  continuidade: {
    titulo: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE CONSULTORIA E ACOMPANHAMENTO',
    tipoDoServico: 'PRESTAÇÃO DE SERVIÇOS · CONSULTORIA E ACOMPANHAMENTO',
    texto: TEXTO_DE_CONTINUIDADE,
  },
};

export function moldeDoContrato(modalidade: ModalidadeDeContrato): MoldeDoContrato {
  const molde = MOLDES[modalidade];
  if (!molde) throw new Error(`modalidade de contrato desconhecida: ${String(modalidade)}`);
  return { modalidade, data: DATA_DO_MOLDE, campos: camposDoTexto(molde.texto), ...molde };
}

/**
 * Os campos soltos que `preencher-molde.ts` usa para montar a qualificação do CONTRATANTE e
 * os blocos de assinatura. Não aparecem no texto, mas vêm na mesma entrada.
 */
export const CAMPOS_DA_QUALIFICACAO = [
  'contratada_documento',
  'contratante_tipo',
  'contratante_genero',
  'contratante_documento',
  'contratante_endereco',
  'contratante_email',
  'contratante_representante',
  'contratante_representante_cpf',
  'contratante_representante_genero',
  'contratante_representacao',
  'contratante_nacionalidade',
  'contratante_estado_civil',
  'contratante_profissao',
  'contratante_assinante',
  'contratante_documento_assinatura',
] as const;
