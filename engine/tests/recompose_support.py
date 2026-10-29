"""Helpers for recompose tests: block every AI or network call, run recompose, and read a remix's edit bundle."""

import asyncio
import json
import os
from pathlib import Path

from clip_engine.services import remix_service as remix
from clip_engine.services import segmentation


def no_ai(monkeypatch):
    """Recompose must not reach a model, a transcription service, the network or the cut-out model."""
    def boom(*args, **kwargs):
        raise AssertionError("no AI or network calls while recomposing")

    async def aboom(*args, **kwargs):
        boom()
    import httpx
    import clip_engine.services.transcription_service as ts
    monkeypatch.setattr(remix, "chat_completion", aboom)
    monkeypatch.setattr(ts, "TranscriptionService", boom)
    monkeypatch.setattr(remix.OpenRouterMedia, "__init__", boom)
    monkeypatch.setattr(httpx.AsyncClient, "send", aboom)
    monkeypatch.setattr(segmentation, "write_matte", boom)


def spy_captions(monkeypatch) -> list:
    """Each caption request's (text, style) while the spy is on."""
    from clip_engine.services.caption_generator import CaptionGeneratorService
    original = CaptionGeneratorService.generate_captions
    seen = []

    async def spy(self, **kw):
        seen.append((" ".join(s.text for s in kw["transcript_segments"]), kw["caption_style"]))
        return await original(self, **kw)
    monkeypatch.setattr(CaptionGeneratorService, "generate_captions", spy)
    return seen


def recompose(root, clip="clip_00", name="clip_00-edit.mp4", **settings) -> dict:
    request = remix.RecomposeRequest(output_dir=str(root), clip=clip, output_path=os.path.join(str(root), name),
                                     headline=settings.pop("headline", "A brand new hook for this video"), **settings)
    return asyncio.run(remix.recompose(request))


def bundle(out: dict) -> tuple[Path, dict, int]:
    """A rendered remix's edit folder, its edit.json and the folder's size in bytes."""
    folder = Path(out["path"]).parent / remix.EDIT_DIR / Path(out["path"]).stem
    data = json.loads((folder / "edit.json").read_text())
    size = sum(p.stat().st_size for p in folder.iterdir() if p.is_file())
    assert data["version"] == remix.EDIT_VERSION and out["editable"] == remix.editable_of(data)
    assert json.load(open(out["manifest_path"]))["editable"] == out["editable"]
    return folder, data, size
