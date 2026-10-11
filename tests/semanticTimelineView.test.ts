import { describe, expect, it } from 'vitest'
import {
  SIDE_PANE_MAX_WIDTH,
  SIDE_PANE_MIN_WIDTH,
  TRACKS_PANE_MIN_WIDTH,
  clampSeekSeconds,
  clampSidePaneWidth,
  resolveSemanticTimelineViewTarget,
  resolveTriggerRange,
  semanticTimelineSummaryText,
  semanticTimelineTextFromRunState,
  sidePaneWidthFromPointer,
  sourceAspectRatio
} from '../src/renderer/src/features/graph/model/semanticTimelineView'
import { semanticTimelineValue } from '../src/shared/graph/execute/semanticTimelineValue'
import { SEMANTIC_TIMELINE_SCHEMA } from '../src/shared/semanticTimeline'
import type { SemanticTimeline } from '../src/shared/semanticTimeline'
import type { GraphNodeRunState } from '../src/shared/graph/execute/types'

/**
 * 「语义分析跑完怎么看结果」这条链路的回归守卫。
 *
 * 实测踩过：时间线输出从纯文本换成结构化值（`kind: 'semanticTimeline'`）后，
 * 卡片的载荷解析只认 `kind === 'text'` —— 双击节点变成**静默无响应**，用户找不到结果。
 */
