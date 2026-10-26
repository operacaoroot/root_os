import { describe, expect, it } from 'vitest';

import { acharPorNome, idsDoAgente, lerComando, lerPedidoDoGrupo, mesmoTelefone } from '../src/work/agente-de-tarefas/pedido-do-grupo';

const GRUPO = '120363407836726219@g.us';
const IDS = idsDoAgente('5532936180013, 63617827360770');

function evento(texto: string, extra: Record<string, unknown> = {}, marcados: string[] = ['63617827360770@lid']) {
  return {
    event: 'messages.upsert',
    data: {
      key: { remoteJid: GRUPO, fromMe: false, id: 'ABC', participant: '553291486277@s.whatsapp.net', ...extra },
      pushName: 'Lucas',
      message: { extendedTextMessage: { text: texto, contextInfo: { mentionedJid: marcados } } },
    },
  };
}

describe('agente de tarefas: o pedido do grupo', () => {
  it('só lê mensagem que marca o número comercial', () => {
    expect(lerPedidoDoGrupo(evento('tarefa pro Pedro: revisar contrato', {}, []), GRUPO, IDS)).toBeNull();
    expect(lerPedidoDoGrupo({ ...evento('a tarefa de ontem'), data: { ...evento('x').data, message: { conversation: 'tarefas atrasadas' } } }, GRUPO, IDS)).toBeNull();
    expect(lerPedidoDoGrupo(evento('@227990520782943 tarefas', {}, ['227990520782943@lid']), GRUPO, IDS)).toBeNull();
    expect(lerPedidoDoGrupo(evento('@63617827360770 tarefa pro Pedro: revisar contrato até sexta'), GRUPO, IDS)?.texto)
      .toBe('tarefa pro Pedro: revisar contrato até sexta');
    expect(lerPedidoDoGrupo(evento('@5532936180013 tarefas', {}, ['5532936180013@s.whatsapp.net']), GRUPO, IDS)?.plural).toBe(true);
    expect(lerPedidoDoGrupo(evento('minhas tarefas @63617827360770'), GRUPO, IDS)?.texto).toBe('minhas tarefas');
    expect(lerPedidoDoGrupo(evento('@63617827360770'), GRUPO, IDS)?.texto).toBe('');
  });

  it('sem ids configurados, nada é pedido', () => {
    expect(lerPedidoDoGrupo(evento('@63617827360770 tarefas'), GRUPO, [])).toBeNull();
  });

  it('ignora outro grupo, eco da instância e evento que não é mensagem nova', () => {
    expect(lerPedidoDoGrupo(evento('tarefas'), '999@g.us', IDS)).toBeNull();
    expect(lerPedidoDoGrupo(evento('tarefas', { fromMe: true }), GRUPO, IDS)).toBeNull();
    expect(lerPedidoDoGrupo({ ...evento('tarefas'), event: 'messages.update' }, GRUPO, IDS)).toBeNull();
  });

  it('acha o telefone do participante, também atrás de um @lid', () => {
    expect(lerPedidoDoGrupo(evento('tarefas'), GRUPO, IDS)?.telefone).toBe('553291486277');
    const lid = lerPedidoDoGrupo(evento('tarefas', { participant: '123@lid', participantAlt: '553299413766@s.whatsapp.net' }), GRUPO, IDS);
    expect(lid?.telefone).toBe('553299413766');
    expect(lerPedidoDoGrupo(evento('tarefas', { participant: '123@lid' }), GRUPO, IDS)?.telefone).toBeNull();
  });
});

describe('agente de tarefas: telefone e nome', () => {
  it('casa o celular com e sem o 9 da frente e com máscara', () => {
    expect(mesmoTelefone('553291486277', '(32) 99148-6277')).toBe(true);
    expect(mesmoTelefone('5532991486277', '+55 32 9148-6277')).toBe(true);
    expect(mesmoTelefone('553291486277', '(31) 99148-6277')).toBe(false);
    expect(mesmoTelefone('553291486277', null)).toBe(false);
  });

  it('acha a pessoa pelo nome sem acento ou pelo primeiro nome', () => {
    const equipe = [{ id: '1', nome: 'Lucas Rezende' }, { id: '2', nome: 'Pedro Magnago' }];
    expect(acharPorNome(equipe, 'pedro')?.id).toBe('2');
    expect(acharPorNome(equipe, 'Lucas Rezende')?.id).toBe('1');
    expect(acharPorNome(equipe, 'Rodrigo')).toBeNull();
  });
});

describe('agente de tarefas: o comando do modelo', () => {
  it('lê o JSON mesmo cercado de texto', () => {
    expect(lerComando('```json\n{"acao":"criar","titulo":"Revisar contrato","pessoa":"Pedro","prazo":"2026-10-30"}\n```'))
      .toEqual({ acao: 'criar', titulo: 'Revisar contrato', pessoa: 'Pedro', prazo: '2026-10-30' });
  });

  it('recusa ação desconhecida, prazo torto e texto sem JSON', () => {
    expect(lerComando('{"acao":"apagar"}')).toBeNull();
    expect(lerComando('{"acao":"criar","prazo":"30/10"}')).toBeNull();
    expect(lerComando('não sei')).toBeNull();
  });
});
