"""Instagram, TikTok, X and Facebook links are pages read with yt-dlp, optionally with the member's browser login."""
import asyncio
from types import SimpleNamespace

import pytest
from clip_engine.error_policy import safe_failure_code, safe_job_error_text, safe_processing_error
from clip_engine.services import video_downloader as module


def settings(browser=""):
    return SimpleNamespace(local_mode=True, max_download_duration_seconds=21600, download_login_browser=browser)


@pytest.fixture
def service(monkeypatch):
    monkeypatch.setattr(module, "get_settings", lambda: settings())
    return module.VideoDownloaderService()


@pytest.mark.parametrize("url", ["https://www.instagram.com/p/DeaEzA4Ndrd/", "https://instagram.com/reel/abc/", "https://www.tiktok.com/@a/video/1",
                                 "https://vm.tiktok.com/xyz/", "https://x.com/a/status/1", "https://www.facebook.com/watch?v=1", "https://fb.watch/abc/"])
def test_social_links_are_read_with_ytdlp(service, url):
    assert service.detect_source_type(url) == "social"


@pytest.mark.parametrize("url", ["https://example.com/video.mp4", "https://notinstagram.com/p/x", "https://instagram.com.evil.test/p/x"])
def test_other_links_stay_direct(service, url):
    assert service.detect_source_type(url) == "direct_url"


def test_youtube_is_unchanged(service):
    assert service.detect_source_type("https://www.youtube.com/watch?v=abcdefghijk") == "youtube"


def test_browser_login_only_for_social_links(monkeypatch):
    monkeypatch.setattr(module, "get_settings", lambda: settings("chrome"))
    opts = module.login_browser_opts("https://www.instagram.com/p/x/")
    assert opts["cookiesfrombrowser"] == ("chrome",)
    assert "generic" not in opts["allowed_extractors"] and not any("youtube" in e for e in opts["allowed_extractors"])
    assert module.login_browser_opts("https://www.youtube.com/watch?v=x") == {}
    monkeypatch.setattr(module, "get_settings", lambda: settings("netscape"))
    assert "cookiesfrombrowser" not in module.login_browser_opts("https://www.instagram.com/p/x/")
    monkeypatch.setattr(module, "get_settings", lambda: settings(""))
    assert "cookiesfrombrowser" not in module.login_browser_opts("https://www.instagram.com/p/x/")
    # Only the social sites' own extractors load: a post linking to YouTube or a web page isn't followed.
    import yt_dlp
    loaded = set(yt_dlp.YoutubeDL({"allowed_extractors": module.SOCIAL_EXTRACTORS, "quiet": True})._ies)
    assert {"Instagram", "TikTok", "Twitter", "Facebook", "Vimeo"} <= loaded and not ({"Youtube", "Generic", "FacebookRedirectURL"} & loaded)


@pytest.mark.parametrize("text, reason", [
    ("ERROR: [Instagram] DeaEzA4Ndrd: Requested content is not available, rate-limit reached or login required. Use --cookies", "login_required"),
    ("ERROR: [Instagram] x: Instagram sent an empty media response. Check if this post is accessible in your browser without being logged-in", "login_required"),
    ("ERROR: [Instagram] x: There is no video in this post", "no_video"),
    ("could not find chrome cookies database", "login_unreadable"),
    ("ERROR: Could not copy Chrome cookie database. See https://github.com/yt-dlp/yt-dlp/issues/7271", "login_unreadable"),
    ("ERROR: Failed to decrypt with DPAPI", "login_unreadable"),
    ("ERROR: Unsupported URL: https://www.youtube.com/watch?v=x", "no_video"),
])
def test_social_failures_are_explained(text, reason):
    error = module.social_failure("https://www.instagram.com/p/x/", Exception(text))
    assert error.reason == reason
    assert safe_failure_code(error) == f"download.{reason}"
    assert safe_job_error_text(safe_processing_error(error)) == safe_processing_error(error)
    assert module.social_failure("https://www.youtube.com/watch?v=x", Exception(text)) is None


def test_download_routes_social_links_and_explains_a_login_wall(service, monkeypatch):
    seen = {}

    async def fake(url, output_path, output_dir, max_duration_seconds=None, source_type="youtube"):
        seen["source_type"] = source_type
        raise Exception("ERROR: [Instagram] x: Requested content is not available, rate-limit reached or login required")
    monkeypatch.setattr(service, "_download_from_youtube", fake)
    with pytest.raises(module.VideoDownloadError) as error:
        asyncio.run(service.download_video("https://www.instagram.com/p/DeaEzA4Ndrd/", "/tmp/social-test"))
    assert seen["source_type"] == "social"
    assert error.value.reason == "login_required"
    assert "Instagram" in str(error.value)


def test_a_social_post_without_a_listed_length_is_measured_after_download(service, monkeypatch, tmp_path):
    """Instagram often omits the length: the file is downloaded and its measured length used (YouTube still refuses)."""
    async def info(url, deadline=None):
        return module.VideoMetadata(title="Post", duration_seconds=0, width=0, height=0, fps=0, format_id="", extractor="Instagram", uploader="coach")
    monkeypatch.setattr(service, "_get_video_info", info)
    out = tmp_path / "source.mp4"

    class FakeYDL:
        def __init__(self, opts): self.opts = opts
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def download(self, urls): out.write_bytes(b"video")
    monkeypatch.setattr(module.yt_dlp, "YoutubeDL", FakeYDL)

    async def probe(path):
        return module.VideoMetadata(title="", duration_seconds=31.5, width=1080, height=1920, fps=30, format_id="mp4", extractor="file")
    monkeypatch.setattr(service, "_get_video_metadata_ffprobe", probe)
    result = asyncio.run(service.download_video("https://www.instagram.com/p/DeaEzA4Ndrd/", str(tmp_path)))
    assert result.metadata.duration_seconds == 31.5 and result.metadata.uploader == "coach"
    with pytest.raises(module.VideoDownloadError, match="duration is unavailable"):
        asyncio.run(service._download_from_youtube("https://www.youtube.com/watch?v=abcdefghijk", str(out), str(tmp_path)))
