import * as THREE from 'three'

interface Particle {
  active: boolean
  position: THREE.Vector3
  velocity: THREE.Vector3
  rotation: THREE.Euler
  spin: THREE.Vector3
  life: number
  maxLife: number
  size: number
  gravity: number
  drag: number
}

interface Transient {
  object: THREE.Object3D
  life: number
  maxLife: number
  kind: 'tracer' | 'ring' | 'flash'
  material?: THREE.Material
}

export interface BurstOptions {
  count: number
  color: number | THREE.Color
  speed?: number
  life?: number
  size?: number
  gravity?: number
  drag?: number
  direction?: THREE.Vector3
  spread?: number
}

export class EffectsSystem {
  readonly particleMesh: THREE.InstancedMesh

  private readonly scene: THREE.Scene
  private readonly particles: Particle[] = []
  private readonly transient: Transient[] = []
  private readonly dummy = new THREE.Object3D()
  private readonly particleGeometry = new THREE.BoxGeometry(1, 1, 1)
  private readonly tracerGeometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true)
  private cursor = 0

  constructor(scene: THREE.Scene, capacity = 520) {
    this.scene = scene
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92 })
    this.particleMesh = new THREE.InstancedMesh(this.particleGeometry, material, capacity)
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.particleMesh.frustumCulled = false
    this.particleMesh.renderOrder = 4
    scene.add(this.particleMesh)

    const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let i = 0; i < capacity; i += 1) {
      this.particles.push({
        active: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        rotation: new THREE.Euler(),
        spin: new THREE.Vector3(),
        life: 0,
        maxLife: 0,
        size: 0,
        gravity: 0,
        drag: 0,
      })
      this.particleMesh.setMatrixAt(i, hiddenMatrix)
      this.particleMesh.setColorAt(i, new THREE.Color(0xffffff))
    }
    this.particleMesh.instanceMatrix.needsUpdate = true
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true
  }

  burst(position: THREE.Vector3, options: BurstOptions): void {
    const baseColor = options.color instanceof THREE.Color ? options.color : new THREE.Color(options.color)
    const speed = options.speed ?? 4
    const life = options.life ?? 0.65
    const size = options.size ?? 0.08
    const gravity = options.gravity ?? 8
    const drag = options.drag ?? 1.7
    const spread = options.spread ?? Math.PI
    const direction = options.direction?.clone().normalize()

    for (let i = 0; i < options.count; i += 1) {
      const index = this.cursor
      this.cursor = (this.cursor + 1) % this.particles.length
      const particle = this.particles[index]
      particle.active = true
      particle.position.copy(position)
      const randomDirection = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
      ).normalize()
      if (direction && spread < Math.PI) {
        randomDirection.lerp(direction, Math.max(0, 1 - spread / Math.PI)).normalize()
      }
      particle.velocity.copy(randomDirection).multiplyScalar(speed * (0.35 + Math.random() * 0.9))
      particle.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
      particle.spin.set(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4)
      particle.maxLife = life * (0.55 + Math.random() * 0.9)
      particle.life = particle.maxLife
      particle.size = size * (0.55 + Math.random() * 1.2)
      particle.gravity = gravity
      particle.drag = drag
      const color = baseColor.clone().offsetHSL((Math.random() - 0.5) * 0.035, 0, (Math.random() - 0.5) * 0.14)
      this.particleMesh.setColorAt(index, color)
    }
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true
  }

  tracer(start: THREE.Vector3, end: THREE.Vector3, color: number, radius = 0.014, life = 0.075): void {
    const direction = end.clone().sub(start)
    const length = direction.length()
    if (length < 0.001) return
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88, blending: THREE.AdditiveBlending })
    const mesh = new THREE.Mesh(this.tracerGeometry, material)
    mesh.position.copy(start).add(end).multiplyScalar(0.5)
    mesh.scale.set(radius, length, radius)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
    mesh.renderOrder = 5
    this.scene.add(mesh)
    this.transient.push({ object: mesh, life, maxLife: life, kind: 'tracer', material })
  }

  ring(position: THREE.Vector3, normal: THREE.Vector3, color: number, size = 0.12): void {
    const geometry = new THREE.RingGeometry(0.45, 1, 16)
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(position).addScaledVector(normal, 0.012)
    mesh.scale.setScalar(size)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize())
    mesh.renderOrder = 5
    this.scene.add(mesh)
    this.transient.push({ object: mesh, life: 0.28, maxLife: 0.28, kind: 'ring', material })
  }

  flash(position: THREE.Vector3, color: number, intensity = 4.5, distance = 8, life = 0.12): void {
    const light = new THREE.PointLight(color, intensity, distance, 2)
    light.position.copy(position)
    this.scene.add(light)
    this.transient.push({ object: light, life, maxLife: life, kind: 'flash' })
  }

  update(dt: number): void {
    const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0)
    let matricesChanged = false
    for (let i = 0; i < this.particles.length; i += 1) {
      const particle = this.particles[i]
      if (!particle.active) continue
      particle.life -= dt
      if (particle.life <= 0) {
        particle.active = false
        this.particleMesh.setMatrixAt(i, hiddenMatrix)
        matricesChanged = true
        continue
      }
      particle.velocity.y -= particle.gravity * dt
      particle.velocity.multiplyScalar(Math.exp(-particle.drag * dt))
      particle.position.addScaledVector(particle.velocity, dt)
      particle.rotation.x += particle.spin.x * dt
      particle.rotation.y += particle.spin.y * dt
      particle.rotation.z += particle.spin.z * dt
      const lifeRatio = Math.max(0, particle.life / particle.maxLife)
      const scale = particle.size * Math.min(1, lifeRatio * 2.5) * (0.35 + lifeRatio * 0.65)
      this.dummy.position.copy(particle.position)
      this.dummy.rotation.copy(particle.rotation)
      this.dummy.scale.set(scale, scale, scale)
      this.dummy.updateMatrix()
      this.particleMesh.setMatrixAt(i, this.dummy.matrix)
      matricesChanged = true
    }
    if (matricesChanged) this.particleMesh.instanceMatrix.needsUpdate = true

    for (let i = this.transient.length - 1; i >= 0; i -= 1) {
      const item = this.transient[i]
      item.life -= dt
      const ratio = Math.max(0, item.life / item.maxLife)
      if (item.kind === 'tracer' && item.material instanceof THREE.MeshBasicMaterial) item.material.opacity = ratio * 0.88
      if (item.kind === 'ring') {
        item.object.scale.multiplyScalar(1 + dt * 7)
        if (item.material instanceof THREE.MeshBasicMaterial) item.material.opacity = ratio * 0.75
      }
      if (item.kind === 'flash' && item.object instanceof THREE.PointLight) item.object.intensity *= Math.exp(-18 * dt)
      if (item.life > 0) continue
      this.scene.remove(item.object)
      if (item.kind === 'ring' && item.object instanceof THREE.Mesh) item.object.geometry.dispose()
      item.material?.dispose()
      this.transient.splice(i, 1)
    }
  }

  dispose(): void {
    this.scene.remove(this.particleMesh)
    this.particleGeometry.dispose()
    this.tracerGeometry.dispose()
    const material = this.particleMesh.material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material.dispose()
    for (const item of this.transient) {
      this.scene.remove(item.object)
      item.material?.dispose()
      if (item.kind === 'ring' && item.object instanceof THREE.Mesh) item.object.geometry.dispose()
    }
    this.transient.length = 0
  }
}
