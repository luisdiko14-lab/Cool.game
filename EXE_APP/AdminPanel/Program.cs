using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace NeonSwarm.AdminPanel;

internal static class Program
{
    internal const string ShowPipe = "NeonSwarmAdminPanelShow";

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--smoke-test", StringComparer.OrdinalIgnoreCase)) return 0;
        bool background = args.Contains("--background", StringComparer.OrdinalIgnoreCase);
        using var mutex = new Mutex(true, @"Local\NeonSwarmAdminPanel", out bool created);
        if (!created)
        {
            if (!background) SendShowSignal();
            return 0;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new AdminForm(background));
        return 0;
    }

    private static void SendShowSignal()
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", ShowPipe, PipeDirection.Out, PipeOptions.Asynchronous);
            pipe.Connect(700);
            using var writer = new StreamWriter(pipe, new UTF8Encoding(false), 512, leaveOpen: false) { AutoFlush = true };
            writer.WriteLine("show");
        }
        catch { }
    }

    internal static Task<string> SendGameCommandAsync(object payload, CancellationToken token = default)
    {
        return Task.Run(async () =>
        {
            try
            {
                using var pipe = new NamedPipeClientStream(".", "NeonSwarmGameAdmin", PipeDirection.InOut, PipeOptions.Asynchronous);
                await pipe.ConnectAsync(1500, token);
                using var reader = new StreamReader(pipe, Encoding.UTF8, false, 1024, leaveOpen: true);
                await using var writer = new StreamWriter(pipe, new UTF8Encoding(false), 1024, leaveOpen: true) { AutoFlush = true };
                await writer.WriteLineAsync(JsonSerializer.Serialize(payload));
                return await reader.ReadLineAsync(token) ?? "{\"ok\":false,\"message\":\"Game did not return a response.\"}";
            }
            catch (Exception ex)
            {
                return JsonSerializer.Serialize(new { ok = false, message = "Neon Swarm is not running or is not ready: " + ex.Message });
            }
        }, token);
    }
}

internal sealed class AdminForm : Form
{
    private readonly NotifyIcon _tray;
    private readonly bool _startHidden;
    private readonly TextBox _password = new();
    private readonly NumericUpDown _fireRate = new();
    private readonly NumericUpDown _damage = new();
    private readonly NumericUpDown _xp = new();
    private readonly NumericUpDown _shield = new();
    private readonly Label _status = new();
    private readonly Panel _commands = new();
    private bool _unlocked;
    private bool _allowExit;
    private readonly CancellationTokenSource _stop = new();

    public AdminForm(bool startHidden)
    {
        _startHidden = startHidden;
        Text = "Neon Swarm — Admin Panel";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(540, 620);
        MinimumSize = new Size(500, 560);
        BackColor = Color.FromArgb(13, 5, 36);
        ForeColor = Color.FromArgb(244, 234, 255);
        Font = new Font("Segoe UI", 9);
        BuildUi();

        var menu = new ContextMenuStrip();
        menu.Items.Add("Open Admin Panel", null, (_, _) => ShowPanel());
        menu.Items.Add("Check game connection", null, async (_, _) => await Send("status"));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit Admin Panel", null, (_, _) => ExitPanel());
        _tray = new NotifyIcon
        {
            Text = "Neon Swarm Admin Panel",
            Icon = SystemIcons.Application,
            ContextMenuStrip = menu,
            Visible = true
        };
        _tray.DoubleClick += (_, _) => ShowPanel();

        FormClosing += HandleClosing;
        Shown += (_, _) =>
        {
            if (_startHidden) Hide();
            _ = ShowPipeLoopAsync(_stop.Token);
            if (!_startHidden) _ = Send("status");
        };
    }

