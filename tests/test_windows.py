from pomo.windows import StubWindowSource, classify

RULES = {
    "study": {"apps": ["code"], "titles": ["khan academy", "lecture"]},
    "distraction": {"apps": ["steam"], "titles": ["youtube"]},
}


def test_classify():
    assert classify("Code", "main.py", RULES) == "study"
    assert classify("firefox", "Algebra | Khan Academy", RULES) == "study"
    assert classify("firefox", "Funny cats - YouTube", RULES) == "distraction"
    assert classify("firefox", "Lecture 3 - YouTube", RULES) == "study"  # study wins
    assert classify("steam", "Library", RULES) == "distraction"
    assert classify("nautilus", "Downloads", RULES) == "neutral"


def test_stub():
    assert StubWindowSource().category() == "neutral"
