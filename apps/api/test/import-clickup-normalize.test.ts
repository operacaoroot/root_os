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

function makeCapture() {
  const root = mkdtempSync(join(tmpdir(), 'clickup-normalizer-capture-'));
  chmodSync(root, 0o700);
  const lists = LIST_IDS.map((id, order) => ({
    id,
    name: `Lista ${order + 1}`,
    space: { id: SPACE_ID },
    statuses: [{ id: `${id}-open`, status: 'to do', type: 'open', color: '#87909e', orderindex: 0 }],
    fields: [],
  }));
  const tasks = [{
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

function runNormalizer(paths: ReturnType<typeof makeCapture>['paths']) {
  return spawnSync(process.execPath, [SCRIPT,
    '--raw-tasks', paths.tasks,
    '--raw-lists', paths.lists,
    '--files', paths.files,
    '--capture-status', paths.capture,
    '--output-dir', paths.output,
    '--expected-tasks', '1',
    '--expected-files', '0',
  ], { encoding: 'utf8' });
}

function withCapture(test: (capture: ReturnType<typeof makeCapture>) => void) {
  const capture = makeCapture();
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
