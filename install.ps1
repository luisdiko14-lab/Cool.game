
#requires -Version 5.1

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
} catch {}

$script:AppTitle = 'PowerShell Ultimate Hub v1.0'
$script:DefaultUrl = 'https://github.com/luisdiko14-lab/Cool.game/archive/refs/tags/v3beta.zip'
$script:DownloadClient = $null
$script:DownloadActive = $false
$script:DownloadTempPath = $null
$script:DownloadFinalPath = $null
$script:DownloadCancellation = $null

$script:C = @{
    Background = [Drawing.Color]::FromArgb(18,20,28)
    Panel      = [Drawing.Color]::FromArgb(27,30,41)
    Input      = [Drawing.Color]::FromArgb(35,39,53)
    Foreground = [Drawing.Color]::FromArgb(235,238,248)
    Muted      = [Drawing.Color]::FromArgb(155,163,184)
    Accent     = [Drawing.Color]::FromArgb(108,92,231)
    Green      = [Drawing.Color]::FromArgb(46,204,113)
    Red        = [Drawing.Color]::FromArgb(255,91,110)
}

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')

    if ($null -eq $script:LogBox -or $script:LogBox.IsDisposed) { return }

    $line = '[{0}] [{1}] {2}{3}' -f (Get-Date -Format 'HH:mm:ss'), $Level, $Message, [Environment]::NewLine

    try {
        if ($script:LogBox.InvokeRequired) {
            $script:LogBox.BeginInvoke([Action[string]]{
                param($value)
                if (-not $script:LogBox.IsDisposed) {
                    $script:LogBox.AppendText($value)
                }
            }, $line) | Out-Null
        } else {
            $script:LogBox.AppendText($line)
        }
    } catch {}
}

function New-Label {
    param(
        [string]$Text,
        [int]$X,
        [int]$Y,
        [int]$Width = 200,
        [int]$Height = 24,
        [int]$FontSize = 10,
        [Drawing.Color]$Color = $script:C.Foreground
    )

    $c = New-Object Windows.Forms.Label
    $c.Text = $Text
    $c.Location = New-Object Drawing.Point($X,$Y)
    $c.Size = New-Object Drawing.Size($Width,$Height)
    $c.ForeColor = $Color
    $c.BackColor = [Drawing.Color]::Transparent
    $c.Font = New-Object Drawing.Font('Segoe UI',[single]$FontSize)
    $c.TextAlign = [Drawing.ContentAlignment]::MiddleLeft
    return $c
}

function New-Button {
    param(
        [string]$Text,
        [int]$X,
        [int]$Y,
        [int]$Width,
        [int]$Height = 36,
        [switch]$Secondary
    )

    $c = New-Object Windows.Forms.Button
    $c.Text = $Text
    $c.Location = New-Object Drawing.Point($X,$Y)
    $c.Size = New-Object Drawing.Size($Width,$Height)
    $c.FlatStyle = [Windows.Forms.FlatStyle]::Flat
    $c.FlatAppearance.BorderSize = 0
    $c.FlatAppearance.MouseOverBackColor = [Drawing.Color]::FromArgb(128,112,255)
    $c.BackColor = if ($Secondary) { $script:C.Input } else { $script:C.Accent }
    $c.ForeColor = $script:C.Foreground
    $c.Cursor = [Windows.Forms.Cursors]::Hand
    $c.Font = New-Object Drawing.Font('Segoe UI Semibold',[single]9)
    return $c
}

function New-Panel {
    param([int]$X,[int]$Y,[int]$Width,[int]$Height)

    $c = New-Object Windows.Forms.Panel
    $c.Location = New-Object Drawing.Point($X,$Y)
    $c.Size = New-Object Drawing.Size($Width,$Height)
    $c.BackColor = $script:C.Panel
    return $c
}

function New-TextBox {
    param([string]$Text,[int]$X,[int]$Y,[int]$Width,[int]$Height = 32)

    $c = New-Object Windows.Forms.TextBox
    $c.Text = $Text
    $c.Location = New-Object Drawing.Point($X,$Y)
    $c.Size = New-Object Drawing.Size($Width,$Height)
    $c.BackColor = $script:C.Input
    $c.ForeColor = $script:C.Foreground
    $c.BorderStyle = [Windows.Forms.BorderStyle]::FixedSingle
    $c.Font = New-Object Drawing.Font('Segoe UI',[single]9.5)
    return $c
}

