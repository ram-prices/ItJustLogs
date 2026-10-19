& {
  # ItJustLogs - Arknights: Endfield pull history exporter
  #
  # What this does, step by step:
  #   1. Reads the game's own web cache on this PC to find the "headhunting history"
  #      link the game opened most recently (that link contains a temporary token).
  #   2. Downloads your pull history from Gryphline's official server
  #      (ef-webview.gryphline.com) - the same server the in-game history page uses.
  #   3. Saves it to a JSON file on your Desktop and copies it to your clipboard.
  #
  # What this does NOT do: it does not send your token or data anywhere except
  # Gryphline's server, does not need administrator rights, does not change any
  # settings, and does not install or download anything else.
  #
  # Before running: open the game, view your headhunting history once (the link expires),
  # then close the game. While it runs, the game keeps the cache file that holds the
  # link open, and Windows won't let anything else read it.
  # After pasting, press Enter if PowerShell shows a >> prompt.

  $ErrorActionPreference = 'Stop'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $api = 'https://ef-webview.gryphline.com/api/record'
  $urlPattern = 'https://ef-webview\.gryphline\.com/api/record/char\?[^\x00\s"''<>]+'

  function Get-Json([string]$url) {
    try {
      $res = Invoke-WebRequest -Uri $url -UseBasicParsing -Headers @{ 'User-Agent' = 'Mozilla/5.0' }
    } catch {
      # The server answers bad requests with a JSON explanation; return it instead of crashing.
      if ($_.ErrorDetails -and $_.ErrorDetails.Message) { return $_.ErrorDetails.Message | ConvertFrom-Json }
      throw
    }
    # Decode as UTF-8 explicitly; Windows PowerShell 5.1 otherwise guesses Latin-1.
    $ms = New-Object IO.MemoryStream
    $res.RawContentStream.CopyTo($ms)
    [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
  }

  function Get-ServerMessage($response) {
    (@($response.msg) + @($response.message) | Where-Object { $_ } | ForEach-Object { [string]$_ }) -join '; '
  }

  # Returns the newest history link in the game's web cache, and whether any cache
  # file was locked (the game holds its cache open while running, so it must be closed).
  function Find-HistoryUrl {
    $result = @{ Url = $null; Locked = $false }
    $cacheDir = Join-Path $env:LOCALAPPDATA 'PlatformProcess\Cache'
    if (-not (Test-Path $cacheDir)) { return $result }
    $files = Get-ChildItem $cacheDir -File | Sort-Object LastWriteTime -Descending
    foreach ($f in $files) {
      try {
        $fs = [IO.File]::Open($f.FullName, 'Open', 'Read', 'ReadWrite')
        try {
          $bytes = New-Object byte[] $fs.Length
          [void]$fs.Read($bytes, 0, $bytes.Length)
        } finally { $fs.Close() }
      } catch [IO.IOException] {
        $result.Locked = $true
        continue
      } catch { continue }
      $text = [Text.Encoding]::GetEncoding(28591).GetString($bytes)
      $found = [regex]::Matches($text, $urlPattern)
      if ($found.Count -gt 0) {
        $result.Url = $found[$found.Count - 1].Value
        return $result
      }
    }
    return $result
  }

  function Get-QueryValue([string]$url, [string]$pattern) {
    foreach ($pair in ($url -split '\?', 2)[1] -split '&') {
      $k, $v = $pair -split '=', 2
      if ($k -match $pattern) { return [Uri]::UnescapeDataString($v).TrimEnd('?') }
    }
    return $null
  }

  Write-Host ''
  Write-Host '=== ItJustLogs pull history exporter ===' -ForegroundColor Yellow

  $cache = Find-HistoryUrl
  $url = $cache.Url
  if (-not $url) {
    if ($cache.Locked) {
      Write-Host 'The game is still running, so its cache file is in use and cannot be read.' -ForegroundColor Red
      Write-Host 'Close the game completely, then run this again.'
    } else {
      Write-Host 'Could not find your history link in the game cache.' -ForegroundColor Red
      Write-Host 'Open the game, view your headhunting history, close the game, then run this again.'
    }
    return
  }

  $token = Get-QueryValue $url 'token'
  $server = Get-QueryValue $url '^server(_id)?$'
  $lang = Get-QueryValue $url 'lang'
  if (-not $lang) { $lang = 'en-us' }
  if (-not $token -or -not $server) {
    Write-Host 'The history link found in the cache is incomplete. View your history in-game, close the game, then run this again.' -ForegroundColor Red
    return
  }
  $q = 'lang=' + [Uri]::EscapeDataString($lang) + '&token=' + [Uri]::EscapeDataString($token) + '&server_id=' + [Uri]::EscapeDataString($server)

  # Character history is fetched per banner type; weapons need none.
  # These are the types the server accepted as of October 2026.
  $charPools = @(
    'E_CharacterGachaPoolType_Beginner',
    'E_CharacterGachaPoolType_Standard',
    'E_CharacterGachaPoolType_Special',
    'E_CharacterGachaPoolType_Joint'
  )
  $invalidPool = 40000

  function Get-Records([string]$endpoint, [string]$pool) {
    $all = New-Object System.Collections.ArrayList
    $seq = $null
    do {
      $u = "$api/$endpoint`?$q"
      if ($pool) { $u += '&pool_type=' + [Uri]::EscapeDataString($pool) }
      if ($seq) { $u += "&seq_id=$seq" }
      $page = Get-Json $u
      if ($pool -and $page.code -eq $invalidPool) {
        Write-Host "  Skipping $pool (the server no longer recognises it)." -ForegroundColor DarkYellow
        break
      }
      if ($page.code -ne 0) {
        throw "The server rejected the request ($(Get-ServerMessage $page)). If the history link expired, view your history in-game, close the game, then run this again."
      }
      $list = @($page.data.list)
      if ($list.Count) { $all.AddRange($list); $seq = $list[-1].seqId }
      Start-Sleep -Milliseconds 300
    } while ($page.data.hasMore -and $list.Count)
    return , $all
  }

  try {
    $characters = New-Object System.Collections.ArrayList
    foreach ($pool in $charPools) {
      Write-Host "  Downloading operator pulls ($($pool -replace '^E_CharacterGachaPoolType_', ''))..."
      $characters.AddRange((Get-Records 'char' $pool))
    }
    Write-Host '  Downloading arsenal pulls...'
    $weapons = Get-Records 'weapon' $null
  } catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    return
  }

  $json = [pscustomobject]@{ characters = @($characters); weapons = @($weapons) } | ConvertTo-Json -Depth 6 -Compress
  $name = 'endfield_pulls_' + (Get-Date -Format 'yyyy-MM-dd') + '.json'
  $path = Join-Path ([Environment]::GetFolderPath('Desktop')) $name
  [IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding $false))
  Set-Clipboard -Value $json

  Write-Host ''
  Write-Host "Done: $($characters.Count) operator pulls and $($weapons.Count) arsenal pulls." -ForegroundColor Green
  Write-Host "Saved to $path"
  Write-Host 'Also copied to your clipboard - go back to ItJustLogs and press Ctrl+V.'
}
