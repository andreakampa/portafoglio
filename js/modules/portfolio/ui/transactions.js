import { Calc } from '../calc.js';
import { Exchange } from '../../../api/exchange.js';
import { Toast } from '../../../core/toast.js';
import { todayISO, lockScroll, unlockScroll } from './helpers.js';
import { calcolaMinusvalenze } from '../../../api/fiscale.js';

export function openTransactionModal(id, type, portfolio, prices, onSave, activePortfolio = null) {
    const p = portfolio[id];
    const taxRegimeAttivo = activePortfolio?.taxRegime || 'amministrato';
    const { qta, pmc } = Calc.positionSync(p, taxRegimeAttivo);
    const prLive = prices[id] ?? pmc;
    const overlay = document.getElementById('modal-transazione');
    const isBuy = type === 'buy';

    overlay.innerHTML = `
        <div class="modal" style="border-top: 3px solid ${isBuy ? 'var(--success)' : 'var(--purple)'}">
            <div class="modal-header">
                <h3>${isBuy ? '🟢 Acquisto' : '🔴 Vendita'} — ${p.nome}</h3>
                <button class="btn-x" id="tx-close">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-grid-2">
                    <div>
                        <span class="modal-label">Data</span>
                        <input type="date" id="tx-data" value="${todayISO()}">
                    </div>
                    <div>
                        <span class="modal-label">
                            Quantità
                            ${!isBuy ? `<span class="text-muted fs-xs">(max: ${Calc.fmt(qta, 4)})</span> <button id="tx-qta-max" style="margin-left:6px;padding:1px 7px;font-size:10px;font-weight:700;background:var(--warning);color:#fff;border:none;border-radius:4px;cursor:pointer;vertical-align:middle;">MAX</button>` : ''}
                        </span>
                        <input type="number" id="tx-qta" step="any" placeholder="0" ${!isBuy ? `max="${qta}"` : ''}>
                    </div>
                    <div>
                        <span class="modal-label">Prezzo Eseguito</span>
                        <input type="number" id="tx-prezzo" step="any" value="${prLive}">
                    </div>
                    <div>
                        <span class="modal-label">Commissione</span>
                        <div style="display:flex; gap:6px;">
                            <input type="number" id="tx-comm" step="any" placeholder="0.00" style="flex:1;">
                            <select id="tx-comm-currency" style="width:80px;">
                                <option value="EUR">€ EUR</option>
                                <option value="USD">$ USD</option>
                            </select>
                        </div>
                    </div>
                    ${p.valuta === 'USD' ? `
                    <div>
                        <span class="modal-label">Tasso EUR/USD <span class="text-muted fs-xs">(auto-compilato, modificabile)</span></span>
                        <input type="number" id="tx-fx" step="any" placeholder="caricamento...">
                    </div>` : ''}
                </div>
                ${!isBuy ? `
                <div style="display:flex; gap:8px; margin-top:14px;">
                    <button type="button" id="tx-mode-normale" class="btn btn-ghost" style="flex:1; font-weight:700;">Vendita normale</button>
                    <button type="button" id="tx-mode-lotti" class="btn btn-ghost" style="flex:1; font-weight:700;">📦 Vendita a lotti</button>
                </div>
                <div id="tx-lotti-panel" style="display:none; margin-top:10px;"></div>
                ` : ''}
                <div id="tx-preview" class="preview-box" style="display:none; margin-top:14px;"></div>
                <button id="tx-confirm" class="btn ${isBuy ? 'btn-success' : 'btn-purple'} btn-full" style="margin-top:16px;">
                    Conferma ${isBuy ? 'Acquisto' : 'Vendita'}
                </button>
                <button id="tx-cancel" class="btn btn-ghost btn-full" style="margin-top:8px;">Annulla</button>
            </div>
        </div>`;
    overlay.classList.add('visible');
    lockScroll();

    if (p.valuta === 'USD') {
        const fxField = document.getElementById('tx-fx');
        if (fxField) {
            Exchange.getRateForDate(new Date().toISOString().slice(0, 10))
                .then(r => { if (fxField && r > 0) fxField.value = r.toFixed(4); })
                .catch(() => { if (fxField) fxField.value = (Exchange.rate || '').toFixed(4); });
            document.getElementById('tx-data').addEventListener('change', e => {
                fxField.value = '';
                fxField.placeholder = 'caricamento...';
                Exchange.getRateForDate(e.target.value)
                    .then(r => { if (fxField && r > 0) fxField.value = r.toFixed(4); })
                    .catch(() => { if (fxField) fxField.value = (Exchange.rate || '').toFixed(4); });
            });
        }
    }

    const closeModal = () => { overlay.classList.remove('visible'); unlockScroll(); };
    document.getElementById('tx-close').onclick  = closeModal;
    document.getElementById('tx-cancel').onclick = closeModal;

    let saleMode = 'normale';

    if (!isBuy) {
        document.getElementById('tx-qta-max').onclick = () => {
            document.getElementById('tx-qta').value = qta;
            preview();
        };

        const btnNormale = document.getElementById('tx-mode-normale');
        const btnLotti   = document.getElementById('tx-mode-lotti');
        const lottiPanel = document.getElementById('tx-lotti-panel');
        const qtaInput   = document.getElementById('tx-qta');
        const maxBtn     = document.getElementById('tx-qta-max');

        const setActiveBtn = (active) => {
            [btnNormale, btnLotti].forEach(b => { b.style.background = ''; b.style.color = ''; });
            active.style.background = 'var(--purple)';
            active.style.color = '#fff';
        };
        setActiveBtn(btnNormale);

        btnNormale.onclick = () => {
            saleMode = 'normale';
            setActiveBtn(btnNormale);
            lottiPanel.style.display = 'none';
            qtaInput.readOnly = false;
            qtaInput.value = '';
            if (maxBtn) maxBtn.style.display = '';
            preview();
        };

        btnLotti.onclick = () => {
            saleMode = 'lotti';
            setActiveBtn(btnLotti);
            lottiPanel.style.display = 'block';
            qtaInput.readOnly = true;
            if (maxBtn) maxBtn.style.display = 'none';
            renderLottiPanel();
        };
    }

    function renderLottiPanel() {
        const panel = document.getElementById('tx-lotti-panel');
        if (!panel) return;
        const lots = Calc.getLots(p, activePortfolio?.taxRegime || 'amministrato');
        if (!lots.length) {
            panel.innerHTML = `<div class="text-muted fs-xs">Nessun lotto disponibile.</div>`;
            return;
        }
        const isUSD = p.valuta === 'USD';
        const sym = isUSD ? '$' : '€';

        panel.innerHTML = lots.map(l => {
            let pmcLabel = `${sym} ${Calc.fmt(l.price)}`;
            if (isUSD) {
                const lotRate = l.exchangeRate || Exchange._memoryCache.get(l.date)?.rate || Exchange.rate || 1;
                pmcLabel += ` <span class="text-muted fs-xs">(≈ € ${Calc.fmt(l.price / lotRate)})</span>`;
            }
            return `
                <div class="lotto-row" style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border);">
                    <div style="flex:1;">
                        <div style="font-weight:600;">${l.date}</div>
                        <div class="text-muted fs-xs">Disponibili: ${Calc.fmt(l.qtyResidua, 4)} · PMC lotto: ${pmcLabel}</div>
                    </div>
                    <input type="number" class="lotto-qty-input" data-lot-id="${l.id}" step="any" min="0" max="${l.qtyResidua}" placeholder="0" style="width:90px;">
                </div>`;
        }).join('');

        panel.querySelectorAll('.lotto-qty-input').forEach(inp => {
            inp.oninput = () => previewLotti(lots);
        });

        previewLotti(lots);
    }

    function previewLotti(lots) {
        const panel = document.getElementById('tx-lotti-panel');
        const dt = document.getElementById('tx-data').value;
        const pr = parseFloat(document.getElementById('tx-prezzo').value) || 0;
        const cInput = parseFloat(document.getElementById('tx-comm').value) || 0;
        const commCurrency = document.getElementById('tx-comm-currency')?.value || 'EUR';
        const isUSD = p.valuta === 'USD';
        const sym = isUSD ? '$' : '€';
        const cachedRate = Exchange._memoryCache.get(dt)?.rate || Exchange.rate || 1;

        let cNative;
        if (commCurrency === (isUSD ? 'USD' : 'EUR')) {
            cNative = cInput;
        } else if (commCurrency === 'USD' && !isUSD) {
            cNative = cInput / cachedRate;
        } else {
            cNative = cInput * cachedRate;
        }

        let qtyTotale = 0;
        const righe = [];
        panel.querySelectorAll('.lotto-qty-input').forEach(inp => {
            const q = parseFloat(inp.value) || 0;
            if (q <= 0) return;
            const lot = lots.find(l => l.id === inp.dataset.lotId);
            if (!lot) return;
            qtyTotale += q;
            righe.push({ lot, q });
        });

        document.getElementById('tx-qta').value = qtyTotale || '';

        const box = document.getElementById('tx-preview');
        if (qtyTotale <= 0) { box.style.display = 'none'; return; }
        box.style.display = 'block';

        let pnlNativoTotale = 0;
        let pnlEurTotale = 0;

        const dettaglio = righe.map(({ lot, q }) => {
            const commProrata  = qtyTotale > 0 ? (cNative * q / qtyTotale) : 0;
            const costoNativo  = (lot.price * q) + (lot.commission * q / lot.qtyOriginal);
            const ricavoNativo = (pr * q) - commProrata;
            const pnlNativo    = ricavoNativo - costoNativo;
            pnlNativoTotale   += pnlNativo;

            const lotRate   = lot.exchangeRate || Exchange._memoryCache.get(lot.date)?.rate || Exchange.rate || 1;
            const costoEur  = isUSD ? costoNativo / lotRate : costoNativo;
            const ricavoEur = isUSD ? ricavoNativo / cachedRate : ricavoNativo;
            const pnlEur    = ricavoEur - costoEur;
            pnlEurTotale   += pnlEur;

            const pnlPct  = costoNativo > 0 ? (pnlNativo / costoNativo) * 100 : 0;
            const eurHint = isUSD ? ` <span class="text-muted fs-xs">(≈ € ${Calc.fmt(pnlEur)})</span>` : '';
            return `<div class="text-muted fs-xs">${lot.date}: ${Calc.fmt(q, 4)} pz → <b class="${pnlNativo >= 0 ? 'pos-gain' : 'neg-loss'}">${sym} ${Calc.fmt(pnlNativo)}</b>${eurHint} (${pnlPct >= 0 ? '+' : ''}${Calc.fmt(pnlPct)}%)</div>`;
        }).join('');

        const taxPct        = p.tipoAsset === 'bond' ? 0.125 : p.tipoAsset === 'crypto' ? 0.33 : 0.26;
        const baseImponibile = isUSD ? pnlEurTotale : pnlNativoTotale;
        const tax            = baseImponibile > 0 ? baseImponibile * taxPct : 0;
        const pnlNettoEur    = baseImponibile - tax;

        box.innerHTML = `
            <div style="margin-bottom:6px;">Dettaglio per lotto:</div>
            ${dettaglio}
            <div style="margin-top:8px; padding-top:8px; border-top:1px solid var(--border);">
                P&L lordo totale: <b class="${pnlNativoTotale >= 0 ? 'pos-gain' : 'neg-loss'}">${sym} ${Calc.fmt(pnlNativoTotale)}</b>
                ${isUSD ? ` <span class="text-muted fs-xs">(≈ € ${Calc.fmt(pnlEurTotale)})</span>` : ''}<br>
                ${baseImponibile > 0 ? `Tasse teoriche (su € ${Calc.fmt(baseImponibile)}): <b class="neg-loss">− € ${Calc.fmt(tax)}</b><br>` : ''}
                P&L netto teorico: <b class="${pnlNettoEur >= 0 ? 'pos-gain' : 'neg-loss'}">€ ${Calc.fmt(pnlNettoEur)}</b>
            </div>`;
    }

    const preview = () => txPreview(id, type, portfolio, prices, activePortfolio);
    document.getElementById('tx-qta').oninput    = preview;
        document.getElementById('tx-prezzo').oninput = preview;
        document.getElementById('tx-comm').oninput   = preview;
        document.getElementById('tx-comm-currency')?.addEventListener('change', preview);

    document.getElementById('tx-confirm').onclick = async () => {
        const q  = parseFloat(document.getElementById('tx-qta').value);
        const pr = parseFloat(document.getElementById('tx-prezzo').value);
        const c  = parseFloat(document.getElementById('tx-comm').value) || 0;
        const dt = document.getElementById('tx-data').value;
        if (isNaN(q) || q <= 0 || isNaN(pr) || pr <= 0) {
            Toast.show('Inserisci quantità e prezzo validi', 'err');
            return;
        }
        if (type === 'sell') {
            const { qta } = Calc.positionSync(portfolio[id], taxRegimeAttivo);
            if (q > qta + 0.0001) {
                Toast.show('Quantità superiore al disponibile', 'err');
                return;
            }
        }
        let lotAllocation = null;
        if (type === 'sell' && saleMode === 'lotti') {
            lotAllocation = [];
            document.querySelectorAll('.lotto-qty-input').forEach(inp => {
                const qLotto = parseFloat(inp.value) || 0;
                if (qLotto > 0) lotAllocation.push({ lotId: inp.dataset.lotId, qty: qLotto });
            });
            if (!lotAllocation.length) {
                Toast.show('Seleziona almeno un lotto', 'err');
                return;
            }
        }

        if (!portfolio[id].transactions) portfolio[id].transactions = [];
        const fxInp = document.getElementById('tx-fx');
        const fxSave = fxInp ? parseFloat(fxInp.value) : NaN;
        const commCurrency = document.getElementById('tx-comm-currency')?.value || 'EUR';
        portfolio[id].transactions.push({
            date: dt, type, qty: q, price: pr, commission: c,
            ...(commCurrency !== 'EUR' ? { commissionCurrency: commCurrency } : {}),
            ...(fxSave > 0 ? { exchangeRate: fxSave } : {}),
            ...(type === 'sell' ? { saleMode } : {}),
            ...(lotAllocation ? { lotAllocation } : {})
        });
        closeModal();
        await onSave();
        Toast.show(`${isBuy ? 'Acquisto' : 'Vendita'} di ${p.nome} registrata`, 'ok');
    };
}

