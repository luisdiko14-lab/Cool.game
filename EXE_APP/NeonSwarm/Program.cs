using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.IO.Pipes;
using System.Reflection;
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

        if (!LaunchOptions.HasPickedResolution(args))
        {
            string picker = Path.Combine(AppContext.BaseDirectory, "Neon_Swarm_Pick.exe");
            if (!File.Exists(picker))
            {
                MessageBox.Show("Neon_Swarm_Pick.exe is missing. Repair or reinstall Neon Swarm.",
                    "Neon Swarm Launcher", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 2;
            }
            try
            {
                Process.Start(new ProcessStartInfo(picker) { UseShellExecute = true, WorkingDirectory = AppContext.BaseDirectory });
                return 0;
            }
            catch (Exception ex)
            {
                CrashLog.Write("Could not open the resolution picker", ex);
                MessageBox.Show("Could not open Neon Swarm Pick.\n\n" + ex.Message,
                    "Neon Swarm Launcher", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 2;
            }
        }

        LaunchOptions options = LaunchOptions.FromArgs(args);
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
            Application.Run(new MainForm(options));
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
            using var server = new PythonGameHost();
            await server.StartAsync(smokeTest: true);
            using var client = new HttpClient { BaseAddress = new Uri(server.BaseUrl) };
            string health = await client.GetStringAsync("api/health");
            Check(health.Contains("neon-web-python"), "Python server health endpoint is missing.");
            string html = await client.GetStringAsync("");
            Check(html.Contains("menu-shell"), "Python-served game HTML is missing.");
            Check(html.Contains("NeonSwarmDesktopAdmin"), "Desktop admin bridge is missing.");
            Check(html.Contains("DesktopRenderOptions"), "Render profile logic is missing.");
            foreach (string module in new[] { "neon_swarm_features.js", "neon_swarm_expansion.js", "neon_swarm_apex.js", "neon_swarm_ultimate.js", "neon_swarm_round2.js" })
                Check((await client.GetStringAsync(module)).Length > 100, $"Game module is missing: {module}");
            Check((await client.GetAsync("api/auth")).IsSuccessStatusCode, "Offline auth status failed.");
            Check((await client.GetAsync("api/rooms")).IsSuccessStatusCode, "Room directory read failed.");
            Check((await client.GetAsync("api/events")).IsSuccessStatusCode, "Live event read failed.");

            using var roomPayload = new StringContent("{\"name\":\"CI Lobby\",\"playerName\":\"CI Pilot\",\"maxPlayers\":4}", Encoding.UTF8, "application/json");
            using var createdRoom = await client.PostAsync("api/rooms", roomPayload);
            Check((int)createdRoom.StatusCode == 201, "Python room creation failed.");
            using var roomDoc = JsonDocument.Parse(await createdRoom.Content.ReadAsStringAsync());
            string roomId = roomDoc.RootElement.GetProperty("room").GetProperty("id").GetString() ?? "";
            string roomToken = roomDoc.RootElement.GetProperty("token").GetString() ?? "";
            Check(roomId.Length > 0 && roomToken.Length > 0, "Room credentials were not returned.");
            using var joinPayload = new StringContent("{\"playerName\":\"CI Joiner\"}", Encoding.UTF8, "application/json");
            using var joinResponse = await client.PostAsync($"api/rooms/{roomId}/join", joinPayload);
            Check(joinResponse.IsSuccessStatusCode, "Python room join failed.");
            using var joinDoc = JsonDocument.Parse(await joinResponse.Content.ReadAsStringAsync());
            string joinToken = joinDoc.RootElement.GetProperty("token").GetString() ?? "";
            Check(joinToken.Length > 0, "Join token was not returned.");
            using var heartbeat = new HttpRequestMessage(HttpMethod.Post, $"api/rooms/{roomId}/heartbeat");
            heartbeat.Headers.Add("X-Player-Token", roomToken);
            heartbeat.Content = new StringContent("{\"x\":0.4,\"y\":0.7,\"hp\":150,\"score\":123}", Encoding.UTF8, "application/json");
            using var beatResponse = await client.SendAsync(heartbeat);
            Check(beatResponse.IsSuccessStatusCode, "Room player heartbeat failed.");

            using var marketSession = new StringContent("{\"name\":\"CI Seller\"}", Encoding.UTF8, "application/json");
            using var marketResponse = await client.PostAsync("api/market/session", marketSession);
            Check((int)marketResponse.StatusCode == 201, "Marketplace seller session creation failed.");
            using var marketDoc = JsonDocument.Parse(await marketResponse.Content.ReadAsStringAsync());
            string marketToken = marketDoc.RootElement.GetProperty("token").GetString() ?? "";
            using var listingPayload = new StringContent("{\"item\":{\"name\":\"Test Relic\",\"rarity\":\"RARE\",\"kind\":\"collectible\"},\"price\":200}", Encoding.UTF8, "application/json");
            using var listingRequest = new HttpRequestMessage(HttpMethod.Post, "api/market/listings");
            listingRequest.Headers.Add("X-Market-Token", marketToken);
            listingRequest.Content = listingPayload;
            using var listingResponse = await client.SendAsync(listingRequest);
            Check((int)listingResponse.StatusCode == 201, "Marketplace item listing failed.");
            using var listingDoc = JsonDocument.Parse(await listingResponse.Content.ReadAsStringAsync());
            string listingId = listingDoc.RootElement.GetProperty("listing").GetProperty("id").GetString() ?? "";
            using var buyerPayload = new StringContent("{\"name\":\"CI Buyer\"}", Encoding.UTF8, "application/json");
            using var buyerResponse = await client.PostAsync("api/market/session", buyerPayload);
            using var buyerDoc = JsonDocument.Parse(await buyerResponse.Content.ReadAsStringAsync());
            string buyerToken = buyerDoc.RootElement.GetProperty("token").GetString() ?? "";
            using var buyRequest = new HttpRequestMessage(HttpMethod.Post, $"api/market/listings/{listingId}/buy");
            buyRequest.Headers.Add("X-Market-Token", buyerToken);
            buyRequest.Content = new StringContent("{}", Encoding.UTF8, "application/json");
            using var buyResponse = await client.SendAsync(buyRequest);
            Check(buyResponse.IsSuccessStatusCode, "Marketplace purchase failed.");
            using var accountRequest = new HttpRequestMessage(HttpMethod.Get, "api/market/account");
            accountRequest.Headers.Add("X-Market-Token", buyerToken);
            using var accountResponse = await client.SendAsync(accountRequest);
            using var accountDoc = JsonDocument.Parse(await accountResponse.Content.ReadAsStringAsync());
            Check(accountDoc.RootElement.GetProperty("deliveries").GetArrayLength() == 1, "Purchased item was not delivered.");

            using var challengePayload = new StringContent("{\"name\":\"CI Challenge\",\"wave\":12,\"density\":1.5,\"seed\":1234}", Encoding.UTF8, "application/json");
            using var challengeResponse = await client.PostAsync("api/challenges", challengePayload);
            Check((int)challengeResponse.StatusCode == 201, "Shared challenge publish failed.");
            using var challengeList = await client.GetAsync("api/challenges");
            using var challengeDoc = JsonDocument.Parse(await challengeList.Content.ReadAsStringAsync());
            Check(challengeDoc.RootElement.GetProperty("challenges").GetArrayLength() > 0, "Shared challenge directory is empty.");

            using var eventPayload = new StringContent("{\"kills\":5}", Encoding.UTF8, "application/json");
            using var eventResponse = await client.PostAsync("api/events/contribute", eventPayload);
            Check(eventResponse.IsSuccessStatusCode, "Live event contribution failed.");
            using var corsRequest = new HttpRequestMessage(HttpMethod.Options, "api/rooms");
            corsRequest.Headers.Add("Origin", "https://another-pilot.example");
            using var corsResponse = await client.SendAsync(corsRequest);
            Check(corsResponse.Headers.TryGetValues("Access-Control-Allow-Origin", out var corsValues) && corsValues.Contains("*"), "Cross-origin lobby access is not enabled.");

            using var score = new StringContent("{\"name\":\"CI Pilot\",\"score\":12345}", Encoding.UTF8, "application/json");
            Check((await client.PostAsync("api/scores", score)).IsSuccessStatusCode, "Offline leaderboard write failed.");
            using var save = new StringContent("{\"token\":\"0123456789abcdef0123456789abcdef\",\"data\":{\"neonswarm.profile\":{\"credits\":10}}}", Encoding.UTF8, "application/json");
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
            CrashLog.Write("Python desktop server smoke test failed", ex);
            try { File.WriteAllText(Path.Combine(Path.GetTempPath(), "NeonSwarm-SmokeTest.log"), ex.ToString()); } catch { }
            Console.Error.WriteLine("Python desktop server smoke test failed:");
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
    public static string DataDirectory => DesktopPaths.DataDirectory;

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
    private readonly PythonGameHost _server = new();
    private readonly WebView2 _browser = new();
    private readonly ToolStripStatusLabel _status = new();
    private readonly LaunchOptions _launchOptions;
    private readonly CancellationTokenSource _adminPipeStop = new();
    private bool _handlerStarted;
    private bool _fullscreen;
    private FormBorderStyle _savedBorder;
    private FormWindowState _savedState;

    public MainForm(LaunchOptions launchOptions)
    {
        _launchOptions = launchOptions;
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
            string profile = Path.Combine(DesktopPaths.DataDirectory, "WebView2");
            Directory.CreateDirectory(profile);
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await _browser.EnsureCoreWebView2Async(environment);
            var core = _browser.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.NavigationCompleted += (_, a) =>
                _status.Text = a.IsSuccess ? "PYTHON HOST READY  •  LOCAL + LAN SERVER ACTIVE"
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
            StartCompanions();
            _ = AdminPipeLoopAsync(_adminPipeStop.Token);
            string query = "?resolution=" + Uri.EscapeDataString(_launchOptions.Resolution) +
                "&targetHeight=" + _launchOptions.TargetHeight +
                "&vfx=" + (_launchOptions.Vfx ? "on" : "off") +
                "&animations=" + (_launchOptions.Animations ? "on" : "off");
            core.Navigate(_server.BaseUrl + query);
            _status.Text = "PYTHON HOST READY  •  LOCAL + LAN SERVER ACTIVE";
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
            foreach (string item in _launchOptions.ToArguments()) start.ArgumentList.Add(item);
            Process.Start(start);
            _handlerStarted = true;
        }
        catch (Exception ex) { CrashLog.Write("Could not start crash helper", ex); }
    }

    private void StartCompanions()
    {
        string info = typeof(Program).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "build.0";
        string buildNumber = info.Contains("+build.", StringComparison.OrdinalIgnoreCase) ? info.Split("+build.", StringSplitOptions.None).Last() : "0";
        StartCompanion("Neon_Swarm_Update_Checker_Background.exe", "--owner-pid", Environment.ProcessId.ToString(), "--build-number", buildNumber);
        StartCompanion("Neon_Swarm_Webview2_Background.exe", "--owner-pid", Environment.ProcessId.ToString());
        StartCompanion("Admin_Panel.exe", "--background");
    }

    private void StartCompanion(string fileName, params string[] args)
    {
        string path = Path.Combine(AppContext.BaseDirectory, fileName);
        if (!File.Exists(path)) { CrashLog.Write("Background companion is missing: " + fileName); return; }
        try
        {
            var start = new ProcessStartInfo(path) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = AppContext.BaseDirectory };
            foreach (string arg in args) start.ArgumentList.Add(arg);
            Process.Start(start);
        }
        catch (Exception ex) { CrashLog.Write("Could not start companion " + fileName, ex); }
    }

    private async Task AdminPipeLoopAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try
            {
                await using var pipe = new NamedPipeServerStream("NeonSwarmGameAdmin", PipeDirection.InOut, 1,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(token);
                using var reader = new StreamReader(pipe, Encoding.UTF8, false, 1024, leaveOpen: true);
                await using var writer = new StreamWriter(pipe, new UTF8Encoding(false), 1024, leaveOpen: true) { AutoFlush = true };
                string? line = await reader.ReadLineAsync(token);
                if (string.IsNullOrWhiteSpace(line)) continue;
                string reply = await RunAdminRequestAsync(line, token);
                await writer.WriteLineAsync(reply);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                CrashLog.Write("Admin IPC request failed", ex);
                try { await Task.Delay(250, token); } catch { break; }
            }
        }
    }

    private async Task<string> RunAdminRequestAsync(string requestJson, CancellationToken token)
    {
        try
        {
            using JsonDocument request = JsonDocument.Parse(requestJson);
            if (request.RootElement.TryGetProperty("op", out JsonElement operation) &&
                operation.ValueKind == JsonValueKind.String &&
                string.Equals(operation.GetString(), "closeForUpdate", StringComparison.Ordinal))
            {
                _ = Task.Run(async () =>
                {
                    await Task.Delay(900);
                    if (!IsDisposed && IsHandleCreated) BeginInvoke(new Action(Close));
                });
                return JsonSerializer.Serialize(new { ok = true, message = "Neon Swarm is closing for its update." });
            }
            string script = "window.NeonSwarmDesktopAdmin ? window.NeonSwarmDesktopAdmin.handle(" +
                request.RootElement.GetRawText() + ") : {ok:false,message:'The game page is not ready.'};";
            if (IsDisposed || !IsHandleCreated || _browser.CoreWebView2 is null)
                return "{\"ok\":false,\"message\":\"Neon Swarm is not ready.\"}";
            var completion = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            BeginInvoke(new Action(async () =>
            {
                try { completion.TrySetResult(await _browser.CoreWebView2.ExecuteScriptAsync(script)); }
                catch (Exception ex) { completion.TrySetResult(JsonSerializer.Serialize(new { ok = false, message = ex.Message })); }
            }));
            return await completion.Task.WaitAsync(TimeSpan.FromSeconds(8), token);
        }
        catch (Exception ex) { return JsonSerializer.Serialize(new { ok = false, message = ex.Message }); }
    }

    private void OpenSaves()
    {
        try { Process.Start(new ProcessStartInfo("explorer.exe", DesktopPaths.DataDirectory) { UseShellExecute = true }); }
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
        try
        {
            _adminPipeStop.Cancel();
            _browser.Dispose();
            _server.Dispose();
        }
        catch (Exception ex) { CrashLog.Write("Shutdown cleanup error", ex); }
        base.OnFormClosed(e);
    }
}

