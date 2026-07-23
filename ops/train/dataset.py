"""
CubiCasa5k dataset loader for wall segmentation training.

Dataset source
--------------
CubiCasa5k is an open dataset of ~5,000 annotated floor-plan images released
by Cubicasa under the Creative Commons Attribution 4.0 International licence.

  Paper : "CubiCasa5K: A Dataset and an Improved Multi-Task Model for
           Floorplan Image Analysis" (Kalervo et al., 2019)
  Repo  : https://github.com/CubiCasa/CubiCasa5k
  HF    : https://huggingface.co/datasets/cubicasa/cubicasa5k

Download
--------
  git clone https://github.com/CubiCasa/CubiCasa5k data/cubicasa5k
  # — or —
  python -c "from huggingface_hub import snapshot_download; \\
             snapshot_download('cubicasa/cubicasa5k', repo_type='dataset', \\
             local_dir='data/cubicasa5k')"

Dataset directory layout expected
----------------------------------
  data/cubicasa5k/
    high_quality/
      <id>/
        F1_original.png   # floor-plan raster image
        model.svg         # semantic SVG annotation
    colorful/
      <id>/
        F1_original.png
        model.svg

Wall mask extraction
--------------------
The SVG contains a <g> element whose id or class attribute contains the word
"Wall" (case-insensitive). We render all child <polygon> and <path> elements
of that group as white-on-black, then threshold to a binary mask.

If cairosvg is unavailable the loader falls back to a pure-lxml polygon
renderer using Pillow ImageDraw.
"""

import os
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Callable, List, Optional, Tuple

import numpy as np
from PIL import Image, ImageDraw
from torch.utils.data import Dataset
import torchvision.transforms.functional as TF
import torch

# ── SVG namespaces ────────────────────────────────────────────────────────────

_SVG_NS = 'http://www.w3.org/2000/svg'
_XLINK_NS = 'http://www.w3.org/1999/xlink'


def _strip_ns(tag: str) -> str:
    """Remove the XML namespace prefix from a tag name."""
    m = re.match(r'\{[^}]+\}(.+)', tag)
    return m.group(1) if m else tag


# ── SVG → wall mask ───────────────────────────────────────────────────────────

def _parse_viewbox(root: ET.Element) -> Optional[Tuple[float, float, float, float]]:
    vb = root.get('viewBox') or root.get('viewbox')
    if vb:
        parts = re.split(r'[\s,]+', vb.strip())
        if len(parts) == 4:
            try:
                return tuple(float(p) for p in parts)  # type: ignore[return-value]
            except ValueError:
                pass
    # Fall back to width/height
    w = root.get('width', '').replace('px', '').strip()
    h = root.get('height', '').replace('px', '').strip()
    try:
        return 0.0, 0.0, float(w), float(h)
    except ValueError:
        return None


def _points_from_polygon(elem: ET.Element) -> Optional[List[Tuple[float, float]]]:
    pts_str = elem.get('points', '')
    nums = re.findall(r'-?[\d.]+(?:e[+-]?\d+)?', pts_str)
    if len(nums) < 4:
        return None
    coords = [float(n) for n in nums]
    return [(coords[i], coords[i + 1]) for i in range(0, len(coords) - 1, 2)]


def _path_d_to_points(d: str) -> Optional[List[Tuple[float, float]]]:
    """Very small subset of SVG path 'd': M/L/Z moveto/lineto commands only."""
    pts: List[Tuple[float, float]] = []
    # normalise
    d = re.sub(r',', ' ', d)
    tokens = re.split(r'(?=[MmLlZz])', d.strip())
    cx, cy = 0.0, 0.0
    for tok in tokens:
        tok = tok.strip()
        if not tok:
            continue
        cmd, rest = tok[0], tok[1:].strip()
        nums = re.findall(r'-?[\d.]+(?:e[+-]?\d+)?', rest)
        pairs = [(float(nums[i]), float(nums[i + 1])) for i in range(0, len(nums) - 1, 2)]
        if cmd == 'M' and pairs:
            cx, cy = pairs[0]
            pts.append((cx, cy))
            for px, py in pairs[1:]:
                pts.append((px, py))
                cx, cy = px, py
        elif cmd == 'm' and pairs:
            cx, cy = cx + pairs[0][0], cy + pairs[0][1]
            pts.append((cx, cy))
            for px, py in pairs[1:]:
                cx, cy = cx + px, cy + py
                pts.append((cx, cy))
        elif cmd == 'L':
            for px, py in pairs:
                pts.append((px, py))
                cx, cy = px, py
        elif cmd == 'l':
            for px, py in pairs:
                cx, cy = cx + px, cy + py
                pts.append((cx, cy))
        elif cmd in ('Z', 'z'):
            pass
    return pts if len(pts) >= 3 else None


