"""First-party Neon Swarm accounts and encrypted local data storage."""

import hashlib
import html
import json
import os
import re
import secrets
import threading
import time
from pathlib import Path
from urllib.parse import quote

try:
    from cryptography.fernet import Fernet, InvalidToken
except ImportError:
    Fernet = None

    class InvalidToken(Exception):
        pass


PASSWORD_ROUNDS = 600_000
PASSWORD_MIN_LENGTH = 12
PASSWORD_MAX_LENGTH = 128
SESSION_SECONDS = 14 * 24 * 60 * 60
PERMISSIONS = ("username", "email", "data")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,24}$")


class AccountError(ValueError):
    pass


def user_data_dir():
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    path = base / "NeonSwarm"
    path.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        os.chmod(path, 0o700)
    return path


def load_data_key(directory):
    configured = os.environ.get("NEON_SWARM_DATA_KEY", "").strip()
    if configured:
        key = configured.encode("ascii")
        if Fernet is None:
            raise RuntimeError("Install the cryptography package to enable account storage.")
        Fernet(key)
        return key
    if os.environ.get("GITHUB_ACTIONS", "").lower() == "true":
        return None
    if Fernet is None:
        raise RuntimeError("Install the cryptography package to enable account storage.")

    key_path = Path(directory) / "account-data.key"
    try:
        key = key_path.read_bytes().strip()
    except FileNotFoundError:
        key = Fernet.generate_key()
        temporary = key_path.with_suffix(".tmp")
        temporary.write_bytes(key + b"\n")
        if os.name != "nt":
            os.chmod(temporary, 0o600)
        temporary.replace(key_path)
    Fernet(key)
    return key


def read_encrypted_json(path, key):
    if not key:
        return {}
    path = Path(path)
    try:
        encrypted = path.read_bytes()
    except FileNotFoundError:
        return {}
    try:
        content = Fernet(key).decrypt(encrypted)
        value = json.loads(content.decode("utf-8"))
    except (InvalidToken, UnicodeDecodeError, ValueError) as error:
        raise RuntimeError("Encrypted Neon Swarm data could not be read with this data key.") from error
    if not isinstance(value, dict):
        raise RuntimeError("Encrypted Neon Swarm data has an invalid format.")
    return value


def write_encrypted_json(path, value, key):
    if not key:
        raise RuntimeError("Account and cloud-save storage is disabled until NEON_SWARM_DATA_KEY is configured.")
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    encrypted = Fernet(key).encrypt(json.dumps(value, separators=(",", ":")).encode("utf-8"))
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(encrypted)
    if os.name != "nt":
        os.chmod(temporary, 0o600)
    temporary.replace(path)


def safe_return_path(value):
    if (
        not isinstance(value, str)
        or not value.startswith("/")
        or value.startswith("//")
        or "\\" in value
        or any(ord(char) < 32 for char in value)
    ):
        return "/"
    return value


def _email_key(value):
    if not isinstance(value, str):
        raise AccountError("Enter a valid email address.")
    value = value.strip()
    if len(value) > 254 or not EMAIL_RE.fullmatch(value):
        raise AccountError("Enter a valid email address.")
    return value.casefold()


def _password_hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ROUNDS, dklen=32)


