import type { InlineAsset, LayoutConfig, LayoutResult, Placement, Rect } from './types'

type LayoutToken =
  | { type: 'text'; value: string }
  | { type: 'asset'; asset: InlineAsset }

const ASSET_TOKEN_REGEX = /\[\[asset:([^\]]+)\]\]/g

export function tokenizeText(input: string, assets: InlineAsset[]): LayoutToken[] {
  const results: LayoutToken[] = []
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]))

  let lastIndex = 0
  input.replace(ASSET_TOKEN_REGEX, (match, assetId, offset) => {
    if (offset > lastIndex) {
      const slice = input.slice(lastIndex, offset)
      if (slice) {
        results.push({ type: 'text', value: slice })
      }
    }
    const asset = assetMap.get(assetId)
    if (asset) {
      results.push({ type: 'asset', asset })
    } else {
      results.push({ type: 'text', value: match })
    }
    lastIndex = offset + match.length
    return match
  })

  const tail = input.slice(lastIndex)
  if (tail) {
    results.push({ type: 'text', value: tail })
  }

  if (results.length === 0) {
    results.push({ type: 'text', value: '' })
  }

  return results
}

interface LineBuffer {
  runs: RunBuffer[]
  width: number
  ascent: number
  descent: number
  height: number
}

interface RunBuffer {
  type: 'text' | 'asset'
  value: string
  asset?: InlineAsset
  width: number
  height: number
  ascent: number
  descent: number
  metrics?: TextMetrics
}

interface LayoutAttempt {
  success: boolean
  placements: Placement[]
  overflow: boolean
  warnings: string[]
  columnHeights: number[]
}

export function autoLayout(
  tokens: LayoutToken[],
  config: LayoutConfig,
  safeRect: Rect,
  autoColumns: boolean
): LayoutResult {
  const warnings: string[] = []
  if (safeRect.width <= 0 || safeRect.height <= 0) {
    return {
      success: false,
      placements: [],
      fontSize: config.minFontSize,
      columns: 1,
      columnHeights: [],
      warnings: ['安全区域尺寸无效，无法排版']
    }
  }

  const maxColumns = autoColumns ? Math.max(1, config.maxColumns) : 1
  const columnCandidates = autoColumns
    ? Array.from({ length: maxColumns }, (_, idx) => idx + 1)
    : [1]

  const measureContext = createMeasureContext(config.fontFamily, config.fontSize)

  for (const columns of columnCandidates) {
    const attempt = findFontSizeForColumns(tokens, safeRect, config, columns, measureContext)
    if (attempt.success) {
      return {
        success: true,
        placements: attempt.placements,
        fontSize: attempt.fontSize,
        columns,
        columnHeights: attempt.columnHeights,
        warnings: [...warnings, ...attempt.warnings]
      }
    }
    warnings.push(...attempt.warnings)
  }

  return {
    success: false,
    placements: [],
    fontSize: config.minFontSize,
    columns: 1,
    columnHeights: [],
    warnings: warnings.length
      ? warnings
      : ['内容过多，最小字号仍无法在安全区域排布，可尝试减少文字、缩小角色或下调“基准字号”。']
  }
}

function findFontSizeForColumns(
  tokens: LayoutToken[],
  safeRect: Rect,
  config: LayoutConfig,
  columns: number,
  reusableContext: CanvasRenderingContext2D
): {
  success: boolean
  placements: Placement[]
  fontSize: number
  warnings: string[]
  columnHeights: number[]
} {
  const warnings: string[] = []
  const step = 2
  for (let fontSize = config.fontSize; fontSize >= config.minFontSize; fontSize -= step) {
    reusableContext.font = `${fontSize}px ${config.fontFamily}`
    const attempt = layoutWithConfig(tokens, safeRect, { fontSize, columns, config, measureContext: reusableContext })
    warnings.push(...attempt.warnings)
    if (attempt.success) {
      return {
        success: true,
        placements: attempt.placements,
        fontSize,
        warnings,
        columnHeights: attempt.columnHeights
      }
    }
  }
  return {
    success: false,
    placements: [],
    fontSize: config.minFontSize,
    warnings,
    columnHeights: []
  }
}

interface LayoutWithConfigParams {
  fontSize: number
  columns: number
  config: LayoutConfig
  measureContext: CanvasRenderingContext2D
}

