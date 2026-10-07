import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LIST_IDS = ['901328341442', '901328341443', '901328341445', '901328341450',
  '901328341456', '901328341455', '901328341451'];
const SPACE_ID = '901313864063';
const SCRIPT = resolve('prisma/import-clickup-work.normalize.mjs');
type CaptureStatus = {
  stable: boolean;
  usableForNormalization: boolean;
  paginationComplete: boolean;
  capturedAt: string;
  finalRecheck: { added: string[]; missing: string[]; updated: string[] };
  taskCount: number;
  listCount: number;
  filesCount: number;
  listIds: string[];
  sha256: Record<string, string>;
};

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

type Export = { lists: Array<Record<string, any>>; tasks: Array<Record<string, any>> };

function makeCapture(ajustar?: (exportado: Export) => void) {
  const root = mkdtempSync(join(tmpdir(), 'clickup-normalizer-capture-'));
  chmodSync(root, 0o700);
  const lists: Export['lists'] = LIST_IDS.map((id, order) => ({
    id,
    name: `Lista ${order + 1}`,
    space: { id: SPACE_ID },
    statuses: [{ id: `${id}-open`, status: 'to do', type: 'open', color: '#87909e', orderindex: 0 }],
    fields: [],
  }));
  const tasks: Export['tasks'] = [{
    id: 'task-001',
    name: 'ROOT-001 — fixture',
    list: { id: LIST_IDS[0] },
    space: { id: SPACE_ID },
    folder: { id: '901318837280' },
    status: 'to do',
    markdown_description: 'Fixture local de teste',
    text_content: '',
    priority: null,
    assignees: [],
    start_date: null,
    due_date: null,
    date_created: '1790678584724',
    date_updated: '1790678584724',
    parent: null,
    url: 'https://app.clickup.com/t/task-001',
    tags: [],
    custom_fields: [],
    commentsExport: { count: 0, comments: [] },
    checklists: [],
    dependencies: [],
    attachments: [],
  }];
  ajustar?.({ lists, tasks });
  const files: unknown[] = [];
  const paths = {
    tasks: join(root, 'raw-tasks.json'),
    lists: join(root, 'raw-lists.json'),
    files: join(root, 'files.json'),
    capture: join(root, 'capture-status.json'),
    output: join(root, 'output'),
  };
  mkdirSync(paths.output, { mode: 0o700 });
  chmodSync(paths.output, 0o700);
  writeFileSync(paths.tasks, JSON.stringify(tasks));
  writeFileSync(paths.lists, JSON.stringify(lists));
  writeFileSync(paths.files, JSON.stringify(files));
  const hashes = Object.fromEntries([paths.tasks, paths.lists, paths.files].map((path) => [
    path.split('/').at(-1)!, sha256(readFileSync(path)),
  ]));
  const capture: CaptureStatus = {
    stable: true,
    usableForNormalization: true,
    paginationComplete: true,
    capturedAt: '2026-09-29T14:15:30.123Z',
    finalRecheck: { added: [], missing: [], updated: [] },
    taskCount: tasks.length,
    listCount: lists.length,
    filesCount: files.length,
    listIds: LIST_IDS,
    sha256: hashes,
  };
  writeFileSync(paths.capture, JSON.stringify(capture));
  return { root, paths, capture };
}

function runNormalizer(paths: ReturnType<typeof makeCapture>['paths'], expectedTasks = 1) {
  return spawnSync(process.execPath, [SCRIPT,
    '--raw-tasks', paths.tasks,
    '--raw-lists', paths.lists,
    '--files', paths.files,
    '--capture-status', paths.capture,
    '--output-dir', paths.output,
    '--expected-tasks', String(expectedTasks),
    '--expected-files', '0',
  ], { encoding: 'utf8' });
}

function withCapture(test: (capture: ReturnType<typeof makeCapture>) => void, ajustar?: (exportado: Export) => void) {
  const capture = makeCapture(ajustar);
  try { test(capture); } finally { rmSync(capture.root, { recursive: true, force: true }); }
}

