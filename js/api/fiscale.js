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
export function calcolaMinusvalenze(portfolio, taxRegime = 'amministrato') {
    const righe = [];
    const oggi = new Date();
    const annoCorrente = oggi.getFullYear();
    const annoMinimo = annoCorrente - ANNI_COMPENSAZIONE;

    const assets = portfolio && portfolio.assets ? portfolio.assets : portfolio || {};

    for (const id in assets) {
        const p = assets[id];
        if (!(p.transactions || []).length) continue;

        const eventi = Calc.realizedEvents(p, taxRegime);

        for (const ev of eventi) {
            if (ev.pnlEur < -0.01) {
                const annoVendita = new Date(ev.date).getFullYear();
                if (annoVendita >= annoMinimo) {
                    const categoria = p.tipoAsset === 'crypto' ? 'crypto' : 'strumenti';
                    righe.push({
                        anno: annoVendita,
                        data: ev.date,
                        titolo: p.nome,
                        tipoAsset: p.tipoAsset || 'stock',
                        categoria,
                        minus: Math.abs(ev.pnlEur),
                        id
                    });
                }
            }
        }
    }

   righe.sort((a, b) => b.data.localeCompare(a.data));
    return righe;
}


// ── COMPENSAZIONE REALE (regime amministrato) ──────────────────────────────
// Ricostruisce, anno per anno e in ordine cronologico, come le plusvalenze
// storiche avrebbero consumato il pool di minusvalenze disponibili (FIFO
// sull'anno di origine della minus, così si usano prima quelle più vicine
// a scadenza). Le plus generate da fondi/OICR sono escluse: per natura
// fiscale sono "redditi di capitale" e non ammettono compensazione.
// Ogni evento di plus può avere un override manuale dell'importo compensato
// (es. per riconciliare con l'estratto del broker), salvato in
// portfolio.fiscal.compensationOverrides, keyed per id stabile dell'evento.

export function calcolaCompensazione(portfolio, taxRegime = 'amministrato') {
    const assets = portfolio && portfolio.assets ? portfolio.assets : portfolio || {};
    const overrides = (portfolio && portfolio.fiscal && portfolio.fiscal.compensationOverrides) || {};

    // 1. Raccogli TUTTI gli eventi (plus e minus) di tutti gli asset, con id stabile.
    const eventiGrezzi = [];
    for (const assetId in assets) {
        const p = assets[assetId];
        if (!(p.transactions || []).length) continue;

        const eventi = Calc.realizedEvents(p, taxRegime);
        const occCounter = {};

        for (const ev of eventi) {
            const occ = occCounter[ev.date] || 0;
            occCounter[ev.date] = occ + 1;

            const categoria = p.tipoAsset === 'crypto' ? 'crypto' : 'strumenti';
            const isFondo = p.tipoAsset === 'fondo';

            eventiGrezzi.push({
                id: `${assetId}#${ev.date}#${occ}`,
                assetId,
                titolo: p.nome,
                tipoAsset: p.tipoAsset || 'stock',
                categoria,
                isFondo,
                date: ev.date,
                pnlEur: ev.pnlEur
            });
        }
    }

    // 2. Ordine cronologico: è essenziale per la ricostruzione retroattiva.
    eventiGrezzi.sort((a, b) => a.date.localeCompare(b.date));

    // 3. Pool di minus disponibili, separato per categoria, taggato per anno origine.
    //    Struttura: { strumenti: [{anno, residuo}], crypto: [{anno, residuo}] }
    const pool = { strumenti: [], crypto: [] };

    const aggiungiAlPool = (categoria, anno, importo) => {
        if (importo <= 0.009) return;
        let bucket = pool[categoria].find(b => b.anno === anno);
        if (!bucket) {
            bucket = { anno, residuo: 0 };
            pool[categoria].push(bucket);
        }
        bucket.residuo += importo;
    };

    // Consuma dal pool FIFO per anno (più vecchio prima), rispettando la scadenza
    // a 4 anni rispetto all'anno della PLUS che sta consumando.
    const consumaDalPool = (categoria, annoPlus, importoRichiesto) => {
        const bucket = pool[categoria]
            .filter(b => b.residuo > 0.009 && (annoPlus - b.anno) <= ANNI_COMPENSAZIONE)
            .sort((a, b) => a.anno - b.anno);

        let rimanente = importoRichiesto;
        let consumatoTotale = 0;
        for (const b of bucket) {
            if (rimanente <= 0.009) break;
            const usato = Math.min(b.residuo, rimanente);
            b.residuo -= usato;
            rimanente -= usato;
            consumatoTotale += usato;
        }
        return consumatoTotale;
    };

    // 4. Scorri gli eventi in ordine cronologico, alimentando/consumando il pool.
    const dettaglioPlus = [];

    for (const ev of eventiGrezzi) {
        const anno = new Date(ev.date).getFullYear();

        if (ev.pnlEur < -0.01) {
            // Minus: alimenta il pool, anche se viene da un fondo.
            aggiungiAlPool(ev.categoria, anno, Math.abs(ev.pnlEur));
            continue;
        }

        if (ev.pnlEur > 0.01) {
            // Plus da fondo: mai compensabile, esce dal giro.
            if (ev.isFondo) {
                dettaglioPlus.push({
                    ...ev, anno, plusEur: ev.pnlEur,
                    compensatoEur: 0, residuoTassabileEur: ev.pnlEur,
                    overrideAttivo: false, motivoEsclusione: 'fondo'
                });
                continue;
            }

            const override = overrides[ev.id];
            let compensatoEur;

            if (override && typeof override.compensatoEur === 'number') {
                // Override manuale: rispettalo, ma scala comunque il pool
                // (più vecchio prima) per restare consistenti per le plus successive.
                compensatoEur = Math.min(override.compensatoEur, ev.pnlEur);
                consumaDalPool(ev.categoria, anno, compensatoEur);
            } else {
                compensatoEur = consumaDalPool(ev.categoria, anno, ev.pnlEur);
            }

            dettaglioPlus.push({
                ...ev, anno, plusEur: ev.pnlEur,
                compensatoEur,
                residuoTassabileEur: Math.max(0, ev.pnlEur - compensatoEur),
                overrideAttivo: !!override,
                motivoEsclusione: null
            });
        }
    }

    // 5. Residuo finale disponibile per anno/categoria (quello che interessa
    //    vedere nel cassetto fiscale come "ancora spendibile").
    const residuoFinale = { strumenti: [], crypto: [] };
    for (const cat of ['strumenti', 'crypto']) {
        for (const b of pool[cat]) {
            if (b.residuo > 0.009) {
                residuoFinale[cat].push({ anno: b.anno, residuo: b.residuo });
            }
        }
    }

    return { dettaglioPlus, residuoFinale };
}


