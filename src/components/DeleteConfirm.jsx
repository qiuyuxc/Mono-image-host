import { X } from 'lucide-react'

export default function DeleteConfirm({ file, busy, onCancel, onConfirm }) {
  if (!file) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-ink/35 p-3 sm:place-items-center" onMouseDown={event => event.target === event.currentTarget && onCancel()}>
      <section role="dialog" aria-modal="true" aria-labelledby="delete-title" className="w-full max-w-md rounded-lg bg-canvas p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-danger">永久操作</p>
            <h2 id="delete-title" className="mt-2 text-2xl font-medium tracking-[-0.012em]">删除这张图片？</h2>
          </div>
          <button type="button" onClick={onCancel} aria-label="关闭" className="press flex size-10 items-center justify-center rounded-sm hover:bg-surface"><X size={18} /></button>
        </div>
        <p className="mt-5 break-words text-sm leading-7 text-muted"><strong className="font-medium text-ink">{file.file_name}</strong> 将从 Telegram 存储和画廊中彻底移除，现有直链会立即失效，无法恢复。</p>
        <div className="mt-7 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="press min-h-11 rounded-sm px-4 text-sm font-medium hover:bg-surface">取消</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="press min-h-11 rounded-sm bg-danger px-4 text-sm font-medium text-white disabled:opacity-45">{busy ? '正在删除' : '永久删除'}</button>
        </div>
      </section>
    </div>
  )
}
