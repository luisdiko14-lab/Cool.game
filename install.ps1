
#requires -Version 5.1
<#
    PowerShell Ultimate Hub v1.0
    Download Manager, Archive Extractor & Mini Task Manager
    Windows PowerShell 5.1+
#>

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# ------------------------- Configuration -------------------------

$script:DefaultUrl = 'https://github.com/luisdiko14-lab/Cool.game/archive/refs/tags/v3beta.zip'
$script:DownloadClient = $null
$script:DownloadTask = $null
$script:DownloadCancellation = $null
$script:DownloadedFile = $null
$script:IsDownloading = $false
$script:DownloadStarted = $null
$script:LastCpuSnapshot = @{}
$script:ProcessRefreshBusy = $false

$script:Colors = @{
    Background = [System.Drawing.Color]::FromArgb(24, 26, 32)
    Panel      = [System.Drawing.Color]::FromArgb(32, 35, 43)
    Input      = [System.Drawing.Color]::FromArgb(42, 46, 56)
    Accent     = [System.Drawing.Color]::FromArgb(83, 126, 245)
    Success    = [System.Drawing.Color]::FromArgb(66, 190, 130)
    Danger     = [System.Drawing.Color]::FromArgb(225, 79, 89)
    Text       = [System.Drawing.Color]::FromArgb(235, 238, 245)
    Muted      = [System.Drawing.Color]::FromArgb(155, 163, 179)
    Border     = [System.Drawing.Color]::FromArgb(57, 62, 74)
}

$script:Font = New-Object System.Drawing.Font('Segoe UI', 9)
$script:FontBold = New-Object System.Drawing.Font(
    'Segoe UI', 10, [System.Drawing.FontStyle]::Bold
)

# ------------------------- Helpers -------------------------

function Write-Log {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet('INFO', 'OK', 'WARN', 'ERROR')][string]$Level = 'INFO'
    )

    if ($null -eq $script:LogBox -or $script:LogBox.IsDisposed) {
        return
    }

    $color = switch ($Level) {
        'OK'    { $script:Colors.Success }
        'WARN'  { [System.Drawing.Color]::FromArgb(240, 185, 80) }
        'ERROR' { $script:Colors.Danger }
        default { $script:Colors.Muted }
    }

    $line = '[{0}] [{1}] {2}{3}' -f (
        (Get-Date).ToString('HH:mm:ss'),
        $Level,
        $Message,
        [Environment]::NewLine
    )

    $script:LogBox.SelectionStart = $script:LogBox.TextLength
    $script:LogBox.SelectionColor = $color
    $script:LogBox.AppendText($line)
    $script:LogBox.SelectionColor = $script:Colors.Text
    $script:LogBox.ScrollToCaret()
}

function Show-Error {
    param([string]$Message)

    [void][System.Windows.Forms.MessageBox]::Show(
        $script:Form,
        $Message,
        'PowerShell Ultimate Hub',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    )
}

function Format-Bytes {
    param([long]$Bytes)

    if ($Bytes -lt 0) { return 'Unknown' }
    if ($Bytes -ge 1TB) { return ('{0:N2} TB' -f ($Bytes / 1TB)) }
    if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N2} MB' -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ('{0:N2} KB' -f ($Bytes / 1KB)) }
    return "$Bytes B"
}

function New-UiLabel {
    param(
        [string]$Text,
        [int]$X,
        [int]$Y,
        [int]$Width = 180,
        [int]$Height = 24
    )

    $control = New-Object System.Windows.Forms.Label
    $control.Text = $Text
    $control.Location = New-Object System.Drawing.Point($X, $Y)
    $control.Size = New-Object System.Drawing.Size($Width, $Height)
    $control.ForeColor = $script:Colors.Text
    $control.BackColor = [System.Drawing.Color]::Transparent
    $control.Font = $script:Font
    $control.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    return $control
}

function New-UiTextBox {
    param(
        [int]$X,
        [int]$Y,
        [int]$Width,
        [string]$Value = ''
    )

    $control = New-Object System.Windows.Forms.TextBox
    $control.Location = New-Object System.Drawing.Point($X, $Y)
    $control.Size = New-Object System.Drawing.Size($Width, 29)
    $control.Text = $Value
    $control.Font = $script:Font
    $control.BackColor = $script:Colors.Input
    $control.ForeColor = $script:Colors.Text
    $control.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    return $control
}

