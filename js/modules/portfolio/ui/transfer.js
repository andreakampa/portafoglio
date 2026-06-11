import { Calc } from '../calc.js';
import { lockScroll, unlockScroll } from './helpers.js';

export function openTransferModal(sourceId, portfolio, allPortfolios, activePortfolioId, onConfirm) {
    const asset = portfolio[sourceId];
    if (!asset) return;

    const { qta: qtaDisp, pmc } = Calc.positionSync(asset);
    const qtaGiaTrasferitoTotale = asset.transferredQuantity || 0;
    const qtaEffettiva = Math.max(0, qtaDisp); // quantità attualmente detenuta

    // Portafogli disponibili come destinazione (escludi quello attivo)
    const destPortfolios = Object.values(allPortfolios).filter(p => p.id !== activePortfolioId);

    const overlay = document.createElement('div');
    overlay.id = 'modal-transfer';
    overlay.className = 'overlay visible';

    const destOptions = destPortfolios.length
        ? destPortfolios.map(p => `<option value="${p.id}">${p.name}</option>`).join('')
        : '<option value="" disabled>Nessun altro portafoglio disponibile</option>';

    const valuta = asset.valuta || 'EUR';
    const s = valuta === 'USD' ? '$' : '€';

    overlay.innerHTML = `
        <div class="modal" style="border-top: 3px solid var(--warning); max-width: 480px;">
            <div class="modal-header">
                <h3>🔀 Trasferisci — ${asset.nome}</h3>
                <button class="btn-x" id="transfer-close">✕</button>
            </div>
            <div class="modal-body">

                <div class="preview-box" style="margin-bottom: 16px;">
                    <div style="display:flex; justify-content:space-between; font-size:13px;">
                        <span>PMC attuale</span>
                        <b>${s} ${Calc.fmt(pmc)}</b>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:13px; margin-top:4px;">
                        <span>Q.tà disponibile</span>
                        <b>${Calc.fmt(qtaEffettiva, 4)}</b>
                    </div>
                    ${qtaGiaTrasferitoTotale > 0 ? `
                    <div style="display:flex; justify-content:space-between; font-size:13px; margin-top:4px; color:var(--text-muted);">
                        <span>Già trasferito in precedenza</span>
                        <span>${Calc.fmt(qtaGiaTrasferitoTotale, 4)}</span>
                    </div>` : ''}
                </div>

                <div class="form-grid-2">
                    <div>
                        <span class="modal-label">Portafoglio destinazione</span>
                        <select id="transfer-dest" style="width:100%; padding:8px; border-radius:6px; border:1px solid var(--border); background:var(--bg2); color:var(--text-primary); font-size:13px;">
                            ${destOptions}
                        </select>
                    </div>
                    <div>
                        <span class="modal-label">Quantità da trasferire (1 – ${Calc.fmt(qtaEffettiva, 4)})</span>
                        <input
                            type="number"
                            id="transfer-qty"
                            min="0.0001"
                            max="${qtaEffettiva}"
                            step="any"
                            placeholder="${Calc.fmt(qtaEffettiva, 4)}"
                            value="${Calc.fmt(qtaEffettiva, 4).replace(/\./g, '').replace(',', '.')}"
                            style="width:100%; box-sizing:border-box;"
                        >
                    </div>
                </div>

                <div id="transfer-preview" class="preview-box" style="margin-top:14px; display:none;"></div>

                ${!destPortfolios.length ? `
                <div class="preview-box" style="margin-top:14px; color:var(--warning);">
                    ⚠️ Crea almeno un altro portafoglio prima di trasferire posizioni.
                </div>` : ''}

                <div style="display:flex; gap:8px; margin-top:20px;">
                    <button id="transfer-cancel" class="btn btn-ghost" style="flex:1;">Annulla</button>
                    <button id="transfer-confirm" class="btn btn-success" style="flex:1;" ${!destPortfolios.length ? 'disabled' : ''}>
                        🔀 Conferma trasferimento
                    </button>
                </div>
            </div>
        </div>`;

    document.body.appendChild(overlay);
    lockScroll();

    const close = () => {
        overlay.remove();
        unlockScroll();
    };

    document.getElementById('transfer-close').onclick  = close;
    document.getElementById('transfer-cancel').onclick = close;

    const updatePreview = () => {
        const qty = parseFloat(document.getElementById('transfer-qty').value);
        const destId = document.getElementById('transfer-dest').value;
        const preview = document.getElementById('transfer-preview');
        const btn = document.getElementById('transfer-confirm');

        if (!destId || isNaN(qty) || qty <= 0) {
            preview.style.display = 'none';
            btn.disabled = true;
            return;
        }
        if (qty > qtaEffettiva + 0.00001) {
            preview.style.display = 'block';
            preview.innerHTML = `<span style="color:var(--danger);">⚠️ Quantità superiore al disponibile (${Calc.fmt(qtaEffettiva, 4)})</span>`;
            btn.disabled = true;
            return;
        }

        const destName = allPortfolios[destId]?.name || destId;
        const parziale = qty < qtaEffettiva - 0.00001;

        preview.style.display = 'block';
        preview.innerHTML = `
            <div style="display:grid; gap:5px; font-size:13px;">
                <div style="display:flex; justify-content:space-between;">
                    <span>Ticker</span><b>${asset.nome}</b>
                </div>
                <div style="display:flex; justify-content:space-between;">
                    <span>Quantità trasferita</span><b>${Calc.fmt(qty, 4)}</b>
                </div>
                <div style="display:flex; justify-content:space-between;">
                    <span>Prezzo usato (PMC)</span><b>${s} ${Calc.fmt(pmc)}</b>
                </div>
                <div style="display:flex; justify-content:space-between;">
                    <span>Commissioni</span><b>€ 0,00</b>
                </div>
                <div style="display:flex; justify-content:space-between;">
                    <span>Portafoglio destinazione</span><b>${destName}</b>
                </div>
                ${parziale ? `
                <div style="border-top:1px solid var(--border); margin-top:4px; padding-top:4px; color:var(--text-muted); font-size:12px;">
                    Trasferimento parziale — ${Calc.fmt(qtaEffettiva - qty, 4)} unità rimangono nel portafoglio sorgente
                </div>` : `
                <div style="border-top:1px solid var(--border); margin-top:4px; padding-top:4px; color:var(--text-muted); font-size:12px;">
                    Trasferimento totale — il ticker verrà spostato in "Titoli trasferiti"
                </div>`}
            </div>`;
        btn.disabled = false;
    };

    document.getElementById('transfer-qty').addEventListener('input', updatePreview);
    document.getElementById('transfer-dest').addEventListener('change', updatePreview);
    updatePreview(); // inizializza subito

    document.getElementById('transfer-confirm').onclick = async () => {
        const qty    = parseFloat(document.getElementById('transfer-qty').value);
        const destId = document.getElementById('transfer-dest').value;
        if (!destId || isNaN(qty) || qty <= 0 || qty > qtaEffettiva + 0.00001) return;

        const btn = document.getElementById('transfer-confirm');
        btn.disabled = true;
        btn.textContent = 'Trasferimento in corso...';

        try {
            await onConfirm({ sourceAssetId: sourceId, destPortfolioId: destId, qty: Math.min(qty, qtaEffettiva) });
            close();
        } catch (e) {
            btn.disabled = false;
            btn.textContent = '🔀 Conferma trasferimento';
        }
    };
}