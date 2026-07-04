import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The SDK vendors packages/types so the published package has zero
// workspace dependencies. This test pins the copy to the source of
// truth — if it fails, re-copy the drifted file(s) from packages/types.
const here = dirname(fileURLToPath(import.meta.url));
const vendoredDir = join(here, '..', 'src', 'types');
const canonicalDir = join(here, '..', '..', 'packages', 'types', 'src');

describe.skipIf(!existsSync(canonicalDir))('vendored types stay in sync with @noether/types', () => {
  it('every canonical file is vendored byte-for-byte', () => {
    for (const file of readdirSync(canonicalDir).filter((f) => f.endsWith('.ts'))) {
      const canonical = readFileSync(join(canonicalDir, file), 'utf8');
      const vendoredPath = join(vendoredDir, file);
      expect(existsSync(vendoredPath), `missing vendored copy of ${file}`).toBe(true);
      expect(readFileSync(vendoredPath, 'utf8'), `sdk-ts/src/types/${file} drifted from packages/types/src/${file}`).toBe(canonical);
    }
  });
});
