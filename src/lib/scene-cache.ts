/**
 * Cache de imagens de cena no IndexedDB.
 *
 * As imagens nao ficam no Supabase — o plano free da 1 GB de Storage e cada
 * cena come 200-400 KB. Elas vivem aqui, no dispositivo do jogador.
 *
 * Consequencia que a UI precisa deixar clara: trocar de aparelho ou limpar o
 * cache do navegador perde as imagens. O prompt fica no banco, então regerar e
 * possivel — mas gasta quota.
 *
 * localStorage nao serviria: guarda string e tem limite de ~5 MB. IndexedDB
 * guarda Blob e tem folga de ordens de grandeza.
 */

const DB_NOME = 'rpg-ai-cenas'
const DB_VERSAO = 1
const STORE = 'cenas'

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOME, DB_VERSAO)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        // chave: `${campaignId}:${seq}` — uma cena por turno
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function chave(campaignId: string, seq: number): string {
  return `${campaignId}:${seq}`
}

export interface CenaGuardada {
  blob: Blob
  prompt: string
  geradaEm: number
}

/** Modo privado e cotas cheias fazem o IndexedDB falhar; nunca deixe quebrar o jogo. */
async function comBanco<T>(fn: (db: IDBDatabase) => Promise<T>, padrao: T): Promise<T> {
  try {
    const db = await abrir()
    const r = await fn(db)
    db.close()
    return r
  } catch (e) {
    console.warn('cache de cenas indisponivel', e)
    return padrao
  }
}

export function guardarCena(
  campaignId: string,
  seq: number,
  cena: CenaGuardada,
): Promise<boolean> {
  return comBanco(async (db) => {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(cena, chave(campaignId, seq))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    return true
  }, false)
}

export function lerCena(campaignId: string, seq: number): Promise<CenaGuardada | null> {
  return comBanco(async (db) => {
    return await new Promise<CenaGuardada | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(chave(campaignId, seq))
      req.onsuccess = () => resolve((req.result as CenaGuardada) ?? null)
      req.onerror = () => reject(req.error)
    })
  }, null)
}

export function apagarCenasDaCampanha(campaignId: string): Promise<boolean> {
  return comBanco(async (db) => {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const req = store.openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) return
        if (String(cursor.key).startsWith(`${campaignId}:`)) cursor.delete()
        cursor.continue()
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    return true
  }, false)
}

/** Converte o base64 que a Edge Function devolve em Blob para guardar. */
export function base64ParaBlob(base64: string, mimeType: string): Blob {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}
