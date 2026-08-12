import { useEffect, useRef, useState } from 'react'

/**
 * 打字机效果：逐字输出文本（galgame 对话框字幕）
 */
export function useTypewriter(text, speed = 50) {
  const [output, setOutput] = useState('')
  useEffect(() => {
    setOutput('')
    if (!text) return undefined
    let i = 0
    const timer = setInterval(() => {
      i += 1
      setOutput(text.slice(0, i))
      if (i >= text.length) clearInterval(timer)
    }, speed)
    return () => clearInterval(timer)
  }, [text, speed])
  return output
}

/**
 * 点击星光迸发：在点击位置炸开一圈 ✦✧♪
 */
export function burstSparkles(event) {
  const glyphs = ['✦', '✧', '♪', '✦', '❤', '✧']
  const colors = ['#f9a8d4', '#a78bfa', '#7dd3fc', '#6ee7b7', '#fcd34d']
  const x = event.clientX
  const y = event.clientY
  const count = 9
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span')
    s.textContent = glyphs[i % glyphs.length]
    s.style.cssText = [
      'position:fixed',
      `left:${x}px`,
      `top:${y}px`,
      'z-index:4000',
      'pointer-events:none',
      `font-size:${10 + Math.random() * 8}px`,
      `color:${colors[i % colors.length]}`,
      'text-shadow:0 0 6px currentColor',
      'transform:translate(-50%,-50%)'
    ].join(';')
    document.body.appendChild(s)
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6
    const dist = 28 + Math.random() * 46
    const dx = Math.cos(angle) * dist
    const dy = Math.sin(angle) * dist - 12
    const anim = s.animate([
      { transform: 'translate(-50%,-50%) scale(0.3) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.15) rotate(${(Math.random() - 0.5) * 120}deg)`, opacity: 0 }
    ], {
      duration: 550 + Math.random() * 350,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
    })
    anim.onfinish = () => s.remove()
  }
}

/**
 * 3D 倾斜悬浮（鼠标在卡片上移动时随光标倾斜）
 * 触屏设备自动跳过
 */
export function useTilt(max = 5) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (window.matchMedia('(hover: none)').matches) return undefined
    const onMove = (e) => {
      const r = el.getBoundingClientRect()
      const px = (e.clientX - r.left) / r.width - 0.5
      const py = (e.clientY - r.top) / r.height - 0.5
      el.style.transform =
        `perspective(640px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg) translateY(-3px)`
    }
    const onLeave = () => { el.style.transform = '' }
    el.addEventListener('mousemove', onMove)
    el.addEventListener('mouseleave', onLeave)
    return () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseleave', onLeave)
    }
  }, [max])
  return ref
}
