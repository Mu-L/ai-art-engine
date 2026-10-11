import { describe, expect, it } from 'vitest'
import { executeSemanticTriggerNode } from '../src/shared/graph/execute/semanticTimeline'
import { createNodeFromType, GraphPortType, type NodeExecuteContext } from '../src/shared/graph'
import { parseEventLabels, type SemanticTimeline } from '../src/shared/semanticTimeline'

/**
 * 触发节点「事件标签过滤」的多值支持。
 *
 * 之前只能填一个字符串（`===` 精确匹配），串一条片子时想一次抓多个事件做不到。
 * 现在 `eventLabel` 允许**逗号分隔多值**（字段名不变，零迁移）。
 */

/** 最小可用的时间线文档：两个事件 + 两条对应意图 */
function doc(): SemanticTimeline {
  const range = (start: number, end: number) => ({
    start,
    end,
    startFrame: Math.round(start * 30),
    endFrame: Math.round(end * 30)
  })
  return {
    schema: 'aiart.semantic-timeline@1',
    id: 'stl.test',
    source: { assetId: 'asset-1', fps: 30, duration: 30, width: 1080, height: 1920 },
    vocabulary: 'commerce.v1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    evidence: {
      mediaFacts: { durationSec: 30, fps: 30, width: 1080, height: 1920, hasAudio: true },
      shotsPath: '',
      utterancesPath: '',
      entitiesPath: '',
      ocrPath: '',
      hashes: {}
    },
    events: [
      {
        id: 'ev.a',
        label: '京东福利价引导',
        type: '促销',
        timeRange: range(6, 14),
        evidence: []
      },
      { id: 'ev.b', label: '斜挎促销展示', type: '促销', timeRange: range(17, 22), evidence: [] },
      {
        id: 'ev.c',
        label: '最终抢购号召',
        type: '行动号召',
        timeRange: range(32, 34),
        evidence: []
      }
    ],
    beats: [],
    entities: [],
    ocr: [],
    intents: [
      {
        id: 'intent.a',
        trigger: 'ev.a',
        goal: '引导点击',
        techniques: [{ track: 'text', action: '福利价动态标签' }],
        reason: '',
        timeRange: range(6, 14)
      },
      {
        id: 'intent.b',
        trigger: 'ev.b',
        goal: '展示斜挎',
        techniques: [{ track: 'camera', action: '近景平视固定' }],
        reason: '',
        timeRange: range(17, 22)
      },
      {
        id: 'intent.c',
        trigger: 'ev.c',
        goal: '收束抢购',
        techniques: [{ track: 'text', action: '抢购字幕' }],
        reason: '',
        timeRange: range(32, 34)
      },
      {
        /**
         * 这条意图的 `trigger` 写的是**标签**而不是事件 id，且时间**不与任何事件重叠**
         * （100s 之外）—— 只有「按标签匹配 trigger」这条分支能把它选进来，
         * 时间重叠兜不住，这样那条分支才真正被测到。
         */
        id: 'intent.byLabel',
        trigger: '京东福利价引导',
        goal: '标签触发的意图',
        techniques: [{ track: 'audio', action: '提示音' }],
        reason: '',
        timeRange: range(100, 101)
      }
    ],
    edits: [],
    tracks: []
  } as unknown as SemanticTimeline
}

function ctxFor(eventLabel: string, log: string[] = []): NodeExecuteContext {
  const node = createNodeFromType('semantic.trigger', { x: 0, y: 0 })
  node.params = { ...node.params, eventLabel }
  const timeline = doc()
  return {
    node,
    locale: 'zh-CN',
    inputs: {
      in: [
        {
          kind: GraphPortType.semanticTimeline,
          doc: timeline,
          text: JSON.stringify(timeline)
        }
      ]
    },
    log: (message) => log.push(message)
  }
}

function payloadOf(result: Record<string, { kind: string; text?: string }>): {
  eventLabel: string
  eventLabels: string[]
  events: Array<{ id: string }>
  commands: Array<{ sourceIntentId?: string }>
} {
  const out = result.out
  expect(out?.kind).toBe('text')
  return JSON.parse(out?.text ?? '{}')
}

