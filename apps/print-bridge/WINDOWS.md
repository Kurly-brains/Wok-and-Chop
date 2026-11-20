# Windows printer connection

The current owner request selects the Windows PC and its installed printer queue, including USB-connected printers, instead of the original proposed Linux bridge. This implementation is a **manual local printer connection**. It does not enable paid-order automatic dispatch or claim physical printer qualification.

## Connect the queue

1. Install the exact printer manufacturer's Windows driver and connect the printer to this PC. In the printer's Windows preferences, select the correct receipt paper width/length and cutter settings. The application uses those driver settings and does not change Windows defaults.
2. Read the queue name in Windows **Printers & scanners**, or use the read-only command `Get-Printer | Select-Object Name, DriverName, PortName`.
3. In the PowerShell session used to start the local API, set `$env:WOK_WINDOWS_PRINTER = 'Exact installed queue name'`. Run the API under the same Windows user that can access this queue. Apply database migration `013_windows_print_jobs.up.sql` through the local startup/migration workflow, then restart the local API.
4. Sign in as a restaurant manager and open the printer panel. **Ready for a test** means Windows reports an available queue. Send one intentional test, then inspect its full paper output. Test long modifiers, notes, accented names, page length and cutting on the actual device before using kitchen tickets.

The Windows helper calls the fixed Windows PowerShell 5.1 executable and the repository's `windows-printer.ps1` with a JSON request on stdin. It uses `System.Drawing.Printing.PrintDocument` and `StandardPrintController` to submit text through the selected driver, without a browser dialog. Queue names and ticket text are not shell commands. PDF/XPS/file-prompt queues are rejected. The helper does not install drivers, change Windows settings, select a default printer, or use an assumed ESC/POS protocol.

The repository's helper `.ps1` file must remain available when running the compiled API. Source and compiled startup from the repository root or `apps/api` are supported. The API must run on the Windows computer connected to the queue; a hosted website alone cannot access its USB printer.

## API and result meanings

Every endpoint below requires a current restaurant-manager account. POST requests also require the configured local web origin and JSON content type.

- `GET /v1/auth/admin/printer`: queue readiness and the latest 15 dispatch records. `physicalOutputVerified` stays `false`; driver status cannot establish actual paper output.
- `POST /v1/auth/admin/printer/test` with `{ "requestId": "<UUID>" }`: fixed **PRINTER TEST / DO NOT PREPARE** ticket.
- `POST /v1/auth/admin/printer/pickups/:id` with `{ "requestId": "<UUID>" }`: one original kitchen copy from the saved pickup snapshot. Names, quantities, modifiers and notes come from the server. No customer email, phone, address or payment data is printed. Current local pickup tickets say **UNPAID / CHECK PAYMENT BEFORE HANDOVER**.

Both POST endpoints return `{ "job": ... }`. Browser ticket text, destinations and printer commands are not accepted. A repeated request returns its existing job; a pickup can have only one original ticket even with a new request ID. Cancelled or collected pickups cannot create a new original ticket. There is no automatic printing or automatic resend.

| State | Meaning and action |
| --- | --- |
| `SENDING` | PostgreSQL recorded immutable intent before the Windows call. Wait and refresh. Only one active dispatch per queue is allowed. |
| `SPOOLED` | Windows accepted the document. Inspect the printer and queue; this does not prove physical completion. |
| `FAILED` | The helper reported failure before starting printing. Check the queue and driver. The existing job is retained, not automatically retried. A new test ID is an intentional new test. |
| `UNKNOWN` | Printing may have happened, or the process lost its outcome. Inspect paper and the Windows queue. The job will not be resent. |

An interrupted `SENDING` record becomes `UNKNOWN` when next checked after two minutes. Request retries never erase an uncertain outcome. This version intentionally has no pickup-reprint endpoint or automatic cancellation slip. When cancellation races manual dispatch, staff must check the paper and communicate the cancellation to the kitchen. Use the staff order desk as the authoritative current order state.

The Windows spooler may keep an accepted job while a device is offline. Do not click another test because paper is delayed without first checking the queue. The application does not purge Windows jobs or infer device completion from disappearance from the queue.

## Verification and remaining qualification

Automated tests use an injected adapter and dedicated PostgreSQL test database. They cover manager authorization, origin checks, fixed destinations, durable intent, duplicate requests, queue serialization, immutable ticket hashes, server-derived pickup lines, cancelled orders, uncertain dispatch and restart recovery. No automated test sends to physical hardware.

Before operational use, qualify the actual printer/driver and test paper-out, cover-open, unplugging/reconnecting USB, stopping/restarting the local API, long tickets, power loss during printing, and recovery without duplicate cooking instructions. Paid automatic dispatch, reprints with audit/copy markers, device-confirmed completion, Windows service installation, and hosted-to-local authenticated bridging are separate work.

Official references: [PrintDocument.Print](https://learn.microsoft.com/en-us/dotnet/api/system.drawing.printing.printdocument.print?view=netframework-4.8.1), [StandardPrintController](https://learn.microsoft.com/en-us/dotnet/api/system.drawing.printing.standardprintcontroller?view=netframework-4.8.1), [Win32_Printer status](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-printer).
