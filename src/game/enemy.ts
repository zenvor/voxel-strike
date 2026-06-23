import * as THREE from 'three'
import { ENEMY_DEFINITIONS, type DifficultyConfig, type EnemyType } from './types'
import { VoxelWorld } from './world'

export interface EnemyUpdateCallbacks {
  shoot: (enemy: Enemy, origin: THREE.Vector3, direction: THREE.Vector3, damage: number, speed: number) => void
}

const BOX = new THREE.BoxGeometry(1, 1, 1)
const CORE = new THREE.OctahedronGeometry(0.18, 0)

export class Enemy {
  readonly type: EnemyType
  readonly group = new THREE.Group()
  readonly hitMeshes: THREE.Mesh[] = []
  readonly definition
  readonly maxHealth: number
  health: number
  alive = true
  id: number

  private readonly baseMaterial: THREE.MeshStandardMaterial
  private readonly darkMaterial: THREE.MeshStandardMaterial
  private readonly accentMaterial: THREE.MeshStandardMaterial
  private readonly limbs: THREE.Object3D[] = []
  private readonly headPivot = new THREE.Group()
  private fireCooldown = 0
  private losCooldown = 0
  private hasLineOfSight = false
  private age = 0
  private hitFlash = 0
  private wanderAngle = Math.random() * Math.PI * 2
  private strafeDirection = Math.random() > 0.5 ? 1 : -1
  private currentFeetY = 0

