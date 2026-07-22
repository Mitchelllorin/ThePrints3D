# Floor-plan Wall Segmentation — Training Pipeline

This directory contains the offline training pipeline that produces the ONNX
model used by the in-browser AI wall detector
(`src/services/aiWallDetector.ts`).

## Architecture

**WallSegNet** (`model.py`) — a lightweight U-Net with 4 encoder/decoder
levels.  Default configuration (`--base-ch 16`) has ~1.5 M parameters and
exports to a **~6 MB** ONNX file, small enough for a browser asset.

| Setting | Value |
|---------|-------|
| Input  | `(1, 3, 256, 256)` float32, ImageNet-normalised |
| Output | `(1, 1, 256, 256)` float32, sigmoid wall probability |
| ONNX opset | 17 |

## Dataset — CubiCasa5k

> ### ⚠️ LICENCE BLOCKER — DO NOT SHIP A MODEL TRAINED ON THIS
>
> An earlier version of this file claimed CubiCasa5k is CC BY 4.0. **That is
> wrong.** The dataset's own LICENCE file
> (<https://github.com/CubiCasa/CubiCasa5k/blob/master/LICENSE>) and its Zenodo
> record (<https://zenodo.org/record/2613548>) both state
> **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)**.
>
> ThePrints3D is a commercial product (paid distribution, affiliate links).
> Training a shipped model on CC BY-NC data is a licence violation. Weights
> derived from the dataset inherit the NonCommercial restriction.
>
> Before using this pipeline for a shippable model, do ONE of:
> 1. Obtain a commercial licence from CubiCasa directly, or
> 2. Train on a permissively-licensed or self-generated corpus instead, or
> 3. Use it for **research/evaluation only** and never ship the weights.
>
> The training code below is licence-agnostic and works with any dataset in
> the expected layout — the blocker is the data, not the pipeline.

CubiCasa5k is an open dataset of ~5 000 annotated floor-plan images released
by Cubicasa under the
[Creative Commons Attribution-NonCommercial 4.0 International licence][cc-by-nc-4.0].

- **Paper**: *CubiCasa5K: A Dataset and an Improved Multi-Task Model for
  Floorplan Image Analysis* (Kalervo et al., 2019)
- **GitHub**: <https://github.com/CubiCasa/CubiCasa5k>

### Download

Subject to the licence blocker above.

The images are **not** in the GitHub repo — that holds only the loader code.
The actual data is one 5.5 GB zip on Zenodo:

```bash
# https://zenodo.org/record/2613548  —  cubicasa5k.zip, 5.5 GB
# md5 0ce0b203d1e3c125b51087b219bd23b9
curl -L -o data/cubicasa5k.zip 'https://zenodo.org/records/2613548/files/cubicasa5k.zip?download=1'
unzip data/cubicasa5k.zip -d data/cubicasa5k
```

The loader expects each floor plan in its own directory with:
- `F1_original.png` (or `F1_scaled.png` / `floorplan.png`)
- `model.svg` (or `floorplan.svg`) — the semantic annotation

## Setup

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r ops/train/requirements.txt
```

## Full training run

```bash
# 1. Train — ~30 epochs takes ≈ 1 h on a modern GPU, ≈ 6 h on CPU
python ops/train/train.py \
    --data  data/cubicasa5k \
    --out   checkpoints/ \
    --epochs 30 \
    --batch  16

# 2. Export best checkpoint → public/models/
python ops/train/export.py \
    --checkpoint checkpoints/best.pth

# 3. Build the app and test
npm run build
```

## Quick smoke-test (subset)

Use `--max-samples` to limit the dataset for a fast iteration:

```bash
python ops/train/train.py \
    --data data/cubicasa5k \
    --out  checkpoints/ \
    --epochs 5 \
    --batch  8 \
    --max-samples 200
```

## Improving accuracy

| Change | Effect |
|--------|--------|
| `--base-ch 32` | Doubles model capacity (~6 M params, ~22 MB ONNX) |
| `--epochs 50`  | Longer training; pair with cosine LR schedule (already default) |
| Add more data  | Mix in RPLAN, Rent3D, or proprietary floor plans |
| `--img-size 512` | Higher resolution input; increases memory usage 4× |

## CI workflow

A manual `workflow_dispatch` workflow is provided at
`.github/workflows/train-model.yml`.  It runs a 5-epoch smoke-test on a CPU
runner and uploads the resulting ONNX as a workflow artifact.

For a real training run, trigger it on a GPU-enabled self-hosted runner or
run locally and commit the resulting
`public/models/floorplan-wall-segmentation.onnx`.

---

[cc-by-nc-4.0]: https://creativecommons.org/licenses/by-nc/4.0/
