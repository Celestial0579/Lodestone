# Runs as the test user, without a password, through a scheduled task with an
# S4U logon (#88). Everything it finds goes to out.txt; nothing here fails the
# run, so that a refusal by Windows reads as a result and not as a red run.
$ErrorActionPreference = 'Continue'
$out = 'C:\profile-test\out.txt'
function Say($text) { Add-Content -Path $out -Value $text -Encoding UTF8 }

try {
  $version = (Get-Content 'C:\profile-test\version.txt' -Raw).Trim()
  Say "whoami: $(whoami)"
  Say "USERPROFILE: $env:USERPROFILE"
  Say "LOCALAPPDATA: $env:LOCALAPPDATA"
  Say "APPDATA: $env:APPDATA"
  Say "known folder: $([Environment]::GetFolderPath('LocalApplicationData'))"
  Say "session: $((Get-Process -Id $PID).SessionId)"
  Say "profile exists: $(Test-Path $env:USERPROFILE)"

  $setup = 'C:\profile-test\setup\LodestoneSetup-x64.exe'
  $p = Start-Process $setup -ArgumentList '--silent' -PassThru
  $null = $p.Handle
  $finished = $p.WaitForExit(180000)
  Say "setup finished: $finished, exit code: $($p.ExitCode)"

  $exe = "$env:LOCALAPPDATA\Lodestone\app-$version\Lodestone.exe"
  for ($i = 0; $i -lt 60 -and -not (Test-Path $exe); $i++) { Start-Sleep 2 }
  Say "installed: $(Test-Path $exe) at $exe"
  if (Test-Path $exe) {
    Say "version: $((Get-Item $exe).VersionInfo.ProductVersion)"
    Say "shortcuts: $(@(Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu" -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*Lodestone*' } | ForEach-Object { $_.FullName }) -join '; ')"

    Start-Sleep 20
    Get-Process Lodestone -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep 3

    $app = Start-Process $exe -PassThru
    Start-Sleep 25
    Say "app running after 25 s: $(-not $app.HasExited)"
    $logs = "$env:LOCALAPPDATA\Lodestone\logs"
    Say "logs folder: $(Test-Path $logs)"
    if (Test-Path $logs) {
      Say "log lines: $((Get-ChildItem $logs -Filter *.log | Get-Content | Measure-Object -Line).Lines)"
    }
    Get-Process Lodestone -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep 5

    $update = "$env:LOCALAPPDATA\Lodestone\Update.exe"
    $u = Start-Process $update -ArgumentList '--uninstall', '-s' -PassThru
    $null = $u.Handle
    $done = $u.WaitForExit(120000)
    Say "uninstall finished: $done, exit code: $($u.ExitCode)"
    Start-Sleep 10
    Say "app left after uninstall: $(@(Get-ChildItem "$env:LOCALAPPDATA\Lodestone\app-*\Lodestone.exe" -ErrorAction SilentlyContinue).Count)"
  }
} catch {
  Say "error: $($_.Exception.Message)"
}
Say 'done'
