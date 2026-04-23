import { Calc } from '../modules/portfolio/calc.js';
import { Exchange } from '../api/exchange.js';


// ── CASSETTO FISCALE ────────────────────────────────────────────────────────
// Calcola e mostra le minusvalenze compensabili per anno fiscale.
// Le minus sono compensabili nei 4 anni successivi a quello di realizzo.
// Importante: in regime amministrato, minus su crypto NON compensano
// plus su azioni/bond e viceversa. Qui le separiamo per categoria.


const ANNI_COMPENSAZIONE = 4;


// Calcola tutte le minusvalenze realizzate dal portafoglio
// Restituisce array di { anno, data, titolo, tipoAsset, categoria, minus }
export function calcolaMinusvalenze(portfolio) {
    const righe = [];
    const oggi = new Date();
    const annoCorrente = oggi.getFullYear();
    const annoMinimo = annoCorrente - ANNI_COMPENSAZIONE;


    const assets = portfolio && portfolio.assets ? portfolio.assets : portfolio || {};


    for (const id in assets) {
        const p = assets[id];
        const txs = (p.transactions || []).slice().sort((a, b) => a.date.localeCompare(b.date));
        if (!txs.length) continue;


        let rQta = 0, rPmc = 0;
        const isUSD = (p.valuta || 'EUR').toUpperCase() === 'USD';


        for (const tx of txs) {
            const q = +tx.qty || 0;
            const pr = +tx.price || 0;
            const c = +(tx.commission || 0);


            if (tx.type === 'buy') {
                const newCost = (rQta * rPmc) + (q * pr) + c;
                rQta += q;
                rPmc = rQta > 0 ? newCost / rQta : 0;
            } else {
                const pnlNativo = (pr - rPmc) * q - c;
                let pnlEur;


                if (isUSD) {
                    const txRate = tx.exchangeRate
                        ? parseFloat(tx.exchangeRate)
                        : Exchange._memoryCache.get(tx.date)?.rate || Exchange.rate || 1;
                    pnlEur = pnlNativo / txRate;
                } else {
                    pnlEur = pnlNativo;
                }


                if (pnlEur < -0.01) {
                    const dataVendita = new Date(tx.date);
                    const annoVendita = dataVendita.getFullYear();
                    if (annoVendita >= annoMinimo) {
                        const categoria = p.tipoAsset === 'crypto' ? 'crypto' : 'strumenti';
                        righe.push({
                            anno: annoVendita,
                            data: tx.date,
                            titolo: p.nome,
                            tipoAsset: p.tipoAsset || 'stock',
                            categoria,
                            minus: Math.abs(pnlEur),
                            id
                        });
                    }
                }


                rQta -= q;
                if (rQta < 0.00001) { rQta = 0; rPmc = 0; }
            }
        }
    }


    righe.sort((a, b) => b.data.localeCompare(a.data));
    return righe;
}


export function raggruppaPerAnno(righe) {
    const mappa = {};
    for (const r of righe) {
        if (!mappa[r.anno]) mappa[r.anno] = { strumenti: [], crypto: [] };
        mappa[r.anno][r.categoria].push(r);
    }
    return mappa;
}


let _portfolio = null;
let _getPortfolio = null;


function getActivePortfolioData() {
    const pf = typeof _getPortfolio === 'function' ? _getPortfolio() : null;
    if (!pf || typeof pf !== 'object') {
        return { name: 'Portafoglio', taxRegime: 'amministrato', assets: {}, fiscal: { manualLosses: [] } };
    }
    return {
        name: pf.name || 'Portafoglio',
        taxRegime: pf.taxRegime || 'amministrato',
        assets: pf.assets || {},
        fiscal: pf.fiscal || { manualLosses: [] }
    };
}


function ensureManualLosses(fiscal) {
    if (!fiscal.manualLosses) fiscal.manualLosses = [];
    return fiscal.manualLosses;
}


