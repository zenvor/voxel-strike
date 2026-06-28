import './style.css'
import { DEFAULT_SETTINGS, Game } from './game/game'
import { WEAPONS, type Difficulty, type GameSettings } from './game/types'

const randomSeed = (): number => Math.floor(100000 + Math.random() * 899999)
const SETTINGS_VERSION = 2

const saved = (() => {
  try {
    const parsed = JSON.parse(localStorage.getItem('voxel-strike-settings') ?? '{}') as Partial<GameSettings> & { configVersion?: number }
    if (parsed.configVersion !== SETTINGS_VERSION && typeof parsed.sensitivity === 'number') {
      parsed.sensitivity = Math.max(0.2, Math.min(0.75, parsed.sensitivity * 0.52))
    }
    return parsed
  } catch {
    return {}
  }
})()

const initialSettings: GameSettings = {
  ...DEFAULT_SETTINGS,
  ...saved,
  seed: Number.isFinite(saved.seed) ? Number(saved.seed) : randomSeed(),
}

const weaponSlotsMarkup = WEAPONS.map((weapon, index) => `
  <span class="arsenal-slot ${index < 3 ? '' : 'locked'}" data-weapon-id="${weapon.id}" data-code="${weapon.code}">
    <kbd>${index + 1}</kbd><b>${weapon.code}</b><i></i>
  </span>
`).join('')

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <canvas id="game-canvas" aria-label="方块前线 3D 游戏画面"></canvas>
  <div class="screen-vignette"></div>
  <div class="screen-grain"></div>

  <section id="loading-screen" class="loading-screen">
    <div class="loading-core">
      <div class="loading-cube" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="eyebrow">VX // WORLD COMPILER</div>
      <h2>正在构建方块前线</h2>
      <div class="loading-track"><span id="loading-bar-fill"></span></div>
      <p id="loading-text">生成地形、战术设施与光照场……</p>
    </div>
  </section>

  <main id="main-menu" class="overlay menu-overlay visible">
    <div class="menu-shell">
      <header class="menu-header">
        <div class="mini-brand"><span class="brand-cube"></span> VX INDUSTRIES</div>
        <div class="build-tag"><i></i> LIVE BUILD 02.10</div>
      </header>

      <div class="menu-layout">
        <section class="hero-panel">
          <div class="protocol-tag"><span>PROTOCOL</span><b>07</b></div>
          <div class="hero-title">
            <span class="title-voxel">VOXEL</span>
            <span class="title-strike">STRIKE</span>
          </div>
          <h1>方块前线</h1>
          <p class="hero-copy">恒定白昼下，一整个世界都能被你的子弹改写。搜集敌人战利品、解锁六种枪械、利用补给箱续航，在可破坏战区击退五轮机械军团。</p>

          <div class="feature-rail">
            <span><i>01</i>程序化战区</span>
            <span><i>02</i>实时破坏</span>
            <span><i>03</i>第三人称肩射</span>
            <span><i>04</i>战术机动</span>
          </div>

          <div class="start-card tactical-card">
            <div class="card-label">DEPLOYMENT CONFIG</div>
            <div class="difficulty-row" role="group" aria-label="选择难度">
              <button class="choice-button" data-difficulty="recruit" type="button"><b>新兵</b><span>高容错</span></button>
              <button class="choice-button active" data-difficulty="elite" type="button"><b>精英</b><span>标准协议</span></button>
              <button class="choice-button" data-difficulty="nightmare" type="button"><b>梦魇</b><span>极限火力</span></button>
            </div>

            <div class="seed-row">
              <label for="seed-input"><span>世界种子</span><small>决定地形、遗迹与植被</small></label>
              <div class="seed-control">
                <input id="seed-input" type="number" min="1" max="99999999" value="${initialSettings.seed}" />
                <button id="random-seed" type="button" aria-label="随机世界种子">↻</button>
              </div>
            </div>

            <button id="start-game" class="primary-button" type="button">
              <span class="button-code">[ ENTER ]</span>
              <b>进入战区</b>
              <span class="button-arrow">→</span>
            </button>
          </div>
        </section>

        <aside class="intel-column">
          <section class="tactical-card mission-card">
            <div class="card-heading"><span>MISSION // 001</span><b>最后防线</b></div>
            <div class="mission-visual" aria-hidden="true">
              <div class="radar-rings"><i></i><i></i><i></i><span></span></div>
              <div class="mission-count"><b>5</b><span>WAVES</span></div>
            </div>
            <p>机械军团正在收缩包围圈。利用可破坏地形和临时掩体，在终局攻势结束前保持存活。</p>
            <div class="mission-stats">
              <span><small>模式</small><b>白昼生存</b></span>
              <span><small>武器</small><b>6</b></span>
              <span><small>敌型</small><b>3</b></span>
            </div>
          </section>

          <section class="tactical-card settings-card">
            <div class="card-label">SYSTEM TUNING</div>
            <label class="slider-setting">
              <span>鼠标灵敏度 <b id="sensitivity-value">${initialSettings.sensitivity.toFixed(2)}</b></span>
              <input id="sensitivity-input" type="range" min="0.15" max="1.00" step="0.05" value="${initialSettings.sensitivity}" />
            </label>
            <label class="slider-setting">
              <span>主音量 <b id="volume-value">${Math.round(initialSettings.volume * 100)}%</b></span>
              <input id="volume-input" type="range" min="0" max="1" step="0.05" value="${initialSettings.volume}" />
            </label>
            <div class="quality-setting">
              <span>画质预设</span>
              <div class="quality-row" role="group" aria-label="选择画质">
                <button data-quality="performance" type="button">性能</button>
                <button data-quality="balanced" type="button">均衡</button>
                <button data-quality="cinematic" type="button">电影</button>
              </div>
            </div>
          </section>

          <section class="tactical-card controls-card">
            <div class="card-label">FIELD MANUAL</div>
            <div class="control-grid">
              <span><kbd>WASD</kbd><b>移动</b></span>
              <span><kbd>SHIFT</kbd><b>冲刺</b></span>
              <span><kbd>F</kbd><b>战术冲刺</b></span>
              <span><kbd>SPACE</kbd><b>跳跃</b></span>
              <span><kbd>鼠标左键</kbd><b>射击</b></span>
              <span><kbd>鼠标右键</kbd><b>精确瞄准</b></span>
              <span><kbd>V</kbd><b>切换视角</b></span>
              <span><kbd>Q</kbd><b>部署方块</b></span>
              <span><kbd>E</kbd><b>使用补给箱</b></span>
              <span><kbd>G</kbd><b>电浆手雷</b></span>
              <span><kbd>1 — 6</kbd><b>切换武器</b></span>
              <span><kbd>R</kbd><b>换弹</b></span>
            </div>
          </section>
        </aside>
      </div>

      <footer class="menu-footer">
        <span>WEBGL 2.0</span><span>DAYLIGHT LOCKED</span><span>DYNAMIC LOOT</span>
        <b>ESC 暂停 · 建议使用桌面端浏览器</b>
      </footer>
    </div>
  </main>

  <section id="hud" class="hud">
    <div class="hud-top-left">
      <div class="hud-brand"><span class="brand-cube"></span><b>VOXEL STRIKE</b><small>PROTOCOL 7</small></div>
      <div class="objective-panel">
        <span>当前任务</span>
        <b id="objective-text">等待战区同步</b>
      </div>
    </div>

    <div class="wave-panel">
      <span>敌袭波次</span>
      <b id="wave-value">1/5</b>
      <small>剩余目标 <i id="wave-remaining">0</i></small>
    </div>

    <div class="hud-top-right">
      <div class="score-panel">
        <span>SCORE</span><b id="score-value">0</b>
        <small>最高 <i id="high-score-value">0</i></small>
      </div>
      <div class="radar-shell">
        <canvas id="radar" width="180" height="180"></canvas>
        <span class="radar-label">TACTICAL RADAR // 34M</span>
      </div>
    </div>

    <div id="event-feed" class="event-feed"></div>

    <div class="vitals-panel">
      <div class="vital-row health-row">
        <span class="vital-icon">+</span>
        <div><small>生命</small><b id="health-value">100</b></div>
        <div class="vital-track"><i id="health-fill"></i></div>
      </div>
      <div class="vital-row shield-row">
        <span class="vital-icon">◇</span>
        <div><small>护盾</small><b id="shield-value">50</b></div>
        <div class="vital-track"><i id="shield-fill"></i></div>
      </div>
      <div class="stamina-row"><span>冲刺</span><div><i id="stamina-fill"></i></div></div>
    </div>

    <div class="weapon-panel">
      <div class="weapon-heading"><span id="weapon-code">VX-7</span><b id="weapon-name">脉冲步枪</b></div>
      <div class="ammo-display"><b id="ammo-current">30</b><span>/</span><i id="ammo-reserve">180</i></div>
      <div id="reload-progress" class="reload-progress"><span id="reload-fill"></span><b>RELOADING</b></div>
      <div id="arsenal-slots" class="arsenal-slots">${weaponSlotsMarkup}</div>
      <div class="equipment-row">
        <span><kbd>G</kbd> 手雷 <b id="grenade-count">3</b></span>
        <span><kbd>Q</kbd> 方块 <b id="build-count">28</b></span>
        <span><kbd>F</kbd> 冲刺</span>
        <span><kbd>V</kbd> 视角</span>
        <span><kbd>E</kbd> 补给</span>
      </div>
    </div>

    <div class="combo-panel"><span>连杀倍率</span><b id="combo-value">×1</b></div>
    <div class="performance-tag"><i></i><span id="fps-value">60 FPS</span></div>

    <div id="crosshair" class="crosshair">
      <i class="crosshair-top"></i><i class="crosshair-right"></i><i class="crosshair-bottom"></i><i class="crosshair-left"></i><b></b>
    </div>
    <div id="hitmarker" class="hitmarker"><i></i><i></i><i></i><i></i></div>
    <div id="interact-hint" class="interact-hint">按 Q 部署金属方块</div>

    <div id="announcement" class="announcement">
      <span class="announce-line"></span>
      <h2 id="announce-title">协议启动</h2>
      <p id="announce-subtitle">战区已同步</p>
    </div>
  </section>

  <div id="damage-overlay" class="damage-overlay"></div>

  <section id="pause-menu" class="overlay center-overlay">
    <div class="pause-panel tactical-card">
      <div class="pause-code">SYSTEM // PAUSED</div>
      <h2>战术暂停</h2>
      <p>指针锁定已释放。战区状态保持冻结。</p>
      <button id="resume-game" class="primary-button compact" type="button"><span>[ ESC ]</span><b>返回战区</b><i>→</i></button>
      <div class="secondary-actions">
        <button id="pause-restart" type="button">重新部署</button>
        <button id="pause-menu-button" type="button">返回主菜单</button>
      </div>
    </div>
  </section>

  <section id="end-screen" class="overlay center-overlay end-overlay">
    <div class="end-panel tactical-card">
      <div class="end-emblem"><span></span><i></i></div>
      <div class="pause-code">AFTER ACTION REPORT</div>
      <h2 id="end-title">协议完成</h2>
      <p id="end-subtitle">五轮敌袭已被彻底击退。</p>
      <div class="end-stats">
        <span><small>最终得分</small><b id="end-score">0</b></span>
        <span><small>击破目标</small><b id="end-kills">0</b></span>
        <span><small>生存时间</small><b id="end-time">00:00</b></span>
      </div>
      <button id="end-restart" class="primary-button compact" type="button"><span>[ ENTER ]</span><b>再次部署</b><i>→</i></button>
      <button id="end-menu-button" class="text-button" type="button">返回主菜单</button>
    </div>
  </section>

  <div class="mobile-warning">
    <b>需要键盘与鼠标</b><span>请在桌面端浏览器中开启完整作战协议。</span>
  </div>
