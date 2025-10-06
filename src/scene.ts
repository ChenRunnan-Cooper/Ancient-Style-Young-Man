import { autoLayout, tokenizeText } from './layoutEngine'
import type {
  CharacterOptions,
  InlineAsset,
  LayoutConfig,
  LayoutResult,
  SceneComputation,
  SceneOptions,
  Rect
} from './types'

interface SceneParams {
  canvasWidth: number
  canvasHeight: number
  backgroundImage: HTMLImageElement | null
  characterImage: HTMLImageElement | null
  characterOptions: CharacterOptions
  text: string
  inlineAssets: InlineAsset[]
  layoutConfig: LayoutConfig
  options: SceneOptions
}

export function computeScene(params: SceneParams): SceneComputation {
  const {
    canvasWidth,
    canvasHeight,
    characterImage,
    characterOptions,
    text,
    inlineAssets,
    layoutConfig,
    options
  } = params

  const characterRect = characterImage
    ? computeCharacterRect(canvasWidth, canvasHeight, characterImage, characterOptions)
    : undefined

  const safeRect = computeSafeRect(canvasWidth, canvasHeight, characterRect, options.outerPadding, options.safePadding)
  const tokens = tokenizeText(text, inlineAssets)
  const rawLayout = autoLayout(tokens, layoutConfig, safeRect, options.autoColumns)
  const alignedLayout = alignLayout(rawLayout, safeRect, characterRect)
  const offsetLayout = applyTextOffset(alignedLayout, options.textOffsetX, options.textOffsetY, safeRect)

  return {
    safeRect,
    characterRect,
    layout: offsetLayout,
    warnings: offsetLayout.warnings
  }
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  params: SceneParams,
  scene: SceneComputation
) {
  const { canvasWidth, canvasHeight, backgroundImage, characterImage, characterOptions, layoutConfig } = params

  ctx.save()
  ctx.clearRect(0, 0, canvasWidth, canvasHeight)
  ctx.globalCompositeOperation = 'source-over'

  if (backgroundImage) {
    drawBackground(ctx, backgroundImage, canvasWidth, canvasHeight)
  } else {
    ctx.fillStyle = '#222'
    ctx.fillRect(0, 0, canvasWidth, canvasHeight)
  }

  drawText(ctx, scene.layout.placements, scene.layout.fontSize, layoutConfig)

  if (characterImage && scene.characterRect) {
    drawCharacter(ctx, characterImage, scene.characterRect, characterOptions)
  }

  ctx.restore()
}

function alignLayout(layout: LayoutResult, safeRect: Rect, characterRect?: Rect): LayoutResult {
  if (!layout.success || layout.columnHeights.length === 0) {
    return layout
  }

  const maxHeight = Math.max(...layout.columnHeights)
  if (maxHeight <= 0) {
    return layout
  }

  const safeTop = safeRect.y
  const safeBottom = safeRect.y + safeRect.height
  const targetTopRaw = characterRect ? characterRect.y : safeTop
  const targetTop = Math.min(Math.max(targetTopRaw, safeTop), safeBottom)
  const desiredOffset = Math.max(0, targetTop - safeTop)
  const maxOffset = Math.max(0, safeRect.height - maxHeight)
  const appliedOffset = Math.min(desiredOffset, maxOffset)

  if (appliedOffset <= 0) {
    return layout
  }

  const adjustedPlacements = layout.placements.map((placement) => ({
    ...placement,
    y: placement.y + appliedOffset,
    baseline: placement.baseline + appliedOffset
  }))

  return {
    ...layout,
    placements: adjustedPlacements
  }
}