function New-UiButton {
    param(
        [string]$Text,
        [int]$X,
        [int]$Y,
        [int]$Width = 130,
        [int]$Height = 34,
        [System.Drawing.Color]$Color
    )

    $control = New-Object System.Windows.Forms.Button
    $control.Text = $Text
    $control.Location = New-Object System.Drawing.Point($X, $Y)
    $control.Size = New-Object System.Drawing.Size($Width, $Height)
    $control.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $control.FlatAppearance.BorderSize = 0
    $control.BackColor = $Color
    $control.ForeColor = [System.Drawing.Color]::White
    $control.Font = $script:Font
    $control.Cursor = [System.Windows.Forms.Cursors]::Hand
    return $control
}

function Set-DownloadState {
    param(
        [bool]$Busy,
        [string]$Status
    )

    $script:IsDownloading = $Busy
    $script:StartButton.Enabled = -not $Busy
    $script:CancelButton.Enabled = $Busy
    $script:UrlBox.Enabled = -not $Busy
    $script:DirectoryBox.Enabled = -not $Busy
    $script:BrowseButton.Enabled = -not $Busy
    $script:ExtractButton.Enabled = -not $Busy
    $script:DownloadStatus.Text = $Status
}

function Get-ArchiveFiles {
    param([string]$Directory)

    if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
        throw "The target directory does not exist: $Directory"
    }

    @(
        Get-ChildItem -LiteralPath $Directory -File |
            Where-Object {
                $_.Name -match '(?i)\.(zip|tar|tar\.gz|tgz)$'
            } |
            Sort-Object LastWriteTime -Descending
    )
}

# ------------------------- Main Window -------------------------

$script:Form = New-Object System.Windows.Forms.Form
$script:Form.Text = 'PowerShell Ultimate Hub v1.0'
$script:Form.StartPosition = 'CenterScreen'
$script:Form.Size = New-Object System.Drawing.Size(1000, 760)
$script:Form.MinimumSize = New-Object System.Drawing.Size(850, 650)
$script:Form.BackColor = $script:Colors.Background
$script:Form.ForeColor = $script:Colors.Text
$script:Form.Font = $script:Font
$script:Form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi

$header = New-Object System.Windows.Forms.Panel
$header.Dock = [System.Windows.Forms.DockStyle]::Top
$header.Height = 76
$header.BackColor = $script:Colors.Panel

$heading = New-Object System.Windows.Forms.Label
$heading.Text = 'ULTIMATE HUB'
$heading.Font = New-Object System.Drawing.Font(
    'Segoe UI', 17, [System.Drawing.FontStyle]::Bold
)
$heading.ForeColor = $script:Colors.Text
$heading.Location = New-Object System.Drawing.Point(22, 10)
$heading.Size = New-Object System.Drawing.Size(340, 32)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = 'DOWNLOAD MANAGER  /  ARCHIVE TOOLS  /  PROCESS MONITOR'
$subtitle.Font = New-Object System.Drawing.Font('Segoe UI', 8)
$subtitle.ForeColor = $script:Colors.Muted
$subtitle.Location = New-Object System.Drawing.Point(24, 45)
$subtitle.Size = New-Object System.Drawing.Size(650, 20)

$version = New-Object System.Windows.Forms.Label
$version.Text = 'v1.0'
$version.ForeColor = $script:Colors.Accent
$version.Font = $script:FontBold
$version.AutoSize = $true
$version.Location = New-Object System.Drawing.Point(900, 28)
$version.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
                  [System.Windows.Forms.AnchorStyles]::Right

$header.Controls.AddRange(@($heading, $subtitle, $version))
$script:Form.Controls.Add($header)

$script:Tabs = New-Object System.Windows.Forms.TabControl
$script:Tabs.Dock = [System.Windows.Forms.DockStyle]::Fill
$script:Tabs.Padding = New-Object System.Drawing.Point(16, 7)
$script:Tabs.Font = $script:Font

$downloadTab = New-Object System.Windows.Forms.TabPage
$downloadTab.Text = 'Downloader & Extractor'
$downloadTab.BackColor = $script:Colors.Background
$downloadTab.ForeColor = $script:Colors.Text

$taskTab = New-Object System.Windows.Forms.TabPage
$taskTab.Text = 'Mini Task Manager'
$taskTab.BackColor = $script:Colors.Background
$taskTab.ForeColor = $script:Colors.Text

