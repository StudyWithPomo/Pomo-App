import asyncio
import json
import socket
import threading
import urllib.request

import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus

from pomo.server import Hub


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def hub():
    calls: list[bool] = []
    h = Hub(calls.append, http_port=free_port(), ws_port=free_port())
    h.start()
    h.calls = calls
    yield h
    h.stop()


def test_serves_dashboard(hub):
    with urllib.request.urlopen(f"http://127.0.0.1:{hub.http_port}/") as r:
        assert r.status == 200
        assert b"Study Buddy" in r.read()
    with urllib.request.urlopen(f"http://127.0.0.1:{hub.http_port}/app.js") as r:
        assert r.status == 200


def test_camera_commands_and_ticks(hub):
    origin = f"http://localhost:{hub.http_port}"

    async def go():
        async with connect(f"ws://127.0.0.1:{hub.ws_port}", origin=origin) as ws:
            await ws.send(json.dumps({"t": "camera", "on": True}))
            await asyncio.sleep(0.2)
            assert hub.calls == [True]
            threading.Thread(target=hub.publish, args=({"t": "focus", "focus": 88},)).start()
            msg = json.loads(await asyncio.wait_for(ws.recv(), 3))
            assert msg == {"t": "focus", "focus": 88}
        await asyncio.sleep(0.3)
        assert hub.calls[-1] is False  # page closed -> camera off

    asyncio.run(go())


def test_rejects_foreign_origin(hub):
    async def go():
        with pytest.raises(InvalidStatus):
            async with connect(f"ws://127.0.0.1:{hub.ws_port}", origin="https://evil.example"):
                pass

    asyncio.run(go())