    private void BuildUi()
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 5,
            ColumnCount = 1,
            Padding = new Padding(20),
            BackColor = BackColor
        };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 76));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 60));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));

        var title = new Label
        {
            Text = "NEON SWARM  /  ADMIN CONTROL",
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(61, 245, 255),
            Font = new Font("Segoe UI Semibold", 13, FontStyle.Bold),
            TextAlign = ContentAlignment.MiddleLeft
        };

        var auth = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 2 };
        auth.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        auth.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 120));
        auth.RowStyles.Add(new RowStyle(SizeType.Percent, 55));
        auth.RowStyles.Add(new RowStyle(SizeType.Percent, 45));
        _password.Dock = DockStyle.Fill;
        _password.UseSystemPasswordChar = true;
        _password.PlaceholderText = "Existing game admin password";
        var unlock = MakeButton("UNLOCK");
        unlock.Click += async (_, _) => await UnlockAsync();
        auth.Controls.Add(_password, 0, 0);
        auth.Controls.Add(unlock, 1, 0);
        var hint = new Label
        {
            Text = "Local gameplay overrides — not server administration.",
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(165, 146, 214),
            TextAlign = ContentAlignment.MiddleLeft
        };
        auth.Controls.Add(hint, 0, 1);
        auth.SetColumnSpan(hint, 2);

        _commands.Dock = DockStyle.Fill;
        _commands.Visible = false;
        var commandLayout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 7, Padding = new Padding(0, 8, 0, 0) };
        for (int i = 0; i < 7; i++) commandLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100f / 7f));

        ConfigureNumber(_fireRate, 1, 50, 10);
        ConfigureNumber(_damage, 1, 10000000, 500);
        ConfigureNumber(_xp, 1, 10000, 1);
        ConfigureNumber(_shield, 1, 100, 10);
        commandLayout.Controls.Add(NumberRow("Fire rate (shots/sec)", _fireRate, "SET FIRE RATE", "fireRate"), 0, 0);
        commandLayout.Controls.Add(NumberRow("Damage per shot", _damage, "SET DAMAGE", "damage"), 0, 1);
        commandLayout.Controls.Add(NumberRow("XP multiplier", _xp, "SET XP MULTIPLIER", "xpMultiplier"), 0, 2);
        commandLayout.Controls.Add(NumberRow("Shield duration (seconds)", _shield, "SET SHIELD", "shieldDuration"), 0, 3);

        var grantShield = MakeButton("GRANT SHIELD NOW");
        grantShield.Click += async (_, _) => await Send("grantShield");
        commandLayout.Controls.Add(grantShield, 0, 4);

        var openGame = MakeButton("OPEN IN-GAME ADMIN PANEL");
        openGame.Click += async (_, _) => await Send("openGameAdmin");
        commandLayout.Controls.Add(openGame, 0, 5);

        var hint2 = new Label
        {
            Text = "Commands are sent to the active Neon_Swarm.exe process.",
            ForeColor = Color.FromArgb(165, 146, 214),
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleLeft
        };
        commandLayout.Controls.Add(hint2, 0, 6);
        _commands.Controls.Add(commandLayout);

        _status.Text = "Waiting for Neon Swarm…";
        _status.Dock = DockStyle.Fill;
        _status.ForeColor = Color.FromArgb(109, 255, 176);
        _status.TextAlign = ContentAlignment.MiddleLeft;

        var hide = MakeButton("HIDE TO SYSTEM TRAY");
        hide.Dock = DockStyle.Fill;
        hide.Click += (_, _) => HidePanel();

        root.Controls.Add(title, 0, 0);
        root.Controls.Add(auth, 0, 1);
        root.Controls.Add(_commands, 0, 2);
        root.Controls.Add(_status, 0, 3);
        root.Controls.Add(hide, 0, 4);
        Controls.Add(root);
    }

    private static void ConfigureNumber(NumericUpDown control, decimal min, decimal max, decimal value)
    {
        control.Minimum = min;
        control.Maximum = max;
        control.Value = value;
        control.DecimalPlaces = 0;
        control.Dock = DockStyle.Fill;
        control.BackColor = Color.FromArgb(24, 15, 55);
        control.ForeColor = Color.White;
    }

    private Control NumberRow(string caption, NumericUpDown number, string buttonText, string operation)
    {
        var row = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 1, Margin = new Padding(0, 2, 0, 2) };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 48));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 20));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 32));
        row.Controls.Add(new Label { Text = caption, Dock = DockStyle.Fill, ForeColor = Color.White, TextAlign = ContentAlignment.MiddleLeft }, 0, 0);
        row.Controls.Add(number, 1, 0);
        var apply = MakeButton(buttonText);
        apply.Click += async (_, _) => await Send(operation, (double)number.Value);
        row.Controls.Add(apply, 2, 0);
        return row;
    }

    private static Button MakeButton(string text)
    {
        var button = new Button
        {
            Text = text,
            Dock = DockStyle.Fill,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(29, 18, 63),
            ForeColor = Color.FromArgb(61, 245, 255),
            Font = new Font("Segoe UI Semibold", 8, FontStyle.Bold),
            Margin = new Padding(3)
        };
        button.FlatAppearance.BorderColor = Color.FromArgb(61, 245, 255);
        return button;
    }

    private async Task UnlockAsync()
    {
        string response = await Program.SendGameCommandAsync(new { op = "unlock", password = _password.Text }, _stop.Token);
        try
        {
            using JsonDocument doc = JsonDocument.Parse(response);
            bool ok = doc.RootElement.TryGetProperty("ok", out JsonElement result) && result.GetBoolean();
            _unlocked = ok;
            _commands.Visible = ok;
            _status.Text = ReadMessage(doc);
            _status.ForeColor = ok ? Color.FromArgb(109, 255, 176) : Color.FromArgb(255, 100, 140);
            if (!ok) _password.SelectAll();
            else { _password.Clear(); await Send("status"); }
        }
        catch { _status.Text = response; }
    }

    private async Task Send(string operation, double? value = null)
    {
        if (!_unlocked && operation is not "status" and not "unlock")
        {
            _status.Text = "Unlock the panel first.";
            return;
        }

        string response = value.HasValue
            ? await Program.SendGameCommandAsync(new { op = operation, value = value.Value }, _stop.Token)
            : await Program.SendGameCommandAsync(new { op = operation }, _stop.Token);
        try
        {
            using JsonDocument doc = JsonDocument.Parse(response);
            bool ok = doc.RootElement.TryGetProperty("ok", out JsonElement result) && result.GetBoolean();
            _status.Text = ReadMessage(doc);
            _status.ForeColor = ok ? Color.FromArgb(109, 255, 176) : Color.FromArgb(255, 100, 140);
        }
        catch { _status.Text = response; }
    }

    private static string ReadMessage(JsonDocument doc) =>
        doc.RootElement.TryGetProperty("message", out JsonElement text) ? text.GetString() ?? "Done." : "Done.";

    private async Task ShowPipeLoopAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try
            {
                await using var pipe = new NamedPipeServerStream(
                    Program.ShowPipe, PipeDirection.In, 1, PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(token);
                using var reader = new StreamReader(pipe, Encoding.UTF8, false, 256, leaveOpen: false);
                string? command = await reader.ReadLineAsync(token);
                if (command == "show" && !IsDisposed) BeginInvoke(ShowPanel);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { break; }
            catch (Exception)
            {
                try { await Task.Delay(250, token); } catch { break; }
            }
        }
    }

    private void ShowPanel()
    {
        Show();
        WindowState = FormWindowState.Normal;
        Activate();
    }

    private void HidePanel()
    {
        Hide();
        _tray.ShowBalloonTip(1800, "Neon Swarm Admin Panel", "Still running in the notification area.", ToolTipIcon.Info);
    }

    private void HandleClosing(object? sender, FormClosingEventArgs e)
    {
        if (_allowExit) return;
        e.Cancel = true;
        HidePanel();
    }

    private void ExitPanel()
    {
        _allowExit = true;
        _stop.Cancel();
        _tray.Visible = false;
        _tray.Dispose();
        Close();
    }
}
