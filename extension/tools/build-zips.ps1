# ============================================================================
#  build-zips.ps1  —  package the built extension for distribution.
#
#  Usage:   cd extension && npm run build      # produces dist\chromium + the .xpi
#           pwsh tools/build-zips.ps1
#
#  Outputs to the PARENT folder (Brave Extensions\), where the release expects
#  them (same convention as Twitchphobe/Twitchphage):
#     Twitchphile-<ver>-dragdrop.zip   manifest.json at ROOT      -> drag onto
#                                       the browser's extensions page
#     Twitchphile-<ver>-unpacked.zip   files under Twitchphile/   -> unzip, then
#                                       Load unpacked -> pick that folder
#     Twitchphile-<ver>.xpi            Firefox (already built by `npm run build`)
#
#  We zip the ALREADY-BUILT dist\chromium folder (not source): it's the esbuild
#  output, self-contained, with manifest.json at its root — exactly what a
#  drag-drop wants. The two zips carry the same files; only the top-level layout
#  differs, because Chrome is fussy about drag-drop vs. a human unzipping.
#
#  The built manifest keeps its fixed "key", so the extension ID stays
#  jdemjjgkcelbkaacdfdbnnnifhoomhop — which is what lets it pair silently with
#  the Twitchphile desktop app. Don't strip that key from the manifest.
# ============================================================================
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$ext  = $PSScriptRoot | Split-Path -Parent          # ...\Twitchphile\extension
$repo = Split-Path $ext -Parent                     # ...\Twitchphile
$out  = Split-Path $repo -Parent                    # ...\Brave Extensions
$dist = Join-Path $ext 'dist\chromium'
$ver  = (Get-Content -Raw (Join-Path $dist 'manifest.json') | ConvertFrom-Json).version

if (-not (Test-Path (Join-Path $dist 'manifest.json'))) {
    throw "dist\chromium not built. Run: cd extension; npm run build"
}

# Every file under dist\chromium, as paths relative to it (manifest.json, *.js, fonts\, icons\...).
$files = Get-ChildItem $dist -Recurse -File | ForEach-Object { $_.FullName.Substring($dist.Length + 1) }

function New-TwitchphileZip {
    param([string]$Path, [string]$Prefix)
    if (Test-Path $Path) { Remove-Item $Path -Force }
    $zip = [System.IO.Compression.ZipFile]::Open($Path, 'Create')
    try {
        foreach ($rel in $files) {
            # ZIP paths must use forward slashes; Windows gives us backslashes, and browsers treat a
            # backslash as part of the filename (so icons\16.png wouldn't match the manifest's icons/16.png).
            $forward = $rel -replace '\\', '/'
            $entryName = if ($Prefix) { "$Prefix/$forward" } else { $forward }
            $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
            $stream = $entry.Open()
            try {
                $bytes = [System.IO.File]::ReadAllBytes((Join-Path $dist $rel))
                $stream.Write($bytes, 0, $bytes.Length)
            } finally { $stream.Dispose() }
        }
    } finally { $zip.Dispose() }
    $kb = [math]::Round((Get-Item $Path).Length / 1KB, 1)
    Write-Host ("built {0}  ({1} KB)" -f (Split-Path $Path -Leaf), $kb)
}

New-TwitchphileZip -Path (Join-Path $out "Twitchphile-$ver-dragdrop.zip") -Prefix $null
New-TwitchphileZip -Path (Join-Path $out "Twitchphile-$ver-unpacked.zip") -Prefix 'Twitchphile'

# Firefox: `npm run build` already emitted the .xpi; copy it beside the zips.
$xpiSrc = Join-Path $ext 'dist\twitchphile-firefox.xpi'
$xpiDst = Join-Path $out "Twitchphile-$ver.xpi"
if (Test-Path $xpiSrc) {
    Copy-Item $xpiSrc $xpiDst -Force
    Write-Host ("built {0}  ({1} KB)" -f (Split-Path $xpiDst -Leaf), ([math]::Round((Get-Item $xpiDst).Length / 1KB, 1)))
} else {
    Write-Warning "dist\twitchphile-firefox.xpi not found — run the firefox build."
}