`

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')!
const sensitivityInput = document.querySelector<HTMLInputElement>('#sensitivity-input')!
const sensitivityValue = document.querySelector<HTMLElement>('#sensitivity-value')!
const volumeInput = document.querySelector<HTMLInputElement>('#volume-input')!
const volumeValue = document.querySelector<HTMLElement>('#volume-value')!
const seedInput = document.querySelector<HTMLInputElement>('#seed-input')!

let selectedDifficulty: Difficulty = initialSettings.difficulty
let selectedQuality: GameSettings['quality'] = initialSettings.quality

const syncChoiceButtons = (): void => {
  document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((button) => {
    button.classList.toggle('active', button.dataset.difficulty === selectedDifficulty)
  })
  document.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((button) => {
    button.classList.toggle('active', button.dataset.quality === selectedQuality)
  })
}

syncChoiceButtons()

document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((button) => {
  button.addEventListener('click', () => {
    selectedDifficulty = button.dataset.difficulty as Difficulty
    syncChoiceButtons()
  })
})

document.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((button) => {
  button.addEventListener('click', () => {
    selectedQuality = button.dataset.quality as GameSettings['quality']
    syncChoiceButtons()
  })
})

sensitivityInput.addEventListener('input', () => {
  sensitivityValue.textContent = Number(sensitivityInput.value).toFixed(2)
})
volumeInput.addEventListener('input', () => {
  volumeValue.textContent = `${Math.round(Number(volumeInput.value) * 100)}%`
})
document.querySelector<HTMLButtonElement>('#random-seed')!.addEventListener('click', () => {
  seedInput.value = String(randomSeed())
})

let game: Game
try {
  game = new Game(canvas, initialSettings)
} catch (error) {
  console.error(error)
  document.querySelector<HTMLElement>('#loading-text')!.textContent = 'WebGL 初始化失败，请更新浏览器或显卡驱动。'
  throw error
}

if (import.meta.env.DEV) {
  ;(window as Window & { __VOXEL_STRIKE_DEV__?: Game }).__VOXEL_STRIKE_DEV__ = game
}

const readSettings = (): GameSettings => {
  const settings: GameSettings = {
    sensitivity: Number(sensitivityInput.value),
    volume: Number(volumeInput.value),
    quality: selectedQuality,
    difficulty: selectedDifficulty,
    seed: Math.max(1, Math.min(99999999, Number(seedInput.value) || randomSeed())),
  }
  localStorage.setItem('voxel-strike-settings', JSON.stringify({ ...settings, configVersion: SETTINGS_VERSION }))
  return settings
}

document.querySelector<HTMLButtonElement>('#start-game')!.addEventListener('click', () => game.start(readSettings()))
document.querySelector<HTMLButtonElement>('#resume-game')!.addEventListener('click', () => game.resume())
document.querySelector<HTMLButtonElement>('#pause-restart')!.addEventListener('click', () => game.restart())
document.querySelector<HTMLButtonElement>('#pause-menu-button')!.addEventListener('click', () => game.returnToMenu())
document.querySelector<HTMLButtonElement>('#end-restart')!.addEventListener('click', () => game.restart())
document.querySelector<HTMLButtonElement>('#end-menu-button')!.addEventListener('click', () => game.returnToMenu())
