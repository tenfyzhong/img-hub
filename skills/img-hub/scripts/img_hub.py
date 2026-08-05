#!/usr/bin/env python3
"""Dependency-free ImgHub API client for AI agents."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path


def configuration() -> tuple[str, str]:
    base_url = os.environ.get("IMG_HUB_URL", "").strip().rstrip("/")
    api_key = os.environ.get("IMG_HUB_API_KEY", "").strip()
    missing = [name for name, value in (
        ("IMG_HUB_URL", base_url),
        ("IMG_HUB_API_KEY", api_key),
    ) if not value]
    if missing:
        raise ValueError(f"Missing required environment variables: {', '.join(missing)}")

    parsed = urllib.parse.urlparse(base_url)
    local_hosts = {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not (
        parsed.scheme == "http" and parsed.hostname in local_hosts
    ):
        raise ValueError("IMG_HUB_URL must use HTTPS (HTTP is allowed only for localhost)")
    if not parsed.netloc or parsed.path not in ("", "/"):
        raise ValueError("IMG_HUB_URL must be an origin without a path")
    return base_url, api_key


def multipart_file(path: Path, directory: str | None) -> tuple[bytes, str]:
    boundary = f"img-hub-{uuid.uuid4().hex}"
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    chunks: list[bytes] = []

    def add(value: str) -> None:
        chunks.append(value.encode("utf-8"))

    if directory is not None:
        add(f"--{boundary}\r\n")
        add('Content-Disposition: form-data; name="directory"\r\n\r\n')
        add(directory)
        add("\r\n")
    quoted_name = path.name.replace('"', "")
    add(f"--{boundary}\r\n")
    add(f'Content-Disposition: form-data; name="file"; filename="{quoted_name}"\r\n')
    add(f"Content-Type: {content_type}\r\n\r\n")
    chunks.append(path.read_bytes())
    add(f"\r\n--{boundary}--\r\n")
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def request_json(
    method: str,
    path: str,
    *,
    body: bytes | None = None,
    content_type: str | None = None,
) -> object:
    base_url, api_key = configuration()
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    if content_type:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(
        f"{base_url}{path}", data=body, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read()
            return json.loads(payload) if payload else {"ok": True}
    except urllib.error.HTTPError as error:
        payload = error.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(payload).get("error", payload)
        except json.JSONDecodeError:
            detail = payload or error.reason
        raise RuntimeError(f"ImgHub request failed ({error.code}): {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Unable to reach ImgHub: {error.reason}") from error


def json_body(value: dict[str, object]) -> bytes:
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


def read_text(arguments: argparse.Namespace) -> str:
    if arguments.content is not None:
        return arguments.content
    return Path(arguments.file).read_text(encoding="utf-8")


def execute(arguments: argparse.Namespace) -> object:
    if arguments.command == "list":
        query = "" if arguments.kind is None else "?" + urllib.parse.urlencode({"kind": arguments.kind})
        return request_json("GET", f"/api/resources{query}")
    if arguments.command == "upload":
        body, content_type = multipart_file(Path(arguments.path), arguments.directory)
        return request_json("POST", "/api/files", body=body, content_type=content_type)
    if arguments.command == "publish-text":
        body = json_body({
            "name": arguments.name,
            "directory": arguments.directory,
            "content": read_text(arguments),
        })
        return request_json("POST", "/api/texts", body=body, content_type="application/json")
    if arguments.command == "replace":
        body, content_type = multipart_file(Path(arguments.path), None)
        return request_json(
            "PUT", f"/api/resources/{urllib.parse.quote(arguments.resource_id, safe='')}/content",
            body=body, content_type=content_type,
        )
    if arguments.command == "replace-text":
        body = json_body({"content": read_text(arguments)})
        return request_json(
            "PUT", f"/api/resources/{urllib.parse.quote(arguments.resource_id, safe='')}/content",
            body=body, content_type="application/json",
        )
    if arguments.command == "delete":
        return request_json(
            "DELETE", f"/api/resources/{urllib.parse.quote(arguments.resource_id, safe='')}"
        )
    raise ValueError(f"Unknown command: {arguments.command}")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Upload and manage ImgHub resources")
    commands = root.add_subparsers(dest="command", required=True)

    list_command = commands.add_parser("list", help="list resources owned by the API key user")
    list_command.add_argument("--kind", choices=("file", "text"))

    upload = commands.add_parser("upload", help="upload a file")
    upload.add_argument("path")
    upload.add_argument("--directory", default="")

    publish_text = commands.add_parser("publish-text", help="publish UTF-8 text")
    publish_text.add_argument("name")
    publish_text.add_argument("--directory", default="")
    text_input = publish_text.add_mutually_exclusive_group(required=True)
    text_input.add_argument("--content")
    text_input.add_argument("--file")

    replace = commands.add_parser("replace", help="replace a file without changing its path")
    replace.add_argument("resource_id")
    replace.add_argument("path")

    replace_text = commands.add_parser("replace-text", help="replace text without changing its path")
    replace_text.add_argument("resource_id")
    replacement_input = replace_text.add_mutually_exclusive_group(required=True)
    replacement_input.add_argument("--content")
    replacement_input.add_argument("--file")

    delete = commands.add_parser("delete", help="permanently delete a resource")
    delete.add_argument("resource_id")
    return root


def main() -> int:
    try:
        result = execute(parser().parse_args())
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, RuntimeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
