const PROXIES = [
    ticker => `https://corsproxy.io/?${encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '?interval=1d&range=5d')}`,
    ticker => `https://api.allorigins.win/get?url=${encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '?interval=1d&range=5d')}`,
    ticker => `https://thingproxy.freeboard.io/fetch/https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`,
];

const PROXIES_30D = [
    ticker => `https://corsproxy.io/?${encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '?interval=1d&range=1mo')}`,
    ticker => `https://api.allorigins.win/get?url=${encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '?interval=1d&range=1mo')}`,
    ticker => `https://thingproxy.freeboard.io/fetch/https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1mo`,
];

export const Yahoo = {
    async fetchPrice(ticker) {
        for (let i = 0; i < PROXIES.length; i++) {
            try {
                const r = await fetch(PROXIES[i](ticker), { signal: AbortSignal.timeout(7000) });
                const raw = await r.json();
                const parsed = (i === 1) ? JSON.parse(raw.contents) : raw;
                const result = parsed.chart.result[0];
                const meta   = result.meta;
                const closes = result.indicators?.quote?.[0]?.close?.filter(Boolean) ?? [];
                const prev   = closes.length >= 2 ? closes[closes.length - 2] : (meta.chartPreviousClose ?? null);
                return { price: meta.regularMarketPrice, prevClose: prev };
            } catch (e) { /* try next proxy */ }
        }
        return null;
    },

    async fetchAll(tickers) {
        const entries = Object.entries(tickers);
        const results = await Promise.allSettled(
            entries.map(([id, ticker]) =>
                this.fetchPrice(ticker).then(r => ({ id, r }))
            )
        );
        const prices = {}, prevs = {};
        results.forEach(({ status, value }) => {
            if (status === 'fulfilled' && value?.r) {
                prices[value.id] = value.r.price;
                prevs[value.id]  = value.r.prevClose;
            }
        });
        return { prices, prevs };
    },

    async fetchSparkline(ticker) {
        for (let i = 0; i < PROXIES_30D.length; i++) {
            try {
                const r = await fetch(PROXIES_30D[i](ticker), { signal: AbortSignal.timeout(7000) });
                const raw = await r.json();
                const parsed = (i === 1) ? JSON.parse(raw.contents) : raw;
                const closes = parsed.chart.result[0].indicators?.quote?.[0]?.close ?? [];
                return closes.filter(v => v !== null && v !== undefined);
            } catch (e) { /* try next proxy */ }
        }
        return [];
    },

    async fetchAllSparklines(tickers) {
        const entries = Object.entries(tickers);
        const results = await Promise.allSettled(
            entries.map(([id, ticker]) =>
                this.fetchSparkline(ticker).then(data => ({ id, data }))
            )
        );
        const sparklines = {};
        results.forEach(({ status, value }) => {
            if (status === 'fulfilled' && value?.data?.length) {
                sparklines[value.id] = value.data;
            }
        });
        return sparklines;
    }
};
