import { Calc } from './calc.js';
import { Exchange } from '../../api/exchange.js';
import { Toast } from '../../core/toast.js';

function todayISO() { return new Date().toISOString().slice(0, 10); }

// ── HISTORY MODAL ──────────────────────────────────────────────────────────
export function openHistoryModal(id, portfolio, onSave) {
    const p = portfolio[id];
    const overlay = document.getElementById('modal-history');

    overlay.innerHTML = `
        <div class="modal modal-wide">
            <div class="modal-header">
                <h3>📜 Storico — ${p.nome}</h3>
                <button class="btn-x" id="hist-close">✕</button>
            </div>
            <div class="modal-body">
                <div class="preview-box" id="hist-summary" style="margin-bottom:14px;"></div>
                <div class="table-wrapper">
                    <table class="tx-table">
                        <thead><tr>
                            <th>Data</th><th>Tipo</th><th>Q.tà</th>
                            <th>Prezzo</th><th>Commissione</th><th>Totale</th>
                            <th>PMC post-trade</th><th>P&L trade</th><th></th>
                        </tr></thead>
                        <tbody id="hist-tbody"></tbody>
                    </table>
                </div>
            </div>
        </div>`;
    overlay.classList.add('visible');
    document.getElementById('hist-close').onclick = () => overlay.classList.remove('visible');
    _renderHistoryContent(id, portfolio, onSave);
}

function _renderHistoryContent(id, portfolio, onSave) {
    const p = portfolio[id];
    const { qta, pmc, realizedPnL, totalComm } = Calc.position(p);
    const s = p.valuta === 'USD' ? '$' : '€';
    const txsSorted = (p.transactions || []).slice().sort((a, b) => a.date.localeCompare(b.date));

    document.getElementById('hist-summary').innerHTML =
        `Q.tà: <b>${Calc.fmt(qta, 4)}</b> &nbsp;|&nbsp; PMC: <b>${Calc.fmt(pmc)}</b> &nbsp;|&nbsp;
         P&L Realizzato: <b class="${realizedPnL >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(realizedPnL)}</b> &nbsp;|&nbsp;
         Commissioni tot.: <b>${s} ${Calc.fmt(totalComm)}</b>`;

    const tbody = document.getElementById('hist-tbody');
    if (!txsSorted.length) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--text-muted);">Nessuna transazione</td></tr>`;
        return;
    }

    let rQta = 0, rPmc = 0;
    tbody.innerHTML = '';
    txsSorted.forEach((tx, i) => {
        const q = +tx.qty, pr = +tx.price, c = +(tx.commission || 0);
        let tradePnL = null;
        if (tx.type === 'buy') {
            rPmc = rQta + q > 0 ? ((rQta * rPmc) + (q * pr) + c) / (rQta + q) : 0;
            rQta += q;
        } else {
            tradePnL = (pr - rPmc) * q - c;
            rQta -= q;
            if (rQta < 0.00001) rQta = 0;
        }
        const totale = tx.type === 'buy' ? q * pr + c : q * pr - c;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${tx.date}</td>
            <td class="${tx.type === 'buy' ? 'tx-buy' : 'tx-sell'}">${tx.type === 'buy' ? '🟢 Acquisto' : '🔴 Vendita'}</td>
            <td>${Calc.fmt(q, 4)}</td>
            <td>${Calc.fmt(pr)}</td>
            <td>${Calc.fmt(c)}</td>
            <td>${s} ${Calc.fmt(totale)}</td>
            <td>${Calc.fmt(rPmc)}</td>
            <td>${tradePnL !== null
                ? `<span class="${tradePnL >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(tradePnL)}</span>`
                : '—'}</td>
            <td>
                <button class="btn-del-tx" data-idx="${i}" title="Elimina transazione">🗑</button>
            </td>`;
        tbody.appendChild(tr);
    });

    tbody.onclick = async e => {
        const btn = e.target.closest('.btn-del-tx');
        if (!btn) return;
        const origIdx = txsSorted[+btn.dataset.idx];
        if (!confirm(`Eliminare la transazione del ${origIdx.date}?`)) return;
        const realIdx = portfolio[id].transactions.findIndex(
            t => t.date === origIdx.date && t.qty === origIdx.qty &&
                 t.price === origIdx.price && t.type === origIdx.type
        );
        if (realIdx > -1) portfolio[id].transactions.splice(realIdx, 1);
        await onSave();
        _renderHistoryContent(id, portfolio, onSave);
        Toast.show('Transazione rimossa', 'ok');
    };
}

// ── TRANSACTION MODAL ──────────────────────────────────────────────────────
export function openTransactionModal(id, type, portfolio, prices, onSave) {
    const p = portfolio[id];
    const { qta, pmc } = Calc.position(p);
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
                        <span class="modal-label">Quantità</span>
                        <input type="number" id="tx-qta" step="any" placeholder="0">
                    </div>
                    <div>
                        <span class="modal-label">Prezzo Eseguito</span>
                        <input type="number" id="tx-prezzo" step="any" value="${Calc.fmt(prLive)}">
                    </div>
                    <div>
                        <span class="modal-label">Commissione (€)</span>
                        <input type="number" id="tx-comm" step="any" value="${p.commDefault || 7}">
                    </div>
                </div>
                <div id="tx-preview" class="preview-box" style="display:none; margin-top:14px;"></div>
                <button id="tx-confirm" class="btn ${isBuy ? 'btn-success' : 'btn-purple'} btn-full" style="margin-top:16px;">
                    Conferma ${isBuy ? 'Acquisto' : 'Vendita'}
                </button>
                <button id="tx-cancel" class="btn btn-ghost btn-full" style="margin-top:8px;">Annulla</button>
            </div>
        </div>`;
    overlay.classList.add('visible');
    document.getElementById('tx-close').onclick  = () => overlay.classList.remove('visible');
    document.getElementById('tx-cancel').onclick = () => overlay.classList.remove('visible');

    const preview = () => _txPreview(id, type, portfolio, prices);
    document.getElementById('tx-qta').oninput    = preview;
    document.getElementById('tx-prezzo').oninput = preview;
    document.getElementById('tx-comm').oninput   = preview;

    document.getElementById('tx-confirm').onclick = async () => {
        const q  = parseFloat(document.getElementById('tx-qta').value);
        const pr = parseFloat(document.getElementById('tx-prezzo').value);
        const c  = parseFloat(document.getElementById('tx-comm').value) || 0;
        const dt = document.getElementById('tx-data').value;
        if (isNaN(q) || q <= 0 || isNaN(pr) || pr <= 0) { Toast.show('Inserisci quantità e prezzo validi', 'err'); return; }
        if (type === 'sell') {
            const { qta } = Calc.position(portfolio[id]);
            if (q > qta + 0.0001) { Toast.show('Quantità superiore al disponibile', 'err'); return; }
        }
        if (!portfolio[id].transactions) portfolio[id].transactions = [];
        portfolio[id].transactions.push({ date: dt, type, qty: q, price: pr, commission: c });
        overlay.classList.remove('visible');
        await onSave();
        Toast.show(`${isBuy ? 'Acquisto' : 'Vendita'} di ${p.nome} registrata`, 'ok');
    };
}

function _txPreview(id, type, portfolio, prices) {
    const q  = parseFloat(document.getElementById('tx-qta').value);
    const pr = parseFloat(document.getElementById('tx-prezzo').value);
    const c  = parseFloat(document.getElementById('tx-comm').value) || 0;
    const box = document.getElementById('tx-preview');
    if (isNaN(q) || isNaN(pr) || q <= 0) { box.style.display = 'none'; return; }

    const { qta, pmc } = Calc.position(portfolio[id]);
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
        const pnl = (pr - pmc) * q - c;
        box.innerHTML = `P&L questa vendita: <b class="${pnl >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(pnl)}</b><br>
            Q.tà rimanente: <b>${Calc.fmt(qta - q, 4)}</b> &nbsp;|&nbsp; Incasso netto: <b>${s} ${Calc.fmt(q * pr - c)}</b>`;
    }
}

