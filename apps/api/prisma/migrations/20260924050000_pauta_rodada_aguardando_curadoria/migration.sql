-- MC6 — curadoria humana antes do roteiro. A rodada gerada "para curadoria"
-- nasce com todos os candidatos da janela e espera o operador marcar o que
-- segue; os candidatos moram no `itens` que já existe, então nenhuma coluna nem
-- tabela nova e nada muda no isolamento por linha. Nome depois de
-- `20260924020000_pauta_fonte_gmail` para a ordem do deploy seguir a de criação.
ALTER TYPE "PautaRodadaStatus" ADD VALUE 'aguardando_curadoria';
