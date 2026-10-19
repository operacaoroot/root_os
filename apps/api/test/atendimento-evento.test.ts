import { describe, expect, it } from 'vitest';
import {
  envioComProblema,
  falhasRecentes,
  lerEventoDaEvolution,
  statusDoAviso,
  statusSobe,
  telefoneDoJid,
  tipoDeAnexoAceito,
} from '@mktos/shared';

/*
 * Caixa de atendimento (Dia a dia › Conversas) — a parte pura: o que se lê do
 * corpo do webhook da Evolution, a ordem dos estados de envio e o aviso de
 * falha. Tudo com corpos SINTÉTICOS no formato da Evolution v2; nenhum número
 * ou mensagem real.
 */

const CLIENTE = '5511900000001@s.whatsapp.net';
const GRUPO = '120363000000000001@g.us';

const upsert = (data: Record<string, unknown>) => ({ event: 'messages.upsert', instance: 'teste', data });

describe('atendimento — leitura do messages.upsert', () => {
  it('texto de conversa direta: conversa, telefone, nome e hora', () => {
    const [m] = lerEventoDaEvolution(upsert({
      key: { id: 'MSG1', remoteJid: CLIENTE, fromMe: false },
      pushName: 'Cliente Sintético',
      message: { conversation: 'Bom dia, preciso da segunda via' },
      messageTimestamp: 1_760_000_000,
    }));
    expect(m).toMatchObject({
      tipo: 'mensagem', jidConversa: CLIENTE, grupo: false, telefone: '5511900000001', fromMe: false,
      evolutionId: 'MSG1', remetenteNome: 'Cliente Sintético', tipoMensagem: 'texto', texto: 'Bom dia, preciso da segunda via',
    });
    expect(m.tipo === 'mensagem' && m.momento.toISOString()).toBe(new Date(1_760_000_000_000).toISOString());
  });

  it('grupo: a conversa é o grupo e quem escreveu é o participante (sem o sufixo de aparelho)', () => {
    const [m] = lerEventoDaEvolution(upsert({
      key: { id: 'MSG2', remoteJid: GRUPO, fromMe: false, participant: '5511900000002:7@s.whatsapp.net' },
      pushName: 'Participante',
      message: { extendedTextMessage: { text: 'segue o comprovante' } },
    }));
    expect(m).toMatchObject({ jidConversa: GRUPO, grupo: true, telefone: null, remetenteJid: '5511900000002@s.whatsapp.net' });
  });

  it('conversa por @lid usa o número alternativo quando a Evolution manda', () => {
    const [m] = lerEventoDaEvolution(upsert({
      key: { id: 'MSG3', remoteJid: '123456789012345@lid', remoteJidAlt: CLIENTE, fromMe: false },
      message: { conversation: 'oi' },
    }));
    expect(m).toMatchObject({ jidConversa: '123456789012345@lid', telefone: '5511900000001' });
  });

  it('imagem e documento viram anexo com tipo, nome, tamanho e base64 quando vem junto', () => {
    const [img] = lerEventoDaEvolution(upsert({
      key: { id: 'MSG4', remoteJid: CLIENTE, fromMe: false },
      message: { imageMessage: { caption: 'nota', mimetype: 'image/jpeg', fileLength: { low: 2048, high: 0 } }, base64: 'AAAA' },
    }));
    expect(img).toMatchObject({ tipoMensagem: 'imagem', texto: 'nota', midia: { mimetype: 'image/jpeg', tamanho: 2048, base64: 'AAAA' } });
    const [doc] = lerEventoDaEvolution(upsert({
      key: { id: 'MSG5', remoteJid: CLIENTE, fromMe: false },
      message: { documentWithCaptionMessage: { message: { documentMessage: { fileName: 'boleto.pdf', mimetype: 'application/pdf', fileLength: '9000' } } } },
    }));
    expect(doc).toMatchObject({ tipoMensagem: 'documento', midia: { nome: 'boleto.pdf', tamanho: 9000, base64: null } });
  });

  it('status, transmissão, reação e protocolo não entram na caixa', () => {
    expect(lerEventoDaEvolution(upsert({ key: { id: 'S', remoteJid: 'status@broadcast' }, message: { conversation: 'x' } }))).toEqual([]);
    expect(lerEventoDaEvolution(upsert({ key: { id: 'R', remoteJid: CLIENTE }, message: { reactionMessage: { text: '👍' } } }))).toEqual([]);
    expect(lerEventoDaEvolution(upsert({ key: { id: 'P', remoteJid: CLIENTE }, message: { protocolMessage: { type: 0 } } }))).toEqual([]);
  });

  it('corpo torto não lança: devolve nada', () => {
    for (const corpo of [null, 'texto', 42, {}, { event: 'messages.upsert' }, { event: 'messages.upsert', data: { key: {} } }]) {
      expect(lerEventoDaEvolution(corpo)).toEqual([]);
    }
  });

  it('aceita data em lista e o nome do evento com sublinhado', () => {
    const r = lerEventoDaEvolution({
      event: 'MESSAGES_UPSERT',
      data: [
        { key: { id: 'A', remoteJid: CLIENTE }, message: { conversation: '1' } },
        { key: { id: 'B', remoteJid: CLIENTE }, message: { conversation: '2' } },
      ],
    });
    expect(r.map((e) => e.tipo === 'mensagem' && e.evolutionId)).toEqual(['A', 'B']);
  });
});

