import base64
import gc
import io
import json
import os
import sys
import time
import traceback
from contextlib import nullcontext
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
    "clone": {},
    "device": None,
    "active": None,
}


def jprint(data):
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def trace(msg, **data):
    extra = " ".join(
        f"{key}={json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list, tuple)) else value}"
        for key, value in data.items()
        if value is not None
    )
    sys.stderr.write((f"[voice] {msg}" + (f" {extra}" if extra else "")) + "\n")
    sys.stderr.flush()


def clip(text, size=96):
    if not text:
        return None
    text = " ".join(str(text).split())
    if len(text) <= size:
        return text
    return text[:size] + "…"


def ref(file):
    if not file:
        return None
    return os.path.basename(file)


def mem():
    try:
        import torch

        if torch.cuda.is_available():
            return {
                "cuda_alloc_mb": round(torch.cuda.memory_allocated() / (1024 * 1024), 1),
                "cuda_reserved_mb": round(torch.cuda.memory_reserved() / (1024 * 1024), 1),
            }
    except Exception:
        pass
    return {}


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
    trace("engine.switch", current=state["active"], next=kind)
    state["active"] = kind
    clear()


def infer():
    try:
        import torch

        return torch.inference_mode()
    except Exception:
        return nullcontext()


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
        trace("stt.reuse", model=cfg["stt"]["model"], device=dev, **mem())
        return state["stt"]
    import whisperx

    state["stt"] = None
    state["stt_key"] = None
    state["align"] = {}
    clear()
    state["device"] = dev
    trace(
        "stt.load.begin",
        model=cfg["stt"]["model"],
        device=dev,
        compute_type=cfg["stt"]["compute_type"],
        beam_size=cfg["stt"]["beam_size"],
    )
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
    trace("stt.load.done", model=cfg["stt"]["model"], device=dev, **mem())
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
        trace("tts.reuse", model="k2-fsa/OmniVoice", device=state["device"], **mem())
        return state["tts"]
    import torch
    from omnivoice import OmniVoice

    dev = device(cfg)
    state["device"] = dev
    target = "cuda:0" if dev == "cuda" else dev
    trace("tts.load.begin", model="k2-fsa/OmniVoice", device=dev, target=target)
    model = OmniVoice.from_pretrained(
        "k2-fsa/OmniVoice",
        device_map=target,
        dtype=dtype(cfg),
    )
    state["tts"] = model
    trace("tts.load.done", model="k2-fsa/OmniVoice", device=dev, **mem())
    return model


def prime_stt(cfg):
    now = time.perf_counter()
    model = ensure_stt(cfg)
    try:
        import numpy as np

        audio = np.zeros(16000, dtype="float32")
        with infer():
            model.transcribe(
                audio,
                batch_size=1,
                language=None if cfg["stt"]["language"] == "auto" else cfg["stt"]["language"],
            )
    except Exception:
        pass
    lang = cfg["stt"].get("language")
    if not lang or lang == "auto":
        trace("stt.prime.done", duration_ms=round((time.perf_counter() - now) * 1000), language=lang, **mem())
        return
    try:
        ensure_align(cfg, lang)
    except Exception:
        pass
    trace("stt.prime.done", duration_ms=round((time.perf_counter() - now) * 1000), language=lang, **mem())


def prime_tts(cfg, req=None):
    now = time.perf_counter()
    model = ensure_tts(cfg)
    try:
        opts = {
            "text": "Oi.",
            "num_step": max(4, min(8, cfg["tts"].get("call_num_step") or cfg["tts"].get("num_step") or 8)),
            "speed": cfg["tts"].get("call_speed") or cfg["tts"].get("speed") or 1.0,
        }
        if req and req.get("ref_audio_path") and req.get("mode") != "design":
            opts["voice_clone_prompt"] = clone_prompt(model, req)
        with infer():
            audio = model.generate(**opts)
        wave = audio[0] if isinstance(audio, list) else audio
        len(wave)
    except Exception:
        pass
    trace(
        "tts.prime.done",
        duration_ms=round((time.perf_counter() - now) * 1000),
        mode=req.get("mode") if req else None,
        ref=ref(req.get("ref_audio_path")) if req else None,
        **mem(),
    )


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
    now = time.perf_counter()
    trace(
        "stt.req.begin",
        file=ref(req.get("path")),
        profile=req.get("profile"),
        partial=req.get("partial"),
        language=req.get("language") or cfg["stt"]["language"],
        diarization=req.get("diarization"),
        **mem(),
    )
    import whisperx

    model = ensure_stt(cfg)
    audio = whisperx.load_audio(req["path"])
    with infer():
        result = model.transcribe(
            audio,
            batch_size=cfg["stt"]["batch_size"],
            language=None if (req.get("language") or cfg["stt"]["language"]) == "auto" else (req.get("language") or cfg["stt"]["language"]),
        )
    if cfg["stt"]["timestamps"] != "none" and result.get("segments"):
        lang = result.get("language") or req.get("language") or cfg["stt"]["language"]
        if lang and lang != "auto":
            model_a, meta = ensure_align(cfg, lang)
            with infer():
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
    trace(
        "stt.req.done",
        file=ref(req.get("path")),
        duration_ms=round((time.perf_counter() - now) * 1000),
        text_len=len(out["text"]),
        text_head=clip(out["text"]),
        segments=len(seg),
        words=len(out["words"]),
        language=out.get("language"),
        **mem(),
    )
    return out


