"use client"

import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WIDTH = 900
const HEIGHT = 506
const GROUND_H = 70
const GROUND_Y = HEIGHT - GROUND_H
const GRAVITY = 0.62
const PLAYER_SPEED = 4.6
const PLAYER_JUMP = 15
const PLAYER_R = 34 // body collision radius
const BALL_R = 15
const BALL_BOUNCE = 0.7
const BALL_FRICTION = 0.985
const GOAL_H = 158
const GOAL_W = 26
const KICK_POWER = 13
const MATCH_TIME = 90 // seconds

type Mode = "cpu" | "2p"
type Difficulty = "easy" | "normal" | "hard"
type GameState = "menu" | "kickoff" | "playing" | "goal" | "ended"

type Team = {
  name: string
  jersey: string
  jerseyDark: string
  skin: string
  hair: string
  shorts: string
}

const TEAMS: Team[] = [
  { name: "Red", jersey: "#ef4444", jerseyDark: "#b91c1c", skin: "#f1c27d", hair: "#2b1a0e", shorts: "#ffffff" },
  { name: "Blue", jersey: "#3b82f6", jerseyDark: "#1d4ed8", skin: "#e0a96d", hair: "#0b0b0b", shorts: "#111827" },
]

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
type Player = {
  x: number
  y: number // position of feet (ground contact point)
  vx: number
  vy: number
  onGround: boolean
  facing: 1 | -1
  kickTimer: number // frames remaining in a kick animation
  team: Team
  isCpu: boolean
}

type Ball = {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vrot: number
}

function makePlayer(x: number, facing: 1 | -1, team: Team, isCpu: boolean): Player {
  return { x, y: GROUND_Y, vx: 0, vy: 0, onGround: true, facing, kickTimer: 0, team, isCpu }
}

