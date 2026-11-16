"""Run one real Seeker resolution from the command line."""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.resolve import resolve
from app.schema import Page, ResolveRequest


async def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit('Usage: py scripts/try_resolve.py "selection" "context"')

    request = ResolveRequest(
        selection=sys.argv[1],
        context=sys.argv[2],
        page=Page(title="Command-line lookup", domain="localhost"),
    )
    result = await resolve(request)
    print(json.dumps(result.model_dump(), indent=2))


if __name__ == "__main__":
    asyncio.run(main())