describe('gate de captura do normalizador ClickUp', () => {
  it('exige a escolha explícita do manifesto de captura', () => {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--capture-status é obrigatório');
  });

  it('recusa manifesto instável', () => withCapture(({ paths, capture }) => {
    capture.stable = false;
    writeFileSync(paths.capture, JSON.stringify(capture));
    const result = runNormalizer(paths);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Captura não confirmada');
    expect(readdirSync(paths.output)).toEqual([]);
  }));

  it('recusa hash divergente no raw-tasks', () => withCapture(({ paths }) => {
    writeFileSync(paths.tasks, `${readFileSync(paths.tasks, 'utf8')} `);
    const result = runNormalizer(paths);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SHA-256 da captura diverge: raw-tasks.json');
    expect(readdirSync(paths.output)).toEqual([]);
  }));

  it('recusa recheck final com updated não vazio', () => withCapture(({ paths, capture }) => {
    capture.finalRecheck.updated = ['task-001'];
    writeFileSync(paths.capture, JSON.stringify(capture));
    const result = runNormalizer(paths);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Recheck da captura não fechou: updated');
    expect(readdirSync(paths.output)).toEqual([]);
  }));

  it('usa capturedAt do manifesto e grava os artefatos com modo 0600', () => withCapture(({ paths }) => {
    const result = runNormalizer(paths);
    expect(result.status).toBe(0);
    const snapshot = JSON.parse(readFileSync(join(paths.output, 'marketing.local.snapshot.json'), 'utf8'));
    expect(snapshot.capturedAt).toBe('2026-09-29T14:15:30.123Z');
    expect(readdirSync(paths.output).sort()).toEqual([
      'attachments-index.json', 'marketing.local.snapshot.json', 'marketing.vps.snapshot.json',
    ]);
    for (const name of readdirSync(paths.output)) {
      expect(statSync(join(paths.output, name)).mode & 0o777).toBe(0o600);
    }
  }));

  it('recusa diretório de saída preexistente com permissões 0755', () => withCapture(({ paths }) => {
    chmodSync(paths.output, 0o755);
    const result = runNormalizer(paths);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Diretório de saída deve ser privado (0700)');
    expect(readdirSync(paths.output)).toEqual([]);
  }));
});

/*
 * MOEDA E ETAPA `done` NO NORMALIZADOR (ROOT-06a). O normalizador só transcreve:
 * a conversão para o canônico acontece uma vez, no TypeScript do importador.
 */
const CAMPO = 'campo-valor';
const LEADS = LIST_IDS[1];
type Configuracao = { currency_type?: unknown; precision?: unknown };

function comMoeda(config: Configuracao, valores: Array<Record<string, unknown>> = []) {
  return ({ lists, tasks }: Export) => {
    lists[1].statuses = [
      { id: 'st-oportunidade', status: 'oportunidade', type: 'open', color: '#87909e', orderindex: 0 },
      { id: 'st-geladeira', status: 'geladeira', type: 'done', color: '#6f7d8c', orderindex: 1 },
      { id: 'st-perdido', status: 'perdido', type: 'done', color: '#d33d44', orderindex: 2 },
      { id: 'st-fechado', status: 'fechado', type: 'closed', color: '#008844', orderindex: 3 },
    ];
    lists[1].fields = [{ id: CAMPO, name: 'Valor em negocição', type: 'currency', type_config: config }];
    valores.forEach((campo, i) => tasks.push({
      ...tasks[0], id: `lead-${i}`, name: `Lead ${i}`, list: { id: LEADS }, status: i % 2 ? 'geladeira' : 'fechado',
      url: `https://app.clickup.com/t/lead-${i}`, custom_fields: [{ id: CAMPO, type: 'currency', ...campo }],
    }));
  };
}

const snapshotLocal = (paths: ReturnType<typeof makeCapture>['paths']) =>
  JSON.parse(readFileSync(join(paths.output, 'marketing.local.snapshot.json'), 'utf8'));

