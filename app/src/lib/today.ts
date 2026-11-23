/** Data di oggi (AAAA-MM-GG) nel fuso del telefono o del PC: dopo mezzanotte è già il giorno nuovo, non quello di Greenwich. */
export function localToday(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
