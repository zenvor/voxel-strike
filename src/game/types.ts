import * as THREE from 'three'

export enum BlockType {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Sand = 4,
  Metal = 5,
  Glow = 6,
  Wood = 7,
  Leaves = 8,
  Crate = 9,
  Bedrock = 10,
}

export type Difficulty = 'recruit' | 'elite' | 'nightmare'

export interface DifficultyConfig {
  id: Difficulty
  label: string
  subtitle: string
  enemyHealth: number
  enemyDamage: number
  enemySpeed: number
  spawnScale: number
}

export interface VoxelHit {
  x: number
  y: number
  z: number
  type: BlockType
  distance: number
  point: THREE.Vector3
  normal: THREE.Vector3
}

export type WeaponId = 'rifle' | 'smg' | 'shotgun' | 'marksman' | 'lmg' | 'railgun'

export interface WeaponDefinition {
  id: WeaponId
  name: string
  code: string
  damage: number
  blockDamage: number
  fireRate: number
  magazine: number
  reserve: number
  reloadTime: number
  spread: number
  pellets: number
  recoil: number
  automatic: boolean
  range: number
  tracerColor: number
}

export interface WeaponAmmoState {
  magazine: number
  reserve: number
}

export type EnemyType = 'scout' | 'brute' | 'sentry'

export interface EnemyDefinition {
  type: EnemyType
  health: number
  speed: number
  damage: number
  fireRate: number
  range: number
  projectileSpeed: number
  score: number
  scale: number
  color: number
  accent: number
}

export interface GameSettings {
  sensitivity: number
  volume: number
  quality: 'performance' | 'balanced' | 'cinematic'
  difficulty: Difficulty
  seed: number
}

export const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  recruit: {
    id: 'recruit',
    label: '新兵',
    subtitle: '更高生存容错',
    enemyHealth: 0.82,
    enemyDamage: 0.72,
    enemySpeed: 0.94,
    spawnScale: 0.85,
  },
  elite: {
    id: 'elite',
    label: '精英',
    subtitle: '完整战术体验',
    enemyHealth: 1,
    enemyDamage: 1,
    enemySpeed: 1,
    spawnScale: 1,
  },
  nightmare: {
    id: 'nightmare',
    label: '梦魇',
    subtitle: '敌群全面强化',
    enemyHealth: 1.35,
    enemyDamage: 1.35,
    enemySpeed: 1.12,
    spawnScale: 1.25,
  },
}

export const STARTING_WEAPONS: readonly WeaponId[] = ['rifle', 'smg', 'shotgun']

export const WEAPONS: WeaponDefinition[] = [
  {
    id: 'rifle',
    name: '脉冲步枪',
    code: 'VX-7',
    damage: 24,
    blockDamage: 1.1,
    fireRate: 9.5,
    magazine: 30,
    reserve: 180,
    reloadTime: 1.58,
    spread: 0.009,
    pellets: 1,
    recoil: 0.017,
    automatic: true,
    range: 72,
    tracerColor: 0x6ef2ff,
  },
  {
    id: 'smg',
    name: '疾风冲锋枪',
    code: 'VTR-9',
    damage: 15,
    blockDamage: 0.62,
    fireRate: 13.6,
    magazine: 42,
    reserve: 252,
    reloadTime: 1.42,
    spread: 0.015,
    pellets: 1,
    recoil: 0.0115,
    automatic: true,
    range: 48,
    tracerColor: 0x72ffbe,
  },
  {
    id: 'shotgun',
    name: '裂变霰弹枪',
    code: 'SG-12',
    damage: 13,
    blockDamage: 0.48,
    fireRate: 1.18,
    magazine: 8,
    reserve: 56,
    reloadTime: 2.05,
    spread: 0.068,
    pellets: 9,
    recoil: 0.071,
    automatic: false,
    range: 38,
    tracerColor: 0xffc36e,
  },
  {
    id: 'marksman',
    name: '猎隼精确步枪',
    code: 'MR-18',
    damage: 52,
    blockDamage: 2.1,
    fireRate: 2.75,
    magazine: 12,
    reserve: 72,
    reloadTime: 1.92,
    spread: 0.0032,
    pellets: 1,
    recoil: 0.043,
    automatic: false,
    range: 102,
    tracerColor: 0xffe07a,
  },
  {
    id: 'lmg',
    name: '雷暴轻机枪',
    code: 'LM-60',
    damage: 21,
    blockDamage: 1.28,
    fireRate: 8.4,
    magazine: 60,
    reserve: 240,
    reloadTime: 3.25,
    spread: 0.0125,
    pellets: 1,
    recoil: 0.023,
    automatic: true,
    range: 76,
    tracerColor: 0xff8f5f,
  },
  {
    id: 'railgun',
    name: '磁轨炮',
    code: 'RG-3',
    damage: 96,
    blockDamage: 4.2,
    fireRate: 0.64,
    magazine: 5,
    reserve: 30,
    reloadTime: 2.55,
    spread: 0.0014,
    pellets: 1,
    recoil: 0.105,
    automatic: false,
    range: 112,
    tracerColor: 0xd77cff,
  },
]

export const ENEMY_DEFINITIONS: Record<EnemyType, EnemyDefinition> = {
  scout: {
    type: 'scout',
    health: 58,
    speed: 3.1,
    damage: 7,
    fireRate: 1.2,
    range: 21,
    projectileSpeed: 18,
    score: 120,
    scale: 1,
    color: 0x344758,
    accent: 0xff5f68,
  },
  brute: {
    type: 'brute',
    health: 185,
    speed: 1.65,
    damage: 15,
    fireRate: 0.68,
    range: 17,
    projectileSpeed: 14,
    score: 360,
    scale: 1.38,
    color: 0x4a3e3c,
    accent: 0xffa24c,
  },
  sentry: {
    type: 'sentry',
    health: 105,
    speed: 0.65,
    damage: 5,
    fireRate: 2.35,
    range: 29,
    projectileSpeed: 24,
    score: 240,
    scale: 1.08,
    color: 0x3f3c58,
    accent: 0xd276ff,
  },
}

export const BLOCK_COLORS: Record<number, number> = {
  [BlockType.Grass]: 0x5b9d58,
  [BlockType.Dirt]: 0x76523b,
  [BlockType.Stone]: 0x6e7780,
  [BlockType.Sand]: 0xbca66b,
  [BlockType.Metal]: 0x4b6470,
  [BlockType.Glow]: 0x63efff,
  [BlockType.Wood]: 0x765238,
  [BlockType.Leaves]: 0x3d754b,
  [BlockType.Crate]: 0xa36b3b,
  [BlockType.Bedrock]: 0x282d33,
}

export const BLOCK_DURABILITY: Record<number, number> = {
  [BlockType.Grass]: 1.8,
  [BlockType.Dirt]: 1.45,
  [BlockType.Stone]: 3.6,
  [BlockType.Sand]: 1.2,
  [BlockType.Metal]: 6.5,
  [BlockType.Glow]: 4.5,
  [BlockType.Wood]: 2.1,
  [BlockType.Leaves]: 0.8,
  [BlockType.Crate]: 1.65,
  [BlockType.Bedrock]: Number.POSITIVE_INFINITY,
}
