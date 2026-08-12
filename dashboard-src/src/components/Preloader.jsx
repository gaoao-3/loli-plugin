import React from 'react'
import Icon from '../icons.jsx'

/**
 * 预加载页（Now Loading ♪）：首次进入面板时展示，数据就绪后淡出
 * 参考 komari-mikus 主题的 preloader 设定
 */
export default function Preloader({ fading }) {
  return (
    <div className={`preloader${fading ? ' fading' : ''}`} aria-hidden={fading}>
      <div className="preloader-inner">
        <div className="preloader-logo">
          <Icon name="presets" size={30} />
        </div>
        <span className="preloader-title">HINA DASHBOARD</span>
        <span className="preloader-sub">
          Now Loading
          <span className="preloader-dots"><i>.</i><i>.</i><i>.</i>
        </span>
        </span>
        <div className="preloader-bar"><div /></div>
      </div>
    </div>
  )
}