def text_used(req):
    text = req["text"].strip()
    tags = req.get("tags") or []
    if not tags:
        return text
    return " ".join([*tags, text]).strip()


def clone_key(req):
    file = req.get("ref_audio_path")
    if not file:
        return None
    try:
        stat = os.stat(file)
        tag = f"{stat.st_mtime_ns}:{stat.st_size}"
    except OSError:
        tag = "?"
    return json.dumps(
        {
            "file": os.path.abspath(file),
            "tag": tag,
            "text": req.get("ref_text") or "",
        },
        ensure_ascii=False,
        sort_keys=True,
    )


def clone_prompt(model, req):
    key = clone_key(req)
    if not key:
        return None
    hit = state["clone"].get(key)
    if hit is not None:
        trace("tts.clone.hit", ref=ref(req.get("ref_audio_path")))
        return hit
    trace("tts.clone.miss", ref=ref(req.get("ref_audio_path")), ref_text_len=len(req.get("ref_text") or ""))
    prompt = model.create_voice_clone_prompt(
        ref_audio=req.get("ref_audio_path"),
        ref_text=req.get("ref_text"),
    )
    state["clone"][key] = prompt
    while len(state["clone"]) > 2:
        state["clone"].pop(next(iter(state["clone"])))
    return prompt


def synthesize(cfg, req):
    now = time.perf_counter()
    model = ensure_tts(cfg)
    mode = req.get("mode")
    text = text_used(req)
    trace(
        "tts.req.begin",
        profile=req.get("profile"),
        rank=req.get("rank"),
        mode=mode,
        language=req.get("language"),
        speed=req.get("speed") or cfg["tts"].get("speed"),
        duration=req.get("duration") or cfg["tts"].get("duration"),
        num_step=req.get("num_step") or cfg["tts"].get("num_step"),
        ref=ref(req.get("ref_audio_path")),
        ref_text_len=len(req.get("ref_text") or ""),
        instruct_len=len(req.get("instruct") or ""),
        text_len=len(text),
        text_head=clip(text),
        **mem(),
    )
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
        opts["voice_clone_prompt"] = clone_prompt(model, req)
    else:
        if req.get("ref_audio_path"):
            opts["voice_clone_prompt"] = clone_prompt(model, req)
        if req.get("instruct"):
            opts["instruct"] = req.get("instruct")

    with infer():
        audio = model.generate(**opts)
    wave = audio[0] if isinstance(audio, list) else audio
    import soundfile as sf

    buf = io.BytesIO()
    sf.write(buf, wave, 24000, format="WAV")
    raw = buf.getvalue()
    out = {
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
    trace(
        "tts.req.done",
        profile=req.get("profile"),
        rank=req.get("rank"),
        mode=mode,
        duration_ms=round((time.perf_counter() - now) * 1000),
        audio_ms=out["duration_ms"],
        text_len=len(out["text_used"]),
        text_head=clip(out["text_used"]),
        **mem(),
    )
    return out


def main():
    for raw in load_json(sys.stdin):
        req = raw
        req_id = req.get("id")
        now = time.perf_counter()
        try:
            cmd = req.get("cmd")
            cfg = req.get("input", {}).get("cfg")
            trace("cmd.begin", id=req_id, cmd=cmd, engine=ENGINE, active=state["active"])
            if cmd == "status":
                out = {
                    "active_engine": ENGINE or state["active"],
                    "device": state["device"] or device(cfg),
                }
            elif cmd == "warm":
                if req["input"].get("stt"):
                    prime_stt(cfg)
                if req["input"].get("tts"):
                    prime_tts(cfg, req["input"].get("clone"))
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

            trace("cmd.done", id=req_id, cmd=cmd, duration_ms=round((time.perf_counter() - now) * 1000), active=state["active"], **mem())
            jprint({"id": req_id, "type": "ok", "result": out})
        except Exception as err:
            trace("cmd.err", id=req_id, cmd=req.get("cmd"), duration_ms=round((time.perf_counter() - now) * 1000), err=str(err), **mem())
            sys.stderr.write(traceback.format_exc() + "\n")
            sys.stderr.flush()
            jprint({"id": req_id, "type": "err", "error": str(err)})
        finally:
            clear()


if __name__ == "__main__":
    main()
