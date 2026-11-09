import logging

from clip_engine.logging_safety import SafeDiagnosticsFilter


def test_log_filter_removes_urls_paths_and_credentials():
    record = logging.LogRecord(
        name="test", level=logging.ERROR, pathname=__file__, lineno=1,
        msg="Download https://example.com/video?token=value from /Users/person/private/file.mp4 Authorization: Bearer secret-value",
        args=(), exc_info=None,
    )
    assert SafeDiagnosticsFilter().filter(record)
    text = record.getMessage()
    assert "example.com" not in text
    assert "person" not in text
    assert "secret-value" not in text


def test_log_filter_removes_json_credentials():
    record = logging.LogRecord(
        name="test", level=logging.ERROR, pathname=__file__, lineno=1,
        msg='Provider rejected {"api_key":"secret-value"}', args=(), exc_info=None,
    )
    assert SafeDiagnosticsFilter().filter(record)
    assert "secret-value" not in record.getMessage()


def test_paths_with_spaces_apostrophes_and_bare_keys_are_redacted():
    from clip_engine.logging_safety import safe_log_text
    leaks = {
        r"Failed at C:\Users\Trent Jones\Videos\my clip (1).mp4 while rendering": ["Trent", "Jones", "my clip"],
        r"open C:\Program Files\CreatorClips\ffmpeg.exe: denied": ["Program Files", "CreatorClips"],
        r"\\nas\share\Trent Jones\x.mp4 gone": ["Trent", "nas"],
        "/Users/trent/It's mine/clip.mp4 failed": ["trent", "mine"],
        "/home/o'brien/Videos/[draft] take.webm": ["o'brien", "draft"],
        "key sk-or-v1-abcdef0123456789abcdef rejected": ["abcdef0123456789"],
        "header Bearer abc.def-123456789xyz sent": ["abc.def-123456789xyz"],
        "aws AKIAABCDEFGHIJKLMNOP used": ["AKIAABCDEFGHIJKLMNOP"],
    }
    for text, secrets in leaks.items():
        cleaned = safe_log_text(text)
        for secret in secrets:
            assert secret not in cleaned, (text, cleaned)
    assert safe_log_text("Remix 1 of 2: rendering 3/4 done") == "Remix 1 of 2: rendering 3/4 done"