def _is_wall_group(elem: ET.Element) -> bool:
    tag_lower = _strip_ns(elem.tag).lower()
    elem_id = (elem.get('id') or '').lower()
    elem_class = (elem.get('class') or '').lower()
    return (
        tag_lower == 'g'
        and ('wall' in elem_id or 'wall' in elem_class)
    )


def _collect_wall_groups(root: ET.Element) -> List[ET.Element]:
    """BFS for all <g> elements whose id/class mentions 'wall'."""
    found: List[ET.Element] = []
    queue = list(root)
    while queue:
        elem = queue.pop(0)
        if _is_wall_group(elem):
            found.append(elem)
        queue.extend(list(elem))
    return found


def svg_to_wall_mask(svg_path: str, out_size: int = 256) -> np.ndarray:
    """Parse *svg_path* and return a uint8 binary mask (0 or 255) at *out_size*×*out_size*.

    Returns an all-zero mask if wall geometry cannot be extracted.
    """
    try:
        tree = ET.parse(svg_path)
        root = tree.getroot()
    except Exception:
        return np.zeros((out_size, out_size), dtype=np.uint8)

    vb = _parse_viewbox(root)
    if vb is None:
        return np.zeros((out_size, out_size), dtype=np.uint8)

    vb_x, vb_y, vb_w, vb_h = vb
    if vb_w <= 0 or vb_h <= 0:
        return np.zeros((out_size, out_size), dtype=np.uint8)

    scale_x = out_size / vb_w
    scale_y = out_size / vb_h

    wall_groups = _collect_wall_groups(root)
    mask = Image.new('L', (out_size, out_size), 0)
    draw = ImageDraw.Draw(mask)

    for group in wall_groups:
        for child in group.iter():
            tag = _strip_ns(child.tag).lower()
            pts: Optional[List[Tuple[float, float]]] = None
            if tag == 'polygon':
                pts = _points_from_polygon(child)
            elif tag == 'path':
                d = child.get('d', '')
                if d:
                    pts = _path_d_to_points(d)
            if pts and len(pts) >= 3:
                scaled = [
                    ((x - vb_x) * scale_x, (y - vb_y) * scale_y)
                    for x, y in pts
                ]
                draw.polygon(scaled, fill=255)

    return np.array(mask, dtype=np.uint8)


# ── Dataset ───────────────────────────────────────────────────────────────────

_IMG_NAMES = ('F1_original.png', 'F1_scaled.png', 'floorplan.png')
_SVG_NAMES = ('model.svg', 'floorplan.svg')

_IMG_MEAN = (0.485, 0.456, 0.406)
_IMG_STD = (0.229, 0.224, 0.225)


def _find_pairs(root: Path) -> List[Tuple[Path, Path]]:
    """Walk *root* and collect (image, svg) pairs."""
    pairs: List[Tuple[Path, Path]] = []
    for dirpath, _, filenames in os.walk(root):
        dp = Path(dirpath)
        svg: Optional[Path] = None
        img: Optional[Path] = None
        for name in filenames:
            if name.lower() in [n.lower() for n in _SVG_NAMES]:
                svg = dp / name
            if name.lower() in [n.lower() for n in _IMG_NAMES]:
                img = dp / name
        if img and svg:
            pairs.append((img, svg))
    return sorted(pairs)


