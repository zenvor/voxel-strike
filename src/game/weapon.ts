import * as THREE from 'three'
import { AudioSystem } from './audio'
import {
  STARTING_WEAPONS,
  WEAPONS,
  type WeaponAmmoState,
  type WeaponDefinition,
  type WeaponId,
} from './types'

export interface WeaponCallbacks {
  shoot: (definition: WeaponDefinition, muzzlePosition: THREE.Vector3) => void
  recoil: (pitch: number, yaw: number) => void
  changed: (definition: WeaponDefinition, ammo: WeaponAmmoState, reloading: boolean) => void
  dryFire: () => void
}

export class WeaponSystem {
  readonly root = new THREE.Group()

  private readonly camera: THREE.PerspectiveCamera
  private readonly audio: AudioSystem
  private readonly callbacks: WeaponCallbacks
  private readonly model = new THREE.Group()
  private readonly muzzle = new THREE.Object3D()
  private readonly muzzleFlash: THREE.Mesh
  private readonly muzzleLight: THREE.PointLight
  private readonly ammo = new Map<WeaponId, WeaponAmmoState>()
  private readonly unlocked = new Set<WeaponId>()
  private readonly modelMaterials: THREE.Material[] = []
  private currentIndex = 0
  private cooldown = 0
  private reloadRemaining = 0
  private reloadDuration = 0
  private triggerHeld = false
  private semiConsumed = false
  private recoilKick = 0
  private recoilSide = 0
  private swayX = 0
  private swayY = 0
  private bobTime = 0
  private flashTime = 0
  private aimRequested = false
  private aimAmount = 0
  private pendingIndex: number | null = null
  private queuedAutoEquipIndex: number | null = null
  private switchElapsed = 0
  private readonly switchDuration = 0.52
  private switchDirection = 1
  private switchSwapped = false

