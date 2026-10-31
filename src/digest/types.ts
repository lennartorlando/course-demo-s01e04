// Run log reader contract (plan.md § 1, issue #1). The page, the JSON route, the board link and
// the route tests build against this file; the reader itself implements `ReadNight`.
//
// Input: `<runsDir>/<night>.jsonl`, one JSON object per line:
//   { "at": string, "job": string, "status": "ok" | "retry" | "fail", "owner": string | null, "error"?: string }

/** The status of one log line, and so of a job's last run. */
export type RunStatus = 'ok' | 'retry' | 'fail';

/**
 * One row per job of a night.
 *
 * A "parsed line" is a line that is valid JSON and has a non-empty string `job`, a `status` of
 * `ok | retry | fail`, and an `at` that is an ISO 8601 date-time with an explicit offset
 * (`Z` or `±HH:MM`). Any other non-blank line is a bad line: counted in `Night.badLines`, never
 * thrown, never part of a row. Blank lines (including the one after a trailing newline) are
 * neither parsed nor bad. "First", "last" and "most recent" mean file order, not time order.
 *
 * - `job`: the `job` of the job's lines.
 * - `owner`: the `owner` of the job's last parsed line; `null` when that line's `owner` is
 *   `null`, missing or not a string. The row is kept; views show it as `—`.
 * - `runs`: every parsed line of the job.
 * - `retries`: the job's parsed lines with status `retry`.
 * - `lastStatus`: the status of the job's last parsed line.
 * - `lastError`: the job's most recent `error` (from the last of its parsed lines that has a
 *   string `error`), even when `lastStatus` is `ok`; `null` when it has none.
 * - `first` / `last`: the `at` of the job's first and last parsed line, exactly as written in the
 *   log, offset kept (styleguide: never converted to UTC).
 */
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  first: string;
  last: string;
};

/** Parsed lines of a night per status. Bad lines are not in here; see `Night.badLines`. */
export type StatusCounts = Record<RunStatus, number>;

/**
 * One night's run log, read. Plain data, safe to return as JSON unchanged, so the page and
 * `GET /api/digest/:night` can never disagree.
 *
 * - `night`: the `YYYY-MM-DD` that was read.
 * - `rows`: one per job, sorted by `job` in plain string order (`a < b`, not `localeCompare`).
 * - `counts`: the night's parsed lines per status. `counts.ok + counts.retry + counts.fail`
 *   equals the sum of `rows[].runs`.
 * - `badLines`: the number of lines that don't parse (see `DigestRow`).
 *
 * An empty file is a night with `rows: []`, all counts 0 and `badLines: 0`, not a missing night.
 */
export type Night = {
  night: string;
  rows: DigestRow[];
  counts: StatusCounts;
  badLines: number;
};

/**
 * Reads `<runsDir>/<night>.jsonl` synchronously.
 *
 * Returns `null`, without touching the file system, when `night` is not `YYYY-MM-DD`
 * (`/^\d{4}-\d{2}-\d{2}$/`, the same pattern as `nightsOnDisk`), so routes can answer 404
 * without building a path from user input. Returns `null` when the file (or `runsDir`) does not
 * exist. Never throws for bad lines; other file system errors (for example permissions) are
 * thrown.
 */
export type ReadNight = (runsDir: string, night: string) => Night | null;
