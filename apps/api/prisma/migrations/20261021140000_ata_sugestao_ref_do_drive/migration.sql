-- Produção 21 (P7, 21/10/2026): a sugestão de tarefa pode vir de uma ata da
-- pasta do Google Drive. A referência da ata ganha a forma `drive:<id do
-- arquivo>` (o id do Drive tem até 120 caracteres do mesmo alfabeto). Nenhuma
-- tabela nova, nenhuma coluna nova: só o CHECK passa a aceitar a terceira forma.
-- A transcrição do Granola (`granola:<id>`) NÃO entra aqui de propósito: ela
-- nunca rende sugestão direta, só a ata escrita a partir dela (`memoria:`).
ALTER TABLE "AtaSugestao" DROP CONSTRAINT IF EXISTS "AtaSugestao_ataRef_check";
ALTER TABLE "AtaSugestao" ADD CONSTRAINT "AtaSugestao_ataRef_check"
  CHECK ("ataRef" ~ '^(vault|memoria|drive):[A-Za-z0-9_-]{1,120}$');