export function raggruppaPerAnno(righe) {
    const mappa = {};
    for (const r of righe) {
        if (!mappa[r.anno]) mappa[r.anno] = { strumenti: [], crypto: [] };
        mappa[r.anno][r.categoria].push(r);
    }
    return mappa;
}

export function getAvailableMinusForPreview(fiscalState, assetType = 'stock') {
    if (!fiscalState) return 0;

    const manualLosses = Array.isArray(fiscalState.manualLosses)
        ? fiscalState.manualLosses
        : [];

    const totaleManuale = manualLosses.reduce((sum, row) => {
        const amount = Math.abs(parseFloat(row.amount) || 0);
        return sum + amount;
    }, 0);

    if (assetType === 'crypto') {
        return 0;
    }

    return totaleManuale;
}


let _portfolio = null;
let _getPortfolio = null;
let _savePortfolio = null;


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
                <div class="manual-loss-amount">− € ${Calc.fmt(l.amount || 0)}</div>
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


export function initCassettoFiscale(getPortfolio, savePortfolio) {
    _getPortfolio = getPortfolio;
_savePortfolio = savePortfolio;
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


export function aggiornaBadgeFiscale(portfolio, taxRegime = 'amministrato') {
    const righe = calcolaMinusvalenze(portfolio, taxRegime);
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
    if (typeof _savePortfolio === 'function') {
        return _savePortfolio();
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
            const target = losses[idx];

            if (!confirm(`Eliminare la minusvalenza "${target?.title || 'senza nome'}" di € ${Calc.fmt(target?.amount || 0)}?`)) return;

            losses.splice(idx, 1);

            await saveFiscalPortfolio();
            renderDrawerFiscale(_portfolio || (_getPortfolio ? _getPortfolio() : null));
        });
    }
}

function attachCompensationOverrideHandlers() {
    const container = document.getElementById('drawer-fiscale-body');
    if (!container || container.dataset.compBound) return;
    container.dataset.compBound = '1';

    container.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-comp-edit]');
        if (!btn) return;

        const compId = btn.dataset.compEdit;
        const current = parseFloat(btn.dataset.compCurrent || '0');

        const input = prompt(
            `Importo compensato per questa plusvalenza (€).\nLascia vuoto per tornare al calcolo automatico.`,
            current.toFixed(2)
        );
        if (input === null) return;

        const pf = typeof _getPortfolio === 'function' ? _getPortfolio() : null;
        if (!pf) return;

        if (!pf.fiscal) pf.fiscal = { manualLosses: [] };
        if (!pf.fiscal.compensationOverrides) pf.fiscal.compensationOverrides = {};

        const trimmed = input.trim();
        if (trimmed === '') {
            delete pf.fiscal.compensationOverrides[compId];
        } else {
            const val = parseFloat(trimmed.replace(',', '.'));
            if (isNaN(val) || val < 0) {
                alert('Importo non valido.');
                return;
            }
            pf.fiscal.compensationOverrides[compId] = { compensatoEur: val };
        }

        await saveFiscalPortfolio();
        renderDrawerFiscale(_portfolio || (_getPortfolio ? _getPortfolio() : null));
    });
}

