const SEARCH_PROXIES = [
    q => `https://api.allorigins.win/get?url=${encodeURIComponent('https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(q) + '&lang=it-IT&region=IT&quotesCount=8&newsCount=0')}`,
    q => `https://corsproxy.io/?${encodeURIComponent('https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(q) + '&lang=it-IT&region=IT&quotesCount=8&newsCount=0')}`
];

const CURRENCY_MAP = {
    'EUR': 'EUR', 'USD': 'USD', 'GBp': 'EUR', 'GBP': 'EUR',
    'CHF': 'EUR', 'JPY': 'USD', 'CAD': 'USD', 'AUD': 'USD',
};

export const Search = {
    async query(q) {
        if (!q || q.length < 1) return [];
        for (let i = 0; i < SEARCH_PROXIES.length; i++) {
            try {
                const r   = await fetch(SEARCH_PROXIES[i](q), { signal: AbortSignal.timeout(5000) });
                const raw = await r.json();
                const parsed = (i === 0) ? JSON.parse(raw.contents) : raw;
                const quotes = parsed?.quotes || [];
                return quotes
                    .filter(q => q.symbol && q.quoteType !== 'CURRENCY')
                    .map(q => ({
                        ticker:   q.symbol,
                        name:     q.shortname || q.longname || q.symbol,
                        type:     q.quoteType || '',
                        exchange: q.exchDisp || '',
                        currency: CURRENCY_MAP[q.currency] || (q.currency?.startsWith('EUR') ? 'EUR' : 'USD'),
                    }));
            } catch (e) { /* prova proxy successivo */ }
        }
        return [];
    }
};
