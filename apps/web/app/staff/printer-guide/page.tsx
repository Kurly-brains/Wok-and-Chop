import type { Metadata } from "next";
import Link from "next/link";
import { OperationsShell } from "../../../components/operations/OperationsShell";
import "../../../styles/operations.css";
import "../../../styles/printer-guide.css";

export const metadata: Metadata = { title: "Thermal printer setup · Wok & Chop", robots: { index: false, follow: false } };

const sections = [
  ["station", "Identify the station"], ["simulator", "Run the simulator"], ["connect", "Connect the printer"],
  ["paper", "Verify a paper slip"], ["recovery", "Recover a missing ticket"], ["service", "Pickup and delivery"],
];

export default function PrinterGuide() {
  return <OperationsShell active="printer">
    <main id="main-content" className="ops-main printer-guide" tabIndex={-1}>
      <header><Link href="/staff/training/#printer-station">← Kitchen printer</Link>
        <h1>Thermal printer setup</h1>
        <p>For the person setting up the kitchen station in Kanata. Start with a virtual ticket, then check one physical slip beside the printer. Allow time outside service for the paper test.</p>
      </header>
      <div className="printer-guide-layout">
        <nav className="printer-guide-contents" aria-label="Guide contents"><strong>In this guide</strong>
          <ol>{sections.map(([id, label]) => <li key={id}><a href={"#" + id}>{label}</a></li>)}</ol>
        </nav>
        <article>
          <section id="station"><h2>1. Identify the kitchen station</h2>
            <p>With the restaurant manager, match the physical printer to its intended station. Record the model, firmware, paper width, interface and station name. Load the correct thermal roll, close the cover and run the printer’s built-in self-test using its model manual.</p>
            <p>The bridge supports a setup slip on an <strong>80 mm, wired Ethernet printer</strong> that accepts raw TCP and ESC/POS text. Confirm the private IPv4 address and port from that unit’s settings sheet. Ask the network administrator to reserve its address so it continues to identify the same station.</p>
            <p><strong>USB-only printer?</strong> The current bridge has no USB driver adapter. A Windows printer queue can identify installed hardware, but selecting that queue here will not send a slip. If the printer also supports Ethernet, use that interface. Otherwise keep the kitchen display available while the exact USB model and driver are qualified.</p>
          </section>
          <section id="simulator"><h2>2. Run the simulator</h2>
            <p>From the training board, open <Link href="/staff/training/#printer-station">Kitchen printer</Link>, choose <strong>Run simulator test</strong>, then <strong>View latest specimen</strong>. “Virtual spool verified” means the saved bytes matched the rendered test. You can do this before the printer arrives.</p>
            <p>To run the same check from a bridge computer, open the project in a terminal with Node 24 and run these commands.</p>
            <pre>{`node apps/print-bridge/check.cjs simulate kitchen-sim-01
node apps/print-bridge/check.cjs status`}</pre>
            <p>The CLI runs from the project root. It stores <code>test-kitchen-sim-01.prn</code> and the <code>checks.sqlite</code> journal under <code>~/.wok-and-chop/printer/</code>. Set <code>WOK_PRINTER_DIAGNOSTICS_DIR</code> to change the location. The local API and the CLI must use the same directory to share results.</p>
          </section>
          <section id="connect"><h2>3. Connect the approved LAN printer</h2>
            <p>Plug the printer and bridge into the restaurant’s private network. Configure the bridge computer with the IPv4 address from the unit’s settings sheet. These commands prompt for the address so a pasted example cannot select another device.</p>
            <h3>Windows PowerShell</h3><pre>{`$env:WOK_PRINTER_IPV4 = Read-Host 'Printer IPv4 from settings sheet'
$env:WOK_PRINTER_PORT = Read-Host 'Printer raw TCP port (Enter for 9100)'
node apps/print-bridge/check.cjs status`}</pre>
            <h3>Linux bridge shell</h3><pre>{`read -r -p 'Printer IPv4 from settings sheet: ' WOK_PRINTER_IPV4
read -r -p 'Printer raw TCP port (Enter for 9100): ' WOK_PRINTER_PORT
export WOK_PRINTER_IPV4 WOK_PRINTER_PORT
node apps/print-bridge/check.cjs status`}</pre>
            <p>Look for <code>setup: configured</code>. This checks the address and port format. Commands in a terminal affect that session and its child processes. Configure the same values in the local API’s environment and restart it if its status panel should show that configuration. Keep the raw printer port on the private LAN.</p>
          </section>
          <section id="paper"><h2>4. Send one slip and check the paper</h2>
            <p>Stand beside the approved printer. Run one test with a fresh ID, such as <code>kitchen-paper-01</code>.</p>
            <pre>node apps/print-bridge/check.cjs test-device kitchen-paper-01</pre>
            <p>Look for <strong>PRINTER TEST / DO NOT PREPARE</strong> at the top and your test ID at the bottom. Check that the station, wrapping and final line are readable, with one complete copy. Enter the ID you read on the paper to record your observation.</p>
            <pre>node apps/print-bridge/check.cjs observed-paper kitchen-paper-01</pre>
            <p>Refresh the staff panel. The socket result and the operator’s paper observation appear separately. Keep the physical slip with the station record and note the model, firmware, date and operator who checked it.</p>
          </section>
          <section id="recovery"><h2>5. Recover a missing ticket</h2>
            <dl className="printer-evidence">
              <div><dt>Connection failed before sending</dt><dd>Confirm power, Ethernet link, paper, assigned address and raw port. After correcting the fault, use a fresh test ID for the intentional retry.</dd></div>
              <div><dt>Socket sent, paper missing</dt><dd>Inspect the target unit, paper orientation, cover, errors and any queued output. A successful socket write provides no device completion signal. Wait for the station to settle before requesting another slip.</dd></div>
              <div><dt>Outcome unknown</dt><dd>Check the physical station and ask the kitchen whether it received the ticket. Reusing the ID returns the journal entry. It cannot issue a second copy. After reconciliation, use a new ID only for a deliberately requested new setup slip.</dd></div>
              <div><dt>Duplicate or unreadable slip</dt><dd>Keep both samples and their IDs. Record the model, width and interface. Resolve the cause and retest before approving that station for service.</dd></div>
            </dl>
          </section>
          <section id="service"><h2>6. Use tickets during service</h2>
            <p><strong>Training pickup.</strong> A ticket created on the shared training board saves a kitchen slip locally. Open the order to view its slip. A reasoned reprint creates a separate, numbered copy. A kitchen acknowledgment records what staff saw.</p>
            <p><strong>Delivery requests.</strong> In the signed-in manager delivery detail, open <strong>View delivery slips</strong>. The kitchen copy lists dishes, modifiers and kitchen notes. The driver copy lists the recipient, drop-off contact, address and delivery instructions. Save the appropriate text copy on the manager workstation only when it is needed. A saved slip does not charge a customer, dispatch a driver or send a job to the printer.</p>
            <p><strong>Before automatic printing goes live.</strong> Approve the exact hardware, test real ticket widths and allergy notes, then rehearse paper-out, cover-open, power loss, network loss and bridge restart with test jobs. A production bridge also needs authenticated order release, durable jobs, duplicate prevention, an alert for unknown outcomes and a working kitchen-display fallback. Completing the setup slip alone does not enable live order dispatch.</p>
            <p>Use the manufacturer’s exact model manual for the self-test, network settings sheet and error lights. An Epson TM-T88VII is one documented example. <a href="https://download4.epson.biz/sec_pubs/bs/pdf/TM-T88VII_trg_en_revG.pdf">Epson TM-T88VII technical reference</a></p>
          </section>
        </article>
      </div>
    </main>
  </OperationsShell>;
}
