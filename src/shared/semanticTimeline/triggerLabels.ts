/**
 * 触发节点的「事件标签过滤」多值解析。
 *
 * 参数名仍是 `eventLabel`（单值字符串，保持向后兼容），但允许**逗号分隔多值** ——
 * 与 `rulePackIds` 的写法一致，零迁移。串成一条片子时经常要一次抓多个事件
 * （例如「促销类 + 收尾号召」）。
 *
 * ⚠️ **不按空格切分**：事件标签可能是英文短语（`price announce`），空格切开就废了。
 */
export function parseEventLabels(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  const out: string[] = []
  for (const part of raw.split(/[,，]/)) {
    const label = part.trim()
    if (label && !out.includes(label)) out.push(label)
  }
  return out
}
