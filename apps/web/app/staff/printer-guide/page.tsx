import type { Metadata } from "next";
import Link from "next/link";
import { OperationsShell } from "../../../components/operations/OperationsShell";
import { WindowsPrinterPanel } from "../../../components/operations/windows-printer";
import { requireStaff } from "../../../lib/require-staff";
import "../../../styles/operations.css";
import "../../../styles/printer-guide.css";

export const metadata: Metadata = {
  title: "Kitchen printer · Wok & Chop",
  robots: { index: false, follow: false },
};

export default async function PrinterGuide() {
  await requireStaff("printer");
  return (
    <OperationsShell active="printer">
      <main id="main-content" className="ops-main printer-guide" tabIndex={-1}>
        <header>
          <Link href="/staff/">← Order desk</Link>
          <h1>Kitchen printer</h1>
          <p>
            Set up the Windows printer used for Wok &amp; Chop pickup slips.
          </p>
        </header>

        <div className="printer-guide-layout">
          <WindowsPrinterPanel />
          <section
            className="printer-guide-setup"
            aria-labelledby="printer-setup-title"
          >
            <h2 id="printer-setup-title">Set up the printer</h2>
            <ol>
              <li>
                <h3>Connect it to the Windows workstation</h3>
                <p>
                  Load the thermal roll, turn on the printer, and connect its
                  USB cable to the computer that runs the Wok &amp; Chop API.
                </p>
              </li>
              <li>
                <h3>Check the installed printer</h3>
                <p>
                  Open{" "}
                  <strong>
                    Settings → Bluetooth &amp; devices → Printers &amp; scanners
                  </strong>
                  . Select your thermal printer or add it, using the driver for
                  its exact model if needed.
                </p>
                <a href="https://support.microsoft.com/en-us/windows/hardware/printer/add-or-install-a-printer-in-windows">
                  Microsoft printer setup ↗
                </a>
              </li>
              <li>
                <h3>Point Wok &amp; Chop at the Windows queue</h3>
                <p>
                  Run these commands in PowerShell from the project folder.
                  Enter the exact name of the thermal printer shown in the list.
                  Restart the local API in the same PowerShell session.
                </p>
                <pre>
                  <code>{`Get-Printer | Select-Object -ExpandProperty Name
$env:WOK_WINDOWS_PRINTER = Read-Host 'Exact Windows printer name'
.\\ops\\start-local-accounts.ps1`}</code>
                </pre>
                <p>
                  If the website uses a different port, pass its number with{" "}
                  <code>-WebPort</code>.
                </p>
              </li>
              <li>
                <h3>Verify one slip at the printer</h3>
                <p>
                  Refresh the status here, then send one test slip while
                  standing beside the printer. Check that the full test is
                  readable. Windows can accept a job before paper comes out.
                </p>
              </li>
            </ol>
          </section>
        </div>
        <section
          className="printer-guide-service"
          aria-labelledby="printer-service-title"
        >
          <h2 id="printer-service-title">Print a pickup slip during service</h2>
          <p>
            Open an active pickup ticket in the order desk. Select{" "}
            <strong>View kitchen slip</strong>, then{" "}
            <strong>Print kitchen slip</strong>. If the outcome is unknown,
            check for paper and inspect the Windows queue. You can also save the
            kitchen slip for manual printing.
          </p>
          <Link href="/staff/">
            Open order desk <span aria-hidden="true">→</span>
          </Link>
        </section>
      </main>
    </OperationsShell>
  );
}