function layoutWithConfig(
  tokens: LayoutToken[],
  safeRect: Rect,
  params: LayoutWithConfigParams
): LayoutAttempt {
  const { fontSize, columns, config, measureContext } = params
  const columnGap = config.columnGap
  const totalGap = columnGap * (columns - 1)
  const columnWidth = (safeRect.width - totalGap) / columns

  if (columnWidth <= 20) {
    return {
      success: false,
      placements: [],
      overflow: true,
      warnings: ['安全区域过窄，建议缩小角色或增加安全边距，可尝试下调“基准字号”。'],
      columnHeights: new Array(columns).fill(0)
    }
  }

  const lines: LineBuffer[] = []
  let currentLine = createLineBuffer(fontSize, config.lineHeight)

  for (const token of tokens) {
    if (token.type === 'text') {
      const segments = token.value.split('\n')
      segments.forEach((segment, segmentIndex) => {
        if (segment) {
          currentLine = pushTextSegment(
            segment,
            currentLine,
            columnWidth,
            measureContext,
            fontSize,
            config.lineHeight,
            lines
          )
        }
        if (segmentIndex < segments.length - 1) {
          lines.push(currentLine)
          currentLine = createLineBuffer(fontSize, config.lineHeight)
        }
      })
    } else {
      currentLine = pushAssetToken(
        token.asset,
        currentLine,
        columnWidth,
        fontSize,
        config.lineHeight,
        lines
      )
    }
  }

  if (currentLine.runs.length > 0 || lines.length === 0) {
    lines.push(currentLine)
  }

  const placements: Placement[] = []
  const columnHeights = new Array(columns).fill(0)
  let columnIndex = 0
  let cursorY = 0

  for (const line of lines) {
    if (cursorY + line.height > safeRect.height + 0.5) {
      columnHeights[columnIndex] = cursorY
      columnIndex += 1
      if (columnIndex >= columns) {
        return {
          success: false,
          placements: [],
          overflow: true,
          warnings: ['内容过多，换列后仍然溢出，可尝试减小“基准字号”或精简文案。'],
          columnHeights
        }
      }
      cursorY = 0
    }

    const left = safeRect.x + columnIndex * (columnWidth + columnGap)
    let cursorX = 0
    const baseline = cursorY + line.ascent + Math.max(0, (line.height - (line.ascent + line.descent)) / 2)

    for (const run of line.runs) {
      const runHeight = run.type === 'asset' ? run.height : line.height
      placements.push({
        type: run.type,
        value: run.value,
        asset: run.asset,
        x: left + cursorX,
        y: safeRect.y + cursorY,
        width: run.width,
        height: runHeight,
        baseline: safeRect.y + baseline,
        lineHeight: line.height,
        column: columnIndex
      })
      cursorX += run.width
    }

    cursorY += line.height
  }

  columnHeights[columnIndex] = cursorY

  return { success: true, placements, overflow: false, warnings: [], columnHeights }
}

function pushTextSegment(
  segment: string,
  line: LineBuffer,
  columnWidth: number,
  measureContext: CanvasRenderingContext2D,
  fontSize: number,
  lineHeightRatio: number,
  lines: LineBuffer[]
): LineBuffer {
  let currentLine = line
  for (const char of Array.from(segment)) {
    const metrics = measureContext.measureText(char)
    const width = metrics.width
    const ascent = metrics.actualBoundingBoxAscent || metrics.fontBoundingBoxAscent || fontSize * 0.82
    const descent = metrics.actualBoundingBoxDescent || metrics.fontBoundingBoxDescent || fontSize * 0.18

    if (currentLine.width + width > columnWidth && currentLine.runs.length > 0) {
      lines.push(currentLine)
      currentLine = createLineBuffer(fontSize, lineHeightRatio)
    }

    currentLine.runs.push({
      type: 'text',
      value: char,
      width,
      height: currentLine.height,
      ascent,
      descent,
      metrics
    })
    currentLine.width += width
    currentLine.ascent = Math.max(currentLine.ascent, ascent)
    currentLine.descent = Math.max(currentLine.descent, descent)
    currentLine.height = Math.max(currentLine.height, currentLine.ascent + currentLine.descent)
  }
  return currentLine
}

function pushAssetToken(
  asset: InlineAsset,
  line: LineBuffer,
  columnWidth: number,
  fontSize: number,
  lineHeightRatio: number,
  lines: LineBuffer[]
): LineBuffer {
  let currentLine = line
  const targetHeight = fontSize * 1.05
  const ratio = asset.naturalWidth / asset.naturalHeight || 1
  let width = targetHeight * ratio
  let height = targetHeight

  if (width > columnWidth) {
    const scale = columnWidth / width
    width = columnWidth
    height *= scale
  }

  if (currentLine.width + width > columnWidth && currentLine.runs.length > 0) {
    lines.push(currentLine)
    currentLine = createLineBuffer(fontSize, lineHeightRatio)
  }

  currentLine.runs.push({
    type: 'asset',
    value: asset.id,
    width,
    height,
    ascent: height,
    descent: 0,
    asset
  })
  currentLine.width += width
  currentLine.height = Math.max(currentLine.height, height)
  currentLine.ascent = Math.max(currentLine.ascent, height)
  currentLine.descent = Math.max(currentLine.descent, 0)
  currentLine.height = Math.max(currentLine.height, currentLine.ascent + currentLine.descent)
  return currentLine
}

function createLineBuffer(fontSize: number, lineHeightRatio: number): LineBuffer {
  const baseHeight = fontSize * lineHeightRatio
  return {
    runs: [],
    width: 0,
    ascent: (fontSize * 0.8),
    descent: (fontSize * 0.2),
    height: baseHeight
  }
}

function createMeasureContext(fontFamily: string, fontSize: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 2048
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('无法创建测量上下文')
  }
  ctx.font = `${fontSize}px ${fontFamily}`
  ctx.textBaseline = 'alphabetic'
  return ctx
}
