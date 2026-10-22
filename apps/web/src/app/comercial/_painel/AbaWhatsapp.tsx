'use client';

/*
 * A ABA "WHATSAPP" DO PAINEL DO LEAD (produção 22C, W3): as conversas do número
 * da empresa ligadas a este lead (1:1 pelo telefone ou grupo pelo clique), com
 * a prévia e o link para a caixa, as últimas mensagens da mais recente e o
 * telefone do lead, editável (é o número que faz a conversa 1:1 ligar sozinha).
 * As mensagens de gente também entram no Fio, sem repetir as do comercial.
 */
import type { FichaDoLead, WhatsappDaFicha } from '@mktos/shared';

import { ConversasLigadas, TelefoneEditavel } from '@/components/whatsapp/ConversasLigadas';

import { CARTAO, Carregando, Erro, Rotulo, useCarregar } from '../_ui';

export function AbaWhatsapp({ leadId, aoMudar }: { leadId: string; ficha?: FichaDoLead | null; aoMudar: () => void | Promise<void> }) {
  const caminho = `/whatsapp/vinculos/lead/${encodeURIComponent(leadId)}`;
  const { dados, erro, carregando, recarregar } = useCarregar<WhatsappDaFicha>(caminho, 60_000);
  return (
    <div className="space-y-4" data-testid="painel-whatsapp">
      <section className={CARTAO} aria-label="telefone do lead">
        <Rotulo>telefone do lead</Rotulo>
        <div className="mt-2">
          {dados ? (
            <TelefoneEditavel
              caminho={`${caminho}/telefone`}
              telefone={dados.telefone}
              podeEditar={dados.podeEditar}
              testId="painel-whatsapp-telefone"
              convite="Este lead não tem telefone. Com o número preenchido, a conversa 1:1 do WhatsApp com ele liga sozinha."
              aoSalvar={async () => {
                await recarregar();
                await aoMudar();
              }}
            />
          ) : carregando ? (
            <Carregando linhas={1} altura="h-6" />
          ) : null}
        </div>
      </section>
      <section className={CARTAO} aria-label="conversas de WhatsApp">
        <Rotulo>conversas de WhatsApp</Rotulo>
        <div className="mt-2">
          <Erro erro={erro} aoTentar={() => void recarregar()} />
          {dados ? (
            <ConversasLigadas
              conversas={dados.conversas}
              ultimas={dados.ultimas}
              vazio={
                <span data-testid="painel-whatsapp-vazio">
                  Nenhuma conversa de WhatsApp ligada a este lead.
                  {!dados.telefone && ' Preencha o telefone acima, ou ligue a conversa pela caixa de WhatsApp.'}
                </span>
              }
            />
          ) : carregando ? (
            <Carregando linhas={2} />
          ) : null}
        </div>
      </section>
    </div>
  );
}