// ── SIMULATION MODAL ───────────────────────────────────────────────────────
export function openSimModal(id, portfolio, prices) {
    const p = portfolio[id];
    const { qta, pmc } = Calc.position(p);
    const prLive = prices[id] ?? pmc;
    const overlay = document.getElementById('modal-simulazione');

    overlay.innerHTML = `
        <div class="modal" style="border-top: 3px solid var(--warning)">
            <div class="modal-header">
                <h3>📊 Simulazione — ${p.nome}</h3>
                <button class="btn-x" id="sim-close">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-grid-3">
                    <div>
                        <span class="modal-label">Prezzo Simulato</span>
                        <input type="number" id="sim-prezzo" step="any" value="${Calc.fmt(prLive)}">
                    </div>
                    <div>
                        <span class="modal-label">Budget Disponibile</span>
                        <input type="number" id="sim-budget" step="any" placeholder="0.00">
                    </div>
                    <div>
                        <span class="modal-label">Commissione Stimata</span>
                        <input type="number" id="sim-comm" step="any" value="${p.commDefault || 7}">
                    </div>
                </div>
                <div id="sim-result" class="preview-box" style="display:none; margin-top:14px;"></div>
                <button id="sim-close2" class="btn btn-ghost btn-full" style="margin-top:16px;">Chiudi</button>
            </div>
        </div>`;
    overlay.classList.add('visible');
    document.getElementById('sim-close').onclick  = () => overlay.classList.remove('visible');
    document.getElementById('sim-close2').onclick = () => overlay.classList.remove('visible');

    const calc = () => {
        const pr  = parseFloat(document.getElementById('sim-prezzo').value);
        const b   = parseFloat(document.getElementById('sim-budget').value);
        const c   = parseFloat(document.getElementById('sim-comm').value) || 0;
        const box = document.getElementById('sim-result');
        if (isNaN(pr) || isNaN(b) || pr <= 0 || b <= 0) { box.style.display = 'none'; return; }
        const net = b - c;
        const aq  = net / pr;
        const newPmc = (qta + aq) > 0 ? ((qta * pmc) + net) / (qta + aq) : 0;
        const s = p.valuta === 'USD' ? '$' : '€';
        const convLine = p.valuta === 'USD'
            ? `<br>Costo in EUR: <b>€ ${Calc.fmt(b / Exchange.rate)}</b>` : '';
        box.style.display = 'block';
        box.innerHTML = `Azioni acquistabili (netto comm.): <b>${Calc.fmt(aq, 4)}</b><br>
            Budget: <b>${Calc.fmt(b)}</b> (comm. <b>${Calc.fmt(c)}</b>)${convLine}<br>
            Nuovo PMC: <b class="hl">${Calc.fmt(newPmc)}</b> (attuale: ${Calc.fmt(pmc)})<br>
            Nuova Q.tà totale: <b>${Calc.fmt(qta + aq, 4)}</b>`;
    };
    ['sim-prezzo', 'sim-budget', 'sim-comm'].forEach(el =>
        document.getElementById(el).oninput = calc
    );
}
