"""
Training script for WallSegNet on CubiCasa5k.

Usage
-----
  python ops/train/train.py \\
      --data data/cubicasa5k \\
      --out  checkpoints/ \\
      [--epochs 30] \\
      [--batch  16] \\
      [--lr     3e-4] \\
      [--base-ch 16] \\
      [--img-size 256] \\
      [--max-samples 5000]

The best checkpoint (lowest validation loss) is saved to
``<out>/best.pth`` and can be passed to ``export.py``.
"""

import argparse
import os
import sys
from pathlib import Path
from typing import Optional

import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from tqdm import tqdm

# Allow running from repo root or from ops/train/
sys.path.insert(0, str(Path(__file__).parent))
from dataset import build_dataset
from model import build_model


# ── Loss ─────────────────────────────────────────────────────────────────────

def dice_loss(pred: torch.Tensor, target: torch.Tensor, eps: float = 1e-6) -> torch.Tensor:
    pred_f = pred.view(-1)
    target_f = target.view(-1)
    intersection = (pred_f * target_f).sum()
    return 1.0 - (2.0 * intersection + eps) / (pred_f.sum() + target_f.sum() + eps)


def combined_loss(pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    bce = nn.functional.binary_cross_entropy(pred, target)
    return 0.5 * bce + 0.5 * dice_loss(pred, target)


# ── Metrics ──────────────────────────────────────────────────────────────────

def iou_score(pred: torch.Tensor, target: torch.Tensor, threshold: float = 0.5) -> float:
    p = (pred > threshold).float()
    t = target.float()
    inter = (p * t).sum().item()
    union = (p + t).clamp(0, 1).sum().item()
    return inter / union if union > 0 else 1.0


# ── Training epoch ────────────────────────────────────────────────────────────

def run_epoch(
    model: nn.Module,
    loader: DataLoader,
    optimizer: Optional[torch.optim.Optimizer],
    device: torch.device,
    train: bool,
) -> tuple[float, float]:
    model.train(train)
    total_loss, total_iou, n = 0.0, 0.0, 0
    with torch.set_grad_enabled(train):
        for images, masks in tqdm(loader, leave=False, desc='train' if train else 'val'):
            images = images.to(device)
            masks = masks.to(device)
            preds = model(images)
            loss = combined_loss(preds, masks)
            if train and optimizer:
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
            total_loss += loss.item() * images.size(0)
            total_iou += iou_score(preds.detach(), masks.detach()) * images.size(0)
            n += images.size(0)
    return total_loss / n, total_iou / n


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description='Train WallSegNet on CubiCasa5k')
    parser.add_argument('--data', required=True, help='Path to cubicasa5k root directory')
    parser.add_argument('--out', default='checkpoints', help='Output directory for checkpoints')
    parser.add_argument('--epochs', type=int, default=30)
    parser.add_argument('--batch', type=int, default=16)
    parser.add_argument('--lr', type=float, default=3e-4)
    parser.add_argument('--base-ch', type=int, default=16, dest='base_ch')
    parser.add_argument('--img-size', type=int, default=256, dest='img_size')
    parser.add_argument(
        '--max-samples',
        type=int,
        default=None,
        dest='max_samples',
        help='Limit dataset size for quick tests',
    )
    parser.add_argument('--resume', default=None, help='Path to checkpoint to resume from')
    parser.add_argument(
        '--dataset',
        default='auto',
        choices=('auto', 'synthetic', 'cubicasa'),
        help="Which loader to use. 'auto' detects the synthetic images/masks layout.",
    )
    args = parser.parse_args()

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f'Device: {device}')

    # ── Datasets ──
    train_ds = build_dataset(args.data, img_size=args.img_size, split='train',
                             augment=True, kind=args.dataset)
    val_ds = build_dataset(args.data, img_size=args.img_size, split='val',
                           augment=False, kind=args.dataset)

    if args.max_samples is not None and args.max_samples < len(train_ds):
        from torch.utils.data import Subset
        import random
        idxs = random.sample(range(len(train_ds)), args.max_samples)
        train_ds = Subset(train_ds, idxs)  # type: ignore[assignment]

    print(f'Train samples : {len(train_ds)}')
    print(f'Val   samples : {len(val_ds)}')

    train_loader = DataLoader(
        train_ds, batch_size=args.batch, shuffle=True,
        num_workers=min(4, os.cpu_count() or 1), pin_memory=True,
    )
    val_loader = DataLoader(
        val_ds, batch_size=args.batch, shuffle=False,
        num_workers=min(4, os.cpu_count() or 1), pin_memory=True,
    )

    # ── Model ──
    model = build_model(args.base_ch).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    print(f'WallSegNet  base_ch={args.base_ch}  params={n_params / 1e6:.2f}M')

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=args.epochs, eta_min=args.lr * 0.01,
    )

    start_epoch = 0
    best_val_loss = float('inf')
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.resume and Path(args.resume).exists():
        ckpt = torch.load(args.resume, map_location=device)
        model.load_state_dict(ckpt['model'])
        optimizer.load_state_dict(ckpt['optimizer'])
        scheduler.load_state_dict(ckpt['scheduler'])
        start_epoch = ckpt['epoch'] + 1
        best_val_loss = ckpt.get('best_val_loss', float('inf'))
        print(f'Resumed from epoch {start_epoch}')

    # ── Training loop ──
    for epoch in range(start_epoch, args.epochs):
        train_loss, train_iou = run_epoch(model, train_loader, optimizer, device, train=True)
        val_loss, val_iou = run_epoch(model, val_loader, None, device, train=False)
        scheduler.step()

        improved = val_loss < best_val_loss
        if improved:
            best_val_loss = val_loss
            torch.save(model.state_dict(), out_dir / 'best.pth')

        ckpt = {
            'epoch': epoch,
            'model': model.state_dict(),
            'optimizer': optimizer.state_dict(),
            'scheduler': scheduler.state_dict(),
            'best_val_loss': best_val_loss,
            'base_ch': args.base_ch,
            'img_size': args.img_size,
        }
        torch.save(ckpt, out_dir / 'last.pth')

        mark = ' ✓' if improved else ''
        print(
            f'Epoch {epoch + 1:03d}/{args.epochs}  '
            f'train_loss={train_loss:.4f}  train_iou={train_iou:.4f}  '
            f'val_loss={val_loss:.4f}  val_iou={val_iou:.4f}{mark}'
        )

    print(f'\nBest val_loss={best_val_loss:.4f} — checkpoint saved to {out_dir / "best.pth"}')


if __name__ == '__main__':
    main()