function Format-Bytes {
    param([long]$Bytes)

    if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N2} MB' -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ('{0:N2} KB' -f ($Bytes / 1KB)) }
    return "$Bytes bytes"
}

function Set-DownloadStatus {
    param([string]$Text,[Drawing.Color]$Color = $script:C.Muted)

    if ($null -ne $script:DownloadStatus -and -not $script:DownloadStatus.IsDisposed) {
        $script:DownloadStatus.Text = $Text
        $script:DownloadStatus.ForeColor = $Color
    }
}

function Get-SafeFileName {
    param([Uri]$Uri)

    $name = [IO.Path]::GetFileName($Uri.AbsolutePath)

    if ([string]::IsNullOrWhiteSpace($name)) {
        $name = 'download.bin'
    }

    try { $name = [Uri]::UnescapeDataString($name) } catch {}

    $name = $name -replace '[<>:"/\\|?*\x00-\x1F]','_'

    if ([string]::IsNullOrWhiteSpace($name)) {
        $name = 'download.bin'
    }

    return $name
}

function Start-Download {
    if ($script:DownloadActive) { return }

    $urlText = $script:UrlBox.Text.Trim()
    $directoryText = $script:DirectoryBox.Text.Trim()

    try {
        $uri = $null

        if (-not [Uri]::TryCreate($urlText,[UriKind]::Absolute,[ref]$uri)) {
            throw 'Enter a valid absolute download URL.'
        }

        if ($uri.Scheme -notin @('http','https')) {
            throw 'Only HTTP and HTTPS URLs are supported.'
        }

        if ([string]::IsNullOrWhiteSpace($directoryText)) {
            throw 'Choose a destination directory.'
        }

        $directory = [IO.Path]::GetFullPath(
            [Environment]::ExpandEnvironmentVariables($directoryText)
        )

        if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
            New-Item -ItemType Directory -Path $directory -Force | Out-Null
        }

        $fileName = Get-SafeFileName -Uri $uri
        $destination = Join-Path $directory $fileName

        if (Test-Path -LiteralPath $destination -PathType Leaf) {
            $answer = [Windows.Forms.MessageBox]::Show(
                "The file already exists:`r`n$destination`r`n`r`nReplace it?",
                $script:AppTitle,
                [Windows.Forms.MessageBoxButtons]::YesNo,
                [Windows.Forms.MessageBoxIcon]::Question
            )

            if ($answer -ne [Windows.Forms.DialogResult]::Yes) { return }
        }

        $tempPath = Join-Path $directory ('.download-' + [guid]::NewGuid().ToString('N') + '.tmp')

        # Use HttpWebRequest with redirect support and a streamed response.
        # This avoids WebClient event/closure issues and handles GitHub redirects.
        $script:DownloadActive = $true
        $script:DownloadTempPath = $tempPath
        $script:DownloadFinalPath = $destination
        $script:StartDownloadButton.Enabled = $false
        $script:CancelDownloadButton.Enabled = $true
        $script:ProgressBar.Value = 0
        $script:ProgressLabel.Text = 'Connecting...'
        Set-DownloadStatus 'Connecting to server...' $script:C.Accent

        $script:DownloadCancellation = New-Object Threading.CancellationTokenSource
        $token = $script:DownloadCancellation.Token

        $script:DownloadClient = [System.Net.Http.HttpClient]::new()
        $script:DownloadClient.Timeout = [TimeSpan]::FromMinutes(30)
        $script:DownloadClient.DefaultRequestHeaders.UserAgent.ParseAdd('Mozilla/5.0 PowerShell-Ultimate-Hub/1.0')
        $script:DownloadClient.DefaultRequestHeaders.Accept.ParseAdd('*/*')

        $client = $script:DownloadClient
        $progress = $script:ProgressBar
        $progressLabel = $script:ProgressLabel
        $statusLabel = $script:DownloadStatus
        $startButton = $script:StartDownloadButton
        $cancelButton = $script:CancelDownloadButton
        $form = $script:MainForm
        $log = $script:LogBox
        $extractEnabled = $script:ExtractCheckBox.Checked

        Write-Log "Starting download: $urlText"
        Write-Log "Destination: $destination"

        $worker = [Action]{
            $success = $false
            $errorText = $null
            $cancelled = $false
            $downloadedBytes = [long]0
            $totalBytes = [long]-1

            try {
                $requestUri = $uri
                $response = $client.GetAsync(
                    $requestUri,
                    [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead,
                    $token
                ).GetAwaiter().GetResult()

                try {
                    $response.EnsureSuccessStatusCode()
                    $totalBytes = $response.Content.Headers.ContentLength

                    $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
                    $outputStream = [IO.File]::Open(
                        $tempPath,
                        [IO.FileMode]::CreateNew,
                        [IO.FileAccess]::Write,
                        [IO.FileShare]::None
                    )

                    try {
                        $buffer = New-Object byte[] (128KB)

                        while (($read = $inputStream.Read($buffer,0,$buffer.Length)) -gt 0) {
                            $token.ThrowIfCancellationRequested()
                            $outputStream.Write($buffer,0,$read)
                            $downloadedBytes += $read

                            $received = $downloadedBytes
                            $expected = $totalBytes

                            $form.BeginInvoke([Action]{
                                if ($progress.IsDisposed) { return }

                                if ($expected -gt 0) {
                                    $percent = [int][Math]::Min(100,[Math]::Floor(($received * 100.0) / $expected))
                                    $progress.Value = [Math]::Max(0,[Math]::Min(100,$percent))
                                    $progressLabel.Text = '{0}%  |  {1} of {2}' -f $percent,(Format-Bytes $received),(Format-Bytes $expected)
                                } else {
                                    $progressLabel.Text = (Format-Bytes $received) + ' downloaded'
                                }

                                $statusLabel.Text = 'Downloading...'
                                $statusLabel.ForeColor = $script:C.Accent
                            }) | Out-Null
                        }

                        $outputStream.Flush()
                    }
                    finally {
                        $outputStream.Dispose()
                        $inputStream.Dispose()
                    }
                }
                finally {
                    $response.Dispose()
                }

                if ($downloadedBytes -le 0) {
                    throw 'The server returned an empty file.'
                }

                $success = $true
            }
            catch [OperationCanceledException] {
                $cancelled = $true
            }
            catch {
                $errorText = $_.Exception.Message
                if ($_.Exception.InnerException) {
                    $errorText += ' ' + $_.Exception.InnerException.Message
                }
            }

            $resultSuccess = $success
            $resultError = $errorText
            $resultCancelled = $cancelled
            $resultBytes = $downloadedBytes
            $resultTemp = $tempPath
            $resultDestination = $destination
            $resultExtract = $extractEnabled

            $form.BeginInvoke([Action]{
                try {
                    if ($resultCancelled) {
                        Set-DownloadStatus 'Download cancelled.' $script:C.Red
                        $script:ProgressLabel.Text = 'Cancelled'
                        Write-Log 'Download cancelled.' 'WARNING'
                    }
                    elseif (-not $resultSuccess) {
                        Set-DownloadStatus 'Download failed.' $script:C.Red
                        $script:ProgressLabel.Text = 'Failed'
                        Write-Log "Download failed: $resultError" 'ERROR'

                        [Windows.Forms.MessageBox]::Show(
                            "Download failed:`r`n$resultError",
                            $script:AppTitle,
                            [Windows.Forms.MessageBoxButtons]::OK,
                            [Windows.Forms.MessageBoxIcon]::Error
                        ) | Out-Null
                    }
                    else {
                        if (Test-Path -LiteralPath $resultDestination -PathType Leaf) {
                            Remove-Item -LiteralPath $resultDestination -Force
                        }

                        Move-Item -LiteralPath $resultTemp -Destination $resultDestination -Force

                        $size = Format-Bytes $resultBytes
                        $script:ProgressBar.Value = 100
                        $script:ProgressLabel.Text = "100%  |  $size"
                        Set-DownloadStatus 'Download completed successfully.' $script:C.Green
                        Write-Log "Download completed: $resultDestination ($size)" 'SUCCESS'

                        if ($resultExtract) {
                            $lowerPath = $resultDestination.ToLowerInvariant()
                            $isZip = $lowerPath.EndsWith('.zip')
                            $isTar = $lowerPath.EndsWith('.tar') -or
                                     $lowerPath.EndsWith('.tar.gz') -or
                                     $lowerPath.EndsWith('.tgz')

                            if ($isZip -or $isTar) {
                                try {
                                    $folderName = [IO.Path]::GetFileNameWithoutExtension($resultDestination)

                                    if ($lowerPath.EndsWith('.tar.gz')) {
                                        $folderName = [IO.Path]::GetFileName(
                                            $resultDestination.Substring(0,$resultDestination.Length - 7)
                                        )
                                    }

                                    $extractDir = Join-Path ([IO.Path]::GetDirectoryName($resultDestination)) $folderName

                                    if (-not (Test-Path -LiteralPath $extractDir -PathType Container)) {
                                        New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
                                    }

                                    if ($isZip) {
                                        Expand-Archive -LiteralPath $resultDestination -DestinationPath $extractDir -Force
                                    } else {
                                        $tar = Get-Command tar.exe -ErrorAction SilentlyContinue

                                        if (-not $tar) {
                                            throw 'tar.exe is unavailable on this Windows installation.'
                                        }

                                        $p = Start-Process -FilePath $tar.Source `
                                            -ArgumentList @('-xf',"`"$resultDestination`"",'-C',"`"$extractDir`"") `
                                            -Wait -PassThru -NoNewWindow

                                        if ($p.ExitCode -ne 0) {
                                            throw "tar.exe returned exit code $($p.ExitCode)."
                                        }
                                    }

                                    Set-DownloadStatus 'Download and extraction completed.' $script:C.Green
                                    Write-Log "Extracted archive to $extractDir" 'SUCCESS'
                                }
                                catch {
                                    Set-DownloadStatus 'Downloaded, but extraction failed.' $script:C.Red
                                    Write-Log "Extraction failed: $($_.Exception.Message)" 'ERROR'
                                }
                            }
                        }
                    }
                }
                catch {
                    Set-DownloadStatus 'Unable to finalize download.' $script:C.Red
                    Write-Log "Finalization error: $($_.Exception.Message)" 'ERROR'
                }
                finally {
                    if ($resultTemp -and (Test-Path -LiteralPath $resultTemp -PathType Leaf)) {
                        Remove-Item -LiteralPath $resultTemp -Force -ErrorAction SilentlyContinue
                    }

                    if ($null -ne $script:DownloadClient) {
                        $script:DownloadClient.Dispose()
                        $script:DownloadClient = $null
                    }

                    if ($null -ne $script:DownloadCancellation) {
                        $script:DownloadCancellation.Dispose()
                        $script:DownloadCancellation = $null
                    }

                    $script:DownloadActive = $false

                    if (-not $script:MainForm.IsDisposed) {
                        $script:StartDownloadButton.Enabled = $true
                        $script:CancelDownloadButton.Enabled = $false
                    }
                }
            }) | Out-Null
        }

        $task = [System.Threading.Tasks.Task]::Run($worker)
    }
    catch {
        $script:DownloadActive = $false
        $script:StartDownloadButton.Enabled = $true
        $script:CancelDownloadButton.Enabled = $false
        Set-DownloadStatus 'Unable to start download.' $script:C.Red
        Write-Log "Unable to start download: $($_.Exception.Message)" 'ERROR'

        [Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            $script:AppTitle,
            [Windows.Forms.MessageBoxButtons]::OK,
            [Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
}

function Refresh-ProcessList {
    if ($null -eq $script:ProcessList -or $script:ProcessList.IsDisposed) { return }

    $selectedPid = $null
    if ($script:ProcessList.SelectedItems.Count -gt 0) {
        $selectedPid = [int]$script:ProcessList.SelectedItems[0].SubItems[1].Text
    }

    $script:ProcessList.BeginUpdate()

    try {
        $script:ProcessList.Items.Clear()

        foreach ($p in (Get-Process -ErrorAction SilentlyContinue | Sort-Object ProcessName)) {
            try {
                $memory = [Math]::Round($p.WorkingSet64 / 1MB,1)
                $cpu = if ($null -ne $p.CPU) { [Math]::Round([double]$p.CPU,1) } else { 0 }

                $item = New-Object Windows.Forms.ListViewItem([string]$p.ProcessName)
                $null = $item.SubItems.Add([string]$p.Id)
                $null = $item.SubItems.Add("$cpu s")
                $null = $item.SubItems.Add("$memory MB")

                if ($null -ne $selectedPid -and $p.Id -eq $selectedPid) {
                    $item.Selected = $true
                }

                $script:ProcessList.Items.Add($item) | Out-Null
            } catch {}
        }

        $script:ProcessCountLabel.Text = "$($script:ProcessList.Items.Count) processes"
    }
    finally {
        $script:ProcessList.EndUpdate()
    }
}

function Stop-SelectedProcess {
    if ($script:ProcessList.SelectedItems.Count -eq 0) {
        [Windows.Forms.MessageBox]::Show(
            'Select a process first.',
            $script:AppTitle,
            [Windows.Forms.MessageBoxButtons]::OK,
            [Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
        return
    }

    $item = $script:ProcessList.SelectedItems[0]
    $processId = [int]$item.SubItems[1].Text
    $processName = $item.SubItems[0].Text

    if ($processId -eq $PID) {
        [Windows.Forms.MessageBox]::Show(
            'The application cannot terminate its own process.',
            $script:AppTitle,
            [Windows.Forms.MessageBoxButtons]::OK,
            [Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
        return
    }

    $answer = [Windows.Forms.MessageBox]::Show(
        "End process '$processName' (PID $processId)?`r`nUnsaved work may be lost.",
        $script:AppTitle,
        [Windows.Forms.MessageBoxButtons]::YesNo,
        [Windows.Forms.MessageBoxIcon]::Warning
    )

    if ($answer -ne [Windows.Forms.DialogResult]::Yes) { return }

    try {
        Stop-Process -Id $processId -Force -ErrorAction Stop
        Write-Log "Terminated $processName (PID $processId)." 'WARNING'
        Refresh-ProcessList
    }
    catch {
        Write-Log "Unable to terminate PID ${processId}: $($_.Exception.Message)" 'ERROR'
        [Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            $script:AppTitle,
            [Windows.Forms.MessageBoxButtons]::OK,
            [Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
}

function Open-DownloadDirectory {
    try {
        $path = [IO.Path]::GetFullPath(
            [Environment]::ExpandEnvironmentVariables($script:DirectoryBox.Text.Trim())
        )

        if (-not (Test-Path -LiteralPath $path -PathType Container)) {
            New-Item -ItemType Directory -Path $path -Force | Out-Null
        }

        Start-Process explorer.exe -ArgumentList "`"$path`""
    }
    catch {
        Write-Log "Unable to open directory: $($_.Exception.Message)" 'ERROR'
    }
}

# Main form
$script:MainForm = New-Object Windows.Forms.Form
$script:MainForm.Text = $script:AppTitle
$script:MainForm.Size = New-Object Drawing.Size(1120,820)
$script:MainForm.MinimumSize = New-Object Drawing.Size(1000,740)
$script:MainForm.StartPosition = [Windows.Forms.FormStartPosition]::CenterScreen
$script:MainForm.BackColor = $script:C.Background
$script:MainForm.ForeColor = $script:C.Foreground
$script:MainForm.Font = New-Object Drawing.Font('Segoe UI',[single]9.5)
$script:MainForm.AutoScaleMode = [Windows.Forms.AutoScaleMode]::Font

$header = New-Panel 0 0 1100 82
$header.Dock = [Windows.Forms.DockStyle]::Top
$script:MainForm.Controls.Add($header)

$logo = New-Label 'PS' 22 16 46 46 17
$logo.BackColor = $script:C.Accent
$logo.TextAlign = [Drawing.ContentAlignment]::MiddleCenter
$logo.Font = New-Object Drawing.Font('Segoe UI Semibold',[single]16)
$header.Controls.Add($logo)

$appName = New-Label 'PowerShell Ultimate Hub' 82 12 460 32 17
$appName.Font = New-Object Drawing.Font('Segoe UI Semibold',[single]16)
$header.Controls.Add($appName)

$header.Controls.Add((New-Label 'DOWNLOAD MANAGER  •  PROCESS MANAGER' 84 43 480 22 8 $script:C.Muted))
$version = New-Label 'VERSION 1.0' 930 26 125 25 9 $script:C.Muted
$version.TextAlign = [Drawing.ContentAlignment]::MiddleRight
$header.Controls.Add($version)

$tabs = New-Object Windows.Forms.TabControl
$tabs.Dock = [Windows.Forms.DockStyle]::Fill
$tabs.Font = New-Object Drawing.Font('Segoe UI Semibold',[single]10)
$tabs.Padding = New-Object Drawing.Point(16,7)
$tabs.BackColor = $script:C.Background
$script:MainForm.Controls.Add($tabs)
$tabs.BringToFront()

$downloadTab = New-Object Windows.Forms.TabPage
$downloadTab.Text = '  Downloads  '
$downloadTab.BackColor = $script:C.Background
$downloadTab.ForeColor = $script:C.Foreground
$tabs.TabPages.Add($downloadTab)

$processTab = New-Object Windows.Forms.TabPage
$processTab.Text = '  Task Manager  '
$processTab.BackColor = $script:C.Background
$processTab.ForeColor = $script:C.Foreground
$tabs.TabPages.Add($processTab)

# Download configuration
$downloadPanel = New-Panel 15 15 1030 270
$downloadPanel.Anchor = 'Top,Left,Right'
$downloadTab.Controls.Add($downloadPanel)

$downloadPanel.Controls.Add((New-Label 'Download a file' 20 14 400 30 14))
$downloadPanel.Controls.Add((New-Label 'Enter a direct file URL and choose where to save it.' 20 45 700 23 9 $script:C.Muted))
$downloadPanel.Controls.Add((New-Label 'DOWNLOAD URL' 20 78 150 20 8 $script:C.Muted))

$script:UrlBox = New-TextBox $script:DefaultUrl 20 101 990
$script:UrlBox.Anchor = 'Top,Left,Right'
$downloadPanel.Controls.Add($script:UrlBox)

$downloadPanel.Controls.Add((New-Label 'SAVE DIRECTORY' 20 145 170 20 8 $script:C.Muted))
$defaultDirectory = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads'
$script:DirectoryBox = New-TextBox $defaultDirectory 20 168 760
$script:DirectoryBox.Anchor = 'Top,Left,Right'
$downloadPanel.Controls.Add($script:DirectoryBox)

$browseButton = New-Button 'Browse...' 795 166 110 36 -Secondary
$browseButton.Anchor = 'Top,Right'
$downloadPanel.Controls.Add($browseButton)

$openFolderButton = New-Button 'Open Folder' 914 166 105 36 -Secondary
$openFolderButton.Anchor = 'Top,Right'
$downloadPanel.Controls.Add($openFolderButton)

$script:ExtractCheckBox = New-Object Windows.Forms.CheckBox
$script:ExtractCheckBox.Text = 'Extract ZIP/TAR archives after download'
$script:ExtractCheckBox.Location = New-Object Drawing.Point(20,213)
$script:ExtractCheckBox.Size = New-Object Drawing.Size(370,25)
$script:ExtractCheckBox.Checked = $true
$script:ExtractCheckBox.ForeColor = $script:C.Foreground
$script:ExtractCheckBox.BackColor = [Drawing.Color]::Transparent
$downloadPanel.Controls.Add($script:ExtractCheckBox)

$script:StartDownloadButton = New-Button 'Start Download' 760 210 140
$script:StartDownloadButton.Anchor = 'Top,Right'
$downloadPanel.Controls.Add($script:StartDownloadButton)

$script:CancelDownloadButton = New-Button 'Cancel' 910 210 110 -Secondary
$script:CancelDownloadButton.Anchor = 'Top,Right'
$script:CancelDownloadButton.Enabled = $false
$downloadPanel.Controls.Add($script:CancelDownloadButton)

# Progress display
$progressPanel = New-Panel 15 300 1030 118
$progressPanel.Anchor = 'Top,Left,Right'
$downloadTab.Controls.Add($progressPanel)

$progressPanel.Controls.Add((New-Label 'Download progress' 20 12 300 25 12))
$script:DownloadStatus = New-Label 'Ready to download' 20 43 700 23 9 $script:C.Muted
$progressPanel.Controls.Add($script:DownloadStatus)

$script:ProgressLabel = New-Label '0%' 760 43 250 23 9 $script:C.Muted
$script:ProgressLabel.TextAlign = [Drawing.ContentAlignment]::MiddleRight
$progressPanel.Controls.Add($script:ProgressLabel)

$script:ProgressBar = New-Object Windows.Forms.ProgressBar
$script:ProgressBar.Location = New-Object Drawing.Point(20,74)
$script:ProgressBar.Size = New-Object Drawing.Size(990,23)
$script:ProgressBar.Anchor = 'Top,Left,Right'
$script:ProgressBar.Minimum = 0
$script:ProgressBar.Maximum = 100
$script:ProgressBar.Style = [Windows.Forms.ProgressBarStyle]::Continuous
$progressPanel.Controls.Add($script:ProgressBar)

# Activity log
$logPanel = New-Panel 15 430 1030 260
$logPanel.Anchor = 'Top,Bottom,Left,Right'
$downloadTab.Controls.Add($logPanel)

$logPanel.Controls.Add((New-Label 'Activity log' 20 12 300 26 12))
$clearLogButton = New-Button 'Clear Log' 915 9 95 30 -Secondary
$clearLogButton.Anchor = 'Top,Right'
$logPanel.Controls.Add($clearLogButton)

$script:LogBox = New-Object Windows.Forms.RichTextBox
$script:LogBox.Location = New-Object Drawing.Point(20,44)
$script:LogBox.Size = New-Object Drawing.Size(990,195)
$script:LogBox.Anchor = 'Top,Bottom,Left,Right'
$script:LogBox.BackColor = $script:C.Background
$script:LogBox.ForeColor = $script:C.Foreground
$script:LogBox.BorderStyle = [Windows.Forms.BorderStyle]::None
$script:LogBox.ReadOnly = $true
$script:LogBox.DetectUrls = $false
$script:LogBox.Font = New-Object Drawing.Font('Consolas',[single]9)
$logPanel.Controls.Add($script:LogBox)

# Task manager
$processPanel = New-Panel 15 15 1030 660
$processPanel.Anchor = 'Top,Bottom,Left,Right'
$processTab.Controls.Add($processPanel)

$processPanel.Controls.Add((New-Label 'Running processes' 20 14 400 30 14))
$processPanel.Controls.Add((New-Label 'Inspect running processes, processor time and memory usage.' 20 44 850 24 9 $script:C.Muted))

$script:ProcessCountLabel = New-Label '0 processes' 800 14 210 26 9 $script:C.Muted
$script:ProcessCountLabel.TextAlign = [Drawing.ContentAlignment]::MiddleRight
$processPanel.Controls.Add($script:ProcessCountLabel)

$script:ProcessList = New-Object Windows.Forms.ListView
$script:ProcessList.Location = New-Object Drawing.Point(20,80)
$script:ProcessList.Size = New-Object Drawing.Size(990,510)
$script:ProcessList.Anchor = 'Top,Bottom,Left,Right'
$script:ProcessList.View = [Windows.Forms.View]::Details
$script:ProcessList.FullRowSelect = $true
$script:ProcessList.GridLines = $true
$script:ProcessList.MultiSelect = $false
$script:ProcessList.HideSelection = $false
$script:ProcessList.BackColor = $script:C.Input
$script:ProcessList.ForeColor = $script:C.Foreground
$script:ProcessList.BorderStyle = [Windows.Forms.BorderStyle]::FixedSingle
$script:ProcessList.Font = New-Object Drawing.Font('Segoe UI',[single]9.5)
$null = $script:ProcessList.Columns.Add('Process name',470)
$null = $script:ProcessList.Columns.Add('PID',110)
$null = $script:ProcessList.Columns.Add('CPU time',170)
$null = $script:ProcessList.Columns.Add('Memory',190)
$processPanel.Controls.Add($script:ProcessList)

$refreshButton = New-Button 'Refresh Processes' 20 605 160
$refreshButton.Anchor = 'Bottom,Left'
$processPanel.Controls.Add($refreshButton)

$endTaskButton = New-Button 'End Task' 190 605 120
$endTaskButton.Anchor = 'Bottom,Left'
$endTaskButton.BackColor = $script:C.Red
$processPanel.Controls.Add($endTaskButton)

$autoRefreshCheckBox = New-Object Windows.Forms.CheckBox
$autoRefreshCheckBox.Text = 'Auto-refresh every 5 seconds'
$autoRefreshCheckBox.Location = New-Object Drawing.Point(330,611)
$autoRefreshCheckBox.Size = New-Object Drawing.Size(250,24)
$autoRefreshCheckBox.ForeColor = $script:C.Muted
$autoRefreshCheckBox.BackColor = [Drawing.Color]::Transparent
$autoRefreshCheckBox.Checked = $true
$processPanel.Controls.Add($autoRefreshCheckBox)

# UI events
$browseButton.Add_Click({
    $dialog = New-Object Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Choose the download destination'
    $dialog.ShowNewFolderButton = $true

    if (Test-Path -LiteralPath $script:DirectoryBox.Text -PathType Container) {
        $dialog.SelectedPath = $script:DirectoryBox.Text
    }

    if ($dialog.ShowDialog($script:MainForm) -eq [Windows.Forms.DialogResult]::OK) {
        $script:DirectoryBox.Text = $dialog.SelectedPath
    }

    $dialog.Dispose()
})

$openFolderButton.Add_Click({ Open-DownloadDirectory })
$script:StartDownloadButton.Add_Click({ Start-Download })

$script:CancelDownloadButton.Add_Click({
    if ($script:DownloadActive -and $null -ne $script:DownloadCancellation) {
        try {
            $script:DownloadCancellation.Cancel()
            Set-DownloadStatus 'Cancellation requested...' $script:C.Red
            Write-Log 'Cancellation requested.' 'WARNING'
            $script:CancelDownloadButton.Enabled = $false
        } catch {}
    }
})

$clearLogButton.Add_Click({ $script:LogBox.Clear() })
$refreshButton.Add_Click({ Refresh-ProcessList })
$endTaskButton.Add_Click({ Stop-SelectedProcess })
$script:ProcessList.Add_DoubleClick({ Stop-SelectedProcess })

$timer = New-Object Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({
    if ($autoRefreshCheckBox.Checked -and $tabs.SelectedTab -eq $processTab) {
        Refresh-ProcessList
    }
})
$timer.Start()

$script:MainForm.Add_Shown({
    Write-Log 'PowerShell Ultimate Hub initialized.' 'SUCCESS'
    Write-Log 'Download requests follow HTTP redirects, including GitHub release/archive redirects.'
    Write-Log 'Choose a URL and destination, then select Start Download.'
    Refresh-ProcessList
})

$script:MainForm.Add_FormClosing({
    param($sender,$eventArgs)

    if ($script:DownloadActive) {
        $answer = [Windows.Forms.MessageBox]::Show(
            'A download is running. Cancel it and close the application?',
            $script:AppTitle,
            [Windows.Forms.MessageBoxButtons]::YesNo,
            [Windows.Forms.MessageBoxIcon]::Warning
        )

        if ($answer -ne [Windows.Forms.DialogResult]::Yes) {
            $eventArgs.Cancel = $true
            return
        }

        if ($null -ne $script:DownloadCancellation) {
            try { $script:DownloadCancellation.Cancel() } catch {}
        }
    }

    $timer.Stop()
    $timer.Dispose()

    if ($null -ne $script:DownloadClient) {
        $script:DownloadClient.Dispose()
    }
})

[void]$script:MainForm.ShowDialog()