function makeDoc(id = 'stl.view0001'): SemanticTimeline {
  return {
    id,
    schema: SEMANTIC_TIMELINE_SCHEMA,
    source: {
      assetId: 'asset-1',
      relativePath: 'Cache/Videos/a.mp4',
      duration: 3,
      fps: 30,
      width: 640,
      height: 360
    },
    vocabulary: 'commerce.v1',
    tracks: [],
    events: [
      {
        id: 'ev-1',
        type: 'story',
        label: '开场',
        timeRange: { start: 0, end: 1, startFrame: 0, endFrame: 30 },
        confidence: 0.9,
        origin: 'analysis',
        evidence: [],
        intents: []
      }
    ],
    beats: [
      { id: 'bt-1', label: 'hook', timeRange: { start: 0, end: 1, startFrame: 0, endFrame: 30 } }
    ],
    intents: [],
    entities: [],
    evidence: {
      mediaFacts: 'evidence/mediaFacts.json',
      shots: 'evidence/shots.json',
      utterances: 'evidence/utterances.json',
      entities: 'evidence/entities.json',
      ocr: 'evidence/ocr.json',
      hashes: { shots: '9', utterances: '8', entities: '16', ocr: '2' }
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  } as unknown as SemanticTimeline
}

function runStateWith(outputs: Record<string, unknown>): GraphNodeRunState {
  return { status: 'done', outputs } as unknown as GraphNodeRunState
}

describe('semanticTimelineView', () => {
  it('结构化值也能取出时间线文本（这是双击失效的那个 bug）', () => {
    const doc = makeDoc()
    const text = semanticTimelineTextFromRunState(runStateWith({ out: semanticTimelineValue(doc) }))
    expect(JSON.parse(text).id).toBe('stl.view0001')
    // 旧的纯文本值仍要认
    expect(
      semanticTimelineTextFromRunState(runStateWith({ out: { kind: 'text', text: ' {"a":1} ' } }))
    ).toBe('{"a":1}')
    // 别的 kind / 空输出 → 空串
    expect(
      semanticTimelineTextFromRunState(runStateWith({ out: { kind: 'image', id: 'x' } }))
    ).toBe('')
    expect(semanticTimelineTextFromRunState(undefined)).toBe('')
  })

  it('查看目标优先用本次运行输出（带 inline JSON）', () => {
    const doc = makeDoc()
    const target = resolveSemanticTimelineViewTarget(
      { params: {} },
      runStateWith({ out: semanticTimelineValue(doc) })
    )
    expect(target?.id).toBe('stl.view0001')
    expect(target?.json).toBeTruthy()
  })

  it('没有运行输出时退回参数里的 timelineJson', () => {
    const doc = makeDoc('stl.fromparams')
    const target = resolveSemanticTimelineViewTarget(
      { params: { timelineJson: JSON.stringify(doc) } },
      null
    )
    expect(target?.id).toBe('stl.fromparams')
    expect(target?.json).toBeTruthy()
  })

  it('只剩 semanticTimelineId 时也能打开（重开工程后按 id 读盘）', () => {
    const target = resolveSemanticTimelineViewTarget(
      { params: { semanticTimelineId: 'stl.fromdisk' } },
      null
    )
    expect(target).toEqual({ id: 'stl.fromdisk' })
  })

  /**
   * 点选 clip → 播放条跳过去：越界必须夹住，否则 `video.currentTime = 超出时长` 会被拒绝。
   */
  it('clampSeekSeconds：负数归零、越界夹到时长、时长未知时只保证非负', () => {
    expect(clampSeekSeconds(3.2, 35.6)).toBe(3.2)
    expect(clampSeekSeconds(-1, 35.6)).toBe(0)
    expect(clampSeekSeconds(40, 35.6)).toBe(35.6)
    expect(clampSeekSeconds(Number.NaN, 35.6)).toBe(0)
    // 时长还没解析出来（video.duration 为 NaN）时不能把 seek 归零
    expect(clampSeekSeconds(12.5, Number.NaN)).toBe(12.5)
    expect(clampSeekSeconds(12.5, 0)).toBe(12.5)
    expect(clampSeekSeconds(12.5, undefined)).toBe(12.5)
  })

  /**
   * 制作层片段（机位/声音/字幕/特效）的落点由 trigger 决定 —— 这条以前内联在模板里，
   * 且**机位/声音的片段根本没绑 @click**（点了没反应）。现在抽成纯函数并补用例。
   */
  it('resolveTriggerRange：按 id 或 label 命中事件，找不到给 0–1 兜底', () => {
    const events = [
      { id: 'ev-1', label: 'cta', timeRange: { start: 2, end: 5 } },
      { id: 'ev-2', label: 'hook', timeRange: { start: 0, end: 2 } }
    ]
    expect(resolveTriggerRange(events, 'ev-1')).toEqual({ start: 2, end: 5 })
    // 按 label 触发也要认（生成侧两种都出现过）
    expect(resolveTriggerRange(events, 'hook')).toEqual({ start: 0, end: 2 })
    expect(resolveTriggerRange(events, '  ev-1  ')).toEqual({ start: 2, end: 5 })
    // 找不到 / 空 trigger → 兜底 0–1，不能是负宽或 NaN（否则片段会整块消失）
    expect(resolveTriggerRange(events, 'nope')).toEqual({ start: 0, end: 1 })
    expect(resolveTriggerRange(events, '')).toEqual({ start: 0, end: 1 })
    // 事件时间为非法值时也要给出可用区间
    expect(
      resolveTriggerRange([{ id: 'x', timeRange: { start: Number.NaN, end: Number.NaN } }], 'x')
    ).toEqual({ start: 0, end: 1 })
    expect(resolveTriggerRange([{ id: 'y', timeRange: { start: 3, end: 3 } }], 'y')).toEqual({
      start: 3,
      end: 4
    })
  })

  /**
   * 两栏拖动：宽度收敛必须在纯函数里定死（拖过头把轨道挤没、或把右栏拖成 0 都是这里防的）。
   */
  it('clampSidePaneWidth / sidePaneWidthFromPointer：边界与「左栏不被挤没」', () => {
    expect(clampSidePaneWidth(500)).toBe(500)
    // 绝对边界
    expect(clampSidePaneWidth(100)).toBe(SIDE_PANE_MIN_WIDTH)
    expect(clampSidePaneWidth(5000)).toBe(SIDE_PANE_MAX_WIDTH)
    expect(clampSidePaneWidth(Number.NaN)).toBe(SIDE_PANE_MIN_WIDTH)
    // 已知编辑器总宽时，保证左栏至少 TRACKS_PANE_MIN_WIDTH（这里上限 900 先生效）
    expect(clampSidePaneWidth(900, 1200)).toBe(SIDE_PANE_MAX_WIDTH)
    expect(clampSidePaneWidth(500, 1200)).toBe(500)
    // 总宽不够时由「左栏保护」收紧：1000 - 280 = 720
    expect(clampSidePaneWidth(880, 1000)).toBe(1000 - TRACKS_PANE_MIN_WIDTH)
    // 窗口很窄（总宽 < 两个最小值之和）：右栏不小于 min 优先，不能出现负宽
    expect(clampSidePaneWidth(500, 400)).toBe(SIDE_PANE_MIN_WIDTH)
    expect(clampSidePaneWidth(500, 100)).toBe(SIDE_PANE_MIN_WIDTH)
  })

  it('拖动换算：右栏贴着编辑器右边缘，拖到哪算到哪', () => {
    // 编辑器右边缘 1000，鼠标在 600 → 右栏 400
    expect(sidePaneWidthFromPointer({ clientX: 600, editorRight: 1000, editorWidth: 1600 })).toBe(
      400
    )
    // 拖到最右（超出右边缘）→ 收敛到最小值，而不是 0 或负数
    expect(sidePaneWidthFromPointer({ clientX: 1400, editorRight: 1000, editorWidth: 1600 })).toBe(
      SIDE_PANE_MIN_WIDTH
    )
    // 拖到很左 → 收敛到最大值
    expect(sidePaneWidthFromPointer({ clientX: 0, editorRight: 1600, editorWidth: 1600 })).toBe(
      SIDE_PANE_MAX_WIDTH
    )
  })

  /**
   * 视频按素材实际比例自适应：元数据到位前用时间线记的宽高占位。
   */
  it('sourceAspectRatio：竖屏/横屏/方形都给出正确比例，非法值交给浏览器', () => {
    expect(sourceAspectRatio({ width: 1080, height: 1920 })).toBe('1080 / 1920')
    expect(sourceAspectRatio({ width: 1920, height: 1080 })).toBe('1920 / 1080')
    expect(sourceAspectRatio({ width: 720, height: 720 })).toBe('720 / 720')
    // 缺失 / 0 / 负数 / NaN → undefined（让浏览器用内在比例，别写出 0/0 这种无效声明）
    expect(sourceAspectRatio({})).toBeUndefined()
    expect(sourceAspectRatio({ width: 1080 })).toBeUndefined()
    expect(sourceAspectRatio({ width: 0, height: 1920 })).toBeUndefined()
    expect(sourceAspectRatio({ width: -10, height: 20 })).toBeUndefined()
    expect(sourceAspectRatio({ width: Number.NaN, height: 1080 })).toBeUndefined()
  })

  it('非法 / 不相干的 JSON 不算时间线目标', () => {
    expect(
      resolveSemanticTimelineViewTarget({ params: { timelineJson: '{oops' } }, null)
    ).toBeNull()
    // 有 id 但没有 source → 不是时间线文档
    expect(
      resolveSemanticTimelineViewTarget({ params: { timelineJson: '{"id":"stl.x"}' } }, null)
    ).toBeNull()
    expect(
      resolveSemanticTimelineViewTarget({ params: { timelineJson: '{"id":"other"}' } }, null)
    ).toBeNull()
    expect(
      resolveSemanticTimelineViewTarget({ params: { semanticTimelineId: 'not-an-id' } }, null)
    ).toBeNull()
  })

  it('输出摘要给 id 与规模（供卡片预览，不塞整份 JSON）', () => {
    const summary = semanticTimelineSummaryText(semanticTimelineValue(makeDoc()))
    expect(summary).toContain('stl.view0001')
    expect(summary).toContain('镜头 9')
    expect(summary).toContain('话语 8')
    expect(summary).toContain('实体 16')
    expect(summary).toContain('事件 1')
    expect(summary).toContain('节拍 1')
    // 摘要必须短（卡片上是一行）
    expect(summary.length).toBeLessThan(120)
    // 非该 kind → 空串
    expect(semanticTimelineSummaryText({ kind: 'text', text: 'hi' } as never)).toBe('')
    expect(semanticTimelineSummaryText(undefined)).toBe('')
  })
})
