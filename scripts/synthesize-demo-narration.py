# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "en-core-web-sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl",
#   "kokoro==0.9.4",
#   "librosa==1.0.0",
#   "soundfile==0.14.0",
# ]
# ///
"""Build timed SignGate demo narration with Apache-2.0 Kokoro-82M."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
from kokoro import KPipeline

ROOT = Path(__file__).resolve().parents[1]
SRT_PATH = ROOT / "video" / "signgate-demo.en.srt"
OUTPUT_PATH = ROOT / "video" / "build" / "narration-kokoro.wav"
CACHE_DIR = OUTPUT_PATH.parent / "kokoro-bm-george-120-cues"
TIMING_PATTERN = re.compile(
    r"(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> "
    r"(\d{2}):(\d{2}):(\d{2}),(\d{3})"
)
SAMPLE_RATE = 24_000


def seconds(parts: tuple[str, str, str, str]) -> float:
    hours, minutes, secs, millis = map(int, parts)
    return hours * 3600 + minutes * 60 + secs + millis / 1000


def parse_srt(path: Path) -> list[tuple[int, float, float, str]]:
    cues: list[tuple[int, float, float, str]] = []
    for block in path.read_text().strip().split("\n\n"):
        lines = block.splitlines()
        match = TIMING_PATTERN.fullmatch(lines[1])
        if match is None:
            raise ValueError(f"Invalid cue timing: {lines[1]}")
        cues.append(
            (
                int(lines[0]),
                seconds(match.groups()[:4]),
                seconds(match.groups()[4:]),
                " ".join(lines[2:]),
            )
        )
    return cues


def fit_cue(speech: np.ndarray, available: float) -> tuple[np.ndarray, float]:
    current = len(speech) / SAMPLE_RATE
    rate = max(1.0, current / available)
    if rate > 1.0:
        speech = librosa.effects.time_stretch(speech, rate=rate)
    return speech[: int(available * SAMPLE_RATE)], rate


def finish_cue(speech: np.ndarray) -> np.ndarray:
    peak = float(np.max(np.abs(speech))) if len(speech) else 0.0
    if peak > 0:
        speech = speech * min(0.90 / peak, 1.4)
    fade_samples = min(int(0.025 * SAMPLE_RATE), len(speech) // 2)
    if fade_samples:
        fade = np.linspace(0.0, 1.0, fade_samples, dtype=np.float32)
        speech[:fade_samples] *= fade
        speech[-fade_samples:] *= fade[::-1]
    return speech


def main() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    pipeline = KPipeline(lang_code="b", repo_id="hexgrad/Kokoro-82M", device="cpu")
    cues = parse_srt(SRT_PATH)
    timeline = np.zeros(int((cues[-1][2] + 0.35) * SAMPLE_RATE), dtype=np.float32)

    for cue_number, start, end, text in cues:
        text_hash = hashlib.sha256(text.encode()).hexdigest()[:12]
        cue_path = CACHE_DIR / f"{cue_number:02d}-{text_hash}.wav"
        if cue_path.exists():
            speech, existing_rate = sf.read(cue_path, dtype="float32")
            if existing_rate != SAMPLE_RATE:
                speech = librosa.resample(speech, orig_sr=existing_rate, target_sr=SAMPLE_RATE)
        else:
            print(f"Generating {cue_number:02d}/{len(cues)}: {text}")
            pieces = [
                result.audio.detach().cpu().numpy()
                for result in pipeline(text, voice="bm_george", speed=1.20)
                if result.audio is not None
            ]
            if not pieces:
                raise RuntimeError(f"No audio generated for cue {cue_number}")
            speech = np.concatenate(pieces).astype(np.float32)
            speech, _ = librosa.effects.trim(speech, top_db=42)
            sf.write(cue_path, speech, SAMPLE_RATE, subtype="PCM_24")

        current = len(speech) / SAMPLE_RATE
        speech, rate = fit_cue(speech, end - start - 0.10)
        speech = finish_cue(speech)
        offset = int(start * SAMPLE_RATE)
        timeline[offset : offset + len(speech)] += speech
        print(f"Cue {cue_number:02d}: generated={current:.2f}s, speed={rate:.3f}x")

    sf.write(OUTPUT_PATH, timeline, SAMPLE_RATE, subtype="PCM_24")
    print(f"Wrote {OUTPUT_PATH} ({len(timeline) / SAMPLE_RATE:.2f}s)")


if __name__ == "__main__":
    main()
