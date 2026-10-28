#!/usr/bin/env python3
"""Install build tools per-user, clone Neon Swarm, and build a Desktop ZIP."""

import ctypes
import os
import queue
import shutil
import ssl
import subprocess
import sys
import threading
import tempfile
import tkinter as tk
import urllib.error
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath
from tkinter import ttk

REPOSITORY = "https://github.com/luisdiko14-lab/Cool.game.git"
SOURCE_ARCHIVE = "https://codeload.github.com/luisdiko14-lab/Cool.game/zip/refs/heads/main"
PYTHON_VERSION = "3.12.10"
PYTHON_URL = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe"
PACKAGES = [
    "pyinstaller==6.22.3",
    "pywebview[pyside6]==6.2.1",
    "PySide6==6.10.3",
]
LOG_HANDLER = print


def report(message):
    LOG_HANDLER(str(message))


def run(command, *, cwd=None, env=None):
    report("\n> " + subprocess.list2cmdline([str(item) for item in command]))
    process = subprocess.Popen(
        command,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if process.stdout:
        for line in process.stdout:
            report(line.rstrip())
    return_code = process.wait()
    if return_code:
        raise subprocess.CalledProcessError(return_code, command)


def download(url, destination):
    request = urllib.request.Request(url, headers={"User-Agent": "Build-and-use-game"})
    destination.parent.mkdir(parents=True, exist_ok=True)
    report(f"Downloading {destination.name}...")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            with destination.open("wb") as output:
                shutil.copyfileobj(response, output)
    except (urllib.error.URLError, ssl.SSLCertVerificationError) as error:
        reason = error.reason if isinstance(error, urllib.error.URLError) else error
        if sys.platform != "win32" or not isinstance(reason, ssl.SSLCertVerificationError):
            raise

        powershell = shutil.which("powershell.exe") or shutil.which("pwsh.exe")
        if not powershell:
            raise RuntimeError(
                "Python could not verify the download certificate and PowerShell is unavailable."
            ) from error

        report("Retrying with the Windows certificate store...")
        environment = os.environ.copy()
        environment["BUILD_AND_USE_URL"] = url
        environment["BUILD_AND_USE_DESTINATION"] = str(destination)
        command = [
            powershell,
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$ProgressPreference='SilentlyContinue'; "
            "Invoke-WebRequest -UseBasicParsing -Uri $env:BUILD_AND_USE_URL "
            "-OutFile $env:BUILD_AND_USE_DESTINATION",
        ]
        subprocess.run(command, env=environment, check=True)
        if not destination.is_file() or destination.stat().st_size == 0:
            raise RuntimeError("PowerShell did not create the downloaded file.")


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
        local_app_data = Path(local_app_data)
        candidates.extend(
            [
                local_app_data / "Programs/Python/Python312/python.exe",
                local_app_data / "Build_and_use_game/Python312/python.exe",
            ]
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


def find_git():
    executable = shutil.which("git.exe") or shutil.which("git")
    if executable:
        return Path(executable)
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        executable = Path(local_app_data) / "Build_and_use_game/Git/cmd/git.exe"
        if executable.is_file():
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
    if git_executable and git_executable.parent.name.lower() == "cmd":
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

    with tempfile.TemporaryDirectory(prefix="neon-swarm-build-") as temporary:
        work = Path(temporary)
        source = work / "Cool.game"
        try:
            if git_executable is None:
                raise RuntimeError("Git was skipped by the user.")
            run(
                [str(git_executable), "clone", "--depth", "1", REPOSITORY, str(source)],
                env=environment,
            )
        except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
            report(
                f"Git clone failed ({error}); downloading the repository source archive instead."
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
        report(f"\nCreating {package}...")
        with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_STORED) as archive:
            archive.write(executable, "NeonSwarm.exe")
            archive.writestr("README.txt", readme)
    return package


class BuilderWindow:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Neon Swarm Builder")
        self.root.configure(bg="#0b1020")
        self.root.geometry("720x650")
        self.root.minsize(620, 560)
        self.root.protocol("WM_DELETE_WINDOW", self.close)

        self.messages = queue.Queue()
        self.python_executable = find_python()
        self.git_executable = find_git()
        self.worker = None
        self.package = None

        self.python_install = tk.BooleanVar(value=self.python_executable is None)
        self.git_install = tk.BooleanVar(value=self.git_executable is None)
        self._build_ui()
        self._write_initial_status()
        self.root.after(100, self._poll_messages)

    def _build_ui(self):
        header = tk.Frame(self.root, bg="#0b1020")
        header.pack(fill="x", padx=28, pady=(24, 16))
        tk.Label(
            header,
            text="NEON SWARM",
            bg="#0b1020",
            fg="#e7f7ff",
            font=("Segoe UI", 24, "bold"),
        ).pack(anchor="w")
        tk.Label(
            header,
            text="BUILD STATION  /  WINDOWS",
            bg="#0b1020",
            fg="#47e9e1",
            font=("Segoe UI", 9, "bold"),
        ).pack(anchor="w", pady=(2, 0))

        tools = tk.Frame(self.root, bg="#151d31", highlightbackground="#293552", highlightthickness=1)
        tools.pack(fill="x", padx=28, pady=(0, 14))
        tk.Label(
            tools,
            text="BUILD TOOLS",
            bg="#151d31",
            fg="#94a9c7",
            font=("Segoe UI", 9, "bold"),
        ).pack(anchor="w", padx=16, pady=(12, 4))
        self.python_check = tk.Checkbutton(
            tools,
            text="Install Python 3.12 for this user",
            variable=self.python_install,
            bg="#151d31",
            fg="#e7f7ff",
            activebackground="#151d31",
            activeforeground="#ffffff",
            selectcolor="#0b1020",
            font=("Segoe UI", 10),
            anchor="w",
        )
        self.python_check.pack(fill="x", padx=12, pady=3)
        self.git_check = tk.Checkbutton(
            tools,
            text="Install Git for this user (optional; source download works without Git)",
            variable=self.git_install,
            bg="#151d31",
            fg="#e7f7ff",
            activebackground="#151d31",
            activeforeground="#ffffff",
            selectcolor="#0b1020",
            font=("Segoe UI", 10),
            anchor="w",
        )
        self.git_check.pack(fill="x", padx=12, pady=(3, 12))

        actions = tk.Frame(self.root, bg="#0b1020")
        actions.pack(fill="x", padx=28, pady=(0, 14))
        self.build_button = tk.Button(
            actions,
            text="BUILD GAME  →  CREATE DESKTOP ZIP",
            command=self.start_build,
            bg="#16b8b0",
            fg="#04131c",
            activebackground="#52eee0",
            activeforeground="#04131c",
            disabledforeground="#64748b",
            relief="flat",
            padx=18,
            pady=12,
            font=("Segoe UI", 10, "bold"),
            cursor="hand2",
        )
        self.build_button.pack(side="left", fill="x", expand=True)
        self.desktop_button = tk.Button(
            actions,
            text="OPEN DESKTOP",
            command=self.open_desktop,
            state="disabled",
            bg="#26324a",
            fg="#e7f7ff",
            activebackground="#344663",
            relief="flat",
            padx=14,
            pady=12,
            font=("Segoe UI", 9, "bold"),
            cursor="hand2",
        )
        self.desktop_button.pack(side="left", padx=(10, 0))

        self.status = tk.StringVar(value="Ready when you are.")
        tk.Label(
            self.root,
            textvariable=self.status,
            bg="#0b1020",
            fg="#47e9e1",
            font=("Segoe UI", 10),
            anchor="w",
        ).pack(fill="x", padx=28, pady=(0, 7))
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure(
            "Neon.Horizontal.TProgressbar",
            troughcolor="#151d31",
            background="#47e9e1",
            bordercolor="#151d31",
            lightcolor="#47e9e1",
            darkcolor="#47e9e1",
        )
        self.progress = ttk.Progressbar(
            self.root,
            mode="indeterminate",
            style="Neon.Horizontal.TProgressbar",
        )
        self.progress.pack(fill="x", padx=28, pady=(0, 12))

        tk.Label(
            self.root,
            text="BUILD LOG",
            bg="#0b1020",
            fg="#94a9c7",
            font=("Segoe UI", 9, "bold"),
            anchor="w",
        ).pack(fill="x", padx=28, pady=(0, 5))
        log_frame = tk.Frame(self.root, bg="#0b1020")
        log_frame.pack(fill="both", expand=True, padx=28, pady=(0, 24))
        self.log = tk.Text(
            log_frame,
            bg="#080c17",
            fg="#c5d5e8",
            insertbackground="#47e9e1",
            selectbackground="#245b68",
            relief="flat",
            wrap="word",
            font=("Consolas", 9),
            padx=12,
            pady=10,
            state="disabled",
        )
        scrollbar = ttk.Scrollbar(log_frame, command=self.log.yview)
        self.log.configure(yscrollcommand=scrollbar.set)
        self.log.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

    def _write_initial_status(self):
        python_found = self.python_executable is not None
        git_found = self.git_executable is not None
        self.python_check.configure(
            text=(
                f"Python 3.12 found: {self.python_executable}"
                if python_found
                else "Install Python 3.12 for this user (required to build)"
            ),
            state="disabled" if python_found else "normal",
        )
        self.git_check.configure(
            text=(
                f"Git found: {self.git_executable}"
                if git_found
                else "Install Git for this user (optional; source download works without Git)"
            ),
            state="disabled" if git_found else "normal",
        )
        self._append_log("Select missing tools, then build the game.")

    def _append_log(self, message):
        self.log.configure(state="normal")
        self.log.insert("end", message + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def start_build(self):
        if self.worker and self.worker.is_alive():
            return
        self.build_button.configure(state="disabled")
        self.python_check.configure(state="disabled")
        self.git_check.configure(state="disabled")
        self.desktop_button.configure(state="disabled")
        self.status.set("Preparing your local build...")
        self.progress.start(12)
        install_python_selected = self.python_install.get()
        install_git_selected = self.git_install.get()
        self.worker = threading.Thread(
            target=self._build_worker,
            args=(install_python_selected, install_git_selected),
            daemon=True,
        )
        self.worker.start()

    def _build_worker(self, install_python_selected, install_git_selected):
        global LOG_HANDLER
        LOG_HANDLER = lambda message: self.messages.put(("log", message))
        try:
            tools = local_tools_directory()
            python_executable = find_python()
            if python_executable is None and install_python_selected:
                report("Python 3.12 is missing; installing it for this user.")
                python_executable = install_python(tools)
            if python_executable is None:
                raise RuntimeError(
                    "Python 3.12 is required. Select Install Python and try again."
                )
            report(f"Using Python: {python_executable}")

            git_executable = find_git()
            if git_executable is None and install_git_selected:
                report("Git is missing; installing it for this user.")
                git_executable = install_git(tools)
            if git_executable:
                report(f"Using Git: {git_executable}")
            else:
                report("Git is not installed; the source archive will be used.")

            package = build_zip(tools, python_executable, git_executable)
            self.messages.put(("success", package))
        except Exception as error:
            self.messages.put(("failure", error))

    def _poll_messages(self):
        try:
            while True:
                kind, payload = self.messages.get_nowait()
                if kind == "log":
                    self._append_log(payload)
                elif kind == "success":
                    self.package = Path(payload)
                    self.status.set("Build complete. ZIP saved to your Desktop.")
                    self._append_log(f"\nCreated: {self.package}")
                    self.desktop_button.configure(state="normal")
                    self._finish_build()
                elif kind == "failure":
                    self.status.set("Build failed. Details are in the log.")
                    self._append_log(f"\nBuild failed: {payload}")
                    self._finish_build()
        except queue.Empty:
            pass
        self.root.after(100, self._poll_messages)

    def _finish_build(self):
        self.progress.stop()
        self.build_button.configure(state="normal")
        self.python_executable = find_python()
        self.git_executable = find_git()
        if self.python_executable:
            self.python_install.set(False)
            self.python_check.configure(
                text=f"Python 3.12 found: {self.python_executable}", state="disabled"
            )
        else:
            self.python_check.configure(
                text="Install Python 3.12 for this user (required to build)",
                state="normal",
            )
        if self.git_executable:
            self.git_install.set(False)
            self.git_check.configure(
                text=f"Git found: {self.git_executable}", state="disabled"
            )
        else:
            self.git_check.configure(
                text="Install Git for this user (optional; source download works without Git)",
                state="normal",
            )

    def open_desktop(self):
        try:
            os.startfile(str(find_desktop()))
        except OSError as error:
            self._append_log(f"Could not open Desktop: {error}")

    def close(self):
        if self.worker and self.worker.is_alive():
            self.status.set("Build is still running; wait for it to finish before closing.")
            return
        self.root.destroy()

    def run(self):
        self.root.mainloop()


def main():
    if sys.platform != "win32":
        raise RuntimeError("Build_and_use_game.exe must be run on Windows.")
    BuilderWindow().run()


if __name__ == "__main__":
    main()