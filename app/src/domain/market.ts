// Indicatori di mercato: soglia del VIX e stato del mercato. Funzioni pure.

/** Soglia di attenzione del VIX scelta da Andrea. */
export const VIX_ALERT = 25

/** Stato del mercato secondo il VIX: sotto 20 calmo, fino alla soglia nervoso, oltre paura. */
export function vixStatus(v: number): { key: 'good' | 'warning' | 'critical'; label: string } {
  if (v >= VIX_ALERT) return { key: 'critical', label: 'paura' }
  if (v >= 20) return { key: 'warning', label: 'nervoso' }
  return { key: 'good', label: 'calmo' }
}
