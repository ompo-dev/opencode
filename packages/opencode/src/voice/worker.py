import base64
import gc
import io
import json
import os
import sys
import traceback
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(os.environ.get("OPENCODE_VOICE_ROOT", ".")).resolve()
TMP = ROOT / "tmp"
TMP.mkdir(parents=True, exist_ok=True)
ENGINE = os.environ.get("OPENCODE_VOICE_ENGINE") or None

state = {
    "stt": None,
    "stt_key": None,
    "align": {},
    "tts": None,
    "device": None,
    "active": None,
}


def jprint(data):
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def clear():
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def guard(kind):
    if ENGINE and ENGINE != kind:
        raise ValueError(f"Voice worker for {ENGINE} cannot run {kind} commands")


def device(cfg):
    import torch

    want = cfg["runtime"]["device"]
    if want == "cpu":
        return "cpu"
    if want == "mps":
        return "mps"
    if want == "cuda":
        return "cuda"
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def dtype(cfg):
    import torch

    want = cfg["runtime"]["dtype"]
    if want == "float32":
        return torch.float32
    if want == "int8":
        return torch.float32
    if want == "float16":
        return torch.float16
    if device(cfg) == "cuda":
        return torch.float16
    return torch.float32


def active(kind):
    guard(kind)
    if state["active"] == kind:
        return
    state["active"] = kind
    clear()


def ensure_stt(cfg):
    active("stt")
    dev = device(cfg)
    key = json.dumps(
        {
            "model": cfg["stt"]["model"],
            "device": dev,
            "compute_type": cfg["stt"]["compute_type"],
            "beam_size": cfg["stt"]["beam_size"],
        },
        sort_keys=True,
    )
    if state["stt"] is not None and state["stt_key"] == key:
        return state["stt"]
    import whisperx

    state["stt"] = None
    state["stt_key"] = None
    state["align"] = {}
    clear()
    state["device"] = dev
    model = whisperx.load_model(
        cfg["stt"]["model"],
        dev,
        compute_type=cfg["stt"]["compute_type"],
        asr_options={
            "beam_size": cfg["stt"]["beam_size"],
        },
        language=None if cfg["stt"]["language"] == "auto" else cfg["stt"]["language"],
        vad_method="silero",
    )
    state["stt"] = model
    state["stt_key"] = key
    return model


def ensure_align(cfg, language):
    key = f"{device(cfg)}:{language}"
    hit = state["align"].get(key)
    if hit:
        return hit
    import whisperx

    model, meta = whisperx.load_align_model(language_code=language, device=device(cfg))
    state["align"][key] = (model, meta)
    return model, meta


def ensure_tts(cfg):
    active("tts")
    if state["tts"] is not None:
        return state["tts"]
    import torch
    from omnivoice import OmniVoice

    dev = device(cfg)
    state["device"] = dev
    target = "cuda:0" if dev == "cuda" else dev
    model = OmniVoice.from_pretrained(
        "k2-fsa/OmniVoice",
        device_map=target,
        dtype=dtype(cfg),
    )
    state["tts"] = model
    return model


def prime_stt(cfg):
    model = ensure_stt(cfg)
    try:
        import numpy as np

        audio = np.zeros(16000, dtype="float32")
        model.transcribe(
            audio,
            batch_size=1,
            language=None if cfg["stt"]["language"] == "auto" else cfg["stt"]["language"],
        )
    except Exception:
        pass
    lang = cfg["stt"].get("language")
    if not lang or lang == "auto":
        return
    try:
        ensure_align(cfg, lang)
    except Exception:
        pass


def prime_tts(cfg):
    model = ensure_tts(cfg)
    try:
        audio = model.generate(
            text="Oi.",
            num_step=max(4, min(8, cfg["tts"].get("call_num_step") or cfg["tts"].get("num_step") or 8)),
            speed=cfg["tts"].get("call_speed") or cfg["tts"].get("speed") or 1.0,
        )
        wave = audio[0] if isinstance(audio, list) else audio
        len(wave)
    except Exception:
        pass


def load_json(stdin):
    for line in stdin:
        if not line.strip():
            continue
        yield json.loads(line)


def words(result):
    out = []
    for seg in result.get("segments", []):
        for word in seg.get("words", []) or []:
            if not isinstance(word, dict):
                continue
            item = {
                "word": str(word.get("word") or word.get("text") or "").strip(),
                "start": word.get("start"),
                "end": word.get("end"),
                "score": word.get("score"),
            }
            if seg.get("speaker"):
                item["speaker"] = seg.get("speaker")
            if item["word"]:
                out.append(item)
    return out


def segments(result):
    out = []
    for idx, seg in enumerate(result.get("segments", [])):
        if not isinstance(seg, dict):
            continue
        item = {
            "id": seg.get("id", idx),
            "text": seg.get("text") or "",
            "start": seg.get("start"),
            "end": seg.get("end"),
        }
        if seg.get("speaker"):
            item["speaker"] = seg.get("speaker")
        if seg.get("words"):
            item["words"] = words({"segments": [seg]})
        out.append(item)
    return out


