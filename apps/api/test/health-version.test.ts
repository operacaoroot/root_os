import { afterEach, describe, expect, it } from 'vitest';
import { HealthController } from '../src/health/health.controller';

const ORIGINAL_VERSION = process.env.ROOTOS_VERSION;
const ORIGINAL_COMMIT = process.env.ROOTOS_COMMIT;

afterEach(() => {
  if (ORIGINAL_VERSION === undefined) delete process.env.ROOTOS_VERSION;
  else process.env.ROOTOS_VERSION = ORIGINAL_VERSION;
  if (ORIGINAL_COMMIT === undefined) delete process.env.ROOTOS_COMMIT;
  else process.env.ROOTOS_COMMIT = ORIGINAL_COMMIT;
});

describe('GET /health/versao', () => {
  const controller = new HealthController({} as never);

  it('expõe a versão e o commit gravados no artefato', () => {
    process.env.ROOTOS_VERSION = 'v1.2.3';
    process.env.ROOTOS_COMMIT = 'abcdef123456';
    expect(controller.version()).toEqual({ version: 'v1.2.3', commit: 'abcdef123456' });
  });

  it('não inventa uma release no desenvolvimento local', () => {
    delete process.env.ROOTOS_VERSION;
    delete process.env.ROOTOS_COMMIT;
    expect(controller.version()).toEqual({ version: 'development', commit: 'unknown' });
  });

  it('não aceita metadado composto apenas por espaço', () => {
    process.env.ROOTOS_VERSION = '   ';
    process.env.ROOTOS_COMMIT = '\t';
    expect(controller.version()).toEqual({ version: 'development', commit: 'unknown' });
  });
});
