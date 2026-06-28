import * as THREE from 'three'
import { AudioSystem } from './audio'
import { EffectsSystem } from './effects'
import { Enemy } from './enemy'
import { Environment } from './environment'
import { Player } from './player'
import { PlayerAvatar } from './playerAvatar'
import {
  BLOCK_COLORS,
  BLOCK_DURABILITY,
  BlockType,
  DIFFICULTIES,
  WEAPONS,
  type DifficultyConfig,
  type EnemyType,
  type GameSettings,
  type WeaponAmmoState,
  type WeaponDefinition,
  type WeaponId,
} from './types'
import { mulberry32 } from './noise'
import { VoxelWorld } from './world'
import { WeaponSystem } from './weapon'

type GameState = 'menu' | 'playing' | 'paused' | 'gameover' | 'victory'
type WavePhase = 'delay' | 'spawning' | 'active' | 'complete'
type PickupKind = 'health' | 'shield' | 'ammo' | 'build' | 'grenade' | 'weapon'
type ViewMode = 'firstPerson' | 'thirdPerson'

interface EnemyProjectile {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  damage: number
  life: number
  radius: number
  color: number
  trailTimer: number
}

interface Grenade {
  group: THREE.Group
  velocity: THREE.Vector3
  fuse: number
  bounces: number
}

interface Pickup {
  group: THREE.Group
  kind: PickupKind
  weaponId?: WeaponId
  life: number
  phase: number
  baseY: number
  beam: THREE.Mesh
  magnetized: boolean
}

interface SupplyCrate {
  group: THREE.Group
  lid: THREE.Group
  ring: THREE.Mesh
  accent: THREE.MeshStandardMaterial
  cooldown: number
  maxCooldown: number
  openTimer: number
  phase: number
  baseY: number
}

interface UIElements {
  loading: HTMLElement
  loadingBar: HTMLElement
  loadingText: HTMLElement
  menu: HTMLElement
  hud: HTMLElement
  pause: HTMLElement
  end: HTMLElement
  endTitle: HTMLElement
  endSubtitle: HTMLElement
  endScore: HTMLElement
  endKills: HTMLElement
  endTime: HTMLElement
  healthValue: HTMLElement
  healthFill: HTMLElement
  shieldValue: HTMLElement
  shieldFill: HTMLElement
  staminaFill: HTMLElement
  weaponName: HTMLElement
  weaponCode: HTMLElement
  ammoCurrent: HTMLElement
  ammoReserve: HTMLElement
  reload: HTMLElement
  reloadFill: HTMLElement
  grenades: HTMLElement
  build: HTMLElement
  score: HTMLElement
  highScore: HTMLElement
  combo: HTMLElement
  wave: HTMLElement
  waveRemaining: HTMLElement
  objective: HTMLElement
  fps: HTMLElement
  crosshair: HTMLElement
  hitmarker: HTMLElement
  damage: HTMLElement
  announcement: HTMLElement
  announceTitle: HTMLElement
  announceSubtitle: HTMLElement
  feed: HTMLElement
  radar: HTMLCanvasElement
  interactHint: HTMLElement
  arsenal: HTMLElement
}

const DEFAULT_SETTINGS: GameSettings = {
  sensitivity: 0.42,
  volume: 0.65,
  quality: 'balanced',
  difficulty: 'elite',
  seed: 731942,
}

export class Game {
  readonly canvas: HTMLCanvasElement

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(75, 1, 0.045, 230)
  private readonly audio = new AudioSystem()
  private readonly effects: EffectsSystem
  private readonly environment: Environment
  private readonly ui: UIElements
  private readonly raycaster = new THREE.Raycaster()
  private readonly selection: THREE.LineSegments
  private readonly playerAvatar = new PlayerAvatar(this.scene)
  private readonly aimDirection = new THREE.Vector3()
  private readonly actionOrigin = new THREE.Vector3()
  private readonly thirdPersonTarget = new THREE.Vector3()
  private readonly thirdPersonDesired = new THREE.Vector3()
  private readonly thirdPersonLookAt = new THREE.Vector3()
  private readonly thirdPersonRay = new THREE.Vector3()
  private readonly thirdPersonRight = new THREE.Vector3()
  private readonly thirdPersonMuzzle = new THREE.Vector3()
  private readonly beaconLights: THREE.PointLight[] = []
  private readonly projectiles: EnemyProjectile[] = []
  private readonly grenadesInWorld: Grenade[] = []
  private readonly pickups: Pickup[] = []
  private readonly supplyCrates: SupplyCrate[] = []
  private readonly enemies: Enemy[] = []
  private readonly blockDamage = new Map<string, number>()

  private world!: VoxelWorld
  private player!: Player
  private weapon: WeaponSystem
  private settings: GameSettings = { ...DEFAULT_SETTINGS }
  private difficulty: DifficultyConfig = DIFFICULTIES.elite
  private state: GameState = 'menu'
  private wavePhase: WavePhase = 'delay'
  private wave = 0
  private waveDelay = 0
  private waveQueue: EnemyType[] = []
  private waveSpawnTimer = 0
  private waveTotal = 0
  private score = 0
  private highScore = Number(localStorage.getItem('voxel-strike-high-score') ?? 0)
  private kills = 0
  private combo = 1
  private comboTimer = 0
  private grenades = 3
  private buildStock = 28
  private enemyId = 0
  private runTime = 0
  private previewTime = 0
  private announcementTimer = 0
  private hitmarkerTimer = 0
  private damageFlash = 0
  private crosshairKick = 0
  private footstepDistance = 0
  private radarTimer = 0
  private fpsTimer = 0
  private fpsFrames = 0
  private fpsValue = 60
  private basePixelRatio = 1
  private adaptiveResolutionScale = 1
  private lowFpsSamples = 0
  private highFpsSamples = 0
  private hudTimer = 0
  private weaponDropPity = 0
  private ammoDropPity = 0
  private disposed = false
  private viewMode: ViewMode = 'firstPerson'
  private lastFrameTime = performance.now()

