using System.Diagnostics;

namespace NeonSwarm.Picker;

internal sealed record Preset(string Id, string Name, string Detail, int Height, bool Vfx, bool Animations, bool Recommended = false);

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--smoke-test", StringComparer.OrdinalIgnoreCase)) return 0;
        ApplicationConfiguration.Initialize();
        Application.Run(new PickerForm());
        return 0;
    }
}

internal sealed class PickerForm : Form
{
    private readonly Preset[] _presets =
    {
        new("144p","144P","Very pixelated • no VFX or decorative animation",144,false,false),
        new("244p","244P","Pixelated • no VFX or decorative animation",244,false,false),
        new("345p","345P","Low render load • effects and decorative animation off",345,false,false),
        new("480p","480P","Low render load • effects and decorative animation off",480,false,false),
        new("720p","720P","Recommended for mid-range computers",720,true,true,true),
        new("1080p","1080P","High detail • full effects",1080,true,true),
        new("1440p","2K (1440P)","Ultra-smooth effects and animations",1440,true,true),
        new("2160p","2160P (4K)","Sharp 4K render • smooth effects and animations",2160,true,true)
    };
    private Preset _selected;
    private readonly FlowLayoutPanel _choices = new();
    private readonly Panel _terminalPanel = new();
    private readonly RichTextBox _terminal = new();
    private readonly ProgressBar _progress = new();
    private readonly Label _bootStatus = new();
    private readonly Label _selectionStatus = new();
    private readonly Button _continue = new();
    private readonly System.Windows.Forms.Timer _bootTimer = new();
    private int _bootStep;
    private bool _booting;

    public PickerForm()
    {
        _selected = _presets[4];
        Text = "Neon Swarm — Display Setup";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(820, 680);
        MinimumSize = new Size(760, 620);
        BackColor = Color.FromArgb(9, 5, 29);
        ForeColor = Color.FromArgb(244, 234, 255);
        Font = new Font("Segoe UI", 9);
        BuildUi();
        _bootTimer.Interval = 350;
        _bootTimer.Tick += BootNext;
    }

