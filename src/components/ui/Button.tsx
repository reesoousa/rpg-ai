import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'gradient' | 'subtle' | 'ghost'
type Size = 'md' | 'lg'

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

const base = cn(
  'font-display inline-flex items-center justify-center gap-2 rounded-full font-medium',
  'transition-colors duration-150 ease-out',
  'disabled:pointer-events-none disabled:opacity-50',
)

export function estilosDeBotao(variant: Variant = 'primary', size: Size = 'md'): string {
  return cn(base, variants[variant], sizes[size])
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  return <button className={cn(estilosDeBotao(variant, size), className)} {...props} />
}

/**
 * Mesmo visual, mas navega. Existe porque `<Link>` dentro de `<button>` e HTML
 * invalido — e porque um alvo de navegacao deve ser uma ancora, para abrir em
 * nova aba e aparecer no menu de contexto como o usuario espera.
 */
export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: LinkProps & { variant?: Variant; size?: Size }) {
  return <Link className={cn(estilosDeBotao(variant, size), className)} {...props} />
}