internal sealed class PythonGameHost : IDisposable
{
    private Process? _process;
    private bool _disposed;
    public string BaseUrl { get; private set; } = "";

    public async Task StartAsync(bool smokeTest = false)
    {
        string executable = Path.Combine(AppContext.BaseDirectory, "neon_web_python.exe");
        if (!File.Exists(executable))
            throw new FileNotFoundException("neon_web_python.exe is missing from the published app.", executable);

        using var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        int port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        BaseUrl = $"http://127.0.0.1:{port}/";

        string logPath = Path.Combine(DesktopPaths.DataDirectory, "neon_web_python.log");
        var start = new ProcessStartInfo(executable)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = AppContext.BaseDirectory
        };
        foreach (string arg in new[] { "--server", "--lan", "--no-browser", "--port", port.ToString(),
                     "--log-file", logPath })
            start.ArgumentList.Add(arg);
        start.Environment["NEON_SWARM_APP_DIR"] = DesktopPaths.DataDirectory;
        if (smokeTest)
        {
            // Test-only Fernet key: enables encrypted save tests in GitHub Actions,
            // where auth.py intentionally refuses to create a persistent key.
            start.Environment["NEON_SWARM_DATA_KEY"] = "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=";
        }
        _process = new Process { StartInfo = start, EnableRaisingEvents = true };
        if (!_process.Start())
            throw new InvalidOperationException("Windows could not start neon_web_python.exe.");

        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        var deadline = DateTimeOffset.UtcNow.AddSeconds(30);
        Exception? lastError = null;
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (_process.HasExited)
            {
                string log = ReadLogTail(logPath);
                throw new InvalidOperationException(
                    $"The Python game backend exited with code {_process.ExitCode}. {log}");
            }
            try
            {
                using var response = await client.GetAsync(BaseUrl + "api/health");
                if (response.IsSuccessStatusCode)
                {
                    string body = await response.Content.ReadAsStringAsync();
                    if (body.Contains("neon-web-python", StringComparison.Ordinal))
                        return;
                }
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException)
            {
                lastError = ex;
            }
            await Task.Delay(250);
        }

        string detail = ReadLogTail(logPath);
        throw new TimeoutException(
            "The Python game backend did not become ready within 30 seconds. " +
            (lastError?.Message ?? "") + " " + detail);
    }

    private static string ReadLogTail(string path)
    {
        try
        {
            if (!File.Exists(path)) return "Python server log has not been created.";
            var lines = File.ReadAllLines(path);
            return string.Join(Environment.NewLine, lines.TakeLast(18));
        }
        catch { return "Could not read the Python server log."; }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try
        {
            if (_process is { HasExited: false })
            {
                _process.Kill(entireProcessTree: true);
                _process.WaitForExit(5000);
            }
        }
        catch (Exception ex) { CrashLog.Write("Could not stop Python game backend", ex); }
        finally
        {
            _process?.Dispose();
            _process = null;
        }
    }
}

