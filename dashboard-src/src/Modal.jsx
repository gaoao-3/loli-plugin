import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * 弹窗（挂载到 body，避免被 .main / .bottom-nav 层叠上下文压住）
 * - open 控制显隐，关闭时播退场动画后再卸载
 * - 点击遮罩空白处关闭
 */
export default function Modal({ open, onClose, maxWidth = 450, cardClass = '', children }) {
  const [render, setRender] = useState(open)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open) {
      setRender(true)
      setClosing(false)
      return undefined
    }
    if (render) {
      setClosing(true)
      const t = setTimeout(() => {
        setRender(false)
        setClosing(false)
      }, 200)
      return () => clearTimeout(t)
    }
    return undefined
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!render) return null

  return createPortal(
    <div
      className={`modal-overlay${closing ? ' closing' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div className={`modal-card ${cardClass}${closing ? ' closing' : ''}`} style={{ maxWidth }}>
        {children}
      </div>
    </div>,
    document.body
  )
}