class CubiCasa5kDataset(Dataset):
    """PyTorch Dataset for CubiCasa5k floor-plan wall segmentation.

    Parameters
    ----------
    root :
        Path to the cloned ``cubicasa5k`` directory (or any directory with
        subdirectories following the ``<id>/F1_original.png`` + ``model.svg``
        layout).
    img_size :
        Square size to resize images and masks (default 256).
    split :
        ``'train'``, ``'val'``, or ``'all'``.  Train uses the first 80 % of
        found pairs, val uses the remaining 20 %.
    augment :
        Whether to apply random flips / rotations / colour jitter (only for
        training).
    transform :
        Optional additional image transform applied *after* normalisation.
    """

    def __init__(
        self,
        root: str,
        img_size: int = 256,
        split: str = 'train',
        augment: bool = True,
        transform: Optional[Callable] = None,
    ) -> None:
        super().__init__()
        self.img_size = img_size
        self.augment = augment and split == 'train'
        self.transform = transform

        all_pairs = _find_pairs(Path(root))
        if not all_pairs:
            raise FileNotFoundError(
                f'No floor-plan image+SVG pairs found under {root!r}. '
                'Check the README for download instructions.'
            )

        n_train = int(len(all_pairs) * 0.8)
        if split == 'train':
            self.pairs = all_pairs[:n_train]
        elif split == 'val':
            self.pairs = all_pairs[n_train:]
        else:
            self.pairs = all_pairs

    def __len__(self) -> int:
        return len(self.pairs)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        img_path, svg_path = self.pairs[idx]

        # ── Image ──
        img = Image.open(img_path).convert('RGB').resize(
            (self.img_size, self.img_size), Image.BILINEAR
        )

        # ── Mask ──
        mask_np = svg_to_wall_mask(str(svg_path), self.img_size)
        mask = Image.fromarray(mask_np)

        # ── Augmentation (only train) ──
        if self.augment:
            if torch.rand(1) < 0.5:
                img = TF.hflip(img)
                mask = TF.hflip(mask)
            if torch.rand(1) < 0.5:
                img = TF.vflip(img)
                mask = TF.vflip(mask)
            angle = float(torch.randint(-10, 11, (1,)))
            img = TF.rotate(img, angle)
            mask = TF.rotate(mask, angle)
            # Colour jitter on image only
            img = TF.adjust_brightness(img, 1.0 + float(torch.empty(1).uniform_(-0.3, 0.3)))
            img = TF.adjust_contrast(img, 1.0 + float(torch.empty(1).uniform_(-0.2, 0.2)))

        # ── To tensor ──
        img_t: torch.Tensor = TF.to_tensor(img)  # (3, H, W) in [0,1]
        img_t = TF.normalize(img_t, _IMG_MEAN, _IMG_STD)
        mask_t = TF.to_tensor(mask)  # (1, H, W) in {0, 1}

        if self.transform:
            img_t = self.transform(img_t)

        return img_t, mask_t