function parseFlexibleYear(value) {
    const v = (value || '').trim();
    if (!v) return null;
    if (/^\d{4}$/.test(v)) return { year: parseInt(v, 10), date: `${v}-12-31` };
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return { year: d.getFullYear(), date: d.toISOString().slice(0, 10) };
}


function manualLossesHtml() {
    const { name, taxRegime, fiscal } = getActivePortfolioData();
    const losses = ensureManualLosses(fiscal);

    const items = losses
        .slice()
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const listHtml = items.length
        ? items.map((l, i) => `
            <div class="manual-loss-item">
                <div>
                    <div class="manual-loss-title">${l.title || 'Minus manuale'}</div>
                    <div class="manual-loss-meta">${l.date || l.year || ''}</div>
                </div>
                <div class="manual-loss-amount">− € ${fmt(l.amount || 0)}</div>
                <button type="button" class="manual-loss-del" data-loss-idx="${i}">Elimina</button>
            </div>
        `).join('')
        : `<div class="fiscale-empty" style="margin-top:12px;">Nessuna minusvalenza manuale inserita.</div>`;

    return `
        <div class="fiscale-subhead">
            <div><strong>Portafoglio:</strong> ${name}</div>
            <div><strong>Regime:</strong> ${taxRegime === 'dichiarativo' ? 'Dichiarativo' : 'Amministrato'}</div>
        </div>

        <div class="fiscale-regime-note">
            Minusvalenze esterne registrate manualmente per questo portafoglio.
        </div>

        <div class="manual-loss-form">
            <div class="manual-loss-grid">
                <div>
                    <label class="manual-loss-label" for="manual-loss-title">Nome strumento / fondo</label>
                    <input
                        id="manual-loss-title"
                        class="manual-loss-input"
                        type="text"
                        placeholder="Es. Fondo X o Broker Y"
                    >
                </div>

                <div>
                    <label class="manual-loss-label" for="manual-loss-date">Anno fiscale o data</label>
                    <input
                        id="manual-loss-date"
                        class="manual-loss-input"
                        type="text"
                        inputmode="numeric"
                        placeholder="Formato: 2026 oppure 2026-03-04"
                    >
                    <div class="manual-loss-help">Formati accettati: YYYY oppure YYYY-MM-DD</div>
                </div>

                <div>
                    <label class="manual-loss-label" for="manual-loss-amount">Importo perdita (€)</label>
                    <input
                        id="manual-loss-amount"
                        class="manual-loss-input"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                    >
                </div>
            </div>

            <button type="button" class="manual-loss-submit" id="manual-loss-submit">
                Aggiungi minusvalenza
            </button>
        </div>

        <div class="manual-loss-list" id="manual-loss-list">
            ${listHtml}
        </div>
    `;
}


export function initCassettoFiscale(getPortfolio) {
    _getPortfolio = getPortfolio;
    const bar = document.querySelector('.controls-right');
    if (!bar || document.getElementById('btn-cassetto-fiscale')) return;


    const btn = document.createElement('button');
    btn.id = 'btn-cassetto-fiscale';
    btn.className = 'btn-fiscale';
    btn.innerHTML = `📂 Cassetto fiscale <span class="fiscale-badge" id="fiscale-badge">0</span>`;
    btn.addEventListener('click', () => apriFiscale(_getPortfolio ? _getPortfolio() : null));
    bar.prepend(btn);


    const overlay = document.createElement('div');
    overlay.id = 'drawer-overlay-fiscale';
    overlay.className = 'drawer-overlay';
    overlay.addEventListener('click', chiudiFiscale);
    document.body.appendChild(overlay);


    const drawer = document.createElement('div');
    drawer.id = 'drawer-fiscale';
    drawer.innerHTML = `
        <div class="drawer-header">
            <h3>📂 Cassetto fiscale</h3>
            <button class="drawer-close" id="drawer-fiscale-close">✕</button>
        </div>
        <div class="drawer-body" id="drawer-fiscale-body">
            <div class="fiscale-empty">Caricamento...</div>
        </div>`;
    document.body.appendChild(drawer);


    document.getElementById('drawer-fiscale-close')?.addEventListener('click', chiudiFiscale);
}


