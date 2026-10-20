-- Rodada da interface (20/10/2026, U2): a Implantação e o Funil vivo ganham vistas
-- salvas próprias. Aditiva: a verificação passa a aceitar mais duas telas; as vistas
-- que já existem continuam valendo como estão.
ALTER TABLE "VistaSalva" DROP CONSTRAINT "VistaSalva_tela_check";
ALTER TABLE "VistaSalva" ADD CONSTRAINT "VistaSalva_tela_check" CHECK ("tela" IN ('minhas-tarefas', 'quadro', 'implantacao', 'funil'));
