using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace NeonSwarm;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--server-smoke-test", StringComparer.OrdinalIgnoreCase))
            return SmokeTestAsync().GetAwaiter().GetResult();

        ApplicationConfiguration.Initialize();
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) =>
        {
            CrashLog.Write("UI thread exception", e.Exception);
            Environment.ExitCode = 1;
            MessageBox.Show("Neon Swarm hit an unexpected error. The recovery helper will offer to retry.",
                "Neon Swarm", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Application.Exit();
        };
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            if (e.ExceptionObject is Exception ex) CrashLog.Write("Unhandled exception", ex);
            Environment.ExitCode = 1;
        };

        using var mutex = new Mutex(true, @"Local\NeonSwarmDesktopApp", out bool first);
        if (!first)
        {
            MessageBox.Show("Neon Swarm is already running.", "Neon Swarm",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }

        try
        {
            Application.Run(new MainForm());
            return Environment.ExitCode;
        }
        catch (Exception ex)
        {
            CrashLog.Write("Fatal startup exception", ex);
            MessageBox.Show("Neon Swarm could not start.\n\n" + ex.Message,
                "Neon Swarm — Startup Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static async Task<int> SmokeTestAsync()
    {
        try
        {
            using var server = new GameServer();
            await server.StartAsync();
            using var client = new HttpClient { BaseAddress = new Uri(server.BaseUrl) };
            string html = await client.GetStringAsync("");
            Check(html.Contains("menu-shell"), "Updated menu HTML is missing.");
            Check(html.Contains("export-progress"), "Save-transfer controls are missing.");
            foreach (string module in new[] { "neon_swarm_features.js", "neon_swarm_expansion.js", "neon_swarm_apex.js" })
                Check((await client.GetStringAsync(module)).Length > 100, $"Game module is missing: {module}");
            Check((await client.GetAsync("api/auth")).IsSuccessStatusCode, "Offline auth status failed.");

            using var score = new StringContent("{\"name\":\"CI Pilot\",\"score\":12345}", Encoding.UTF8, "application/json");
            Check((await client.PostAsync("api/scores", score)).IsSuccessStatusCode, "Offline leaderboard write failed.");

            using var save = new StringContent(
                "{\"token\":\"0123456789abcdef0123456789abcdef\",\"data\":{\"neonswarm.profile\":{\"credits\":10}}}",
                Encoding.UTF8, "application/json");
            Check((await client.PostAsync("api/saves", save)).IsSuccessStatusCode, "Offline save write failed.");

            using var request = new HttpRequestMessage(HttpMethod.Get, "Raya(Slowed).mp3");
            request.Headers.Range = new RangeHeaderValue(0, 15);
            using var audio = await client.SendAsync(request);
            Check((int)audio.StatusCode == 206, "Audio range support is missing.");
            Check((await audio.Content.ReadAsByteArrayAsync()).Length == 16, "Bundled audio is unavailable.");
            return 0;
        }
        catch (Exception ex)
        {
            CrashLog.Write("Desktop server smoke test failed", ex);
            try { File.WriteAllText(Path.Combine(Path.GetTempPath(), "NeonSwarm-SmokeTest.log"), ex.ToString()); } catch { }
            Console.Error.WriteLine("Desktop server smoke test failed:");
            Console.Error.WriteLine(ex);
            return 1;
        }
    }

    private static void Check(bool condition, string error)
    {
        if (!condition) throw new InvalidOperationException(error);
    }
}

internal static class CrashLog
{
    private static readonly object Gate = new();
    public static string DataDirectory => GameServer.DataDirectory;

    public static void Write(string title, Exception ex) => Write(title + Environment.NewLine + ex);

    public static void Write(string message)
    {
        try
        {
            Directory.CreateDirectory(DataDirectory);
            lock (Gate)
                File.AppendAllText(Path.Combine(DataDirectory, "Neon_Swarm_Crash.log"),
                    $"[{DateTimeOffset.Now:O}] {message}{Environment.NewLine}{Environment.NewLine}", Encoding.UTF8);
        }
        catch { }
    }
}

internal sealed class MainForm : Form
{
    private readonly GameServer _server = new();
    private readonly WebView2 _browser = new();
    private readonly ToolStripStatusLabel _status = new();
    private bool _handlerStarted;
    private bool _fullscreen;
    private FormBorderStyle _savedBorder;
    private FormWindowState _savedState;

    public MainForm()
    {
        Text = "Neon Swarm";
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1280, 820);
        MinimumSize = new Size(880, 600);
        BackColor = Color.FromArgb(13, 5, 36);
        ForeColor = Color.FromArgb(244, 234, 255);
        KeyPreview = true;
        AutoScaleMode = AutoScaleMode.Dpi;
        BuildLayout();
        KeyDown += OnShortcut;
    }

    private void BuildLayout()
    {
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 1,
            BackColor = BackColor, Margin = Padding.Empty, Padding = Padding.Empty };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 25));

        var header = new Panel { Dock = DockStyle.Fill, BackColor = Color.FromArgb(15, 9, 37),
            Padding = new Padding(18, 0, 14, 0) };
        var brand = new Label { Text = "NEON SWARM   /   WINDOWS EDITION", Dock = DockStyle.Left,
            Width = 360, TextAlign = ContentAlignment.MiddleLeft, ForeColor = Color.FromArgb(61, 245, 255),
            Font = new Font("Segoe UI Semibold", 10, FontStyle.Bold) };
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Right, Width = 315, Height = 48,
            FlowDirection = FlowDirection.RightToLeft, WrapContents = false, Padding = new Padding(0, 7, 0, 0),
            BackColor = Color.Transparent };
        buttons.Controls.Add(ActionButton("FULLSCREEN", (_, _) => ToggleFullscreen()));
        buttons.Controls.Add(ActionButton("OPEN SAVES", (_, _) => OpenSaves()));
        buttons.Controls.Add(ActionButton("RELOAD", (_, _) => _browser.CoreWebView2?.Reload()));
        header.Controls.Add(buttons);
        header.Controls.Add(brand);

        _browser.Dock = DockStyle.Fill;
        _browser.DefaultBackgroundColor = BackColor;
        _browser.BackColor = BackColor;
        var footer = new StatusStrip { Dock = DockStyle.Fill, SizingGrip = false,
            BackColor = Color.FromArgb(15, 9, 37), ForeColor = Color.FromArgb(165, 146, 214),
            Padding = new Padding(10, 0, 10, 0) };
        _status.Text = "Starting local game host…";
        _status.ForeColor = Color.FromArgb(109, 255, 176);
        footer.Items.Add(_status);
        footer.Items.Add(new ToolStripStatusLabel { Spring = true });
        footer.Items.Add(new ToolStripStatusLabel("v1.0.0  •  LOCAL DESKTOP"));
        layout.Controls.Add(header, 0, 0);
        layout.Controls.Add(_browser, 0, 1);
        layout.Controls.Add(footer, 0, 2);
        Controls.Add(layout);
    }

    private static Button ActionButton(string text, EventHandler click)
    {
        var button = new Button { Text = text, Width = 96, Height = 32, Margin = new Padding(5, 0, 0, 0),
            FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(29, 18, 63),
            ForeColor = Color.FromArgb(244, 234, 255), Font = new Font("Segoe UI Semibold", 8.5f, FontStyle.Bold),
            Cursor = Cursors.Hand };
        button.FlatAppearance.BorderColor = Color.FromArgb(61, 245, 255);
        button.FlatAppearance.BorderSize = 1;
        button.Click += click;
        return button;
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        try
        {
            await _server.StartAsync();
            string profile = Path.Combine(GameServer.DataDirectory, "WebView2");
            Directory.CreateDirectory(profile);
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await _browser.EnsureCoreWebView2Async(environment);
            var core = _browser.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.NavigationCompleted += (_, a) =>
                _status.Text = a.IsSuccess ? "OFFLINE READY  •  LOCAL SAVES AND LEADERBOARD ENABLED"
                    : "GAME PAGE DID NOT LOAD  •  PRESS RELOAD TO RETRY";
            core.DocumentTitleChanged += (_, _) =>
            {
                if (!string.IsNullOrWhiteSpace(core.DocumentTitle)) Text = core.DocumentTitle + " — Neon Swarm";
            };
            core.NewWindowRequested += (_, a) =>
            {
                a.Handled = true;
                if (Uri.TryCreate(a.Uri, UriKind.Absolute, out var uri) &&
                    (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp))
                {
                    try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
                    catch (Exception ex) { CrashLog.Write("External link failed", ex); }
                }
            };
            StartCrashHandler();
            core.Navigate(_server.BaseUrl);
            _status.Text = "OFFLINE READY  •  LOCAL SAVES AND LEADERBOARD ENABLED";
        }
        catch (Exception ex)
        {
            CrashLog.Write("Desktop initialization failed", ex);
            bool webViewProblem = ex.Message.Contains("WebView2", StringComparison.OrdinalIgnoreCase) ||
                                  ex.Message.Contains("browser executable", StringComparison.OrdinalIgnoreCase);
            var result = MessageBox.Show(
                "Neon Swarm could not start its desktop window.\n\n" + ex.Message +
                (webViewProblem ? "\n\nThe Microsoft Edge WebView2 Runtime is required. Setup.exe installs it automatically. Open its installer page now?" :
                    "\n\nSee %LOCALAPPDATA%\\NeonSwarm\\Neon_Swarm_Crash.log for details."),
                "Neon Swarm — Startup Error", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (webViewProblem && result == DialogResult.Yes)
            {
                try { Process.Start(new ProcessStartInfo("https://go.microsoft.com/fwlink/p/?LinkId=2124703") { UseShellExecute = true }); }
                catch (Exception launchEx) { CrashLog.Write("Could not open WebView2 installer page", launchEx); }
            }
            Environment.ExitCode = 0;
            Close();
        }
    }

    private void StartCrashHandler()
    {
        if (_handlerStarted) return;
        string handler = Path.Combine(AppContext.BaseDirectory, "Neon_Swarm_Crash_Handler.exe");
        if (!File.Exists(handler)) { _status.Text = "GAME READY  •  RECOVERY HELPER NOT FOUND"; return; }
        try
        {
            var start = new ProcessStartInfo(handler) { UseShellExecute = false, CreateNoWindow = true,
                WorkingDirectory = AppContext.BaseDirectory };
            start.ArgumentList.Add("--pid"); start.ArgumentList.Add(Environment.ProcessId.ToString());
            start.ArgumentList.Add("--app"); start.ArgumentList.Add(Environment.ProcessPath ?? Path.Combine(AppContext.BaseDirectory, "Neon_Swarm.exe"));
            start.ArgumentList.Add("--workdir"); start.ArgumentList.Add(AppContext.BaseDirectory);
            Process.Start(start);
            _handlerStarted = true;
        }
        catch (Exception ex) { CrashLog.Write("Could not start crash helper", ex); }
    }

    private void OpenSaves()
    {
        try { Process.Start(new ProcessStartInfo("explorer.exe", GameServer.DataDirectory) { UseShellExecute = true }); }
        catch (Exception ex) { CrashLog.Write("Could not open save folder", ex); }
    }

    private void ToggleFullscreen()
    {
        if (!_fullscreen)
        {
            _savedBorder = FormBorderStyle; _savedState = WindowState;
            FormBorderStyle = FormBorderStyle.None; WindowState = FormWindowState.Maximized; _fullscreen = true;
        }
        else
        {
            FormBorderStyle = _savedBorder;
            WindowState = _savedState == FormWindowState.Minimized ? FormWindowState.Normal : _savedState;
            _fullscreen = false;
        }
    }

    private void OnShortcut(object? sender, KeyEventArgs e)
    {
        if (e.KeyCode == Keys.F11) { ToggleFullscreen(); e.Handled = true; e.SuppressKeyPress = true; }
        else if (e.Control && e.KeyCode == Keys.R) { _browser.CoreWebView2?.Reload(); e.Handled = true; e.SuppressKeyPress = true; }
        else if (e.KeyCode == Keys.Escape && _fullscreen) { ToggleFullscreen(); e.Handled = true; e.SuppressKeyPress = true; }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        try { _browser.Dispose(); _server.Dispose(); }
        catch (Exception ex) { CrashLog.Write("Shutdown cleanup error", ex); }
        base.OnFormClosed(e);
    }
}

