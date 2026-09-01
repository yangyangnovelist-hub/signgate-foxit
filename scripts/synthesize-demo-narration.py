# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = [
#   "mlx-audio==0.5.1",
#   "soundfile==0.14.0",
# ]
# ///
"""Build artifact-screened SignGate narration with direct Qwen CustomVoice."""

from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any

import mlx.core as mx
import numpy as np
import soundfile as sf
from mlx_audio.tts.utils import load_model


ROOT = Path(__file__).resolve().parents[1]
SRT_PATH = ROOT / "video" / "signgate-demo.en.srt"
OUTPUT_PATH = ROOT / "video" / "build" / "narration-qwen3.wav"
REPORT_PATH = ROOT / "video" / "build" / "narration-qwen3-report.json"
CACHE_DIR = OUTPUT_PATH.parent / "qwen3-custom-aiden-candidates-v1"
MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit"
SPEAKER = "Aiden"
VOICE_DIRECTION = (
    "Warm, restrained, and conversational. A calm product security lead speaking "
    "to one trusted colleague, close to a dry microphone. Use a steady natural pace "
    "and precise but relaxed phrasing. No announcer cadence, sales energy, trailer "
    "delivery, whispering, exaggerated consonants, or audible artificial breaths."
)
PROFILES: tuple[dict[str, float | int | str], ...] = (
    {
        "name": "stable",
        "temperature": 0.62,
        "top_k": 32,
        "top_p": 0.90,
        "repetition_penalty": 1.08,
    },
    {
        "name": "natural",
        "temperature": 0.68,
        "top_k": 48,
        "top_p": 0.93,
        "repetition_penalty": 1.08,
    },
)
TIMING_PATTERN = re.compile(
    r"(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> "
    r"(\d{2}):(\d{2}):(\d{2}),(\d{3})"
)
SAMPLE_RATE = 24_000
CANDIDATES_PER_CUE = 6
CANDIDATE_COUNT_OVERRIDES = {5: 8, 7: 8, 11: 10}
TAIL_ROOM_SECONDS = 0.10
PRE_ROLL_SECONDS = 0.04
POST_ROLL_SECONDS = 0.10
GENERATION_SEED_BASE = 2_026_091_000
PRONUNCIATION_VERSION = "3"


def seconds(parts: tuple[str, str, str, str]) -> float:
    hours, minutes, secs, millis = map(int, parts)
    return hours * 3600 + minutes * 60 + secs + millis / 1000


def parse_srt(path: Path) -> list[tuple[int, float, float, str]]:
    cues: list[tuple[int, float, float, str]] = []
    for block in path.read_text().strip().split("\n\n"):
        lines = block.splitlines()
        if len(lines) < 3:
            raise ValueError(f"Invalid subtitle block: {block!r}")
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


def to_spoken_text(text: str) -> str:
    replacements = (
        ("Foxit's", "Fox-it's"),
        ("U.S.", "U S"),
        ("SHA-256", "S H A two fifty-six"),
        ("SignGate", "Sign Gate"),
        ("Foxit", "Fox-it"),
        ("eSign", "e-sign"),
        ("MCP", "M C P"),
        ("HTML", "H T M L"),
        ("PDF", "P D F"),
    )
    spoken = text
    for source, replacement in replacements:
        spoken = spoken.replace(source, replacement)
    return spoken


def as_mono(audio: np.ndarray) -> np.ndarray:
    speech = np.asarray(audio, dtype=np.float32)
    speech = np.squeeze(speech)
    if speech.ndim == 1:
        return speech
    if speech.ndim != 2:
        raise ValueError(f"Unexpected generated-audio shape: {speech.shape}")
    channel_axis = 0 if speech.shape[0] <= speech.shape[1] else 1
    return np.mean(speech, axis=channel_axis, dtype=np.float32)


def trim_with_context(speech: np.ndarray) -> np.ndarray:
    window = max(1, round(0.020 * SAMPLE_RATE))
    if len(speech) <= window:
        return np.asarray(speech, dtype=np.float32)
    squared = np.square(speech, dtype=np.float64)
    cumulative = np.concatenate(([0.0], np.cumsum(squared)))
    moving_rms = np.sqrt((cumulative[window:] - cumulative[:-window]) / window)
    threshold = float(np.max(moving_rms)) * 10 ** (-42 / 20)
    active = np.flatnonzero(moving_rms >= threshold)
    if not len(active):
        return np.asarray(speech, dtype=np.float32)
    start = max(0, int(active[0]) - round(PRE_ROLL_SECONDS * SAMPLE_RATE))
    end = min(
        len(speech),
        int(active[-1]) + window + round(POST_ROLL_SECONDS * SAMPLE_RATE),
    )
    return np.asarray(speech[start:end], dtype=np.float32)


