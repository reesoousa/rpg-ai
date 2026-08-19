import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'gradient' | 'subtle' | 'ghost'
type Size = 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children?: ReactNode
}

/**
 * Escrito a mao em vez de vir do shadcn/ui: os componentes gerados nascem com
 * `border`, e a regra 1 do DESIGN.md proibe contorno hairline. Aqui a
 * separacao vem de superficie e sombra.
 */
const variants: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover shadow-1',
  gradient: 'gradient-accent text-white shadow-2',
  subtle: 'bg-surface-1 text-text hover:bg-surface-2 shadow-1',
  ghost: 'bg-transparent text-text-muted hover:text-text',
}

const sizes: Record<Size, string> = {
  // 44px: alvo de toque minimo.
  md: 'h-11 px-5 text-ui',
  // 56px: acao principal, alcancavel com uma mao.
  lg: 'h-14 px-6 text-ui',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'font-display inline-flex items-center justify-center gap-2 rounded-full font-medium',
        'transition-colors duration-150 ease-out',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  )
}
