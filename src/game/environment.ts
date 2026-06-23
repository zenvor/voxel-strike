import * as THREE from 'three'
import type { GameSettings } from './types'

export class Environment {
  readonly sun = new THREE.DirectionalLight(0xfff3d8, 2.45)
  readonly hemisphere = new THREE.HemisphereLight(0xb9e8ff, 0x43515a, 1.55)
  readonly ambient = new THREE.AmbientLight(0xa9cbd2, 0.54)

  private readonly scene: THREE.Scene
  private readonly sky: THREE.Mesh
  private readonly clouds = new THREE.Group()
  private readonly cloudGeometry = new THREE.BoxGeometry(1, 1, 1)
  private readonly cloudMaterial = new THREE.MeshLambertMaterial({
    color: 0xf2f8ff,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  })
  private readonly skyMaterial: THREE.ShaderMaterial
  private elapsed = 0

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, settings: GameSettings) {
    this.scene = scene
    scene.fog = new THREE.Fog(0xa4c3d2, 27, settings.quality === 'performance' ? 70 : 94)

    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x286b9d) },
        horizonColor: { value: new THREE.Color(0xa8d6e7) },
        bottomColor: { value: new THREE.Color(0xe8d7a9) },
        sunColor: { value: new THREE.Color(0xffedb8) },
        sunDirection: { value: new THREE.Vector3(0.35, 0.78, -0.45).normalize() },
      },
      vertexShader: `
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vDirection;
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 bottomColor;
        uniform vec3 sunColor;
        uniform vec3 sunDirection;
        void main() {
          float h = clamp(vDirection.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 low = mix(bottomColor, horizonColor, smoothstep(0.0, 0.48, h));
          vec3 sky = mix(low, topColor, smoothstep(0.42, 1.0, h));
          float sun = pow(max(dot(normalize(vDirection), normalize(sunDirection)), 0.0), 420.0);
          float halo = pow(max(dot(normalize(vDirection), normalize(sunDirection)), 0.0), 18.0);
          sky += sunColor * sun * 2.8 + sunColor * halo * 0.22;
          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    })
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(155, 30, 20), this.skyMaterial)
    this.sky.renderOrder = -10
    scene.add(this.sky)

    const rngCloudCount = settings.quality === 'performance' ? 12 : settings.quality === 'cinematic' ? 28 : 21
    for (let i = 0; i < rngCloudCount; i += 1) {
      const cloud = new THREE.Group()
      const pieces = 3 + Math.floor(Math.random() * 4)
      for (let p = 0; p < pieces; p += 1) {
        const cube = new THREE.Mesh(this.cloudGeometry, this.cloudMaterial)
        cube.position.set((p - pieces / 2) * 2.2 + Math.random(), Math.random() * 0.6, Math.random() * 1.8)
        cube.scale.set(2.6 + Math.random() * 2.8, 0.5 + Math.random() * 0.45, 1.7 + Math.random() * 2.4)
        cloud.add(cube)
      }
      cloud.position.set((Math.random() - 0.5) * 116, 24 + Math.random() * 14, (Math.random() - 0.5) * 116)
      cloud.userData.speed = 0.3 + Math.random() * 0.33
      this.clouds.add(cloud)
    }
    scene.add(this.clouds)

    this.sun.position.set(38, 62, -42)
    this.sun.castShadow = settings.quality !== 'performance'
    const shadowSize = settings.quality === 'cinematic' ? 2048 : 1024
    this.sun.shadow.mapSize.set(shadowSize, shadowSize)
    this.sun.shadow.camera.left = -36
    this.sun.shadow.camera.right = 36
    this.sun.shadow.camera.top = 36
    this.sun.shadow.camera.bottom = -36
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 120
    this.sun.shadow.bias = -0.00016
    this.sun.shadow.normalBias = 0.018
    scene.add(this.sun, this.sun.target, this.hemisphere, this.ambient)

    renderer.shadowMap.enabled = settings.quality !== 'performance'
    renderer.shadowMap.type = THREE.PCFShadowMap
  }

  update(dt: number, cameraPosition: THREE.Vector3): void {
    this.elapsed += dt
    // “白昼锁定”：太阳只做极小幅度漂移，永远不会进入黄昏或黑夜。
    const drift = Math.sin(this.elapsed * 0.012) * 0.08
    const verticalDrift = Math.sin(this.elapsed * 0.008 + 0.9) * 0.025
    const sunDirection = new THREE.Vector3(0.48 + drift, 0.8 + verticalDrift, -0.42 + drift * 0.25).normalize()

    this.sky.position.copy(cameraPosition)
    this.skyMaterial.uniforms.sunDirection.value.copy(sunDirection)
    this.sun.position.copy(cameraPosition).addScaledVector(sunDirection, 78)
    this.sun.target.position.set(cameraPosition.x, 4, cameraPosition.z)
    this.sun.intensity = 2.35 + Math.sin(this.elapsed * 0.01) * 0.08
    this.hemisphere.intensity = 1.52
    this.ambient.intensity = 0.54

    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.set(0xa4c3d2)
    }

    for (const cloud of this.clouds.children) {
      cloud.position.x += (cloud.userData.speed as number) * dt
      if (cloud.position.x > 70) cloud.position.x = -70
    }
    this.cloudMaterial.opacity = 0.19 + Math.sin(this.elapsed * 0.015) * 0.015
  }

  dispose(): void {
    this.scene.remove(this.sky, this.clouds, this.sun, this.sun.target, this.hemisphere, this.ambient)
    this.sky.geometry.dispose()
    this.skyMaterial.dispose()
    this.cloudGeometry.dispose()
    this.cloudMaterial.dispose()
  }
}
