-- Etapa 8 (#6, 04/11/2026): o horário de postar, além do dia. Aditiva; vazio = sem horário.
ALTER TABLE "MarketingPost" ADD COLUMN "hora" TEXT NOT NULL DEFAULT '';
