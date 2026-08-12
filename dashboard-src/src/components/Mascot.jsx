import React from 'react'

/**
 * 欢迎小人（mascot）：猫耳 Q 版头像 + 光环，随页面色调变色，上下漂浮
 * 参考 komari-mikus 主题的 mascot 设定
 */
export default function Mascot({ size = 52 }) {
  return (
    <svg className="mascot" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      {/* 光环 */}
      <ellipse className="mascot-halo" cx="32" cy="9" rx="12" ry="4" />
      {/* 猫耳 */}
      <path className="mascot-ear" d="M14 27 L18 12 L27 21 Z" />
      <path className="mascot-ear" d="M50 27 L46 12 L37 21 Z" />
      {/* 脸 */}
      <circle className="mascot-face" cx="32" cy="37" r="20" />
      {/* 眼睛 */}
      <circle className="mascot-eye" cx="24.5" cy="35" r="2.6" />
      <circle className="mascot-eye" cx="39.5" cy="35" r="2.6" />
      {/* 腮红 */}
      <path className="mascot-blush" d="M16.5 43 h6 M41.5 43 h6" />
      {/* 嘴 */}
      <path className="mascot-mouth" d="M29 42 q3 3 6 0" />
    </svg>
  )
}
