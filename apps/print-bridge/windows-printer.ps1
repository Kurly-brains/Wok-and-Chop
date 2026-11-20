$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($payload.operation -notin @('status', 'print') -or $payload.queueName -isnot [string] -or
      $payload.queueName.Length -lt 1 -or $payload.queueName.Length -gt 220 -or $payload.queueName -match '[\x00-\x1f\x7f]') {
    throw 'Invalid printer request.'
  }
  # Exact comparison: never select the Windows default, parse a command, or install/change a queue.
  $selectedQueue = @(Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Name -ceq $payload.queueName })
  $available = $selectedQueue.Count -eq 1
  if ($available) {
    $queue = $selectedQueue[0]
    $available = -not $queue.WorkOffline -and $queue.PortName -notin @('FILE:', 'PORTPROMPT:', 'nul:') -and
      $queue.DriverName -notmatch 'Microsoft Print To PDF|Microsoft XPS|OneNote|Virtual Print|Fax' -and
      $queue.ExtendedPrinterStatus -notin @(6,7,8,9,11,16,18) -and
      $queue.DetectedErrorState -notin @(4,6,7,8,9,10,11)
  }
  if ($payload.operation -eq 'status') {
    @{ available = [bool]$available } | ConvertTo-Json -Compress
    exit 0
  }
  if (-not $available -or $payload.jobId -notmatch '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' -or
      $payload.text -isnot [string] -or $payload.text.Length -lt 1 -or $payload.text.Length -gt 100000 -or
      $payload.text -match '[\x00-\x09\x0b-\x1f\x7f-\x9f]') {
    throw 'Printer or rendered ticket unavailable.'
  }
  Add-Type -AssemblyName System.Drawing
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Printing;
public static class WokWindowsTicket {
  public static bool Started;
  public static void Send(string queue, string id, string text) {
    using (var document = new PrintDocument())
    using (var font = new Font("Courier New", 9, FontStyle.Regular))
    using (var format = new StringFormat(StringFormatFlags.LineLimit)) {
      document.PrinterSettings.PrinterName = queue;
      if (!document.PrinterSettings.IsValid) throw new InvalidOperationException("Invalid queue");
      document.PrinterSettings.PrintToFile = false;
      document.PrinterSettings.Copies = 1;
      document.DocumentName = "Wok and Chop " + id;
      document.PrintController = new StandardPrintController();
      // Use the receipt stock and cutter settings configured in this queue's driver.
      document.DefaultPageSettings.Margins = new Margins(10, 10, 10, 10);
      int offset = 0;
      int pages = 0;
      document.PrintPage += delegate(object sender, PrintPageEventArgs e) {
        if (++pages > 100) throw new InvalidOperationException("Ticket pagination limit");
        var area = new RectangleF(e.MarginBounds.Left, e.MarginBounds.Top, e.MarginBounds.Width, e.MarginBounds.Height);
        if (area.Width < 80 || area.Height < 40) throw new InvalidOperationException("Invalid paper area");
        string remaining = text.Substring(offset);
        int characters, lines;
        e.Graphics.MeasureString(remaining, font, area.Size, format, out characters, out lines);
        if (characters < 1) throw new InvalidOperationException("No printable text area");
        e.Graphics.DrawString(remaining.Substring(0, characters), font, Brushes.Black, area, format);
        offset += characters;
        e.HasMorePages = offset < text.Length;
      };
      Started = true;
      document.Print();
    }
  }
}
'@
  try {
    [WokWindowsTicket]::Send($payload.queueName, $payload.jobId, $payload.text)
    @{ status = 'SPOOLED' } | ConvertTo-Json -Compress
  } catch {
    @{ status = $(if ([WokWindowsTicket]::Started) { 'UNKNOWN' } else { 'FAILED' }) } | ConvertTo-Json -Compress
  }
} catch {
  # No PrintDocument call has started on this path. Do not expose OS exceptions or ticket data.
  if ($null -ne $payload -and $payload.operation -eq 'status') {
    @{ available = $false } | ConvertTo-Json -Compress
  } else {
    @{ status = 'FAILED' } | ConvertTo-Json -Compress
  }
}