class SyntheticWallDataset(Dataset):
    """PyTorch Dataset for the procedurally generated corpus from ``synth.py``.

    Why a second loader
    -------------------
    ``CubiCasa5kDataset`` pairs a raster with an *SVG annotation* and derives
    the mask by parsing the SVG.  The synthetic generator already knows the
    exact wall pixels, so it writes a PNG mask directly — round-tripping that
    through SVG would only lose precision.  This loader therefore reads
    image/mask PNG pairs instead.  Everything downstream (tensor shapes,
    normalisation, augmentation semantics) is identical to
    ``CubiCasa5kDataset`` so ``train.py`` can use either.

    Expected layout (produced by ``python ops/train/synth.py --out <root>``)::

        <root>/
          train/images/plan_000000.png
          train/masks/plan_000000.png
          val/images/...
          val/masks/...

    If ``<root>`` has no ``train``/``val`` subdirectories, a flat
    ``images/``+``masks/`` layout is accepted and split 80/20.
    """

    def __init__(
        self,
        root: str,
        img_size: int = 256,
        split: str = 'train',
        augment: bool = True,
        transform: Optional[Callable] = None,
    ) -> None:
        super().__init__()
        self.img_size = img_size
        self.augment = augment and split == 'train'
        self.transform = transform

        root_p = Path(root)
        pairs: List[Tuple[Path, Path]] = []

        def collect(img_dir: Path, mask_dir: Path) -> List[Tuple[Path, Path]]:
            out: List[Tuple[Path, Path]] = []
            if not img_dir.is_dir() or not mask_dir.is_dir():
                return out
            for img_p in sorted(img_dir.iterdir()):
                if img_p.suffix.lower() not in ('.png', '.jpg', '.jpeg'):
                    continue
                mask_p = mask_dir / img_p.name
                if not mask_p.exists():
                    stem_hits = list(mask_dir.glob(img_p.stem + '.*'))
                    if not stem_hits:
                        continue
                    mask_p = stem_hits[0]
                out.append((img_p, mask_p))
            return out

        if (root_p / 'train').is_dir() or (root_p / 'val').is_dir():
            sub = 'train' if split in ('train', 'all') else 'val'
            if split == 'all':
                pairs = (collect(root_p / 'train' / 'images', root_p / 'train' / 'masks')
                         + collect(root_p / 'val' / 'images', root_p / 'val' / 'masks'))
            else:
                pairs = collect(root_p / sub / 'images', root_p / sub / 'masks')
        else:
            all_pairs = collect(root_p / 'images', root_p / 'masks')
            n_train = int(len(all_pairs) * 0.8)
            if split == 'train':
                pairs = all_pairs[:n_train]
            elif split == 'val':
                pairs = all_pairs[n_train:]
            else:
                pairs = all_pairs

        if not pairs:
            raise FileNotFoundError(
                f'No synthetic image/mask pairs found under {root!r} for split '
                f'{split!r}. Generate some with:\n'
                f'  python ops/train/synth.py --out {root} --count 2000 --augment'
            )
        self.pairs = pairs

    def __len__(self) -> int:
        return len(self.pairs)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        img_path, mask_path = self.pairs[idx]

        img = Image.open(img_path).convert('RGB')
        mask = Image.open(mask_path).convert('L')
        if img.size != (self.img_size, self.img_size):
            img = img.resize((self.img_size, self.img_size), Image.BILINEAR)
        if mask.size != (self.img_size, self.img_size):
            mask = mask.resize((self.img_size, self.img_size), Image.NEAREST)

        if self.augment:
            if torch.rand(1) < 0.5:
                img = TF.hflip(img)
                mask = TF.hflip(mask)
            if torch.rand(1) < 0.5:
                img = TF.vflip(img)
                mask = TF.vflip(mask)
            if torch.rand(1) < 0.5:
                k = int(torch.randint(1, 4, (1,)))
                img = img.rotate(90 * k, expand=False)
                mask = mask.rotate(90 * k, expand=False)
            img = TF.adjust_brightness(img, 1.0 + float(torch.empty(1).uniform_(-0.3, 0.3)))
            img = TF.adjust_contrast(img, 1.0 + float(torch.empty(1).uniform_(-0.2, 0.2)))

        img_t: torch.Tensor = TF.to_tensor(img)
        img_t = TF.normalize(img_t, _IMG_MEAN, _IMG_STD)
        mask_t = (TF.to_tensor(mask) > 0.5).float()

        if self.transform:
            img_t = self.transform(img_t)

        return img_t, mask_t


def build_dataset(
    root: str,
    img_size: int = 256,
    split: str = 'train',
    augment: bool = True,
    kind: str = 'auto',
) -> Dataset:
    """Pick the right loader for *root*.

    ``kind`` is ``'auto'`` (detect), ``'synthetic'`` or ``'cubicasa'``.
    Auto-detection looks for the synthetic ``images/``+``masks/`` layout first.
    """
    root_p = Path(root)
    if kind == 'auto':
        looks_synth = any(
            (root_p / sub / 'images').is_dir()
            for sub in ('train', 'val', '.')
        )
        kind = 'synthetic' if looks_synth else 'cubicasa'
    if kind == 'synthetic':
        return SyntheticWallDataset(root, img_size=img_size, split=split, augment=augment)
    return CubiCasa5kDataset(root, img_size=img_size, split=split, augment=augment)


if __name__ == '__main__':
    import sys

    root = sys.argv[1] if len(sys.argv) > 1 else 'data/cubicasa5k'
    ds = build_dataset(root, split='train')
    print(f'Train samples : {len(ds)}')
    img, mask = ds[0]
    print(f'Image shape   : {img.shape}  dtype={img.dtype}')
    print(f'Mask  shape   : {mask.shape} dtype={mask.dtype}  '
          f'pos_ratio={mask.mean():.3f}')