function makeBall(): Ball {
  return { x: WIDTH / 2, y: GROUND_Y - 160, vx: 0, vy: 0, rot: 0, vrot: 0 }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function FootballGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const keysRef = useRef<Record<string, boolean>>({})

  const [mode, setMode] = useState<Mode>("cpu")
  const [difficulty, setDifficulty] = useState<Difficulty>("normal")
  const [gameState, setGameState] = useState<GameState>("menu")
  const [score, setScore] = useState<[number, number]>([0, 0])
  const [timeLeft, setTimeLeft] = useState(MATCH_TIME)
  const [message, setMessage] = useState<string>("")

  // Mutable simulation refs (so the RAF loop never gets stale values)
  const stateRef = useRef<GameState>("menu")
  const modeRef = useRef<Mode>("cpu")
  const diffRef = useRef<Difficulty>("normal")
  const scoreRef = useRef<[number, number]>([0, 0])
  const timeRef = useRef(MATCH_TIME)
  const lastTickRef = useRef(0)
  const freezeUntilRef = useRef(0)

  const p1Ref = useRef<Player>(makePlayer(WIDTH * 0.28, 1, TEAMS[0], false))
  const p2Ref = useRef<Player>(makePlayer(WIDTH * 0.72, -1, TEAMS[1], true))
  const ballRef = useRef<Ball>(makeBall())

  useEffect(() => {
    stateRef.current = gameState
  }, [gameState])
  useEffect(() => {
    modeRef.current = mode
  }, [mode])
  useEffect(() => {
    diffRef.current = difficulty
  }, [difficulty])

  const resetPositions = useCallback((servingLeft: boolean) => {
    p1Ref.current = makePlayer(WIDTH * 0.28, 1, TEAMS[0], false)
    p2Ref.current = makePlayer(WIDTH * 0.72, -1, TEAMS[1], modeRef.current === "cpu")
    const b = makeBall()
    // nudge ball toward the team that was scored on
    b.vx = servingLeft ? -2 : 2
    ballRef.current = b
  }, [])

  const startMatch = useCallback(() => {
    scoreRef.current = [0, 0]
    setScore([0, 0])
    timeRef.current = MATCH_TIME
    setTimeLeft(MATCH_TIME)
    resetPositions(true)
    freezeUntilRef.current = performance.now() + 900
    lastTickRef.current = performance.now()
    setMessage("KICK OFF!")
    setGameState("playing")
  }, [resetPositions])

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (
        ["arrowleft", "arrowright", "arrowup", "arrowdown", " ", "w", "a", "s", "d"].includes(k)
      ) {
        e.preventDefault()
      }
      keysRef.current[k] = true
    }
    const up = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = false
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [])

  // -------------------------------------------------------------------------
  // Physics helpers
  // -------------------------------------------------------------------------
  const controlPlayer = (
    p: Player,
    left: boolean,
    right: boolean,
    jump: boolean,
    kick: boolean,
  ) => {
    if (left && !right) {
      p.vx = -PLAYER_SPEED
      p.facing = -1
    } else if (right && !left) {
      p.vx = PLAYER_SPEED
      p.facing = 1
    } else {
      p.vx *= 0.6
    }
    if (jump && p.onGround) {
      p.vy = -PLAYER_JUMP
      p.onGround = false
    }
    if (kick && p.kickTimer <= 0 && p.onGround) {
      p.kickTimer = 14
    }
  }

  const integratePlayer = (p: Player) => {
    p.vy += GRAVITY
    p.x += p.vx
    p.y += p.vy
    if (p.y >= GROUND_Y) {
      p.y = GROUND_Y
      p.vy = 0
      p.onGround = true
    }
    // keep on pitch
    if (p.x < PLAYER_R) p.x = PLAYER_R
    if (p.x > WIDTH - PLAYER_R) p.x = WIDTH - PLAYER_R
    if (p.kickTimer > 0) p.kickTimer--
  }

  // Center of the player body used for ball collisions.
  const bodyCenter = (p: Player) => ({ x: p.x, y: p.y - 46 })

  // The tip of the foot when kicking, used to detect a powered strike.
  const footTip = (p: Player) => {
    const swing = p.kickTimer > 0 ? Math.sin((1 - p.kickTimer / 14) * Math.PI) : 0
    const reach = 26 + swing * 30
    return { x: p.x + p.facing * reach, y: p.y - 10 - swing * 10 }
  }

  const ballPlayerCollision = (ball: Ball, p: Player) => {
    // Body collision (soft bump)
    const c = bodyCenter(p)
    let dx = ball.x - c.x
    let dy = ball.y - c.y
    let dist = Math.hypot(dx, dy) || 0.001
    const minDist = BALL_R + PLAYER_R
    if (dist < minDist) {
      const nx = dx / dist
      const ny = dy / dist
      const overlap = minDist - dist
      ball.x += nx * overlap
      ball.y += ny * overlap
      const rel = ball.vx * nx + ball.vy * ny
      const bump = 6.5
      ball.vx += nx * (bump - rel * 0.5) + p.vx * 0.6
      ball.vy += ny * (bump - rel * 0.5) - 1
      ball.vrot = ball.vx * 0.05
    }

    // Powered kick
    if (p.kickTimer > 0) {
      const f = footTip(p)
      dx = ball.x - f.x
      dy = ball.y - f.y
      dist = Math.hypot(dx, dy)
      if (dist < BALL_R + 20) {
        const power = KICK_POWER
        ball.vx = p.facing * power + p.vx * 0.5
        ball.vy = -power * 0.62
        ball.vrot = p.facing * 0.4
      }
    }
  }

  const integrateBall = (ball: Ball): "left" | "right" | null => {
    ball.vy += GRAVITY * 0.72
    ball.vx *= BALL_FRICTION
    ball.x += ball.vx
    ball.y += ball.vy
    ball.rot += ball.vrot
    ball.vrot *= 0.98

    // ground
    if (ball.y > GROUND_Y - BALL_R) {
      ball.y = GROUND_Y - BALL_R
      ball.vy *= -BALL_BOUNCE
      ball.vx *= 0.985
      ball.vrot = ball.vx * 0.05
      if (Math.abs(ball.vy) < 1.2) ball.vy = 0
    }
    // ceiling
    if (ball.y < BALL_R) {
      ball.y = BALL_R
      ball.vy *= -BALL_BOUNCE
    }

    const goalTop = GROUND_Y - GOAL_H
    // left goal check: ball crosses into left goal mouth
    if (ball.x - BALL_R < GOAL_W && ball.y > goalTop) {
      return "left"
    }
    // right goal
    if (ball.x + BALL_R > WIDTH - GOAL_W && ball.y > goalTop) {
      return "right"
    }

    // side walls (above the goal, or full wall)
    if (ball.x < BALL_R) {
      ball.x = BALL_R
      ball.vx *= -BALL_BOUNCE
    }
    if (ball.x > WIDTH - BALL_R) {
      ball.x = WIDTH - BALL_R
      ball.vx *= -BALL_BOUNCE
    }
    // Goal crossbar collision (bounce off top of net frame)
    if (ball.y < goalTop && ball.y > goalTop - BALL_R * 2) {
      if (ball.x - BALL_R < GOAL_W || ball.x + BALL_R > WIDTH - GOAL_W) {
        if (ball.y + BALL_R > goalTop && ball.vy > 0) {
          ball.y = goalTop - BALL_R
          ball.vy *= -BALL_BOUNCE
        }
      }
    }
    return null
  }

  // Simple but lively CPU AI
  const runAi = (p: Player, ball: Ball) => {
    const diff = diffRef.current
    const react = diff === "easy" ? 0.4 : diff === "normal" ? 0.62 : 0.85
    const aggression = diff === "easy" ? 0.22 : diff === "normal" ? 0.4 : 0.6

    // CPU defends the right goal and attacks left.
    const targetX = ball.x + BALL_R + 8
    let left = false
    let right = false
    let jump = false
    let kick = false

    if (Math.random() < react) {
      if (p.x > targetX + 6) left = true
      else if (p.x < targetX - 6) right = true
    }

    // jump for high balls near the player
    if (ball.y < GROUND_Y - 120 && Math.abs(ball.x - p.x) < 90 && p.onGround && Math.random() < aggression * 0.15) {
      jump = true
    }

    // kick when ball is in front and close
    const inFront = (ball.x - p.x) * p.facing > -20
    if (Math.abs(ball.x - p.x) < 70 && Math.abs(ball.y - (p.y - 40)) < 90 && inFront && Math.random() < aggression) {
      kick = true
    }

    // Make sure CPU faces the ball / goal it attacks (left)
    if (ball.x < p.x) p.facing = -1
    else p.facing = 1
    // But when far behind ball, chase toward left goal to attack
    if (Math.abs(ball.x - p.x) < 40 && p.x < ball.x) p.facing = -1

    controlPlayer(p, left, right, jump, kick)
  }

  const concede = useCallback((scoringSide: "p1" | "p2") => {
    const s: [number, number] = [...scoreRef.current] as [number, number]
    if (scoringSide === "p1") s[0]++
    else s[1]++
    scoreRef.current = s
    setScore(s)
    setMessage(scoringSide === "p1" ? `${TEAMS[0].name} scores!` : `${TEAMS[1].name} scores!`)
    setGameState("goal")
    stateRef.current = "goal"
    // resume after short celebration
    window.setTimeout(() => {
      if (timeRef.current <= 0) {
        endMatch()
        return
      }
      resetPositions(scoringSide === "p1")
      freezeUntilRef.current = performance.now() + 700
      setMessage("")
      setGameState("playing")
      stateRef.current = "playing"
      lastTickRef.current = performance.now()
    }, 1200)
  }, [resetPositions])

  const endMatch = useCallback(() => {
    const [a, b] = scoreRef.current
    setMessage(a === b ? "FULL TIME — Draw!" : a > b ? `${TEAMS[0].name} wins!` : `${TEAMS[1].name} wins!`)
    setGameState("ended")
    stateRef.current = "ended"
  }, [])

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const loop = () => {
      const now = performance.now()
      const st = stateRef.current

      if (st === "playing") {
        const frozen = now < freezeUntilRef.current

        // clock
        if (!frozen && now - lastTickRef.current >= 1000) {
          lastTickRef.current += 1000
          timeRef.current = Math.max(0, timeRef.current - 1)
          setTimeLeft(timeRef.current)
          if (timeRef.current <= 0) {
            endMatch()
          }
        }

        if (!frozen && stateRef.current === "playing") {
          const keys = keysRef.current
          const p1 = p1Ref.current
          const p2 = p2Ref.current
          const ball = ballRef.current

          // Player 1 controls
          controlPlayer(
            p1,
            keys["a"],
            keys["d"],
            keys["w"],
            keys["s"] || keys[" "],
          )

          // Player 2 or CPU
          if (modeRef.current === "cpu") {
            runAi(p2, ball)
          } else {
            controlPlayer(
              p2,
              keys["arrowleft"],
              keys["arrowright"],
              keys["arrowup"],
              keys["arrowdown"] || keys["enter"],
            )
          }

          integratePlayer(p1)
          integratePlayer(p2)
          ballPlayerCollision(ball, p1)
          ballPlayerCollision(ball, p2)
          const goal = integrateBall(ball)
          if (goal === "left") concede("p2")
          else if (goal === "right") concede("p1")
        }
      }

      draw(ctx)
      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concede, endMatch])

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  const draw = (ctx: CanvasRenderingContext2D) => {
    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y)
    sky.addColorStop(0, "#1e3a8a")
    sky.addColorStop(1, "#3b82f6")
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, WIDTH, GROUND_Y)

    // Stadium stands
    ctx.fillStyle = "rgba(255,255,255,0.06)"
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(0, 40 + i * 34, WIDTH, 18)
    }
    // crowd dots
    ctx.save()
    for (let i = 0; i < 220; i++) {
      const cx = (i * 53) % WIDTH
      const cy = 44 + ((i * 29) % 90)
      ctx.fillStyle = ["#f87171", "#60a5fa", "#fbbf24", "#f3f4f6", "#34d399"][i % 5]
      ctx.globalAlpha = 0.5
      ctx.fillRect(cx, cy, 4, 4)
    }
    ctx.restore()

    // Pitch
    const grass = ctx.createLinearGradient(0, GROUND_Y, 0, HEIGHT)
    grass.addColorStop(0, "#22c55e")
    grass.addColorStop(1, "#15803d")
    ctx.fillStyle = grass
    ctx.fillRect(0, GROUND_Y, WIDTH, GROUND_H)
    // mow stripes
    ctx.fillStyle = "rgba(0,0,0,0.06)"
    for (let i = 0; i < WIDTH; i += 90) {
      ctx.fillRect(i, GROUND_Y, 45, GROUND_H)
    }
    // center line + halo
    ctx.strokeStyle = "rgba(255,255,255,0.5)"
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(WIDTH / 2, GROUND_Y)
    ctx.lineTo(WIDTH / 2, HEIGHT)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(WIDTH / 2, GROUND_Y, 46, 0, Math.PI, false)
    ctx.stroke()

    // Goals
    drawGoal(ctx, true)
    drawGoal(ctx, false)

    // Entities
    drawPlayer(ctx, p1Ref.current)
    drawPlayer(ctx, p2Ref.current)
    drawBall(ctx, ballRef.current)
  }

  const drawGoal = (ctx: CanvasRenderingContext2D, isLeft: boolean) => {
    const top = GROUND_Y - GOAL_H
    const x = isLeft ? 0 : WIDTH - GOAL_W
    // net
    ctx.save()
    ctx.strokeStyle = "rgba(255,255,255,0.35)"
    ctx.lineWidth = 1
    for (let gx = x; gx <= x + GOAL_W; gx += 6) {
      ctx.beginPath()
      ctx.moveTo(gx, top)
      ctx.lineTo(gx, GROUND_Y)
      ctx.stroke()
    }
    for (let gy = top; gy <= GROUND_Y; gy += 6) {
      ctx.beginPath()
      ctx.moveTo(x, gy)
      ctx.lineTo(x + GOAL_W, gy)
      ctx.stroke()
    }
    // frame
    ctx.strokeStyle = "#f8fafc"
    ctx.lineWidth = 5
    ctx.beginPath()
    const postX = isLeft ? GOAL_W : WIDTH - GOAL_W
    ctx.moveTo(postX, GROUND_Y)
    ctx.lineTo(postX, top)
    ctx.lineTo(isLeft ? 0 : WIDTH, top)
    ctx.stroke()
    ctx.restore()
  }

  const drawBall = (ctx: CanvasRenderingContext2D, ball: Ball) => {
    ctx.save()
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.2)"
    ctx.beginPath()
    ctx.ellipse(ball.x, GROUND_Y - 4, BALL_R * 0.9, 5, 0, 0, Math.PI * 2)
    ctx.fill()

    ctx.translate(ball.x, ball.y)
    ctx.rotate(ball.rot)
    ctx.fillStyle = "#ffffff"
    ctx.beginPath()
    ctx.arc(0, 0, BALL_R, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = "#111827"
    ctx.lineWidth = 1.5
    ctx.stroke()
    // pentagon accents
    ctx.fillStyle = "#111827"
    ctx.beginPath()
    ctx.arc(0, 0, BALL_R * 0.36, 0, Math.PI * 2)
    ctx.fill()
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      ctx.beginPath()
      ctx.arc(Math.cos(a) * BALL_R * 0.66, Math.sin(a) * BALL_R * 0.66, BALL_R * 0.16, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  const drawPlayer = (ctx: CanvasRenderingContext2D, p: Player) => {
    const t = p.team
    const { x } = p
    const feetY = p.y
    const hipY = feetY - 34
    const shoulderY = feetY - 70
    const headY = feetY - 92

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.2)"
    ctx.beginPath()
    ctx.ellipse(x, GROUND_Y - 4, 26, 6, 0, 0, Math.PI * 2)
    ctx.fill()

    const swing = p.kickTimer > 0 ? Math.sin((1 - p.kickTimer / 14) * Math.PI) : 0

    // back leg
    ctx.strokeStyle = t.shorts === "#ffffff" ? "#e5e7eb" : t.shorts
    ctx.lineWidth = 9
    ctx.lineCap = "round"
    ctx.beginPath()
    ctx.moveTo(x, hipY)
    ctx.lineTo(x - p.facing * 8, feetY)
    ctx.stroke()
    // kicking (front) leg
    ctx.strokeStyle = t.skin
    ctx.beginPath()
    ctx.moveTo(x, hipY)
    const kneeX = x + p.facing * (10 + swing * 20)
    const footX = x + p.facing * (14 + swing * 34)
    const footY = feetY - swing * 22
    ctx.lineTo(kneeX, hipY + 16)
    ctx.lineTo(footX, footY)
    ctx.stroke()
    // boot
    ctx.fillStyle = "#111827"
    ctx.beginPath()
    ctx.ellipse(footX + p.facing * 4, footY, 8, 5, 0, 0, Math.PI * 2)
    ctx.fill()

    // body / jersey
    ctx.fillStyle = t.jersey
    roundRect(ctx, x - 15, shoulderY, 30, hipY - shoulderY + 6, 8)
    ctx.fill()
    ctx.fillStyle = t.jerseyDark
    roundRect(ctx, x - 15, shoulderY + (hipY - shoulderY) * 0.6, 30, 8, 3)
    ctx.fill()

    // arms
    ctx.strokeStyle = t.skin
    ctx.lineWidth = 7
    ctx.beginPath()
    ctx.moveTo(x - 12, shoulderY + 6)
    ctx.lineTo(x - 18 - swing * 4, shoulderY + 30)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x + 12, shoulderY + 6)
    ctx.lineTo(x + 18 + swing * 8, shoulderY + 26 - swing * 10)
    ctx.stroke()

    // head (big, legend style)
    ctx.fillStyle = t.skin
    ctx.beginPath()
    ctx.arc(x, headY, 20, 0, Math.PI * 2)
    ctx.fill()
    // hair
    ctx.fillStyle = t.hair
    ctx.beginPath()
    ctx.arc(x, headY - 4, 20, Math.PI, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(x - 20, headY - 6, 40, 6)
    // face
    ctx.fillStyle = "#111827"
    ctx.beginPath()
    ctx.arc(x + p.facing * 7, headY - 1, 2.4, 0, Math.PI * 2)
    ctx.fill()
    // smile
    ctx.strokeStyle = "#111827"
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(x + p.facing * 5, headY + 6, 5, 0.1 * Math.PI, 0.9 * Math.PI)
    ctx.stroke()
  }

  const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  // -------------------------------------------------------------------------
  // UI
  // -------------------------------------------------------------------------
  const timeStr = `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, "0")}`

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Scoreboard */}
      <div className="flex w-full max-w-[900px] items-center justify-between rounded-xl bg-slate-900/80 px-5 py-3 text-white shadow-lg ring-1 ring-white/10">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: TEAMS[0].jersey }} />
          <span className="font-semibold">{TEAMS[0].name}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="min-w-8 text-center text-3xl font-black tabular-nums">{score[0]}</span>
          <span className="rounded-md bg-slate-800 px-3 py-1 font-mono text-lg tabular-nums text-emerald-400">
            {timeStr}
          </span>
          <span className="min-w-8 text-center text-3xl font-black tabular-nums">{score[1]}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-semibold">{TEAMS[1].name}</span>
          <span className="h-3 w-3 rounded-full" style={{ background: TEAMS[1].jersey }} />
        </div>
      </div>

      {/* Field */}
      <div className="relative w-full max-w-[900px] overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="block h-auto w-full touch-none select-none bg-slate-800"
        />

        {/* Overlays */}
        {gameState !== "playing" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/70 p-6 text-center backdrop-blur-sm">
            {gameState === "menu" && (
              <div className="flex w-full max-w-md flex-col items-center gap-5">
                <h1 className="text-balance text-4xl font-black tracking-tight text-white sm:text-5xl">
                  Football <span className="text-emerald-400">Legends</span>
                </h1>
                <p className="text-pretty text-sm text-slate-300">
                  Head-to-head arcade soccer. Jump, kick, and bury the ball in the net before the clock runs out.
                </p>

                <div className="flex w-full flex-col gap-3 text-left">
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Mode</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Toggle active={mode === "cpu"} onClick={() => setMode("cpu")}>
                        1 Player vs CPU
                      </Toggle>
                      <Toggle active={mode === "2p"} onClick={() => setMode("2p")}>
                        2 Players
                      </Toggle>
                    </div>
                  </div>
                  {mode === "cpu" && (
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        CPU Difficulty
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {(["easy", "normal", "hard"] as Difficulty[]).map((d) => (
                          <Toggle key={d} active={difficulty === d} onClick={() => setDifficulty(d)}>
                            <span className="capitalize">{d}</span>
                          </Toggle>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={startMatch}
                  className="mt-1 w-full rounded-lg bg-emerald-500 px-6 py-3 text-lg font-bold text-slate-950 shadow-lg transition hover:bg-emerald-400 active:scale-95"
                >
                  Kick Off ⚽
                </button>
                <Controls mode={mode} />
              </div>
            )}

            {gameState === "goal" && (
              <div className="animate-pulse">
                <p className="text-5xl font-black text-white drop-shadow-lg sm:text-7xl">GOAL!</p>
                <p className="mt-2 text-xl font-semibold text-emerald-400">{message}</p>
              </div>
            )}

            {gameState === "kickoff" && <p className="text-3xl font-black text-white">{message}</p>}

            {gameState === "ended" && (
              <div className="flex flex-col items-center gap-4">
                <p className="text-2xl font-semibold text-slate-300">Full Time</p>
                <p className="text-4xl font-black text-white sm:text-5xl">{message}</p>
                <p className="text-3xl font-black tabular-nums text-emerald-400">
                  {score[0]} — {score[1]}
                </p>
                <button
                  onClick={() => setGameState("menu")}
                  className="mt-2 rounded-lg bg-emerald-500 px-6 py-3 text-lg font-bold text-slate-950 shadow-lg transition hover:bg-emerald-400 active:scale-95"
                >
                  Play Again
                </button>
              </div>
            )}
          </div>
        )}

        {/* Kick off flash while playing */}
        {gameState === "playing" && message && (
          <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
            <span className="rounded-full bg-slate-950/70 px-5 py-2 text-lg font-black text-white">
              {message}
            </span>
          </div>
        )}
      </div>

      {gameState === "playing" && <Controls mode={mode} compact />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small UI bits
// ---------------------------------------------------------------------------
function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-sm font-semibold transition active:scale-95 ${
        active
          ? "bg-emerald-500 text-slate-950 shadow"
          : "bg-slate-800 text-slate-200 hover:bg-slate-700"
      }`}
    >
      {children}
    </button>
  )
}

function Controls({ mode, compact }: { mode: Mode; compact?: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-slate-300 ${
        compact ? "text-xs" : "mt-2 text-sm"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold" style={{ color: TEAMS[0].jersey }}>
          Red
        </span>
        <Key>A</Key>
        <Key>D</Key>
        move
        <Key>W</Key>
        jump
        <Key>S</Key>
        kick
      </div>
      {mode === "2p" && (
        <div className="flex items-center gap-2">
          <span className="font-semibold" style={{ color: TEAMS[1].jersey }}>
            Blue
          </span>
          <Key>←</Key>
          <Key>→</Key>
          move
          <Key>↑</Key>
          jump
          <Key>↓</Key>
          kick
        </div>
      )}
    </div>
  )
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded border border-white/20 bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-white">
      {children}
    </kbd>
  )
}
