import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * dive 宿主的高度链守卫。
 *
 * 实测踩到：`.editor-dive-view`（视图包装层）**没有任何样式**，高度链断在这里 ——
 * `.editor-dive-child` 是 flex 列，但它是 auto 高度的普通块，里面的
 * `.dive-view { height: 100% }` 解析成 auto（内容高度）→ 内容比窗口高时整块溢出，
 * 左侧轨道区被撑出一大片空白（「窗口下部分没有适配窗口」）。
 *
 * 组件在 node 环境渲染不了（无 jsdom），按仓库既有做法做源码守卫；
 * 另有浏览器实测复刻高度链（见提交说明）。
 */
const host = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/EditorDiveChildHost.vue'),
  'utf8'
)
const code = host.replace(/\/\*[\s\S]*?\*\//g, '')
const style = /<style scoped>([\s\S]*?)<\/style>/.exec(code)?.[1] ?? ''

function block(selector: string): string {
  // 选择器里有 `(` `*` 等正则元字符（:deep(*)），必须整体转义再拼
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's').exec(style)?.[1] ?? ''
}

describe('EditorDiveChildHost 高度链', () => {
  it('包装层做 flex 透传（不再是 auto 高度的普通块）', () => {
    const view = block('.editor-dive-view')
    expect(view, '.editor-dive-view 缺少样式（高度链会断在这层）').toBeTruthy()
    expect(view).toMatch(/flex:\s*1/)
    expect(view).toMatch(/min-height:\s*0/)
    expect(view).toMatch(/display:\s*flex/)
    expect(view).toMatch(/flex-direction:\s*column/)
  })

  it('包装层的子项自己撑满（视图只要声明 height: 100% 就能贴合）', () => {
    const child = block('.editor-dive-view > :deep(*)')
    expect(child, '缺少包装层子项规则').toBeTruthy()
    expect(child).toMatch(/flex:\s*1 1 auto/)
    expect(child).toMatch(/min-height:\s*0/)
  })

  it('宿主根仍是 flex 列（链的另一端）', () => {
    const root = block('.editor-dive-child')
    expect(root).toMatch(/flex:\s*1/)
    expect(root).toMatch(/min-height:\s*0/)
    expect(root).toMatch(/flex-direction:\s*column/)
  })
})