describe('normalizador ClickUp: currency e etapa done', () => {
  const VALORES = [
    { value: '1500.50' }, { value: 1500.5 }, { value: '0' }, { value: null }, { value: '' }, {},
  ];

  it('currency BRL com precisão 2 vira moeda; texto e número passam sem conversão; vazio não gera valor', () => withCapture(({ paths }) => {
    const result = runNormalizer(paths, 1 + VALORES.length);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const snapshot = snapshotLocal(paths);
    const lista = snapshot.lists.find((l: { id: string }) => l.id === LEADS);
    expect(lista.fields).toEqual([expect.objectContaining({
      id: CAMPO, name: 'Valor em negocição', type: 'moeda', moeda: 'BRL', casas: 2, options: [],
    })]);
    const valorDa = (id: string) => snapshot.tasks.find((t: { id: string }) => t.id === id).fieldValues;
    expect(valorDa('lead-0')).toEqual([{ fieldId: CAMPO, optionId: null, value: '1500.50' }]);
    expect(valorDa('lead-1')).toEqual([{ fieldId: CAMPO, optionId: null, value: 1500.5 }]);
    expect(valorDa('lead-2')).toEqual([{ fieldId: CAMPO, optionId: null, value: '0' }]);
    for (const id of ['lead-3', 'lead-4', 'lead-5']) expect(valorDa(id)).toEqual([]);
  }, comMoeda({ currency_type: 'BRL', precision: 2 }, VALORES)));

  it('etapa done é aceita e transcrita como done', () => withCapture(({ paths }) => {
    expect(runNormalizer(paths, 3).status).toBe(0);
    const lista = snapshotLocal(paths).lists.find((l: { id: string }) => l.id === LEADS);
    expect(lista.statuses.map((s: { name: string; type: string }) => [s.name, s.type])).toEqual([
      ['oportunidade', 'open'], ['geladeira', 'done'], ['perdido', 'done'], ['fechado', 'closed'],
    ]);
  }, comMoeda({ currency_type: 'BRL', precision: 2 }, [{ value: '10' }, { value: '20' }])));

  for (const [rotulo, config] of [
    ['sem currency_type', { precision: 2 }],
    ['com código minúsculo', { currency_type: 'brl', precision: 2 }],
    ['sem precision', { currency_type: 'BRL' }],
    ['com precisão 3', { currency_type: 'BRL', precision: 3 }],
    ['com precisão fracionária', { currency_type: 'BRL', precision: 1.5 }],
  ] as const) {
    it(`currency ${rotulo} derruba a normalização com o ID do campo e não grava nada`, () => withCapture(({ paths }) => {
      const result = runNormalizer(paths);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`Campo currency ${LEADS}/${CAMPO}`);
      expect(readdirSync(paths.output)).toEqual([]);
    }, comMoeda(config)));
  }

  it('valor de currency que não é texto nem número vira lacuna e nada é gravado', () => withCapture(({ paths }) => {
    const result = runNormalizer(paths, 2);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`lead-0: valor do campo ${CAMPO} sem texto nem número`);
    expect(readdirSync(paths.output)).toEqual([]);
  }, comMoeda({ currency_type: 'BRL', precision: 2 }, [{ value: { amount: 1500 } }])));

  it('tipo de etapa desconhecido continua derrubando', () => withCapture(({ paths }) => {
    const result = runNormalizer(paths);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Tipo de status desconhecido archived');
    expect(readdirSync(paths.output)).toEqual([]);
  }, ({ lists }) => { lists[2].statuses[0].type = 'archived'; }));

  // Os bytes do snapshot do export padrão desta suíte, medidos com o
  // normalizador da base f58de1e: o export sem currency e sem done não muda.
  it('export sem currency e sem done gera o mesmo snapshot de antes', () => withCapture(({ paths }) => {
    expect(runNormalizer(paths).status).toBe(0);
    for (const nome of ['marketing.local.snapshot.json', 'marketing.vps.snapshot.json']) {
      expect(sha256(readFileSync(join(paths.output, nome)))).toBe('2838738ae3939911ce2c7672efd825f054afe909d099e43290c495c71d46444c');
    }
  }));
});
