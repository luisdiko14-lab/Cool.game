using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text.Json;

namespace NeonSwarm.UpdateChecker;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Contains("--smoke-test", StringComparer.OrdinalIgnoreCase)) return 0;
        int pid = ReadInt(args, "--owner-pid");
        if (pid <= 0) return 2;
        int build = ReadInt(args, "--build-number");
        ApplicationConfiguration.Initialize();
        Application.Run(new UpdateForm(pid, build));
        return 0;
    }

    private static int ReadInt(string[] args, string key)
    {
        int index = Array.FindIndex(args, x => string.Equals(x, key, StringComparison.OrdinalIgnoreCase));
        return index >= 0 && index + 1 < args.Length && int.TryParse(args[index + 1], out int value) ? value : 0;
    }
}

internal sealed class UpdateForm : Form
{
    private const string LatestReleaseApi = "https://api.github.com/repos/luisdiko14-lab/Cool.game/releases/latest";
    private const string ReleasePage = "https://github.com/luisdiko14-lab/Cool.game/releases";
    private readonly int _ownerPid;
    private readonly int _currentBuild;
    private readonly NotifyIcon _tray;
    private readonly System.Windows.Forms.Timer _timer = new();
    private readonly HttpClient _http = new();
    private bool _closing;
    private bool _promptOpen;
    private volatile bool _launchingInstaller;

    public UpdateForm(int ownerPid, int currentBuild)
    {
        _ownerPid = ownerPid;
        _currentBuild = currentBuild;
        ShowInTaskbar = false;
        WindowState = FormWindowState.Minimized;
        FormBorderStyle = FormBorderStyle.FixedToolWindow;
        Opacity = 0;
        _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("NeonSwarmUpdateChecker", "1.0"));
        _http.Timeout = TimeSpan.FromMinutes(4);

        var menu = new ContextMenuStrip();
        menu.Items.Add("Check for updates now", null, async (_, _) => await CheckForUpdateAsync(true));
        menu.Items.Add("Open Neon Swarm releases", null, (_, _) => OpenUrl(ReleasePage));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit update checker", null, (_, _) => Close());
        _tray = new NotifyIcon
        {
            Text = "Neon Swarm Update Checker",
            Icon = SystemIcons.Application,
            ContextMenuStrip = menu,
            Visible = true
        };

