"""
Lightweight U-Net for floor-plan wall segmentation.

Architecture
------------
Encoder : 4 levels, starting with 16 channels, doubled each level.
Bottleneck : 256 → 256 conv block.
Decoder : 4 symmetric up-sample levels with skip connections.
Output : 1-channel sigmoid mask (wall probability per pixel).

Parameters : ~1.5 M (produces a ~6 MB ONNX file).
Input  : (N, 3, H, W) float32, values in [0, 1].
Output : (N, 1, H, W) float32, values in [0, 1].
"""

import torch
import torch.nn as nn


class _ConvBlock(nn.Module):
    """Two 3×3 convolutions with BN + ReLU."""

    def __init__(self, in_ch: int, out_ch: int) -> None:
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv2d(in_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.block(x)


class _Down(nn.Module):
    """MaxPool 2×2 followed by a conv block."""

    def __init__(self, in_ch: int, out_ch: int) -> None:
        super().__init__()
        self.pool = nn.MaxPool2d(2)
        self.conv = _ConvBlock(in_ch, out_ch)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.conv(self.pool(x))


class _Up(nn.Module):
    """Bilinear up-sample, concatenate skip, then conv block."""

    def __init__(self, in_ch: int, skip_ch: int, out_ch: int) -> None:
        super().__init__()
        self.up = nn.Upsample(scale_factor=2, mode='bilinear', align_corners=False)
        self.conv = _ConvBlock(in_ch + skip_ch, out_ch)

    def forward(self, x: torch.Tensor, skip: torch.Tensor) -> torch.Tensor:
        x = self.up(x)
        x = torch.cat([x, skip], dim=1)
        return self.conv(x)


class WallSegNet(nn.Module):
    """Lightweight U-Net for wall segmentation.

    Parameters
    ----------
    base_ch : int
        Channel width at the first encoder level (default 16).  Doubling each
        level gives [16, 32, 64, 128] encoder feature maps and a 256-channel
        bottleneck.
    """

    def __init__(self, base_ch: int = 16) -> None:
        super().__init__()
        b = base_ch  # shorthand

        # Encoder
        self.enc1 = _ConvBlock(3, b)
        self.enc2 = _Down(b, b * 2)
        self.enc3 = _Down(b * 2, b * 4)
        self.enc4 = _Down(b * 4, b * 8)

        # Bottleneck
        self.bottleneck = _Down(b * 8, b * 16)

        # Decoder
        self.dec4 = _Up(b * 16, b * 8, b * 8)
        self.dec3 = _Up(b * 8, b * 4, b * 4)
        self.dec2 = _Up(b * 4, b * 2, b * 2)
        self.dec1 = _Up(b * 2, b, b)

        # Output head — sigmoid gives probability in [0, 1]
        self.out_conv = nn.Conv2d(b, 1, kernel_size=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        s1 = self.enc1(x)
        s2 = self.enc2(s1)
        s3 = self.enc3(s2)
        s4 = self.enc4(s3)

        bn = self.bottleneck(s4)

        d4 = self.dec4(bn, s4)
        d3 = self.dec3(d4, s3)
        d2 = self.dec2(d3, s2)
        d1 = self.dec1(d2, s1)

        return torch.sigmoid(self.out_conv(d1))


def build_model(base_ch: int = 16) -> WallSegNet:
    """Construct and return an untrained WallSegNet."""
    return WallSegNet(base_ch=base_ch)


if __name__ == '__main__':
    import sys

    ch = int(sys.argv[1]) if len(sys.argv) > 1 else 16
    model = build_model(ch)
    n_params = sum(p.numel() for p in model.parameters())
    print(f'WallSegNet  base_ch={ch}  params={n_params / 1e6:.2f}M')
    dummy = torch.zeros(1, 3, 256, 256)
    out = model(dummy)
    print(f'Output shape: {out.shape}  min={out.min():.3f} max={out.max():.3f}')