class AccountStore:
    def __init__(self, path, key):
        self.path = Path(path)
        self.key = key
        self.lock = threading.RLock()

    def _load(self):
        value = read_encrypted_json(self.path, self.key)
        users = value.get("users", {})
        if not isinstance(users, dict):
            raise RuntimeError("Account database has an invalid format.")
        return users

    def _save(self, users):
        write_encrypted_json(self.path, {"users": users}, self.key)

    @staticmethod
    def _public(user):
        return {
            "id": user["id"],
            "username": user["username"],
            "email": user["email"],
            "permissions": list(user.get("permissions", [])),
        }

    def register(self, username, email, password):
        if not isinstance(username, str) or not USERNAME_RE.fullmatch(username.strip()):
            raise AccountError("Username must be 3-24 letters, numbers, or underscores.")
        username = username.strip()
        email_key = _email_key(email)
        if not isinstance(password, str) or not PASSWORD_MIN_LENGTH <= len(password) <= PASSWORD_MAX_LENGTH:
            raise AccountError("Password must be 12-128 characters.")
        if len(password.encode("utf-8")) > 512:
            raise AccountError("Password is too long.")

        salt = secrets.token_bytes(16)
        user = {
            "id": secrets.token_hex(16),
            "username": username,
            "username_key": username.casefold(),
            "email": email.strip(),
            "email_key": email_key,
            "salt": salt.hex(),
            "password_hash": _password_hash(password, salt).hex(),
            "permissions": [],
            "created": int(time.time()),
        }
        with self.lock:
            users = self._load()
            if any(
                entry.get("email_key") == email_key
                or entry.get("username_key") == username.casefold()
                for entry in users.values()
            ):
                raise AccountError("That username or email is already registered.")
            users[user["id"]] = user
            self._save(users)
        return self._public(user)

    def authenticate(self, email, password):
        try:
            email_key = _email_key(email)
        except AccountError:
            email_key = ""
        if not isinstance(password, str) or len(password.encode("utf-8", errors="ignore")) > 512:
            password = ""
        with self.lock:
            users = self._load()
            user = next((entry for entry in users.values() if entry.get("email_key") == email_key), None)
        if user:
            try:
                salt = bytes.fromhex(user["salt"])
                expected = bytes.fromhex(user["password_hash"])
            except (KeyError, ValueError):
                raise RuntimeError("Account database has an invalid password record.")
        else:
            salt = bytes(16)
            expected = bytes(32)
        candidate = _password_hash(password, salt)
        if not user or not secrets.compare_digest(candidate, expected):
            raise AccountError("Email or password is incorrect.")
        return self._public(user)

    def get(self, user_id):
        with self.lock:
            user = self._load().get(user_id)
        return self._public(user) if user else None

    def authorize(self, user_id):
        with self.lock:
            users = self._load()
            user = users.get(user_id)
            if not user:
                return None
            user["permissions"] = list(PERMISSIONS)
            self._save(users)
            return self._public(user)


class SessionStore:
    def __init__(self):
        self.sessions = {}
        self.lock = threading.Lock()

    @staticmethod
    def _key(token):
        return hashlib.sha256(token.encode("ascii", errors="ignore")).hexdigest()

    def create(self, user_id):
        token = secrets.token_urlsafe(32)
        with self.lock:
            self.sessions[self._key(token)] = {"user_id": user_id, "expires": time.time() + SESSION_SECONDS}
        return token

    def get(self, token):
        if not token:
            return None
        key = self._key(token)
        with self.lock:
            session = self.sessions.get(key)
            if not session or session["expires"] <= time.time():
                self.sessions.pop(key, None)
                return None
            return session["user_id"]

    def revoke(self, token):
        if token:
            with self.lock:
                self.sessions.pop(self._key(token), None)


PAGE_STYLE = """
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 18% 0%,#31205e 0,transparent 42%),#0d1020;color:#f5f4fb;font:16px/1.5 system-ui,sans-serif}.panel{width:min(440px,100%);padding:32px;background:#171a2b;border:1px solid #343851;border-radius:14px;box-shadow:0 24px 80px #050611b0}h1{margin:0 0 8px;font-size:30px;line-height:1.15}p{color:#b6bad0}.eyebrow{margin:0 0 10px;color:#8ce9e5;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.field{display:grid;gap:6px;margin:16px 0}.field label{font-size:14px;font-weight:700}.field input{width:100%;padding:12px;border:1px solid #454b67;border-radius:7px;background:#0f1220;color:#fff;font:inherit}.field input:focus{outline:2px solid #56d9d4;outline-offset:1px}.primary,.secondary{width:100%;min-height:44px;margin-top:12px;padding:10px 14px;border:0;border-radius:7px;background:#4b61d1;color:#fff;font:700 15px system-ui,sans-serif;cursor:pointer}.primary:hover{background:#5b70e2}.secondary{background:transparent;border:1px solid #454b67}.links{display:flex;justify-content:center;gap:16px;margin-top:18px;font-size:14px}a{color:#aab8ff}.error{padding:10px 12px;border:1px solid #9c5261;border-radius:7px;background:#3a202a;color:#ffc6ce}.permissions{display:grid;gap:10px;margin:20px 0;padding:0;list-style:none}.permissions li{padding:12px;border:1px solid #343851;border-radius:7px;background:#111424}.permissions strong{display:block}.permissions small{color:#b6bad0}.fine{font-size:12px;color:#9298b2}
"""


