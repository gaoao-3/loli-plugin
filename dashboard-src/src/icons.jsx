import React from 'react'

/**
 * 碧蓝档案风格图标集
 * 特征：圆润粗线条 + 光环（halo）+ 四角星闪光（sparkle）
 * 着色：主体 currentColor；光环/闪光通过 --tone 变量着色（.icon-accent / .icon-accent-fill）
 */

// 四角星路径（以 cx,cy 为中心，半径 s）
const spark = (cx, cy, s) =>
  `M${cx} ${cy - s} Q${cx + s * 0.22} ${cy - s * 0.22} ${cx + s} ${cy} Q${cx + s * 0.22} ${cy + s * 0.22} ${cx} ${cy + s} Q${cx - s * 0.22} ${cy + s * 0.22} ${cx - s} ${cy} Q${cx - s * 0.22} ${cy - s * 0.22} ${cx} ${cy - s} Z`

// 光环（倾斜的椭圆环）
const Halo = ({ cx = 12, cy = 4.2, rx = 4.6, ry = 1.5, rotate = -8 }) => (
  <ellipse className="icon-accent" cx={cx} cy={cy} rx={rx} ry={ry} transform={`rotate(${rotate} ${cx} ${cy})`} />
)

const Sparkle = ({ cx, cy, s = 1.8 }) => <path className="icon-accent-fill" d={spark(cx, cy, s)} stroke="none" />

const Svg = ({ size = 18, children, ...p }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...p}
  >
    {children}
  </svg>
)

const paths = {
  // 总览：四格面板，右上角换成光环
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
      <Halo cx="17" cy="7" rx="4" ry="2.4" rotate={-10} />
    </>
  ),
  // 渠道：对话气泡 + 光环
  channels: (
    <>
      <path d="M20 12.5a7.5 7.5 0 0 1-7.5 7.5c-1.3 0-2.5-.3-3.6-.9L4 20.5l1.4-4.9a7.4 7.4 0 0 1-.4-2.5A7.5 7.5 0 0 1 12.5 5.6h0a7.5 7.5 0 0 1 7.5 6.9Z" />
      <Halo cx="12" cy="3.4" rx="4.2" ry="1.3" />
      <Sparkle cx="18.6" cy="17.8" s={1.4} />
    </>
  ),
  // 预设角色：小人 + 光环（BA 角色标配）
  presets: (
    <>
      <circle cx="12" cy="10" r="3.4" />
      <path d="M5.5 20.5c1-3.6 3.6-5.4 6.5-5.4s5.5 1.8 6.5 5.4" />
      <Halo cx="12" cy="3.8" rx="4.4" ry="1.4" />
    </>
  ),
  // 工具：六边形 + 中央闪光
  tools: (
    <>
      <path d="M12 2.5 20 7v10l-8 4.5L4 17V7l8-4.5Z" />
      <Sparkle cx="12" cy="12" s={2.6} />
    </>
  ),
  // MCP / Skills：互联节点
  extensions: (
    <>
      <circle cx="7" cy="7" r="3" />
      <circle cx="17" cy="17" r="3" />
      <path d="M9.5 9.5l5 5M14.5 7.5l2-2M7.5 14.5l-2 2" />
    </>
  ),
  // 记忆：数据库 + 闪光
  memory: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.6" />
      <path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6" />
      <path d="M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" />
      <Sparkle cx="19" cy="4" s={1.5} />
    </>
  ),
  // 配置：三条滑杆
  config: (
    <>
      <path d="M4 7h9M17 7h3" />
      <circle cx="15" cy="7" r="2" />
      <path d="M4 12h3M11 12h9" />
      <circle cx="9" cy="12" r="2" />
      <path d="M4 17h11M19 17h1" />
      <circle cx="17" cy="17" r="2" />
    </>
  ),
  // 日志：终端窗口
  logs: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="m7.5 10 2.5 2.5L7.5 15" />
      <path d="M12.5 15H16" />
    </>
  ),

  /* ─── 工具型小图标 ─── */
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: (
    <>
      <path d="M3 12a9 9 0 0 1 15.4-6.3L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.4 6.3L3 16" />
      <path d="M3 21v-5h5" />
    </>
  ),
  upload: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <path d="M12 3v12" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </>
  ),
  pause: (
    <>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </>
  ),
  save: (
    <>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </>
  ),
  close: <path d="M18 6 6 18M6 6l12 12" />,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6 6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  play: <path d="m7 4 13 8-13 8V4z" />,
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  file: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v6h6" />
    </>
  ),
  // 安全令牌：盾牌 + 钥匙孔 + 光环
  shield: (
    <>
      <path d="M12 22s8-3.6 8-10V5.2L12 2 4 5.2V12c0 6.4 8 10 8 10Z" />
      <circle cx="12" cy="10" r="1.7" />
      <path d="M12 11.7v2.8" />
      <Sparkle cx="18.5" cy="5" s={1.3} />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.5-4.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M2 14h4M10 8h4M18 16h4" />
    </>
  ),
}

export function Icon({ name, size = 18, className, style }) {
  return (
    <Svg size={size} className={className} style={style}>
      {paths[name] || null}
    </Svg>
  )
}

export default Icon