export function aggiornaBadgeFiscale(portfolio) {
    const righe = calcolaMinusvalenze(portfolio);
    const totale = righe.reduce((s, r) => s + r.minus, 0);
    const badge = document.getElementById('fiscale-badge');
    if (badge) {
        badge.textContent = totale > 0 ? '!' : '0';
        badge.style.display = totale > 0 ? 'inline-flex' : 'none';
    }
}


function apriFiscale(portfolio) {
    _portfolio = portfolio;
    const drawer = document.getElementById('drawer-fiscale');
    const overlay = document.getElementById('drawer-overlay-fiscale');
    if (!drawer) return;
    renderDrawerFiscale(portfolio);
    drawer.classList.add('open');
    overlay?.classList.add('open');
}


function chiudiFiscale() {
    document.getElementById('drawer-fiscale')?.classList.remove('open');
    document.getElementById('drawer-overlay-fiscale')?.classList.remove('open');
}


async function saveFiscalPortfolio() {
    if (typeof window.__savePortfolioFiscal === 'function') {
        return window.__savePortfolioFiscal();
    }
    return Promise.resolve();
}


function attachManualLossHandlers() {
    const submit = document.getElementById('manual-loss-submit');
    const list = document.getElementById('manual-loss-list');

    if (submit && !submit.dataset.bound) {
        submit.dataset.bound = '1';
        submit.addEventListener('click', async () => {
            const title = document.getElementById('manual-loss-title')?.value.trim();
            const dateVal = document.getElementById('manual-loss-date')?.value.trim();
            const amount = parseFloat(document.getElementById('manual-loss-amount')?.value || '0');
            const parsed = parseFlexibleYear(dateVal);

            const pf = typeof _getPortfolio === 'function' ? _getPortfolio() : null;
            if (!pf) return;

            if (!pf.fiscal) pf.fiscal = { manualLosses: [] };
            const losses = ensureManualLosses(pf.fiscal);

            if (!title) {
                alert('Inserisci il nome dello strumento o della minusvalenza.');
                return;
            }
            if (!parsed) {
                alert('Data non valida. Usa uno di questi formati: 2026 oppure 2026-03-04.');
                return;
            }
            if (isNaN(amount) || amount <= 0) {
                alert('Inserisci un importo perdita valido, maggiore di zero.');
                return;
            }

            losses.push({
                title,
                date: parsed.date,
                year: parsed.year,
                amount
            });

            await saveFiscalPortfolio();
            renderDrawerFiscale(_portfolio || (_getPortfolio ? _getPortfolio() : null));
        });
    }

    if (list && !list.dataset.bound) {
        list.dataset.bound = '1';
        list.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-loss-idx]');
            if (!btn) return;

            const idx = parseInt(btn.dataset.lossIdx, 10);
            const pf = typeof _getPortfolio === 'function' ? _getPortfolio() : null;
            if (!pf) return;

            if (!pf.fiscal) pf.fiscal = { manualLosses: [] };
            const losses = ensureManualLosses(pf.fiscal);

            losses.splice(idx, 1);

            await saveFiscalPortfolio();
            renderDrawerFiscale(_portfolio || (_getPortfolio ? _getPortfolio() : null));
        });
    }
}


