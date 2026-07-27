const SESSION_COOKIE = 'mono_session'
const encoder = new TextEncoder()

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const config = {
      tgBotToken: env.TG_BOT_TOKEN,
      database: env.DB,
      domain: env.DOMAIN || url.host,
      maxSizeMB: Number(env.MAX_SIZE_MB || 20),
      webUploadMaxMB: Number(env.WEB_UPLOAD_MAX_MB || 20),
      storageChatId: env.STORAGE_CHAT_ID,
      allowedUsers: (env.ALLOWED_USERS || '').split(',').map(value => value.trim()).filter(Boolean),
      sessionSecret: env.SESSION_SECRET,
      adminPassword: env.ADMIN_PASSWORD,
      sessionTtlHours: Number(env.SESSION_TTL_HOURS || 24)
    }

    if (url.pathname.startsWith('/dl/')) {
      return proxyTelegramFile(url.pathname.slice(4), config.tgBotToken, config.database)
    }

    if (url.pathname === '/webhook' && request.method === 'POST') {
      return handleWebhook(request, config, ctx)
    }

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, url, config)
    }

    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 })
  }
}

async function handleApi(request, url, config) {
  try {
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      return login(request, config)
    }
    if (url.pathname === '/api/session' && request.method === 'GET') {
      const session = await readSession(request, config)
      return json(session ? { authenticated: true, csrf: session.csrf } : { authenticated: false })
    }

    const session = await readSession(request, config)
    if (!session) return json({ error: '会话已过期，请重新登录。' }, 401)

    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      requireMutationAuth(request, session, url)
      return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() })
    }
    if (url.pathname === '/api/files' && request.method === 'GET') {
      return listFiles(url, config)
    }
    if (url.pathname === '/api/files' && request.method === 'POST') {
      requireMutationAuth(request, session, url)
      return uploadFile(request, config)
    }
    const deleteMatch = url.pathname.match(/^\/api\/files\/(\d+)$/)
    if (deleteMatch && request.method === 'DELETE') {
      requireMutationAuth(request, session, url)
      return deleteFile(Number(deleteMatch[1]), config)
    }
    return json({ error: '接口不存在。' }, 404)
  } catch (error) {
    console.error('API error:', error)
    return json({ error: error.message || '服务器无法完成请求。' }, error.status || 500)
  }
}

async function login(request, config) {
  if (!config.adminPassword || !config.sessionSecret) {
    return json({ error: '服务端尚未配置管理员凭据。' }, 503)
  }
  const url = new URL(request.url)
  requireSameOrigin(request, url)
  const key = request.headers.get('CF-Connecting-IP') || 'local'
  const attempt = await config.database.prepare('SELECT attempts, window_started_at FROM auth_attempts WHERE key = ?').bind(key).first()
  const now = Date.now()
  if (attempt && now - attempt.window_started_at < 15 * 60_000 && attempt.attempts >= 8) {
    return json({ error: '尝试次数过多，请稍后再试。' }, 429)
  }

  const body = await request.json().catch(() => ({}))
  if (!await safeEqual(String(body.password || ''), config.adminPassword)) {
    const attempts = attempt && now - attempt.window_started_at < 15 * 60_000 ? attempt.attempts + 1 : 1
    const started = attempt && now - attempt.window_started_at < 15 * 60_000 ? attempt.window_started_at : now
    await config.database.prepare('INSERT OR REPLACE INTO auth_attempts (key, attempts, window_started_at) VALUES (?, ?, ?)').bind(key, attempts, started).run()
    return json({ error: '密码不正确。' }, 401)
  }

  await config.database.prepare('DELETE FROM auth_attempts WHERE key = ?').bind(key).run()
  const csrf = randomToken()
  const expiresAt = now + config.sessionTtlHours * 3_600_000
  const token = await signSession({ exp: expiresAt, csrf }, config.sessionSecret)
  return json({ authenticated: true, csrf }, 200, { 'Set-Cookie': sessionCookie(token, config.sessionTtlHours) })
}

