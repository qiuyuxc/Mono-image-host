import { Copy, Trash2 } from 'lucide-react'

export default function ImageItem({ file, index, onCopy, onDelete, canManage }) {
  const ratio = file.width && file.height ? `${file.width} / ${file.height}` : '4 / 3'
  return (
    <article className="gallery-item group relative mb-4 break-inside-avoid overflow-hidden rounded-md bg-surface" style={{ animationDelay: `${Math.min(index, 8) * 70}ms` }}>
      <img
        src={file.url}
        alt={file.file_name}
        width={file.width || 800}
        height={file.height || 600}
        loading="lazy"
        className="block h-auto w-full bg-surface object-cover"
        style={{ aspectRatio: ratio }}
      />
      <div className="image-actions absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/70 via-black/15 to-transparent px-3 pb-3 pt-14 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{file.file_name}</p>
          <p className="mt-0.5 text-xs text-white/70">{file.sizeLabel}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={() => onCopy(file.url)} aria-label={`复制 ${file.file_name} 的链接`} className="press flex size-10 items-center justify-center rounded-sm bg-black/35 text-white hover:bg-black/55 focus-visible:bg-black/55"><Copy size={16} /></button>
          {canManage && <button type="button" onClick={() => onDelete(file)} aria-label={`删除 ${file.file_name}`} className="press flex size-10 items-center justify-center rounded-sm bg-black/35 text-white hover:bg-danger focus-visible:bg-danger"><Trash2 size={16} /></button>}
        </div>
      </div>
    </article>
  )
}
