import ImageItem from './ImageItem'

export default function Gallery({ files, loading, nextCursor, onLoadMore, onCopy, onDelete, canManage }) {
  if (!loading && files.length === 0) {
    return (
      <section className="grid min-h-[42vh] place-items-center py-24 text-center">
        <div>
          <p className="text-2xl font-medium tracking-[-0.012em]">这里还没有图片</p>
          <p className="mt-3 text-sm text-muted">从上方放入第一张，画廊会从这里开始。</p>
        </div>
      </section>
    )
  }

  return (
    <section aria-label="图片画廊" className="py-5 sm:py-7">
      <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 2xl:columns-4">
        {files.map((file, index) => <ImageItem key={file.id} file={file} index={index} onCopy={onCopy} onDelete={onDelete} canManage={canManage} />)}
      </div>
      {loading && <p className="py-12 text-center text-sm text-muted" role="status">正在整理图片…</p>}
      {nextCursor && !loading && (
        <div className="flex justify-center py-10">
          <button type="button" onClick={onLoadMore} className="press min-h-11 rounded-sm border border-ink/20 px-5 text-sm font-medium hover:bg-ink hover:text-canvas">加载更早的图片</button>
        </div>
      )}
    </section>
  )
}