def has_three_consecutive_hot_samples(speech: np.ndarray) -> bool:
    hot = np.abs(speech) > 0.98
    return bool(len(hot) >= 3 and np.any(hot[:-2] & hot[1:-1] & hot[2:]))


def candidate_metrics(speech: np.ndarray) -> dict[str, float | int | bool]:
    finite = bool(np.all(np.isfinite(speech)))
    clean = np.nan_to_num(speech, copy=True)
    peak = float(np.max(np.abs(clean))) if len(clean) else 0.0
    rms = float(np.sqrt(np.mean(np.square(clean, dtype=np.float64)))) if len(clean) else 0.0
    crest_db = 20 * np.log10(max(peak, 1e-12) / max(rms, 1e-12))

    analysis = clean - float(np.mean(clean))
    analysis_rms = float(np.sqrt(np.mean(np.square(analysis, dtype=np.float64))))
    if analysis_rms > 1e-9:
        analysis *= (10 ** (-18 / 20)) / analysis_rms
    jumps = np.abs(np.diff(analysis))
    max_jump = float(np.max(jumps)) if len(jumps) else 0.0
    jump_p99_9 = float(np.percentile(jumps, 99.9)) if len(jumps) else 0.0
    jump_p99_999 = float(np.percentile(jumps, 99.999)) if len(jumps) else 0.0
    jump_ratio = max_jump / max(jump_p99_9, 1e-9)

    high_band_ratio = 0.0
    if len(analysis) >= 1024:
        windowed = analysis * np.hanning(len(analysis))
        spectrum = np.abs(np.fft.rfft(windowed)) ** 2
        frequencies = np.fft.rfftfreq(len(analysis), d=1 / SAMPLE_RATE)
        total_energy = float(np.sum(spectrum))
        if total_energy > 0:
            high_band_ratio = float(
                np.sum(spectrum[frequencies >= 8_000]) / total_energy
            )

    artifact_score = (
        jump_ratio
        + 4.0 * max_jump
        + 2.0 * jump_p99_999
        + 80.0 * high_band_ratio
        + 0.05 * max(0.0, crest_db - 18.0)
    )
    return {
        "finite": finite,
        "duration_seconds": round(len(clean) / SAMPLE_RATE, 4),
        "peak": round(peak, 8),
        "peak_dbfs": round(20 * np.log10(max(peak, 1e-12)), 3),
        "rms_dbfs": round(20 * np.log10(max(rms, 1e-12)), 3),
        "crest_db": round(float(crest_db), 3),
        "samples_ge_0_999": int(np.count_nonzero(np.abs(clean) >= 0.999)),
        "three_consecutive_samples_gt_0_98": has_three_consecutive_hot_samples(clean),
        "analysis_max_adjacent_jump": round(max_jump, 8),
        "analysis_jump_p99_999": round(jump_p99_999, 8),
        "analysis_jump_ratio": round(jump_ratio, 4),
        "high_band_energy_ratio": round(high_band_ratio, 8),
        "artifact_score": round(float(artifact_score), 6),
    }


def rejection_reasons(
    metrics: dict[str, float | int | bool], available: float
) -> list[str]:
    reasons: list[str] = []
    if not bool(metrics["finite"]):
        reasons.append("non-finite samples")
    if int(metrics["samples_ge_0_999"]) > 0:
        reasons.append("sample reached 0.999 full scale")
    if bool(metrics["three_consecutive_samples_gt_0_98"]):
        reasons.append("three consecutive samples exceeded 0.98")
    if float(metrics["duration_seconds"]) > available:
        reasons.append(
            f"duration {metrics['duration_seconds']:.4f}s exceeds {available:.4f}s window"
        )
    if float(metrics["duration_seconds"]) < 0.25:
        reasons.append("generated speech was effectively empty")
    return reasons


def max_tokens_for_window(available: float) -> int:
    if available < 8:
        return 256
    if available < 12:
        return 320
    return 384