  constructor(type: EnemyType, id: number, position: THREE.Vector3, difficulty: DifficultyConfig) {
    this.type = type
    this.id = id
    this.definition = ENEMY_DEFINITIONS[type]
    this.maxHealth = this.definition.health * difficulty.enemyHealth
    this.health = this.maxHealth
    this.currentFeetY = position.y

    this.baseMaterial = new THREE.MeshStandardMaterial({
      color: this.definition.color,
      roughness: 0.62,
      metalness: 0.48,
      emissive: 0x000000,
    })
    this.darkMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.definition.color).multiplyScalar(0.48),
      roughness: 0.78,
      metalness: 0.55,
      emissive: 0x000000,
    })
    this.accentMaterial = new THREE.MeshStandardMaterial({
      color: this.definition.accent,
      emissive: this.definition.accent,
      emissiveIntensity: 2.5,
      roughness: 0.28,
      metalness: 0.22,
    })

    this.group.position.copy(position)
    this.group.scale.setScalar(this.definition.scale)
    this.group.name = `${type}-${id}`
    this.buildModel()
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true
        object.receiveShadow = true
      }
    })
  }

  update(
    dt: number,
    playerPosition: THREE.Vector3,
    world: VoxelWorld,
    difficulty: DifficultyConfig,
    callbacks: EnemyUpdateCallbacks,
  ): void {
    if (!this.alive) return
    this.age += dt
    this.fireCooldown -= dt
    this.losCooldown -= dt
    this.hitFlash = Math.max(0, this.hitFlash - dt)

    const origin = this.getMuzzlePosition(new THREE.Vector3())
    const targetOffset = playerPosition.clone().sub(origin)
    const distance = targetOffset.length()
    const toPlayer = targetOffset.normalize()

    if (this.losCooldown <= 0) {
      this.losCooldown = 0.18 + Math.random() * 0.16
      const worldHit = world.raycast(origin, toPlayer, Math.min(distance, this.definition.range + 8))
      this.hasLineOfSight = !worldHit || worldHit.distance >= distance - 0.7
    }

    const planarDirection = new THREE.Vector3(playerPosition.x - this.group.position.x, 0, playerPosition.z - this.group.position.z)
    const planarDistance = planarDirection.length()
    if (planarDistance > 0.001) planarDirection.multiplyScalar(1 / planarDistance)

    const desiredYaw = Math.atan2(planarDirection.x, planarDirection.z)
    this.group.rotation.y = this.lerpAngle(this.group.rotation.y, desiredYaw, 1 - Math.exp(-7 * dt))
    this.headPivot.rotation.y = Math.sin(this.age * 1.6 + this.id) * 0.08

    const attackRange = this.definition.range
    const shouldAdvance = planarDistance > attackRange * (this.type === 'brute' ? 0.62 : 0.72) || !this.hasLineOfSight
    if (shouldAdvance && planarDistance < 42) {
      let moveDirection = planarDirection.clone()
      if (this.type !== 'brute' && this.hasLineOfSight && planarDistance < attackRange * 1.15) {
        const side = new THREE.Vector3(-planarDirection.z, 0, planarDirection.x)
        moveDirection.addScaledVector(side, this.strafeDirection * 0.72).normalize()
      }
      const moveSpeed = this.definition.speed * difficulty.enemySpeed * (this.type === 'sentry' ? 0.7 : 1)
      this.tryMove(moveDirection, moveSpeed * dt, world)
    } else if (planarDistance >= 42) {
      this.wanderAngle += (Math.random() - 0.5) * dt * 0.8
      this.tryMove(new THREE.Vector3(Math.sin(this.wanderAngle), 0, Math.cos(this.wanderAngle)), this.definition.speed * 0.25 * dt, world)
    }

    const groundY = world.getHighestSolidY(Math.floor(this.group.position.x), Math.floor(this.group.position.z)) + 1
    this.currentFeetY = THREE.MathUtils.lerp(this.currentFeetY, groundY, 1 - Math.exp(-10 * dt))
    this.group.position.y = this.currentFeetY + Math.sin(this.age * 4.2 + this.id) * (this.type === 'sentry' ? 0.055 : 0.018)

    if (this.hasLineOfSight && distance <= attackRange && this.fireCooldown <= 0) {
      const jitter = this.type === 'brute' ? 0.035 : this.type === 'sentry' ? 0.018 : 0.028
      const shotDirection = toPlayer.clone()
      shotDirection.x += (Math.random() - 0.5) * jitter
      shotDirection.y += (Math.random() - 0.5) * jitter
      shotDirection.z += (Math.random() - 0.5) * jitter
      shotDirection.normalize()
      callbacks.shoot(
        this,
        origin,
        shotDirection,
        this.definition.damage * difficulty.enemyDamage,
        this.definition.projectileSpeed,
      )
      this.fireCooldown = 1 / this.definition.fireRate * (0.8 + Math.random() * 0.38)
    }

    const walkAmount = Math.min(1, planarDistance / 4)
    const swing = Math.sin(this.age * (this.type === 'brute' ? 5 : 8)) * 0.55 * walkAmount
    if (this.limbs[0]) this.limbs[0].rotation.x = swing
    if (this.limbs[1]) this.limbs[1].rotation.x = -swing
    if (this.limbs[2]) this.limbs[2].rotation.x = -swing * 0.75
    if (this.limbs[3]) this.limbs[3].rotation.x = swing * 0.75

    const flash = this.hitFlash > 0 ? this.hitFlash / 0.12 : 0
    this.baseMaterial.emissive.setRGB(flash * 1.7, flash * 1.7, flash * 1.7)
    this.darkMaterial.emissive.setRGB(flash, flash, flash)
    this.accentMaterial.emissiveIntensity = 2.3 + Math.sin(this.age * 7) * 0.45 + flash * 2
  }

  applyDamage(amount: number): boolean {
    if (!this.alive) return false
    this.health -= amount
    this.hitFlash = 0.12
    if (this.health <= 0) {
      this.alive = false
      return true
    }
    return false
  }

  getMuzzlePosition(target = new THREE.Vector3()): THREE.Vector3 {
    const local = this.type === 'brute'
      ? new THREE.Vector3(0, 1.45, 0.62)
      : this.type === 'sentry'
        ? new THREE.Vector3(0, 1.5, 0.55)
        : new THREE.Vector3(0, 1.36, 0.55)
    return this.group.localToWorld(target.copy(local))
  }

  getCenter(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.group.position).add(new THREE.Vector3(0, 1.05 * this.definition.scale, 0))
  }

  getHealthRatio(): number {
    return Math.max(0, this.health / this.maxHealth)
  }

  dispose(): void {
    this.baseMaterial.dispose()
    this.darkMaterial.dispose()
    this.accentMaterial.dispose()
  }

  private buildModel(): void {
    if (this.type === 'sentry') {
      const base = this.addBox(new THREE.Vector3(0.76, 0.38, 0.76), new THREE.Vector3(0, 0.24, 0), this.darkMaterial, 'body')
      base.rotation.y = Math.PI / 4
      const stem = this.addBox(new THREE.Vector3(0.28, 0.74, 0.28), new THREE.Vector3(0, 0.74, 0), this.baseMaterial, 'body')
      stem.rotation.y = Math.PI / 4
      const turret = this.addBox(new THREE.Vector3(0.86, 0.5, 0.54), new THREE.Vector3(0, 1.28, 0), this.baseMaterial, 'head')
      this.headPivot.add(turret)
      this.group.add(this.headPivot)
      this.addBox(new THREE.Vector3(0.16, 0.16, 0.68), new THREE.Vector3(0, 1.3, 0.48), this.darkMaterial, 'body')
      const core = new THREE.Mesh(CORE, this.accentMaterial)
      core.position.set(0, 1.3, 0.29)
      core.userData.enemy = this
      core.userData.part = 'core'
      this.hitMeshes.push(core)
      this.group.add(core)
      return
    }

    const bodyWidth = this.type === 'brute' ? 0.9 : 0.72
    const bodyHeight = this.type === 'brute' ? 1.02 : 0.82
    this.addBox(new THREE.Vector3(bodyWidth, bodyHeight, 0.46), new THREE.Vector3(0, 1.12, 0), this.baseMaterial, 'body')
    this.addBox(new THREE.Vector3(bodyWidth * 1.2, 0.16, 0.58), new THREE.Vector3(0, 1.48, 0), this.darkMaterial, 'body')

    const head = this.addBox(
      new THREE.Vector3(this.type === 'brute' ? 0.62 : 0.5, this.type === 'brute' ? 0.56 : 0.48, 0.5),
      new THREE.Vector3(0, this.type === 'brute' ? 1.86 : 1.72, 0.02),
      this.darkMaterial,
      'head',
    )
    this.headPivot.add(head)
    this.group.add(this.headPivot)

    const eye = this.addBox(new THREE.Vector3(0.28, 0.08, 0.035), new THREE.Vector3(0, this.type === 'brute' ? 1.9 : 1.75, 0.275), this.accentMaterial, 'head')
    eye.castShadow = false

    const armY = this.type === 'brute' ? 1.15 : 1.08
    const armX = bodyWidth * 0.72
    const armSize = this.type === 'brute' ? new THREE.Vector3(0.28, 0.82, 0.3) : new THREE.Vector3(0.2, 0.72, 0.24)
    const leftArm = this.addBox(armSize, new THREE.Vector3(-armX, armY, 0), this.darkMaterial, 'body')
    const rightArm = this.addBox(armSize, new THREE.Vector3(armX, armY, 0), this.darkMaterial, 'body')
    const leftLeg = this.addBox(new THREE.Vector3(0.26, 0.72, 0.3), new THREE.Vector3(-0.23, 0.38, 0), this.baseMaterial, 'body')
    const rightLeg = this.addBox(new THREE.Vector3(0.26, 0.72, 0.3), new THREE.Vector3(0.23, 0.38, 0), this.baseMaterial, 'body')
    this.limbs.push(leftArm, rightArm, leftLeg, rightLeg)

    const core = new THREE.Mesh(CORE, this.accentMaterial)
    core.position.set(0, 1.16, 0.28)
    core.scale.setScalar(this.type === 'brute' ? 1.35 : 1)
    core.userData.enemy = this
    core.userData.part = 'core'
    this.hitMeshes.push(core)
    this.group.add(core)

    if (this.type === 'brute') {
      this.addBox(new THREE.Vector3(0.26, 0.26, 0.76), new THREE.Vector3(0.58, 1.25, 0.42), this.darkMaterial, 'body')
      this.addBox(new THREE.Vector3(0.26, 0.26, 0.76), new THREE.Vector3(-0.58, 1.25, 0.42), this.darkMaterial, 'body')
    }
  }

  private addBox(size: THREE.Vector3, position: THREE.Vector3, material: THREE.Material, part: 'head' | 'core' | 'body'): THREE.Mesh {
    const mesh = new THREE.Mesh(BOX, material)
    mesh.scale.copy(size)
    mesh.position.copy(position)
    mesh.userData.enemy = this
    mesh.userData.part = part
    this.hitMeshes.push(mesh)
    this.group.add(mesh)
    return mesh
  }

  private tryMove(direction: THREE.Vector3, distance: number, world: VoxelWorld): void {
    if (distance <= 0 || direction.lengthSq() < 1e-6) return
    direction.normalize()
    const currentGround = world.getHighestSolidY(Math.floor(this.group.position.x), Math.floor(this.group.position.z)) + 1
    const tryDirection = (dir: THREE.Vector3): boolean => {
      const nextX = this.group.position.x + dir.x * distance
      const nextZ = this.group.position.z + dir.z * distance
      const nextGround = world.getHighestSolidY(Math.floor(nextX), Math.floor(nextZ)) + 1
      if (Math.abs(nextGround - currentGround) > (this.type === 'brute' ? 0.8 : 1.15)) return false
      const bodyY = Math.floor(nextGround + 0.25)
      if (world.isSolid(Math.floor(nextX), bodyY, Math.floor(nextZ))) return false
      this.group.position.x = nextX
      this.group.position.z = nextZ
      return true
    }

    if (tryDirection(direction)) return
    const side = new THREE.Vector3(-direction.z * this.strafeDirection, 0, direction.x * this.strafeDirection)
    if (tryDirection(side)) return
    this.strafeDirection *= -1
  }

  private lerpAngle(from: number, to: number, alpha: number): number {
    let difference = (to - from + Math.PI) % (Math.PI * 2) - Math.PI
    if (difference < -Math.PI) difference += Math.PI * 2
    return from + difference * alpha
  }
}
