/**
 * Rewrite libsql-style `?` positional placeholders to Postgres `$1…$n`.
 *
 * Skips placeholders inside single-quoted strings (with `''` escaping),
 * double-quoted identifiers, `-- line` comments, `/* block *\/` comments and
 * `$tag$ … $tag$` dollar-quoted strings. The jsonb `?`/`?|`/`?&` operators are
 * deliberately NOT supported in ported SQL — use `jsonb_exists()` instead.
 */
export function rewritePlaceholders(sql: string): string {
  let out = '';
  let param = 0;
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

    // $tag$ dollar-quoted string (also bare $$)
    if (ch === '$') {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        out += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }

    if (ch === '?') {
      param += 1;
      out += `$${param}`;
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}
