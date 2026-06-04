#!/usr/bin/env python3
"""
Serveur local pour la démo web fraud-agent-demo.
Sert les fichiers statiques (index.html, app.js) et proxy les appels
vers l'API Anthropic pour contourner les restrictions CORS navigateur.

Usage :
    cd demo-web/
    python server.py
    # Ouvre http://localhost:8765 dans le navigateur
"""

import json
import os
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

PORT = 8765
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
STATIC_DIR = Path(__file__).parent

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".ico": "image/x-icon",
    ".json": "application/json",
}


class DemoHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} — {fmt % args}")

    def _send_json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        # Pré-vol CORS
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type, x-api-key")
        self.end_headers()

    def do_GET(self):
        # Rediriger / vers index.html
        path = self.path.split("?")[0]
        if path == "/" or path == "":
            path = "/index.html"

        file_path = STATIC_DIR / path.lstrip("/")

        if not file_path.exists() or not file_path.is_file():
            self.send_error(404, "Fichier introuvable")
            return

        suffix = file_path.suffix.lower()
        mime = MIME_TYPES.get(suffix, "application/octet-stream")
        content = file_path.read_bytes()

        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        if self.path != "/api/anthropic":
            self.send_error(404, "Endpoint inconnu")
            return

        # Lire le corps de la requête
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        # Clé API : d'abord l'en-tête transmis par le navigateur, puis la variable d'env
        api_key = (
            self.headers.get("x-api-key")
            or os.environ.get("ANTHROPIC_API_KEY", "")
        ).strip()

        if not api_key:
            self._send_json(401, {
                "error": {
                    "type": "authentication_error",
                    "message": "Clé API manquante — saisissez-la dans le formulaire ou exportez ANTHROPIC_API_KEY.",
                }
            })
            return

        # Proxy vers l'API Anthropic
        req = urllib.request.Request(
            ANTHROPIC_URL,
            data=body,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "anthropic-beta": "interleaved-thinking-2025-05-14",
                "content-type": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                resp_body = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(resp_body)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(resp_body)
        except urllib.error.HTTPError as e:
            err_body = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(err_body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(err_body)
        except Exception as exc:
            self._send_json(502, {"error": {"message": str(exc)}})


if __name__ == "__main__":
    server = HTTPServer(("localhost", PORT), DemoHandler)
    print(f"\n  Agent Fraude — Démo Web")
    print(f"  ═══════════════════════")
    print(f"  → http://localhost:{PORT}\n")
    print("  Ctrl+C pour arrêter\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Serveur arrêté.")
        server.server_close()