[void]$script:Tabs.TabPages.Add($downloadTab)
[void]$script:Tabs.TabPages.Add($taskTab)
$script:Form.Controls.Add($script:Tabs)
$script:Tabs.BringToFront()

# ------------------------- Downloader Tab -------------------------

$downloadPanel = New-Object System.Windows.Forms.Panel
$downloadPanel.Dock = [System.Windows.Forms.DockStyle]::Fill
$downloadPanel.AutoScroll = $true
$downloadPanel.BackColor = $script:Colors.Background
$downloadTab.Controls.Add($downloadPanel)

$downloadPanel.Controls.Add((New-UiLabel 'Download URL' 22 18 200))
$script:UrlBox = New-UiTextBox 22 45 760 $script:DefaultUrl
$script:UrlBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
                        [System.Windows.Forms.AnchorStyles]::Left -bor
                        [System.Windows.Forms.AnchorStyles]::Right
$downloadPanel.Controls.Add($script:UrlBox)

$downloadPanel.Controls.Add((New-UiLabel 'Save Directory' 22 84 200))
$script:DirectoryBox = New-UiTextBox 22 111 650 (
    Join-Path $HOME 'Downloads\CoolGame'
)
$script:DirectoryBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
                              [System.Windows.Forms.AnchorStyles]::Left -bor
                              [System.Windows.Forms.AnchorStyles]::Right
$downloadPanel.Controls.Add($script:DirectoryBox)

$script:BrowseButton = New-UiButton 'Browse...' 685 109 105 32 $script:Colors.Input
$script:BrowseButton.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
                              [System.Windows.Forms.AnchorStyles]::Right
$downloadPanel.Controls.Add($script:BrowseButton)

$script:StartButton = New-UiButton 'Start Download' 22 160 150 38 $script:Colors.Accent
$script:CancelButton = New-UiButton 'Cancel Download' 182 160 150 38 $script:Colors.Danger
$script:CancelButton.Enabled = $false
$script:ExtractButton = New-UiButton 'Extract Archive' 342 160 145 38 $script:Colors.Success
$script:OpenFolderButton = New-UiButton 'Open Folder' 497 160 125 38 $script:Colors.Input
$script:ClearLogButton = New-UiButton 'Clear Log' 632 160 100 38 $script:Colors.Input

$script:StartButton.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
                             [System.Windows.Forms.AnchorStyles]::Left
$script:CancelButton.Anchor = $script:StartButton.Anchor
$script:ExtractButton.Anchor = $script:StartButton.Anchor
$script:OpenFolderButton.Anchor = $script:StartButton.Anchor
$script:ClearLogButton.Anchor = $script:StartButton.Anchor

$downloadPanel.Controls.AddRange(@(
    $script:StartButton,
    $script:CancelButton,
    $script:ExtractButton,
    $script:OpenFolderButton,
    $script:ClearLogButton
))

$script:DownloadStatus = New-UiLabel 'Ready' 22 211 700 24
$script:DownloadStatus.ForeColor = $script:Colors.Muted
$downloadPanel.Controls.Add($script:DownloadStatus)

$script:ProgressBar = New-Object System.Windows.Forms.ProgressBar
$script:ProgressBar.Location = New-Object System.Drawing.Point(22, 240)
$script:ProgressBar.Size = New-Object System.Drawing.Size(760, 24)
$script:ProgressBar.Minimum = 0
$script:ProgressBar.Maximum = 100
$script:ProgressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
$script:ProgressBar.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
                             [System.Windows.Forms.AnchorStyles]::Left -bor
                             [System.Windows.Forms.AnchorStyles]::Right
$downloadPanel.Controls.Add($script:ProgressBar)

$script:BytesLabel = New-UiLabel 'Downloaded: 0 B / Unknown' 22 270 500 23
$downloadPanel.Controls.Add($script:BytesLabel)

$script:PercentLabel = New-UiLabel '0%' 710 270 72 23
$script:PercentLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$script:PercentLabel.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
                              [System.Windows.Forms.AnchorStyles]::Right
$downloadPanel.Controls.Add($script:PercentLabel)

$downloadPanel.Controls.Add((New-UiLabel 'LIVE ACTIVITY LOG' 22 308 250 24))

