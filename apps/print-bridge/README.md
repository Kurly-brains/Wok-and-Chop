# Local printer diagnostics

Open the [Thermal printer setup guide](http://127.0.0.1:3000/staff/printer-guide/) for station preparation, Windows and Linux configuration, paper checks and missing-ticket recovery. With the local API running, open **Training board → Kitchen printer** to produce a fixed setup ticket. The simulator writes a `.prn` file, reads it back and compares the contents. It uses the kitchen ticket formatter and a virtual spool. The latest result is also available with `node apps/print-bridge/check.cjs status`.

The commands below run from the repository root with Node 24. SQLite keeps each specimen, its SHA-256 digest, target, timestamp and outcome. Files live in `~/.wok-and-chop/printer/` by default. Set `WOK_PRINTER_DIAGNOSTICS_DIR` to a directory owned by the local service user to use another location. Run the CLI and API on the same workstation with the same data directory to see CLI outcomes in Staff. Each ID identifies one dispatch. Reusing it reads the existing result.

1. Run `node apps/print-bridge/check.cjs simulate counter-sim-01` to test the virtual spool.
2. At the restaurant, identify the wired 80 mm printer and confirm the exact model and firmware support ESC/POS printing and a raw TCP port. Set `WOK_PRINTER_IPV4` to its private LAN IPv4 address and `WOK_PRINTER_PORT` to its configured port (default 9100). The bridge opens an outbound socket to that address only.
3. Run `node apps/print-bridge/check.cjs test-device counter-test-01` to send one clearly marked setup slip. Use a fresh ID for an intentional new slip. Inspect the physical output. No web endpoint can select a destination, send custom bytes or initiate a hardware test.
4. Read the ID from the physical slip. Use `node apps/print-bridge/check.cjs observed-paper counter-test-01` with that ID to journal the operator’s observation. Refresh the staff status. `socket-sent` records a completed local socket write. `not-sent` records a failure before the write began. `uncertain` means dispatch may have started and staff should check the paper. The observation stays separate from the transport result.

The diagnostic uses fixed printable ASCII and LF with a 42-column specimen. Model-specific paper width, extended characters and completion acknowledgments require separate qualification. [Epson ESC/POS line-feed reference](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/lf.html)

## Production dispatch requirements

Qualify the exact wired 80 mm printer, firmware, encoding, driver, Linux host and network before enabling production tickets. Production dispatch still requires an outbound HTTPS machine identity, stable job hashes, monotonic fencing tokens and a server dispatch-start authorization gate. Journal the sending intent before possible output.

Transport delivery means bytes were accepted by the transport. Device confirmation requires job-specific physical-completion evidence from the qualified printer. Kitchen acknowledgment is a separate staff event. If output might have occurred and the outcome is missing, persist UNKNOWN and stop unattended resend. A lease timeout or reboot alone is never proof that no output occurred. A manager-authorized reprint is a new linked job with copy number, actor, reason and REPRINT marking.

Proposed defaults: poll 2 seconds, heartbeat 15 seconds, offline 45 seconds, overdue alert 30 seconds, escalation 120 seconds. These are configuration targets, not measured behavior. Production dispatch must remain disabled after database restoration until provider records, cloud jobs and local journal evidence have been reconciled.

Qualification record must include readable long/modifier/allergy tickets, accented text, paper-out, cover-open, network interruption, power loss during output, bridge restart, stale fencing rejection, cancellation racing dispatch, explicit reprint, and recovery without silent omissions or unattended duplicates. Record the actual evidence level and physical tickets.
