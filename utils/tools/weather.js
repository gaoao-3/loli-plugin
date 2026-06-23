/**
 * 天气查询工具 - 使用 wttr.in 免费天气服务
 */
import { CustomTool } from 'lolicon-core'

class Weather extends CustomTool {

  name = 'get_weather'

  function = {
    name: 'get_weather',
    description: '查询指定城市的当前天气。返回温度、天气状况、湿度、风速等信息。支持中文城市名。',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: '城市名称，如 "北京"、"上海"、"Tokyo"、"London"'
        }
      },
      required: ['location']
    }
  }

  async run(args, _context) {
    const { location } = args

    try {
      // wttr.in 提供免费的纯文本天气 API
      const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1&lang=zh`
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      })

      if (!res.ok) {
        return `天气查询失败: HTTP ${res.status}`
      }

      const data = await res.json()
      const current = data?.current_condition?.[0]
      const weather = data?.weather?.[0]
      const nearest = data?.nearest_area?.[0]

      if (!current) {
        return `未找到 "${location}" 的天气信息，请检查城市名是否正确。`
      }

      const city = nearest?.areaName?.[0]?.value || location
      const country = nearest?.country?.[0]?.value || ''
      const temp = current.temp_C
      const feelsLike = current.FeelsLikeC
      const humidity = current.humidity
      const windSpeed = current.windspeedKmph
      const windDir = current.winddir16Point
      const weatherDesc = current.weatherDesc?.[0]?.value || '未知'
      const visibility = current.visibility
      const uvIndex = current.uvIndex
      const maxTemp = weather?.maxtempC
      const minTemp = weather?.mintempC

      const lines = [
        `📍 ${city}${country ? ', ' + country : ''} 天气`,
        `🌡 温度: ${temp}°C (体感 ${feelsLike}°C) | 今日 ${minTemp}°C ~ ${maxTemp}°C`,
        `☁️ 天气: ${weatherDesc}`,
        `💧 湿度: ${humidity}% | 风速: ${windSpeed}km/h ${windDir}`,
      ]

      if (visibility && visibility !== '0') {
        lines.push(`👁 能见度: ${visibility}km`)
      }
      if (uvIndex) {
        lines.push(`☀️ 紫外线指数: ${uvIndex}`)
      }

      return lines.join('\n')
    } catch (err) {
      return `天气查询出错: ${err.message}`
    }
  }
}

export default new Weather()
