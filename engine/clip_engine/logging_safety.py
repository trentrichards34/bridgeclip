"""Keep source URLs, paths, and provider diagnostics out of application logs."""

import logging
import re

_URL = re.compile(r"(?:https?|s3)://\S+", re.IGNORECASE)
# Unix paths (folder names may hold spaces, apostrophes, brackets…), Windows drive paths whose folders hold spaces
# (C:\Users\Trent Jones\…, up to the last backslash, then the file name), and UNC paths.
_SEGMENT = r"[\w.'’ ()\[\]{}@+,&~!#$%=-]"
_WIN_DIR = r"[^\\/\r\n\t:*?\"<>|]+"
_PATH = re.compile(
    rf"(?<![\w])~?(?:/{_SEGMENT}+){{2,}}"
    rf"|(?<![\w])[A-Za-z]:\\(?:{_WIN_DIR}\\)*(?:{_WIN_DIR}?\.[A-Za-z0-9]{{1,6}}\b|[^\s\\:*?\"<>|]*)"
    rf"|\\\\[^\s\\]+\\(?:{_WIN_DIR}\\)*[^\s\\]*"
)
_CREDENTIAL = re.compile(
    r"(?i)\b(?:authorization|api[_ -]?key|token|password|secret)\"?\s*[:=]\s*\"?(?:Bearer\s+|Basic\s+)?[^\s,;\"}]+"
)
# Keys with no label in front of them: OpenRouter/OpenAI-style keys, bearer/basic tokens, AWS access keys.
_BARE_KEY = re.compile(r"(?i)\b(?:sk|pk|rk)-(?:or-v\d+-)?[A-Za-z0-9_-]{12,}|\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}|\bAKIA[0-9A-Z]{16}\b")


def safe_log_text(value: object) -> str:
    text = str(value)
    text = _CREDENTIAL.sub("[redacted credential]", text)
    text = _BARE_KEY.sub("[redacted credential]", text)
    text = _URL.sub("[redacted URL]", text)
    text = _PATH.sub("[redacted path]", text)
    return text[:1000]


class SafeDiagnosticsFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            record.msg = safe_log_text(record.getMessage())
        except Exception:
            record.msg = "[diagnostic unavailable]"
        record.args = ()
        record.exc_info = None
        record.exc_text = None
        record.stack_info = None
        return True


def install_safe_logging() -> None:
    root = logging.getLogger()
    for handler in root.handlers:
        if not any(isinstance(item, SafeDiagnosticsFilter) for item in handler.filters):
            handler.addFilter(SafeDiagnosticsFilter())
