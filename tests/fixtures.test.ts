import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('sample fixtures', () => {
  it('contains ten projects and six overlaps', () => {
    const projects = JSON.parse(readFileSync(resolve(process.cwd(), 'data/fixtures/projects.geojson'), 'utf8'));
    const overlaps = JSON.parse(readFileSync(resolve(process.cwd(), 'data/fixtures/overlaps.json'), 'utf8'));

    expect(projects.features).toHaveLength(10);
    expect(overlaps).toHaveLength(6);
  });
});
