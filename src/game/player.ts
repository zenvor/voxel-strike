import * as THREE from 'three'
import { VoxelWorld } from './world'

export class Player {
  readonly camera: THREE.PerspectiveCamera
  readonly world: VoxelWorld
  readonly position = new THREE.Vector3()
  readonly velocity = new THREE.Vector3()
  readonly eyeHeight = 1.62
  readonly bodyHeight = 1.8
  readonly radius = 0.32

  yaw = 0
  pitch = 0
  sensitivity = 0.0012
  aiming = false
  onGround = false
  health = 100
  shield = 50
  stamina = 100
  maxHealth = 100
  maxShield = 50
  lastDamageAt = -100
  alive = true
  dashCooldown = 0

  private readonly keys = new Set<string>()
  private bobTime = 0
  private elapsed = 0
  private landingKick = 0
  private previousVerticalVelocity = 0
  private canStepThisFrame = false

  constructor(camera: THREE.PerspectiveCamera, world: VoxelWorld) {
    this.camera = camera
    this.world = world
    this.camera.rotation.order = 'YXZ'
  }

  reset(feetPosition: THREE.Vector3): void {
    this.position.copy(feetPosition).add(new THREE.Vector3(0, this.eyeHeight, 0))
    this.velocity.set(0, 0, 0)
    this.yaw = Math.PI
    this.pitch = -0.04
    this.onGround = false
    this.health = this.maxHealth
    this.shield = this.maxShield
    this.stamina = 100
    this.alive = true
    this.aiming = false
    this.dashCooldown = 0
    this.lastDamageAt = -100
    this.elapsed = 0
    this.bobTime = 0
    this.camera.position.copy(this.position)
  }

  setKey(code: string, down: boolean): void {
    if (down) this.keys.add(code)
    else this.keys.delete(code)
  }

  clearInput(): void {
    this.keys.clear()
  }

