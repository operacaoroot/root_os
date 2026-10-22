import { describe, expect, it } from 'vitest';

import {
  TETO_DO_TEXTO,
  conversaDaKey,
  instanteDaEvolution,
  lerChatDaEvolution,
  lerCorpoDoWebhook,
  lerGrupoDaEvolution,
  lerRegistroDaEvolution,
  type MensagemLida,
} from '../src/whatsapp/leitura-da-evolution';

/*
 * A LEITURA DO QUE A EVOLUTION ENTREGA (produção 22C, W1) — parte pura.
 *
 * Números, nomes e textos daqui são FICTÍCIOS (55329000000xx, "Café Serra
 * (exemplo)"). A forma é a da Evolution v2 (`messages.upsert` e
 * `chat/findMessages` têm o mesmo item).
 */

const AGORA = new Date('2026-10-22T15:00:00.000Z');
const NUM = '5532900000001';
const NUM2 = '5532900000002';
const GRUPO = '120363000000000001@g.us';
const LID = '271828182845904@lid';

const item = (key: Record<string, unknown>, message: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  key: { id: 'MSG1', fromMe: false, remoteJid: `${NUM}@s.whatsapp.net`, ...key },
  pushName: 'Café Serra (exemplo)',
  messageType: 'conversation',
  message,
  messageTimestamp: 1792681200,
  ...extra,
});

const ler = (i: unknown): MensagemLida => {
  const r = lerRegistroDaEvolution(i, AGORA);
  if (!('mensagem' in r)) throw new Error(`ignorada: ${r.ignorado}`);
  return r.mensagem;
};

