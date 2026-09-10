"""
CubiCasa5k dataset loader for wall segmentation training.

!! LICENCE BLOCKER - DO NOT SHIP A MODEL TRAINED ON THIS !!
-----------------------------------------------------------
CubiCasa5k is CC BY-**NC** 4.0 (NonCommercial). Its own LICENSE file and its
Zenodo record both say so:
    https://github.com/CubiCasa/CubiCasa5k/blob/master/LICENSE

An earlier version of THIS docstring claimed CC BY 4.0. That was wrong, and the
claim is repeated here only to kill it: the correction lived in README.md while
this file — the one you actually open to start a training run — went on saying
the permissive thing. Weights are a derivative work of the data they were fit
to, so training a SHIPPED model on this is a licence violation.

The detection engine is proprietary. Anything trained here must come from data
we are free to commercialise, which today means `synth.py` (our own copyright,
perfect ground truth, unlimited volume) or a corpus we hold a commercial
licence to. The loader below is licence-agnostic and works with either.

`data/test-prints/` is a separate matter and stays that way: those government
drawing sets are for MEASURING a model, never for training one.

Dataset source
--------------
CubiCasa5k is an open dataset of ~5,000 annotated floor-plan images released
by Cubicasa under the Creative Commons Attribution-NonCommercial 4.0
International licence.

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
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Callable, List, Optional, Tuple

import numpy as np
from PIL import Image, ImageDraw
from torch.utils.data import Dataset
import torchvision.transforms.functional as TF
import torch

sys.path.insert(0, str(Path(__file__).parent))
#: Junction channel order, shared with the generator that writes the labels.
#: Imported rather than restated so the two can never drift apart — a silent
#: disagreement here trains the head against arms pointing the wrong way.
from synth import ARM_N, ARM_E, ARM_S, ARM_W  # noqa: E402

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

        # Same arity as the synthetic loader so the training loop unpacks one
        # shape. CubiCasa carries no junction labels, so the weight is zero and
        # the junction head simply learns nothing from these samples — rather
        # than learning that floor plans have no corners.
        return (img_t, mask_t,
                torch.zeros(4, self.img_size, self.img_size), torch.zeros(()))


class SyntheticWallDataset(Dataset):
    """The corpus `synth.py` writes — and the only one whose weights we can ship.

    CubiCasa5k is CC BY-NC, so a model trained on it cannot go into a paid app
    (see ops/train/README.md). The synthetic generator exists to sidestep that:
    plans we produce ourselves, masks that are exact by construction rather than
    parsed out of an SVG, and as many as we care to render.

    Layout, as written by `synth.py --out <root>`::

        <root>/train/images/plan_000000.png
        <root>/train/masks/plan_000000.png
        <root>/val/...

    Image and mask share a filename — pairing is by name, not by ordering, so a
    missing or half-written file is caught here instead of silently training a
    picture against somebody else's mask.

    Augmentation and normalisation deliberately mirror `CubiCasa5kDataset`: the
    browser sends one tensor shape, normalised one way (see IMG_MEAN in
    src/services/aiWallDetector.ts), and the two datasets must not disagree
    about what that is.
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

        base = Path(root) / ('train' if split == 'all' else split)
        img_dir, mask_dir = base / 'images', base / 'masks'
        junc_dir = base / 'juncs'
        if not img_dir.is_dir() or not mask_dir.is_dir():
            raise FileNotFoundError(
                f'No synthetic split at {base!r}. Generate one first:\n'
                f'  python ops/train/synth.py --out {root} --count 3000 --augment'
            )

        # A corpus generated before the junction head existed has no juncs/. It
        # still trains the wall head; the junction loss is weighted out for
        # those samples rather than trained against zeros, which would actively
        # teach the model that floor plans have no corners.
        self.has_junctions = junc_dir.is_dir()

        self.pairs: List[Tuple[Path, Path, Optional[Path]]] = []
        for img_path in sorted(img_dir.glob('*.png')):
            mask_path = mask_dir / img_path.name
            if not mask_path.exists():
                continue
            junc_path = junc_dir / img_path.name if self.has_junctions else None
            if junc_path is not None and not junc_path.exists():
                junc_path = None
            self.pairs.append((img_path, mask_path, junc_path))

        if not self.pairs:
            raise FileNotFoundError(f'No image/mask pairs found under {base!r}.')

    def __len__(self) -> int:
        return len(self.pairs)

    def __getitem__(
        self, idx: int,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """Returns (image, wall mask, junction arms, junction weight).

        The weight is 1 where this sample carries junction labels and 0 where
        it does not, so a mixed or older corpus still trains the wall head.
        """
        img_path, mask_path, junc_path = self.pairs[idx]

        img = Image.open(img_path).convert('RGB')
        mask = Image.open(mask_path).convert('L')
        junc = Image.open(junc_path).convert('RGBA') if junc_path else None
        if img.size != (self.img_size, self.img_size):
            img = img.resize((self.img_size, self.img_size), Image.BILINEAR)
        if mask.size != (self.img_size, self.img_size):
            # NEAREST for the mask: a wall pixel must stay 0 or 255. Interpolating
            # it would invent half-walls along every edge and blur the very
            # boundary the model is being asked to find.
            mask = mask.resize((self.img_size, self.img_size), Image.NEAREST)
        if junc is not None and junc.size != (self.img_size, self.img_size):
            # BILINEAR here, unlike the mask: the junction map is a heatmap and
            # its falloff IS the label, so it must be resampled, not snapped.
            junc = junc.resize((self.img_size, self.img_size), Image.BILINEAR)

        # A FLIP RENAMES THE ARMS.
        #
        # The junction channels carry direction — north, east, south, west.
        # Mirroring the picture turns every east arm into a west one, so the
        # channels must be swapped to match. Get this wrong and the head trains
        # against labels pointing the wrong way: no error, no warning, just a
        # head that never converges and no obvious reason why.
        flip_h = self.augment and bool(torch.rand(1) < 0.5)
        flip_v = self.augment and bool(torch.rand(1) < 0.5)

        if self.augment:
            if flip_h:
                img = TF.hflip(img)
                mask = TF.hflip(mask)
                if junc is not None:
                    junc = TF.hflip(junc)
            if flip_v:
                img = TF.vflip(img)
                mask = TF.vflip(mask)
                if junc is not None:
                    junc = TF.vflip(junc)
            angle = float(torch.randint(-10, 11, (1,)))
            img = TF.rotate(img, angle)
            mask = TF.rotate(mask, angle)
            if junc is not None:
                junc = TF.rotate(junc, angle)
            img = TF.adjust_brightness(img, 1.0 + float(torch.empty(1).uniform_(-0.3, 0.3)))
            img = TF.adjust_contrast(img, 1.0 + float(torch.empty(1).uniform_(-0.2, 0.2)))

        img_t: torch.Tensor = TF.to_tensor(img)
        img_t = TF.normalize(img_t, _IMG_MEAN, _IMG_STD)
        mask_t = (TF.to_tensor(mask) > 0.5).float()

        if junc is not None:
            junc_t = TF.to_tensor(junc)  # (4, H, W) in [0, 1] — N, E, S, W
            if flip_h:
                junc_t = junc_t[[ARM_N, ARM_W, ARM_S, ARM_E]]
            if flip_v:
                junc_t = junc_t[[ARM_S, ARM_E, ARM_N, ARM_W]]
            junc_w = torch.ones(())
        else:
            junc_t = torch.zeros(4, self.img_size, self.img_size)
            junc_w = torch.zeros(())

        if self.transform:
            img_t = self.transform(img_t)

        return img_t, mask_t, junc_t, junc_w


def build_dataset(
    root: str,
    img_size: int = 256,
    split: str = 'train',
    augment: bool = True,
) -> Dataset:
    """Pick the loader that matches what is actually on disk.

    A synthetic corpus has `<root>/train/images`; CubiCasa has `<id>/model.svg`
    scattered through it. Sniffing the layout means the same train command works
    for either, and nobody has to remember a flag to stay on the shippable side
    of the licence line.
    """
    if (Path(root) / 'train' / 'images').is_dir():
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
