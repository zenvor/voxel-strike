export function mulberry32(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function fade(t: number): number {
  return t * t * (3 - 2 * t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export class SeededNoise {
  private readonly seed: number

  constructor(seed: number) {
    this.seed = seed | 0
  }

  hash2(x: number, y: number): number {
    let h = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(y | 0, 0x5f356495) ^ this.seed
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
    h ^= h >>> 16
    return (h >>> 0) / 4294967295
  }

  value2(x: number, y: number): number {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const tx = fade(x - x0)
    const ty = fade(y - y0)
    const a = this.hash2(x0, y0)
    const b = this.hash2(x0 + 1, y0)
    const c = this.hash2(x0, y0 + 1)
    const d = this.hash2(x0 + 1, y0 + 1)
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty)
  }

  fbm2(x: number, y: number, octaves = 5): number {
    let value = 0
    let amplitude = 0.55
    let frequency = 1
    let total = 0
    for (let i = 0; i < octaves; i += 1) {
      value += this.value2(x * frequency, y * frequency) * amplitude
      total += amplitude
      frequency *= 2.03
      amplitude *= 0.5
    }
    return value / total
  }

  ridged2(x: number, y: number, octaves = 4): number {
    const n = this.fbm2(x, y, octaves)
    return 1 - Math.abs(n * 2 - 1)
  }
}

export function hashFloat(x: number, y: number, z: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647) + seed
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
