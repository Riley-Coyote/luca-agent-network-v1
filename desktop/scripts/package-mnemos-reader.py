"""Reproduce the app's local, read-only adapter from immutable upstream inputs.

No package install, working-tree imports, downloads, user scope or store reads.
Pass the pinned Mnemos git checkout, upstream's locked ulid wheel and output path.
"""
import argparse
import hashlib
import io
import pathlib
import subprocess
import tarfile
import zipfile

ENGINE = "fd07d9cdee9f6b53137ffc6d52d254e5e80d10eb"
WHEEL = "b56a0f809ef90d6020b21b89a87a48edc7c03aea80e5ed5174172e82d76e3987"
ENTRY = """import argparse, sys
from mnemos.host_view import answer
if not (3, 10) <= sys.version_info[:2] <= (3, 13):
    raise SystemExit(2)
p = argparse.ArgumentParser(allow_abbrev=False)
p.add_argument('command', choices=['view'])
for flag in ('protocol','section','db-path','agent-id','person-id','project-scope'):
    p.add_argument('--'+flag, required=True)
for flag in ('limit','cursor'):
    p.add_argument('--'+flag)
args = vars(p.parse_args())
del args['command']
status, text = answer(**args)
print(text)
raise SystemExit(status)
"""

def make(repo, wheel, dest):
    blob = wheel.read_bytes()
    if hashlib.sha256(blob).hexdigest() != WHEEL:
        raise SystemExit("Not the dependency pinned by the engine")
    tree = subprocess.check_output(["git", "-C", str(repo), "archive", "--format=tar", ENGINE,
                                    "mnemos", "LICENSE", "NOTICE", "pyproject.toml"])
    files = {"__main__.py": ENTRY.encode()}
    with tarfile.open(fileobj=io.BytesIO(tree), mode="r:") as src:
        for entry in src:
            if entry.isfile() and (entry.name.endswith(".py") or entry.name in ("LICENSE", "NOTICE", "pyproject.toml")):
                files[entry.name] = src.extractfile(entry).read()
    import re
    version = re.search(rb'^version = "([0-9.]+)"$', files["pyproject.toml"], re.M)[1].decode()
    files[f"mnemos_continuity-{version}.dist-info/METADATA"] = f"Metadata-Version: 2.1\nName: mnemos-continuity\nVersion: {version}\n".encode()
    with zipfile.ZipFile(io.BytesIO(blob)) as dep:
        for name in dep.namelist():
            if (name.startswith("ulid/") and name.endswith(".py")) or name.endswith(".dist-info/LICENSE"):
                files[name] = dep.read(name)
    with zipfile.ZipFile(dest, "x") as out:
        for name, data in sorted(files.items()):
            # Stored (no zlib version dependency), fixed epoch/mode/order.
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            out.writestr(info, data)
    print(hashlib.sha256(dest.read_bytes()).hexdigest())

if __name__ == "__main__":
    args = argparse.ArgumentParser()
    for arg in ("repo", "wheel", "dest"):
        args.add_argument(arg, type=pathlib.Path)
    opts = args.parse_args()
    make(opts.repo, opts.wheel, opts.dest)
