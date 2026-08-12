import { ReactNode, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ColumnDef<T> = {
  id: string
  header: string
  cell: (row: T) => ReactNode
  /**
   * CSS width for fixed-size columns (e.g. '140px').
   * Omit for fluid columns — they share remaining space equally (flex: 1).
   */
  width?: string
  /** Provide a value to make this column sortable. */
  sortFn?: (row: T) => string | number
  align?: 'left' | 'right'
}

type Props<T> = {
  columns: ColumnDef<T>[]
  data: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  defaultSortId?: string
  defaultSortDesc?: boolean
  emptyState?: ReactNode
  /** Enable pagination with the given page size. Omit or set to 0 to show all rows. */
  pageSize?: number
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DataTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  defaultSortId,
  defaultSortDesc = true,
  emptyState,
  pageSize = 0
}: Props<T>) {
  const [sortId, setSortId] = useState<string | null>(defaultSortId ?? null)
  const [sortDesc, setSortDesc] = useState(defaultSortDesc)
  const [page, setPage] = useState(0)

  function handleHeaderClick(col: ColumnDef<T>) {
    if (!col.sortFn) return
    if (sortId === col.id) {
      setSortDesc((prev) => !prev)
    } else {
      setSortId(col.id)
      setSortDesc(true)
    }
    setPage(0)
  }

  const sorted = [...data].sort((a, b) => {
    const col = columns.find((c) => c.id === sortId)
    if (!col?.sortFn) return 0
    const av = col.sortFn(a)
    const bv = col.sortFn(b)
    if (av < bv) return sortDesc ? 1 : -1
    if (av > bv) return sortDesc ? -1 : 1
    return 0
  })

  // Pagination
  const paginated = pageSize > 0 ? sorted.slice(page * pageSize, (page + 1) * pageSize) : sorted
  const totalPages = pageSize > 0 ? Math.ceil(sorted.length / pageSize) : 1
  const showPagination = pageSize > 0 && totalPages > 1

  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center border-b border-border-subtle px-1 pb-2">
        {columns.map((col) => {
          const isSorted = sortId === col.id
          const canSort = !!col.sortFn
          return (
            <div
              key={col.id}
              onClick={() => handleHeaderClick(col)}
              className={[
                'flex items-center gap-1 px-3',
                canSort ? 'cursor-pointer select-none group/header' : '',
                col.align === 'right' ? 'justify-end' : 'justify-start'
              ].join(' ')}
              style={col.width ? { width: col.width, flexShrink: 0 } : { flex: 1, minWidth: 0 }}
            >
              <span className={[
                'text-[11px] font-medium uppercase tracking-wider transition-colors',
                isSorted ? 'text-fg-secondary' : 'text-fg-tertiary',
                canSort ? 'group-hover/header:text-fg-secondary' : ''
              ].join(' ')}>
                {col.header}
              </span>
              {canSort && (
                <span className={[
                  'shrink-0 transition-colors',
                  isSorted ? 'text-fg-secondary' : 'text-fg-tertiary opacity-0 group-hover/header:opacity-100'
                ].join(' ')}>
                  {isSorted
                    ? sortDesc
                      ? <ArrowDown size={11} />
                      : <ArrowUp size={11} />
                    : <ArrowUpDown size={11} />
                  }
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Rows */}
      <div>
        {paginated.map((row) => (
          <div
            key={rowKey(row)}
            onClick={() => onRowClick?.(row)}
            className={[
              'flex items-center border-b border-border-subtle last:border-b-0 px-1',
              'transition-colors duration-100',
              onRowClick ? 'cursor-pointer hover:bg-surface-hover' : ''
            ].join(' ')}
          >
            {columns.map((col) => (
              <div
                key={col.id}
                className={[
                  'px-3 py-3 min-w-0',
                  col.align === 'right' ? 'text-right' : ''
                ].join(' ')}
                style={col.width ? { width: col.width, flexShrink: 0 } : { flex: 1, minWidth: 0 }}
              >
                {col.cell(row)}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {showPagination && (
        <div className="flex items-center justify-between pt-3 px-1">
          <span className="text-[11px] text-fg-tertiary">
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex items-center justify-center w-7 h-7 rounded text-fg-secondary hover:text-fg hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-[11px] text-fg-tertiary px-1">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="flex items-center justify-center w-7 h-7 rounded text-fg-secondary hover:text-fg hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