def generate_candidate(
    model: Any,
    text: str,
    profile: dict[str, float | int | str],
    seed: int,
    max_tokens: int,
) -> np.ndarray:
    mx.random.seed(seed)
    results = list(
        model.generate_custom_voice(
            text=text,
            speaker=SPEAKER,
            language="English",
            instruct=VOICE_DIRECTION,
            temperature=float(profile["temperature"]),
            top_k=int(profile["top_k"]),
            top_p=float(profile["top_p"]),
            repetition_penalty=float(profile["repetition_penalty"]),
            max_tokens=max_tokens,
            verbose=False,
            stream=False,
        )
    )
    if not results:
        raise RuntimeError("Qwen3-TTS returned no audio")
    speech = np.concatenate(
        [as_mono(np.asarray(result.audio, dtype=np.float32)) for result in results]
    )
    sample_rate = int(results[0].sample_rate)
    if sample_rate != SAMPLE_RATE:
        raise RuntimeError(
            f"Qwen3-TTS returned {sample_rate} Hz; expected {SAMPLE_RATE} Hz"
        )
    return trim_with_context(np.asarray(speech, dtype=np.float32))


def apply_edge_fades(speech: np.ndarray) -> np.ndarray:
    result = np.array(speech, dtype=np.float32, copy=True)
    fade_in_samples = min(round(0.005 * SAMPLE_RATE), len(result) // 2)
    fade_out_samples = min(round(0.010 * SAMPLE_RATE), len(result) // 2)
    if fade_in_samples:
        result[:fade_in_samples] *= np.linspace(
            0.0, 1.0, fade_in_samples, dtype=np.float32
        )
    if fade_out_samples:
        result[-fade_out_samples:] *= np.linspace(
            1.0, 0.0, fade_out_samples, dtype=np.float32
        )
    return result


def main() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    cues = parse_srt(SRT_PATH)
    timeline = np.zeros(
        round((cues[-1][2] + 0.35) * SAMPLE_RATE), dtype=np.float32
    )
    model: Any | None = None
    started = time.monotonic()
    report: dict[str, Any] = {
        "model": MODEL_ID,
        "model_license": "Apache-2.0",
        "speaker": SPEAKER,
        "generation_method": "direct first-generation Qwen CustomVoice",
        "reference_audio": None,
        "uses_real_person_voice": False,
        "voice_direction": VOICE_DIRECTION,
        "sample_rate": SAMPLE_RATE,
        "candidate_count_policy": {
            "default": CANDIDATES_PER_CUE,
            "overrides": CANDIDATE_COUNT_OVERRIDES,
        },
        "time_stretch": 1.0,
        "per_cue_loudness_normalization": False,
        "candidate_hard_rejection": [
            "non-finite samples",
            "sample reaches 0.999 full scale",
            "three consecutive samples exceed 0.98",
            "duration exceeds cue window",
        ],
        "candidate_ranking": "gain-independent transient and high-band artifact score",
        "srt_sha256": hashlib.sha256(SRT_PATH.read_bytes()).hexdigest(),
        "cues": [],
    }

    for cue_number, start, end, text in cues:
        spoken_text = to_spoken_text(text)
        available = end - start - TAIL_ROOM_SECONDS
        candidate_count = CANDIDATE_COUNT_OVERRIDES.get(
            cue_number, CANDIDATES_PER_CUE
        )
        cue_candidates: list[dict[str, Any]] = []
        candidate_audio: dict[int, np.ndarray] = {}
        print(f"Cue {cue_number:02d}/{len(cues)}: {spoken_text}", flush=True)

        for candidate_number in range(1, candidate_count + 1):
            profile = PROFILES[(candidate_number - 1) % len(PROFILES)]
            seed = GENERATION_SEED_BASE + cue_number * 100 + candidate_number
            cache_key = hashlib.sha256(
                (
                    f"{MODEL_ID}|{SPEAKER}|{VOICE_DIRECTION}|"
                    f"pronunciation-{PRONUNCIATION_VERSION}|{profile}|"
                    f"seed-{seed}|{spoken_text}"
                ).encode()
            ).hexdigest()[:16]
            cue_path = (
                CACHE_DIR
                / f"{cue_number:02d}-c{candidate_number}-{profile['name']}-{cache_key}.wav"
            )
            from_cache = cue_path.exists()
            generation_seconds = 0.0
            if from_cache:
                speech, existing_rate = sf.read(cue_path, dtype="float32")
                speech = as_mono(speech)
                if existing_rate != SAMPLE_RATE:
                    raise RuntimeError(
                        f"Cached candidate {cue_path} is {existing_rate} Hz; "
                        f"expected {SAMPLE_RATE} Hz"
                    )
            else:
                if model is None:
                    print(f"Loading {MODEL_ID}...", flush=True)
                    model = load_model(MODEL_ID)
                candidate_started = time.monotonic()
                speech = generate_candidate(
                    model,
                    spoken_text,
                    profile,
                    seed,
                    max_tokens_for_window(available),
                )
                generation_seconds = time.monotonic() - candidate_started
                sf.write(cue_path, speech, SAMPLE_RATE, subtype="PCM_24")

            speech = np.asarray(speech, dtype=np.float32)
            metrics = candidate_metrics(speech)
            reasons = rejection_reasons(metrics, available)
            entry: dict[str, Any] = {
                "candidate": candidate_number,
                "profile": profile["name"],
                "settings": profile,
                "seed": seed,
                "from_cache": from_cache,
                "generation_seconds": round(generation_seconds, 3),
                "cache_file": str(cue_path),
                "metrics": metrics,
                "accepted": not reasons,
                "rejection_reasons": reasons,
            }
            cue_candidates.append(entry)
            candidate_audio[candidate_number] = speech
            verdict = "valid" if not reasons else "rejected"
            print(
                f"  candidate {candidate_number}: {verdict}, "
                f"duration={metrics['duration_seconds']:.2f}s, "
                f"score={metrics['artifact_score']:.3f}, cached={from_cache}",
                flush=True,
            )

        valid = [candidate for candidate in cue_candidates if candidate["accepted"]]
        if not valid:
            report["cues"].append(
                {
                    "number": cue_number,
                    "text": text,
                    "spoken_text": spoken_text,
                    "start": start,
                    "end": end,
                    "available_seconds": round(available, 3),
                    "time_stretch": 1.0,
                    "candidates": cue_candidates,
                    "selected_candidate": None,
                }
            )
            REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n")
            raise RuntimeError(
                f"Cue {cue_number:02d} has no valid un-stretched candidate. "
                f"Shorten its subtitle or regenerate with a new seed; see {REPORT_PATH}."
            )

        selected = min(
            valid,
            key=lambda candidate: float(candidate["metrics"]["artifact_score"]),
        )
        selected_number = int(selected["candidate"])
        speech = apply_edge_fades(candidate_audio[selected_number])
        offset = round(start * SAMPLE_RATE)
        final_index = offset + len(speech)
        if final_index > len(timeline):
            raise RuntimeError(f"Cue {cue_number:02d} exceeds the narration timeline")
        timeline[offset:final_index] += speech
        report["cues"].append(
            {
                "number": cue_number,
                "text": text,
                "spoken_text": spoken_text,
                "start": start,
                "end": end,
                "available_seconds": round(available, 3),
                "placed_seconds": round(len(speech) / SAMPLE_RATE, 3),
                "time_stretch": 1.0,
                "per_cue_gain_db": 0.0,
                "candidates": cue_candidates,
                "selected_candidate": selected_number,
                "selected_cache_file": selected["cache_file"],
                "selected_artifact_score": selected["metrics"]["artifact_score"],
            }
        )
        print(
            f"  selected candidate {selected_number} "
            f"(score={selected['metrics']['artifact_score']:.3f})",
            flush=True,
        )

    peak_before_safety = float(np.max(np.abs(timeline)))
    global_safety_scale = 1.0
    if peak_before_safety > 0.98:
        global_safety_scale = 0.98 / peak_before_safety
        timeline *= global_safety_scale
    sf.write(OUTPUT_PATH, timeline, SAMPLE_RATE, subtype="PCM_24")
    report["output"] = str(OUTPUT_PATH)
    report["duration_seconds"] = round(len(timeline) / SAMPLE_RATE, 3)
    report["peak_before_global_safety"] = round(peak_before_safety, 8)
    report["global_safety_scale"] = round(global_safety_scale, 8)
    report["elapsed_seconds"] = round(time.monotonic() - started, 3)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Wrote {OUTPUT_PATH} ({len(timeline) / SAMPLE_RATE:.2f}s)")
    print(f"Wrote {REPORT_PATH}")


if __name__ == "__main__":
    main()