$script:LogBox = New-Object System.Windows.Forms.RichTextBox
$script:LogBox.Location = New-Object System.Drawing.Point(22, 336)
$script:LogBox.Size = New-Object System.Drawing.Size(760, 235)
$script:LogBox.ReadOnly = $true
$script:LogBox.BackColor = [System.Drawing.Color]::FromArgb(18, 20, 25)
$script:LogBox.ForeColor = $script:Colors.Text
$script:LogBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$script:LogBox.Font = New-Object System.Drawing.Font('Consolas', 9)
$script:LogBox.DetectUrls = $true
$script:LogBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
                        [System.Windows.Forms.AnchorStyles]::Bottom -bor
                        [System.Windows.Forms.AnchorStyles]::Left -bor
                        [System.Windows.Forms.AnchorStyles]::Right
$downloadPanel.Controls.Add($script:LogBox)

$script:ArchiveHint = New-UiLabel (
    'Supported formats: ZIP, TAR, TAR.GZ and TGZ. Extraction uses built-in Windows tools where available.'
) 22 578 760 42
$script:ArchiveHint.ForeColor = $script:Colors.Muted
$script:ArchiveHint.Anchor = [System.Windows.Forms.AnchorStyles]::Bottom -bor
                              [System.Windows.Forms.AnchorStyles]::Left -bor
                              [System.Windows.Forms.AnchorStyles]::Right
$downloadPanel.Controls.Add($script:ArchiveHint)

# ------------------------- Task Manager Tab -------------------------

$taskPanel = New-Object System.Windows.Forms.Panel
$taskPanel.Dock = [System.Windows.Forms.DockStyle]::Fill
$taskPanel.BackColor = $script:Colors.Background
$taskTab.Controls.Add($taskPanel)

$taskPanel.Controls.Add((New-UiLabel 'RUNNING PROCESSES' 18 14 280 26))

$script:ProcessSummary = New-UiLabel 'Refresh to load process information.' 18 42 720 24
$script:ProcessSummary.ForeColor = $script:Colors.Muted
$taskPanel.Controls.Add($script:ProcessSummary)

$script:ProcessList = New-Object System.Windows.Forms.ListView
$script:ProcessList.Location = New-Object System.Drawing.Point(18, 75)
$script:ProcessList.Size = New-Object System.Drawing.Size(920, 470)
$script:ProcessList.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor
                             [System.Windows.Forms.AnchorStyles]::Bottom -bor
                             [System.Windows.Forms.AnchorStyles]::Left -bor
                             [System.Windows.Forms.AnchorStyles]::Right
$script:ProcessList.View = [System.Windows.Forms.View]::Details
$script:ProcessList.FullRowSelect = $true
$script:ProcessList.GridLines = $true
$script:ProcessList.MultiSelect = $false
$script:ProcessList.HideSelection = $false
$script:ProcessList.BackColor = $script:Colors.Panel
$script:ProcessList.ForeColor = $script:Colors.Text
$script:ProcessList.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle

[void]$script:ProcessList.Columns.Add('Process Name', 280)
[void]$script:ProcessList.Columns.Add('PID', 90)
[void]$script:ProcessList.Columns.Add('CPU (s)', 150)
[void]$script:ProcessList.Columns.Add('Memory (MB)', 150)

$taskPanel.Controls.Add($script:ProcessList)

$script:RefreshButton = New-UiButton 'Refresh Processes' 18 565 160 38 $script:Colors.Accent
$script:EndTaskButton = New-UiButton 'End Selected Task' 190 565 160 38 $script:Colors.Danger
$script:EndTaskButton.Enabled = $false
$script:ProcessCountLabel = New-UiLabel '0 processes' 370 570 300 28
$script:ProcessCountLabel.ForeColor = $script:Colors.Muted

$script:RefreshButton.Anchor = [System.Windows.Forms.AnchorStyles]::Bottom -bor
                               [System.Windows.Forms.AnchorStyles]::Left
$script:EndTaskButton.Anchor = $script:RefreshButton.Anchor
$script:ProcessCountLabel.Anchor = $script:RefreshButton.Anchor

$taskPanel.Controls.AddRange(@(
    $script:RefreshButton,
    $script:EndTaskButton,
    $script:ProcessCountLabel
))

# ------------------------- Process Manager -------------------------

