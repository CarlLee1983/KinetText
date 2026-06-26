#!/usr/bin/env bun
/**
 * YouTube upload wrapper: forces H.264 + AAC MP4 output.
 * Equivalent to: bun run to-mp4 --youtube ...
 */
process.argv.splice(2, 0, '--youtube')
await import('./mp3_to_mp4.ts')
