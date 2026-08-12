type Props = { keys: string[] }

export function KeyBadge({ keys }: Props) {
  return (
    <div className="flex items-center gap-1">
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 text-[11px] font-medium text-fg-secondary bg-surface border border-border rounded shadow-[0_1px_0_0] shadow-border"
        >
          {k}
        </kbd>
      ))}
    </div>
  )
}