function Refresh-ProcessList {
    if ($script:ProcessRefreshBusy -or $script:Form.IsDisposed) {
        return
    }

    $script:ProcessRefreshBusy = $true

    try {
        $script:ProcessList.BeginUpdate()
        $script:ProcessList.Items.Clear()

        $processes = @(
            Get-Process -ErrorAction SilentlyContinue |
                Sort-Object WorkingSet64 -Descending |
                Select-Object -First 100
        )

        foreach ($process in $processes) {
            $cpu = 'N/A'

            if ($null -ne $process.CPU) {
                $cpu = '{0:N1}' -f $process.CPU
            }

            $memory = '{0:N1}' -f ($process.WorkingSet64 / 1MB)
            $item = New-Object System.Windows.Forms.ListViewItem($process.ProcessName)
            [void]$item.SubItems.Add([string]$process.Id)
            [void]$item.SubItems.Add($cpu)
            [void]$item.SubItems.Add($memory)
            $item.Tag = [int]$process.Id

            [void]$script:ProcessList.Items.Add($item)
        }

        $script:ProcessCountLabel.Text = "$($processes.Count) processes displayed"
        $script:ProcessSummary.Text = 'Sorted by memory usage. Some system processes require administrator privileges.'
    }
    catch {
        Show-Error "Could not refresh processes: $($_.Exception.Message)"
    }
    finally {
        $script:ProcessList.EndUpdate()
        $script:ProcessRefreshBusy = $false
    }
}

$script:ProcessList.Add_SelectedIndexChanged({
    $script:EndTaskButton.Enabled = ($script:ProcessList.SelectedItems.Count -gt 0)
})

$script:RefreshButton.Add_Click({
    try {
        Refresh-ProcessList
    }
    catch {
        Show-Error $_.Exception.Message
    }
})

$script:EndTaskButton.Add_Click({
    try {
        if ($script:ProcessList.SelectedItems.Count -eq 0) {
            return
        }

        $item = $script:ProcessList.SelectedItems[0]
        $processId = [int]$item.Tag
        $processName = $item.Text

        if ($processId -eq $PID) {
            Show-Error 'For safety, this application will not terminate itself.'
            return
        }

        $answer = [System.Windows.Forms.MessageBox]::Show(
            $script:Form,
            "Terminate process '$processName' (PID $processId)?`r`nUnsaved work in that process may be lost.",
            'Confirm End Task',
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )

        if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) {
            return
        }

        $process = Get-Process -Id $processId -ErrorAction Stop
        Stop-Process -InputObject $process -Force -ErrorAction Stop

        [void][System.Windows.Forms.MessageBox]::Show(
            $script:Form,
            "Process $processName (PID $processId) was terminated.",
            'End Task',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        )

        Refresh-ProcessList
    }
    catch {
        Show-Error (
            "Could not terminate the selected process.`r`n" +
            'It may have exited already or require administrator privileges.' +
            "`r`n`r`nDetails: $($_.Exception.Message)"
        )
    }
})

$script:Tabs.Add_SelectedIndexChanged({
    if ($script:Tabs.SelectedTab -eq $taskTab) {
        Refresh-ProcessList
    }
})

# ------------------------- Download Manager -------------------------

$script:BrowseButton.Add_Click({
    try {
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description = 'Choose where downloads should be saved.'
        $dialog.ShowNewFolderButton = $true

        if (Test-Path -LiteralPath $script:DirectoryBox.Text -PathType Container) {
            $dialog.SelectedPath = $script:DirectoryBox.Text
        }

        if ($dialog.ShowDialog($script:Form) -eq [System.Windows.Forms.DialogResult]::OK) {
            $script:DirectoryBox.Text = $dialog.SelectedPath
        }
    }
    catch {
        Show-Error "Could not open folder browser: $($_.Exception.Message)"
    }
})

