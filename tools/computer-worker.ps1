$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class BujiWindows {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out Rect rect, int size);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetPhysicalCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetPhysicalCursorPos(out Point point);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPhysicalPoint(Point point);
  [DllImport("user32.dll")] public static extern bool RedrawWindow(IntPtr hwnd, IntPtr rect, IntPtr region, uint flags);
  [DllImport("user32.dll")] public static extern uint SendInput(uint count, Input[] inputs, int size);
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int dx, dy; public uint data, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Keyboard { public ushort key, scan; public uint flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct Union { [FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Keyboard keyboard; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public Union value; }
  static void Send(Input[] inputs) { if(SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(Input))) != inputs.Length) throw new InvalidOperationException("Windows refused input. Continue manually."); }
  static void Pointer(IntPtr hwnd,int x,int y) {
    if(!SetPhysicalCursorPos(x,y)) throw new InvalidOperationException("Pointer could not reach the target.");
    Point point;
    if(!GetPhysicalCursorPos(out point)||point.X!=x||point.Y!=y||GetAncestor(WindowFromPhysicalPoint(point),2)!=hwnd||GetForegroundWindow()!=hwnd)
      throw new InvalidOperationException("The physical pointer target is not inside the selected app. No input sent.");
  }
  public static void Click(IntPtr hwnd,int x,int y,bool twice) {
    Pointer(hwnd,x,y);
    for(int i=0;i<(twice?2:1);i++) { Send(new[]{new Input{type=0,value=new Union{mouse=new Mouse{flags=2}}},new Input{type=0,value=new Union{mouse=new Mouse{flags=4}}}}); if(twice)System.Threading.Thread.Sleep(70); }
  }
  public static void TypeText(IntPtr hwnd,string text) {
    foreach(char c in text) { if(GetForegroundWindow()!=hwnd)throw new InvalidOperationException("Focus changed during typing. Input stopped.");Send(new[]{new Input{type=1,value=new Union{keyboard=new Keyboard{scan=c,flags=4}}},new Input{type=1,value=new Union{keyboard=new Keyboard{scan=c,flags=6}}}}); }
  }
  public static void Wheel(IntPtr hwnd,int x,int y,bool down) { Pointer(hwnd,x,y);Send(new[]{new Input{type=0,value=new Union{mouse=new Mouse{data=unchecked((uint)(down?-480:480)),flags=0x800}}}}); }
  public static bool Focus(IntPtr hwnd) {
    if(IsIconic(hwnd))ShowWindow(hwnd,9);
    uint ignored; uint thread=GetCurrentThreadId(), foregroundThread=GetWindowThreadProcessId(GetForegroundWindow(),out ignored);
    bool attached=thread!=foregroundThread&&AttachThreadInput(thread,foregroundThread,true);
    try { BringWindowToTop(hwnd);SetForegroundWindow(hwnd);return GetForegroundWindow()==hwnd; }
    finally {if(attached)AttachThreadInput(thread,foregroundThread,false);}
  }
}
'@
[void][BujiWindows]::SetThreadDpiAwarenessContext([IntPtr](-4))
$script:snapshot = $null
$script:elements = @{}
function Text-Hash([string]$value) {
  $hasher=[Security.Cryptography.SHA256]::Create()
  try { return [Convert]::ToBase64String($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($value))) } finally { $hasher.Dispose() }
}
function Window-Info([long]$windowId) {
  $handle = [IntPtr]$windowId
  if (![BujiWindows]::IsWindow($handle)) { throw 'The selected window is no longer available.' }
  [uint32]$ownerId = 0
  [void][BujiWindows]::GetWindowThreadProcessId($handle, [ref]$ownerId)
  $owner = [Diagnostics.Process]::GetProcessById($ownerId)
  $title = [Text.StringBuilder]::new(512)
  [void][BujiWindows]::GetWindowText($handle, $title, $title.Capacity)
  return @{ id=$windowId; pid=[int]$ownerId; process=$owner.ProcessName; title=$title.ToString(); started=$owner.StartTime.ToUniversalTime().Ticks.ToString() }
}
function Check-Window($expected) {
  $actual = Window-Info $expected.id
  if ($actual.pid -ne $expected.pid -or $actual.started -ne $expected.started -or $actual.process -ne $expected.process) { throw 'The app identity changed. Reconnect before continuing.' }
  if ($actual.process -match '^(cmd|powershell|pwsh|WindowsTerminal|conhost|consent|CredentialUI|LogonUI|LockApp|Taskmgr|Codex(?:-computer-use)?|ChatGPT|Buji(?:V\d+)?|SystemSettings|TextInputHost|explorer|OmApSvcBroker|NVIDIA Overlay|1Password|Bitwarden|KeePass)$' -or $actual.title -match 'Windows Security|User Account Control|password manager|sign[ -]?in|log[ -]?in|authentication|captcha|checkout|payment|banking|^Run$|^Buji V\d+$|^Settings$|^Program Manager$|overlay|Windows Input Experience') { throw 'Protected application or dialog. Continue manually.' }
  return $actual
}
function Observe-Window($window) {
  $actual = Check-Window $window
  $root = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.id)
  $script:elements = @{}
  $script:snapshot = [Guid]::NewGuid().ToString()
  $script:observedAt = [DateTime]::UtcNow
  $script:observedWindow = $actual
  $queue = [Collections.Generic.Queue[object]]::new()
  $queue.Enqueue($root)
  $walker = [Windows.Automation.TreeWalker]::ControlViewWalker
  $output = [Collections.Generic.List[object]]::new()
  $scanned = 0
  $sensitive = $false
  while ($queue.Count -gt 0 -and $scanned -lt 500 -and $output.Count -lt 140) {
    $node = $queue.Dequeue(); $scanned++
    try {
      $current = $node.Current
      if ($current.IsPassword -or $current.Name -match 'password|passcode|one.time code|\bOTP\b|API.?key|access.?token|secret') { if (!$current.IsOffscreen) { $sensitive=$true }; continue }
      if (!$current.IsOffscreen -and !$current.IsPassword) {
        $name = $current.Name
        $type = $current.ControlType.ProgrammaticName.Replace('ControlType.','')
        $value = ''; $valueHash=$null
        $pattern = $null
        if ($type -in @('Edit','Document') -and $node.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)) { $value = $pattern.Current.Value; $valueHash=Text-Hash $value }
        elseif ($type -eq 'Document' -and $node.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern,[ref]$pattern)) { $value = $pattern.DocumentRange.GetText(2400) }
        if ($name.Length -gt 220) { $name = $name.Substring(0,220) }
        if ($value.Length -gt 2400) { $value = $value.Substring(0,2400) }
        $number = $output.Count + 1
        $entry = @{ id=$number; type=$type; name=$name; value=$value; enabled=$current.IsEnabled; password=$false; focused=$current.HasKeyboardFocus }
        $script:elements[$number] = @{ node=$node; runtime=($node.GetRuntimeId() -join ','); name=$current.Name; type=$type; valueHash=$valueHash }
        $output.Add($entry)
      }
      $child = $walker.GetFirstChild($node)
      $siblings = 0
      while ($null -ne $child -and $siblings -lt 100 -and $queue.Count -lt 600) { $queue.Enqueue($child); $child=$walker.GetNextSibling($child); $siblings++ }
    } catch { }
  }
  return @{ window=$actual; snapshot=$script:snapshot; elements=@($output.ToArray()); truncated=($queue.Count -gt 0); sensitive=$sensitive }
}
function Act-Visual($request) {
  $actual=Check-Window $request.window
  if ($request.snapshot -ne $script:snapshot -or ([DateTime]::UtcNow-$script:observedAt).TotalSeconds -gt 240 -or $actual.id -ne $script:observedWindow.id) { throw 'Stale app observation. Observe again.' }
  $script:snapshot=$null
  if (!$request.rect -or $request.operation -notin @('click','double_click','type','key','scroll')) { throw 'Invalid visual input.' }
  $rect=[BujiWindows+Rect]::new()
  if ([BujiWindows]::DwmGetWindowAttribute([IntPtr]$actual.id,9,[ref]$rect,16) -ne 0 -or $rect.Left -ne $request.rect.left -or $rect.Top -ne $request.rect.top -or ($rect.Right-$rect.Left) -ne $request.rect.width -or ($rect.Bottom-$rect.Top) -ne $request.rect.height) { throw 'Window moved or resized. Observe again.' }
  if (![BujiWindows]::Focus([IntPtr]$actual.id)) { throw 'Bring the selected app forward, then observe again. Windows did not grant focus.' }
  [void](Check-Window $request.window)
  if ($request.operation -ne 'key') {
    if ($request.x -isnot [long] -and $request.x -isnot [int]) { throw 'Invalid pointer coordinates.' }
    if ($request.x -lt 0 -or $request.x -gt 1000 -or $request.y -lt 0 -or $request.y -gt 1000) { throw 'Coordinates outside the selected app.' }
    $x=$rect.Left+[int][Math]::Round(($rect.Right-$rect.Left-1)*$request.x/1000)
    $y=$rect.Top+[int][Math]::Round(($rect.Bottom-$rect.Top-1)*$request.y/1000)
    $point=[BujiWindows+Point]::new();$point.X=$x;$point.Y=$y
    $hit=[BujiWindows]::WindowFromPhysicalPoint($point)
    if ([BujiWindows]::GetAncestor($hit,2) -ne [IntPtr]$actual.id) { throw 'Another window covers that target. Observe again.' }
    $control=[Windows.Automation.AutomationElement]::FromPoint([Windows.Point]::new($x,$y))
    $info=$control.Current
    if ($info.IsPassword -or !$info.IsEnabled -or $info.Name -match 'password|passcode|one.time code|\bOTP\b|API.?key|access.?token|secret' -or $info.Name.Trim() -match '^(Send|Submit|Pay|Purchase|Buy|Delete|Permanently delete|Format|Erase|Don.t save|Discard|Agree|Install|Allow|Grant access|Sign in|Log in)\b') { throw 'Protected or sensitive control. Continue manually.' }
    if ($request.operation -eq 'type') {
      $textValue=$null
      if (!$control.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$textValue) -or $textValue.Current.IsReadOnly) { throw 'The visual point did not land in a writable text field. Observe again and choose the field center, not its label or border.' }
    }
  }
  if ([BujiWindows]::GetForegroundWindow() -ne [IntPtr]$actual.id) { throw 'Focus changed. No input sent.' }
  switch ($request.operation) {
    'click' { [BujiWindows]::Click([IntPtr]$actual.id,$x,$y,$false) }
    'double_click' { [BujiWindows]::Click([IntPtr]$actual.id,$x,$y,$true) }
    'scroll' { if ($request.direction -notin @('up','down')) { throw 'Invalid scroll direction.' };[BujiWindows]::Wheel([IntPtr]$actual.id,$x,$y,($request.direction -eq 'down')) }
    'type' {
      if ([string]::IsNullOrEmpty($request.text) -or $request.text.Length -gt 4000) { throw 'Invalid text length.' }
      [BujiWindows]::Click([IntPtr]$actual.id,$x,$y,$false)
      if ([BujiWindows]::GetForegroundWindow() -ne [IntPtr]$actual.id) { throw 'Focus changed. Text not sent.' }
      $focusDeadline=[DateTime]::UtcNow.AddMilliseconds(700)
      do { $focused=[Windows.Automation.AutomationElement]::FocusedElement;if (($focused.GetRuntimeId() -join ',') -eq ($control.GetRuntimeId() -join ',')) {break};Start-Sleep -Milliseconds 30 } while ([DateTime]::UtcNow -lt $focusDeadline)
      if ($focused.Current.IsPassword -or ($focused.GetRuntimeId() -join ',') -ne ($control.GetRuntimeId() -join ',')) { throw 'Input focus does not match the reviewed text field. No text sent.' }
      [Windows.Forms.SendKeys]::SendWait('^a');[BujiWindows]::TypeText([IntPtr]$actual.id,[string]$request.text)
      $deadline=[DateTime]::UtcNow.AddSeconds(2)
      do {
        $entered=$textValue.Current.Value
        if ($entered.Replace("`r`n","`n") -eq ([string]$request.text).Replace("`r`n","`n")) { break }
        Start-Sleep -Milliseconds 40
      } while ([DateTime]::UtcNow -lt $deadline)
      if ($entered.Replace("`r`n","`n") -ne ([string]$request.text).Replace("`r`n","`n")) { throw 'The field did not contain the exact requested text after typing. Observe before retrying; do not claim success.' }
    }
    'key' {
      $keys=@{Enter='{ENTER}';Tab='{TAB}';'Shift+Tab'='+{TAB}';Escape='{ESC}';Space=' ';ArrowUp='{UP}';ArrowDown='{DOWN}';ArrowLeft='{LEFT}';ArrowRight='{RIGHT}';Home='{HOME}';End='{END}';'Ctrl+A'='^a';'Ctrl+S'='^s';'Ctrl+L'='^l'}
      if (!$keys.ContainsKey([string]$request.key)) { throw 'Unsupported visual shortcut.' }
      $focused=[Windows.Automation.AutomationElement]::FocusedElement
      if ($focused.Current.IsPassword -or $focused.Current.Name -match 'password|passcode|\bOTP\b|^(Send|Submit|Pay|Purchase|Buy|Delete|Permanently delete|Format|Erase|Discard|Agree|Install|Allow|Grant access|Sign in|Log in)\b') { throw 'Protected input focus. Continue manually.' }
      [Windows.Forms.SendKeys]::SendWait($keys[[string]$request.key])
    }
  }
  return @{performed=$true;action=$request.operation;target=if($info){$info.Name}else{$request.key}}
}
function Act-Window($request) {
  $actual = Check-Window $request.window
  if ($request.snapshot -ne $script:snapshot -or ([DateTime]::UtcNow-$script:observedAt).TotalSeconds -gt 180 -or $actual.id -ne $script:observedWindow.id) { throw 'Stale observation. Observe again.' }
  $cached = $script:elements[[int]$request.element_id]
  $script:snapshot = $null
  if (!$cached) { throw 'Unknown element.' }
  $node = $cached.node; $current=$node.Current
  if (($node.GetRuntimeId() -join ',') -ne $cached.runtime) { throw 'The control changed. Observe again.' }
  if ($current.Name -ne $cached.name -or $current.IsPassword -or !$current.IsEnabled -or $current.IsOffscreen) { throw 'The control changed or cannot accept input.' }
  if ($current.Name.Trim() -match '^(Send|Submit|Pay|Purchase|Buy|Delete|Permanently delete|Format|Erase|Don.t save|Discard|Agree|Install|Allow|Grant access|Sign in|Log in)\b') { throw 'Complete this action manually.' }
  # Semantic patterns target this exact element without injecting input into the foreground window.
  # Only keyboard events require foreground focus; never send them if focus cannot be proven.
  if ($request.operation -eq 'key') {
    if ([BujiWindows]::IsIconic([IntPtr]$actual.id)) { [void][BujiWindows]::ShowWindow([IntPtr]$actual.id,9) }
    [void][BujiWindows]::SetForegroundWindow([IntPtr]$actual.id)
    if ([BujiWindows]::GetForegroundWindow() -ne [IntPtr]$actual.id) { throw 'The app could not be focused. Bring it forward and observe again.' }
  }
  [void](Check-Window $request.window)
  $pattern=$null
  switch ($request.operation) {
    'click' {
      if ($node.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) { $pattern.Invoke() }
      elseif ($node.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern,[ref]$pattern)) { $pattern.Select() }
      elseif ($node.TryGetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$pattern)) { $pattern.Expand() }
      elseif ($node.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern,[ref]$pattern)) { $pattern.Toggle() }
      else { $node.SetFocus() }
    }
    'type' {
      if ([string]::IsNullOrEmpty($request.text) -or $request.text.Length -gt 4000) { throw 'Invalid text length.' }
      if ($node.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$pattern) -and !$pattern.Current.IsReadOnly) {
        if (!$cached.valueHash -or (Text-Hash $pattern.Current.Value) -ne $cached.valueHash) { throw 'The field changed after observation. Observe again before replacing it.' }
        $pattern.SetValue([string]$request.text)
      }
      else { throw 'This field has no writable accessibility value. Use the app manually.' }
    }
    'key' {
      $keys = @{ Enter='{ENTER}'; Tab='{TAB}'; 'Shift+Tab'='+{TAB}'; Escape='{ESC}'; Space=' '; ArrowUp='{UP}'; ArrowDown='{DOWN}'; ArrowLeft='{LEFT}'; ArrowRight='{RIGHT}'; Home='{HOME}'; End='{END}'; 'Ctrl+A'='^a'; 'Ctrl+S'='^s' }
      if (!$keys.ContainsKey([string]$request.key)) { throw 'Shortcut unavailable.' }
      $node.SetFocus()
      if ([Windows.Automation.AutomationElement]::FocusedElement.Current.IsPassword) { throw 'Password fields cannot be automated.' }
      if ([BujiWindows]::GetForegroundWindow() -ne [IntPtr]$actual.id) { throw 'Focus changed.' }
      [Windows.Forms.SendKeys]::SendWait($keys[[string]$request.key])
    }
    'scroll' {
      if (!$node.TryGetCurrentPattern([Windows.Automation.ScrollPattern]::Pattern,[ref]$pattern)) { throw 'Choose an accessible scrolling container.' }
      $amount = if ($request.direction -eq 'down') { [Windows.Automation.ScrollAmount]::LargeIncrement } elseif ($request.direction -eq 'up') { [Windows.Automation.ScrollAmount]::LargeDecrement } else { throw 'Invalid scroll direction.' }
      $pattern.Scroll([Windows.Automation.ScrollAmount]::NoAmount,$amount)
    }
    default { throw 'Unsupported operation.' }
  }
  return @{ performed=$true }
}
function Capture-Window($window) {
  $actual=Check-Window $window
  $rect=[BujiWindows+Rect]::new()
  if (![BujiWindows]::GetWindowRect([IntPtr]$actual.id,[ref]$rect)) { throw 'Window capture unavailable.' }
  $width=$rect.Right-$rect.Left; $height=$rect.Bottom-$rect.Top
  if ($width -lt 40 -or $height -lt 40 -or $width -gt 10000 -or $height -gt 10000 -or $width*$height -gt 20000000) { throw 'Window capture size unavailable.' }
  $bitmap=[Drawing.Bitmap]::new($width,$height)
  $graphics=[Drawing.Graphics]::FromImage($bitmap)
  try {
    $dc=$graphics.GetHdc()
    try { $ok=[BujiWindows]::PrintWindow([IntPtr]$actual.id,$dc,2) } finally { $graphics.ReleaseHdc($dc) }
    if (!$ok) { throw 'This app does not support window previews.' }
    $colors=[Collections.Generic.HashSet[int]]::new()
    for ($x=20;$x -lt $width-20;$x += [Math]::Max(1,[int]($width/16))) { for ($y=45;$y -lt $height-10;$y += [Math]::Max(1,[int]($height/16))) { [void]$colors.Add($bitmap.GetPixel($x,$y).ToArgb()) } }
    if ($colors.Count -lt 4) { throw 'The app returned a blank window preview.' }
    $ratio=[Math]::Min(1,[Math]::Min(1000/$width,700/$height))
    $small=[Drawing.Bitmap]::new($bitmap,[int]($width*$ratio),[int]($height*$ratio))
    $stream=[IO.MemoryStream]::new()
    try { $small.Save($stream,[Drawing.Imaging.ImageFormat]::Png); return @{image=('data:image/png;base64,'+[Convert]::ToBase64String($stream.ToArray()))} }
    finally { $stream.Dispose();$small.Dispose() }
  } finally { $graphics.Dispose();$bitmap.Dispose() }
}
while ($null -ne ($line=[Console]::ReadLine())) {
  $request=$null
  try {
    if ($line.Length -gt 12000) { throw 'Request too large.' }
    $request=$line | ConvertFrom-Json
    switch ($request.action) {
      'list' {
        $script:windows=[Collections.Generic.List[object]]::new()
        [void][BujiWindows]::EnumWindows({ param($handle,$unused)
          if ([BujiWindows]::IsWindowVisible($handle)) { try { $entry=Window-Info $handle.ToInt64(); if ($entry.title) { $script:windows.Add($entry) } } catch {} }
          return $true
        },[IntPtr]::Zero)
        $result=@{windows=@($script:windows.ToArray())}
      }
      'observe' { $result=Observe-Window $request.window }
      'visual_observe' {
        $actual=Check-Window $request.window
        if (![BujiWindows]::Focus([IntPtr]$actual.id)) { throw 'Bring the selected app forward before visual observation. Windows did not grant focus.' }
        [void][BujiWindows]::RedrawWindow([IntPtr]$actual.id,[IntPtr]::Zero,[IntPtr]::Zero,0x185)
        $result=Observe-Window $request.window
      }
      'act' { $result=Act-Window $request }
      'visual_act' { $result=Act-Visual $request }
      'capture' { $result=Capture-Window $request.window }
      default { throw 'Unsupported helper operation.' }
    }
    $reply=@{id=$request.id;result=$result}
  } catch { $reply=@{id=$request.id;error=$_.Exception.Message} }
  [Console]::WriteLine((ConvertTo-Json -InputObject $reply -Depth 12 -Compress))
}
