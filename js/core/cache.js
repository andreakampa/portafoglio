const PRICES_KEY = 'ptpro_prices_v2';
const TTL_MS     = 8 * 60 * 1000; // 8 minuti

export const Cache = {
    getPrices() {
        try {
            const raw = localStorage.getItem(PRICES_KEY);
            if (!raw) return null;
            const { prices, prevs, ts } = JSON.parse(raw);
            if (Date.now() - ts > TTL_MS) return null;
            return { prices, prevs };
        } catch (e) { return null; }
    },

    savePrices(prices, prevs) {
        try {
            localStorage.setItem(PRICES_KEY, JSON.stringify({ prices, prevs, ts: Date.now() }));
        } catch (e) {}
    },

    clear() {
        localStorage.removeItem(PRICES_KEY);
    }
};
