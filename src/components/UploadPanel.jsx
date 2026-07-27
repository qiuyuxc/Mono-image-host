import { useRef, useState } from 'react'
import { Check, ImagePlus, LoaderCircle, X } from 'lucide-react'

const MAX_BYTES = 20 * 1024 * 1024
const ACCEPTED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

const dimensionsFor = file => new Promise(resolve => {
  const image = new Image()
  image.onload = () => {
    resolve({ width: image.naturalWidth, height: image.naturalHeight })
    URL.revokeObjectURL(image.src)
  }
  image.onerror = () => resolve({})
  image.src = URL.createObjectURL(file)
})

export default function UploadPanel({ onUpload }) {
  const input = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [queue, setQueue] = useState([])

  const process = async selected => {
    const files = [...selected]
    const entries = files.map(file => ({ key: crypto.randomUUID(), file, status: 'waiting', error: '' }))
    setQueue(current => [...entries, ...current].slice(0, 8))
    for (const entry of entries) {
      if (!ACCEPTED.includes(entry.file.type) || entry.file.size > MAX_BYTES) {
        setQueue(current => current.map(item => item.key === entry.key ? { ...item, status: 'error', error: entry.file.size > MAX_BYTES ? '超过 20 MB' : '格式不支持' } : item))
        continue
      }
      setQueue(current => current.map(item => item.key === entry.key ? { ...item, status: 'uploading' } : item))
      try {
        await onUpload(entry.file, await dimensionsFor(entry.file))
        setQueue(current => current.map(item => item.key === entry.key ? { ...item, status: 'done' } : item))
      } catch (error) {
        setQueue(current => current.map(item => item.key === entry.key ? { ...item, status: 'error', error: error.message } : item))
      }
    }
  }

  const drop = event => {
    event.preventDefault()
    setDragging(false)
    if (event.dataTransfer.files.length) process(event.dataTransfer.files)
  }

  return (
    <section aria-labelledby="upload-title" className="border-y border-ink/10 py-5 sm:py-7">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragEnter={event => { event.preventDefault(); setDragging(true) }}
        onDragOver={event => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        className={`upload-zone group flex min-h-36 w-full items-center justify-between rounded-md border border-dashed px-5 text-left sm:px-7 ${dragging ? 'is-dragging' : ''}`}
      >
        <span>
          <span id="upload-title" className="block text-xl font-medium tracking-[-0.012em] sm:text-2xl">放入新的图片</span>
          <span className="mt-2 block text-sm text-muted">JPG、PNG、GIF 或 WebP，单张不超过 20 MB</span>
        </span>
        <span className="press flex size-12 shrink-0 items-center justify-center rounded-sm bg-ink text-canvas"><ImagePlus size={19} /></span>
      </button>
      <input ref={input} type="file" accept={ACCEPTED.join(',')} multiple hidden onChange={event => process(event.target.files)} />
      {queue.length > 0 && (
        <div className="mt-3 divide-y divide-ink/8" aria-live="polite">
          {queue.map(item => (
            <div key={item.key} className="flex min-h-11 items-center gap-3 py-2 text-sm">
              {item.status === 'uploading' && <LoaderCircle size={15} className="animate-spin text-muted" />}
              {item.status === 'waiting' && <span className="size-[15px] rounded-full border border-ink/20" />}
              {item.status === 'done' && <Check size={15} className="text-success" />}
              {item.status === 'error' && <X size={15} className="text-danger" />}
              <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
              <span className={item.status === 'error' ? 'text-danger' : 'text-muted'}>{item.error || ({ waiting: '等待', uploading: '上传中', done: '已保存' }[item.status])}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