internal static class DesktopPaths
{
    public static string DataDirectory
    {
        get
        {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string path = Path.Combine(string.IsNullOrWhiteSpace(local)
                ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
                : local, "NeonSwarm");
            Directory.CreateDirectory(path);
            return path;
        }
    }
}

internal sealed record LaunchOptions(string Resolution, int TargetHeight, bool Vfx, bool Animations)
{
    public static bool HasPickedResolution(string[] args) =>
        args.Any(x => string.Equals(x, "--picked-resolution", StringComparison.OrdinalIgnoreCase));

    public static LaunchOptions FromArgs(string[] args)
    {
        string Read(string key, string fallback)
        {
            int index = Array.FindIndex(args, x => string.Equals(x, key, StringComparison.OrdinalIgnoreCase));
            return index >= 0 && index + 1 < args.Length ? args[index + 1] : fallback;
        }
        string resolution = Read("--picked-resolution", "720p").ToLowerInvariant();
        int height = int.TryParse(Read("--target-height", "720"), out int parsed) ? Math.Clamp(parsed, 144, 2160) : 720;
        bool vfx = !string.Equals(Read("--vfx", "on"), "off", StringComparison.OrdinalIgnoreCase);
        bool animations = !string.Equals(Read("--animations", "on"), "off", StringComparison.OrdinalIgnoreCase);
        return new LaunchOptions(resolution, height, vfx, animations);
    }

    public IEnumerable<string> ToArguments()
    {
        yield return "--picked-resolution"; yield return Resolution;
        yield return "--target-height"; yield return TargetHeight.ToString();
        yield return "--vfx"; yield return Vfx ? "on" : "off";
        yield return "--animations"; yield return Animations ? "on" : "off";
    }
}
