import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'

interface EstadoAuth {
  session: Session | null
  carregando: boolean
  /** Papel vindo de profiles. null enquanto nao carregou. */
  role: 'player' | 'master' | null
  entrarComEmail: (email: string) => Promise<void>
  sair: () => Promise<void>
}

const AuthContext = createContext<EstadoAuth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [role, setRole] = useState<'player' | 'master' | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setCarregando(false)
      return
    }
    const supabase = getSupabase()

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCarregando(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_evento, novaSessao) => {
      setSession(novaSessao)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // O papel decide se o painel do mestre aparece. Isto e UX: a autorizacao
  // real esta na policy do Postgres e na Edge Function.
  useEffect(() => {
    if (!session) {
      setRole(null)
      return
    }
    getSupabase()
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setRole((data?.role as 'player' | 'master') ?? 'player'))
  }, [session])

  async function entrarComEmail(email: string) {
    const supabase = getSupabase()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Volta para a rota de callback respeitando o base path do Pages.
        emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}entrar`,
      },
    })
    if (error) throw new Error(traduzirErroDeAuth(error.message))
  }

  async function sair() {
    await getSupabase().auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, carregando, role, entrarComEmail, sair }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): EstadoAuth {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa estar dentro de AuthProvider')
  return ctx
}

/**
 * O cadastro e por convite (allowlist). Quem nao esta na lista recebe um erro
 * cru do banco; melhor dizer o que aconteceu.
 */
function traduzirErroDeAuth(mensagem: string): string {
  if (/Cadastro restrito|Database error/i.test(mensagem)) {
    return 'Este email nao esta na lista de convidados. O acesso e por convite.'
  }
  if (/rate limit|too many/i.test(mensagem)) {
    return 'Muitas tentativas. Espere alguns minutos.'
  }
  return mensagem
}
