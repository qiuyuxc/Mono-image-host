import { describe, expect, it } from 'vitest'
import { decodeCursor, detectImageType, formatSize, normalizeImageName } from '../works.js'

describe('worker helpers', () => {
  it('detects supported image signatures', () => {
    expect(detectImageType(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe('image/jpeg')
    expect(detectImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png')
    expect(detectImageType(new TextEncoder().encode('plain text'))).toBeNull()
  })

  it('normalizes file names to their verified type', () => {
    expect(normalizeImageName('旅行<script>.png', 'image/jpeg')).toBe('旅行_script_.jpg')
  })

  it('formats storage sizes', () => {
    expect(formatSize(1536)).toBe('1.5 KB')
  })

  it('rejects malformed cursors', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow('分页游标无效')
  })
})
