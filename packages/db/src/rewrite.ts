/** Raised instead of emitting SQL whose meaning we cannot guarantee. */
export class SqlRewriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlRewriteError';
  }
}

/**
 * Rewrite libsql-style `?` positional placeholders to Postgres `$1…$n`.
 *
 * Skips placeholders inside single-quoted strings (with `''` escaping),
 * double-quoted identifiers, `-- line` comments, `/* block *\/` comments and
 * `$tag$ … $tag$` dollar-quoted strings.
 *
 * Where the input is ambiguous this THROWS rather than guessing. Both hazards
 * below previously produced valid-looking SQL that Postgres accepted and
 * executed with the wrong meaning — the worst possible failure mode, because
 * there is no error to notice:
 *
 *  - Mixing `$n` with `?`. Numbering restarts at 1 regardless of the `$n`
 *    already present, so `a = $1 AND b = ?` became `a = $1 AND b = $1`:
 *    one parameter supplied, one expected, no bind error, and `b` silently
 *    compared against `a`'s value.
 *  - The jsonb `?`, `?|` and `?&` operators, which are indistinguishable from
 *    placeholders to a scanner this simple. `?|`/`?&` are caught here; a bare
 *    `payload_json ? 'k'` is caught downstream by the arity check, since it
 *    inflates the placeholder count past the supplied argument count.
 */
export function rewritePlaceholders(sql: string): string {
  return rewriteWithCount(sql).sql;
}

/** As `rewritePlaceholders`, also reporting how many placeholders were emitted. */
export function rewriteWithCount(sql: string): { sql: string; params: number } {
  let out = '';
  let param = 0;
  let sawPositional = false;
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i]!;

    // -- line comment
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      if (end === -1) {
        out += sql.slice(i);
        break;
      }
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    // /* block comment */
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // 'string literal' with '' escaping
    if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    // "quoted identifier"
    if (ch === '"') {
      let j = i + 1;
      while (j < n && sql[j] !== '"') j += 1;
      const stop = Math.min(j + 1, n);
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // $tag$ dollar-quoted string (also bare $$). Tags follow identifier rules,
    // so digits are legal after the first character — `$body1$` is a real tag
    // and must not be mistaken for a positional parameter.
    if (ch === '$') {
      const m = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        out += sql.slice(i, stop);
        i = stop;
        continue;
      }
      // $1, $2 … an already-numbered parameter.
      const positional = /^\$[0-9]+/.exec(sql.slice(i));
      if (positional) {
        sawPositional = true;
        out += positional[0];
        i += positional[0].length;
        continue;
      }
    }

    if (ch === '?') {
      const next = sql[i + 1];
      if (next === '|' || next === '&') {
        throw new SqlRewriteError(
          `jsonb operator "?${next}" is not supported: it is indistinguishable from a ` +
            'placeholder. Use jsonb_exists_any()/jsonb_exists_all() instead.',
        );
      }
      param += 1;
      out += `$${param}`;
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  // Only a genuine mix is fatal. SQL written entirely with $n (no `?` at all)
  // passes through untouched, so callers that hand-number are unaffected.
  if (sawPositional && param > 0) {
    throw new SqlRewriteError(
      'SQL mixes $n parameters with ? placeholders. Placeholder numbering restarts ' +
        'at $1 and would collide with the existing $n, binding a value to the wrong ' +
        'column without any bind error. Use one style throughout.',
    );
  }

  return { sql: out, params: param };
}
