import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_VOCABULARIES } from '../src/shared/semanticTimeline'
import enUS from '../src/renderer/src/i18n/locales/en-US'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'

/**
 * 「语义时间线 dive 打不开 / 报 timeline not found」的回归守卫。
 *
 * 实测踩到：透传节点（`semantic.timeline`）自己没时间线时，卡片**编了一个假 id**
 * `stl.node.<nodeId>` 去开编辑器 → dive 去读不存在的 `Semantic/<假id>/timeline.json`
 * → 用户看到 `timeline not found`。正确做法是：回落上游节点；真没有就给提示。
 */
const card = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/GraphNodeCard.vue'),
  'utf8'
)
const view = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/dive/EditorDiveSemanticTimelineView.vue'),
  'utf8'
)

describe('语义时间线 dive 的打开路径', () => {
  it('不再编造 stl.node.<nodeId> 假 id', () => {
    expect(card).not.toContain('`stl.node.${props.node.id}`')
    expect(card).not.toContain("'stl.node.'")
    // 空 id 也允许打开（由视图给提示），所以不再提前 return false
    expect(card).toContain("const timelineId = payload?.id || fallbackId || ''")
  })

  it('自己没有时间线时回落上游节点的 semanticTimelineId（并带上原视频路径）', () => {
    expect(card).toContain('function resolveUpstreamTimelinePayload(')
    expect(card).toContain('graphEditorHosts.listIncomingEdges(hostId, props.node.id)')
    expect(card).toContain('graphEditorHosts.getNode(hostId, edge.sourceNodeId)')
    // 必须真的拿上游节点去解析（否则"回落"是空壳：函数在、但永远返回 null）
    expect(card).toContain('resolveSemanticTimelineViewTarget(source, null)')
    expect(card).toMatch(
      /resolveSemanticTimelinePayload\(props\.node, props\.runState\) \?\?\s*\n\s*resolveUpstreamTimelinePayload\(\)/
    )
    expect(card).toContain('sourceRelativePath: payload?.sourceRelativePath')
  })

  it('视图把「还没有时间线」当提示、把「文件缺失」当错误（都不再是裸英文 timeline not found）', () => {
    expect(view).not.toContain("'timeline not found'")
    expect(view).not.toContain("'missing timelineId'")
    expect(view).toContain("hint.value = t('graph.semanticTimeline.noTimelineHint')")
    expect(view).toContain("error.value = t('graph.semanticTimeline.timelineFileMissing')")
    // 错误时把实际路径显示出来（便于排查）
    expect(view).toContain('missingPath.value = rel')
    expect(view).toContain('class="path"')
    // 提示态要有"下一步怎么做"的说明
    expect(view).toContain('noTimelineHintSub')
  })

  it('两套文案都有这三个 key', () => {
    for (const key of ['noTimelineHint', 'noTimelineHintSub', 'timelineFileMissing']) {
      for (const [name, locale] of [
        ['zh-CN', zhCN],
        ['en-US', enUS]
      ] as const) {
        const value = (locale as Record<string, any>)?.graph?.semanticTimeline?.[key]
        expect(typeof value === 'string' && value.trim().length > 0, `${name} 缺少 ${key}`).toBe(
          true
        )
      }
    }
  })

  it('内置词表的每个节拍类型在两套文案里都有名字（含中文，不再显示 hook）', () => {
    for (const vocabulary of BUILTIN_VOCABULARIES) {
      for (const beat of vocabulary.beats) {
        for (const [name, locale] of [
          ['zh-CN', zhCN],
          ['en-US', enUS]
        ] as const) {
          const value = (locale as Record<string, any>)?.graph?.semanticTimeline?.beat?.[beat.type]
          expect(
            typeof value === 'string' && value.trim().length > 0,
            `${name} 缺少 ${beat.type} 的节拍名`
          ).toBe(true)
        }
      }
    }
  })
})
