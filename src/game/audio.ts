import type { WeaponDefinition } from './types'

export class AudioSystem {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private volume = 0.65

  async resume(): Promise<void> {
    this.ensureContext()
    if (this.context?.state === 'suspended') await this.context.resume()
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.volume * 0.55, this.context.currentTime, 0.02)
    }
  }

  ui(pitch = 620): void {
    this.tone(pitch, pitch * 1.18, 0.065, 'square', 0.055)
  }

  gun(definition: WeaponDefinition): void {
    if (definition.id === 'rifle') {
      this.noise(0.075, 0.25, 1750)
      this.tone(140, 62, 0.09, 'sawtooth', 0.12)
      this.tone(960, 360, 0.035, 'square', 0.035)
    } else if (definition.id === 'smg') {
      this.noise(0.05, 0.18, 2200)
      this.tone(190, 88, 0.06, 'sawtooth', 0.085)
      this.tone(1180, 540, 0.025, 'square', 0.025)
    } else if (definition.id === 'shotgun') {
      this.noise(0.19, 0.42, 920)
      this.tone(88, 34, 0.2, 'sawtooth', 0.2)
      this.tone(270, 90, 0.075, 'square', 0.08)
    } else if (definition.id === 'marksman') {
      this.noise(0.1, 0.28, 1350)
      this.tone(190, 54, 0.14, 'sawtooth', 0.14)
      this.tone(1320, 410, 0.055, 'square', 0.04)
    } else if (definition.id === 'lmg') {
      this.noise(0.095, 0.31, 1120)
      this.tone(112, 46, 0.12, 'sawtooth', 0.15)
      this.tone(510, 165, 0.04, 'square', 0.045)
    } else {
      this.tone(1280, 110, 0.22, 'sawtooth', 0.17)
      this.tone(720, 90, 0.28, 'sine', 0.12)
      this.noise(0.12, 0.18, 3100)
    }
  }

  dryFire(): void {
    this.tone(170, 125, 0.045, 'square', 0.065)
  }

  reload(): void {
    this.noise(0.035, 0.08, 2400)
    this.tone(260, 210, 0.045, 'square', 0.045, 0.03)
    this.tone(380, 500, 0.06, 'square', 0.05, 0.22)
  }

  hit(headshot = false): void {
    this.tone(headshot ? 1220 : 810, headshot ? 1580 : 960, 0.055, 'sine', headshot ? 0.075 : 0.045)
  }

  enemyShot(type: 'scout' | 'brute' | 'sentry'): void {
    const base = type === 'brute' ? 105 : type === 'sentry' ? 410 : 230
    this.tone(base * 1.8, base, type === 'brute' ? 0.16 : 0.09, 'sawtooth', type === 'brute' ? 0.09 : 0.055)
  }

  hurt(): void {
    this.noise(0.11, 0.13, 420)
    this.tone(95, 54, 0.13, 'sawtooth', 0.075)
  }

  shieldBreak(): void {
    this.tone(760, 120, 0.24, 'square', 0.11)
    this.noise(0.18, 0.1, 2800)
  }

  explosion(): void {
    this.noise(0.48, 0.48, 520)
    this.tone(72, 28, 0.5, 'sawtooth', 0.24)
  }

  pickup(): void {
    this.tone(420, 840, 0.11, 'sine', 0.075)
    this.tone(720, 1120, 0.08, 'sine', 0.05, 0.06)
  }

  build(): void {
    this.tone(340, 510, 0.075, 'square', 0.065)
    this.noise(0.035, 0.045, 1800)
  }

  blockBreak(): void {
    this.noise(0.09, 0.11, 740)
  }

  step(strength = 1): void {
    this.noise(0.035, 0.035 * strength, 320)
  }

  wave(): void {
    this.tone(180, 680, 0.36, 'sawtooth', 0.08)
    this.tone(420, 920, 0.28, 'sine', 0.06, 0.12)
  }

  private ensureContext(): void {
    if (this.context) return
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    this.context = new AudioContextClass()
    this.master = this.context.createGain()
    this.master.gain.value = this.volume * 0.55
    this.master.connect(this.context.destination)
    const length = this.context.sampleRate
    this.noiseBuffer = this.context.createBuffer(1, length, this.context.sampleRate)
    const data = this.noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
  }

  private tone(
    startFrequency: number,
    endFrequency: number,
    duration: number,
    type: OscillatorType,
    gainAmount: number,
    delay = 0,
  ): void {
    this.ensureContext()
    if (!this.context || !this.master) return
    const now = this.context.currentTime + delay
    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(Math.max(20, startFrequency), now)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainAmount), now + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    oscillator.connect(gain)
    gain.connect(this.master)
    oscillator.start(now)
    oscillator.stop(now + duration + 0.02)
  }

  private noise(duration: number, gainAmount: number, filterFrequency: number, delay = 0): void {
    this.ensureContext()
    if (!this.context || !this.master || !this.noiseBuffer) return
    const now = this.context.currentTime + delay
    const source = this.context.createBufferSource()
    const filter = this.context.createBiquadFilter()
    const gain = this.context.createGain()
    source.buffer = this.noiseBuffer
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(filterFrequency, now)
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, filterFrequency * 0.32), now + duration)
    gain.gain.setValueAtTime(Math.max(0.0001, gainAmount), now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(this.master)
    source.start(now)
    source.stop(now + duration + 0.02)
  }
}
