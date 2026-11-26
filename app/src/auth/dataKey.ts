import { createContext, useContext } from 'react'

/**
 * Chiave dei dati dell'utente collegato.
 * null = dati in chiaro (l'amministratore: la sincronizzazione IBKR e il sito vecchio leggono i suoi dati).
 */
export const DataKeyContext = createContext<CryptoKey | null>(null)

export const useDataKey = () => useContext(DataKeyContext)

/** Dove sta la busta con la chiave dei dati. */
export const envelopePath = (uid: string) => `users/${uid}/crypto`