$script:OpenFolderButton.Add_Click({
    try {
        $directory = $script:DirectoryBox.Text.Trim()

        if ([string]::IsNullOrWhiteSpace($directory)) {
            throw 'Enter a target directory first.'
        }

        if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
            New-Item -ItemType Directory -Path $directory -Force | Out-Null
        }

        Start-Process explorer.exe -ArgumentList "`"$directory`""
    }
    catch {
        Show-Error "Could not open directory: $($_.Exception.Message)"
    }
})

$script:ClearLogButton.Add_Click({
    $script:LogBox.Clear()
    Write-Log 'Activity log cleared.'
})

$script:StartButton.Add_Click({
    try {
        if ($script:IsDownloading) {
            return
        }

        $url = $script:UrlBox.Text.Trim()
        $directory = $script:DirectoryBox.Text.Trim()

        $uri = $null
        if (-not [Uri]::TryCreate(
            $url,
            [System.UriKind]::Absolute,
            [ref]$uri
        )) {
            throw 'Enter a valid absolute download URL.'
        }

        if ($uri.Scheme -notin @('http', 'https')) {
            throw 'Only HTTP and HTTPS download URLs are supported.'
        }

        if ([string]::IsNullOrWhiteSpace($directory)) {
            throw 'Choose a target save directory.'
        }

        $directory = [System.IO.Path]::GetFullPath($directory)

        if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
            New-Item -ItemType Directory -Path $directory -Force | Out-Null
        }

        $fileName = [System.IO.Path]::GetFileName($uri.AbsolutePath)

        if ([string]::IsNullOrWhiteSpace($fileName)) {
            $fileName = 'download.bin'
        }

        if ($fileName -notmatch '(?i)\.(zip|tar|tar\.gz|tgz)$') {
            $fileName = "$fileName"
        }

        $destination = Join-Path $directory $fileName

        if (Test-Path -LiteralPath $destination) {
            $overwrite = [System.Windows.Forms.MessageBox]::Show(
                $script:Form,
                "The file already exists:`r`n$destination`r`n`r`nOverwrite it?",
                'Confirm Overwrite',
                [System.Windows.Forms.MessageBoxButtons]::YesNo,
                [System.Windows.Forms.MessageBoxIcon]::Question
            )

            if ($overwrite -ne [System.Windows.Forms.DialogResult]::Yes) {
                return
            }
        }

        $script:DownloadedFile = $destination
        $script:ProgressBar.Value = 0
        $script:PercentLabel.Text = '0%'
        $script:BytesLabel.Text = 'Downloaded: 0 B / Unknown'
        $script:DownloadStarted = Get-Date

        Set-DownloadState -Busy $true -Status 'Connecting...'
        Write-Log "Starting download: $url"
        Write-Log "Destination: $destination"

        $script:DownloadCancellation = New-Object System.Threading.CancellationTokenSource

        # Run the transfer on a background task so the WinForms UI remains responsive.
        $script:DownloadTask = [System.Threading.Tasks.Task]::Run(
            [System.Action]{
                $client = $null
                $stream = $null
                $output = $null

                try {
                    $handler = New-Object System.Net.Http.HttpClientHandler
                    $handler.AllowAutoRedirect = $true

                    $client = New-Object System.Net.Http.HttpClient($handler)
                    $client.Timeout = [System.Threading.Timeout]::InfiniteTimeSpan
                    $client.DefaultRequestHeaders.UserAgent.ParseAdd(
                        'PowerShell-Ultimate-Hub/1.0'
                    )

                    $response = $client.GetAsync(
                        $uri,
                        [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead,
                        $script:DownloadCancellation.Token
                    ).GetAwaiter().GetResult()

                    try {
                        $response.EnsureSuccessStatusCode()

                        $total = $response.Content.Headers.ContentLength
                        $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
                        $output = [System.IO.File]::Open(
                            $destination,
                            [System.IO.FileMode]::Create,
                            [System.IO.FileAccess]::Write,
                            [System.IO.FileShare]::None
                        )

                        $buffer = New-Object byte[] (65536)
                        [long]$received = 0

                        while (($read = $stream.Read(
                            $buffer,
                            0,
                            $buffer.Length
                        )) -gt 0) {
                            $script:DownloadCancellation.Token.ThrowIfCancellationRequested()
                            $output.Write($buffer, 0, $read)
                            $received += $read

                            $percent = 0
                            if ($null -ne $total -and $total -gt 0) {
                                $percent = [int][Math]::Min(
                                    100,
                                    [Math]::Floor(($received * 100.0) / $total)
                                )
                            }

                            $receivedSnapshot = $received
                            $totalSnapshot = if ($null -ne $total) { [long]$total } else { -1L }
                            $percentSnapshot = $percent

                            $script:Form.BeginInvoke([Action]{
                                if ($script:Form.IsDisposed) { return }

                                if ($percentSnapshot -ge 0) {
                                    $script:ProgressBar.Value = [Math]::Max(
                                        0,
                                        [Math]::Min(100, $percentSnapshot)
                                    )
                                }

                                $totalText = if ($totalSnapshot -ge 0) {
                                    Format-Bytes $totalSnapshot
                                } else {
                                    'Unknown'
                                }

                                $script:BytesLabel.Text = 'Downloaded: {0} / {1}' -f (
                                    (Format-Bytes $receivedSnapshot),
                                    $totalText
                                )

                                $script:PercentLabel.Text = if ($totalSnapshot -gt 0) {
                                    "$percentSnapshot%"
                                } else {
                                    (Format-Bytes $receivedSnapshot)
                                }

                                $script:DownloadStatus.Text = 'Downloading...'
                            }) | Out-Null
                        }

                        $output.Flush()
                    }
                    finally {
                        if ($null -ne $output) { $output.Dispose() }
                        if ($null -ne $stream) { $stream.Dispose() }
                        $response.Dispose()
                    }

                    $script:Form.BeginInvoke([Action]{
                        if ($script:Form.IsDisposed) { return }

                        $script:ProgressBar.Value = 100
                        $script:PercentLabel.Text = '100%'
                        Set-DownloadState -Busy $false -Status 'Download complete'
                        Write-Log "Download completed: $destination" 'OK'
                        Write-Log 'You can now extract the downloaded archive.'
                    }) | Out-Null
                }
                catch {
                    $message = $_.Exception.GetBaseException().Message
                    $wasCancelled = $script:DownloadCancellation.IsCancellationRequested

                    $script:Form.BeginInvoke([Action]{
                        if ($script:Form.IsDisposed) { return }

                        Set-DownloadState -Busy $false -Status (
                            if ($wasCancelled) { 'Download cancelled' } else { 'Download failed' }
                        )

                        if ($wasCancelled) {
                            Write-Log 'Download cancelled by user.' 'WARN'
                        }
                        else {
                            Write-Log "Download failed: $message" 'ERROR'
                            Show-Error "Download failed:`r`n$message"
                        }
                    }) | Out-Null
                }
                finally {
                    if ($null -ne $client) { $client.Dispose() }
                }
            }
        )
    }
    catch {
        Set-DownloadState -Busy $false -Status 'Ready'
        Write-Log $_.Exception.Message 'ERROR'
        Show-Error $_.Exception.Message
    }
})

$script:CancelButton.Add_Click({
    try {
        if ($null -ne $script:DownloadCancellation -and $script:IsDownloading) {
            $script:DownloadCancellation.Cancel()
            $script:DownloadStatus.Text = 'Cancelling...'
            Write-Log 'Cancellation requested.' 'WARN'
        }
    }
    catch {
        Show-Error "Could not cancel the download: $($_.Exception.Message)"
    }
})

# ------------------------- Archive Extractor -------------------------

$script:ExtractButton.Add_Click({
    try {
        if ($script:IsDownloading) {
            throw 'Wait for the current download to finish before extracting.'
        }

        $directory = $script:DirectoryBox.Text.Trim()

        if ([string]::IsNullOrWhiteSpace($directory)) {
            throw 'Choose a target directory first.'
        }

        $archives = @(Get-ArchiveFiles -Directory $directory)

        if ($archives.Count -eq 0) {
            throw 'No ZIP, TAR, TAR.GZ or TGZ archives were found in the target directory.'
        }

        $selectedArchive = $null

        if ($archives.Count -eq 1) {
            $selectedArchive = $archives[0]
        }
        else {
            $picker = New-Object System.Windows.Forms.Form
            $picker.Text = 'Choose Archive'
            $picker.Size = New-Object System.Drawing.Size(550, 180)
            $picker.StartPosition = 'CenterParent'
            $picker.BackColor = $script:Colors.Background
            $picker.ForeColor = $script:Colors.Text
            $picker.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
            $picker.MaximizeBox = $false
            $picker.MinimizeBox = $false

            $combo = New-Object System.Windows.Forms.ComboBox
            $combo.Location = New-Object System.Drawing.Point(16, 20)
            $combo.Size = New-Object System.Drawing.Size(500, 30)
            $combo.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
            $combo.BackColor = $script:Colors.Input
            $combo.ForeColor = $script:Colors.Text

            foreach ($archive in $archives) {
                [void]$combo.Items.Add($archive.Name)
            }

            $combo.SelectedIndex = 0

            $choose = New-UiButton 'Extract Selected' 16 70 150 35 $script:Colors.Success
            $cancel = New-UiButton 'Cancel' 180 70 100 35 $script:Colors.Input
            $choose.DialogResult = [System.Windows.Forms.DialogResult]::OK
            $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

            $picker.Controls.AddRange(@($combo, $choose, $cancel))
            $picker.AcceptButton = $choose
            $picker.CancelButton = $cancel

            if ($picker.ShowDialog($script:Form) -ne [System.Windows.Forms.DialogResult]::OK) {
                $picker.Dispose()
                return
            }

            $selectedArchive = $archives[$combo.SelectedIndex]
            $picker.Dispose()
        }

        $name = $selectedArchive.Name
        $extractName = $name -replace '(?i)\.tar\.gz$', ''
        $extractName = $extractName -replace '(?i)\.tgz$', ''
        $extractName = $extractName -replace '(?i)\.zip$', ''
        $extractName = $extractName -replace '(?i)\.tar$', ''

        if ([string]::IsNullOrWhiteSpace($extractName)) {
            $extractName = 'Extracted'
        }

        $destination = Join-Path $directory $extractName
        $destination = [System.IO.Path]::GetFullPath($destination)
        $baseDirectory = [System.IO.Path]::GetFullPath($directory)

        if (-not $destination.StartsWith(
            $baseDirectory.TrimEnd('\') + '\',
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
            throw 'Invalid extraction destination.'
        }

        if (Test-Path -LiteralPath $destination) {
            $confirm = [System.Windows.Forms.MessageBox]::Show(
                $script:Form,
                "The extraction folder already exists:`r`n$destination`r`n`r`nFiles may be overwritten. Continue?",
                'Confirm Extraction',
                [System.Windows.Forms.MessageBoxButtons]::YesNo,
                [System.Windows.Forms.MessageBoxIcon]::Warning
            )

            if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) {
                return
            }
        }
        else {
            New-Item -ItemType Directory -Path $destination -Force | Out-Null
        }

        Write-Log "Extracting $name to $destination"

        if ($name -match '(?i)\.zip$') {
            Expand-Archive -LiteralPath $selectedArchive.FullName `
                -DestinationPath $destination -Force -ErrorAction Stop
        }
        elseif ($name -match '(?i)\.(tar\.gz|tgz|tar)$') {
            $tar = Get-Command tar.exe -ErrorAction SilentlyContinue

            if ($null -eq $tar) {
                throw 'TAR extraction requires tar.exe, available on supported modern Windows versions.'
            }

            $tarArgs = @('-xf', $selectedArchive.FullName, '-C', $destination)
            $process = Start-Process -FilePath $tar.Source `
                -ArgumentList $tarArgs `
                -Wait -PassThru -NoNewWindow

            if ($process.ExitCode -ne 0) {
                throw "tar.exe returned exit code $($process.ExitCode). The archive may be invalid or unsupported."
            }
        }
        else {
            throw 'Unsupported archive format.'
        }

        Write-Log "Extraction completed: $destination" 'OK'
        $script:DownloadStatus.Text = 'Extraction complete'

        [void][System.Windows.Forms.MessageBox]::Show(
            $script:Form,
            "Archive extracted successfully.`r`n`r`n$destination",
            'Extraction Complete',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        )
    }
    catch {
        Write-Log "Extraction failed: $($_.Exception.Message)" 'ERROR'
        Show-Error "Extraction failed:`r`n$($_.Exception.Message)"
    }
})