async function listFiles(url, config) {
  const limit = Math.min(40, Math.max(1, Number(url.searchParams.get('limit') || 24)))
  const cursor = decodeCursor(url.searchParams.get('cursor'))
  const query = cursor
    ? config.database.prepare('SELECT id, url, file_name, file_size, mime_type, width, height, created_at FROM files WHERE mime_type LIKE \'image/%\' AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?').bind(cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
    : config.database.prepare('SELECT id, url, file_name, file_size, mime_type, width, height, created_at FROM files WHERE mime_type LIKE \'image/%\' ORDER BY created_at DESC, id DESC LIMIT ?').bind(limit + 1)
  const result = await query.all()
  const rows = result.results || []
  const hasMore = rows.length > limit
  const files = rows.slice(0, limit)
  const last = files.at(-1)
  return json({
    files: files.map(file => ({ ...file, sizeLabel: formatSize(file.file_size) })),
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null
  })
}

async function uploadFile(request, config) {
  if (!config.tgBotToken || !config.storageChatId) throw httpError(503, '服务端尚未配置 Telegram 存储。')
  const contentLength = Number(request.headers.get('Content-Length') || 0)
  const maxBytes = config.webUploadMaxMB * 1024 * 1024
  if (contentLength > maxBytes + 1_000_000) throw httpError(413, `图片不能超过 ${config.webUploadMaxMB} MB。`)

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File) || !file.size) throw httpError(400, '请选择一张图片。')
  if (file.size > maxBytes) throw httpError(413, `图片不能超过 ${config.webUploadMaxMB} MB。`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mimeType = detectImageType(bytes)
  if (!mimeType) throw httpError(415, '仅支持 JPG、PNG、GIF 和 WebP 图片。')

  const fileName = normalizeImageName(file.name, mimeType)
  const formData = new FormData()
  formData.append('chat_id', config.storageChatId)
  formData.append('document', new Blob([bytes], { type: mimeType }), fileName)
  const response = await fetch(apiUrl(config.tgBotToken, 'sendDocument'), { method: 'POST', body: formData })
  const result = await response.json().catch(() => null)
  if (!response.ok || !result?.ok) throw httpError(502, 'Telegram 暂时无法保存这张图片。')

  const document = result.result.document
  const proxyUrl = `https://${config.domain}/dl/${document.file_id}`
  const uploadId = `web_${crypto.randomUUID()}`
  const width = positiveInt(form.get('width'))
  const height = positiveInt(form.get('height'))
  const createdAt = Date.now()
  const inserted = await config.database.prepare(
    'INSERT INTO files (url, file_id, message_id, file_name, file_size, mime_type, storage_type, category_id, chat_id, is_chunked, chunk_count, upload_id, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, 0, ?, ?, ?, ?)'
  ).bind(proxyUrl, document.file_id, result.result.message_id, fileName, document.file_size || file.size, mimeType, 'telegram', String(config.storageChatId), uploadId, width, height, createdAt).run()

  return json({
    file: {
      id: inserted.meta?.last_row_id,
      url: proxyUrl,
      file_name: fileName,
      file_size: document.file_size || file.size,
      sizeLabel: formatSize(document.file_size || file.size),
      mime_type: mimeType,
      width,
      height,
      created_at: createdAt
    }
  }, 201)
}

async function deleteFile(id, config) {
  const file = await config.database.prepare('SELECT id, file_id, message_id, chat_id FROM files WHERE id = ? LIMIT 1').bind(id).first()
  if (!file) throw httpError(404, '图片不存在或已被删除。')
  const response = await fetch(apiUrl(config.tgBotToken, 'deleteMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: file.chat_id, message_id: file.message_id })
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || !result?.ok) throw httpError(502, 'Telegram 删除失败，记录已保留，请稍后重试。')
  await config.database.batch([
    config.database.prepare('DELETE FROM file_path_cache WHERE file_id = ?').bind(file.file_id),
    config.database.prepare('DELETE FROM files WHERE id = ?').bind(id)
  ])
  return json({ ok: true })
}

function requireMutationAuth(request, session, url) {
  requireSameOrigin(request, url)
  if (!session.csrf || request.headers.get('X-CSRF-Token') !== session.csrf) {
    throw httpError(403, '安全校验失败，请刷新页面后重试。')
  }
}

function requireSameOrigin(request, url) {
  const origin = request.headers.get('Origin')
  if (origin && origin !== url.origin) throw httpError(403, '不允许跨站请求。')
}

async function readSession(request, config) {
  if (!config.sessionSecret) return null
  const cookies = parseCookies(request.headers.get('Cookie') || '')
  const token = cookies[SESSION_COOKIE]
  if (!token) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = await sign(payload, config.sessionSecret)
  if (!await safeEqual(signature, expected)) return null
  try {
    const session = JSON.parse(decodeBase64Url(payload))
    return session.exp > Date.now() ? session : null
  } catch {
    return null
  }
}

async function signSession(data, secret) {
  const payload = encodeBase64Url(JSON.stringify(data))
  return `${payload}.${await sign(payload, secret)}`
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return bytesToBase64Url(new Uint8Array(signature))
}

async function safeEqual(left, right) {
  const leftHash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(left)))
  const rightHash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(right)))
  let mismatch = 0
  for (let index = 0; index < leftHash.length; index++) mismatch |= leftHash[index] ^ rightHash[index]
  return mismatch === 0
}

