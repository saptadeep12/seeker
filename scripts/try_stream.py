"""Stream one lookup from a running local Seeker backend."""

import json
import sys
import time
from urllib.request import Request, urlopen


def main() -> None:
    if len(sys.argv) not in {3, 4}:
        raise SystemExit(
            'Usage: py scripts/try_stream.py "selection" "context" [base_url]'
        )

    selection, context = sys.argv[1:3]
    base_url = sys.argv[3] if len(sys.argv) == 4 else "http://127.0.0.1:8000"
    payload = json.dumps(
        {
            "selection": selection,
            "context": context,
            "page": {"title": "CLI lookup", "domain": "localhost"},
            "lang": "en",
        }
    ).encode("utf-8")
    request = Request(
        f"{base_url}/v1/resolve",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "X-Install-Token": "local-test-token",
        },
        method="POST",
    )

    started = time.perf_counter()
    first_meaning = None
    final_result = None
    with urlopen(request) as response:
        event_name = None
        data_lines: list[str] = []
        for raw_line in response:
            line = raw_line.decode("utf-8").rstrip("\r\n")
            if line.startswith("event: "):
                event_name = line[7:]
            elif line.startswith("data: "):
                data_lines.append(line[6:])
            elif not line and event_name is not None:
                data = json.loads("".join(data_lines))
                now = time.perf_counter()
                print(f"{event_name}: {json.dumps(data, ensure_ascii=False)}")
                if event_name == "meaning" and first_meaning is None:
                    first_meaning = now
                if event_name == "result":
                    final_result = now
                event_name = None
                data_lines = []

    if first_meaning is not None:
        print(f"time to first meaning: {first_meaning - started:.3f}s")
    if final_result is not None:
        print(f"time to final result: {final_result - started:.3f}s")


if __name__ == "__main__":
    main()
