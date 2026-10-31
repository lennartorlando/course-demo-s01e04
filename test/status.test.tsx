import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

describe('status board', () => {
  it('shows the lane banner and the nights on disk', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('2026-10-28');
  });

  it('links each night to its digest with its ok / retry / fail counts', async () => {
    const html = await (await createApp(config).request('/')).text();
    expect(html).toContain('<tr><td><a href="/digest/2026-10-28">2026-10-28</a></td><td>10</td><td>4</td><td>1</td></tr>');
    expect(html).toContain('<tr><td><a href="/digest/2026-10-27">2026-10-27</a></td><td>7</td><td>0</td><td>0</td></tr>');
  });

  it('health answers with the lane id', async () => {
    const res = await createApp(config).request('/health');
    expect(await res.json()).toEqual({ ok: true, lane: 'lane-07' });
  });
});
