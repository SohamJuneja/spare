# Assembles the final submission video:
#   assets/intro.mp4 + out/demo-core.mp4 + assets/outro.mp4  (0.3 s crossfade at each join)
#   + assets/bed.wav under the demo section only, at -20 dB relative to the VO, 1 s fade in/out.
# Intro/outro keep their own audio. Output: out/spare-demo-v2.mp4 (H.264 CRF 20, AAC 192k, 1920x1080, 30 fps).
#
# Usage (from anywhere):  powershell -ExecutionPolicy Bypass -File video\assemble.ps1
# Optional: -AssetsDir <dir> -Demo <file> -Out <file>
param(
  [string]$AssetsDir = (Join-Path $PSScriptRoot 'assets'),
  [string]$Demo = (Join-Path $PSScriptRoot 'out\demo-core.mp4'),
  [string]$Out = (Join-Path $PSScriptRoot 'out\spare-demo-v2.mp4'),
  [double]$Xfade = 0.3,
  [double]$BedBelowVoDb = 20
)
# 'Continue': Windows PowerShell 5.1 turns ffmpeg's normal stderr output into terminating errors under 'Stop'.
# Failures are caught explicitly below (missing inputs, $LASTEXITCODE).
$ErrorActionPreference = 'Continue'
$inv = [System.Globalization.CultureInfo]::InvariantCulture

$Intro = Join-Path $AssetsDir 'intro.mp4'
$Outro = Join-Path $AssetsDir 'outro.mp4'
$Bed = Join-Path $AssetsDir 'bed.wav'
foreach ($f in @($Intro, $Demo, $Outro, $Bed)) {
  if (-not (Test-Path $f)) { throw "Missing input: $f" }
}

function Get-Duration([string]$file) {
  $d = & ffprobe -v error -show_entries format=duration -of csv=p=0 $file
  return [double]::Parse($d.Trim(), $inv)
}
function Test-Audio([string]$file) {
  $a = & ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 $file
  return [bool]($a)
}
function Get-Lufs([string]$file) {
  # ebur128 integrated loudness (LUFS) of the file's audio.
  $log = cmd /c "ffmpeg -hide_banner -nostats -i `"$file`" -vn -af ebur128=framelog=quiet -f null - 2>&1" | Out-String
  $m = [regex]::Matches($log, 'I:\s+(-?[\d.]+) LUFS')
  if ($m.Count -eq 0) { throw "Could not measure loudness of $file" }
  return [double]::Parse($m[$m.Count - 1].Groups[1].Value, $inv)
}
function F([double]$x) { return $x.ToString('0.000', $inv) }

$d0 = Get-Duration $Intro
$d1 = Get-Duration $Demo
$d2 = Get-Duration $Outro
$off1 = $d0 - $Xfade                 # demo starts here in the final timeline
$off2 = $off1 + $d1 - $Xfade         # outro starts here

$voLufs = Get-Lufs $Demo
$bedLufs = Get-Lufs $Bed
$bedGain = ($voLufs - $BedBelowVoDb) - $bedLufs
Write-Host ("intro {0}s, demo {1}s, outro {2}s; VO {3} LUFS, bed {4} LUFS -> bed gain {5} dB" -f (F $d0), (F $d1), (F $d2), (F $voLufs), (F $bedLufs), (F $bedGain))

# Normalise every clip to the same video/audio format, padding audio to the clip's video length
# (or generating silence if a clip has no audio), so xfade/acrossfade line up exactly.
$durs = @($d0, $d1, $d2)
$files = @($Intro, $Demo, $Outro)
$parts = @()
for ($i = 0; $i -lt 3; $i++) {
  $d = F $durs[$i]
  $parts += "[${i}:v]fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,settb=AVTB[v$i]"
  if (Test-Audio $files[$i]) {
    $parts += "[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:$d,asetpts=PTS-STARTPTS[a$i]"
  } else {
    $parts += "anullsrc=r=48000:cl=stereo,atrim=0:$d,aformat=sample_fmts=fltp:channel_layouts=stereo[a$i]"
  }
}
$x = F $Xfade
$parts += "[v0][v1]xfade=transition=fade:duration=${x}:offset=$(F $off1)[v01]"
$parts += "[v01][v2]xfade=transition=fade:duration=${x}:offset=$(F $off2)[v]"
$parts += "[a0][a1]acrossfade=d=${x}:c1=tri:c2=tri[a01]"
$parts += "[a01][a2]acrossfade=d=${x}:c1=tri:c2=tri[amain]"

# Bed: only as long as the demo, 1 s fades, placed at the demo's start, mixed without normalisation.
$delayMs = [int][math]::Round($off1 * 1000)
$parts += "[3:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:$(F $d1),asetpts=PTS-STARTPTS,volume=$(F $bedGain)dB,afade=t=in:st=0:d=1,afade=t=out:st=$(F ($d1 - 1)):d=1,adelay=${delayMs}|${delayMs}[bed]"
$parts += "[amain][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]"
$filter = $parts -join ';'

New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
# -stream_loop on the bed so a short bed still covers the whole demo.
& ffmpeg -hide_banner -y -i $Intro -i $Demo -i $Outro -stream_loop -1 -i $Bed `
  -filter_complex $filter -map '[v]' -map '[a]' `
  -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -r 30 `
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart $Out
if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed ($LASTEXITCODE)" }

$total = Get-Duration $Out
Write-Host ("Wrote {0} ({1}s; expected {2}s)" -f $Out, (F $total), (F ($d0 + $d1 + $d2 - 2 * $Xfade)))
