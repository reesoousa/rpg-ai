import { useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { applyTheme, getStoredTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'

const options: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Tema claro', Icon: Sun },
  { value: 'dark', label: 'Tema escuro', Icon: Moon },
  { value: 'system', label: 'Seguir o sistema', Icon: Monitor },
]

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme())

  function select(next: Theme) {
    applyTheme(next)
    setTheme(next)
  }

  return (
    <div className="bg-surface-sunken flex items-center gap-1 rounded-full p-1">
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={theme === value}
          onClick={() => select(value)}
          className={cn(
            'grid h-9 w-9 place-items-center rounded-full transition-colors duration-150 ease-out',
            // Item ativo e pill solido, nao box tonal de baixa opacidade (regra 2).
            theme === value
              ? 'bg-primary text-on-primary'
              : 'text-text-muted hover:text-text',
          )}
        >
          <Icon size={17} strokeWidth={2} />
        </button>
      ))}
    </div>
  )
}
