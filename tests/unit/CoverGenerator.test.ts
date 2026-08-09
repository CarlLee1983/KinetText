import { test, expect } from 'bun:test'
import { CoverGenerator } from '../../src/core/services/CoverGenerator'

test('generateCover throws when font file is missing', async () => {
  const gen = new CoverGenerator()
  await expect(
    gen.generateCover({
      title: 'X',
      partLabel: 'part1',
      outPath: '/tmp/none.jpg',
      font: '/no/such/font.ttc',
    })
  ).rejects.toThrow(/字型/)
})
