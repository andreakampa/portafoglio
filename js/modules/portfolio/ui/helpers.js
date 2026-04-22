export function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

export function lockScroll() {
    document.body.classList.add('modal-open');
}

export function unlockScroll() {
    document.body.classList.remove('modal-open');
}