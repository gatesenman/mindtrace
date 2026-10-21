// Windows 内置 OCR（Windows.Media.Ocr，WinRT），完全本地，无需模型/网络。
// 借鉴：Windrecorder 使用 Windows.Media.Ocr 作为默认引擎（中文 0.26s / 90%）；Screenpipe 以系统 OCR 作为无障碍文本的兜底。
const { PsHost } = require('../common/psHost');
const dedup = require('./textdedup');
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1' })[0]
function Await($op, $t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $null = $task.Wait(-1); $task.Result }
$engine = $null
try { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('zh-Hans-CN')) } catch {}
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
$langs = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag })
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  try {
    if ($line -eq '__probe__') { @{ ok = [bool]$engine; langs = $langs; lang = $(if ($engine) { $engine.RecognizerLanguage.LanguageTag } else { '' }) } | ConvertTo-Json -Compress; [Console]::Out.Flush(); continue }
    if (-not $engine) { throw '系统未安装任何 OCR 语言包' }
    $f = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($line)) ([Windows.Storage.StorageFile])
    $s = Await ($f.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $d = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($s)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $b = Await ($d.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $r = Await ($engine.RecognizeAsync($b)) ([Windows.Media.Ocr.OcrResult])
    $s.Dispose()
    @{ ok = $true; lines = @($r.Lines | ForEach-Object { $_.Text }) } | ConvertTo-Json -Compress -Depth 3
  } catch { @{ ok = $false; error = "$($_.Exception.Message)" } | ConvertTo-Json -Compress }
  [Console]::Out.Flush()
}
`;
let host = null; let probed = null; const cache = new Map();
function getHost(opts = {}) { if (!host) host = new PsHost({ name: 'winocr', script: SCRIPT, timeoutMs: 15000, ...opts }); return host; }
function supported() { return process.platform === 'win32' || !!(host && host.spawnImpl); }
async function probe() {
  if (!supported()) return { ok: false, error: '仅 Windows 10/11 支持系统 OCR', langs: [] };
  if (probed) return probed;
  try { probed = await getHost().request('__probe__'); } catch (e) { probed = { ok: false, error: e.message, langs: [] }; }
  return probed;
}
/** 识别图片 → {ok, lines, text, ms, cached}; key 一般用 phash，命中缓存则不重复识别 */
async function recognize(file, { key } = {}) {
  if (!supported()) return { ok: false, error: 'unsupported' };
  if (key && cache.has(key)) return { ...cache.get(key), cached: true };
  const t0 = Date.now();
  let r; try { r = await getHost().request(file); } catch (e) { return { ok: false, error: e.message }; }
  if (!r || !r.ok) return { ok: false, error: r?.error || 'OCR 失败' };
  const lines = dedup.normalize(r.lines || []);
  const out = { ok: true, lines, text: lines.join('\n'), ms: Date.now() - t0 };
  if (key) { cache.set(key, out); if (cache.size > 200) cache.delete(cache.keys().next().value); }
  return out;
}
function info() { return host ? host.info() : { alive: false, requests: 0 }; }
function _inject(spawnImpl) { if (host) host.stop(); host = new PsHost({ name: 'winocr', script: SCRIPT, timeoutMs: 3000, spawnImpl }); probed = null; cache.clear(); }
function stop() { host && host.stop(); }
module.exports = { recognize, probe, info, stop, supported, SCRIPT, _inject };