function txPreview(id, type, portfolio, prices, activePortfolio) {
    const q   = parseFloat(document.getElementById('tx-qta').value);
    const pr  = parseFloat(document.getElementById('tx-prezzo').value);
    const c   = parseFloat(document.getElementById('tx-comm').value) || 0;
    const dt  = document.getElementById('tx-data').value;
    const box = document.getElementById('tx-preview');
    if (isNaN(q) || isNaN(pr) || q <= 0) { box.style.display = 'none'; return; }

    const { qta, pmc, pmcEur } = Calc.positionSync(portfolio[id], activePortfolio?.taxRegime || 'amministrato');
    const p = portfolio[id];
    const s = p.valuta === 'USD' ? '$' : '€';
    const assetIsUSD = p.valuta === 'USD';

    const commCurrency = document.getElementById('tx-comm-currency')?.value || 'EUR';
    const cachedRate = Exchange._memoryCache.get(dt)?.rate || Exchange.rate || 1;

    let cNative;
    if (commCurrency === (assetIsUSD ? 'USD' : 'EUR')) {
        cNative = c;
    } else if (commCurrency === 'USD' && !assetIsUSD) {
        cNative = c / cachedRate;
    } else {
        cNative = c * cachedRate;
    }

    const commHint = commCurrency !== (assetIsUSD ? 'USD' : 'EUR')
        ? ` <span class="text-muted fs-xs">(≈ ${s} ${Calc.fmt(cNative)})</span>`
        : '';
    const commLabel = `${commCurrency === 'USD' ? '$ ' : '€ '}${Calc.fmt(c)}${commHint}`;

    box.style.display = 'block';

    if (type === 'buy') {
        const newCost = (qta * pmc) + (q * pr) + cNative;
        const newQta  = qta + q;
        const newPmc  = newQta > 0 ? newCost / newQta : 0;
        box.innerHTML = `
            Costo operazione: <b>${s} ${Calc.fmt(q * pr + cNative)}</b> &nbsp;(comm.:&nbsp; <b class="text-warning">${commLabel}</b>)<br>
            Nuovo PMC: <b class="hl">${Calc.fmt(newPmc)}</b> (attuale: ${Calc.fmt(pmc)})<br>
            Nuova Q.tà: <b>${Calc.fmt(newQta, 4)}</b>`;
    } else {
        const pnlLordoNative = (pr - pmc) * q - cNative;
        const costoBaseEur   = (pmcEur || pmc) * q;
        const proceedsEur    = assetIsUSD ? ((q * pr - cNative) / cachedRate) : (q * pr - cNative);
        const pnlLordoEur    = proceedsEur - costoBaseEur;

        const taxPct      = p.tipoAsset === 'bond' ? 0.125 : p.tipoAsset === 'crypto' ? 0.33 : 0.26;
        const taxLabel     = p.tipoAsset === 'bond' ? '12,5%' : p.tipoAsset === 'crypto' ? '33%' : '26%';
        const tax          = pnlLordoEur > 0 ? pnlLordoEur * taxPct : 0;
        const pnlNettoEur  = pnlLordoEur - tax;
        const eurHint      = assetIsUSD ? ` <span class="text-muted fs-xs">(≈ € ${Calc.fmt(pnlLordoEur)})</span>` : '';

        // Calcola minusvalenze disponibili se regime amministrato (sempre in €)
        let minusHtml = '';
        if (activePortfolio?.taxRegime !== 'dichiarativo' && pnlLordo > 0) {
            const righe = calcolaMinusvalenze(portfolio, activePortfolio?.taxRegime || 'amministrato');
            const categoria = p.tipoAsset === 'crypto' ? 'crypto' : 'strumenti';
            const minusDisp = righe
                .filter(r => r.categoria === categoria)
                .reduce((s, r) => s + r.minus, 0);

            if (minusDisp > 0) {
                const minusUsate = Math.min(pnlLordoEur, minusDisp);
                const imponibile = Math.max(0, pnlLordoEur - minusUsate);
                const taxEffettiva = imponibile * taxPct;
                const pnlNettoEffettivoEur = pnlLordoEur - taxEffettiva;
                minusHtml = `
                    <div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border);">
                        <span class="text-muted fs-xs">Con compensazione minus (€ ${Calc.fmt(minusDisp)} disponibili):</span><br>
                        Tasse effettive: <b class="neg-loss">− € ${Calc.fmt(taxEffettiva)}</b>
                        <span class="text-muted fs-xs">(minus usate: € ${Calc.fmt(minusUsate)})</span><br>
                        P&L netto effettivo: <b class="${pnlNettoEffettivoEur >= 0 ? 'pos-gain' : 'neg-loss'}">€ ${Calc.fmt(pnlNettoEffettivoEur)}</b>
                    </div>`;
            }
        }

        if (q > qta + 0.0001) {
            box.innerHTML = `<span style="color:var(--danger);">⚠️ Quantità superiore al disponibile (${Calc.fmt(qta, 4)})</span>`;
            return;
        }
        box.innerHTML = `
            Incasso lordo: <b>${s} ${Calc.fmt(q * pr - cNative)}</b> &nbsp;(comm.:&nbsp; <b class="text-warning">${commLabel}</b>)<br>
            P&L lordo: <b class="${pnlLordoNative >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(pnlLordoNative)}</b>${eurHint}<br>
            ${pnlLordoEur > 0 ? `Tasse teoriche (${taxLabel}, su € ${Calc.fmt(pnlLordoEur)}): <b class="neg-loss">− € ${Calc.fmt(tax)}</b><br>` : ''}
            P&L netto teorico: <b class="${pnlNettoEur >= 0 ? 'pos-gain' : 'neg-loss'}">€ ${Calc.fmt(pnlNettoEur)}</b><br>
            Q.tà rimanente: <b>${Calc.fmt(qta - q, 4)}</b>
            ${minusHtml}`;
    }
}