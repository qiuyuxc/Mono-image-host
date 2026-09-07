import { useState } from 'react'
import { ArrowRight, LockKeyhole } from 'lucide-react'

export default function Login({ onLogin, onCancel }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async event => {
    event.preventDefault()
    if (!password) return setError('请输入管理密码。')
    setBusy(true)
    setError('')
    try {
      await onLogin(password)
    } catch (nextError) {
      setError(nextError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main id="main-content" className="min-h-screen px-5 py-6 sm:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-[1400px] flex-col">
        <header className="flex h-12 items-center justify-between border-b border-ink/10">
          <a href="/" className="text-[15px] font-semibold tracking-[-0.01em]">Mono</a>
          {onCancel ? (
            <button type="button" onClick={onCancel} className="text-xs text-muted hover:text-ink">返回画廊</button>
          ) : (
            <span className="flex items-center gap-2 text-xs text-muted"><LockKeyhole size={14} />私人空间</span>
          )}
        </header>
        <section className="grid flex-1 items-center py-16 lg:grid-cols-[1.15fr_0.85fr] lg:gap-24">
          <div className="max-w-2xl">
            <p className="mb-5 text-xs font-medium uppercase tracking-[0.18em] text-muted">Private image archive</p>
            <h1 className="max-w-xl text-balance text-[clamp(3.25rem,8vw,7.5rem)] font-medium leading-[0.98] tracking-[-0.035em]">
              图片，<br />安静地保存。
            </h1>
          </div>
          <form onSubmit={submit} className="mt-16 border-t border-ink/15 pt-7 lg:mt-0" noValidate>
            <label htmlFor="password" className="mb-3 block text-sm font-medium">管理密码</label>
            <div className="flex border-b border-ink pb-2 focus-within:border-success">
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                className="min-w-0 flex-1 bg-transparent py-2 text-lg outline-none placeholder:text-muted/60"
                placeholder="输入密码"
                aria-describedby={error ? 'login-error' : undefined}
                autoFocus
              />
              <button aria-label="登录" disabled={busy} className="press flex size-11 items-center justify-center rounded-sm bg-ink text-canvas disabled:opacity-45">
                <ArrowRight size={18} />
              </button>
            </div>
            <div className="h-10 pt-3 text-sm text-danger" id="login-error" role="alert">{error}</div>
            <p className="mt-7 max-w-sm text-sm leading-7 text-muted">此空间仅对持有管理密码的人开放。图片将通过你的私人 Telegram 存储。</p>
          </form>
        </section>
      </div>
    </main>
  )
}
