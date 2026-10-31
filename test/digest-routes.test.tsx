import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

// Route tests for GET /digest/:night (#2) and GET /api/digest/:night (#3), through app.request().
// Every night lives in a temp runs dir; runs/ is read-only and never read here. The nights are
// dated so that none of them exists in runs/, and the missing night is one that does exist there:
// a route that reads runs/ instead of config.runsDir fails these tests.

const NORMAL = '2031-01-15';
const EMPTY = '2031-01-16';
const BAD = '2031-01-17';
const MISSING = '2026-10-28'; // on disk in runs/, not in the temp dir
const MARKER = 'TEST-MARKER-DIGEST';

const lines = (...ls: string[]) => ls.join('\n') + '\n';

// File order is not job order: "Ops/report" sorts first in plain string order but last with
// localeCompare.
const normalLog = lines(
  '{"at":"2031-01-14T23:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
  '{"at":"2031-01-14T23:05:00+01:00","job":"rig/rotate-logs","status":"retry","owner":"lane-07","error":"disk busy"}',
  '{"at":"2031-01-14T23:10:00+01:00","job":"Ops/report","status":"fail","owner":null,"error":"timeout after 30s"}',
  '{"at":"2031-01-14T23:15:00+01:00","job":"rig/rotate-logs","status":"retry","owner":"lane-07","error":"disk still busy"}',
  '{"at":"2031-01-15T00:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
  '{"at":"2031-01-15T00:20:00+01:00","job":"rig/rotate-logs","status":"retry","owner":"lane-07"}',
  '{"at":"2031-01-15T00:40:00+01:00","job":"rig/rotate-logs","status":"ok","owner":"ops"}',
);

const normalNight: Night = {
  night: NORMAL,
  rows: [
    {
      job: 'Ops/report',
      owner: null,
      runs: 1,
      retries: 0,
      lastStatus: 'fail',
      lastError: 'timeout after 30s',
      first: '2031-01-14T23:10:00+01:00',
      last: '2031-01-14T23:10:00+01:00',
    },
    {
      job: 'lane/sync',
      owner: 'rook',
      runs: 2,
      retries: 0,
      lastStatus: 'ok',
      lastError: null,
      first: '2031-01-14T23:00:00+01:00',
      last: '2031-01-15T00:00:00+01:00',
    },
    {
      job: 'rig/rotate-logs',
      owner: 'ops',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'disk still busy',
      first: '2031-01-14T23:05:00+01:00',
      last: '2031-01-15T00:40:00+01:00',
    },
  ],
  counts: { ok: 3, retry: 3, fail: 1 },
  badLines: 0,
};

// Three bad lines (not JSON, unknown status, `at` without an offset) and one blank line, which is
// neither parsed nor bad.
const badLog = lines(
  '{"at":"2031-01-17T01:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
  'not json at all',
  '{"at":"2031-01-17T01:05:00+01:00","job":"lane/sync","status":"done","owner":"rook"}',
  '',
  '{"at":"2031-01-17T01:10:00","job":"rig/rotate-logs","status":"ok","owner":"lane-07"}',
  '{"at":"2031-01-17T01:15:00+01:00","job":"rig/rotate-logs","status":"fail","owner":"lane-07","error":"no space left"}',
);

const badNight: Night = {
  night: BAD,
  rows: [
    {
      job: 'lane/sync',
      owner: 'rook',
      runs: 1,
      retries: 0,
      lastStatus: 'ok',
      lastError: null,
      first: '2031-01-17T01:00:00+01:00',
      last: '2031-01-17T01:00:00+01:00',
    },
    {
      job: 'rig/rotate-logs',
      owner: 'lane-07',
      runs: 1,
      retries: 0,
      lastStatus: 'fail',
      lastError: 'no space left',
      first: '2031-01-17T01:15:00+01:00',
      last: '2031-01-17T01:15:00+01:00',
    },
  ],
  counts: { ok: 1, retry: 0, fail: 1 },
  badLines: 3,
};

// `:night` values that are not YYYY-MM-DD. The traversal cases point at real files outside the
// runs dir (`<root>/secret.jsonl`) or inside it under a non-date name (`latest.jsonl`), so they
// only answer 404 if the route refuses the name instead of finding no file.
const malformed = ['2026-1-1', '20310115', 'latest', '..%2F..%2Fetc', '..%2Fsecret', `${NORMAL}.jsonl`];

