import { describe, expect, it } from 'vitest';

import { rewritePlaceholders } from '../src/rewrite.js';

describe('rewritePlaceholders', () => {
  it('numbers placeholders left to right', () => {
    expect(rewritePlaceholders('SELECT * FROM t WHERE a = ? AND b = ?')).toBe(
      'SELECT * FROM t WHERE a = $1 AND b = $2'
    );
  });

  it('passes through SQL without placeholders', () => {
    const sql = 'SELECT 1';
    expect(rewritePlaceholders(sql)).toBe(sql);
  });

  it('ignores ? inside single-quoted strings, with escaping', () => {
    expect(rewritePlaceholders("SELECT '?' , 'it''s ?', ? FROM t")).toBe("SELECT '?' , 'it''s ?', $1 FROM t");
  });

  it('ignores ? inside double-quoted identifiers', () => {
    expect(rewritePlaceholders('SELECT "a?b" FROM t WHERE x = ?')).toBe('SELECT "a?b" FROM t WHERE x = $1');
  });

  it('ignores ? inside line comments', () => {
    expect(rewritePlaceholders('SELECT ? -- was ? here\nFROM t WHERE y = ?')).toBe(
      'SELECT $1 -- was ? here\nFROM t WHERE y = $2'
    );
  });

  it('ignores ? inside block comments', () => {
    expect(rewritePlaceholders('SELECT /* ? */ ? FROM t')).toBe('SELECT /* ? */ $1 FROM t');
  });

  it('ignores ? inside dollar-quoted strings', () => {
    expect(rewritePlaceholders('SELECT $tag$ a ? b $tag$, ?')).toBe('SELECT $tag$ a ? b $tag$, $1');
    expect(rewritePlaceholders('SELECT $$ ? $$, ?')).toBe('SELECT $$ ? $$, $1');
  });

  it('handles unterminated strings without hanging', () => {
    expect(rewritePlaceholders("SELECT '? unterminated")).toBe("SELECT '? unterminated");
  });

  it('leaves ON CONFLICT excluded upserts intact', () => {
    const sql =
      'INSERT INTO candles (asset, interval, bucket_ts) VALUES (?, ?, ?) ' +
      'ON CONFLICT (asset, interval, bucket_ts) DO UPDATE SET open = excluded.open';
    expect(rewritePlaceholders(sql)).toBe(
      'INSERT INTO candles (asset, interval, bucket_ts) VALUES ($1, $2, $3) ' +
        'ON CONFLICT (asset, interval, bucket_ts) DO UPDATE SET open = excluded.open'
    );
  });
});
