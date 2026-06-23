import * as THREE from 'three'
import { BlockType, BLOCK_COLORS, type VoxelHit } from './types'
import { hashFloat, mulberry32, SeededNoise } from './noise'

interface FaceDefinition {
  normal: [number, number, number]
  corners: [number, number, number][]
  shade: number
}

const FACES: FaceDefinition[] = [
  { normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: 0.9 },
  { normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], shade: 0.78 },
  { normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.08 },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.58 },
  { normal: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], shade: 0.98 },
  { normal: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], shade: 0.84 },
]

interface GeometryBucket {
  positions: number[]
  normals: number[]
  colors: number[]
  indices: number[]
}

function createBucket(): GeometryBucket {
  return { positions: [], normals: [], colors: [], indices: [] }
}

export class VoxelWorld {
  readonly width = 80
  readonly depth = 80
  readonly height = 34
  readonly minX = -40
  readonly minZ = -40
  readonly chunkSize = 16
  readonly seed: number
  readonly glowPositions: THREE.Vector3[] = []

  private readonly blocks: Uint8Array
  private readonly scene: THREE.Scene
  private readonly chunkGroups = new Map<string, THREE.Group>()
  private readonly material: THREE.MeshStandardMaterial
  private readonly glowMaterial: THREE.MeshStandardMaterial
  private readonly noise: SeededNoise