def transcribe(cfg, req):
    import whisperx

    model = ensure_stt(cfg)
    audio = whisperx.load_audio(req["path"])
    result = model.transcribe(
        audio,
        batch_size=cfg["stt"]["batch_size"],
        language=None if (req.get("language") or cfg["stt"]["language"]) == "auto" else (req.get("language") or cfg["stt"]["language"]),
    )
    if cfg["stt"]["timestamps"] != "none" and result.get("segments"):
        lang = result.get("language") or req.get("language") or cfg["stt"]["language"]
        if lang and lang != "auto":
            model_a, meta = ensure_align(cfg, lang)
            result = whisperx.align(
                result["segments"],
                model_a,
                meta,
                audio,
                device(cfg),
                return_char_alignments=False,
            )

    diarize = (req.get("diarization") if req.get("diarization") is not None else cfg["stt"]["diarization"]) and cfg["runtime"].get("hf_token")
    if diarize:
        from whisperx.diarize import DiarizationPipeline

        dia = DiarizationPipeline(token=cfg["runtime"]["hf_token"], device=device(cfg))
        spans = dia(audio)
        result = whisperx.assign_word_speakers(spans, result)

    seg = segments(result)
    wrd = words(result)
    labels = sorted({item["speaker"] for item in wrd if item.get("speaker")})
    out = {
        "text": " ".join((item["text"] or "").strip() for item in seg).strip(),
        "duration_ms": int((result.get("segments", [{}])[-1].get("end") or 0) * 1000) if result.get("segments") else 0,
        "segments": seg,
        "words": [] if cfg["stt"]["timestamps"] == "segment" else wrd,
        "raw": result,
    }
    if result.get("language"):
        out["language"] = result.get("language")
    if labels:
        out["speaker_labels"] = labels
    return out


def text_used(req):
    text = req["text"].strip()
    tags = req.get("tags") or []
    if not tags:
        return text
    return " ".join([*tags, text]).strip()


def synthesize(cfg, req):
    model = ensure_tts(cfg)
    mode = req.get("mode")
    text = text_used(req)
    opts = {
        "text": text,
        "num_step": req.get("num_step") or cfg["tts"].get("num_step"),
        "speed": req.get("speed") or cfg["tts"].get("speed"),
    }
    if req.get("duration") or cfg["tts"].get("duration"):
        opts["duration"] = req.get("duration") or cfg["tts"].get("duration")
    if req.get("language"):
        opts["language_id"] = req.get("language")

    if mode == "design":
        if req.get("instruct"):
            opts["instruct"] = req.get("instruct")
    elif mode == "clone":
        if not req.get("ref_audio_path"):
            raise ValueError("Voice cloning requires ref_audio_path")
        opts["ref_audio"] = req.get("ref_audio_path")
        if req.get("ref_text"):
            opts["ref_text"] = req.get("ref_text")
    else:
        if req.get("ref_audio_path"):
            opts["ref_audio"] = req.get("ref_audio_path")
            if req.get("ref_text"):
                opts["ref_text"] = req.get("ref_text")
        if req.get("instruct"):
            opts["instruct"] = req.get("instruct")

    audio = model.generate(**opts)
    wave = audio[0] if isinstance(audio, list) else audio
    import soundfile as sf

    buf = io.BytesIO()
    sf.write(buf, wave, 24000, format="WAV")
    raw = buf.getvalue()
    return {
        "mime": "audio/wav",
        "sample_rate": 24000,
        "duration_ms": int((len(wave) / 24000) * 1000),
        "text_used": text,
        "audio": "data:audio/wav;base64," + base64.b64encode(raw).decode("ascii"),
        "meta": {
            "mode": mode or "auto",
            "device": state["device"],
        },
    }


def main():
    for raw in load_json(sys.stdin):
        req = raw
        req_id = req.get("id")
        try:
            cmd = req.get("cmd")
            cfg = req.get("input", {}).get("cfg")
            if cmd == "status":
                out = {
                    "active_engine": ENGINE or state["active"],
                    "device": state["device"] or device(cfg),
                }
            elif cmd == "warm":
                if req["input"].get("stt"):
                    prime_stt(cfg)
                if req["input"].get("tts"):
                    prime_tts(cfg)
                out = {
                    "active_engine": state["active"],
                    "device": state["device"],
                }
            elif cmd == "transcribe":
                out = transcribe(cfg, req["input"])
            elif cmd == "synthesize":
                out = synthesize(cfg, req["input"])
            else:
                raise ValueError(f"Unknown command: {cmd}")

            jprint({"id": req_id, "type": "ok", "result": out})
        except Exception as err:
            sys.stderr.write(traceback.format_exc() + "\n")
            sys.stderr.flush()
            jprint({"id": req_id, "type": "err", "error": str(err)})


if __name__ == "__main__":
    main()
