"""Thumbnail audit, matching stage (docs/private/PLAN-thumbnail-audit.md).

For each manifest entry (scripts/thumbnail-audit/prepare.ts), finds which
candidate image of the same article the thumbnail was cropped from, and where.

A thumbnail is an axis-aligned crop of its source, uniformly rescaled and
re-encoded. So per candidate: SIFT keypoints, Lowe ratio test, then RANSAC on a
similarity transform (scale + translation, small rotation tolerated). The
inlier count ranks candidates (a near-duplicate frame from the same shoot
shares no consistent keypoints), the transform maps the thumbnail's corners to
the crop rectangle, and a pixel check (warp the source into the thumbnail frame
and correlate) confirms it independently of SIFT. A custom thumbnail should
come out with ~0 inliers on every candidate.

Usage (from this directory):
  uv run match.py [--manifest M] [--out O] [--root DIR] [--jobs N] [--limit N]

--root DIR: local bucket download; an image is read from DIR/<url path> if it
exists, else fetched and cached under <out dir>/images. Verdict thresholds are
provisional: check overlays/ by eye before trusting them.
"""

import argparse
import json
import math
import time
import urllib.request
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from urllib.parse import unquote, urlparse

import cv2
import numpy as np
from PIL import Image, ImageOps

REPO = Path(__file__).resolve().parents[2]
SOURCE_MAX = 1600  # long side the sources are shrunk to before SIFT
THUMB_UPSCALE = 2.0  # small JPEGs give few keypoints; SIFT likes some size
RATIO = 0.75  # Lowe ratio test
RANSAC_PX = 3.0  # reprojection tolerance, in shrunk-source pixels
MAX_ROTATION_DEG = 3.0

# Provisional (see module docstring).
MATCH_INLIERS = 20
WEAK_INLIERS = 8
MATCH_ZNCC = 0.9  # median block ZNCC; a true source scores >0.99


def key_of(url: str) -> str:
    return unquote(urlparse(url).path).lstrip("/")


def fetch(url: str, root: Path | None, cache: Path) -> Path | None:
    key = key_of(url)
    if root is not None and (root / key).is_file():
        return root / key
    path = cache / key
    if path.is_file():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "jknm-thumbnail-audit"})
    for attempt in range(4):  # the B2 origin sometimes answers 503 under load
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                path.write_bytes(response.read())
            return path
        except Exception as error:
            if attempt == 3:
                print(f"  ! {url}: {error}")
                return None
            time.sleep(2**attempt)
    return None


def load_gray(path: Path, max_side: int | None) -> tuple[np.ndarray, tuple[int, int], float] | None:
    """Gray array, original (w, h) after EXIF rotation, shrink factor applied."""
    try:
        image = ImageOps.exif_transpose(Image.open(path)).convert("L")
    except Exception as error:
        print(f"  ! cannot open {path}: {error}")
        return None
    size = image.size
    factor = 1.0
    if max_side and max(size) > max_side:
        factor = max_side / max(size)
        image = image.resize((round(size[0] * factor), round(size[1] * factor)), Image.LANCZOS)
    return np.asarray(image), size, factor


def zncc(a: np.ndarray, b: np.ndarray) -> float:
    a = a.astype(np.float32).ravel()
    b = b.astype(np.float32).ravel()
    a -= a.mean()
    b -= b.mean()
    denominator = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(a @ b / denominator) if denominator else 0.0


