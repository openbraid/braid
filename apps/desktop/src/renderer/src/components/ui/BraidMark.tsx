interface Props {
  size?: number
  className?: string
}

export function BraidMark({ size = 24, className = '' }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 72 72"
      width={size}
      height={size}
      className={className}
    >
      <rect x="14" y="48" width="44" height="10" rx="5" fill="#C8674A" opacity="0.45" />
      <rect x="14" y="32" width="44" height="10" rx="5" fill="#C8674A" opacity="0.65" />
      <rect x="14" y="16" width="30" height="10" rx="5" fill="#C8674A" />
      <circle cx="53" cy="21" r="5" fill="#C8674A" opacity="0.7" />
    </svg>
  )
}