describe('whatsapp: a leitura de uma mensagem da Evolution', () => {
  it('1:1 de entrada: conversa canônica, remetente com número e nome, texto', () => {
    const m = ler(item({}, { conversation: '  Oi, tudo bem?  ' }));
    expect(m).toEqual({
      chatJid: `${NUM}@s.whatsapp.net`,
      lidJid: null,
      grupo: false,
      remetenteJid: `${NUM}@s.whatsapp.net`,
      remetenteNumero: NUM,
      remetenteNome: 'Café Serra (exemplo)',
      deMim: false,
      direcao: 'entrada',
      tipo: 'conversation',
      texto: 'Oi, tudo bem?',
      midia: null,
      mensagemExternaId: 'MSG1',
      citaMensagemExternaId: null,
      timestamp: new Date(1792681200 * 1000),
    });
  });

  it('1:1 com @c.us e sufixo de aparelho vira a forma canônica', () => {
    expect(ler(item({ remoteJid: `${NUM}:12@c.us` }, { conversation: 'x' })).chatJid).toBe(`${NUM}@s.whatsapp.net`);
  });

  it('fromMe no 1:1: saída, sem remetente (é a casa), a conversa é a do outro lado', () => {
    const m = ler(item({ fromMe: true }, { conversation: 'Bom dia' }));
    expect(m).toMatchObject({ chatJid: `${NUM}@s.whatsapp.net`, deMim: true, direcao: 'saida', remetenteJid: null, remetenteNumero: null, texto: 'Bom dia' });
  });

  it('grupo: a conversa é o @g.us e o remetente é o participante (número real no modo @lid)', () => {
    const m = ler(item({ remoteJid: GRUPO, participant: `${NUM2}@s.whatsapp.net` }, { conversation: 'Olá grupo' }));
    expect(m).toMatchObject({ chatJid: GRUPO, grupo: true, remetenteJid: `${NUM2}@s.whatsapp.net`, remetenteNumero: NUM2, lidJid: null });
    const lid = ler(item({ remoteJid: GRUPO, participant: '99887766554433@lid', participantAlt: `${NUM2}@s.whatsapp.net` }, { conversation: 'x' }));
    expect(lid).toMatchObject({ remetenteNumero: NUM2, remetenteJid: `${NUM2}@s.whatsapp.net` });
    const semNumero = ler(item({ remoteJid: GRUPO, participant: '99887766554433@lid' }, { conversation: 'x' }));
    expect(semNumero).toMatchObject({ remetenteNumero: null, remetenteJid: '99887766554433@lid' });
  });

  it('@lid com o número real ao lado: a conversa é a do número e o lid fica guardado', () => {
    const alt = ler(item({ remoteJid: LID, remoteJidAlt: `${NUM}@s.whatsapp.net` }, { conversation: 'oi' }));
    expect(alt).toMatchObject({ chatJid: `${NUM}@s.whatsapp.net`, lidJid: LID, remetenteNumero: NUM });
    const pn = ler(item({ remoteJid: LID, senderPn: `${NUM}@s.whatsapp.net` }, { conversation: 'oi' }));
    expect(pn).toMatchObject({ chatJid: `${NUM}@s.whatsapp.net`, lidJid: LID });
    // o inverso (telefone no remoteJid, lid ao lado) também guarda o lid
    expect(ler(item({ remoteJidAlt: LID }, { conversation: 'oi' }))).toMatchObject({ chatJid: `${NUM}@s.whatsapp.net`, lidJid: LID });
  });

  it('@lid sem o número real: a conversa fica no lid, sem número de remetente', () => {
    const m = ler(item({ remoteJid: LID }, { conversation: 'oi' }));
    expect(m).toMatchObject({ chatJid: LID, lidJid: null, remetenteNumero: null, remetenteJid: LID });
  });

  it('mídia: só metadados (MIME, nome, tamanho, segundos); nada de url, chave nem base64', () => {
    const doc = ler(
      item({}, {
        documentMessage: {
          url: 'https://mmg.whatsapp.net/x', mediaKey: 'CHAVE-SECRETA', directPath: '/v/x', jpegThumbnail: 'AAAA',
          mimetype: 'application/pdf', fileName: 'Contrato (exemplo).pdf', fileLength: { low: 2048, high: 0 }, caption: 'segue',
        },
        base64: 'JVBERi0xLjQK',
      }, { messageType: 'documentMessage' }),
    );
    expect(doc).toMatchObject({ tipo: 'document', texto: 'segue', midia: { mime: 'application/pdf', nome: 'Contrato (exemplo).pdf', tamanho: 2048, segundos: null } });
    expect(JSON.stringify(doc)).not.toMatch(/CHAVE-SECRETA|mmg\.whatsapp|JVBERi|AAAA|directPath/);
    const audio = ler(item({}, { audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 12, fileLength: '5120', ptt: true, mediaKey: 'K' } }, { messageType: 'audioMessage' }));
    expect(audio).toMatchObject({ tipo: 'audio', texto: null, midia: { mime: 'audio/ogg', nome: null, tamanho: 5120, segundos: 12 } });
    const imagem = ler(item({}, { imageMessage: { mimetype: 'image/jpeg', caption: 'foto da fachada', fileLength: 900 } }, { messageType: 'imageMessage' }));
    expect(imagem).toMatchObject({ tipo: 'image', texto: 'foto da fachada', midia: { mime: 'image/jpeg', tamanho: 900 } });
    expect(ler(item({}, { videoMessage: { mimetype: 'video/mp4', seconds: 30 } })).tipo).toBe('video');
    expect(ler(item({}, { stickerMessage: { mimetype: 'image/webp' } })).tipo).toBe('sticker');
    // documento com legenda vem embrulhado
    const embrulhado = ler(item({}, { documentWithCaptionMessage: { message: { documentMessage: { fileName: 'a.pdf', mimetype: 'application/pdf', caption: 'leg' } } } }));
    expect(embrulhado).toMatchObject({ tipo: 'document', texto: 'leg', midia: { nome: 'a.pdf' } });
  });

  it('citação: o stanzaId do contextInfo (no texto estendido, na mídia ou no registro)', () => {
    const m = ler(item({}, { extendedTextMessage: { text: 'respondendo', contextInfo: { stanzaId: 'ORIG1', participant: `${NUM2}@s.whatsapp.net` } } }, { messageType: 'extendedTextMessage' }));
    expect(m).toMatchObject({ tipo: 'extendedText', texto: 'respondendo', citaMensagemExternaId: 'ORIG1' });
    const doRegistro = ler(item({}, { conversation: 'oi' }, { contextInfo: { stanzaId: 'ORIG2' } }));
    expect(doRegistro.citaMensagemExternaId).toBe('ORIG2');
  });

  it('reação: o emoji é o texto e a mensagem reagida é a citação', () => {
    const m = ler(item({}, { reactionMessage: { key: { id: 'ORIG3', remoteJid: `${NUM}@s.whatsapp.net` }, text: '👍' } }, { messageType: 'reactionMessage' }));
    expect(m).toMatchObject({ tipo: 'reaction', texto: '👍', citaMensagemExternaId: 'ORIG3' });
  });

  it('edição: o texto novo e a mensagem editada como citação (as duas formas da Evolution)', () => {
    const viaProtocolo = ler(item({ id: 'ED1' }, { protocolMessage: { type: 14, key: { id: 'ORIG4' }, editedMessage: { conversation: 'texto corrigido' } } }, { messageType: 'protocolMessage' }));
    expect(viaProtocolo).toMatchObject({ tipo: 'edicao', texto: 'texto corrigido', citaMensagemExternaId: 'ORIG4' });
    const viaEnvelope = ler(
      item({ id: 'ED2' }, { editedMessage: { message: { protocolMessage: { type: 14, key: { id: 'ORIG5' }, editedMessage: { extendedTextMessage: { text: 'de novo' } } } } } }, { messageType: 'editedMessage' }),
    );
    expect(viaEnvelope).toMatchObject({ tipo: 'edicao', texto: 'de novo', citaMensagemExternaId: 'ORIG5' });
  });

  it('protocolo (apagar para todos, distribuição de chave): sem texto', () => {
    const apagada = ler(item({ id: 'P1' }, { protocolMessage: { type: 0, key: { id: 'ORIG6' } } }, { messageType: 'protocolMessage' }));
    expect(apagada).toMatchObject({ tipo: 'protocolo', texto: null, citaMensagemExternaId: 'ORIG6' });
    expect(ler(item({ id: 'P2' }, { senderKeyDistributionMessage: { groupId: GRUPO } })).tipo).toBe('protocolo');
  });

  it('contato, localização, enquete e o desconhecido', () => {
    expect(ler(item({}, { contactMessage: { displayName: 'Contato (exemplo)', vcard: 'BEGIN:VCARD' } }))).toMatchObject({ tipo: 'contato', texto: 'Contato (exemplo)' });
    expect(ler(item({}, { locationMessage: { degreesLatitude: -21.7, degreesLongitude: -43.3, name: 'Sede (exemplo)' } }))).toMatchObject({ tipo: 'localizacao', texto: 'Sede (exemplo)' });
    expect(ler(item({}, { pollCreationMessageV3: { name: 'Qual dia?', options: [] } }))).toMatchObject({ tipo: 'enquete', texto: 'Qual dia?' });
    expect(ler(item({}, { algoNovoMessage: { x: 1 } })).tipo).toBe('outro');
  });

  it('texto longo é cortado no teto; controle sai, quebra de linha fica', () => {
    const m = ler(item({}, { conversation: `a\u0000b\r\nc${'x'.repeat(TETO_DO_TEXTO + 50)}` }));
    expect(m.texto!.length).toBe(TETO_DO_TEXTO);
    expect(m.texto!.startsWith('ab\nc')).toBe(true);
  });

  it('o instante: segundos, milissegundos, texto e Long; fora de razão vira o agora', () => {
    expect(instanteDaEvolution(1792681200, AGORA).getTime()).toBe(1792681200000);
    expect(instanteDaEvolution(1792681200123, AGORA).getTime()).toBe(1792681200123);
    expect(instanteDaEvolution('1792681200', AGORA).getTime()).toBe(1792681200000);
    expect(instanteDaEvolution({ low: 1792681200, high: 0 }, AGORA).getTime()).toBe(1792681200000);
    expect(instanteDaEvolution(undefined, AGORA)).toBe(AGORA);
    expect(instanteDaEvolution(5, AGORA)).toBe(AGORA);
    expect(instanteDaEvolution(AGORA.getTime() / 1000 + 10 * 86400, AGORA)).toBe(AGORA);
  });

  it('recado (status), lista de transmissão, canal, sem id e sem conteúdo são ignorados', () => {
    expect(lerRegistroDaEvolution(item({ remoteJid: 'status@broadcast' }, { conversation: 'x' }), AGORA)).toEqual({ ignorado: 'status ou lista de transmissão' });
    expect(lerRegistroDaEvolution(item({ remoteJid: '1234@newsletter' }, { conversation: 'x' }), AGORA)).toEqual({ ignorado: 'canal (newsletter)' });
    expect(lerRegistroDaEvolution(item({ id: '' }, { conversation: 'x' }), AGORA)).toEqual({ ignorado: 'sem id da mensagem' });
    expect(lerRegistroDaEvolution({ key: { id: 'A', remoteJid: `${NUM}@s.whatsapp.net` } }, AGORA)).toEqual({ ignorado: 'sem conteúdo' });
    expect(lerRegistroDaEvolution(item({ remoteJid: 'lixo' }, { conversation: 'x' }), AGORA)).toEqual({ ignorado: 'conversa fora do formato' });
    expect(lerRegistroDaEvolution(null, AGORA)).toEqual({ ignorado: 'sem mensagem' });
  });

  it('conversaDaKey: as três formas', () => {
    expect(conversaDaKey({ remoteJid: GRUPO })).toEqual({ chatJid: GRUPO, lidJid: null, grupo: true });
    expect(conversaDaKey({ remoteJid: LID, senderPn: `${NUM}@s.whatsapp.net` })).toEqual({ chatJid: `${NUM}@s.whatsapp.net`, lidJid: LID, grupo: false });
    expect(conversaDaKey(null)).toEqual({ ignorado: 'sem conversa' });
  });
});

