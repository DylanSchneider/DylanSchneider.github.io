<#
.SYNOPSIS
  Preserve a committed Halloween release as an annotated <year>_<theme> tag.
.EXAMPLE
  ./scripts/archive-season.ps1 -Year 2027 -Theme 'NextTheme' -Push
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateRange(2000, 9999)]
  [int]$Year = (Get-Date).Year,

  [Parameter(Mandatory = $true, Position = 1)]
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]*$')]
  [string]$Theme,

  [switch]$Push
)

$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
  $tag = "${Year}_$Theme"
  $status = git status --porcelain
  if ($LASTEXITCODE -ne 0) { throw 'Could not read Git status.' }
  if ($status) { throw 'Commit or stash changes first. A tag only preserves committed files.' }

  $existing = git tag --list $tag
  if ($LASTEXITCODE -ne 0) { throw 'Could not read Git tags.' }
  if ($existing) { throw "Tag '$tag' already exists. Annual archives must not be overwritten." }

  if ($Push) {
    $remoteTag = git ls-remote --tags origin "refs/tags/$tag"
    if ($LASTEXITCODE -ne 0) { throw 'Could not check origin for the archive tag.' }
    if ($remoteTag) { throw "Tag '$tag' already exists on origin. Fetch it instead of overwriting it." }
  }

  $sha = git rev-parse HEAD
  if ($LASTEXITCODE -ne 0) { throw 'Could not resolve HEAD.' }
  git tag -a $tag -m "Halloween $Year - $Theme; archived party release" $sha
  if ($LASTEXITCODE -ne 0) { throw "Could not create tag '$tag'." }
  Write-Host "Archived $sha as '$tag'."

  if ($Push) {
    git push origin "refs/tags/$tag"
    if ($LASTEXITCODE -ne 0) { throw "Tag exists locally, but push failed. Retry: git push origin refs/tags/$tag" }
    Write-Host "Pushed '$tag' to origin."
  } else {
    Write-Host "Push when ready: git push origin refs/tags/$tag"
  }
} finally {
  Pop-Location
}