    private void BuildUi()
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 5,
            Padding = new Padding(22),
            BackColor = BackColor
        };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 55));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 45));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));

        var brand = new Label
        {
            Text = "NEON SWARM  /  DISPLAY CONFIGURATION",
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(61, 245, 255),
            Font = new Font("Segoe UI Semibold", 10, FontStyle.Bold),
            TextAlign = ContentAlignment.MiddleLeft
        };
        var title = new Label
        {
            Name = "picker-title",
            Text = "What resolution will you use?",
            Dock = DockStyle.Fill,
            Font = new Font("Segoe UI Semibold", 20, FontStyle.Bold),
            TextAlign = ContentAlignment.MiddleLeft
        };

        _choices.Dock = DockStyle.Fill;
        _choices.AutoScroll = true;
        _choices.WrapContents = true;
        _choices.FlowDirection = FlowDirection.LeftToRight;
        _choices.Padding = new Padding(0, 6, 0, 6);

        foreach (Preset preset in _presets)
        {
            var card = new Panel
            {
                Width = 365,
                Height = 102,
                Margin = new Padding(0, 0, 12, 12),
                BackColor = Color.FromArgb(22, 13, 52),
                Padding = new Padding(12),
                Cursor = Cursors.Hand
            };
            var radio = new RadioButton
            {
                Text = preset.Name + (preset.Recommended ? "  •  RECOMMENDED" : ""),
                Tag = preset,
                Dock = DockStyle.Top,
                Height = 28,
                ForeColor = preset.Recommended ? Color.FromArgb(109, 255, 176) : Color.FromArgb(244, 234, 255),
                Font = new Font("Segoe UI Semibold", 10, FontStyle.Bold),
                Checked = preset.Id == _selected.Id
            };
            var detail = new Label
            {
                Text = preset.Detail,
                Dock = DockStyle.Fill,
                ForeColor = Color.FromArgb(165, 146, 214),
                TextAlign = ContentAlignment.MiddleLeft
            };
            radio.CheckedChanged += (_, _) => { if (radio.Checked) SelectPreset(preset); };
            card.Click += (_, _) => radio.Checked = true;
            detail.Click += (_, _) => radio.Checked = true;
            card.Controls.Add(detail);
            card.Controls.Add(radio);
            _choices.Controls.Add(card);
        }

        _continue.Text = "Continue";
        _continue.Dock = DockStyle.Fill;
        _continue.FlatStyle = FlatStyle.Flat;
        _continue.BackColor = Color.FromArgb(32, 20, 73);
        _continue.ForeColor = Color.FromArgb(61, 245, 255);
        _continue.Font = new Font("Segoe UI Semibold", 12, FontStyle.Bold);
        _continue.FlatAppearance.BorderColor = Color.FromArgb(61, 245, 255);
        _continue.Click += BeginBoot;

        _selectionStatus.Text = "This changes the game's internal render target and effects load, not Windows display settings.";
        _selectionStatus.Dock = DockStyle.Fill;
        _selectionStatus.ForeColor = Color.FromArgb(165, 146, 214);
        _selectionStatus.TextAlign = ContentAlignment.MiddleLeft;

        root.Controls.Add(brand, 0, 0);
        root.Controls.Add(title, 0, 1);
        root.Controls.Add(_choices, 0, 2);
        root.Controls.Add(_continue, 0, 3);
        root.Controls.Add(_selectionStatus, 0, 4);
        Controls.Add(root);

        _terminalPanel.Dock = DockStyle.Fill;
        _terminalPanel.Visible = false;
        _terminalPanel.BackColor = Color.FromArgb(4, 8, 18);
        _terminalPanel.Padding = new Padding(14);
        var terminalLayout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 1 };
        terminalLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        terminalLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 20));
        terminalLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        _terminal.Dock = DockStyle.Fill;
        _terminal.ReadOnly = true;
        _terminal.BorderStyle = BorderStyle.None;
        _terminal.BackColor = Color.FromArgb(4, 8, 18);
        _terminal.ForeColor = Color.FromArgb(109, 255, 176);
        _terminal.Font = new Font("Cascadia Mono", 10);
        _progress.Dock = DockStyle.Fill;
        _bootStatus.Dock = DockStyle.Fill;
        _bootStatus.TextAlign = ContentAlignment.MiddleLeft;
        _bootStatus.ForeColor = Color.FromArgb(61, 245, 255);
        terminalLayout.Controls.Add(_terminal, 0, 0);
        terminalLayout.Controls.Add(_progress, 0, 1);
        terminalLayout.Controls.Add(_bootStatus, 0, 2);
        _terminalPanel.Controls.Add(terminalLayout);
        root.Controls.Add(_terminalPanel, 0, 2);
        _terminalPanel.BringToFront();
    }

    private void SelectPreset(Preset preset)
    {
        if (_booting) return;
        _selected = preset;
        _selectionStatus.Text = preset.Name + " selected — " + preset.Detail;
    }

    private void BeginBoot(object? sender, EventArgs e)
    {
        if (_booting) return;
        _booting = true;
        _choices.Visible = false;
        _continue.Visible = false;
        foreach (Control control in Controls.OfType<TableLayoutPanel>().SelectMany(x => x.Controls.Cast<Control>()))
        {
            if (control is Label label && label.Name == "picker-title") label.Text = "Preparing your Neon Swarm session…";
        }
        _terminalPanel.Visible = true;
        _terminalPanel.BringToFront();
        _terminal.Clear();
        _progress.Value = 0;
        _bootStep = 0;
        _bootStatus.Text = "INITIALIZING";
        Append("NEON SWARM BOOT CONSOLE  /  LOCAL WINDOWS SESSION");
        Append("Selected profile: " + _selected.Name + " (" + _selected.Height + " render pixels)");
        Append("> run Neon_Swarm.exe --options: " + _selected.Name + " --close: false");
        _bootTimer.Start();
    }

    private void BootNext(object? sender, EventArgs e)
    {
        string[] lines =
        {
            "[OK] Loading .NET desktop components",
            "[OK] Preparing WebView2 game surface",
            "[OK] Applying render and effects profile",
            "[OK] Launching Neon_Swarm.exe"
        };
        if (_bootStep < lines.Length)
        {
            Append(lines[_bootStep]);
            _progress.Value = Math.Min(100, (_bootStep + 1) * 25);
            _bootStatus.Text = lines[_bootStep];
            _bootStep++;
            return;
        }

        _bootTimer.Stop();
        try
        {
            string exe = Path.Combine(AppContext.BaseDirectory, "Neon_Swarm.exe");
            if (!File.Exists(exe)) throw new FileNotFoundException("Neon_Swarm.exe was not found.", exe);
            var start = new ProcessStartInfo(exe) { UseShellExecute = true, WorkingDirectory = AppContext.BaseDirectory };
            start.ArgumentList.Add("--picked-resolution");
            start.ArgumentList.Add(_selected.Id);
            start.ArgumentList.Add("--target-height");
            start.ArgumentList.Add(_selected.Height.ToString());
            start.ArgumentList.Add("--vfx");
            start.ArgumentList.Add(_selected.Vfx ? "on" : "off");
            start.ArgumentList.Add("--animations");
            start.ArgumentList.Add(_selected.Animations ? "on" : "off");
            Process.Start(start);
            Append("Session launched. --close: false");
            _bootStatus.Text = "SESSION STARTED";
            BeginInvoke(Close);
        }
        catch (Exception ex)
        {
            Append("[ERROR] " + ex.Message);
            _bootStatus.Text = "LAUNCH FAILED";
            _booting = false;
            _continue.Visible = true;
            _continue.Text = "Try again";
        }
    }

    private void Append(string line)
    {
        _terminal.AppendText(line + Environment.NewLine);
        _terminal.SelectionStart = _terminal.TextLength;
        _terminal.ScrollToCaret();
    }
}