  constructor(scene: THREE.Scene, seed: number) {
    this.scene = scene
    this.seed = seed
    this.blocks = new Uint8Array(this.width * this.height * this.depth)
    this.noise = new SeededNoise(seed)
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.08,
      flatShading: true,
    })
    this.glowMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.38,
      metalness: 0.3,
      emissive: new THREE.Color(0x1bdaf0),
      emissiveIntensity: 2.1,
      flatShading: true,
    })
  }

  generate(): void {
    this.blocks.fill(BlockType.Air)
    this.glowPositions.length = 0
    const rng = mulberry32(this.seed ^ 0x9e3779b9)

    for (let z = this.minZ; z < this.minZ + this.depth; z += 1) {
      for (let x = this.minX; x < this.minX + this.width; x += 1) {
        const macro = this.noise.fbm2((x + 430) * 0.031, (z - 270) * 0.031, 5)
        const ridged = this.noise.ridged2((x - 90) * 0.064, (z + 190) * 0.064, 3)
        let surface = Math.floor(4.5 + macro * 8.2 + ridged * 2.2)
        const distanceFromCenter = Math.hypot(x + 0.5, z + 0.5)
        if (distanceFromCenter < 12) {
          const blend = Math.max(0, Math.min(1, (12 - distanceFromCenter) / 7))
          surface = Math.round(surface * (1 - blend) + 6 * blend)
        }
        surface = Math.max(3, Math.min(this.height - 8, surface))
        const moisture = this.noise.fbm2((x - 800) * 0.046, (z + 510) * 0.046, 4)
        const sandy = surface <= 6 && moisture < 0.52

        for (let y = 0; y <= surface; y += 1) {
          let type = BlockType.Stone
          if (y === 0) type = BlockType.Bedrock
          else if (y === surface) type = sandy ? BlockType.Sand : BlockType.Grass
          else if (y >= surface - 2) type = sandy ? BlockType.Sand : BlockType.Dirt
          this.setRaw(x, y, z, type)
        }
      }
    }

    this.buildCentralPlatform()
    this.buildRuin(-19, -14, 0)
    this.buildRuin(20, 13, 1)
    this.buildRuin(-22, 20, 2)
    this.buildRuin(24, -21, 3)
    this.buildWatchTower(4, -24)
    this.buildWatchTower(-27, 1)

    for (let i = 0; i < 52; i += 1) {
      const x = Math.floor(this.minX + 4 + rng() * (this.width - 8))
      const z = Math.floor(this.minZ + 4 + rng() * (this.depth - 8))
      if (Math.hypot(x, z) < 20.5) continue
      if (Math.abs(x + 19) < 7 && Math.abs(z + 14) < 7) continue
      if (Math.abs(x - 20) < 7 && Math.abs(z - 13) < 7) continue
      const surface = this.getHighestSolidY(x, z)
      if (surface < 5 || surface > 15 || this.getBlock(x, surface, z) !== BlockType.Grass) continue
      this.buildTree(x, surface + 1, z, rng)
    }

    for (let i = 0; i < 28; i += 1) {
      const angle = rng() * Math.PI * 2
      const radius = 12 + rng() * 24
      const x = Math.round(Math.cos(angle) * radius)
      const z = Math.round(Math.sin(angle) * radius)
      const y = this.getHighestSolidY(x, z) + 1
      if (this.getBlock(x, y, z) === BlockType.Air) this.setRaw(x, y, z, BlockType.Crate)
    }

    this.rebuildAll()
  }

  private buildCentralPlatform(): void {
    // Carve a gently graded combat bowl around the deployment pad. This keeps
    // the first sightline open across every seed and prevents steep terrain
    // walls from trapping the player at spawn.
    for (let z = -25; z <= 25; z += 1) {
      for (let x = -25; x <= 25; x += 1) {
        const radius = Math.hypot(x, z)
        if (radius > 24.5) continue
        const targetSurface = radius <= 17.5 ? 6 : 6 + Math.floor((radius - 17.5) * 0.46)
        for (let y = 1; y <= targetSurface; y += 1) {
          const type = y === targetSurface ? BlockType.Grass : y >= targetSurface - 2 ? BlockType.Dirt : BlockType.Stone
          this.setRaw(x, y, z, type)
        }
        for (let y = targetSurface + 1; y < this.height; y += 1) this.setRaw(x, y, z, BlockType.Air)
      }
    }

    for (let z = -9; z <= 9; z += 1) {
      for (let x = -9; x <= 9; x += 1) {
        if (Math.hypot(x, z) > 9.4) continue
        for (let y = 1; y < 6; y += 1) this.setRaw(x, y, z, y < 4 ? BlockType.Stone : BlockType.Metal)
        const isCircuit = (Math.abs(x) === 4 && Math.abs(z) <= 6) || (Math.abs(z) === 4 && Math.abs(x) <= 6)
        this.setRaw(x, 6, z, isCircuit && (Math.abs(x + z) % 2 === 0) ? BlockType.Glow : BlockType.Metal)
        for (let y = 7; y < this.height; y += 1) this.setRaw(x, y, z, BlockType.Air)
      }
    }

    const beacons: [number, number][] = [[-7, -3], [7, -3], [-7, 5], [7, 5]]
    for (const [x, z] of beacons) {
      for (let y = 7; y <= 9; y += 1) this.setRaw(x, y, z, BlockType.Metal)
      this.setRaw(x, 10, z, BlockType.Glow)
      this.glowPositions.push(new THREE.Vector3(x + 0.5, 10.6, z + 0.5))
    }

    const cover: [number, number][] = [[-4, 0], [4, 0], [-2, -6], [2, 7]]
    for (const [x, z] of cover) {
      this.setRaw(x, 7, z, BlockType.Crate)
      if ((x + z) % 2 === 0) this.setRaw(x, 8, z, BlockType.Crate)
    }
  }

  private buildTree(x: number, y: number, z: number, rng: () => number): void {
    const trunkHeight = 3 + Math.floor(rng() * 3)
    for (let i = 0; i < trunkHeight; i += 1) this.setRaw(x, y + i, z, BlockType.Wood)
    const crownY = y + trunkHeight - 1
    for (let dy = -1; dy <= 2; dy += 1) {
      const radius = dy === 2 ? 1 : 2
      for (let dz = -radius; dz <= radius; dz += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.abs(dx) + Math.abs(dz) > radius * 1.7) continue
          if (dx === 0 && dz === 0 && dy < 1) continue
          if (rng() < 0.12 && Math.abs(dx) + Math.abs(dz) > 1) continue
          this.setRaw(x + dx, crownY + dy, z + dz, BlockType.Leaves)
        }
      }
    }
  }

  private buildRuin(cx: number, cz: number, variant: number): void {
    const base = this.getHighestSolidY(cx, cz) + 1
    const half = 4 + (variant % 2)
    for (let z = -half; z <= half; z += 1) {
      for (let x = -half; x <= half; x += 1) {
        const worldX = cx + x
        const worldZ = cz + z
        const y = this.getHighestSolidY(worldX, worldZ) + 1
        if (Math.abs(y - base) > 2) continue
        if (Math.abs(x) === half || Math.abs(z) === half) {
          const gap = ((x * 13 + z * 7 + variant * 5) & 3) === 0
          if (gap) continue
          const wallHeight = 1 + ((Math.abs(x + z + variant) * 11) % 4)
          for (let h = 0; h < wallHeight; h += 1) {
            this.setRaw(worldX, y + h, worldZ, h === wallHeight - 1 && h > 1 ? BlockType.Metal : BlockType.Stone)
          }
        } else if ((x + z + variant) % 5 === 0) {
          this.setRaw(worldX, y, worldZ, BlockType.Metal)
        }
      }
    }
    this.setRaw(cx, base + 1, cz, BlockType.Glow)
    this.glowPositions.push(new THREE.Vector3(cx + 0.5, base + 1.6, cz + 0.5))
  }

  private buildWatchTower(cx: number, cz: number): void {
    const base = this.getHighestSolidY(cx, cz) + 1
    const corners: [number, number][] = [[-2, -2], [2, -2], [-2, 2], [2, 2]]
    for (const [dx, dz] of corners) {
      for (let y = 0; y < 6; y += 1) this.setRaw(cx + dx, base + y, cz + dz, BlockType.Metal)
    }
    for (let x = -2; x <= 2; x += 1) {
      for (let z = -2; z <= 2; z += 1) this.setRaw(cx + x, base + 5, cz + z, BlockType.Wood)
    }
    this.setRaw(cx, base + 6, cz, BlockType.Glow)
    this.glowPositions.push(new THREE.Vector3(cx + 0.5, base + 6.6, cz + 0.5))
  }

  getBlock(x: number, y: number, z: number): BlockType {
    if (!this.inBounds(x, y, z)) return BlockType.Air
    return this.blocks[this.index(x, y, z)] as BlockType
  }

  isSolid(x: number, y: number, z: number): boolean {
    if (y < 0) return true
    if (x < this.minX || x >= this.minX + this.width || z < this.minZ || z >= this.minZ + this.depth) return true
    if (y >= this.height) return false
    return this.getBlock(x, y, z) !== BlockType.Air
  }

  setBlock(x: number, y: number, z: number, type: BlockType): boolean {
    if (!this.inBounds(x, y, z) || y === 0) return false
    if (this.getBlock(x, y, z) === type) return false
    this.blocks[this.index(x, y, z)] = type
    this.rebuildAround(x, z)
    return true
  }

  removeBlock(x: number, y: number, z: number): boolean {
    const type = this.getBlock(x, y, z)
    if (type === BlockType.Air || type === BlockType.Bedrock) return false
    this.blocks[this.index(x, y, z)] = BlockType.Air
    this.rebuildAround(x, z)
    return true
  }

  removeBlocksBatch(blocks: Array<{ x: number; y: number; z: number }>): number {
    const chunks = new Set<string>()
    let removed = 0
    for (const block of blocks) {
      const type = this.getBlock(block.x, block.y, block.z)
      if (type === BlockType.Air || type === BlockType.Bedrock) continue
      this.blocks[this.index(block.x, block.y, block.z)] = BlockType.Air
      removed += 1
      const cx = Math.floor((block.x - this.minX) / this.chunkSize)
      const cz = Math.floor((block.z - this.minZ) / this.chunkSize)
      chunks.add(`${cx},${cz}`)
      const localX = (block.x - this.minX) % this.chunkSize
      const localZ = (block.z - this.minZ) % this.chunkSize
      if (localX === 0) chunks.add(`${cx - 1},${cz}`)
      if (localX === this.chunkSize - 1) chunks.add(`${cx + 1},${cz}`)
      if (localZ === 0) chunks.add(`${cx},${cz - 1}`)
      if (localZ === this.chunkSize - 1) chunks.add(`${cx},${cz + 1}`)
    }
    for (const key of chunks) {
      const [cx, cz] = key.split(',').map(Number)
      this.rebuildChunk(cx, cz)
    }
    return removed
  }

  private setRaw(x: number, y: number, z: number, type: BlockType): void {
    if (!this.inBounds(x, y, z)) return
    this.blocks[this.index(x, y, z)] = type
  }

  getHighestSolidY(x: number, z: number, ignoreFoliage = true): number {
    if (x < this.minX || x >= this.minX + this.width || z < this.minZ || z >= this.minZ + this.depth) return 0
    for (let y = this.height - 1; y >= 0; y -= 1) {
      const type = this.getBlock(x, y, z)
      if (type === BlockType.Air) continue
      if (ignoreFoliage && (type === BlockType.Leaves || type === BlockType.Wood)) continue
      return y
    }
    return 0
  }

  getSpawnFeet(): THREE.Vector3 {
    const x = 0.5
    const z = 4.5
    return new THREE.Vector3(x, this.getHighestSolidY(Math.floor(x), Math.floor(z), false) + 1.001, z)
  }

  raycast(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): VoxelHit | null {
    const dir = direction.clone().normalize()
    let x = Math.floor(origin.x)
    let y = Math.floor(origin.y)
    let z = Math.floor(origin.z)

    const stepX = dir.x >= 0 ? 1 : -1
    const stepY = dir.y >= 0 ? 1 : -1
    const stepZ = dir.z >= 0 ? 1 : -1
    const tDeltaX = dir.x === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dir.x)
    const tDeltaY = dir.y === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dir.y)
    const tDeltaZ = dir.z === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dir.z)
    let tMaxX = dir.x === 0 ? Number.POSITIVE_INFINITY : ((stepX > 0 ? x + 1 : x) - origin.x) / dir.x
    let tMaxY = dir.y === 0 ? Number.POSITIVE_INFINITY : ((stepY > 0 ? y + 1 : y) - origin.y) / dir.y
    let tMaxZ = dir.z === 0 ? Number.POSITIVE_INFINITY : ((stepZ > 0 ? z + 1 : z) - origin.z) / dir.z
    let distance = 0
    const normal = new THREE.Vector3()

    for (let i = 0; i < 512 && distance <= maxDistance; i += 1) {
      const outside = x < this.minX || x >= this.minX + this.width || z < this.minZ || z >= this.minZ + this.depth || y < 0
      const type = outside ? BlockType.Bedrock : this.getBlock(x, y, z)
      if (type !== BlockType.Air) {
        return {
          x,
          y,
          z,
          type,
          distance,
          point: origin.clone().addScaledVector(dir, Math.max(0, distance)),
          normal: normal.clone(),
        }
      }

      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX
        distance = tMaxX
        tMaxX += tDeltaX
        normal.set(-stepX, 0, 0)
      } else if (tMaxY < tMaxZ) {
        y += stepY
        distance = tMaxY
        tMaxY += tDeltaY
        normal.set(0, -stepY, 0)
      } else {
        z += stepZ
        distance = tMaxZ
        tMaxZ += tDeltaZ
        normal.set(0, 0, -stepZ)
      }
    }
    return null
  }

  rebuildAll(): void {
    for (const group of this.chunkGroups.values()) {
      this.scene.remove(group)
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose()
      })
    }
    this.chunkGroups.clear()
    const chunksX = Math.ceil(this.width / this.chunkSize)
    const chunksZ = Math.ceil(this.depth / this.chunkSize)
    for (let cz = 0; cz < chunksZ; cz += 1) {
      for (let cx = 0; cx < chunksX; cx += 1) this.rebuildChunk(cx, cz)
    }
  }

  private rebuildAround(x: number, z: number): void {
    const cx = Math.floor((x - this.minX) / this.chunkSize)
    const cz = Math.floor((z - this.minZ) / this.chunkSize)
    const targets = new Set<string>([`${cx},${cz}`])
    const localX = (x - this.minX) % this.chunkSize
    const localZ = (z - this.minZ) % this.chunkSize
    if (localX === 0) targets.add(`${cx - 1},${cz}`)
    if (localX === this.chunkSize - 1) targets.add(`${cx + 1},${cz}`)
    if (localZ === 0) targets.add(`${cx},${cz - 1}`)
    if (localZ === this.chunkSize - 1) targets.add(`${cx},${cz + 1}`)
    for (const key of targets) {
      const [tx, tz] = key.split(',').map(Number)
      this.rebuildChunk(tx, tz)
    }
  }

  private rebuildChunk(cx: number, cz: number): void {
    const chunksX = Math.ceil(this.width / this.chunkSize)
    const chunksZ = Math.ceil(this.depth / this.chunkSize)
    if (cx < 0 || cz < 0 || cx >= chunksX || cz >= chunksZ) return
    const key = `${cx},${cz}`
    const previous = this.chunkGroups.get(key)
    if (previous) {
      this.scene.remove(previous)
      previous.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose()
      })
    }

    const regular = createBucket()
    const glow = createBucket()
    const startX = this.minX + cx * this.chunkSize
    const startZ = this.minZ + cz * this.chunkSize
    const endX = Math.min(startX + this.chunkSize, this.minX + this.width)
    const endZ = Math.min(startZ + this.chunkSize, this.minZ + this.depth)

    for (let z = startZ; z < endZ; z += 1) {
      for (let y = 0; y < this.height; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const type = this.getBlock(x, y, z)
          if (type === BlockType.Air) continue
          const bucket = type === BlockType.Glow ? glow : regular
          const baseColor = new THREE.Color(BLOCK_COLORS[type] ?? 0xffffff)
          const variation = 0.9 + hashFloat(x, y, z, this.seed) * 0.18
          baseColor.multiplyScalar(variation)

          for (const face of FACES) {
            const [nx, ny, nz] = face.normal
            if (this.getBlock(x + nx, y + ny, z + nz) !== BlockType.Air) continue
            const vertexOffset = bucket.positions.length / 3
            let faceColor = baseColor.clone().multiplyScalar(face.shade)
            if (type === BlockType.Grass && ny === 0) faceColor = new THREE.Color(BLOCK_COLORS[BlockType.Dirt]).multiplyScalar(face.shade * variation)
            for (const corner of face.corners) {
              bucket.positions.push(x + corner[0], y + corner[1], z + corner[2])
              bucket.normals.push(nx, ny, nz)
              bucket.colors.push(faceColor.r, faceColor.g, faceColor.b)
            }
            bucket.indices.push(vertexOffset, vertexOffset + 1, vertexOffset + 2, vertexOffset, vertexOffset + 2, vertexOffset + 3)
          }
        }
      }
    }

    const group = new THREE.Group()
    group.name = `chunk-${key}`
    const regularMesh = this.createMeshFromBucket(regular, this.material)
    const glowMesh = this.createMeshFromBucket(glow, this.glowMaterial)
    if (regularMesh) group.add(regularMesh)
    if (glowMesh) group.add(glowMesh)
    this.scene.add(group)
    this.chunkGroups.set(key, group)
  }

  private createMeshFromBucket(bucket: GeometryBucket, material: THREE.Material): THREE.Mesh | null {
    if (bucket.positions.length === 0) return null
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normals, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(bucket.colors, 3))
    geometry.setIndex(bucket.indices)
    geometry.computeBoundingSphere()
    const mesh = new THREE.Mesh(geometry, material)
    mesh.receiveShadow = true
    mesh.castShadow = false
    return mesh
  }

  private index(x: number, y: number, z: number): number {
    const localX = x - this.minX
    const localZ = z - this.minZ
    return localX + localZ * this.width + y * this.width * this.depth
  }

  private inBounds(x: number, y: number, z: number): boolean {
    return x >= this.minX && x < this.minX + this.width && z >= this.minZ && z < this.minZ + this.depth && y >= 0 && y < this.height
  }

  dispose(): void {
    for (const group of this.chunkGroups.values()) {
      this.scene.remove(group)
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose()
      })
    }
    this.chunkGroups.clear()
    this.material.dispose()
    this.glowMaterial.dispose()
  }
}