# ------------------------- Lifecycle -------------------------

$script:Form.Add_Shown({
    Write-Log 'PowerShell Ultimate Hub initialized.' 'OK'
    Write-Log 'Enter a URL, choose a save directory, and select Start Download.'
    Write-Log 'Downloads run in the background; process termination may require administrator rights.'
})

$script:Form.Add_FormClosing({
    param($sender, $eventArgs)

    if ($script:IsDownloading) {
        $answer = [System.Windows.Forms.MessageBox]::Show(
            $script:Form,
            'A download is still running. Cancel the download and close the application?',
            'Download in Progress',
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )

        if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) {
            $eventArgs.Cancel = $true
            return
        }

        if ($null -ne $script:DownloadCancellation) {
            $script:DownloadCancellation.Cancel()
        }
    }
})

try {
    [void]$script:Form.ShowDialog()
}
catch {
    [void][System.Windows.Forms.MessageBox]::Show(
        "The application encountered an unexpected error:`r`n$($_.Exception.Message)",
        'PowerShell Ultimate Hub',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    )
}
finally {
    if ($null -ne $script:DownloadCancellation) {
        try { $script:DownloadCancellation.Dispose() } catch {}
    }

    if ($null -ne $script:Form -and -not $script:Form.IsDisposed) {
        $script:Form.Dispose()
    }
}
