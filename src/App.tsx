import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import type { CharacterOptions, InlineAsset, SceneComputation } from './types'
import { computeScene, renderScene } from './scene'
import type { LayoutConfig, SceneOptions } from './types'

const DEFAULT_CANVAS_SIZE = 1080
const ASSET_BASE = import.meta.env.BASE_URL || '/'
const DEFAULT_BACKGROUND = `${ASSET_BASE}assets/background.jpg`
const DEFAULT_CHARACTER = `${ASSET_BASE}assets/character.png`
const MIN_TRIMMED_HEIGHT = 360

function useLoadedImage(src: string | null) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    if (!src) {
      setImage(null)
      return
    }
    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (!cancelled) {
        setImage(img)
      }
    }
    img.onerror = () => {
      if (!cancelled) {
        setImage(null)
      }
    }
    img.src = src
    return () => {
      cancelled = true
    }
  }, [src])

  return image
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        resolve(result)
      } else {
        reject(new Error('无法读取文件'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = dataUrl
  })
}

function scaleCharacterOptions(
  source: CharacterOptions,
  factor: number
): CharacterOptions {
  return {
    ...source,
    offsetX: source.offsetX * factor,
    offsetY: source.offsetY * factor,
    margin: source.margin * factor
  }
}

function scaleLayoutConfig(
  config: LayoutConfig,
  factor: number,
  size: { width: number; height: number }
): LayoutConfig {
  return {
    ...config,
    width: size.width,
    height: size.height,
    fontSize: config.fontSize * factor,
    minFontSize: config.minFontSize * factor,
    columnGap: config.columnGap * factor,
    strokeWidth: Math.max(config.strokeWidth * factor, 0)
  }
}

function scaleSceneOptions(
  options: SceneOptions,
  factor: number,
  size: { width: number; height: number }
): SceneOptions {
  return {
    ...options,
    canvasWidth: size.width,
    canvasHeight: size.height,
    outerPadding: options.outerPadding * factor,
    safePadding: options.safePadding * factor,
    textOffsetX: options.textOffsetX * factor,
    textOffsetY: options.textOffsetY * factor
  }
}

function normalizeCrop(top: number, bottom: number, fullHeight: number, minHeight: number) {
  const safeMinHeight = Math.min(fullHeight, Math.max(minHeight, 1))
  const maxTop = Math.max(0, fullHeight - safeMinHeight)
  const normalizedTop = Math.max(0, Math.min(top, maxTop))
  const maxBottom = Math.max(0, fullHeight - normalizedTop - safeMinHeight)
  const normalizedBottom = Math.max(0, Math.min(bottom, maxBottom))
  const trimmedHeight = Math.max(fullHeight - normalizedTop - normalizedBottom, safeMinHeight)
  return { top: normalizedTop, bottom: normalizedBottom, height: trimmedHeight }
}

const FONT_FAMILIES = [
  'Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif',
  'Noto Serif SC, Songti SC, SimSun, serif',
  'ZCOOL KuaiLe, PingFang SC, sans-serif',
  'LXGW WenKai, KaiTi, STKaiti, serif'
]