let root: string;
let app: ReturnType<typeof createApp>;
let savedMarker: string | undefined;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  const runsDir = join(root, 'runs');
  mkdirSync(runsDir);
  writeFileSync(join(runsDir, `${NORMAL}.jsonl`), normalLog);
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  writeFileSync(join(runsDir, `${BAD}.jsonl`), badLog);
  writeFileSync(join(runsDir, 'latest.jsonl'), normalLog);
  writeFileSync(join(root, 'secret.jsonl'), normalLog);

  savedMarker = process.env.LANE_MARKER;
  process.env.LANE_MARKER = MARKER;
  app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
});

afterAll(() => {
  if (savedMarker === undefined) delete process.env.LANE_MARKER;
  else process.env.LANE_MARKER = savedMarker;
  rmSync(root, { recursive: true, force: true });
});

async function page(night: string) {
  const res = await app.request(`/digest/${night}`);
  return { status: res.status, html: await res.text() };
}

async function api(night: string) {
  const res = await app.request(`/api/digest/${night}`);
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() };
}

/** The page's visible text, tags dropped and whitespace collapsed. */
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

/** The given jobs in the order they first appear in the html; each must appear. */
function orderIn(html: string, jobs: string[]): string[] {
  for (const job of jobs) expect(html, `page lists ${job}`).toContain(job);
  return [...jobs].sort((a, b) => html.indexOf(a) - html.indexOf(b));
}

describe('GET /api/digest/:night', () => {
  it('returns the night as JSON', async () => {
    const res = await api(NORMAL);
    expect(res.status).toBe(200);
    expect(res.type).toContain('application/json');
    expect(JSON.parse(res.body)).toEqual(normalNight);
  });

  it('returns an empty night, not a 404, for an empty file', async () => {
    const res = await api(EMPTY);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ night: EMPTY, rows: [], counts: { ok: 0, retry: 0, fail: 0 }, badLines: 0 });
  });

  it('counts bad lines and keeps the rest of the night', async () => {
    const res = await api(BAD);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual(badNight);
  });

  it('answers 404 with JSON for a night with no file', async () => {
    const res = await api(MISSING);
    expect(res.status).toBe(404);
    expect(res.type).toContain('application/json');
  });

  it.each(malformed)('answers 404 for the malformed night %s', async (night) => {
    const res = await api(night);
    expect(res.status).toBe(404);
    expect(res.body).not.toContain('Ops/report');
  });
});

describe('GET /digest/:night', () => {
  it('renders the jobs sorted by job, inside the layout with the lane banner', async () => {
    const res = await page(NORMAL);
    expect(res.status).toBe(200);
    expect(res.html).toContain('lane-07');
    expect(res.html).toContain(MARKER);
    expect(orderIn(res.html, ['rig/rotate-logs', 'lane/sync', 'Ops/report'])).toEqual([
      'Ops/report',
      'lane/sync',
      'rig/rotate-logs',
    ]);
    // Ops/report has a null owner: shown as —, not dropped.
    expect(res.html).toContain('—');
    expect(text(res.html)).not.toMatch(/nothing ran/i);
  });

  it('renders "nothing ran" for an empty file', async () => {
    const res = await page(EMPTY);
    expect(res.status).toBe(200);
    expect(res.html).toContain(MARKER);
    expect(text(res.html)).toMatch(/nothing ran/i);
  });

  it('renders the night and shows how many lines did not parse', async () => {
    const res = await page(BAD);
    expect(res.status).toBe(200);
    expect(orderIn(res.html, ['rig/rotate-logs', 'lane/sync'])).toEqual(['lane/sync', 'rig/rotate-logs']);
    // The wording is #2's; the count must sit next to it.
    expect(text(res.html)).toMatch(/\b3\b\D{0,40}(bad|pars|invalid|skipped)|(bad|pars|invalid|skipped)\D{0,40}\b3\b/i);
  });

  it('answers 404 for a night with no file', async () => {
    expect((await page(MISSING)).status).toBe(404);
  });

  it.each(malformed)('answers 404 for the malformed night %s', async (night) => {
    const res = await page(night);
    expect(res.status).toBe(404);
    expect(res.html).not.toContain('Ops/report');
  });
});

describe('page and JSON', () => {
  it('list the same jobs in the same order', async () => {
    for (const night of [NORMAL, BAD]) {
      const jobs = (JSON.parse((await api(night)).body) as Night).rows.map((r) => r.job);
      expect(jobs.length).toBeGreaterThan(0);
      expect(orderIn((await page(night)).html, jobs)).toEqual(jobs);
    }
  });
});
