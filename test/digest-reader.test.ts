import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('reads 5 jobs, 1 bad line and the per-status line counts', () => {
    expect(night).not.toBeNull();
    expect(night?.night).toBe('2026-10-28');
    expect(night?.rows).toHaveLength(5);
    expect(night?.badLines).toBe(1);
    expect(night?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('sorts rows by job', () => {
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('keeps the last error of a job that recovered, and the log offset', () => {
    expect(night?.rows.find((r) => r.job === 'fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      first: '2026-10-29T01:30:00+01:00',
      last: '2026-10-29T01:37:00+01:00',
    });
  });

  it('keeps a row whose owner is null', () => {
    const row = night?.rows.find((r) => r.job === 'digest/render');
    expect(row?.owner).toBeNull();
    expect(row?.runs).toBe(1);
  });
});

describe('readNight edge cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null for a night with no file', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
  });

  it('reads an empty file as a night with no rows', () => {
    writeFileSync(join(dir, '2026-01-02.jsonl'), '');
    expect(readNight(dir, '2026-01-02')).toEqual({
      night: '2026-01-02',
      rows: [],
      counts: { ok: 0, retry: 0, fail: 0 },
      badLines: 0,
    });
  });

  it('returns null for a night that is not YYYY-MM-DD', () => {
    writeFileSync(join(dir, 'x.jsonl'), '{"at":"2026-01-01T00:00:00Z","job":"a","status":"ok","owner":"me"}\n');
    expect(readNight(dir, 'x')).toBeNull();
    expect(readNight(dir, '../runs/2026-10-28')).toBeNull();
  });

  it('reads the last line of a file without a trailing newline', () => {
    writeFileSync(
      join(dir, '2026-01-03.jsonl'),
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"retry","owner":"me","error":"boom"}\n' +
        '{"at":"2026-01-03T01:05:00+01:00","job":"a","status":"fail","owner":"me","error":"down"}',
    );
    const night = readNight(dir, '2026-01-03');
    expect(night?.badLines).toBe(0);
    expect(night?.counts).toEqual({ ok: 0, retry: 1, fail: 1 });
    expect(night?.rows[0]).toMatchObject({ runs: 2, lastStatus: 'fail', lastError: 'down', last: '2026-01-03T01:05:00+01:00' });
  });
});
