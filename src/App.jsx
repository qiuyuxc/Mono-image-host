import { useCallback, useEffect, useState } from 'react'
import { LogOut } from 'lucide-react'
import { api } from './lib/api'
import Login from './components/Login'
import UploadPanel from './components/UploadPanel'
import Gallery from './components/Gallery'
import DeleteConfirm from './components/DeleteConfirm'

export default function App() {
  const [session, setSession] = useState(null)
  const [files, setFiles] = useState([])
  const [cursor, setCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [deleting, setDeleting] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  useEffect(() => {
    api.session().then(data => setSession(data.authenticated ? data : false)).catch(() => setSession(false)).finally(() => setLoading(false))
  }, [])

  const loadFiles = useCallback(async (reset, currentCursor = null) => {
    setLoading(true)
    try {
      const data = await api.files(reset ? null : currentCursor)
      setFiles(current => reset ? data.files : [...current, ...data.files])
      setCursor(data.nextCursor)
    } catch (error) {
      setNotice(error.message)
      if (error.status === 401) setSession(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session?.authenticated) {
      const timer = window.setTimeout(() => loadFiles(true), 0)
      return () => window.clearTimeout(timer)
    }
  }, [session, loadFiles])

  const handleExpired = error => {
    if (error.status === 401) {
      setSession(false)
      setFiles([])
    }
    throw error
  }

  const login = async password => setSession(await api.login(password))

  const logout = async () => {
    try { await api.logout(session.csrf) } finally { setSession(false); setFiles([]) }
  }

  const upload = async (file, dimensions) => {
    try {
      const data = await api.upload(file, dimensions, session.csrf)
      setFiles(current => [data.file, ...current])
      setNotice(`${file.name} 已保存`)
      return data
    } catch (error) {
      handleExpired(error)
    }
  }

  const copy = async url => {
    try {
      await navigator.clipboard.writeText(url)
      setNotice('直链已复制')
    } catch {
      setNotice('无法访问剪贴板，请手动复制链接。')
    }
  }

  const remove = async () => {
    setDeleteBusy(true)
    try {
      await api.remove(deleting.id, session.csrf)
      setFiles(current => current.filter(file => file.id !== deleting.id))
      setNotice(`${deleting.file_name} 已永久删除`)
      setDeleting(null)
    } catch (error) {
      setNotice(error.message)
      if (error.status === 401) setSession(false)
    } finally {
      setDeleteBusy(false)
    }
  }

  if (session === null) return <main className="grid min-h-screen place-items-center text-sm text-muted">正在打开私人空间…</main>
  if (!session) return <Login onLogin={login} />

  return (
    <>
      <a href="#main-content" className="skip-link">跳到主要内容</a>
      <div className="min-h-screen px-4 pb-safe sm:px-7 lg:px-10">
        <header className="sticky top-0 z-30 mx-auto flex h-16 max-w-[1600px] items-center justify-between border-b border-ink/10 bg-canvas/95">
          <a href="/" className="text-[15px] font-semibold tracking-[-0.01em]">Mono</a>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted sm:block">私人图库</span>
            <button type="button" onClick={logout} aria-label="退出登录" className="press flex size-10 items-center justify-center rounded-sm hover:bg-surface"><LogOut size={17} /></button>
          </div>
        </header>
        <main id="main-content" className="mx-auto max-w-[1600px]">
          <section className="flex items-end justify-between gap-6 pb-8 pt-12 sm:pb-10 sm:pt-16">
            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-muted">Image archive</p>
              <h1 className="text-4xl font-medium tracking-[-0.035em] sm:text-6xl">你的图片</h1>
            </div>
            <p className="hidden max-w-xs text-right text-sm leading-6 text-muted md:block">上传、复制直链，或永久移除。图片本身是这里唯一需要被看见的内容。</p>
          </section>
          <UploadPanel onUpload={upload} />
          <Gallery files={files} loading={loading} nextCursor={cursor} onLoadMore={() => loadFiles(false, cursor)} onCopy={copy} onDelete={setDeleting} />
        </main>
      </div>
      <div className={`notice ${notice ? 'is-visible' : ''}`} role="status" aria-live="polite" onTransitionEnd={() => notice && setTimeout(() => setNotice(''), 1800)}>{notice}</div>
      <DeleteConfirm file={deleting} busy={deleteBusy} onCancel={() => setDeleting(null)} onConfirm={remove} />
    </>
  )
}
