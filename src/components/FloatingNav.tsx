import { NavLink } from 'react-router'
import { Compass, LibraryBig, LogIn, Shield, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/features/auth/useAuth'

/**
 * Ilha flutuante com glass. Blur so aqui e em sheets (regra 5) — nunca em card
 * sobre card. Item ativo e pill solido, como nas referencias.
 *
 * Os itens mudam com o login: sem sessao, nao faz sentido oferecer "Campanhas"
 * para levar a uma tela de redirecionamento.
 */
export function FloatingNav() {
  const { session, role } = useAuth()

  const itens = session
    ? [
        { to: '/', label: 'Descobrir', Icon: Compass, end: true },
        { to: '/dashboard', label: 'Campanhas', Icon: LibraryBig, end: false },
        ...(role === 'master'
          ? [{ to: '/admin', label: 'Mestre', Icon: Shield, end: false }]
          : []),
        { to: '/perfil', label: 'Perfil', Icon: User, end: false },
      ]
    : [
        { to: '/', label: 'Descobrir', Icon: Compass, end: true },
        { to: '/entrar', label: 'Entrar', Icon: LogIn, end: false },
      ]

  return (
    <nav
      aria-label="Navegacao principal"
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="bg-surface-2/80 shadow-2 flex items-center gap-1 rounded-full p-2 backdrop-blur-xl">
        {itens.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'font-display text-ui-sm flex h-12 items-center gap-2 rounded-full px-4 font-medium',
                'transition-colors duration-150 ease-out',
                isActive
                  ? 'bg-primary text-on-primary'
                  : 'text-text-muted hover:text-text',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={20} strokeWidth={2} />
                <span className={cn(isActive ? 'inline' : 'hidden sm:inline')}>
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
