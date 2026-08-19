import { Card } from '@/components/ui/Card'

/** Marca uma area ainda nao construida, sem fingir que existe. */
export function PagePlaceholder({
  title,
  planned,
}: {
  title: string
  planned: string[]
}) {
  return (
    <div className="space-y-5">
      <h1 className="text-display">{title}</h1>
      <Card>
        <p className="text-text-muted text-ui">Ainda nao construido. Vai conter:</p>
        <ul className="mt-3 space-y-2">
          {planned.map((item) => (
            <li key={item} className="text-ui flex gap-2">
              <span className="text-accent-text font-mono">—</span>
              {item}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
