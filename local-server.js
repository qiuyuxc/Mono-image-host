import { createServer } from 'node:http'
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const port = Number(process.env.LOCAL_API_PORT || 8787)
const password = process.env.ADMIN_PASSWORD || 'mono-local'
const secret = process.env.SESSION_SECRET || randomBytes(32).toString('hex')
const root = new URL('./local-data/', import.meta.url).pathname
const filesDirectory = join(root, 'files')
await mkdir(filesDirectory, { recursive: true })
const database = new DatabaseSync(join(root, 'mono.sqlite'))
database.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    storage_name TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS files_cursor ON files(created_at DESC, id DESC);
`)

const sessions = new Map()
const json = (response, data, status = 200, headers = {}) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  response.end(JSON.stringify(data))
}
const body = request => new Promise((resolve, reject) => {
  const chunks = []
  let size = 0
  request.on('data', chunk => {
    size += chunk.length
    if (size > 25 * 1024 * 1024) reject(Object.assign(new Error('图片不能超过 20 MB。'), { status: 413 }))
    else chunks.push(chunk)
  })
  request.on('end', () => resolve(Buffer.concat(chunks)))
  request.on('error', reject)
})
const cookies = request => Object.fromEntries(String(request.headers.cookie || '').split(';').map(value => value.trim().split('=')).filter(value => value.length === 2))
const signedSession = () => {
  const id = randomUUID()
  const csrf = randomBytes(24).toString('base64url')
  sessions.set(id, { csrf, expires: Date.now() + 86_400_000 })
  const signature = createHmac('sha256', secret).update(id).digest('base64url')
  return { token: `${id}.${signature}`, csrf }
}
const sessionFor = request => {
  const token = cookies(request).mono_local
  if (!token) return null
  const [id, signature] = token.split('.')
  if (!id || !signature) return null
  const expected = createHmac('sha256', secret).update(id).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  const session = sessions.get(id)
  return session?.expires > Date.now() ? { id, ...session } : null
}
const sameOrigin = request => !request.headers.origin || request.headers.origin === 'http://127.0.0.1:5173' || request.headers.origin === 'http://localhost:5173'
const requireMutation = (request, session) => sameOrigin(request) && request.headers['x-csrf-token'] === session.csrf
const detectImage = buffer => {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return ['image/jpeg', 'jpg']
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return ['image/png', 'png']
  if (buffer.subarray(0, 6).toString().startsWith('GIF8')) return ['image/gif', 'gif']
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return ['image/webp', 'webp']
  return null
}
const formatSize = bytes => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`
const boundaryParts = (buffer, boundary) => buffer.toString('latin1').split(`--${boundary}`).slice(1, -1).map(part => {
  const separator = part.indexOf('\r\n\r\n')
  const headers = part.slice(0, separator)
  const value = Buffer.from(part.slice(separator + 4).replace(/\r\n$/, ''), 'latin1')
  const name = headers.match(/name="([^"]+)"/)?.[1]
  const filename = headers.match(/filename="([^"]*)"/)?.[1]
  return { name, filename, value }
})

createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`)
  try {
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      if (!sameOrigin(request)) return json(response, { error: '不允许跨站请求。' }, 403)
      const payload = JSON.parse((await body(request)).toString() || '{}')
      if (payload.password !== password) return json(response, { error: '密码不正确。' }, 401)
      const session = signedSession()
      return json(response, { authenticated: true, csrf: session.csrf }, 200, { 'Set-Cookie': `mono_local=${session.token}; Path=/; HttpOnly; SameSite=Strict` })
    }
    const localFile = url.pathname.match(/^\/local-files\/([a-f0-9-]+\.(?:jpg|png|gif|webp))$/)
    if (localFile) {
      const content = await readFile(join(filesDirectory, localFile[1]))
      const types = { '.jpg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }
      response.writeHead(200, { 'Content-Type': types[extname(localFile[1])], 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' })
      return response.end(content)
    }
    const session = sessionFor(request)
    if (url.pathname === '/api/session') return json(response, session ? { authenticated: true, csrf: session.csrf } : { authenticated: false })
    if (!session) return json(response, { error: '会话已过期，请重新登录。' }, 401)
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      if (!requireMutation(request, session)) return json(response, { error: '安全校验失败。' }, 403)
      sessions.delete(session.id)
      return json(response, { ok: true }, 200, { 'Set-Cookie': 'mono_local=; Path=/; Max-Age=0' })
    }
    if (url.pathname === '/api/files' && request.method === 'GET') {
      const cursor = url.searchParams.get('cursor') ? JSON.parse(Buffer.from(url.searchParams.get('cursor'), 'base64url')) : null
      const rows = cursor
        ? database.prepare('SELECT * FROM files WHERE created_at < ? OR (created_at = ? AND id < ?) ORDER BY created_at DESC, id DESC LIMIT 25').all(cursor.createdAt, cursor.createdAt, cursor.id)
        : database.prepare('SELECT * FROM files ORDER BY created_at DESC, id DESC LIMIT 25').all()
      const hasMore = rows.length > 24
      const selected = rows.slice(0, 24).map(file => ({ ...file, sizeLabel: formatSize(file.file_size) }))
      const last = selected.at(-1)
      return json(response, { files: selected, nextCursor: hasMore ? Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id })).toString('base64url') : null })
    }
    if (url.pathname === '/api/files' && request.method === 'POST') {
      if (!requireMutation(request, session)) return json(response, { error: '安全校验失败。' }, 403)
      const boundary = request.headers['content-type']?.match(/boundary=(.+)$/)?.[1]
      if (!boundary) return json(response, { error: '上传格式无效。' }, 400)
      const parts = boundaryParts(await body(request), boundary)
      const upload = parts.find(part => part.name === 'file')
      const type = upload && detectImage(upload.value)
      if (!type) return json(response, { error: '仅支持 JPG、PNG、GIF 和 WebP 图片。' }, 415)
      const storageName = `${randomUUID()}.${type[1]}`
      await writeFile(join(filesDirectory, storageName), upload.value)
      const filename = String(upload.filename || `image.${type[1]}`).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120)
      const width = Number(parts.find(part => part.name === 'width')?.value.toString()) || null
      const height = Number(parts.find(part => part.name === 'height')?.value.toString()) || null
      const createdAt = Date.now()
      const result = database.prepare('INSERT INTO files (url, file_name, file_size, mime_type, width, height, storage_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(`/local-files/${storageName}`, filename, upload.value.length, type[0], width, height, storageName, createdAt)
      return json(response, { file: { id: Number(result.lastInsertRowid), url: `/local-files/${storageName}`, file_name: filename, file_size: upload.value.length, sizeLabel: formatSize(upload.value.length), mime_type: type[0], width, height, created_at: createdAt } }, 201)
    }
    const deleting = url.pathname.match(/^\/api\/files\/(\d+)$/)
    if (deleting && request.method === 'DELETE') {
      if (!requireMutation(request, session)) return json(response, { error: '安全校验失败。' }, 403)
      const file = database.prepare('SELECT storage_name FROM files WHERE id = ?').get(Number(deleting[1]))
      if (!file) return json(response, { error: '图片不存在或已被删除。' }, 404)
      await unlink(join(filesDirectory, file.storage_name))
      database.prepare('DELETE FROM files WHERE id = ?').run(Number(deleting[1]))
      return json(response, { ok: true })
    }
    return json(response, { error: '接口不存在。' }, 404)
  } catch (error) {
    console.error(error)
    return json(response, { error: error.message || '本地服务无法完成请求。' }, error.status || 500)
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Local API: http://127.0.0.1:${port}`)
  console.log(`Local password: ${password}`)
})
