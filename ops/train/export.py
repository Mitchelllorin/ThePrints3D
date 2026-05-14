"""
Export a trained WallSegNet checkpoint to ONNX and place it at
``public/models/floorplan-wall-segmentation.onnx``.

Usage
-----
  python ops/train/export.py \\
      --checkpoint checkpoints/best.pth \\
      [--out public/models/floorplan-wall-segmentation.onnx] \\
      [--opset 17] \\
      [--base-ch 16] \\
      [--img-size 256]

After export the script runs a quick ONNX Runtime sanity-check to confirm
that the model loads and produces output with the correct shape.
"""

import argparse
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).parent))
from model import build_model


def export(
    checkpoint: str,
    out_path: str,
    opset: int,
    base_ch: int,
    img_size: int,
) -> None:
    device = torch.device('cpu')

    model = build_model(base_ch).to(device)

    ckpt = torch.load(checkpoint, map_location=device)
    # Support both plain state-dict and training checkpoint dicts
    if isinstance(ckpt, dict) and 'model' in ckpt:
        model.load_state_dict(ckpt['model'])
        base_ch = ckpt.get('base_ch', base_ch)
        img_size = ckpt.get('img_size', img_size)
    else:
        model.load_state_dict(ckpt)

    model.eval()

    dummy = torch.zeros(1, 3, img_size, img_size, device=device)

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)

    torch.onnx.export(
        model,
        dummy,
        out_path,
        opset_version=opset,
        input_names=['input'],
        output_names=['output'],
        dynamic_axes={
            'input': {0: 'batch', 2: 'height', 3: 'width'},
            'output': {0: 'batch', 2: 'height', 3: 'width'},
        },
        do_constant_folding=True,
    )
    print(f'Exported ONNX model → {out_path}')
    size_mb = Path(out_path).stat().st_size / 1024 / 1024
    print(f'File size: {size_mb:.2f} MB')

    # ── Sanity check with ONNX Runtime ──
    try:
        import onnxruntime as ort
        import numpy as np

        sess = ort.InferenceSession(out_path, providers=['CPUExecutionProvider'])
        inp_name = sess.get_inputs()[0].name
        out_name = sess.get_outputs()[0].name
        dummy_np = np.zeros((1, 3, img_size, img_size), dtype=np.float32)
        result = sess.run([out_name], {inp_name: dummy_np})
        out_shape = result[0].shape
        assert out_shape == (1, 1, img_size, img_size), \
            f'Unexpected output shape: {out_shape}'
        print(f'ONNX Runtime check passed — output shape {out_shape}')
    except ImportError:
        print('onnxruntime not installed — skipping runtime check.')


def main() -> None:
    # Determine repo root (two levels up from this file)
    repo_root = Path(__file__).resolve().parent.parent.parent
    default_out = str(repo_root / 'public' / 'models' / 'floorplan-wall-segmentation.onnx')

    parser = argparse.ArgumentParser(description='Export WallSegNet to ONNX')
    parser.add_argument('--checkpoint', default='checkpoints/best.pth',
                        help='Path to trained checkpoint (.pth)')
    parser.add_argument('--out', default=default_out,
                        help='Output path for the ONNX file')
    parser.add_argument('--opset', type=int, default=17)
    parser.add_argument('--base-ch', type=int, default=16, dest='base_ch')
    parser.add_argument('--img-size', type=int, default=256, dest='img_size')
    args = parser.parse_args()

    export(args.checkpoint, args.out, args.opset, args.base_ch, args.img_size)


if __name__ == '__main__':
    main()