  constructor(camera: THREE.PerspectiveCamera, audio: AudioSystem, callbacks: WeaponCallbacks) {
    this.camera = camera
    this.audio = audio
    this.callbacks = callbacks
    for (const definition of WEAPONS) {
      this.ammo.set(definition.id, { magazine: definition.magazine, reserve: definition.reserve })
    }
    for (const id of STARTING_WEAPONS) this.unlocked.add(id)

    this.root.position.set(0.32, -0.28, -0.48)
    this.camera.add(this.root)
    this.root.add(this.model)
    this.model.add(this.muzzle)

    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffe4a3,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.muzzleFlash = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), flashMaterial)
    this.muzzleFlash.visible = false
    this.muzzle.add(this.muzzleFlash)
    this.muzzleLight = new THREE.PointLight(0xffc46e, 0, 4.5, 2)
    this.muzzle.add(this.muzzleLight)
    this.buildModel()
  }

  reset(): void {
    this.unlocked.clear()
    for (const id of STARTING_WEAPONS) this.unlocked.add(id)
    for (const definition of WEAPONS) {
      this.ammo.set(definition.id, { magazine: definition.magazine, reserve: definition.reserve })
    }
    this.currentIndex = Math.max(0, WEAPONS.findIndex((weapon) => weapon.id === STARTING_WEAPONS[0]))
    this.cooldown = 0
    this.reloadRemaining = 0
    this.reloadDuration = 0
    this.triggerHeld = false
    this.semiConsumed = false
    this.recoilKick = 0
    this.recoilSide = 0
    this.aimRequested = false
    this.aimAmount = 0
    this.pendingIndex = null
    this.queuedAutoEquipIndex = null
    this.switchElapsed = 0
    this.switchSwapped = false
    this.buildModel()
    this.emitChanged()
  }

  setTrigger(held: boolean): void {
    this.triggerHeld = held
    if (!held) this.semiConsumed = false
  }

  setAiming(aiming: boolean): void {
    this.aimRequested = aiming
  }

  addLookSway(deltaX: number, deltaY: number): void {
    const swayScale = THREE.MathUtils.lerp(1, 0.38, this.aimAmount)
    this.swayX = THREE.MathUtils.clamp(this.swayX + deltaX * 0.00038 * swayScale, -0.04, 0.04)
    this.swayY = THREE.MathUtils.clamp(this.swayY + deltaY * 0.0003 * swayScale, -0.032, 0.032)
  }

  update(dt: number, movementSpeed: number, sprinting: boolean): void {
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.flashTime = Math.max(0, this.flashTime - dt)
    this.muzzleFlash.visible = this.flashTime > 0
    this.muzzleLight.intensity = this.flashTime > 0 ? 4.8 * (this.flashTime / 0.06) : 0
    if (this.flashTime > 0) this.muzzleFlash.rotation.z += dt * 48

    if (this.pendingIndex !== null) {
      this.switchElapsed += dt
      const progress = Math.min(1, this.switchElapsed / this.switchDuration)
      if (!this.switchSwapped && progress >= 0.48) {
        this.currentIndex = this.pendingIndex
        this.switchSwapped = true
        this.buildModel()
        this.audio.ui(430 + this.currentIndex * 86)
        this.emitChanged()
      }
      if (progress >= 1) {
        this.pendingIndex = null
        this.switchElapsed = 0
        this.switchSwapped = false
        const queuedIndex = this.queuedAutoEquipIndex
        this.queuedAutoEquipIndex = null
        if (queuedIndex !== null) this.switchWeapon(queuedIndex)
      }
    }

    if (this.reloadRemaining > 0) {
      this.reloadRemaining -= dt
      if (this.reloadRemaining <= 0) this.finishReload()
    }

    const canAim = !sprinting && this.reloadRemaining <= 0 && this.pendingIndex === null
    const aimTarget = this.aimRequested && canAim ? 1 : 0
    this.aimAmount = THREE.MathUtils.lerp(this.aimAmount, aimTarget, 1 - Math.exp(-(aimTarget > this.aimAmount ? 14 : 18) * dt))

    const definition = this.getDefinition()
    if (
      this.triggerHeld &&
      this.cooldown <= 0 &&
      this.reloadRemaining <= 0 &&
      this.pendingIndex === null &&
      (!this.semiConsumed || definition.automatic)
    ) {
      this.fire()
      if (!definition.automatic) this.semiConsumed = true
    }

    this.recoilKick = THREE.MathUtils.lerp(this.recoilKick, 0, 1 - Math.exp(-17 * dt))
    this.recoilSide = THREE.MathUtils.lerp(this.recoilSide, 0, 1 - Math.exp(-14 * dt))
    this.swayX = THREE.MathUtils.lerp(this.swayX, 0, 1 - Math.exp(-9 * dt))
    this.swayY = THREE.MathUtils.lerp(this.swayY, 0, 1 - Math.exp(-9 * dt))

    const moveRatio = Math.min(1, movementSpeed / 6)
    if (movementSpeed > 0.2) this.bobTime += dt * (sprinting ? 13 : 9.5)
    const aimBobScale = THREE.MathUtils.lerp(1, 0.24, this.aimAmount)
    const bobX = Math.sin(this.bobTime) * 0.018 * moveRatio * aimBobScale
    const bobY = Math.abs(Math.cos(this.bobTime)) * 0.017 * moveRatio * aimBobScale
    const sprintDrop = sprinting ? 0.13 : 0
    const switchProgress = this.pendingIndex === null ? 0 : Math.min(1, this.switchElapsed / this.switchDuration)
    const switchArc = this.pendingIndex === null ? 0 : Math.sin(switchProgress * Math.PI)
    const switchSide = this.pendingIndex === null ? 0 : Math.sin(switchProgress * Math.PI * 2) * 0.05 * this.switchDirection
    const reloadProgress = this.reloadDuration > 0 && this.reloadRemaining > 0 ? 1 - this.reloadRemaining / this.reloadDuration : 0
    const reloadArc = this.reloadRemaining > 0 ? Math.sin(reloadProgress * Math.PI) : 0

    const baseX = THREE.MathUtils.lerp(0.32, 0.006, this.aimAmount)
    const baseY = THREE.MathUtils.lerp(-0.28, -0.205, this.aimAmount)
    const baseZ = THREE.MathUtils.lerp(-0.48, -0.315, this.aimAmount)
    this.root.position.x = baseX + bobX + this.recoilSide + switchSide
    this.root.position.y = baseY - bobY - sprintDrop - switchArc * 0.34 - reloadArc * 0.105
    this.root.position.z = baseZ + this.recoilKick * THREE.MathUtils.lerp(1.55, 0.95, this.aimAmount)
    this.root.rotation.x = -this.swayY + sprintDrop * 0.4 + reloadArc * 0.42 + switchArc * 0.22
    this.root.rotation.y = -this.swayX + this.recoilSide * 1.8 + switchSide * 2.1
    this.root.rotation.z = -bobX * 1.7 + reloadArc * 0.38 + (sprinting ? -0.08 : 0) + switchArc * -0.34 * this.switchDirection
    this.root.scale.setScalar(1 - switchArc * 0.055)
  }

  reload(): void {
    const definition = this.getDefinition()
    const state = this.getAmmoState()
    if (this.reloadRemaining > 0 || this.pendingIndex !== null || state.magazine >= definition.magazine || state.reserve <= 0) return
    this.aimRequested = false
    this.reloadDuration = definition.reloadTime
    this.reloadRemaining = definition.reloadTime
    this.audio.reload()
    this.emitChanged()
  }

  switchWeapon(index: number): boolean {
    if (index < 0 || index >= WEAPONS.length) return false
    const target = WEAPONS[index]
    if (!this.unlocked.has(target.id)) return false
    if (index === this.currentIndex && this.pendingIndex === null) return true
    if (this.pendingIndex !== null) return false
    this.switchDirection = index >= this.currentIndex ? 1 : -1
    this.pendingIndex = index
    this.switchElapsed = 0
    this.switchSwapped = false
    this.reloadRemaining = 0
    this.reloadDuration = 0
    this.triggerHeld = false
    this.semiConsumed = false
    this.aimRequested = false
    return true
  }

  cycle(direction: number): void {
    const unlockedIndices = WEAPONS.map((weapon, index) => ({ weapon, index }))
      .filter(({ weapon }) => this.unlocked.has(weapon.id))
      .map(({ index }) => index)
    if (unlockedIndices.length <= 1 || this.pendingIndex !== null) return
    const currentSlot = Math.max(0, unlockedIndices.indexOf(this.currentIndex))
    const nextSlot = (currentSlot + (direction >= 0 ? 1 : -1) + unlockedIndices.length) % unlockedIndices.length
    this.switchWeapon(unlockedIndices[nextSlot])
  }

  unlockWeapon(id: WeaponId, autoEquip = true): boolean {
    const definition = WEAPONS.find((weapon) => weapon.id === id)
    if (!definition) return false
    const newlyUnlocked = !this.unlocked.has(id)
    this.unlocked.add(id)
    const state = this.ammo.get(id)
    if (state) {
      state.magazine = Math.max(state.magazine, definition.magazine)
      state.reserve = Math.max(state.reserve, definition.reserve)
    }
    if (newlyUnlocked && autoEquip) {
      const index = WEAPONS.findIndex((weapon) => weapon.id === id)
      if (this.pendingIndex !== null) {
        this.queuedAutoEquipIndex = index
        this.emitChanged()
      } else this.switchWeapon(index)
    } else this.emitChanged()
    return newlyUnlocked
  }

  isUnlocked(id: WeaponId): boolean {
    return this.unlocked.has(id)
  }

  getLockedWeaponIds(): WeaponId[] {
    return WEAPONS.filter((weapon) => !this.unlocked.has(weapon.id)).map((weapon) => weapon.id)
  }

  getUnlockedWeaponIds(): WeaponId[] {
    return WEAPONS.filter((weapon) => this.unlocked.has(weapon.id)).map((weapon) => weapon.id)
  }

  addAmmo(amountScale = 1, weaponId?: WeaponId): number {
    let added = 0
    for (const definition of WEAPONS) {
      if (weaponId && definition.id !== weaponId) continue
      if (!this.unlocked.has(definition.id)) continue
      const state = this.ammo.get(definition.id)
      if (!state) continue
      const before = state.reserve
      state.reserve = Math.min(definition.reserve * 2, state.reserve + Math.ceil(definition.magazine * amountScale))
      added += state.reserve - before
    }
    if (added > 0) this.emitChanged()
    return added
  }

  resupply(amountScale = 1): number {
    let added = 0
    const currentId = this.getDefinition().id
    for (const definition of WEAPONS) {
      if (!this.unlocked.has(definition.id)) continue
      const state = this.ammo.get(definition.id)
      if (!state) continue
      if (definition.id === currentId) {
        const beforeMagazine = state.magazine
        state.magazine = definition.magazine
        added += state.magazine - beforeMagazine
      }
      const beforeReserve = state.reserve
      const reserveGain = Math.ceil(definition.magazine * (definition.id === currentId ? amountScale : amountScale * 0.62))
      state.reserve = Math.min(definition.reserve * 2, state.reserve + reserveGain)
      added += state.reserve - beforeReserve
    }
    if (added > 0) {
      this.reloadRemaining = 0
      this.reloadDuration = 0
      this.emitChanged()
    }
    return added
  }

  isAmmoLow(): boolean {
    const definition = this.getDefinition()
    const state = this.getAmmoState()
    return state.magazine + state.reserve <= definition.magazine * 1.35
  }

  getDefinition(): WeaponDefinition {
    return WEAPONS[this.currentIndex]
  }

  getDefinitionById(id: WeaponId): WeaponDefinition | undefined {
    return WEAPONS.find((weapon) => weapon.id === id)
  }

  getAmmoState(): WeaponAmmoState {
    return this.ammo.get(this.getDefinition().id)!
  }

  isReloading(): boolean {
    return this.reloadRemaining > 0
  }

  isSwitching(): boolean {
    return this.pendingIndex !== null
  }

  isAiming(): boolean {
    return this.aimAmount > 0.45
  }

  getAimAmount(): number {
    return this.aimAmount
  }

  getSpreadMultiplier(): number {
    return THREE.MathUtils.lerp(1, 0.43, this.aimAmount)
  }

  getReloadProgress(): number {
    if (this.reloadRemaining <= 0 || this.reloadDuration <= 0) return 0
    return 1 - this.reloadRemaining / this.reloadDuration
  }

  getMuzzleWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.muzzle.getWorldPosition(target)
  }

  private fire(): void {
    const definition = this.getDefinition()
    const state = this.getAmmoState()
    if (state.magazine <= 0) {
      this.audio.dryFire()
      this.callbacks.dryFire()
      this.cooldown = 0.22
      if (state.reserve > 0) {
        const weaponId = definition.id
        window.setTimeout(() => {
          if (this.getDefinition().id === weaponId) this.reload()
        }, 180)
      }
      return
    }
    state.magazine -= 1
    this.cooldown = 1 / definition.fireRate
    const recoilScale = THREE.MathUtils.lerp(1, 0.72, this.aimAmount)
    this.recoilKick = Math.min(0.17, this.recoilKick + definition.recoil * recoilScale)
    this.recoilSide += (Math.random() - 0.5) * definition.recoil * 0.38 * recoilScale
    this.flashTime = definition.id === 'shotgun' ? 0.08 : definition.id === 'railgun' ? 0.075 : 0.055
    const flashScale = definition.id === 'shotgun' ? 1.48 : definition.id === 'railgun' ? 1.35 : definition.id === 'lmg' ? 1.15 : 1
    this.muzzleFlash.scale.setScalar(flashScale)
    this.audio.gun(definition)
    this.callbacks.recoil(
      definition.recoil * recoilScale * (definition.id === 'railgun' ? 1.42 : 1),
      (Math.random() - 0.5) * definition.recoil * 0.42 * recoilScale,
    )
    this.callbacks.shoot(definition, this.getMuzzleWorldPosition())
    this.emitChanged()
    if (state.magazine <= 0 && state.reserve > 0) {
      const weaponId = definition.id
      window.setTimeout(() => {
        if (this.getDefinition().id === weaponId) this.reload()
      }, 220)
    }
  }

  private finishReload(): void {
    const definition = this.getDefinition()
    const state = this.getAmmoState()
    const needed = definition.magazine - state.magazine
    const loaded = Math.min(needed, state.reserve)
    state.magazine += loaded
    state.reserve -= loaded
    this.reloadRemaining = 0
    this.reloadDuration = 0
    this.audio.ui(520)
    this.emitChanged()
  }

  private emitChanged(): void {
    this.callbacks.changed(this.getDefinition(), { ...this.getAmmoState() }, this.isReloading())
  }

  private buildModel(): void {
    while (this.model.children.length > 0) {
      const child = this.model.children[0]
      if (child === this.muzzle) {
        this.model.remove(child)
        continue
      }
      this.model.remove(child)
      if (child instanceof THREE.Mesh) child.geometry.dispose()
    }
    for (const material of this.modelMaterials) material.dispose()
    this.modelMaterials.length = 0

    const dark = new THREE.MeshStandardMaterial({ color: 0x111922, roughness: 0.36, metalness: 0.84 })
    const metal = new THREE.MeshStandardMaterial({ color: 0x536571, roughness: 0.31, metalness: 0.78 })
    const grip = new THREE.MeshStandardMaterial({ color: 0x202b32, roughness: 0.72, metalness: 0.18 })
    const accentColor = this.getDefinition().tracerColor
    const accent = new THREE.MeshStandardMaterial({
      color: accentColor,
      emissive: accentColor,
      emissiveIntensity: 2.35,
      roughness: 0.23,
      metalness: 0.32,
    })
    this.modelMaterials.push(dark, metal, grip, accent)

    const addBox = (
      size: [number, number, number],
      position: [number, number, number],
      material: THREE.Material,
      rotation?: [number, number, number],
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
      mesh.position.set(...position)
      if (rotation) mesh.rotation.set(...rotation)
      mesh.castShadow = true
      this.model.add(mesh)
      return mesh
    }
    const addBarrel = (radius: number, length: number, position: [number, number, number], material: THREE.Material): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), material)
      mesh.rotation.x = Math.PI / 2
      mesh.position.set(...position)
      mesh.castShadow = true
      this.model.add(mesh)
      return mesh
    }
    const addCylinder = (
      radius: number,
      length: number,
      position: [number, number, number],
      rotation: [number, number, number],
      material: THREE.Material,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material)
      mesh.rotation.set(...rotation)
      mesh.position.set(...position)
      mesh.castShadow = true
      this.model.add(mesh)
      return mesh
    }

    const definition = this.getDefinition()
    if (definition.id === 'rifle') {
      addBox([0.25, 0.2, 0.58], [0, 0, -0.16], metal)
      addBox([0.19, 0.1, 0.34], [0, 0.14, -0.18], dark)
      addBox([0.07, 0.055, 0.48], [0, 0.035, -0.65], accent)
      addBarrel(0.035, 0.5, [0, 0.025, -0.72], dark)
      addBox([0.18, 0.22, 0.22], [0, -0.2, -0.02], grip, [-0.25, 0, 0])
      addBox([0.2, 0.14, 0.3], [0, 0, 0.28], dark)
      this.muzzle.position.set(0, 0.025, -0.99)
    } else if (definition.id === 'smg') {
      addBox([0.28, 0.22, 0.44], [0, 0, -0.12], dark)
      addBox([0.22, 0.14, 0.34], [0, 0.13, -0.2], metal)
      addBox([0.1, 0.05, 0.36], [0, 0.03, -0.49], accent)
      addBarrel(0.032, 0.34, [0, 0.03, -0.56], metal)
      addBox([0.15, 0.28, 0.18], [0, -0.22, -0.04], grip, [-0.2, 0, 0])
      addBox([0.24, 0.11, 0.23], [0, 0.01, 0.22], grip)
      addBox([0.06, 0.08, 0.15], [0, 0.17, -0.04], accent)
      this.muzzle.position.set(0, 0.03, -0.76)
    } else if (definition.id === 'shotgun') {
      addBox([0.31, 0.24, 0.62], [0, 0, -0.14], dark)
      addBox([0.34, 0.12, 0.32], [0, -0.08, -0.54], metal)
      addBarrel(0.055, 0.66, [-0.075, 0.055, -0.66], dark)
      addBarrel(0.055, 0.66, [0.075, 0.055, -0.66], dark)
      addBox([0.24, 0.18, 0.36], [0, -0.18, -0.05], grip, [-0.18, 0, 0])
      addBox([0.27, 0.18, 0.32], [0, 0, 0.31], dark)
      addBox([0.22, 0.035, 0.12], [0, 0.15, -0.18], accent)
      this.muzzle.position.set(0, 0.055, -1.01)
    } else if (definition.id === 'marksman') {
      addBox([0.24, 0.19, 0.72], [0, 0, -0.24], metal)
      addBox([0.18, 0.11, 0.48], [0, 0.13, -0.24], dark)
      addBarrel(0.031, 0.82, [0, 0.035, -0.82], dark)
      addBox([0.055, 0.05, 0.66], [0, 0.04, -0.68], accent)
      addCylinder(0.07, 0.34, [0, 0.23, -0.27], [Math.PI / 2, 0, 0], dark)
      addCylinder(0.038, 0.37, [0, 0.23, -0.27], [Math.PI / 2, 0, 0], accent)
      addBox([0.17, 0.26, 0.2], [0, -0.2, -0.02], grip, [-0.22, 0, 0])
      addBox([0.22, 0.15, 0.38], [0, 0, 0.38], grip)
      this.muzzle.position.set(0, 0.035, -1.23)
    } else if (definition.id === 'lmg') {
      addBox([0.34, 0.29, 0.72], [0, 0, -0.22], dark)
      addBox([0.4, 0.1, 0.56], [0, 0.17, -0.34], metal)
      addBarrel(0.045, 0.78, [0, 0.05, -0.86], metal)
      addBox([0.08, 0.065, 0.72], [0, 0.055, -0.74], accent)
      addCylinder(0.19, 0.18, [0, -0.22, -0.12], [0, 0, Math.PI / 2], dark)
      addCylinder(0.125, 0.185, [0, -0.22, -0.12], [0, 0, Math.PI / 2], accent)
      addBox([0.19, 0.25, 0.23], [0, -0.2, 0.14], grip, [-0.2, 0, 0])
      addBox([0.29, 0.18, 0.4], [0, 0, 0.4], grip)
      addBox([0.42, 0.05, 0.12], [0, 0.21, -0.03], accent)
      this.muzzle.position.set(0, 0.05, -1.26)
    } else {
      addBox([0.27, 0.2, 0.72], [0, 0, -0.2], dark)
      addBox([0.34, 0.08, 0.68], [0, 0.15, -0.25], metal)
      addBox([0.055, 0.055, 0.82], [-0.11, 0.12, -0.55], accent)
      addBox([0.055, 0.055, 0.82], [0.11, 0.12, -0.55], accent)
      addBarrel(0.032, 0.86, [0, 0.08, -0.68], metal)
      addBox([0.19, 0.26, 0.24], [0, -0.19, -0.02], grip, [-0.2, 0, 0])
      addBox([0.24, 0.16, 0.36], [0, -0.01, 0.36], dark)
      this.muzzle.position.set(0, 0.08, -1.12)
    }

    this.model.add(this.muzzle)
    this.muzzleFlash.position.set(0, 0, -0.03)
    const flashMaterial = this.muzzleFlash.material as THREE.MeshBasicMaterial
    flashMaterial.color.set(definition.tracerColor)
    this.muzzleLight.color.set(definition.tracerColor)
  }
}
