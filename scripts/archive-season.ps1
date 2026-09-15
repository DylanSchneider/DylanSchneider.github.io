<#
.SYNOPSIS
  Tag the current commit as a snapshot of one year's Halloween party site.

.DESCRIPTION
  This repo doesn't use per-year branches for deployment (GitHub Pages for
  a user site only serves one branch), so instead each year's exact code
  is preserved as a lightweight git tag: party-<year>. Ongoing development
  keeps happening on master; tags just mark "this is what guests used."

.PARAMETER Year
  The year to tag, e.g. 2026. Defaults to the current year.

.PARAMETER Push
  Push the new tag to origin immediately. If omitted, you'll be asked.

.EXAMPLE
  ./scripts/archive-season.ps1 2026
#>
param(
  [Parameter(Position = 0)]
  [int]$Year = (Get-Date).Year,

  [switch]$Push
)

$ErrorActionPreference = 'Stop'

$tag = "party-$Year"

$existing = git tag --list $tag
if ($existing) {
  Write-Error "Tag '$tag' already exists (commit $(git rev-list -n 1 $tag)). Delete it first if you really want to re-tag: git tag -d $tag"
  exit 1
}

$status = git status --porcelain
if ($status) {
  Write-Warning "Working tree has uncommitted changes. Tagging HEAD anyway (uncommitted changes are NOT included in the tag)."
}

$sha = git rev-parse --short HEAD
$msg = "Halloween $Year - snapshot of the site as deployed for the party"
git tag -a $tag -m $msg
Write-Host "Tagged $sha as '$tag'." -ForegroundColor Green

if (-not $Push) {
  $answer = Read-Host "Push tag '$tag' to origin now? [Y/n]"
  $Push = ($answer -eq '' -or $answer -match '^[Yy]')
}

if ($Push) {
  git push origin $tag
  Write-Host "Pushed '$tag' to origin." -ForegroundColor Green
} else {
  Write-Host "Not pushed. Push later with: git push origin $tag"
}
