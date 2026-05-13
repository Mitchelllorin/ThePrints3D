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

CubiCasa5k is an open dataset of ~5 000 annotated floor-plan images released
by Cubicasa under the
[Creative Commons Attribution 4.0 International licence][cc-by-4.0].

- **Paper**: *CubiCasa5K: A Dataset and an Improved Multi-Task Model for
  Floorplan Image Analysis* (Kalervo et al., 2019)
- **GitHub**: <https://github.com/CubiCasa/CubiCasa5k>

### Download

**Option A — git clone** (recommended, ~1.8 GB):

```bash
git clone --depth 1 https://github.com/CubiCasa/CubiCasa5k data/cubicasa5k
```

**Option B — Hugging Face Hub**:

```bash
pip install huggingface_hub
python - <<'EOF'
from huggingface_hub import snapshot_download
snapshot_download(
    'cubicasa/cubicasa5k',
    repo_type='dataset',
    local_dir='data/cubicasa5k',
)
EOF
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

[cc-by-4.0]: https://creativecommons.org/licenses/by/4.0/
