#!/usr/bin/env python3
"""Install build tools per-user, clone Neon Swarm, and build a Desktop ZIP."""

import ctypes
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

REPOSITORY = "https://github.com/luisdiko14-lab/Cool.game.git"
SOURCE_ARCHIVE = "https://codeload.github.com/luisdiko14-lab/Cool.game/zip/refs/heads/main"
PYTHON_VERSION = "3.12.10"
PYTHON_URL = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe"
PACKAGES = [
    "pyinstaller==6.22.3",
    "pywebview[pyside6]==6.2.1",
    "PySide6==6.10.3",
]


def run(command, *, cwd=None, env=None):
    print("\n> " + subprocess.list2cmdline([str(item) for item in command]), flush=True)
    subprocess.run(command, cwd=cwd, env=env, check=True)


def download(url, destination):
    request = urllib.request.Request(url, headers={"User-Agent": "Build-and-use-game"})
    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {destination.name}...", flush=True)
    with urllib.request.urlopen(request, timeout=60) as response:
        with destination.open("wb") as output:
            shutil.copyfileobj(response, output)


def local_tools_directory():
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        raise RuntimeError("Could not locate Windows Local AppData.")
    directory = Path(local_app_data) / "Build_and_use_game"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def supports_python_312(executable):
    result = subprocess.run(
        [str(executable), "-c", "import sys; print(sys.version_info[:2])"],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0 and result.stdout.strip() == "(3, 12)"


def find_python():
    candidates = [shutil.which("python.exe"), shutil.which("python")]
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        candidates.append(
            str(Path(local_app_data) / "Programs/Python/Python312/python.exe")
        )
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and supports_python_312(candidate):
            return Path(candidate)

    launcher = shutil.which("py.exe") or shutil.which("py")
    if launcher:
        result = subprocess.run(
            [launcher, "-3.12", "-c", "import sys; print(sys.executable)"],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            executable = Path(result.stdout.strip())
            if executable.is_file() and supports_python_312(executable):
                return executable
    return None


def install_python(tool_directory):
    installer = tool_directory / f"python-{PYTHON_VERSION}-amd64.exe"
    install_directory = tool_directory / "Python312"
    download(PYTHON_URL, installer)
    run(
        [
            str(installer),
            "/quiet",
            "InstallAllUsers=0",
            f"TargetDir={install_directory}",
            "PrependPath=0",
            "Include_launcher=0",
            "Include_pip=1",
            "Include_test=0",
            "Shortcuts=0",
        ]
    )
    executable = install_directory / "python.exe"
    if not executable.is_file():
        raise RuntimeError("Python installer did not create python.exe.")
    return executable


def install_git(tool_directory):
    installer_url = "https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.4/Git-2.56.0.4-64-bit.exe"
    installer = tool_directory / "Git-2.56.0.4-64-bit.exe"
    git_root = tool_directory / "Git"
    download(installer_url, installer)
    run(
        [
            str(installer),
            "/VERYSILENT",
            "/NORESTART",
            "/SP-",
            "/CURRENTUSER",
            f"/DIR={git_root}",
        ]
    )
    executable = git_root / "cmd" / "git.exe"
    if not executable.is_file():
        raise RuntimeError("Git installer did not create cmd/git.exe.")
    return executable


def find_desktop():
    buffer = ctypes.create_unicode_buffer(260)
    result = ctypes.windll.shell32.SHGetFolderPathW(None, 0x10, None, 0, buffer)
    desktop = Path(buffer.value) if result == 0 and buffer.value else Path.home() / "Desktop"
    desktop.mkdir(parents=True, exist_ok=True)
    return desktop


def download_source_archive(work):
    archive_path = work / "Cool.game-source.zip"
    extraction_root = work / "source-archive"
    download(SOURCE_ARCHIVE, archive_path)
    extraction_root.mkdir()

    with zipfile.ZipFile(archive_path) as archive:
        entries = [PurePosixPath(name) for name in archive.namelist() if name]
        root_names = {entry.parts[0] for entry in entries if entry.parts}
        if len(root_names) != 1:
            raise RuntimeError("The repository source archive has an invalid layout.")
        root = extraction_root.resolve()
        for entry in entries:
            if entry.is_absolute() or ".." in entry.parts or "\\" in entry.as_posix():
                raise RuntimeError("The repository source archive contains an invalid path.")
            target = (extraction_root / Path(*entry.parts)).resolve()
            if os.path.commonpath((str(root), str(target))) != str(root):
                raise RuntimeError("The repository source archive contains an invalid path.")
        archive.extractall(extraction_root)

    source = extraction_root / next(iter(root_names))
    if not (source / "neon_swarm.py").is_file():
        raise RuntimeError("Downloaded repository archive does not contain neon_swarm.py.")
    return source


def build_zip(tool_directory, python_executable, git_executable):
    environment = os.environ.copy()
    if git_executable.parent.name.lower() == "cmd":
        git_root = git_executable.parent.parent
        git_paths = [
            git_root / "cmd",
            git_root / "bin",
            git_root / "mingw64/bin",
            git_root / "usr/bin",
        ]
        environment["PATH"] = os.pathsep.join(
            [str(path) for path in git_paths] + [environment.get("PATH", "")]
        )
        environment["GIT_EXEC_PATH"] = str(git_root / "mingw64/libexec/git-core")

    with tempfile.TemporaryDirectory(prefix="neon-swarm-build-") as temporary:
        work = Path(temporary)
        source = work / "Cool.game"
        try:
            run(
                [str(git_executable), "clone", "--depth", "1", REPOSITORY, str(source)],
                env=environment,
            )
        except (OSError, subprocess.CalledProcessError) as error:
            print(
                f"Git clone failed ({error}); downloading the repository source archive instead.",
                flush=True,
            )
            shutil.rmtree(source, ignore_errors=True)
            source = download_source_archive(work)

        venv = work / "venv"
        run([str(python_executable), "-m", "venv", str(venv)])
        venv_python = venv / "Scripts" / "python.exe"
        run([str(venv_python), "-m", "pip", "install", "--upgrade", "pip"])
        run([str(venv_python), "-m", "pip", "install", *PACKAGES])

        executable = work / "dist" / "NeonSwarm.exe"
        run(
            [
                str(venv_python),
                "-m",
                "PyInstaller",
                "--noconfirm",
                "--clean",
                "--onefile",
                "--console",
                "--collect-all",
                "webview",
                "--collect-all",
                "qtpy",
                "--collect-all",
                "PySide6",
                "--name",
                "NeonSwarm",
                "--distpath",
                str(executable.parent),
                "--workpath",
                str(work / "build"),
                "--specpath",
                str(work),
                "--add-data",
                "MATADORA (Sped Up).mp3;.",
                "neon_swarm.py",
            ],
            cwd=source,
        )
        if not executable.is_file():
            raise RuntimeError("PyInstaller did not create NeonSwarm.exe.")

        desktop = find_desktop()
        package = desktop / "NeonSwarm-Windows.zip"
        readme = (
            "Neon Swarm for Windows\n\n"
            "Run NeonSwarm.exe to start the desktop game. Scores and saves are "
            "stored on the Desktop.\n"
        )
        print(f"\nCreating {package}...", flush=True)
        with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_STORED) as archive:
            archive.write(executable, "NeonSwarm.exe")
            archive.writestr("README.txt", readme)
    return package


def main():
    if sys.platform != "win32":
        raise RuntimeError("Build_and_use_game.exe must be run on Windows.")

    tools = local_tools_directory()
    python_executable = find_python()
    if python_executable is None:
        print("Python 3.12 is missing; installing it for this user.", flush=True)
        python_executable = install_python(tools)
    else:
        print(f"Using Python: {python_executable}", flush=True)

    git = shutil.which("git.exe") or shutil.which("git")
    if git:
        git_executable = Path(git)
        print(f"Using Git: {git_executable}", flush=True)
    else:
        print("Git is missing; installing a portable copy for this user.", flush=True)
        git_executable = install_git(tools)

    package = build_zip(tools, python_executable, git_executable)
    print(f"\nFinished. ZIP created on your Desktop:\n{package}", flush=True)
    try:
        os.startfile(str(package.parent))
    except OSError:
        pass


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"\nBuild failed: {error}", file=sys.stderr, flush=True)
        input("Press Enter to close this window...")
        raise SystemExit(1)
    input("\nPress Enter to close this window...")