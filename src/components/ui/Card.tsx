import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * Sem borda (regra 1). Em dark a separacao vem da luminancia da superficie
 * (1.24 de contraste vs fundo); em light, da sombra — la o card branco sobre
 * o fundo da apenas 1.06 e seria invisivel.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('bg-surface-1 rounded-card shadow-1 p-5', className)} {...props} />
  )
}
