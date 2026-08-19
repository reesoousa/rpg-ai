export type Theme = 'dark' | 'light' | 'system'

const STORAGE_KEY = 'rpg-ai:theme'

export function getStoredTheme(): Theme {
  const value = localStorage.getItem(STORAGE_KEY)
  return value === 'dark' || value === 'light' ? value : 'system'
}

/**
 * `system` remove o atributo e deixa o CSS decidir por prefers-color-scheme.
 * Uma escolha explicita vence a preferencia do sistema nas duas direcoes.
 */
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') {
    root.removeAttribute('data-theme')
    localStorage.removeItem(STORAGE_KEY)
    return
  }
  root.setAttribute('data-theme', theme)
  localStorage.setItem(STORAGE_KEY, theme)
}

export function initTheme() {
  applyTheme(getStoredTheme())
}
