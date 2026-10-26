-- Layout 26/10/2026: Comunidade, o quarto tipo de conversa do WhatsApp (ao lado de lead, cliente e equipe).
-- Coluna nova com padrão falso: nenhuma conversa muda de lugar sozinha, e o código antigo a ignora.
ALTER TABLE "WhatsAppConversa" ADD COLUMN "comunidade" BOOLEAN NOT NULL DEFAULT false;
