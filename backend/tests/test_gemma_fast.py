"""Gemma speed work: the answer cache, the compact private-data answer format and the sentence shortlist.

No model is needed: `gemma._run_model` is faked, so these tests check our code, not Gemma.
"""

import pytest

from backend import gemma


@pytest.fixture
def model(monkeypatch, tmp_path):
    """Gemma 'loaded', with a counting fake model and an empty cache file in tmp_path."""

    class Fake:
        def __init__(self):
            self.calls = []
            self.answer = "NONE"

    fake = Fake()

    def run(system, user, max_tokens, temperature):
        fake.calls.append((system, user, max_tokens))
        return fake.answer

    monkeypatch.setattr(gemma, "_status", "loaded")
    monkeypatch.setattr(gemma, "_enabled", lambda: True)
    monkeypatch.setattr(gemma, "_run_model", run)
    monkeypatch.setenv("GEMMA_CACHE_FILE", str(tmp_path / "cache.jsonl"))
    monkeypatch.delenv("GEMMA_CACHE", raising=False)
    monkeypatch.setattr(gemma, "_cache", {})
    monkeypatch.setattr(gemma, "_cache_loaded", False)
    return fake


# --------------------------------------------------------------------------- cache


def test_same_prompt_is_answered_from_the_cache(model):
    model.answer = "PERSON|Priya"
    assert gemma.generate("sys", "Hello Priya") == "PERSON|Priya"
    assert gemma.generate("sys", "Hello Priya") == "PERSON|Priya"
    assert len(model.calls) == 1


def test_a_different_input_prompt_or_limit_is_a_cache_miss(model):
    gemma.generate("sys", "one")
    gemma.generate("sys", "two")
    gemma.generate("other prompt", "one")
    gemma.generate("sys", "one", max_tokens=24)
    assert len(model.calls) == 4


def test_cache_survives_a_restart(model):
    model.answer = "ORG|Henderson"
    gemma.generate("sys", "Henderson called")
    gemma._cache.clear()  # what a restart does to memory
    gemma._cache_loaded = False
    assert gemma.generate("sys", "Henderson called") == "ORG|Henderson"
    assert len(model.calls) == 1


def test_cache_can_be_switched_off(model, monkeypatch):
    monkeypatch.setenv("GEMMA_CACHE", "false")
    gemma.generate("sys", "x")
    gemma.generate("sys", "x")
    assert len(model.calls) == 2


def test_empty_answers_are_not_cached(model):
    model.answer = "   "
    gemma.generate("sys", "x")
    gemma.generate("sys", "x")
    assert len(model.calls) == 2


def test_a_corrupt_cache_file_is_ignored(model, tmp_path):
    (tmp_path / "cache.jsonl").write_text("not json\n{\"k\": 1}\n", encoding="utf-8")
    model.answer = "NONE"
    assert gemma.generate("sys", "x") == "NONE"
    assert len(model.calls) == 1


# --------------------------------------------------------------------------- compact private-data answers


def test_type_pipe_text_lines_become_entities():
    chunk = "Priya at Henderson Logistics ships Project Falcon"
    found = gemma._parse_entities("PERSON|Priya\nORG|Henderson Logistics\n- PROJECT| Project Falcon", chunk)
    assert [(e["type"], e["text"]) for e in found] == [("PERSON", "Priya"), ("ORG", "Henderson Logistics"), ("PROJECT", "Project Falcon")]


def test_none_and_fenced_none_mean_nothing_found():
    assert gemma._parse_entities("NONE", "x y") == []
    assert gemma._parse_entities("```\nNone.\n```", "x y") == []


def test_lines_naming_text_not_in_the_chunk_are_dropped():
    assert gemma._parse_entities("PERSON|Somebody Else", "Priya was here") == []


def test_unknown_type_becomes_other_and_the_old_json_format_still_parses():
    assert gemma._parse_entities("WIZARD|Priya", "hi Priya")[0]["type"] == "OTHER"
    assert gemma._parse_entities('{"entities":[{"text":"Priya","type":"PERSON","reason":"name"}]}', "hi Priya")[0]["text"] == "Priya"


def test_an_answer_with_no_format_is_unusable():
    with pytest.raises(ValueError):
        gemma._parse_entities("I think the text is fine overall", "x")


def test_unusable_answer_is_retried_once_then_skipped(model):
    model.answer = "no idea"
    assert gemma._detect_chunk("Priya Menon wrote this") is None
    assert len(model.calls) == 2
    assert model.calls[1][1].endswith("Answer only with TYPE|text lines, or NONE.")


def test_private_data_prompt_is_short_and_capped(model):
    model.answer = "NONE"
    gemma.detect("Priya Menon owns Project Falcon.")
    system, _user, cap = model.calls[0]
    assert system == gemma.DETECT_SYSTEM_PROMPT and len(system.split()) < 130
    assert cap == gemma.DETECT_MAX_TOKENS <= 96


# --------------------------------------------------------------------------- shortlist


def test_nothing_private_looking_never_reaches_the_model(model):
    assert gemma.detect("draft a reply to the team and keep it short.") == []
    assert model.calls == []


def test_only_sentences_that_could_hold_private_data_are_sent(model):
    model.answer = "PERSON|Priya"
    found = gemma.detect("the weather is fine. Priya Menon called about the renewal. please keep it short.")
    assert [e["text"] for e in found] == ["Priya"]
    sent = model.calls[0][1]
    assert "Priya Menon called about the renewal." in sent
    assert "the weather is fine" not in sent and "keep it short" not in sent


@pytest.mark.parametrize(
    "sentence, expected",
    [
        ("Draft a reply to the team.", False),
        ("the quarterly numbers look fine.", False),
        ("Call me on 555 0143.", True),
        ("Ask Priya about it.", True),
        ("Mateo owns the rollout.", True),
        ("the patient has diabetes.", True),
        ("mail it to a@b.test", True),
    ],
)
def test_pii_shortlist_rule(sentence, expected):
    assert gemma._pii_worth_asking(sentence) is expected
