export interface InlineAsset {
  id: string
  name: string
  dataUrl: string
  naturalWidth: number
  naturalHeight: number
  image?: HTMLImageElement
}

export interface LayoutConfig {
  width: number
  height: number
  fontSize: number
  minFontSize: number
  fontFamily: string
  lineHeight: number
  maxColumns: number
  columnGap: number
  textColor: string
  strokeColor: string
  strokeWidth: number
}

export interface LayoutResult {
  success: boolean
  placements: Placement[]
  fontSize: number
  columns: number
  columnHeights: number[]
  warnings: string[]
}

export interface Placement {
  type: 'text' | 'asset'
  value: string
  asset?: InlineAsset
  x: number
  y: number
  width: number
  height: number
  baseline: number
  lineHeight: number
  column: number
}

export interface CharacterOptions {
  scale: number
  offsetX: number
  offsetY: number
  margin: number
  brightness: number
  contrast: number
  dropShadow: boolean
}

export interface SceneOptions {
  canvasWidth: number
  canvasHeight: number
  outerPadding: number
  safePadding: number
  autoColumns: boolean
  textOffsetX: number
  textOffsetY: number
}

export interface SceneComputation {
  safeRect: Rect
  characterRect?: Rect
  layout: LayoutResult
  warnings: string[]
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