  constructor(canvas: HTMLCanvasElement, initialSettings: Partial<GameSettings> = {}) {
    this.canvas = canvas
    this.settings = { ...DEFAULT_SETTINGS, ...initialSettings }
    this.difficulty = DIFFICULTIES[this.settings.difficulty]
    this.ui = this.captureUI()

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.24
    this.renderer.setClearColor(0x8eb5c8)
    this.scene.add(this.camera)
    const cameraFill = new THREE.PointLight(0xb9edff, 0.72, 10, 2)
    cameraFill.position.set(0, 0.1, 0.25)
    this.camera.add(cameraFill)

    this.applyQuality(this.settings.quality)
    this.environment = new Environment(this.scene, this.renderer, this.settings)
    this.effects = new EffectsSystem(this.scene)
    this.buildWorld(this.settings.seed)

    this.weapon = new WeaponSystem(this.camera, this.audio, {
      shoot: (definition, muzzle) => this.fireWeapon(definition, muzzle),
      recoil: (pitch, yaw) => {
        this.player.pitch = THREE.MathUtils.clamp(this.player.pitch + pitch, -1.5, 1.5)
        this.player.yaw += yaw
        this.crosshairKick = Math.max(this.crosshairKick, pitch * 180)
      },
      changed: (definition, ammo, reloading) => this.updateWeaponUI(definition, ammo, reloading),
      dryFire: () => this.addFeed('弹匣已空', 'warning'),
    })
    this.weapon.root.visible = false
    this.updateWeaponUI(this.weapon.getDefinition(), this.weapon.getAmmoState(), false)

    const selectionMaterial = new THREE.LineBasicMaterial({ color: 0x72f3ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })
    this.selection = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.018, 1.018, 1.018)), selectionMaterial)
    this.selection.visible = false
    this.selection.renderOrder = 8
    this.scene.add(this.selection)

    this.ui.highScore.textContent = this.highScore.toLocaleString('zh-CN')
    this.attachEvents()
    this.resize()
    this.setState('menu')
    this.finishLoading()
    this.lastFrameTime = performance.now()
    requestAnimationFrame(() => this.loop())
  }

  start(settings: GameSettings): void {
    this.audio.resume().catch(() => undefined)
    const seedChanged = settings.seed !== this.world.seed
    this.clearRunObjects()
    this.settings = { ...settings }
    this.difficulty = DIFFICULTIES[this.settings.difficulty]
    this.audio.setVolume(this.settings.volume)
    this.applyQuality(this.settings.quality)
    if (seedChanged) this.buildWorld(this.settings.seed)
    this.player.sensitivity = this.mapSensitivity(this.settings.sensitivity)
    this.player.reset(this.world.getSpawnFeet())
    this.weapon.reset()
    this.weapon.root.visible = true
    for (const crate of this.supplyCrates) {
      crate.cooldown = 0
      crate.openTimer = 0
    }

    this.score = 0
    this.kills = 0
    this.combo = 1
    this.comboTimer = 0
    this.grenades = 3
    this.buildStock = 28
    this.runTime = 0
    this.hudTimer = 0
    this.weaponDropPity = 0
    this.ammoDropPity = 0
    this.wave = 1
    this.wavePhase = 'delay'
    this.waveDelay = 2.4
    this.waveQueue = []
    this.waveTotal = 0
    this.blockDamage.clear()
    this.announce('白昼协议启动', `世界种子 ${this.settings.seed} · ${this.difficulty.label}难度`)
    this.addFeed('任务：存活五轮敌袭 · 搜集战利品与武器', 'system')
    this.addFeed('新增协议：V 切换视角 · F 战术冲刺', 'system')
    this.setState('playing')
    this.requestPointerLock()
    this.updateHUD(0, true)
  }

  resume(): void {
    if (this.state !== 'paused') return
    this.audio.resume().catch(() => undefined)
    this.requestPointerLock()
  }

  restart(): void {
    this.start({ ...this.settings })
  }

  returnToMenu(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock()
    this.clearRunObjects()
    this.weapon.root.visible = false
    this.playerAvatar.setVisible(false)
    this.selection.visible = false
    this.setState('menu')
  }

  getSettings(): GameSettings {
    return { ...this.settings }
  }

  private captureUI(): UIElements {
    const get = <T extends HTMLElement>(id: string): T => {
      const element = document.getElementById(id)
      if (!element) throw new Error(`Missing UI element #${id}`)
      return element as T
    }
    return {
      loading: get('loading-screen'),
      loadingBar: get('loading-bar-fill'),
      loadingText: get('loading-text'),
      menu: get('main-menu'),
      hud: get('hud'),
      pause: get('pause-menu'),
      end: get('end-screen'),
      endTitle: get('end-title'),
      endSubtitle: get('end-subtitle'),
      endScore: get('end-score'),
      endKills: get('end-kills'),
      endTime: get('end-time'),
      healthValue: get('health-value'),
      healthFill: get('health-fill'),
      shieldValue: get('shield-value'),
      shieldFill: get('shield-fill'),
      staminaFill: get('stamina-fill'),
      weaponName: get('weapon-name'),
      weaponCode: get('weapon-code'),
      ammoCurrent: get('ammo-current'),
      ammoReserve: get('ammo-reserve'),
      reload: get('reload-progress'),
      reloadFill: get('reload-fill'),
      grenades: get('grenade-count'),
      build: get('build-count'),
      score: get('score-value'),
      highScore: get('high-score-value'),
      combo: get('combo-value'),
      wave: get('wave-value'),
      waveRemaining: get('wave-remaining'),
      objective: get('objective-text'),
      fps: get('fps-value'),
      crosshair: get('crosshair'),
      hitmarker: get('hitmarker'),
      damage: get('damage-overlay'),
      announcement: get('announcement'),
      announceTitle: get('announce-title'),
      announceSubtitle: get('announce-subtitle'),
      feed: get('event-feed'),
      radar: get<HTMLCanvasElement>('radar'),
      interactHint: get('interact-hint'),
      arsenal: get('arsenal-slots'),
    }
  }

  private buildWorld(seed: number): void {
    this.clearSupplyCrates()
    if (this.world) this.world.dispose()
    this.removeBeaconLights()
    this.world = new VoxelWorld(this.scene, seed)
    this.world.generate()
    this.player = new Player(this.camera, this.world)
    this.player.sensitivity = this.mapSensitivity(this.settings.sensitivity)
    this.player.reset(this.world.getSpawnFeet())
    this.addBeaconLights()
    this.createSupplyCrates()
    this.camera.position.set(18, 15, 25)
    this.camera.lookAt(0, 6, 0)
  }

  private addBeaconLights(): void {
    for (const position of this.world.glowPositions.slice(0, 12)) {
      const light = new THREE.PointLight(0x54eaff, 1.7, 8, 2)
      light.position.copy(position)
      this.scene.add(light)
      this.beaconLights.push(light)
    }
  }

  private removeBeaconLights(): void {
    for (const light of this.beaconLights) this.scene.remove(light)
    this.beaconLights.length = 0
  }

  private createSupplyCrates(): void {
    const rng = mulberry32(this.world.seed ^ 0x41c6ce57)
    const anchors: Array<[number, number]> = [
      [0, -8],
      [15, 2],
      [-16, 6],
      [21, 19],
      [-22, -17],
      [7, 28],
    ]

    for (let index = 0; index < anchors.length; index += 1) {
      const [anchorX, anchorZ] = anchors[index]
      const x = THREE.MathUtils.clamp(Math.round(anchorX + (rng() - 0.5) * 4), this.world.minX + 3, this.world.minX + this.world.width - 4)
      const z = THREE.MathUtils.clamp(Math.round(anchorZ + (rng() - 0.5) * 4), this.world.minZ + 3, this.world.minZ + this.world.depth - 4)
      const baseY = this.world.getHighestSolidY(x, z) + 1.02
      const group = new THREE.Group()
      group.position.set(x + 0.5, baseY, z + 0.5)
      group.rotation.y = rng() * Math.PI * 2

      const shell = new THREE.MeshStandardMaterial({ color: 0x26343d, roughness: 0.38, metalness: 0.76 })
      const dark = new THREE.MeshStandardMaterial({ color: 0x101920, roughness: 0.6, metalness: 0.42 })
      const accent = new THREE.MeshStandardMaterial({
        color: 0xffd16b,
        emissive: 0xffa83f,
        emissiveIntensity: 2.1,
        roughness: 0.28,
        metalness: 0.42,
      })
      const hologram = new THREE.MeshBasicMaterial({ color: 0xffd16b, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false })

      const body = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.62, 0.84), shell)
      body.position.y = 0.31
      body.castShadow = true
      body.receiveShadow = true
      group.add(body)

      const bumperFront = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.18, 0.12), dark)
      bumperFront.position.set(0, 0.23, 0.46)
      const bumperBack = bumperFront.clone()
      bumperBack.position.z = -0.46
      group.add(bumperFront, bumperBack)

      const lid = new THREE.Group()
      lid.position.set(0, 0.6, -0.38)
      const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.18, 0.86), shell)
      lidMesh.position.set(0, 0.09, 0.38)
      lidMesh.castShadow = true
      lid.add(lidMesh)
      const lidStrip = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.045, 0.9), accent)
      lidStrip.position.set(0, 0.19, 0.38)
      lid.add(lidStrip)
      group.add(lid)

      const ammoRack = new THREE.Group()
      ammoRack.position.set(0, 0.78, 0.05)
      for (let roundIndex = -2; roundIndex <= 2; roundIndex += 1) {
        const round = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8), accent)
        round.rotation.x = Math.PI / 2
        round.position.x = roundIndex * 0.16
        ammoRack.add(round)
      }
      group.add(ammoRack)

      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.025, 6, 28), hologram)
      ring.position.y = 1.42
      ring.rotation.x = Math.PI / 2
      ring.renderOrder = 4
      group.add(ring)

      const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), accent)
      marker.position.y = 1.42
      group.add(marker)

      this.scene.add(group)
      this.supplyCrates.push({
        group,
        lid,
        ring,
        accent,
        cooldown: 0,
        maxCooldown: 20,
        openTimer: 0,
        phase: rng() * Math.PI * 2,
        baseY,
      })
    }
  }

  private clearSupplyCrates(): void {
    for (const crate of this.supplyCrates) this.disposeGroup(crate.group)
    this.supplyCrates.length = 0
  }

  private updateSupplyCrates(dt: number, interactive: boolean): void {
    for (const crate of this.supplyCrates) {
      crate.phase += dt
      crate.cooldown = Math.max(0, crate.cooldown - dt)
      crate.openTimer = Math.max(0, crate.openTimer - dt)
      const x = Math.floor(crate.group.position.x)
      const z = Math.floor(crate.group.position.z)
      const targetY = this.world.getHighestSolidY(x, z) + 1.02
      crate.baseY = THREE.MathUtils.lerp(crate.baseY, targetY, 1 - Math.exp(-5 * dt))
      crate.group.position.y = crate.baseY + Math.sin(crate.phase * 1.8) * 0.012

      const active = crate.cooldown <= 0
      const nearby = interactive && crate.group.position.distanceTo(this.player.position) < 4
      const pulse = 1 + Math.sin(crate.phase * 4) * 0.06 + (nearby ? 0.08 : 0)
      crate.ring.rotation.z += dt * (active ? 0.9 : 0.2)
      crate.ring.scale.setScalar(pulse)
      crate.ring.visible = active || crate.cooldown < 3
      const ringMaterial = crate.ring.material
      if (ringMaterial instanceof THREE.MeshBasicMaterial) {
        ringMaterial.opacity = active ? 0.62 + Math.sin(crate.phase * 5) * 0.12 : 0.12 + (1 - crate.cooldown / crate.maxCooldown) * 0.18
      }
      crate.accent.emissiveIntensity = active ? 2.1 + Math.sin(crate.phase * 5) * 0.55 : 0.18 + (1 - crate.cooldown / crate.maxCooldown) * 0.45
      const openAmount = Math.min(1, crate.openTimer * 3.2)
      crate.lid.rotation.x = -openAmount * 0.78
    }
  }

  private getNearestSupplyCrate(maxDistance = 3): SupplyCrate | null {
    let nearest: SupplyCrate | null = null
    let nearestDistance = maxDistance
    for (const crate of this.supplyCrates) {
      const distance = crate.group.position.distanceTo(this.player.position)
      if (distance < nearestDistance) {
        nearest = crate
        nearestDistance = distance
      }
    }
    return nearest
  }

  private useNearestSupplyCrate(): void {
    const crate = this.getNearestSupplyCrate(3.1)
    if (!crate) return
    if (crate.cooldown > 0) {
      this.addFeed(`补给箱充能中：${Math.ceil(crate.cooldown)} 秒`, 'warning')
      this.audio.dryFire()
      return
    }
    const rounds = this.weapon.resupply(1.08)
    if (rounds <= 0) {
      this.addFeed('当前弹药已满', 'warning')
      this.audio.ui(240)
      return
    }
    crate.cooldown = crate.maxCooldown
    crate.openTimer = 1.2
    this.score += 60
    this.audio.pickup()
    const burstPosition = crate.group.position.clone().add(new THREE.Vector3(0, 0.9, 0))
    this.effects.flash(burstPosition, 0xffd16b, 4.5, 8, 0.18)
    this.effects.burst(burstPosition, { count: 28, color: 0xffd16b, speed: 4.2, life: 0.7, size: 0.07, gravity: 0 })
    this.addFeed(`弹药补给箱：恢复 ${rounds} 发`, 'pickup')
  }

  private applyQuality(quality: GameSettings['quality']): void {
    const deviceRatio = window.devicePixelRatio || 1
    this.basePixelRatio = quality === 'performance'
      ? Math.min(deviceRatio, 0.95)
      : quality === 'cinematic'
        ? Math.min(deviceRatio, 1.75)
        : Math.min(deviceRatio, 1.35)
    this.adaptiveResolutionScale = 1
    this.lowFpsSamples = 0
    this.highFpsSamples = 0
    this.renderer?.setPixelRatio(this.basePixelRatio)
    if (this.renderer) this.renderer.shadowMap.enabled = quality !== 'performance'
  }

  private adjustAdaptiveResolution(): void {
    if (this.state !== 'playing' || this.settings.quality !== 'balanced' || this.runTime < 3) return

    if (this.fpsValue < 48) {
      this.lowFpsSamples += 1
      this.highFpsSamples = 0
    } else if (this.fpsValue > 57) {
      this.highFpsSamples += 1
      this.lowFpsSamples = 0
    } else {
      this.lowFpsSamples = Math.max(0, this.lowFpsSamples - 1)
      this.highFpsSamples = Math.max(0, this.highFpsSamples - 1)
    }

    let nextScale = this.adaptiveResolutionScale
    if (this.lowFpsSamples >= 3) {
      nextScale = Math.max(0.72, this.adaptiveResolutionScale - 0.08)
      this.lowFpsSamples = 0
    } else if (this.highFpsSamples >= 8) {
      nextScale = Math.min(1, this.adaptiveResolutionScale + 0.05)
      this.highFpsSamples = 0
    }

    if (Math.abs(nextScale - this.adaptiveResolutionScale) < 0.001) return
    this.adaptiveResolutionScale = nextScale
    this.renderer.setPixelRatio(this.basePixelRatio * this.adaptiveResolutionScale)
  }

  private attachEvents(): void {
    window.addEventListener('resize', () => this.resize())
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Tab') event.preventDefault()
      if (this.state !== 'playing') return
      this.player.setKey(event.code, true)
      if (event.repeat) return
      if (/^Digit[1-6]$/.test(event.code)) {
        const index = Number(event.code.slice(-1)) - 1
        const target = WEAPONS[index]
        if (target && !this.weapon.isUnlocked(target.id)) this.addFeed(`${target.code} 尚未解锁`, 'warning')
        else this.weapon.switchWeapon(index)
      } else if (event.code === 'KeyR') this.weapon.reload()
      else if (event.code === 'KeyG') this.throwGrenade()
      else if (event.code === 'KeyQ') this.placeBlock()
      else if (event.code === 'KeyE') this.useNearestSupplyCrate()
      else if (event.code === 'KeyV') this.toggleViewMode()
      else if (event.code === 'KeyF') this.dashPlayer()
    })
    window.addEventListener('keyup', (event) => {
      if (this.player) this.player.setKey(event.code, false)
    })
    document.addEventListener('mousemove', (event) => {
      if (this.state !== 'playing' || document.pointerLockElement !== this.canvas) return
      this.player.look(event.movementX, event.movementY)
      this.weapon.addLookSway(event.movementX, event.movementY)
    })
    this.canvas.addEventListener('mousedown', (event) => {
      if (this.state !== 'playing' || document.pointerLockElement !== this.canvas) return
      if (event.button === 0) this.weapon.setTrigger(true)
      if (event.button === 2) this.weapon.setAiming(true)
    })
    window.addEventListener('mouseup', (event) => {
      if (event.button === 0) this.weapon.setTrigger(false)
      if (event.button === 2) this.weapon.setAiming(false)
    })
    this.canvas.addEventListener('wheel', (event) => {
      if (this.state !== 'playing' || document.pointerLockElement !== this.canvas) return
      event.preventDefault()
      this.weapon.cycle(event.deltaY > 0 ? 1 : -1)
    }, { passive: false })
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault())
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas
      if (locked && this.state === 'paused') this.setState('playing')
      else if (!locked && this.state === 'playing') {
        this.weapon.setTrigger(false)
        this.weapon.setAiming(false)
        this.player.clearInput()
        this.setState('paused')
      }
    })
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing' && document.pointerLockElement === this.canvas) document.exitPointerLock()
    })
  }

  private loop(): void {
    if (this.disposed) return
    const now = performance.now()
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05)
    this.lastFrameTime = now
    this.fpsFrames += 1
    this.fpsTimer += dt
    if (this.fpsTimer >= 0.5) {
      this.fpsValue = Math.round(this.fpsFrames / this.fpsTimer)
      this.fpsFrames = 0
      this.fpsTimer = 0
      this.adjustAdaptiveResolution()
    }

    if (this.state === 'menu') this.updatePreview(dt)
    else if (this.state === 'playing') this.updatePlaying(dt)
    else {
      this.effects.update(dt)
      this.updateTransientUI(dt)
    }

    this.environment.update(dt, this.camera.position)
    this.renderer.render(this.scene, this.camera)
    requestAnimationFrame(() => this.loop())
  }

  private updatePreview(dt: number): void {
    this.previewTime += dt
    const radius = 22 + Math.sin(this.previewTime * 0.17) * 3
    const angle = this.previewTime * 0.095 + 0.5
    this.camera.position.set(Math.cos(angle) * radius, 13 + Math.sin(this.previewTime * 0.23) * 2, Math.sin(angle) * radius)
    this.camera.lookAt(0, 6.5, 0)
    this.updateSupplyCrates(dt, false)
    this.effects.update(dt)
  }

  private updatePlaying(dt: number): void {
    this.runTime += dt
    this.player.aiming = this.weapon.getAimAmount() > 0.12
    const movement = this.player.update(dt)
    if (!this.player.alive) {
      this.finishRun(false)
      return
    }

    this.syncViewVisibility()
    if (this.viewMode === 'thirdPerson') this.applyThirdPersonCamera(dt, movement.sprinting)
    this.weapon.update(dt, movement.speed, movement.sprinting)
    this.player.aiming = this.weapon.getAimAmount() > 0.12
    this.updateView(dt, movement.speed, movement.sprinting)
    if (movement.landed) this.audio.step(1.3)
    if (this.player.onGround && movement.speed > 1.2) {
      this.footstepDistance += movement.speed * dt
      const stride = movement.sprinting ? 2.3 : 2.8
      if (this.footstepDistance >= stride) {
        this.footstepDistance = 0
        this.audio.step(movement.sprinting ? 1.2 : 0.8)
      }
    }

    for (const enemy of this.enemies) {
      enemy.update(dt, this.player.position, this.world, this.difficulty, {
        shoot: (source, origin, direction, damage, speed) => this.spawnEnemyProjectile(source, origin, direction, damage, speed),
      })
    }
    this.updateProjectiles(dt)
    this.updateGrenades(dt)
    this.updatePickups(dt)
    this.updateSupplyCrates(dt, true)
    this.updateWave(dt)
    this.updateSelection()
    this.effects.update(dt)

    this.comboTimer -= dt
    if (this.comboTimer <= 0 && this.combo > 1) this.combo = Math.max(1, this.combo - dt * 1.5)
    this.updateTransientUI(dt)
    this.updateHUD(dt)
  }

  private toggleViewMode(): void {
    this.viewMode = this.viewMode === 'firstPerson' ? 'thirdPerson' : 'firstPerson'
    this.syncViewVisibility()
    this.addFeed(this.viewMode === 'thirdPerson' ? '第三人称肩射视角已启用' : '第一人称视角已启用', 'system')
    this.audio.ui(this.viewMode === 'thirdPerson' ? 540 : 420)
  }

  private dashPlayer(): void {
    if (this.player.dash()) {
      this.crosshairKick = Math.max(this.crosshairKick, 7)
      this.audio.ui(680)
      const burstOrigin = this.player.position.clone().add(new THREE.Vector3(0, -0.65, 0))
      this.effects.burst(burstOrigin, { count: 12, color: 0x75edff, speed: 3.2, life: 0.35, size: 0.055, gravity: 0, drag: 3 })
      return
    }
    if (this.player.dashCooldown > 0) this.addFeed(`冲刺冷却中：${this.player.dashCooldown.toFixed(1)} 秒`, 'warning')
    else this.addFeed('体力不足，无法战术冲刺', 'warning')
    this.audio.dryFire()
  }

  private updateView(dt: number, speed: number, sprinting: boolean): void {
    this.syncViewVisibility()
    if (this.viewMode === 'thirdPerson') this.applyThirdPersonCamera(dt, sprinting)
    this.playerAvatar.update(this.player.position, this.player.yaw, this.player.pitch, dt, speed, sprinting, this.weapon.getDefinition())
  }

  private applyThirdPersonCamera(dt: number, sprinting: boolean): void {
    this.getPlayerLookDirection(this.aimDirection)
    this.thirdPersonRight.set(Math.cos(this.player.yaw), 0, -Math.sin(this.player.yaw)).normalize()
    const distance = this.weapon.getAimAmount() > 0.45 ? 3.8 : 5.05
    const shoulder = this.weapon.getAimAmount() > 0.45 ? 1.05 : 1.55
    this.thirdPersonTarget.copy(this.player.position).addScaledVector(this.aimDirection, 0.55)
    this.thirdPersonDesired.copy(this.thirdPersonTarget)
      .addScaledVector(this.aimDirection, -distance)
      .addScaledVector(this.thirdPersonRight, shoulder)
    this.thirdPersonDesired.y += 0.62

    this.thirdPersonRay.copy(this.thirdPersonDesired).sub(this.thirdPersonTarget)
    const rayDistance = this.thirdPersonRay.length()
    if (rayDistance > 0.001) {
      this.thirdPersonRay.normalize()
      const hit = this.world.raycast(this.thirdPersonTarget, this.thirdPersonRay, rayDistance)
      if (hit) {
        const safeDistance = Math.max(0.72, hit.distance - 0.22)
        this.thirdPersonDesired.copy(this.thirdPersonTarget).addScaledVector(this.thirdPersonRay, safeDistance)
      }
    }

    this.camera.position.copy(this.thirdPersonDesired)
    this.thirdPersonLookAt.copy(this.thirdPersonTarget).addScaledVector(this.aimDirection, 14)
    this.camera.lookAt(this.thirdPersonLookAt)
    const targetFov = this.weapon.getAimAmount() > 0.45 ? 62 : sprinting ? 76 : 70
    const nextFov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-8 * dt))
    if (Math.abs(nextFov - this.camera.fov) > 0.01) {
      this.camera.fov = nextFov
      this.camera.updateProjectionMatrix()
    }
  }

  private getActionOrigin(target = this.actionOrigin): THREE.Vector3 {
    if (this.viewMode === 'thirdPerson') return target.copy(this.player.position)
    return target.copy(this.camera.position)
  }

  private getAimDirection(target = this.aimDirection): THREE.Vector3 {
    if (this.viewMode === 'thirdPerson') return this.getPlayerLookDirection(target)
    return this.camera.getWorldDirection(target).normalize()
  }

  private getPlayerLookDirection(target = this.aimDirection): THREE.Vector3 {
    const cosPitch = Math.cos(this.player.pitch)
    target.set(
      -Math.sin(this.player.yaw) * cosPitch,
      Math.sin(this.player.pitch),
      -Math.cos(this.player.yaw) * cosPitch,
    )
    return target.normalize()
  }

  private getMuzzlePosition(fallback: THREE.Vector3): THREE.Vector3 {
    if (this.viewMode === 'firstPerson') return fallback
    return this.playerAvatar.muzzle.getWorldPosition(this.thirdPersonMuzzle)
  }

  private syncViewVisibility(): void {
    const inRun = this.state === 'playing' || this.state === 'paused'
    this.weapon.root.visible = inRun && this.viewMode === 'firstPerson'
    this.playerAvatar.setVisible(inRun && this.viewMode === 'thirdPerson')
  }

  private requestPointerLock(): void {
    const request = this.canvas.requestPointerLock() as Promise<void> | void
    if (request && typeof request.catch === 'function') void request.catch(() => undefined)
  }

  private fireWeapon(definition: WeaponDefinition, muzzlePosition: THREE.Vector3): void {
    if (this.state !== 'playing') return
    const origin = this.getActionOrigin(new THREE.Vector3())
    const forward = this.getAimDirection(new THREE.Vector3())
    const visualMuzzle = this.getMuzzlePosition(muzzlePosition)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion)
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion)
    const targetMeshes = this.enemies.filter((enemy) => enemy.alive).flatMap((enemy) => enemy.hitMeshes)
    const moveSpeed = Math.hypot(this.player.velocity.x, this.player.velocity.z)
    const movementSpread = 1 + Math.min(0.55, moveSpeed * 0.055) + (this.player.onGround ? 0 : 0.5)
    const effectiveSpread = definition.spread * this.weapon.getSpreadMultiplier() * movementSpread

    if (definition.id !== 'railgun') {
      const casingOrigin = visualMuzzle.clone().addScaledVector(right, 0.08).addScaledVector(up, 0.03)
      this.effects.burst(casingOrigin, {
        count: definition.id === 'shotgun' ? 2 : 1,
        color: 0xd3a64e,
        speed: 2.2,
        life: 0.58,
        size: 0.035,
        gravity: 8,
        direction: right,
        spread: 0.7,
      })
    }

    for (let pellet = 0; pellet < definition.pellets; pellet += 1) {
      const direction = forward.clone()
      const radial = Math.sqrt(Math.random()) * effectiveSpread
      const theta = Math.random() * Math.PI * 2
      direction.addScaledVector(right, Math.cos(theta) * radial)
      direction.addScaledVector(up, Math.sin(theta) * radial)
      direction.normalize()

      const worldHit = this.world.raycast(origin, direction, definition.range)
      let hitDistance = worldHit?.distance ?? definition.range
      let endPoint = origin.clone().addScaledVector(direction, hitDistance)
      let enemyHit: THREE.Intersection | undefined

      if (targetMeshes.length > 0) {
        this.raycaster.set(origin, direction)
        this.raycaster.near = 0
        this.raycaster.far = Math.min(definition.range, hitDistance)
        enemyHit = this.raycaster.intersectObjects(targetMeshes, false).find((intersection) => {
          const enemy = intersection.object.userData.enemy as Enemy | undefined
          return Boolean(enemy?.alive)
        })
      }

      if (enemyHit) {
        hitDistance = enemyHit.distance
        endPoint = enemyHit.point.clone()
        const enemy = enemyHit.object.userData.enemy as Enemy
        const part = enemyHit.object.userData.part as string
        const multiplier = part === 'head' ? 1.75 : part === 'core' ? 1.32 : 1
        const headshot = part === 'head'
        const damage = definition.damage * multiplier
        const died = enemy.applyDamage(damage)
        const normal = enemyHit.face?.normal
          ? enemyHit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(enemyHit.object.matrixWorld)).normalize()
          : direction.clone().negate()
        this.effects.burst(endPoint, {
          count: headshot ? 10 : 6,
          color: enemy.definition.accent,
          speed: headshot ? 5.8 : 4.1,
          life: 0.42,
          size: 0.055,
          gravity: 2,
          direction: normal,
          spread: 1.4,
        })
        this.effects.ring(endPoint, normal, headshot ? 0xffffff : definition.tracerColor, headshot ? 0.15 : 0.1)
        this.audio.hit(headshot)
        this.showHitmarker(headshot, died)
        if (died) this.killEnemy(enemy, headshot)
      } else if (worldHit) {
        endPoint = worldHit.point.clone()
        this.damageBlock(worldHit.x, worldHit.y, worldHit.z, worldHit.type, definition.blockDamage, worldHit.point, worldHit.normal)
      }

      const tracerRadius = definition.id === 'railgun' ? 0.034 : definition.id === 'lmg' ? 0.016 : definition.id === 'marksman' ? 0.018 : 0.012
      const tracerLife = definition.id === 'railgun' ? 0.15 : definition.id === 'marksman' ? 0.085 : 0.065
      this.effects.tracer(visualMuzzle, endPoint, definition.tracerColor, tracerRadius, tracerLife)
    }
    const kick = definition.id === 'shotgun' ? 16 : definition.id === 'railgun' ? 12 : definition.id === 'lmg' ? 8 : definition.id === 'smg' ? 5 : 6
    this.crosshairKick = Math.max(this.crosshairKick, kick * THREE.MathUtils.lerp(1, 0.62, this.weapon.getAimAmount()))
  }

  private damageBlock(
    x: number,
    y: number,
    z: number,
    type: BlockType,
    damage: number,
    point: THREE.Vector3,
    normal: THREE.Vector3,
  ): void {
    const color = BLOCK_COLORS[type] ?? 0xffffff
    this.effects.burst(point, { count: 4, color, speed: 2.4, life: 0.45, size: 0.055, gravity: 7, direction: normal, spread: 1.35 })
    this.effects.ring(point, normal, color, 0.08)
    if (type === BlockType.Bedrock) return
    const key = `${x},${y},${z}`
    const total = (this.blockDamage.get(key) ?? 0) + damage
    const durability = BLOCK_DURABILITY[type] ?? 3
    if (total >= durability) {
      this.blockDamage.delete(key)
      if (this.world.removeBlock(x, y, z)) {
        this.audio.blockBreak()
        this.effects.burst(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), {
          count: 14,
          color,
          speed: 4.3,
          life: 0.8,
          size: 0.11,
          gravity: 10,
        })
      }
    } else this.blockDamage.set(key, total)
  }

  private placeBlock(): void {
    if (this.buildStock <= 0) {
      this.addFeed('纳米方块耗尽', 'warning')
      this.audio.dryFire()
      return
    }
    const direction = this.getAimDirection(new THREE.Vector3())
    const hit = this.world.raycast(this.getActionOrigin(new THREE.Vector3()), direction, 6.5)
    if (!hit || hit.normal.lengthSq() === 0 || hit.type === BlockType.Bedrock) return
    const x = hit.x + Math.round(hit.normal.x)
    const y = hit.y + Math.round(hit.normal.y)
    const z = hit.z + Math.round(hit.normal.z)
    if (this.world.getBlock(x, y, z) !== BlockType.Air || this.player.intersectsBlock(x, y, z)) {
      this.addFeed('无法在此部署方块', 'warning')
      return
    }
    const enemyTooClose = this.enemies.some((enemy) => enemy.alive && enemy.getCenter(new THREE.Vector3()).distanceTo(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5)) < 1)
    if (enemyTooClose) return
    if (this.world.setBlock(x, y, z, BlockType.Metal)) {
      this.buildStock -= 1
      this.audio.build()
      this.effects.burst(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), {
        count: 10,
        color: BLOCK_COLORS[BlockType.Metal],
        speed: 2.2,
        life: 0.4,
        size: 0.06,
        gravity: 2,
      })
      this.crosshairKick = 4
      this.updateHUD(0, true)
    }
  }

  private throwGrenade(): void {
    if (this.grenades <= 0) {
      this.addFeed('电浆手雷耗尽', 'warning')
      this.audio.dryFire()
      return
    }
    this.grenades -= 1
    const group = new THREE.Group()
    const shellMaterial = new THREE.MeshStandardMaterial({ color: 0x27313b, roughness: 0.35, metalness: 0.82 })
    const glowMaterial = new THREE.MeshStandardMaterial({ color: 0xff9e50, emissive: 0xff6d2e, emissiveIntensity: 2.6 })
    const shell = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), shellMaterial)
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 12), glowMaterial)
    band.rotation.x = Math.PI / 2
    group.add(shell, band)
    const forward = this.getAimDirection(new THREE.Vector3())
    group.position.copy(this.getActionOrigin(new THREE.Vector3())).addScaledVector(forward, 0.55)
    this.scene.add(group)
    this.grenadesInWorld.push({
      group,
      velocity: forward.multiplyScalar(12.5).add(new THREE.Vector3(0, 4.2, 0)).addScaledVector(this.player.velocity, 0.35),
      fuse: 2.15,
      bounces: 0,
    })
    this.audio.ui(260)
    this.updateHUD(0, true)
  }

  private updateGrenades(dt: number): void {
    for (let i = this.grenadesInWorld.length - 1; i >= 0; i -= 1) {
      const grenade = this.grenadesInWorld[i]
      grenade.fuse -= dt
      const previous = grenade.group.position.clone()
      grenade.velocity.y -= 18 * dt
      const displacement = grenade.velocity.clone().multiplyScalar(dt)
      const distance = displacement.length()
      if (distance > 0) {
        const direction = displacement.clone().normalize()
        const hit = this.world.raycast(previous, direction, distance + 0.12)
        if (hit && hit.distance <= distance + 0.06) {
          grenade.group.position.copy(hit.point).addScaledVector(hit.normal, 0.18)
          grenade.velocity.reflect(hit.normal).multiplyScalar(0.48)
          grenade.velocity.x *= 0.78
          grenade.velocity.z *= 0.78
          grenade.bounces += 1
          this.audio.step(0.45)
        } else grenade.group.position.add(displacement)
      }
      grenade.group.rotation.x += dt * 8
      grenade.group.rotation.z += dt * 11
      const band = grenade.group.children[1]
      if (band instanceof THREE.Mesh && band.material instanceof THREE.MeshStandardMaterial) {
        band.material.emissiveIntensity = 2 + Math.max(0, Math.sin((2.15 - grenade.fuse) * 16)) * (grenade.fuse < 0.7 ? 5 : 2)
      }
      if (grenade.fuse <= 0) {
        this.explodeGrenade(grenade.group.position.clone())
        this.disposeGroup(grenade.group)
        this.grenadesInWorld.splice(i, 1)
      }
    }
  }

  private explodeGrenade(position: THREE.Vector3): void {
    const radius = 5.4
    this.audio.explosion()
    this.effects.flash(position, 0xff7a38, 9, 15, 0.28)
    this.effects.burst(position, { count: 72, color: 0xff873f, speed: 10, life: 1.05, size: 0.13, gravity: 8, drag: 1.5 })
    this.effects.burst(position, { count: 52, color: 0x56636d, speed: 7.5, life: 1.5, size: 0.16, gravity: 11, drag: 1.8 })

    for (const enemy of [...this.enemies]) {
      if (!enemy.alive) continue
      const center = enemy.getCenter(new THREE.Vector3())
      const distance = center.distanceTo(position)
      if (distance > radius) continue
      const direction = center.clone().sub(position).normalize()
      const obstruction = this.world.raycast(position, direction, distance)
      const visibility = obstruction && obstruction.distance < distance - 0.4 ? 0.38 : 1
      const damage = Math.max(0, 155 * (1 - distance / radius) * visibility)
      if (enemy.applyDamage(damage)) this.killEnemy(enemy, false)
    }

    const playerDistance = this.player.position.distanceTo(position)
    if (playerDistance < radius) {
      const direction = this.player.position.clone().sub(position).normalize()
      const obstruction = this.world.raycast(position, direction, playerDistance)
      const visibility = obstruction && obstruction.distance < playerDistance - 0.4 ? 0.3 : 1
      const damage = 72 * (1 - playerDistance / radius) * visibility
      this.damagePlayer(damage)
      this.player.velocity.addScaledVector(direction, 7 * (1 - playerDistance / radius))
      this.player.velocity.y += 3.5 * (1 - playerDistance / radius)
    }

    const removals: Array<{ x: number; y: number; z: number }> = []
    const r = Math.ceil(radius * 0.78)
    for (let z = Math.floor(position.z - r); z <= Math.ceil(position.z + r); z += 1) {
      for (let y = Math.max(1, Math.floor(position.y - r)); y <= Math.min(this.world.height - 1, Math.ceil(position.y + r)); y += 1) {
        for (let x = Math.floor(position.x - r); x <= Math.ceil(position.x + r); x += 1) {
          const type = this.world.getBlock(x, y, z)
          if (type === BlockType.Air || type === BlockType.Bedrock) continue
          const distance = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5).distanceTo(position)
          if (distance > r) continue
          const hardness = type === BlockType.Metal || type === BlockType.Glow ? 0.25 : type === BlockType.Stone ? 0.58 : 0.92
          const chance = (1 - distance / r) * hardness
          if (Math.random() < chance) removals.push({ x, y, z })
        }
      }
    }
    const removed = this.world.removeBlocksBatch(removals.slice(0, 110))
    if (removed > 0) this.addFeed(`爆破移除 ${removed} 个方块`, 'system')
  }

  private spawnEnemyProjectile(enemy: Enemy, origin: THREE.Vector3, direction: THREE.Vector3, damage: number, speed: number): void {
    if (this.state !== 'playing') return
    const color = enemy.definition.accent
    const material = new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.95 })
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(enemy.type === 'brute' ? 0.17 : 0.11, 0), material)
    mesh.position.copy(origin)
    mesh.renderOrder = 5
    this.scene.add(mesh)
    this.projectiles.push({
      mesh,
      velocity: direction.clone().multiplyScalar(speed),
      damage,
      life: 4.5,
      radius: enemy.type === 'brute' ? 0.24 : 0.17,
      color,
      trailTimer: 0,
    })
    this.audio.enemyShot(enemy.type)
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = this.projectiles[i]
      projectile.life -= dt
      projectile.trailTimer -= dt
      const previous = projectile.mesh.position.clone()
      const displacement = projectile.velocity.clone().multiplyScalar(dt)
      const distance = displacement.length()
      const direction = displacement.clone().normalize()
      const hit = distance > 0 ? this.world.raycast(previous, direction, distance + projectile.radius) : null

      const next = previous.clone().add(displacement)
      const closest = new THREE.Line3(previous, next).closestPointToPoint(this.player.position, true, new THREE.Vector3())
      const hitsPlayer = closest.distanceTo(this.player.position) < 0.43 + projectile.radius
      if (hitsPlayer) {
        this.damagePlayer(projectile.damage)
        this.effects.burst(closest, { count: 12, color: projectile.color, speed: 4.5, life: 0.52, size: 0.07, gravity: 1 })
        this.removeProjectile(i)
        continue
      }
      if (hit && hit.distance <= distance + projectile.radius * 0.5) {
        this.effects.burst(hit.point, { count: 9, color: projectile.color, speed: 3.2, life: 0.5, size: 0.06, gravity: 2, direction: hit.normal, spread: 1.3 })
        this.effects.ring(hit.point, hit.normal, projectile.color, 0.11)
        this.removeProjectile(i)
        continue
      }

      projectile.mesh.position.copy(next)
      projectile.mesh.rotation.x += dt * 9
      projectile.mesh.rotation.y += dt * 13
      if (projectile.trailTimer <= 0) {
        projectile.trailTimer = 0.045
        this.effects.burst(projectile.mesh.position, { count: 1, color: projectile.color, speed: 0.5, life: 0.22, size: 0.045, gravity: 0, drag: 3 })
      }
      if (projectile.life <= 0) this.removeProjectile(i)
    }
  }

  private removeProjectile(index: number): void {
    const projectile = this.projectiles[index]
    this.scene.remove(projectile.mesh)
    projectile.mesh.geometry.dispose()
    ;(projectile.mesh.material as THREE.Material).dispose()
    this.projectiles.splice(index, 1)
  }

  private damagePlayer(amount: number): void {
    if (amount <= 0 || !this.player.alive) return
    const shieldBefore = this.player.shield
    this.player.takeDamage(amount)
    this.damageFlash = Math.min(1, this.damageFlash + 0.28 + amount / 130)
    if (shieldBefore > 0 && this.player.shield <= 0) this.audio.shieldBreak()
    else this.audio.hurt()
    this.crosshairKick = Math.max(this.crosshairKick, 8)
    if (!this.player.alive) this.finishRun(false)
  }

  private killEnemy(enemy: Enemy, headshot: boolean): void {
    const center = enemy.getCenter(new THREE.Vector3())
    const enemyType = enemy.type
    this.scene.remove(enemy.group)
    enemy.dispose()
    const multiplier = Math.max(1, Math.floor(this.combo))
    const gained = Math.round(enemy.definition.score * multiplier * (headshot ? 1.25 : 1))
    this.score += gained
    this.kills += 1
    this.combo = Math.min(5, this.combo + (this.comboTimer > 0 ? 0.5 : 0))
    this.comboTimer = 3.2
    this.effects.flash(center, enemy.definition.accent, 5, 9, 0.16)
    this.effects.burst(center, { count: enemy.type === 'brute' ? 42 : 26, color: enemy.definition.color, speed: enemy.type === 'brute' ? 8 : 6, life: 1, size: enemy.type === 'brute' ? 0.14 : 0.1, gravity: 11 })
    this.effects.burst(center, { count: 22, color: enemy.definition.accent, speed: 7, life: 0.7, size: 0.07, gravity: 4 })
    this.addFeed(`${headshot ? '精准击破' : '目标消灭'} +${gained}`, headshot ? 'critical' : 'kill')
    this.spawnEnemyLoot(enemyType, center)
  }

  private spawnEnemyLoot(enemyType: EnemyType, position: THREE.Vector3): void {
    this.weaponDropPity += 1
    this.ammoDropPity += 1
    const lockedWeapons = this.weapon.getLockedWeaponIds()
    const weaponChance = enemyType === 'brute' ? 0.24 : enemyType === 'sentry' ? 0.14 : 0.065
    const guaranteedWeapon = this.kills === 3 || this.kills === 9 || this.weaponDropPity >= 8
    let droppedWeapon = false

    if (lockedWeapons.length > 0 && (guaranteedWeapon || Math.random() < weaponChance)) {
      const weaponId = guaranteedWeapon
        ? lockedWeapons[0]
        : lockedWeapons[Math.floor(Math.random() * lockedWeapons.length)]
      const offset = new THREE.Vector3(0.55, 0, -0.35).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2)
      this.spawnPickup(position.clone().add(offset), 'weapon', weaponId)
      this.weaponDropPity = 0
      droppedWeapon = true
    }

    const forcedHealth = this.player.health < 48 && !this.pickups.some((pickup) => pickup.kind === 'health')
    const regularDropChance = enemyType === 'brute' ? 1 : enemyType === 'sentry' ? 0.84 : 0.72
    if (forcedHealth || Math.random() < regularDropChance) {
      const kind = forcedHealth ? 'health' : this.chooseLootKind()
      const offset = droppedWeapon
        ? new THREE.Vector3(-0.5, 0, 0.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2)
        : new THREE.Vector3()
      this.spawnPickup(position.clone().add(offset), kind)
      if (kind === 'ammo') this.ammoDropPity = 0
    }

    if (enemyType === 'brute' && Math.random() < 0.34) {
      const bonusKind: PickupKind = this.player.health < 72 ? 'health' : 'ammo'
      this.spawnPickup(position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2)), bonusKind)
      if (bonusKind === 'ammo') this.ammoDropPity = 0
    }
  }

  private chooseLootKind(): PickupKind {
    if (this.ammoDropPity >= 3 || this.weapon.isAmmoLow()) return 'ammo'
    const roll = Math.random()
    if (this.player.health < 72 && roll < 0.34) return 'health'
    if (this.player.shield < 24 && roll < 0.5) return 'shield'
    if (roll < 0.38) return 'ammo'
    if (roll < 0.56) return 'health'
    if (roll < 0.7) return 'shield'
    if (roll < 0.86) return 'build'
    return 'grenade'
  }

  private spawnPickup(position: THREE.Vector3, kind: PickupKind, weaponId?: WeaponId): void {
    if (this.pickups.length >= 32) {
      const oldest = this.pickups.shift()
      if (oldest) this.disposeGroup(oldest.group)
    }

    const weaponDefinition = weaponId ? this.weapon.getDefinitionById(weaponId) : undefined
    const colors: Record<PickupKind, number> = {
      health: 0x64ff91,
      shield: 0x63d8ff,
      ammo: 0xffd16b,
      build: 0xa8c3cf,
      grenade: 0xff8b4f,
      weapon: weaponDefinition?.tracerColor ?? 0xd77cff,
    }
    const color = colors[kind]
    const group = new THREE.Group()
    group.userData.pickupColor = color
    const coreMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: kind === 'weapon' ? 2.6 : 1.85,
      roughness: 0.25,
      metalness: 0.42,
    })
    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x172129, roughness: 0.42, metalness: 0.72 })
    const lightMaterial = new THREE.MeshStandardMaterial({ color: 0xeaf9ff, roughness: 0.38, metalness: 0.18 })
    const ringMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.78, blending: THREE.AdditiveBlending, depthWrite: false })
    const beamMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: kind === 'weapon' ? 0.34 : 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })

    const ring = new THREE.Mesh(new THREE.TorusGeometry(kind === 'weapon' ? 0.48 : 0.39, 0.026, 6, 20), ringMaterial)
    ring.rotation.x = Math.PI / 2
    group.add(ring)

    if (kind === 'health') {
      const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.32, 0.18), lightMaterial)
      const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.085, 0.03), coreMaterial)
      const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.28, 0.03), coreMaterial)
      crossH.position.z = crossV.position.z = 0.105
      group.add(caseMesh, crossH, crossV)
    } else if (kind === 'shield') {
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.25, 0), coreMaterial)
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 6, 18), darkMaterial)
      guard.rotation.x = Math.PI / 2
      group.add(core, guard)
    } else if (kind === 'ammo') {
      const tray = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.32), darkMaterial)
      tray.position.y = -0.08
      group.add(tray)
      for (let i = -1; i <= 1; i += 1) {
        const round = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.4, 8), coreMaterial)
        round.rotation.x = Math.PI / 2
        round.position.set(i * 0.13, 0.06, 0)
        group.add(round)
      }
    } else if (kind === 'build') {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), coreMaterial)
      const cage = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(0.5, 0.5, 0.5)),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }),
      )
      group.add(cube, cage)
    } else if (kind === 'grenade') {
      const grenade = new THREE.Mesh(new THREE.IcosahedronGeometry(0.25, 0), darkMaterial)
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 6, 16), coreMaterial)
      band.rotation.x = Math.PI / 2
      group.add(grenade, band)
    } else {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.18), darkMaterial)
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.055, 0.055), coreMaterial)
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.24, 0.12), darkMaterial)
      body.position.x = -0.02
      barrel.position.x = 0.36
      grip.position.set(-0.12, -0.18, 0)
      grip.rotation.z = -0.22
      group.add(body, barrel, grip)
      group.scale.setScalar(1.08)
    }

    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, kind === 'weapon' ? 0.13 : 0.085, kind === 'weapon' ? 3.2 : 2.4, 8, 1, true), beamMaterial)
    beam.position.y = kind === 'weapon' ? 1.6 : 1.2
    beam.renderOrder = 3
    group.add(beam)

    const groundY = this.world.getHighestSolidY(Math.floor(position.x), Math.floor(position.z)) + 1.18
    group.position.set(position.x, groundY, position.z)
    this.scene.add(group)
    this.pickups.push({
      group,
      kind,
      weaponId,
      life: kind === 'weapon' ? 55 : 34,
      phase: Math.random() * Math.PI * 2,
      baseY: groundY,
      beam,
      magnetized: false,
    })
  }

  private updatePickups(dt: number): void {
    const target = this.player.position.clone().add(new THREE.Vector3(0, -0.55, 0))
    for (let i = this.pickups.length - 1; i >= 0; i -= 1) {
      const pickup = this.pickups[i]
      pickup.life -= dt
      pickup.phase += dt * (pickup.kind === 'weapon' ? 1.7 : 2.4)
      const distance = pickup.group.position.distanceTo(target)
      if (distance < 5.2) pickup.magnetized = true

      if (pickup.magnetized) {
        pickup.group.position.lerp(target, 1 - Math.exp(-8.5 * dt))
      } else {
        pickup.group.position.y = pickup.baseY + Math.sin(pickup.phase) * 0.16
      }
      pickup.group.rotation.y += dt * (pickup.kind === 'weapon' ? 1.1 : 1.8)
      const ring = pickup.group.children[0]
      if (ring) ring.rotation.z += dt * 1.35
      const beamMaterial = pickup.beam.material
      if (beamMaterial instanceof THREE.MeshBasicMaterial) {
        beamMaterial.opacity = (pickup.kind === 'weapon' ? 0.3 : 0.17) + Math.sin(pickup.phase * 1.8) * 0.06
      }

      if (pickup.group.position.distanceTo(target) < 0.95) {
        this.collectPickup(pickup)
        this.disposeGroup(pickup.group)
        this.pickups.splice(i, 1)
        continue
      }
      if (pickup.life <= 0) {
        this.disposeGroup(pickup.group)
        this.pickups.splice(i, 1)
      }
    }
  }

  private collectPickup(pickup: Pickup): void {
    let label = ''
    if (pickup.kind === 'health') {
      const missing = this.player.maxHealth - this.player.health
      if (missing > 0) {
        const healed = Math.min(35, missing)
        this.player.heal(35)
        label = `医疗包 +${Math.round(healed)} 生命`
      } else {
        this.player.addShield(10)
        label = '医疗包转化为护盾 +10'
      }
    } else if (pickup.kind === 'shield') {
      this.player.addShield(28)
      label = '护盾电池 +28'
    } else if (pickup.kind === 'ammo') {
      const added = this.weapon.addAmmo(0.82)
      label = `弹药组件 +${added} 发`
    } else if (pickup.kind === 'build') {
      this.buildStock = Math.min(72, this.buildStock + 16)
      label = '纳米方块 +16'
    } else if (pickup.kind === 'grenade') {
      this.grenades = Math.min(6, this.grenades + 1)
      label = '电浆手雷 +1'
    } else if (pickup.weaponId) {
      const definition = this.weapon.getDefinitionById(pickup.weaponId)
      const unlocked = this.weapon.unlockWeapon(pickup.weaponId, true)
      if (definition && unlocked) {
        label = `武器解锁：${definition.code} ${definition.name}`
        this.announce('新武器已接入', `${definition.code} · ${definition.name} · 已自动装备`)
      } else if (definition) {
        const added = this.weapon.addAmmo(1.5, definition.id)
        label = `${definition.code} 专用弹药 +${added}`
      }
    }

    this.score += pickup.kind === 'weapon' ? 180 : 45
    this.audio.pickup()
    const color = Number(pickup.group.userData.pickupColor ?? 0xffffff)
    this.effects.flash(pickup.group.position, color, pickup.kind === 'weapon' ? 6 : 3.5, 8, 0.18)
    this.effects.burst(pickup.group.position, { count: pickup.kind === 'weapon' ? 30 : 18, color, speed: 4.5, life: 0.65, size: 0.07, gravity: 0 })
    this.addFeed(label || '战利品已拾取', 'pickup')
  }

  private updateWave(dt: number): void {
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      if (!this.enemies[i].alive) this.enemies.splice(i, 1)
    }

    if (this.wavePhase === 'delay') {
      this.waveDelay -= dt
      this.ui.objective.textContent = this.wave === 1 ? '等待战区同步' : `下一轮倒计时 ${Math.max(0, this.waveDelay).toFixed(1)} 秒`
      if (this.waveDelay <= 0) this.beginWave()
      return
    }

    if (this.wavePhase === 'spawning') {
      this.waveSpawnTimer -= dt
      if (this.waveSpawnTimer <= 0 && this.waveQueue.length > 0) {
        const type = this.waveQueue.shift()!
        this.spawnEnemy(type)
        this.waveSpawnTimer = this.wave === 5 ? 0.32 : 0.48
      }
      if (this.waveQueue.length === 0) this.wavePhase = 'active'
    }

    if (this.wavePhase === 'active' && this.enemies.length === 0) {
      if (this.wave >= 5) {
        this.wavePhase = 'complete'
        this.finishRun(true)
      } else {
        this.rewardWaveClear()
        this.wave += 1
        this.wavePhase = 'delay'
        this.waveDelay = 4.4
      }
    }
  }

  private beginWave(): void {
    const baseCounts = [
      { scout: 5, brute: 0, sentry: 0 },
      { scout: 6, brute: 1, sentry: 0 },
      { scout: 7, brute: 2, sentry: 2 },
      { scout: 9, brute: 3, sentry: 3 },
      { scout: 12, brute: 4, sentry: 4 },
    ][this.wave - 1]
    const scale = this.difficulty.spawnScale
    const queue: EnemyType[] = []
    const add = (type: EnemyType, count: number) => {
      for (let i = 0; i < Math.max(type === 'scout' ? 1 : 0, Math.ceil(count * scale)); i += 1) queue.push(type)
    }
    add('scout', baseCounts.scout)
    add('brute', baseCounts.brute)
    add('sentry', baseCounts.sentry)
    for (let i = queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[queue[i], queue[j]] = [queue[j], queue[i]]
    }
    this.waveQueue = queue
    this.waveTotal = queue.length
    this.waveSpawnTimer = 0
    this.wavePhase = 'spawning'
    this.audio.wave()
    this.announce(`第 ${this.wave} 轮`, this.wave === 5 ? '终局攻势 · 全部火力已解锁' : `侦测到 ${this.waveTotal} 个敌对信号`)
    this.addFeed(`第 ${this.wave} 轮敌袭开始`, 'system')
  }

  private spawnEnemy(type: EnemyType): void {
    let position = new THREE.Vector3()
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const angle = Math.random() * Math.PI * 2
      const radius = 23 + Math.random() * 13
      const x = THREE.MathUtils.clamp(Math.round(Math.cos(angle) * radius), this.world.minX + 3, this.world.minX + this.world.width - 4)
      const z = THREE.MathUtils.clamp(Math.round(Math.sin(angle) * radius), this.world.minZ + 3, this.world.minZ + this.world.depth - 4)
      const y = this.world.getHighestSolidY(x, z) + 1
      position.set(x + 0.5, y, z + 0.5)
      if (position.distanceTo(this.player.position) > 16 && !this.world.isSolid(x, y, z) && !this.world.isSolid(x, y + 1, z)) break
    }
    const enemy = new Enemy(type, ++this.enemyId, position, this.difficulty)
    this.enemies.push(enemy)
    this.scene.add(enemy.group)
    const center = enemy.getCenter(new THREE.Vector3())
    this.effects.flash(center, enemy.definition.accent, 3.2, 6, 0.14)
    this.effects.burst(center, { count: 18, color: enemy.definition.accent, speed: 4.2, life: 0.65, size: 0.07, gravity: 0 })
  }

  private rewardWaveClear(): void {
    this.player.heal(16)
    this.player.addShield(22)
    this.weapon.addAmmo(0.6)
    this.buildStock = Math.min(60, this.buildStock + 10)
    this.grenades = Math.min(5, this.grenades + 1)
    const bonus = this.wave * 500
    this.score += bonus
    this.announce('区域肃清', `补给已投送 · 波次奖励 +${bonus}`)
    this.addFeed('生命、护盾与弹药已补充', 'pickup')
    this.audio.pickup()
  }

  private updateSelection(): void {
    const nearbyCrate = this.getNearestSupplyCrate(3.1)
    if (nearbyCrate) {
      this.selection.visible = false
      this.ui.interactHint.classList.add('visible', 'supply')
      this.ui.interactHint.classList.toggle('cooldown', nearbyCrate.cooldown > 0)
      this.ui.interactHint.textContent = nearbyCrate.cooldown <= 0
        ? '按 E 使用弹药补给箱'
        : `补给箱充能中 ${Math.ceil(nearbyCrate.cooldown)} 秒`
      return
    }

    this.ui.interactHint.classList.remove('supply', 'cooldown')
    const direction = this.getAimDirection(new THREE.Vector3())
    const hit = this.world.raycast(this.getActionOrigin(new THREE.Vector3()), direction, 6.5)
    if (!hit || hit.type === BlockType.Bedrock) {
      this.selection.visible = false
      this.ui.interactHint.classList.remove('visible')
      return
    }
    this.selection.visible = true
    this.selection.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5)
    const pulse = 1 + Math.sin(this.runTime * 6) * 0.008
    this.selection.scale.setScalar(pulse)
    this.ui.interactHint.classList.add('visible')
    this.ui.interactHint.textContent = this.buildStock > 0 ? '按 Q 部署金属方块' : '纳米方块已耗尽'
  }

  private updateHUD(dt = 0, force = false): void {
    this.hudTimer -= dt
    this.radarTimer -= dt
    this.ui.reload.classList.toggle('visible', this.weapon.isReloading())
    this.ui.reloadFill.style.width = `${this.weapon.getReloadProgress() * 100}%`
    this.crosshairKick = Math.max(0, this.crosshairKick - (force ? 0 : dt * 25))
    const aimAmount = this.weapon.getAimAmount()
    this.ui.crosshair.style.setProperty('--spread', `${THREE.MathUtils.lerp(8, 2.4, aimAmount) + this.crosshairKick}px`)
    this.ui.crosshair.classList.toggle('aiming', aimAmount > 0.45)

    if (!force && this.hudTimer > 0) {
      if (this.radarTimer <= 0) {
        this.drawRadar()
        this.radarTimer = 0.1
      }
      return
    }
    this.hudTimer = 0.05
    const health = Math.round(this.player.health)
    const shield = Math.round(this.player.shield)
    this.ui.healthValue.textContent = String(health)
    this.ui.shieldValue.textContent = String(shield)
    this.ui.healthFill.style.width = `${Math.max(0, this.player.health / this.player.maxHealth * 100)}%`
    this.ui.shieldFill.style.width = `${Math.max(0, this.player.shield / this.player.maxShield * 100)}%`
    this.ui.staminaFill.style.width = `${this.player.stamina}%`
    this.ui.score.textContent = Math.floor(this.score).toLocaleString('zh-CN')
    this.ui.combo.textContent = `×${Math.max(1, Math.floor(this.combo))}`
    this.ui.combo.classList.toggle('active', this.combo > 1.2)
    this.ui.wave.textContent = `${this.wave}/5`
    const remaining = this.enemies.filter((enemy) => enemy.alive).length + this.waveQueue.length
    this.ui.waveRemaining.textContent = String(remaining)
    this.ui.grenades.textContent = String(this.grenades)
    this.ui.build.textContent = String(this.buildStock)
    this.ui.fps.textContent = `${this.fpsValue} FPS`
    const definition = this.weapon.getDefinition()
    const ammo = this.weapon.getAmmoState()
    this.updateWeaponUI(definition, ammo, this.weapon.isReloading())
    if (force || this.radarTimer <= 0) {
      this.drawRadar()
      this.radarTimer = 0.1
    }
  }

  private updateWeaponUI(definition: WeaponDefinition, ammo: WeaponAmmoState, reloading: boolean): void {
    this.ui.weaponName.textContent = definition.name
    this.ui.weaponCode.textContent = definition.code
    this.ui.ammoCurrent.textContent = String(ammo.magazine).padStart(2, '0')
    this.ui.ammoReserve.textContent = String(ammo.reserve).padStart(3, '0')
    this.ui.ammoCurrent.classList.toggle('low', ammo.magazine <= Math.max(2, Math.floor(definition.magazine * 0.2)))
    this.ui.reload.classList.toggle('visible', reloading)
    for (const slot of this.ui.arsenal.querySelectorAll<HTMLElement>('[data-weapon-id]')) {
      const id = slot.dataset.weaponId as WeaponId
      slot.classList.toggle('active', id === definition.id)
      slot.classList.toggle('locked', !this.weapon.isUnlocked(id))
      slot.setAttribute('aria-label', this.weapon.isUnlocked(id) ? `${slot.dataset.code ?? id} 已解锁` : `${slot.dataset.code ?? id} 未解锁`)
    }
  }

  private drawRadar(): void {
    const canvas = this.ui.radar
    const size = canvas.width
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const center = size / 2
    const range = 34
    const scale = center / range
    ctx.clearRect(0, 0, size, size)
    ctx.save()
    ctx.beginPath()
    ctx.arc(center, center, center - 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = 'rgba(6, 18, 27, 0.72)'
    ctx.fillRect(0, 0, size, size)
    ctx.strokeStyle = 'rgba(94, 228, 255, 0.13)'
    ctx.lineWidth = 1
    for (let ring = 1; ring <= 3; ring += 1) {
      ctx.beginPath()
      ctx.arc(center, center, (center - 5) * ring / 3, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(center, 0)
    ctx.lineTo(center, size)
    ctx.moveTo(0, center)
    ctx.lineTo(size, center)
    ctx.stroke()

    const rightX = Math.cos(this.player.yaw)
    const rightZ = -Math.sin(this.player.yaw)
    const forwardX = -Math.sin(this.player.yaw)
    const forwardZ = -Math.cos(this.player.yaw)
    const project = (position: THREE.Vector3): [number, number] => {
      const dx = position.x - this.player.position.x
      const dz = position.z - this.player.position.z
      const localX = dx * rightX + dz * rightZ
      const localForward = dx * forwardX + dz * forwardZ
      return [center + localX * scale, center - localForward * scale]
    }

    for (const light of this.world.glowPositions) {
      const [x, y] = project(light)
      if (Math.hypot(x - center, y - center) > center) continue
      ctx.fillStyle = 'rgba(91, 226, 255, 0.35)'
      ctx.fillRect(x - 1, y - 1, 2, 2)
    }
    for (const pickup of this.pickups) {
      const [x, y] = project(pickup.group.position)
      if (Math.hypot(x - center, y - center) > center) continue
      ctx.fillStyle = pickup.kind === 'weapon' ? '#ffe27a' : pickup.kind === 'health' ? '#72ff9c' : '#82ffc1'
      const sizePx = pickup.kind === 'weapon' ? 5 : 4
      ctx.fillRect(x - sizePx / 2, y - sizePx / 2, sizePx, sizePx)
    }
    for (const crate of this.supplyCrates) {
      const [x, y] = project(crate.group.position)
      if (Math.hypot(x - center, y - center) > center) continue
      ctx.strokeStyle = crate.cooldown <= 0 ? '#ffd16b' : 'rgba(255,209,107,.32)'
      ctx.lineWidth = 1.5
      ctx.strokeRect(x - 3, y - 3, 6, 6)
    }
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue
      const [x, y] = project(enemy.group.position)
      if (Math.hypot(x - center, y - center) > center) continue
      ctx.fillStyle = enemy.type === 'brute' ? '#ff9b55' : enemy.type === 'sentry' ? '#d482ff' : '#ff6471'
      ctx.beginPath()
      ctx.moveTo(x, y - (enemy.type === 'brute' ? 4 : 3))
      ctx.lineTo(x + 3, y + 3)
      ctx.lineTo(x - 3, y + 3)
      ctx.closePath()
      ctx.fill()
    }
    const sweep = (this.runTime * 1.4) % (Math.PI * 2)
    const gradient = ctx.createLinearGradient(center, center, center + Math.cos(sweep) * center, center + Math.sin(sweep) * center)
    gradient.addColorStop(0, 'rgba(100,238,255,0)')
    gradient.addColorStop(1, 'rgba(100,238,255,0.38)')
    ctx.strokeStyle = gradient
    ctx.beginPath()
    ctx.moveTo(center, center)
    ctx.lineTo(center + Math.cos(sweep) * center, center + Math.sin(sweep) * center)
    ctx.stroke()
    ctx.restore()

    ctx.fillStyle = '#7ff3ff'
    ctx.beginPath()
    ctx.moveTo(center, center - 6)
    ctx.lineTo(center + 4, center + 5)
    ctx.lineTo(center, center + 3)
    ctx.lineTo(center - 4, center + 5)
    ctx.closePath()
    ctx.fill()
  }

  private updateTransientUI(dt: number): void {
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.65)
    this.ui.damage.style.opacity = String(this.damageFlash)
    this.hitmarkerTimer -= dt
    this.ui.hitmarker.classList.toggle('visible', this.hitmarkerTimer > 0)
    this.announcementTimer -= dt
    this.ui.announcement.classList.toggle('visible', this.announcementTimer > 0)
    this.crosshairKick = THREE.MathUtils.lerp(this.crosshairKick, 0, 1 - Math.exp(-9 * dt))
  }

  private showHitmarker(headshot: boolean, kill: boolean): void {
    this.hitmarkerTimer = kill ? 0.22 : 0.12
    this.ui.hitmarker.classList.toggle('headshot', headshot)
    this.ui.hitmarker.classList.toggle('kill', kill)
  }

  private announce(title: string, subtitle: string): void {
    this.ui.announceTitle.textContent = title
    this.ui.announceSubtitle.textContent = subtitle
    this.announcementTimer = 3.1
    this.ui.announcement.classList.remove('visible')
    void this.ui.announcement.offsetWidth
    this.ui.announcement.classList.add('visible')
  }

  private addFeed(message: string, type: 'system' | 'kill' | 'critical' | 'pickup' | 'warning'): void {
    const item = document.createElement('div')
    item.className = `feed-item ${type}`
    item.textContent = message
    this.ui.feed.prepend(item)
    while (this.ui.feed.children.length > 5) this.ui.feed.lastElementChild?.remove()
    window.setTimeout(() => item.classList.add('leaving'), 3600)
    window.setTimeout(() => item.remove(), 4100)
  }

  private finishRun(victory: boolean): void {
    if (this.state === 'gameover' || this.state === 'victory') return
    this.weapon.setTrigger(false)
    this.weapon.setAiming(false)
    this.player.clearInput()
    if (document.pointerLockElement === this.canvas) document.exitPointerLock()
    const finalScore = Math.floor(this.score + (victory ? 5000 : 0))
    this.score = finalScore
    if (finalScore > this.highScore) {
      this.highScore = finalScore
      localStorage.setItem('voxel-strike-high-score', String(finalScore))
      this.ui.highScore.textContent = finalScore.toLocaleString('zh-CN')
    }
    this.ui.endTitle.textContent = victory ? '协议完成' : '作战中止'
    this.ui.endSubtitle.textContent = victory ? '五轮敌袭已被彻底击退，方块前线安全。' : `你抵达了第 ${this.wave} 轮。重新部署，刷新纪录。`
    this.ui.endScore.textContent = finalScore.toLocaleString('zh-CN')
    this.ui.endKills.textContent = String(this.kills)
    this.ui.endTime.textContent = this.formatTime(this.runTime)
    this.weapon.root.visible = false
    this.selection.visible = false
    this.setState(victory ? 'victory' : 'gameover')
    this.audio.wave()
  }

  private setState(state: GameState): void {
    this.state = state
    document.body.dataset.gameState = state
    this.ui.menu.classList.toggle('visible', state === 'menu')
    this.ui.hud.classList.toggle('visible', state === 'playing' || state === 'paused')
    this.ui.pause.classList.toggle('visible', state === 'paused')
    this.ui.end.classList.toggle('visible', state === 'gameover' || state === 'victory')
    this.canvas.classList.toggle('dimmed', state === 'paused' || state === 'gameover' || state === 'victory')
    if (state === 'playing') this.lastFrameTime = performance.now()
  }

  private clearRunObjects(): void {
    for (const enemy of this.enemies) {
      this.scene.remove(enemy.group)
      enemy.dispose()
    }
    this.enemies.length = 0
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) this.removeProjectile(i)
    for (const grenade of this.grenadesInWorld) this.disposeGroup(grenade.group)
    this.grenadesInWorld.length = 0
    for (const pickup of this.pickups) this.disposeGroup(pickup.group)
    this.pickups.length = 0
    this.waveQueue = []
    this.ui.feed.innerHTML = ''
  }

  private disposeGroup(group: THREE.Group): void {
    this.scene.remove(group)
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line) && !(object instanceof THREE.LineSegments)) return
      geometries.add(object.geometry)
      const material = object.material
      if (Array.isArray(material)) material.forEach((item) => materials.add(item))
      else materials.add(material)
    })
    geometries.forEach((geometry) => geometry.dispose())
    materials.forEach((material) => material.dispose())
  }

  private finishLoading(): void {
    this.ui.loadingBar.style.width = '100%'
    this.ui.loadingText.textContent = '战区构建完成'
    window.setTimeout(() => this.ui.loading.classList.add('hidden'), 420)
  }

  private resize(): void {
    const width = window.innerWidth
    const height = window.innerHeight
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  private mapSensitivity(value: number): number {
    const normalized = THREE.MathUtils.clamp(value, 0.15, 1)
    return 0.00052 + normalized * 0.00162
  }

  private formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60)
    const remaining = Math.floor(seconds % 60)
    return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
  }
}

export { DEFAULT_SETTINGS }
