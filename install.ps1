Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# --- Main Form Setup ---
$form = New-Object System.Windows.Forms.Form
$form.Text = "PowerShell Ultimate Hub v1.0"
$form.Size = New-Object System.Drawing.Size(760, 560)$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)
$form.ForeColor = [System.Drawing.Color]::White$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
$form.MaximizeBox =$false

# --- TabControl Setup ---
$tabControl = New-Object System.Windows.Forms.TabControl
$tabControl.Location = New-Object System.Drawing.Point(12, 12)
$tabControl.Size = New-Object System.Drawing.Size(725, 500)$tabControl.BackColor = [System.Drawing.Color]::FromArgb(37, 37, 38)

# Tab 1: Downloader & Extractor
$tabDownload = New-Object System.Windows.Forms.TabPage
$tabDownload.Text = "Downloader & Extractor"
$tabDownload.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)

# Tab 2: Mini Task Manager
$tabTasks = New-Object System.Windows.Forms.TabPage
$tabTasks.Text = "Mini Task Manager"
$tabTasks.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)

$tabControl.Controls.Add($tabDownload)
$tabControl.Controls.Add($tabTasks)
$form.Controls.Add($tabControl)

# ==========================================
# TAB 1: Downloader & Extractor Components
# ==========================================

# URL Label & TextBox
$lblUrl = New-Object System.Windows.Forms.Label
$lblUrl.Text = "Download URL:"
$lblUrl.Location = New-Object System.Drawing.Point(15, 15)$lblUrl.AutoSize = $true$lblUrl.ForeColor = [System.Drawing.Color]::White
$tabDownload.Controls.Add($lblUrl)

$txtUrl = New-Object System.Windows.Forms.TextBox
$txtUrl.Text = "https://github.com/luisdiko14-lab/Cool.game/archive/refs/tags/v3beta.zip"
$txtUrl.Location = New-Object System.Drawing.Point(15, 35)$txtUrl.Size = New-Object System.Drawing.Size(690, 23)
$txtUrl.BackColor = [System.Drawing.Color]::FromArgb(45, 45, 48)$txtUrl.ForeColor = [System.Drawing.Color]::White
$tabDownload.Controls.Add($txtUrl)

# Target Dir Label, TextBox & Browse Button
$lblDir = New-Object System.Windows.Forms.Label
$lblDir.Text = "Target Save Directory:"
$lblDir.Location = New-Object System.Drawing.Point(15, 70)$lblDir.AutoSize = $true$lblDir.ForeColor = [System.Drawing.Color]::White
$tabDownload.Controls.Add($lblDir)

$txtDir = New-Object System.Windows.Forms.TextBox
$txtDir.Text = "$HOME\Downloads\CoolGame"
$txtDir.Location = New-Object System.Drawing.Point(15, 90)$txtDir.Size = New-Object System.Drawing.Size(580, 23)
$txtDir.BackColor = [System.Drawing.Color]::FromArgb(45, 45, 48)$txtDir.ForeColor = [System.Drawing.Color]::White
$tabDownload.Controls.Add($txtDir)

$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = "Browse..."
$btnBrowse.Location = New-Object System.Drawing.Point(605, 89)
$btnBrowse.Size = New-Object System.Drawing.Size(100, 25)$btnBrowse.BackColor = [System.Drawing.Color]::FromArgb(62, 62, 66)
$btnBrowse.ForeColor = [System.Drawing.Color]::White$btnBrowse.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnBrowse.Add_Click({$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        $txtDir.Text =$dialog.SelectedPath
    }
})
$tabDownload.Controls.Add($btnBrowse)

# ProgressBar & Status Label
$progressBar = New-Object System.Windows.Forms.ProgressBar
$progressBar.Location = New-Object System.Drawing.Point(15, 130)$progressBar.Size = New-Object System.Drawing.Size(690, 25)
$tabDownload.Controls.Add($progressBar)

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text = "Status: Ready"
$lblStatus.Location = New-Object System.Drawing.Point(15, 160)
$lblStatus.Size = New-Object System.Drawing.Size(690, 20)$lblStatus.ForeColor = [System.Drawing.Color]::LightGray
$tabDownload.Controls.Add($lblStatus)

