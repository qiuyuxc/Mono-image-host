import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeCursor, deleteFile, detectImageType, formatSize, normalizeImageName, randomImage, telegramMessageGone, uploadFile } from '../works.js'

const webpBytes = () => new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])

const makeUploadConfig = () => ({
  tgBotToken: 'token',
  storageChatId: 'chat-id',
  domain: 'img.example.com',
  webUploadMaxMB: 20,
  database: {
    prepare: () => ({ bind: () => ({ run: async () => ({ meta: { last_row_id: 7 } }) }) })
  }
})

const uploadRequest = (name, bytes, type) => {
  const form = new FormData()
  form.append('file', new File([bytes], name, { type }))
  return new Request('https://img.example.com/api/files', { method: 'POST', body: form })
}

afterEach(() => vi.unstubAllGlobals())

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

describe('telegramMessageGone', () => {
  it('treats already-deleted Telegram messages as gone', () => {
    expect(telegramMessageGone({ ok: false, error_code: 400, description: 'Bad Request: message to delete not found' })).toBe(true)
    expect(telegramMessageGone({ ok: false, error_code: 400, description: "Bad Request: message can't be deleted for everyone" })).toBe(true)
    expect(telegramMessageGone({ ok: false, error_code: 400, description: 'Bad Request: message is too old to be deleted' })).toBe(true)
    expect(telegramMessageGone({ ok: false, error_code: 404, description: 'Not Found' })).toBe(true)
  })

  it('keeps genuine API failures as errors', () => {
    expect(telegramMessageGone(null)).toBe(false)
    expect(telegramMessageGone({ ok: false, error_code: 429, description: 'Too Many Requests: retry after 5' })).toBe(false)
    expect(telegramMessageGone({ ok: false, error_code: 403, description: 'Forbidden: bot was kicked from the group chat' })).toBe(false)
    expect(telegramMessageGone({ ok: false, error_code: 400, description: 'Bad Request: chat not found' })).toBe(false)
  })
})

describe('uploadFile', () => {
  it('stores the sticker file_id when Telegram returns a sticker for webp', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      result: { message_id: 42, sticker: { file_id: 'sticker-id', file_size: 1024 } }
    }), { status: 200 })))
    const result = await (await uploadFile(uploadRequest('sample.webp', webpBytes(), 'image/webp'), makeUploadConfig())).json()
    expect(result.file.url).toBe('https://img.example.com/dl/sticker-id')
    expect(result.file.file_size).toBe(1024)
    expect(result.file.id).toBe(7)
  })

  it('still uses the document file_id for regular uploads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      result: { message_id: 43, document: { file_id: 'doc-id', file_size: 2048 } }
    }), { status: 200 })))
    const result = await (await uploadFile(uploadRequest('sample.jpg', Uint8Array.from([0xff, 0xd8, 0xff, 0x01]), 'image/jpeg'), makeUploadConfig())).json()
    expect(result.file.url).toBe('https://img.example.com/dl/doc-id')
    expect(result.file.file_size).toBe(2048)
  })
})

describe('randomImage', () => {
  const makeConfig = (file, onSql) => ({
    database: {
      prepare: sql => {
        if (onSql) onSql(sql)
        return { first: async () => file }
      }
    }
  })
  const randomUrl = params => new URL(`https://img.example.com/random${params ? `?${params}` : ''}`)
  const sampleFile = { id: 1, url: 'https://img.example.com/dl/file-id', file_name: 'cat.jpg', file_size: 1536, mime_type: 'image/jpeg', width: 640, height: 480, created_at: 1_700_000_000_000 }

  it('redirects to a random image', async () => {
    const response = await randomImage(randomUrl(), makeConfig(sampleFile))
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('https://img.example.com/dl/file-id')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('returns image metadata as JSON when json flag is present', async () => {
    const response = await randomImage(randomUrl('json'), makeConfig(sampleFile))
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.url).toBe('https://img.example.com/dl/file-id')
    expect(data.file_name).toBe('cat.jpg')
    expect(data.sizeLabel).toBe('1.5 KB')
    expect(data.width).toBe(640)
  })

  it('filters landscape images only', async () => {
    let sql = ''
    const response = await randomImage(randomUrl('o=h'), makeConfig(sampleFile, query => { sql = query }))
    expect(response.status).toBe(302)
    expect(sql).toContain('width >= height')
  })

  it('filters portrait images and combines with the json flag', async () => {
    let sql = ''
    const response = await randomImage(randomUrl('o=v&json'), makeConfig(sampleFile, query => { sql = query }))
    expect(response.status).toBe(200)
    expect(sql).toContain('width <= height')
    const data = await response.json()
    expect(data.url).toBe('https://img.example.com/dl/file-id')
  })

  it('accepts uppercase orientation values', async () => {
    let sql = ''
    const response = await randomImage(randomUrl('o=H'), makeConfig(sampleFile, query => { sql = query }))
    expect(response.status).toBe(302)
    expect(sql).toContain('width >= height')
  })

  it('rejects unsupported orientation values', async () => {
    await expect(randomImage(randomUrl('o=square'), makeConfig(sampleFile))).rejects.toMatchObject({ status: 400 })
  })

  it('returns 404 when there are no images', async () => {
    await expect(randomImage(randomUrl(), makeConfig(null))).rejects.toMatchObject({ status: 404 })
  })
})

describe('deleteFile', () => {
  const makeDeleteConfig = onBatch => ({
    tgBotToken: 'token',
    database: {
      prepare: () => ({ bind: () => ({ first: async () => ({ id: 1, file_id: 'fid', message_id: 42, chat_id: 'chat' }) }) }),
      batch: async calls => onBatch(calls)
    }
  })

  it('removes the record when the message was already deleted in Telegram', async () => {
    let batchCalls = 0
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error_code: 400,
      description: 'Bad Request: message to delete not found'
    }), { status: 400 })))
    const response = await deleteFile(1, makeDeleteConfig(calls => { batchCalls = calls.length }))
    expect(batchCalls).toBe(2)
    expect(response.status).toBe(200)
  })

  it('keeps the record when Telegram deletion fails for a real reason', async () => {
    let batchCalls = 0
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error_code: 429,
      description: 'Too Many Requests: retry after 3'
    }), { status: 429 })))
    await expect(deleteFile(1, makeDeleteConfig(calls => { batchCalls = calls.length }))).rejects.toMatchObject({ status: 502 })
    expect(batchCalls).toBe(0)
  })
})
