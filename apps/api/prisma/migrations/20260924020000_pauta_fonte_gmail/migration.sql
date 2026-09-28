-- MC2 — Gmail como fonte da pauta. A etiqueta mora em `PautaFonte.handle`;
-- nenhuma coluna nem tabela nova, então nada muda no isolamento por linha.
-- Nome depois de `20260924010000_onboarding_do_cliente` para a ordem do
-- deploy seguir a de criação.
ALTER TYPE "PautaFonteTipo" ADD VALUE 'gmail';
