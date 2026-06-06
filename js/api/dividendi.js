import { Exchange } from './exchange.js';

const PROXY = 'https://finance-proxy.andrea-kampa.workers.dev';
const DIVIDENDI_CACHE_KEY = 'ptpro_dividendi_v1';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 ore

export const Dividendi = {

    // Fetch dividendi storici da Yahoo per un ticker
    async fetchDividendi(ticker) {
        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=10y&events=dividends`;
            const proxyUrl = `${PROXY}?url=${encodeURIComponent(url)}`;
            const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
            const raw = await r.json();
            const divs = raw?.chart?.result?.[0]?.events?.dividends;
            if (!divs) return [];

            return Object.values(divs).map(d => ({
                exDate: new Date(d.date * 1000).toISOString().slice(0, 10),
                amount: d.amount
            })).sort((a, b) => a.exDate.localeCompare(b.exDate));
        } catch (e) {
            return [];
        }
    },

    // Calcola dividendi ricevuti per un asset in base alle transazioni
    calcolaDividendiRicevuti(asset, dividendiTicker) {
        const txs = (asset.transactions || []).sort((a, b) => a.date.localeCompare(b.date));
        if (!txs.length || !dividendiTicker.length) return [];

        const risultati = [];

        for (const div of dividendiTicker) {
            const exDate = div.exDate;

            // Calcola quante azioni detenevo alla data ex-dividend
            let qtaAllExDate = 0;
            for (const tx of txs) {
                if (tx.date > exDate) break;
                if (tx.type === 'buy')  qtaAllExDate += +tx.qty || 0;
                if (tx.type === 'sell') qtaAllExDate -= +tx.qty || 0;
            }
            qtaAllExDate = Math.max(0, qtaAllExDate);
            if (qtaAllExDate < 0.0001) continue;

            // Data stimata di pagamento = ex-date + 30 giorni
            const exDateObj = new Date(exDate + 'T12:00:00');
            exDateObj.setDate(exDateObj.getDate() + 30);
            const y = exDateObj.getFullYear();
            const m = String(exDateObj.getMonth() + 1).padStart(2, '0');
            const d = String(exDateObj.getDate()).padStart(2, '0');
            const payDate = `${y}-${m}-${d}`;

            const oggi = new Date().toISOString().slice(0, 10);
            const pagato = payDate <= oggi;

            // Importo in valuta nativa
            const importoNativo = div.amount * qtaAllExDate;

            // Converti in EUR
            const rate = Exchange._memoryCache.get(exDate)?.rate || Exchange.rate || 1;
            const importoEur = asset.valuta === 'USD'
                ? importoNativo / rate
                : importoNativo;

            risultati.push({
                exDate,
                payDate,
                pagato,
                dividendoPerAzione: div.amount,
                qta: qtaAllExDate,
                importoNativo,
                importoEur,
                valuta: asset.valuta || 'EUR'
            });
        }

        return risultati;
    },

    // Aggiorna tutti i dividendi del portfolio
    async aggiornaPortfolio(portfolio) {
        const risultati = {};

        const tickers = Object.entries(portfolio)
            .filter(([, p]) => p.transactions?.length > 0)
            .map(([id, p]) => ({ id, ticker: p.nome, asset: p }));

        await Promise.all(tickers.map(async ({ id, ticker, asset }) => {
            const divsTicker = await this.fetchDividendi(ticker);
            const ricevuti = this.calcolaDividendiRicevuti(asset, divsTicker);
            if (ricevuti.length > 0) {
                risultati[id] = ricevuti;
            }
        }));

        return risultati;
    },

    // Salva in localStorage
    salva(dividendi) {
        try {
            localStorage.setItem(DIVIDENDI_CACHE_KEY, JSON.stringify({
                ts: Date.now(),
                data: dividendi
            }));
        } catch (e) {}
    },

    // Carica da localStorage
    carica() {
        try {
            const raw = localStorage.getItem(DIVIDENDI_CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (Date.now() - parsed.ts > CACHE_TTL) return null;
            return parsed.data;
        } catch (e) { return null; }
    },

    // Svuota cache
    clear() {
        localStorage.removeItem(DIVIDENDI_CACHE_KEY);
    },

    // Totale dividendi ricevuti per un asset
    totaleRicevuto(dividendiAsset) {
        return (dividendiAsset || [])
            .filter(d => d.pagato)
            .reduce((s, d) => s + d.importoEur, 0);
    },

    // Ha ricevuto almeno un dividendo?
    haRicevutoDividendi(dividendiAsset) {
        return (dividendiAsset || []).some(d => d.pagato);
    }
};