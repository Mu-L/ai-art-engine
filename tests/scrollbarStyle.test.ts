import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 滚动条角落守卫。
 *
 * 实测踩到：双向滚动容器（时间线轨道区就是）右下角露出一块**白方块** ——
 * 那是 `::-webkit-scrollbar-corner` 的平台默认色（量到 RGB(252,252,252)）。
 * 补上这条规则后与面板同色（RGB(12,14,19)）。
 */
const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles/main.css'), 'utf8')

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's').exec(css)?.[1] ?? ''
}

describe('全局滚动条样式', () => {
  it('角落必须显式透明（否则深色主题下是白方块）', () => {
    const corner = block('::-webkit-scrollbar-corner')
    expect(corner, '缺少 ::-webkit-scrollbar-corner 规则').toBeTruthy()
    expect(corner).toMatch(/background:\s*transparent/)
  })

  it('本体/滑块/槽三条原有规则仍在', () => {
    expect(block('::-webkit-scrollbar')).toMatch(/width:\s*8px/)
    expect(block('::-webkit-scrollbar')).toMatch(/height:\s*8px/)
    expect(block('::-webkit-scrollbar-thumb')).toMatch(/background:\s*var\(--scrollbar-thumb\)/)
    expect(block('::-webkit-scrollbar-track')).toMatch(/background:\s*transparent/)
  })

  it('两端箭头按钮不画（部分平台默认会画）', () => {
    expect(block('::-webkit-scrollbar-button')).toMatch(/display:\s*none/)
  })
})
