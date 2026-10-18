-- Custo fixo × variável: a conta do plano diz se o gasto dela vem todo mês,
-- venda ou não venda. A Análise do financeiro usa isso para separar o que saiu
-- em impostos, custo fixo, custo variável, investimento e retirada dos sócios.
-- Só acrescenta coluna: a imagem anterior não a lê e continua funcionando.
ALTER TABLE "ChartAccount" ADD COLUMN "custoFixo" BOOLEAN NOT NULL DEFAULT false;

-- Ponto de partida no plano padrão (o mesmo em toda empresa): as contas que
-- costumam ser fixas. Cada empresa ajusta na tela da Análise.
UPDATE "ChartAccount" SET "custoFixo" = true
WHERE "codigo" IN (
  '3.1.03',                                                    -- Software
  '3.2.01', '3.2.06', '3.2.07', '3.2.10', '3.2.11', '3.2.12', '3.2.16', -- folha e benefícios
  '4.1.01', '4.1.02', '4.1.03', '4.1.04', '4.1.05',            -- aluguel, condomínio, água, energia, telefonia
  '4.1.08', '4.1.09', '4.1.10', '4.1.12', '4.1.13',            -- seguros, IPTU, contabilidade, segurança, limpeza
  '4.2.01'                                                     -- pessoal ADM
);
