"""One-shot JSON bridge between the Node.js plugin and Microsoft Quicksand.

The bridge intentionally avoids host directory mounts: current Quicksand
Windows releases fail to mount CIFS/9p shares on some hosts. Files are moved
through the guest agent as bounded base64 chunks instead.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import shlex
import sys
import traceback
from pathlib import Path, PurePosixPath
from typing import Any


UPLOAD_CHUNK_CHARS = 8192
DOWNLOAD_CHUNK_BYTES = 128 * 1024


def _well_formed_text(value: Any) -> str:
    """Replace isolated UTF-16 surrogate code points before UTF-8 boundaries."""
    return "".join(
        "\ufffd" if 0xD800 <= ord(character) <= 0xDFFF else character
        for character in str(value or "")
    )


def _clean_proxy_environment() -> None:
    # httpx must connect directly to the local guest-agent forwarder.
    for name in (
        "ALL_PROXY",
        "all_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "HTTPS_PROXY",
        "https_proxy",
    ):
        os.environ.pop(name, None)
    os.environ["NO_PROXY"] = "127.0.0.1,localhost"
    os.environ["no_proxy"] = "127.0.0.1,localhost"


def _safe_filename(value: Any) -> str:
    name = _well_formed_text(value).strip()
    if (
        not name
        or len(name) > 255
        or "\x00" in name
        or PurePosixPath(name).name != name
        or name in {".", ".."}
    ):
        raise ValueError(f"unsafe filename: {value!r}")
    return name


async def _checked_execute(sb: Any, command: str, timeout: float = 30.0) -> Any:
    result = await sb.execute(command, timeout=timeout)
    if result.exit_code != 0:
        detail = (result.stderr or result.stdout or "guest command failed").strip()
        raise RuntimeError(f"{detail[:2000]} (exit={result.exit_code})")
    return result


async def _upload_bytes(sb: Any, guest_path: str, data: bytes) -> None:
    encoded = base64.b64encode(data).decode("ascii")
    encoded_path = f"{guest_path}.b64"
    await _checked_execute(
        sb,
        f"mkdir -p {shlex.quote(str(PurePosixPath(guest_path).parent))}; "
        f": > {shlex.quote(encoded_path)}",
    )
    for offset in range(0, len(encoded), UPLOAD_CHUNK_CHARS):
        chunk = encoded[offset : offset + UPLOAD_CHUNK_CHARS]
        await _checked_execute(
            sb,
            f"printf '%s' {shlex.quote(chunk)} >> {shlex.quote(encoded_path)}",
        )
    await _checked_execute(
        sb,
        f"base64 -d {shlex.quote(encoded_path)} > {shlex.quote(guest_path)} && "
        f"rm -f {shlex.quote(encoded_path)}",
    )


async def _download_bytes(sb: Any, guest_path: str, size: int) -> bytes:
    chunks: list[bytes] = []
    blocks = (size + DOWNLOAD_CHUNK_BYTES - 1) // DOWNLOAD_CHUNK_BYTES
    for index in range(blocks):
        result = await _checked_execute(
            sb,
            f"dd if={shlex.quote(guest_path)} bs={DOWNLOAD_CHUNK_BYTES} "
            f"skip={index} count=1 status=none | base64 | tr -d '\\n'",
        )
        chunks.append(base64.b64decode(result.stdout.strip(), validate=True))
    data = b"".join(chunks)
    if len(data) != size:
        raise RuntimeError(
            f"artifact size changed during transfer: expected {size}, got {len(data)}"
        )
    return data


async def _read_guest_text(
    sb: Any, guest_path: str, max_chars: int
) -> tuple[str, bool]:
    size_result = await _checked_execute(
        sb, f"wc -c < {shlex.quote(guest_path)}"
    )
    total_bytes = int(size_result.stdout.strip() or 0)
    max_bytes = max_chars * 4
    encoded_result = await _checked_execute(
        sb,
        f"head -c {max_bytes} {shlex.quote(guest_path)} | base64 | tr -d '\\n'",
    )
    raw = base64.b64decode(encoded_result.stdout.strip(), validate=True)
    text = raw.decode("utf-8", errors="replace")
    return text[:max_chars], total_bytes > len(raw) or len(text) > max_chars


async def _download_to_host(sb: Any, guest_path: str, host_path: Path, size: int) -> None:
    host_path.parent.mkdir(parents=True, exist_ok=True)
    with host_path.open("wb") as output:
        for index in range((size + DOWNLOAD_CHUNK_BYTES - 1) // DOWNLOAD_CHUNK_BYTES):
            result = await _checked_execute(
                sb,
                f"dd if={shlex.quote(guest_path)} bs={DOWNLOAD_CHUNK_BYTES} "
                f"skip={index} count=1 status=none | base64 | tr -d '\\n'",
            )
            output.write(base64.b64decode(result.stdout.strip(), validate=True))


async def _list_artifacts(
    sb: Any, max_files: int, max_bytes: int, artifact_dir: str
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    script = (
        "import json,os\n"
        "root='/workspace/outputs'\n"
        "items=[]\n"
        "for entry in os.scandir(root):\n"
        "  if entry.is_file(follow_symlinks=False):\n"
        "    items.append({'name':entry.name,'size':entry.stat(follow_symlinks=False).st_size})\n"
        "print(json.dumps(sorted(items,key=lambda x:x['name']),ensure_ascii=False))\n"
    )
    result = await _checked_execute(
        sb,
        f"python3 -c {shlex.quote(script)}",
    )
    entries = json.loads(result.stdout or "[]")
    artifacts: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    host_root = Path(artifact_dir).resolve() if artifact_dir else None
    if host_root:
        host_root.mkdir(parents=True, exist_ok=True)
    for entry in entries[:max_files]:
        name = _safe_filename(entry.get("name"))
        size = int(entry.get("size") or 0)
        if size < 0 or size > max_bytes:
            skipped.append({"filename": name, "size": size, "reason": "artifact_too_large"})
            continue
        if host_root:
            host_path = host_root / name
            await _download_to_host(sb, f"/workspace/outputs/{name}", host_path, size)
            artifacts.append({"filename": name, "size": size, "path": str(host_path)})
        else:
            data = await _download_bytes(sb, f"/workspace/outputs/{name}", size)
            artifacts.append(
                {
                    "filename": name,
                    "size": size,
                    "data": base64.b64encode(data).decode("ascii"),
                }
            )
    for entry in entries[max_files:]:
        skipped.append({
            "filename": _safe_filename(entry.get("name")),
            "size": int(entry.get("size") or 0),
            "reason": "artifact_file_limit",
        })
    return artifacts, skipped


async def _run(request: dict[str, Any]) -> dict[str, Any]:
    _clean_proxy_environment()
    from quicksand import NetworkMode, Sandbox

    code = _well_formed_text(request.get("code"))
    if not code.strip():
        raise ValueError("code is empty")
    language = _well_formed_text(request.get("language") or "python").lower()
    runners = {
        "python": ("main.py", "python3 /workspace/main.py"),
        "javascript": ("main.js", "node /workspace/main.js"),
        "bash": ("main.sh", "bash /workspace/main.sh"),
    }
    if language not in runners:
        raise ValueError(f"unsupported language: {language}")
    source_name, run_command = runners[language]

    image = _well_formed_text(request.get("image") or "loli-python-media").strip()
    workspace = _well_formed_text(request.get("workspace")).strip() or None
    if workspace and not Path(image).is_absolute():
        saved_image = Path(workspace) / image
        if saved_image.exists():
            image = str(saved_image)
    memory_mib = max(128, int(request.get("memory_mib") or 512))
    cpus = max(1, int(request.get("cpus") or 1))
    timeout = max(1.0, float(request.get("timeout_seconds") or 120))
    max_output = max(1024, int(request.get("max_output_chars") or 4096))
    max_files = max(0, min(8, int(request.get("max_artifacts") or 4)))
    max_artifact_bytes = max(
        0, min(512 * 1024 * 1024, int(request.get("max_artifact_bytes") or 200 * 1024 * 1024))
    )
    artifact_dir = _well_formed_text(request.get("artifact_dir") or "")
    requested_network_mode = _well_formed_text(
        request.get("network_mode") or "none"
    ).lower()
    network_mode = (
        NetworkMode.FULL if requested_network_mode == "full" else NetworkMode.NONE
    )

    # User code always stays fully offline.
    sb = Sandbox(
        image=image,
        workspace=workspace,
        memory=f"{memory_mib}M",
        cpus=cpus,
        network_mode=network_mode,
    )
    try:
        await sb.start()
        await _checked_execute(
            sb,
            "mkdir -p /workspace/inputs /workspace/outputs && "
            "rm -rf /workspace/inputs/* /workspace/outputs/*",
        )
        await _upload_bytes(
            sb, f"/workspace/{source_name}", code.encode("utf-8", errors="replace")
        )
        for item in request.get("inputs") or []:
            name = _safe_filename(item.get("filename"))
            data = base64.b64decode(str(item.get("data") or ""), validate=True)
            await _upload_bytes(sb, f"/workspace/inputs/{name}", data)

        execution = await sb.execute(
            "set +e; "
            f"{run_command} > /workspace/.stdout 2> /workspace/.stderr; "
            "status=$?; printf '%s' \"$status\"",
            timeout=timeout,
            cwd="/workspace",
        )
        if execution.exit_code != 0:
            raise RuntimeError(
                f"failed to collect guest process status: {execution.stderr or execution.stdout}"
            )
        process_exit_code = int(str(execution.stdout or "").strip())
        stdout, stdout_truncated = await _read_guest_text(
            sb, "/workspace/.stdout", max_output
        )
        stderr, stderr_truncated = await _read_guest_text(
            sb, "/workspace/.stderr", max_output
        )
        artifacts, artifact_warnings = await _list_artifacts(
            sb, max_files, max_artifact_bytes, artifact_dir
        )
        result: dict[str, Any] = {
            "stdout": stdout,
            "stderr": stderr,
            "result": "",
            "truncated": stdout_truncated or stderr_truncated,
            "artifacts": artifacts,
            "artifactWarnings": artifact_warnings,
            "backend": "quicksand",
            "networkMode": requested_network_mode,
        }
        if process_exit_code != 0:
            result["error"] = {
                "name": "ProcessExitError",
                "value": f"进程退出码 {process_exit_code}",
                "traceback": stderr,
            }
        return result
    finally:
        if sb.is_running:
            await sb.stop()


def main() -> int:
    try:
        # JSON bytes are UTF-8 by specification; bypass the Windows locale
        # encoding inherited by redirected text stdin.
        request = json.load(sys.stdin.buffer)
        response = {"ok": True, "result": asyncio.run(_run(request))}
        # Keep the wire format ASCII-only because redirected stdout may inherit
        # the Windows GBK locale. JSON parsing restores the original Unicode.
        json.dump(response, sys.stdout, ensure_ascii=True, separators=(",", ":"))
        return 0
    except Exception as exc:
        response = {
            "ok": False,
            "error": str(exc),
            "traceback": traceback.format_exc(limit=8)[-8000:],
        }
        json.dump(response, sys.stdout, ensure_ascii=True, separators=(",", ":"))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