        _timer.Interval = 6 * 60 * 60 * 1000;
        _timer.Tick += async (_, _) => await CheckForUpdateAsync(false);
        Shown += async (_, _) =>
        {
            Hide();
            _ = MonitorOwnerAsync();
            await Task.Delay(12000);
            if (_closing) return;
            await CheckForUpdateAsync(false);
            _timer.Start();
        };
        FormClosing += (_, _) =>
        {
            _closing = true;
            _timer.Stop();
            _timer.Dispose();
            _tray.Visible = false;
            _tray.Dispose();
            _http.Dispose();
        };
    }

    private async Task MonitorOwnerAsync()
    {
        try
        {
            using Process owner = Process.GetProcessById(_ownerPid);
            await owner.WaitForExitAsync();
        }
        catch { }
        if (!_closing && !_launchingInstaller && IsHandleCreated) BeginInvoke(Close);
    }

    private async Task CheckForUpdateAsync(bool manual)
    {
        if (_promptOpen) return;
        try
        {
            using HttpResponseMessage response = await _http.GetAsync(LatestReleaseApi);
            response.EnsureSuccessStatusCode();
            using JsonDocument release = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            JsonElement root = release.RootElement;
            string tag = root.GetProperty("tag_name").GetString() ?? "";
            string page = root.GetProperty("html_url").GetString() ?? ReleasePage;
            const string prefix = "neon-swarm-desktop-build-";
            if (!tag.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                if (manual) _tray.ShowBalloonTip(2500, "Neon Swarm", "No desktop release was found.", ToolTipIcon.Info);
                return;
            }

            if (!int.TryParse(tag[prefix.Length..], out int latest) || latest <= _currentBuild)
            {
                if (manual) _tray.ShowBalloonTip(2500, "Neon Swarm", "You're up to date (build " + _currentBuild + ").", ToolTipIcon.Info);
                return;
            }

            string? assetUrl = null;
            foreach (JsonElement asset in root.GetProperty("assets").EnumerateArray())
            {
                if (string.Equals(asset.GetProperty("name").GetString(), "Neon_Swarm_Setup.exe", StringComparison.OrdinalIgnoreCase))
                {
                    assetUrl = asset.GetProperty("browser_download_url").GetString();
                    break;
                }
            }

            _tray.ShowBalloonTip(4000, "Neon Swarm update available", "Build " + latest + " is available.", ToolTipIcon.Info);
            _promptOpen = true;
            DialogResult result = MessageBox.Show(
                "Neon Swarm build " + latest + " is available.\n\nDownload and open the official Setup wizard?",
                "Neon Swarm Update", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
            _promptOpen = false;
            if (result != DialogResult.Yes) return;
            if (string.IsNullOrWhiteSpace(assetUrl))
            {
                OpenUrl(page);
                return;
            }

            string folder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "NeonSwarm", "Updates");
            Directory.CreateDirectory(folder);
            string installer = Path.Combine(folder, "Neon_Swarm_Setup_" + latest + ".exe");
            using HttpResponseMessage download = await _http.GetAsync(assetUrl, HttpCompletionOption.ResponseHeadersRead);
            download.EnsureSuccessStatusCode();
            await using (Stream source = await download.Content.ReadAsStreamAsync())
            await using (FileStream destination = File.Create(installer))
                await source.CopyToAsync(destination);

            DialogResult install = MessageBox.Show(
                "The update has been downloaded. Close Neon Swarm and launch Setup now?",
                "Neon Swarm Update", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (install != DialogResult.Yes)
            {
                _tray.ShowBalloonTip(3000, "Neon Swarm update ready", "The installer is saved in LocalAppData\\NeonSwarm\\Updates.", ToolTipIcon.Info);
                return;
            }

            _launchingInstaller = true;
            string shutdown = await RequestGameShutdownAsync();
            bool shutdownAccepted = false;
            try
            {
                using JsonDocument response = JsonDocument.Parse(shutdown);
                shutdownAccepted = response.RootElement.TryGetProperty("ok", out JsonElement ok) && ok.GetBoolean();
            }
            catch { }
            if (!shutdownAccepted)
            {
                _launchingInstaller = false;
                MessageBox.Show("Neon Swarm could not close automatically. Close the game manually, then run:\n\n" + installer,
                    "Neon Swarm Update", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            try
            {
                using Process owner = Process.GetProcessById(_ownerPid);
                await owner.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(20));
            }
            catch (TimeoutException)
            {
                _launchingInstaller = false;
                MessageBox.Show("Neon Swarm is still running. Close it manually and run the downloaded Setup wizard.",
                    "Neon Swarm Update", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            catch { }

            Process.Start(new ProcessStartInfo(installer) { UseShellExecute = true });
            _timer.Stop();
            BeginInvoke(Close);
        }
        catch (Exception ex)
        {
            if (manual) _tray.ShowBalloonTip(3500, "Update check failed", ex.Message, ToolTipIcon.Warning);
        }
    }

    private async Task<string> RequestGameShutdownAsync()
    {
        try
        {
            using var pipe = new System.IO.Pipes.NamedPipeClientStream(
                ".", "NeonSwarmGameAdmin", System.IO.Pipes.PipeDirection.InOut, System.IO.Pipes.PipeOptions.Asynchronous);
            await pipe.ConnectAsync(2000);
            using var reader = new StreamReader(pipe, System.Text.Encoding.UTF8, false, 512, leaveOpen: true);
            await using var writer = new StreamWriter(pipe, new System.Text.UTF8Encoding(false), 512, leaveOpen: true) { AutoFlush = true };
            await writer.WriteLineAsync("{\\"op\\":\\"closeForUpdate\\"}");
            return await reader.ReadLineAsync() ?? "{\\"ok\\":false}";
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { ok = false, message = ex.Message });
        }
    }

    private static void OpenUrl(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch { }
    }
}