describe('whatsapp: o corpo do webhook', () => {
  const corpo = (data: unknown, event = 'messages.upsert') => ({ event, instance: 'inst-casa', apikey: 'chave-do-corpo', data });

  it('messages.upsert (e MESSAGES_UPSERT, e send.message): as mensagens e a instância', () => {
    const r = lerCorpoDoWebhook(corpo(item({}, { conversation: 'oi' })), AGORA);
    expect(r).toMatchObject({ tipo: 'mensagens', instancia: 'inst-casa', ignoradas: [] });
    if (r.tipo === 'mensagens') expect(r.lidas).toHaveLength(1);
    expect(lerCorpoDoWebhook(corpo(item({}, { conversation: 'oi' }), 'MESSAGES_UPSERT'), AGORA).tipo).toBe('mensagens');
    expect(lerCorpoDoWebhook(corpo(item({}, { conversation: 'oi' }), 'send.message'), AGORA).tipo).toBe('mensagens');
    const status = lerCorpoDoWebhook(corpo(item({ remoteJid: 'status@broadcast' }, { conversation: 'x' })), AGORA);
    expect(status).toMatchObject({ tipo: 'mensagens', lidas: [], ignoradas: ['status ou lista de transmissão'] });
  });

  it('connection.update: o estado da instância', () => {
    expect(lerCorpoDoWebhook(corpo({ instance: 'inst-casa', state: 'open', statusReason: 200 }, 'connection.update'))).toEqual({ tipo: 'conexao', instancia: 'inst-casa', estado: 'open' });
    expect(lerCorpoDoWebhook(corpo({ state: 'close' }, 'CONNECTION_UPDATE'))).toMatchObject({ tipo: 'conexao', estado: 'close' });
    expect(lerCorpoDoWebhook(corpo({ state: 'qualquer' }, 'connection.update'))).toMatchObject({ estado: 'desconhecido' });
  });

  it('outros eventos e corpo vazio: ignorados', () => {
    expect(lerCorpoDoWebhook(corpo({}, 'messages.update'))).toEqual({ tipo: 'ignorado', instancia: 'inst-casa', motivo: 'evento messages.update' });
    expect(lerCorpoDoWebhook(null)).toMatchObject({ tipo: 'ignorado', motivo: 'corpo vazio' });
    expect(lerCorpoDoWebhook({ data: {} })).toMatchObject({ tipo: 'ignorado', instancia: null });
  });
});

