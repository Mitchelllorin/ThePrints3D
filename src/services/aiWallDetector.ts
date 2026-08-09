import { detectWalls, type DetectWallsResult } from './wallDetector'

const MODEL_URL = '/models/floorplan-wall-segmentation.onnx'
const MODEL_INPUT_SIZE = 256
const AI_THRESHOLD = 0.5

/**
 * ImageNet mean/std — the SAME values `ops/train/dataset.py` normalises with.
 *
 * These must match the training pipeline exactly or the model sees inputs on a
 * different scale than it was fitted to and returns noise. This file used to
 * feed raw 0–1 and would have done precisely that the first time a real model
 * was dropped in — a silent failure, since a plausible-looking garbage mask
 * just yields bad walls rather than an error.
 *
 * If you change these, change `_IMG_MEAN`/`_IMG_STD` in dataset.py in the same
 * commit and retrain.
 */
const IMG_MEAN = [0.485, 0.456, 0.406]
const IMG_STD = [0.229, 0.224, 0.225]

let _supported: boolean | null = null
let _sessionPromise: Promise<import('onnxruntime-web').InferenceSession> | null = null

/**
 * ONE INFERENCE AT A TIME. An onnxruntime-web session is not re-entrant: a
 * second `run()` while the first is in flight throws "Session already started",
 * and both callers then fall back to the classical detector.
 *
 * That is not a hypothetical. Dropping several files at once processes them in
 * a loop, so two sheets in the same second is the normal case, not the edge
 * one. Each run waits its turn on this chain instead. The tail is swallowed so
 * one failed inference cannot poison every run that queues behind it.
 */
let _runQueue: Promise<unknown> = Promise.resolve()

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = _runQueue.then(work, work)
  _runQueue = result.catch(() => undefined)
  return result
}

function pickProviders() {
  const providers: Array<'webgpu' | 'wasm'> = ['wasm']
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) providers.unshift('webgpu')
  return providers
}

async function modelExists(): Promise<boolean> {
  if (_supported !== null) return _supported
  try {
    const res = await fetch(MODEL_URL, { method: 'HEAD' })
    _supported = res.ok
  } catch {
    _supported = false
  }
  return _supported
}

async function getSession() {
  if (_sessionPromise) return _sessionPromise
  _sessionPromise = (async () => {
    const ort = await import('onnxruntime-web')
    return ort.InferenceSession.create(MODEL_URL, {
      executionProviders: pickProviders(),
      graphOptimizationLevel: 'all',
    })
  })()
  return _sessionPromise
}

function resizeToModelInput(
  imageData: ImageData,
  targetSize: number,
): { tensorData: Float32Array; width: number; height: number } {
  const canvas = document.createElement('canvas')
  canvas.width = targetSize
  canvas.height = targetSize
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not create canvas context for AI preprocessing')
  const src = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = imageData.width
  srcCanvas.height = imageData.height
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })
  if (!srcCtx) throw new Error('Could not create source canvas for AI preprocessing')
  srcCtx.putImageData(src, 0, 0)
  ctx.drawImage(srcCanvas, 0, 0, targetSize, targetSize)
  const resized = ctx.getImageData(0, 0, targetSize, targetSize).data

  const data = new Float32Array(1 * 3 * targetSize * targetSize)
  for (let y = 0; y < targetSize; y++) {
    for (let x = 0; x < targetSize; x++) {
      const idx = y * targetSize + x
      const rgbaIdx = idx * 4
      // NCHW, and normalised the way the model was TRAINED — see IMG_MEAN.
      const plane = targetSize * targetSize
      data[idx] = (resized[rgbaIdx] / 255 - IMG_MEAN[0]) / IMG_STD[0]
      data[plane + idx] = (resized[rgbaIdx + 1] / 255 - IMG_MEAN[1]) / IMG_STD[1]
      data[2 * plane + idx] = (resized[rgbaIdx + 2] / 255 - IMG_MEAN[2]) / IMG_STD[2]
    }
  }
  return { tensorData: data, width: targetSize, height: targetSize }
}

