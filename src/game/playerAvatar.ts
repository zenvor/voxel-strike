import * as THREE from 'three'
import type { WeaponDefinition, WeaponId } from './types'

export class PlayerAvatar {
  readonly group = new THREE.Group()
  readonly muzzle = new THREE.Object3D()

  private readonly bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x315063,
    emissive: 0x07131a,
    emissiveIntensity: 0.22,
    roughness: 0.48,
    metalness: 0.48,
  })
  private readonly armorMaterial = new THREE.MeshStandardMaterial({
    color: 0x1d303b,
    emissive: 0x050e13,
    emissiveIntensity: 0.16,
    roughness: 0.42,
    metalness: 0.74,
  })
  private readonly visorMaterial = new THREE.MeshStandardMaterial({
    color: 0x72edff,
    emissive: 0x32d9ff,
    emissiveIntensity: 1.9,
    roughness: 0.2,
    metalness: 0.24,
  })
  private readonly limbMaterial = new THREE.MeshStandardMaterial({ color: 0x243744, roughness: 0.52, metalness: 0.56 })
  private readonly weaponMaterial = new THREE.MeshStandardMaterial({ color: 0xd7eef2, roughness: 0.36, metalness: 0.62 })
  private readonly weaponGlowMaterial = new THREE.MeshStandardMaterial({
    color: 0x75edff,
    emissive: 0x75edff,
    emissiveIntensity: 1.6,
    roughness: 0.28,
    metalness: 0.42,
  })
  private readonly chest = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.78, 0.36), this.bodyMaterial)
  private readonly head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.38), this.armorMaterial)
  private readonly leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.58, 0.16), this.limbMaterial)
  private readonly rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.58, 0.16), this.limbMaterial)
  private readonly leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.64, 0.18), this.limbMaterial)
  private readonly rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.64, 0.18), this.limbMaterial)
  private readonly weaponGroup = new THREE.Group()
  private activeWeaponId: WeaponId | null = null
  private bobTime = 0

  constructor(scene: THREE.Scene) {
    this.group.visible = false
    this.group.frustumCulled = false
    this.group.add(this.chest, this.head, this.leftArm, this.rightArm, this.leftLeg, this.rightLeg, this.weaponGroup)

    this.chest.position.y = 1.04
    this.chest.castShadow = true
    this.chest.receiveShadow = true

    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.58, 0.16), this.armorMaterial)
    pack.position.set(0, 1.06, 0.25)
    pack.castShadow = true
    this.group.add(pack)

    this.head.position.y = 1.58
    this.head.castShadow = true

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.08, 0.025), this.visorMaterial)
    visor.position.set(0, 1.6, -0.202)
    this.group.add(visor)

    this.leftArm.position.set(-0.43, 1.07, -0.05)
    this.rightArm.position.set(0.43, 1.07, -0.05)
    this.leftLeg.position.set(-0.18, 0.34, 0)
    this.rightLeg.position.set(0.18, 0.34, 0)
    this.leftArm.castShadow = this.rightArm.castShadow = true
    this.leftLeg.castShadow = this.rightLeg.castShadow = true

    this.weaponGroup.position.set(0.2, 1.13, -0.38)
    this.weaponGroup.rotation.x = -0.06
    this.weaponGroup.add(this.muzzle)
    scene.add(this.group)
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible
  }

  update(position: THREE.Vector3, yaw: number, pitch: number, dt: number, speed: number, sprinting: boolean, weapon: WeaponDefinition): void {
    if (this.activeWeaponId !== weapon.id) this.rebuildWeapon(weapon)
    const feetY = position.y - 1.62
    this.group.position.set(position.x, feetY, position.z)
    this.group.rotation.y = yaw

    if (speed > 0.2) this.bobTime += dt * (sprinting ? 12.8 : 8.8)
    const stride = Math.min(1, speed / 6)
    const armSwing = Math.sin(this.bobTime) * 0.34 * stride
    const legSwing = Math.sin(this.bobTime) * 0.42 * stride
    const aimDip = THREE.MathUtils.clamp(pitch, -0.7, 0.55)

    this.head.rotation.x = aimDip * 0.35
    this.chest.rotation.x = aimDip * 0.08
    this.leftArm.rotation.x = -0.42 - armSwing * 0.18
    this.rightArm.rotation.x = -0.5 + armSwing * 0.12
    this.leftLeg.rotation.x = legSwing
    this.rightLeg.rotation.x = -legSwing
    this.weaponGroup.rotation.x = -0.08 + aimDip * 0.52
    this.weaponGroup.position.y = 1.14 + Math.abs(Math.cos(this.bobTime)) * 0.025 * stride
  }

  dispose(): void {
    this.group.removeFromParent()
    this.disposeWeaponMeshes()
    for (const object of [this.chest, this.head, this.leftArm, this.rightArm, this.leftLeg, this.rightLeg]) {
      object.geometry.dispose()
    }
    this.bodyMaterial.dispose()
    this.armorMaterial.dispose()
    this.visorMaterial.dispose()
    this.limbMaterial.dispose()
    this.weaponMaterial.dispose()
    this.weaponGlowMaterial.dispose()
  }

  private rebuildWeapon(definition: WeaponDefinition): void {
    this.disposeWeaponMeshes()
    this.activeWeaponId = definition.id
    this.weaponGlowMaterial.color.setHex(definition.tracerColor)
    this.weaponGlowMaterial.emissive.setHex(definition.tracerColor)

    const length = definition.id === 'shotgun' ? 0.78 : definition.id === 'smg' ? 0.58 : definition.id === 'railgun' ? 1.04 : 0.86
    const body = new THREE.Mesh(new THREE.BoxGeometry(length * 0.58, 0.13, 0.16), this.weaponMaterial)
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(length, 0.055, 0.055), this.weaponGlowMaterial)
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.24, 0.12), this.weaponMaterial)
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.11, 0.18), this.weaponMaterial)

    body.position.z = -length * 0.28
    barrel.position.z = -length * 0.62
    grip.position.set(0.04, -0.17, -length * 0.22)
    grip.rotation.x = -0.28
    stock.position.set(0, 0.01, 0.1)
    this.muzzle.position.set(0, 0.01, -length - 0.08)
    this.weaponGroup.add(body, barrel, grip, stock)

    if (definition.id === 'railgun' || definition.id === 'lmg') {
      const topRail = new THREE.Mesh(new THREE.BoxGeometry(length * 0.46, 0.045, 0.08), this.weaponGlowMaterial)
      topRail.position.set(0, 0.115, -length * 0.34)
      this.weaponGroup.add(topRail)
    }
  }

  private disposeWeaponMeshes(): void {
    for (let i = this.weaponGroup.children.length - 1; i >= 0; i -= 1) {
      const child = this.weaponGroup.children[i]
      if (child === this.muzzle) continue
      this.weaponGroup.remove(child)
      if (child instanceof THREE.Mesh) child.geometry.dispose()
    }
  }
}
