// The shell side of Efficient Browser Use, with no imports, so shrink-check/ can run it under node.
//
// Image tool, picked per machine:
// - macOS: `sips`, built in.
// - anywhere else: python3 with Pillow (`pip install pillow`, or the distro's python3-pil).
// EBU_IMAGE_TOOL=sips|pil|none forces one (the check uses it for the "no tool" case).

// Python half of the Pillow backend. dims FILE -> "W H". fit MAX FMT QUALITY IN OUT: longest side
// at most MAX, aspect kept; FMT empty keeps PNG and JPEG as they came and turns the rest into PNG.
const PIL = `import sys
from PIL import Image
a = sys.argv[1:]
if a[0] == "dims":
    with Image.open(a[1]) as im:
        print(im.size[0], im.size[1])
    sys.exit(0)
mx, fmt, q, src, dst = int(a[1]), a[2].lower(), a[3], a[4], a[5]
with Image.open(src) as im:
    im.load()
    t = {"jpeg": "JPEG", "jpg": "JPEG", "png": "PNG"}.get(fmt) or (im.format if im.format in ("PNG", "JPEG") else "PNG")
    im.thumbnail((mx, mx), Image.LANCZOS)
    if t == "JPEG" and im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    opts = {"quality": int(q)} if t == "JPEG" and q else {}
    im.save(dst, t, **opts)`

// Defines dims FILE and fit MAX FMT QUALITY IN OUT for whichever tool this machine has.
const TOOL = `tool="\${EBU_IMAGE_TOOL:-}"
if [ -z "$tool" ]; then
  if [ "$(uname)" = Darwin ] && command -v sips >/dev/null 2>&1; then tool=sips
  elif command -v python3 >/dev/null 2>&1 && python3 -c 'import PIL' 2>/dev/null; then tool=pil
  else tool=none; fi
fi
PIL='${PIL.replace(/'/g, `'"'"'`)}'
case "$tool" in
  sips)
    dims() { sips -g pixelWidth -g pixelHeight "$1" | awk '/pixelWidth/{w=$2} /pixelHeight/{h=$2} END{print w, h}'; }
    fit() { sips -Z "$1" \${2:+-s format "$2"} \${3:+-s formatOptions "$3"} "$4" --out "$5" >/dev/null; } ;;
  pil)
    dims() { python3 -c "$PIL" dims "$1"; }
    fit() { python3 -c "$PIL" fit "$1" "$2" "$3" "$4" "$5"; } ;;
  *)
    echo "no image tool: needs sips (macOS) or python3 with Pillow (pip install pillow)" >&2; exit 3 ;;
esac`

/**
 * Decodes stdin, reads the size, shrinks to scale (never under min on the long side), prints
 * "IN w h", then "SKIP" or "OUT w h" and the new bytes in base64.
 * Args: in out scale min fmt (fmt empty keeps PNG/JPEG as they came).
 */
export const SHRINK = `set -e
in="$1"; out="$2"; scale="$3"; min="$4"; fmt="$5"
${TOOL}
mkdir -p "$(dirname "$in")"
trap 'rm -f "$in" "$out"' EXIT
base64 --decode > "$in"
set -- $(dims "$in")
w=$1; h=$2; long=$w
if [ "$h" -gt "$w" ]; then long=$h; fi
target=$(awk -v l="$long" -v s="$scale" -v m="$min" 'BEGIN{t=int(l*s+0.5); if (t<m) t=m; print t}')
echo "IN $w $h"
if [ "$target" -ge "$long" ]; then echo SKIP; exit 0; fi
fit "$target" "$fmt" "" "$in" "$out"
set -- $(dims "$out")
echo "OUT $1 $2"
base64 < "$out"`

/** A 160 px JPEG (quality 60) of stdin, printed in base64. Args: in out. */
export const THUMB = `set -e
in="$1"; out="$2"
${TOOL}
mkdir -p "$(dirname "$in")"
trap 'rm -f "$in" "$out"' EXIT
base64 --decode > "$in"
fit 160 jpeg 60 "$in" "$out"
base64 < "$out"`

/** The picture's real type from its first bytes; the declared one only when the bytes say nothing. */
export function sniff(base64: string, mime: string): string {
  if (base64.startsWith('iVBOR')) return 'image/png'
  if (base64.startsWith('/9j/')) return 'image/jpeg'
  if (base64.startsWith('R0lGOD')) return 'image/gif'
  if (base64.startsWith('UklGR')) return 'image/webp'
  return mime || 'image/png'
}

/** What SHRINK is given for a picture of this type: output extension and forced format. */
export function shrinkPlan(kind: string): { ext: string; fmt: string; mime: string } {
  if (kind === 'image/jpeg') return { ext: 'jpg', fmt: '', mime: kind }
  if (kind === 'image/png') return { ext: 'png', fmt: '', mime: kind }
  // GIF, WebP and the rest come back as PNG.
  return { ext: 'png', fmt: 'png', mime: 'image/png' }
}

export type Shrunk = { w: number; h: number; nw?: number; nh?: number; base64?: string }

/** Reads SHRINK's stdout. Throws on anything it did not print itself. */
export function parseShrink(stdout: string): Shrunk {
  const lines = stdout.split('\n')
  const head = /^IN (\d+) (\d+)$/.exec(lines[0] ?? '')
  if (!head) throw new Error(`no size from the image tool: ${stdout.slice(0, 80)}`)
  const w = Number(head[1])
  const h = Number(head[2])
  if (lines[1] === 'SKIP') return { w, h }
  const out = /^OUT (\d+) (\d+)$/.exec(lines[1] ?? '')
  if (!out) throw new Error(`no new size from the image tool: ${String(lines[1]).slice(0, 80)}`)
  const base64 = lines.slice(2).join('').replace(/\s+/g, '')
  if (!base64) throw new Error('the image tool printed no picture')
  return { w, h, nw: Number(out[1]), nh: Number(out[2]), base64 }
}