  look(deltaX: number, deltaY: number): void {
    this.yaw -= deltaX * this.sensitivity
    this.pitch -= deltaY * this.sensitivity
    this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI * 0.485, Math.PI * 0.485)
  }

  dash(): boolean {
    if (!this.alive || this.dashCooldown > 0 || this.stamina < 26) return false
    const forwardInput = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0)
    const strafeInput = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0)
    const inputLength = Math.hypot(forwardInput, strafeInput)
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
    const direction = new THREE.Vector3()
    if (inputLength > 0) {
      direction.addScaledVector(forward, forwardInput / inputLength)
      direction.addScaledVector(right, strafeInput / inputLength)
    } else direction.copy(forward)

    this.velocity.x += direction.x * 9.8
    this.velocity.z += direction.z * 9.8
    if (!this.onGround) this.velocity.y = Math.max(this.velocity.y, 1.1)
    this.stamina -= 26
    this.dashCooldown = 0.95
    return true
  }

  update(dt: number): { speed: number; sprinting: boolean; landed: boolean } {
    this.elapsed += dt
    this.dashCooldown = Math.max(0, this.dashCooldown - dt)
    const forwardInput = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0)
    const strafeInput = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0)
    const inputLength = Math.hypot(forwardInput, strafeInput)
    const wantsSprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
    const sprinting = wantsSprint && forwardInput > 0 && inputLength > 0 && this.stamina > 0.5 && this.onGround

    if (sprinting) this.stamina = Math.max(0, this.stamina - 23 * dt)
    else this.stamina = Math.min(100, this.stamina + (this.onGround ? 18 : 9) * dt)

    const speed = sprinting ? 8.6 : this.aiming ? 4.65 : 5.7
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
    const desired = new THREE.Vector3()
    if (inputLength > 0) {
      desired.addScaledVector(forward, forwardInput / inputLength)
      desired.addScaledVector(right, strafeInput / inputLength)
      desired.multiplyScalar(speed)
    }

    const horizontalResponse = 1 - Math.exp(-(this.onGround ? 14 : 5.5) * dt)
    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, desired.x, horizontalResponse)
    this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, desired.z, horizontalResponse)

    if (this.keys.has('Space') && this.onGround) {
      this.velocity.y = 9.2
      this.onGround = false
    }

    this.previousVerticalVelocity = this.velocity.y
    this.velocity.y -= 25.5 * dt
    this.velocity.y = Math.max(this.velocity.y, -22)

    const wasGrounded = this.onGround
    this.canStepThisFrame = this.onGround
    this.onGround = false
    const maxAxisMove = Math.max(Math.abs(this.velocity.x * dt), Math.abs(this.velocity.y * dt), Math.abs(this.velocity.z * dt))
    const steps = Math.max(1, Math.ceil(maxAxisMove / 0.18))
    const stepDt = dt / steps
    for (let i = 0; i < steps; i += 1) {
      this.moveHorizontal('x', this.velocity.x * stepDt)
      this.moveHorizontal('z', this.velocity.z * stepDt)
      this.moveVertical(this.velocity.y * stepDt)
    }

    const landed = !wasGrounded && this.onGround && this.previousVerticalVelocity < -4
    if (landed) this.landingKick = Math.min(0.16, Math.abs(this.previousVerticalVelocity) * 0.008)
    this.landingKick = THREE.MathUtils.lerp(this.landingKick, 0, 1 - Math.exp(-11 * dt))

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z)
    if (this.onGround && horizontalSpeed > 0.35) this.bobTime += dt * (sprinting ? 12.8 : 9.2)
    const bobAmount = this.onGround ? Math.min(horizontalSpeed / 6, 1) : 0
    const aimBobScale = this.aiming ? 0.35 : 1
    const bobY = Math.sin(this.bobTime * 2) * 0.022 * bobAmount * aimBobScale - this.landingKick
    const bobX = Math.sin(this.bobTime) * 0.014 * bobAmount * aimBobScale
    const lean = THREE.MathUtils.clamp(-this.velocity.dot(right) * 0.0045, -0.035, 0.035)

    this.camera.position.copy(this.position)
    this.camera.position.y += bobY
    this.camera.position.x += Math.cos(this.yaw) * bobX
    this.camera.position.z -= Math.sin(this.yaw) * bobX
    this.camera.rotation.x = this.pitch
    this.camera.rotation.y = this.yaw
    this.camera.rotation.z = lean
    const targetFov = this.aiming ? 62 : sprinting ? 79 : 75
    const nextFov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-(this.aiming ? 10 : 6) * dt))
    if (Math.abs(nextFov - this.camera.fov) > 0.01) {
      this.camera.fov = nextFov
      this.camera.updateProjectionMatrix()
    }

    if (this.elapsed - this.lastDamageAt > 4.5 && this.shield < this.maxShield && this.alive) {
      this.shield = Math.min(this.maxShield, this.shield + 9 * dt)
    }

    if (this.position.y < -5 && this.alive) {
      this.health = 0
      this.alive = false
    }

    return { speed: horizontalSpeed, sprinting, landed }
  }

  takeDamage(amount: number): number {
    if (!this.alive) return 0
    this.lastDamageAt = this.elapsed
    let remaining = amount
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, remaining)
      this.shield -= absorbed
      remaining -= absorbed
    }
    if (remaining > 0) this.health = Math.max(0, this.health - remaining)
    if (this.health <= 0) this.alive = false
    return amount
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount)
  }

  addShield(amount: number): void {
    this.shield = Math.min(this.maxShield, this.shield + amount)
  }

  getForward(target = new THREE.Vector3()): THREE.Vector3 {
    return this.camera.getWorldDirection(target).normalize()
  }

  getFeetY(): number {
    return this.position.y - this.eyeHeight
  }

  intersectsBlock(x: number, y: number, z: number): boolean {
    const feetY = this.getFeetY()
    return (
      this.position.x + this.radius > x &&
      this.position.x - this.radius < x + 1 &&
      feetY + this.bodyHeight > y &&
      feetY < y + 1 &&
      this.position.z + this.radius > z &&
      this.position.z - this.radius < z + 1
    )
  }

  private moveHorizontal(axis: 'x' | 'z', amount: number): void {
    if (Math.abs(amount) < 1e-7) return
    const previous = this.position[axis]
    this.position[axis] += amount
    if (!this.collides()) return

    if (this.canStepThisFrame) {
      const oldY = this.position.y
      this.position[axis] = previous
      this.position.y += 1.01
      this.position[axis] += amount
      if (!this.collides()) {
        this.onGround = false
        return
      }
      this.position.y = oldY
    }

    this.position[axis] = previous
    this.velocity[axis] = 0
  }

  private moveVertical(amount: number): void {
    if (Math.abs(amount) < 1e-7) return
    const previous = this.position.y
    this.position.y += amount
    if (!this.collides()) return
    this.position.y = previous
    if (amount < 0) this.onGround = true
    this.velocity.y = 0
  }

  private collides(): boolean {
    const feetY = this.position.y - this.eyeHeight
    const minX = Math.floor(this.position.x - this.radius + 1e-5)
    const maxX = Math.floor(this.position.x + this.radius - 1e-5)
    const minY = Math.floor(feetY + 1e-5)
    const maxY = Math.floor(feetY + this.bodyHeight - 1e-5)
    const minZ = Math.floor(this.position.z - this.radius + 1e-5)
    const maxZ = Math.floor(this.position.z + this.radius - 1e-5)
    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          if (this.world.isSolid(x, y, z)) return true
        }
      }
    }
    return false
  }
}