def zncc_blocks(a: np.ndarray, b: np.ndarray, grid: int = 4) -> float:
    """Median ZNCC over a grid of blocks, so a logo or caption burned into the
    thumbnail corrupts one block instead of the whole score. Flat blocks (no
    texture to correlate) are skipped."""
    h, w = a.shape
    scores = []
    for i in range(grid):
        for j in range(grid):
            ys, xs = slice(i * h // grid, (i + 1) * h // grid), slice(j * w // grid, (j + 1) * w // grid)
            if a[ys, xs].std() < 3 or b[ys, xs].std() < 3:
                continue
            scores.append(zncc(a[ys, xs], b[ys, xs]))
    return float(np.median(scores)) if scores else 0.0


def match_one(thumb, thumb_kp, thumb_des, source, source_size, factor, sift) -> dict:
    """thumb_kp are in native thumbnail coordinates."""
    kp, des = sift.detectAndCompute(source, None)
    result = {"inliers": 0, "matches": 0}
    if des is None or thumb_des is None or len(kp) < 2:
        return result
    pairs = cv2.BFMatcher().knnMatch(thumb_des, des, k=2)
    good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < RATIO * p[1].distance]
    result["matches"] = len(good)
    if len(good) < 4:
        return result
    src_pts = np.float32([thumb_kp[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst_pts = np.float32([kp[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    matrix, mask = cv2.estimateAffinePartial2D(
        src_pts, dst_pts, method=cv2.RANSAC, ransacReprojThreshold=RANSAC_PX, maxIters=5000
    )
    if matrix is None:
        return result
    inliers = int(mask.sum())
    scale = math.hypot(matrix[0, 0], matrix[1, 0])
    rotation = math.degrees(math.atan2(matrix[1, 0], matrix[0, 0]))
    h, w = thumb.shape
    corners = np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2)
    mapped = cv2.transform(corners, matrix).reshape(-1, 2) / factor  # full-res source px
    x0, y0 = mapped.min(axis=0)
    x1, y1 = mapped.max(axis=0)
    sw, sh = source_size
    warped = cv2.warpAffine(
        source, matrix, (w, h), flags=cv2.WARP_INVERSE_MAP | cv2.INTER_LINEAR
    )
    coverage = cv2.warpAffine(
        np.full(source.shape, 255, np.uint8), matrix, (w, h),
        flags=cv2.WARP_INVERSE_MAP | cv2.INTER_NEAREST,
    )
    inside = float((coverage > 0).mean())
    blur = lambda x: cv2.GaussianBlur(x, (0, 0), 1.0)
    result.update(
        inliers=inliers,
        scale=scale / factor,  # thumbnail px per full-res source px, inverse
        rotation_deg=rotation,
        rect_px=[round(float(v), 1) for v in (x0, y0, x1 - x0, y1 - y0)],
        rect_pct=[round(100 * float(v), 2) for v in (x0 / sw, y0 / sh, (x1 - x0) / sw, (y1 - y0) / sh)],
        focal_pct=[round(100 * float((x0 + x1) / 2 / sw), 2), round(100 * float((y0 + y1) / 2 / sh), 2)],
        inside=round(inside, 3),
        zncc=round(zncc(blur(warped), blur(thumb)), 4),
        zncc_blocks=round(zncc_blocks(blur(warped), blur(thumb)), 4),
        mae=round(float(np.abs(blur(warped).astype(np.float32) - blur(thumb)).mean()), 2),
        matrix=matrix.tolist(),
    )
    return result


def verified(c: dict) -> bool:
    """Geometry and pixels agree: this candidate is the source (or an identical copy)."""
    return (
        c["inliers"] >= MATCH_INLIERS
        and abs(c.get("rotation_deg", 0)) <= MAX_ROTATION_DEG
        and c.get("inside", 0) >= 0.98
        and c.get("zncc_blocks", 0) >= MATCH_ZNCC
    )


def rank(c: dict) -> tuple:
    return (verified(c), c.get("zncc_blocks", 0) if verified(c) else 0, c["inliers"])


def verdict(candidates: list[dict]) -> tuple[str, list[str]]:
    """Returns (verdict, media ids of other verified candidates). Several
    verified candidates are copies of one photo, and which one is used does not
    matter, so it is not ambiguous; the ids are reported for review."""
    if not candidates:
        return "none", []
    best = candidates[0]
    if verified(best):
        return "match", [c["media_id"] for c in candidates[1:] if verified(c)]
    return ("weak" if best["inliers"] >= WEAK_INLIERS else "none"), []


def draw_overlay(path: Path, thumb_path: Path, best: dict, out: Path) -> None:
    source = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    source.thumbnail((1100, 1100))
    k = source.width / best["source_size"][0]
    x, y, w, h = (v * k for v in best["rect_px"])
    canvas = np.asarray(source).copy()
    cv2.rectangle(canvas, (round(x), round(y)), (round(x + w), round(y + h)), (255, 40, 40), 3)
    thumb = ImageOps.exif_transpose(Image.open(thumb_path)).convert("RGB")
    thumb = thumb.resize((round(thumb.width * canvas.shape[0] / thumb.height / 2.5) or 1, round(canvas.shape[0] / 2.5)))
    panel = np.full((canvas.shape[0], thumb.width + 10, 3), 255, np.uint8)
    panel[: thumb.height, 10:] = np.asarray(thumb)
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.hstack([canvas, panel])).save(out, quality=85)


def process(job: tuple) -> dict:
    entry, root, cache, overlays = job
    cv2.setNumThreads(1)
    sift = cv2.SIFT_create(nfeatures=4000)
    out = {k: entry[k] for k in ("group", "article_id", "title", "uploaded_custom_thumbnail", "crop")}
    out["thumbnail"] = entry["thumbnail"]
    out["candidates"] = []
    thumb_path = fetch(entry["thumbnail"]["url"], root, cache)
    loaded = load_gray(thumb_path, None) if thumb_path else None
    if not loaded:
        out.update(verdict="error", error="thumbnail unreadable")
        return out
    thumb = loaded[0]
    big = cv2.resize(thumb, None, fx=THUMB_UPSCALE, fy=THUMB_UPSCALE, interpolation=cv2.INTER_CUBIC)
    kp_big, thumb_des = sift.detectAndCompute(big, None)
    thumb_kp = [cv2.KeyPoint(k.pt[0] / THUMB_UPSCALE, k.pt[1] / THUMB_UPSCALE, k.size / THUMB_UPSCALE) for k in kp_big]
    paths = {}
    for candidate in entry["candidates"]:
        path = fetch(candidate["url"], root, cache)
        source = load_gray(path, SOURCE_MAX) if path else None
        if not source:
            out["candidates"].append({"media_id": candidate["id"], "url": candidate["url"], "error": "unreadable", "inliers": 0})
            continue
        gray, size, factor = source
        paths[candidate["id"]] = path
        res = match_one(thumb, thumb_kp, thumb_des, gray, size, factor, sift)
        res.update(media_id=candidate["id"], url=candidate["url"], source_size=list(size))
        out["candidates"].append(res)
    out["candidates"].sort(key=rank, reverse=True)
    best = out["candidates"][0] if out["candidates"] else None
    out["verdict"], out["alternates"] = verdict(out["candidates"])
    out["runner_up_inliers"] = out["candidates"][1]["inliers"] if len(out["candidates"]) > 1 else 0
    # A logo or caption burned into the thumbnail lowers the global score only.
    out["edited"] = bool(best and out["verdict"] == "match" and best["zncc"] < 0.97)
    if best and best["inliers"] >= WEAK_INLIERS and overlays is not None and best["media_id"] in paths:
        draw_overlay(paths[best["media_id"]], thumb_path, best, overlays / f"{out['verdict']}-{entry['article_id']}.jpg")
    for c in out["candidates"]:
        c.pop("matrix", None)
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default=REPO / "artifacts/thumbnail-audit/manifest.json", type=Path)
    parser.add_argument("--out", default=REPO / "artifacts/thumbnail-audit/match.json", type=Path)
    parser.add_argument("--root", type=Path)
    parser.add_argument("--jobs", type=int, default=8)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()

    entries = json.loads(args.manifest.read_text())["entries"]
    if args.limit:
        entries = entries[: args.limit]
    cache = args.out.parent / "images"
    overlays = args.out.parent / "overlays"
    jobs = [(e, args.root, cache, overlays) for e in entries]
    with ProcessPoolExecutor(args.jobs) as pool:
        results = list(pool.map(process, jobs, chunksize=1))
    args.out.write_text(json.dumps({"entries": results}, indent=2))

    print(f"{len(results)} entries -> {args.out}")
    groups = sorted({r["group"] for r in results})
    for group in groups:
        counts: dict[str, int] = {}
        for r in results:
            if r["group"] == group:
                counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
        print(f"  {group:15} {counts}")


if __name__ == "__main__":
    main()