function renderDrawerFiscale(portfolio) {
    const body = document.getElementById('drawer-fiscale-body');
    if (!body) return;


    const data = portfolio && portfolio.assets ? portfolio : { assets: portfolio || {} };
    const { taxRegime, fiscal } = getActivePortfolioData();
    const righe = calcolaMinusvalenze(data);
    const manualRows = ensureManualLosses(fiscal).map((l) => ({
        anno: Number(l.year),
        data: l.date,
        titolo: l.title || 'Minus manuale',
        tipoAsset: 'manual',
        categoria: 'strumenti',
        minus: Math.abs(parseFloat(l.amount) || 0),
        id: 'manual'
    })).filter(r => r.anno && r.data && r.minus > 0);

    const tutteLeRighe = [...righe, ...manualRows].sort((a, b) => b.data.localeCompare(a.data));
    const perAnno = raggruppaPerAnno(tutteLeRighe);
    const oggi = new Date();
    const annoCorrente = oggi.getFullYear();
    const regimeLabel = taxRegime === 'dichiarativo' ? 'Dichiarativo' : 'Amministrato';
    const regimeNote = taxRegime === 'dichiarativo'
        ? 'Modalità dichiarativa: i calcoli mostrati sono una stima utile al monitoraggio fiscale e alla dichiarazione.'
        : 'Modalità amministrata: il cassetto fiscale del portafoglio viene usato per stimare la compensazione interna delle minusvalenze.';


    if (!tutteLeRighe.length) {
        body.innerHTML = `
        ${manualLossesHtml()}
        <div class="fiscale-empty">
            <div style="font-size:2em;margin-bottom:8px;">🎉</div>
            Nessuna minusvalenza compensabile nei 4 anni precedenti.
        </div>
        <div class="fiscale-nota">
            Le minusvalenze realizzate sono compensabili con le plusvalenze della stessa
            categoria nei <b>4 anni successivi</b> a quello di realizzo (art. 68 TUIR,
            regime del risparmio amministrato).
        </div>`;
        attachManualLossHandlers();
        return;
    }


    const totaleStrumenti = tutteLeRighe.filter(r => r.categoria === 'strumenti').reduce((s, r) => s + r.minus, 0);
    const totaleCrypto = tutteLeRighe.filter(r => r.categoria === 'crypto').reduce((s, r) => s + r.minus, 0);
    const totaleAssoluto = totaleStrumenti + totaleCrypto;


    const anniConScadenza = Object.keys(perAnno).map(Number).filter(a => (a + ANNI_COMPENSAZIONE) === annoCorrente);
    const semaforoClass = anniConScadenza.length > 0 ? 'semaforo-rosso'
        : Object.keys(perAnno).some(a => (Number(a) + ANNI_COMPENSAZIONE) === annoCorrente + 1) ? 'semaforo-giallo'
        : 'semaforo-verde';


    let html = `
        ${manualLossesHtml()}
        <div class="fiscale-totale">
            <div class="fiscale-semaforo ${semaforoClass}"></div>
            <div style="flex:1;">
                <div class="fiscale-totale-label">Totale minusvalenze compensabili</div>
                <div class="fiscale-totale-value neg-loss">− € ${fmt(totaleAssoluto)}</div>
            </div>
        </div>`;


    if (totaleStrumenti > 0 && totaleCrypto > 0) {
        html += `
        <div style="display:flex;gap:8px;margin-bottom:16px;">
            <div style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 12px;">
                <div class="fiscale-totale-label">Azioni / Bond</div>
                <div style="font-size:0.92em;font-weight:700;color:var(--danger);">− € ${fmt(totaleStrumenti)}</div>
            </div>
            <div style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 12px;">
                <div class="fiscale-totale-label">Crypto</div>
                <div style="font-size:0.92em;font-weight:700;color:var(--danger);">− € ${fmt(totaleCrypto)}</div>
            </div>
        </div>`;
    }


    const anni = Object.keys(perAnno).map(Number).sort((a, b) => b - a);


    for (const anno of anni) {
        const scadenza = anno + ANNI_COMPENSAZIONE;
        const giorniRimasti = Math.ceil((new Date(`${scadenza}-12-31`) - oggi) / 86400000);
        const percScaduta = Math.max(0, Math.min(100, ((oggi.getFullYear() - anno) / ANNI_COMPENSAZIONE) * 100));
        const barClass = percScaduta > 75 ? 'scadenza-danger' : percScaduta > 40 ? 'scadenza-warning' : 'scadenza-ok';


        const righeAnno = [...(perAnno[anno].strumenti || []), ...(perAnno[anno].crypto || [])].sort((a, b) => b.data.localeCompare(a.data));
        const totaleAnno = righeAnno.reduce((s, r) => s + r.minus, 0);
        const isScaduto = scadenza < annoCorrente;
        const scadeLabel = isScaduto
            ? `Scaduta il 31/12/${scadenza}`
            : giorniRimasti <= 180
                ? `⚠️ Scade tra ${giorniRimasti} giorni (31/12/${scadenza})`
                : `Scade il 31/12/${scadenza}`;


        const annoId = `fiscale-anno-${anno}`;
        html += `
        <div class="fiscale-anno" id="${annoId}">
            <div class="fiscale-anno-header" onclick="toggleAnnoFiscale('${annoId}')">
                <div class="fiscale-anno-label">
                    Anno ${anno}
                    <span class="fiscale-anno-scadenza">${isScaduto ? '(scaduta)' : ''}</span>
                </div>
                <div class="fiscale-anno-importo ${totaleAnno === 0 ? 'zero' : ''}">
                    ${totaleAnno > 0 ? `− € ${fmt(totaleAnno)}` : '—'}
                </div>
            </div>
            <div class="fiscale-scadenza-bar-wrap">
                <div class="fiscale-scadenza-bar">
                    <div class="fiscale-scadenza-fill ${barClass}" style="width:${percScaduta}%"></div>
                </div>
                <div class="fiscale-scadenza-label">${scadeLabel}</div>
            </div>
            <div class="fiscale-detail" id="${annoId}-detail">`;


        if (!righeAnno.length) {
            html += `<div class="fiscale-detail-row" style="color:var(--text-muted);font-size:0.8em;">Nessuna minusvalenza per quest'anno</div>`;
        } else {
            const hasStrumenti = righeAnno.some(r => r.categoria === 'strumenti');
            const hasCrypto = righeAnno.some(r => r.categoria === 'crypto');
            if (hasStrumenti && hasCrypto) {
                html += `<div style="padding:6px 14px 4px;font-size:0.68em;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;background:var(--secondary);">Azioni / Bond</div>`;
                for (const r of righeAnno.filter(x => x.categoria === 'strumenti')) html += rigaDettaglio(r);
                html += `<div style="padding:6px 14px 4px;font-size:0.68em;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;background:var(--secondary);">Crypto</div>`;
                for (const r of righeAnno.filter(x => x.categoria === 'crypto')) html += rigaDettaglio(r);
            } else {
                for (const r of righeAnno) html += rigaDettaglio(r);
            }
        }


        html += `</div></div>`;
    }


    html += `
        <div class="fiscale-nota">
            <b>Nota:</b> Le minusvalenze su <b>strumenti finanziari</b> (azioni, ETF, bond)
            compensano solo plusvalenze della stessa categoria. Le <b>crypto</b> dal 2023
            hanno un regime separato. Scadenza: <b>31 dicembre del 4° anno successivo</b>
            al realizzo. Verifica sempre con il tuo intermediario o consulente fiscale.
        </div>`;


    body.innerHTML = html;
    attachManualLossHandlers();


    for (const anno of anni.slice(0, 2)) {
        const el = document.getElementById(`fiscale-anno-${anno}-detail`);
        if (el) el.classList.add('open');
    }
}


function rigaDettaglio(r) {
    const isManual = r.tipoAsset === 'manual';
    const tipoLabel = isManual
        ? 'Manuale'
        : r.tipoAsset === 'bond'
            ? 'Bond'
            : r.tipoAsset === 'crypto'
                ? 'Crypto'
                : 'Stock';

    return `
        <div class="fiscale-detail-row ${isManual ? 'manual-loss-row' : ''}">
            <div class="fiscale-detail-titolo">
                <span>${r.titolo}</span>
                <span class="fiscale-detail-cat ${isManual ? 'manual-loss-badge' : ''}">${tipoLabel}</span>
            </div>
            <div class="fiscale-detail-data">${r.data}</div>
            <div class="fiscale-detail-importo">− € ${fmt(r.minus)}</div>
        </div>`;
}


function fmt(n) {
    return Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


window.toggleAnnoFiscale = function(annoId) {
    const detail = document.getElementById(`${annoId}-detail`);
    if (detail) detail.classList.toggle('open');
};
