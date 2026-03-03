const RATE_CACHE_KEY = 'ptpro_fx_history';
const FX_TTL = 24 * 60 * 60 * 1000; // 24 ore

export const Exchange = {
    rate: 1.08,

    async update() {
        try {
            const r = await fetch('https://open.er-api.com/v6/latest/EUR');
            const d = await r.json();
            if (d.result === 'success') {
                this.rate = d.rates.USD;
                return true;
            }
        } catch (e) {}
        return false;
    },

    convert(value, from, to) {
        if (from === to) return value;
        return from === 'EUR' ? value * this.rate : value / this.rate;
    },

    // Restituisce tasso EUR/USD per una data specifica (YYYY-MM-DD)
    async getRateForDate(dateStr) {
        const cache = this._loadFxCache();
        if (cache[dateStr]) return cache[dateStr];
        try {
            const r = await fetch(`https://open.er-api.com/v6/history/period/${dateStr}/${dateStr}?base=EUR`);
            const d = await r.json();
            const rate = d?.rates?.[dateStr]?.USD ?? this.rate;
            cache[dateStr] = rate;
            this._saveFxCache(cache);
            return rate;
        } catch (e) {
            return this.rate; // fallback tasso attuale
        }
    },

    // Calcola tasso medio ponderato alla data di acquisto per una lista di transazioni
    async getWeightedHistoricRate(transactions, fromCurrency, toCurrency) {
        if (fromCurrency === toCurrency) return 1;
        const buys = (transactions || []).filter(t => t.type === 'buy');
        if (!buys.length) return this.rate;

        let totalQty = 0, weightedRate = 0;
        await Promise.all(buys.map(async tx => {
            const rate = await this.getRateForDate(tx.date);
            totalQty    += +tx.qty;
            weightedRate += rate * +tx.qty;
        }));
        return totalQty > 0 ? weightedRate / totalQty : this.rate;
    },

    _loadFxCache() {
        try {
            const raw = localStorage.getItem(RATE_CACHE_KEY);
            if (!raw) return {};
            const { data, ts } = JSON.parse(raw);
            if (Date.now() - ts > FX_TTL) return {};
            return data || {};
        } catch (e) { return {}; }
    },

    _saveFxCache(data) {
        try {
            localStorage.setItem(RATE_CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
        } catch (e) {}
    }
};
