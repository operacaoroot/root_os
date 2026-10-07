-- ROOT-06a — tipo `moeda` no campo personalizado do Trabalho. O valor mora em
-- `WorkFieldValue.value`, que já existe, como texto canônico "BRL 1500.00";
-- nenhuma coluna nem tabela nova, então nada muda no isolamento por linha nem
-- no fingerprint dos lotes importados do ClickUp. `IF NOT EXISTS` deixa
-- reaplicar depois de um `prisma migrate resolve --rolled-back`, quando o valor
-- já entrou no tipo. Nome depois de `20260930160000_editorial_versions` (PR35)
-- para a ordem do deploy seguir a de criação.
ALTER TYPE "WorkFieldType" ADD VALUE IF NOT EXISTS 'moeda';
