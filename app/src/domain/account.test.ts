import { describe, expect, it } from 'vitest'
import { isMarketCacheKey, passwordError, validatePassword } from './account'

describe('account', () => {
  it('controlli sulla nuova password', () => {
    const ok = { current: 'vecchia123', next: 'nuova12345', repeat: 'nuova12345' }
    expect(validatePassword(ok)).toBeNull()
    expect(validatePassword({ ...ok, current: '' })).toMatch(/attuale/)
    expect(validatePassword({ ...ok, next: 'corta', repeat: 'corta' })).toMatch(/8 caratteri/)
    expect(validatePassword({ ...ok, repeat: 'altra12345' })).toMatch(/coincidono/)
    expect(validatePassword({ current: 'stessa123', next: 'stessa123', repeat: 'stessa123' })).toMatch(/uguale/)
    expect(passwordError('auth/invalid-credential')).toMatch(/non è giusta/)
  })

  it('svuota solo la cache dei dati di mercato, non le preferenze', () => {
    expect(['ptpro_v2_quotes_3', 'ptpro_v2_fx', 'ptpro_v2_fx_monthly', 'ptpro_v2_dividends'].every(isMarketCacheKey)).toBe(true)
    expect(['ptpro_v2_selected_portfolio', 'ptpro_v2_view_positionsSort', 'ptpro_theme', 'gemini_api_key', 'ptpro_v2_ai_analysis_P1'].some(isMarketCacheKey)).toBe(false)
  })
})
