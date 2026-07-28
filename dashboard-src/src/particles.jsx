import React, { useEffect, useRef } from 'react'

/**
 * 飘落花瓣/光点粒子背景
 * - 桌面 30 片、移动端 14 片
 * - 遵循 prefers-reduced-motion
 */
const COLORS = ['rgba(255,255,255,', 'rgba(207,232,255,', 'rgba(230,212,255,', 'rgba(255,215,234,']

export default function Petals() {
  const ref = useRef(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    const DPR = Math.min(2, window.devicePixelRatio || 1)
    let w = 0
    let h = 0
    let raf = 0

    const resize = () => {
      w = canvas.width = window.innerWidth * DPR
      h = canvas.height = window.innerHeight * DPR
    }
    resize()
    window.addEventListener('resize', resize)

    const spawn = (anyY) => ({
      x: Math.random() * w,
      y: anyY ? Math.random() * h : -20 * DPR,
      s: (3 + Math.random() * 5) * DPR,
      vy: (0.25 + Math.random() * 0.5) * DPR,
      ph: Math.random() * Math.PI * 2,
      sw: (0.3 + Math.random() * 0.7) * DPR,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.015,
      c: COLORS[(Math.random() * COLORS.length) | 0],
      a: 0.22 + Math.random() * 0.3,
    })

    const count = window.innerWidth < 768 ? 14 : 30
    const petals = Array.from({ length: count }, () => spawn(true))

    const tick = (t) => {
      ctx.clearRect(0, 0, w, h)
      for (const p of petals) {
        p.y += p.vy
        p.rot += p.vr
        p.x += Math.sin(t / 1600 + p.ph) * p.sw * 0.3
        if (p.y > h + 30 * DPR) Object.assign(p, spawn(false))
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.c + p.a + ')'
        ctx.beginPath()
        ctx.moveTo(0, -p.s)
        ctx.quadraticCurveTo(p.s * 0.9, -p.s * 0.3, 0, p.s)
        ctx.quadraticCurveTo(-p.s * 0.9, -p.s * 0.3, 0, -p.s)
        ctx.fill()
        ctx.restore()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={ref} className="petals-canvas" aria-hidden="true" />
}