# Action Buttons
$btnDownload = New-Object System.Windows.Forms.Button
$btnDownload.Text = "Start Download"
$btnDownload.Location = New-Object System.Drawing.Point(15, 190)
$btnDownload.Size = New-Object System.Drawing.Size(150, 30)$btnDownload.BackColor = [System.Drawing.Color]::FromArgb(0, 122, 204)
$btnDownload.ForeColor = [System.Drawing.Color]::White$btnDownload.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$tabDownload.Controls.Add($btnDownload)

$btnExtract = New-Object System.Windows.Forms.Button
$btnExtract.Text = "Extract Archive"
$btnExtract.Location = New-Object System.Drawing.Point(175, 190)
$btnExtract.Size = New-Object System.Drawing.Size(150, 30)$btnExtract.BackColor = [System.Drawing.Color]::FromArgb(51, 153, 51)
$btnExtract.ForeColor = [System.Drawing.Color]::White$btnExtract.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$tabDownload.Controls.Add($btnExtract)

# Live Log Console
$lblLog = New-Object System.Windows.Forms.Label
$lblLog.Text = "Live System Logs:"
$lblLog.Location = New-Object System.Drawing.Point(15, 230)$lblLog.AutoSize = $true$lblLog.ForeColor = [System.Drawing.Color]::White
$tabDownload.Controls.Add($lblLog)

$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Multiline = $true$txtLog.ScrollBars = "Vertical"
$txtLog.Location = New-Object System.Drawing.Point(15, 250)$txtLog.Size = New-Object System.Drawing.Size(690, 200)
$txtLog.BackColor = [System.Drawing.Color]::FromArgb(20, 20, 20)$txtLog.ForeColor = [System.Drawing.Color]::LightGreen
$txtLog.ReadOnly =$true
$tabDownload.Controls.Add($txtLog)

# --- Logging Helper ---
function Write-Log {
    param([string]$message)$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp]$message`r`n"
    if ($txtLog.InvokeRequired) {$txtLog.Invoke([Action[string]]{ param($msg)$txtLog.AppendText($msg) },$logEntry)
    } else {
        $txtLog.AppendText($logEntry)
    }
}

