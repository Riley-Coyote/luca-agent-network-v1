"""Serve a built folder for the Playwright tests.

`python3 -m http.server` keeps only 5 connections waiting to be accepted. The
app asks for about 100 script files at once, so on a busy Mac some of those
connections are reset (net::ERR_CONNECTION_RESET), a dynamic import fails and
the page stays blank, failing a different set of tests each run (measured
2026-11-17). This server answers on threads and keeps 128 waiting.

    python3 scripts/serve-dist.py <port> <folder>
"""

import functools
import http.server
import sys


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128


def main() -> None:
    port = int(sys.argv[1])
    folder = sys.argv[2]
    handler = functools.partial(
        http.server.SimpleHTTPRequestHandler, directory=folder
    )
    with Server(("127.0.0.1", port), handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