const EXPORT_PRESETS = [
  { label: '1080px (1K)', value: 1080 },
  { label: '2048px (2K)', value: 2048 },
  { label: '4096px (4K)', value: 4096 }
]

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)

  const [backgroundSource, setBackgroundSource] = useState<string>(DEFAULT_BACKGROUND)
  const [characterSource, setCharacterSource] = useState<string>(DEFAULT_CHARACTER)
  const [textContent, setTextContent] = useState<string>(
    '孤月酒，细雨愁。\n此处留白请君落字，一笑风尘三千筹。'
  )
  const [inlineAssets, setInlineAssets] = useState<InlineAsset[]>([])
  const [backgroundObjectUrl, setBackgroundObjectUrl] = useState<string | null>(null)
  const [characterObjectUrl, setCharacterObjectUrl] = useState<string | null>(null)
  const [cropSettings, setCropSettings] = useState({ top: 0, bottom: 0 })

  const [characterOptions, setCharacterOptions] = useState<CharacterOptions>({
    scale: 0.42,
    offsetX: 0,
    offsetY: 0,
    margin: 48,
    brightness: 100,
    contrast: 105,
    dropShadow: true
  })

  const [sceneOptions, setSceneOptions] = useState<SceneOptions>({
    canvasWidth: DEFAULT_CANVAS_SIZE,
    canvasHeight: DEFAULT_CANVAS_SIZE,
    outerPadding: 72,
    safePadding: 40,
    autoColumns: true,
    textOffsetX: 0,
    textOffsetY: 0
  })

  const [layoutUI, setLayoutUI] = useState({
    fontFamily: FONT_FAMILIES[0],
    fontSize: 84,
    minFontSize: 32,
    lineHeight: 1.28,
    maxColumns: 2,
    columnGap: 48,
    textColor: '#407fbf',
    strokeColor: '#ffffff',
    strokeWidth: 3
  })

  const [scene, setScene] = useState<SceneComputation | null>(null)
  const [layoutWarnings, setLayoutWarnings] = useState<string[]>([])
  const [isExporting, setIsExporting] = useState(false)
  const [selectedExport, setSelectedExport] = useState<number>(EXPORT_PRESETS[1].value)
  const [previewSize, setPreviewSize] = useState({ cropTop: 0, cropBottom: 0, height: DEFAULT_CANVAS_SIZE })

  const backgroundImage = useLoadedImage(backgroundSource)
  const characterImage = useLoadedImage(characterSource)

  useEffect(() => {
    return () => {
      if (backgroundObjectUrl) URL.revokeObjectURL(backgroundObjectUrl)
      if (characterObjectUrl) URL.revokeObjectURL(characterObjectUrl)
    }
  }, [backgroundObjectUrl, characterObjectUrl])

  const baseLayoutConfig: LayoutConfig = useMemo(
    () => ({
      width: sceneOptions.canvasWidth,
      height: sceneOptions.canvasHeight,
      fontSize: layoutUI.fontSize,
      minFontSize: layoutUI.minFontSize,
      fontFamily: layoutUI.fontFamily,
      lineHeight: layoutUI.lineHeight,
      maxColumns: layoutUI.maxColumns,
      columnGap: layoutUI.columnGap,
      textColor: layoutUI.textColor,
      strokeColor: layoutUI.strokeColor,
      strokeWidth: layoutUI.strokeWidth
    }),
    [layoutUI, sceneOptions.canvasWidth, sceneOptions.canvasHeight]
  )

  const buildSceneParams = (targetWidth: number, targetHeight: number) => {
    const factor = targetWidth / sceneOptions.canvasWidth
    const size = { width: targetWidth, height: targetHeight }
    return {
      canvasWidth: targetWidth,
      canvasHeight: targetHeight,
      backgroundImage,
      characterImage,
      characterOptions: scaleCharacterOptions(characterOptions, factor),
      text: textContent,
      inlineAssets,
      layoutConfig: scaleLayoutConfig(baseLayoutConfig, factor, size),
      options: scaleSceneOptions(sceneOptions, factor, size)
    }
  }

  const previewAspectRatio = useMemo(() => {
    const height = previewSize.height > 0 ? previewSize.height : sceneOptions.canvasHeight
    return `${sceneOptions.canvasWidth} / ${height}`
  }, [previewSize.height, sceneOptions.canvasWidth, sceneOptions.canvasHeight])

  const safeHighlightStyle = useMemo(() => {
    if (!scene || previewSize.height <= 0) {
      return null
    }
    const safeLeft = (scene.safeRect.x / sceneOptions.canvasWidth) * 100
    const safeWidth = (scene.safeRect.width / sceneOptions.canvasWidth) * 100

    const visibleTop = Math.max(scene.safeRect.y - previewSize.cropTop, 0)
    const visibleBottom = Math.min(
      scene.safeRect.y + scene.safeRect.height - previewSize.cropTop,
      previewSize.height
    )
    const visibleHeight = visibleBottom - visibleTop
    if (visibleHeight <= 0) {
      return null
    }

    return {
      left: `${safeLeft}%`,
      width: `${safeWidth}%`,
      top: `${(visibleTop / previewSize.height) * 100}%`,
      height: `${(visibleHeight / previewSize.height) * 100}%`
    }
  }, [scene, previewSize, sceneOptions.canvasWidth])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const params = buildSceneParams(sceneOptions.canvasWidth, sceneOptions.canvasHeight)
    const computed = computeScene(params)

    const offscreen = document.createElement('canvas')
    offscreen.width = sceneOptions.canvasWidth
    offscreen.height = sceneOptions.canvasHeight
    const offscreenCtx = offscreen.getContext('2d')
    if (!offscreenCtx) return

    renderScene(offscreenCtx, params, computed)

    const crop = normalizeCrop(
      cropSettings.top,
      cropSettings.bottom,
      sceneOptions.canvasHeight,
      MIN_TRIMMED_HEIGHT
    )

    const ratio = window.devicePixelRatio || 1
    canvas.width = sceneOptions.canvasWidth * ratio
    canvas.height = crop.height * ratio
    canvas.style.width = '100%'
    canvas.style.height = 'auto'

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.save()
    ctx.scale(ratio, ratio)
    ctx.clearRect(0, 0, sceneOptions.canvasWidth, crop.height)
    ctx.drawImage(
      offscreen,
      0,
      crop.top,
      sceneOptions.canvasWidth,
      crop.height,
      0,
      0,
      sceneOptions.canvasWidth,
      crop.height
    )
    ctx.restore()

    setScene(computed)
    setLayoutWarnings(computed.warnings)
    setPreviewSize((prev) =>
      prev.cropTop === crop.top && prev.cropBottom === crop.bottom && prev.height === crop.height
        ? prev
        : { cropTop: crop.top, cropBottom: crop.bottom, height: crop.height }
    )
  }, [
    backgroundImage,
    characterImage,
    characterOptions,
    inlineAssets,
    textContent,
    sceneOptions,
    baseLayoutConfig,
    cropSettings
  ])

  const handleBackgroundUpload = async (file: File) => {
    if (!file) return
    if (backgroundObjectUrl) {
      URL.revokeObjectURL(backgroundObjectUrl)
    }
    const url = URL.createObjectURL(file)
    setBackgroundObjectUrl(url)
    setBackgroundSource(url)
  }

  const handleCharacterUpload = async (file: File) => {
    if (!file) return
    if (characterObjectUrl) {
      URL.revokeObjectURL(characterObjectUrl)
    }
    const url = URL.createObjectURL(file)
    setCharacterObjectUrl(url)
    setCharacterSource(url)
  }

  const handleAddInlineAsset = async (file: File) => {
    if (!file) return
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const image = await loadImage(dataUrl)
      const asset: InlineAsset = {
        id: `asset-${Date.now()}`,
        name: file.name,
        dataUrl,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        image
      }
      setInlineAssets((prev) => [...prev, asset])
    } catch (error) {
      console.error(error)
    }
  }

  const insertAssetToken = (assetId: string) => {
    const token = `[[asset:${assetId}]]`
    const editor = textAreaRef.current
    if (!editor) {
      setTextContent((prev) => prev + token)
      return
    }
    const start = editor.selectionStart ?? editor.value.length
    const end = editor.selectionEnd ?? editor.value.length
    const nextValue = editor.value.slice(0, start) + token + editor.value.slice(end)
    setTextContent(nextValue)
    requestAnimationFrame(() => {
      editor.focus()
      const caret = start + token.length
      editor.setSelectionRange(caret, caret)
    })
  }

  const removeAsset = (assetId: string) => {
    setInlineAssets((prev) => prev.filter((asset) => asset.id !== assetId))
    setTextContent((prev) => prev.replaceAll(`[[asset:${assetId}]]`, ''))
  }

  const handleExport = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const width = selectedExport
      const factor = width / sceneOptions.canvasWidth
      const height = Math.round(sceneOptions.canvasHeight * factor)
      const params = buildSceneParams(width, height)
      const sceneData = computeScene(params)

      const baseCanvas = document.createElement('canvas')
      baseCanvas.width = width
      baseCanvas.height = height
      const baseCtx = baseCanvas.getContext('2d')
      if (!baseCtx) throw new Error('导出画布创建失败')
      renderScene(baseCtx, params, sceneData)

      const crop = normalizeCrop(
        Math.round(cropSettings.top * factor),
        Math.round(cropSettings.bottom * factor),
        height,
        Math.max(Math.round(MIN_TRIMMED_HEIGHT * factor), 1)
      )

      const finalCanvas = document.createElement('canvas')
      finalCanvas.width = width
      finalCanvas.height = crop.height
      const finalCtx = finalCanvas.getContext('2d')
      if (!finalCtx) throw new Error('导出画布创建失败')
      finalCtx.drawImage(baseCanvas, 0, crop.top, width, crop.height, 0, 0, width, crop.height)

      const blob = await new Promise<Blob | null>((resolve) => finalCanvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('导出失败，请重试')
      const blobUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = blobUrl
      anchor.download = `gufeng-${Date.now()}.png`
      anchor.click()
      URL.revokeObjectURL(blobUrl)
    } catch (error) {
      console.error(error)
      alert(error instanceof Error ? error.message : '导出失败')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>古风小生生成器</h1>
          <p>上传背景与人物，输入文案，即刻生成留白抽象表情包。</p>
        </div>
        <div className="header__actions">
          <div className="export-group">
            <label htmlFor="export-size">导出分辨率</label>
            <select
              id="export-size"
              value={selectedExport}
              onChange={(event) => setSelectedExport(Number(event.target.value))}
            >
              {EXPORT_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>
          <button className="primary" onClick={handleExport} disabled={isExporting}>
            {isExporting ? '生成中…' : '导出 PNG'}
          </button>
        </div>
      </header>

      <main className="app__main">
        <section className="panel panel--controls">
          <h2>背景与角色</h2>
          <div className="field">
            <label htmlFor="background-upload">背景图片</label>
            <input
              id="background-upload"
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) handleBackgroundUpload(file)
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (backgroundObjectUrl) {
                  URL.revokeObjectURL(backgroundObjectUrl)
                  setBackgroundObjectUrl(null)
                }
                setBackgroundSource(DEFAULT_BACKGROUND)
              }}
            >
              恢复默认
            </button>
          </div>

          <div className="field">
            <label htmlFor="character-upload">角色图片</label>
            <input
              id="character-upload"
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) handleCharacterUpload(file)
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (characterObjectUrl) {
                  URL.revokeObjectURL(characterObjectUrl)
                  setCharacterObjectUrl(null)
                }
                setCharacterSource(DEFAULT_CHARACTER)
              }}
            >
              恢复默认
            </button>
          </div>

          <div className="field-grid">
            <label>
              人物大小
              <input
                type="range"
                min={0.25}
                max={0.7}
                step={0.01}
                value={characterOptions.scale}
                onChange={(event) =>
                  setCharacterOptions((prev) => ({ ...prev, scale: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              水平偏移
              <input
                type="range"
                min={-200}
                max={200}
                step={1}
                value={characterOptions.offsetX}
                onChange={(event) =>
                  setCharacterOptions((prev) => ({ ...prev, offsetX: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              垂直偏移
              <input
                type="range"
                min={-200}
                max={200}
                step={1}
                value={characterOptions.offsetY}
                onChange={(event) =>
                  setCharacterOptions((prev) => ({ ...prev, offsetY: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              安全距离
              <input
                type="range"
                min={16}
                max={160}
                step={2}
                value={sceneOptions.safePadding}
                onChange={(event) =>
                  setSceneOptions((prev) => ({ ...prev, safePadding: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              外框留白
              <input
                type="range"
                min={32}
                max={160}
                step={2}
                value={sceneOptions.outerPadding}
                onChange={(event) =>
                  setSceneOptions((prev) => ({ ...prev, outerPadding: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              亮度
              <input
                type="range"
                min={60}
                max={140}
                step={1}
                value={characterOptions.brightness}
                onChange={(event) =>
                  setCharacterOptions((prev) => ({ ...prev, brightness: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              对比度
              <input
                type="range"
                min={60}
                max={160}
                step={1}
                value={characterOptions.contrast}
                onChange={(event) =>
                  setCharacterOptions((prev) => ({ ...prev, contrast: Number(event.target.value) }))
                }
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={characterOptions.dropShadow}
                onChange={(event) =>
                  setCharacterOptions((prev) => ({ ...prev, dropShadow: event.target.checked }))
                }
              />
              角色阴影
            </label>
          </div>
        </section>

        <section className="panel panel--editor">
          <h2>文案与内嵌元素</h2>
          <textarea
            ref={textAreaRef}
            className="editor"
            value={textContent}
            onChange={(event) => setTextContent(event.target.value)}
            placeholder="在此输入你的古风文案，可通过下方按钮插入图片或 emoji。"
          />

          <div className="inline-assets">
            <div className="inline-assets__header">
              <span>内嵌图片 / Emoji</span>
              <label className="inline-assets__upload">
                + 添加
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) {
                      handleAddInlineAsset(file)
                      event.target.value = ''
                    }
                  }}
                />
              </label>
            </div>
            {inlineAssets.length === 0 ? (
              <p className="inline-assets__empty">尚未添加，可用于在文字中插入小贴图。</p>
            ) : (
              <ul>
                {inlineAssets.map((asset) => (
                  <li key={asset.id}>
                    <img src={asset.dataUrl} alt={asset.name} />
                    <div>
                      <p>{asset.name}</p>
                      <p className="token">{`[[asset:${asset.id}]]`}</p>
                    </div>
                    <div className="inline-assets__actions">
                      <button type="button" onClick={() => insertAssetToken(asset.id)}>
                        插入
                      </button>
                      <button type="button" onClick={() => removeAsset(asset.id)}>
                        移除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="layout-settings">
            <h3>排版设置</h3>
            <label>
              字体
              <select
                value={layoutUI.fontFamily}
                onChange={(event) =>
                  setLayoutUI((prev) => ({ ...prev, fontFamily: event.target.value }))
                }
              >
                {FONT_FAMILIES.map((font) => (
                  <option key={font} value={font}>
                    {font.split(',')[0]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              基准字号
              <input
                type="range"
                min={36}
                max={120}
                step={2}
                value={layoutUI.fontSize}
                onChange={(event) =>
                  setLayoutUI((prev) => ({ ...prev, fontSize: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              最小字号
              <input
                type="range"
                min={16}
                max={layoutUI.fontSize}
                step={2}
                value={layoutUI.minFontSize}
                onChange={(event) =>
                  setLayoutUI((prev) => ({ ...prev, minFontSize: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              行距
              <input
                type="range"
                min={1.1}
                max={1.6}
                step={0.02}
                value={layoutUI.lineHeight}
                onChange={(event) =>
                  setLayoutUI((prev) => ({ ...prev, lineHeight: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              列数上限
              <input
                type="range"
                min={1}
                max={3}
                step={1}
                value={layoutUI.maxColumns}
                onChange={(event) =>
                  setLayoutUI((prev) => ({ ...prev, maxColumns: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              列间距
              <input
                type="range"
                min={16}
                max={120}
                step={4}
                value={layoutUI.columnGap}
                onChange={(event) =>
                  setLayoutUI((prev) => ({ ...prev, columnGap: Number(event.target.value) }))
                }
              />
            </label>
            <div className="color-pickers">
              <label>
                文字颜色
                <input
                  type="color"
                  value={layoutUI.textColor}
                  onChange={(event) =>
                    setLayoutUI((prev) => ({ ...prev, textColor: event.target.value }))
                  }
                />
              </label>
              <label>
                描边颜色
                <input
                  type="color"
                  value={layoutUI.strokeColor}
                  onChange={(event) =>
                    setLayoutUI((prev) => ({ ...prev, strokeColor: event.target.value }))
                  }
                />
              </label>
              <label>
                描边宽度
                <input
                  type="range"
                  min={0}
                  max={12}
                  step={1}
                  value={layoutUI.strokeWidth}
                  onChange={(event) =>
                    setLayoutUI((prev) => ({ ...prev, strokeWidth: Number(event.target.value) }))
                  }
                />
              </label>
            </div>
            <label>
              文案水平偏移 ({sceneOptions.textOffsetX} px)
              <input
                type="range"
                min={-240}
                max={240}
                step={2}
                value={sceneOptions.textOffsetX}
                onChange={(event) =>
                  setSceneOptions((prev) => ({ ...prev, textOffsetX: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              文案垂直偏移 ({sceneOptions.textOffsetY} px)
              <input
                type="range"
                min={-240}
                max={240}
                step={2}
                value={sceneOptions.textOffsetY}
                onChange={(event) =>
                  setSceneOptions((prev) => ({ ...prev, textOffsetY: Number(event.target.value) }))
                }
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={sceneOptions.autoColumns}
                onChange={(event) =>
                  setSceneOptions((prev) => ({ ...prev, autoColumns: event.target.checked }))
                }
              />
              自动多列排版
            </label>
          </div>
        </section>

        <section className="panel panel--preview">
          <h2>预览</h2>
          <div className="preview-wrapper">
            <div className="canvas-container" style={{ aspectRatio: previewAspectRatio }}>
              <canvas ref={canvasRef} />
              {safeHighlightStyle ? <div className="safe-highlight" style={safeHighlightStyle} /> : null}
            </div>
            {layoutWarnings.length > 0 ? (
              <div className="warnings">
                {layoutWarnings.map((warning, index) => (
                  <p key={index}>{warning}</p>
                ))}
              </div>
            ) : (
              <p className="note">✅ 好了！导出前可再次微调人物与参数。</p>
            )}
            <div className="crop-settings">
              <h3>自定义裁剪</h3>
              <label>
                上裁剪（当前 {Math.round(previewSize.cropTop)} px）
                <input
                  type="range"
                  min={0}
                  max={480}
                  step={10}
                  value={cropSettings.top}
                  onChange={(event) =>
                    setCropSettings((prev) => ({ ...prev, top: Number(event.target.value) }))
                  }
                />
              </label>
              <label>
                下裁剪（当前 {Math.round(previewSize.cropBottom)} px）
                <input
                  type="range"
                  min={0}
                  max={480}
                  step={10}
                  value={cropSettings.bottom}
                  onChange={(event) =>
                    setCropSettings((prev) => ({ ...prev, bottom: Number(event.target.value) }))
                  }
                />
              </label>
              <p className="hint">拖动滑块即可裁去上下多余留白，导出时同样生效。</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="app__footer">
        <p>
          所有操作均在浏览器本地完成，不会上传到服务器。推荐使用 Chrome / Edge / Safari 最新版以获得最佳体验。
        </p>
      </footer>
    </div>
  )
}

export default App