# --- Asynchronous Download Logic ---
$btnDownload.Add_Click({
    $url =$txtUrl.Text.Trim()
    $targetDir =$txtDir.Text.Trim()

    if ([string]::IsNullOrEmpty($url) -or [string]::IsNullOrEmpty($targetDir)) {
        [System.Windows.Forms.MessageBox]::Show("Please provide both a valid Download URL and Target Directory.", "Validation Error", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
        return
    }

    try {
        if (-not (Test-Path $targetDir)) {
            New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
            Write-Log "Created target directory: $targetDir"
        }

        $fileName = [System.IO.Path]::GetFileName($url)
        if ([string]::IsNullOrEmpty($fileName) -or -not$fileName.Contains(".")) {
            $fileName = "archive.zip"
        }
        $destFile = Join-Path $targetDir$fileName

        $btnDownload.Enabled = $false$btnExtract.Enabled = $false$progressBar.Value = 0
        Write-Log "Initiating asynchronous download from: $url"
        $lblStatus.Text = "Status: Connecting..."

        $webClient = New-Object System.Net.WebClient

        $progressChanged = {
            param($sender, $e)$form.Invoke([Action]{
                $progressBar.Value =$e.ProgressPercentage
                $recvMb = [Math]::Round($e.BytesReceived / 1MB, 2)
                $totalMb = [Math]::Round($e.TotalBytesToReceive / 1MB, 2)
                $lblStatus.Text = "Status: Downloading... $($e.ProgressPercentage)\% ($recvMb MB / $totalMb MB)"
            })
        }

        $downloadCompleted = {
            param($sender, $e)$form.Invoke([Action]{
                $btnDownload.Enabled =$true
                $btnExtract.Enabled =$true
                if ($e.Error -ne$null) {
                    Write-Log "ERROR: Download failed - $($e.Error.Message)"
                    $lblStatus.Text = "Status: Download Failed"
                    [System.Windows.Forms.MessageBox]::Show("Download failed: $($e.Error.Message)", "Error", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
                } else {
                    Write-Log "SUCCESS: File successfully downloaded to $destFile"
                    $lblStatus.Text = "Status: Download Complete"
                    [System.Windows.Forms.MessageBox]::Show("Download completed successfully!", "Success", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
                }
                $webClient.Dispose()
            })
        }

        $webClient.add_DownloadProgressChanged($progressChanged)
        $webClient.add_DownloadFileCompleted($downloadCompleted)

        $uri = New-Object System.Uri($url)$webClient.DownloadFileAsync($uri,$destFile)
    }
    catch {
        $btnDownload.Enabled =$true
        $btnExtract.Enabled =$true
        Write-Log "EXCEPTION: $_"
        [System.Windows.Forms.MessageBox]::Show("An unexpected error occurred: $_", "Exception", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
    }
})

# --- Archive Extraction Logic ---
$btnExtract.Add_Click({
    $targetDir =$txtDir.Text.Trim()
    if (-not (Test-Path $targetDir)) {
        [System.Windows.Forms.MessageBox]::Show("Target directory does not exist: $targetDir", "Error", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
        return
    }

    try {
        $archives = Get-ChildItem -Path$targetDir -Include *.zip, *.tar.gz, *.tar -Recurse
        if ($archives.Count -eq 0) {
            [System.Windows.Forms.MessageBox]::Show("No supported archives (.zip, .tar.gz, .tar) found in $targetDir", "Extraction Notice", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
            Write-Log "Extraction warning: No archives located in directory."
            return
        }

        foreach ($archive in $archives) {$extractPath = Join-Path $archive.DirectoryName $archive.BaseName
            if ($archive.Name.EndsWith(".tar.gz")) {
                $extractPath = Join-Path$archive.DirectoryName ($archive.Name -replace '\.tar\.gz$', '')
            }

            Write-Log "Extracting archive: $($archive.Name) ->$extractPath"

            if ($archive.Extension -eq ".zip") {
                Expand-Archive -Path $archive.FullName -DestinationPath$extractPath -Force
                Write-Log "SUCCESS: ZIP archive extracted successfully."
            } elseif ($archive.Name.EndsWith(".tar.gz") -or $archive.Extension -eq ".tar") {
                if (Get-Command tar -ErrorAction SilentlyContinue) {
                    if (-not (Test-Path $extractPath)) { New-Item -ItemType Directory -Force -Path$extractPath | Out-Null }
                    tar -xf $archive.FullName -C$extractPath
                    Write-Log "SUCCESS: TAR archive extracted via system tar utility."
                } else {
                    throw "System 'tar' utility not available for extracting TAR/TAR.GZ files."
                }
            }
        }
        [System.Windows.Forms.MessageBox]::Show("All archives extracted successfully!", "Extraction Complete", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
    }
    catch {
        Write-Log "EXTRACTION ERROR: $_"
        [System.Windows.Forms.MessageBox]::Show("Extraction failed: $_", "Error", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
    }
})


# ==========================================
# TAB 2: Mini Task Manager Components
# ==========================================

$listView = New-Object System.Windows.Forms.ListView
$listView.Location = New-Object System.Drawing.Point(15, 15)
$listView.Size = New-Object System.Drawing.Size(690, 400)$listView.View = [System.Windows.Forms.View]::Details
$listView.FullRowSelect =$true
$listView.GridLines =$true
$listView.BackColor = [System.Drawing.Color]::FromArgb(45, 45, 48)$listView.ForeColor = [System.Drawing.Color]::White

$listView.Columns.Add("Process Name", 230, [System.Windows.Forms.HorizontalAlignment]::Left) | Out-Null
$listView.Columns.Add("PID", 80, [System.Windows.Forms.HorizontalAlignment]::Left) | Out-Null
$listView.Columns.Add("CPU (s)", 130, [System.Windows.Forms.HorizontalAlignment]::Right) | Out-Null
$listView.Columns.Add("Memory (MB)", 150, [System.Windows.Forms.HorizontalAlignment]::Right) | Out-Null
$tabTasks.Controls.Add($listView)

$btnRefresh = New-Object System.Windows.Forms.Button
$btnRefresh.Text = "Refresh Processes"
$btnRefresh.Location = New-Object System.Drawing.Point(15, 425)
$btnRefresh.Size = New-Object System.Drawing.Size(150, 30)$btnRefresh.BackColor = [System.Drawing.Color]::FromArgb(0, 122, 204)
$btnRefresh.ForeColor = [System.Drawing.Color]::White$btnRefresh.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$tabTasks.Controls.Add($btnRefresh)

$btnEndTask = New-Object System.Windows.Forms.Button
$btnEndTask.Text = "End Task"
$btnEndTask.Location = New-Object System.Drawing.Point(175, 425)
$btnEndTask.Size = New-Object System.Drawing.Size(150, 30)$btnEndTask.BackColor = [System.Drawing.Color]::FromArgb(202, 81, 0)
$btnEndTask.ForeColor = [System.Drawing.Color]::White$btnEndTask.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$tabTasks.Controls.Add($btnEndTask)

# --- Process Refresh Function ---
function Load-Processes {
    try {
        $listView.BeginUpdate()$listView.Items.Clear()

        $procs = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 60

        foreach ($p in $procs) {$cpuSec = 0
            try { if ($p.CPU -ne $null) {$cpuSec = [Math]::Round($p.CPU, 2) } } catch {}$memMb = 0
            try { if ($p.WorkingSet64 -ne$null) { $memMb = [Math]::Round($p.WorkingSet64 / 1MB, 2) } } catch {}

            $item = New-Object System.Windows.Forms.ListViewItem($p.ProcessName)
            $item.SubItems.Add($p.Id.ToString()) | Out-Null
            $item.SubItems.Add($cpuSec.ToString()) | Out-Null
            $item.SubItems.Add($memMb.ToString()) | Out-Null

            $listView.Items.Add($item) | Out-Null
        }
        $listView.EndUpdate()
    }
    catch {
        $listView.EndUpdate()
        [System.Windows.Forms.MessageBox]::Show("Failed to refresh processes: $_", "Error", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
    }
}

$btnRefresh.Add_Click({
    Load-Processes
})

$btnEndTask.Add_Click({
    if ($listView.SelectedItems.Count -eq 0) {
        [System.Windows.Forms.MessageBox]::Show("Please select a process from the list first.", "No Selection", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
        return
    }

    $selectedItem =$listView.SelectedItems[0]
    $procName =$selectedItem.Text
    $procId = [int]$selectedItem.SubItems[1].Text

    $confirm = [System.Windows.Forms.MessageBox]::Show("Are you sure you want to forcefully terminate process '$procName' (PID:$procId)?", "Confirm Termination", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
    if ($confirm -eq [System.Windows.Forms.DialogResult]::Yes) {
        try {
            Stop-Process -Id $procId -Force
            [System.Windows.Forms.MessageBox]::Show("Successfully terminated '$procName' (PID:$procId).", "Success", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
            Load-Processes
        }
        catch {
            [System.Windows.Forms.MessageBox]::Show("Failed to terminate process: $_", "Error", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
        }
    }
})

# Auto-refresh when switching to Task Manager tab
$tabControl.Add_SelectedIndexChanged({
    if ($tabControl.SelectedTab -eq$tabTasks) {
        Load-Processes
    }
})

# Initial Startup Log
Write-Log "PowerShell Ultimate Hub initialized successfully. Ready."

# --- Launch Application ---
[void]$form.ShowDialog()