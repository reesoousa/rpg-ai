import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '@/features/auth/useAuth'

/**
 * Guard de rota. E UX, nao seguranca: quem forjar a rota nao ve dado nenhum,
 * porque RLS e as Edge Functions decidem no servidor.
 */
export function RequireAuth({ exigirMestre = false }: { exigirMestre?: boolean }) {
  const { session, carregando, role } = useAuth()
  const local = useLocation()

  if (carregando) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="bg-surface-1 h-6 w-40 animate-pulse rounded-full" />
        <div className="bg-surface-1 h-24 animate-pulse rounded-card" />
      </div>
    )
  }

  if (!session) return <Navigate to="/entrar" state={{ de: local.pathname }} replace />

  if (exigirMestre) {
    if (role === null) {
      return <div className="bg-surface-1 h-24 animate-pulse rounded-card" aria-busy="true" />
    }
    if (role !== 'master') {
      return (
        <div className="space-y-3">
          <h1 className="text-title">Area do mestre</h1>
          <p className="text-text-muted text-ui">
            Sua conta nao tem acesso a esta area.
          </p>
        </div>
      )
    }
  }

  return <Outlet />
}