function sessionCookie(token, hours) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.round(hours * 3600)}`
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
}

function parseCookies(header) {
  return Object.fromEntries(header.split(';').map(part => part.trim().split('=').map(decodeURIComponent)).filter(pair => pair.length === 2))
}

function randomToken() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

function bytesToBase64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function encodeBase64Url(value) {
  return bytesToBase64Url(encoder.encode(value))
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64)
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)))
}

function encodeCursor(createdAt, id) {
  return encodeBase64Url(JSON.stringify({ createdAt, id }))
}

function decodeCursor(value) {
  if (!value) return null
  try {
    const cursor = JSON.parse(decodeBase64Url(value))
    return Number.isFinite(cursor.createdAt) && Number.isFinite(cursor.id) ? cursor : null
  } catch {
    throw httpError(400, '分页游标无效。')
  }
}

function detectImageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (String.fromCharCode(...bytes.slice(0, 6)).startsWith('GIF8')) return 'image/gif'
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

function normalizeImageName(name, mimeType) {
  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }
  const clean = String(name || 'image').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120)
  const base = clean.replace(/\.[^.]+$/, '') || 'image'
  return `${base}.${extensions[mimeType]}`
}

function positiveInt(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  })
}

async function proxyTelegramFile(fileId, botToken, database) {
  if (!fileId || !botToken) return new Response('Not found', { status: 404 })
  const stored = await database.prepare('SELECT 1 FROM files WHERE file_id = ? LIMIT 1').bind(fileId).first()
  if (!stored) return new Response('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  })
  let filePath = ''
  try {
    const cached = await database.prepare('SELECT file_path FROM file_path_cache WHERE file_id = ? AND expires_at > ? LIMIT 1').bind(fileId, Date.now()).first()
    filePath = cached?.file_path || ''
  } catch (error) {
    console.warn('File path cache read failed:', error)
  }
  if (!filePath) {
    const response = await fetch(`${apiUrl(botToken, 'getFile')}?file_id=${encodeURIComponent(fileId)}`)
    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.ok || !result.result?.file_path) return new Response('Not found', { status: 404 })
    filePath = result.result.file_path
    try {
      await database.prepare('INSERT OR REPLACE INTO file_path_cache (file_id, file_path, expires_at) VALUES (?, ?, ?)').bind(fileId, filePath, Date.now() + 3_000_000).run()
    } catch (error) {
      console.warn('File path cache write failed:', error)
    }
  }
  const response = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`)
  if (!response.ok) return new Response('Not found', { status: 404 })
  const extension = filePath.includes('.') ? filePath.split('.').pop().toLowerCase() : ''
  const headers = new Headers(response.headers)
  headers.set('Content-Type', getContentType(extension))
  headers.set('Content-Disposition', 'inline')
  headers.set('Cache-Control', 'public, max-age=300, must-revalidate')
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox")
  return new Response(response.body, { headers })
}

async function handleWebhook(request, config, ctx) {
  const update = await request.json().catch(() => null)
  const message = update?.message
  if (!message) return new Response('OK')
  if (config.allowedUsers.length) {
    const userId = String(message.from?.id || '')
    const chatId = String(message.chat?.id || '')
    if (!config.allowedUsers.some(id => id === userId || id === chatId)) {
      await sendMessage(message.chat.id, '未授权，你没有使用此 Bot 的权限。', config.tgBotToken)
      return new Response('OK')
    }
  }
  const file = message.document || message.video || message.audio || message.photo?.at(-1) || message.voice || message.video_note
  if (file) ctx.waitUntil(storeWebhookFile(message.chat.id, message.message_id, file, config))
  return new Response('OK')
}

async function storeWebhookFile(chatId, messageId, file, config) {
  try {
    if (!file.file_id) return
    const response = await fetch(`${apiUrl(config.tgBotToken, 'getFile')}?file_id=${encodeURIComponent(file.file_id)}`)
    const result = await response.json()
    if (!result.ok || !result.result?.file_path) return
    const filePath = result.result.file_path
    const extension = filePath.includes('.') ? filePath.split('.').pop().toLowerCase() : 'bin'
    const mimeType = file.mime_type || getContentType(extension)
    const fileName = file.file_name || `telegram_${messageId}.${extension}`
    const url = `https://${config.domain}/dl/${file.file_id}`
    await config.database.prepare(
      'INSERT OR IGNORE INTO files (url, file_id, message_id, file_name, file_size, mime_type, storage_type, category_id, chat_id, is_chunked, chunk_count, upload_id, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, 0, ?, ?, ?, ?)'
    ).bind(url, file.file_id, messageId, fileName, result.result.file_size || file.file_size || 0, mimeType, 'telegram', String(chatId), `tg_${chatId}_${messageId}`, file.width || null, file.height || null, Date.now()).run()
    await sendMessage(chatId, `<b>已保存</b>\n\n${escapeHtml(fileName)}\n${url}`, config.tgBotToken)
  } catch (error) {
    console.error('Webhook upload error:', error)
    await sendMessage(chatId, `保存失败: ${escapeHtml(error.message)}`, config.tgBotToken)
  }
}

function apiUrl(token, method) {
  return `https://api.telegram.org/bot${token}/${method}`
}

async function sendMessage(chatId, text, token) {
  return fetch(apiUrl(token, 'sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  }).catch(() => null)
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character])
}

function formatSize(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`
}

export { decodeCursor, detectImageType, formatSize, normalizeImageName }

function getContentType(extension) {
  return {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', pdf: 'application/pdf',
    zip: 'application/zip', json: 'application/json', txt: 'text/plain'
  }[extension] || 'application/octet-stream'
}
