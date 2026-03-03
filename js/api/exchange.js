const RATE_CACHE_KEY = 'ptpro_fx_history';
const FX_TTL = 24 * 60 * 60 * 1000;

const LATEST_PROXIES = [
    `https://corsproxy.io/?${encodeURIComponent('https://open.er-api.com/v6/latest/EUR')}`,
    `https://api.allorigins.win/get?url=${encodeURIComponent('https://open.er-api.com/v6/latest/EUR')}`,
];

export const Exchange = {
    rate: 1.08,

    async update() {
        for (let i = 0; i < LATEST_PROXIES.length; i++) {
            try {
                const r = await fetch(LATEST_PROXIES[i], { signal: AbortSignal.timeout(5000) });
                const raw = await r.json();
                const d = (i === 1) ? JSON.parse(raw.contents) : raw;
                if (d.result === 'success') {
                    this.rate = d.rates.USD;
                    return true;
                }
            } catch (e) { /* prova proxy successivo */ }
        }
        return false;
    },

    convert(value, from, to) {
        if (from === to) return value;
        return from === 'EUR' ? value * this.rate : value / this.rate;
    },

    async getRateForDate(dateStr) {
        return this.rate;
    },

    async getWeightedHistoricRate(transactions, fromCurrency, toCurrency) {
        if (fromCurrency === toCurrency) return 1;
        return this.rate;
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
