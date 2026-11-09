"""Build the Windows x64 installer from checkout and pinned public inputs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
from zipfile import ZipFile


RELEASE = Path(__file__).resolve().parent
ROOT = RELEASE.parents[1]
INPUTS = json.loads((RELEASE / "build-inputs.json").read_text(encoding="utf-8"))
NOTICES = RELEASE / "notices"


def digest(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def fetch(cache, name):
    item = INPUTS[name]
    destination = cache / name
    if destination.is_file() and digest(destination) == item["sha256"]:
        return destination
    print(f"Downloading {name}", flush=True)
    partial = destination.with_suffix(destination.suffix + ".partial")
    subprocess.run([
        "curl.exe", "--fail", "--location", "--proto", "=https",
        "--proto-redir", "=https", "--retry", "3", "--connect-timeout", "30",
        "--output", str(partial), item["url"],
    ], check=True)
    if digest(partial) != item["sha256"]:
        raise ValueError(f"Unexpected SHA-256 for {name}")
    partial.replace(destination)
    return destination


def copy(file, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(file, destination)


def unpack_runtime(archive, destination, executable, prefix=""):
    with ZipFile(archive) as zipped:
        entries = [
            name for name in zipped.namelist()
            if name.startswith(prefix) and "/" not in name.removeprefix(prefix)
            and (name.endswith(".dll") or name.removeprefix(prefix) in {
                executable, "LICENSE-LLVM-OpenMP",
            })
        ]
        if prefix + executable not in entries:
            raise ValueError(f"{executable} missing from {archive.name}")
        for name in entries:
            target = destination / name.removeprefix(prefix)
            target.parent.mkdir(parents=True, exist_ok=True)
            with zipped.open(name) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)


def build(cache, output):
    files = {name: fetch(cache, name) for name in INPUTS}
    with tempfile.TemporaryDirectory(prefix="buji-v3-build-", dir=cache.parent) as folder:
        work = Path(folder)
        payload = work / "payload"
        payload.mkdir()
        env = {
            **os.environ,
            "BUJI_PACKAGING_ROOT": str(work),
            "BUJI_ELECTRON_ARCHIVE": str(files["electron-v45.2.2-win32-x64.zip"]),
        }
        subprocess.run(["node", "package.mjs", "--v2", "--stage-only"], cwd=ROOT, env=env, check=True)
        packaged = work / "work/buji-v2-packaging/packages/Buji V2-win32-x64"
        shutil.move(packaged, payload / "app")
        for name in ("Start-Buji.ps1", "Start-Buji-V2-Backend.ps1", "release-assets.json",
                     "hindi-wheels.txt", "vision-wheels.txt"):
            copy(RELEASE / name, payload / name)
        copy(ROOT / "assets/buji.ico", payload / "buji.ico")
        (payload / "cbn-buji-install.marker").write_text("CBN.Ai Buji V3 Windows x64\n", encoding="utf-8")
        for name in ("gateway", "router", "profile", "arithmetic", "service"):
            copy(ROOT / f"tools/brain/{name}.cjs", payload / f"tools/brain/{name}.cjs")
        (payload / "tools/brain/brain.json").write_text(
            '{"schema":1,"profile":"current-wsp","context":8192}\n', encoding="utf-8")

        with ZipFile(files["Buji-V3-WSP-adapters.zip"]) as archive:
            archive.extractall(payload / "wsp")
        unpack_runtime(files["llama-b12099-bin-win-cpu-x64.zip"], payload / "runtime", "llama-server.exe")
        unpack_runtime(files["whisper-bin-x64.zip"], payload / "voice/runtime/Release", "whisper-cli.exe", "Release/")
        copy(files["ggml-small-q5_1.bin"], payload / "voice/ggml-small-q5_1.bin")
        for name in ("LICENSE-whisper-model.txt", "LICENSE-whisper.cpp.txt", "provenance.json"):
            copy(NOTICES / name, payload / "voice" / name)
        for name in ("MODEL_CARD", "LICENSE-piper.txt"):
            copy(NOTICES / name, payload / "voice/hindi" / name)
        copy(ROOT / "tools/hindi-speech.py", payload / "voice/hindi/speak.py")
        copy(ROOT / "tools/english-speech.ps1", payload / "voice/hindi/english-speech.ps1")
        python = payload / "voice/hindi-runtime/Scripts"
        with ZipFile(files["python-3.12.10-embed-amd64.zip"]) as archive:
            archive.extractall(python)
        (python / "python312._pth").write_text(
            "python312.zip\n.\nLib/site-packages\nimport site\n", encoding="ascii")
        with ZipFile(files["pip-25.0.1-py3-none-any.whl"]) as wheel:
            wheel.extractall(python / "Lib/site-packages")

        for name in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
            copy(ROOT / name, payload / "notices" / name)
        for name in ("LICENSE-llama.txt", "LICENSE-omnicoder.txt", "LICENSE-QWEN.txt",
                     "OmniCoder-model-card.md", "Qwen-model-card.md"):
            copy(NOTICES / name, payload / "notices" / name)
        shutil.copytree(ROOT / "docs/licenses", payload / "notices/javascript-licenses")
        with tarfile.open(files["nsis-bundle-3.13.tar.gz"], "r:gz") as archive:
            members = [item for item in archive.getmembers() if item.name.startswith("nsis-bundle/windows/")]
            archive.extractall(work, members=members, filter="data")
        nsis = work / "nsis-bundle/windows"
        output.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([
            str(nsis / "makensis.exe"), "/V3", f"/DPAYLOAD={payload}", f"/DOUTPUT={output}",
            str(RELEASE / "setup.nsi"),
        ], env={**env, "NSISDIR": str(nsis)}, check=True)
    print(f"SHA-256 {digest(output)}  {output.name}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    cache = args.cache.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    build(cache, args.output.resolve())