function applyTextOffset(layout: LayoutResult, offsetX: number, offsetY: number, safeRect: Rect): LayoutResult {
  if (!layout.success) {
    return layout
  }

  if (offsetX === 0 && offsetY === 0) {
    return layout
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  const placements = layout.placements.map((placement) => {
    const x = placement.x + offsetX
    const y = placement.y + offsetY
    const baseline = placement.baseline + offsetY

    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x + placement.width)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y + placement.height)

    return {
      ...placement,
      x,
      y,
      baseline
    }
  })

  const warnings = [...layout.warnings]
  const warningText = '文案位置已超出安全区，可调整“文案偏移”或裁剪设置。'
  if (
    minX < safeRect.x ||
    maxX > safeRect.x + safeRect.width ||
    minY < safeRect.y ||
    maxY > safeRect.y + safeRect.height
  ) {
    if (!warnings.includes(warningText)) {
      warnings.push(warningText)
    }
  }

  return {
    ...layout,
    placements,
    warnings
  }
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  canvasWidth: number,
  canvasHeight: number
) {
  const scale = Math.max(canvasWidth / image.naturalWidth, canvasHeight / image.naturalHeight)
  const drawWidth = image.naturalWidth * scale
  const drawHeight = image.naturalHeight * scale
  const offsetX = (canvasWidth - drawWidth) / 2
  const offsetY = (canvasHeight - drawHeight) / 2
  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight)
}

function drawText(
  ctx: CanvasRenderingContext2D,
  placements: ReturnType<typeof autoLayout>['placements'],
  fontSize: number,
  config: LayoutConfig
) {
  ctx.save()
  ctx.font = `${fontSize}px ${config.fontFamily}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = config.textColor
  ctx.lineJoin = 'round'
  ctx.lineWidth = config.strokeWidth
  if (config.strokeWidth > 0) {
    ctx.strokeStyle = config.strokeColor
  }

  for (const placement of placements) {
    if (placement.type === 'text') {
      if (config.strokeWidth > 0) {
        ctx.strokeText(placement.value, placement.x, placement.baseline)
      }
      ctx.fillText(placement.value, placement.x, placement.baseline)
    } else if (placement.asset) {
      const asset = placement.asset
      const image = asset.image
      if (image && image.complete) {
        const top = placement.y + (placement.lineHeight - placement.height) / 2
        ctx.drawImage(image, placement.x, top, placement.width, placement.height)
      }
    }
  }

  ctx.restore()
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  rect: Rect,
  options: CharacterOptions
) {
  ctx.save()
  const filters = [`brightness(${options.brightness}%)`, `contrast(${options.contrast}%)`]
  ctx.filter = filters.join(' ')
  if (options.dropShadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
    ctx.shadowBlur = 24
    ctx.shadowOffsetX = 12
    ctx.shadowOffsetY = 12
  }
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height)
  ctx.restore()
}

function computeCharacterRect(
  canvasWidth: number,
  canvasHeight: number,
  image: HTMLImageElement,
  options: CharacterOptions
): Rect {
  const maxWidth = canvasWidth * 0.9
  const width = Math.min(maxWidth, canvasWidth * options.scale)
  const ratio = image.naturalHeight === 0 ? 1 : image.naturalWidth / image.naturalHeight
  const height = width / (ratio || 1)
  const baseX = canvasWidth - width - options.margin
  const baseY = canvasHeight - height - options.margin
  const x = clamp(baseX + options.offsetX, -width * 0.25, canvasWidth - width * 0.75)
  const y = clamp(baseY + options.offsetY, -height * 0.1, canvasHeight - height * 0.1)
  return { x, y, width, height }
}

function computeSafeRect(
  canvasWidth: number,
  canvasHeight: number,
  characterRect: Rect | undefined,
  outerPadding: number,
  safePadding: number
): Rect {
  const x = outerPadding
  const y = outerPadding
  const width = Math.max(canvasWidth - outerPadding * 2, 10)
  const height = Math.max(canvasHeight - outerPadding * 2, 10)

  if (!characterRect) {
    return { x, y, width, height }
  }

  const leftWidth = Math.max(characterRect.x - safePadding - x, 0)
  const leftRect = { x, y, width: leftWidth, height }

  const topHeight = Math.max(characterRect.y - safePadding - y, 0)
  const topRect = { x, y, width, height: topHeight }

  const rightX = characterRect.x + characterRect.width + safePadding
  const rightWidth = Math.max(x + width - rightX, 0)
  const rightRect = { x: rightX, y, width: rightWidth, height }

  const candidates = [leftRect, topRect, rightRect].filter((rect) => rect.width > 20 && rect.height > 20)
  if (candidates.length === 0) {
    return { x, y, width, height }
  }

  candidates.sort((a, b) => b.width * b.height - a.width * a.height)
  return candidates[0]
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
