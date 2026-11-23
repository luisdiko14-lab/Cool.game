using System.Diagnostics;
using System.Globalization;

namespace NeonSwarm.CrashHandler;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--smoke-test", StringComparer.OrdinalIgnoreCase)) return 0;
        if (!ReadArg(args, "--pid", out string rawPid) ||
            !int.TryParse(rawPid, NumberStyles.None, CultureInfo.InvariantCulture, out int pid) ||
            !ReadArg(args, "--app", out string app) ||
            !ReadArg(args, "--workdir", out string workdir)) return 2;
        app = Path.GetFullPath(app);
        workdir = Path.GetFullPath(workdir);
        if (!File.Exists(app)) return 3;
        ApplicationConfiguration.Initialize();
        Application.Run(new RecoveryForm(pid, app, workdir));
        return 0;
    }

    private static bool ReadArg(string[] args, string name, out string value)
    {
        for (int i = 0; i < args.Length - 1; i++)
            if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
            { value = args[i + 1]; return true; }
        value = "";
        return false;
    }
}

internal sealed class RecoveryForm : Form
{
    private readonly string _app;
    private readonly string _workdir;
    private readonly NotifyIcon _tray;
    private int _pid;
    private bool _closing;

    public RecoveryForm(int pid, string app, string workdir)
    {
        _pid = pid;
        _app = app;
        _workdir = workdir;
        ShowInTaskbar = false;
        WindowState = FormWindowState.Minimized;
        FormBorderStyle = FormBorderStyle.FixedToolWindow;
        Opacity = 0;

        var menu = new ContextMenuStrip();
        menu.Items.Add("Recovery status", null, (_, _) =>
            _tray.ShowBalloonTip(2200, "Neon Swarm", "Crash recovery is monitoring the game.", ToolTipIcon.Info));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit recovery helper", null, (_, _) => Close());
        _tray = new NotifyIcon
        {
            Text = "Neon Swarm Crash Recovery",
            Icon = SystemIcons.Application,
            ContextMenuStrip = menu,
            Visible = true
        };
        Shown += async (_, _) => { Hide(); await MonitorAsync(); };
        FormClosing += (_, _) => { _closing = true; _tray.Visible = false; _tray.Dispose(); };
    }

    private async Task MonitorAsync()
    {
        while (!_closing)
        {
            bool found = false;
            int exitCode = 1;
            Process? process = null;
            try
            {
                process = Process.GetProcessById(_pid);
                found = true;
                await process.WaitForExitAsync();
                exitCode = process.ExitCode;
            }
            catch (ArgumentException) { found = false; }
            catch (InvalidOperationException) { found = false; }
            finally { process?.Dispose(); }

            if (_closing) return;
            if (found && exitCode == 0) { Close(); return; }

            _tray.ShowBalloonTip(2500, "Neon Swarm stopped unexpectedly",
                "Choose Retry in the recovery prompt.", ToolTipIcon.Warning);
            DialogResult answer = MessageBox.Show(
                "Neon Swarm closed unexpectedly.\n\nRetry to open app?\n\nYes = continue\nNo = exit",
                "Neon Swarm — Crash Recovery", MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning, MessageBoxDefaultButton.Button1);
            if (answer != DialogResult.Yes) { Close(); return; }

            try
            {
                var start = new ProcessStartInfo(_app)
                {
                    WorkingDirectory = _workdir,
                    UseShellExecute = true
                };
                using Process? launched = Process.Start(start);
                if (launched is null) throw new InvalidOperationException("Windows did not start Neon Swarm.");
                _pid = launched.Id;
            }
            catch (Exception ex)
            {
                DialogResult retry = MessageBox.Show(
                    "Neon Swarm could not be reopened.\n\n" + ex.Message + "\n\nTry again?",
                    "Neon Swarm — Recovery Error", MessageBoxButtons.YesNo, MessageBoxIcon.Error);
                if (retry != DialogResult.Yes) { Close(); return; }
            }
        }
    }
}
