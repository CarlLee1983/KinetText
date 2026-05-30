import { describe, expect, test } from 'bun:test'
import { buildM4BCommand } from '../src/core/utils/ffmpeg-commands'

describe('buildM4BCommand', () => {
  test('builds concat + ffmetadata args without cover', () => {
    const args = buildM4BCommand('/tmp/list.txt', '/tmp/meta.txt', '/out/vol01.m4b', 256)
    expect(args).toEqual([
      '-y',
      '-f', 'concat', '-safe', '0', '-i', '/tmp/list.txt',
      '-i', '/tmp/meta.txt',
      '-map_metadata', '1',
      '-map', '0:a',
      '-c:a', 'aac', '-b:a', '256k',
      '-movflags', '+faststart',
      '/out/vol01.m4b',
    ])
  })

  test('adds cover as attached_pic when coverPath given', () => {
    const args = buildM4BCommand('/tmp/list.txt', '/tmp/meta.txt', '/out/vol01.m4b', 192, '/c/cover.jpg')
    expect(args).toEqual([
      '-y',
      '-f', 'concat', '-safe', '0', '-i', '/tmp/list.txt',
      '-i', '/tmp/meta.txt',
      '-i', '/c/cover.jpg',
      '-map_metadata', '1',
      '-map', '0:a',
      '-map', '2:v', '-disposition:v:0', 'attached_pic', '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      '/out/vol01.m4b',
    ])
  })

  test('throws on out-of-range bitrate', () => {
    expect(() => buildM4BCommand('/l', '/m', '/o.m4b', 64)).toThrow(/Invalid bitrate/)
    expect(() => buildM4BCommand('/l', '/m', '/o.m4b', 400)).toThrow(/Invalid bitrate/)
  })
})