internal sealed class GameServer : IDisposable
{
    private static readonly HashSet<string> AllowedSaveKeys = new(StringComparer.Ordinal)
    {
        "neonswarm.scores","neonswarm.profile","neonswarm.settings",
        "neonswarm.admin","neonswarm.arcade","neonswarm.features"
    };
    private readonly HttpListener _listener = new();
    private readonly CancellationTokenSource _stop = new();
    private readonly SemaphoreSlim _storage = new(1, 1);
    private readonly string _root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "Game"));
    private readonly string _scores = Path.Combine(DataDirectory, "desktop-scores.json");
    private readonly string _saves = Path.Combine(DataDirectory, "desktop-saves.json");

    public static string DataDirectory
    {
        get
        {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string path = Path.Combine(string.IsNullOrWhiteSpace(local) ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) : local, "NeonSwarm");
            Directory.CreateDirectory(path);
            return path;
        }
    }
    public string BaseUrl { get; private set; } = "";

    public Task StartAsync()
    {
        if (!File.Exists(Path.Combine(_root, "index.html")))
            throw new FileNotFoundException("Game/index.html is missing from the published app.", _root);
        using var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        int port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        BaseUrl = $"http://127.0.0.1:{port}/";
        _listener.Prefixes.Add(BaseUrl);
        _listener.Start();
        _ = ListenAsync(_stop.Token);
        return Task.CompletedTask;
    }

    private async Task ListenAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            HttpListenerContext context;
            try { context = await _listener.GetContextAsync().WaitAsync(token); }
            catch (OperationCanceledException) { break; }
            catch (HttpListenerException) when (token.IsCancellationRequested) { break; }
            catch (ObjectDisposedException) { break; }
            _ = HandleAsync(context, token);
        }
    }

    private async Task HandleAsync(HttpListenerContext c, CancellationToken token)
    {
        try
        {
            string path = Uri.UnescapeDataString(c.Request.Url?.AbsolutePath ?? "/");
            if (path == "/") path = "/index.html";
            if (path == "/api/auth") { await Text(c, "{\"configured\":false,\"authenticated\":false}", "application/json", 200, token); return; }
            if (path == "/api/scores") { await Scores(c, token); return; }
            if (path == "/api/saves") { await Saves(c, token); return; }
            if (c.Request.HttpMethod is not ("GET" or "HEAD")) { await Text(c, "Method not allowed", "text/plain", 405, token); return; }

            string relative = path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            string full = Path.GetFullPath(Path.Combine(_root, relative));
            string prefix = _root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) { await Text(c, "Bad path", "text/plain", 400, token); return; }
            if (!File.Exists(full)) { await Text(c, "Not found", "text/plain", 404, token); return; }

            if (Path.GetFileName(full).Equals("index.html", StringComparison.OrdinalIgnoreCase))
            {
                string html = await File.ReadAllTextAsync(full, token);
                html = html.Replace("https://raw.githubusercontent.com/luisdiko14-lab/Cool.game/main/Raya%28Slowed%29.mp3", "/Raya(Slowed).mp3", StringComparison.OrdinalIgnoreCase);
                html = html.Replace("https://raw.githubusercontent.com/luisdiko14-lab/Cool.game/main/Raya(Slowed).mp3", "/Raya(Slowed).mp3", StringComparison.OrdinalIgnoreCase);
                await Text(c, html, "text/html", 200, token);
                return;
            }
            if (Path.GetExtension(full).Equals(".mp3", StringComparison.OrdinalIgnoreCase)) { await Audio(c, full, token); return; }
            await Bytes(c, await File.ReadAllBytesAsync(full, token), TypeOf(full), 200, token);
        }
        catch (OperationCanceledException) { QuietClose(c); }
        catch (Exception ex) { QuietClose(c); CrashLog.Write("Local HTTP request failed", ex); }
    }

    private async Task Scores(HttpListenerContext c, CancellationToken token)
    {
        if (c.Request.HttpMethod == "GET")
        {
            await _storage.WaitAsync(token);
            List<Score> readRows;
            try { readRows = ReadScores(); } finally { _storage.Release(); }
            await Text(c, JsonSerializer.Serialize(new { scores = readRows }), "application/json", 200, token);
            return;
        }
        if (c.Request.HttpMethod != "POST") { await Text(c, "Method not allowed", "text/plain", 405, token); return; }
        using JsonDocument doc = await ReadJson(c.Request, 4096, token);
        JsonElement root = doc.RootElement;
        if (!root.TryGetProperty("name", out var n) || !root.TryGetProperty("score", out var s) ||
            !s.TryGetInt64(out long value) || value <= 0 || value > 9007199254740991)
        { await Text(c, "{\"error\":\"Invalid score\"}", "application/json", 400, token); return; }
        string name = n.ValueKind == JsonValueKind.String ? n.GetString() ?? "Player" : "Player";
        name = Regex.Replace(name, @"[^\w -]", "", RegexOptions.CultureInvariant);
        name = string.IsNullOrWhiteSpace(name) ? "Player" : name[..Math.Min(12, name.Length)].Trim();

        await _storage.WaitAsync(token);
        List<Score> rows;
        try
        {
            rows = ReadScores();
            rows.Add(new Score { n = name, s = value });
            rows = rows.OrderByDescending(x => x.s).Take(10).ToList();
            await AtomicWrite(_scores, JsonSerializer.Serialize(rows), token);
        }
        finally { _storage.Release(); }
        await Text(c, JsonSerializer.Serialize(new { scores = rows }), "application/json", 200, token);
    }

    private async Task Saves(HttpListenerContext c, CancellationToken token)
    {
        if (c.Request.HttpMethod == "GET")
        {
            string readToken = c.Request.Headers["X-Save-Token"] ?? "";
            if (!Regex.IsMatch(readToken, "^[a-f0-9]{32}$", RegexOptions.CultureInvariant))
            { await Text(c, "{\"error\":\"Invalid save token\"}", "application/json", 400, token); return; }
            await _storage.WaitAsync(token);
            string json = "{}";
            try { if (File.Exists(_saves)) { using var d = JsonDocument.Parse(await File.ReadAllTextAsync(_saves, token)); if (d.RootElement.ValueKind == JsonValueKind.Object) json = d.RootElement.GetRawText(); } }
            catch (JsonException) { json = "{}"; }
            finally { _storage.Release(); }
            await Text(c, "{\"data\":" + json + "}", "application/json", 200, token);
            return;
        }
        if (c.Request.HttpMethod != "POST") { await Text(c, "Method not allowed", "text/plain", 405, token); return; }
        using JsonDocument doc = await ReadJson(c.Request, 524288, token);
        JsonElement root = doc.RootElement;
        string id = root.TryGetProperty("token", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() ?? "" : "";
        if (!Regex.IsMatch(id, "^[a-f0-9]{32}$", RegexOptions.CultureInvariant) ||
            !root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object)
        { await Text(c, "{\"error\":\"Invalid save data\"}", "application/json", 400, token); return; }
        foreach (var field in data.EnumerateObject())
            if (!AllowedSaveKeys.Contains(field.Name) || field.Value.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array) ||
                Encoding.UTF8.GetByteCount(field.Value.GetRawText()) > 131072)
            { await Text(c, "{\"error\":\"Unsupported save section\"}", "application/json", 400, token); return; }
        await _storage.WaitAsync(token);
        try { await AtomicWrite(_saves, data.GetRawText(), token); }
        finally { _storage.Release(); }
        await Text(c, "{\"ok\":true}", "application/json", 200, token);
    }

    private List<Score> ReadScores()
    {
        try
        {
            if (!File.Exists(_scores)) return new();
            return JsonSerializer.Deserialize<List<Score>>(File.ReadAllText(_scores))?
                .Where(x => x.s > 0 && x.s <= 9007199254740991).OrderByDescending(x => x.s).Take(10).ToList() ?? new();
        }
        catch { return new(); }
    }

    private static async Task<JsonDocument> ReadJson(HttpListenerRequest req, int maximum, CancellationToken token)
    {
        using var memory = new MemoryStream();
        byte[] buffer = new byte[8192];
        while (true)
        {
            int count = await req.InputStream.ReadAsync(buffer.AsMemory(), token);
            if (count == 0) break;
            if (memory.Length + count > maximum) throw new InvalidDataException("Request body too large.");
            memory.Write(buffer, 0, count);
        }
        if (memory.Length == 0) throw new InvalidDataException("Request body is empty.");
        return JsonDocument.Parse(memory.ToArray());
    }

    private static async Task AtomicWrite(string path, string content, CancellationToken token)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        string temp = path + ".tmp";
        await File.WriteAllTextAsync(temp, content, Encoding.UTF8, token);
        File.Move(temp, path, true);
    }

    private static async Task Audio(HttpListenerContext c, string path, CancellationToken token)
    {
        byte[] audio = await File.ReadAllBytesAsync(path, token);
        long first = 0, last = audio.LongLength - 1;
        int status = 200;
        string? range = c.Request.Headers["Range"];
        if (!string.IsNullOrWhiteSpace(range) && range.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                string[] parts = range[6..].Split('-', 2);
                if (parts[0].Length == 0) first = Math.Max(0, audio.LongLength - long.Parse(parts[1]));
                else { first = long.Parse(parts[0]); if (parts[1].Length > 0) last = Math.Min(last, long.Parse(parts[1])); }
                if (first < 0 || first > last || first >= audio.LongLength) throw new FormatException();
                status = 206;
            }
            catch { c.Response.StatusCode = 416; c.Response.AddHeader("Content-Range", $"bytes */{audio.LongLength}"); c.Response.Close(); return; }
        }
        int length = checked((int)(last - first + 1));
        c.Response.StatusCode = status; c.Response.ContentType = "audio/mpeg"; c.Response.ContentLength64 = length;
        c.Response.AddHeader("Accept-Ranges", "bytes");
        if (status == 206) c.Response.AddHeader("Content-Range", $"bytes {first}-{last}/{audio.LongLength}");
        await c.Response.OutputStream.WriteAsync(audio.AsMemory(checked((int)first), length), token);
        c.Response.Close();
    }

    private static async Task Text(HttpListenerContext c, string value, string type, int status, CancellationToken token)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(value);
        c.Response.StatusCode = status; c.Response.ContentType = type + "; charset=utf-8";
        c.Response.ContentLength64 = bytes.Length; c.Response.Headers["Cache-Control"] = "no-store";
        c.Response.Headers["X-Content-Type-Options"] = "nosniff";
        if (c.Request.HttpMethod != "HEAD") await c.Response.OutputStream.WriteAsync(bytes.AsMemory(), token);
        c.Response.Close();
    }

    private static async Task Bytes(HttpListenerContext c, byte[] bytes, string type, int status, CancellationToken token)
    {
        c.Response.StatusCode = status; c.Response.ContentType = type; c.Response.ContentLength64 = bytes.LongLength;
        c.Response.Headers["X-Content-Type-Options"] = "nosniff";
        await c.Response.OutputStream.WriteAsync(bytes.AsMemory(), token);
        c.Response.Close();
    }

    private static string TypeOf(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8", ".js" => "application/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8", ".json" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml", ".png" => "image/png", ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp", ".mp3" => "audio/mpeg", ".woff2" => "font/woff2",
        _ => "application/octet-stream"
    };

    private static void QuietClose(HttpListenerContext c) { try { c.Response.Close(); } catch { } }

    public void Dispose()
    {
        _stop.Cancel();
        try { if (_listener.IsListening) _listener.Stop(); } catch { }
        _listener.Close();
        _storage.Dispose();
        _stop.Dispose();
    }

    private sealed class Score
    {
        public string n { get; set; } = "Player";
        public long s { get; set; }
    }
}