describe('语义触发节点：事件标签过滤', () => {
  it('parseEventLabels：逗号分隔、去重、去空白；**不按空格切**（英文标签含空格）', () => {
    expect(parseEventLabels('a')).toEqual(['a'])
    expect(parseEventLabels('a, b，c')).toEqual(['a', 'b', 'c'])
    expect(parseEventLabels(' 京东福利价引导 , 斜挎促销展示 ')).toEqual([
      '京东福利价引导',
      '斜挎促销展示'
    ])
    expect(parseEventLabels('a,a,a')).toEqual(['a'])
    expect(parseEventLabels('a,, ,b')).toEqual(['a', 'b'])
    // 英文短语不能因为空格被切开
    expect(parseEventLabels('price announce')).toEqual(['price announce'])
    expect(parseEventLabels('price announce, final cta')).toEqual(['price announce', 'final cta'])
    expect(parseEventLabels('')).toEqual([])
    expect(parseEventLabels(undefined)).toEqual([])
    expect(parseEventLabels(123)).toEqual([])
  })

  it('留空 = 全部事件 + 全部命令（eventLabels 为空数组）', async () => {
    const payload = payloadOf(await executeSemanticTriggerNode(ctxFor('')))
    expect(payload.eventLabel).toBe('')
    expect(payload.eventLabels).toEqual([])
    expect(payload.events).toHaveLength(3)
    // 4 条意图（含 trigger 写标签的那条）全部产出命令
    expect(payload.commands).toHaveLength(4)
  })

  it('单个标签：只留该事件与它的命令', async () => {
    const payload = payloadOf(await executeSemanticTriggerNode(ctxFor('京东福利价引导')))
    expect(payload.eventLabels).toEqual(['京东福利价引导'])
    expect(payload.events.map((e) => e.id)).toEqual(['ev.a'])
    // intent.byLabel 的 trigger 写的是标签（时间在 100s 之外）→ 只有按标签匹配那条路能选到它
    expect(payload.commands.map((c) => c.sourceIntentId).sort()).toEqual([
      'intent.a',
      'intent.byLabel'
    ])
  })

  it('多个标签（逗号分隔）：两个事件与它们各自的命令都要在', async () => {
    const payload = payloadOf(
      await executeSemanticTriggerNode(ctxFor('京东福利价引导, 最终抢购号召'))
    )
    expect(payload.eventLabels).toEqual(['京东福利价引导', '最终抢购号召'])
    expect(payload.events.map((e) => e.id)).toEqual(['ev.a', 'ev.c'])
    expect(payload.commands.map((c) => c.sourceIntentId).sort()).toEqual([
      'intent.a',
      'intent.byLabel',
      'intent.c'
    ])
  })

  it('填 type 也能多选（同类型多条一起命中，去重后不重复）', async () => {
    const payload = payloadOf(await executeSemanticTriggerNode(ctxFor('促销')))
    expect(payload.events.map((e) => e.id)).toEqual(['ev.a', 'ev.b'])
    expect(payload.commands.map((c) => c.sourceIntentId).sort()).toEqual([
      'intent.a',
      'intent.b',
      'intent.byLabel'
    ])
  })

  it('填事件 id 同样生效；标签不存在时给 warn 且事件/命令都为空', async () => {
    const logged: string[] = []
    const byId = payloadOf(await executeSemanticTriggerNode(ctxFor('ev.b', logged)))
    expect(byId.events.map((e) => e.id)).toEqual(['ev.b'])
    expect(logged).toEqual([])

    const missing = payloadOf(
      await executeSemanticTriggerNode(ctxFor('不存在的标签, 也不存在', logged))
    )
    expect(missing.events).toEqual([])
    expect(missing.commands).toEqual([])
    // 中英都带上了要匹配的多个标签，便于排查
    expect(logged.some((line) => line.includes('不存在的标签') && line.includes('也不存在'))).toBe(
      true
    )
  })
})
