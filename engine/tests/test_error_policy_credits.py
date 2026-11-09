"""An OpenRouter 402 (no credit left) reaches the app as its own fixed message and code."""

import sys
from pathlib import Path

from clip_engine.error_policy import safe_failure_code, safe_job_error_text, safe_processing_error
from clip_engine.services.openrouter import OpenRouterError

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "bridge"))


def test_out_of_credits_is_reported_plainly():
    error = OpenRouterError("OpenRouter account is out of credits. Add credits at openrouter.ai/credits.")
    assert safe_processing_error(error) == "OpenRouter account is out of credits"
    assert safe_failure_code(error) == "openrouter.out_of_credits"
    assert safe_job_error_text("OpenRouter account is out of credits") == "OpenRouter account is out of credits"


def test_wrapped_out_of_credits_is_found_in_the_chain():
    try:
        try:
            raise OpenRouterError("OpenRouter account is out of credits.")
        except OpenRouterError as inner:
            raise RuntimeError("planning failed") from inner
    except RuntimeError as outer:
        assert safe_processing_error(outer) == "OpenRouter account is out of credits"
        assert safe_failure_code(outer) == "openrouter.out_of_credits"


def test_other_openrouter_errors_are_unchanged():
    error = OpenRouterError("OpenRouter API error (500)")
    assert safe_processing_error(error) == "Processing failed"
    assert safe_failure_code(error) == "pipeline.failed"


def test_bridge_explains_the_message():
    from bridge_runner import describe_failure
    described = describe_failure("OpenRouter account is out of credits")
    assert "out of credits" in described["message"]
    assert "openrouter.ai" in described["hint"]
