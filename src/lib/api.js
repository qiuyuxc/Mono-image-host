const request = async (path, options = {}) => {
  const response = await fetch(path, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || '请求失败，请稍后重试。')
    error.status = response.status
    throw error
  }
  return data
}

export const api = {
  session: () => request('/api/session'),
  login: password => request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  }),
  logout: csrf => request('/api/auth/logout', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrf }
  }),
  files: cursor => request(`/api/files?limit=24${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  upload: (file, dimensions, csrf) => {
    const body = new FormData()
    body.append('file', file)
    if (dimensions.width) body.append('width', dimensions.width)
    if (dimensions.height) body.append('height', dimensions.height)
    return request('/api/files', { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body })
  },
  remove: (id, csrf) => request(`/api/files/${id}`, {
    method: 'DELETE',
    headers: { 'X-CSRF-Token': csrf }
  })
}
