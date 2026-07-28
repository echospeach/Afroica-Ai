from app.llm import _trim_history
from app.plans import MAX_HISTORY_MESSAGES


def _msg(role: str, i: int) -> dict:
    return {"role": role, "content": f"message {i}"}


def test_short_history_is_untouched():
    messages = [_msg("user", 0), _msg("assistant", 1), _msg("user", 2)]
    assert _trim_history(messages) == messages


def test_long_history_is_trimmed_to_the_cap():
    messages = [_msg("user" if i % 2 == 0 else "assistant", i) for i in range(60)]
    trimmed = _trim_history(messages)
    assert len(trimmed) <= MAX_HISTORY_MESSAGES
    assert trimmed[-1] == messages[-1]


def test_trimmed_history_always_starts_with_user():
    # 60 alternating messages starting on "assistant" at index 0 means a
    # naive messages[-N:] slice could land on an "assistant" first entry.
    messages = [_msg("assistant" if i % 2 == 0 else "user", i) for i in range(61)]
    trimmed = _trim_history(messages)
    assert trimmed[0]["role"] == "user"


def test_empty_history_returns_empty():
    assert _trim_history([]) == []
