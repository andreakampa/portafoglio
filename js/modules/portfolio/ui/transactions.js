import { Calc } from '../calc.js';
import { Exchange } from '../../../api/exchange.js';
import { Toast } from '../../../core/toast.js';
import { todayISO, lockScroll, unlockScroll } from './helpers.js';

export function openTransactionModal(id, type, portfolio, prices, onSave) {
    const p = portfolio[id];
    const { qta, pmc } = Calc.positionSync(p);
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
                            ${!isBuy ? `<button id="tx-qta-max" style="margin-left:6px;padding:1px 7px;font-size:10px;font-weight:700;background:var(--warning);color:#fff;border:none;border-radius:4px;cursor:pointer;vertical-align:middle;">MAX</button>` : ''}
                        </span>
                        <input type="number" id="tx-qta" step="any" placeholder="0">
                    </div>
                    <div>
                        <span class="modal-label">Prezzo Eseguito</span>
                        <input type="number" id="tx-prezzo" step="any" value="${prLive}">
                    </div>
                    <div>
                        <span class="modal-label">Commissione (€)</span>
                        <input type="number" id="tx-comm" step="any" value="${p.commDefault || 7}">
                    </div>
                    ${p.valuta === 'USD' ? `
                    <div>
                        <span class="modal-label">Tasso EUR/USD <span class="text-muted fs-xs">(auto-compilato, modificabile)</span></span>
                        <input type="number" id="tx-fx" step="any" placeholder="caricamento...">
                    </div>` : ''}
                </div>
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

    if (!isBuy) {
        document.getElementById('tx-qta-max').onclick = () => {
            document.getElementById('tx-qta').value = qta;
            preview();
        };
    }

    const preview = () => txPreview(id, type, portfolio, prices);
    document.getElementById('tx-qta').oninput    = preview;
    document.getElementById('tx-prezzo').oninput = preview;
    document.getElementById('tx-comm').oninput   = preview;

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
            const { qta } = Calc.positionSync(portfolio[id]);
            if (q > qta + 0.0001) {
                Toast.show('Quantità superiore al disponibile', 'err');
                return;
            }
        }
        if (!portfolio[id].transactions) portfolio[id].transactions = [];
        const fxInp = document.getElementById('tx-fx');
        const fxSave = fxInp ? parseFloat(fxInp.value) : NaN;
        portfolio[id].transactions.push({
            date: dt, type, qty: q, price: pr, commission: c,
            ...(fxSave > 0 ? { exchangeRate: fxSave } : {})
        });
        closeModal();
        await onSave();
        Toast.show(`${isBuy ? 'Acquisto' : 'Vendita'} di ${p.nome} registrata`, 'ok');
    };
}

function txPreview(id, type, portfolio, prices) {
    const q  = parseFloat(document.getElementById('tx-qta').value);
    const pr = parseFloat(document.getElementById('tx-prezzo').value);
    const c  = parseFloat(document.getElementById('tx-comm').value) || 0;
    const box = document.getElementById('tx-preview');
    if (isNaN(q) || isNaN(pr) || q <= 0) { box.style.display = 'none'; return; }

    const { qta, pmc } = Calc.positionSync(portfolio[id]);
    const p = portfolio[id];
    const s = p.valuta === 'USD' ? '$' : '€';
    box.style.display = 'block';

    if (type === 'buy') {
        const newCost = (qta * pmc) + (q * pr) + c;
        const newQta  = qta + q;
        const newPmc  = newQta > 0 ? newCost / newQta : 0;
        box.innerHTML = `Costo operazione: <b>${s} ${Calc.fmt(q * pr + c)}</b> (comm. <b>${Calc.fmt(c)}</b>)<br>
            Nuovo PMC: <b class="hl">${Calc.fmt(newPmc)}</b> (attuale: ${Calc.fmt(pmc)})<br>
            Nuova Q.tà: <b>${Calc.fmt(newQta, 4)}</b>`;
    } else {
        const pnlLordo = (pr - pmc) * q - c;
        const taxPct   = portfolio[id].tipoAsset === 'bond' ? 0.125 : portfolio[id].tipoAsset === 'crypto' ? 0.33 : 0.26;
        const taxLabel = portfolio[id].tipoAsset === 'bond' ? '12,5%' : portfolio[id].tipoAsset === 'crypto' ? '33%' : '26%';
        const tax      = pnlLordo > 0 ? pnlLordo * taxPct : 0;
        const pnlNetto = pnlLordo - tax;
        box.innerHTML = `
            Incasso lordo: <b>${s} ${Calc.fmt(q * pr - c)}</b><br>
            P&L lordo: <b class="${pnlLordo >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(pnlLordo)}</b><br>
            ${pnlLordo > 0 ? `Tasse (${taxLabel}): <b class="neg-loss">− ${s} ${Calc.fmt(tax)}</b><br>` : ''}
            P&L <b>netto</b>: <b class="${pnlNetto >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(pnlNetto)}</b><br>
            Q.tà rimanente: <b>${Calc.fmt(qta - q, 4)}</b>`;
    }
}