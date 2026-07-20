import { describe, expect, it } from 'vitest';
import { applyNotification, unreadCount, type AccountNotification } from './core';

const mk = (dedupeKey: string, read = false): AccountNotification => ({
  id: dedupeKey,
  dedupeKey,
  type: 'fill',
  title: dedupeKey,
  ts: 1,
  read,
});

describe('applyNotification', () => {
  it('rejects duplicates by dedupeKey and returns the SAME array reference', () => {
    const entries = applyNotification([], mk('a'));
    const after = applyNotification(entries, mk('a'));
    expect(after).toBe(entries); // identity — stores skip the update, no double toast
    expect(after).toHaveLength(1);
  });

  it('prepends newest-first', () => {
    let entries = applyNotification([], mk('a'));
    entries = [...applyNotification(entries, mk('b'))];
    expect(entries.map((e) => e.dedupeKey)).toEqual(['b', 'a']);
  });

  it('evicts past the cap, oldest first', () => {
    let entries: readonly AccountNotification[] = [];
    for (let i = 0; i < 5; i++) entries = applyNotification(entries, mk(`n${i}`), 3);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.dedupeKey)).toEqual(['n4', 'n3', 'n2']);
  });
});

describe('unreadCount', () => {
  it('counts only unread entries', () => {
    expect(unreadCount([mk('a'), mk('b', true), mk('c')])).toBe(2);
  });
});