def _page(title, content):
    return (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>" + html.escape(title) + " | Neon Swarm</title><style>"
        + PAGE_STYLE
        + "</style></head><body><main class='panel'>"
        "<p class='eyebrow'>Neon Swarm Account</p>" + content + "</main></body></html>"
    )


def _hidden(name, value):
    return "<input type='hidden' name='" + html.escape(name, quote=True) + "' value='" + html.escape(value, quote=True) + "'>"


def render_login(csrf, next_path="/", error=""):
    next_path = safe_return_path(next_path)
    message = "<p class='error' role='alert'>" + html.escape(error) + "</p>" if error else ""
    content = (
        "<h1>Welcome back</h1><p>Sign in to sync your Neon Swarm profile and game data.</p>"
        + message
        + "<form method='post' action='/auth/login' autocomplete='on'>"
        + _hidden("csrf", csrf) + _hidden("next", next_path)
        + "<div class='field'><label for='email'>Email</label><input id='email' name='email' type='email' maxlength='254' autocomplete='email' required></div>"
        + "<div class='field'><label for='password'>Password</label><input id='password' name='password' type='password' maxlength='128' autocomplete='current-password' required></div>"
        + "<button class='primary' type='submit'>Sign in</button></form>"
        + "<nav class='links'><a href='/auth/register?next=" + quote(next_path, safe="/") + "'>Create account</a></nav>"
    )
    return _page("Sign in", content)


def render_register(csrf, next_path="/", error=""):
    next_path = safe_return_path(next_path)
    message = "<p class='error' role='alert'>" + html.escape(error) + "</p>" if error else ""
    content = (
        "<h1>Create your account</h1><p>Your email is stored encrypted and is not verified by email.</p>"
        + message
        + "<form method='post' action='/auth/register' autocomplete='on'>"
        + _hidden("csrf", csrf) + _hidden("next", next_path)
        + "<div class='field'><label for='username'>Username</label><input id='username' name='username' minlength='3' maxlength='24' pattern='[A-Za-z0-9_]+' autocomplete='username' required></div>"
        + "<div class='field'><label for='email'>Email</label><input id='email' name='email' type='email' maxlength='254' autocomplete='email' required></div>"
        + "<div class='field'><label for='password'>Password</label><input id='password' name='password' type='password' minlength='12' maxlength='128' autocomplete='new-password' required><small class='fine'>Use 12-128 characters.</small></div>"
        + "<button class='primary' type='submit'>Create account</button></form>"
        + "<nav class='links'><a href='/auth/login?next=" + quote(next_path, safe="/") + "'>Already registered? Sign in</a></nav>"
    )
    return _page("Create account", content)


def render_authorize(csrf, username, next_path="/"):
    next_path = safe_return_path(next_path)
    content = (
        "<h1>Authorize Neon Swarm Game</h1><p>Signed in as <strong>"
        + html.escape(username)
        + "</strong>. The game requests permission to access:</p>"
        "<ul class='permissions'><li><strong>Username</strong><small>Show your account name in the game.</small></li>"
        "<li><strong>Email</strong><small>Account email you provided (not verified).</small></li>"
        "<li><strong>Game Data</strong><small>Sync scores, profile, settings, and arcade progress.</small></li></ul>"
        "<p class='fine'>Your password is never shared with the game. Your account data is encrypted on the server.</p>"
        "<form method='post' action='/auth/authorize'>"
        + _hidden("csrf", csrf) + _hidden("next", next_path)
        + "<button class='primary' name='decision' value='authorize' type='submit'>Authorize</button>"
        "<button class='secondary' name='decision' value='cancel' type='submit'>Cancel</button></form>"
    )
    return _page("Authorize Neon Swarm Game", content)