function maskToImageData(
  mask: Float32Array,
  maskW: number,
  maskH: number,
  outW: number,
  outH: number,
): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = maskW
  canvas.height = maskH
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not create canvas context for AI postprocessing')
  const data = new Uint8ClampedArray(maskW * maskH * 4)
  for (let i = 0; i < maskW * maskH; i++) {
    const wall = mask[i] >= AI_THRESHOLD
    const px = wall ? 0 : 255
    data[i * 4] = px
    data[i * 4 + 1] = px
    data[i * 4 + 2] = px
    data[i * 4 + 3] = 255
  }
  ctx.putImageData(new ImageData(data, maskW, maskH), 0, 0)

  const scaledCanvas = document.createElement('canvas')
  scaledCanvas.width = outW
  scaledCanvas.height = outH
  const scaledCtx = scaledCanvas.getContext('2d', { willReadFrequently: true })
  if (!scaledCtx) throw new Error('Could not create scaled canvas for AI postprocessing')
  scaledCtx.drawImage(canvas, 0, 0, outW, outH)
  return scaledCtx.getImageData(0, 0, outW, outH)
}

function readMaskTensor(tensor: { data: Float32Array; dims: readonly number[] }): Float32Array {
  const size = tensor.dims.reduce((a, b) => a * b, 1)
  if (size === 0) return new Float32Array()
  // Support [1,1,H,W], [1,H,W], or [H,W]
  if (tensor.dims.length === 4) return tensor.data.subarray(0, tensor.dims[2] * tensor.dims[3])
  if (tensor.dims.length === 3) return tensor.data.subarray(0, tensor.dims[1] * tensor.dims[2])
  return tensor.data
}

/**
 * Returns true if the trained ONNX wall-segmentation model is present at the
 * expected URL.  The result is cached after the first network check.
 *
 * The model is built by the pipeline in `ops/train/` and placed at
 * `public/models/floorplan-wall-segmentation.onnx`.  When the model is
 * absent the detector falls back to the heuristic edge-based wall finder.
 */
export async function isAIModelAvailable(): Promise<boolean> {
  return modelExists()
}

export async function detectWallsWithAI(
  imageData: ImageData,
): Promise<DetectWallsResult | null> {
  if (!(await modelExists())) return null
  try {
    const ort = await import('onnxruntime-web')
    const { tensorData, width, height } = resizeToModelInput(imageData, MODEL_INPUT_SIZE)
    const session = await getSession()
    const inputName = session.inputNames[0]
    const outputName = session.outputNames[0]
    const input = new ort.Tensor('float32', tensorData, [1, 3, height, width])
    const output = await serialize(() => session.run({ [inputName]: input }, [outputName]))
    const tensor = output[outputName]
    const mask = readMaskTensor({
      data: tensor.data as Float32Array,
      dims: tensor.dims,
    })
    const maskImage = maskToImageData(mask, width, height, imageData.width, imageData.height)
    const aiResult = detectWalls(maskImage, {
      edgeThreshold: 8,
      minWallLengthPx: 36,
      minWallThicknessPx: 2,
      maxWallThicknessPx: 80,
      requirePairedEdges: false,
      mergeGapPx: 6,
    })
    aiResult.walls = aiResult.walls.map((w) => ({
      ...w,
      source: 'auto' as const,
      detectionConfidence: Math.max(w.detectionConfidence ?? 0.75, 0.75),
    }))
    return aiResult
  } catch (err) {
    // SAY SOMETHING. Returning null falls back to the classical detector, which
    // is the right behaviour — but silently, so a broken model, a missing WASM
    // file or a shape mismatch all present as "the AI made no difference" with
    // nothing anywhere to explain why. The fallback stays; the silence goes.
    console.error('[ThePrints3D] AI wall detection failed, falling back to the classical detector:', err)
    return null
  }
}