function renderDrawerFiscale(portfolio) {
    const body = document.getElementById('drawer-fiscale-body');
    if (!body) return;


    const data = portfolio && portfolio.assets ? portfolio : { assets: portfolio || {} };
    const { taxRegime, fiscal } = getActivePortfolioData();
    const righe = calcolaMinusvalenze(data, taxRegime);
    const statoCompensazione = taxRegime === 'amministrato' ? statoCompensazioneHtml(data, taxRegime) : '';
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
        ${statoCompensazione}
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
        attachCompensationOverrideHandlers();
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
        ${statoCompensazione}
        <div class="fiscale-totale">
            <div class="fiscale-semaforo ${semaforoClass}"></div>
            <div style="flex:1;">
                <div class="fiscale-totale-label">Totale minusvalenze compensabili</div>
                <div class="fiscale-totale-value neg-loss">− € ${Calc.fmt(totaleAssoluto)}</div>
            </div>
        </div>`;


    if (totaleStrumenti > 0 && totaleCrypto > 0) {
        html += `
        <div style="display:flex;gap:8px;margin-bottom:16px;">
            <div style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 12px;">
                <div class="fiscale-totale-label">Azioni / Bond</div>
                <div style="font-size:0.92em;font-weight:700;color:var(--danger);">− € ${Calc.fmt(totaleStrumenti)}</div>
            </div>
            <div style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 12px;">
                <div class="fiscale-totale-label">Crypto</div>
                <div style="font-size:0.92em;font-weight:700;color:var(--danger);">− € ${Calc.fmt(totaleCrypto)}</div>
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
            <div class="fiscale-anno-header" data-toggle-anno="${annoId}">
                <div class="fiscale-anno-label">
                    Anno ${anno}
                    <span class="fiscale-anno-scadenza">${isScaduto ? '(scaduta)' : ''}</span>
                </div>
                <div class="fiscale-anno-importo ${totaleAnno === 0 ? 'zero' : ''}">
                    ${totaleAnno > 0 ? `− € ${Calc.fmt(totaleAnno)}` : '—'}
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
    body.querySelectorAll('[data-toggle-anno]').forEach(el => {
        el.addEventListener('click', () => toggleAnnoFiscale(el.dataset.toggleAnno));
    });
    attachManualLossHandlers();
    attachCompensationOverrideHandlers();


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
            <div class="fiscale-detail-importo">− € ${Calc.fmt(r.minus)}</div>
        </div>`;
}

function toggleAnnoFiscale(annoId) {
    const detail = document.getElementById(`${annoId}-detail`);
    if (detail) detail.classList.toggle('open');
}

function statoCompensazioneHtml(portfolio, taxRegime) {
    const { dettaglioPlus, residuoFinale } = calcolaCompensazione(portfolio, taxRegime);

    const residuoTotale = ['strumenti', 'crypto'].reduce((sum, cat) =>
        sum + residuoFinale[cat].reduce((s, b) => s + b.residuo, 0), 0);

    const residuoRighe = ['strumenti', 'crypto'].flatMap(cat =>
        residuoFinale[cat].map(b => `
            <div style="display:flex;justify-content:space-between;font-size:0.85em;padding:4px 0;">
                <span>${cat === 'crypto' ? 'Crypto' : 'Azioni/Bond'} · ${b.anno}</span>
                <span style="font-weight:700;color:var(--success);">€ ${Calc.fmt(b.residuo)}</span>
            </div>`)
    ).join('');

    const plusOrdinate = dettaglioPlus.slice().sort((a, b) => b.date.localeCompare(a.date));

    const plusRighe = plusOrdinate.length
        ? plusOrdinate.map(p => {
            const escluso = p.motivoEsclusione === 'fondo';
            return `
            <div class="comp-plus-row" data-comp-id="${p.id}">
                <div class="comp-plus-info">
                    <div class="comp-plus-titolo">${p.titolo} <span class="comp-plus-data">${p.date}</span></div>
                    <div class="comp-plus-dettaglio">
                        Plus € ${Calc.fmt(p.plusEur)}
                        ${escluso
                            ? `<span class="comp-plus-escluso">— fondo, non compensabile</span>`
                            : `→ compensato € ${Calc.fmt(p.compensatoEur)}${p.overrideAttivo ? ' (manuale)' : ''}, tassabile € ${Calc.fmt(p.residuoTassabileEur)}`}
                    </div>
                </div>
                ${escluso ? '' : `<button type="button" class="comp-override-btn" data-comp-edit="${p.id}" data-comp-current="${p.compensatoEur}" title="Correggi importo compensato">✎</button>`}
            </div>`;
        }).join('')
        : `<div class="fiscale-empty" style="margin-top:8px;">Nessuna plusvalenza registrata.</div>`;

    return `
        <div class="comp-stato">
            <div class="comp-stato-header">
                <strong>Disponibile per compensazione (oggi)</strong>
                <span class="comp-stato-totale">€ ${Calc.fmt(residuoTotale)}</span>
            </div>
            ${residuoRighe || `<div class="fiscale-empty" style="margin-top:4px;">Nessun residuo disponibile.</div>`}
        </div>

        <div class="comp-plus-section">
            <div class="comp-plus-header">Plusvalenze e compensazioni applicate</div>
            ${plusRighe}
        </div>
    `;
}