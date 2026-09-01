# MoMask source-motion diagnostic

This directory records a local, network-free inference spike using the official
[EricGuo5513 MoMask implementation](https://github.com/EricGuo5513/momask-codes).
It contains source skeleton motion only. Nothing has been retargeted to the Ashveil
character or accepted for production.

## Disposition

- `basic_ik.bvh` means MoMask's position sequence fitted to the bundled BVH skeleton
  by its basic inverse-kinematics solver.
- `footlocked_basic_ik.bvh` additionally applies MoMask's naive foot-lock pass before
  the same solve. It is not called raw or rotational ground truth.
- `source_positions.npy` is the untouched 22-joint output from
  `recover_from_ric(..., 22)`, captured before either conversion.
- The terminal hand/palm roll is unobservable from these positions. No palm-facing
  claim is made.
- The basic-IK variant is the leading diagnostic for all three clips. The foot-lock
  pass was rejected because its limited contact improvements came with worse fit,
  knee-plane behaviour, or penetration.
- `game_loop_basic_ik.bvh` is the accepted, deterministic in-place source loop.
  `game_loop_source_positions.npy` preserves its position-space target, and
  `game_loop_cleanup.json` contains independently measured BVH results.
- All three cleaned sources pass the fixed source-only gates in `report.json` and may
  enter ARP retarget evaluation. This does not accept target-rig deformation, export
  parity or production animation.

The selected clips contain 81/41/41 samples at exactly 20 fps. Their sample spans
are 4.0/2.0/2.0 seconds. Odd sample counts make 20-to-30 fps retiming exact because
`(frames - 1) * 1.5` is integral. No duplicate frames were appended.

## Provenance and licensing

The external checkout is pinned at commit
`94a6636c9c463b7a9414c3401a6f1b67e6c51824`. The checkpoint archive SHA-256 is
`3ed737fe352c4cdc671b0c133d6c0090690468d58832bd883686188d5f333ec7`.
Exact checkpoint and output hashes are in `report.json`; the inference environment
is in `environment.lock.txt`.

MoMask code is MIT-licensed, but the repository does not grant a distinct checkpoint
license. The pretrained models use HumanML3D/AMASS-derived data. The
[AMASS license](https://amass.is.tue.mpg.de/license.html) restricts use to
non-commercial scientific research, so these outputs are diagnostic/noncommercial
until a separate model-and-data rights review clears them.

The local wrapper only preserved pre-conversion positions and disabled the broken
upstream preview stage. It did not change sampling or model code. Its SHA-256 is
`e4b9a3c71aec5ee53014bd42f4c511f860c7c2fbcbabec0eb34ee2812d7cdda0`.
The deterministic odd-window selector SHA-256 is
`b5689f0d93603fc65ef910809b15794d06f9ed41c3fe306841fa7223476134dd`.
The checked-in position/IK cleanup script is
`scripts/art/momask-source-cleanup.py` (SHA-256
`4a223f51a0db22c11d49729e1fd3a16f05de2ccade655aa888e8d5e3d0d0a46f`); it aligns validated locomotion heading,
derives in-place motion, stabilizes geometry-defined contacts, closes pose and
velocity at the loop seam, and corrects only geometry-detected knee-plane reversals.
It never authors rotations on the ARP target.

## Known local compatibility limits

The official requirements force a CUDA wheel index and cannot be installed verbatim
on Apple Silicon. The isolated environment uses CPU PyTorch 2.2.2 and NumPy 1.23.5;
the latter is required by MoMask's private `numpy.core.umath_tests` import. Upstream
MP4 preview generation was bypassed because its old Matplotlib code and this Mac's
broken Homebrew FFmpeg x265 link are unrelated to inference. The checked-in previews
are independent static FK contact sheets generated from the resulting BVHs.
