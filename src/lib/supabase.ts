import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Permite o app subir antes das credenciais existirem. Telas que dependem de
 * dados checam isso e mostram um aviso, em vez de a aplicacao morrer no import.
 */
export const isSupabaseConfigured = Boolean(url && anonKey)

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase nao configurado. Copie .env.example para .env e preencha ' +
        'VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.',
    )
  }
  client ??= createClient(url, anonKey, {
    auth: {
      // PKCE devolve o codigo em ?code=, nao no fragmento. E o que funciona
      // em GitHub Pages sem servidor proprio.
      flowType: 'pkce',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  })
  return client
}
