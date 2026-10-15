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
    assert module.login_browser_opts("https://www.instagram.com/p/x/") == {"cookiesfrombrowser": ("chrome",)}
    assert module.login_browser_opts("https://www.youtube.com/watch?v=x") == {}
    monkeypatch.setattr(module, "get_settings", lambda: settings("netscape"))
    assert module.login_browser_opts("https://www.instagram.com/p/x/") == {}
    monkeypatch.setattr(module, "get_settings", lambda: settings(""))
    assert module.login_browser_opts("https://www.instagram.com/p/x/") == {}


@pytest.mark.parametrize("text, reason", [
    ("ERROR: [Instagram] DeaEzA4Ndrd: Requested content is not available, rate-limit reached or login required. Use --cookies", "login_required"),
    ("ERROR: [Instagram] x: Instagram sent an empty media response. Check if this post is accessible in your browser without being logged-in", "login_required"),
    ("ERROR: [Instagram] x: There is no video in this post", "no_video"),
    ("could not find chrome cookies database", "login_unreadable"),
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
