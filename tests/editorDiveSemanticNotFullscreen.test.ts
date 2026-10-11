import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 语义时间线 dive 的**渲染方式**守卫：必须与其它 dive 视图一致。
 *
 * 历史：这个视图曾一度改成 `Teleport to="body"` + `fixed inset 0` 的全屏浮层，
 * 结果面包屑/返回条与别的节点不一致（应用外壳也被盖住）。现在撤回：就地渲染在宿主编辑器位置，
 * 面包屑由宿主统一渲染（`.dive-shell-bar` + EditorDiveBar），本视图不自带、也不做浮层。
 *
 * 组件在 node 环境渲染不了（无 jsdom），按仓库既有做法做源码守卫。
 */
const source = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/dive/EditorDiveSemanticTimelineView.vue'),
  'utf8'
)

/** 去掉注释再断言：注释里常写着同样的字样，直接 toContain 会造成假通过 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
const styleBlock = /<style scoped>([\s\S]*?)<\/style>/.exec(code)?.[1] ?? ''

describe('EditorDiveSemanticTimelineView 与其它 dive 一致（非全屏）', () => {
  it('就地渲染：没有 Teleport、没有全屏浮层类', () => {
    expect(code).not.toContain('<Teleport')
    expect(code).not.toContain('dive-fullscreen')
    expect(code).toContain('<div class="dive-semantic dive-view">')
  })

  it('固定定位 + 高层级都没了（不该浮在应用外壳之上）', () => {
    expect(styleBlock).not.toMatch(/position:\s*fixed/)
    expect(styleBlock).not.toMatch(/inset:\s*0/)
    expect(styleBlock).not.toMatch(/z-index/)
  })

  /**
   * 面包屑必须是宿主那一条 —— 本视图自己再渲染一份就会和别的节点不一致（甚至出现两条）。
   */
  it('不自带面包屑/返回条（由宿主统一渲染）', () => {
    expect(code).not.toContain('<EditorDiveBar')
    expect(code).not.toContain('dive-shell-bar')
    expect(code).not.toContain('editorDiveKey')
    expect(code).not.toContain('inject(')
  })

  it('仍然填满宿主那块区域（height: 100% + 自身兜底滚动）', () => {
    const root = /\.dive-semantic\s*\{([^}]*)\}/s.exec(styleBlock)?.[1] ?? ''
    expect(root).toMatch(/height:\s*100%/)
    expect(root).toMatch(/overflow:\s*auto/)
    expect(root).toMatch(/flex-direction:\s*column/)
  })
})