describe('whatsapp: chats e grupos da sincronização', () => {
  it('chat 1:1: nome pelo pushName, foto só https, última pela lastMessage', () => {
    const c = lerChatDaEvolution(
      { id: 'uuid-1', remoteJid: `${NUM}@s.whatsapp.net`, pushName: 'Café Serra (exemplo)', profilePicUrl: 'https://pps.exemplo/x.jpg', lastMessage: { messageTimestamp: 1792681200 } },
      AGORA,
    );
    expect(c).toEqual({ chatJid: `${NUM}@s.whatsapp.net`, lidJid: null, grupo: false, nome: 'Café Serra (exemplo)', fotoUrl: 'https://pps.exemplo/x.jpg', ultimaEm: new Date(1792681200000) });
    expect(lerChatDaEvolution({ remoteJid: `${NUM}@s.whatsapp.net`, profilePicUrl: 'http://inseguro/x.jpg' }, AGORA)?.fotoUrl).toBeNull();
  });

  it('chat @lid com o número na última mensagem; grupo sem nome; recado fora', () => {
    expect(lerChatDaEvolution({ remoteJid: LID, lastMessage: { key: { remoteJid: LID, remoteJidAlt: `${NUM}@s.whatsapp.net` } } }, AGORA)).toMatchObject({ chatJid: `${NUM}@s.whatsapp.net`, lidJid: LID });
    expect(lerChatDaEvolution({ remoteJid: GRUPO, pushName: 'Quem falou por último' }, AGORA)).toMatchObject({ grupo: true, nome: null });
    expect(lerChatDaEvolution({ remoteJid: 'status@broadcast' }, AGORA)).toBeNull();
    expect(lerChatDaEvolution(null, AGORA)).toBeNull();
  });

  it('grupo: assunto, foto, contagem e a lista só com número, nome e admin', () => {
    const g = lerGrupoDaEvolution({
      id: GRUPO,
      subject: 'ROOT | Café Serra (exemplo)',
      pictureUrl: 'https://pps.exemplo/g.jpg',
      size: 3,
      participants: [
        { id: `${NUM}@s.whatsapp.net`, admin: 'superadmin' },
        { id: '99887766554433@lid', phoneNumber: `${NUM2}@s.whatsapp.net`, admin: null },
        { id: '11223344556677@lid', admin: 'admin', name: 'Pessoa (exemplo)' },
      ],
    });
    expect(g).toEqual({
      chatJid: GRUPO,
      nome: 'ROOT | Café Serra (exemplo)',
      fotoUrl: 'https://pps.exemplo/g.jpg',
      participantes: 3,
      participantesLista: [
        { numero: NUM, nome: null, admin: true },
        { numero: NUM2, nome: null, admin: false },
        { numero: null, nome: 'Pessoa (exemplo)', admin: true },
      ],
    });
    expect(lerGrupoDaEvolution({ id: `${NUM}@s.whatsapp.net` })).toBeNull();
    expect(lerGrupoDaEvolution({ id: GRUPO, size: 7 })).toMatchObject({ participantes: 7, participantesLista: null });
  });
});