describe('atendimento — avisos de envio (messages.update) e apagadas', () => {
  it('aceita, entregue e lida são três coisas diferentes', () => {
    expect(statusDoAviso('SERVER_ACK')).toBe('aceita');
    expect(statusDoAviso('DELIVERY_ACK')).toBe('entregue');
    expect(statusDoAviso('READ')).toBe('lida');
    expect(statusDoAviso('PLAYED')).toBe('lida');
    expect(statusDoAviso(3)).toBe('entregue');
    expect(statusDoAviso('PENDING')).toBeNull();
  });

  it('lê o id em keyId, messageId ou key.id', () => {
    const r = lerEventoDaEvolution({
      event: 'messages.update',
      data: [
        { keyId: 'K1', status: 'DELIVERY_ACK' },
        { messageId: 'K2', status: 'READ' },
        { key: { id: 'K3' }, update: { status: 'SERVER_ACK' } },
      ],
    });
    expect(r).toEqual([
      { tipo: 'aviso', evolutionId: 'K1', status: 'entregue' },
      { tipo: 'aviso', evolutionId: 'K2', status: 'lida' },
      { tipo: 'aviso', evolutionId: 'K3', status: 'aceita' },
    ]);
  });

  it('messages.delete vira apagada', () => {
    expect(lerEventoDaEvolution({ event: 'messages.delete', data: { key: { id: 'D1' } } })).toEqual([{ tipo: 'apagada', evolutionId: 'D1' }]);
  });

  it('o estado só sobe: aviso atrasado não rebaixa', () => {
    expect(statusSobe('lida', 'entregue')).toBe(false);
    expect(statusSobe('entregue', 'aceita')).toBe(false);
    expect(statusSobe('aceita', 'entregue')).toBe(true);
    expect(statusSobe('erro', 'entregue')).toBe(true);
    expect(statusSobe('aguardando_assinatura', 'aceita')).toBe(true);
    expect(statusSobe(null, 'aceita')).toBe(true);
  });
});

describe('atendimento — aviso de envio com problema (statusEnvioChat do FinOps)', () => {
  const agora = Date.parse('2026-10-19T15:00:00Z');
  const em = (min: number) => new Date(agora - min * 60_000).toISOString();
  it('duas falhas nos últimos 15 minutos avisam; uma não', () => {
    expect(envioComProblema([{ statusEnvio: 'erro', momento: em(1) }], agora)).toBe(false);
    expect(envioComProblema([{ statusEnvio: 'erro', momento: em(1) }, { statusEnvio: 'erro', momento: em(14) }], agora)).toBe(true);
  });
  it('falha antiga não conta; data ruim conta', () => {
    expect(falhasRecentes([{ statusEnvio: 'erro', momento: em(16) }, { statusEnvio: 'aceita', momento: em(1) }], agora)).toBe(0);
    expect(falhasRecentes([{ statusEnvio: 'erro', momento: 'lixo' }, { statusEnvio: 'erro', momento: null }], agora)).toBe(2);
  });
});

describe('atendimento — anexos e telefone', () => {
  it('aceita os tipos do atendimento e limpa o codecs', () => {
    expect(tipoDeAnexoAceito('audio/ogg; codecs=opus')).toBe('audio/ogg');
    expect(tipoDeAnexoAceito('application/pdf')).toBe('application/pdf');
    expect(tipoDeAnexoAceito('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).not.toBeNull();
  });
  it('recusa executável, html e svg', () => {
    for (const t of ['application/x-msdownload', 'text/html', 'image/svg+xml', 'application/javascript', null]) {
      expect(tipoDeAnexoAceito(t)).toBeNull();
    }
  });
  it('telefone só de JID de pessoa', () => {
    expect(telefoneDoJid(CLIENTE)).toBe('5511900000001');
    expect(telefoneDoJid(GRUPO)).toBeNull();
    expect(telefoneDoJid('123@lid')).toBeNull();
  });
});
