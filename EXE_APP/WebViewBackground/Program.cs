using System.Diagnostics;
using Microsoft.Win32;

namespace NeonSwarm.WebViewBackground;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Contains("--smoke-test", StringComparer.OrdinalIgnoreCase)) return 0;
        int pid = 0;
        int index = Array.FindIndex(args, x => string.Equals(x, "--owner-pid", StringComparison.OrdinalIgnoreCase));
        if (index >= 0 && index + 1 < args.Length) int.TryParse(args[index + 1], out pid);
        if (pid <= 0) return 2;
        ApplicationConfiguration.Initialize();
        Application.Run(new WebViewMonitor(pid));
        return 0;
    }
}

internal sealed class WebViewMonitor : Form
{
    private readonly int _ownerPid;
    private readonly NotifyIcon _tray;
    private readonly System.Windows.Forms.Timer _timer = new();
    private bool _closing;
    private bool _missingNoticeShown;

    public WebViewMonitor(int ownerPid)
    {
        _ownerPid = ownerPid;
        ShowInTaskbar = false;
        WindowState = FormWindowState.Minimized;
        FormBorderStyle = FormBorderStyle.FixedToolWindow;
        Opacity = 0;

        var menu = new ContextMenuStrip();
        menu.Items.Add("WebView2 runtime status", null, (_, _) => ShowRuntimeStatus());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit WebView2 monitor", null, (_, _) => Close());
        _tray = new NotifyIcon
        {
            Text = "Neon Swarm WebView2 Monitor",
            Icon = SystemIcons.Application,
            ContextMenuStrip = menu,
            Visible = true
        };

        _timer.Interval = 5000;
        _timer.Tick += (_, _) => RefreshStatus();
        Shown += async (_, _) =>
        {
            Hide();
            RefreshStatus();
            _timer.Start();
            await MonitorOwnerAsync();
        };
        FormClosing += (_, _) =>
        {
            _closing = true;
            _timer.Stop();
            _timer.Dispose();
            _tray.Visible = false;
            _tray.Dispose();
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
        if (!_closing && IsHandleCreated) BeginInvoke(Close);
    }

    private void RefreshStatus()
    {
        string version = GetRuntimeVersion();
        int processCount = 0;
        try { processCount = Process.GetProcessesByName("msedgewebview2").Length; } catch { }
        string text = "Neon Swarm WebView2: " + (version == "Not detected" ? "Missing" : "Ready");
        _tray.Text = text[..Math.Min(63, text.Length)];
        if (version == "Not detected" && !_missingNoticeShown)
        {
            _missingNoticeShown = true;
            _tray.ShowBalloonTip(3000, "WebView2 Runtime missing",
                "Close Neon Swarm and run Setup.exe to repair the WebView2 Runtime.", ToolTipIcon.Warning);
        }
    }

    private void ShowRuntimeStatus()
    {
        string version = GetRuntimeVersion();
        int count = 0;
        try { count = Process.GetProcessesByName("msedgewebview2").Length; } catch { }
        MessageBox.Show(
            "Microsoft Edge WebView2 Runtime: " + version +
            "\nWebView2 runtime processes detected: " + count +
            "\nThis monitor stays active while Neon_Swarm.exe is running.",
            "Neon Swarm WebView2 Background",
            MessageBoxButtons.OK,
            version == "Not detected" ? MessageBoxIcon.Warning : MessageBoxIcon.Information);
    }

    private static string GetRuntimeVersion()
    {
        foreach (RegistryHive hive in new[] { RegistryHive.LocalMachine, RegistryHive.CurrentUser })
        {
            foreach (RegistryView view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
            {
                try
                {
                    using RegistryKey baseKey = RegistryKey.OpenBaseKey(hive, view);
                    using RegistryKey? key = baseKey.OpenSubKey(@"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}");
                    string? version = key?.GetValue("pv") as string;
                    if (!string.IsNullOrWhiteSpace(version)) return version;
                }
                catch { }
            }
        }
        return "Not detected";
    }
}
