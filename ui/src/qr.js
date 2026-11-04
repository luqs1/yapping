// QR codes drawn client-side from the bridge's payload (uqr, bundled inline).
import { encode } from 'uqr'

export function qrSVG(text, { size = 200, fg = '#141413', bg = '#fff' } = {}) {
  const qr = encode(String(text), { ecc: 'M', border: 2 })
  const n = qr.data.length
  let d = ''
  for (let y = 0; y < n; y++) {
    let x = 0
    while (x < n) {
      if (!qr.data[y][x]) { x++; continue }
      let w = 1
      while (x + w < n && qr.data[y][x + w]) w++
      d += `M${x} ${y}h${w}v1h-${w}z`
      x += w
    }
  }
  return `<svg class="qr" width="${size}" height="${size}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${n}" height="${n}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`
}
