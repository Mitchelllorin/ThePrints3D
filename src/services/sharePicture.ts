/**
 * SHARE THE PICTURE — one tap from the model to a text message.
 *
 * Mitchell, 25 Oct 2026: on a real job he drew an angled wall layout, framed
 * it, screenshotted the app and texted it to his boss. It worked, and the
 * screenshot was the workaround. The old "Share PNG" sat in Settings and only
 * downloaded a file — which on a phone means finding it again, and inside the
 * Android app does nothing at all, because a WebView ignores <a download>.
 *
 * So this hands the picture to the phone's own share sheet: Messages,
 * WhatsApp, email, whatever they use. The Android app goes through the native
 * Share plugin (the file is written to the cache first; the sheet needs a
 * path). A browser uses the Web Share API with the file. Anything that can do
 * neither — a desktop browser, mostly — falls back to the download.
 *
 * Free pictures carry the corner mark, Pro pictures do not. See watermark.ts
 * for why the mark is small: a shared picture is how other trades find the app.
 */
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { watermarkedPng } from './watermark'

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed'

const TITLE = 'ThePrints3D'

/** The 3D view. The workspace has one WebGL canvas; the plan editor is SVG. */
function modelCanvas(): HTMLCanvasElement | null {
  return document.querySelector('canvas')
}

/** A share sheet closed without picking anything is not an error. */
function isCancel(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e)
  return /abort|cancel/i.test(msg)
}

export async function sharePicture(isPro: boolean): Promise<ShareOutcome> {
  const canvas = modelCanvas()
  if (!canvas) return 'failed'

  let dataUrl: string
  try {
    dataUrl = isPro ? canvas.toDataURL('image/png') : watermarkedPng(canvas)
  } catch (e) {
    console.error('Share: could not read the view', e)
    return 'failed'
  }
  const fileName = `theprints3d-${Date.now()}.png`

  if (Capacitor.isNativePlatform()) {
    try {
      const { uri } = await Filesystem.writeFile({
        path: fileName,
        data: dataUrl.slice(dataUrl.indexOf(',') + 1),
        directory: Directory.Cache,
      })
      await Share.share({ title: TITLE, files: [uri] })
      return 'shared'
    } catch (e) {
      if (isCancel(e)) return 'cancelled'
      console.error('Share: native share failed', e)
      return 'failed'
    }
  }

  try {
    const blob = await (await fetch(dataUrl)).blob()
    const file = new File([blob], fileName, { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: TITLE })
      return 'shared'
    }
  } catch (e) {
    if (isCancel(e)) return 'cancelled'
    console.error('Share: web share failed, downloading instead', e)
  }

  const a = document.createElement('a')
  a.href = dataUrl
  a.download = fileName
  a.click()
  return 'downloaded'
}
